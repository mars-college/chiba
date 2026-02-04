/**
 * Govee Cloud API client.
 *
 * Uses the Govee OpenAPI v1 to control lights via the cloud.
 * Falls back to UDP LAN control when the API key is not configured or a call fails.
 *
 * API docs: https://developer.govee.com/reference/get-you-devices
 */

import https from 'https';
import { createLogger } from '@chiba/shared';

const logger = createLogger('controller', 'govee-cloud');

const BASE_URL = 'https://openapi.api.govee.com/router/api/v1';
const REQUEST_TIMEOUT = 10000; // 10 seconds

interface CloudDevice {
  sku: string;
  device: string;
  deviceName: string;
}

interface GoveeApiResponse {
  code: number;
  message: string;
  data?: unknown;
}

interface GoveeDeviceListResponse extends GoveeApiResponse {
  data?: CloudDevice[];
}

/**
 * Check whether the Govee Cloud API key is configured.
 */
export function isCloudConfigured(): boolean {
  return Boolean(process.env.GOVEE_API_KEY);
}

/**
 * Make an HTTPS request to the Govee Cloud API.
 */
function request(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: Record<string, unknown>
): Promise<GoveeApiResponse> {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GOVEE_API_KEY;
    if (!apiKey) {
      reject(new Error('GOVEE_API_KEY not configured'));
      return;
    }

    const url = new URL(path, BASE_URL);
    const postData = body ? JSON.stringify(body) : undefined;

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Govee-API-Key': apiKey,
        ...(postData && { 'Content-Length': Buffer.byteLength(postData) }),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as GoveeApiResponse;

          if (res.statusCode === 429) {
            logger.warn('Govee cloud rate limited', { status: res.statusCode });
            reject(new Error('Govee cloud rate limited (429)'));
            return;
          }

          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Govee cloud error ${res.statusCode}: ${parsed.message || data}`));
            return;
          }

          resolve(parsed);
        } catch {
          reject(new Error(`Failed to parse Govee response: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT, () => {
      req.destroy();
      reject(new Error('Govee cloud request timeout'));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * Send a device control command via the Govee Cloud API.
 */
async function controlDevice(
  sku: string,
  device: string,
  capability: { type: string; instance: string; value: unknown }
): Promise<void> {
  const requestId = `chiba_${Date.now()}`;

  await request('POST', '/router/api/v1/device/control', {
    requestId,
    payload: {
      sku,
      device,
      capability,
    },
  });
}

/**
 * Control power via cloud API.
 */
export async function cloudControlPower(sku: string, device: string, on: boolean): Promise<void> {
  logger.info('Cloud control: power', { device, on });
  await controlDevice(sku, device, {
    type: 'devices.capabilities.on_off',
    instance: 'powerSwitch',
    value: on ? 1 : 0,
  });
}

/**
 * Control brightness via cloud API.
 */
export async function cloudControlBrightness(sku: string, device: string, brightness: number): Promise<void> {
  logger.info('Cloud control: brightness', { device, brightness });
  await controlDevice(sku, device, {
    type: 'devices.capabilities.range',
    instance: 'brightness',
    value: Math.max(0, Math.min(100, brightness)),
  });
}

/**
 * Control color via cloud API using RGB values.
 * Govee cloud expects color as a single integer: r*65536 + g*256 + b
 */
export async function cloudControlColorRgb(
  sku: string,
  device: string,
  r: number,
  g: number,
  b: number
): Promise<void> {
  const colorValue = r * 65536 + g * 256 + b;
  logger.info('Cloud control: color', { device, r, g, b, colorValue });
  await controlDevice(sku, device, {
    type: 'devices.capabilities.color_setting',
    instance: 'colorRgb',
    value: colorValue,
  });
}

/**
 * Control color temperature via cloud API.
 */
export async function cloudControlColorTemp(sku: string, device: string, kelvin: number): Promise<void> {
  const clamped = Math.max(2000, Math.min(9000, kelvin));
  logger.info('Cloud control: temperature', { device, kelvin: clamped });
  await controlDevice(sku, device, {
    type: 'devices.capabilities.color_setting',
    instance: 'colorTemperatureK',
    value: clamped,
  });
}

/**
 * List all devices from the Govee Cloud API.
 * Returns device SKU, device ID, and device name.
 */
export async function cloudListDevices(): Promise<CloudDevice[]> {
  logger.info('Listing devices from Govee cloud');
  const response = await request('GET', '/router/api/v1/user/devices') as GoveeDeviceListResponse;

  if (!response.data || !Array.isArray(response.data)) {
    logger.warn('Govee cloud returned no devices', { response });
    return [];
  }

  logger.info('Govee cloud devices', { count: response.data.length });
  return response.data;
}
