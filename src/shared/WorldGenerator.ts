import {
  BEDROCK_START_Y,
  DIRT_START_Y,
  SURFACE_Y,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './constants';
import { ITEM_IDS } from './ItemRegistry';
import { TileData, WeatherType } from './types';

function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GeneratedWorldData {
  name: string;
  width: number;
  height: number;
  weather: WeatherType;
  spawnX: number;
  spawnY: number;
  tiles: TileData[];
}

export function generateWorld(rawName: string): GeneratedWorldData {
  const name = rawName.toUpperCase().trim() || 'START';
  const rng = mulberry32(hashString(name));

  const tiles: TileData[] = new Array(WORLD_WIDTH * WORLD_HEIGHT);
  for (let i = 0; i < tiles.length; i++) {
    tiles[i] = { fg: 0, bg: 0 };
  }

  const idx = (x: number, y: number) => y * WORLD_WIDTH + x;

  // Choose weather flavor for themed world names, default sunny
  let weather: WeatherType = 'sunny';
  if (name.includes('NIGHT') || name.includes('MOON') || name.includes('SPACE')) {
    weather = 'night';
  } else if (name.includes('RAIN') || name.includes('STORM')) {
    weather = 'rain';
  } else if (name.includes('DESERT') || name.includes('SAND')) {
    weather = 'desert';
  }

  // Spawn X near middle (35..65), exact 50 for START
  const spawnX = name === 'START' ? 50 : 32 + Math.floor(rng() * 36);
  const spawnY = SURFACE_Y;

  // Fill Dirt + Cave Background (Y = 37..53) and Bedrock (Y = 54..59)
  for (let y = DIRT_START_Y; y < WORLD_HEIGHT; y++) {
    for (let x = 0; x < WORLD_WIDTH; x++) {
      const tile = tiles[idx(x, y)];
      tile.bg = ITEM_IDS.CAVE_BG;
      if (y >= BEDROCK_START_Y) {
        tile.fg = ITEM_IDS.BEDROCK;
      } else {
        tile.fg = ITEM_IDS.DIRT;
      }
    }
  }

  // Scatter Rock veins (Y = 39..52)
  const rockClusters = 42 + Math.floor(rng() * 14);
  for (let c = 0; c < rockClusters; c++) {
    const cx = 2 + Math.floor(rng() * (WORLD_WIDTH - 4));
    const cy = 39 + Math.floor(rng() * 13);
    const blobs = 2 + Math.floor(rng() * 4);
    for (let b = 0; b < blobs; b++) {
      const rx = cx + Math.floor(rng() * 3) - 1;
      const ry = cy + Math.floor(rng() * 3) - 1;
      if (rx >= 0 && rx < WORLD_WIDTH && ry >= 38 && ry < BEDROCK_START_Y) {
        tiles[idx(rx, ry)].fg = ITEM_IDS.ROCK;
      }
    }
  }

  // Scatter Lava pockets deep underground (Y = 48..53)
  const lavaClusters = 18 + Math.floor(rng() * 10);
  for (let c = 0; c < lavaClusters; c++) {
    const lx = 2 + Math.floor(rng() * (WORLD_WIDTH - 4));
    const ly = 48 + Math.floor(rng() * 6);
    if (ly < BEDROCK_START_Y) {
      tiles[idx(lx, ly)].fg = ITEM_IDS.LAVA;
      if (lx + 1 < WORLD_WIDTH && rng() < 0.55) {
        tiles[idx(lx + 1, ly)].fg = ITEM_IDS.LAVA;
      }
    }
  }

  // Place iconic Growtopia White Door + Bedrock pedestal at spawn
  tiles[idx(spawnX, spawnY)] = {
    fg: ITEM_IDS.WHITE_DOOR,
    bg: 0,
    meta: { label: 'EXIT' },
  };
  tiles[idx(spawnX, spawnY + 1)] = {
    fg: ITEM_IDS.BEDROCK,
    bg: ITEM_IDS.CAVE_BG,
  };

  // Give START world a welcoming landmark plaza (still leaves 90% natural terrain to mine & build!)
  if (name === 'START') {
    for (let dx = -5; dx <= 5; dx++) {
      const px = spawnX + dx;
      if (dx !== 0) {
        tiles[idx(px, SURFACE_Y + 1)].fg = ITEM_IDS.GRASS;
      }
    }
    // Welcome sign next to White Door
    tiles[idx(spawnX + 2, SURFACE_Y)] = {
      fg: ITEM_IDS.SIGN,
      bg: 0,
      meta: {
        label: '`2Welcome to GrokTopia! `wPunch Dirt & Lava to farm Seeds & Gems!',
      },
    };
    // Splicing tip sign on left
    tiles[idx(spawnX - 2, SURFACE_Y)] = {
      fg: ITEM_IDS.SIGN,
      bg: 0,
      meta: {
        label: '`6Tip: `wPlant `2Dirt Seed `w+ `4Lava Seed `won same tile to splice `6Wood`w!',
      },
    };
    // Warm torches flanking plaza
    tiles[idx(spawnX - 4, SURFACE_Y)] = { fg: ITEM_IDS.TORCH, bg: 0 };
    tiles[idx(spawnX + 4, SURFACE_Y)] = { fg: ITEM_IDS.TORCH, bg: 0 };
    // Small wooden platform hop above plaza with a warp door to PARKOUR
    for (let dx = -2; dx <= 2; dx++) {
      tiles[idx(spawnX + dx, SURFACE_Y - 3)] = {
        fg: ITEM_IDS.PLATFORM,
        bg: ITEM_IDS.WOOD_BG,
      };
    }
    tiles[idx(spawnX, SURFACE_Y - 4)] = {
      fg: ITEM_IDS.DOOR,
      bg: ITEM_IDS.WOOD_BG,
      meta: {
        label: 'To: FARM',
        targetWorld: 'FARM',
      },
    };
  } else if (name === 'PARKOUR') {
    // Fun parkour obstacle course above ground while keeping underground mineable!
    for (let step = 1; step <= 8; step++) {
      const px = spawnX + step * 4;
      const py = SURFACE_Y - step * 2;
      if (px < WORLD_WIDTH - 4 && py > 6) {
        tiles[idx(px, py)].fg = step % 3 === 0 ? ITEM_IDS.BUMPER : ITEM_IDS.PLATFORM;
        if (step % 2 === 0 && px + 1 < WORLD_WIDTH - 2) {
          tiles[idx(px + 1, SURFACE_Y)].fg = ITEM_IDS.SPIKE;
        }
      }
    }
    tiles[idx(spawnX + 2, SURFACE_Y)] = {
      fg: ITEM_IDS.SIGN,
      bg: 0,
      meta: { label: '`bPARKOUR CHALLENGE! `wWatch out for Spikes & hit Bumpers!' },
    };
  }

  return {
    name,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    weather,
    spawnX,
    spawnY,
    tiles,
  };
}
