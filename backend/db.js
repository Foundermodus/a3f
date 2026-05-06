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
      sticker_image TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_participants_created ON participants(created_at);
    CREATE INDEX IF NOT EXISTS idx_participants_name ON participants(name COLLATE NOCASE);
  `);
  // Idempotent migrations (SQLite has no IF NOT EXISTS for ADD COLUMN)
  const cols = new Set(db.prepare("PRAGMA table_info(participants)").all().map(r => r.name));
  if (!cols.has('email')) db.exec("ALTER TABLE participants ADD COLUMN email TEXT");
  if (!cols.has('phone')) db.exec("ALTER TABLE participants ADD COLUMN phone TEXT");
  return db;
}
