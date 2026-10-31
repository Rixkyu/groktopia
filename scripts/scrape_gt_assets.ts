import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = path.resolve(__dirname, '../public/assets/gt');
const CDN_BASE = 'https://ubistatic-a.akamaihd.net/0098/040220269/cache/';

// Precomputed CRC32 table for PNG chunks
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodeRgbaToPng(width: number, height: number, rgba: Uint8Array): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 6; // color type 6 = RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const rawScanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    rawScanlines[rowStart] = 0; // filter type 0 (None)
    const srcOffset = y * stride;
    rawScanlines.set(rgba.subarray(srcOffset, srcOffset + stride), rowStart + 1);
  }

  const compressed = zlib.deflateSync(rawScanlines, { level: 6 });

  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface UnpackedTextureMeta {
  outRel: string;
  srcPath: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  format: number;
  usesAlpha: boolean;
}

function unpackRttex(rawBuf: Buffer): {
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  format: number;
  usesAlpha: boolean;
  pngBuffer: Buffer;
} {
  let buf = rawBuf;
  const magic = buf.subarray(0, 6).toString('ascii');
  if (magic === 'RTPACK') {
    buf = zlib.inflateSync(buf.subarray(32));
  }

  const texMagic = buf.subarray(0, 6).toString('ascii');
  if (texMagic !== 'RTTXTR') {
    throw new Error(`Unexpected RTTEX magic: ${texMagic} (len=${buf.length})`);
  }

  const height = buf.readUInt32LE(8);
  const width = buf.readUInt32LE(12);
  const format = buf.readUInt32LE(16);
  const originalHeight = buf.readUInt32LE(20);
  const originalWidth = buf.readUInt32LE(24);
  const usesAlpha = buf[28] !== 0;
  const channels = 3 + (usesAlpha ? 1 : 0);
  const pixelOffset = 124;

  const rgba = new Uint8Array(width * height * 4);

  // Flip vertically (RTTXTR stores rows bottom-to-top)
  for (let dstY = 0; dstY < height; dstY++) {
    const srcY = height - 1 - dstY;
    for (let x = 0; x < width; x++) {
      const dstIdx = (dstY * width + x) * 4;
      const pxIndex = srcY * width + x;

      if (format === 5121) {
        // GL_UNSIGNED_BYTE (RGB or RGBA)
        const sIdx = pixelOffset + pxIndex * channels;
        rgba[dstIdx] = buf[sIdx];
        rgba[dstIdx + 1] = buf[sIdx + 1];
        rgba[dstIdx + 2] = buf[sIdx + 2];
        rgba[dstIdx + 3] = channels === 4 ? buf[sIdx + 3] : 255;
      } else if (format === 32819) {
        // GL_UNSIGNED_SHORT_4_4_4_4 (0x8033)
        const val = buf.readUInt16LE(pixelOffset + pxIndex * 2);
        rgba[dstIdx] = ((val >>> 12) & 0xf) * 17;
        rgba[dstIdx + 1] = ((val >>> 8) & 0xf) * 17;
        rgba[dstIdx + 2] = ((val >>> 4) & 0xf) * 17;
        rgba[dstIdx + 3] = (val & 0xf) * 17;
      } else if (format === 33635) {
        // GL_UNSIGNED_SHORT_5_6_5 (0x8363)
        const val = buf.readUInt16LE(pixelOffset + pxIndex * 2);
        rgba[dstIdx] = Math.round(((val >>> 11) & 0x1f) * (255 / 31));
        rgba[dstIdx + 1] = Math.round(((val >>> 5) & 0x3f) * (255 / 63));
        rgba[dstIdx + 2] = Math.round((val & 0x1f) * (255 / 31));
        rgba[dstIdx + 3] = 255;
      } else if (format === 32820) {
        // GL_UNSIGNED_SHORT_5_5_5_1 (0x8034)
        const val = buf.readUInt16LE(pixelOffset + pxIndex * 2);
        rgba[dstIdx] = Math.round(((val >>> 11) & 0x1f) * (255 / 31));
        rgba[dstIdx + 1] = Math.round(((val >>> 6) & 0x1f) * (255 / 31));
        rgba[dstIdx + 2] = Math.round(((val >>> 1) & 0x1f) * (255 / 31));
        rgba[dstIdx + 3] = (val & 1) ? 255 : 0;
      } else {
        throw new Error(`Unsupported GL texture format: ${format}`);
      }
    }
  }

  return {
    width,
    height,
    originalWidth,
    originalHeight,
    format,
    usesAlpha,
    pngBuffer: encodeRgbaToPng(width, height, rgba),
  };
}

const RTTEX_TARGETS: Array<[string, string]> = [
  // Core Tiles, Seeds, Particles, Drops
  ['game/tiles_page1.rttex', 'game/tiles_page1.png'],
  ['game/tiles_page2.rttex', 'game/tiles_page2.png'],
  ['game/tiles_page3.rttex', 'game/tiles_page3.png'],
  ['game/tiles_page4.rttex', 'game/tiles_page4.png'],
  ['game/tiles_page5.rttex', 'game/tiles_page5.png'],
  ['game/tiles_page6.rttex', 'game/tiles_page6.png'],
  ['game/tiles_page7.rttex', 'game/tiles_page7.png'],
  ['game/tiles_page8.rttex', 'game/tiles_page8.png'],
  ['game/tiles_page9.rttex', 'game/tiles_page9.png'],
  ['game/tiles_page10.rttex', 'game/tiles_page10.png'],
  ['game/tiles_page11.rttex', 'game/tiles_page11.png'],
  ['game/tiles_page12.rttex', 'game/tiles_page12.png'],
  ['game/seed.rttex', 'game/seed.png'],
  ['game/particles.rttex', 'game/particles.png'],
  ['game/particles2.rttex', 'game/particles2.png'],
  ['game/pickup_box.rttex', 'game/pickup_box.png'],
  ['game/tile_grid_overlay.rttex', 'game/tile_grid_overlay.png'],

  // Sky, Sun, Clouds, Hills & Weather
  ['game/sun.rttex', 'game/sun.png'],
  ['game/cloud.rttex', 'game/cloud.png'],
  ['game/hills1.rttex', 'game/hills1.png'],
  ['game/hills2.rttex', 'game/hills2.png'],
  ['game/hills3.rttex', 'game/hills3.png'],
  ['game/desert_sky.rttex', 'game/desert_sky.png'],
  ['game/desert_hills2.rttex', 'game/desert_hills2.png'],
  ['game/city_sky.rttex', 'game/city_sky.png'],
  ['game/city_skyline.rttex', 'game/city_skyline.png'],
  ['game/city2_skyline.rttex', 'game/city2_skyline.png'],
  ['game/moon.rttex', 'game/moon.png'],
  ['game/stars.rttex', 'game/stars.png'],
  ['game/bg_EC_sky.rttex', 'game/bg_EC_sky.png'],

  // Growtopian Character Parts & Clothing
  ['game/player_head.rttex', 'game/player_head.png'],
  ['game/player_eyes.rttex', 'game/player_eyes.png'],
  ['game/player_face.rttex', 'game/player_face.png'],
  ['game/player_arm.rttex', 'game/player_arm.png'],
  ['game/player_arm2.rttex', 'game/player_arm2.png'],
  ['game/player_puncharm.rttex', 'game/player_puncharm.png'],
  ['game/player_sleeve.rttex', 'game/player_sleeve.png'],
  ['game/player_feet.rttex', 'game/player_feet.png'],
  ['game/player_feet2.rttex', 'game/player_feet2.png'],
  ['game/player_feet3.rttex', 'game/player_feet3.png'],
  ['game/player_feet_icon.rttex', 'game/player_feet_icon.png'],
  ['game/player_extraleg.rttex', 'game/player_extraleg.png'],
  ['game/player_pants.rttex', 'game/player_pants.png'],
  ['game/player_pants2.rttex', 'game/player_pants2.png'],
  ['game/player_pants3.rttex', 'game/player_pants3.png'],
  ['game/player_shirt.rttex', 'game/player_shirt.png'],
  ['game/player_shirt2.rttex', 'game/player_shirt2.png'],
  ['game/player_shirt3.rttex', 'game/player_shirt3.png'],
  ['game/player_hair.rttex', 'game/player_hair.png'],
  ['game/player_hairhair.rttex', 'game/player_hairhair.png'],
  ['game/player_hairhair2.rttex', 'game/player_hairhair2.png'],
  ['game/player_hair3.rttex', 'game/player_hair3.png'],
  ['game/player_hair3_icon.rttex', 'game/player_hair3_icon.png'],
  ['game/player_hair4.rttex', 'game/player_hair4.png'],
  ['game/player_hair4_icon.rttex', 'game/player_hair4_icon.png'],
  ['game/player_hair5.rttex', 'game/player_hair5.png'],
  ['game/player_faceitem.rttex', 'game/player_faceitem.png'],
  ['game/player_faceitem2.rttex', 'game/player_faceitem2.png'],
  ['game/player_faceitem3.rttex', 'game/player_faceitem3.png'],
  ['game/player_faceitem4.rttex', 'game/player_faceitem4.png'],
  ['game/player_handitem.rttex', 'game/player_handitem.png'],
  ['game/player_handitem2.rttex', 'game/player_handitem2.png'],
  ['game/player_handitem3.rttex', 'game/player_handitem3.png'],
  ['game/player_handitem4.rttex', 'game/player_handitem4.png'],
  ['game/player_handitem_icon.rttex', 'game/player_handitem_icon.png'],
  ['game/player_longhanditem1.rttex', 'game/player_longhanditem1.png'],
  ['game/player_longhanditem1_icon.rttex', 'game/player_longhanditem1_icon.png'],
  ['game/player_back.rttex', 'game/player_back.png'],
  ['game/player_back2.rttex', 'game/player_back2.png'],
  ['game/player_back3.rttex', 'game/player_back3.png'],

  // Authentic Growtopia UI Panels, Slots, Icons & Controls
  ['game/gui_box.rttex', 'ui/gui_box.png'],
  ['game/gui_box_glow_yellow.rttex', 'ui/gui_box_glow_yellow.png'],
  ['game/gui_box_upwhite.rttex', 'ui/gui_box_upwhite.png'],
  ['game/gui_box_white.rttex', 'ui/gui_box_white.png'],
  ['game/gui_itembox.rttex', 'ui/gui_itembox.png'],
  ['game/inv_select.rttex', 'ui/inv_select.png'],
  ['interface/cash_icon_overlay.rttex', 'ui/cash_icon_overlay.png'],
  ['interface/handle_up.rttex', 'ui/handle_up.png'],
  ['interface/handle_down.rttex', 'ui/handle_down.png'],
  ['interface/handle_horizontal.rttex', 'ui/handle_horizontal.png'],
  ['interface/handle_big.rttex', 'ui/handle_big.png'],
  ['interface/atomic_button.rttex', 'ui/atomic_button.png'],
  ['interface/cross.rttex', 'ui/cross.png'],
  ['interface/checkbox.rttex', 'ui/checkbox.png'],
  ['interface/slider_button.rttex', 'ui/slider_button.png'],
  ['interface/large/game_title.rttex', 'ui/game_title.png'],
  ['interface/large/generic_menu.rttex', 'ui/generic_menu.png'],
  ['interface/large/main_menu_bg.rttex', 'ui/main_menu_bg.png'],
  ['interface/large/menu_button.rttex', 'ui/menu_button.png'],
  ['interface/large/chat_button.rttex', 'ui/chat_button.png'],
  ['interface/large/friend_button.rttex', 'ui/friend_button.png'],
  ['interface/large/punch_icon.rttex', 'ui/punch_icon.png'],
  ['interface/large/jump_icon.rttex', 'ui/jump_icon.png'],
  ['interface/large/left_arrow.rttex', 'ui/left_arrow.png'],
  ['interface/large/right_arrow.rttex', 'ui/right_arrow.png'],
  ['interface/large/skin_selected_marker.rttex', 'ui/skin_selected_marker.png'],
  ['interface/large/gui_store_button_overlays1.rttex', 'ui/gui_store_button_overlays1.png'],
  ['interface/large/store_buttons.rttex', 'ui/store_buttons.png'],
];

const DIRECT_FILE_TARGETS: Array<[string, string]> = [
  [
    'https://static.wikia.nocookie.net/growtopia/images/3/33/Arid_Weather.png/revision/latest?cb=20230303131004',
    'weather/arid_weather.png',
  ],
  [
    'https://static.wikia.nocookie.net/growtopia/images/b/b2/Night_Weather.png/revision/latest?cb=20240614183000',
    'weather/night_weather.png',
  ],
  [
    'https://raw.githubusercontent.com/BorzXy/RenderWorld/main/cache/fonts/century_gothic_bold.ttf',
    'fonts/century_gothic_bold.ttf',
  ],
  // Authentic Sound Effects from Akamai CDN
  [
    'https://ubistatic-a.akamaihd.net/0098/040220269/cache/audio/punch.wav',
    'audio/punch.wav',
  ],
  [
    'https://ubistatic-a.akamaihd.net/0098/040220269/cache/audio/jump.wav',
    'audio/jump.wav',
  ],
  [
    'https://ubistatic-a.akamaihd.net/0098/040220269/cache/audio/hit.wav',
    'audio/hit.wav',
  ],
  [
    'https://ubistatic-a.akamaihd.net/0098/040220269/cache/audio/splat.wav',
    'audio/splat.wav',
  ],
  [
    'https://ubistatic-a.akamaihd.net/0098/040220269/cache/audio/click.wav',
    'audio/click.wav',
  ],
  [
    'https://ubistatic-a.akamaihd.net/0098/040220269/cache/audio/teleport.wav',
    'audio/teleport.wav',
  ],
];

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const force = process.argv.includes('--force');
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  const manifestPath = path.join(OUT_ROOT, 'manifest.json');
  const manifest: Record<string, UnpackedTextureMeta> =
    !force && fs.existsSync(manifestPath)
      ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      : {};

  console.log(`[GT Scraper] Checking & unpacking ${RTTEX_TARGETS.length} official .rttex assets...`);

  // Process in batches of 8 for polite, fast concurrency
  const batchSize = 8;
  for (let i = 0; i < RTTEX_TARGETS.length; i += batchSize) {
    const batch = RTTEX_TARGETS.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async ([srcRel, outRel]) => {
        const fullOut = path.join(OUT_ROOT, outRel);
        if (!force && fs.existsSync(fullOut) && manifest[outRel]) {
          return;
        }
        const url = CDN_BASE + srcRel;
        const raw = await fetchBuffer(url);
        const unpacked = unpackRttex(raw);
        fs.mkdirSync(path.dirname(fullOut), { recursive: true });
        fs.writeFileSync(fullOut, unpacked.pngBuffer);
        manifest[outRel] = {
          outRel,
          srcPath: srcRel,
          width: unpacked.width,
          height: unpacked.height,
          originalWidth: unpacked.originalWidth,
          originalHeight: unpacked.originalHeight,
          format: unpacked.format,
          usesAlpha: unpacked.usesAlpha,
        };
        console.log(
          `  [OK] ${outRel} (${unpacked.width}x${unpacked.height}, orig=${unpacked.originalWidth}x${unpacked.originalHeight}, fmt=${unpacked.format})`
        );
      })
    );
  }

  for (const [url, outRel] of DIRECT_FILE_TARGETS) {
    const fullOut = path.join(OUT_ROOT, outRel);
    if (!force && fs.existsSync(fullOut)) {
      continue;
    }
    const buf = await fetchBuffer(url);
    fs.mkdirSync(path.dirname(fullOut), { recursive: true });
    fs.writeFileSync(fullOut, buf);
    console.log(`  [OK] ${outRel} (${buf.length} bytes)`);
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n[GT Scraper] Ready: ${Object.keys(manifest).length} unpacked textures + fonts/weather in ${OUT_ROOT}`);
}

main().catch((err) => {
  console.error('[GT Scraper] Fatal error:', err);
  process.exit(1);
});
