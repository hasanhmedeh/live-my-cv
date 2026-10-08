// Converts the Lilita One TTF into a tiny three.js typeface JSON containing only
// the glyphs the 3D scene needs. Run once with `node scripts/build-font.mjs`;
// the output is committed so Vercel builds never need network access.
import fs from 'node:fs';
import opentype from 'opentype.js';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!&-\'. ';
const buf = fs.readFileSync(new URL('./LilitaOne-Regular.ttf', import.meta.url));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const scale = 100000 / ((font.unitsPerEm || 2048) * 72);
const r = Math.round;

const glyphs = {};
for (const ch of CHARS) {
  const glyph = font.charToGlyph(ch);
  let o = '';
  for (const c of glyph.path.commands) {
    const type = c.type.toLowerCase() === 'c' ? 'b' : c.type.toLowerCase();
    o += type + ' ';
    if (c.x !== undefined) o += `${r(c.x * scale)} ${r(c.y * scale)} `;
    if (c.x1 !== undefined) o += `${r(c.x1 * scale)} ${r(c.y1 * scale)} `;
    if (c.x2 !== undefined) o += `${r(c.x2 * scale)} ${r(c.y2 * scale)} `;
  }
  const bb = glyph.getBoundingBox();
  glyphs[ch] = { ha: r(glyph.advanceWidth * scale), x_min: r(bb.x1 * scale), x_max: r(bb.x2 * scale), o: o.trim() };
}

const out = {
  glyphs,
  familyName: 'Lilita One',
  ascender: r(font.ascender * scale),
  descender: r(font.descender * scale),
  underlinePosition: font.tables.post.underlinePosition,
  underlineThickness: font.tables.post.underlineThickness,
  boundingBox: { xMin: font.tables.head.xMin, xMax: font.tables.head.xMax, yMin: font.tables.head.yMin, yMax: font.tables.head.yMax },
  resolution: 1000,
};

fs.writeFileSync(new URL('../src/assets/lilita.typeface.json', import.meta.url), JSON.stringify(out));
console.log('wrote', Object.keys(glyphs).length, 'glyphs');
