/**
 * Types for Govee LED light control.
 */

/**
 * Govee light configuration stored in database.
 */
export interface Light {
  id: string;
  name: string;
  ipAddress: string;
  port: number;
  deviceId?: string;
  sku?: string;
  deviceType?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * A light discovered via LAN multicast scan.
 */
export interface DiscoveredLight {
  ip: string;
  deviceId: string;
  sku: string;
  name?: string;
}

/**
 * Result of a discovery scan operation.
 */
export interface DiscoveryResult {
  discovered: number;
  added: number;
  updated: number;
  pruned?: number;
  lights: DiscoveredLight[];
}

/**
 * Current state of a light.
 */
export interface LightState {
  lightId: string;
  power: boolean;
  hue: number; // 0-360
  saturation: number; // 0-100
  brightness: number; // 0-100
  kelvin?: number; // 2000-9000, if set the light is in temperature mode
  updatedAt: number;
}

/**
 * Light with its current state combined (for API responses).
 */
export interface LightWithState extends Light {
  state: LightState | null;
  reachable: boolean;
}

/**
 * Settings for a single light in a preset.
 * Use lightId="*" to apply to all lights.
 */
export interface PresetLightSetting {
  lightId: string;
  power?: boolean;
  hue?: number;
  saturation?: number;
  brightness?: number;
  kelvin?: number; // 2000-9000, color temperature (mutually exclusive with hue/saturation)
}

/**
 * A saved preset (scene) for lights.
 */
export interface LightPreset {
  id: string;
  name: string;
  isPredefined: boolean;
  settings: PresetLightSetting[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Request to control a single light.
 */
export interface LightControlRequest {
  power?: boolean;
  hue?: number; // 0-360
  saturation?: number; // 0-100
  brightness?: number; // 0-100
  kelvin?: number; // 2000-9000, color temperature (mutually exclusive with hue/saturation)
}

/**
 * Request to create a new preset.
 */
export interface CreatePresetRequest {
  name: string;
  settings: PresetLightSetting[];
}

/**
 * Light entry in the config file (lights.json).
 */
export interface LightConfigEntry {
  id: string;
  name: string;
  ip: string;
  deviceId?: string; // Stable device ID (MAC-like) for tracking across IP changes
}

/**
 * Structure of the lights.json config file.
 */
export interface LightsConfig {
  lights: LightConfigEntry[];
  port: number;
}
