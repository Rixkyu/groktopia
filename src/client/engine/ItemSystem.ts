import {
  MAGNET_RADIUS_PX,
  PICKUP_RADIUS_PX,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
} from '../../shared/constants';
import { DroppedItem } from '../../shared/types';
import { InventorySystem } from './InventorySystem';
import { WorldManager } from './WorldManager';

export class ItemSystem {
  private pendingPickups = new Map<string, number>();

  public update(
    dt: number,
    nowMs: number,
    playerX: number,
    playerY: number,
    world: WorldManager,
    inventory: InventorySystem,
    onRequestPickup: (uid: string) => void
  ): void {
    const pcx = playerX + PLAYER_WIDTH * 0.5;
    const pcy = playerY + PLAYER_HEIGHT * 0.5;

    // Clean old pending markers
    for (const [uid, sentAt] of this.pendingPickups) {
      if (nowMs - sentAt > 1200 || !world.drops.has(uid)) {
        this.pendingPickups.delete(uid);
      }
    }

    for (const drop of world.drops.values()) {
      // Newly dropped items have a tiny 300ms spawn pop before magnetizing
      if (nowMs - drop.spawnedAt < 280) continue;

      if (drop.itemId !== 0 && !inventory.canFit(drop.itemId, 1)) {
        continue;
      }

      const dx = pcx - drop.x;
      const dy = pcy - drop.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= MAGNET_RADIUS_PX && dist > 1) {
        const pullSpeed = 230 * (1 - dist / (MAGNET_RADIUS_PX + 20));
        drop.x += (dx / dist) * pullSpeed * dt;
        drop.y += (dy / dist) * pullSpeed * dt;
      }

      if (dist <= PICKUP_RADIUS_PX && !this.pendingPickups.has(drop.uid)) {
        this.pendingPickups.set(drop.uid, nowMs);
        onRequestPickup(drop.uid);
      }
    }
  }
}
