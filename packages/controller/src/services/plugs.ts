/**
 * Service for controlling Kasa smart plugs via tplink-smarthome-api.
 */

import { Client } from 'tplink-smarthome-api';
import type TplinkPlug from 'tplink-smarthome-api/lib/plug/index.js';
import { createLogger } from '@chiba/shared';
import type { Plug, PlugState, PlugControlRequest, DiscoveredPlug, PlugDiscoveryResult } from '@chiba/shared';
import { getDatabase } from '../db/index.js';

const logger = createLogger('controller', 'plugs');

/** Singleton tplink client */
let client: InstanceType<typeof Client> | null = null;

function getClient(): InstanceType<typeof Client> {
  if (!client) {
    client = new Client();
  }
  return client;
}

// ============================================================================
// Discovery
// ============================================================================

/**
 * Discover Kasa plugs on the network.
 */
export async function discoverPlugs(timeout = 5000): Promise<DiscoveredPlug[]> {
  const c = getClient();
  const discovered: DiscoveredPlug[] = [];

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      c.stopDiscovery();
      logger.info('Plug discovery complete', { found: discovered.length });
      resolve(discovered);
    }, timeout);

    c.startDiscovery({
      deviceTypes: ['plug'],
      discoveryTimeout: 0,
    });

    c.on('plug-new', (plug: TplinkPlug) => {
      discovered.push({
        ip: plug.host,
        deviceId: plug.deviceId,
        alias: plug.alias || plug.host,
        model: plug.model,
      });
    });

    // Safety: also resolve if discoveryTimeout fires
    c.on('error', (err: Error) => {
      logger.warn('Discovery error', { error: err.message });
      clearTimeout(timer);
      c.stopDiscovery();
      resolve(discovered);
    });
  });
}

/**
 * Sync discovered plugs to the database (upsert by deviceId).
 */
export function syncDiscoveredPlugs(discovered: DiscoveredPlug[]): { added: number; updated: number } {
  const db = getDatabase();
  const now = Date.now();
  let added = 0;
  let updated = 0;

  const findByDeviceId = db.prepare('SELECT id, ip_address FROM plugs WHERE device_id = ?');
  const insertPlug = db.prepare(`
    INSERT INTO plugs (id, name, ip_address, host, device_id, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updatePlug = db.prepare(`
    UPDATE plugs SET ip_address = ?, host = ?, model = ?, updated_at = ? WHERE device_id = ?
  `);

  const transaction = db.transaction(() => {
    for (const plug of discovered) {
      const existing = findByDeviceId.get(plug.deviceId) as { id: string; ip_address: string } | undefined;

      if (existing) {
        if (existing.ip_address !== plug.ip) {
          updatePlug.run(plug.ip, plug.ip, plug.model, now, plug.deviceId);
          logger.info('Updated plug IP', { deviceId: plug.deviceId, oldIp: existing.ip_address, newIp: plug.ip });
          updated++;
        }
      } else {
        // Generate a short ID from alias
        const id = plug.alias.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `plug-${Date.now()}`;
        insertPlug.run(id, plug.alias, plug.ip, plug.ip, plug.deviceId, plug.model, now, now);
        logger.info('Added new plug', { id, alias: plug.alias, ip: plug.ip, model: plug.model });
        added++;
      }
    }
  });

  transaction();
  return { added, updated };
}

/**
 * Run discovery and sync results to database.
 */
export async function runPlugDiscovery(timeout = 5000): Promise<PlugDiscoveryResult> {
  const discovered = await discoverPlugs(timeout);
  const { added, updated } = syncDiscoveredPlugs(discovered);

  return {
    discovered: discovered.length,
    added,
    updated,
    plugs: discovered,
  };
}

// ============================================================================
// Control
// ============================================================================

/**
 * Set plug power state via tplink API.
 */
export async function setPlugPower(plug: Plug, on: boolean): Promise<void> {
  logger.info('Setting plug power', { plugId: plug.id, name: plug.name, on });

  const c = getClient();
  const device = c.getPlug({ host: plug.ipAddress });
  await device.setPowerState(on);
}

/**
 * Control a plug and persist state to database.
 */
export async function controlPlug(plug: Plug, request: PlugControlRequest): Promise<PlugState> {
  await setPlugPower(plug, request.power);

  const now = Date.now();
  const db = getDatabase();

  db.prepare(`
    INSERT INTO plug_state (plug_id, power, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(plug_id) DO UPDATE SET
      power = excluded.power,
      updated_at = excluded.updated_at
  `).run(plug.id, request.power ? 1 : 0, now);

  return {
    plugId: plug.id,
    power: request.power,
    updatedAt: now,
  };
}

// ============================================================================
// State Queries
// ============================================================================

/**
 * Query live plug state. Returns null if unreachable.
 */
export async function queryPlugState(plug: Plug): Promise<PlugState | null> {
  try {
    const c = getClient();
    const device = c.getPlug({ host: plug.ipAddress });
    const power = await device.getPowerState();
    const now = Date.now();

    return {
      plugId: plug.id,
      power,
      updatedAt: now,
    };
  } catch {
    return null;
  }
}

/**
 * Query and persist plug state.
 */
export async function refreshPlugState(plug: Plug): Promise<PlugState | null> {
  const state = await queryPlugState(plug);

  if (state) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO plug_state (plug_id, power, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(plug_id) DO UPDATE SET
        power = excluded.power,
        updated_at = excluded.updated_at
    `).run(plug.id, state.power ? 1 : 0, state.updatedAt);
  }

  return state;
}

/**
 * Refresh states for all plugs in parallel.
 */
export async function refreshAllPlugStates(): Promise<Map<string, PlugState | null>> {
  const plugs = getAllPlugs();
  const results = new Map<string, PlugState | null>();

  await Promise.all(
    plugs.map(async (plug) => {
      const state = await refreshPlugState(plug);
      results.set(plug.id, state);
    })
  );

  return results;
}

// ============================================================================
// CRUD
// ============================================================================

type PlugRow = {
  id: string;
  name: string;
  ip_address: string;
  host: string;
  device_id: string | null;
  model: string | null;
  created_at: number;
  updated_at: number;
};

function rowToPlug(row: PlugRow): Plug {
  return {
    id: row.id,
    name: row.name,
    ipAddress: row.ip_address,
    host: row.host,
    deviceId: row.device_id ?? undefined,
    model: row.model ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get a plug by ID or name (case-insensitive).
 */
export function getPlugById(plugId: string): Plug | null {
  const db = getDatabase();

  // Try exact ID match
  const byId = db.prepare('SELECT * FROM plugs WHERE id = ?').get(plugId) as PlugRow | undefined;
  if (byId) return rowToPlug(byId);

  // Try name match (case-insensitive)
  const byName = db.prepare('SELECT * FROM plugs WHERE LOWER(name) = LOWER(?)').get(plugId) as PlugRow | undefined;
  if (byName) return rowToPlug(byName);

  return null;
}

/**
 * Get all plugs from database.
 */
export function getAllPlugs(): Plug[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM plugs ORDER BY name').all() as PlugRow[];
  return rows.map(rowToPlug);
}

/**
 * Rename a plug.
 */
export function renamePlug(plugId: string, newName: string): Plug | null {
  const db = getDatabase();
  const now = Date.now();

  const existing = db.prepare('SELECT id FROM plugs WHERE id = ?').get(plugId);
  if (!existing) return null;

  db.prepare('UPDATE plugs SET name = ?, updated_at = ? WHERE id = ?').run(newName, now, plugId);
  return getPlugById(plugId);
}

/**
 * Delete a plug and its state/schedule.
 */
export function deletePlug(plugId: string): boolean {
  const db = getDatabase();

  const existing = db.prepare('SELECT id FROM plugs WHERE id = ?').get(plugId);
  if (!existing) return false;

  db.prepare('DELETE FROM plug_state WHERE plug_id = ?').run(plugId);
  db.prepare('DELETE FROM plug_schedules WHERE plug_id = ?').run(plugId);
  db.prepare('DELETE FROM plugs WHERE id = ?').run(plugId);

  return true;
}
