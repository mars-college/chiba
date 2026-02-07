/**
 * Service for controlling Kasa smart plugs via tplink-smarthome-api.
 */

import pkg from 'tplink-smarthome-api';
const { Client } = pkg;
import type TplinkPlug from 'tplink-smarthome-api/lib/plug/index.js';
import { createLogger } from '@chiba/shared';
import type { Plug, PlugState, PlugControlRequest, DiscoveredPlug, PlugDiscoveryResult } from '@chiba/shared';
import { loadPlugsConfig } from '@chiba/shared/utils/config';
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
 * Probe a single IP for a Kasa plug. Returns DiscoveredPlug or null if unreachable.
 */
export async function probePlugAt(ip: string, timeout = 3000): Promise<DiscoveredPlug | null> {
  try {
    const c = getClient();
    const device = c.getPlug({ host: ip, sysInfo: {} as any });
    const sysInfo = await Promise.race([
      device.getSysInfo(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout)),
    ]);
    return {
      ip,
      deviceId: sysInfo.deviceId || '',
      alias: sysInfo.alias || ip,
      model: sysInfo.model || '',
    };
  } catch {
    return null;
  }
}

/**
 * Scan a /24 subnet for Kasa plugs by probing each IP.
 * Batches in groups of 50 to avoid file descriptor limits.
 */
export async function scanSubnetForPlugs(subnet: string, timeout = 3000): Promise<DiscoveredPlug[]> {
  const discovered: DiscoveredPlug[] = [];
  const batchSize = 50;

  logger.info('Starting subnet scan for plugs', { subnet, timeout });

  for (let batchStart = 1; batchStart <= 254; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize - 1, 254);
    const batch: Promise<DiscoveredPlug | null>[] = [];

    for (let i = batchStart; i <= batchEnd; i++) {
      batch.push(probePlugAt(`${subnet}.${i}`, timeout));
    }

    const results = await Promise.all(batch);
    for (const result of results) {
      if (result) {
        discovered.push(result);
        logger.info('Found plug via subnet scan', { ip: result.ip, alias: result.alias, model: result.model });
      }
    }
  }

  logger.info('Subnet scan complete', { subnet, found: discovered.length });
  return discovered;
}

/**
 * Sync plugs from static config file (plugs.json) into the database.
 */
export function syncPlugsFromConfig(): { added: number; updated: number; total: number } {
  const config = loadPlugsConfig();

  if (!config) {
    logger.warn('Could not load plugs config - skipping sync');
    return { added: 0, updated: 0, total: 0 };
  }

  const db = getDatabase();
  const now = Date.now();
  let added = 0;
  let updated = 0;

  const findById = db.prepare('SELECT id, name, ip_address, device_id FROM plugs WHERE id = ?');
  const updatePlug = db.prepare(`
    UPDATE plugs SET name = ?, ip_address = ?, host = ?, device_id = COALESCE(?, device_id), model = COALESCE(?, model), updated_at = ?
    WHERE id = ?
  `);
  const insertPlug = db.prepare(`
    INSERT INTO plugs (id, name, ip_address, host, device_id, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    for (const plug of config.plugs) {
      const existing = findById.get(plug.id) as {
        id: string;
        name: string;
        ip_address: string;
        device_id: string | null;
      } | undefined;

      if (existing) {
        const deviceIdChanged = plug.deviceId && existing.device_id !== plug.deviceId;
        if (existing.name !== plug.name || existing.ip_address !== plug.ip || deviceIdChanged) {
          updatePlug.run(plug.name, plug.ip, plug.ip, plug.deviceId || null, plug.model || null, now, plug.id);
          logger.info('Updated plug from config', {
            id: plug.id,
            name: plug.name,
            oldIp: existing.ip_address,
            newIp: plug.ip,
          });
          updated++;
        }
      } else {
        insertPlug.run(plug.id, plug.name, plug.ip, plug.ip, plug.deviceId || null, plug.model || null, now, now);
        logger.info('Added plug from config', {
          id: plug.id,
          name: plug.name,
          ip: plug.ip,
        });
        added++;
      }
    }
  });

  transaction();

  logger.info('Plugs sync completed', { added, updated, total: config.plugs.length });
  return { added, updated, total: config.plugs.length };
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
 * When subnet is provided, uses unicast probing instead of broadcast.
 */
export async function runPlugDiscovery(timeout = 5000, subnet?: string): Promise<PlugDiscoveryResult> {
  const discovered = subnet
    ? await scanSubnetForPlugs(subnet, timeout)
    : await discoverPlugs(timeout);
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
  const device = c.getPlug({ host: plug.ipAddress, sysInfo: {} as any });
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
    const device = c.getPlug({ host: plug.ipAddress, sysInfo: {} as any });
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
