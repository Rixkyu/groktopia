import { findSpliceResult, getItemDef } from '../../shared/ItemRegistry';
import { ItemDefinition, TileData } from '../../shared/types';
import { WorldManager } from './WorldManager';

export class SeedSystem {
  public getGrowthProgress(tile: TileData, nowMs: number): number {
    if (!tile.fg) return 0;
    const def = getItemDef(tile.fg);
    if (!def || def.category !== 'seed') return 0;
    const plantedAt = tile.meta?.plantedAt ?? nowMs;
    const growMs = tile.meta?.growTimeMs ?? (def.growTimeSec ?? 10) * 1000;
    if (growMs <= 0) return 1;
    return Math.max(0, Math.min(1, (nowMs - plantedAt) / growMs));
  }

  public getTreeStage(tile: TileData, nowMs: number): number {
    const p = this.getGrowthProgress(tile, nowMs);
    if (p >= 1) return 3;
    if (p >= 0.6) return 2;
    if (p >= 0.25) return 1;
    return 0;
  }

  public isMature(tile: TileData, nowMs: number): boolean {
    return this.getGrowthProgress(tile, nowMs) >= 1;
  }

  public getRemainingSeconds(tile: TileData, nowMs: number): number {
    const def = getItemDef(tile.fg);
    if (!def || def.category !== 'seed') return 0;
    const plantedAt = tile.meta?.plantedAt ?? nowMs;
    const growMs = tile.meta?.growTimeMs ?? (def.growTimeSec ?? 10) * 1000;
    const rem = Math.ceil((plantedAt + growMs - nowMs) / 1000);
    return Math.max(0, rem);
  }

  public canPlantAt(
    tx: number,
    ty: number,
    seedId: number,
    world: WorldManager,
    nowMs: number
  ): { ok: boolean; spliceResult?: ItemDefinition; reason?: string } {
    const tile = world.getTile(tx, ty);
    if (!tile) return { ok: false, reason: 'Invalid tile.' };

    // Must have solid block underneath!
    const below = world.getTile(tx, ty + 1);
    if (!below || below.fg === 0) {
      return { ok: false, reason: 'Seeds must be planted on top of a solid block!' };
    }
    const belowDef = getItemDef(below.fg);
    if (!belowDef || belowDef.collision !== 'solid') {
      return { ok: false, reason: 'Seeds require solid ground underneath!' };
    }

    if (tile.fg === 0) {
      return { ok: true };
    }

    // Check seed splicing!
    const existingDef = getItemDef(tile.fg);
    if (existingDef && existingDef.category === 'seed') {
      if (this.isMature(tile, nowMs)) {
        return { ok: false, reason: 'Tree is already fully grown! Harvest it first.' };
      }
      const spliced = findSpliceResult(tile.fg, seedId);
      if (!spliced) {
        return { ok: false, reason: `${existingDef.name} and ${getItemDef(seedId)?.name} do not splice!` };
      }
      return { ok: true, spliceResult: spliced };
    }

    return { ok: false, reason: 'Tile is occupied!' };
  }
}
