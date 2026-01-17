/**
 * Service for discovering Govee lights via LAN multicast.
 *
 * Govee LAN API uses:
 * - Multicast address: 239.255.255.250
 * - Scan send port: 4001
 * - Response receive port: 4002
 */

import dgram from 'dgram';
import { createLogger } from '@chiba/shared';
import type { DiscoveredLight, DiscoveryResult } from '@chiba/shared';
import { getDatabase, generateId } from '../db/index.js';

const logger = createLogger('controller', 'discovery');

const MULTICAST_ADDRESS = '239.255.255.250';
const SCAN_PORT = 4001;
const RESPONSE_PORT = 4002;
const DEFAULT_LIGHT_PORT = 4003;
const DEFAULT_TIMEOUT = 5000; // 5 seconds

/**
 * The scan message to send to discover Govee devices.
 */
const SCAN_MESSAGE = JSON.stringify({
  msg: {
    cmd: 'scan',
    data: {
      account_topic: 'reserve',
    },
  },
});

/**
 * Parse a Govee scan response message.
 */
interface GoveeScanResponse {
  msg: {
    cmd: 'scan';
    data: {
      ip: string;
      device: string; // Device ID like "AA:BB:CC:DD:EE:FF:GG:HH"
      sku: string; // Model like "H6061"
      bleVersionHard?: string;
      bleVersionSoft?: string;
      wifiVersionHard?: string;
      wifiVersionSoft?: string;
    };
  };
}

/**
 * Discover Govee lights on the local network via multicast scan.
 *
 * @param timeout - How long to wait for responses in milliseconds
 * @returns Array of discovered lights
 */
export function discoverLights(timeout = DEFAULT_TIMEOUT): Promise<DiscoveredLight[]> {
  return new Promise((resolve, reject) => {
    const discovered: Map<string, DiscoveredLight> = new Map();
    let socket: dgram.Socket | null = null;

    const cleanup = () => {
      if (socket) {
        try {
          socket.close();
        } catch {
          // Ignore close errors
        }
        socket = null;
      }
    };

    try {
      // Create UDP socket for receiving responses
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      socket.on('error', (err) => {
        logger.error('Discovery socket error', err);
        cleanup();
        reject(err);
      });

      socket.on('message', (msg, rinfo) => {
        try {
          const response = JSON.parse(msg.toString()) as GoveeScanResponse;

          if (response.msg?.cmd === 'scan' && response.msg?.data) {
            const { ip, device, sku } = response.msg.data;
            const lightIp = ip || rinfo.address;

            // Filter by subnet if GOVEE_SUBNET is configured
            const subnetFilter = process.env.GOVEE_SUBNET;
            if (subnetFilter && !lightIp.startsWith(subnetFilter)) {
              logger.debug('Ignoring light outside subnet', { ip: lightIp, filter: subnetFilter });
              return;
            }

            if (device && sku) {
              // Use device ID as key to deduplicate
              discovered.set(device, {
                ip: lightIp,
                deviceId: device,
                sku,
              });
              logger.debug('Discovered light', { ip: lightIp, deviceId: device, sku });
            }
          }
        } catch (err) {
          logger.debug('Failed to parse discovery response', { error: (err as Error).message });
        }
      });

      // Bind to the response port
      socket.bind(RESPONSE_PORT, () => {
        logger.info('Discovery socket bound', { port: RESPONSE_PORT });

        // Create a separate socket for sending the scan message
        const sendSocket = dgram.createSocket('udp4');

        sendSocket.on('error', (err) => {
          logger.error('Send socket error', err);
          sendSocket.close();
        });

        // Send the scan message to the multicast address
        sendSocket.send(SCAN_MESSAGE, SCAN_PORT, MULTICAST_ADDRESS, (err) => {
          if (err) {
            logger.error('Failed to send scan message', err);
          } else {
            logger.info('Scan message sent', { address: MULTICAST_ADDRESS, port: SCAN_PORT });
          }
          sendSocket.close();
        });
      });

      // Set timeout to collect responses
      setTimeout(() => {
        cleanup();
        const results = Array.from(discovered.values());
        logger.info('Discovery completed', { found: results.length });
        resolve(results);
      }, timeout);
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

/**
 * Sync discovered lights to the database.
 * - If a device_id is found, update the IP address
 * - If a device_id is not found, insert a new light
 *
 * @param discovered - Array of discovered lights
 * @returns Counts of added and updated lights
 */
export function syncDiscoveredLights(discovered: DiscoveredLight[]): { added: number; updated: number } {
  const db = getDatabase();
  const now = Date.now();
  let added = 0;
  let updated = 0;

  const findByDeviceId = db.prepare('SELECT id, name, ip_address FROM lights WHERE device_id = ?');
  const updateLight = db.prepare(`
    UPDATE lights SET ip_address = ?, sku = ?, updated_at = ?
    WHERE device_id = ?
  `);
  const insertLight = db.prepare(`
    INSERT INTO lights (id, name, ip_address, port, device_id, sku, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    for (const light of discovered) {
      const existing = findByDeviceId.get(light.deviceId) as {
        id: string;
        name: string;
        ip_address: string;
      } | undefined;

      if (existing) {
        // Update IP if it changed
        if (existing.ip_address !== light.ip) {
          updateLight.run(light.ip, light.sku, now, light.deviceId);
          logger.info('Updated light IP', {
            id: existing.id,
            name: existing.name,
            oldIp: existing.ip_address,
            newIp: light.ip,
          });
        } else {
          // Just update SKU and timestamp
          updateLight.run(light.ip, light.sku, now, light.deviceId);
        }
        updated++;
      } else {
        // Insert new light with default name
        const id = generateId();
        const name = `Light (${light.sku})`;
        insertLight.run(id, name, light.ip, DEFAULT_LIGHT_PORT, light.deviceId, light.sku, now, now);
        logger.info('Added new light', { id, name, ip: light.ip, deviceId: light.deviceId, sku: light.sku });
        added++;
      }
    }
  });

  transaction();

  return { added, updated };
}

/**
 * Run a full discovery scan and sync results to the database.
 *
 * @param timeout - How long to wait for responses in milliseconds
 * @returns Discovery result with counts
 */
export async function runDiscovery(timeout = DEFAULT_TIMEOUT): Promise<DiscoveryResult> {
  logger.info('Starting light discovery', { timeout });

  const lights = await discoverLights(timeout);
  const { added, updated } = syncDiscoveredLights(lights);

  return {
    discovered: lights.length,
    added,
    updated,
    lights,
  };
}
