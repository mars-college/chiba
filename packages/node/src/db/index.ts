/**
 * SQLite database connection and utilities for the node.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { createLogger } from '@chiba/shared';
import type { Playlist, PlaylistItem } from '@chiba/shared';
import { SCHEMA, DROP_ALL, DEFAULT_CONFIG } from './schema.js';

const logger = createLogger('node', 'db');

/**
 * Database instance singleton.
 */
let db: Database.Database | null = null;

/**
 * Get the database file path.
 */
function getDbPath(): string {
  const dbPath = process.env.DB_PATH;
  if (dbPath) {
    return dbPath;
  }

  // Default to data directory in project root
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  return path.join(dataDir, 'node.db');
}

/**
 * Initialize the database connection and create tables.
 */
export function initDatabase(dbPath?: string): Database.Database {
  if (db) {
    return db;
  }

  const finalPath = dbPath ?? getDbPath();
  logger.info('Initializing database', { path: finalPath });

  db = new Database(finalPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Create schema
  db.exec(SCHEMA);
  logger.info('Database schema created');

  // Run migrations for existing databases
  runMigrations();

  // Initialize default config values
  initDefaultConfig();

  return db;
}

/**
 * Run database migrations for existing databases.
 * Adds columns that may not exist in older schemas.
 */
function runMigrations(): void {
  if (!db) return;

  // Check if cached_content.name column exists
  const columns = db.prepare("PRAGMA table_info(cached_content)").all() as Array<{ name: string }>;
  const hasNameColumn = columns.some(col => col.name === 'name');

  if (!hasNameColumn) {
    logger.info('Running migration: adding name column to cached_content');
    db.exec('ALTER TABLE cached_content ADD COLUMN name TEXT');
  }

  // Check if download_queue.task_id column exists
  const queueColumns = db.prepare("PRAGMA table_info(download_queue)").all() as Array<{ name: string }>;
  const hasTaskIdColumn = queueColumns.some(col => col.name === 'task_id');

  if (!hasTaskIdColumn) {
    logger.info('Running migration: adding task_id and play_after columns to download_queue');
    db.exec('ALTER TABLE download_queue ADD COLUMN task_id TEXT');
    db.exec('ALTER TABLE download_queue ADD COLUMN play_after INTEGER DEFAULT 0');
    db.exec('CREATE INDEX IF NOT EXISTS idx_download_queue_task_id ON download_queue(task_id)');
  }

  // Check if playlists table exists
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='playlists'").get();
  if (!tables) {
    logger.info('Running migration: creating playlists table');
    db.exec(`
      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        items TEXT NOT NULL,
        loop INTEGER DEFAULT 1,
        show_intros INTEGER DEFAULT 1,
        intro_duration INTEGER DEFAULT 3000,
        source TEXT,
        source_id TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        last_played_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_playlists_updated ON playlists(updated_at DESC);
    `);
  }

  // Check if resume_state table exists
  const resumeTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='resume_state'").get();
  if (!resumeTable) {
    logger.info('Running migration: creating resume_state table');
    db.exec(`
      CREATE TABLE IF NOT EXISTS resume_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        playlist_id TEXT,
        url TEXT,
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );
    `);
  }
}

/**
 * Initialize default configuration values if not set.
 */
function initDefaultConfig(): void {
  if (!db) return;

  const insertConfig = db.prepare(
    'INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)'
  );

  const insertMany = db.transaction(() => {
    for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
      insertConfig.run(key, value);
    }
  });

  insertMany();
  logger.debug('Default configuration initialized');
}

/**
 * Get the database instance.
 * Throws if not initialized.
 */
export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection.
 */
export function closeDatabase(): void {
  if (db) {
    logger.info('Closing database');
    db.close();
    db = null;
  }
}

/**
 * Reset the database (drop all tables and recreate).
 * Use only for testing.
 */
export function resetDatabase(): void {
  if (!db) {
    throw new Error('Database not initialized');
  }

  logger.warn('Resetting database - all data will be lost');
  db.exec(DROP_ALL);
  db.exec(SCHEMA);
  initDefaultConfig();
}

/**
 * Create an in-memory database for testing.
 */
export function createTestDatabase(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(SCHEMA);

  // Initialize default config
  const insertConfig = testDb.prepare(
    'INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)'
  );
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    insertConfig.run(key, value);
  }

  return testDb;
}

/**
 * Get a configuration value.
 */
export function getConfig(key: string): string | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT value FROM config WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Set a configuration value.
 */
export function setConfig(key: string, value: string): void {
  const db = getDatabase();
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(
    key,
    value
  );
  logger.debug('Configuration updated', { key, value });
}

/**
 * Get all configuration values.
 */
export function getAllConfig(): Record<string, string> {
  const db = getDatabase();
  const rows = db.prepare('SELECT key, value FROM config').all() as Array<{
    key: string;
    value: string;
  }>;

  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.key] = row.value;
  }
  return config;
}

/**
 * Generate a UUID v4.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

// ============================================================================
// Playlist Functions
// ============================================================================

interface PlaylistRow {
  id: string;
  name: string;
  items: string;
  loop: number;
  show_intros: number;
  intro_duration: number;
  source: string | null;
  source_id: string | null;
  created_at: number;
  updated_at: number;
  last_played_at: number | null;
}

function rowToPlaylist(row: PlaylistRow): Playlist {
  return {
    id: row.id,
    name: row.name,
    items: JSON.parse(row.items) as PlaylistItem[],
    loop: row.loop === 1,
    showIntros: row.show_intros === 1,
    introDuration: row.intro_duration,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Save or update a playlist in the database.
 */
export function savePlaylist(
  playlist: Playlist,
  source?: { type: string; id?: string }
): void {
  const database = getDatabase();
  database
    .prepare(
      `
    INSERT OR REPLACE INTO playlists (
      id, name, items, loop, show_intros, intro_duration,
      source, source_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      playlist.id,
      playlist.name,
      JSON.stringify(playlist.items),
      playlist.loop ? 1 : 0,
      playlist.showIntros ? 1 : 0,
      playlist.introDuration,
      source?.type ?? null,
      source?.id ?? null,
      playlist.createdAt,
      playlist.updatedAt
    );
  logger.debug('Playlist saved', { id: playlist.id, name: playlist.name });
}

/**
 * Get a playlist by ID.
 */
export function getPlaylist(id: string): Playlist | null {
  const database = getDatabase();
  const row = database
    .prepare('SELECT * FROM playlists WHERE id = ?')
    .get(id) as PlaylistRow | undefined;
  return row ? rowToPlaylist(row) : null;
}

/**
 * List all saved playlists.
 */
export function listPlaylists(): Playlist[] {
  const database = getDatabase();
  const rows = database
    .prepare('SELECT * FROM playlists ORDER BY updated_at DESC')
    .all() as PlaylistRow[];
  return rows.map(rowToPlaylist);
}

/**
 * Delete a playlist.
 */
export function deletePlaylist(id: string): boolean {
  const database = getDatabase();
  const result = database
    .prepare('DELETE FROM playlists WHERE id = ?')
    .run(id);
  return result.changes > 0;
}

/**
 * Delete all playlists.
 * Returns the number of playlists deleted.
 */
export function clearAllPlaylists(): number {
  const database = getDatabase();
  const result = database
    .prepare('DELETE FROM playlists')
    .run();
  logger.info('All playlists cleared', { deletedCount: result.changes });
  return result.changes;
}

/**
 * Update last_played_at timestamp for a playlist.
 */
export function markPlaylistPlayed(id: string): void {
  const database = getDatabase();
  database
    .prepare('UPDATE playlists SET last_played_at = ? WHERE id = ?')
    .run(Date.now(), id);
}

// ============================================================================
// Resume State Functions
// ============================================================================

export interface ResumeState {
  playlistId?: string;
  url?: string;
}

/**
 * Save the current resume state.
 * Call this when starting playback to enable resume-on-restart.
 */
export function saveResumeState(state: ResumeState): void {
  const database = getDatabase();
  database
    .prepare(
      `INSERT OR REPLACE INTO resume_state (id, playlist_id, url, updated_at)
       VALUES (1, ?, ?, ?)`
    )
    .run(state.playlistId ?? null, state.url ?? null, Date.now());
  logger.debug('Resume state saved', { playlistId: state.playlistId, url: state.url });
}

/**
 * Get the current resume state.
 * Returns null if no resume state is saved.
 */
export function getResumeState(): ResumeState | null {
  const database = getDatabase();
  const row = database
    .prepare('SELECT playlist_id, url FROM resume_state WHERE id = 1')
    .get() as { playlist_id: string | null; url: string | null } | undefined;

  if (!row || (!row.playlist_id && !row.url)) {
    return null;
  }

  return {
    playlistId: row.playlist_id ?? undefined,
    url: row.url ?? undefined,
  };
}

/**
 * Clear the resume state.
 * Call this when playback is explicitly stopped.
 */
export function clearResumeState(): void {
  const database = getDatabase();
  database.prepare('DELETE FROM resume_state WHERE id = 1').run();
  logger.debug('Resume state cleared');
}
