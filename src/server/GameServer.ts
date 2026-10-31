import crypto from 'node:crypto';
import { Server as SocketIOServer, Socket } from 'socket.io';
import {
  BLOCK_HEAL_DELAY_MS,
  MAX_INVENTORY_SLOTS,
  MAX_STACK,
  PICKUP_RADIUS_PX,
  PLACE_COOLDOWN_MS,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  PUNCH_COOLDOWN_MS,
  PUNCH_REACH_TILES,
  TILE_SIZE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../shared/constants';
import {
  findSpliceResult,
  getItemDef,
  ITEM_IDS,
  STORE_LISTINGS,
} from '../shared/ItemRegistry';
import {
  ChatPacket,
  DroppedItem,
  EquipSlot,
  PlayerAnimState,
  PlayerNetState,
  PlayerProfile,
  TileData,
  WorldInitPayload,
} from '../shared/types';
import { SaveManager, StoredWorld } from './SaveManager';

interface ConnectedSession {
  socketId: string;
  profile: PlayerProfile;
  worldName: string | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: -1 | 1;
  anim: PlayerAnimState;
  lastPunchAt: number;
  lastPlaceAt: number;
  lastChatAt: number;
}

export class GameServer {
  private worlds = new Map<string, StoredWorld>();
  private sessions = new Map<string, ConnectedSession>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(
    private io: SocketIOServer,
    private saveManager: SaveManager
  ) {
    this.setupSocketHandlers();
    this.saveTimer = setInterval(() => this.flushDirtyWorlds(), 6000);
  }

  public stop(): void {
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.flushDirtyWorlds();
  }

  public getOnlineStats(): { onlinePlayers: number; activeWorlds: number } {
    return {
      onlinePlayers: this.sessions.size,
      activeWorlds: this.worlds.size,
    };
  }

  public getWorldInstance(name: string): StoredWorld {
    const clean = name.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 20) || 'START';
    let world = this.worlds.get(clean);
    if (!world) {
      world = this.saveManager.loadOrCreateWorld(clean);
      this.worlds.set(clean, world);
    }
    return world;
  }

  private flushDirtyWorlds(): void {
    const now = Date.now();
    for (const [name, world] of this.worlds) {
      // Heal blocks on server too
      for (const t of world.tiles) {
        if (t.damage && t.lastHitAt && now - t.lastHitAt >= BLOCK_HEAL_DELAY_MS) {
          t.damage = 0;
          t.lastHitAt = undefined;
        }
      }
      if (world.dirty) {
        this.saveManager.saveWorld(world);
      }
      // Unload idle worlds with 0 players
      const count = this.getPlayersInWorld(name).length;
      if (count === 0 && !world.dirty) {
        this.worlds.delete(name);
      }
    }
  }

  private getPlayersInWorld(worldName: string): ConnectedSession[] {
    const list: ConnectedSession[] = [];
    for (const s of this.sessions.values()) {
      if (s.worldName === worldName) list.push(s);
    }
    return list;
  }

  private getActiveCountsMap(): Map<string, number> {
    const m = new Map<string, number>();
    for (const s of this.sessions.values()) {
      if (s.worldName) {
        m.set(s.worldName, (m.get(s.worldName) ?? 0) + 1);
      }
    }
    return m;
  }

  private toNetState(s: ConnectedSession, worldOwnerId: string | null): PlayerNetState {
    return {
      id: s.profile.id,
      username: s.profile.username,
      x: s.x,
      y: s.y,
      vx: s.vx,
      vy: s.vy,
      facing: s.facing,
      anim: s.anim,
      skinColor: s.profile.skinColor,
      equipped: s.profile.equipped,
      isOwner: !!worldOwnerId && s.profile.id === worldOwnerId,
    };
  }

  private addInventoryItem(profile: PlayerProfile, itemId: number, amount: number): number {
    if (amount <= 0) return 0;
    if (itemId === 0) {
      profile.gems += amount;
      return amount;
    }
    const existing = profile.inventory.find((s) => s.itemId === itemId);
    if (existing) {
      const space = Math.max(0, MAX_STACK - existing.count);
      const added = Math.min(space, amount);
      existing.count += added;
      return added;
    }
    if (profile.inventory.length >= profile.maxSlots) {
      return 0;
    }
    const added = Math.min(MAX_STACK, amount);
    profile.inventory.push({ itemId, count: added });
    return added;
  }

  private removeInventoryItem(profile: PlayerProfile, itemId: number, amount: number): boolean {
    if (itemId === ITEM_IDS.FIST || itemId === ITEM_IDS.WRENCH) return false;
    const idx = profile.inventory.findIndex((s) => s.itemId === itemId);
    if (idx === -1 || profile.inventory[idx].count < amount) return false;
    profile.inventory[idx].count -= amount;
    if (profile.inventory[idx].count <= 0) {
      profile.inventory.splice(idx, 1);
      // Unequip if it was a wearable item
      for (const slot of ['hat', 'face', 'back', 'hand'] as EquipSlot[]) {
        if (profile.equipped[slot] === itemId) {
          delete profile.equipped[slot];
        }
      }
    }
    return true;
  }

  private canModifyTile(
    world: StoredWorld,
    tx: number,
    ty: number,
    playerId: string
  ): { ok: boolean; reason?: string } {
    if (tx < 0 || tx >= world.width || ty < 0 || ty >= world.height) {
      return { ok: false, reason: 'Out of bounds.' };
    }
    const tile = world.tiles[ty * world.width + tx];
    if (tile.fg !== 0) {
      const def = getItemDef(tile.fg);
      if (def?.unbreakable) {
        return { ok: false, reason: `${def.name} is unbreakable!` };
      }
    }
    if (world.ownerId && world.ownerId !== playerId) {
      return { ok: false, reason: `World is locked by ${world.ownerName}!` };
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || nx >= world.width || ny < 0 || ny >= world.height) continue;
        const nt = world.tiles[ny * world.width + nx];
        if (nt.fg === ITEM_IDS.SMALL_LOCK && nt.meta?.ownerId && nt.meta.ownerId !== playerId) {
          return { ok: false, reason: `Area locked by ${nt.meta.ownerName}!` };
        }
      }
    }
    return { ok: true };
  }

  private checkReach(s: ConnectedSession, tx: number, ty: number): boolean {
    const pcx = s.x + PLAYER_WIDTH * 0.5;
    const pcy = s.y + PLAYER_HEIGHT * 0.5;
    const tcx = (tx + 0.5) * TILE_SIZE;
    const tcy = (ty + 0.5) * TILE_SIZE;
    // Slight network tolerance (+0.75 tile) over client reach for smooth latency compensation
    const maxReach = PUNCH_REACH_TILES + 0.75;
    return (
      Math.abs(pcx - tcx) / TILE_SIZE <= maxReach &&
      Math.abs(pcy - tcy) / TILE_SIZE <= maxReach
    );
  }

  private spawnDrop(world: StoredWorld, itemId: number, count: number, tx: number, ty: number): DroppedItem {
    const drop: DroppedItem = {
      uid: `drp_${crypto.randomUUID().slice(0, 12)}`,
      itemId,
      count,
      x: (tx + 0.22 + Math.random() * 0.56) * TILE_SIZE,
      y: (ty + 0.35 + Math.random() * 0.35) * TILE_SIZE,
      spawnedAt: Date.now(),
    };
    world.drops.push(drop);
    world.dirty = true;
    return drop;
  }

  private spawnGemsForRange(world: StoredWorld, minGems: number, maxGems: number, tx: number, ty: number): DroppedItem[] {
    const created: DroppedItem[] = [];
    let total = minGems + Math.floor(Math.random() * (maxGems - minGems + 1));
    if (total <= 0) return created;

    const denoms = [100, 25, 10, 5, 1];
    for (const d of denoms) {
      while (total >= d) {
        created.push(this.spawnDrop(world, 0, d, tx, ty));
        total -= d;
      }
    }
    return created;
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      socket.on(
        'auth:login',
        (
          data: { username: string; password: string; skinColor: string },
          ack?: (res: { ok: boolean; profile?: PlayerProfile; worlds?: ReturnType<SaveManager['listPopularWorlds']>; error?: string }) => void
        ) => {
          const res = this.saveManager.authenticateOrRegister(
            data?.username ?? '',
            data?.password ?? '',
            data?.skinColor ?? '#f2b885'
          );
          if (!res.ok) {
            ack?.({ ok: false, error: res.error });
            return;
          }

          // Kick duplicate session if same GrowID logged in elsewhere
          for (const [oldSockId, existing] of this.sessions) {
            if (existing.profile.id === res.profile.id && oldSockId !== socket.id) {
              this.leaveCurrentWorld(oldSockId);
              this.io.sockets.sockets.get(oldSockId)?.emit('session:kicked', 'Logged in from another window.');
              this.sessions.delete(oldSockId);
            }
          }

          const session: ConnectedSession = {
            socketId: socket.id,
            profile: res.profile,
            worldName: null,
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            facing: 1,
            anim: 'idle',
            lastPunchAt: 0,
            lastPlaceAt: 0,
            lastChatAt: 0,
          };
          this.sessions.set(socket.id, session);

          ack?.({
            ok: true,
            profile: res.profile,
            worlds: this.saveManager.listPopularWorlds(this.getActiveCountsMap()),
          });
        }
      );

      socket.on('worlds:list', (ack?: (worlds: ReturnType<SaveManager['listPopularWorlds']>) => void) => {
        ack?.(this.saveManager.listPopularWorlds(this.getActiveCountsMap()));
      });

      socket.on(
        'world:join',
        (
          rawWorldName: string,
          ack?: (res: { ok: boolean; world?: WorldInitPayload; error?: string }) => void
        ) => {
          const session = this.sessions.get(socket.id);
          if (!session) {
            ack?.({ ok: false, error: 'Not authenticated.' });
            return;
          }

          this.leaveCurrentWorld(socket.id);

          const world = this.getWorldInstance(rawWorldName);
          session.worldName = world.name;
          session.x = world.spawnX * TILE_SIZE + (TILE_SIZE - PLAYER_WIDTH) * 0.5;
          session.y = world.spawnY * TILE_SIZE + (TILE_SIZE - PLAYER_HEIGHT);
          session.vx = 0;
          session.vy = 0;
          session.anim = 'idle';

          socket.join(`world:${world.name}`);
          this.saveManager.savePlayer(session.profile, world.name);

          const others = this.getPlayersInWorld(world.name)
            .filter((p) => p.socketId !== socket.id)
            .map((p) => this.toNetState(p, world.ownerId));

          const payload: WorldInitPayload = {
            name: world.name,
            width: world.width,
            height: world.height,
            weather: world.weather,
            ownerId: world.ownerId,
            ownerName: world.ownerName,
            spawnX: world.spawnX,
            spawnY: world.spawnY,
            tiles: world.tiles,
            drops: world.drops,
            players: others,
          };

          socket.to(`world:${world.name}`).emit('player:joined', this.toNetState(session, world.ownerId));

          const lockNote = world.ownerName ? ` \`2[World Locked by ${world.ownerName}]` : '';
          this.sendSystemToSocket(
            socket,
            `\`wWorld \`2[${world.name}]\`w entered. \`9${others.length}\`w other player(s) here.${lockNote}`
          );
          socket.to(`world:${world.name}`).emit('chat:message', {
            id: `sys_${Date.now()}`,
            senderId: 'system',
            senderName: 'SYSTEM',
            text: `\`2${session.profile.username} \`wentered the world.`,
            type: 'system',
            timestamp: Date.now(),
          } satisfies ChatPacket);

          ack?.({ ok: true, world: payload });
        }
      );

      socket.on('world:leave', () => {
        this.leaveCurrentWorld(socket.id);
      });

      socket.on(
        'player:move',
        (state: {
          x: number;
          y: number;
          vx: number;
          vy: number;
          facing: -1 | 1;
          anim: PlayerAnimState;
        }) => {
          const session = this.sessions.get(socket.id);
          if (!session || !session.worldName) return;

          // Anti-cheat clamp within world boundaries
          const maxX = WORLD_WIDTH * TILE_SIZE - PLAYER_WIDTH;
          const maxY = WORLD_HEIGHT * TILE_SIZE - PLAYER_HEIGHT;
          if (!Number.isFinite(state.x) || !Number.isFinite(state.y)) return;

          session.x = Math.max(0, Math.min(maxX, state.x));
          session.y = Math.max(0, Math.min(maxY, state.y));
          session.vx = Math.max(-700, Math.min(700, state.vx || 0));
          session.vy = Math.max(-700, Math.min(700, state.vy || 0));
          session.facing = state.facing === -1 ? -1 : 1;
          session.anim = state.anim || 'idle';

          socket.to(`world:${session.worldName}`).emit('player:moved', {
            id: session.profile.id,
            x: session.x,
            y: session.y,
            vx: session.vx,
            vy: session.vy,
            facing: session.facing,
            anim: session.anim,
          });
        }
      );

      socket.on('player:respawn', () => {
        const session = this.sessions.get(socket.id);
        if (!session || !session.worldName) return;
        const world = this.worlds.get(session.worldName);
        if (!world) return;

        session.x = world.spawnX * TILE_SIZE + (TILE_SIZE - PLAYER_WIDTH) * 0.5;
        session.y = world.spawnY * TILE_SIZE + (TILE_SIZE - PLAYER_HEIGHT);
        session.vx = 0;
        session.vy = 0;

        this.io.to(`world:${world.name}`).emit('player:teleported', {
          id: session.profile.id,
          x: session.x,
          y: session.y,
        });
      });

      socket.on('world:punch', (data: { tx: number; ty: number }) => {
        this.handlePunch(socket, data?.tx, data?.ty);
      });

      socket.on('world:place', (data: { tx: number; ty: number; itemId: number }) => {
        this.handlePlace(socket, data?.tx, data?.ty, data?.itemId);
      });

      socket.on('world:pickup', (data: { uid: string }) => {
        this.handlePickup(socket, data?.uid);
      });

      socket.on('inventory:drop', (data: { itemId: number; count: number }) => {
        this.handleDropItem(socket, data?.itemId, data?.count);
      });

      socket.on('inventory:trash', (data: { itemId: number; count: number }) => {
        this.handleTrashItem(socket, data?.itemId, data?.count);
      });

      socket.on('inventory:equip', (data: { itemId: number }) => {
        this.handleEquipItem(socket, data?.itemId);
      });

      socket.on(
        'world:wrench',
        (data: { tx: number; ty: number; label?: string; targetWorld?: string }) => {
          this.handleWrenchEdit(socket, data);
        }
      );

      socket.on(
        'store:buy',
        (
          listingId: string,
          ack?: (res: { ok: boolean; message?: string; profile?: PlayerProfile }) => void
        ) => {
          this.handleStoreBuy(socket, listingId, ack);
        }
      );

      socket.on('chat:send', (rawText: string) => {
        this.handleChat(socket, rawText);
      });

      socket.on('ping:check', (t0: number, ack?: (t0: number) => void) => {
        ack?.(t0);
      });

      socket.on('disconnect', () => {
        const s = this.sessions.get(socket.id);
        if (s) {
          this.saveManager.savePlayer(s.profile, s.worldName ?? 'START');
          this.leaveCurrentWorld(socket.id);
          this.sessions.delete(socket.id);
        }
      });
    });
  }

  private handlePunch(socket: Socket, tx: number, ty: number): void {
    const session = this.sessions.get(socket.id);
    if (!session || !session.worldName) return;
    if (!Number.isInteger(tx) || !Number.isInteger(ty)) return;

    const now = Date.now();
    if (now - session.lastPunchAt < PUNCH_COOLDOWN_MS - 45) return; // Anti-cheat rate limit
    session.lastPunchAt = now;

    const world = this.worlds.get(session.worldName);
    if (!world || !this.checkReach(session, tx, ty)) return;

    // Broadcast punch visual to room even if hitting air/locked block!
    this.io.to(`world:${world.name}`).emit('player:punched', {
      id: session.profile.id,
      tx,
      ty,
    });

    const tile = world.tiles[ty * world.width + tx];
    if (tile.fg === 0 && tile.bg === 0) return;

    const perm = this.canModifyTile(world, tx, ty, session.profile.id);
    if (!perm.ok) {
      if (perm.reason) {
        socket.emit('world:denied', { tx, ty, reason: perm.reason });
      }
      return;
    }

    // Target foreground first; if empty foreground, target background wall!
    const targetIsFg = tile.fg !== 0;
    const targetId = targetIsFg ? tile.fg : tile.bg;
    const def = getItemDef(targetId);
    if (!def || def.unbreakable) return;

    // Special case 1: Weather Machine toggle on punch!
    if (targetIsFg && def.category === 'weather' && def.weatherTarget) {
      const nextWeather = world.weather === def.weatherTarget ? 'sunny' : def.weatherTarget;
      world.weather = nextWeather;
      world.dirty = true;
      this.io.to(`world:${world.name}`).emit('world:weather', {
        weather: nextWeather,
        by: session.profile.username,
      });
    }

    // Special case 2: Growing / Mature Seed Tree!
    if (targetIsFg && def.category === 'seed') {
      const plantedAt = tile.meta?.plantedAt ?? now;
      const growMs = tile.meta?.growTimeMs ?? (def.growTimeSec ?? 10) * 1000;
      const mature = now - plantedAt >= growMs;

      if (mature) {
        // HARVEST RIPE TREE!
        const fruitBlockId = def.blockId ?? ITEM_IDS.DIRT;
        const fruitDef = getItemDef(fruitBlockId);
        const fruitCount = 2 + Math.floor(Math.random() * 4); // 2..5 blocks harvested!

        tile.fg = 0;
        tile.damage = 0;
        tile.lastHitAt = undefined;
        tile.meta = undefined;
        world.dirty = true;

        const newDrops: DroppedItem[] = [];
        newDrops.push(this.spawnDrop(world, fruitBlockId, fruitCount, tx, ty));

        // Chance to also drop a bonus seed when harvesting!
        if (Math.random() < 0.42) {
          newDrops.push(this.spawnDrop(world, def.id, 1, tx, ty));
        }

        // Gems from harvesting!
        const [minG, maxG] = fruitDef?.gemDropRange ?? [1, 4];
        newDrops.push(...this.spawnGemsForRange(world, minG, maxG + 2, tx, ty));

        this.io.to(`world:${world.name}`).emit('world:tileUpdated', {
          tx,
          ty,
          tile,
          brokenId: def.id,
          harvested: true,
        });
        this.io.to(`world:${world.name}`).emit('world:dropsAdded', newDrops);
        return;
      }
      // If unripe seed is punched, breaking it cancels the sapling (no fruit, 50% seed refund)
      tile.fg = 0;
      tile.damage = 0;
      tile.meta = undefined;
      world.dirty = true;
      const drops: DroppedItem[] = [];
      if (Math.random() < 0.65) {
        drops.push(this.spawnDrop(world, def.id, 1, tx, ty));
      }
      this.io.to(`world:${world.name}`).emit('world:tileUpdated', {
        tx,
        ty,
        tile,
        brokenId: def.id,
      });
      if (drops.length > 0) {
        this.io.to(`world:${world.name}`).emit('world:dropsAdded', drops);
      }
      return;
    }

    // Standard Block / Background / Lock damage progression
    let dmg = 1;
    if (session.profile.equipped.hand) {
      dmg += getItemDef(session.profile.equipped.hand)?.bonusPunchDamage ?? 0;
    }

    // Reset damage if expired
    if (tile.lastHitAt && now - tile.lastHitAt >= BLOCK_HEAL_DELAY_MS) {
      tile.damage = 0;
    }

    tile.damage = (tile.damage ?? 0) + dmg;
    tile.lastHitAt = now;

    if (tile.damage < def.hitsToBreak) {
      this.io.to(`world:${world.name}`).emit('world:tileDamaged', {
        tx,
        ty,
        damage: tile.damage,
      });
      return;
    }

    // BLOCK BROKEN!
    if (targetIsFg) {
      if (targetId === ITEM_IDS.WORLD_LOCK) {
        world.ownerId = null;
        world.ownerName = null;
        this.io.to(`world:${world.name}`).emit('world:lockChanged', {
          ownerId: null,
          ownerName: null,
        });
      }
      tile.fg = 0;
      tile.meta = undefined;
    } else {
      tile.bg = 0;
    }
    tile.damage = 0;
    tile.lastHitAt = undefined;
    world.dirty = true;

    const newDrops: DroppedItem[] = [];
    if (def.category === 'lock' || def.category === 'weather') {
      // Locks and Weather Machines always return directly as drops (100% recovery!)
      newDrops.push(this.spawnDrop(world, def.id, 1, tx, ty));
    } else {
      // Authentic Growtopia block break drop table:
      // ~32% chance to drop the Block back, ~26% chance to drop its Seed, plus Gems!
      const roll = Math.random();
      if (roll < 0.34) {
        newDrops.push(this.spawnDrop(world, def.id, 1, tx, ty));
      } else if (roll < 0.62 && def.seedId) {
        newDrops.push(this.spawnDrop(world, def.seedId, 1, tx, ty));
      }
      if (def.gemDropRange) {
        newDrops.push(...this.spawnGemsForRange(world, def.gemDropRange[0], def.gemDropRange[1], tx, ty));
      }
    }

    this.io.to(`world:${world.name}`).emit('world:tileUpdated', {
      tx,
      ty,
      tile,
      brokenId: targetId,
    });
    if (newDrops.length > 0) {
      this.io.to(`world:${world.name}`).emit('world:dropsAdded', newDrops);
    }
  }

  private handlePlace(socket: Socket, tx: number, ty: number, itemId: number): void {
    const session = this.sessions.get(socket.id);
    if (!session || !session.worldName) return;
    if (!Number.isInteger(tx) || !Number.isInteger(ty) || !Number.isInteger(itemId)) return;

    const now = Date.now();
    if (now - session.lastPlaceAt < PLACE_COOLDOWN_MS - 30) return;
    session.lastPlaceAt = now;

    const world = this.worlds.get(session.worldName);
    if (!world || !this.checkReach(session, tx, ty)) return;

    const perm = this.canModifyTile(world, tx, ty, session.profile.id);
    if (!perm.ok) {
      if (perm.reason) socket.emit('world:denied', { tx, ty, reason: perm.reason });
      return;
    }

    const def = getItemDef(itemId);
    if (!def) return;

    // Verify player actually owns at least 1 of itemId!
    const owned = session.profile.inventory.find((s) => s.itemId === itemId);
    if (!owned || owned.count < 1) return;

    const tile = world.tiles[ty * world.width + tx];

    // 1. Seed Planting & Seed Splicing!
    if (def.category === 'seed') {
      if (ty + 1 >= world.height) return;
      const below = world.tiles[(ty + 1) * world.width + tx];
      const belowDef = below.fg ? getItemDef(below.fg) : undefined;
      if (!belowDef || belowDef.collision !== 'solid') {
        socket.emit('world:denied', { tx, ty, reason: 'Plant seeds on top of solid blocks!' });
        return;
      }

      if (tile.fg === 0) {
        if (!this.removeInventoryItem(session.profile, itemId, 1)) return;
        tile.fg = itemId;
        tile.damage = 0;
        tile.meta = {
          plantedAt: now,
          growTimeMs: (def.growTimeSec ?? 10) * 1000,
        };
        world.dirty = true;
        this.saveManager.savePlayer(session.profile, world.name);

        socket.emit('profile:sync', session.profile);
        this.io.to(`world:${world.name}`).emit('world:tileUpdated', {
          tx,
          ty,
          tile,
          placedId: itemId,
        });
        return;
      }

      // Splice onto existing unripe seed!
      const existingDef = getItemDef(tile.fg);
      if (existingDef?.category === 'seed') {
        const plantedAt = tile.meta?.plantedAt ?? now;
        const growMs = tile.meta?.growTimeMs ?? (existingDef.growTimeSec ?? 10) * 1000;
        if (now - plantedAt >= growMs) {
          socket.emit('world:denied', { tx, ty, reason: 'Harvest ripe tree before splicing!' });
          return;
        }
        const spliced = findSpliceResult(tile.fg, itemId);
        if (!spliced) {
          socket.emit('world:denied', {
            tx,
            ty,
            reason: `${existingDef.name} and ${def.name} cannot be spliced!`,
          });
          return;
        }

        if (!this.removeInventoryItem(session.profile, itemId, 1)) return;
        tile.fg = spliced.id;
        tile.damage = 0;
        tile.meta = {
          plantedAt: now,
          growTimeMs: (spliced.growTimeSec ?? 16) * 1000,
        };
        world.dirty = true;
        this.saveManager.savePlayer(session.profile, world.name);

        socket.emit('profile:sync', session.profile);
        this.io.to(`world:${world.name}`).emit('world:tileUpdated', {
          tx,
          ty,
          tile,
          placedId: spliced.id,
          splicedName: spliced.name.replace(' Seed', ' Tree'),
        });
        this.sendSystemToSocket(
          socket,
          `\`6SPLICE! \`wCombined \`2${existingDef.name}\`w + \`2${def.name}\`w into \`9${spliced.name.replace(' Seed', ' Tree')}\`w!`
        );
      }
      return;
    }

    // 2. Background Block Placement
    if (def.category === 'background') {
      if (tile.bg === itemId) return;
      if (!this.removeInventoryItem(session.profile, itemId, 1)) return;
      tile.bg = itemId;
      tile.damage = 0;
      world.dirty = true;
      this.saveManager.savePlayer(session.profile, world.name);

      socket.emit('profile:sync', session.profile);
      this.io.to(`world:${world.name}`).emit('world:tileUpdated', {
        tx,
        ty,
        tile,
        placedId: itemId,
      });
      return;
    }

    // 3. Foreground / Lock / Weather Block Placement
    if (
      def.category === 'foreground' ||
      def.category === 'lock' ||
      def.category === 'weather'
    ) {
      if (tile.fg !== 0) return;

      if (itemId === ITEM_IDS.WORLD_LOCK && world.ownerId) {
        socket.emit('world:denied', { tx, ty, reason: 'World already has a World Lock!' });
        return;
      }

      // Solid collision overlap validation against all players in the world!
      if (def.collision === 'solid' || def.collision === 'lava' || def.collision === 'bumper') {
        const bx = tx * TILE_SIZE;
        const by = ty * TILE_SIZE;
        for (const p of this.getPlayersInWorld(world.name)) {
          if (
            p.x < bx + TILE_SIZE - 1 &&
            p.x + PLAYER_WIDTH > bx + 1 &&
            p.y < by + TILE_SIZE - 1 &&
            p.y + PLAYER_HEIGHT > by + 1
          ) {
            socket.emit('world:denied', { tx, ty, reason: 'Player standing there!' });
            return;
          }
        }
      }

      if (!this.removeInventoryItem(session.profile, itemId, 1)) return;

      tile.fg = itemId;
      tile.damage = 0;
      tile.meta = undefined;

      if (def.category === 'lock') {
        tile.meta = {
          ownerId: session.profile.id,
          ownerName: session.profile.username,
        };
        if (itemId === ITEM_IDS.WORLD_LOCK) {
          world.ownerId = session.profile.id;
          world.ownerName = session.profile.username;
          this.io.to(`world:${world.name}`).emit('world:lockChanged', {
            ownerId: world.ownerId,
            ownerName: world.ownerName,
          });
          this.io.to(`world:${world.name}`).emit('chat:message', {
            id: `wl_${Date.now()}`,
            senderId: 'system',
            senderName: 'SYSTEM',
            text: `\`6[${world.name}] \`whas been \`2World Locked \`wby \`2${session.profile.username}\`w!`,
            type: 'broadcast',
            timestamp: Date.now(),
          } satisfies ChatPacket);
        }
      } else if (itemId === ITEM_IDS.SIGN) {
        tile.meta = { label: 'Use Wrench to edit sign!' };
      } else if (itemId === ITEM_IDS.DOOR) {
        tile.meta = { label: 'Portal Door', targetWorld: 'START' };
      }

      world.dirty = true;
      this.saveManager.savePlayer(session.profile, world.name);

      socket.emit('profile:sync', session.profile);
      this.io.to(`world:${world.name}`).emit('world:tileUpdated', {
        tx,
        ty,
        tile,
        placedId: itemId,
      });
    }
  }

  private handlePickup(socket: Socket, uid: string): void {
    const session = this.sessions.get(socket.id);
    if (!session || !session.worldName || !uid) return;
    const world = this.worlds.get(session.worldName);
    if (!world) return;

    const dropIdx = world.drops.findIndex((d) => d.uid === uid);
    if (dropIdx === -1) return;
    const drop = world.drops[dropIdx];

    const pcx = session.x + PLAYER_WIDTH * 0.5;
    const pcy = session.y + PLAYER_HEIGHT * 0.5;
    const dist = Math.hypot(pcx - drop.x, pcy - drop.y);
    if (dist > PICKUP_RADIUS_PX + 75) return; // Anti-cheat distance verification

    const added = this.addInventoryItem(session.profile, drop.itemId, drop.count);
    if (added <= 0) return;

    if (added >= drop.count) {
      world.drops.splice(dropIdx, 1);
      this.io.to(`world:${world.name}`).emit('world:dropRemoved', {
        uid: drop.uid,
        pickedById: session.profile.id,
        itemId: drop.itemId,
        count: added,
      });
    } else {
      drop.count -= added;
      this.io.to(`world:${world.name}`).emit('world:dropsAdded', [drop]);
    }

    world.dirty = true;
    this.saveManager.savePlayer(session.profile, world.name);
    socket.emit('profile:sync', session.profile);
  }

  private handleDropItem(socket: Socket, itemId: number, count: number): void {
    const session = this.sessions.get(socket.id);
    if (!session || !session.worldName) return;
    const amt = Math.max(1, Math.min(MAX_STACK, Math.floor(count || 1)));
    if (itemId === ITEM_IDS.FIST || itemId === ITEM_IDS.WRENCH) return;

    const world = this.worlds.get(session.worldName);
    if (!world) return;

    if (!this.removeInventoryItem(session.profile, itemId, amt)) return;

    const dropX = Math.max(
      16,
      Math.min(
        world.width * TILE_SIZE - 16,
        session.x + PLAYER_WIDTH * 0.5 + session.facing * 36
      )
    );
    const dropY = session.y + PLAYER_HEIGHT * 0.5;
    const drop: DroppedItem = {
      uid: `drp_${crypto.randomUUID().slice(0, 12)}`,
      itemId,
      count: amt,
      x: dropX,
      y: dropY,
      spawnedAt: Date.now() + 350, // Delay self-pickup slightly so player sees it drop in front of them!
    };
    world.drops.push(drop);
    world.dirty = true;

    this.saveManager.savePlayer(session.profile, world.name);
    socket.emit('profile:sync', session.profile);
    this.io.to(`world:${world.name}`).emit('world:dropsAdded', [drop]);
    this.io.to(`world:${world.name}`).emit('player:equippedChanged', {
      id: session.profile.id,
      equipped: session.profile.equipped,
    });
  }

  private handleTrashItem(socket: Socket, itemId: number, count: number): void {
    const session = this.sessions.get(socket.id);
    if (!session) return;
    const amt = Math.max(1, Math.min(MAX_STACK, Math.floor(count || 1)));
    if (!this.removeInventoryItem(session.profile, itemId, amt)) return;

    // Recycle bonus: 1 gem per 4 recycled items!
    const bonusGems = Math.max(1, Math.floor(amt / 4));
    session.profile.gems += bonusGems;
    this.saveManager.savePlayer(session.profile, session.worldName ?? 'START');
    socket.emit('profile:sync', session.profile);
    this.sendSystemToSocket(
      socket,
      `\`wRecycled \`9${amt}x ${getItemDef(itemId)?.name ?? 'Item'}\`w for \`2+${bonusGems} Gem(s)\`w!`
    );
  }

  private handleEquipItem(socket: Socket, itemId: number): void {
    const session = this.sessions.get(socket.id);
    if (!session) return;
    const def = getItemDef(itemId);
    if (!def || !def.equipSlot) return;

    const owned = session.profile.inventory.find((s) => s.itemId === itemId);
    if (!owned || owned.count < 1) return;

    const slot = def.equipSlot;
    if (session.profile.equipped[slot] === itemId) {
      delete session.profile.equipped[slot]; // Toggle unequip
    } else {
      session.profile.equipped[slot] = itemId;
    }

    this.saveManager.savePlayer(session.profile, session.worldName ?? 'START');
    socket.emit('profile:sync', session.profile);

    if (session.worldName) {
      this.io.to(`world:${session.worldName}`).emit('player:equippedChanged', {
        id: session.profile.id,
        equipped: session.profile.equipped,
      });
    }
  }

  private handleWrenchEdit(
    socket: Socket,
    data: { tx: number; ty: number; label?: string; targetWorld?: string }
  ): void {
    const session = this.sessions.get(socket.id);
    if (!session || !session.worldName) return;
    const world = this.worlds.get(session.worldName);
    if (!world) return;
    const { tx, ty } = data;
    if (!Number.isInteger(tx) || !Number.isInteger(ty)) return;
    if (!this.checkReach(session, tx, ty)) return;

    const perm = this.canModifyTile(world, tx, ty, session.profile.id);
    if (!perm.ok) {
      if (perm.reason) socket.emit('world:denied', { tx, ty, reason: perm.reason });
      return;
    }

    const tile = world.tiles[ty * world.width + tx];
    if (tile.fg !== ITEM_IDS.SIGN && tile.fg !== ITEM_IDS.DOOR) return;

    const cleanLabel = String(data.label ?? '').slice(0, 72);
    const cleanTarget = String(data.targetWorld ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '')
      .slice(0, 20);

    tile.meta = {
      ...tile.meta,
      label: cleanLabel,
      targetWorld: tile.fg === ITEM_IDS.DOOR ? cleanTarget || 'START' : undefined,
    };
    world.dirty = true;

    this.io.to(`world:${world.name}`).emit('world:tileUpdated', {
      tx,
      ty,
      tile,
    });
    this.sendSystemToSocket(socket, '`2Updated object settings!');
  }

  private handleStoreBuy(
    socket: Socket,
    listingId: string,
    ack?: (res: { ok: boolean; message?: string; profile?: PlayerProfile }) => void
  ): void {
    const session = this.sessions.get(socket.id);
    if (!session) {
      ack?.({ ok: false, message: 'Not logged in.' });
      return;
    }

    const listing = STORE_LISTINGS.find((l) => l.id === listingId);
    if (!listing) {
      ack?.({ ok: false, message: 'Unknown store item.' });
      return;
    }

    if (session.profile.gems < listing.costGems) {
      ack?.({ ok: false, message: `Need ${listing.costGems} Gems! Farm blocks & trees to earn more.` });
      return;
    }

    if (listing.grants === 'backpack_upgrade') {
      if (session.profile.maxSlots >= MAX_INVENTORY_SLOTS) {
        ack?.({ ok: false, message: 'Backpack is already at maximum size (36 slots)!' });
        return;
      }
      session.profile.gems -= listing.costGems;
      session.profile.maxSlots = Math.min(MAX_INVENTORY_SLOTS, session.profile.maxSlots + 8);
      this.saveManager.savePlayer(session.profile, session.worldName ?? 'START');
      socket.emit('profile:sync', session.profile);
      ack?.({
        ok: true,
        message: `Backpack upgraded to ${session.profile.maxSlots} slots!`,
        profile: session.profile,
      });
      return;
    }

    let itemsToGrant: Array<{ itemId: number; count: number }> = [];
    if (listing.grants === 'random_basic_pack') {
      const pool = [
        ITEM_IDS.WOOD_SEED,
        ITEM_IDS.GRASS_SEED,
        ITEM_IDS.BRICK_SEED,
        ITEM_IDS.GLASS_SEED,
        ITEM_IDS.SIGN_SEED,
        ITEM_IDS.TORCH_SEED,
        ITEM_IDS.PLATFORM_SEED,
      ];
      for (let i = 0; i < 3; i++) {
        const pick = pool[Math.floor(Math.random() * pool.length)];
        itemsToGrant.push({ itemId: pick, count: 5 });
      }
    } else if (listing.grants === 'random_farm_pack') {
      const pool = [
        ITEM_IDS.SUGAR_CANE_SEED,
        ITEM_IDS.GOLD_SEED,
        ITEM_IDS.CRYSTAL_SEED,
        ITEM_IDS.CHANDELIER_SEED,
        ITEM_IDS.BUMPER_SEED,
      ];
      for (let i = 0; i < 2; i++) {
        const pick = pool[Math.floor(Math.random() * pool.length)];
        itemsToGrant.push({ itemId: pick, count: 4 });
      }
    } else {
      itemsToGrant = listing.grants;
    }

    // Check inventory space first
    const freeSlots = session.profile.maxSlots - session.profile.inventory.length;
    const newUniqueNeeded = itemsToGrant.filter(
      (g) => !session.profile.inventory.some((s) => s.itemId === g.itemId)
    ).length;
    if (newUniqueNeeded > freeSlots) {
      ack?.({ ok: false, message: 'Not enough empty backpack slots!' });
      return;
    }

    session.profile.gems -= listing.costGems;
    const summaryParts: string[] = [];
    for (const g of itemsToGrant) {
      this.addInventoryItem(session.profile, g.itemId, g.count);
      summaryParts.push(`${g.count}x ${getItemDef(g.itemId)?.name ?? 'Item'}`);
    }

    this.saveManager.savePlayer(session.profile, session.worldName ?? 'START');
    socket.emit('profile:sync', session.profile);
    ack?.({
      ok: true,
      message: `Purchased: ${summaryParts.join(', ')}!`,
      profile: session.profile,
    });
  }

  private handleChat(socket: Socket, rawText: string): void {
    const session = this.sessions.get(socket.id);
    if (!session || !session.worldName) return;

    const now = Date.now();
    if (now - session.lastChatAt < 350) return;
    session.lastChatAt = now;

    const text = String(rawText ?? '').trim().slice(0, 120);
    if (!text) return;

    // Slash commands!
    if (text.startsWith('/')) {
      const [cmdRaw, ...rest] = text.slice(1).split(/\s+/);
      const cmd = cmdRaw.toLowerCase();

      if (cmd === 'help') {
        this.sendSystemToSocket(
          socket,
          '`6Commands: `w/wave, /dance, /laugh, /cry, /who, /warp <WORLD>, /respawn, or color codes like `2`2green `4`4red `9`9yellow`w!'
        );
        return;
      }
      if (cmd === 'who') {
        const names = this.getPlayersInWorld(session.worldName).map((p) => p.profile.username);
        this.sendSystemToSocket(
          socket,
          `\`wPlayers in \`2[${session.worldName}]\`w (${names.length}): \`9${names.join(', ')}`
        );
        return;
      }
      if (cmd === 'wave' || cmd === 'dance' || cmd === 'laugh' || cmd === 'cry') {
        const actionMap: Record<string, string> = {
          wave: 'waves hello!',
          dance: 'busts out pixel dance moves!',
          laugh: 'laughs out loud! Haha!',
          cry: 'sobs dramatically!',
        };
        this.io.to(`world:${session.worldName}`).emit('chat:message', {
          id: `em_${Date.now()}_${Math.random()}`,
          senderId: session.profile.id,
          senderName: session.profile.username,
          text: `* ${session.profile.username} ${actionMap[cmd]} *`,
          type: 'emote',
          timestamp: now,
        } satisfies ChatPacket);
        if (cmd === 'wave' || cmd === 'dance') {
          socket.emit('player:localEmote', cmd);
        }
        return;
      }
      if (cmd === 'warp' && rest[0]) {
        socket.emit('client:warpRequest', rest[0].toUpperCase());
        return;
      }
      if (cmd === 'respawn') {
        const world = this.worlds.get(session.worldName);
        if (world) {
          session.x = world.spawnX * TILE_SIZE + (TILE_SIZE - PLAYER_WIDTH) * 0.5;
          session.y = world.spawnY * TILE_SIZE + (TILE_SIZE - PLAYER_HEIGHT);
          this.io.to(`world:${world.name}`).emit('player:teleported', {
            id: session.profile.id,
            x: session.x,
            y: session.y,
          });
        }
        return;
      }
    }

    const packet: ChatPacket = {
      id: `msg_${now}_${Math.random().toString(36).slice(2, 7)}`,
      senderId: session.profile.id,
      senderName: session.profile.username,
      text,
      type: 'player',
      timestamp: now,
    };

    this.io.to(`world:${session.worldName}`).emit('chat:message', packet);
  }

  private sendSystemToSocket(socket: Socket, text: string): void {
    socket.emit('chat:message', {
      id: `sys_${Date.now()}_${Math.random()}`,
      senderId: 'system',
      senderName: 'SYSTEM',
      text,
      type: 'system',
      timestamp: Date.now(),
    } satisfies ChatPacket);
  }

  private leaveCurrentWorld(socketId: string): void {
    const session = this.sessions.get(socketId);
    if (!session || !session.worldName) return;

    const oldWorld = session.worldName;
    session.worldName = null;

    const sock = this.io.sockets.sockets.get(socketId);
    sock?.leave(`world:${oldWorld}`);

    this.io.to(`world:${oldWorld}`).emit('player:left', session.profile.id);
    this.io.to(`world:${oldWorld}`).emit('chat:message', {
      id: `sys_${Date.now()}`,
      senderId: 'system',
      senderName: 'SYSTEM',
      text: `\`4${session.profile.username} \`wleft the world.`,
      type: 'system',
      timestamp: Date.now(),
    } satisfies ChatPacket);

    const worldObj = this.worlds.get(oldWorld);
    if (worldObj && worldObj.dirty) {
      this.saveManager.saveWorld(worldObj);
    }
  }
}
