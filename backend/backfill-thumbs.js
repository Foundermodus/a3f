// Backfill thumbnails for participants uploaded before the thumb feature.
// Run on the server: cd /opt/a3f/backend && node backfill-thumbs.js
import 'dotenv/config';
import sharp from 'sharp';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { openDb } from './db.js';

const DB_PATH    = process.env.DB_PATH    || './data/a3f.db';
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

const db = openDb(DB_PATH);
const rows = db.prepare(
  'SELECT id, sticker_image, sticker_image2, sticker_thumb, sticker_thumb2 FROM participants'
).all();

let made = 0, skipped = 0, failed = 0;
for (const r of rows) {
  const updates = {};
  for (const [imgCol, thumbCol, suffix] of [
    ['sticker_image',  'sticker_thumb',  ''],
    ['sticker_image2', 'sticker_thumb2', '-2'],
  ]) {
    const img = r[imgCol];
    if (!img || r[thumbCol]) { skipped++; continue; }
    const fullPath  = path.join(UPLOAD_DIR, path.basename(img));
    const thumbName = path.basename(img).replace(/\.jpg$/, '-thumb.jpg');
    const thumbPath = path.join(UPLOAD_DIR, thumbName);
    try {
      const buf = await readFile(fullPath);
      const thumb = await sharp(buf).rotate()
        .resize({ width: 256, height: 256, fit: 'cover' })
        .jpeg({ quality: 72, mozjpeg: true })
        .withMetadata({}).toBuffer();
      await writeFile(thumbPath, thumb);
      updates[thumbCol] = `/uploads/${thumbName}`;
      made++;
    } catch (e) {
      console.error(`id=${r.id} ${imgCol}: ${e.message}`);
      failed++;
    }
  }
  if (Object.keys(updates).length) {
    const cols = Object.keys(updates);
    const vals = Object.values(updates);
    db.prepare(`UPDATE participants SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).run(...vals, r.id);
  }
}
console.log(`backfill done: made=${made} skipped=${skipped} failed=${failed}`);
