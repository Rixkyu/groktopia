import {
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  TILE_SIZE,
} from '../../shared/constants';
import { getItemDef, ITEM_IDS } from '../../shared/ItemRegistry';
import { PlayerNetState, WeatherType } from '../../shared/types';
import { BlockSystem } from './BlockSystem';
import { ChatManager } from './ChatManager';
import { SeedSystem } from './SeedSystem';
import { SpriteAtlas } from './SpriteAtlas';
import { WorldManager } from './WorldManager';

const GT_FONT = '"CenturyGothicBold", "Century Gothic", "Trebuchet MS", sans-serif';

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  public cameraX = 0;
  public cameraY = 0;
  public zoom = 2; // effective pixel scale, derived from window height + zoomScale
  public zoomScale = 1; // user multiplier (Options -> Camera Zoom)
  public showGrid = false;

  // Growtopia keeps a roughly fixed number of tiles visible vertically regardless of resolution.
  private static readonly VISIBLE_TILES_Y = 18;

  constructor(
    public canvas: HTMLCanvasElement,
    private atlas: SpriteAtlas,
    private seedSystem: SeedSystem
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
  }

  public handleResize(): void {
    const dpr = 1;
    this.canvas.width = Math.max(320, Math.floor(window.innerWidth * dpr));
    this.canvas.height = Math.max(240, Math.floor(window.innerHeight * dpr));
    this.ctx.imageSmoothingEnabled = false;
    this.recomputeZoom();
  }

  public setZoomScale(scale: number): void {
    this.zoomScale = scale;
    this.recomputeZoom();
  }

  private recomputeZoom(): void {
    const raw = (this.canvas.height / (Renderer.VISIBLE_TILES_Y * TILE_SIZE)) * this.zoomScale;
    // Snap to whole screen pixels per tile so tiles never show seams.
    const tilePx = Math.max(24, Math.min(160, Math.round(raw * TILE_SIZE)));
    this.zoom = tilePx / TILE_SIZE;
  }

  public updateCamera(targetX: number, targetY: number, world: WorldManager, dt: number, instant = false): void {
    const viewW = this.canvas.width / this.zoom;
    const viewH = this.canvas.height / this.zoom;

    const desiredX = targetX + PLAYER_WIDTH * 0.5 - viewW * 0.5;
    const desiredY = targetY + PLAYER_HEIGHT * 0.5 - viewH * 0.5;

    const maxCamX = Math.max(0, world.width * TILE_SIZE - viewW);
    const maxCamY = Math.max(0, world.height * TILE_SIZE - viewH);

    const clampedX = Math.max(0, Math.min(maxCamX, desiredX));
    const clampedY = Math.max(0, Math.min(maxCamY, desiredY));

    if (instant) {
      this.cameraX = clampedX;
      this.cameraY = clampedY;
    } else {
      const alpha = Math.min(1, dt * 11);
      this.cameraX += (clampedX - this.cameraX) * alpha;
      this.cameraY += (clampedY - this.cameraY) * alpha;
    }
  }

  public renderMenuBackdrop(nowMs: number): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.imageSmoothingEnabled = false;

    this.drawSkyAndParallax(ctx, w, h, nowMs * 0.035, 0, 'sunny', nowMs);

    // Scenic Growtopia terrain strip with autotiled grassy Dirt, shadows, trees & locks!
    const scale = 2;
    const tileScreen = TILE_SIZE * scale;
    const shOff = 4 * scale;
    const cols = Math.ceil(w / tileScreen) + 2;
    const scrollPx = Math.floor(nowMs * 0.042);
    const scrollTiles = Math.floor(scrollPx / tileScreen);
    const offsetX = -(scrollPx % tileScreen);
    const groundY = h - tileScreen * 2;

    // 1. Background cave layer + shadows
    const caveBg = this.atlas.getAutotiledSprite(ITEM_IDS.CAVE_BG, 0, 0, 0);
    const topDirtShadow = this.atlas.getAutotiledShadow(ITEM_IDS.DIRT, 1, 0, 0);
    const midDirtShadow = this.atlas.getAutotiledShadow(ITEM_IDS.DIRT, 0, 0, 0);

    for (let i = 0; i < cols; i++) {
      const sx = offsetX + i * tileScreen;
      ctx.drawImage(caveBg, sx, groundY + tileScreen, tileScreen, tileScreen);
      ctx.drawImage(topDirtShadow, sx - shOff, groundY + shOff, tileScreen, tileScreen);
      ctx.drawImage(midDirtShadow, sx - shOff, groundY + tileScreen + shOff, tileScreen, tileScreen);
    }

    // 2. Foreground grassy Dirt + scenic Growtopia trees & props
    const topDirt = this.atlas.getAutotiledSprite(ITEM_IDS.DIRT, 1, 0, 0);
    const midDirt = this.atlas.getAutotiledSprite(ITEM_IDS.DIRT, 0, 0, 0);

    for (let i = 0; i < cols; i++) {
      const worldCol = i + scrollTiles;
      const sx = offsetX + i * tileScreen;
      ctx.drawImage(topDirt, sx, groundY, tileScreen, tileScreen);
      ctx.drawImage(midDirt, sx, groundY + tileScreen, tileScreen, tileScreen);

      if (worldCol % 9 === 0) {
        const treeSh = this.atlas.getTreeShadowSprite(ITEM_IDS.GRASS_SEED, 3);
        const tree = this.atlas.getTreeSprite(ITEM_IDS.GRASS_SEED, 3);
        if (treeSh) ctx.drawImage(treeSh, sx - shOff, groundY - tileScreen + shOff, tileScreen, tileScreen);
        if (tree) ctx.drawImage(tree, sx, groundY - tileScreen, tileScreen, tileScreen);
      } else if (worldCol % 13 === 0) {
        const treeSh = this.atlas.getTreeShadowSprite(ITEM_IDS.GOLD_SEED, 3);
        const tree = this.atlas.getTreeSprite(ITEM_IDS.GOLD_SEED, 3);
        if (treeSh) ctx.drawImage(treeSh, sx - shOff, groundY - tileScreen + shOff, tileScreen, tileScreen);
        if (tree) ctx.drawImage(tree, sx, groundY - tileScreen, tileScreen, tileScreen);
      } else if (worldCol % 17 === 0) {
        const wl = this.atlas.getAutotiledSprite(ITEM_IDS.WORLD_LOCK, 2, 0, 0);
        const wlSh = this.atlas.getAutotiledShadow(ITEM_IDS.WORLD_LOCK, 2, 0, 0);
        ctx.drawImage(wlSh, sx - shOff, groundY - tileScreen + shOff, tileScreen, tileScreen);
        ctx.drawImage(wl, sx, groundY - tileScreen, tileScreen, tileScreen);
      } else if (worldCol % 6 === 0) {
        const cane = this.atlas.getAutotiledSprite(ITEM_IDS.SUGAR_CANE, 3, 0, 0);
        ctx.drawImage(cane, sx, groundY - tileScreen, tileScreen, tileScreen);
      }
    }
  }

  private drawTiledHoriz(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    srcW: number,
    srcH: number,
    destY: number,
    destW: number,
    destH: number,
    scrollX: number,
    viewportW: number
  ): void {
    const startX = -(((Math.floor(scrollX) % destW) + destW) % destW);
    for (let x = startX; x < viewportW + destW; x += destW) {
      ctx.drawImage(img, 0, 0, srcW, srcH, x, destY, destW, destH);
    }
  }

  private drawSkyAndParallax(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    camX: number,
    camY: number,
    weather: WeatherType,
    nowMs: number
  ): void {
    if (weather === 'night') {
      const nightBg = this.atlas.getSheet('night_weather');
      if (nightBg) {
        ctx.drawImage(nightBg, 0, 0, w, h);
      } else {
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#05091e');
        grad.addColorStop(0.65, '#111d4a');
        grad.addColorStop(1, '#222b61');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      // Twinkling unpacked stars.png (4x2 16x16 star sprites inside 64x64)
      const starsSheet = this.atlas.getSheet('stars');
      for (let i = 0; i < 36; i++) {
        const sx = (((i * 211 - Math.floor(camX * 0.05)) % w) + w) % w;
        const sy = (i * 83 + 18) % Math.max(80, Math.floor(h * 0.58));
        if (starsSheet) {
          const starCol = (i + Math.floor(nowMs / 450)) % 4;
          const starRow = i % 2;
          ctx.drawImage(starsSheet, starCol * 16, starRow * 16, 16, 16, sx, sy, 16, 16);
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(sx, sy, 3, 3);
        }
      }

      // Official moon.png (orig 161x159 inside 256x256)
      const moon = this.atlas.getSheet('moon');
      const mx = Math.floor(w * 0.78);
      const my = Math.floor(h * 0.08);
      if (moon) {
        ctx.drawImage(moon, 0, 0, 161, 159, mx, my, 128, 126);
      }
      return;
    }

    if (weather === 'desert') {
      const aridBg = this.atlas.getSheet('arid_weather');
      const desertSky = this.atlas.getSheet('desert_sky');
      if (aridBg) {
        ctx.drawImage(aridBg, 0, 0, w, h);
      } else if (desertSky) {
        ctx.drawImage(desertSky, 0, 0, 32, 32, 0, 0, w, h);
      } else {
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#372485');
        grad.addColorStop(0.55, '#c46f3b');
        grad.addColorStop(1, '#473023');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      const sun = this.atlas.getSheet('sun');
      if (sun && !aridBg) {
        ctx.drawImage(sun, 0, 0, 161, 159, Math.floor(w * 0.8), Math.floor(h * 0.08), 130, 128);
      }

      const dHills = this.atlas.getSheet('desert_hills2');
      if (dHills) {
        const hy = Math.floor(h * 0.62 - camY * 0.06);
        this.drawTiledHoriz(ctx, dHills, 512, 256, hy, 512, 256, camX * 0.18, w);
      }
      return;
    }

    if (weather === 'rain') {
      const citySky = this.atlas.getSheet('city_sky');
      if (citySky) {
        ctx.drawImage(citySky, 0, 0, 8, 64, 0, 0, w, h);
      } else {
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#223147');
        grad.addColorStop(1, '#4c6787');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      // Dark storm clouds (cloud.png orig 197x111)
      const cloud = this.atlas.getSheet('cloud');
      if (cloud) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        for (let c = 0; c < 6; c++) {
          const speed = c % 2 === 0 ? 0.022 : 0.014;
          const rawX = c * 310 + nowMs * speed - camX * 0.14;
          const cx = (((Math.floor(rawX) % (w + 260)) + (w + 260)) % (w + 260)) - 180;
          const cy = 24 + (c % 3) * 48 - Math.floor(camY * 0.03);
          ctx.drawImage(cloud, 0, 0, 197, 111, cx, cy, 178, 100);
        }
        ctx.restore();
      }

      const cityFar = this.atlas.getSheet('city2_skyline');
      const cityNear = this.atlas.getSheet('city_skyline');
      const baseHorizon = Math.floor(h * 0.45 - camY * 0.06);
      if (cityFar) {
        this.drawTiledHoriz(ctx, cityFar, 512, 512, baseHorizon, 512, 512, camX * 0.12, w);
      }
      if (cityNear) {
        this.drawTiledHoriz(ctx, cityNear, 512, 512, baseHorizon + 70, 512, 512, camX * 0.22, w);
      }

      // Atmospheric dark storm tint + crisp rain streaks
      ctx.fillStyle = 'rgba(14, 24, 42, 0.28)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(180, 228, 255, 0.58)';
      for (let r = 0; r < 95; r++) {
        const rx = (((r * 97 + Math.floor(nowMs * 0.36)) % w) + w) % w;
        const ry = (((r * 131 + Math.floor(nowMs * 0.88)) % h) + h) % h;
        ctx.fillRect(rx, ry, 2, 13);
      }
      return;
    }

    // DEFAULT SUNNY GROWTOPIA WEATHER!
    const skyTex = this.atlas.getSheet('bg_EC_sky');
    if (skyTex) {
      ctx.drawImage(skyTex, 0, 0, 32, 32, 0, 0, w, h);
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#44b8f7');
      grad.addColorStop(0.6, '#7cd6ff');
      grad.addColorStop(1, '#c8f2ff');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    // Official Growtopia Sun (sun.png orig 161x159 inside 256x256)
    const sun = this.atlas.getSheet('sun');
    const sunX = Math.floor(w * 0.78);
    const sunY = Math.max(16, Math.floor(h * 0.06 - camY * 0.02));
    if (sun) {
      ctx.drawImage(sun, 0, 0, 161, 159, sunX, sunY, 138, 136);
    } else {
      ctx.fillStyle = '#ffe84d';
      ctx.fillRect(sunX, sunY, 64, 64);
    }

    // Official Growtopia Parallax Clouds (cloud.png orig 197x111 inside 256x128)
    const cloud = this.atlas.getSheet('cloud');
    for (let c = 0; c < 6; c++) {
      const speed = c % 2 === 0 ? 0.016 : 0.01;
      const scale = c % 3 === 0 ? 0.95 : c % 3 === 1 ? 0.78 : 0.65;
      const rawX = c * 310 + nowMs * speed - camX * (0.12 * scale);
      const cx = (((Math.floor(rawX) % (w + 260)) + (w + 260)) % (w + 260)) - 180;
      const cy = 28 + (c % 3) * 56 - Math.floor(camY * 0.03);
      if (cloud) {
        ctx.drawImage(
          cloud,
          0,
          0,
          197,
          111,
          cx,
          cy,
          Math.round(197 * scale),
          Math.round(111 * scale)
        );
      }
    }

    // Official 3-Layer Growtopia Rolling Green Hills (hills3 -> hills2 -> hills1)
    const hills3 = this.atlas.getSheet('hills3');
    const hills2 = this.atlas.getSheet('hills2');
    const hills1 = this.atlas.getSheet('hills1');
    const horizonY = Math.floor(h * 0.56 - camY * 0.07);

    if (hills3) {
      this.drawTiledHoriz(ctx, hills3, 512, 256, horizonY - 30, 512, 256, camX * 0.1, w);
      ctx.fillStyle = '#75b9b9';
      if (horizonY + 224 < h) ctx.fillRect(0, horizonY + 224, w, h - (horizonY + 224));
    }
    if (hills2) {
      this.drawTiledHoriz(ctx, hills2, 512, 256, horizonY + 34, 512, 256, camX * 0.18, w);
      ctx.fillStyle = '#5da876';
      if (horizonY + 288 < h) ctx.fillRect(0, horizonY + 288, w, h - (horizonY + 288));
    }
    if (hills1) {
      this.drawTiledHoriz(ctx, hills1, 512, 128, horizonY + 120, 512, 128, camX * 0.28, w);
      ctx.fillStyle = '#439652';
      if (horizonY + 246 < h) ctx.fillRect(0, horizonY + 246, w, h - (horizonY + 246));
    }
  }

  public renderWorld(
    world: WorldManager,
    localPlayer: PlayerNetState,
    remotePlayers: Map<string, PlayerNetState>,
    hoveredTile: { tx: number; ty: number },
    selectedItemId: number,
    effects: BlockSystem,
    nowMs: number
  ): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const z = this.zoom;
    const ts = TILE_SIZE * z;
    const shOff = Math.round(4 * z); // Official Growtopia (-4, +4) world-pixel shadow offset!
    ctx.imageSmoothingEnabled = false;

    this.drawSkyAndParallax(ctx, w, h, this.cameraX, this.cameraY, world.weather, nowMs);

    const startX = Math.max(0, Math.floor(this.cameraX / TILE_SIZE) - 1);
    const endX = Math.min(world.width - 1, Math.ceil((this.cameraX + w / z) / TILE_SIZE) + 1);
    const startY = Math.max(0, Math.floor(this.cameraY / TILE_SIZE) - 1);
    const endY = Math.min(world.height - 1, Math.ceil((this.cameraY + h / z) / TILE_SIZE) + 1);

    const animFrame = Math.floor(nowMs / 320) % 2;
    const lightSources: Array<{ sx: number; sy: number; r: number; color: string }> = [];

    const getNeighborId = (nx: number, ny: number, bg: boolean): number => {
      const t = world.getTile(nx, ny);
      if (!t) return 0;
      return bg ? t.bg : t.fg;
    };

    // PASS 1: Autotiled Background Layer
    for (let ty = startY; ty <= endY; ty++) {
      const sy = Math.round((ty * TILE_SIZE - this.cameraY) * z);
      for (let tx = startX; tx <= endX; tx++) {
        const tile = world.getTile(tx, ty);
        if (!tile || tile.bg === 0) continue;
        const sx = Math.round((tx * TILE_SIZE - this.cameraX) * z);
        const { ox, oy } = this.atlas.computeAutotileOffset(
          tile.bg,
          tx,
          ty,
          world.width,
          world.height,
          true,
          getNeighborId
        );
        const bgSprite = this.atlas.getAutotiledSprite(tile.bg, ox, oy, animFrame, false, false);
        ctx.drawImage(bgSprite, sx, sy, ts, ts);
      }
    }

    // PASS 2: Authentic Growtopia (-4, +4) Silhouette Shadows (Foreground Tiles + Trees + Drops)
    for (let ty = startY; ty <= endY; ty++) {
      const sy = Math.round((ty * TILE_SIZE - this.cameraY) * z);
      for (let tx = startX; tx <= endX; tx++) {
        const tile = world.getTile(tx, ty);
        if (!tile || tile.fg === 0) continue;
        const fgDef = getItemDef(tile.fg);
        if (!fgDef) continue;
        const sx = Math.round((tx * TILE_SIZE - this.cameraX) * z);

        if (fgDef.category === 'seed') {
          const stage = this.seedSystem.getTreeStage(tile, nowMs);
          const treeShadow = this.atlas.getTreeShadowSprite(tile.fg, stage);
          if (treeShadow) {
            ctx.drawImage(treeShadow, sx - shOff, sy + shOff, ts, ts);
          }
        } else {
          const { ox, oy } = this.atlas.computeAutotileOffset(
            tile.fg,
            tx,
            ty,
            world.width,
            world.height,
            false,
            getNeighborId
          );
          const topOpen = ty === 0 || getNeighborId(tx, ty - 1, false) === 0;
          const fgShadow = this.atlas.getAutotiledShadow(tile.fg, ox, oy, animFrame, topOpen);
          ctx.drawImage(fgShadow, sx - shOff, sy + shOff, ts, ts);
        }
      }
    }

    // Drop shadows (-4, +4)
    for (const drop of world.drops.values()) {
      const bob = Math.sin(nowMs * 0.0055 + drop.x * 0.1) * 2.5;
      const sx = Math.round((drop.x - this.cameraX) * z);
      const sy = Math.round((drop.y + bob - this.cameraY) * z);
      if (sx < -64 || sx > w + 64 || sy < -64 || sy > h + 64) continue;

      if (drop.itemId === 0) {
        const gs = Math.round(18 * z);
        const gemSh = this.atlas.getGemShadowSprite(drop.count);
        ctx.drawImage(gemSh, sx - gs * 0.5 - shOff, sy - gs * 0.5 + shOff, gs, gs);
      } else {
        const dDef = getItemDef(drop.itemId);
        if (dDef?.category === 'seed') {
          const ss = Math.round(16 * z);
          const seedSh = this.atlas.getSeedDrop16Shadow(drop.itemId);
          if (seedSh) {
            ctx.drawImage(seedSh, sx - ss * 0.5 - shOff, sy - ss * 0.5 + shOff, ss, ss);
          }
        } else {
          const bs = Math.round(20 * z);
          const is = Math.round(19 * z);
          const b19Sh = this.atlas.getDropBlock19Shadow(drop.itemId);
          if (b19Sh) {
            ctx.drawImage(b19Sh, sx - is * 0.5 - shOff, sy - is * 0.5 + shOff, is, is);
          }
          const pbSh = this.atlas.getPickupBoxShadow();
          if (pbSh) {
            ctx.drawImage(pbSh, sx - bs * 0.5 - shOff, sy - bs * 0.5 + shOff, bs, bs);
          }
        }
      }
    }

    // PASS 3: Autotiled Foreground Blocks, Growing Trees & Particles Cracks
    for (let ty = startY; ty <= endY; ty++) {
      const sy = Math.round((ty * TILE_SIZE - this.cameraY) * z);
      for (let tx = startX; tx <= endX; tx++) {
        const tile = world.getTile(tx, ty);
        if (!tile) continue;
        const sx = Math.round((tx * TILE_SIZE - this.cameraX) * z);

        if (tile.fg !== 0) {
          const fgDef = getItemDef(tile.fg);
          if (fgDef) {
            if (fgDef.category === 'seed') {
              const stage = this.seedSystem.getTreeStage(tile, nowMs);
              const treeSprite = this.atlas.getTreeSprite(tile.fg, stage);
              if (treeSprite) {
                ctx.drawImage(treeSprite, sx, sy, ts, ts);
              }
              if (stage === 3 && Math.floor(nowMs / 420 + tx + ty) % 2 === 0) {
                ctx.fillStyle = '#ffffa8';
                ctx.fillRect(sx + Math.floor(ts * 0.48), sy + Math.floor(ts * 0.14), 2 * z, 2 * z);
              }
            } else {
              const { ox, oy } = this.atlas.computeAutotileOffset(
                tile.fg,
                tx,
                ty,
                world.width,
                world.height,
                false,
                getNeighborId
              );
              const topOpen = ty === 0 || getNeighborId(tx, ty - 1, false) === 0;
              const fgSprite = this.atlas.getAutotiledSprite(
                tile.fg,
                ox,
                oy,
                animFrame,
                false,
                topOpen
              );
              ctx.drawImage(fgSprite, sx, sy, ts, ts);
            }

            if (fgDef.lightRadius && fgDef.lightColor) {
              lightSources.push({
                sx: sx + ts * 0.5,
                sy: sy + ts * 0.5,
                r: fgDef.lightRadius * z,
                color: fgDef.lightColor,
              });
            }

            // Official particles.png Block Damage Cracks!
            if (tile.damage && tile.damage > 0 && fgDef.hitsToBreak > 1) {
              const ratio = tile.damage / fgDef.hitsToBreak;
              const crackStage = Math.min(3, Math.floor(ratio * 4));
              const crack = this.atlas.getCrackSprite(crackStage);
              if (crack) {
                ctx.drawImage(crack, sx, sy, ts, ts);
              }
            }
          }
        } else if (tile.bg !== 0 && tile.damage && tile.damage > 0) {
          const bgDef = getItemDef(tile.bg);
          if (bgDef && bgDef.hitsToBreak > 1) {
            const ratio = tile.damage / bgDef.hitsToBreak;
            const crackStage = Math.min(3, Math.floor(ratio * 4));
            const crack = this.atlas.getCrackSprite(crackStage);
            if (crack) {
              ctx.drawImage(crack, sx, sy, ts, ts);
            }
          }
        }

        if (this.showGrid) {
          ctx.strokeStyle = 'rgba(255,255,255,0.12)';
          ctx.lineWidth = 1;
          ctx.strokeRect(sx + 0.5, sy + 0.5, ts, ts);
        }
      }
    }

    // 4. Warm Point Lights (Torches, Lava, Chandeliers, Crystals)
    for (const light of lightSources) {
      const rad = ctx.createRadialGradient(light.sx, light.sy, 4, light.sx, light.sy, light.r);
      rad.addColorStop(0, light.color);
      rad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rad;
      ctx.fillRect(light.sx - light.r, light.sy - light.r, light.r * 2, light.r * 2);
    }

    // 5. Dropped World Items, Seeds & Gems (with pickup_box.png!)
    const pickupBox = this.atlas.getPickupBox();
    for (const drop of world.drops.values()) {
      const bob = Math.sin(nowMs * 0.0055 + drop.x * 0.1) * 2.5;
      const sx = Math.round((drop.x - this.cameraX) * z);
      const sy = Math.round((drop.y + bob - this.cameraY) * z);
      if (sx < -64 || sx > w + 64 || sy < -64 || sy > h + 64) continue;

      if (drop.itemId === 0) {
        const gemSprite = this.atlas.getGemSprite(drop.count);
        const gs = Math.round(18 * z);
        ctx.drawImage(gemSprite, sx - gs * 0.5, sy - gs * 0.5, gs, gs);
      } else {
        const dDef = getItemDef(drop.itemId);
        if (dDef?.category === 'seed') {
          const seed16 = this.atlas.getSeedDrop16(drop.itemId);
          const ss = Math.round(16 * z);
          if (seed16) {
            ctx.drawImage(seed16, sx - ss * 0.5, sy - ss * 0.5, ss, ss);
          }
          if (pickupBox) {
            const bs = Math.round(20 * z);
            ctx.drawImage(pickupBox, sx - bs * 0.5, sy - bs * 0.5, bs, bs);
          }
        } else {
          const block19 = this.atlas.getDropBlock19(drop.itemId);
          const is = Math.round(19 * z);
          const bs = Math.round(20 * z);
          if (block19) {
            ctx.drawImage(block19, sx - is * 0.5 + z * 0.5, sy - is * 0.5 + z * 0.5, is, is);
          }
          if (pickupBox) {
            ctx.drawImage(pickupBox, sx - bs * 0.5, sy - bs * 0.5, bs, bs);
          }
        }

        if (drop.count > 1) {
          const bs = Math.round(20 * z);
          ctx.font = `bold ${Math.max(10, Math.round(6.5 * z))}px ${GT_FONT}`;
          ctx.textAlign = 'right';
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = '#09121e';
          ctx.strokeText(`${drop.count}`, sx + bs * 0.44, sy + bs * 0.42);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(`${drop.count}`, sx + bs * 0.44, sy + bs * 0.42);
        }
      }
    }

    // 6. Hovered Tile Cursor & Placement Preview (using official tile_grid_overlay.png!)
    if (world.inBounds(hoveredTile.tx, hoveredTile.ty)) {
      const hsx = Math.round((hoveredTile.tx * TILE_SIZE - this.cameraX) * z);
      const hsy = Math.round((hoveredTile.ty * TILE_SIZE - this.cameraY) * z);
      const inReach = world.isWithinReach(localPlayer.x, localPlayer.y, hoveredTile.tx, hoveredTile.ty);
      const selDef = getItemDef(selectedItemId);
      const hTile = world.getTile(hoveredTile.tx, hoveredTile.ty);
      const gridOverlay = this.atlas.getSheet('tile_grid_overlay');

      if (inReach && selDef && selDef.category !== 'tool' && selDef.category !== 'clothing') {
        const ghost = this.atlas.getItemIcon(selectedItemId);
        if (ghost) {
          ctx.save();
          ctx.globalAlpha = 0.45;
          ctx.drawImage(ghost, hsx, hsy, ts, ts);
          ctx.restore();
        }
      }

      if (gridOverlay) {
        ctx.save();
        ctx.globalAlpha = inReach ? 0.92 : 0.35;
        // Cell [4] = yellow dashed Growtopia tile selector; Cell [1] = sky-blue placement frame
        const frameCell =
          inReach && selDef && selDef.category !== 'tool' && selDef.category !== 'clothing' ? 1 : 4;
        ctx.drawImage(gridOverlay, frameCell * 32, 0, 32, 32, hsx, hsy, ts, ts);

        // Wrench reticle [2] on interactive Sign/Door when Wrench selected
        if (
          inReach &&
          selectedItemId === ITEM_IDS.WRENCH &&
          (hTile?.fg === ITEM_IDS.SIGN || hTile?.fg === ITEM_IDS.DOOR)
        ) {
          ctx.drawImage(gridOverlay, 2 * 32, 0, 32, 32, hsx, hsy, ts, ts);
        }
        ctx.restore();
      } else {
        ctx.strokeStyle = inReach ? 'rgba(255, 238, 85, 0.9)' : 'rgba(255, 85, 85, 0.4)';
        ctx.lineWidth = 2;
        ctx.strokeRect(hsx + 1, hsy + 1, ts - 2, ts - 2);
      }

      // Tree growth timer or Small Lock 3x3 aura
      if (hTile && hTile.fg !== 0) {
        const hDef = getItemDef(hTile.fg);
        if (hDef?.category === 'seed') {
          const rem = this.seedSystem.getRemainingSeconds(hTile, nowMs);
          const label = rem <= 0 ? 'READY! Punch to Harvest' : `${hDef.name.replace(' Seed', ' Tree')} (${rem}s)`;
          this.drawOverheadPill(ctx, hsx + ts * 0.5, hsy - 8, label, rem <= 0 ? '#4ef55c' : '#ffee55');
        } else if (hTile.fg === ITEM_IDS.SMALL_LOCK) {
          ctx.strokeStyle = 'rgba(78, 245, 92, 0.65)';
          ctx.lineWidth = 2;
          ctx.strokeRect(hsx - ts, hsy - ts, ts * 3, ts * 3);
        }
      }
    }

    // 7. Remote Players + Local Player
    for (const rp of remotePlayers.values()) {
      this.drawPlayerEntity(ctx, rp, world.ownerId, z, nowMs, false);
    }
    this.drawPlayerEntity(ctx, localPlayer, world.ownerId, z, nowMs, true);

    // 8. Nearby Sign & Door Floating Text
    const pTileX = Math.floor((localPlayer.x + PLAYER_WIDTH * 0.5) / TILE_SIZE);
    const pTileY = Math.floor((localPlayer.y + PLAYER_HEIGHT * 0.5) / TILE_SIZE);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = pTileX + dx;
        const ty = pTileY + dy;
        const tile = world.getTile(tx, ty);
        if (!tile || tile.fg === 0) continue;
        const sx = Math.round(((tx + 0.5) * TILE_SIZE - this.cameraX) * z);
        const sy = Math.round((ty * TILE_SIZE - this.cameraY) * z);

        const bannerOffset =
          dx === 0 && localPlayer.chatBubble && localPlayer.chatBubble.expiresAt > nowMs
            ? 16 * z + 30
            : 16 * z;
        if (tile.fg === ITEM_IDS.SIGN && tile.meta?.label) {
          this.drawSignBanner(ctx, sx, sy - bannerOffset, tile.meta.label);
        } else if (tile.fg === ITEM_IDS.WHITE_DOOR && dx === 0 && dy === 0) {
          this.drawSignBanner(ctx, sx, sy - bannerOffset, '`2[EXIT] `wPress `9[W] `wto open World Map');
        } else if (tile.fg === ITEM_IDS.DOOR) {
          const dest = tile.meta?.targetWorld ? `Warp to ${tile.meta.targetWorld}` : 'Unlinked Door (Use Wrench)';
          const hint = dx === 0 && dy === 0 && tile.meta?.targetWorld ? ' \x609[Press W]' : '';
          this.drawSignBanner(ctx, sx, sy - bannerOffset, `\x606${tile.meta?.label || dest}${hint}`);
        }
      }
    }

    // 9. Particles & Floating Pickup/Damage Text
    for (const p of effects.particles) {
      const sx = Math.round((p.x - this.cameraX) * z);
      const sy = Math.round((p.y - this.cameraY) * z);
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(sx, sy, p.size * z * 0.75, p.size * z * 0.75);
    }
    ctx.globalAlpha = 1;

    for (const ft of effects.floatingTexts) {
      const sx = Math.round((ft.x - this.cameraX) * z);
      const sy = Math.round((ft.y - this.cameraY) * z);
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, (ft.life / ft.maxLife) * 1.4));
      ctx.font = `bold ${Math.round(8.5 * z)}px ${GT_FONT}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#09101a';
      ctx.strokeText(ft.text, sx, sy);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, sx, sy);
      ctx.restore();
    }
  }

  private drawPlayerEntity(
    ctx: CanvasRenderingContext2D,
    player: PlayerNetState,
    worldOwnerId: string | null,
    z: number,
    nowMs: number,
    isLocal: boolean
  ): void {
    const sx = (player.x - this.cameraX) * z;
    const sy = (player.y - this.cameraY) * z;

    this.atlas.drawCharacter(
      ctx,
      sx,
      sy,
      z,
      player.facing,
      player.anim,
      player.skinColor,
      player.equipped,
      nowMs,
      player.punchTarget,
      player.vx,
      player.vy
    );

    // Punch target reticle flash (official tile_grid_overlay fist [0]!)
    if (player.punchTarget && nowMs - player.punchTarget.at < 190) {
      const ptsx = Math.round((player.punchTarget.tx * TILE_SIZE - this.cameraX) * z);
      const ptsy = Math.round((player.punchTarget.ty * TILE_SIZE - this.cameraY) * z);
      const gridOverlay = this.atlas.getSheet('tile_grid_overlay');
      if (gridOverlay) {
        ctx.save();
        ctx.globalAlpha = 0.88;
        ctx.drawImage(gridOverlay, 0, 0, 32, 32, ptsx, ptsy, TILE_SIZE * z, TILE_SIZE * z);
        ctx.restore();
      }
    }

    // Overhead Nameplate in authentic Century Gothic Bold!
    const nameX = Math.round(sx + PLAYER_WIDTH * 0.5 * z);
    const nameY = Math.round(sy - 11 * z);
    const isOwner = !!worldOwnerId && player.id === worldOwnerId;
    const nameColor = isOwner ? '#4ef55c' : isLocal ? '#ffffff' : '#e6f6ff';
    const displayTag = player.username;

    ctx.font = `bold ${Math.max(13, Math.round(7.5 * z))}px ${GT_FONT}`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(5, 10, 18, 0.95)';
    ctx.strokeText(displayTag, nameX, nameY);
    ctx.fillStyle = nameColor;
    ctx.fillText(displayTag, nameX, nameY);

    // Overhead Speech Bubble
    if (player.chatBubble && player.chatBubble.expiresAt > nowMs) {
      this.drawSpeechBubble(ctx, nameX, nameY - 18, player.chatBubble.text);
    }
  }

  private drawOverheadPill(
    ctx: CanvasRenderingContext2D,
    cx: number,
    bottomY: number,
    text: string,
    color: string
  ): void {
    ctx.font = `bold 13px ${GT_FONT}`;
    const padX = 10;
    const tw = ctx.measureText(text).width;
    const bw = tw + padX * 2;
    const bh = 24;
    const bx = Math.round(cx - bw * 0.5);
    const by = Math.round(bottomY - bh);

    ctx.fillStyle = 'rgba(14, 34, 58, 0.88)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#6ecbff';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);

    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, Math.round(cx), by + 16);
  }

  private drawSignBanner(ctx: CanvasRenderingContext2D, cx: number, bottomY: number, rawText: string): void {
    const segments = ChatManager.parseColoredText(rawText, '#ffffff');
    const plain = ChatManager.stripColorCodes(rawText);
    ctx.font = `bold 14px ${GT_FONT}`;
    const padX = 11;
    const tw = ctx.measureText(plain).width;
    const bw = tw + padX * 2;
    const bh = 26;
    const bx = Math.max(8, Math.min(this.canvas.width - bw - 8, Math.round(cx - bw * 0.5)));
    const by = Math.max(8, Math.round(bottomY - bh));

    ctx.fillStyle = 'rgba(15, 36, 62, 0.88)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#7cd4ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);

    let cursorX = bx + padX;
    ctx.textAlign = 'left';
    for (const seg of segments) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(seg.text, cursorX, by + 18);
      ctx.fillStyle = seg.color;
      ctx.fillText(seg.text, cursorX, by + 18);
      cursorX += ctx.measureText(seg.text).width;
    }
  }

  private drawSpeechBubble(ctx: CanvasRenderingContext2D, cx: number, bottomY: number, rawText: string): void {
    const segments = ChatManager.parseColoredText(rawText, '#111822');
    const plain = ChatManager.stripColorCodes(rawText);
    ctx.font = `bold 13px ${GT_FONT}`;
    const padX = 10;
    const tw = Math.min(380, ctx.measureText(plain).width);
    const bw = tw + padX * 2;
    const bh = 26;
    const bx = Math.max(6, Math.min(this.canvas.width - bw - 6, Math.round(cx - bw * 0.5)));
    const by = Math.max(6, Math.round(bottomY - bh));

    // Authentic Growtopia crisp white speech bubble with solid dark outline!
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(bx + 2, by + 2, bw, bh);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#182433';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(bx, by, bw, bh);

    // Bubble pointer tail
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 3, by + bh - 1, 6, 4);

    let cursorX = bx + padX;
    ctx.textAlign = 'left';
    for (const seg of segments) {
      ctx.fillStyle = seg.color === '#ffffff' ? '#111822' : seg.color === '#ffee55' ? '#a37700' : seg.color;
      ctx.fillText(seg.text, cursorX, by + 18);
      cursorX += ctx.measureText(seg.text).width;
    }
  }
}
