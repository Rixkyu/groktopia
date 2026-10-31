import { TILE_SIZE } from '../../shared/constants';
import { getAllItems, getItemDef, ITEM_IDS } from '../../shared/ItemRegistry';
import { EquippedItems, ItemDefinition, PlayerAnimState } from '../../shared/types';

// Exact 8-bit neighbor lookup table from Growtopia (spreadType = 2, 8x6 block sheet)
const LUT_8BIT: Uint8Array = (() => {
  const lut = new Uint8Array(256);
  const map: Record<number, number> = {
    0: 12,
    2: 11,
    8: 30,
    10: 44,
    11: 8,
    16: 29,
    18: 43,
    22: 7,
    24: 28,
    26: 42,
    27: 41,
    30: 40,
    31: 2,
    64: 10,
    66: 9,
    72: 46,
    74: 36,
    75: 35,
    80: 45,
    82: 33,
    86: 32,
    88: 39,
    90: 27,
    91: 23,
    94: 24,
    95: 18,
    104: 6,
    106: 34,
    107: 4,
    120: 38,
    122: 25,
    123: 20,
    126: 21,
    127: 16,
    208: 5,
    210: 31,
    214: 3,
    216: 37,
    218: 26,
    219: 22,
    222: 19,
    223: 15,
    248: 1,
    250: 17,
    251: 14,
    254: 13,
  };
  for (let i = 0; i < 256; i++) {
    lut[i] = map[i] ?? 0;
  }
  return lut;
})();

// Exact 4-bit neighbor lookup table from Growtopia (spreadType = 5, 8x2 lava sheet)
const LUT_4BIT = new Uint8Array([12, 11, 15, 8, 14, 7, 13, 2, 10, 9, 6, 4, 5, 3, 1, 0]);

export type SheetKey =
  | 'tiles_page1'
  | 'tiles_page2'
  | 'tiles_page3'
  | 'tiles_page4'
  | 'tiles_page5'
  | 'tiles_page6'
  | 'tiles_page7'
  | 'tiles_page8'
  | 'tiles_page9'
  | 'tiles_page10'
  | 'tiles_page11'
  | 'tiles_page12'
  | 'seed'
  | 'particles'
  | 'particles2'
  | 'pickup_box'
  | 'tile_grid_overlay'
  | 'sun'
  | 'moon'
  | 'stars'
  | 'cloud'
  | 'hills1'
  | 'hills2'
  | 'hills3'
  | 'desert_sky'
  | 'desert_hills2'
  | 'bg_EC_sky'
  | 'city_sky'
  | 'city_skyline'
  | 'city2_skyline'
  | 'arid_weather'
  | 'night_weather'
  | 'player_head'
  | 'player_eyes'
  | 'player_feet'
  | 'player_feet2'
  | 'player_feet3'
  | 'player_pants'
  | 'player_pants2'
  | 'player_pants3'
  | 'player_shirt'
  | 'player_shirt2'
  | 'player_shirt3'
  | 'player_arm'
  | 'player_arm2'
  | 'player_puncharm'
  | 'player_hair'
  | 'player_hair3'
  | 'player_hair4'
  | 'player_hair5'
  | 'player_hair3_icon'
  | 'player_hair4_icon'
  | 'player_faceitem'
  | 'player_faceitem2'
  | 'player_faceitem3'
  | 'player_faceitem4'
  | 'player_back'
  | 'player_back2'
  | 'player_back3'
  | 'player_handitem'
  | 'player_handitem2'
  | 'player_handitem3'
  | 'player_handitem4'
  | 'player_handitem_icon';

const ASSET_URLS: Record<SheetKey, string> = {
  tiles_page1: '/assets/gt/game/tiles_page1.png',
  tiles_page2: '/assets/gt/game/tiles_page2.png',
  tiles_page3: '/assets/gt/game/tiles_page3.png',
  tiles_page4: '/assets/gt/game/tiles_page4.png',
  tiles_page5: '/assets/gt/game/tiles_page5.png',
  tiles_page6: '/assets/gt/game/tiles_page6.png',
  tiles_page7: '/assets/gt/game/tiles_page7.png',
  tiles_page8: '/assets/gt/game/tiles_page8.png',
  tiles_page9: '/assets/gt/game/tiles_page9.png',
  tiles_page10: '/assets/gt/game/tiles_page10.png',
  tiles_page11: '/assets/gt/game/tiles_page11.png',
  tiles_page12: '/assets/gt/game/tiles_page12.png',
  seed: '/assets/gt/game/seed.png',
  particles: '/assets/gt/game/particles.png',
  particles2: '/assets/gt/game/particles2.png',
  pickup_box: '/assets/gt/game/pickup_box.png',
  tile_grid_overlay: '/assets/gt/game/tile_grid_overlay.png',
  sun: '/assets/gt/game/sun.png',
  moon: '/assets/gt/game/moon.png',
  stars: '/assets/gt/game/stars.png',
  cloud: '/assets/gt/game/cloud.png',
  hills1: '/assets/gt/game/hills1.png',
  hills2: '/assets/gt/game/hills2.png',
  hills3: '/assets/gt/game/hills3.png',
  desert_sky: '/assets/gt/game/desert_sky.png',
  desert_hills2: '/assets/gt/game/desert_hills2.png',
  bg_EC_sky: '/assets/gt/game/bg_EC_sky.png',
  city_sky: '/assets/gt/game/city_sky.png',
  city_skyline: '/assets/gt/game/city_skyline.png',
  city2_skyline: '/assets/gt/game/city2_skyline.png',
  arid_weather: '/assets/gt/weather/arid_weather.png',
  night_weather: '/assets/gt/weather/night_weather.png',
  player_head: '/assets/gt/game/player_head.png',
  player_eyes: '/assets/gt/game/player_eyes.png',
  player_feet: '/assets/gt/game/player_feet.png',
  player_feet2: '/assets/gt/game/player_feet2.png',
  player_feet3: '/assets/gt/game/player_feet3.png',
  player_pants: '/assets/gt/game/player_pants.png',
  player_pants2: '/assets/gt/game/player_pants2.png',
  player_pants3: '/assets/gt/game/player_pants3.png',
  player_shirt: '/assets/gt/game/player_shirt.png',
  player_shirt2: '/assets/gt/game/player_shirt2.png',
  player_shirt3: '/assets/gt/game/player_shirt3.png',
  player_arm: '/assets/gt/game/player_arm.png',
  player_arm2: '/assets/gt/game/player_arm2.png',
  player_puncharm: '/assets/gt/game/player_puncharm.png',
  player_hair: '/assets/gt/game/player_hair.png',
  player_hair3: '/assets/gt/game/player_hair3.png',
  player_hair4: '/assets/gt/game/player_hair4.png',
  player_hair5: '/assets/gt/game/player_hair5.png',
  player_hair3_icon: '/assets/gt/game/player_hair3_icon.png',
  player_hair4_icon: '/assets/gt/game/player_hair4_icon.png',
  player_faceitem: '/assets/gt/game/player_faceitem.png',
  player_faceitem2: '/assets/gt/game/player_faceitem2.png',
  player_faceitem3: '/assets/gt/game/player_faceitem3.png',
  player_faceitem4: '/assets/gt/game/player_faceitem4.png',
  player_back: '/assets/gt/game/player_back.png',
  player_back2: '/assets/gt/game/player_back2.png',
  player_back3: '/assets/gt/game/player_back3.png',
  player_handitem: '/assets/gt/game/player_handitem.png',
  player_handitem2: '/assets/gt/game/player_handitem2.png',
  player_handitem3: '/assets/gt/game/player_handitem3.png',
  player_handitem4: '/assets/gt/game/player_handitem4.png',
  player_handitem_icon: '/assets/gt/game/player_handitem_icon.png',
};

interface TileCoordMeta {
  sheet:
    | 'tiles_page1'
    | 'tiles_page2'
    | 'tiles_page3'
    | 'tiles_page4'
    | 'tiles_page5'
    | 'tiles_page6'
    | 'tiles_page7'
    | 'tiles_page8'
    | 'tiles_page9'
    | 'tiles_page10'
    | 'tiles_page11'
    | 'tiles_page12';
  tx: number;
  ty: number;
  spreadType: 1 | 2 | 3 | 4 | 5;
  defaultOx?: number;
  defaultOy?: number;
  animFrames?: number;
}

const TILE_COORDS: Record<number, TileCoordMeta> = {
  [ITEM_IDS.FIST]: { sheet: 'tiles_page1', tx: 11, ty: 1, spreadType: 1 },
  [ITEM_IDS.WRENCH]: { sheet: 'tiles_page1', tx: 31, ty: 1, spreadType: 1 },
  [ITEM_IDS.BEDROCK]: { sheet: 'tiles_page1', tx: 0, ty: 26, spreadType: 2, defaultOx: 4, defaultOy: 1 },
  [ITEM_IDS.WHITE_DOOR]: { sheet: 'tiles_page1', tx: 17, ty: 1, spreadType: 1 },
  [ITEM_IDS.DIRT]: { sheet: 'tiles_page1', tx: 8, ty: 20, spreadType: 2, defaultOx: 4, defaultOy: 1 },
  [ITEM_IDS.CAVE_BG]: { sheet: 'tiles_page1', tx: 24, ty: 26, spreadType: 2, defaultOx: 4, defaultOy: 1 },
  [ITEM_IDS.ROCK]: { sheet: 'tiles_page1', tx: 15, ty: 1, spreadType: 1 },
  [ITEM_IDS.LAVA]: { sheet: 'tiles_page1', tx: 4, ty: 6, spreadType: 5, defaultOx: 4, defaultOy: 1 },
  [ITEM_IDS.WOOD]: { sheet: 'tiles_page1', tx: 12, ty: 1, spreadType: 1 },
  [ITEM_IDS.GRASS]: { sheet: 'tiles_page1', tx: 8, ty: 20, spreadType: 2, defaultOx: 4, defaultOy: 1 },
  [ITEM_IDS.GLASS]: { sheet: 'tiles_page1', tx: 8, ty: 1, spreadType: 1 },
  [ITEM_IDS.WOOD_BG]: { sheet: 'tiles_page1', tx: 0, ty: 20, spreadType: 2, defaultOx: 4, defaultOy: 1 },
  [ITEM_IDS.PLATFORM]: { sheet: 'tiles_page1', tx: 0, ty: 8, spreadType: 3, defaultOx: 3, defaultOy: 0 },
  [ITEM_IDS.BRICK]: { sheet: 'tiles_page1', tx: 8, ty: 26, spreadType: 2, defaultOx: 4, defaultOy: 1 },
  [ITEM_IDS.SIGN]: { sheet: 'tiles_page1', tx: 21, ty: 0, spreadType: 1 },
  [ITEM_IDS.DOOR]: { sheet: 'tiles_page1', tx: 14, ty: 1, spreadType: 1 },
  [ITEM_IDS.TORCH]: { sheet: 'tiles_page1', tx: 21, ty: 9, spreadType: 1, animFrames: 2 },
  [ITEM_IDS.SUGAR_CANE]: { sheet: 'tiles_page2', tx: 16, ty: 2, spreadType: 3, defaultOx: 3, defaultOy: 0 },
  [ITEM_IDS.SPIKE]: { sheet: 'tiles_page1', tx: 25, ty: 0, spreadType: 4, defaultOx: 3, defaultOy: 0 },
  [ITEM_IDS.GOLD]: { sheet: 'tiles_page1', tx: 7, ty: 2, spreadType: 1 },
  [ITEM_IDS.CRYSTAL]: { sheet: 'tiles_page1', tx: 7, ty: 3, spreadType: 1 },
  [ITEM_IDS.CHANDELIER]: { sheet: 'tiles_page1', tx: 26, ty: 2, spreadType: 1, animFrames: 2 },
  [ITEM_IDS.BUMPER]: { sheet: 'tiles_page1', tx: 30, ty: 4, spreadType: 1 },
  [ITEM_IDS.MUSHROOM]: { sheet: 'tiles_page1', tx: 3, ty: 2, spreadType: 1 },
  [ITEM_IDS.SMALL_LOCK]: { sheet: 'tiles_page1', tx: 0, ty: 9, spreadType: 1 },
  [ITEM_IDS.WORLD_LOCK]: { sheet: 'tiles_page1', tx: 0, ty: 12, spreadType: 1 },
  [ITEM_IDS.WEATHER_NIGHT]: { sheet: 'tiles_page2', tx: 29, ty: 1, spreadType: 1 },
  [ITEM_IDS.WEATHER_RAIN]: { sheet: 'tiles_page2', tx: 29, ty: 4, spreadType: 1 },
  [ITEM_IDS.WEATHER_DESERT]: { sheet: 'tiles_page2', tx: 29, ty: 3, spreadType: 1 },
};

interface SeedSpriteMeta {
  seedBase: number;
  seedOverlay: number;
  baseHex: string;
  overlayHex: string;
  treeBase: number;
  treeLeaves: number;
  trunkHex: string;
  leafHex: string;
}

// Decoded directly from official Growtopia items.dat / items.json
const SEED_META: Record<number, SeedSpriteMeta> = {
  [ITEM_IDS.DIRT_SEED]: {
    seedBase: 1, seedOverlay: 2, baseHex: '#603913', overlayHex: '#a67c52',
    treeBase: 1, treeLeaves: 2, trunkHex: '#8c5a2b', leafHex: '#52b83a',
  },
  [ITEM_IDS.CAVE_BG_SEED]: {
    seedBase: 7, seedOverlay: 14, baseHex: '#3b2c1a', overlayHex: '#6e5227',
    treeBase: 7, treeLeaves: 6, trunkHex: '#5c4328', leafHex: '#6e593b',
  },
  [ITEM_IDS.ROCK_SEED]: {
    seedBase: 5, seedOverlay: 10, baseHex: '#808080', overlayHex: '#c8c8c8',
    treeBase: 5, treeLeaves: 2, trunkHex: '#7d7368', leafHex: '#9aa3ab',
  },
  [ITEM_IDS.LAVA_SEED]: {
    seedBase: 2, seedOverlay: 4, baseHex: '#ff2811', overlayHex: '#ffbb2a',
    treeBase: 2, treeLeaves: 4, trunkHex: '#802b19', leafHex: '#ff591c',
  },
  [ITEM_IDS.WOOD_SEED]: {
    seedBase: 2, seedOverlay: 4, baseHex: '#ae763a', overlayHex: '#f8c78e',
    treeBase: 2, treeLeaves: 4, trunkHex: '#a86f35', leafHex: '#5ec942',
  },
  [ITEM_IDS.GRASS_SEED]: {
    seedBase: 8, seedOverlay: 0, baseHex: '#499d2d', overlayHex: '#87d959',
    treeBase: 0, treeLeaves: 0, trunkHex: '#8f5d2e', leafHex: '#59d63b',
  },
  [ITEM_IDS.GLASS_SEED]: {
    seedBase: 12, seedOverlay: 8, baseHex: '#86d7ec', overlayHex: '#ffffff',
    treeBase: 4, treeLeaves: 0, trunkHex: '#9ac7d9', leafHex: '#bdf2ff',
  },
  [ITEM_IDS.WOOD_BG_SEED]: {
    seedBase: 10, seedOverlay: 4, baseHex: '#97724b', overlayHex: '#c99763',
    treeBase: 2, treeLeaves: 4, trunkHex: '#8a623c', leafHex: '#75b84f',
  },
  [ITEM_IDS.PLATFORM_SEED]: {
    seedBase: 3, seedOverlay: 6, baseHex: '#83531f', overlayHex: '#f6c289',
    treeBase: 3, treeLeaves: 6, trunkHex: '#996228', leafHex: '#bae053',
  },
  [ITEM_IDS.BRICK_SEED]: {
    seedBase: 10, seedOverlay: 4, baseHex: '#bf621e', overlayHex: '#e8531f',
    treeBase: 2, treeLeaves: 4, trunkHex: '#944d2b', leafHex: '#d95b38',
  },
  [ITEM_IDS.SIGN_SEED]: {
    seedBase: 10, seedOverlay: 4, baseHex: '#9d8d45', overlayHex: '#ccbd74',
    treeBase: 2, treeLeaves: 4, trunkHex: '#916836', leafHex: '#abd14b',
  },
  [ITEM_IDS.DOOR_SEED]: {
    seedBase: 6, seedOverlay: 12, baseHex: '#9a6b38', overlayHex: '#ffd11d',
    treeBase: 6, treeLeaves: 4, trunkHex: '#8c5a2b', leafHex: '#ebb838',
  },
  [ITEM_IDS.TORCH_SEED]: {
    seedBase: 12, seedOverlay: 8, baseHex: '#7f5635', overlayHex: '#ff2015',
    treeBase: 4, treeLeaves: 0, trunkHex: '#7a4d2b', leafHex: '#ff9c24',
  },
  [ITEM_IDS.SUGAR_CANE_SEED]: {
    seedBase: 13, seedOverlay: 10, baseHex: '#39f206', overlayHex: '#2ca00c',
    treeBase: 5, treeLeaves: 2, trunkHex: '#6ab82e', leafHex: '#5eff36',
  },
  [ITEM_IDS.SPIKE_SEED]: {
    seedBase: 1, seedOverlay: 2, baseHex: '#caddde', overlayHex: '#edf1f1',
    treeBase: 1, treeLeaves: 2, trunkHex: '#7d8791', leafHex: '#d4e6ed',
  },
  [ITEM_IDS.GOLD_SEED]: {
    seedBase: 2, seedOverlay: 4, baseHex: '#fff115', overlayHex: '#ffffff',
    treeBase: 2, treeLeaves: 4, trunkHex: '#bd8c1c', leafHex: '#ffe438',
  },
  [ITEM_IDS.CRYSTAL_SEED]: {
    seedBase: 3, seedOverlay: 6, baseHex: '#ffffff', overlayHex: '#38f5ff',
    treeBase: 3, treeLeaves: 6, trunkHex: '#639ab8', leafHex: '#63f7ff',
  },
  [ITEM_IDS.CHANDELIER_SEED]: {
    seedBase: 10, seedOverlay: 4, baseHex: '#ffe015', overlayHex: '#f1f1ed',
    treeBase: 2, treeLeaves: 4, trunkHex: '#ab8729', leafHex: '#fff078',
  },
  [ITEM_IDS.BUMPER_SEED]: {
    seedBase: 7, seedOverlay: 14, baseHex: '#ffe433', overlayHex: '#4ba7ff',
    treeBase: 7, treeLeaves: 6, trunkHex: '#9c3668', leafHex: '#47b8ff',
  },
  [ITEM_IDS.MUSHROOM_SEED]: {
    seedBase: 1, seedOverlay: 2, baseHex: '#e83838', overlayHex: '#fff0d9',
    treeBase: 1, treeLeaves: 2, trunkHex: '#d9cfb8', leafHex: '#f03a3a',
  },
};

function hasDomCanvas(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

function makeCanvas(w = TILE_SIZE, h = TILE_SIZE): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  if (Number.isNaN(num)) return { r: 255, g: 255, b: 255 };
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

function tintRegion(
  src: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  hexColor: string
): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(dw, dh);
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
  const { r, g, b } = hexToRgb(hexColor);
  const imgData = ctx.getImageData(0, 0, dw, dh);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) {
      data[i] = Math.min(255, Math.round((data[i] * r) / 255));
      data[i + 1] = Math.min(255, Math.round((data[i + 1] * g) / 255));
      data[i + 2] = Math.min(255, Math.round((data[i + 2] * b) / 255));
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return c;
}

function makeSilhouette(
  src: CanvasImageSource,
  w: number,
  h: number,
  alpha = 0.56
): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(w, h);
  ctx.drawImage(src, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

function isSoilConnected(itemId: number, neighborId: number): boolean {
  if (itemId === neighborId) return true;
  if (
    (itemId === ITEM_IDS.DIRT || itemId === ITEM_IDS.GRASS) &&
    (neighborId === ITEM_IDS.DIRT || neighborId === ITEM_IDS.GRASS)
  ) {
    return true;
  }
  return false;
}

export class SpriteAtlas {
  public isLoaded = false;

  private sheets = new Map<SheetKey, HTMLImageElement>();
  private tileCache = new Map<string, HTMLCanvasElement>();
  private tileShadowCache = new Map<string, HTMLCanvasElement>();
  private seed16Cache = new Map<number, HTMLCanvasElement>();
  private seed16ShadowCache = new Map<number, HTMLCanvasElement>();
  private treeSprites = new Map<string, HTMLCanvasElement>();
  private treeShadowSprites = new Map<string, HTMLCanvasElement>();
  private crackSprites: HTMLCanvasElement[] = [];
  private gemSprites = new Map<number, HTMLCanvasElement>();
  private gemShadowSprites = new Map<number, HTMLCanvasElement>();
  private itemIcons = new Map<number, HTMLCanvasElement>();
  private dropBlock19Cache = new Map<number, HTMLCanvasElement>();
  private dropBlock19ShadowCache = new Map<number, HTMLCanvasElement>();
  private pickupBox20: HTMLCanvasElement | null = null;
  private pickupBox20Shadow: HTMLCanvasElement | null = null;
  private iconDataUrls = new Map<number, string>();
  private gemDataUrls = new Map<number, string>();
  private skinPartCache = new Map<string, HTMLCanvasElement>();

  public init(): void {
    if (!hasDomCanvas()) return;
    this.rebuildCaches();
  }

  public async loadAssets(): Promise<void> {
    if (!hasDomCanvas() || typeof Image === 'undefined') return;

    const entries = Object.entries(ASSET_URLS) as Array<[SheetKey, string]>;
    await Promise.allSettled(
      entries.map(
        ([key, url]) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => {
              this.sheets.set(key, img);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = url;
          })
      )
    );

    this.isLoaded = this.sheets.size > 0;
    this.rebuildCaches();
  }

  public getSheet(key: SheetKey): HTMLImageElement | undefined {
    return this.sheets.get(key);
  }

  private clearCaches(): void {
    this.tileCache.clear();
    this.tileShadowCache.clear();
    this.seed16Cache.clear();
    this.seed16ShadowCache.clear();
    this.treeSprites.clear();
    this.treeShadowSprites.clear();
    this.crackSprites = [];
    this.gemSprites.clear();
    this.gemShadowSprites.clear();
    this.itemIcons.clear();
    this.dropBlock19Cache.clear();
    this.dropBlock19ShadowCache.clear();
    this.pickupBox20 = null;
    this.pickupBox20Shadow = null;
    this.iconDataUrls.clear();
    this.gemDataUrls.clear();
    this.skinPartCache.clear();
  }

  private rebuildCaches(): void {
    if (!hasDomCanvas()) return;
    this.clearCaches();

    // 1. Crack stages (0..3) from particles.png row 6 cols 15..12
    for (let s = 0; s < 4; s++) {
      this.crackSprites.push(this.buildCrackSprite(s));
    }

    // 2. Gems (1, 5, 10, 25/50, 100) from tiles_page1.png row 1 cols 22..26
    for (const val of [1, 5, 10, 25, 50, 100]) {
      const gem = this.buildGemSprite(val);
      this.gemSprites.set(val, gem);
      this.gemShadowSprites.set(val, makeSilhouette(gem, gem.width, gem.height));
    }

    // 3. Pickup box (0,0,20,20) from pickup_box.png
    const pBoxSheet = this.sheets.get('pickup_box');
    const [pb, pbCtx] = makeCanvas(20, 20);
    if (pBoxSheet) {
      pbCtx.drawImage(pBoxSheet, 0, 0, 20, 20, 0, 0, 20, 20);
    } else {
      pbCtx.fillStyle = 'rgba(18, 36, 62, 0.72)';
      pbCtx.fillRect(0, 0, 20, 20);
      pbCtx.strokeStyle = '#82e1ff';
      pbCtx.strokeRect(0.5, 0.5, 19, 19);
    }
    this.pickupBox20 = pb;
    this.pickupBox20Shadow = makeSilhouette(pb, 20, 20);

    // 4. Build all seeds, icons, and trees
    const allItems = getAllItems();
    for (const item of allItems) {
      if (item.category === 'seed') {
        const s16 = this.buildSeed16Sprite(item);
        this.seed16Cache.set(item.id, s16);
        this.seed16ShadowCache.set(item.id, makeSilhouette(s16, 16, 16));

        const [icon32, iconCtx] = makeCanvas(32, 32);
        iconCtx.drawImage(s16, 0, 0, 16, 16, 6, 6, 20, 20);
        this.itemIcons.set(item.id, icon32);
      } else if (item.category === 'tool' || item.category === 'clothing') {
        const icon = this.buildGearIcon(item);
        this.itemIcons.set(item.id, icon);
      } else {
        const meta = TILE_COORDS[item.id];
        const ox = meta?.defaultOx ?? 0;
        const oy = meta?.defaultOy ?? 0;
        const icon =
          item.id === ITEM_IDS.GRASS
            ? this.buildGrassItemIcon()
            : this.getAutotiledSprite(item.id, ox, oy, 0, true);
        this.itemIcons.set(item.id, icon);

        // Prebuild 19x19 world drop block icon + shadow
        const [d19, d19Ctx] = makeCanvas(19, 19);
        d19Ctx.drawImage(icon, 0, 0, 32, 32, 0, 0, 19, 19);
        this.dropBlock19Cache.set(item.id, d19);
        this.dropBlock19ShadowCache.set(item.id, makeSilhouette(d19, 19, 19));
      }
    }

    // Build tree stages AFTER block icons exist so stage 3 ripe trees can hang mini block fruits!
    for (const item of allItems) {
      if (item.category === 'seed') {
        for (let stage = 0; stage <= 3; stage++) {
          const tree = this.buildTreeSprite(item, stage);
          this.treeSprites.set(`${item.id}_${stage}`, tree);
          this.treeShadowSprites.set(`${item.id}_${stage}`, makeSilhouette(tree, 32, 32));
        }
      }
    }
  }

  public computeAutotileOffset(
    itemId: number,
    tx: number,
    ty: number,
    worldWidth: number,
    worldHeight: number,
    isBg: boolean,
    getTileItemAt: (nx: number, ny: number, bg: boolean) => number
  ): { ox: number; oy: number } {
    const meta = TILE_COORDS[itemId];
    if (!meta) return { ox: 0, oy: 0 };

    if (!isBg && (itemId === ITEM_IDS.SMALL_LOCK || itemId === ITEM_IDS.WORLD_LOCK)) {
      return { ox: 2, oy: 0 };
    }

    if (meta.spreadType === 2) {
      const dirs: Array<[number, number]> = [
        [-1, -1],
        [0, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [0, 1],
        [1, 1],
      ];
      let bit = 0;
      for (let i = 0; i < 8; i++) {
        const nx = tx + dirs[i][0];
        const ny = ty + dirs[i][1];
        const outX = nx < 0 || nx >= worldWidth;
        const outY = ny >= worldHeight;
        if (outX || outY) {
          bit |= 1 << i;
        } else if (ny >= 0) {
          const nId = getTileItemAt(nx, ny, isBg);
          if (isSoilConnected(itemId, nId)) {
            bit |= 1 << i;
          }
        }
      }
      if (!(bit & 8) || !(bit & 2)) bit &= ~1;
      if (!(bit & 16) || !(bit & 2)) bit &= ~4;
      if (!(bit & 8) || !(bit & 64)) bit &= ~32;
      if (!(bit & 16) || !(bit & 64)) bit &= ~128;

      const lutVal = LUT_8BIT[bit];
      return { ox: lutVal % 8, oy: Math.floor(lutVal / 8) };
    }

    if (meta.spreadType === 3) {
      const hasLeft = tx > 0 && getTileItemAt(tx - 1, ty, isBg) === itemId;
      const hasRight = tx < worldWidth - 1 && getTileItemAt(tx + 1, ty, isBg) === itemId;
      const ox = hasLeft && hasRight ? 1 : hasRight ? 0 : hasLeft ? 2 : 3;
      return { ox, oy: 0 };
    }

    if (meta.spreadType === 4) {
      // Spikes orient toward adjacent solid surface (prioritizing floor below -> ox = 3)
      const isSolidAt = (nx: number, ny: number): boolean => {
        if (nx < 0 || nx >= worldWidth || ny >= worldHeight) return true;
        if (ny < 0) return false;
        const nId = getTileItemAt(nx, ny, false);
        if (!nId || nId === itemId) return false;
        return getItemDef(nId)?.collision === 'solid';
      };
      if (isSolidAt(tx, ty + 1)) return { ox: 3, oy: 0 };
      if (isSolidAt(tx, ty - 1)) return { ox: 1, oy: 0 };
      if (isSolidAt(tx - 1, ty)) return { ox: 0, oy: 0 };
      if (isSolidAt(tx + 1, ty)) return { ox: 2, oy: 0 };
      return { ox: 4, oy: 0 };
    }

    if (meta.spreadType === 5) {
      const dirs: Array<[number, number]> = [
        [0, -1],
        [-1, 0],
        [1, 0],
        [0, 1],
      ];
      let bit = 0;
      for (let i = 0; i < 4; i++) {
        const nx = tx + dirs[i][0];
        const ny = ty + dirs[i][1];
        const outEdge = nx < 0 || nx >= worldWidth || ny >= worldHeight;
        if (outEdge || (ny >= 0 && getTileItemAt(nx, ny, isBg) === itemId)) {
          bit |= 1 << i;
        }
      }
      const lutVal = LUT_4BIT[bit];
      return { ox: lutVal % 8, oy: Math.floor(lutVal / 8) };
    }

    return { ox: 0, oy: 0 };
  }

  public getAutotiledSprite(
    itemId: number,
    ox = 0,
    oy = 0,
    animFrame = 0,
    forIcon = false,
    grassExposedTop = true
  ): HTMLCanvasElement {
    const meta = TILE_COORDS[itemId];
    const frame = meta?.animFrames ? animFrame % meta.animFrames : 0;
    const extraTag = itemId === ITEM_IDS.GRASS && !forIcon ? (grassExposedTop ? '_gt1' : '_gt0') : '';
    const key = `${itemId}_${ox}_${oy}_${frame}${forIcon ? '_ic' : ''}${extraTag}`;
    const existing = this.tileCache.get(key);
    if (existing) return existing;

    const [c, ctx] = makeCanvas(32, 32);
    const sheet = meta ? this.sheets.get(meta.sheet) : undefined;

    if (sheet && meta) {
      const finalOx = meta.animFrames ? ox + frame : ox;
      ctx.drawImage(
        sheet,
        (meta.tx + finalOx) * 32,
        (meta.ty + oy) * 32,
        32,
        32,
        0,
        0,
        32,
        32
      );

      // For solid Grass lawn tiles in START, layer lush Growtopia grass blades along exposed top!
      if (itemId === ITEM_IDS.GRASS && !forIcon && grassExposedTop) {
        const p1 = this.sheets.get('tiles_page1');
        if (p1) {
          ctx.drawImage(p1, 1 * 32, 6 * 32, 32, 14, 0, 0, 32, 14);
        }
      }
    } else {
      // Fallback procedural tile (used only before async PNG load completes)
      const def = getItemDef(itemId);
      ctx.fillStyle = def?.primaryColor ?? '#7a4d25';
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = def?.secondaryColor ?? '#48b83b';
      ctx.fillRect(2, 2, 28, 6);
    }

    this.tileCache.set(key, c);
    return c;
  }

  public getAutotiledShadow(
    itemId: number,
    ox = 0,
    oy = 0,
    animFrame = 0,
    grassExposedTop = true
  ): HTMLCanvasElement {
    const meta = TILE_COORDS[itemId];
    const frame = meta?.animFrames ? animFrame % meta.animFrames : 0;
    const extraTag = itemId === ITEM_IDS.GRASS ? (grassExposedTop ? '_gt1' : '_gt0') : '';
    const key = `${itemId}_${ox}_${oy}_${frame}${extraTag}`;
    const existing = this.tileShadowCache.get(key);
    if (existing) return existing;

    const sprite = this.getAutotiledSprite(itemId, ox, oy, frame, false, grassExposedTop);
    const shadow = makeSilhouette(sprite, 32, 32);
    this.tileShadowCache.set(key, shadow);
    return shadow;
  }

  public getTileSprite(itemId: number, animFrame = 0): HTMLCanvasElement | undefined {
    if (!hasDomCanvas()) return undefined;
    const meta = TILE_COORDS[itemId];
    const ox = meta?.defaultOx ?? 0;
    const oy = meta?.defaultOy ?? 0;
    return this.getAutotiledSprite(itemId, ox, oy, animFrame, false, true);
  }

  public getTreeSprite(seedId: number, stage: number): HTMLCanvasElement | undefined {
    return this.treeSprites.get(`${seedId}_${Math.max(0, Math.min(3, stage))}`);
  }

  public getTreeShadowSprite(seedId: number, stage: number): HTMLCanvasElement | undefined {
    return this.treeShadowSprites.get(`${seedId}_${Math.max(0, Math.min(3, stage))}`);
  }

  public getCrackSprite(stage: number): HTMLCanvasElement | undefined {
    return this.crackSprites[Math.max(0, Math.min(3, stage))];
  }

  public getGemSprite(value: number): HTMLCanvasElement {
    const key = value >= 100 ? 100 : value >= 50 ? 50 : value >= 25 ? 25 : value >= 10 ? 10 : value >= 5 ? 5 : 1;
    return this.gemSprites.get(key) ?? this.gemSprites.get(1)!;
  }

  public getGemShadowSprite(value: number): HTMLCanvasElement {
    const key = value >= 100 ? 100 : value >= 50 ? 50 : value >= 25 ? 25 : value >= 10 ? 10 : value >= 5 ? 5 : 1;
    return this.gemShadowSprites.get(key) ?? this.gemShadowSprites.get(1)!;
  }

  public getSeedDrop16(seedId: number): HTMLCanvasElement | undefined {
    return this.seed16Cache.get(seedId);
  }

  public getSeedDrop16Shadow(seedId: number): HTMLCanvasElement | undefined {
    return this.seed16ShadowCache.get(seedId);
  }

  public getDropBlock19(itemId: number): HTMLCanvasElement | undefined {
    if (this.dropBlock19Cache.has(itemId)) return this.dropBlock19Cache.get(itemId);
    const icon = this.getItemIcon(itemId);
    if (!icon) return undefined;
    const [d19, d19Ctx] = makeCanvas(19, 19);
    d19Ctx.drawImage(icon, 0, 0, 32, 32, 0, 0, 19, 19);
    this.dropBlock19Cache.set(itemId, d19);
    this.dropBlock19ShadowCache.set(itemId, makeSilhouette(d19, 19, 19));
    return d19;
  }

  public getDropBlock19Shadow(itemId: number): HTMLCanvasElement | undefined {
    if (!this.dropBlock19ShadowCache.has(itemId)) {
      this.getDropBlock19(itemId);
    }
    return this.dropBlock19ShadowCache.get(itemId);
  }

  public getPickupBox(): HTMLCanvasElement | null {
    return this.pickupBox20;
  }

  public getPickupBoxShadow(): HTMLCanvasElement | null {
    return this.pickupBox20Shadow;
  }

  public getItemIcon(itemId: number): HTMLCanvasElement | undefined {
    return this.itemIcons.get(itemId);
  }

  public getItemIconDataUrl(itemId: number): string {
    const cached = this.iconDataUrls.get(itemId);
    if (cached) return cached;
    const icon = this.getItemIcon(itemId);
    if (!icon) return '';
    const url = icon.toDataURL();
    this.iconDataUrls.set(itemId, url);
    return url;
  }

  public getGemDataUrl(value = 10): string {
    const cached = this.gemDataUrls.get(value);
    if (cached) return cached;
    const gem = this.getGemSprite(value);
    const url = gem.toDataURL();
    this.gemDataUrls.set(value, url);
    return url;
  }

  private buildGrassItemIcon(): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(32, 32);
    const p1 = this.sheets.get('tiles_page1');
    if (p1) {
      // Official Dirt isolated block + Grass tuft crown
      ctx.drawImage(p1, 12 * 32, 21 * 32, 32, 32, 0, 0, 32, 32);
      ctx.drawImage(p1, 3 * 32, 6 * 32, 32, 16, 0, 0, 32, 16);
    } else {
      px(ctx, 2, 2, 28, 28, '#7a4d25');
      px(ctx, 2, 2, 28, 9, '#48b83b');
    }
    return c;
  }

  private buildSeed16Sprite(seedItem: ItemDefinition): HTMLCanvasElement {
    const meta = SEED_META[seedItem.id];
    const seedSheet = this.sheets.get('seed');
    if (seedSheet && meta) {
      const [c, ctx] = makeCanvas(16, 16);
      const baseLayer = tintRegion(
        seedSheet,
        meta.seedBase * 16,
        0,
        16,
        16,
        16,
        16,
        meta.baseHex
      );
      const overlayLayer = tintRegion(
        seedSheet,
        meta.seedOverlay * 16,
        16,
        16,
        16,
        16,
        16,
        meta.overlayHex
      );
      ctx.drawImage(baseLayer, 0, 0);
      ctx.drawImage(overlayLayer, 0, 0);
      return c;
    }

    const [c, ctx] = makeCanvas(16, 16);
    px(ctx, 3, 2, 10, 12, '#1f1712');
    px(ctx, 4, 3, 8, 10, seedItem.primaryColor);
    px(ctx, 6, 5, 4, 4, seedItem.secondaryColor);
    return c;
  }

  private buildTreeSprite(seedItem: ItemDefinition, stage: number): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(32, 32);
    const meta = SEED_META[seedItem.id];
    const p2 = this.sheets.get('tiles_page2');
    const seed16 = this.seed16Cache.get(seedItem.id);

    if (stage === 0) {
      // Planted Growtopia seed sitting on ground
      if (seed16) {
        ctx.drawImage(seed16, 8, 16, 16, 16);
      } else {
        px(ctx, 12, 20, 8, 10, seedItem.primaryColor);
      }
      return c;
    }

    if (p2 && meta) {
      const trunkCanvas = tintRegion(
        p2,
        (8 + meta.treeBase) * 32,
        17 * 32,
        32,
        32,
        32,
        32,
        meta.trunkHex
      );
      const leavesCanvas = tintRegion(
        p2,
        (8 + meta.treeLeaves) * 32,
        16 * 32,
        32,
        32,
        32,
        32,
        meta.leafHex
      );

      if (stage === 1) {
        // Young sapling
        ctx.drawImage(trunkCanvas, 0, 0, 32, 32, 6, 11, 20, 21);
        ctx.drawImage(leavesCanvas, 0, 0, 32, 32, 5, 6, 22, 18);
        return c;
      }

      // Full Growtopia tree: trunk + vibrant foliage crown
      ctx.drawImage(trunkCanvas, 0, 2);
      ctx.drawImage(leavesCanvas, 0, -2);

      if (stage >= 3) {
        const fruitIcon = seedItem.blockId ? this.itemIcons.get(seedItem.blockId) : undefined;
        const spots: Array<[number, number]> = [
          [4, 8],
          [18, 7],
          [11, 3],
        ];
        for (const [fx, fy] of spots) {
          if (fruitIcon) {
            ctx.drawImage(fruitIcon, 0, 0, 32, 32, fx, fy, 10, 10);
          } else {
            px(ctx, fx, fy, 6, 6, seedItem.secondaryColor);
          }
        }
      }
      return c;
    }

    // Procedural fallback before assets finish loading
    px(ctx, 13, 12, 6, 18, '#75461f');
    px(ctx, 4, 3, 24, 13, seedItem.primaryColor);
    return c;
  }

  private buildCrackSprite(stage: number): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(32, 32);
    const particles = this.sheets.get('particles');
    if (particles) {
      // Official Growtopia block crack frames: row 6 (y=192), cols 15, 14, 13, 12
      const col = 15 - Math.max(0, Math.min(3, stage));
      ctx.drawImage(particles, col * 32, 6 * 32, 32, 32, 0, 0, 32, 32);
      return c;
    }
    ctx.fillStyle = 'rgba(15, 15, 20, 0.8)';
    ctx.fillRect(10 - stage * 2, 12, 12 + stage * 4, 3);
    return c;
  }

  private buildGemSprite(value: number): HTMLCanvasElement {
    const p1 = this.sheets.get('tiles_page1');
    if (p1) {
      const [c, ctx] = makeCanvas(24, 24);
      const col =
        value >= 100
          ? 26
          : value >= 25
          ? 25
          : value >= 10
          ? 24
          : value >= 5
          ? 23
          : 22;
      ctx.drawImage(p1, col * 32 + 4, 1 * 32 + 4, 24, 24, 0, 0, 24, 24);
      return c;
    }
    const [c, ctx] = makeCanvas(16, 16);
    px(ctx, 4, 3, 8, 10, '#ffd926');
    return c;
  }

  private buildGearIcon(item: ItemDefinition): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(32, 32);
    const p1 = this.sheets.get('tiles_page1');

    switch (item.id) {
      case ITEM_IDS.FIST: {
        if (p1) {
          ctx.drawImage(p1, 11 * 32, 1 * 32, 32, 32, 0, 0, 32, 32);
          return c;
        }
        px(ctx, 8, 10, 16, 12, '#f2b885');
        return c;
      }
      case ITEM_IDS.WRENCH: {
        if (p1) {
          ctx.drawImage(p1, 31 * 32, 1 * 32, 32, 32, 0, 0, 32, 32);
          return c;
        }
        px(ctx, 8, 8, 16, 16, '#b8cde0');
        return c;
      }
      case ITEM_IDS.PICKAXE: {
        const handIcon = this.sheets.get('player_handitem_icon');
        if (handIcon) {
          ctx.drawImage(handIcon, 4 * 32, 0, 32, 32, 0, 0, 32, 32);
          return c;
        }
        px(ctx, 10, 6, 14, 18, '#5fe3ff');
        return c;
      }
      case ITEM_IDS.ANGEL_WINGS: {
        const back = this.sheets.get('player_back');
        if (back) {
          ctx.drawImage(back, 0 * 32, 1 * 32, 32, 32, 0, -3, 32, 32);
          return c;
        }
        px(ctx, 4, 8, 24, 16, '#f5fbff');
        return c;
      }
      case ITEM_IDS.CRIMSON_WINGS: {
        const back = this.sheets.get('player_back');
        if (back) {
          ctx.drawImage(back, 3 * 32, 1 * 32, 32, 32, 0, -3, 32, 32);
          return c;
        }
        px(ctx, 4, 8, 24, 16, '#e62e4d');
        return c;
      }
      case ITEM_IDS.GOLD_CROWN: {
        const h3Icon = this.sheets.get('player_hair3_icon') ?? this.sheets.get('player_hair3');
        if (h3Icon) {
          ctx.drawImage(h3Icon, 4 * 32, 1 * 32, 32, 32, 0, 4, 32, 32);
          return c;
        }
        px(ctx, 4, 10, 24, 12, '#ffd429');
        return c;
      }
      case ITEM_IDS.HARDHAT: {
        const h4Icon = this.sheets.get('player_hair4_icon');
        if (h4Icon) {
          ctx.drawImage(h4Icon, 7 * 32, 2 * 32, 32, 32, 0, 2, 32, 32);
          return c;
        }
        px(ctx, 4, 10, 24, 12, '#ffb71b');
        return c;
      }
      case ITEM_IDS.SHADES: {
        const face = this.sheets.get('player_faceitem');
        if (face) {
          const head = this.sheets.get('player_head');
          if (head) {
            ctx.drawImage(head, 0, 0, 32, 16, 0, 8, 32, 16);
          }
          ctx.drawImage(face, 1 * 32, 0, 32, 16, 0, 8, 32, 16);
          return c;
        }
        px(ctx, 4, 12, 24, 8, '#1a1f2b');
        return c;
      }
    }
    return c;
  }

  private getTintedSkinPart(
    partKey: 'player_head' | 'player_arm' | 'player_puncharm',
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    skinHex: string
  ): HTMLCanvasElement | undefined {
    const sheet = this.sheets.get(partKey);
    if (!sheet) return undefined;
    const cacheKey = `${partKey}_${sx}_${sy}_${sw}_${sh}_${skinHex}`;
    const existing = this.skinPartCache.get(cacheKey);
    if (existing) return existing;
    const tinted = tintRegion(sheet, sx, sy, sw, sh, sw, sh, skinHex);
    this.skinPartCache.set(cacheKey, tinted);
    return tinted;
  }

  public drawCharacter(
    ctx: CanvasRenderingContext2D,
    screenX: number,
    screenY: number,
    scale: number,
    facing: -1 | 1,
    anim: PlayerAnimState,
    skinColor: string,
    equipped: EquippedItems,
    timeMs: number,
    punchTarget?: { tx: number; ty: number; at: number },
    vx = 0,
    vy = 0
  ): void {
    const headSheet = this.sheets.get('player_head');
    if (!headSheet) {
      // Fallback before PNG sheets finish decoding
      ctx.save();
      ctx.fillStyle = skinColor;
      ctx.fillRect(screenX + 2 * scale, screenY, 16 * scale, 27 * scale);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const p = Math.max(1, scale);
    // Anchor at bottom-center of 20x28 hitbox; 32x32 Growtopia character spans [-16..+16] x [-31..+1]
    const centerX = Math.round(screenX + 10 * p);
    const bottomY = Math.round(screenY + 28 * p);
    ctx.translate(centerX, bottomY);
    ctx.scale(facing, 1);

    // Dynamic state determination: supports punching while walking or jumping
    const punchElapsed = punchTarget ? timeMs - punchTarget.at : -1;
    const isPunching = anim === 'punch' || (punchElapsed >= 0 && punchElapsed < 220);
    const punchProgress =
      punchElapsed >= 0 && punchElapsed < 220
        ? punchElapsed / 220
        : anim === 'punch'
        ? Math.sin(timeMs * 0.02) * 0.5 + 0.5
        : 0;

    const isMoving = anim === 'walk' || Math.abs(vx) > 15;
    const isInAir = anim === 'jump' || anim === 'fall' || (!isMoving && Math.abs(vy) > 35);

    // Authentic Growtopia walk stride: 360ms period with snappy bounce & foot clearance
    const walkPhase = timeMs * 0.0175;
    const walkSin = isMoving ? Math.sin(walkPhase) : 0;
    const legSwing = isMoving
      ? walkSin * 4.2
      : isInAir
      ? (vy < 0 || anim === 'jump' ? 2.5 : -1.8)
      : 0;
    const frontFootLift = isMoving ? Math.max(0, walkSin) * 2.2 : isInAir ? 1.5 : 0;
    const backFootLift = isMoving ? Math.max(0, -walkSin) * 2.2 : isInAir ? 1.5 : 0;

    // Authentic step bounce (1.5px dip and pop on every step)
    const danceBob = anim === 'dance' ? Math.abs(Math.sin(timeMs * 0.016)) * 2.5 : 0;
    const bodyBob = (isMoving ? Math.abs(walkSin) * 1.5 : 0) + danceBob;

    // Natural arm counter-swing during walk
    const armSwing = isMoving ? -walkSin * 3.0 : isInAir ? -1.5 : 0;

    // Slight forward torso lean at peak punch thrust
    const upperLeanX = (isPunching && punchProgress >= 0.2 && punchProgress < 0.75 ? 1.5 : 0) * p;
    const originX = -16 * p + upperLeanX;
    const originY = (-31 - bodyBob) * p;
    const effectiveSkin = anim === 'hurt' && Math.floor(timeMs / 65) % 2 === 0 ? '#ff6b6b' : skinColor;

    // 1. Back Item (Angel Wings / Crimson Eagle Wings from player_back.png)
    const backSheet = this.sheets.get('player_back');
    if (backSheet && (equipped.back === ITEM_IDS.ANGEL_WINGS || equipped.back === ITEM_IDS.CRIMSON_WINGS)) {
      const flapFrame =
        anim === 'jump' || anim === 'fall' || isInAir
          ? Math.floor(timeMs / 110) % 2
          : Math.floor(timeMs / 420) % 2;
      const baseTx = equipped.back === ITEM_IDS.ANGEL_WINGS ? 0 : 3;
      ctx.drawImage(
        backSheet,
        (baseTx + flapFrame) * 32,
        1 * 32,
        32,
        32,
        (-23) * p,
        (-33 - bodyBob) * p,
        32 * p,
        32 * p
      );
    }

    // 2. Back Arm (tinted player_arm.png 6x10)
    const armSprite = this.getTintedSkinPart('player_arm', 0, 0, 6, 10, effectiveSkin);
    if (armSprite) {
      ctx.drawImage(
        armSprite,
        0,
        0,
        6,
        10,
        (5 - armSwing * 0.8) * p,
        (-15 - bodyBob) * p,
        6 * p,
        10 * p
      );
    }

    // 3. Feet / Shoes (Brown Shoes from player_feet.png (1,0), two animated feet!)
    const feetSheet = this.sheets.get('player_feet');
    if (feetSheet) {
      // Back foot (shifted right/inward)
      ctx.drawImage(
        feetSheet,
        1 * 32,
        0,
        32,
        32,
        (-8 - legSwing) * p,
        (-31 - backFootLift) * p,
        32 * p,
        32 * p
      );
      // Front foot (outer)
      ctx.drawImage(
        feetSheet,
        1 * 32,
        0,
        32,
        32,
        (-16 + legSwing) * p,
        (-31 - frontFootLift) * p,
        32 * p,
        32 * p
      );
    }

    // 4. Pants (Classic Growtopia Jeans from player_pants.png (1,0))
    const pantsSheet = this.sheets.get('player_pants');
    if (pantsSheet) {
      const pantsX = originX + (isMoving ? walkSin * 0.5 * p : 0);
      ctx.drawImage(pantsSheet, 1 * 32, 0, 32, 32, pantsX, (-31 - bodyBob * 0.5) * p, 32 * p, 32 * p);
    }

    // 5. Shirt (Classic Growtopia Green Shirt from player_shirt.png (1,0))
    const shirtSheet = this.sheets.get('player_shirt');
    if (shirtSheet) {
      ctx.drawImage(shirtSheet, 1 * 32, 0, 32, 32, originX, originY, 32 * p, 32 * p);
    }

    // 6. Big Iconic Growtopia Head (player_head.png 32x16 row 0 tinted by skinColor)
    // Frame 2 = grimace punch face, Frame 3 = hurt, Frame 1 = happy/dance, Frame 0 = idle/walk
    const headFrame = isPunching ? 2 : anim === 'hurt' ? 3 : anim === 'dance' || anim === 'wave' ? 1 : 0;
    const headSprite = this.getTintedSkinPart('player_head', headFrame * 32, 0, 32, 16, effectiveSkin);
    if (headSprite) {
      ctx.drawImage(headSprite, 0, 0, 32, 16, originX, originY, 32 * p, 16 * p);
    }

    // 7. Eyes (player_eyes.png (0,0) with natural blink & punch intensity)
    const eyesSheet = this.sheets.get('player_eyes');
    const isBlinking = timeMs % 3900 < 115;
    if (eyesSheet && !isBlinking) {
      const eyeFrame = isPunching || anim === 'hurt' ? 1 : 0;
      ctx.drawImage(eyesSheet, eyeFrame * 32, 0, 32, 16, originX, originY, 32 * p, 16 * p);
    }

    // 8. Face Item (Shades from player_faceitem.png (1,0))
    const faceSheet = this.sheets.get('player_faceitem');
    if (faceSheet && equipped.face === ITEM_IDS.SHADES) {
      ctx.drawImage(faceSheet, 1 * 32, 0, 32, 16, originX, originY, 32 * p, 16 * p);
    }

    // 9. Hair or Equipped Hat (drawn at originY - 16*p to align 32x32 hat/hair sheet with head!)
    const hatY = originY - 16 * p;
    if (equipped.hat === ITEM_IDS.GOLD_CROWN) {
      const h3 = this.sheets.get('player_hair3');
      if (h3) {
        ctx.drawImage(h3, 4 * 32, 1 * 32, 32, 32, originX, hatY + 2 * p, 32 * p, 32 * p);
      }
    } else if (equipped.hat === ITEM_IDS.HARDHAT) {
      const h4 = this.sheets.get('player_hair4');
      if (h4) {
        ctx.drawImage(h4, 7 * 32, 2 * 32, 32, 32, originX, hatY + 2 * p, 32 * p, 32 * p);
      }
    } else {
      // Classic default spiky brown Growtopia hair (player_hair.png (0,3))
      const hair = this.sheets.get('player_hair');
      if (hair) {
        ctx.drawImage(hair, 0 * 32, 3 * 32, 32, 32, originX, hatY + 1 * p, 32 * p, 32 * p);
      }
    }

    // 10. Front Arm / Authentic Growtopia 5-Frame Punch Fist + Hand Item (Pickaxe)
    const handSheet = this.sheets.get('player_handitem');
    if (isPunching) {
      let punchFrameCol = 0;
      let punchThrust = 0;
      if (punchProgress < 0.2) {
        punchFrameCol = 0;
        punchThrust = 0;
      } else if (punchProgress < 0.45) {
        punchFrameCol = 1;
        punchThrust = 2;
      } else if (punchProgress < 0.75) {
        punchFrameCol = 2; // Peak punch extension
        punchThrust = 4;
      } else {
        punchFrameCol = 4; // Follow-through
        punchThrust = 1;
      }

      const punchSprite = this.getTintedSkinPart('player_puncharm', punchFrameCol * 40, 0, 40, 24, effectiveSkin);
      if (punchSprite) {
        ctx.drawImage(
          punchSprite,
          0,
          0,
          40,
          24,
          (-18 + punchThrust + upperLeanX / p) * p,
          (-15 - bodyBob) * p,
          40 * p,
          24 * p
        );
      }

      if (handSheet && equipped.hand === ITEM_IDS.PICKAXE) {
        ctx.save();
        const pivotX = (-10 + punchThrust * 1.5 + upperLeanX / p) * p;
        const pivotY = (-13 - bodyBob) * p;
        ctx.translate(pivotX, pivotY);

        let toolAngle = 0;
        if (punchProgress < 0.2) {
          toolAngle = -0.3; // windup back ~ -17 deg
        } else if (punchProgress < 0.45) {
          toolAngle = 0.2; // swing forward
        } else if (punchProgress < 0.75) {
          toolAngle = 0.75; // full strike impact down-forward ~ 43 deg
        } else {
          toolAngle = 0.1; // return
        }
        ctx.rotate(toolAngle);
        ctx.drawImage(
          handSheet,
          4 * 32,
          0,
          32,
          32,
          -12 * p,
          -14 * p,
          32 * p,
          32 * p
        );
        ctx.restore();
      }
    } else if (anim === 'wave') {
      const waveY = Math.sin(timeMs * 0.025) * 2.5;
      if (armSprite) {
        ctx.save();
        ctx.translate(-7 * p, (-16 + waveY - bodyBob) * p);
        ctx.rotate(-2.4);
        ctx.drawImage(armSprite, 0, 0, 6, 10, -3 * p, 0, 6 * p, 10 * p);
        ctx.restore();
      }
    } else {
      if (armSprite) {
        ctx.drawImage(
          armSprite,
          0,
          0,
          6,
          10,
          (-11 + armSwing) * p,
          (-15 - bodyBob) * p,
          6 * p,
          10 * p
        );
      }
      if (handSheet && equipped.hand === ITEM_IDS.PICKAXE) {
        ctx.drawImage(
          handSheet,
          4 * 32,
          0,
          32,
          32,
          (-13 + armSwing * 0.4) * p,
          (-22 - bodyBob) * p,
          32 * p,
          32 * p
        );
      }
    }

    ctx.restore();
  }
}
