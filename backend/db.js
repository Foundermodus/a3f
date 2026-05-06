import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      sticker_image TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_participants_created ON participants(created_at);
    CREATE INDEX IF NOT EXISTS idx_participants_name ON participants(name COLLATE NOCASE);
  `);
  // Idempotent migrations
  const info = db.prepare("PRAGMA table_info(participants)").all();
  const cols = new Set(info.map(r => r.name));
  if (!cols.has('email'))          db.exec("ALTER TABLE participants ADD COLUMN email TEXT");
  if (!cols.has('phone'))          db.exec("ALTER TABLE participants ADD COLUMN phone TEXT");
  if (!cols.has('sticker_image2')) db.exec("ALTER TABLE participants ADD COLUMN sticker_image2 TEXT");
  if (!cols.has('idem_key'))       db.exec("ALTER TABLE participants ADD COLUMN idem_key TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_idem ON participants(idem_key) WHERE idem_key IS NOT NULL");
  // Drop NOT NULL on sticker_image if still present (table-rebuild dance)
  const sticker = info.find(r => r.name === 'sticker_image');
  if (sticker?.notnull === 1) {
    db.exec(`
      PRAGMA foreign_keys=off;
      BEGIN TRANSACTION;
      CREATE TABLE participants_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        sticker_image TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        email TEXT,
        phone TEXT,
        sticker_image2 TEXT
      );
      INSERT INTO participants_new (id, code, name, sticker_image, created_at, email, phone, sticker_image2)
        SELECT id, code, name, sticker_image, created_at, email, phone, sticker_image2 FROM participants;
      DROP TABLE participants;
      ALTER TABLE participants_new RENAME TO participants;
      CREATE INDEX IF NOT EXISTS idx_participants_created ON participants(created_at);
      CREATE INDEX IF NOT EXISTS idx_participants_name ON participants(name COLLATE NOCASE);
      COMMIT;
      PRAGMA foreign_keys=on;
    `);
  }
  return db;
}
