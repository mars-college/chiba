/**
 * Types for Kasa smart plug control.
 */

import type { BreakpointTimeType } from './lights.js';

/**
 * Smart plug configuration stored in database.
 */
export interface Plug {
  id: string;
  name: string;
  ipAddress: string;
  host: string;
  deviceId?: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Current state of a plug.
 */
export interface PlugState {
  plugId: string;
  power: boolean;
  updatedAt: number;
}

/**
 * Plug with its current state combined (for API responses).
 */
export interface PlugWithState extends Plug {
  state: PlugState | null;
  reachable: boolean;
}

/**
 * Request to control a plug.
 */
export interface PlugControlRequest {
  power: boolean;
}

/**
 * A plug discovered via network scan.
 */
export interface DiscoveredPlug {
  ip: string;
  deviceId: string;
  alias: string;
  model: string;
}

/**
 * Result of a plug discovery scan.
 */
export interface PlugDiscoveryResult {
  discovered: number;
  added: number;
  updated: number;
  plugs: DiscoveredPlug[];
}

/**
 * A plug entry in the static config file (plugs.json).
 */
export interface PlugConfigEntry {
  id: string;
  name: string;
  ip: string;
  deviceId?: string;
  model?: string;
}

/**
 * Static plug configuration loaded from plugs.json.
 */
export interface PlugsConfig {
  plugs: PlugConfigEntry[];
}

/**
 * A single breakpoint in a plug schedule.
 */
export interface PlugScheduleBreakpoint {
  id: string;
  timeType: BreakpointTimeType;
  time?: string;           // HH:MM — required when timeType='clock'
  offsetMinutes?: number;  // +/-N from sunrise/sunset
  power: boolean;
}

/**
 * A daily schedule for a plug.
 */
export interface PlugSchedule {
  plugId: string;
  enabled: boolean;
  breakpoints: PlugScheduleBreakpoint[];
  updatedAt: number;
}

/**
 * Request to set a plug schedule.
 */
export interface SetPlugScheduleRequest {
  enabled: boolean;
  breakpoints: Array<{
    timeType: BreakpointTimeType;
    time?: string;
    offsetMinutes?: number;
    power: boolean;
  }>;
}
