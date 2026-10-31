import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { INITIAL_INVENTORY_SLOTS } from '../shared/constants';
import { ITEM_IDS } from '../shared/ItemRegistry';
import {
  DroppedItem,
  EquippedItems,
  InventorySlot,
  PlayerProfile,
  TileData,
  WeatherType,
  WorldSummary,
} from '../shared/types';
import { generateWorld } from '../shared/WorldGenerator';

export interface StoredWorld {
  name: string;
  width: number;
  height: number;
  weather: WeatherType;
  ownerId: string | null;
  ownerName: string | null;
  spawnX: number;
  spawnY: number;
  tiles: TileData[];
  drops: DroppedItem[];
  visitCount: number;
  dirty?: boolean;
}

interface CompactTileTuple {
  i: number;
  f: number;
  b: number;
  m?: TileData['meta'];
}

export class SaveManager {
  private db: DatabaseSync;
  private closed = false;

  constructor(dbPath = path.resolve(process.cwd(), 'data', 'groktopia.db')) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    if (dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE COLLATE NOCASE NOT NULL,
        password_hash TEXT NOT NULL,
        skin_color TEXT NOT NULL,
        gems INTEGER NOT NULL DEFAULT 75,
        max_slots INTEGER NOT NULL DEFAULT 20,
        inventory_json TEXT NOT NULL,
        equipped_json TEXT NOT NULL,
        last_world TEXT NOT NULL DEFAULT 'START',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS worlds (
        name TEXT PRIMARY KEY,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        weather TEXT NOT NULL DEFAULT 'sunny',
        owner_id TEXT,
        owner_name TEXT,
        spawn_x INTEGER NOT NULL,
        spawn_y INTEGER NOT NULL,
        tiles_json TEXT NOT NULL,
        drops_json TEXT NOT NULL,
        visit_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  private hashPassword(password: string, salt: string): string {
    const derived = crypto.scryptSync(password, salt, 32).toString('hex');
    return `${salt}:${derived}`;
  }

  private verifyPassword(password: string, stored: string): boolean {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const check = crypto.scryptSync(password, salt, 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  }

  public authenticateOrRegister(
    rawUsername: string,
    rawPassword: string,
    skinColor: string
  ): { ok: true; profile: PlayerProfile } | { ok: false; error: string } {
    const username = rawUsername.trim().replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16);
    if (username.length < 2) {
      return { ok: false, error: 'GrowID must be 2–16 letters/numbers.' };
    }
    const password = rawPassword || 'guest';
    const validSkins = ['#f2b885', '#ffdbb5', '#d9955b', '#9e6234', '#633a1d', '#8fd9a8', '#9ecaff'];
    const safeSkin = validSkins.includes(skinColor) ? skinColor : '#f2b885';

    const existing = this.db
      .prepare('SELECT * FROM players WHERE username = ?')
      .get(username) as Record<string, unknown> | undefined;

    if (existing) {
      const storedHash = String(existing.password_hash);
      if (!this.verifyPassword(password, storedHash)) {
        return { ok: false, error: 'Incorrect password for existing GrowID!' };
      }
      // Update skin color if chosen on login screen
      this.db
        .prepare('UPDATE players SET skin_color = ?, updated_at = ? WHERE id = ?')
        .run(safeSkin, Date.now(), String(existing.id));

      return {
        ok: true,
        profile: {
          id: String(existing.id),
          username: String(existing.username),
          skinColor: safeSkin,
          gems: Number(existing.gems),
          maxSlots: Number(existing.max_slots),
          inventory: JSON.parse(String(existing.inventory_json)) as InventorySlot[],
          equipped: JSON.parse(String(existing.equipped_json)) as EquippedItems,
        },
      };
    }

    // Create new Growtopian account with starter builder tools!
    const id = `plr_${crypto.randomUUID()}`;
    const salt = crypto.randomBytes(12).toString('hex');
    const pwHash = this.hashPassword(password, salt);

    const starterInventory: InventorySlot[] = [
      { itemId: ITEM_IDS.FIST, count: 1 },
      { itemId: ITEM_IDS.WRENCH, count: 1 },
      { itemId: ITEM_IDS.WOOD, count: 12 },
      { itemId: ITEM_IDS.PLATFORM, count: 8 },
      { itemId: ITEM_IDS.TORCH, count: 5 },
      { itemId: ITEM_IDS.SIGN, count: 2 },
      { itemId: ITEM_IDS.DOOR, count: 1 },
    ];
    const starterEquipped: EquippedItems = {};

    this.db
      .prepare(
        `INSERT INTO players (
          id, username, password_hash, skin_color, gems, max_slots, inventory_json, equipped_json, last_world, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        username,
        pwHash,
        safeSkin,
        100, // Starter 100 Gems!
        INITIAL_INVENTORY_SLOTS,
        JSON.stringify(starterInventory),
        JSON.stringify(starterEquipped),
        'START',
        Date.now()
      );

    return {
      ok: true,
      profile: {
        id,
        username,
        skinColor: safeSkin,
        gems: 100,
        maxSlots: INITIAL_INVENTORY_SLOTS,
        inventory: starterInventory,
        equipped: starterEquipped,
      },
    };
  }

  public savePlayer(profile: PlayerProfile, lastWorld = 'START'): void {
    if (this.closed) return;
    this.db
      .prepare(
        `UPDATE players
         SET skin_color = ?, gems = ?, max_slots = ?, inventory_json = ?, equipped_json = ?, last_world = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        profile.skinColor,
        profile.gems,
        profile.maxSlots,
        JSON.stringify(profile.inventory),
        JSON.stringify(profile.equipped),
        lastWorld,
        Date.now(),
        profile.id
      );
  }

  private encodeTiles(tiles: TileData[]): string {
    const nonEmpty: CompactTileTuple[] = [];
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (t.fg !== 0 || t.bg !== 0 || t.meta) {
        const entry: CompactTileTuple = { i, f: t.fg, b: t.bg };
        if (t.meta && Object.keys(t.meta).length > 0) {
          entry.m = t.meta;
        }
        nonEmpty.push(entry);
      }
    }
    return JSON.stringify(nonEmpty);
  }

  private decodeTiles(json: string, total: number): TileData[] {
    const tiles: TileData[] = new Array(total);
    for (let i = 0; i < total; i++) {
      tiles[i] = { fg: 0, bg: 0 };
    }
    const parsed = JSON.parse(json) as CompactTileTuple[];
    for (const item of parsed) {
      if (item.i >= 0 && item.i < total) {
        tiles[item.i] = {
          fg: item.f,
          bg: item.b,
          meta: item.m,
        };
      }
    }
    return tiles;
  }

  public loadOrCreateWorld(rawName: string): StoredWorld {
    const cleanName = rawName.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 20) || 'START';
    const row = this.db
      .prepare('SELECT * FROM worlds WHERE name = ?')
      .get(cleanName) as Record<string, unknown> | undefined;

    if (row) {
      const width = Number(row.width);
      const height = Number(row.height);
      const visitCount = Number(row.visit_count) + 1;
      this.db.prepare('UPDATE worlds SET visit_count = ? WHERE name = ?').run(visitCount, cleanName);

      return {
        name: cleanName,
        width,
        height,
        weather: (row.weather as WeatherType) || 'sunny',
        ownerId: row.owner_id ? String(row.owner_id) : null,
        ownerName: row.owner_name ? String(row.owner_name) : null,
        spawnX: Number(row.spawn_x),
        spawnY: Number(row.spawn_y),
        tiles: this.decodeTiles(String(row.tiles_json), width * height),
        drops: JSON.parse(String(row.drops_json)) as DroppedItem[],
        visitCount,
      };
    }

    const gen = generateWorld(cleanName);
    const stored: StoredWorld = {
      name: gen.name,
      width: gen.width,
      height: gen.height,
      weather: gen.weather,
      ownerId: null,
      ownerName: null,
      spawnX: gen.spawnX,
      spawnY: gen.spawnY,
      tiles: gen.tiles,
      drops: [],
      visitCount: 1,
    };
    this.saveWorld(stored);
    return stored;
  }

  public saveWorld(world: StoredWorld): void {
    if (this.closed) return;
    const tilesJson = this.encodeTiles(world.tiles);
    const dropsJson = JSON.stringify(world.drops.slice(-250)); // Cap persisted floor drops
    this.db
      .prepare(
        `INSERT INTO worlds (
          name, width, height, weather, owner_id, owner_name, spawn_x, spawn_y, tiles_json, drops_json, visit_count, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          weather = excluded.weather,
          owner_id = excluded.owner_id,
          owner_name = excluded.owner_name,
          tiles_json = excluded.tiles_json,
          drops_json = excluded.drops_json,
          visit_count = excluded.visit_count,
          updated_at = excluded.updated_at`
      )
      .run(
        world.name,
        world.width,
        world.height,
        world.weather,
        world.ownerId,
        world.ownerName,
        world.spawnX,
        world.spawnY,
        tilesJson,
        dropsJson,
        world.visitCount,
        Date.now()
      );
    world.dirty = false;
  }

  public listPopularWorlds(activeCounts: Map<string, number>): WorldSummary[] {
    // Ensure default featured worlds exist so players see rich destinations right away
    for (const preset of ['START', 'FARM', 'PARKOUR', 'TRADE']) {
      const exists = this.db.prepare('SELECT 1 FROM worlds WHERE name = ?').get(preset);
      if (!exists) {
        this.loadOrCreateWorld(preset);
      }
    }

    const rows = this.db
      .prepare('SELECT name, owner_name, weather, visit_count FROM worlds ORDER BY visit_count DESC, updated_at DESC LIMIT 18')
      .all() as Array<Record<string, unknown>>;

    const summaries: WorldSummary[] = rows.map((r) => {
      const name = String(r.name);
      return {
        name,
        playerCount: activeCounts.get(name) ?? 0,
        ownerName: r.owner_name ? String(r.owner_name) : null,
        weather: (r.weather as WeatherType) || 'sunny',
      };
    });

    // Sort active worlds with players to the top!
    summaries.sort((a, b) => b.playerCount - a.playerCount);
    return summaries;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
