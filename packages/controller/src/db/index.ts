/**
 * SQLite database connection and utilities for the controller.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { createLogger, LIGHTS_CONFIG } from '@chiba/shared';
import { SCHEMA, CLEAR_EPHEMERAL, DROP_ALL, MIGRATIONS } from './schema.js';

const logger = createLogger('controller', 'db');

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

  return path.join(dataDir, 'controller.db');
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

  // Run migrations (these may fail if already applied, which is fine)
  for (const migration of MIGRATIONS) {
    try {
      db.exec(migration);
      logger.debug('Migration applied', { sql: migration.substring(0, 50) + '...' });
    } catch (err) {
      // Ignore errors (migration already applied)
      logger.debug('Migration skipped (likely already applied)', { sql: migration.substring(0, 50) + '...' });
    }
  }

  // Clear ephemeral data
  db.exec(CLEAR_EPHEMERAL);
  logger.debug('Ephemeral data cleared');

  // Sync lights from shared config (single source of truth)
  syncLightsFromConfig(db);

  return db;
}

/**
 * Sync lights from shared config.
 * This runs on every startup to ensure lights are always up-to-date.
 */
function syncLightsFromConfig(database: Database.Database): void {
  const { lights, port } = LIGHTS_CONFIG;
  const now = Date.now();

  const upsert = database.prepare(`
    INSERT INTO lights (id, name, ip_address, port, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      ip_address = excluded.ip_address,
      port = excluded.port,
      updated_at = excluded.updated_at
  `);

  const transaction = database.transaction(() => {
    for (const light of lights) {
      upsert.run(light.id, light.name, light.ip, port, now, now);
    }
  });

  transaction();
  logger.info('Synced lights from config', { count: lights.length });
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
}

/**
 * Create an in-memory database for testing.
 */
export function createTestDatabase(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(SCHEMA);
  return testDb;
}

/**
 * Generate a UUID v4.
 */
export function generateId(): string {
  return crypto.randomUUID();
}
