/**
 * Plug schedule service.
 * Manages daily per-plug schedules with breakpoints (clock, sunrise, sunset).
 * Same pattern as light scheduler but simpler (power only, no color/brightness).
 */

import { createLogger } from '@chiba/shared';
import type { PlugScheduleBreakpoint } from '@chiba/shared';
import { getDatabase } from '../db/index.js';
import { controlPlug, getPlugById } from './plugs.js';
import { resolveBreakpointTime } from './solar.js';

const logger = createLogger('controller', 'plug-scheduler');

/** Active timers per plug */
const plugTimers = new Map<string, NodeJS.Timeout[]>();

/** Midnight reschedule timer */
let midnightTimer: NodeJS.Timeout | null = null;

/** Whether scheduler is running */
let running = false;

/**
 * Load schedule from database for a given plug.
 */
function getScheduleFromDb(plugId: string): { enabled: boolean; breakpoints: PlugScheduleBreakpoint[] } | null {
  const db = getDatabase();
  const row = db.prepare('SELECT enabled, breakpoints FROM plug_schedules WHERE plug_id = ?').get(plugId) as {
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
function getAllEnabledSchedules(): Array<{ plugId: string; breakpoints: PlugScheduleBreakpoint[] }> {
  const db = getDatabase();
  const rows = db.prepare('SELECT plug_id, breakpoints FROM plug_schedules WHERE enabled = 1').all() as Array<{
    plug_id: string;
    breakpoints: string;
  }>;

  return rows.map(row => ({
    plugId: row.plug_id,
    breakpoints: JSON.parse(row.breakpoints),
  }));
}

/**
 * Apply a breakpoint's settings to a plug.
 */
async function applyBreakpoint(plugId: string, bp: PlugScheduleBreakpoint): Promise<void> {
  const plug = getPlugById(plugId);
  if (!plug) {
    logger.warn('Scheduled plug not found', { plugId });
    return;
  }

  logger.info('Applying scheduled breakpoint', {
    plugId,
    breakpointId: bp.id,
    power: bp.power,
  });

  try {
    await controlPlug(plug, { power: bp.power });
  } catch (err) {
    logger.error('Failed to apply scheduled breakpoint', err as Error, { plugId, breakpointId: bp.id });
  }
}

/**
 * Clear all timers for a specific plug.
 */
function clearPlugTimers(plugId: string): void {
  const timers = plugTimers.get(plugId);
  if (timers) {
    for (const t of timers) clearTimeout(t);
    plugTimers.delete(plugId);
  }
}

/**
 * Schedule all breakpoints for a plug for today.
 * Also applies the most recent past breakpoint immediately.
 */
function schedulePlugForToday(plugId: string, breakpoints: PlugScheduleBreakpoint[]): void {
  clearPlugTimers(plugId);

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
  let mostRecentPast: PlugScheduleBreakpoint | null = null;
  for (const { bp, time } of resolved) {
    if (time.getTime() <= now.getTime()) {
      mostRecentPast = bp;
    }
  }

  if (mostRecentPast) {
    applyBreakpoint(plugId, mostRecentPast);
  }

  // Schedule future breakpoints
  for (const { bp, time } of resolved) {
    const delay = time.getTime() - now.getTime();
    if (delay > 0) {
      const timer = setTimeout(() => {
        applyBreakpoint(plugId, bp);
      }, delay);
      timers.push(timer);
    }
  }

  plugTimers.set(plugId, timers);

  logger.debug('Scheduled breakpoints for plug', {
    plugId,
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
  const midnightTargetUtc = new Date(Date.UTC(ty!, tm! - 1, td!, -offsetHours, 0, 0));

  const delay = midnightTargetUtc.getTime() - now.getTime();

  if (delay > 0) {
    midnightTimer = setTimeout(() => {
      logger.info('Midnight reschedule triggered');
      scheduleAllPlugs();
      scheduleMidnightReschedule();
    }, delay);

    logger.debug('Midnight reschedule set', { delayMs: delay, targetUtc: midnightTargetUtc.toISOString() });
  } else {
    const nextDelay = delay + 86400000;
    if (nextDelay > 0) {
      midnightTimer = setTimeout(() => {
        logger.info('Midnight reschedule triggered');
        scheduleAllPlugs();
        scheduleMidnightReschedule();
      }, nextDelay);
    }
  }
}

/**
 * Schedule all enabled plugs for today.
 */
function scheduleAllPlugs(): void {
  const schedules = getAllEnabledSchedules();
  logger.info('Scheduling plugs', { count: schedules.length });

  for (const { plugId, breakpoints } of schedules) {
    schedulePlugForToday(plugId, breakpoints);
  }
}

/**
 * Reload schedule for a specific plug (called after API updates).
 */
export function reloadPlugSchedule(plugId: string): void {
  clearPlugTimers(plugId);

  const schedule = getScheduleFromDb(plugId);
  if (schedule && schedule.enabled && schedule.breakpoints.length > 0) {
    schedulePlugForToday(plugId, schedule.breakpoints);
  }

  logger.info('Reloaded plug schedule', {
    plugId,
    enabled: schedule?.enabled ?? false,
    breakpoints: schedule?.breakpoints.length ?? 0,
  });
}

/**
 * Start the plug scheduler. Called at server startup.
 */
export function startPlugScheduler(): void {
  if (running) return;
  running = true;

  logger.info('Starting plug scheduler');
  scheduleAllPlugs();
  scheduleMidnightReschedule();
}

/**
 * Stop the plug scheduler. Called during shutdown.
 */
export function stopPlugScheduler(): void {
  if (!running) return;
  running = false;

  logger.info('Stopping plug scheduler');

  // Clear all plug timers
  for (const [plugId] of plugTimers) {
    clearPlugTimers(plugId);
  }

  // Clear midnight timer
  if (midnightTimer) {
    clearTimeout(midnightTimer);
    midnightTimer = null;
  }
}
