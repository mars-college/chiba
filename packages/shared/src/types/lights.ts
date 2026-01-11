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
  deviceType?: string;
  createdAt: number;
  updatedAt: number;
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
}

/**
 * Request to create a new preset.
 */
export interface CreatePresetRequest {
  name: string;
  settings: PresetLightSetting[];
}
