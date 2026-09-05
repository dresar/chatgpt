// generate_icons.js - Pure Node.js PNG Icon Generator
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

function createPNG(width, height) {
  // Buat canvas RGBA
  const buffer = Buffer.alloc(width * height * 4);

  const cx = width / 2;
  const cy = height / 2;
  const radius = width * 0.44;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        // Gradient background: Dark Cyan to Deep Violet
        const factor = (x + y) / (width + height);
        const r = Math.floor(15 + factor * 40);
        const g = Math.floor(23 + (1 - factor) * 160);
        const b = Math.floor(42 + factor * 210);

        // Cyber Glowing Spark di tengah
        const sparkDist = Math.abs(dx) + Math.abs(dy);
        if (sparkDist < width * 0.3) {
          // Bright Cyan Spark
          buffer[idx] = 0;
          buffer[idx + 1] = 240;
          buffer[idx + 2] = 255;
          buffer[idx + 3] = 255;
        } else if (dist > radius - 2) {
          // Glowing Neon Border
          buffer[idx] = 0;
          buffer[idx + 1] = 210;
          buffer[idx + 2] = 255;
          buffer[idx + 3] = 255;
        } else {
          buffer[idx] = r;
          buffer[idx + 1] = g;
          buffer[idx + 2] = b;
          buffer[idx + 3] = 255;
        }
      } else {
        // Transparent
        buffer[idx] = 0;
        buffer[idx + 1] = 0;
        buffer[idx + 2] = 0;
        buffer[idx + 3] = 0;
      }
    }
  }

  // Encode PNG manually
  const rawData = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    rawData[y * (width * 4 + 1)] = 0; // Filter: None
    buffer.copy(rawData, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(rawData);

  // PNG Header
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type);
    const body = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let j = 0; j < 8; j++) {
        c = (c >>> 1) ^ (-(c & 1) & 0xedb88320);
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const sizes = [16, 32, 48, 128];
for (const size of sizes) {
  const pngBuf = createPNG(size, size);
  const filePath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(filePath, pngBuf);
  console.log(`✅ Generated: icons/icon-${size}.png (${size}x${size} px)`);
}
