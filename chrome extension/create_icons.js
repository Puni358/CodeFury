const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function generatePNG(width, height, r, g, b) {
  // Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type 2 (RGB)
  ihdrData[10] = 0; // compression method
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace method

  const ihdrChunk = createChunk('IHDR', ihdrData);

  // IDAT
  const rowSize = width * 3 + 1;
  const rawData = Buffer.alloc(height * rowSize);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // filter byte: 0 (None)
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 3;
      // Draw a subtle border / contrast design
      const isBorder = (x < 2 || x >= width - 2 || y < 2 || y >= height - 2);
      if (isBorder) {
        rawData[pixelOffset] = 37;     // 0x25
        rawData[pixelOffset + 1] = 99;  // 0x63
        rawData[pixelOffset + 2] = 235; // 0xeb
      } else {
        rawData[pixelOffset] = r;
        rawData[pixelOffset + 1] = g;
        rawData[pixelOffset + 2] = b;
      }
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressedData);

  // IEND
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const length = data.length;
  const buf = Buffer.alloc(8 + length + 4);
  buf.writeUInt32BE(length, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  
  const crc = calcCRC32(Buffer.concat([Buffer.from(type, 'ascii'), data]));
  buf.writeUInt32BE(crc, 8 + length);
  return buf;
}

function calcCRC32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    let byte = buf[i];
    for (let j = 0; j < 8; j++) {
      let bit = (byte ^ crc) & 1;
      crc = (crc >>> 1) ^ (bit ? 0xedb88320 : 0);
      byte >>>= 1;
    }
  }
  return (crc ^ -1) >>> 0;
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);

fs.writeFileSync(path.join(iconsDir, 'icon16.png'), generatePNG(16, 16, 37, 99, 235));
fs.writeFileSync(path.join(iconsDir, 'icon48.png'), generatePNG(48, 48, 37, 99, 235));
fs.writeFileSync(path.join(iconsDir, 'icon128.png'), generatePNG(128, 128, 37, 99, 235));

console.log('Icons generated successfully in ./icons');
