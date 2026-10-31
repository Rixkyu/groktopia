import {
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  TILE_SIZE,
} from '../../shared/constants';
import { getItemDef, ITEM_IDS } from '../../shared/ItemRegistry';
import { CollisionSystem } from './CollisionSystem';
import { InventorySystem } from './InventorySystem';
import { SeedSystem } from './SeedSystem';
import { WorldManager } from './WorldManager';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
  gravity: boolean;
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export class BlockSystem {
  public particles: Particle[] = [];
  public floatingTexts: FloatingText[] = [];

  constructor(
    private collision: CollisionSystem,
    private seedSystem: SeedSystem
  ) {}

  public spawnBlockParticles(tx: number, ty: number, color: string, secondary: string, count = 10): void {
    const cx = (tx + 0.5) * TILE_SIZE;
    const cy = (ty + 0.5) * TILE_SIZE;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 145;
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 14,
        y: cy + (Math.random() - 0.5) * 14,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 75,
        size: 3 + Math.floor(Math.random() * 4),
        color: i % 2 === 0 ? color : secondary,
        life: 0.45 + Math.random() * 0.25,
        maxLife: 0.7,
        gravity: true,
      });
    }
  }

  public spawnSparkles(x: number, y: number, color: string, count = 12): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const speed = 35 + Math.random() * 90;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 20,
        size: 3,
        color,
        life: 0.55,
        maxLife: 0.55,
        gravity: false,
      });
    }
  }

  public spawnFloatingText(x: number, y: number, text: string, color = '#ffffff'): void {
    this.floatingTexts.push({
      x,
      y,
      vy: -42,
      text,
      color,
      life: 1.15,
      maxLife: 1.15,
    });
  }

  public updateEffects(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      if (p.gravity) p.vy += 520 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life -= dt;
      if (ft.life <= 0) {
        this.floatingTexts.splice(i, 1);
        continue;
      }
      ft.y += ft.vy * dt;
    }
  }

  public validatePlaceClient(
    tx: number,
    ty: number,
    itemId: number,
    playerId: string,
    playerX: number,
    playerY: number,
    otherPlayers: Array<{ x: number; y: number }>,
    world: WorldManager,
    inventory: InventorySystem,
    nowMs: number
  ): { ok: boolean; reason?: string } {
    if (!world.inBounds(tx, ty)) return { ok: false, reason: 'Out of bounds.' };
    if (!world.isWithinReach(playerX, playerY, tx, ty)) {
      return { ok: false, reason: 'Too far away!' };
    }
    if (inventory.getCount(itemId) <= 0) {
      return { ok: false, reason: 'Out of that item!' };
    }

    const perm = world.canPlayerModify(tx, ty, playerId);
    if (!perm.ok) return perm;

    const def = getItemDef(itemId);
    if (!def) return { ok: false, reason: 'Unknown item.' };

    const tile = world.getTile(tx, ty)!;

    if (def.category === 'seed') {
      const check = this.seedSystem.canPlantAt(tx, ty, itemId, world, nowMs);
      return check;
    }

    if (def.category === 'background') {
      if (tile.bg === itemId) return { ok: false, reason: 'Already placed here.' };
      return { ok: true };
    }

    if (
      def.category === 'foreground' ||
      def.category === 'lock' ||
      def.category === 'weather'
    ) {
      if (tile.fg !== 0) return { ok: false, reason: 'Tile already occupied!' };

      if (itemId === ITEM_IDS.WORLD_LOCK && world.ownerId) {
        return { ok: false, reason: 'World already has a World Lock!' };
      }

      if (
        def.collision === 'solid' ||
        def.collision === 'lava' ||
        def.collision === 'bumper'
      ) {
        // Prevent placing a solid block directly on top of yourself or another player!
        const localBox = { x: playerX, y: playerY, width: PLAYER_WIDTH, height: PLAYER_HEIGHT };
        if (this.collision.doesBlockOverlapBox(tx, ty, localBox)) {
          return { ok: false, reason: 'Cannot place solid block inside player!' };
        }
        for (const op of otherPlayers) {
          if (
            this.collision.doesBlockOverlapBox(tx, ty, {
              x: op.x,
              y: op.y,
              width: PLAYER_WIDTH,
              height: PLAYER_HEIGHT,
            })
          ) {
            return { ok: false, reason: 'Cannot place solid block on another player!' };
          }
        }
      }
      return { ok: true };
    }

    return { ok: false, reason: 'Item cannot be placed.' };
  }
}
