// Génère les icônes PNG de la PWA (192 et 512 px) sans dépendance externe.
// Le dessin reprend public/favicon.svg sur une grille de 64 unités.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BG = [0x8b, 0x5a, 0x2b];
const FG = [0xf3, 0xe3, 0xcf];
// Rectangles [x, y, largeur, hauteur] sur une grille 64×64 : plateau, ceinture, pieds.
const RECTS = [
  [14, 16, 36, 4],
  [14, 22, 36, 6],
  [18, 28, 5, 20],
  [41, 28, 5, 20],
];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filtre « None »
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * 64;
      const gy = (y / size) * 64;
      const inside = RECTS.some(([rx, ry, rw, rh]) => gx >= rx && gx < rx + rw && gy >= ry && gy < ry + rh);
      const [r, g, b] = inside ? FG : BG;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), png(size));
  console.log(`public/icon-${size}.png`);
}
