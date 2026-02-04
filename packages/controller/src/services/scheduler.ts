/**
 * Light schedule service.
 * Manages daily per-light schedules with breakpoints (clock, sunrise, sunset).
 */

import { createLogger } from '@chiba/shared';
import type { LightScheduleBreakpoint } from '@chiba/shared';
import { getDatabase } from '../db/index.js';
import { controlLight, getLightById } from './lights.js';
import { resolveBreakpointTime } from './solar.js';

const logger = createLogger('controller', 'scheduler');

/** Active timers per light */
const lightTimers = new Map<string, NodeJS.Timeout[]>();

/** Midnight reschedule timer */
let midnightTimer: NodeJS.Timeout | null = null;

/** Whether scheduler is running */
let running = false;

/**
 * Load schedule from database for a given light.
 */
function getScheduleFromDb(lightId: string): { enabled: boolean; breakpoints: LightScheduleBreakpoint[] } | null {
  const db = getDatabase();
  const row = db.prepare('SELECT enabled, breakpoints FROM light_schedules WHERE light_id = ?').get(lightId) as {
    enabled: number;
    breakpoints: string;
  } | undefined;

  if (!row) return null;
  return {
    enabled: Boolean(row.enabled),
    breakpoints: JSON.parse(row.breakpoints),
  };
}

/**
 * Get all enabled schedules from the database.
 */
function getAllEnabledSchedules(): Array<{ lightId: string; breakpoints: LightScheduleBreakpoint[] }> {
  const db = getDatabase();
  const rows = db.prepare('SELECT light_id, breakpoints FROM light_schedules WHERE enabled = 1').all() as Array<{
    light_id: string;
    breakpoints: string;
  }>;

  return rows.map(row => ({
    lightId: row.light_id,
    breakpoints: JSON.parse(row.breakpoints),
  }));
}

/**
 * Apply a breakpoint's settings to a light.
 */
async function applyBreakpoint(lightId: string, bp: LightScheduleBreakpoint): Promise<void> {
  const light = getLightById(lightId);
  if (!light) {
    logger.warn('Scheduled light not found', { lightId });
    return;
  }

  logger.info('Applying scheduled breakpoint', {
    lightId,
    breakpointId: bp.id,
    power: bp.power,
    brightness: bp.brightness,
  });

  try {
    await controlLight(light, { power: bp.power, brightness: bp.brightness });
  } catch (err) {
    logger.error('Failed to apply scheduled breakpoint', err as Error, { lightId, breakpointId: bp.id });
  }
}

/**
 * Clear all timers for a specific light.
 */
function clearLightTimers(lightId: string): void {
  const timers = lightTimers.get(lightId);
  if (timers) {
    for (const t of timers) clearTimeout(t);
    lightTimers.delete(lightId);
  }
}

/**
 * Schedule all breakpoints for a light for today.
 * Also applies the most recent past breakpoint immediately.
 */
function scheduleLightForToday(lightId: string, breakpoints: LightScheduleBreakpoint[]): void {
  clearLightTimers(lightId);

  if (breakpoints.length === 0) return;

  const now = new Date();
  const timers: NodeJS.Timeout[] = [];

  // Resolve all breakpoint times for today
  const resolved = breakpoints.map(bp => ({
    bp,
    time: resolveBreakpointTime(bp, now),
  }));

  // Sort by resolved time
  resolved.sort((a, b) => a.time.getTime() - b.time.getTime());

  // Find most recent past breakpoint and apply it immediately
  let mostRecentPast: LightScheduleBreakpoint | null = null;
  for (const { bp, time } of resolved) {
    if (time.getTime() <= now.getTime()) {
      mostRecentPast = bp;
    }
  }

  if (mostRecentPast) {
    applyBreakpoint(lightId, mostRecentPast);
  }

  // Schedule future breakpoints
  for (const { bp, time } of resolved) {
    const delay = time.getTime() - now.getTime();
    if (delay > 0) {
      const timer = setTimeout(() => {
        applyBreakpoint(lightId, bp);
      }, delay);
      timers.push(timer);
    }
  }

  lightTimers.set(lightId, timers);

  logger.debug('Scheduled breakpoints for light', {
    lightId,
    total: breakpoints.length,
    future: timers.length,
    appliedPast: !!mostRecentPast,
  });
}

/**
 * Schedule the midnight reschedule timer.
 * At midnight PST, recompute all schedules for the new day.
 */
function scheduleMidnightReschedule(): void {
  if (midnightTimer) {
    clearTimeout(midnightTimer);
    midnightTimer = null;
  }

  // Find next midnight in America/Los_Angeles
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });

  // Build tomorrow midnight in LA timezone
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = formatter.format(tomorrow);
  const [ty, tm, td] = tomorrowStr.split('-').map(Number);

  // Get the offset for this date in the target timezone
  const testDate = new Date(Date.UTC(ty!, tm! - 1, td!, 12, 0, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric', hour12: false,
  }).formatToParts(testDate);
  const localHourAtNoonUTC = Number(parts.find(p => p.type === 'hour')?.value || 0);
  const offsetHours = localHourAtNoonUTC - 12;
  // midnight local = 0:00 local = -offsetHours UTC
  const midnightTargetUtc = new Date(Date.UTC(ty!, tm! - 1, td!, -offsetHours, 0, 0));

  const delay = midnightTargetUtc.getTime() - now.getTime();

  if (delay > 0) {
    midnightTimer = setTimeout(() => {
      logger.info('Midnight reschedule triggered');
      scheduleAllLights();
      scheduleMidnightReschedule();
    }, delay);

    logger.debug('Midnight reschedule set', { delayMs: delay, targetUtc: midnightTargetUtc.toISOString() });
  } else {
    // Already past midnight, schedule for tomorrow
    const nextDelay = delay + 86400000;
    if (nextDelay > 0) {
      midnightTimer = setTimeout(() => {
        logger.info('Midnight reschedule triggered');
        scheduleAllLights();
        scheduleMidnightReschedule();
      }, nextDelay);
    }
  }
}

/**
 * Schedule all enabled lights for today.
 */
function scheduleAllLights(): void {
  const schedules = getAllEnabledSchedules();
  logger.info('Scheduling lights', { count: schedules.length });

  for (const { lightId, breakpoints } of schedules) {
    scheduleLightForToday(lightId, breakpoints);
  }
}

/**
 * Reload schedule for a specific light (called after API updates).
 */
export function reloadLightSchedule(lightId: string): void {
  clearLightTimers(lightId);

  const schedule = getScheduleFromDb(lightId);
  if (schedule && schedule.enabled && schedule.breakpoints.length > 0) {
    scheduleLightForToday(lightId, schedule.breakpoints);
  }

  logger.info('Reloaded light schedule', {
    lightId,
    enabled: schedule?.enabled ?? false,
    breakpoints: schedule?.breakpoints.length ?? 0,
  });
}

/**
 * Start the scheduler. Called at server startup.
 */
export function startScheduler(): void {
  if (running) return;
  running = true;

  logger.info('Starting light scheduler');
  scheduleAllLights();
  scheduleMidnightReschedule();
}

/**
 * Stop the scheduler. Called during shutdown.
 */
export function stopScheduler(): void {
  if (!running) return;
  running = false;

  logger.info('Stopping light scheduler');

  // Clear all light timers
  for (const [lightId] of lightTimers) {
    clearLightTimers(lightId);
  }

  // Clear midnight timer
  if (midnightTimer) {
    clearTimeout(midnightTimer);
    midnightTimer = null;
  }
}
