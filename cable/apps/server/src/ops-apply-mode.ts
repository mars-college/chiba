import path from 'node:path';
import fsp from 'node:fs/promises';
import toml from '@iarna/toml';
import type { KioskState } from './kiosk-state.js';

export type InventoryPi = {
  id: string;
  host: string;
  ip?: string;
  nodeName: string;
  guidePort: number;
  serverPort: number;
  orientation?: string; // "portrait" | "landscape" (best-effort; treated as hardware property)
  displayRotate?: 0 | 90 | 180 | 270;
};

export type CableModeDefaults = {
  mode?: string;
  theme?: string;
  nosplash?: boolean;
  lock?: boolean;
  qr?: boolean;
  channel?: string;
  ambient_channels?: string[];
  playlist?: boolean;
  scale?: number;
  text_scale?: number;
  hours?: number;
};

export type CableMode = {
  defaults?: { cable?: CableModeDefaults };
  pis?: Record<string, { cable?: CableModeDefaults }>;
};

export type ApplyModeResult = {
  pi: InventoryPi;
  url: string;
  ok: boolean;
  status: number | null;
  ms: number | null;
  error?: string;
};

type LimitFn = <T>(fn: () => Promise<T>) => Promise<T>;

function createLimit(concurrency: number): LimitFn {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= concurrency) return;
    const job = queue.shift();
    if (!job) return;
    active += 1;
    job();
  };
  return async <T>(fn: () => Promise<T>) =>
    await new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            active -= 1;
            next();
          });
      });
      next();
    });
}

export function toEnvSuffix(piId: string): string {
  const out: string[] = [];
  let lastUnderscore = false;
  for (const ch of piId ?? '') {
    const ok =
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= '0' && ch <= '9');
    if (ok) {
      out.push(ch.toUpperCase());
      lastUnderscore = false;
    } else if (!lastUnderscore) {
      out.push('_');
      lastUnderscore = true;
    }
  }
  return out.join('').replace(/^_+|_+$/g, '');
}

export function getApiKeyForPi(piId: string): string | null {
  const suf = toEnvSuffix(piId);
  const v =
    process.env[`CHIBA_API_KEY_${suf}`] ||
    process.env.CHIBA_API_KEY ||
    process.env.API_KEY ||
    '';
  return v.trim().length > 0 ? v.trim() : null;
}

function normalizeHost(input: string): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
    return u.hostname;
  } catch {
    return raw.replace(/^https?:\/\//i, '').split('/')[0] ?? raw;
  }
}

export async function loadInventoryFromRegistry(
  repoRoot: string,
  registryPath: string
): Promise<InventoryPi[]> {
  const resolved = path.resolve(repoRoot, registryPath);
  const raw = await fsp.readFile(resolved, 'utf-8');
  const parsed = toml.parse(raw) as any;
  const defaults = parsed?.defaults ?? {};
  const defaultServerPort =
    typeof defaults?.server_port === 'number'
      ? defaults.server_port
      : typeof defaults?.server_port === 'string'
        ? Number(defaults.server_port)
        : 8787;
  const defaultGuidePort =
    typeof defaults?.guide_port === 'number'
      ? defaults.guide_port
      : typeof defaults?.guide_port === 'string'
        ? Number(defaults.guide_port)
        : 5173;

  const pisObj = parsed?.pis ?? {};
  const pis: InventoryPi[] = [];
  for (const [id, node] of Object.entries<any>(pisObj)) {
    const host = normalizeHost(node?.host ?? '');
    const ip = normalizeHost(node?.ip ?? '');
    const nodeName = String(node?.node_name ?? node?.nodeName ?? id);
    const orientationRaw =
      typeof node?.orientation === 'string'
        ? node.orientation
        : typeof node?.cable?.orientation === 'string'
          ? node.cable.orientation
          : '';
    const orientation = String(orientationRaw ?? '')
      .trim()
      .toLowerCase();
    const rotateRaw =
      typeof node?.display_rotate === 'number'
        ? node.display_rotate
        : typeof node?.display_rotate === 'string'
          ? Number(node.display_rotate)
          : typeof defaults?.display_rotate === 'number'
            ? defaults.display_rotate
            : typeof defaults?.display_rotate === 'string'
              ? Number(defaults.display_rotate)
              : NaN;
    const displayRotate =
      rotateRaw === 0 || rotateRaw === 90 || rotateRaw === 180 || rotateRaw === 270
        ? (rotateRaw as 0 | 90 | 180 | 270)
        : undefined;
    const guidePort =
      typeof node?.guide_port === 'number'
        ? node.guide_port
        : typeof node?.guide_port === 'string'
          ? Number(node.guide_port)
          : defaultGuidePort;
    const serverPort =
      typeof node?.server_port === 'number'
        ? node.server_port
        : typeof node?.server_port === 'string'
          ? Number(node.server_port)
          : defaultServerPort;
    pis.push({
      id,
      host,
      ip: ip || undefined,
      nodeName,
      guidePort: Number.isFinite(guidePort) ? guidePort : 5173,
      serverPort: Number.isFinite(serverPort) ? serverPort : 8787,
      orientation: orientation || undefined,
      displayRotate,
    });
  }
  pis.sort((a, b) => a.id.localeCompare(b.id));
  return pis;
}

export async function loadModeFromFile(repoRoot: string, modePath: string): Promise<CableMode> {
  const resolved = path.resolve(repoRoot, modePath);
  const raw = await fsp.readFile(resolved, 'utf-8');
  const parsed = toml.parse(raw) as any;
  return parsed as CableMode;
}

export function mergeCableMode(mode: CableMode, piId: string): CableModeDefaults {
  const d = (mode?.defaults?.cable ?? {}) as CableModeDefaults;
  const p = ((mode?.pis ?? {})[piId]?.cable ?? {}) as CableModeDefaults;
  return { ...d, ...p };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const s = entry.trim();
    if (!s) continue;
    out.push(s);
  }
  return Array.from(new Set(out));
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV-1a prime multiply (mod 2^32)
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function pickFromPool(opts: { pool: string[]; piId: string; seed: string }): string | null {
  const { pool, piId, seed } = opts;
  if (!pool.length) return null;
  const key = `${seed}:${piId}`;
  const idx = fnv1a32(key) % pool.length;
  return pool[idx] ?? null;
}

function resolveChosenChannel(pi: InventoryPi, cable: CableModeDefaults): string {
  const ambientSeed =
    (process.env.CHIBA_AMBIENT_SEED ?? '').trim() ||
    // Default: stable per day. Re-run apply-mode on a different day to reshuffle.
    new Date().toISOString().slice(0, 10);
  const ambientPool = normalizeStringArray((cable as any).ambient_channels);
  let chosenChannel = typeof cable.channel === 'string' ? cable.channel.trim() : '';
  if (!chosenChannel && ambientPool.length) {
    chosenChannel = pickFromPool({ pool: ambientPool, piId: pi.id, seed: ambientSeed }) ?? '';
  }
  return chosenChannel;
}

export function buildKioskState(pi: InventoryPi, cable: CableModeDefaults): KioskState {
  const chosenChannel = resolveChosenChannel(pi, cable);
  return {
    mode: cable.mode === 'gallery' ? 'gallery' : cable.mode === 'guide' ? 'guide' : undefined,
    channel: chosenChannel || undefined,
    lock: typeof cable.lock === 'boolean' ? cable.lock : undefined,
    qr: typeof cable.qr === 'boolean' ? cable.qr : undefined,
    playlist: typeof cable.playlist === 'boolean' ? cable.playlist : undefined,
    nosplash: typeof cable.nosplash === 'boolean' ? cable.nosplash : undefined,
    theme: typeof cable.theme === 'string' ? cable.theme : undefined,
    scale: typeof cable.scale === 'number' && Number.isFinite(cable.scale) ? cable.scale : undefined,
    textScale:
      typeof cable.text_scale === 'number' && Number.isFinite(cable.text_scale)
        ? cable.text_scale
        : undefined,
    hours: typeof cable.hours === 'number' && Number.isFinite(cable.hours) ? cable.hours : undefined,
  };
}

export function buildKioskUrl(pi: InventoryPi, cable: CableModeDefaults): string {
  const base = new URL(`http://localhost:${pi.guidePort}/`);
  base.searchParams.set('screenId', pi.nodeName);

  const chosenChannel = resolveChosenChannel(pi, cable);

  if (typeof cable.theme === 'string' && cable.theme.trim().length > 0) {
    base.searchParams.set('theme', cable.theme.trim());
  }
  if (cable.nosplash === true) base.searchParams.set('nosplash', '1');
  if (cable.mode === 'gallery') base.searchParams.set('gallery', '1');
  if (cable.lock === true) base.searchParams.set('lock', '1');
  // In gallery mode, the guide defaults to "locked" unless explicitly disabled.
  // Emit lock=0 when the profile sets lock=false to override that default.
  if (cable.mode === 'gallery' && cable.lock === false) base.searchParams.set('lock', '0');
  if (cable.qr === false) base.searchParams.set('qr', '0');
  if (cable.qr === true) base.searchParams.set('qr', '1');
  if (chosenChannel) {
    base.searchParams.set('channel', chosenChannel);
  }
  if (cable.playlist === true) base.searchParams.set('playlist', '1');
  if (typeof cable.scale === 'number' && Number.isFinite(cable.scale)) {
    base.searchParams.set('scale', String(cable.scale));
  }
  if (typeof cable.text_scale === 'number' && Number.isFinite(cable.text_scale)) {
    base.searchParams.set('textScale', String(cable.text_scale));
  }
  if (typeof cable.hours === 'number' && Number.isFinite(cable.hours)) {
    base.searchParams.set('hours', String(cable.hours));
  }

  return base.toString();
}

async function postKioskUrl(opts: {
  host: string;
  apiKey?: string | null;
  url: string;
  timeoutMs: number;
}): Promise<{ ok: boolean; status: number | null; ms: number | null; error?: string }> {
  const started = Date.now();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.apiKey && opts.apiKey.trim().length > 0) {
      headers.authorization = `Bearer ${opts.apiKey.trim()}`;
    }
    const res = await fetch(`http://${opts.host}:8080/kiosk-url`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        ...headers,
      },
      body: JSON.stringify({ url: opts.url }),
    });
    const ok = res.ok;
    return { ok, status: res.status, ms: Date.now() - started, error: ok ? undefined : `http_${res.status}` };
  } catch (err) {
    return { ok: false, status: null, ms: null, error: (err as Error).message };
  } finally {
    clearTimeout(t);
  }
}

async function postRotate(opts: {
  host: string;
  apiKey?: string | null;
  rotation: 0 | 90 | 180 | 270;
  timeoutMs: number;
}): Promise<{ ok: boolean; status: number | null; ms: number | null; error?: string }> {
  const started = Date.now();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.apiKey && opts.apiKey.trim().length > 0) {
      headers.authorization = `Bearer ${opts.apiKey.trim()}`;
    }
    const res = await fetch(`http://${opts.host}:8080/rotate`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        ...headers,
      },
      body: JSON.stringify({ rotation: opts.rotation }),
    });
    const ok = res.ok;
    return { ok, status: res.status, ms: Date.now() - started, error: ok ? undefined : `http_${res.status}` };
  } catch (err) {
    return { ok: false, status: null, ms: null, error: (err as Error).message };
  } finally {
    clearTimeout(t);
  }
}

async function postKioskState(opts: {
  host: string;
  serverPort: number;
  screenId: string;
  state: KioskState;
  timeoutMs: number;
}): Promise<{ ok: boolean; status: number | null; ms: number | null; error?: string }> {
  const started = Date.now();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs);
  try {
    const res = await fetch(`http://${opts.host}:${opts.serverPort}/api/kiosk/state`, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ screenId: opts.screenId, state: opts.state }),
    });
    const ok = res.ok;
    return { ok, status: res.status, ms: Date.now() - started, error: ok ? undefined : `http_${res.status}` };
  } catch (err) {
    return { ok: false, status: null, ms: null, error: (err as Error).message };
  } finally {
    clearTimeout(t);
  }
}

async function postOpenArt(opts: {
  host: string;
  serverPort: number;
  screenId: string;
  channelId: string;
  index: number;
  timeoutMs: number;
}): Promise<{ ok: boolean; status: number | null; ms: number | null; error?: string }> {
  const started = Date.now();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs);
  try {
    const res = await fetch(`http://${opts.host}:${opts.serverPort}/api/kiosk/open-art`, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        screenId: opts.screenId,
        channelId: opts.channelId,
        index: opts.index,
      }),
    });
    const ok = res.ok;
    return { ok, status: res.status, ms: Date.now() - started, error: ok ? undefined : `http_${res.status}` };
  } catch (err) {
    return { ok: false, status: null, ms: null, error: (err as Error).message };
  } finally {
    clearTimeout(t);
  }
}

export async function applyKioskUrlToFleet(opts: {
  repoRoot: string;
  inventoryPath: string;
  piIds?: string[]; // if omitted: apply to all inventory pis
  concurrency?: number;
  timeoutMs?: number;
  dryRun?: boolean;
  buildUrl: (pi: InventoryPi) => string;
}): Promise<ApplyModeResult[]> {
  const timeoutMs = opts.timeoutMs ?? 2500;
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const limit = createLimit(concurrency);

  const inventory = await loadInventoryFromRegistry(opts.repoRoot, opts.inventoryPath);

  const allow = new Set((opts.piIds ?? []).filter((s) => s.trim().length > 0));
  const targets = allow.size > 0 ? inventory.filter((p) => allow.has(p.id)) : inventory;

  return await Promise.all(
    targets.map((pi) =>
      limit(async () => {
        const url = opts.buildUrl(pi);

        if (opts.dryRun) {
          return { pi, url, ok: true, status: null, ms: null } satisfies ApplyModeResult;
        }

        const addr = pi.ip || pi.host;
        if (!addr) {
          return { pi, url, ok: false, status: null, ms: null, error: 'missing_host_or_ip' } satisfies ApplyModeResult;
        }
        const apiKey = getApiKeyForPi(pi.id);

        // If no key is configured, we still try the request unauthenticated.
        // If the node is configured with API_KEY, it will return http_401.
        const res = await postKioskUrl({ host: addr, apiKey, url, timeoutMs });

        // Best-effort: rotate portrait screens as part of "apply mode", so portrait hardware
        // doesn't require per-Pi manual intervention.
        //
        // We treat missing orientation as landscape-by-default (rotation 0).
        if (res.ok) {
          const o = String(pi.orientation ?? '')
            .trim()
            .toLowerCase();
          const rotation: 0 | 90 | 180 | 270 =
            pi.displayRotate ?? (o === 'portrait' ? 90 : 0);
          // Ignore failures; kiosk URL is the primary contract.
          await postRotate({ host: addr, apiKey, rotation, timeoutMs }).catch(() => {});
        }

        return {
          pi,
          url,
          ok: res.ok,
          status: res.status,
          ms: res.ms,
          error: res.error,
        } satisfies ApplyModeResult;
      })
    )
  );
}

export async function applyModeToFleet(opts: {
  repoRoot: string;
  inventoryPath: string;
  modePath: string;
  piIds?: string[]; // if omitted: apply to all inventory pis
  concurrency?: number;
  timeoutMs?: number;
  dryRun?: boolean;
}): Promise<ApplyModeResult[]> {
  const mode = await loadModeFromFile(opts.repoRoot, opts.modePath);
  return await applyKioskUrlToFleet({
    repoRoot: opts.repoRoot,
    inventoryPath: opts.inventoryPath,
    piIds: opts.piIds,
    concurrency: opts.concurrency,
    timeoutMs: opts.timeoutMs,
    dryRun: opts.dryRun,
    buildUrl: (pi) => buildKioskUrl(pi, mergeCableMode(mode, pi.id)),
  });
}

export async function applyModeToFleetFromObject(opts: {
  repoRoot: string;
  inventoryPath: string;
  mode: CableMode;
  piIds?: string[]; // if omitted: apply to all inventory pis
  concurrency?: number;
  timeoutMs?: number;
  dryRun?: boolean;
}): Promise<ApplyModeResult[]> {
  return await applyKioskUrlToFleet({
    repoRoot: opts.repoRoot,
    inventoryPath: opts.inventoryPath,
    piIds: opts.piIds,
    concurrency: opts.concurrency,
    timeoutMs: opts.timeoutMs,
    dryRun: opts.dryRun,
    buildUrl: (pi) => buildKioskUrl(pi, mergeCableMode(opts.mode, pi.id)),
  });
}

export async function applyKioskStateToFleetFromObject(opts: {
  repoRoot: string;
  inventoryPath: string;
  mode: CableMode;
  piIds?: string[]; // if omitted: apply to all inventory pis
  concurrency?: number;
  timeoutMs?: number;
  dryRun?: boolean;
}): Promise<ApplyModeResult[]> {
  const timeoutMs = opts.timeoutMs ?? 2500;
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const limit = createLimit(concurrency);
  const inventory = await loadInventoryFromRegistry(opts.repoRoot, opts.inventoryPath);

  const allow = new Set((opts.piIds ?? []).filter((s) => s.trim().length > 0));
  const targets = allow.size > 0 ? inventory.filter((p) => allow.has(p.id)) : inventory;

  return await Promise.all(
    targets.map((pi) =>
      limit(async () => {
        const cable = mergeCableMode(opts.mode, pi.id);
        const url = buildKioskUrl(pi, cable); // for UI/debugging only
        const state = buildKioskState(pi, cable);

        if (opts.dryRun) {
          return { pi, url, ok: true, status: null, ms: null } satisfies ApplyModeResult;
        }

        const addr = pi.ip || pi.host;
        if (!addr) {
          return { pi, url, ok: false, status: null, ms: null, error: 'missing_host_or_ip' } satisfies ApplyModeResult;
        }

        const res = await postKioskState({
          host: addr,
          serverPort: pi.serverPort,
          screenId: pi.nodeName,
          state,
          timeoutMs,
        });

        return {
          pi,
          url,
          ok: res.ok,
          status: res.status,
          ms: res.ms,
          error: res.error,
        } satisfies ApplyModeResult;
      })
    )
  );
}

export async function openArtOnFleet(opts: {
  repoRoot: string;
  inventoryPath: string;
  channelId: string;
  index: number;
  piIds?: string[]; // if omitted: apply to all inventory pis
  concurrency?: number;
  timeoutMs?: number;
  dryRun?: boolean;
}): Promise<ApplyModeResult[]> {
  const timeoutMs = opts.timeoutMs ?? 2500;
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const limit = createLimit(concurrency);
  const inventory = await loadInventoryFromRegistry(opts.repoRoot, opts.inventoryPath);

  const allow = new Set((opts.piIds ?? []).filter((s) => s.trim().length > 0));
  const targets = allow.size > 0 ? inventory.filter((p) => allow.has(p.id)) : inventory;

  return await Promise.all(
    targets.map((pi) =>
      limit(async () => {
        const url = new URL(`http://localhost:${pi.guidePort}/channel/${encodeURIComponent(opts.channelId)}`);
        url.searchParams.set('i', String(opts.index));
        url.searchParams.set('screenId', pi.nodeName);
        url.searchParams.set('nosplash', '1');
        url.searchParams.set('qr', '0');

        if (opts.dryRun) {
          return { pi, url: url.toString(), ok: true, status: null, ms: null } satisfies ApplyModeResult;
        }

        const addr = pi.ip || pi.host;
        if (!addr) {
          return { pi, url: url.toString(), ok: false, status: null, ms: null, error: 'missing_host_or_ip' } satisfies ApplyModeResult;
        }

        const res = await postOpenArt({
          host: addr,
          serverPort: pi.serverPort,
          screenId: pi.nodeName,
          channelId: opts.channelId,
          index: opts.index,
          timeoutMs,
        });

        return {
          pi,
          url: url.toString(),
          ok: res.ok,
          status: res.status,
          ms: res.ms,
          error: res.error,
        } satisfies ApplyModeResult;
      })
    )
  );
}
