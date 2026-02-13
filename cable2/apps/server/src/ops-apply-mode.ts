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
  target_kind?: "media" | "playlist" | "block" | "channel";
  target_id?: string;
  display_rotate?: 0 | 90 | 180 | 270;
  theme?: string;
  nosplash?: boolean;
  hud?: "always" | "start" | "never";
  hud_sec?: number;
  lock?: boolean;
  qr?: boolean;
  channel?: string;
  ambient_channels?: string[];
  playlist?: boolean;
  // Best-effort caching hints used by ops apply-mode.
  // If present, apply-mode will ask the node cable server (8787) to prefetch
  // dependencies for these channels after the kiosk URL is applied.
  prefetch_channels?: string[];
  prefetch_targets?: string[];
  prefetch_stash?: boolean; // default true
  prefetch_cache?: boolean; // default true
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
  state?: { ok: boolean; status: number | null; ms: number | null; error?: string };
  prefetch?: {
    channelIds: string[];
    targets?: string[];
    stash?: { ok: boolean; status: number | null; ms: number | null; queued: number | null; error?: string };
    cache?: { ok: boolean; status: number | null; ms: number | null; queued: number | null; error?: string };
  };
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

function fallbackPi(id: string): InventoryPi {
  return {
    id,
    host: '',
    ip: undefined,
    nodeName: id,
    guidePort: 5173,
    serverPort: 8787,
  };
}

function selectInventoryTargets(inventory: InventoryPi[], requestedIds?: string[]): {
  targets: InventoryPi[];
  missingIds: string[];
} {
  const trimmed = (requestedIds ?? [])
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter((id) => id.length > 0);
  const allow = new Set(trimmed);
  if (allow.size === 0) return { targets: inventory, missingIds: [] };

  const byId = new Map(inventory.map((pi) => [pi.id, pi]));
  const targets: InventoryPi[] = [];
  const missingIds: string[] = [];
  for (const id of allow) {
    const pi = byId.get(id);
    if (pi) targets.push(pi);
    else missingIds.push(id);
  }
  return { targets, missingIds };
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
    process.env[`CHIBA_NODE_API_KEY_${suf}`] ||
    process.env[`CHIBA_API_KEY_${suf}`] ||
    process.env.CHIBA_NODE_API_KEY ||
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

async function postJson(opts: {
  url: string;
  body: unknown;
  timeoutMs: number;
}): Promise<{ ok: boolean; status: number | null; ms: number | null; json?: any; error?: string }> {
  const started = Date.now();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs);
  try {
    const res = await fetch(opts.url, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts.body),
    });
    const ok = res.ok;
    let json: any = undefined;
    try {
      json = await res.json();
    } catch {
      // ignore parse errors
    }
    return {
      ok,
      status: res.status,
      ms: Date.now() - started,
      json,
      error: ok ? undefined : `http_${res.status}`,
    };
  } catch (err) {
    return { ok: false, status: null, ms: null, error: (err as Error).message };
  } finally {
    clearTimeout(t);
  }
}

function resolvePrefetchChannels(pi: InventoryPi, cable: CableModeDefaults): string[] {
  const explicit = normalizeStringArray((cable as any).prefetch_channels);
  const chosen = resolveChosenChannel(pi, cable);
  return Array.from(new Set([...explicit, chosen].map((s) => s.trim()).filter(Boolean)));
}

function parseTargetKind(value: unknown): "media" | "playlist" | "block" | "channel" | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "media") return "media";
  if (normalized === "playlist") return "playlist";
  if (normalized === "block") return "block";
  if (normalized === "channel") return "channel";
  return undefined;
}

function resolveModeTarget(
  pi: InventoryPi,
  cable: CableModeDefaults
): { kind?: "media" | "playlist" | "block" | "channel"; id?: string; channelId?: string } {
  const chosenChannel = resolveChosenChannel(pi, cable);
  let kind = parseTargetKind((cable as any).target_kind);
  let id = typeof cable.target_id === "string" ? cable.target_id.trim() : "";

  if (kind === "channel" && !id) id = chosenChannel;
  if (!kind && chosenChannel) {
    kind = "channel";
    id = chosenChannel;
  }
  const channelId = kind === "channel" ? id : undefined;
  return {
    kind,
    id: id || undefined,
    channelId,
  };
}

function resolvePrefetchTargets(pi: InventoryPi, cable: CableModeDefaults): string[] {
  const explicit = normalizeStringArray((cable as any).prefetch_targets);
  const target = resolveModeTarget(pi, cable);
  const implicit = target.kind && target.id ? [`${target.kind}:${target.id}`] : [];
  return Array.from(new Set([...explicit, ...implicit]));
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
  const target = resolveModeTarget(pi, cable);
  const rotateRaw =
    typeof cable.display_rotate === "number"
      ? cable.display_rotate
      : typeof (cable as any).display_rotate === "string"
        ? Number((cable as any).display_rotate)
        : NaN;
  const rotate =
    rotateRaw === 0 || rotateRaw === 90 || rotateRaw === 180 || rotateRaw === 270
      ? (rotateRaw as 0 | 90 | 180 | 270)
      : undefined;
  return {
    mode: cable.mode === 'gallery' ? 'gallery' : cable.mode === 'guide' ? 'guide' : undefined,
    targetKind: target.kind,
    targetId: target.id,
    channel: target.channelId,
    rotate,
    lock: typeof cable.lock === 'boolean' ? cable.lock : undefined,
    qr: typeof cable.qr === 'boolean' ? cable.qr : undefined,
    playlist: typeof cable.playlist === 'boolean' ? cable.playlist : undefined,
    nosplash: typeof cable.nosplash === 'boolean' ? cable.nosplash : undefined,
    hudMode:
      cable.hud === 'always' || cable.hud === 'start' || cable.hud === 'never'
        ? cable.hud
        : undefined,
    hudShowSec:
      typeof cable.hud_sec === 'number' && Number.isFinite(cable.hud_sec)
        ? cable.hud_sec
        : undefined,
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
  if (cable.nosplash !== false) base.searchParams.set('nosplash', '1');

  const target = resolveModeTarget(pi, cable);

  if (typeof cable.theme === 'string' && cable.theme.trim().length > 0) {
    base.searchParams.set('theme', cable.theme.trim());
  }
  if (cable.nosplash === false) base.searchParams.delete('nosplash');
  if (cable.mode === 'gallery') base.searchParams.set('gallery', '1');
  if (cable.lock === true) base.searchParams.set('lock', '1');
  // In gallery mode, the guide defaults to "locked" unless explicitly disabled.
  // Emit lock=0 when the profile sets lock=false to override that default.
  if (cable.mode === 'gallery' && cable.lock === false) base.searchParams.set('lock', '0');
  if (cable.qr === false) base.searchParams.set('qr', '0');
  if (cable.qr === true) base.searchParams.set('qr', '1');
  if (cable.hud === 'always' || cable.hud === 'start' || cable.hud === 'never') {
    base.searchParams.set('hud', cable.hud);
  }
  if (typeof cable.hud_sec === 'number' && Number.isFinite(cable.hud_sec)) {
    base.searchParams.set('hudSec', String(cable.hud_sec));
  }
  if (target.channelId) base.searchParams.set('channel', target.channelId);
  if (target.kind) base.searchParams.set('targetKind', target.kind);
  if (target.id) base.searchParams.set('targetId', target.id);
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
  const rotateRaw =
    typeof cable.display_rotate === "number"
      ? cable.display_rotate
      : typeof (cable as any).display_rotate === "string"
        ? Number((cable as any).display_rotate)
        : NaN;
  if (rotateRaw === 0 || rotateRaw === 90 || rotateRaw === 180 || rotateRaw === 270) {
    base.searchParams.set("rotate", String(rotateRaw));
  }

  return base.toString();
}

function resolveRotationForPi(pi: InventoryPi, cable: CableModeDefaults): 0 | 90 | 180 | 270 {
  const raw =
    typeof cable.display_rotate === "number"
      ? cable.display_rotate
      : typeof (cable as any).display_rotate === "string"
        ? Number((cable as any).display_rotate)
        : NaN;
  if (raw === 0 || raw === 90 || raw === 180 || raw === 270) {
    return raw as 0 | 90 | 180 | 270;
  }
  const orientation = String(pi.orientation ?? "").trim().toLowerCase();
  return pi.displayRotate ?? (orientation === "portrait" ? 90 : 0);
}

async function postKioskUrl(opts: {
  host: string;
  apiKey?: string | null;
  url: string;
  restart?: boolean;
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
      body: JSON.stringify({ url: opts.url, restart: opts.restart ?? true }),
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
      body: JSON.stringify({ screenId: opts.screenId, state: opts.state, replace: true }),
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
  resolveRotation?: (pi: InventoryPi) => 0 | 90 | 180 | 270;
  afterOk?: (pi: InventoryPi) => Promise<{ prefetch?: ApplyModeResult['prefetch'] } | void>;
}): Promise<ApplyModeResult[]> {
  const timeoutMs = opts.timeoutMs ?? 2500;
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const limit = createLimit(concurrency);

  const inventory = await loadInventoryFromRegistry(opts.repoRoot, opts.inventoryPath);

  const { targets, missingIds } = selectInventoryTargets(inventory, opts.piIds);
  const targetResults = await Promise.all(
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
        let prefetch: ApplyModeResult['prefetch'] | undefined = undefined;
        let state: ApplyModeResult['state'] | undefined = undefined;
        if (res.ok) {
          const o = String(pi.orientation ?? "").trim().toLowerCase();
          const rotation: 0 | 90 | 180 | 270 = opts.resolveRotation
            ? opts.resolveRotation(pi)
            : pi.displayRotate ?? (o === "portrait" ? 90 : 0);
          // Ignore failures; kiosk URL is the primary contract.
          await postRotate({ host: addr, apiKey, rotation, timeoutMs }).catch(() => {});

          if (opts.afterOk) {
            try {
              const out = await opts.afterOk(pi);
              if (out && typeof out === 'object') {
                if ('prefetch' in out) {
                  prefetch = (out as any).prefetch ?? undefined;
                }
                if ('state' in out) {
                  state = (out as any).state ?? undefined;
                }
              }
            } catch (err) {
              // Best-effort; don't fail apply-mode.
              prefetch = {
                channelIds: [],
                stash: { ok: false, status: null, ms: null, queued: null, error: (err as Error).message },
              };
            }
          }
        }

        return {
          pi,
          url,
          ok: res.ok,
          status: res.status,
          ms: res.ms,
          error: res.error,
          state,
          prefetch,
        } satisfies ApplyModeResult;
      })
    )
  );
  const missingResults = missingIds.map((id) => ({
    pi: fallbackPi(id),
    url: '',
    ok: false,
    status: null,
    ms: null,
    error: 'unknown_pi_id',
  }) satisfies ApplyModeResult);
  return [...targetResults, ...missingResults];
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
    resolveRotation: (pi) => resolveRotationForPi(pi, mergeCableMode(mode, pi.id)),
    afterOk: async (pi) => {
      const addr = pi.ip || pi.host;
      if (!addr) return;

      const cable = mergeCableMode(mode, pi.id);

      // IMPORTANT:
      // The guide treats `/api/kiosk/state` as higher-precedence than query params.
      // That means a stale kiosk-state record can "override" a freshly applied kiosk URL.
      // After applying the node kiosk URL (which restarts Chromium), also persist the
      // equivalent kiosk state to the local cable server so the Pi lands in the expected
      // channel/mode reliably.
      const statePayload = buildKioskState(pi, cable);
      const stateRes = await postJson({
        url: `http://${addr}:${pi.serverPort}/api/kiosk/state`,
        body: { screenId: pi.nodeName, state: statePayload, replace: true },
        timeoutMs: opts.timeoutMs ?? 2500,
      }).catch(() => null);

      const channelIds = resolvePrefetchChannels(pi, cable);
      const targets = resolvePrefetchTargets(pi, cable);
      if (!channelIds.length && !targets.length) return;

      const wantStash = (cable as any).prefetch_stash === false ? false : true;
      // Default false because older Pis may not have /api/cache/prefetch yet.
      const wantCache = (cable as any).prefetch_cache === true;
      const timeoutMs = opts.timeoutMs ?? 2500;

      const firstChannelId = channelIds.length === 1 ? channelIds[0] : '';
      const firstTarget = targets.length === 1 ? targets[0] : '';
      const [stashRes, cacheRes] = await Promise.all([
        wantStash
          ? postJson({
              url: `http://${addr}:${pi.serverPort}/api/stash/prefetch`,
              // Back-compat: older servers only accept channelId.
              body: {
                channelId: firstChannelId || undefined,
                channelIds,
                target: firstTarget || undefined,
                targets,
              },
              timeoutMs,
            })
          : Promise.resolve(null),
        wantCache
          ? postJson({
              url: `http://${addr}:${pi.serverPort}/api/cache/prefetch`,
              body: {
                channelId: firstChannelId || undefined,
                channelIds,
                target: firstTarget || undefined,
                targets,
              },
              timeoutMs,
            })
          : Promise.resolve(null),
      ]);

      const stash =
        stashRes === null
          ? undefined
          : {
              ok: stashRes.ok,
              status: stashRes.status,
              ms: stashRes.ms,
              queued: typeof stashRes.json?.queued === 'number' ? stashRes.json.queued : null,
              error: stashRes.error,
            };
      const cache =
        cacheRes === null
          ? undefined
          : {
              ok: cacheRes.ok,
              status: cacheRes.status,
              ms: cacheRes.ms,
              queued: typeof cacheRes.json?.queued === 'number' ? cacheRes.json.queued : null,
              error: cacheRes.error,
            };

      return {
        prefetch: { channelIds, targets, stash, cache },
        state: stateRes
          ? {
              ok: stateRes.ok,
              status: stateRes.status,
              ms: stateRes.ms,
              error: stateRes.error,
            }
          : { ok: false, status: null, ms: null, error: 'state_post_failed' },
      } as any;
    },
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
    resolveRotation: (pi) => resolveRotationForPi(pi, mergeCableMode(opts.mode, pi.id)),
    afterOk: async (pi) => {
      const addr = pi.ip || pi.host;
      if (!addr) return;

      const cable = mergeCableMode(opts.mode, pi.id);

      // Keep kiosk state aligned with the applied URL so stale state records
      // cannot override explicit runtime targets on next guide refresh.
      const statePayload = buildKioskState(pi, cable);
      const stateRes = await postJson({
        url: `http://${addr}:${pi.serverPort}/api/kiosk/state`,
        body: { screenId: pi.nodeName, state: statePayload, replace: true },
        timeoutMs: opts.timeoutMs ?? 2500,
      }).catch(() => null);

      const channelIds = resolvePrefetchChannels(pi, cable);
      const targets = resolvePrefetchTargets(pi, cable);
      if (!channelIds.length && !targets.length) {
        return {
          state: stateRes
            ? {
                ok: stateRes.ok,
                status: stateRes.status,
                ms: stateRes.ms,
                error: stateRes.error,
              }
            : { ok: false, status: null, ms: null, error: 'state_post_failed' },
        } as any;
      }

      const wantStash = (cable as any).prefetch_stash === false ? false : true;
      const wantCache = (cable as any).prefetch_cache === true;
      const timeoutMs = opts.timeoutMs ?? 2500;
      const firstChannelId = channelIds.length === 1 ? channelIds[0] : '';
      const firstTarget = targets.length === 1 ? targets[0] : '';

      const [stashRes, cacheRes] = await Promise.all([
        wantStash
          ? postJson({
              url: `http://${addr}:${pi.serverPort}/api/stash/prefetch`,
              body: {
                channelId: firstChannelId || undefined,
                channelIds,
                target: firstTarget || undefined,
                targets,
              },
              timeoutMs,
            })
          : Promise.resolve(null),
        wantCache
          ? postJson({
              url: `http://${addr}:${pi.serverPort}/api/cache/prefetch`,
              body: {
                channelId: firstChannelId || undefined,
                channelIds,
                target: firstTarget || undefined,
                targets,
              },
              timeoutMs,
            })
          : Promise.resolve(null),
      ]);

      const stash =
        stashRes === null
          ? undefined
          : {
              ok: stashRes.ok,
              status: stashRes.status,
              ms: stashRes.ms,
              queued: typeof stashRes.json?.queued === 'number' ? stashRes.json.queued : null,
              error: stashRes.error,
            };
      const cache =
        cacheRes === null
          ? undefined
          : {
              ok: cacheRes.ok,
              status: cacheRes.status,
              ms: cacheRes.ms,
              queued: typeof cacheRes.json?.queued === 'number' ? cacheRes.json.queued : null,
              error: cacheRes.error,
            };

      return {
        prefetch: { channelIds, targets, stash, cache },
        state: stateRes
          ? {
              ok: stateRes.ok,
              status: stateRes.status,
              ms: stateRes.ms,
              error: stateRes.error,
            }
          : { ok: false, status: null, ms: null, error: 'state_post_failed' },
      } as any;
    },
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

  const { targets, missingIds } = selectInventoryTargets(inventory, opts.piIds);
  const targetResults = await Promise.all(
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

        // Keep persisted launcher URL aligned with state applies without forcing a restart.
        // This prevents reboot/startup drift while avoiding visible flicker mid-session.
        let urlSync:
          | { ok: boolean; status: number | null; ms: number | null; error?: string }
          | undefined = undefined;
        let rotateSync:
          | { ok: boolean; status: number | null; ms: number | null; error?: string }
          | undefined = undefined;
        if (res.ok) {
          const apiKey = getApiKeyForPi(pi.id);
          const rotation = resolveRotationForPi(pi, cable);
          rotateSync = await postRotate({
            host: addr,
            apiKey,
            rotation,
            timeoutMs,
          }).catch((err) => ({
            ok: false,
            status: null,
            ms: null,
            error: (err as Error).message,
          }));
          urlSync = await postKioskUrl({
            host: addr,
            apiKey,
            url,
            restart: false,
            timeoutMs,
          }).catch((err) => ({
            ok: false,
            status: null,
            ms: null,
            error: (err as Error).message,
          }));
        }

        return {
          pi,
          url,
          // State apply is the source of truth for active playback.
          // URL sync is best-effort (used for reboot/startup drift prevention),
          // so auth failures there should not mark the apply itself as failed.
          ok: res.ok,
          status: res.status,
          ms: res.ms,
          error: res.error ?? undefined,
          state:
            urlSync || rotateSync
              ? {
                  ok: (urlSync?.ok ?? true) && (rotateSync?.ok ?? true),
                  status: urlSync?.status ?? rotateSync?.status ?? null,
                  ms: urlSync?.ms ?? rotateSync?.ms ?? null,
                  error: [
                    rotateSync && !rotateSync.ok
                      ? `rotate_sync_failed:${rotateSync.error ?? "unknown"}`
                      : null,
                    urlSync && !urlSync.ok
                      ? `kiosk_url_sync_failed:${urlSync.error ?? "unknown"}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(";") || undefined,
                }
              : undefined,
        } satisfies ApplyModeResult;
      })
    )
  );
  const missingResults = missingIds.map((id) => ({
    pi: fallbackPi(id),
    url: '',
    ok: false,
    status: null,
    ms: null,
    error: 'unknown_pi_id',
  }) satisfies ApplyModeResult);
  return [...targetResults, ...missingResults];
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

  const { targets, missingIds } = selectInventoryTargets(inventory, opts.piIds);
  const targetResults = await Promise.all(
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
  const missingResults = missingIds.map((id) => ({
    pi: fallbackPi(id),
    url: '',
    ok: false,
    status: null,
    ms: null,
    error: 'unknown_pi_id',
  }) satisfies ApplyModeResult);
  return [...targetResults, ...missingResults];
}
