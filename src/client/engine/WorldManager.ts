import {
  BLOCK_HEAL_DELAY_MS,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  PUNCH_REACH_TILES,
  TILE_SIZE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../../shared/constants';
import { getItemDef, ITEM_IDS } from '../../shared/ItemRegistry';
import {
  DroppedItem,
  TileData,
  WeatherType,
  WorldInitPayload,
} from '../../shared/types';

export class WorldManager {
  public name = 'START';
  public width = WORLD_WIDTH;
  public height = WORLD_HEIGHT;
  public weather: WeatherType = 'sunny';
  public ownerId: string | null = null;
  public ownerName: string | null = null;
  public spawnX = 50;
  public spawnY = 36;
  public tiles: TileData[] = [];
  public drops = new Map<string, DroppedItem>();

  public loadWorld(payload: WorldInitPayload): void {
    this.name = payload.name;
    this.width = payload.width;
    this.height = payload.height;
    this.weather = payload.weather;
    this.ownerId = payload.ownerId;
    this.ownerName = payload.ownerName;
    this.spawnX = payload.spawnX;
    this.spawnY = payload.spawnY;
    this.tiles = payload.tiles;
    this.drops.clear();
    for (const d of payload.drops) {
      this.drops.set(d.uid, { ...d });
    }
  }

  public inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && tx < this.width && ty >= 0 && ty < this.height;
  }

  public getTile(tx: number, ty: number): TileData | undefined {
    if (!this.inBounds(tx, ty)) return undefined;
    return this.tiles[ty * this.width + tx];
  }

  public setTile(tx: number, ty: number, data: TileData): void {
    if (!this.inBounds(tx, ty)) return;
    this.tiles[ty * this.width + tx] = data;
  }

  public isWithinReach(playerX: number, playerY: number, tx: number, ty: number): boolean {
    const pcx = playerX + PLAYER_WIDTH * 0.5;
    const pcy = playerY + PLAYER_HEIGHT * 0.5;
    const tcx = (tx + 0.5) * TILE_SIZE;
    const tcy = (ty + 0.5) * TILE_SIZE;
    const dx = Math.abs(pcx - tcx) / TILE_SIZE;
    const dy = Math.abs(pcy - tcy) / TILE_SIZE;
    return dx <= PUNCH_REACH_TILES && dy <= PUNCH_REACH_TILES;
  }

  public getLockOwnerAt(tx: number, ty: number): { ownerId: string; ownerName: string } | null {
    if (this.ownerId && this.ownerName) {
      return { ownerId: this.ownerId, ownerName: this.ownerName };
    }
    // Check 3x3 Small Locks around (tx, ty)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = this.getTile(tx + dx, ty + dy);
        if (t && t.fg === ITEM_IDS.SMALL_LOCK && t.meta?.ownerId && t.meta?.ownerName) {
          return { ownerId: t.meta.ownerId, ownerName: t.meta.ownerName };
        }
      }
    }
    return null;
  }

  public canPlayerModify(tx: number, ty: number, playerId: string): { ok: boolean; reason?: string } {
    const tile = this.getTile(tx, ty);
    if (!tile) return { ok: false, reason: 'Out of world bounds.' };

    if (tile.fg !== 0) {
      const fgDef = getItemDef(tile.fg);
      if (fgDef?.unbreakable) {
        return { ok: false, reason: `${fgDef.name} is unbreakable!` };
      }
    }

    const lock = this.getLockOwnerAt(tx, ty);
    if (lock && lock.ownerId !== playerId) {
      return { ok: false, reason: `Area locked by ${lock.ownerName}!` };
    }

    return { ok: true };
  }

  public tickBlockHealing(nowMs: number): void {
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (t.damage && t.damage > 0 && t.lastHitAt && nowMs - t.lastHitAt >= BLOCK_HEAL_DELAY_MS) {
        t.damage = 0;
        t.lastHitAt = undefined;
      }
    }
  }
}
