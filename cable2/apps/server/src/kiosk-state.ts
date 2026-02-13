import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export type KioskState = {
  // High-level mode hints. The guide can treat these as overrides.
  mode?: 'gallery' | 'guide';
  targetKind?: 'media' | 'playlist' | 'block' | 'channel';
  targetId?: string;
  channel?: string; // channel id or number string
  rotate?: 0 | 90 | 180 | 270;
  lock?: boolean;
  qr?: boolean;
  playlist?: boolean;
  nosplash?: boolean;
  hudMode?: 'always' | 'start' | 'never';
  hudShowSec?: number;
  theme?: string;
  scale?: number;
  textScale?: number;
  hours?: number;
};

export type KioskStateRecord = {
  updatedAt: number;
  state: KioskState;
};

type KioskStateStoreFile = {
  version: 1;
  updatedAt: number;
  byScreenId: Record<string, KioskStateRecord>;
};

export function normalizeScreenId(input: string): string {
  return String(input ?? '').trim();
}

export async function loadKioskStateStore(filePath: string): Promise<KioskStateStoreFile> {
  try {
    const raw = await fsp.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<KioskStateStoreFile>;
    if (parsed && parsed.version === 1 && parsed.byScreenId && typeof parsed.byScreenId === 'object') {
      return {
        version: 1,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
        byScreenId: parsed.byScreenId as any,
      };
    }
  } catch {
    // ignore; create new
  }
  return { version: 1, updatedAt: Date.now(), byScreenId: {} };
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fsp.writeFile(tmp, content, 'utf-8');
  await fsp.rename(tmp, filePath);
}

export class KioskStateStore {
  private filePath: string;
  private data: KioskStateStoreFile;

  constructor(filePath: string, initial: KioskStateStoreFile) {
    this.filePath = filePath;
    this.data = initial;
  }

  static async open(filePath: string): Promise<KioskStateStore> {
    const initial = await loadKioskStateStore(filePath);
    return new KioskStateStore(filePath, initial);
  }

  get(screenId: string): KioskStateRecord | null {
    const key = normalizeScreenId(screenId);
    if (!key) return null;
    return this.data.byScreenId[key] ?? null;
  }

  list(): Array<{ screenId: string; record: KioskStateRecord }> {
    return Object.entries(this.data.byScreenId)
      .map(([screenId, record]) => ({ screenId, record }))
      .sort((a, b) => a.screenId.localeCompare(b.screenId));
  }

  async set(screenId: string, next: KioskState): Promise<KioskStateRecord> {
    const key = normalizeScreenId(screenId);
    if (!key) throw new Error('missing_screenId');
    const prev = this.data.byScreenId[key]?.state ?? {};
    const merged = { ...prev, ...next };
    const record: KioskStateRecord = { updatedAt: Date.now(), state: merged };
    this.data.byScreenId[key] = record;
    this.data.updatedAt = Date.now();
    await this.flush();
    return record;
  }

  async replace(screenId: string, state: KioskState): Promise<KioskStateRecord> {
    const key = normalizeScreenId(screenId);
    if (!key) throw new Error('missing_screenId');
    const record: KioskStateRecord = { updatedAt: Date.now(), state: state ?? {} };
    this.data.byScreenId[key] = record;
    this.data.updatedAt = Date.now();
    await this.flush();
    return record;
  }

  async clear(screenId: string): Promise<void> {
    const key = normalizeScreenId(screenId);
    if (!key) return;
    delete this.data.byScreenId[key];
    this.data.updatedAt = Date.now();
    await this.flush();
  }

  async flush(): Promise<void> {
    // If the containing dir is unwritable we don't want to crash the server; best-effort.
    try {
      const content = JSON.stringify(this.data, null, 2);
      await writeFileAtomic(this.filePath, content);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[kiosk-state] flush failed', (err as Error).message);
    }
  }
}

export function getDefaultKioskStatePath(repoRoot: string): string {
  // Keep it inside the repo so fast-cable-update / rsync deployments preserve it.
  // This lives alongside other server-local data files.
  return path.resolve(repoRoot, 'cable2/apps/server/data/kiosk-state.json');
}

export function coerceBoolean(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  return undefined;
}

export function coerceNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

export function coerceString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s : undefined;
}

export function sanitizeKioskState(input: unknown): KioskState {
  const raw = (input ?? {}) as any;
  const mode = raw.mode === 'gallery' || raw.mode === 'guide' ? raw.mode : undefined;
  const targetKindRaw =
    coerceString(raw.targetKind) ??
    coerceString(raw.target_kind) ??
    coerceString(raw.target?.kind);
  const targetKind =
    targetKindRaw === 'media' ||
    targetKindRaw === 'playlist' ||
    targetKindRaw === 'block' ||
    targetKindRaw === 'channel'
      ? targetKindRaw
      : undefined;
  const targetId =
    coerceString(raw.targetId) ??
    coerceString(raw.target_id) ??
    coerceString(raw.target?.id);
  return {
    mode,
    targetKind,
    targetId,
    channel: coerceString(raw.channel),
    rotate:
      coerceNumber(raw.rotate) === 0 ||
      coerceNumber(raw.rotate) === 90 ||
      coerceNumber(raw.rotate) === 180 ||
      coerceNumber(raw.rotate) === 270
        ? (coerceNumber(raw.rotate) as 0 | 90 | 180 | 270)
        : undefined,
    lock: coerceBoolean(raw.lock),
    qr: coerceBoolean(raw.qr),
    playlist: coerceBoolean(raw.playlist),
    nosplash: coerceBoolean(raw.nosplash),
    hudMode:
      coerceString(raw.hudMode) === 'always' ||
      coerceString(raw.hudMode) === 'start' ||
      coerceString(raw.hudMode) === 'never'
        ? (coerceString(raw.hudMode) as 'always' | 'start' | 'never')
        : coerceString(raw.hud) === 'always' ||
            coerceString(raw.hud) === 'start' ||
            coerceString(raw.hud) === 'never'
          ? (coerceString(raw.hud) as 'always' | 'start' | 'never')
          : undefined,
    hudShowSec: coerceNumber(raw.hudShowSec ?? raw.hud_sec ?? raw.hudSec),
    theme: coerceString(raw.theme),
    scale: coerceNumber(raw.scale),
    textScale: coerceNumber(raw.textScale),
    hours: coerceNumber(raw.hours),
  };
}
