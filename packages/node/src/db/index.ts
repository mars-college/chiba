/**
 * SQLite database connection and utilities for the node.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { createLogger } from '@chiba/shared';
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
