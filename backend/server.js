import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import sharp from 'sharp';
import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openDb } from './db.js';

const PORT = Number(process.env.PORT || 3300);
const HOST = process.env.HOST || '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const UPLOAD_MAX = Number(process.env.UPLOAD_MAX_BYTES || 8 * 1024 * 1024);
const DB_PATH = process.env.DB_PATH || './data/a3f.db';
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

if (!ADMIN_KEY || ADMIN_KEY === 'change-me-to-a-long-random-string') {
  console.warn('[a3f] WARNING: ADMIN_KEY is unset or default. Set it in .env before production.');
}

mkdirSync(UPLOAD_DIR, { recursive: true });
const db = openDb(DB_PATH);

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map(s => s.trim()) }));
app.use(express.json({ limit: '64kb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

const submitLimiter = rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false });
const readLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX, files: 1 },
});

function requireAdmin(req, res, next) {
  const key = req.get('x-admin-key');
  if (!ADMIN_KEY || key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.post('/api/submit', submitLimiter, upload.single('photo'), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'name_required' });
    if (!req.file?.buffer) return res.status(400).json({ error: 'photo_required' });

    const code = crypto.randomBytes(12).toString('hex');
    const safe = await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    const filename = `${code}.jpg`;
    await writeFile(path.join(UPLOAD_DIR, filename), safe);
    const stickerImage = `/uploads/${filename}`;

    db.prepare(
      'INSERT INTO participants (code, name, sticker_image) VALUES (?, ?, ?)'
    ).run(code, name, stickerImage);

    res.json({ ok: true, code });
  } catch (err) {
    console.error('[submit]', err);
    res.status(500).json({ error: 'submit_failed' });
  }
});

app.get('/api/participants', readLimiter, (req, res) => {
  const sort = req.query.sort === 'name'
    ? 'name COLLATE NOCASE ASC'
    : 'created_at DESC';
  const rows = db.prepare(
    `SELECT id, name, sticker_image, created_at FROM participants ORDER BY ${sort} LIMIT 1000`
  ).all();
  res.json({ count: rows.length, participants: rows });
});

app.get('/api/stats', readLimiter, (_req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS n FROM participants').get().n;
  res.json({ total });
});

app.delete('/api/participants/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM participants WHERE id = ?').run(id);
  res.json({ ok: true, deleted: info.changes });
});

app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large' });
  console.error('[err]', err);
  res.status(500).json({ error: 'internal' });
});

app.listen(PORT, HOST, () => {
  console.log(`[a3f] listening on http://${HOST}:${PORT}`);
});
