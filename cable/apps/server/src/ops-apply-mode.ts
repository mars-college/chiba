import path from 'node:path';
import fsp from 'node:fs/promises';
import toml from '@iarna/toml';

export type InventoryPi = {
  id: string;
  host: string;
  ip?: string;
  nodeName: string;
  guidePort: number;
  orientation?: string; // "portrait" | "landscape" (best-effort; treated as hardware property)
};

export type CableModeDefaults = {
  mode?: string;
  theme?: string;
  nosplash?: boolean;
  lock?: boolean;
  qr?: boolean;
  channel?: string;
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
    const guidePort =
      typeof node?.guide_port === 'number'
        ? node.guide_port
        : typeof node?.guide_port === 'string'
          ? Number(node.guide_port)
          : defaultGuidePort;
    pis.push({
      id,
      host,
      ip: ip || undefined,
      nodeName,
      guidePort: Number.isFinite(guidePort) ? guidePort : 5173,
      orientation: orientation || undefined,
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

export function buildKioskUrl(pi: InventoryPi, cable: CableModeDefaults): string {
  const base = new URL(`http://localhost:${pi.guidePort}/`);
  base.searchParams.set('screenId', pi.nodeName);

  if (typeof cable.theme === 'string' && cable.theme.trim().length > 0) {
    base.searchParams.set('theme', cable.theme.trim());
  }
  if (cable.nosplash === true) base.searchParams.set('nosplash', '1');
  if (cable.mode === 'gallery') base.searchParams.set('gallery', '1');
  if (cable.lock === true) base.searchParams.set('lock', '1');
  if (cable.qr === false) base.searchParams.set('qr', '0');
  if (typeof cable.channel === 'string' && cable.channel.trim().length > 0) {
    base.searchParams.set('channel', cable.channel.trim());
  }
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
  apiKey: string;
  url: string;
  timeoutMs: number;
}): Promise<{ ok: boolean; status: number | null; ms: number | null; error?: string }> {
  const started = Date.now();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs);
  try {
    const res = await fetch(`http://${opts.host}:8080/kiosk-url`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.apiKey}`,
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
  apiKey: string;
  rotation: 0 | 90 | 180 | 270;
  timeoutMs: number;
}): Promise<{ ok: boolean; status: number | null; ms: number | null; error?: string }> {
  const started = Date.now();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs);
  try {
    const res = await fetch(`http://${opts.host}:8080/rotate`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.apiKey}`,
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

export async function applyModeToFleet(opts: {
  repoRoot: string;
  inventoryPath: string;
  modePath: string;
  piIds?: string[]; // if omitted: apply to all inventory pis
  concurrency?: number;
  timeoutMs?: number;
  dryRun?: boolean;
}): Promise<ApplyModeResult[]> {
  const timeoutMs = opts.timeoutMs ?? 2500;
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const limit = createLimit(concurrency);

  const inventory = await loadInventoryFromRegistry(opts.repoRoot, opts.inventoryPath);
  const mode = await loadModeFromFile(opts.repoRoot, opts.modePath);

  const allow = new Set((opts.piIds ?? []).filter((s) => s.trim().length > 0));
  const targets = allow.size > 0 ? inventory.filter((p) => allow.has(p.id)) : inventory;

  return await Promise.all(
    targets.map((pi) =>
      limit(async () => {
        const cable = mergeCableMode(mode, pi.id);
        const url = buildKioskUrl(pi, cable);

        if (opts.dryRun) {
          return { pi, url, ok: true, status: null, ms: null } satisfies ApplyModeResult;
        }

        const addr = pi.ip || pi.host;
        if (!addr) {
          return { pi, url, ok: false, status: null, ms: null, error: 'missing_host_or_ip' } satisfies ApplyModeResult;
        }
        const apiKey = getApiKeyForPi(pi.id);
        if (!apiKey) {
          return {
            pi,
            url,
            ok: false,
            status: null,
            ms: null,
            error: `missing_api_key (set CHIBA_API_KEY_${toEnvSuffix(pi.id)})`,
          } satisfies ApplyModeResult;
        }

        const res = await postKioskUrl({ host: addr, apiKey, url, timeoutMs });

        // Best-effort: rotate portrait screens as part of "apply mode", so portrait hardware
        // doesn't require per-Pi manual intervention.
        //
        // We treat missing orientation as landscape-by-default (rotation 0).
        if (res.ok) {
          const o = String(pi.orientation ?? '')
            .trim()
            .toLowerCase();
          const rotation: 0 | 90 | 180 | 270 = o === 'portrait' ? 90 : 0;
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
