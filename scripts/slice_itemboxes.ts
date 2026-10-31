import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
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
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const rawScanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    rawScanlines[rowStart] = 0;
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

function unpackRttex(buf: Buffer): { width: number; height: number; rgba: Uint8Array } {
  const magic = buf.subarray(0, 6).toString('ascii');
  if (magic === 'RTPACK') {
    buf = zlib.inflateSync(buf.subarray(32));
  }
  const height = buf.readUInt32LE(8);
  const width = buf.readUInt32LE(12);
  const format = buf.readUInt32LE(16);
  const usesAlpha = buf[28] !== 0;
  const channels = 3 + (usesAlpha ? 1 : 0);
  const pixelOffset = 124;
  const rgba = new Uint8Array(width * height * 4);

  for (let dstY = 0; dstY < height; dstY++) {
    const srcY = height - 1 - dstY;
    for (let x = 0; x < width; x++) {
      const dstIdx = (dstY * width + x) * 4;
      const pxIndex = srcY * width + x;
      if (format === 5121) {
        const sIdx = pixelOffset + pxIndex * channels;
        rgba[dstIdx] = buf[sIdx];
        rgba[dstIdx + 1] = buf[sIdx + 1];
        rgba[dstIdx + 2] = buf[sIdx + 2];
        rgba[dstIdx + 3] = channels === 4 ? buf[sIdx + 3] : 255;
      }
    }
  }
  return { width, height, rgba };
}

async function main() {
  const rttexPath = path.resolve('public/assets/gt_source/game/gui_itembox.rttex');
  let fullWidth = 256;
  let fullHeight = 256;
  let fullRgba: Uint8Array;

  if (fs.existsSync(rttexPath)) {
    const res = unpackRttex(fs.readFileSync(rttexPath));
    fullWidth = res.width;
    fullHeight = res.height;
    fullRgba = res.rgba;
  } else {
    console.error('rttex not found');
    process.exit(1);
  }

  // Crop 40x40 boxes
  const boxDefs = [
    { name: 'itembox_blue.png', col: 0, row: 0 },    // Standard default slot
    { name: 'itembox_gold.png', col: 1, row: 0 },    // Gold slot
    { name: 'itembox_red.png', col: 2, row: 0 },     // Red slot
    { name: 'itembox_green.png', col: 0, row: 1 },   // Active / selected slot
    { name: 'itembox_yellow.png', col: 1, row: 1 },  // Yellow slot
    { name: 'itembox_purple.png', col: 2, row: 1 },  // Equipped clothing slot
    { name: 'itembox_orange.png', col: 0, row: 2 },  // Orange slot
    { name: 'itembox_gray.png', col: 1, row: 2 },    // Gray slot
    { name: 'itembox_white.png', col: 2, row: 2 },   // White slot
    { name: 'itembox_pink.png', col: 0, row: 3 },    // Pink slot
  ];

  const outDir = path.resolve('public/assets/gt/ui');
  for (const b of boxDefs) {
    const cropW = 40;
    const cropH = 40;
    const cropRgba = new Uint8Array(cropW * cropH * 4);
    const startX = b.col * 40;
    const startY = b.row * 40;

    for (let cy = 0; cy < cropH; cy++) {
      for (let cx = 0; cx < cropW; cx++) {
        const srcIdx = ((startY + cy) * fullWidth + (startX + cx)) * 4;
        const dstIdx = (cy * cropW + cx) * 4;
        cropRgba[dstIdx] = fullRgba[srcIdx];
        cropRgba[dstIdx + 1] = fullRgba[srcIdx + 1];
        cropRgba[dstIdx + 2] = fullRgba[srcIdx + 2];
        cropRgba[dstIdx + 3] = fullRgba[srcIdx + 3];
      }
    }

    const png = encodeRgbaToPng(cropW, cropH, cropRgba);
    fs.writeFileSync(path.join(outDir, b.name), png);
    console.log(`Saved ${b.name}`);
  }
}

main();
