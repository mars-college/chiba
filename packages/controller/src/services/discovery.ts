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
import { isCloudConfigured, cloudListDevices } from './govee-cloud.js';

const logger = createLogger('controller', 'discovery');

const MULTICAST_ADDRESS = '239.255.255.250';
const SCAN_PORT = 4001;
const RESPONSE_PORT = 4002;
const DEFAULT_LIGHT_PORT = 4003;
const DEFAULT_TIMEOUT = 5000; // 5 seconds
const SCAN_ATTEMPTS = 3; // Number of multicast scan attempts
const SCAN_ATTEMPT_DELAY = 1000; // Delay between scan attempts (ms)
const PROBE_TIMEOUT = 2000; // Timeout for direct probe (ms)
const AUTO_DISCOVERY_INTERVAL = 30 * 60 * 1000; // 30 minutes

let autoDiscoveryTimer: ReturnType<typeof setInterval> | null = null;

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
 * Send a single multicast scan request.
 * Matches the Python implementation: sends to multicast with TTL=2 and also broadcasts.
 */
function sendScanRequest(): void {
  // Send to multicast address with proper TTL
  // Need to bind first before setting socket options
  const sendSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sendSocket.on('error', (err) => {
    logger.debug('Send socket error', { error: err.message });
    try { sendSocket.close(); } catch { /* ignore */ }
  });

  // Bind to any port, then set multicast TTL and send
  sendSocket.bind(0, () => {
    try {
      sendSocket.setMulticastTTL(2);
    } catch (err) {
      logger.debug('Could not set multicast TTL', { error: (err as Error).message });
    }

    sendSocket.send(SCAN_MESSAGE, SCAN_PORT, MULTICAST_ADDRESS, (err) => {
      if (err) {
        logger.debug('Failed to send multicast scan', { error: err.message });
      } else {
        logger.debug('Multicast scan sent', { address: MULTICAST_ADDRESS, port: SCAN_PORT });
      }
      try { sendSocket.close(); } catch { /* ignore */ }
    });
  });

  // Also send broadcast (like Python script does)
  const bcastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  bcastSocket.on('error', () => {
    try { bcastSocket.close(); } catch { /* ignore */ }
  });

  bcastSocket.bind(0, () => {
    try {
      bcastSocket.setBroadcast(true);
    } catch {
      // Ignore broadcast setup errors
    }
    bcastSocket.send(SCAN_MESSAGE, SCAN_PORT, '255.255.255.255', (err) => {
      if (err) {
        logger.debug('Failed to send broadcast scan', { error: err.message });
      } else {
        logger.debug('Broadcast scan sent');
      }
      try { bcastSocket.close(); } catch { /* ignore */ }
    });
  });
}

/**
 * Discover Govee lights on the local network via multicast scan.
 * Matches Python implementation: joins multicast group, sends multiple attempts.
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
          // Leave multicast group before closing
          socket.dropMembership(MULTICAST_ADDRESS);
        } catch {
          // Ignore - might not have joined
        }
        try {
          socket.close();
        } catch {
          // Ignore close errors
        }
        socket = null;
      }
    };

    try {
      // Create UDP socket for receiving responses (match Python: reuseAddr + reusePort equivalent)
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
              if (!discovered.has(device)) {
                discovered.set(device, {
                  ip: lightIp,
                  deviceId: device,
                  sku,
                });
                logger.info('Discovered light', { ip: lightIp, deviceId: device, sku });
              }
            }
          }
        } catch (err) {
          logger.debug('Failed to parse discovery response', { error: (err as Error).message });
        }
      });

      // Bind to the response port on all interfaces ('' = INADDR_ANY, like Python)
      socket.bind(RESPONSE_PORT, '', () => {
        logger.info('Discovery socket bound', { port: RESPONSE_PORT });

        // Join multicast group to receive responses (like Python script)
        try {
          socket!.addMembership(MULTICAST_ADDRESS);
          logger.debug('Joined multicast group', { address: MULTICAST_ADDRESS });
        } catch (err) {
          logger.warn('Could not join multicast group', { error: (err as Error).message });
        }

        // Send multiple scan requests for better reliability
        logger.info('Sending scan requests', { attempts: SCAN_ATTEMPTS, timeout });
        sendScanRequest();
        for (let i = 1; i < SCAN_ATTEMPTS; i++) {
          setTimeout(() => sendScanRequest(), i * SCAN_ATTEMPT_DELAY);
        }
      });

      // Set timeout to collect responses
      setTimeout(() => {
        cleanup();
        const results = Array.from(discovered.values());
        logger.info('Multicast discovery completed', { found: results.length });
        resolve(results);
      }, timeout);
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

/**
 * Directly probe a specific IP address to check if a Govee light is there.
 * This is useful when multicast doesn't work (e.g., across VLANs or Tailscale).
 *
 * Uses unicast scan command to port 4001, listens for response on port 4002.
 * Note: Govee lights ALWAYS respond to port 4002 regardless of source port.
 *
 * @param ip - IP address to probe
 * @param timeout - Timeout in milliseconds
 * @returns Discovered light info or null if not found
 */
export function probeLight(ip: string, timeout = PROBE_TIMEOUT): Promise<DiscoveredLight | null> {
  return new Promise((resolve) => {
    // Govee lights always respond to port 4002, so we must listen there
    const listenSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        try { listenSocket.close(); } catch { /* ignore */ }
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeout);

    listenSocket.on('error', (err) => {
      logger.debug('Probe listen error', { ip, error: err.message });
      clearTimeout(timer);
      cleanup();
      resolve(null);
    });

    listenSocket.on('message', (msg, rinfo) => {
      // Only accept response from the IP we probed
      if (rinfo.address !== ip) return;

      clearTimeout(timer);

      try {
        const response = JSON.parse(msg.toString()) as GoveeScanResponse;

        if (response.msg?.cmd === 'scan' && response.msg?.data) {
          const { device, sku } = response.msg.data;
          const lightIp = response.msg.data.ip || ip;
          if (device && sku) {
            cleanup();
            resolve({ ip: lightIp, deviceId: device, sku });
            return;
          }
        }
      } catch {
        // Ignore parse errors
      }
    });

    // Must bind to port 4002 - Govee lights always respond there
    listenSocket.bind(RESPONSE_PORT, () => {
      // Send scan command to port 4001 (unicast, not multicast)
      const sendSocket = dgram.createSocket('udp4');
      sendSocket.send(SCAN_MESSAGE, SCAN_PORT, ip, (err) => {
        sendSocket.close();
        if (err) {
          logger.debug('Probe send error', { ip, error: err.message });
          clearTimeout(timer);
          cleanup();
          resolve(null);
        }
      });
    });
  });
}

/**
 * Probe multiple IPs in parallel.
 *
 * @param ips - Array of IP addresses to probe
 * @param timeout - Timeout per probe
 * @returns Array of discovered lights
 */
export async function probeLights(ips: string[], timeout = PROBE_TIMEOUT): Promise<DiscoveredLight[]> {
  const results = await Promise.all(ips.map(ip => probeLight(ip, timeout)));
  return results.filter((r): r is DiscoveredLight => r !== null);
}

/**
 * Scan an entire subnet by probing all 254 IPs.
 * This is useful when multicast doesn't work (e.g., across VLANs or different subnets).
 *
 * Since Govee lights always respond to port 4002, we use a single listener
 * and send scans to all IPs, then collect responses.
 *
 * @param subnet - Subnet prefix (e.g., "100.128.0" for 100.128.0.1-254)
 * @param timeout - Total timeout in ms (default: 5000)
 * @returns Array of discovered lights
 */
export function scanSubnet(
  subnet: string,
  timeout = 5000
): Promise<DiscoveredLight[]> {
  return new Promise((resolve) => {
    const discovered: Map<string, DiscoveredLight> = new Map();

    // Generate all IPs in the /24 subnet
    const ips: string[] = [];
    for (let i = 1; i <= 254; i++) {
      ips.push(`${subnet}.${i}`);
    }

    logger.info('Scanning subnet', { subnet, count: ips.length, timeout });

    // Create listener on port 4002
    const listenSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const cleanup = () => {
      try { listenSocket.close(); } catch { /* ignore */ }
    };

    listenSocket.on('error', (err) => {
      logger.error('Subnet scan listen error', err);
      cleanup();
      resolve([]);
    });

    listenSocket.on('message', (msg, rinfo) => {
      try {
        const response = JSON.parse(msg.toString()) as GoveeScanResponse;

        if (response.msg?.cmd === 'scan' && response.msg?.data) {
          const { device, sku, ip } = response.msg.data;
          const lightIp = ip || rinfo.address;

          if (device && sku && !discovered.has(device)) {
            discovered.set(device, { ip: lightIp, deviceId: device, sku });
            logger.info('Found light via subnet scan', { ip: lightIp, deviceId: device, sku });
          }
        }
      } catch {
        // Ignore parse errors
      }
    });

    // Bind to port 4002 and start scanning
    listenSocket.bind(RESPONSE_PORT, () => {
      logger.debug('Subnet scan listening on port', { port: RESPONSE_PORT });

      // Send scan to all IPs with small delays to avoid flooding
      const sendSocket = dgram.createSocket('udp4');
      let sent = 0;

      const sendNext = () => {
        if (sent >= ips.length) {
          sendSocket.close();
          return;
        }

        const ip = ips[sent];
        sendSocket.send(SCAN_MESSAGE, SCAN_PORT, ip, (err) => {
          if (err) {
            logger.debug('Failed to send scan', { ip, error: err.message });
          }
        });
        sent++;

        // Small delay between sends (2ms = ~500 packets/sec)
        if (sent < ips.length) {
          setTimeout(sendNext, 2);
        } else {
          sendSocket.close();
        }
      };

      sendNext();
    });

    // Wait for timeout then return results
    setTimeout(() => {
      cleanup();
      const results = Array.from(discovered.values());
      logger.info('Subnet scan completed', { subnet, found: results.length });
      resolve(results);
    }, timeout);
  });
}

/**
 * Sync discovered lights to the database.
 * - If a device_id is found, update the IP address
 * - If a device_id is not found, insert a new light
 * - If prune is true, delete lights not found in discovery
 *
 * @param discovered - Array of discovered lights
 * @param prune - If true, delete lights not found in discovery
 * @returns Counts of added, updated, and pruned lights
 */
export function syncDiscoveredLights(discovered: DiscoveredLight[], prune = false): { added: number; updated: number; pruned: number } {
  const db = getDatabase();
  const now = Date.now();
  let added = 0;
  let updated = 0;
  let pruned = 0;

  const findByDeviceId = db.prepare('SELECT id, name, ip_address FROM lights WHERE device_id = ?');
  const updateLight = db.prepare(`
    UPDATE lights SET ip_address = ?, sku = ?, updated_at = ?
    WHERE device_id = ?
  `);
  const insertLight = db.prepare(`
    INSERT INTO lights (id, name, ip_address, port, device_id, sku, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteLight = db.prepare('DELETE FROM lights WHERE device_id = ?');
  const getAllLights = db.prepare('SELECT id, name, device_id FROM lights WHERE device_id IS NOT NULL');

  const discoveredDeviceIds = new Set(discovered.map(l => l.deviceId));

  const transaction = db.transaction(() => {
    for (const light of discovered) {
      const existing = findByDeviceId.get(light.deviceId) as {
        id: string;
        name: string;
        ip_address: string;
      } | undefined;

      if (existing) {
        // Update IP if it changed (but don't overwrite a known IP with empty string)
        const newIp = light.ip || existing.ip_address;
        if (existing.ip_address !== newIp) {
          updateLight.run(newIp, light.sku, now, light.deviceId);
          logger.info('Updated light IP', {
            id: existing.id,
            name: existing.name,
            oldIp: existing.ip_address,
            newIp,
          });
        } else {
          // Just update SKU and timestamp
          updateLight.run(newIp, light.sku, now, light.deviceId);
        }
        updated++;
      } else {
        // Insert new light - prefer cloud-provided name, fall back to generic
        const id = generateId();
        const name = light.name || `Light (${light.sku})`;
        insertLight.run(id, name, light.ip, DEFAULT_LIGHT_PORT, light.deviceId, light.sku, now, now);
        logger.info('Added new light', { id, name, ip: light.ip, deviceId: light.deviceId, sku: light.sku });
        added++;
      }
    }

    // Prune lights not found in discovery
    if (prune) {
      const allLights = getAllLights.all() as Array<{ id: string; name: string; device_id: string }>;
      for (const light of allLights) {
        if (!discoveredDeviceIds.has(light.device_id)) {
          deleteLight.run(light.device_id);
          logger.info('Pruned light not found in discovery', { id: light.id, name: light.name, deviceId: light.device_id });
          pruned++;
        }
      }
    }
  });

  transaction();

  return { added, updated, pruned };
}

/**
 * Run a full discovery scan and sync results to the database.
 * Uses multiple methods for better reliability:
 * 1. Multicast scan (sends multiple requests) - skipped if subnet provided
 * 2. Subnet scan via direct UDP probes (if subnet provided)
 * 3. Direct probe of known lights that weren't found via multicast
 *
 * @param timeout - How long to wait for responses in milliseconds
 * @param subnet - Optional subnet to scan (e.g., "100.128.0" for 100.128.0.1-254)
 * @param prune - If true, delete lights not found in discovery
 * @returns Discovery result with counts
 */
export async function runDiscovery(timeout = DEFAULT_TIMEOUT, subnet?: string, prune = false): Promise<DiscoveryResult> {
  logger.info('Starting light discovery', { timeout, subnet, prune });

  let initialLights: DiscoveredLight[] = [];

  // Step 0: Try cloud device listing first (provides device names)
  if (isCloudConfigured()) {
    try {
      const cloudDevices = await cloudListDevices();
      if (cloudDevices.length > 0) {
        // Look up existing IPs from DB (cloud doesn't provide IPs)
        const db = getDatabase();
        const existingLights = db.prepare(`
          SELECT ip_address, device_id FROM lights WHERE device_id IS NOT NULL
        `).all() as Array<{ ip_address: string; device_id: string }>;
        const ipByDeviceId = new Map(existingLights.map(l => [l.device_id, l.ip_address]));

        initialLights = cloudDevices.map(d => ({
          ip: ipByDeviceId.get(d.device) || '',
          deviceId: d.device,
          sku: d.sku,
          name: d.deviceName,
        }));
        logger.info('Cloud discovery found devices', { count: initialLights.length });
      }
    } catch (err) {
      logger.warn('Cloud device listing failed, falling back to LAN discovery', { error: (err as Error).message });
    }
  }

  // Step 1: LAN discovery (subnet scan or multicast)
  // Run LAN scan to discover IPs even if cloud found devices
  let lanLights: DiscoveredLight[] = [];
  if (subnet) {
    lanLights = await scanSubnet(subnet, PROBE_TIMEOUT);
    logger.info('Subnet scan found lights', { count: lanLights.length });
  } else {
    lanLights = await discoverLights(timeout);
    logger.info('Multicast scan found lights', { count: lanLights.length });
  }

  // Merge LAN results into cloud results (LAN provides IPs)
  if (initialLights.length > 0 && lanLights.length > 0) {
    const lanByDeviceId = new Map(lanLights.map(l => [l.deviceId, l]));
    for (const light of initialLights) {
      const lanMatch = lanByDeviceId.get(light.deviceId);
      if (lanMatch) {
        light.ip = lanMatch.ip; // LAN IP takes precedence
      }
    }
    // Add any LAN-only lights not found in cloud
    const cloudDeviceIds = new Set(initialLights.map(l => l.deviceId));
    for (const lanLight of lanLights) {
      if (!cloudDeviceIds.has(lanLight.deviceId)) {
        initialLights.push(lanLight);
      }
    }
  } else if (initialLights.length === 0) {
    initialLights = lanLights;
  }

  const discoveredDeviceIds = new Set(initialLights.map(l => l.deviceId));

  // Step 2: Get known lights from database that weren't found via multicast
  const db = getDatabase();
  const knownLights = db.prepare(`
    SELECT ip_address, device_id FROM lights
    WHERE device_id IS NOT NULL AND device_id != ''
  `).all() as Array<{ ip_address: string; device_id: string }>;

  const missingLights = knownLights.filter(l => !discoveredDeviceIds.has(l.device_id));

  // Step 3: Direct probe missing lights at their last known IP
  let probedLights: DiscoveredLight[] = [];
  if (missingLights.length > 0) {
    logger.info('Probing missing lights at last known IPs', {
      count: missingLights.length,
      ips: missingLights.map(l => l.ip_address)
    });
    probedLights = await probeLights(missingLights.map(l => l.ip_address));
    logger.info('Direct probe found lights', { count: probedLights.length });
  }

  // Combine results (initial scan results take precedence for IP updates)
  let allLights = [...initialLights];
  for (const probed of probedLights) {
    if (!discoveredDeviceIds.has(probed.deviceId)) {
      allLights.push(probed);
      discoveredDeviceIds.add(probed.deviceId);
    }
  }

  // Apply GOVEE_SUBNET filter to lights that have IPs.
  // Cloud-only devices (no IP) are kept — they're from our account and controllable via cloud API.
  // Only filter out devices whose known IP belongs to a different subnet.
  const subnetFilter = process.env.GOVEE_SUBNET;
  if (subnetFilter) {
    const before = allLights.length;
    allLights = allLights.filter(l => !l.ip || l.ip.startsWith(subnetFilter));
    if (allLights.length < before) {
      logger.info('Filtered discovery results by subnet', { subnet: subnetFilter, before, after: allLights.length });
    }
  }

  const { added, updated, pruned } = syncDiscoveredLights(allLights, prune);

  return {
    discovered: allLights.length,
    added,
    updated,
    pruned,
    lights: allLights,
  };
}

/**
 * Start automatic discovery at a regular interval.
 * @param interval - Interval in milliseconds (default: 30 minutes)
 */
export function startAutoDiscovery(interval = AUTO_DISCOVERY_INTERVAL): void {
  if (autoDiscoveryTimer) {
    logger.warn('Auto-discovery already running');
    return;
  }

  logger.info('Starting auto-discovery', { intervalMinutes: interval / 60000 });

  // Run initial discovery
  runDiscovery().catch(err => {
    logger.error('Auto-discovery failed', err as Error);
  });

  // Schedule periodic discovery
  autoDiscoveryTimer = setInterval(() => {
    logger.info('Running scheduled auto-discovery');
    runDiscovery().catch(err => {
      logger.error('Auto-discovery failed', err as Error);
    });
  }, interval);
}

/**
 * Remove lights from the database whose IP doesn't match the given subnet prefix.
 * Used on startup to ensure each controller only manages its own lights.
 * Lights with no IP or empty IP are also removed (can't determine location).
 *
 * @param subnetPrefix - IP prefix to keep (e.g., "100.128" or "10.")
 * @returns Number of lights removed
 */
export function pruneBySubnet(subnetPrefix: string): number {
  const db = getDatabase();

  // Find lights whose IP is set but doesn't match the subnet.
  // Lights with empty IP (cloud-only, no LAN IP yet) are kept.
  const toRemove = db.prepare(`
    SELECT id, name, ip_address, device_id FROM lights
    WHERE ip_address != '' AND ip_address NOT LIKE ?
  `).all(`${subnetPrefix}%`) as Array<{ id: string; name: string; ip_address: string; device_id: string | null }>;

  if (toRemove.length === 0) return 0;

  // light_state has ON DELETE CASCADE, so deleting from lights cleans up state too
  const deleteStmt = db.prepare('DELETE FROM lights WHERE id = ?');
  const transaction = db.transaction(() => {
    for (const light of toRemove) {
      deleteStmt.run(light.id);
      logger.info('Pruned out-of-subnet light', { id: light.id, name: light.name, ip: light.ip_address, subnet: subnetPrefix });
    }
  });
  transaction();

  return toRemove.length;
}

/**
 * Stop automatic discovery.
 */
export function stopAutoDiscovery(): void {
  if (autoDiscoveryTimer) {
    clearInterval(autoDiscoveryTimer);
    autoDiscoveryTimer = null;
    logger.info('Auto-discovery stopped');
  }
}
