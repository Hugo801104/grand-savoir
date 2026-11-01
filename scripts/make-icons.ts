// Génère les icônes PNG de l'appli (fond bleu nuit, disque doré, étoile) sans dépendance externe.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function star(cx: number, cy: number, R: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : r;
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  return pts;
}
function inPoly(x: number, y: number, p: [number, number][]) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function render(size: number): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  const discR = size * 0.34;
  const st = star(c, c * 1.02, size * 0.2, size * 0.085);
  const SS = 3; // sur-échantillonnage pour l'anticrénelage
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let rr = 0, gg = 0, bb = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          // fond : dégradé bleu nuit / violet
          const t = py / size;
          let col = [14 + 20 * (1 - t), 16 + 10 * (1 - t), 48 + 60 * (1 - t)];
          const d = Math.hypot(px - c, py - c);
          // halo
          if (d < discR * 1.45) {
            const h = 1 - d / (discR * 1.45);
            col = col.map((v, i) => v + [255, 201, 74][i] * 0.18 * h);
          }
          if (d < discR) {
            const k = Math.min(1, d / discR);
            col = [255 - 10 * k, 214 - 50 * k, 90 - 60 * k];
          }
          if (inPoly(px, py, st)) col = [42, 26, 0];
          rr += col[0]; gg += col[1]; bb += col[2];
        }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const n = SS * SS;
      raw[o] = Math.min(255, rr / n);
      raw[o + 1] = Math.min(255, gg / n);
      raw[o + 2] = Math.min(255, bb / n);
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const s of [192, 512]) writeFileSync(`public/icon-${s}.png`, render(s));
const pts = star(256, 261, 102, 43).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
writeFileSync(
  'public/icon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22206c"/><stop offset="1" stop-color="#0e1030"/></linearGradient><radialGradient id="g"><stop offset="0" stop-color="#ffd65a"/><stop offset="1" stop-color="#f5a01e"/></radialGradient></defs><rect width="512" height="512" rx="110" fill="url(#b)"/><circle cx="256" cy="256" r="174" fill="url(#g)"/><polygon points="${pts}" fill="#2a1a00"/></svg>`,
);
console.log('Icônes générées');
