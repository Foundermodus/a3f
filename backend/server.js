import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import sharp from 'sharp';
import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { openDb } from './db.js';

const PORT = Number(process.env.PORT || 3300);
const HOST = process.env.HOST || '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const UPLOAD_MAX = Number(process.env.UPLOAD_MAX_BYTES || 8 * 1024 * 1024);
const DB_PATH = process.env.DB_PATH || './data/a3f.db';
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

if (!ADMIN_KEY || ADMIN_KEY.length < 24) {
  console.warn('[a3f] WARNING: ADMIN_KEY missing or too short (<24 chars). DELETE endpoint will refuse requests.');
}
if (!CORS_ORIGIN) {
  console.warn('[a3f] WARNING: CORS_ORIGIN unset — refusing all cross-origin requests.');
}

mkdirSync(UPLOAD_DIR, { recursive: true });
const db = openDb(DB_PATH);

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: false,        // API only, no HTML served
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // photos consumed from GH Pages origin
}));

const allowedOrigins = CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);              // curl, server-to-server
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('cors_blocked'));
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  credentials: false,
  maxAge: 600,
}));

app.use(express.json({ limit: '64kb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', dotfiles: 'deny', index: false }));

const submitLimiter = rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false });
const readLimiter   = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const adminLimiter  = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX, files: 2, fields: 10, parts: 14 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error('unsupported_mime'));
    cb(null, true);
  },
});

async function processPhoto(buffer, dest) {
  const safe = await sharp(buffer, { limitInputPixels: 24_000_000, failOn: 'error' })
    .rotate()
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .withMetadata({})
    .toBuffer();
  await writeFile(dest, safe);
}

function timingSafeEqStr(a, b) {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function requireAdmin(req, res, next) {
  const key = req.get('x-admin-key') || '';
  if (!ADMIN_KEY || ADMIN_KEY.length < 24) return res.status(503).json({ error: 'admin_disabled' });
  if (!timingSafeEqStr(key, ADMIN_KEY)) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.post('/api/submit', submitLimiter, upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'photo2', maxCount: 1 },
]), async (req, res) => {
  try {
    const sanitize = (s, max) => String(s || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max);
    const name  = sanitize(req.body.name, 80);
    const email = sanitize(req.body.email, 120).toLowerCase();
    const phone = sanitize(req.body.phone, 30);
    const photo1 = req.files?.photo?.[0];
    const photo2 = req.files?.photo2?.[0];
    if (!name) return res.status(400).json({ error: 'name_required' });
    if (!photo1?.buffer) return res.status(400).json({ error: 'photo_required' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'invalid_email' });
    if (phone && !/^[+0-9 ()/.-]{4,30}$/.test(phone)) return res.status(400).json({ error: 'invalid_phone' });

    const code = crypto.randomBytes(12).toString('hex');
    await processPhoto(photo1.buffer, path.join(UPLOAD_DIR, `${code}.jpg`));
    const stickerImage = `/uploads/${code}.jpg`;
    let stickerImage2 = null;
    if (photo2?.buffer) {
      await processPhoto(photo2.buffer, path.join(UPLOAD_DIR, `${code}-2.jpg`));
      stickerImage2 = `/uploads/${code}-2.jpg`;
    }

    db.prepare(
      'INSERT INTO participants (code, name, email, phone, sticker_image, sticker_image2) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(code, name, email || null, phone || null, stickerImage, stickerImage2);

    res.json({ ok: true, code });
  } catch (err) {
    if (err?.message === 'unsupported_mime') return res.status(415).json({ error: 'unsupported_mime' });
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large' });
    console.error('[submit]', err.message);
    res.status(500).json({ error: 'submit_failed' });
  }
});

app.get('/api/participants', readLimiter, (req, res) => {
  const sort = req.query.sort === 'name'
    ? 'name COLLATE NOCASE ASC'
    : 'created_at DESC';
  const rows = db.prepare(
    `SELECT id, name, email, phone, sticker_image, sticker_image2, created_at FROM participants ORDER BY ${sort} LIMIT 1000`
  ).all();
  res.json({ count: rows.length, participants: rows });
});

app.get('/api/stats', readLimiter, (_req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS n FROM participants').get().n;
  res.json({ total });
});

app.delete('/api/participants/:id', adminLimiter, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad_id' });
  const row = db.prepare('SELECT sticker_image, sticker_image2 FROM participants WHERE id = ?').get(id);
  const info = db.prepare('DELETE FROM participants WHERE id = ?').run(id);
  for (const p of [row?.sticker_image, row?.sticker_image2]) {
    if (p?.startsWith('/uploads/')) {
      try { await unlink(path.join(UPLOAD_DIR, path.basename(p))); } catch { /* file already gone */ }
    }
  }
  res.json({ ok: true, deleted: info.changes });
});

app.use((err, _req, res, _next) => {
  if (err?.message === 'cors_blocked') return res.status(403).json({ error: 'cors_blocked' });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large' });
  if (err?.message === 'unsupported_mime') return res.status(415).json({ error: 'unsupported_mime' });
  console.error('[err]', err.message);
  res.status(500).json({ error: 'internal' });
});

app.listen(PORT, HOST, () => {
  console.log(`[a3f] listening on ${HOST}:${PORT} | cors=[${allowedOrigins.join(', ')}]`);
});
