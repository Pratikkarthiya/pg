import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
export function openDatabase(directory) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'bliss.sqlite'));
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT, role TEXT NOT NULL CHECK(role IN ('admin','resident')),
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS residents (
      user_id TEXT PRIMARY KEY REFERENCES users(id), sharing TEXT NOT NULL CHECK(sharing IN ('two-sharing','four-sharing')),
      room_number TEXT NOT NULL, bed INTEGER NOT NULL, move_in TEXT NOT NULL, rent INTEGER NOT NULL CHECK(rent>0),
      deposit INTEGER NOT NULL DEFAULT 0 CHECK(deposit>=0), active INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS occupied_bed ON residents(room_number,bed) WHERE active=1;
    CREATE TABLE IF NOT EXISTS invites (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS charges (
      id TEXT PRIMARY KEY, resident_id TEXT NOT NULL REFERENCES users(id), month TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK(amount>0), due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','under-review','paid')), reference TEXT NOT NULL DEFAULT '', proof_id TEXT,
      submitted_at TEXT, paid_at TEXT, reviewed_by TEXT REFERENCES users(id), review_note TEXT NOT NULL DEFAULT '',
      UNIQUE(resident_id,month)
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY, purpose TEXT NOT NULL CHECK(purpose IN ('room','payment')), owner_id TEXT REFERENCES users(id),
      room_slug TEXT, caption TEXT NOT NULL DEFAULT '', mime TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS room_settings (slug TEXT PRIMARY KEY, rent INTEGER);
    CREATE TABLE IF NOT EXISTS complaints (
      id TEXT PRIMARY KEY, resident_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
      category TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'New'
      CHECK(status IN ('New','Acknowledged','In progress','Resolved')), admin_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notices (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
      target_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  return db;
}
