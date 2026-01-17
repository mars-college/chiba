/**
 * Service for controlling Govee lights via UDP LAN API.
 */

import dgram from 'dgram';
import { createLogger } from '@chiba/shared';
import type { Light, LightState, LightControlRequest } from '@chiba/shared';
import { getDatabase } from '../db/index.js';

const logger = createLogger('controller', 'lights');

const UDP_TIMEOUT = 2000; // 2 seconds

/**
 * Convert HSB to RGB (Govee uses RGB internally).
 */
export function hsbToRgb(
  h: number,
  s: number,
  b: number
): { r: number; g: number; b: number } {
  const saturation = s / 100;
  const brightness = b / 100;
  const hue = h / 360;

  let r = 0,
    g = 0,
    bl = 0;

  if (saturation === 0) {
    r = g = bl = brightness;
  } else {
    const i = Math.floor(hue * 6);
    const f = hue * 6 - i;
    const p = brightness * (1 - saturation);
    const q = brightness * (1 - f * saturation);
    const t = brightness * (1 - (1 - f) * saturation);

    switch (i % 6) {
      case 0:
        r = brightness;
        g = t;
        bl = p;
        break;
      case 1:
        r = q;
        g = brightness;
        bl = p;
        break;
      case 2:
        r = p;
        g = brightness;
        bl = t;
        break;
      case 3:
        r = p;
        g = q;
        bl = brightness;
        break;
      case 4:
        r = t;
        g = p;
        bl = brightness;
        break;
      case 5:
        r = brightness;
        g = p;
        bl = q;
        break;
    }
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(bl * 255),
  };
}

/**
 * Send a UDP command to a Govee light.
 */
async function sendGoveeCommand(
  ip: string,
  port: number,
  cmd: string,
  data: Record<string, unknown>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const message = JSON.stringify({ msg: { cmd, data } });

    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('UDP timeout'));
    }, UDP_TIMEOUT);

    socket.send(message, port, ip, (err) => {
      clearTimeout(timeout);
      socket.close();
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Set light power state.
 */
export async function setLightPower(light: Light, on: boolean): Promise<void> {
  logger.info('Setting light power', { lightId: light.id, name: light.name, on });
  await sendGoveeCommand(light.ipAddress, light.port, 'turn', { value: on ? 1 : 0 });
}

/**
 * Set light brightness.
 */
export async function setLightBrightness(light: Light, brightness: number): Promise<void> {
  logger.info('Setting light brightness', { lightId: light.id, brightness });
  await sendGoveeCommand(light.ipAddress, light.port, 'brightness', { value: brightness });
}

/**
 * Set light color using HSB values.
 */
export async function setLightColor(
  light: Light,
  hue: number,
  saturation: number,
  brightness: number
): Promise<void> {
  logger.info('Setting light color', { lightId: light.id, hue, saturation, brightness });
  const rgb = hsbToRgb(hue, saturation, brightness);
  await sendGoveeCommand(light.ipAddress, light.port, 'colorwc', {
    color: rgb,
    colorTemInKelvin: 0,
  });
}

/**
 * Set light color temperature in Kelvin.
 */
export async function setLightTemperature(light: Light, kelvin: number): Promise<void> {
  logger.info('Setting light temperature', { lightId: light.id, kelvin });
  await sendGoveeCommand(light.ipAddress, light.port, 'colorwc', {
    color: { r: 0, g: 0, b: 0 },
    colorTemInKelvin: Math.max(2000, Math.min(9000, kelvin)),
  });
}

/**
 * Apply a control request to a light.
 * Returns the updated state.
 */
export async function controlLight(
  light: Light,
  request: LightControlRequest
): Promise<LightState> {
  const db = getDatabase();

  // Get current state
  let currentState = db
    .prepare('SELECT * FROM light_state WHERE light_id = ?')
    .get(light.id) as
    | {
        power: number;
        hue: number;
        saturation: number;
        brightness: number;
        kelvin: number | null;
      }
    | undefined;

  if (!currentState) {
    currentState = { power: 0, hue: 0, saturation: 100, brightness: 100, kelvin: null };
  }

  // Apply power if specified
  if (request.power !== undefined) {
    await setLightPower(light, request.power);
    currentState.power = request.power ? 1 : 0;
  }

  // Apply color/brightness if specified
  const hue = request.hue ?? currentState.hue;
  const saturation = request.saturation ?? currentState.saturation;
  const brightness = request.brightness ?? currentState.brightness;
  let kelvin: number | undefined = currentState.kelvin ?? undefined;

  if (request.kelvin !== undefined) {
    // Color temperature mode - use kelvin
    await setLightTemperature(light, request.kelvin);
    kelvin = request.kelvin;
    // Also set brightness if specified
    if (request.brightness !== undefined) {
      await setLightBrightness(light, brightness);
    }
  } else if (request.hue !== undefined || request.saturation !== undefined) {
    // Color change - use colorwc which sets RGB
    // Clear kelvin since we're now in color mode
    kelvin = undefined;
    await setLightColor(light, hue, saturation, brightness);
  } else if (request.brightness !== undefined) {
    // Brightness only change
    await setLightBrightness(light, brightness);
  }

  // Update state in database
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO light_state (light_id, power, hue, saturation, brightness, kelvin, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(light_id) DO UPDATE SET
      power = excluded.power,
      hue = excluded.hue,
      saturation = excluded.saturation,
      brightness = excluded.brightness,
      kelvin = excluded.kelvin,
      updated_at = excluded.updated_at
  `
  ).run(light.id, currentState.power, hue, saturation, brightness, kelvin ?? null, now);

  return {
    lightId: light.id,
    power: Boolean(currentState.power),
    hue,
    saturation,
    brightness,
    kelvin,
    updatedAt: now,
  };
}

/**
 * Convert RGB to HSB.
 */
export function rgbToHsb(
  r: number,
  g: number,
  b: number
): { h: number; s: number; b: number } {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;

  let h = 0;
  const s = max === 0 ? 0 : (diff / max) * 100;
  const br = max * 100;

  if (diff !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / diff) % 6;
        break;
      case g:
        h = (b - r) / diff + 2;
        break;
      case b:
        h = (r - g) / diff + 4;
        break;
    }
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }

  return { h, s: Math.round(s), b: Math.round(br) };
}

/**
 * Probe a light to check if it's reachable.
 * Sends a devStatus command and waits for response.
 */
export async function probeLightStatus(light: Light): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const message = JSON.stringify({ msg: { cmd: 'devStatus', data: {} } });

    const timeout = setTimeout(() => {
      socket.close();
      resolve(false);
    }, UDP_TIMEOUT);

    socket.on('message', () => {
      clearTimeout(timeout);
      socket.close();
      resolve(true);
    });

    socket.send(message, light.port, light.ipAddress, (err) => {
      if (err) {
        clearTimeout(timeout);
        socket.close();
        resolve(false);
      }
    });
  });
}

interface GoveeDevStatusResponse {
  msg: {
    cmd: string;
    data: {
      onOff: number;
      brightness: number;
      color: { r: number; g: number; b: number };
      colorTemInKelvin: number;
    };
  };
}

/**
 * Query actual light state via UDP devStatus command.
 * Returns null if light is unreachable.
 */
export async function queryLightState(light: Light): Promise<LightState | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const message = JSON.stringify({ msg: { cmd: 'devStatus', data: {} } });

    const timeout = setTimeout(() => {
      socket.close();
      resolve(null);
    }, UDP_TIMEOUT);

    socket.on('message', (msg) => {
      clearTimeout(timeout);
      socket.close();

      try {
        const response = JSON.parse(msg.toString()) as GoveeDevStatusResponse;
        const data = response.msg?.data;

        if (!data) {
          resolve(null);
          return;
        }

        const now = Date.now();
        const kelvin = data.colorTemInKelvin || 0;

        // If kelvin is set, light is in temperature mode
        // Otherwise convert RGB to HSB
        let hue = 0;
        let saturation = 100;
        let brightness = data.brightness ?? 100;

        if (kelvin === 0 && data.color) {
          const hsb = rgbToHsb(data.color.r, data.color.g, data.color.b);
          hue = hsb.h;
          saturation = hsb.s;
          // Use brightness from response, not derived from color
        }

        resolve({
          lightId: light.id,
          power: Boolean(data.onOff),
          hue,
          saturation,
          brightness,
          kelvin: kelvin > 0 ? kelvin : undefined,
          updatedAt: now,
        });
      } catch {
        resolve(null);
      }
    });

    socket.send(message, light.port, light.ipAddress, (err) => {
      if (err) {
        clearTimeout(timeout);
        socket.close();
        resolve(null);
      }
    });
  });
}

/**
 * Query and persist light state. Updates the database with fresh state.
 */
export async function refreshLightState(light: Light): Promise<LightState | null> {
  const state = await queryLightState(light);

  if (state) {
    const db = getDatabase();
    db.prepare(
      `
      INSERT INTO light_state (light_id, power, hue, saturation, brightness, kelvin, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(light_id) DO UPDATE SET
        power = excluded.power,
        hue = excluded.hue,
        saturation = excluded.saturation,
        brightness = excluded.brightness,
        kelvin = excluded.kelvin,
        updated_at = excluded.updated_at
    `
    ).run(light.id, state.power ? 1 : 0, state.hue, state.saturation, state.brightness, state.kelvin ?? null, state.updatedAt);
  }

  return state;
}

/**
 * Refresh states for all lights in parallel.
 */
export async function refreshAllLightStates(): Promise<Map<string, LightState | null>> {
  const lights = getAllLights();
  const results = new Map<string, LightState | null>();

  await Promise.all(
    lights.map(async (light) => {
      const state = await refreshLightState(light);
      results.set(light.id, state);
    })
  );

  return results;
}

/**
 * Get a light by ID from database.
 */
export function getLightById(lightId: string): Light | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM lights WHERE id = ?').get(lightId) as
    | {
        id: string;
        name: string;
        ip_address: string;
        port: number;
        device_id: string | null;
        sku: string | null;
        device_type: string | null;
        created_at: number;
        updated_at: number;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    ipAddress: row.ip_address,
    port: row.port,
    deviceId: row.device_id ?? undefined,
    sku: row.sku ?? undefined,
    deviceType: row.device_type ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get all lights from database.
 */
export function getAllLights(): Light[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM lights ORDER BY name').all() as Array<{
    id: string;
    name: string;
    ip_address: string;
    port: number;
    device_id: string | null;
    sku: string | null;
    device_type: string | null;
    created_at: number;
    updated_at: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    ipAddress: row.ip_address,
    port: row.port,
    deviceId: row.device_id ?? undefined,
    sku: row.sku ?? undefined,
    deviceType: row.device_type ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Rename a light.
 */
export function renameLight(lightId: string, newName: string): Light | null {
  const db = getDatabase();
  const now = Date.now();

  const existing = db.prepare('SELECT id FROM lights WHERE id = ?').get(lightId);
  if (!existing) return null;

  db.prepare('UPDATE lights SET name = ?, updated_at = ? WHERE id = ?').run(newName, now, lightId);

  return getLightById(lightId);
}

/**
 * Delete a light and its state.
 */
export function deleteLight(lightId: string): boolean {
  const db = getDatabase();

  const existing = db.prepare('SELECT id FROM lights WHERE id = ?').get(lightId);
  if (!existing) return false;

  // Delete light state first (cascade should handle this, but be explicit)
  db.prepare('DELETE FROM light_state WHERE light_id = ?').run(lightId);

  // Delete the light
  db.prepare('DELETE FROM lights WHERE id = ?').run(lightId);

  return true;
}
