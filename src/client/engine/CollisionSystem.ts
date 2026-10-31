import {
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  TILE_SIZE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../../shared/constants';
import { getItemDef } from '../../shared/ItemRegistry';
import { TileData } from '../../shared/types';

export interface AABB {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SweepResult {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  hitCeiling: boolean;
  touchedLava: boolean;
  touchedSpike: boolean;
  touchedBumper: boolean;
}

export class CollisionSystem {
  public resolveMovement(
    x: number,
    y: number,
    vx: number,
    vy: number,
    dt: number,
    getTile: (tx: number, ty: number) => TileData | undefined,
    dropThroughPlatforms: boolean
  ): SweepResult {
    let nextX = x;
    let nextY = y;
    let nextVx = vx;
    let nextVy = vy;
    let grounded = false;
    let hitCeiling = false;
    let touchedLava = false;
    let touchedSpike = false;
    let touchedBumper = false;

    const worldMaxX = WORLD_WIDTH * TILE_SIZE - PLAYER_WIDTH;
    const worldMaxY = WORLD_HEIGHT * TILE_SIZE - PLAYER_HEIGHT;

    // Sub-step large velocities to prevent tunneling
    const maxStepPx = 8;
    const dist = Math.hypot(vx * dt, vy * dt);
    const steps = Math.max(1, Math.ceil(dist / maxStepPx));
    const stepDt = dt / steps;

    for (let s = 0; s < steps; s++) {
      // --- HORIZONTAL PASS ---
      nextX += nextVx * stepDt;
      if (nextX < 0) {
        nextX = 0;
        nextVx = 0;
      } else if (nextX > worldMaxX) {
        nextX = worldMaxX;
        nextVx = 0;
      }

      const leftTile = Math.floor(nextX / TILE_SIZE);
      const rightTile = Math.floor((nextX + PLAYER_WIDTH - 0.001) / TILE_SIZE);
      const topTileH = Math.floor((nextY + 0.5) / TILE_SIZE);
      const bottomTileH = Math.floor((nextY + PLAYER_HEIGHT - 0.5) / TILE_SIZE);

      for (let ty = topTileH; ty <= bottomTileH; ty++) {
        for (let tx = leftTile; tx <= rightTile; tx++) {
          const tile = getTile(tx, ty);
          if (!tile || tile.fg === 0) continue;
          const def = getItemDef(tile.fg);
          if (!def) continue;

          if (def.collision === 'spike') {
            touchedSpike = true;
            continue;
          }

          if (
            def.collision === 'solid' ||
            def.collision === 'lava' ||
            def.collision === 'bumper'
          ) {
            if (def.collision === 'lava') touchedLava = true;
            if (def.collision === 'bumper') touchedBumper = true;

            if (nextVx > 0) {
              nextX = tx * TILE_SIZE - PLAYER_WIDTH;
              nextVx = 0;
            } else if (nextVx < 0) {
              nextX = (tx + 1) * TILE_SIZE;
              nextVx = 0;
            }
          }
        }
      }

      // --- VERTICAL PASS ---
      const prevBottom = nextY + PLAYER_HEIGHT;
      nextY += nextVy * stepDt;

      if (nextY < 0) {
        nextY = 0;
        nextVy = 0;
        hitCeiling = true;
      } else if (nextY > worldMaxY) {
        nextY = worldMaxY;
        nextVy = 0;
        grounded = true;
      }

      const leftTileV = Math.floor((nextX + 0.5) / TILE_SIZE);
      const rightTileV = Math.floor((nextX + PLAYER_WIDTH - 0.5) / TILE_SIZE);
      const topTileV = Math.floor(nextY / TILE_SIZE);
      const bottomTileV = Math.floor((nextY + PLAYER_HEIGHT - 0.001) / TILE_SIZE);

      // Authentic Growtopia Corner Nudge: if head clips a block corner by <= 5px while jumping up, slip into the open shaft!
      if (nextVy < 0) {
        const tileL = getTile(leftTileV, topTileV);
        const tileR = getTile(rightTileV, topTileV);
        const defL = tileL?.fg ? getItemDef(tileL.fg) : null;
        const defR = tileR?.fg ? getItemDef(tileR.fg) : null;
        const isSolidL = defL?.collision === 'solid' || defL?.collision === 'lava';
        const isSolidR = defR?.collision === 'solid' || defR?.collision === 'lava';

        if (isSolidL && !isSolidR && (leftTileV + 1) * TILE_SIZE - nextX <= 5.5) {
          nextX = (leftTileV + 1) * TILE_SIZE + 0.5;
        } else if (isSolidR && !isSolidL && nextX + PLAYER_WIDTH - rightTileV * TILE_SIZE <= 5.5) {
          nextX = rightTileV * TILE_SIZE - PLAYER_WIDTH - 0.5;
        }
      }

      for (let ty = topTileV; ty <= bottomTileV; ty++) {
        for (let tx = leftTileV; tx <= rightTileV; tx++) {
          const tile = getTile(tx, ty);
          if (!tile || tile.fg === 0) continue;
          const def = getItemDef(tile.fg);
          if (!def) continue;

          if (def.collision === 'spike') {
            touchedSpike = true;
            continue;
          }

          if (def.collision === 'platform') {
            // One-way platform: only collide when falling downward and player's feet were at or above top edge!
            const platformTop = ty * TILE_SIZE;
            if (
              !dropThroughPlatforms &&
              nextVy >= 0 &&
              prevBottom <= platformTop + 4 &&
              nextY + PLAYER_HEIGHT >= platformTop
            ) {
              nextY = platformTop - PLAYER_HEIGHT;
              nextVy = 0;
              grounded = true;
            }
            continue;
          }

          if (
            def.collision === 'solid' ||
            def.collision === 'lava' ||
            def.collision === 'bumper'
          ) {
            if (def.collision === 'lava') touchedLava = true;
            if (def.collision === 'bumper') touchedBumper = true;

            if (nextVy > 0) {
              nextY = ty * TILE_SIZE - PLAYER_HEIGHT;
              nextVy = 0;
              grounded = true;
            } else if (nextVy < 0) {
              nextY = (ty + 1) * TILE_SIZE;
              nextVy = 0;
              hitCeiling = true;
            }
          }
        }
      }
    }

    return {
      x: nextX,
      y: nextY,
      vx: nextVx,
      vy: nextVy,
      grounded,
      hitCeiling,
      touchedLava,
      touchedSpike,
      touchedBumper,
    };
  }

  public doesBlockOverlapBox(tx: number, ty: number, box: AABB): boolean {
    const bx = tx * TILE_SIZE;
    const by = ty * TILE_SIZE;
    return (
      box.x < bx + TILE_SIZE - 1 &&
      box.x + box.width > bx + 1 &&
      box.y < by + TILE_SIZE - 1 &&
      box.y + box.height > by + 1
    );
  }
}
