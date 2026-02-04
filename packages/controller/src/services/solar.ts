/**
 * Sunrise/sunset calculator using NOAA solar algorithm.
 * Hardcoded for Bombay Beach, CA (Salton Sea).
 */

import type { BreakpointTimeType } from '@chiba/shared';

const LAT = 33.324779;
const LNG = -115.839313;
const TZ = 'America/Los_Angeles';

function toJulianDay(date: Date): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const a = Math.floor((14 - m) / 12);
  const y1 = y + 4800 - a;
  const m1 = m + 12 * a - 3;
  return d + Math.floor((153 * m1 + 2) / 5) + 365 * y1 + Math.floor(y1 / 4) - Math.floor(y1 / 100) + Math.floor(y1 / 400) - 32045;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function calcSolarNoon(jd: number, lng: number): number {
  const n = jd - 2451545.0 + 0.0008;
  const jStar = n - lng / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C =
    1.9148 * Math.sin(toRad(M)) +
    0.02 * Math.sin(toRad(2 * M)) +
    0.0003 * Math.sin(toRad(3 * M));
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit =
    2451545.0 +
    jStar +
    0.0053 * Math.sin(toRad(M)) -
    0.0069 * Math.sin(toRad(2 * lambda));
  return jTransit;
}

function calcHourAngle(jd: number, lng: number, lat: number): number {
  const n = jd - 2451545.0 + 0.0008;
  const jStar = n - lng / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C =
    1.9148 * Math.sin(toRad(M)) +
    0.02 * Math.sin(toRad(2 * M)) +
    0.0003 * Math.sin(toRad(3 * M));
  const lambda = (M + C + 180 + 102.9372) % 360;
  const sinDec = Math.sin(toRad(lambda)) * Math.sin(toRad(23.4397));
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosOmega =
    (Math.sin(toRad(-0.833)) - Math.sin(toRad(lat)) * sinDec) /
    (Math.cos(toRad(lat)) * cosDec);
  return toDeg(Math.acos(cosOmega));
}

function julianToDate(jd: number): Date {
  // Convert Julian day to milliseconds since epoch
  const ms = (jd - 2440587.5) * 86400000;
  return new Date(ms);
}

export interface SolarTimes {
  sunrise: Date;
  sunset: Date;
}

/**
 * Get sunrise and sunset times for a given date at the hardcoded location.
 */
export function getSolarTimes(date: Date): SolarTimes {
  // Use noon UTC of the given date for Julian day calculation
  const noon = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0));
  const jd = toJulianDay(noon);

  const jTransit = calcSolarNoon(jd, LNG);
  const omega = calcHourAngle(jd, LNG, LAT);

  const jRise = jTransit - omega / 360;
  const jSet = jTransit + omega / 360;

  return {
    sunrise: julianToDate(jRise),
    sunset: julianToDate(jSet),
  };
}

/**
 * Resolve a breakpoint's time specification to a concrete Date for the given day.
 */
export function resolveBreakpointTime(
  bp: { timeType: BreakpointTimeType; time?: string; offsetMinutes?: number },
  date: Date
): Date {
  if (bp.timeType === 'clock') {
    const [hh, mm] = (bp.time || '00:00').split(':').map(Number);
    // Create a date in the local timezone (America/Los_Angeles)
    const localStr = date.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
    const [year, month, day] = localStr.split('-').map(Number);
    // Build an ISO string with the target time and find the UTC equivalent
    const target = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`);
    // Adjust: the above creates a local time in the system timezone.
    // We need to convert it to the correct timezone offset for PST/PDT.
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    // Use a reference point to find the timezone offset
    const refParts = formatter.formatToParts(date);
    const refYear = Number(refParts.find(p => p.type === 'year')?.value);
    const refMonth = Number(refParts.find(p => p.type === 'month')?.value);
    const refDay = Number(refParts.find(p => p.type === 'day')?.value);
    // Build the target date in UTC and adjust
    const utcTarget = new Date(Date.UTC(refYear, refMonth - 1, refDay, hh!, mm!, 0));
    // Find the offset by comparing local representation
    const testStr = formatter.format(utcTarget);
    const testParts = testStr.match(/(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+):(\d+)/);
    if (testParts) {
      const testHour = Number(testParts[4]);
      let offsetHours = testHour - hh!;
      if (offsetHours > 12) offsetHours -= 24;
      if (offsetHours < -12) offsetHours += 24;
      return new Date(utcTarget.getTime() - offsetHours * 3600000);
    }
    return target;
  }

  const solar = getSolarTimes(date);
  const base = bp.timeType === 'sunrise' ? solar.sunrise : solar.sunset;
  const offsetMs = (bp.offsetMinutes || 0) * 60000;
  return new Date(base.getTime() + offsetMs);
}
