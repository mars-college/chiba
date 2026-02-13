import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import mime from 'mime-types';
import { buildIndexFromFile, type GuideIndex } from './index-builder.js';
import { buildIndexFromConfig } from './index-builder-config.js';
import { loadConfig, type ChannelEmbedConfig, type LoadedConfig } from './config.js';
import { createVillageCapture } from './village-capture.js';
import { createWeatherstarCapture } from './weatherstar-capture.js';
import { createImagePoller } from './image-poller.js';
import { buildFleetResponse, getLocalOpsMeta, loadFleetFromRegistry, probeFleetHealth, probePiHealth } from './ops-fleet.js';
import {
  applyKioskUrlToFleet,
  applyModeToFleet,
  applyModeToFleetFromObject,
  applyKioskStateToFleetFromObject,
  buildKioskState,
  buildKioskUrl,
  loadModeFromFile,
  mergeCableMode,
  openArtOnFleet,
  getApiKeyForPi,
  type CableMode,
  type CableModeDefaults,
  type ApplyModeResult,
  type InventoryPi,
} from './ops-apply-mode.js';
import { KioskStateStore, getDefaultKioskStatePath, sanitizeKioskState, type KioskState } from './kiosk-state.js';

function loadEnvFileIfPresent(p: string) {
  // Keep this tiny and dependency-free; we run on Pis and in local dev.
  try {
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, 'utf-8');
    for (const line of raw.split('\n')) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const m = s.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = (m[2] ?? '').trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // ignore; best-effort only
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 8787);
const app = express();
app.use(express.json({ limit: '2mb' }));
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const proxyWss = new WebSocketServer({ noServer: true });
const WS_HEARTBEAT_MS = Number(process.env.WS_HEARTBEAT_MS ?? 25000);
const wsAlive = new WeakMap<WebSocket, boolean>();

// Monorepo root (for registries, git sha, shared assets).
const repoRoot = path.resolve(__dirname, '../../../..');
// Cable root (for cable-local config defaults).
const cableRoot = path.resolve(__dirname, '../../..');

// Load local env files so ops endpoints can authenticate to node APIs (8080).
// On Pis, `scripts/setup-node.sh` writes `/home/pi/chiba/.env` with API_KEY.
loadEnvFileIfPresent(path.resolve(repoRoot, '.env'));
loadEnvFileIfPresent(path.resolve(repoRoot, '.env.pis.local'));
loadEnvFileIfPresent(path.resolve(repoRoot, 'scripts/pis/.env.pis.local'));

const distDir = path.resolve(__dirname, '../../guide/dist');
const indexFile = path.join(distDir, 'index.html');
const opsDistDir = path.resolve(__dirname, '../../ops/dist');
const opsIndexFile = path.join(opsDistDir, 'index.html');
const opsDevUrl = (process.env.CHIBA_OPS_DEV_URL ?? '').trim().replace(/\/$/, '');
const sourcesFile = path.resolve(__dirname, '../data/sources.json');
const kioskStatePath = getDefaultKioskStatePath(repoRoot);
const configPath =
  process.env.CHIBA_CONFIG ??
  (() => {
    const cableConfig = path.resolve(cableRoot, 'config/chiba.toml');
    if (fs.existsSync(cableConfig)) return cableConfig;
    return path.resolve(repoRoot, 'config/chiba.toml');
  })();

function resolveOpsRegistryPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) return 'scripts/pis/registry.toml';
  if (path.isAbsolute(trimmed)) return trimmed;

  const candidates = [
    path.resolve(repoRoot, trimmed),
    path.resolve(cableRoot, trimmed),
    path.resolve(process.cwd(), trimmed),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return path.relative(repoRoot, candidate);
    }
  }
  return trimmed;
}

// Ops dashboard registry:
// Prefer explicit env override, otherwise default to committable source-of-truth registry.
const OPS_REGISTRY_PATH = resolveOpsRegistryPath(
  process.env.CHIBA_OPS_REGISTRY ??
    process.env.CHIBA_PIS_REGISTRY ??
    'scripts/pis/registry.toml'
);
const OPS_CONCURRENCY = Number(process.env.CHIBA_OPS_CONCURRENCY ?? 8);
const OPS_TIMEOUT_MS = Number(process.env.CHIBA_OPS_TIMEOUT_MS ?? 1200);
const OPS_CONTROL_PLANE_URL = (
  process.env.CHIBA_OPS_CONTROL_PLANE_URL ??
  process.env.CHIBA_CONTROL_PLANE_URL ??
  ''
).trim().replace(/\/$/, '');
const OPS_USE_CONTROL_PLANE = OPS_CONTROL_PLANE_URL.length > 0;

type OpsControlPlaneNode = {
  id: string;
  host?: string;
  ip?: string;
  nodeName?: string;
  guidePort?: number;
  serverPort?: number;
};

type OpsControlPlaneNodeStatus = {
  nodeId: string;
  nodeName?: string;
  platform?: string;
  hostname?: string;
  seenAt?: number;
  runtime?: {
    nodeAgentVersion?: string | null;
    deployGitSha?: string | null;
    cableVersion?: string | null;
    cableGitSha?: string | null;
    cableReachable?: boolean;
    cableStatus?: number | null;
    cableCheckedAt?: number;
    kioskUrl?: string | null;
  };
};

type RuntimeCatalog = {
  media: any[];
  playlists: any[];
  blocks: any[];
  channels: any[];
};

type RuntimeCatalogSource = 'control-plane' | 'local';

const RUNTIME_CATALOG_TTL_MS = Math.max(
  1_000,
  Number(process.env.CHIBA_RUNTIME_CATALOG_TTL_MS ?? 5_000)
);

let runtimeCatalogCache:
  | {
      at: number;
      source: RuntimeCatalogSource;
      catalog: RuntimeCatalog;
    }
  | null = null;
let runtimeCatalogInflight: Promise<{
  source: RuntimeCatalogSource;
  catalog: RuntimeCatalog;
}> | null = null;

function formatHostForUrl(hostOrIp: string): string {
  if (hostOrIp.includes(':') && !hostOrIp.startsWith('[')) {
    return `[${hostOrIp}]`;
  }
  return hostOrIp;
}

async function fetchControlPlaneJson(pathname: string, timeoutMs: number): Promise<any> {
  if (!OPS_CONTROL_PLANE_URL) throw new Error('ops_control_plane_url_not_configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + 800);
  try {
    const response = await fetch(`${OPS_CONTROL_PLANE_URL}${pathname}`, {
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      throw new Error(`control_plane_http_${response.status}`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function postControlPlaneJson(pathname: string, body: unknown, timeoutMs: number): Promise<any> {
  if (!OPS_CONTROL_PLANE_URL) throw new Error('ops_control_plane_url_not_configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + 1200);
  try {
    const response = await fetch(`${OPS_CONTROL_PLANE_URL}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      throw new Error(`control_plane_http_${response.status}`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function parseRuntimeCatalog(value: unknown): RuntimeCatalog | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const media = Array.isArray(obj.media) ? obj.media : null;
  const playlists = Array.isArray(obj.playlists) ? obj.playlists : null;
  const blocks = Array.isArray(obj.blocks) ? obj.blocks : null;
  const channels = Array.isArray(obj.channels) ? obj.channels : null;
  if (!media || !playlists || !blocks || !channels) return null;
  return { media, playlists, blocks, channels };
}

function buildRuntimeCatalogFromLoadedConfig(config: LoadedConfig | null): RuntimeCatalog | null {
  if (!config) return null;
  return {
    media: Object.values(config.mediaById ?? {}),
    playlists: Object.values(config.playlistsById ?? {}),
    blocks: Object.values(config.blocksById ?? {}),
    channels: config.channels ?? [],
  };
}

async function fetchRuntimeCatalogFromControlPlane(timeoutMs: number): Promise<RuntimeCatalog | null> {
  if (!OPS_CONTROL_PLANE_URL) return null;
  try {
    const payload = await fetchControlPlaneJson('/api/catalog', timeoutMs);
    return parseRuntimeCatalog(payload?.catalog);
  } catch {
    return null;
  }
}

function toLoadedConfigLikeFromRuntimeCatalog(catalog: RuntimeCatalog): LoadedConfig {
  const normalizeRow = (kind: 'media' | 'playlist' | 'block' | 'channel', row: any) => {
    if (!row || typeof row !== 'object') return row;
    const out: any = { ...row };
    if (kind === 'playlist') {
      if (!Array.isArray(out.items) && Array.isArray(out.item)) out.items = out.item;
      if (!Array.isArray(out.programs) && Array.isArray(out.program)) out.programs = out.program;
    }
    if (kind === 'block') {
      if (!Array.isArray(out.items) && Array.isArray(out.item)) out.items = out.item;
      if (!Array.isArray(out.programs) && Array.isArray(out.program)) out.programs = out.program;
    }
    if (kind === 'channel') {
      if (!Array.isArray(out.programs) && Array.isArray(out.program)) out.programs = out.program;
      if (!Array.isArray(out.blocks) && Array.isArray(out.block)) {
        out.blocks = out.block
          .map((entry: any) => (typeof entry === 'string' ? entry : String(entry?.id ?? '').trim()))
          .filter((entry: string) => entry.length > 0);
      }
    }
    return out;
  };

  const byId = (rows: any[]) =>
    Object.fromEntries(
      rows
        .map((row) => {
          const normalized =
            rows === catalog.media
              ? normalizeRow('media', row)
              : rows === catalog.playlists
                ? normalizeRow('playlist', row)
                : rows === catalog.blocks
                  ? normalizeRow('block', row)
                  : normalizeRow('channel', row);
          return [String((normalized as any)?.id ?? '').trim(), normalized] as const;
        })
        .filter(([id]) => id.length > 0)
    );
  return {
    channels: catalog.channels.map((row) => normalizeRow('channel', row)),
    mediaById: byId(catalog.media),
    playlistsById: byId(catalog.playlists),
    blocksById: byId(catalog.blocks),
  } as LoadedConfig;
}

async function getRuntimeCatalog(): Promise<{ source: RuntimeCatalogSource; catalog: RuntimeCatalog }> {
  const now = Date.now();
  if (runtimeCatalogCache && now - runtimeCatalogCache.at < RUNTIME_CATALOG_TTL_MS) {
    return { source: runtimeCatalogCache.source, catalog: runtimeCatalogCache.catalog };
  }
  if (runtimeCatalogInflight) return runtimeCatalogInflight;

  runtimeCatalogInflight = (async () => {
    const controlPlaneCatalog = await fetchRuntimeCatalogFromControlPlane(
      Math.min(4_000, Math.max(800, OPS_TIMEOUT_MS + 600))
    );
    if (controlPlaneCatalog) {
      runtimeCatalogCache = {
        at: Date.now(),
        source: 'control-plane',
        catalog: controlPlaneCatalog,
      };
      return { source: 'control-plane' as const, catalog: controlPlaneCatalog };
    }

    const localCatalog = buildRuntimeCatalogFromLoadedConfig(loadedConfig);
    if (localCatalog) {
      runtimeCatalogCache = {
        at: Date.now(),
        source: 'local',
        catalog: localCatalog,
      };
      return { source: 'local' as const, catalog: localCatalog };
    }

    throw new Error('catalog_not_ready');
  })();

  try {
    return await runtimeCatalogInflight;
  } finally {
    runtimeCatalogInflight = null;
  }
}

async function getTargetResolutionConfig(): Promise<LoadedConfig | null> {
  try {
    const { catalog } = await getRuntimeCatalog();
    return toLoadedConfigLikeFromRuntimeCatalog(catalog);
  } catch {
    return loadedConfig;
  }
}

function toOpsFleetHealthFromControlPlane(args: {
  nodes: OpsControlPlaneNode[];
  statuses: OpsControlPlaneNodeStatus[];
  registryPath: string | null;
  liveKioskUrlById?: Map<string, string>;
  liveProbeById?: Map<string, any>;
}): any {
  const now = Date.now();
  const local = getLocalOpsMeta(repoRoot);
  const statusById = new Map(args.statuses.map((entry) => [entry.nodeId, entry]));
  const freshnessMs = 45_000;

  const pis = args.nodes.map((node) => {
    const host = typeof node.host === 'string' ? node.host : '';
    const ip = typeof node.ip === 'string' ? node.ip : undefined;
    const addr = (ip ?? host).trim();
    const liveProbe = args.liveProbeById?.get(node.id);
    const status = statusById.get(node.id);
    const seenAt = typeof status?.seenAt === 'number' ? status.seenAt : null;
    const fresh = seenAt !== null && now - seenAt <= freshnessMs;
    const hasAddr = addr.length > 0;
    const healthy = hasAddr && fresh;
    const runtime = status?.runtime;
    const nodeAgentVersion =
      typeof runtime?.nodeAgentVersion === 'string' && runtime.nodeAgentVersion.trim().length > 0
        ? runtime.nodeAgentVersion.trim()
        : null;
    const cableVersion =
      typeof runtime?.cableVersion === 'string' && runtime.cableVersion.trim().length > 0
        ? runtime.cableVersion.trim()
        : null;
    const cableGitSha =
      typeof runtime?.cableGitSha === 'string' && runtime.cableGitSha.trim().length > 0
        ? runtime.cableGitSha.trim()
        : null;
    const cableCheckedAt = typeof runtime?.cableCheckedAt === 'number' ? runtime.cableCheckedAt : null;
    const cableProbeFresh = cableCheckedAt !== null && now - cableCheckedAt <= freshnessMs * 2;
    const cableReachable = runtime?.cableReachable === true && cableProbeFresh && fresh;
    const cableHttpStatus = typeof runtime?.cableStatus === 'number' ? runtime.cableStatus : null;
    const runtimeKioskUrl =
      typeof runtime?.kioskUrl === 'string' && runtime.kioskUrl.trim().length > 0
        ? runtime.kioskUrl.trim()
        : null;
    const liveKioskUrl = args.liveKioskUrlById?.get(node.id) ?? null;
    const kioskUrl = liveKioskUrl || runtimeKioskUrl;

    const syntheticPing = {
      ok: healthy,
      ms: healthy ? 1 : null,
      error: healthy ? undefined : hasAddr ? 'stale_or_missing_heartbeat' : 'missing_host_or_ip',
    };
    const syntheticTcp = {
      ssh22: { ok: healthy, ms: healthy ? 1 : null, error: healthy ? undefined : 'stale_or_missing_heartbeat' },
      node8080: { ok: healthy, ms: healthy ? 1 : null, error: healthy ? undefined : 'stale_or_missing_heartbeat' },
      cable8787: { ok: healthy, ms: healthy ? 1 : null, error: healthy ? undefined : 'stale_or_missing_heartbeat' },
    };
    const syntheticNodeStatus = {
      ok: healthy,
      ms: healthy ? 1 : null,
      status: healthy ? 200 : null,
      error: healthy ? undefined : 'stale_or_missing_heartbeat',
    };
    const syntheticCableVersion = {
      ok: cableReachable,
      ms: cableProbeFresh ? 1 : null,
      status: cableHttpStatus,
      error: cableReachable ? undefined : 'missing_or_stale_cable_probe',
    };

    const ping = liveProbe?.ping ?? syntheticPing;
    const tcp = liveProbe?.tcp ?? syntheticTcp;
    const nodeStatusHttp = liveProbe?.http?.nodeStatus ?? syntheticNodeStatus;
    const cableVersionHttp = liveProbe?.http?.cableVersion ?? syntheticCableVersion;
    const anyReachable =
      Boolean(ping?.ok) ||
      Boolean(tcp?.ssh22?.ok) ||
      Boolean(tcp?.node8080?.ok) ||
      Boolean(tcp?.cable8787?.ok);

    return {
      id: node.id,
      host,
      ip,
      nodeName: typeof node.nodeName === 'string' ? node.nodeName : node.id,
      resolvedIp: liveProbe?.resolvedIp ?? ip ?? null,
      dnsOk: typeof liveProbe?.dnsOk === 'boolean' ? liveProbe.dnsOk : hasAddr,
      ping,
      tcp,
      http: {
        nodeStatus: nodeStatusHttp,
        cableVersion: cableVersionHttp,
      },
      chibaNode: {
        version: nodeAgentVersion,
        ipReported: ip ?? null,
        kioskUrl,
      },
      cableServer:
        cableReachable || cableVersion || cableGitSha
          ? {
              version: cableVersion ?? '0.0.0',
              gitSha: cableGitSha,
            }
          : null,
      needsUpdate: null,
      lastCheckedAt: now,
      errorSummary: anyReachable
        ? undefined
        : hasAddr
          ? 'stale_or_missing_heartbeat'
          : 'missing_host_or_ip',
    };
  });

  return {
    now,
    local: { gitSha: local.gitSha, registryPath: args.registryPath },
    pis,
  };
}

function cableStateToKioskUrl(opts: {
  node: OpsControlPlaneNode;
  state: KioskState;
}): string {
  const pi: InventoryPi = {
    id: opts.node.id,
    host: typeof opts.node.host === 'string' ? opts.node.host : '',
    ip: typeof opts.node.ip === 'string' ? opts.node.ip : undefined,
    nodeName:
      typeof opts.node.nodeName === 'string' && opts.node.nodeName.trim().length > 0
        ? opts.node.nodeName
        : opts.node.id,
    guidePort:
      typeof opts.node.guidePort === 'number' && Number.isFinite(opts.node.guidePort)
        ? opts.node.guidePort
        : 5173,
    serverPort:
      typeof opts.node.serverPort === 'number' && Number.isFinite(opts.node.serverPort)
        ? opts.node.serverPort
        : 8787,
  };
  const cableDefaults: CableModeDefaults = {
    mode: opts.state.mode,
    target_kind: opts.state.targetKind,
    target_id: opts.state.targetId,
    channel: opts.state.channel,
    lock: opts.state.lock,
    qr: opts.state.qr,
    playlist: opts.state.playlist,
    nosplash: opts.state.nosplash,
    hud: opts.state.hudMode,
    hud_sec: opts.state.hudShowSec,
    theme: opts.state.theme,
    scale: opts.state.scale,
    text_scale: opts.state.textScale,
    hours: opts.state.hours,
  };
  return buildKioskUrl(pi, cableDefaults);
}

async function fetchLiveKioskUrlForNode(args: {
  node: OpsControlPlaneNode;
  timeoutMs: number;
}): Promise<string | null> {
  const host = typeof args.node.host === 'string' ? args.node.host.trim() : '';
  const ip = typeof args.node.ip === 'string' ? args.node.ip.trim() : '';
  const address = ip || host;
  if (!address) return null;
  const serverPort =
    typeof args.node.serverPort === 'number' && Number.isFinite(args.node.serverPort)
      ? args.node.serverPort
      : 8787;
  const screenId =
    typeof args.node.nodeName === 'string' && args.node.nodeName.trim().length > 0
      ? args.node.nodeName.trim()
      : args.node.id;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const response = await fetch(
      `http://${formatHostForUrl(address)}:${serverPort}/api/kiosk/state?screenId=${encodeURIComponent(screenId)}`,
      { signal: controller.signal }
    );
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as any;
    const state = payload?.record?.state as KioskState | undefined;
    if (!state || typeof state !== 'object') return null;
    return cableStateToKioskUrl({ node: args.node, state });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function buildFleetFromControlPlane(opts: {
  timeoutMs: number;
}): Promise<any> {
  const [nodesResp, statusResp] = await Promise.all([
    fetchControlPlaneJson('/api/nodes', opts.timeoutMs),
    fetchControlPlaneJson('/api/node-status?limit=500', opts.timeoutMs),
  ]);

  const nodes = Array.isArray(nodesResp?.nodes)
    ? (nodesResp.nodes as OpsControlPlaneNode[])
    : [];
  const statuses = Array.isArray(statusResp?.statuses)
    ? (statusResp.statuses as OpsControlPlaneNodeStatus[])
    : [];
  const registryPath =
    typeof nodesResp?.canonicalRegistry === 'string'
      ? nodesResp.canonicalRegistry
      : null;
  const limit = createAsyncLimit(8);
  const liveKioskPairs = await Promise.all(
    nodes.map(async (node) =>
      await limit(async () => {
        const kioskUrl = await fetchLiveKioskUrlForNode({
          node,
          timeoutMs: Math.max(600, Math.floor(opts.timeoutMs)),
        });
        return [node.id, kioskUrl] as const;
      })
    )
  );
  const liveKioskUrlById = new Map<string, string>(
    liveKioskPairs
      .filter(([, kioskUrl]) => typeof kioskUrl === 'string' && kioskUrl.trim().length > 0)
      .map(([nodeId, kioskUrl]) => [nodeId, kioskUrl as string])
  );
  const liveProbePairs = await Promise.all(
    nodes.map(async (node) =>
      await limit(async () => {
        const host = typeof node.host === 'string' ? node.host.trim() : '';
        const ip = typeof node.ip === 'string' ? node.ip.trim() : undefined;
        const probe = await probePiHealth({
          repoRoot,
          registryPath,
          timeoutMs: Math.max(500, Math.floor(opts.timeoutMs)),
          pi: {
            id: node.id,
            host,
            ip,
            nodeName:
              typeof node.nodeName === 'string' && node.nodeName.trim().length > 0
                ? node.nodeName.trim()
                : node.id,
          },
        });
        return [node.id, probe] as const;
      })
    )
  );
  const liveProbeById = new Map<string, any>(liveProbePairs);

  return toOpsFleetHealthFromControlPlane({
    nodes,
    statuses,
    registryPath,
    liveKioskUrlById,
    liveProbeById,
  });
}

let opsFleetCache: { at: number; payload: any } | null = null;

let guideIndex: GuideIndex | null = null;
let rebuildTimer: NodeJS.Timeout | null = null;
const villageCapture = createVillageCapture();
const weatherstarCapture = createWeatherstarCapture();
const swpcAuroraNorth = createImagePoller({
  url: 'https://services.swpc.noaa.gov/images/aurora-forecast-northern-hemisphere.jpg',
  intervalMs: Number(process.env.SWPC_AURORA_INTERVAL_MS ?? 5 * 60 * 1000),
});
const swpcAuroraSouth = createImagePoller({
  url: 'https://services.swpc.noaa.gov/images/aurora-forecast-southern-hemisphere.jpg',
  intervalMs: Number(process.env.SWPC_AURORA_INTERVAL_MS ?? 5 * 60 * 1000),
});
const swpcSwepam24h = createImagePoller({
  url: 'https://services.swpc.noaa.gov/images/ace-swepam-24-hour.gif',
  intervalMs: Number(process.env.SWPC_ACE_INTERVAL_MS ?? 5 * 60 * 1000),
});
let loadedConfig: LoadedConfig | null = null;
let mediaRoots: string[] = [];
type PathPrefixMap = { from: string; to: string };
const mediaPathPrefixMap: PathPrefixMap[] = (() => {
  const raw = (process.env.CHIBA_MEDIA_PATH_PREFIX_MAP ?? "").trim();
  const defaults = ["/Volumes/share=/mnt/share"];
  const entries = raw ? raw.split(",") : defaults;
  const out: PathPrefixMap[] = [];
  for (const entryRaw of entries) {
    const entry = entryRaw.trim();
    if (!entry) continue;
    const idx = entry.indexOf("=");
    if (idx <= 0 || idx >= entry.length - 1) continue;
    const from = entry.slice(0, idx).trim();
    const to = entry.slice(idx + 1).trim();
    if (!from || !to) continue;
    out.push({ from, to });
  }
  return out;
})();
let kioskStateStore: KioskStateStore | null = null;
const mediaCacheDir = process.env.CHIBA_MEDIA_CACHE_DIR
  ? path.resolve(process.env.CHIBA_MEDIA_CACHE_DIR)
  : path.resolve(repoRoot, 'media-cache');
const mediaCacheInflight = new Map<string, Promise<string>>();
const stashCacheDir = path.join(mediaCacheDir, 'stash');
const stashInflight = new Map<string, Promise<string>>();
let configWatchers: Array<ReturnType<typeof fs.watch>> = [];
let configPollTimer: NodeJS.Timeout | null = null;
let lastConfigFingerprint = '';

function broadcastWs(payload: unknown) {
  const message = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      try {
        client.send(message);
      } catch {
        // ignore send failures
      }
    }
  });
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

type RuntimeTargetKind = 'media' | 'playlist' | 'block' | 'channel';
type RuntimeTargetRef = { kind: RuntimeTargetKind; id: string };

function parseRuntimeTargetRef(input: string): RuntimeTargetRef | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const idx = raw.indexOf(':');
  if (idx <= 0 || idx >= raw.length - 1) return null;
  const kind = raw.slice(0, idx).trim().toLowerCase();
  const id = raw.slice(idx + 1).trim();
  if (!id) return null;
  if (kind === 'media' || kind === 'playlist' || kind === 'block' || kind === 'channel') {
    return { kind, id };
  }
  return null;
}

function normalizeRuntimeTargetRefs(value: unknown): RuntimeTargetRef[] {
  const out: RuntimeTargetRef[] = [];
  const arr = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  for (const entry of arr) {
    if (typeof entry === 'string') {
      const parsed = parseRuntimeTargetRef(entry);
      if (parsed) out.push(parsed);
      continue;
    }
    if (entry && typeof entry === 'object') {
      const kindRaw = typeof (entry as any).kind === 'string' ? (entry as any).kind.trim().toLowerCase() : '';
      const idRaw = typeof (entry as any).id === 'string' ? (entry as any).id.trim() : '';
      if (!idRaw) continue;
      if (kindRaw === 'media' || kindRaw === 'playlist' || kindRaw === 'block' || kindRaw === 'channel') {
        out.push({ kind: kindRaw as RuntimeTargetKind, id: idRaw });
      }
    }
  }
  return Array.from(
    new Map(out.map((target) => [`${target.kind}:${target.id}`, target])).values()
  );
}

type ResolvedSource = { type: 'path' | 'url'; value: string; cache?: boolean };

function normalizeResolvedSource(input: unknown): ResolvedSource | null {
  if (!input || typeof input !== 'object') return null;
  const type = (input as any).type;
  const value = typeof (input as any).value === 'string' ? (input as any).value.trim() : '';
  if ((type !== 'path' && type !== 'url') || !value) return null;
  return {
    type,
    value,
    cache: typeof (input as any).cache === 'boolean' ? (input as any).cache : undefined,
  };
}

function resolveProgramsForChannel(config: LoadedConfig, channel: any): any[] {
  const blocks = Array.isArray(channel?.blocks) ? channel.blocks : [];
  if (!blocks.length) return Array.isArray(channel?.programs) ? channel.programs : [];
  const out: any[] = [];
  for (const blockId of blocks) {
    const block = (config as any).blocksById?.[blockId];
    if (!block) continue;
    if (Array.isArray(block.programs) && block.programs.length) {
      out.push(...block.programs);
    }
    const blockItems = Array.isArray(block.items) ? block.items : [];
    for (const item of blockItems) {
      const source = normalizeResolvedSource((item as any).source);
      const mediaId = typeof (item as any).media === 'string' ? (item as any).media.trim() : '';
      const media = mediaId ? (config as any).mediaById?.[mediaId] ?? null : null;
      if (source) out.push({ ...(item as any), source });
      else if (media?.source) out.push({ ...(item as any), source: media.source });
      const playlistId = typeof (item as any).playlist === 'string' ? (item as any).playlist.trim() : '';
      if (playlistId) {
        out.push(...resolveProgramsForPlaylist(config, playlistId, new Set<string>()));
      }
    }
    const playlistId = String(block.playlist ?? '').trim();
    if (!playlistId) continue;
    out.push(...resolveProgramsForPlaylist(config, playlistId, new Set<string>()));
  }
  return out.length ? out : (Array.isArray(channel.programs) ? channel.programs : []);
}

function resolveProgramsForPlaylist(
  config: LoadedConfig,
  playlistId: string,
  visiting: Set<string>
): any[] {
  const pid = String(playlistId ?? '').trim();
  if (!pid) return [];
  if (visiting.has(pid)) return [];
  visiting.add(pid);
  const playlist = (config as any).playlistsById?.[pid];
  if (!playlist || !Array.isArray(playlist.items)) {
    visiting.delete(pid);
    return [];
  }
  const out: any[] = [];
  for (const item of playlist.items) {
    const mediaId = typeof (item as any).media === 'string' ? (item as any).media.trim() : '';
    const media = mediaId ? (config as any).mediaById?.[mediaId] ?? null : null;
    const source = normalizeResolvedSource((item as any).source) ?? normalizeResolvedSource(media?.source);
    if (source) out.push({ ...(item as any), source });
    const nestedPlaylistId =
      typeof (item as any).playlist === 'string' ? (item as any).playlist.trim() : '';
    if (nestedPlaylistId) out.push(...resolveProgramsForPlaylist(config, nestedPlaylistId, visiting));
  }
  visiting.delete(pid);
  return out;
}

function resolveChannelByKey(config: LoadedConfig, key: string): any | null {
  const k = key.trim();
  if (!k) return null;
  const byId = config.channels.find((c) => c.id === k);
  if (byId) return byId;
  const byNum = config.channels.find((c) => String(c.number ?? '').trim() === k);
  return byNum ?? null;
}

function resolveSourcesForTarget(config: LoadedConfig, target: RuntimeTargetRef): ResolvedSource[] {
  if (target.kind === 'media') {
    const media = (config as any).mediaById?.[target.id];
    const source = normalizeResolvedSource(media?.source);
    return source ? [source] : [];
  }
  if (target.kind === 'playlist') {
    return resolveProgramsForPlaylist(config, target.id, new Set<string>())
      .map((program) => normalizeResolvedSource((program as any).source))
      .filter((source): source is ResolvedSource => Boolean(source));
  }
  if (target.kind === 'block') {
    const block = (config as any).blocksById?.[target.id];
    if (!block) return [];
    const out: ResolvedSource[] = [];
    if (block.playlist) {
      out.push(...resolveSourcesForTarget(config, { kind: 'playlist', id: String(block.playlist) }));
    }
    for (const item of Array.isArray(block.items) ? block.items : []) {
      const source = normalizeResolvedSource((item as any).source);
      if (source) out.push(source);
      const mediaId = typeof (item as any).media === 'string' ? (item as any).media.trim() : '';
      if (mediaId) out.push(...resolveSourcesForTarget(config, { kind: 'media', id: mediaId }));
      const playlistId = typeof (item as any).playlist === 'string' ? (item as any).playlist.trim() : '';
      if (playlistId) out.push(...resolveSourcesForTarget(config, { kind: 'playlist', id: playlistId }));
    }
    for (const program of Array.isArray(block.programs) ? block.programs : []) {
      const source = normalizeResolvedSource((program as any).source);
      if (source) out.push(source);
    }
    return out;
  }
  const channel = resolveChannelByKey(config, target.id);
  if (!channel) return [];
  return resolveProgramsForChannel(config, channel)
    .map((program) => normalizeResolvedSource((program as any).source))
    .filter((source): source is ResolvedSource => Boolean(source));
}

function resolveSourcesForTargets(config: LoadedConfig, targets: RuntimeTargetRef[]): ResolvedSource[] {
  const out: ResolvedSource[] = [];
  for (const target of targets) {
    out.push(...resolveSourcesForTarget(config, target));
  }
  return Array.from(
    new Map(out.map((source) => [`${source.type}:${source.value}:${source.cache ? 1 : 0}`, source])).values()
  );
}

type RemoteControl =
  | {
      id: string;
      label: string;
      type: 'range';
      min: number;
      max: number;
      step?: number;
      value?: number;
    }
  | {
      id: string;
      label: string;
      type: 'select';
      options: { value: string; label: string }[];
      value?: string;
    }
  | {
      id: string;
      label: string;
      type: 'toggle';
      value?: boolean;
    }
  | {
      id: string;
      label: string;
      type: 'button';
    };

type ControlSchema = {
  appId: string;
  controls: RemoteControl[];
  updatedAt: number;
};

const controlSchemas = new Map<string, ControlSchema>();
const mediaStats = {
  startedAt: Date.now(),
  active: 0,
  requests: 0,
  completed: 0,
  bytesSent: 0,
  bytesRequested: 0,
  errors: 0,
  lastRequestAt: null as number | null,
  lastPath: null as string | null,
};
const mediaPathStats = new Map<
  string,
  { path: string; requests: number; bytes: number; lastAt: number }
>();

const bumpPathStats = (path: string, bytes: number) => {
  const now = Date.now();
  const existing = mediaPathStats.get(path);
  if (existing) {
    existing.requests += 1;
    existing.bytes += bytes;
    existing.lastAt = now;
  } else {
    mediaPathStats.set(path, { path, requests: 1, bytes, lastAt: now });
  }
  if (mediaPathStats.size > 40) {
    const entries = Array.from(mediaPathStats.values()).sort(
      (a, b) => a.lastAt - b.lastAt
    );
    for (let i = 0; i < entries.length - 30; i += 1) {
      mediaPathStats.delete(entries[i].path);
    }
  }
};

const recordMediaError = (path?: string | null) => {
  mediaStats.errors += 1;
  if (path) {
    mediaStats.lastPath = path;
    mediaStats.lastRequestAt = Date.now();
  }
};

const getEmbedConfig = (id: string): ChannelEmbedConfig | null => {
  const channel = loadedConfig?.channels.find((item) => item.id === id);
  return channel?.embed ?? null;
};

const parseBooleanQuery = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw > 0;
  if (typeof raw !== "string") return false;
  const normalized = raw.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
};

const clampInt = (
  value: unknown,
  min: number,
  max: number
): number | null => {
  if (value === undefined || value === null) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  const num =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number(raw)
        : NaN;
  if (!Number.isFinite(num)) return null;
  return Math.max(min, Math.min(max, Math.floor(num)));
};

const buildOverlayHtml = (embed: ChannelEmbedConfig | null) => {
  if (!embed?.overlay) return { html: '', script: '' };
  const overlay = embed.overlay;
  const title = overlay.title ?? 'Broadcast';
  const subtitle = overlay.subtitle ?? 'Waiting for Signal';
  const hint = overlay.hint ?? '';
  const qr = overlay.qr ?? '';
  const button = overlay.button ?? 'Hide Info';
  const showDelay = Math.max(0, overlay.show_delay_ms ?? 0);
  const hideOnMessage = overlay.hide_on_message !== false;
  const mode = overlay.mode === 'corner' ? 'corner' : 'center';
  const qrImg = qr
    ? `<img class="embed-qr" src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data=${encodeURIComponent(
        qr
      )}" alt="QR to broadcast" />`
    : '';
  const html = `
    <div id="embed-overlay" class="embed-overlay ${mode}">
      <div class="embed-panel">
        <div class="embed-title">${title}</div>
        <div class="embed-subtitle">${subtitle}</div>
        ${qrImg}
        ${hint ? `<div class="embed-hint">${hint}</div>` : ''}
        <button class="embed-dismiss" id="embed-dismiss">${button}</button>
      </div>
    </div>`;
  const script = `
    const overlay = document.getElementById('embed-overlay');
    const dismiss = document.getElementById('embed-dismiss');
    const showOverlay = () => overlay?.classList.add('is-visible');
    const hideOverlay = () => overlay?.classList.remove('is-visible');
    if (dismiss) dismiss.addEventListener('click', hideOverlay);
    if (${showDelay} > 0) {
      setTimeout(showOverlay, ${showDelay});
    } else {
      showOverlay();
    }
    if (${hideOnMessage}) {
      window.addEventListener('message', () => hideOverlay());
    }
  `;
  return { html, script };
};

const buildEmbedPage = (embed: ChannelEmbedConfig, debug = false) => {
  const allow =
    embed.allow ?? 'autoplay; fullscreen; camera; microphone';
  const sandbox = embed.sandbox ? `sandbox="${embed.sandbox}"` : '';
  const mask = embed.mask;
  const maskStyle = mask
    ? `#embed-mask {display:block; top:${mask.top ?? 8}px; right:${mask.right ?? 8}px; bottom:${mask.bottom ?? 'auto'}; left:${mask.left ?? 'auto'}; width:${mask.width ?? 340}px; height:${mask.height ?? 140}px;}`
    : '#embed-mask {display:none;}';
  const { html: overlayHtml, script: overlayScript } = buildOverlayHtml(embed);
  const autoplayMessages = embed.autoplay_messages ?? [];
  const autoplayDelay = Math.max(0, embed.autoplay_delay_ms ?? 800);
  const autoplayRetryMs = Math.max(0, embed.autoplay_retry_ms ?? 1500);
  const autoplayRetries = Math.max(0, embed.autoplay_retries ?? 3);
  const debugEnabled = Boolean(debug);
  const debugMeta = JSON.stringify({
    url: embed.url ?? "",
    mode: embed.mode ?? "iframe",
  });
  const debugPanel = debugEnabled
    ? `<div id="embed-debug" class="embed-debug"><div class="embed-debug-title">Embed Debug</div><div id="embed-debug-lines" class="embed-debug-lines"></div></div>`
    : "";
  const debugSetup = `
    const debugEnabled = ${debugEnabled};
    const debugLines = debugEnabled ? document.getElementById('embed-debug-lines') : null;
    const debugLog = (label, detail) => {
      if (!debugEnabled || !debugLines) return;
      const line = document.createElement('div');
      let detailText = '';
      if (detail !== undefined) {
        if (typeof detail === 'string') {
          detailText = detail;
        } else {
          try { detailText = JSON.stringify(detail); } catch { detailText = String(detail); }
        }
      }
      line.textContent = detailText ? \`[\${label}] \${detailText}\` : \`[\${label}]\`;
      debugLines.prepend(line);
      while (debugLines.children.length > 14) {
        debugLines.removeChild(debugLines.lastChild);
      }
    };
    if (debugEnabled) debugLog('init', ${debugMeta});
  `;
  const autoplayScript =
    autoplayMessages.length > 0
      ? `
      const autoplayMessages = ${JSON.stringify(autoplayMessages)};
      const autoplayDelay = ${autoplayDelay};
      const autoplayRetryMs = ${autoplayRetryMs};
      const autoplayRetries = ${autoplayRetries};
      let autoplayAttempts = 0;
      const sendAutoplay = () => {
        if (!frame || !frame.contentWindow) return;
        autoplayMessages.forEach((msg) => {
          frame.contentWindow.postMessage({ action: msg }, '*');
          frame.contentWindow.postMessage({ command: msg }, '*');
          frame.contentWindow.postMessage(msg, '*');
        });
      };
      const tryAutoplay = () => {
        if (autoplayAttempts >= autoplayRetries) return;
        autoplayAttempts += 1;
        debugLog('autoplay', { attempt: autoplayAttempts });
        sendAutoplay();
        setTimeout(tryAutoplay, autoplayRetryMs);
      };
      setTimeout(tryAutoplay, autoplayDelay);
      `
      : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Channel Embed</title>
    <style>
      html, body { height: 100%; margin: 0; background: #0a0f1a; }
      body { position: relative; overflow: hidden; font-family: "Oxanium", "Segoe UI", sans-serif; color: #e9f5ff; }
      #embed-frame { position: absolute; inset: 0; width: 100vw; height: 100vh; border: 0; display: block; background: #0a0f1a; }
      #embed-mask {
        position: absolute;
        border-radius: 14px;
        background: radial-gradient(circle at 30% 30%, rgba(18, 32, 56, 0.98), rgba(8, 14, 24, 0.98));
        box-shadow: 0 12px 26px rgba(2, 6, 12, 0.6);
        border: 1px solid rgba(126, 215, 255, 0.18);
        pointer-events: none;
      }
      ${maskStyle}
      .embed-overlay {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at 50% 30%, rgba(40, 80, 140, 0.55), rgba(6, 10, 18, 0.96));
        opacity: 0;
        transition: opacity 220ms ease;
        pointer-events: none;
      }
      .embed-overlay.is-visible { opacity: 1; }
      .embed-overlay.corner {
        background: transparent;
        display: flex;
        align-items: flex-start;
        justify-content: flex-end;
        padding: 24px;
      }
      .embed-panel {
        max-width: min(720px, 90vw);
        padding: 28px;
        border-radius: 18px;
        background: linear-gradient(160deg, rgba(18, 30, 54, 0.96), rgba(8, 14, 24, 0.98));
        border: 1px solid rgba(126, 215, 255, 0.35);
        box-shadow: 0 20px 40px rgba(2, 6, 12, 0.6);
        display: grid;
        gap: 16px;
        text-align: center;
        pointer-events: auto;
      }
      .embed-overlay.corner .embed-panel {
        max-width: min(360px, 44vw);
        padding: 18px;
        gap: 12px;
        text-align: center;
      }
      .embed-title {
        font-size: 1.4rem;
        letter-spacing: 0.3em;
        text-transform: uppercase;
      }
      .embed-overlay.corner .embed-title {
        font-size: 0.95rem;
        letter-spacing: 0.22em;
      }
      .embed-subtitle {
        color: rgba(200, 220, 255, 0.75);
        font-size: 0.9rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
      }
      .embed-overlay.corner .embed-subtitle {
        font-size: 0.7rem;
      }
      .embed-qr {
        margin: 0 auto;
        width: 200px;
        height: 200px;
        border-radius: 14px;
        padding: 8px;
        background: rgba(6, 10, 18, 0.85);
        border: 1px solid rgba(126, 215, 255, 0.3);
      }
      .embed-overlay.corner .embed-qr {
        width: 150px;
        height: 150px;
      }
      .embed-hint {
        font-size: 0.8rem;
        color: rgba(200, 220, 255, 0.8);
      }
      .embed-overlay.corner .embed-hint {
        font-size: 0.7rem;
      }
      .embed-dismiss {
        justify-self: center;
        padding: 8px 18px;
        border-radius: 999px;
        border: 1px solid rgba(126, 215, 255, 0.4);
        background: rgba(12, 20, 36, 0.85);
        color: #e9f5ff;
        font-size: 0.7rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        cursor: pointer;
      }
      .embed-debug {
        position: absolute;
        top: 12px;
        left: 12px;
        max-width: min(360px, 90vw);
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(6, 10, 18, 0.78);
        border: 1px solid rgba(126, 215, 255, 0.35);
        font-size: 12px;
        color: rgba(230, 240, 255, 0.92);
        z-index: 5;
        pointer-events: none;
      }
      .embed-debug-title {
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 10px;
        margin-bottom: 6px;
      }
      .embed-debug-lines {
        display: grid;
        gap: 4px;
        font-family: "JetBrains Mono", "SFMono-Regular", ui-monospace, monospace;
        font-size: 10px;
        color: rgba(160, 210, 255, 0.9);
      }
    </style>
  </head>
  <body>
    <iframe id="embed-frame" src="${embed.url ?? ''}" allow="${allow}" ${sandbox}></iframe>
    <div id="embed-mask"></div>
    ${overlayHtml}
    ${debugPanel}
    <script>
      const frame = document.getElementById('embed-frame');
      ${debugSetup}
      if (frame && debugEnabled) {
        frame.addEventListener('load', () => debugLog('iframe', 'load'));
      }
      window.addEventListener('message', (event) => {
        if (debugEnabled) debugLog('message', event.data);
      });
      ${autoplayScript}
      ${overlayScript}
    </script>
  </body>
</html>`;
};

const buildProxyPage = (
  html: string,
  embed: ChannelEmbedConfig,
  embedId: string,
  debug?: { enabled: boolean; status?: number; url?: string }
) => {
  const selectors = embed.dismiss_selectors ?? [];
  const hideCss = selectors.length
    ? selectors.map((sel) => `${sel}{display:none !important; visibility:hidden !important;}`).join('')
    : '';
  const baseHref = embed.url ?? '';
  const proxyPrefix = `/embed/${embedId}/proxy`;
  const upstreamOrigin = embed.url ? new URL(embed.url).origin : '';
  const upstreamHost = embed.url ? new URL(embed.url).host : '';
  const debugEnabled = Boolean(debug?.enabled);
  const debugStatus =
    typeof debug?.status === 'number' ? debug.status : 'unknown';
  const debugUrl = debug?.url ?? embed.url ?? '';
  const debugStyle = debugEnabled
    ? `
      #embed-debug {
        position: fixed;
        bottom: 12px;
        left: 12px;
        z-index: 2147483647;
        max-width: min(420px, 94vw);
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(6, 10, 18, 0.82);
        border: 1px solid rgba(126, 215, 255, 0.35);
        font-family: "JetBrains Mono", "SFMono-Regular", ui-monospace, monospace;
        font-size: 11px;
        color: rgba(220, 235, 255, 0.92);
        pointer-events: none;
      }
    `
    : '';
  const debugScript = debugEnabled
    ? `
      <script>
        (() => {
          const meta = ${JSON.stringify({ status: debugStatus, url: debugUrl })};
          const panel = document.createElement('div');
          panel.id = 'embed-debug';
          panel.textContent = \`Embed proxy: \${meta.status} \${meta.url}\`;
          const mount = () => document.body && document.body.appendChild(panel);
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', mount);
          } else {
            mount();
          }
        })();
      </script>
    `
    : '';
  const injectScript = `
      <script>
        (() => {
          const baseOrigin = window.location.origin;
          const proxyBase = baseOrigin + window.location.pathname.replace(/\\/$/, '') + '/proxy';
          const proxyWsBase = (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host + window.location.pathname.replace(/\\/$/, '') + '/proxy';
          const normalizeUrlArg = (url) => {
            if (!url) return url;
            if (typeof url === 'string') return url;
            if (typeof url === 'object' && url.href) return url.href;
            try {
              return String(url);
            } catch {
              return null;
            }
          };
          const upstreamOrigin = ${JSON.stringify(upstreamOrigin)} || null;
          const upstreamWsOrigin = upstreamOrigin
            ? upstreamOrigin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
            : null;
          const rewriteUrl = (input) => {
            try {
              const raw = normalizeUrlArg(input);
              if (!raw) return input;
              if (typeof raw === 'string' && raw.startsWith(proxyBase)) {
                return raw;
              }
              if (upstreamOrigin && typeof raw === 'string' && raw.startsWith('/')) {
                return proxyBase + raw;
              }
              const resolved = new URL(raw, document.baseURI);
              if (!upstreamOrigin) return input;
              if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return input;
              if (resolved.origin !== upstreamOrigin) return input;
              return proxyBase + resolved.pathname + resolved.search + resolved.hash;
            } catch {
              return input;
            }
          };
          const rewriteWsUrl = (input) => {
            try {
              const raw = normalizeUrlArg(input);
              if (!raw) return input;
              if (typeof raw === 'string' && raw.startsWith(proxyWsBase)) {
                return raw;
              }
              if (upstreamWsOrigin && typeof raw === 'string' && raw.startsWith('/')) {
                return proxyWsBase + raw;
              }
              const resolved = new URL(raw, document.baseURI);
              if (!upstreamWsOrigin) return input;
              if (resolved.protocol !== 'ws:' && resolved.protocol !== 'wss:') return input;
              if (resolved.origin !== upstreamWsOrigin) return input;
              return proxyWsBase + resolved.pathname + resolved.search + resolved.hash;
            } catch {
              return input;
            }
          };
          const rewriteAsset = (input) => {
            try {
              const raw = normalizeUrlArg(input);
              if (!raw) return input;
              if (typeof raw === 'string' && raw.startsWith(proxyBase)) {
                return raw;
              }
              if (
                typeof raw === 'string' &&
                (raw.startsWith('data:') ||
                  raw.startsWith('blob:') ||
                  raw.startsWith('mailto:') ||
                  raw.startsWith('javascript:') ||
                  raw.startsWith('#'))
              ) {
                return input;
              }
              if (upstreamOrigin && typeof raw === 'string' && raw.startsWith('/')) {
                return proxyBase + raw;
              }
              const resolved = new URL(raw, document.baseURI);
              if (!upstreamOrigin) return input;
              if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return input;
              if (resolved.origin !== upstreamOrigin) return input;
              return proxyBase + resolved.pathname + resolved.search + resolved.hash;
            } catch {
              return input;
            }
          };
          try {
            const locProto = Object.getPrototypeOf(window.location);
            if (locProto?.assign) {
              const originalAssign = locProto.assign;
              locProto.assign = function (url) {
                return originalAssign.call(this, rewriteUrl(url));
              };
            }
            if (locProto?.replace) {
              const originalReplace = locProto.replace;
              locProto.replace = function (url) {
                return originalReplace.call(this, rewriteUrl(url));
              };
            }
          } catch {
            // ignore location override failures
          }
          const safeHistory = (original) => function (state, title, url) {
            try {
              const normalized = normalizeUrlArg(url);
              if (typeof normalized === 'string' && normalized.length > 0) {
                const parsed = new URL(normalized, window.location.href);
                if (parsed.origin !== baseOrigin) {
                  const safeUrl = parsed.pathname + parsed.search + parsed.hash;
                  return original.call(this, state, title, safeUrl);
                }
                return original.call(this, state, title, normalized);
              }
              return original.call(this, state, title, url);
            } catch {
              return;
            }
          };
          try {
            if (History && History.prototype && History.prototype.replaceState) {
              History.prototype.replaceState = safeHistory(History.prototype.replaceState);
            }
            if (History && History.prototype && History.prototype.pushState) {
              History.prototype.pushState = safeHistory(History.prototype.pushState);
            }
          } catch {
            // ignore history override failures
          }
          try {
            const originalFetch = window.fetch ? window.fetch.bind(window) : null;
            if (originalFetch) {
              window.fetch = (input, init) => {
                if (input instanceof Request) {
                  const rewrittenUrl = rewriteUrl(input.url);
                  if (typeof rewrittenUrl === 'string' && rewrittenUrl !== input.url) {
                    const nextRequest = new Request(rewrittenUrl, input);
                    return originalFetch(nextRequest, init);
                  }
                  return originalFetch(input, init);
                }
                const rewritten = rewriteUrl(input);
                if (rewritten !== input) {
                  return originalFetch(rewritten, init);
                }
                return originalFetch(input, init);
              };
            }
          } catch {
            // ignore fetch override failures
          }
          try {
            const originalOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function (method, url, ...rest) {
              const rewritten = rewriteUrl(url);
              return originalOpen.call(this, method, rewritten, ...rest);
            };
          } catch {
            // ignore xhr override failures
          }
          try {
            const OriginalWebSocket = window.WebSocket;
            if (OriginalWebSocket) {
              const WrappedWebSocket = function (url, protocols) {
                const rewritten = rewriteWsUrl(url);
                return protocols
                  ? new OriginalWebSocket(rewritten, protocols)
                  : new OriginalWebSocket(rewritten);
              };
              WrappedWebSocket.prototype = OriginalWebSocket.prototype;
              Object.keys(OriginalWebSocket).forEach((key) => {
                WrappedWebSocket[key] = OriginalWebSocket[key];
              });
              window.WebSocket = WrappedWebSocket;
            }
          } catch {
            // ignore websocket override failures
          }
          const patchAttr = (proto, prop, rewrite) => {
            try {
              const desc = Object.getOwnPropertyDescriptor(proto, prop);
              if (!desc || !desc.set) return;
              Object.defineProperty(proto, prop, {
                ...desc,
                set(value) {
                  return desc.set.call(this, rewrite(value));
                },
              });
            } catch {
              // ignore attribute override failures
            }
          };
          patchAttr(HTMLScriptElement.prototype, 'src', rewriteAsset);
          patchAttr(HTMLLinkElement.prototype, 'href', rewriteAsset);
          patchAttr(HTMLImageElement.prototype, 'src', rewriteAsset);
          try {
            const originalSetAttribute = Element.prototype.setAttribute;
            Element.prototype.setAttribute = function (name, value) {
              if (typeof name === 'string') {
                const lower = name.toLowerCase();
                if (lower === 'src' || lower === 'href') {
                  return originalSetAttribute.call(this, name, rewriteAsset(value));
                }
              }
              return originalSetAttribute.call(this, name, value);
            };
          } catch {
            // ignore setAttribute override failures
          }
          const selectors = ${JSON.stringify(selectors)};
          const remove = () => {
            selectors.forEach((sel) => {
              document.querySelectorAll(sel).forEach((node) => node.remove());
            });
            document.documentElement.style.overflow = 'auto';
            document.body.style.overflow = 'auto';
          };
          const ready = () => {
            remove();
            if (selectors.length) {
              const observer = new MutationObserver(remove);
              observer.observe(document.body, { childList: true, subtree: true });
            }
          };
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', ready);
          } else {
            ready();
          }
        })();
      </script>
    `;
  const rewriteAssetUrl = (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return url;
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('mailto:') || trimmed.startsWith('javascript:') || trimmed.startsWith('#')) {
      return url;
    }
    if (trimmed.startsWith(proxyPrefix)) return url;
    if (upstreamOrigin && trimmed.startsWith(upstreamOrigin)) {
      return `${proxyPrefix}${trimmed.slice(upstreamOrigin.length)}`;
    }
    if (upstreamHost && trimmed.startsWith(`//${upstreamHost}`)) {
      return `${proxyPrefix}${trimmed.slice(2 + upstreamHost.length)}`;
    }
    if (trimmed.startsWith('/')) {
      return `${proxyPrefix}${trimmed}`;
    }
    return url;
  };
  const rewriteSrcset = (value: string) => {
    return value
      .split(',')
      .map((part) => {
        const [urlPart, descriptor] = part.trim().split(/\s+/, 2);
        if (!urlPart) return part;
        const rewritten = rewriteAssetUrl(urlPart);
        return descriptor ? `${rewritten} ${descriptor}` : rewritten;
      })
      .join(', ');
  };
  let output = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
  output = output.replace(/<base[^>]*>/gi, '');
  output = output.replace(/\s(src|href)=["']([^"']+)["']/gi, (match, attr, value) => {
    const rewritten = rewriteAssetUrl(value);
    return ` ${attr}="${rewritten}"`;
  });
  output = output.replace(/\s(srcset)=["']([^"']+)["']/gi, (match, attr, value) => {
    const rewritten = rewriteSrcset(value);
    return ` ${attr}="${rewritten}"`;
  });
  output = output.replace(/\s(src|href)=([^"'\\s>]+)/gi, (match, attr, value) => {
    const rewritten = rewriteAssetUrl(value);
    return ` ${attr}="${rewritten}"`;
  });
  output = output.replace(/\s(srcset)=([^"'\\s>]+)/gi, (match, attr, value) => {
    const rewritten = rewriteSrcset(value);
    return ` ${attr}="${rewritten}"`;
  });
  const injection = `<base href="${proxyPrefix}/"/><style>${hideCss}${debugStyle}</style>${injectScript}${debugScript}`;
  if (/<head[^>]*>/i.test(output)) {
    output = output.replace(/<head[^>]*>/i, (match) => `${match}${injection}`);
  } else {
    output = `${injection}${output}`;
  }
  return output;
};

const broadcast = (message: string) => {
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  });
};

const handleProxyUpgrade = (
  req: http.IncomingMessage,
  socket: any,
  head: Buffer
) => {
  if (!req.url) {
    socket.destroy();
    return;
  }
  const parsed = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const match = parsed.pathname.match(/^\/embed\/([^/]+)\/proxy\/(.+)$/);
  if (!match) {
    socket.destroy();
    return;
  }
  const embedId = match[1];
  const rawSuffix = match[2] ?? '';
  const embed = getEmbedConfig(embedId);
  if (!embed?.url) {
    socket.destroy();
    return;
  }
  const base = new URL(embed.url);
  const suffixPath = rawSuffix.startsWith('/') ? rawSuffix : `/${rawSuffix}`;
  const targetUrl = new URL(suffixPath + parsed.search, base);
  targetUrl.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';

  proxyWss.handleUpgrade(req, socket, head, (client) => {
    const headers: Record<string, string> = {};
    Object.entries(req.headers).forEach(([key, value]) => {
      if (!value) return;
      if (key.toLowerCase() === 'host') return;
      if (Array.isArray(value)) {
        headers[key] = value.join(', ');
      } else {
        headers[key] = value;
      }
    });
    const protocolHeader = req.headers['sec-websocket-protocol'];
    const protocols =
      typeof protocolHeader === 'string'
        ? protocolHeader.split(',').map((p) => p.trim())
        : undefined;
    const upstream = new WebSocket(targetUrl.toString(), protocols, {
      headers,
    });

    const closeBoth = () => {
      if (
        client.readyState === client.OPEN ||
        client.readyState === client.CONNECTING
      ) {
        client.close();
      }
      if (
        upstream.readyState === upstream.OPEN ||
        upstream.readyState === upstream.CONNECTING
      ) {
        upstream.close();
      }
    };

    upstream.on('open', () => {
      client.on('message', (data) => {
        if (upstream.readyState === upstream.OPEN) {
          upstream.send(data);
        }
      });
      client.on('close', closeBoth);
      client.on('error', closeBoth);
    });

    upstream.on('message', (data) => {
      if (client.readyState === client.OPEN) {
        client.send(data);
      }
    });
    upstream.on('close', closeBoth);
    upstream.on('error', closeBoth);
  });
};

async function rebuildIndex() {
  try {
    if (fs.existsSync(configPath)) {
      loadedConfig = await loadConfig(configPath);
      mediaRoots = loadedConfig.libraryRoots;
      guideIndex = buildIndexFromConfig(loadedConfig);
      console.log(`[index] rebuilt from TOML (${guideIndex.channels.length} channels)`);
      broadcast(JSON.stringify({ type: 'index', source: 'toml' }));
      return;
    }
    guideIndex = await buildIndexFromFile(sourcesFile);
    console.log(`[index] rebuilt from sources.json (${guideIndex.channels.length} channels)`);
    broadcast(JSON.stringify({ type: 'index', source: 'json' }));
  } catch (err) {
    console.error('[index] rebuild failed', (err as Error).message);
  }
}

void rebuildIndex();

const scheduleRebuild = () => {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    void rebuildIndex();
  }, 200);
};

const watchConfig = async () => {
  configWatchers.forEach((watcher) => watcher.close());
  configWatchers = [];

  if (fs.existsSync(configPath)) {
    configWatchers.push(fs.watch(configPath, scheduleRebuild));
    try {
      const configDir = path.dirname(configPath);
      const raw = await fsp.readFile(configPath, 'utf-8');
      const match = raw.match(/manifest_dir\s*=\s*\"([^\"]+)\"/);
      if (match?.[1]) {
        const manifestDir = path.resolve(configDir, match[1]);
        if (fs.existsSync(manifestDir)) {
          configWatchers.push(fs.watch(manifestDir, scheduleRebuild));
        }
      }
    } catch {
      // ignore
    }
    return;
  }

  if (fs.existsSync(sourcesFile)) {
    configWatchers.push(fs.watch(sourcesFile, scheduleRebuild));
  }
};

void watchConfig();

const resolveManifestDirFromConfig = async () => {
  try {
    const configDir = path.dirname(configPath);
    const raw = await fsp.readFile(configPath, 'utf-8');
    const match = raw.match(/manifest_dir\s*=\s*\"([^\"]+)\"/);
    if (!match?.[1]) return null;
    return path.resolve(configDir, match[1]);
  } catch {
    return null;
  }
};

const computeConfigFingerprint = async () => {
  if (!fs.existsSync(configPath)) return '';
  try {
    const configStat = await fsp.stat(configPath);
    const manifestDir = await resolveManifestDirFromConfig();
    let entries: string[] = [];
    if (manifestDir && fs.existsSync(manifestDir)) {
      const files = (await fsp.readdir(manifestDir))
        .filter((file) => file.endsWith('.toml'))
        .sort();
      const stats = await Promise.all(
        files.map(async (file) => {
          const stat = await fsp.stat(path.join(manifestDir, file));
          return `${file}:${stat.mtimeMs}`;
        })
      );
      entries = stats;
    }
    return `${configStat.mtimeMs}|${entries.join('|')}`;
  } catch {
    return '';
  }
};

const startConfigPolling = () => {
  if (configPollTimer) clearInterval(configPollTimer);
  configPollTimer = setInterval(async () => {
    const fingerprint = await computeConfigFingerprint();
    if (!fingerprint) return;
    if (!lastConfigFingerprint) {
      lastConfigFingerprint = fingerprint;
      return;
    }
    if (fingerprint !== lastConfigFingerprint) {
      lastConfigFingerprint = fingerprint;
      scheduleRebuild();
    }
  }, 2000);
};

startConfigPolling();

// Kiosk state store lets Ops push per-screen overrides (channel, lock, QR, etc)
// without restarting Chromium. This is persisted locally on each cable server.
void (async () => {
  try {
    kioskStateStore = await KioskStateStore.open(kioskStatePath);
    const count = kioskStateStore.list().length;
    console.log(`[kiosk-state] loaded (${count} screens) -> ${kioskStatePath}`);
  } catch (err) {
    console.warn('[kiosk-state] failed to open', (err as Error).message);
    kioskStateStore = null;
  }
})();

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/kiosk/state', (req, res) => {
  const screenId = typeof req.query.screenId === 'string' ? req.query.screenId.trim() : '';
  if (!screenId) {
    res.status(400).json({ ok: false, error: 'missing_screenId', message: 'Provide ?screenId=lower-east-3' });
    return;
  }
  if (!kioskStateStore) {
    res.status(503).json({ ok: false, error: 'kiosk_state_unavailable' });
    return;
  }
  const record = kioskStateStore.get(screenId);
  res.json({ ok: true, screenId, record });
});

app.get('/api/kiosk/state/all', (_req, res) => {
  if (!kioskStateStore) {
    res.status(503).json({ ok: false, error: 'kiosk_state_unavailable' });
    return;
  }
  res.json({ ok: true, items: kioskStateStore.list() });
});

app.post('/api/kiosk/state', async (req, res) => {
  const screenIdRaw = (req.body as any)?.screenId ?? (req.body as any)?.screen;
  const screenId = typeof screenIdRaw === 'string' ? screenIdRaw.trim() : '';
  if (!screenId) {
    res.status(400).json({ ok: false, error: 'missing_screenId', message: 'Provide { screenId: \"lower-east-3\", state: {...} }' });
    return;
  }
  if (!kioskStateStore) {
    res.status(503).json({ ok: false, error: 'kiosk_state_unavailable' });
    return;
  }
  const replace = Boolean((req.body as any)?.replace);
  const state = sanitizeKioskState((req.body as any)?.state);
  try {
    const record = replace
      ? await kioskStateStore.replace(screenId, state)
      : await kioskStateStore.set(screenId, state);
    // Broadcast so the running guide applies immediately (no restart).
    broadcastWs({ type: 'kiosk_state', screenId, record });
    res.json({ ok: true, screenId, record });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'kiosk_state_set_failed', message: (err as Error).message });
  }
});

app.post('/api/kiosk/clear', async (req, res) => {
  const screenIdRaw = (req.body as any)?.screenId ?? (req.body as any)?.screen;
  const screenId = typeof screenIdRaw === 'string' ? screenIdRaw.trim() : '';
  if (!screenId) {
    res.status(400).json({ ok: false, error: 'missing_screenId' });
    return;
  }
  if (!kioskStateStore) {
    res.status(503).json({ ok: false, error: 'kiosk_state_unavailable' });
    return;
  }
  try {
    await kioskStateStore.clear(screenId);
    broadcastWs({ type: 'kiosk_state', screenId, record: null });
    res.json({ ok: true, screenId });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'kiosk_state_clear_failed', message: (err as Error).message });
  }
});

app.post('/api/kiosk/open-art', (req, res) => {
  const screenIdRaw = (req.body as any)?.screenId ?? (req.body as any)?.screen;
  const screenId = typeof screenIdRaw === 'string' ? screenIdRaw.trim() : '';
  const channelIdRaw = (req.body as any)?.channelId ?? (req.body as any)?.channel;
  const channelId = typeof channelIdRaw === 'string' ? channelIdRaw.trim() : '';
  const indexRaw = (req.body as any)?.index ?? (req.body as any)?.i;
  const index = typeof indexRaw === 'number' ? Math.floor(indexRaw) : typeof indexRaw === 'string' ? Math.floor(Number(indexRaw)) : NaN;
  if (!screenId || !channelId || !Number.isFinite(index) || index < 0) {
    res.status(400).json({ ok: false, error: 'invalid_payload', message: 'Provide { screenId, channelId, index }' });
    return;
  }
  // Broadcast a targeted navigation command.
  broadcastWs({ type: 'open_art', screenId, channelId, index });
  res.json({ ok: true, screenId, channelId, index });
});

app.get('/api/version', async (_req, res) => {
  // Minimal version endpoint so fleet probes can check which code is deployed.
  // Avoid spawning git; prefer an explicit deploy stamp because Pi installs rsync without .git/.
  const envGitSha =
    process.env.CHIBA_CABLE_GIT_SHA ??
    process.env.CHIBA_GIT_SHA ??
    null;

  const deployMetaPath =
    process.env.CHIBA_DEPLOY_META ??
    path.resolve(process.cwd(), '.chiba-deploy.json');

  const deployMeta = await (async () => {
    try {
      if (!fs.existsSync(deployMetaPath)) return null;
      const raw = await fsp.readFile(deployMetaPath, 'utf-8');
      const parsed = JSON.parse(raw) as any;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  })();

  const stampGitSha =
    typeof deployMeta?.gitSha === 'string'
      ? deployMeta.gitSha
      : typeof deployMeta?.git?.sha === 'string'
        ? deployMeta.git.sha
        : null;

  // Fallback: read .git refs if available.
  const gitShaFromRepo = (() => {
    try {
      const headPath = path.join(repoRoot, '.git/HEAD');
      if (!fs.existsSync(headPath)) return null;
      const head = fs.readFileSync(headPath, 'utf-8').trim();
      if (head.startsWith('ref:')) {
        const ref = head.replace('ref:', '').trim();
        const refPath = path.join(repoRoot, '.git', ref);
        if (fs.existsSync(refPath)) return fs.readFileSync(refPath, 'utf-8').trim().slice(0, 12);
        return null;
      }
      return head.slice(0, 12);
    } catch {
      return null;
    }
  })();

  const gitSha = envGitSha ?? stampGitSha ?? gitShaFromRepo;

  let version = '0.0.0';
  try {
    const pkgPath = path.resolve(__dirname, '../package.json');
    const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf-8')) as any;
    if (typeof pkg?.version === 'string') version = pkg.version;
  } catch {
    // ignore
  }

  res.json({
    app: 'chiba-cable-server',
    version,
    gitSha,
    git: { sha: gitSha },
    deployedAt:
      typeof deployMeta?.deployedAt === 'string'
        ? deployMeta.deployedAt
        : typeof deployMeta?.deployed_at === 'string'
          ? deployMeta.deployed_at
          : null,
    deployMetaPath: fs.existsSync(deployMetaPath) ? deployMetaPath : null,
  });
});

app.get('/api/ops/fleet', async (req, res) => {
  const refresh = parseBooleanQuery(req.query.refresh);
  const timeoutMs =
    clampInt(req.query.timeoutMs, 150, 8000) ??
    (Number.isFinite(OPS_TIMEOUT_MS) ? OPS_TIMEOUT_MS : 1200);
  const concurrency =
    clampInt(req.query.parallel ?? req.query.concurrency, 1, 64) ??
    (Number.isFinite(OPS_CONCURRENCY) ? OPS_CONCURRENCY : 8);
  const now = Date.now();
  if (!refresh && opsFleetCache && now - opsFleetCache.at < 2000) {
    res.json(opsFleetCache.payload);
    return;
  }

  try {
    const payload = OPS_USE_CONTROL_PLANE
      ? await buildFleetFromControlPlane({ timeoutMs })
      : await buildFleetResponse({
          repoRoot,
          registryPath: OPS_REGISTRY_PATH || null,
          concurrency,
          timeoutMs,
        });
    opsFleetCache = { at: Date.now(), payload };
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: 'ops_fleet_failed', message: (err as Error).message });
  }
});

app.get('/api/ops/pi', async (req, res) => {
  const idRaw = req.query.id;
  const id = Array.isArray(idRaw) ? idRaw[0] : idRaw;
  if (!id || typeof id !== 'string' || !id.trim()) {
    res.status(400).json({ error: 'missing_id', message: 'Provide ?id=upper-east-3 (registry id)' });
    return;
  }

  const timeoutMs =
    clampInt(req.query.timeoutMs, 150, 8000) ??
    (Number.isFinite(OPS_TIMEOUT_MS) ? OPS_TIMEOUT_MS : 1200);

  try {
    if (OPS_USE_CONTROL_PLANE) {
      const payload = await buildFleetFromControlPlane({ timeoutMs });
      const target = Array.isArray(payload?.pis)
        ? payload.pis.find((pi: any) => pi?.id === id.trim())
        : null;
      if (!target) {
        res.status(404).json({ error: 'unknown_pi', message: `Unknown pi in control-plane nodes: ${id.trim()}` });
        return;
      }
      res.json(target);
      return;
    }

    const { registryPath, pis } = await loadFleetFromRegistry(
      repoRoot,
      OPS_REGISTRY_PATH || null
    );
    const target = pis.find((pi) => pi.id === id.trim());
    if (!target) {
      res.status(404).json({ error: 'unknown_pi', message: `Unknown pi in registry: ${id.trim()}` });
      return;
    }
    const health = await probePiHealth({
      repoRoot,
      registryPath,
      timeoutMs,
      pi: target,
    });
    res.json(health);
  } catch (err) {
    res.status(500).json({ error: 'ops_pi_failed', message: (err as Error).message });
  }
});

app.get('/api/ops/fleet/stream', async (req, res) => {
  // Stream per-node results as they finish (SSE), so UI isn't blocked by offline nodes.
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  const timeoutMs =
    clampInt(req.query.timeoutMs, 150, 8000) ??
    (Number.isFinite(OPS_TIMEOUT_MS) ? OPS_TIMEOUT_MS : 1200);
  const concurrency =
    clampInt(req.query.parallel ?? req.query.concurrency, 1, 64) ??
    (Number.isFinite(OPS_CONCURRENCY) ? OPS_CONCURRENCY : 8);

  const writeEvent = (event: string, data: any) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      // client likely disconnected
    }
  };

  const close = () => {
    try { res.end(); } catch {}
  };
  req.on('close', close);

  try {
    if (OPS_USE_CONTROL_PLANE) {
      const [nodesResp, statusResp] = await Promise.all([
        fetchControlPlaneJson('/api/nodes', timeoutMs),
        fetchControlPlaneJson('/api/node-status?limit=500', timeoutMs),
      ]);
      const nodes = Array.isArray(nodesResp?.nodes)
        ? (nodesResp.nodes as OpsControlPlaneNode[])
        : [];
      const statuses = Array.isArray(statusResp?.statuses)
        ? (statusResp.statuses as OpsControlPlaneNodeStatus[])
        : [];
      const registryPath =
        typeof nodesResp?.canonicalRegistry === 'string'
          ? nodesResp.canonicalRegistry
          : null;
      const local = getLocalOpsMeta(repoRoot);

      writeEvent('meta', {
        now: Date.now(),
        local: { gitSha: local.gitSha, registryPath },
        pis: nodes.map((node: any) => ({
          id: node.id,
          host: node.host,
          ip: node.ip,
          nodeName: node.nodeName,
        })),
        probes: { timeoutMs, concurrency, mode: 'control-plane' },
      });

      const limit = createAsyncLimit(concurrency);
      const tasks = nodes.map((node) =>
        limit(async () => {
          const host = typeof node.host === 'string' ? node.host.trim() : '';
          const ip = typeof node.ip === 'string' ? node.ip.trim() : undefined;
          const nodeName =
            typeof node.nodeName === 'string' && node.nodeName.trim().length > 0
              ? node.nodeName.trim()
              : node.id;

          const [probe, liveKioskUrl] = await Promise.all([
            probePiHealth({
              repoRoot,
              registryPath,
              timeoutMs: Math.max(500, Math.floor(timeoutMs)),
              pi: {
                id: node.id,
                host,
                ip,
                nodeName,
              },
            }),
            fetchLiveKioskUrlForNode({
              node,
              timeoutMs: Math.max(500, Math.floor(timeoutMs)),
            }),
          ]);

          const liveKioskUrlById =
            typeof liveKioskUrl === 'string' && liveKioskUrl.trim().length > 0
              ? new Map<string, string>([[node.id, liveKioskUrl]])
              : undefined;
          const liveProbeById = new Map<string, any>([[node.id, probe]]);

          const merged = toOpsFleetHealthFromControlPlane({
            nodes: [node],
            statuses,
            registryPath,
            liveKioskUrlById,
            liveProbeById,
          });
          const pi = Array.isArray(merged?.pis) ? merged.pis[0] : null;
          if (pi) writeEvent('pi', pi);
        })
      );
      await Promise.allSettled(tasks);

      writeEvent('done', { ok: true });
      close();
      return;
    }

    const now = Date.now();
    const localGitSha = (() => {
      try {
        const headPath = path.join(repoRoot, '.git/HEAD');
        if (!fs.existsSync(headPath)) return null;
        const head = fs.readFileSync(headPath, 'utf-8').trim();
        if (head.startsWith('ref:')) {
          const ref = head.replace('ref:', '').trim();
          const refPath = path.join(repoRoot, '.git', ref);
          if (fs.existsSync(refPath)) return fs.readFileSync(refPath, 'utf-8').trim().slice(0, 12);
          return null;
        }
        return head.slice(0, 12);
      } catch {
        return null;
      }
    })();

    const { registryPath, pis } = await loadFleetFromRegistry(
      repoRoot,
      OPS_REGISTRY_PATH || null
    );

    writeEvent('meta', {
      now,
      local: { gitSha: localGitSha, registryPath },
      pis,
      probes: { timeoutMs, concurrency },
    });

    const stream = await probeFleetHealth({
      repoRoot,
      registryPath,
      pis,
      concurrency,
      timeoutMs,
    });
    for await (const pi of stream) {
      writeEvent('pi', pi);
    }

    writeEvent('done', { ok: true });
    close();
  } catch (err) {
    writeEvent('error', { error: 'ops_fleet_stream_failed', message: (err as Error).message });
    close();
  }
});

type OpsApplyResult = {
  id: string;
  host: string;
  ip: string | null;
  nodeName: string;
  guidePort: number;
  url: string;
  ok: boolean;
  status: number | null;
  ms: number | null;
  error: string | null;
  warning?: string | null;
  // Optional extra diagnostics (present for kiosk-url applies).
  state?: { ok: boolean; status: number | null; ms: number | null; error?: string } | null;
  prefetch?: {
    channelIds: string[];
    targets?: string[];
    stash?: { ok: boolean; status: number | null; ms: number | null; queued: number | null; error?: string };
    cache?: { ok: boolean; status: number | null; ms: number | null; queued: number | null; error?: string };
  } | null;
};

function simplifyApplyResult(r: ApplyModeResult): OpsApplyResult {
  return {
    id: r.pi.id,
    host: r.pi.host,
    ip: r.pi.ip ?? null,
    nodeName: r.pi.nodeName,
    guidePort: r.pi.guidePort,
    url: r.url,
    ok: r.ok,
    status: r.status,
    ms: r.ms,
    error: r.error ?? null,
    warning: (r as any).warning ?? null,
    state: (r as any).state ?? null,
    prefetch: (r as any).prefetch ?? null,
  };
}

function normalizeApplyResults(
  results: Array<ApplyModeResult | OpsApplyResult>
): OpsApplyResult[] {
  return results.map((result) => {
    const r = result as any;
    if (r && typeof r === 'object' && 'pi' in r) {
      return simplifyApplyResult(result as ApplyModeResult);
    }
    return result as OpsApplyResult;
  });
}

function parseStringArray(value: unknown): string[] {
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readRawJsonObject(req: any): Promise<Record<string, unknown> | null> {
  if (req.readableEnded || req.complete) return null;
  try {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk: Buffer | string) => {
        const next = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        chunks.push(next);
        if (chunks.reduce((sum, part) => sum + part.length, 0) > 1024 * 1024) {
          reject(new Error('payload_too_large'));
        }
      });
      req.on('end', () => resolve());
      req.on('error', reject);
    });
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readOpsBody(req: any): Promise<Record<string, unknown>> {
  if (isPlainObject(req.body) && Object.keys(req.body).length > 0) {
    return req.body as Record<string, unknown>;
  }
  if (typeof req.body === 'string' && req.body.trim().length > 0) {
    try {
      const parsed = JSON.parse(req.body);
      if (isPlainObject(parsed)) return parsed;
    } catch {
      // ignore
    }
  }
  const raw = await readRawJsonObject(req);
  if (raw) return raw;
  return {};
}

type OpsApplyTarget = 'profile' | 'channel' | 'block' | 'playlist' | 'media';

type OpsApplyOverrides = {
  mode?: 'guide' | 'gallery';
  targetKind?: 'media' | 'playlist' | 'block' | 'channel';
  targetId?: string;
  channel?: string;
  displayRotate?: 0 | 90 | 180 | 270;
  lock?: boolean;
  showQr?: boolean;
  playlist?: boolean;
  nosplash?: boolean;
  hudMode?: 'always' | 'start' | 'never';
  hudShowSec?: number;
  theme?: string;
  scale?: number;
  textScale?: number;
  hours?: number;
  prefetch?: boolean;
  prefetchStash?: boolean;
  prefetchCache?: boolean;
};

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  return parseBooleanQuery(value);
}

function parseOptionalFinite(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number(raw)
        : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOpsApplyTarget(value: unknown): OpsApplyTarget | null {
  if (typeof value !== 'string') return null;
  const t = value.trim().toLowerCase();
  if (t === 'profile' || t === 'channel' || t === 'block' || t === 'playlist' || t === 'media') {
    return t;
  }
  return null;
}

function parseRuntimeTargetKind(value: unknown): 'media' | 'playlist' | 'block' | 'channel' | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim().toLowerCase();
  if (t === 'media' || t === 'playlist' || t === 'block' || t === 'channel') return t;
  return undefined;
}

function parseOpsApplyOverrides(body: Record<string, unknown>): OpsApplyOverrides {
  const modeRaw = parseOptionalString(body.mode);
  const mode = modeRaw === 'guide' || modeRaw === 'gallery' ? modeRaw : undefined;
  const channel = parseOptionalString(body.channel);
  const theme = parseOptionalString(body.theme);
  const targetKind =
    parseRuntimeTargetKind(body.targetKind) ??
    parseRuntimeTargetKind(body.target_kind);
  const targetId =
    parseOptionalString(body.targetId) ??
    parseOptionalString(body.target_id);
  const hudModeRaw =
    parseOptionalString(body.hudMode) ??
    parseOptionalString(body.hud_mode) ??
    parseOptionalString(body.hud);
  const hudMode =
    hudModeRaw === 'always' || hudModeRaw === 'start' || hudModeRaw === 'never'
      ? hudModeRaw
      : undefined;
  const hudShowSecRaw = parseOptionalFinite(body.hudShowSec ?? body.hud_sec ?? body.hudSec);
  const hudShowSec =
    typeof hudShowSecRaw === 'number' && hudShowSecRaw >= 0 ? hudShowSecRaw : undefined;
  const displayRotateRaw = parseOptionalFinite(
    body.displayRotate ?? body.display_rotate ?? body.rotate ?? body.rotation
  );
  const displayRotate =
    displayRotateRaw === 0 ||
    displayRotateRaw === 90 ||
    displayRotateRaw === 180 ||
    displayRotateRaw === 270
      ? (displayRotateRaw as 0 | 90 | 180 | 270)
      : undefined;

  return {
    mode,
    targetKind,
    targetId,
    channel,
    displayRotate,
    lock: parseOptionalBoolean(body.lock),
    showQr: parseOptionalBoolean(body.showQr ?? body.qr),
    playlist: parseOptionalBoolean(body.playlist),
    nosplash: parseOptionalBoolean(body.nosplash),
    hudMode,
    hudShowSec,
    theme,
    scale: parseOptionalFinite(body.scale),
    textScale: parseOptionalFinite(body.textScale ?? body.text_scale),
    hours: parseOptionalFinite(body.hours),
    prefetch: parseOptionalBoolean(body.prefetch),
    prefetchStash: parseOptionalBoolean(body.prefetchStash ?? body.prefetch_stash),
    prefetchCache: parseOptionalBoolean(body.prefetchCache ?? body.prefetch_cache),
  };
}

function hasOpsApplyOverrides(overrides: OpsApplyOverrides): boolean {
  return Object.values(overrides).some((value) => value !== undefined);
}

function mergeProfileModeWithOverrides(mode: CableMode, overrides: OpsApplyOverrides): CableMode {
  const baseDefaults = (mode.defaults?.cable ?? {}) as CableModeDefaults;
  const nextDefaults: CableModeDefaults = { ...baseDefaults };

  if (overrides.mode) nextDefaults.mode = overrides.mode;
  if (overrides.targetKind) nextDefaults.target_kind = overrides.targetKind;
  if (overrides.targetId) nextDefaults.target_id = overrides.targetId;
  if (overrides.channel) {
    nextDefaults.channel = overrides.channel;
    nextDefaults.target_kind = 'channel';
    nextDefaults.target_id = overrides.channel;
  }
  if (overrides.displayRotate !== undefined) {
    nextDefaults.display_rotate = overrides.displayRotate;
  }
  if (overrides.lock !== undefined) nextDefaults.lock = overrides.lock;
  if (overrides.showQr !== undefined) nextDefaults.qr = overrides.showQr;
  if (overrides.playlist !== undefined) nextDefaults.playlist = overrides.playlist;
  if (overrides.nosplash !== undefined) nextDefaults.nosplash = overrides.nosplash;
  if (overrides.hudMode !== undefined) nextDefaults.hud = overrides.hudMode;
  if (overrides.hudShowSec !== undefined) nextDefaults.hud_sec = overrides.hudShowSec;
  if (overrides.theme !== undefined) nextDefaults.theme = overrides.theme;
  if (overrides.scale !== undefined) nextDefaults.scale = overrides.scale;
  if (overrides.textScale !== undefined) nextDefaults.text_scale = overrides.textScale;
  if (overrides.hours !== undefined) nextDefaults.hours = overrides.hours;
  if (overrides.prefetchStash !== undefined) nextDefaults.prefetch_stash = overrides.prefetchStash;
  if (overrides.prefetchCache !== undefined) nextDefaults.prefetch_cache = overrides.prefetchCache;
  if (overrides.prefetch === true) {
    const tk = nextDefaults.target_kind;
    const tid = nextDefaults.target_id;
    if (tk && tid) {
      nextDefaults.prefetch_targets = Array.from(
        new Set([...(nextDefaults.prefetch_targets ?? []), `${tk}:${tid}`])
      );
      if (nextDefaults.prefetch_stash === undefined) nextDefaults.prefetch_stash = true;
      if (nextDefaults.prefetch_cache === undefined) nextDefaults.prefetch_cache = true;
    }
  } else if (overrides.prefetch === false) {
    nextDefaults.prefetch_targets = [];
    nextDefaults.prefetch_stash = false;
    nextDefaults.prefetch_cache = false;
  }
  if (nextDefaults.target_kind === 'channel') {
    nextDefaults.channel = nextDefaults.target_id ?? nextDefaults.channel;
  } else {
    nextDefaults.channel = undefined;
  }

  return {
    ...mode,
    defaults: {
      ...(mode.defaults ?? {}),
      cable: nextDefaults,
    },
  };
}

function buildTargetDefaults(args: {
  target: OpsApplyTarget;
  id: string;
  overrides: OpsApplyOverrides;
}): CableModeDefaults {
  const { target, id, overrides } = args;
  const isProfileTarget = target === 'profile';
  const defaultTargetKind: 'media' | 'playlist' | 'block' | 'channel' =
    isProfileTarget ? 'channel' : target;

  // Important guardrail:
  // `channel` is a profile fallback only. For direct semantic applies
  // (media/playlist/block/channel), never coerce target kind from a stray
  // channel override coming from UI state.
  let resolvedTargetKind: 'media' | 'playlist' | 'block' | 'channel' =
    overrides.targetKind ?? defaultTargetKind;
  let resolvedTargetId = overrides.targetId ?? id;

  if (isProfileTarget && overrides.targetKind === undefined && overrides.channel) {
    resolvedTargetKind = 'channel';
    resolvedTargetId = overrides.channel;
  } else if (
    resolvedTargetKind === 'channel' &&
    overrides.targetId === undefined &&
    overrides.channel
  ) {
    resolvedTargetId = overrides.channel;
  }

  const defaults: CableModeDefaults = {
    mode: overrides.mode ?? 'gallery',
    target_kind: resolvedTargetKind,
    target_id: resolvedTargetId,
    channel: resolvedTargetKind === 'channel' ? resolvedTargetId : undefined,
    nosplash: overrides.nosplash ?? true,
    qr: overrides.showQr ?? false,
  };

  if (overrides.displayRotate !== undefined) {
    defaults.display_rotate = overrides.displayRotate;
  }
  if (overrides.lock !== undefined) defaults.lock = overrides.lock;
  if (overrides.playlist !== undefined) defaults.playlist = overrides.playlist;
  else if (resolvedTargetKind === 'playlist') defaults.playlist = true;
  if (overrides.hudMode !== undefined) defaults.hud = overrides.hudMode;
  if (overrides.hudShowSec !== undefined) defaults.hud_sec = overrides.hudShowSec;
  if (overrides.theme !== undefined) defaults.theme = overrides.theme;
  if (overrides.scale !== undefined) defaults.scale = overrides.scale;
  if (overrides.textScale !== undefined) defaults.text_scale = overrides.textScale;
  if (overrides.hours !== undefined) defaults.hours = overrides.hours;

  const shouldPrefetchByDefault =
    resolvedTargetKind === 'playlist' || resolvedTargetKind === 'media' || resolvedTargetKind === 'block';
  const shouldPrefetch =
    overrides.prefetch !== undefined ? overrides.prefetch : shouldPrefetchByDefault;
  if (shouldPrefetch && resolvedTargetId) {
    defaults.prefetch_targets = [`${resolvedTargetKind}:${resolvedTargetId}`];
    defaults.prefetch_stash = overrides.prefetchStash ?? true;
    defaults.prefetch_cache = overrides.prefetchCache ?? true;
  } else if (overrides.prefetch === false) {
    defaults.prefetch_targets = [];
    defaults.prefetch_stash = false;
    defaults.prefetch_cache = false;
  } else {
    if (overrides.prefetchStash !== undefined) defaults.prefetch_stash = overrides.prefetchStash;
    if (overrides.prefetchCache !== undefined) defaults.prefetch_cache = overrides.prefetchCache;
  }

  return defaults;
}

async function applyViaControlPlane(args: {
  target: 'profile' | 'channel' | 'block' | 'playlist' | 'media';
  id: string;
  piIds?: string[];
  dryRun: boolean;
  timeoutMs: number;
}): Promise<OpsApplyResult[]> {
  const [applyResp, nodesResp] = await Promise.all([
    postControlPlaneJson(
      '/api/apply',
      {
        target: args.target,
        id: args.id,
        nodeIds: args.piIds?.length ? args.piIds : undefined,
        dryRun: args.dryRun,
        execute: !args.dryRun,
        timeoutMs: args.timeoutMs,
      },
      args.timeoutMs
    ),
    fetchControlPlaneJson('/api/nodes', args.timeoutMs),
  ]);

  const nodes = Array.isArray(nodesResp?.nodes) ? (nodesResp.nodes as OpsControlPlaneNode[]) : [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const intents = Array.isArray(applyResp?.computation?.nodeIntents)
    ? applyResp.computation.nodeIntents as Array<{ nodeId?: string }>
    : [];
  const dispatch = Array.isArray(applyResp?.dispatchResults)
    ? applyResp.dispatchResults as Array<{
        nodeId?: string;
        ok?: boolean;
        status?: number | null;
        ms?: number | null;
        error?: string | null;
      }>
    : [];
  const dispatchById = new Map(
    dispatch
      .filter((entry) => typeof entry.nodeId === 'string')
      .map((entry) => [entry.nodeId as string, entry])
  );

  const plannedNodeIds = intents
    .map((intent) => (typeof intent.nodeId === 'string' ? intent.nodeId : ''))
    .filter((id) => id.length > 0);
  const requestedNodeIds = Array.isArray(args.piIds) ? args.piIds.filter((id) => typeof id === 'string' && id.trim().length > 0) : [];
  const nodeIds = requestedNodeIds.length > 0 ? requestedNodeIds : plannedNodeIds;

  return nodeIds.map((nodeId) => {
    const node = nodeById.get(nodeId);
    const result = dispatchById.get(nodeId);
    const knownInControlPlane = Boolean(node);

    if (!knownInControlPlane) {
      return {
        id: nodeId,
        host: '',
        ip: null,
        nodeName: nodeId,
        guidePort: 5173,
        url: `${OPS_CONTROL_PLANE_URL}/api/apply`,
        ok: false,
        status: null,
        ms: null,
        error: 'node_not_in_control_plane_inventory',
        state: null,
        prefetch: null,
      } satisfies OpsApplyResult;
    }

    const host = typeof node?.host === 'string' ? node.host : '';
    const ip = typeof node?.ip === 'string' ? node.ip : null;
    return {
      id: nodeId,
      host,
      ip,
      nodeName: typeof node?.nodeName === 'string' ? node.nodeName : nodeId,
      guidePort: typeof node?.guidePort === 'number' ? node.guidePort : 5173,
      url: `${OPS_CONTROL_PLANE_URL}/api/apply`,
      ok: args.dryRun ? true : Boolean(result?.ok),
      status: args.dryRun ? null : (typeof result?.status === 'number' ? result.status : null),
      ms: args.dryRun ? null : (typeof result?.ms === 'number' ? result.ms : null),
      error: args.dryRun ? null : (result?.error ?? (result ? null : 'missing_dispatch_result')),
      state: null,
      prefetch: null,
    } satisfies OpsApplyResult;
  });
}

function createAsyncLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const max = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 8;
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= max) return;
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

function toInventoryPiFromControlPlane(node: OpsControlPlaneNode): InventoryPi | null {
  const id = typeof node?.id === 'string' ? node.id.trim() : '';
  if (!id) return null;
  const host = typeof node?.host === 'string' ? node.host.trim() : '';
  const ip = typeof node?.ip === 'string' ? node.ip.trim() : '';
  const nodeName = typeof node?.nodeName === 'string' && node.nodeName.trim() ? node.nodeName.trim() : id;
  const guidePort = typeof node?.guidePort === 'number' && Number.isFinite(node.guidePort) ? node.guidePort : 5173;
  const serverPort = typeof node?.serverPort === 'number' && Number.isFinite(node.serverPort) ? node.serverPort : 8787;
  return {
    id,
    host,
    ip: ip || undefined,
    nodeName,
    guidePort,
    serverPort,
  };
}

async function postKioskStateToNode(args: {
  hostOrIp: string;
  serverPort: number;
  screenId: string;
  state: KioskState;
  timeoutMs: number;
}): Promise<{ ok: boolean; status: number | null; ms: number | null; error?: string }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const response = await fetch(`http://${formatHostForUrl(args.hostOrIp)}:${args.serverPort}/api/kiosk/state`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ screenId: args.screenId, state: args.state, replace: true }),
    });
    return {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      error: response.ok ? undefined : `http_${response.status}`,
    };
  } catch (err) {
    return { ok: false, status: null, ms: null, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

async function postKioskUrlToNode(args: {
  hostOrIp: string;
  url: string;
  apiKey?: string | null;
  restart?: boolean;
  timeoutMs: number;
}): Promise<{ ok: boolean; status: number | null; ms: number | null; error?: string }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (args.apiKey && args.apiKey.trim().length > 0) {
      headers.authorization = `Bearer ${args.apiKey.trim()}`;
    }
    const response = await fetch(`http://${formatHostForUrl(args.hostOrIp)}:8080/kiosk-url`, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        url: args.url,
        restart: args.restart ?? false,
      }),
    });
    return {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      error: response.ok ? undefined : `http_${response.status}`,
    };
  } catch (err) {
    return { ok: false, status: null, ms: null, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

async function postRotateToNode(args: {
  hostOrIp: string;
  rotation: 0 | 90 | 180 | 270;
  apiKey?: string | null;
  timeoutMs: number;
}): Promise<{ ok: boolean; status: number | null; ms: number | null; error?: string }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (args.apiKey && args.apiKey.trim().length > 0) {
      headers.authorization = `Bearer ${args.apiKey.trim()}`;
    }
    const response = await fetch(`http://${formatHostForUrl(args.hostOrIp)}:8080/rotate`, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify({ rotation: args.rotation }),
    });
    return {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      error: response.ok ? undefined : `http_${response.status}`,
    };
  } catch (err) {
    return { ok: false, status: null, ms: null, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

async function postJsonToNode(args: {
  hostOrIp: string;
  serverPort: number;
  route: '/api/stash/prefetch' | '/api/cache/prefetch';
  body: unknown;
  timeoutMs: number;
}): Promise<{ ok: boolean; status: number | null; ms: number | null; json?: any; error?: string }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const response = await fetch(`http://${formatHostForUrl(args.hostOrIp)}:${args.serverPort}${args.route}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args.body),
    });
    let parsed: any = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      json: parsed,
      error: response.ok ? undefined : `http_${response.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      ms: null,
      error: (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function applyModeViaControlPlane(args: {
  mode: CableMode;
  piIds?: string[];
  timeoutMs: number;
  concurrency: number;
  dryRun: boolean;
}): Promise<OpsApplyResult[]> {
  const nodesResp = await fetchControlPlaneJson('/api/nodes', args.timeoutMs);
  const nodes = Array.isArray(nodesResp?.nodes) ? (nodesResp.nodes as OpsControlPlaneNode[]) : [];
  const inventory = nodes
    .map((node) => toInventoryPiFromControlPlane(node))
    .filter((pi): pi is InventoryPi => Boolean(pi));
  const inventoryById = new Map(inventory.map((pi) => [pi.id, pi]));
  const requestedIds = args.piIds?.length ? Array.from(new Set(args.piIds)) : inventory.map((pi) => pi.id);

  const limit = createAsyncLimit(args.concurrency);
  const results = await Promise.all(
    requestedIds.map(async (nodeId) =>
      await limit(async () => {
        const pi = inventoryById.get(nodeId);
        if (!pi) {
          return {
            id: nodeId,
            host: '',
            ip: null,
            nodeName: nodeId,
            guidePort: 5173,
            url: `${OPS_CONTROL_PLANE_URL}/api/apply`,
            ok: false,
            status: null,
            ms: null,
            error: 'node_not_in_control_plane_inventory',
            state: null,
            prefetch: null,
          } satisfies OpsApplyResult;
        }

        const address = (pi.ip ?? '').trim() || (pi.host ?? '').trim();
        const cable = mergeCableMode(args.mode, pi.id);
        const url = buildKioskUrl(pi, cable);
        if (!address) {
          return {
            id: pi.id,
            host: pi.host,
            ip: pi.ip ?? null,
            nodeName: pi.nodeName,
            guidePort: pi.guidePort,
            url,
            ok: false,
            status: null,
            ms: null,
            error: 'node_has_no_address',
            state: null,
            prefetch: null,
          } satisfies OpsApplyResult;
        }

        if (args.dryRun) {
          return {
            id: pi.id,
            host: pi.host,
            ip: pi.ip ?? null,
            nodeName: pi.nodeName,
            guidePort: pi.guidePort,
            url,
            ok: true,
            status: null,
            ms: null,
            error: null,
            state: null,
            prefetch: null,
          } satisfies OpsApplyResult;
        }

        const state = buildKioskState(pi, cable);
        const posted = await postKioskStateToNode({
          hostOrIp: address,
          serverPort: pi.serverPort,
          screenId: pi.nodeName,
          state,
          timeoutMs: args.timeoutMs,
        });
        let urlSync:
          | { ok: boolean; status: number | null; ms: number | null; error?: string }
          | null = null;
        let rotateSync:
          | { ok: boolean; status: number | null; ms: number | null; error?: string }
          | null = null;
        let prefetch: OpsApplyResult['prefetch'] | null = null;
        if (posted.ok) {
          const apiKey = getApiKeyForPi(pi.id);
          const rotateRaw =
            typeof (cable as any).display_rotate === 'number'
              ? (cable as any).display_rotate
              : typeof (cable as any).display_rotate === 'string'
                ? Number((cable as any).display_rotate)
                : NaN;
          const rotation =
            rotateRaw === 0 || rotateRaw === 90 || rotateRaw === 180 || rotateRaw === 270
              ? (rotateRaw as 0 | 90 | 180 | 270)
              : null;
          if (rotation !== null) {
            rotateSync = await postRotateToNode({
              hostOrIp: address,
              rotation,
              apiKey,
              timeoutMs: args.timeoutMs,
            });
          }
          urlSync = await postKioskUrlToNode({
            hostOrIp: address,
            url,
            apiKey,
            restart: false,
            timeoutMs: args.timeoutMs,
          });

          const explicitChannels = parseStringArray((cable as any).prefetch_channels);
          const chosenChannel = typeof cable.channel === 'string' ? cable.channel.trim() : '';
          const channelIds = Array.from(new Set([...explicitChannels, chosenChannel].filter(Boolean)));

          const targetKindRaw = typeof (cable as any).target_kind === 'string' ? String((cable as any).target_kind).trim() : '';
          const targetKind =
            targetKindRaw === 'media' || targetKindRaw === 'playlist' || targetKindRaw === 'block' || targetKindRaw === 'channel'
              ? targetKindRaw
              : '';
          let targetId = typeof cable.target_id === 'string' ? cable.target_id.trim() : '';
          if (!targetId && targetKind === 'channel') targetId = chosenChannel;

          const explicitTargets = parseStringArray((cable as any).prefetch_targets);
          const implicitTargets = targetKind && targetId ? [`${targetKind}:${targetId}`] : [];
          const targets = Array.from(new Set([...explicitTargets, ...implicitTargets]));

          if (channelIds.length || targets.length) {
            const wantStash = (cable as any).prefetch_stash === false ? false : true;
            const wantCache = (cable as any).prefetch_cache === true;
            const firstChannel = channelIds.length === 1 ? channelIds[0] : '';
            const firstTarget = targets.length === 1 ? targets[0] : '';

            const [stash, cache] = await Promise.all([
              wantStash
                ? postJsonToNode({
                    hostOrIp: address,
                    serverPort: pi.serverPort,
                    route: '/api/stash/prefetch',
                    timeoutMs: args.timeoutMs,
                    body: {
                      ...(firstChannel ? { channelId: firstChannel } : channelIds.length ? { channelIds } : {}),
                      ...(firstTarget ? { target: firstTarget } : targets.length ? { targets } : {}),
                    },
                  })
                : Promise.resolve(null),
              wantCache
                ? postJsonToNode({
                    hostOrIp: address,
                    serverPort: pi.serverPort,
                    route: '/api/cache/prefetch',
                    timeoutMs: args.timeoutMs,
                    body: {
                      ...(firstChannel ? { channelId: firstChannel } : channelIds.length ? { channelIds } : {}),
                      ...(firstTarget ? { target: firstTarget } : targets.length ? { targets } : {}),
                    },
                  })
                : Promise.resolve(null),
            ]);

            prefetch = {
              channelIds,
              targets,
              stash: stash
                ? {
                    ok: stash.ok,
                    status: stash.status,
                    ms: stash.ms,
                    queued: typeof stash.json?.queued === 'number' ? stash.json.queued : null,
                    error: stash.ok ? undefined : stash.error ?? 'prefetch_stash_failed',
                  }
                : undefined,
              cache: cache
                ? {
                    ok: cache.ok,
                    status: cache.status,
                    ms: cache.ms,
                    queued: typeof cache.json?.queued === 'number' ? cache.json.queued : null,
                    error: cache.ok ? undefined : cache.error ?? 'prefetch_cache_failed',
                  }
                : undefined,
            };
          }
        }
        const ok = posted.ok;
        const warnings: string[] = [];
        if (posted.ok && rotateSync && !rotateSync.ok) {
          warnings.push(`rotate_sync_failed:${rotateSync.error ?? 'unknown'}`);
        }
        if (posted.ok && urlSync && !urlSync.ok) {
          warnings.push(`kiosk_url_sync_failed:${urlSync.error ?? 'unknown'}`);
        }
        const warning = warnings.length > 0 ? warnings.join(";") : null;
        const error = posted.ok ? null : posted.error ?? 'kiosk_state_failed';
        return {
          id: pi.id,
          host: pi.host,
          ip: pi.ip ?? null,
          nodeName: pi.nodeName,
          guidePort: pi.guidePort,
          url,
          ok,
          status: posted.status,
          ms: posted.ms,
          error,
          warning,
          state: {
            ok: posted.ok,
            status: posted.status,
            ms: posted.ms,
            error: error ?? warning ?? undefined,
          },
          prefetch,
        } satisfies OpsApplyResult;
      })
    )
  );
  return results;
}

app.get('/api/ops/profiles', async (_req, res) => {
  // These profiles map to kiosk URL query params.
  const profilesDir = path.resolve(cableRoot, 'config', 'profiles');
  try {
    const entries = await fsp.readdir(profilesDir, { withFileTypes: true });
    const tomls = entries
      .filter((e) => e.isFile() && e.name.endsWith('.toml'))
      .map((e) => e.name)
      .sort();

    const profiles = await Promise.all(
      tomls.map(async (file) => {
        const id = file.replace(/\.toml$/i, '');
        const modePath = path.join('cable2', 'config', 'profiles', file);
        const mode = await loadModeFromFile(repoRoot, modePath);
        const defaults = (mode?.defaults?.cable ?? {}) as CableModeDefaults;
        const overridePis = Object.keys(mode?.pis ?? {}).sort();
        return {
          id,
          file,
          modePath,
          defaults,
          overridePis,
        };
      })
    );

    res.json({ ok: true, profiles });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'ops_profiles_failed', message: (err as Error).message });
  }
});

app.get('/api/ops/catalog', async (_req, res) => {
  // Expose the composable config model (media/playlists/blocks/channels) to the ops UI.
  try {
    const { catalog, source } = await getRuntimeCatalog();
    res.json({
      ok: true,
      source,
      configPath: source === 'local' ? loadedConfig?.configPath ?? null : null,
      manifestDir: source === 'local' ? loadedConfig?.manifestDir ?? null : null,
      libraryRoots: source === 'local' ? loadedConfig?.libraryRoots ?? [] : [],
      counts: {
        channels: catalog.channels.length,
        blocks: catalog.blocks.length,
        playlists: catalog.playlists.length,
        media: catalog.media.length,
      },
      channels: catalog.channels,
      blocks: catalog.blocks,
      playlists: catalog.playlists,
      media: catalog.media,
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'config_not_ready', message: (err as Error).message });
  }
});

app.get('/api/catalog', async (_req, res) => {
  try {
    const { catalog, source } = await getRuntimeCatalog();
    res.json({
      ok: true,
      source,
      catalog: {
        media: catalog.media,
        playlists: catalog.playlists,
        blocks: catalog.blocks,
        channels: catalog.channels,
      },
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'config_not_ready', message: (err as Error).message });
  }
});

app.post('/api/ops/apply-target', async (req, res) => {
  const body = await readOpsBody(req);
  const target = parseOpsApplyTarget(body.target);
  if (!target) {
    res.status(400).json({
      ok: false,
      error: 'invalid_target',
      message: 'Provide JSON body { target: "profile|channel|block|playlist|media", id: "..." } (set Content-Type: application/json).',
    });
    return;
  }

  const idRaw =
    body.id ??
    body.targetId ??
    (target === 'profile' ? body.profileId : undefined) ??
    (target === 'channel' ? body.channelId : undefined) ??
    (target === 'block' ? body.blockId : undefined) ??
    (target === 'playlist' ? body.playlistId : undefined) ??
    (target === 'media' ? body.mediaId : undefined);
  const id = typeof idRaw === 'string' ? idRaw.trim() : '';
  if (!id) {
    res.status(400).json({ ok: false, error: 'missing_id', message: 'Provide a non-empty target id.' });
    return;
  }

  const methodRaw = body.method ?? req.query.method;
  const defaultMethod = 'state';
  const method =
    methodRaw === 'kiosk-url'
      ? 'kiosk-url'
      : methodRaw === 'state'
        ? 'state'
        : defaultMethod;
  const timeoutMs =
    clampInt(body.timeoutMs, 150, 8000) ??
    clampInt(req.query.timeoutMs, 150, 8000) ??
    2500;
  const concurrency =
    clampInt(body.concurrency, 1, 64) ??
    clampInt(body.parallel, 1, 64) ??
    clampInt(req.query.concurrency ?? req.query.parallel, 1, 64) ??
    8;
  const dryRun = parseBooleanQuery(body.dryRun) || parseBooleanQuery(req.query.dryRun);
  const piIds = parseStringArray(body.piIds ?? body.pis);
  const forceLegacy = parseBooleanQuery(body.forceLegacy ?? req.query.forceLegacy);
  const overrides = parseOpsApplyOverrides(body);
  const hasOverrides = hasOpsApplyOverrides(overrides);

  try {
    // Route profile applies through control-plane for fleet-wide desired-state workflows.
    // For direct semantic targets (media/playlist/block/channel), apply from server state
    // so explicit target_kind/target_id semantics are preserved even if a node is running
    // an older agent build.
    if (OPS_USE_CONTROL_PLANE && method !== 'state' && !forceLegacy && !hasOverrides && target === 'profile') {
      const results = await applyViaControlPlane({
        target,
        id,
        piIds: piIds.length ? piIds : undefined,
        dryRun,
        timeoutMs,
      });
      res.json({ ok: true, target, id, results });
      return;
    }

    if (target === 'profile') {
      const file = id.endsWith('.toml') ? id : `${id}.toml`;
      const modePath = path.join('cable2', 'config', 'profiles', file);
      const mode = await loadModeFromFile(repoRoot, modePath);
      const modeWithOverrides = hasOverrides ? mergeProfileModeWithOverrides(mode, overrides) : mode;

      const results = await (async () => {
        // In control-plane mode, state applies should use control-plane inventory
        // for all profile applies (with or without overrides). This avoids
        // per-node local registry drift causing unknown_pi_id failures.
        if (OPS_USE_CONTROL_PLANE && !forceLegacy && method === 'state') {
          return await applyModeViaControlPlane({
            mode: modeWithOverrides,
            piIds: piIds.length ? piIds : undefined,
            concurrency,
            timeoutMs,
            dryRun,
          });
        }
        if (method === 'kiosk-url') {
          return await applyModeToFleetFromObject({
            repoRoot,
            inventoryPath: OPS_REGISTRY_PATH,
            mode: modeWithOverrides,
            piIds: piIds.length ? piIds : undefined,
            concurrency,
            timeoutMs,
            dryRun,
          });
        }
        return await applyKioskStateToFleetFromObject({
          repoRoot,
          inventoryPath: OPS_REGISTRY_PATH,
          mode: modeWithOverrides,
          piIds: piIds.length ? piIds : undefined,
          concurrency,
          timeoutMs,
          dryRun,
        });
      })();

      res.json({ ok: true, target, id, modePath, results: normalizeApplyResults(results) });
      return;
    }

    // Direct semantic applies (media/playlist/block/channel) must always honor
    // the selected target+id. Keep behavioral/display options, but ignore
    // stale target override fields from the UI.
    const directTargetOverrides: OpsApplyOverrides = {
      ...overrides,
      targetKind: undefined,
      targetId: undefined,
      channel: undefined,
    };
    const defaults = buildTargetDefaults({
      target,
      id,
      overrides: directTargetOverrides,
    });
    const modeForTarget: CableMode = { defaults: { cable: defaults } };

    const results = await (async () => {
      // In control-plane mode, state applies should use control-plane inventory
      // for direct semantic targets as well.
      if (OPS_USE_CONTROL_PLANE && !forceLegacy && method === 'state') {
        return await applyModeViaControlPlane({
          mode: modeForTarget,
          piIds: piIds.length ? piIds : undefined,
          concurrency,
          timeoutMs,
          dryRun,
        });
      }
      if (method === 'kiosk-url') {
        return await applyModeToFleetFromObject({
          repoRoot,
          inventoryPath: OPS_REGISTRY_PATH,
          mode: modeForTarget,
          piIds: piIds.length ? piIds : undefined,
          concurrency,
          timeoutMs,
          dryRun,
        });
      }
      return await applyKioskStateToFleetFromObject({
        repoRoot,
        inventoryPath: OPS_REGISTRY_PATH,
        mode: modeForTarget,
        piIds: piIds.length ? piIds : undefined,
        concurrency,
        timeoutMs,
        dryRun,
      });
    })();

    res.json({
      ok: true,
      target,
      id,
      resolvedTarget: {
        kind: defaults.target_kind ?? target,
        id: defaults.target_id ?? id,
      },
      results: normalizeApplyResults(results),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'ops_apply_target_failed', message: (err as Error).message });
  }
});

app.post('/api/ops/apply-profile', async (req, res) => {
  const profileIdRaw = (req.body as any)?.profileId ?? (req.body as any)?.id ?? (req.body as any)?.profile;
  const profileId = typeof profileIdRaw === 'string' ? profileIdRaw.trim() : '';
  if (!profileId) {
    res.status(400).json({ ok: false, error: 'missing_profileId', message: 'Provide { profileId: \"weather-channel\" }' });
    return;
  }

  const methodRaw = (req.body as any)?.method ?? req.query.method;
  const method = methodRaw === 'kiosk-url' ? 'kiosk-url' : 'state';

  const timeoutMs =
    clampInt((req.body as any)?.timeoutMs, 150, 8000) ??
    clampInt(req.query.timeoutMs, 150, 8000) ??
    2500;
  const concurrency =
    clampInt((req.body as any)?.concurrency, 1, 64) ??
    clampInt((req.body as any)?.parallel, 1, 64) ??
    clampInt(req.query.concurrency ?? req.query.parallel, 1, 64) ??
    8;
  const dryRun = parseBooleanQuery((req.body as any)?.dryRun) || parseBooleanQuery(req.query.dryRun);

  const file = profileId.endsWith('.toml') ? profileId : `${profileId}.toml`;
  // Resolve via repoRoot for parity with CLI behavior.
  const modePath = path.join('cable2', 'config', 'profiles', file);
  const piIds = parseStringArray((req.body as any)?.piIds ?? (req.body as any)?.pis);

  try {
    if (OPS_USE_CONTROL_PLANE && method !== 'state') {
      const results = await applyViaControlPlane({
        target: 'profile',
        id: profileId,
        piIds: piIds.length ? piIds : undefined,
        dryRun,
        timeoutMs,
      });
      res.json({ ok: true, modePath, results });
      return;
    }

    const results = await (async () => {
      if (method === 'kiosk-url') {
        return await applyModeToFleet({
          repoRoot,
          inventoryPath: OPS_REGISTRY_PATH,
          modePath,
          piIds: piIds.length ? piIds : undefined,
          concurrency,
          timeoutMs,
          dryRun,
        });
      }
      const mode = await loadModeFromFile(repoRoot, modePath);
      return await applyKioskStateToFleetFromObject({
        repoRoot,
        inventoryPath: OPS_REGISTRY_PATH,
        mode,
        piIds: piIds.length ? piIds : undefined,
        concurrency,
        timeoutMs,
        dryRun,
      });
    })();
    res.json({ ok: true, modePath, results: normalizeApplyResults(results) });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'ops_apply_profile_failed', message: (err as Error).message });
  }
});

app.post('/api/ops/set-channel', async (req, res) => {
  const channelIdRaw = (req.body as any)?.channelId ?? (req.body as any)?.channel;
  const channelId = typeof channelIdRaw === 'string' ? channelIdRaw.trim() : '';
  if (!channelId) {
    res.status(400).json({ ok: false, error: 'missing_channelId', message: 'Provide { channelId: \"weatherstar\" }' });
    return;
  }

  const methodRaw = (req.body as any)?.method ?? req.query.method;
  const method = methodRaw === 'kiosk-url' ? 'kiosk-url' : 'state';

  const timeoutMs =
    clampInt((req.body as any)?.timeoutMs, 150, 8000) ??
    clampInt(req.query.timeoutMs, 150, 8000) ??
    2500;
  const concurrency =
    clampInt((req.body as any)?.concurrency, 1, 64) ??
    clampInt((req.body as any)?.parallel, 1, 64) ??
    clampInt(req.query.concurrency ?? req.query.parallel, 1, 64) ??
    8;
  const dryRun = parseBooleanQuery((req.body as any)?.dryRun) || parseBooleanQuery(req.query.dryRun);

  const showQr = parseBooleanQuery((req.body as any)?.showQr);
  const lock = parseBooleanQuery((req.body as any)?.lock);
  const playlist = parseBooleanQuery((req.body as any)?.playlist);
  const nosplash = parseBooleanQuery((req.body as any)?.nosplash ?? true);
  const themeRaw = (req.body as any)?.theme;
  const theme = typeof themeRaw === 'string' && themeRaw.trim() ? themeRaw.trim() : undefined;
  const piIds = parseStringArray((req.body as any)?.piIds ?? (req.body as any)?.pis);

  const defaults: CableModeDefaults = {
    mode: 'gallery',
    target_kind: 'channel',
    target_id: channelId,
    channel: channelId,
    nosplash,
    // Schema uses qr=false to hide (default behavior in gallery is hidden anyway).
    qr: showQr ? true : false,
    lock,
    playlist,
    theme,
  };

  try {
    if (OPS_USE_CONTROL_PLANE) {
      const results = await applyViaControlPlane({
        target: 'channel',
        id: channelId,
        piIds: piIds.length ? piIds : undefined,
        dryRun,
        timeoutMs,
      });
      res.json({ ok: true, channelId, results });
      return;
    }

    const results = await (async () => {
      if (method === 'kiosk-url') {
        return await applyModeToFleetFromObject({
          repoRoot,
          inventoryPath: OPS_REGISTRY_PATH,
          mode: { defaults: { cable: defaults } },
          piIds: piIds.length ? piIds : undefined,
          concurrency,
          timeoutMs,
          dryRun,
        });
      }
      return await applyKioskStateToFleetFromObject({
        repoRoot,
        inventoryPath: OPS_REGISTRY_PATH,
        mode: { defaults: { cable: defaults } },
        piIds: piIds.length ? piIds : undefined,
        concurrency,
        timeoutMs,
        dryRun,
      });
    })();
    res.json({ ok: true, channelId, results: normalizeApplyResults(results) });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'ops_set_channel_failed', message: (err as Error).message });
  }
});

app.post('/api/ops/open-program', async (req, res) => {
  const channelIdRaw = (req.body as any)?.channelId ?? (req.body as any)?.channel;
  const channelId = typeof channelIdRaw === 'string' ? channelIdRaw.trim() : '';
  if (!channelId) {
    res.status(400).json({ ok: false, error: 'missing_channelId', message: 'Provide { channelId: \"weatherstar\" }' });
    return;
  }
  const indexRaw = (req.body as any)?.index ?? (req.body as any)?.i;
  const index =
    typeof indexRaw === 'number'
      ? Math.floor(indexRaw)
      : typeof indexRaw === 'string'
        ? Math.floor(Number(indexRaw))
        : NaN;
  if (!Number.isFinite(index) || index < 0) {
    res.status(400).json({ ok: false, error: 'missing_index', message: 'Provide { index: 0 } (0-based)' });
    return;
  }

  const timeoutMs =
    clampInt((req.body as any)?.timeoutMs, 150, 8000) ??
    clampInt(req.query.timeoutMs, 150, 8000) ??
    2500;
  const concurrency =
    clampInt((req.body as any)?.concurrency, 1, 64) ??
    clampInt((req.body as any)?.parallel, 1, 64) ??
    clampInt(req.query.concurrency ?? req.query.parallel, 1, 64) ??
    8;
  const dryRun = parseBooleanQuery((req.body as any)?.dryRun) || parseBooleanQuery(req.query.dryRun);
  const piIds = parseStringArray((req.body as any)?.piIds ?? (req.body as any)?.pis);

  try {
    if (OPS_USE_CONTROL_PLANE) {
      const results = await applyViaControlPlane({
        target: 'channel',
        id: channelId,
        piIds: piIds.length ? piIds : undefined,
        dryRun,
        timeoutMs,
      });
      res.json({
        ok: true,
        channelId,
        index,
        warning: 'control_plane_mode_open_program_uses_channel_apply',
        results,
      });
      return;
    }

    // Prefer: send a live WS broadcast (via the Pi cable server) to navigate to art view
    // without restarting Chromium. Fallback: you can force legacy restart behavior by
    // passing `method=kiosk-url`.
    const methodRaw = (req.body as any)?.method ?? req.query.method;
    const method = methodRaw === 'kiosk-url' ? 'kiosk-url' : 'state';

    const results = await (async () => {
      if (method === 'kiosk-url') {
        return await applyKioskUrlToFleet({
          repoRoot,
          inventoryPath: OPS_REGISTRY_PATH,
          piIds: piIds.length ? piIds : undefined,
          concurrency,
          timeoutMs,
          dryRun,
          buildUrl: (pi) => {
            const base = new URL(`http://localhost:${pi.guidePort}/channel/${encodeURIComponent(channelId)}`);
            base.searchParams.set('i', String(index));
            base.searchParams.set('screenId', pi.nodeName);
            base.searchParams.set('nosplash', '1');
            base.searchParams.set('qr', '0');
            return base.toString();
          },
        });
      }
      return await openArtOnFleet({
        repoRoot,
        inventoryPath: OPS_REGISTRY_PATH,
        channelId,
        index,
        piIds: piIds.length ? piIds : undefined,
        concurrency,
        timeoutMs,
        dryRun,
      });
    })();
    res.json({ ok: true, channelId, index, results: normalizeApplyResults(results) });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'ops_open_program_failed', message: (err as Error).message });
  }
});

app.post('/api/ops/open-guide', async (req, res) => {
  const methodRaw = (req.body as any)?.method ?? req.query.method;
  const method = methodRaw === 'kiosk-url' ? 'kiosk-url' : 'state';

  const timeoutMs =
    clampInt((req.body as any)?.timeoutMs, 150, 8000) ??
    clampInt(req.query.timeoutMs, 150, 8000) ??
    2500;
  const concurrency =
    clampInt((req.body as any)?.concurrency, 1, 64) ??
    clampInt((req.body as any)?.parallel, 1, 64) ??
    clampInt(req.query.concurrency ?? req.query.parallel, 1, 64) ??
    8;
  const dryRun = parseBooleanQuery((req.body as any)?.dryRun) || parseBooleanQuery(req.query.dryRun);
  const piIds = parseStringArray((req.body as any)?.piIds ?? (req.body as any)?.pis);

  // Return-to-guide defaults for kiosk operation:
  // - guide mode
  // - no splash
  // - unlocked (remote can tune)
  // - qr hidden by default
  const showQr = parseBooleanQuery((req.body as any)?.showQr);
  const lock = parseBooleanQuery((req.body as any)?.lock);
  const nosplash = parseBooleanQuery((req.body as any)?.nosplash ?? true);

  const defaults: CableModeDefaults = {
    mode: 'guide',
    lock,
    qr: showQr ? true : false,
    nosplash,
    playlist: false,
  };
  const modeForGuide: CableMode = { defaults: { cable: defaults } };

  try {
    const results = await (async () => {
      if (OPS_USE_CONTROL_PLANE && method === 'state') {
        return await applyModeViaControlPlane({
          mode: modeForGuide,
          piIds: piIds.length ? piIds : undefined,
          concurrency,
          timeoutMs,
          dryRun,
        });
      }
      if (method === 'kiosk-url') {
        return await applyKioskUrlToFleet({
          repoRoot,
          inventoryPath: OPS_REGISTRY_PATH,
          piIds: piIds.length ? piIds : undefined,
          concurrency,
          timeoutMs,
          dryRun,
          buildUrl: (pi) => {
            const base = new URL(`http://localhost:${pi.guidePort}/`);
            base.searchParams.set('screenId', pi.nodeName);
            if (nosplash) base.searchParams.set('nosplash', '1');
            if (showQr) base.searchParams.set('qr', '1');
            else base.searchParams.set('qr', '0');
            if (lock) base.searchParams.set('lock', '1');
            else base.searchParams.set('lock', '0');
            return base.toString();
          },
        });
      }
      return await applyKioskStateToFleetFromObject({
        repoRoot,
        inventoryPath: OPS_REGISTRY_PATH,
        mode: modeForGuide,
        piIds: piIds.length ? piIds : undefined,
        concurrency,
        timeoutMs,
        dryRun,
      });
    })();
    res.json({ ok: true, action: 'open-guide', results: normalizeApplyResults(results) });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'ops_open_guide_failed', message: (err as Error).message });
  }
});

app.get('/api/index', (_req, res) => {
  if (!guideIndex) {
    res.status(503).json({ error: 'index_not_ready' });
    return;
  }
  res.json(guideIndex);
});

app.get('/api/debug/media', (_req, res) => {
  const uptimeSec = Math.floor((Date.now() - mediaStats.startedAt) / 1000);
  const topPaths = Array.from(mediaPathStats.values())
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 6);
  res.json({
    uptimeSec,
    active: mediaStats.active,
    requests: mediaStats.requests,
    completed: mediaStats.completed,
    bytesSent: mediaStats.bytesSent,
    bytesRequested: mediaStats.bytesRequested,
    errors: mediaStats.errors,
    lastRequestAt: mediaStats.lastRequestAt,
    lastPath: mediaStats.lastPath,
    topPaths,
  });
});

app.get('/api/remote', (req, res) => {
  const rawPort = req.query.guide_port ?? req.query.port;
  const guidePort =
    typeof rawPort === 'string' && rawPort.trim().length > 0
      ? Number(rawPort)
      : Array.isArray(rawPort) && typeof rawPort[0] === 'string'
        ? Number(rawPort[0])
        : null;
  const port = Number.isFinite(guidePort) ? guidePort : null;
  const scheme =
    typeof req.query.scheme === 'string'
      ? req.query.scheme.replace(':', '')
      : Array.isArray(req.query.scheme) && typeof req.query.scheme[0] === 'string'
        ? req.query.scheme[0].replace(':', '')
        : null;
  const baseUrl = getRemoteBaseUrl(req, { port, scheme });
  const wsBaseUrl = getRemoteBaseUrl(req, { port: PORT, scheme });
  let wsUrl = '';
  try {
    const wsParsed = new URL(wsBaseUrl);
    wsParsed.protocol = wsParsed.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${wsParsed.origin}/ws`;
  } catch {
    wsUrl = '';
  }
  const remoteUrl = wsUrl
    ? `${baseUrl}/remote?ws=${encodeURIComponent(wsUrl)}`
    : `${baseUrl}/remote`;
  const qrUrl = `${QR_BASE}${encodeURIComponent(remoteUrl)}`;
  res.json({ baseUrl, remoteUrl, qrUrl, wsUrl });
});

function cachedMediaFilenameForUrl(remoteUrl: string): string {
  let ext = '';
  let base = '';
  try {
    const parsed = new URL(remoteUrl);
    ext = path.extname(parsed.pathname).toLowerCase();
    base = path
      .basename(parsed.pathname, ext)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 32);
  } catch {
    ext = '';
    base = '';
  }
  const hash = crypto
    .createHash('sha1')
    .update(remoteUrl)
    .digest('hex')
    .slice(0, 10);
  const safeExt = ext && ext.length <= 10 ? ext : '.bin';
  return base ? `${base}-${hash}${safeExt}` : `${hash}${safeExt}`;
}

function stashedFilenameForPath(sourcePath: string): string {
  // Deterministic key from the source path only (do not stat the NAS path here).
  // This lets us check "is it cached?" without touching the NAS when offline.
  const ext = path.extname(sourcePath).toLowerCase();
  const base = path
    .basename(sourcePath, ext)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 32);
  const hash = crypto
    .createHash('sha1')
    .update(sourcePath)
    .digest('hex')
    .slice(0, 10);
  const safeExt = ext && ext.length <= 10 ? ext : '.bin';
  return base ? `${base}-${hash}${safeExt}` : `${hash}${safeExt}`;
}

async function ensureCached(remoteUrl: string): Promise<string> {
  const name = cachedMediaFilenameForUrl(remoteUrl);
  const targetPath = path.join(mediaCacheDir, name);
  if (fs.existsSync(targetPath)) return targetPath;

  const key = name;
  const inflight = mediaCacheInflight.get(key);
  if (inflight) return inflight;

  const work = (async () => {
    await fsp.mkdir(mediaCacheDir, { recursive: true });
    if (fs.existsSync(targetPath)) return targetPath;

    let parsed: URL;
    try {
      parsed = new URL(remoteUrl);
    } catch {
      throw new Error('invalid_url');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('invalid_protocol');
    }

    const maxBytes = Number(process.env.CHIBA_MEDIA_CACHE_MAX_BYTES ?? '') || 1024 * 1024 * 1024;
    const timeoutMs = Number(process.env.CHIBA_CACHE_FETCH_TIMEOUT_MS ?? '') || 120_000;
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(remoteUrl, { redirect: 'follow', signal: controller.signal });
      if (!res.ok || !res.body) {
        throw new Error(`fetch_failed:${res.status}`);
      }
      const lengthHeader = res.headers.get('content-length');
      if (lengthHeader) {
        const length = Number.parseInt(lengthHeader, 10);
        if (Number.isFinite(length) && length > maxBytes) {
          throw new Error('too_large');
        }
      }

      const stream = Readable.fromWeb(res.body as any);
      const file = fs.createWriteStream(tmpPath, { flags: 'wx' });
      let bytes = 0;
      stream.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          stream.destroy(new Error('too_large'));
        }
      });
      try {
        await pipeline(stream, file);
        await fsp.rename(tmpPath, targetPath);
      } catch (err) {
        try {
          await fsp.rm(tmpPath, { force: true });
        } catch {
          // ignore cleanup errors
        }
        if (fs.existsSync(targetPath)) return targetPath;
        const message = (err as any)?.name === 'AbortError' ? 'timeout' : undefined;
        if (message) throw new Error(message);
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }
    return targetPath;
  })();

  mediaCacheInflight.set(key, work);
  try {
    return await work;
  } finally {
    mediaCacheInflight.delete(key);
  }
}

async function ensureStashed(sourcePath: string): Promise<string> {
  const name = stashedFilenameForPath(sourcePath);
  const targetPath = path.join(stashCacheDir, name);
  if (fs.existsSync(targetPath)) return targetPath;

  const inflight = stashInflight.get(name);
  if (inflight) return inflight;

  const work = (async () => {
    await fsp.mkdir(stashCacheDir, { recursive: true });
    if (fs.existsSync(targetPath)) return targetPath;
    const resolvedSourcePath = resolveAllowedMediaPath(sourcePath);
    if (!resolvedSourcePath) {
      throw new Error('forbidden_path');
    }

    // Copy with a timeout so a dead NAS mount doesn't hang the process forever.
    const timeoutMs =
      Number(process.env.CHIBA_STASH_COPY_TIMEOUT_MS ?? '') || 120_000;
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;

    const withTimeout = async <T>(fn: () => Promise<T>): Promise<T> => {
      let timer: NodeJS.Timeout | null = null;
      const timeout = new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      });
      try {
        return await Promise.race([fn(), timeout]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    const copyWithTimeout = async () => {
      return await new Promise<void>((resolve, reject) => {
        const read = fs.createReadStream(resolvedSourcePath);
        const write = fs.createWriteStream(tmpPath, { flags: 'wx' });
        let settled = false;

        const done = (err?: unknown) => {
          if (settled) return;
          settled = true;
          if (err) reject(err);
          else resolve();
        };

        const timer = setTimeout(() => {
          const err = new Error('timeout');
          read.destroy(err);
          write.destroy(err);
          done(err);
        }, timeoutMs);

        read.on('error', (err) => {
          clearTimeout(timer);
          done(err);
        });
        write.on('error', (err) => {
          clearTimeout(timer);
          done(err);
        });
        write.on('finish', () => {
          clearTimeout(timer);
          done();
        });

        // Don't use pipeline here because it can hang indefinitely in some IO-failure modes.
        read.pipe(write);
      });
    };
    try {
      // Validate source exists and is a file.
      const stat = await withTimeout(() => fsp.stat(resolvedSourcePath));
      if (!stat.isFile()) throw new Error('not_file');

      await copyWithTimeout();
      await fsp.rename(tmpPath, targetPath);
      return targetPath;
    } catch (err) {
      try {
        await fsp.rm(tmpPath, { force: true });
      } catch {
        // ignore
      }
      if (fs.existsSync(targetPath)) return targetPath;
      throw err;
    }
  })();

  stashInflight.set(name, work);
  try {
    return await work;
  } finally {
    stashInflight.delete(name);
  }
}

function isPathAllowed(target: string): boolean {
  return resolveAllowedMediaPath(target) !== null;
}

function rewritePathWithPrefixMap(target: string): string[] {
  const out = [target];
  for (const map of mediaPathPrefixMap) {
    if (target === map.from || target.startsWith(`${map.from}${path.sep}`)) {
      const suffix = target.slice(map.from.length);
      out.push(`${map.to}${suffix}`);
    }
  }
  return Array.from(new Set(out));
}

function resolveAllowedMediaPath(target: string): string | null {
  if (!mediaRoots.length) return null;
  const rootCandidates = new Set<string>();
  for (const root of mediaRoots) {
    for (const maybe of rewritePathWithPrefixMap(root)) {
      rootCandidates.add(path.resolve(maybe));
    }
  }
  for (const maybeTarget of rewritePathWithPrefixMap(target)) {
    const resolved = path.resolve(maybeTarget);
    for (const base of rootCandidates) {
      if (resolved === base || resolved.startsWith(`${base}${path.sep}`)) {
        return resolved;
      }
    }
  }
  return null;
}

app.get('/cache/raw', (req, res) => {
  const remoteUrl = typeof req.query.url === 'string' ? req.query.url : '';
  if (!remoteUrl) {
    res.status(400).send('missing_url');
    return;
  }
  const expected = cachedMediaFilenameForUrl(remoteUrl);
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(307, `/cache/${expected}?url=${encodeURIComponent(remoteUrl)}`);
});

app.get('/cache/:id', async (req, res) => {
  const remoteUrl = typeof req.query.url === 'string' ? req.query.url : '';
  if (!remoteUrl) {
    res.status(400).send('missing_url');
    return;
  }
  const expected = cachedMediaFilenameForUrl(remoteUrl);
  if (req.params.id !== expected) {
    res.redirect(302, `/cache/${expected}?url=${encodeURIComponent(remoteUrl)}`);
    return;
  }

  let cachedPath = '';
  try {
    cachedPath = await ensureCached(remoteUrl);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    if (message === 'invalid_url' || message === 'invalid_protocol') {
      res.status(400).send('bad_url');
      return;
    }
    if (message === 'too_large') {
      res.status(413).send('too_large');
      return;
    }
    if (message === 'timeout') {
      res.status(504).send('fetch_timeout');
      return;
    }
    console.warn('[cache] fetch failed', remoteUrl, message);
    res.status(502).send('fetch_failed');
    return;
  }

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(cachedPath);
  } catch {
    res.status(404).send('not_found');
    return;
  }
  if (!stat.isFile()) {
    res.status(404).send('not_found');
    return;
  }

  const mimeType =
    mime.contentType(path.extname(cachedPath)) || 'application/octet-stream';
  const range = req.headers.range;

  if (!range) {
    res.status(200);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    const stream = fs.createReadStream(cachedPath);
    stream.on('error', (error) => {
      console.warn('[cache] stream error', cachedPath, error?.message ?? error);
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.destroy(error as Error);
      }
    });
    stream.pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
  if (!match) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    return;
  }

  let start = match[1] ? Number.parseInt(match[1], 10) : NaN;
  let end = match[2] ? Number.parseInt(match[2], 10) : NaN;

  if (Number.isNaN(start)) {
    const suffix = Number.isNaN(end) ? 0 : end;
    start = Math.max(stat.size - suffix, 0);
    end = stat.size - 1;
  } else if (Number.isNaN(end)) {
    end = stat.size - 1;
  }

  if (start < 0 || end >= stat.size || start > end) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    return;
  }

  res.status(206);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  res.setHeader('Content-Length', end - start + 1);
  const stream = fs.createReadStream(cachedPath, { start, end });
  stream.on('error', (error) => {
    console.warn('[cache] stream error', cachedPath, error?.message ?? error);
    if (!res.headersSent) {
      res.status(500).end();
    } else {
      res.destroy(error as Error);
    }
  });
  stream.pipe(res);
});

app.get('/stash/raw', (req, res) => {
  const rawPath = req.query.path;
  if (typeof rawPath !== 'string' || !rawPath) {
    res.status(400).send('missing_path');
    return;
  }
  const decoded = decodeURIComponent(rawPath);
  if (!resolveAllowedMediaPath(decoded)) {
    res.status(403).send('forbidden');
    return;
  }
  const expected = stashedFilenameForPath(decoded);
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(307, `/stash/${expected}?path=${encodeURIComponent(decoded)}`);
});

app.get('/stash/:id', async (req, res) => {
  const rawPath = req.query.path;
  if (typeof rawPath !== 'string' || !rawPath) {
    res.status(400).send('missing_path');
    return;
  }
  const decoded = decodeURIComponent(rawPath);
  if (!resolveAllowedMediaPath(decoded)) {
    res.status(403).send('forbidden');
    return;
  }

  const expected = stashedFilenameForPath(decoded);
  if (req.params.id !== expected) {
    res.redirect(302, `/stash/${expected}?path=${encodeURIComponent(decoded)}`);
    return;
  }

  const targetPath = path.join(stashCacheDir, expected);
  if (!fs.existsSync(targetPath)) {
    // "skip-if-not-cached" behavior: fast 404 without touching the NAS.
    // Optionally warm in the background so it shows up on the next loop.
    // Default: warm on demand (best effort). Set CHIBA_STASH_AUTOFETCH=0 to disable.
    const autoFetch =
      process.env.CHIBA_STASH_AUTOFETCH === undefined ||
      process.env.CHIBA_STASH_AUTOFETCH === '' ||
      process.env.CHIBA_STASH_AUTOFETCH === '1' ||
      process.env.CHIBA_STASH_AUTOFETCH === 'true' ||
      process.env.CHIBA_STASH_AUTOFETCH === 'yes';
    const fetchParam =
      req.query.fetch === '1' ||
      req.query.fetch === 'true' ||
      req.query.fetch === 'yes';
    if (autoFetch || fetchParam) {
      // Fire-and-forget: don't block the response.
      void ensureStashed(decoded).catch((err) => {
        console.warn('[stash] fetch failed', decoded, (err as Error).message);
      });
    }
    res.status(404).send('not_cached');
    return;
  }

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(targetPath);
  } catch {
    res.status(404).send('not_found');
    return;
  }
  if (!stat.isFile()) {
    res.status(404).send('not_found');
    return;
  }

  const mimeType =
    mime.contentType(path.extname(targetPath)) || 'application/octet-stream';
  const range = req.headers.range;

  if (!range) {
    res.status(200);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    fs.createReadStream(targetPath).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
  if (!match) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    return;
  }

  let start = match[1] ? Number.parseInt(match[1], 10) : NaN;
  let end = match[2] ? Number.parseInt(match[2], 10) : NaN;

  if (Number.isNaN(start)) {
    const suffix = Number.isNaN(end) ? 0 : end;
    start = Math.max(stat.size - suffix, 0);
    end = stat.size - 1;
  } else if (Number.isNaN(end)) {
    end = stat.size - 1;
  }

  if (start < 0 || end >= stat.size || start > end) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    return;
  }

  res.status(206);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  res.setHeader('Content-Length', end - start + 1);
  fs.createReadStream(targetPath, { start, end }).pipe(res);
});

app.post('/api/stash/prefetch', async (req, res) => {
  // Best-effort prefetch of stashed files (NAS -> local cache).
  const body = (req.body ?? {}) as any;
  const rawPaths = Array.isArray(body.paths) ? body.paths : null;
  const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : '';
  const channelIds = normalizeStringArray(body.channelIds ?? body.channels);
  const targetRefs = normalizeRuntimeTargetRefs(body.targets ?? body.target);
  const config = await getTargetResolutionConfig();

  let paths: string[] = [];
  if (rawPaths) {
    paths = rawPaths.filter((p: any) => typeof p === 'string' && p.trim()).map((p: string) => p.trim());
  } else if (config) {
    const channelTargets: RuntimeTargetRef[] = Array.from(new Set([channelId, ...channelIds].map((s) => s.trim()).filter(Boolean))).map((id) => ({
      kind: 'channel',
      id,
    }));
    const resolvedSources = resolveSourcesForTargets(config, [...targetRefs, ...channelTargets]);
    paths = resolvedSources
      .filter((source) => source.type === 'path' && source.cache)
      .map((source) => source.value);
  }

  const filtered = Array.from(new Set(paths))
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .filter((p) => resolveAllowedMediaPath(p) !== null);

  // Kick off background copies (do not await).
  filtered.forEach((p) => {
    void ensureStashed(p).catch((err) => {
      console.warn('[stash] prefetch failed', p, (err as Error).message);
    });
  });

  res.json({
    ok: true,
    queued: filtered.length,
    channelId: channelId || null,
    channelIds: channelIds.length ? channelIds : null,
    targets: targetRefs.length ? targetRefs.map((target) => `${target.kind}:${target.id}`) : null,
  });
});

app.get('/api/stash/status', async (req, res) => {
  // Report stash cache status without touching the NAS.
  // Query:
  // - ?channelId=earl  (checks cached status for all cached path programs in that channel)
  // - ?path=...        (single path)
  // - ?paths=...       (repeatable)
  const channelId = typeof req.query.channelId === 'string' ? req.query.channelId.trim() : '';
  const channelIds = Array.isArray(req.query.channelIds)
    ? req.query.channelIds
    : typeof req.query.channelIds === 'string'
    ? [req.query.channelIds]
    : [];
  const targetRefs = normalizeRuntimeTargetRefs(req.query.targets ?? req.query.target);
  const pathParam = typeof req.query.path === 'string' ? req.query.path : '';
  const pathsParam = Array.isArray(req.query.paths)
    ? req.query.paths
    : typeof req.query.paths === 'string'
    ? [req.query.paths]
    : [];
  const config = await getTargetResolutionConfig();

  let paths: string[] = [];
  if ((channelId || channelIds.length || targetRefs.length) && config) {
    const channelTargets: RuntimeTargetRef[] = Array.from(new Set([channelId, ...channelIds].map((s) => String(s ?? '').trim()).filter(Boolean))).map((id) => ({
      kind: 'channel',
      id,
    }));
    const resolvedSources = resolveSourcesForTargets(config, [...targetRefs, ...channelTargets]);
    paths = resolvedSources
      .filter((source) => source.type === 'path' && source.cache)
      .map((source) => source.value);
  } else if (pathParam) {
    paths = [pathParam];
  } else if (pathsParam.length) {
    paths = pathsParam.filter((p): p is string => typeof p === 'string');
  }

  const uniq = Array.from(new Set(paths.map((p) => p.trim()).filter(Boolean)))
    .filter((p) => resolveAllowedMediaPath(p) !== null);

  const items = uniq.map((p) => {
    const name = stashedFilenameForPath(p);
    const cachedPath = path.join(stashCacheDir, name);
    return {
      path: p,
      name,
      cached: fs.existsSync(cachedPath),
    };
  });

  res.json({
    ok: true,
    channelId: channelId || null,
    channelIds: channelIds.length ? channelIds : null,
    targets: targetRefs.length ? targetRefs.map((target) => `${target.kind}:${target.id}`) : null,
    items,
    cached: items.filter((i) => i.cached).length,
    total: items.length,
  });
});

app.post('/api/cache/prefetch', async (req, res) => {
  // Best-effort prefetch of cached remote URLs (internet -> local cache).
  const body = (req.body ?? {}) as any;
  const rawUrls = Array.isArray(body.urls) ? body.urls : null;
  const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : '';
  const channelIds = normalizeStringArray(body.channelIds ?? body.channels);
  const targetRefs = normalizeRuntimeTargetRefs(body.targets ?? body.target);
  const config = await getTargetResolutionConfig();

  let urls: string[] = [];
  if (rawUrls) {
    urls = rawUrls.filter((u: any) => typeof u === 'string' && u.trim()).map((u: string) => u.trim());
  } else if (config) {
    const channelTargets: RuntimeTargetRef[] = Array.from(new Set([channelId, ...channelIds].map((s) => s.trim()).filter(Boolean))).map((id) => ({
      kind: 'channel',
      id,
    }));
    const resolvedSources = resolveSourcesForTargets(config, [...targetRefs, ...channelTargets]);
    urls = resolvedSources
      .filter((source) => source.type === 'url' && source.cache)
      .map((source) => source.value);
  }

  // Only prefetch http(s) URLs. Relative URLs won't work with ensureCached.
  const filtered = Array.from(new Set(urls))
    .map((u) => u.trim())
    .filter((u) => u.length > 0)
    .filter((u) => /^https?:\/\//i.test(u));

  filtered.forEach((u) => {
    void ensureCached(u).catch((err) => {
      console.warn('[cache] prefetch failed', u, (err as Error).message);
    });
  });

  res.json({
    ok: true,
    queued: filtered.length,
    channelId: channelId || null,
    channelIds: channelIds.length ? channelIds : null,
    targets: targetRefs.length ? targetRefs.map((target) => `${target.kind}:${target.id}`) : null,
  });
});

app.get('/api/cache/status', async (req, res) => {
  // Report remote cache status without touching the network.
  const channelId = typeof req.query.channelId === 'string' ? req.query.channelId.trim() : '';
  const channelIds = Array.isArray(req.query.channelIds)
    ? req.query.channelIds
    : typeof req.query.channelIds === 'string'
    ? [req.query.channelIds]
    : [];
  const targetRefs = normalizeRuntimeTargetRefs(req.query.targets ?? req.query.target);
  const urlParam = typeof req.query.url === 'string' ? req.query.url : '';
  const urlsParam = Array.isArray(req.query.urls)
    ? req.query.urls
    : typeof req.query.urls === 'string'
    ? [req.query.urls]
    : [];
  const config = await getTargetResolutionConfig();

  let urls: string[] = [];
  if ((channelId || channelIds.length || targetRefs.length) && config) {
    const channelTargets: RuntimeTargetRef[] = Array.from(new Set([channelId, ...channelIds].map((s) => String(s ?? '').trim()).filter(Boolean))).map((id) => ({
      kind: 'channel',
      id,
    }));
    const resolvedSources = resolveSourcesForTargets(config, [...targetRefs, ...channelTargets]);
    urls = resolvedSources
      .filter((source) => source.type === 'url' && source.cache)
      .map((source) => source.value);
  } else if (urlParam) {
    urls = [urlParam];
  } else if (urlsParam.length) {
    urls = urlsParam.filter((u): u is string => typeof u === 'string');
  }

  const uniq = Array.from(new Set(urls.map((u) => u.trim()).filter(Boolean)))
    .filter((u) => /^https?:\/\//i.test(u));

  const items = uniq.map((u) => {
    const name = cachedMediaFilenameForUrl(u);
    const cachedPath = path.join(mediaCacheDir, name);
    return { url: u, name, cached: fs.existsSync(cachedPath) };
  });

  res.json({
    ok: true,
    channelId: channelId || null,
    channelIds: channelIds.length ? channelIds : null,
    targets: targetRefs.length ? targetRefs.map((target) => `${target.kind}:${target.id}`) : null,
    items,
    cached: items.filter((i) => i.cached).length,
    total: items.length,
  });
});

app.post('/api/cache/clear', async (req, res) => {
  const body = (req.body ?? {}) as any;
  const clearStash = typeof body.stash === 'boolean' ? body.stash : true;
  const clearCache = typeof body.cache === 'boolean' ? body.cache : true;

  try {
    if (clearStash && clearCache) {
      await fsp.rm(mediaCacheDir, { recursive: true, force: true }).catch(() => {});
      await fsp.mkdir(stashCacheDir, { recursive: true }).catch(() => {});
      res.json({ ok: true, cleared: ['stash', 'cache'] });
      return;
    }
    if (clearStash) {
      await fsp.rm(stashCacheDir, { recursive: true, force: true }).catch(() => {});
      await fsp.mkdir(stashCacheDir, { recursive: true }).catch(() => {});
    }
    if (clearCache) {
      try {
        const entries = await fsp.readdir(mediaCacheDir, { withFileTypes: true });
        await Promise.all(
          entries.map(async (e) => {
            if (e.name === 'stash') return;
            const p = path.join(mediaCacheDir, e.name);
            await fsp.rm(p, { recursive: true, force: true }).catch(() => {});
          })
        );
      } catch {
        // ignore
      }
    }
    res.json({ ok: true, cleared: [clearStash ? 'stash' : null, clearCache ? 'cache' : null].filter(Boolean) });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'cache_clear_failed', message: (err as Error).message });
  }
});

app.get('/media/:id', async (req, res) => {
  const rawPath = req.query.path;
  if (typeof rawPath !== 'string' || !rawPath) {
    res.status(400).send('missing_path');
    recordMediaError(null);
    return;
  }
  const decoded = decodeURIComponent(rawPath);
  const resolvedPath = resolveAllowedMediaPath(decoded);
  if (!resolvedPath) {
    res.status(403).send('forbidden');
    recordMediaError(decoded);
    return;
  }
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(resolvedPath);
  } catch {
    res.status(404).send('not_found');
    recordMediaError(decoded);
    return;
  }
  if (!stat.isFile()) {
    res.status(404).send('not_found');
    recordMediaError(decoded);
    return;
  }

  const mimeType = mime.contentType(path.extname(resolvedPath)) || 'application/octet-stream';
  const range = req.headers.range;

  if (!range) {
    mediaStats.requests += 1;
    mediaStats.active += 1;
    mediaStats.lastRequestAt = Date.now();
    mediaStats.lastPath = resolvedPath;
    mediaStats.bytesRequested += stat.size;
    bumpPathStats(resolvedPath, 0);
    res.status(200);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    const stream = fs.createReadStream(resolvedPath);
    let completed = false;
    const done = () => {
      if (completed) return;
      completed = true;
      mediaStats.active = Math.max(0, mediaStats.active - 1);
      mediaStats.completed += 1;
    };
    stream.on('data', (chunk) => {
      mediaStats.bytesSent += chunk.length;
      const entry = mediaPathStats.get(resolvedPath);
      if (entry) entry.bytes += chunk.length;
    });
    stream.on('error', (err) => {
      recordMediaError(decoded);
      console.warn('[media] stream error', resolvedPath, err?.message ?? err);
      done();
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.destroy(err as Error);
      }
    });
    res.on('close', done);
    res.on('finish', done);
    stream.pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
  if (!match) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    recordMediaError(decoded);
    return;
  }

  let start = match[1] ? Number.parseInt(match[1], 10) : NaN;
  let end = match[2] ? Number.parseInt(match[2], 10) : NaN;

  if (Number.isNaN(start)) {
    const suffix = Number.isNaN(end) ? 0 : end;
    start = Math.max(stat.size - suffix, 0);
    end = stat.size - 1;
  } else if (Number.isNaN(end)) {
    end = stat.size - 1;
  }

  if (start < 0 || end >= stat.size || start > end) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    recordMediaError(decoded);
    return;
  }

  mediaStats.requests += 1;
  mediaStats.active += 1;
  mediaStats.lastRequestAt = Date.now();
  mediaStats.lastPath = resolvedPath;
  mediaStats.bytesRequested += end - start + 1;
  bumpPathStats(resolvedPath, 0);

  res.status(206);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  res.setHeader('Content-Length', end - start + 1);
  const stream = fs.createReadStream(resolvedPath, { start, end });
  let completed = false;
  const done = () => {
    if (completed) return;
    completed = true;
    mediaStats.active = Math.max(0, mediaStats.active - 1);
    mediaStats.completed += 1;
  };
  stream.on('data', (chunk) => {
    mediaStats.bytesSent += chunk.length;
    const entry = mediaPathStats.get(resolvedPath);
    if (entry) entry.bytes += chunk.length;
  });
  stream.on('error', (err) => {
    recordMediaError(decoded);
    console.warn('[media] stream error', resolvedPath, err?.message ?? err);
    done();
    if (!res.headersSent) {
      res.status(500).end();
    } else {
      res.destroy(err as Error);
    }
  });
  res.on('close', done);
  res.on('finish', done);
  stream.pipe(res);
});

app.get('/api/controls/:appId', (req, res) => {
  const appId = req.params.appId;
  const schema = controlSchemas.get(appId);
  if (!schema) {
    res.status(404).json({ error: 'controls_not_found' });
    return;
  }
  res.json(schema);
});

app.get('/village.jpg', (_req, res) => {
  const frame = villageCapture.getFrame();
  if (!frame) {
    res.status(503).send('capture_not_ready');
    return;
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.send(frame.buffer);
});

app.get('/village/live', (req, res) => {
  const hideMask =
    req.query.mask === '0' ||
    req.query.mask === 'false' ||
    req.query.mask === 'off';
  const sourceUrl = villageCapture.options.url;
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AI Village Live</title>
    <style>
      html, body {
        height: 100%;
        margin: 0;
        background: #0a0f1a;
      }
      body {
        position: relative;
        overflow: hidden;
      }
      #frame {
        position: absolute;
        inset: 0;
        width: 100vw;
        height: 100vh;
        border: 0;
        display: block;
        background: #0a0f1a;
      }
      #mask {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 340px;
        height: 140px;
        border-radius: 14px;
        background: radial-gradient(circle at 30% 30%, rgba(18, 32, 56, 0.98), rgba(8, 14, 24, 0.98));
        box-shadow: 0 12px 26px rgba(2, 6, 12, 0.6);
        border: 1px solid rgba(126, 215, 255, 0.18);
        pointer-events: none;
      }
      #status {
        position: absolute;
        bottom: 12px;
        right: 12px;
        padding: 6px 10px;
        border-radius: 999px;
        font-family: "Alegreya Sans", "Segoe UI", sans-serif;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(230, 240, 255, 0.7);
        background: rgba(10, 18, 32, 0.6);
        border: 1px solid rgba(126, 215, 255, 0.25);
      }
    </style>
  </head>
  <body>
    <iframe id="frame" src="${sourceUrl}" allow="autoplay; fullscreen"></iframe>
    <div id="mask"></div>
    <div id="status">Live site</div>
    <script>
      if (${hideMask ? 'true' : 'false'}) {
        const mask = document.getElementById('mask');
        if (mask) mask.style.display = 'none';
      }
    </script>
  </body>
</html>`);
});

app.get('/village', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AI Village</title>
    <style>
      html, body {
        height: 100%;
        margin: 0;
        background: #0a0f1a;
      }
      body {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      #frame {
        width: 100vw;
        height: 100vh;
        object-fit: contain;
        object-position: center;
        display: block;
        background: #0a0f1a;
      }
      #status {
        position: absolute;
        top: 16px;
        right: 16px;
        padding: 6px 10px;
        border-radius: 999px;
        font-family: "Alegreya Sans", "Segoe UI", sans-serif;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(230, 240, 255, 0.8);
        background: rgba(10, 18, 32, 0.6);
        border: 1px solid rgba(126, 215, 255, 0.35);
      }
    </style>
  </head>
  <body>
    <img id="frame" alt="AI Village feed" />
    <div id="status">Loading...</div>
    <script>
      const img = document.getElementById('frame');
      const status = document.getElementById('status');
      const refreshMs = ${villageCapture.options.intervalMs};
      const tick = () => {
        const ts = Date.now();
        img.src = '/village.jpg?ts=' + ts;
      };
      img.addEventListener('load', () => {
        status.textContent = 'Live';
      });
      img.addEventListener('error', () => {
        status.textContent = 'Connecting';
      });
      tick();
      setInterval(tick, refreshMs);
    </script>
  </body>
</html>`);
});

function sendPolledImageJpg(
  res: express.Response,
  poller: { getFrame: () => { buffer: Buffer; contentType: string } | null }
) {
  const frame = poller.getFrame();
  if (!frame) {
    res.status(503).send('capture_not_ready');
    return;
  }
  res.setHeader('Content-Type', frame.contentType || 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.send(frame.buffer);
}

function sendPolledImagePage(opts: {
  res: express.Response;
  title: string;
  imgPath: string;
  intervalMs: number;
  background?: string;
  fit?: 'cover' | 'contain';
}) {
  const { res, title, imgPath, intervalMs, background, fit } = opts;
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      html, body { height: 100%; margin: 0; background: ${background ?? '#05060a'}; }
      body { position: relative; display: flex; align-items: center; justify-content: center; overflow: hidden; }
      #frame { width: 100vw; height: 100vh; object-fit: ${fit ?? 'cover'}; object-position: center; display: block; background: ${background ?? '#05060a'}; }
      #status {
        position: absolute;
        top: 16px;
        right: 16px;
        padding: 6px 10px;
        border-radius: 999px;
        font-family: "Alegreya Sans", "Segoe UI", sans-serif;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(230, 240, 255, 0.8);
        background: rgba(6, 12, 24, 0.55);
        border: 1px solid rgba(120, 200, 255, 0.35);
      }
    </style>
  </head>
  <body>
    <img id="frame" alt="${title}" />
    <div id="status">Loading...</div>
    <script>
      const img = document.getElementById('frame');
      const status = document.getElementById('status');
      const refreshMs = ${Math.max(500, Math.floor(intervalMs))};
      const tick = () => {
        const ts = Date.now();
        img.src = '${imgPath}?ts=' + ts;
      };
      img.addEventListener('load', () => { status.textContent = 'Live'; });
      img.addEventListener('error', () => { status.textContent = 'Connecting'; });
      tick();
      setInterval(tick, refreshMs);
    </script>
  </body>
</html>`);
}

app.get('/swpc/aurora-north.jpg', (_req, res) => {
  sendPolledImageJpg(res, swpcAuroraNorth);
});
app.get('/swpc/aurora-north', (_req, res) => {
  sendPolledImagePage({
    res,
    title: 'Aurora Forecast (North)',
    imgPath: '/swpc/aurora-north.jpg',
    intervalMs: swpcAuroraNorth.options.intervalMs,
    background: '#05060a',
  });
});

app.get('/swpc/aurora-south.jpg', (_req, res) => {
  sendPolledImageJpg(res, swpcAuroraSouth);
});
app.get('/swpc/aurora-south', (_req, res) => {
  sendPolledImagePage({
    res,
    title: 'Aurora Forecast (South)',
    imgPath: '/swpc/aurora-south.jpg',
    intervalMs: swpcAuroraSouth.options.intervalMs,
    background: '#05060a',
  });
});

app.get('/swpc/swepam-24h.gif', (_req, res) => {
  sendPolledImageJpg(res, swpcSwepam24h);
});
app.get('/swpc/swepam-24h', (_req, res) => {
  sendPolledImagePage({
    res,
    title: 'Solar Wind (ACE SWEPAM, 24h)',
    imgPath: '/swpc/swepam-24h.gif',
    intervalMs: swpcSwepam24h.options.intervalMs,
    background: '#05060a',
    fit: 'contain',
  });
});

app.get('/ambient/gradient', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ambient Gradient</title>
    <style>
      :root {
        --a: #0a1020;
        --b: #101a4a;
        --c: #1d5b6a;
        --d: #b56b3b;
      }
      html, body { height: 100%; margin: 0; background: #05060a; overflow: hidden; }
      .bg {
        position: absolute;
        inset: -20%;
        background:
          radial-gradient(1200px 800px at 20% 25%, rgba(125, 220, 255, 0.25), transparent 60%),
          radial-gradient(900px 700px at 75% 65%, rgba(255, 190, 120, 0.22), transparent 55%),
          radial-gradient(1000px 900px at 50% 95%, rgba(190, 120, 255, 0.18), transparent 55%),
          linear-gradient(135deg, var(--a), var(--b) 35%, var(--c) 70%, var(--d));
        filter: saturate(115%) contrast(110%);
        transform: translate3d(0,0,0);
        animation: drift 28s ease-in-out infinite alternate;
      }
      .grain {
        position: absolute;
        inset: -10%;
        background-image:
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='.22'/%3E%3C/svg%3E");
        mix-blend-mode: overlay;
        opacity: 0.25;
        transform: translate3d(0,0,0);
        animation: grain 4.2s steps(2) infinite;
        pointer-events: none;
      }
      @keyframes drift {
        0% { transform: translate3d(-4%, -2%, 0) scale(1.05) rotate(-0.2deg); }
        100% { transform: translate3d(4%, 2%, 0) scale(1.08) rotate(0.2deg); }
      }
      @keyframes grain {
        0% { transform: translate3d(0,0,0); }
        25% { transform: translate3d(-2%, 1%, 0); }
        50% { transform: translate3d(1%, -2%, 0); }
        75% { transform: translate3d(2%, 2%, 0); }
        100% { transform: translate3d(-1%, -1%, 0); }
      }
    </style>
  </head>
  <body>
    <div class="bg" aria-hidden="true"></div>
    <div class="grain" aria-hidden="true"></div>
  </body>
</html>`);
});

app.get('/ambient/stars', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ambient Stars</title>
    <style>
      html, body { height: 100%; margin: 0; background: #02030a; overflow: hidden; }
      canvas { display: block; width: 100vw; height: 100vh; }
    </style>
  </head>
  <body>
    <canvas id="c"></canvas>
    <script>
      const canvas = document.getElementById('c');
      const ctx = canvas.getContext('2d');
      const stars = [];
      const rand = (a,b)=>a+Math.random()*(b-a);
      const resize = () => {
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        canvas.width = Math.floor(window.innerWidth * dpr);
        canvas.height = Math.floor(window.innerHeight * dpr);
        ctx.setTransform(dpr,0,0,dpr,0,0);
      };
      const init = () => {
        stars.length = 0;
        const n = Math.floor(Math.max(180, (window.innerWidth * window.innerHeight) / 9000));
        for (let i=0;i<n;i++) {
          stars.push({ x: Math.random(), y: Math.random(), r: rand(0.4, 1.8), a: rand(0.2, 0.95), z: rand(0.2, 1.0) });
        }
      };
      const draw = (t) => {
        const w = window.innerWidth, h = window.innerHeight;
        ctx.clearRect(0,0,w,h);
        const g = ctx.createRadialGradient(w*0.55,h*0.45,0,w*0.55,h*0.45,Math.max(w,h)*0.85);
        g.addColorStop(0, 'rgba(28, 62, 120, 0.25)');
        g.addColorStop(0.6, 'rgba(4, 10, 22, 0.7)');
        g.addColorStop(1, 'rgba(2, 3, 10, 1)');
        ctx.fillStyle = g;
        ctx.fillRect(0,0,w,h);
        for (const s of stars) {
          const tw = 0.45 + 0.55*Math.sin((t/1000)*0.7 + s.x*12.0 + s.y*7.0);
          const alpha = s.a * (0.55 + 0.45*tw);
          ctx.fillStyle = 'rgba(230, 245, 255,' + alpha.toFixed(3) + ')';
          const x = s.x * w + Math.sin(t/16000 + s.y*10)*10*s.z;
          const y = s.y * h + Math.cos(t/18000 + s.x*10)*8*s.z;
          ctx.beginPath();
          ctx.arc(x, y, s.r, 0, Math.PI*2);
          ctx.fill();
        }
        requestAnimationFrame(draw);
      };
      window.addEventListener('resize', () => { resize(); init(); });
      resize(); init(); requestAnimationFrame(draw);
    </script>
  </body>
</html>`);
});

app.all('/embed/:id/proxy/*', async (req, res) => {
  const embed = getEmbedConfig(req.params.id);
  if (!embed?.url) {
    res.status(404).send('embed_not_found');
    return;
  }
  const base = new URL(embed.url);
  const prefix = `/embed/${req.params.id}/proxy`;
  const rawSuffix = req.originalUrl.startsWith(prefix)
    ? req.originalUrl.slice(prefix.length)
    : req.originalUrl.replace(`/embed/${req.params.id}/proxy`, "");
  const suffix = rawSuffix || "/";
  const targetUrl = new URL(suffix, base);
  const method = req.method.toUpperCase();
  const headers = new Headers();
  Object.entries(req.headers).forEach(([key, value]) => {
    if (!value) return;
    if (key.toLowerCase() === "host") return;
    if (Array.isArray(value)) {
      headers.set(key, value.join(","));
    } else {
      headers.set(key, value);
    }
  });
  headers.set("User-Agent", "Mozilla/5.0 (ChibaCable)");
  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  try {
    const upstream = await fetch(targetUrl, {
      method,
      headers,
      body: body as any,
      redirect: "follow",
    });
    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (lower === "content-encoding") return;
      if (lower === "content-length") return;
      if (lower === "transfer-encoding") return;
      res.setHeader(key, value);
    });
    const data = Buffer.from(await upstream.arrayBuffer());
    res.send(data);
  } catch (err) {
    res.status(502).send(`embed_proxy_failed: ${(err as Error).message}`);
  }
});

app.get('/embed/:id', async (req, res) => {
  const embed = getEmbedConfig(req.params.id);
  if (!embed?.url) {
    res.status(404).send('embed_not_found');
    return;
  }
  const embedDebug = parseBooleanQuery(req.query.embed_debug);
  if (embed.mode === 'proxy') {
    try {
      const upstream = await fetch(embed.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (ChibaCable)' },
      });
      const html = await upstream.text();
      if (embedDebug) {
        console.log(
          `[embed] proxy ${req.params.id} ${upstream.status} (${embed.url})`
        );
      }
      res.setHeader('Content-Type', 'text/html');
      res.send(
        buildProxyPage(html, embed, req.params.id, {
          enabled: embedDebug,
          status: upstream.status,
          url: embed.url,
        })
      );
    } catch (err) {
      res.status(502).send(`embed_proxy_failed: ${(err as Error).message}`);
    }
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.send(buildEmbedPage(embed, embedDebug));
});

app.get('/mars', (_req, res) => {
  const viewUrl =
    'https://vdo.ninja/?view=QQA3g6X316&room=Mars_Public_Access_Network&pw=marscollege&scene&api=1';
  const pushUrl =
    'https://vdo.ninja/?push=QQA3g6X316&room=Mars_Public_Access_Network&pw=marscollege';
  const qrUrl =
    'https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data=' +
    encodeURIComponent(pushUrl);
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mars Public Access Network</title>
    <style>
      html, body {
        height: 100%;
        margin: 0;
        background: #0a0f1a;
      }
      body {
        position: relative;
        overflow: hidden;
        font-family: "Oxanium", "Segoe UI", sans-serif;
        color: #e9f5ff;
      }
      #frame {
        position: absolute;
        inset: 0;
        width: 100vw;
        height: 100vh;
        border: 0;
        display: block;
        background: #0a0f1a;
      }
      #overlay {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at 50% 30%, rgba(40, 80, 140, 0.55), rgba(6, 10, 18, 0.96));
        color: #e9f5ff;
        opacity: 0;
        transition: opacity 220ms ease;
        pointer-events: none;
      }
      #overlay.is-visible {
        opacity: 1;
        pointer-events: auto;
      }
      .panel {
        max-width: min(720px, 90vw);
        padding: 28px;
        border-radius: 18px;
        background: linear-gradient(160deg, rgba(18, 30, 54, 0.96), rgba(8, 14, 24, 0.98));
        border: 1px solid rgba(126, 215, 255, 0.35);
        box-shadow: 0 20px 40px rgba(2, 6, 12, 0.6);
        display: grid;
        gap: 16px;
        text-align: center;
      }
      .title {
        font-size: 1.4rem;
        letter-spacing: 0.3em;
        text-transform: uppercase;
      }
      .subtitle {
        color: rgba(200, 220, 255, 0.75);
        font-size: 0.9rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
      }
      .qr {
        margin: 0 auto;
        width: 200px;
        height: 200px;
        border-radius: 14px;
        padding: 8px;
        background: rgba(6, 10, 18, 0.85);
        border: 1px solid rgba(126, 215, 255, 0.3);
      }
      .hint {
        font-size: 0.8rem;
        color: rgba(200, 220, 255, 0.8);
      }
      .dismiss {
        justify-self: center;
        padding: 8px 18px;
        border-radius: 999px;
        border: 1px solid rgba(126, 215, 255, 0.4);
        background: rgba(12, 20, 36, 0.85);
        color: #e9f5ff;
        font-size: 0.7rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <iframe id="frame" src="${viewUrl}" allow="autoplay; fullscreen; microphone; camera"></iframe>
    <div id="overlay" class="is-visible">
      <div class="panel">
        <div class="title">Mars Public Access Network</div>
        <div class="subtitle">Waiting for Broadcast</div>
        <img class="qr" src="${qrUrl}" alt="QR to broadcast" />
        <div class="hint">Scan to join and broadcast via VDO Ninja.</div>
        <button class="dismiss" id="dismiss">Hide Info</button>
      </div>
    </div>
    <script>
      const overlay = document.getElementById('overlay');
      const dismiss = document.getElementById('dismiss');
      const show = () => overlay.classList.add('is-visible');
      const hide = () => overlay.classList.remove('is-visible');
      dismiss.addEventListener('click', hide);
      window.addEventListener('message', () => hide());
      setTimeout(() => show(), 4000);
    </script>
  </body>
</html>`);
});

app.get('/roadmap', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Chiba Cable | Roadmap Channel 140</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
      :root {
        color-scheme: dark;
        --bg: #040506;
        --ink: #f9f4ea;
        --ink-soft: rgba(249, 244, 234, 0.6);
      }
      * {
        box-sizing: border-box;
      }
      html, body {
        height: 100%;
        margin: 0;
        background: var(--bg);
      }
      body {
        font-family: "Press Start 2P", monospace;
        color: var(--ink);
        display: grid;
        place-items: center;
        padding: 0;
      }
      .stage {
        width: 100vw;
        height: 100vh;
        display: grid;
        place-items: center;
        background: #000;
      }
      .frame {
        position: relative;
        width: min(1320px, 98vw);
        aspect-ratio: 1024 / 666;
        max-height: 92vh;
        background: #000;
        overflow: hidden;
      }
      .frame img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: scale(1.04);
        transform-origin: center;
        image-rendering: pixelated;
      }
      .frame.glitch {
        animation: glitch 0.5s linear;
      }
      .overlay {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        pointer-events: none;
        padding-bottom: 12%;
      }
      .title {
        --title-size: clamp(1.2rem, 2.4vw, 2.8rem);
        font-size: var(--title-size);
        letter-spacing: 0.12em;
        line-height: 1.35;
        text-align: center;
        white-space: pre-line;
        text-transform: uppercase;
        color: var(--ink);
        text-shadow: 0 3px 0 rgba(0, 0, 0, 0.6);
        max-width: 82%;
      }
      @keyframes glitch {
        0% { transform: translate(0, 0); filter: hue-rotate(0deg); }
        20% { transform: translate(-2px, 1px); filter: hue-rotate(6deg); }
        40% { transform: translate(2px, -1px); filter: hue-rotate(-8deg); }
        60% { transform: translate(-1px, 2px); filter: hue-rotate(4deg); }
        80% { transform: translate(1px, -2px); filter: hue-rotate(-6deg); }
        100% { transform: translate(0, 0); filter: hue-rotate(0deg); }
      }
      @media (max-width: 900px) {
        .frame {
          width: 100vw;
        }
        .title {
          max-width: 90%;
        }
      }
    </style>
  </head>
  <body>
    <div class="stage">
      <div class="frame" id="image-shell">
        <img id="frame" src="/assets/roadmap/remote-idle-1.jpg" alt="Roadmap teletext" />
        <div class="overlay">
          <div class="title" id="slide-title"></div>
        </div>
      </div>
    </div>

    <script>
      const frame = document.getElementById("frame");
      const slideTitle = document.getElementById("slide-title");
      const imageShell = document.getElementById("image-shell");

      const frames = {
        idle: [
          "/assets/roadmap/remote-idle-1.jpg",
          "/assets/roadmap/remote-idle-2.jpg",
        ],
        anim: "/assets/roadmap/remote-anim-1.jpg",
      };

      const slides = [
        "ROADMAP",
        "LET CHIBA CONTROL THE TV",
        "BUMPERS / COMMERCIALS MODULE",
        "AV STREAMS OF CLASSES",
        "MORE CHANNELS! (I NEED HELP)",
        "CURATE THE NAS",
        "CHIBA CABLE SCREENS AROUND CAMP",
        "CALL-IN SHOWS WITH PHONES",
        "CALL THE TV STATION TO ADD FEATURES TO THE APP",
        "CHIBA CABLE AT BIENNALE",
      ];

      const idleIntervalMs = 500;
      const transitionMs = 840;
      const typeIntervalMs = 38;

      let idleTimer = null;
      let transitionTimer = null;
      let typeTimer = null;
      let idleIndex = 0;
      let slideIndex = 0;
      let isTransitioning = false;

      function wrapText(text, maxLen) {
        const words = text.split(" ");
        const lines = [];
        let line = "";
        words.forEach((word) => {
          const next = line ? line + " " + word : word;
          if (next.length > maxLen && line) {
            lines.push(line);
            line = word;
          } else {
            line = next;
          }
        });
        if (line) lines.push(line);
        return lines;
      }

      function computeTitleSize(lines) {
        const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
        let size = 2.6;
        if (longest <= 10) size = 3.0;
        else if (longest <= 16) size = 2.5;
        else if (longest <= 22) size = 2.0;
        else if (longest <= 28) size = 1.6;
        else size = 1.3;
        if (lines.length >= 3) size *= 0.9;
        return size.toFixed(2) + "rem";
      }

      function stopTyping() {
        if (typeTimer) {
          clearInterval(typeTimer);
          typeTimer = null;
        }
      }

      function renderTitle(text) {
        stopTyping();
        const lines = wrapText(text, 22);
        const fullText = lines.join("\\n");
        slideTitle.style.setProperty("--title-size", computeTitleSize(lines));
        slideTitle.textContent = "";
        let index = 0;
        typeTimer = setInterval(() => {
          index += 1;
          slideTitle.textContent = fullText.slice(0, index);
          if (index >= fullText.length) {
            stopTyping();
          }
        }, typeIntervalMs);
      }

      function clampIndex(index) {
        const count = slides.length;
        return ((index % count) + count) % count;
      }

      function updateSlide(index) {
        slideIndex = clampIndex(index);
        renderTitle(slides[slideIndex]);
      }

      function stopIdle() {
        if (idleTimer) {
          clearInterval(idleTimer);
          idleTimer = null;
        }
      }

      function startIdle() {
        stopIdle();
        idleIndex = 0;
        frame.src = frames.idle[idleIndex];
        idleTimer = setInterval(() => {
          idleIndex = (idleIndex + 1) % frames.idle.length;
          frame.src = frames.idle[idleIndex];
        }, idleIntervalMs);
      }

      function playTransition(nextIndex) {
        if (isTransitioning) return;
        isTransitioning = true;
        stopTyping();
        stopIdle();
        frame.src = frames.anim;
        updateSlide(nextIndex);
        if (transitionTimer) clearTimeout(transitionTimer);
        transitionTimer = setTimeout(() => {
          frame.src = frames.idle[0];
          startIdle();
          isTransitioning = false;
        }, transitionMs);
      }

      function nextSlide() {
        playTransition(slideIndex + 1);
      }

      function prevSlide() {
        playTransition(slideIndex - 1);
      }

      function triggerGlitch() {
        imageShell.classList.remove("glitch");
        void imageShell.offsetWidth;
        imageShell.classList.add("glitch");
        setTimeout(() => imageShell.classList.remove("glitch"), 500);
      }

      function bootRemote() {
        const params = new URLSearchParams(window.location.search);
        const appId = params.get("appId") || params.get("app") || "roadmap";
        const wsParam = params.get("ws");
        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        const wsUrl = wsParam || protocol + "://" + window.location.host + "/ws";
        const socket = new WebSocket(wsUrl);

        const controlSchema = [
          { id: "next", label: "Next", type: "button" },
          { id: "prev", label: "Prev", type: "button" },
          { id: "glitch", label: "Glitch", type: "button" },
        ];

        socket.addEventListener("open", () => {
          socket.send(
            JSON.stringify({
              type: "controls",
              appId: appId,
              controls: controlSchema,
            })
          );
        });

        socket.addEventListener("message", (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type !== "control" || msg.appId !== appId) return;
            if (msg.controlId === "next") nextSlide();
            if (msg.controlId === "prev") prevSlide();
            if (msg.controlId === "glitch") triggerGlitch();
          } catch (err) {
            console.warn("remote message failed", err);
          }
        });
      }

      document.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight") nextSlide();
        if (event.key === "ArrowLeft") prevSlide();
      });

      updateSlide(0);
      startIdle();
      bootRemote();
    </script>
  </body>
</html>`);
});
app.get('/weatherstar.jpg', (_req, res) => {
  const frame = weatherstarCapture.getFrame();
  if (!frame) {
    res.status(503).send('capture_not_ready');
    return;
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.send(frame.buffer);
});

app.get('/weatherstar', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>WeatherStar</title>
    <style>
      html, body {
        height: 100%;
        margin: 0;
        background: #05060a;
      }
      body {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      #frame {
        width: 100vw;
        height: 100vh;
        object-fit: cover;
        object-position: center;
        display: block;
        background: #05060a;
      }
      /* Portrait kiosks rotate the display, but the WeatherStar capture is landscape.
         Letterbox instead of cropping when the viewport is portrait. */
      @media (orientation: portrait) {
        #frame {
          object-fit: contain;
        }
      }
      #status {
        position: absolute;
        top: 16px;
        right: 16px;
        padding: 6px 10px;
        border-radius: 999px;
        font-family: "Alegreya Sans", "Segoe UI", sans-serif;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(230, 240, 255, 0.8);
        background: rgba(6, 12, 24, 0.55);
        border: 1px solid rgba(120, 200, 255, 0.35);
      }
    </style>
  </head>
  <body>
    <img id="frame" alt="WeatherStar feed" />
    <div id="status">Loading...</div>
    <script>
      const img = document.getElementById('frame');
      const status = document.getElementById('status');
      const refreshMs = ${weatherstarCapture.options.intervalMs};
      const tick = () => {
        const ts = Date.now();
        img.src = '/weatherstar.jpg?ts=' + ts;
      };
      img.addEventListener('load', () => {
        status.textContent = 'Live';
      });
      img.addEventListener('error', () => {
        status.textContent = 'Connecting';
      });
      tick();
      setInterval(tick, refreshMs);
    </script>
  </body>
</html>`);
});

app.use(
  '/assets',
  express.static(path.resolve(__dirname, '../../guide/public/assets'), {
    index: false,
  })
);
app.use(
  '/assets-local',
  express.static(path.resolve(repoRoot, 'cable2/assets'), {
    index: false,
  })
);
app.use(express.static(distDir, { index: false }));
if (opsDevUrl) {
  app.use('/ops', (req, res) => {
    res.redirect(307, `${opsDevUrl}${req.originalUrl}`);
  });
} else {
  app.use('/ops', express.static(opsDistDir, { index: false }));
}

function getBaseUrl(req: express.Request): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto?.split(',')[0];
  const scheme = proto ?? (req.secure ? 'https' : 'http');
  const host = req.headers.host ?? `localhost:${PORT}`;
  return `${scheme}://${host}`;
}

const QR_BASE =
  'https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=';

type RemoteBaseOptions = {
  scheme?: string | null;
  port?: number | null;
};

function getLanAddress(): string | null {
  const nets = os.networkInterfaces();
  const candidates: Array<{ addr: string; score: number }> = [];
  for (const entries of Object.values(nets)) {
    for (const info of entries ?? []) {
      if (!info) continue;
      if (info.family !== 'IPv4' || info.internal) continue;
      const addr = info.address;
      if (addr.startsWith('169.254.')) continue;
      let score = 1;
      if (addr.startsWith('192.168.')) score = 4;
      else if (addr.startsWith('10.')) score = 3;
      else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(addr)) score = 3;
      else if (addr.startsWith('100.')) score = 2;
      candidates.push({ addr, score });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.addr ?? null;
}

function normalizeRemoteBase(input: string, fallback: string): string {
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function isPrivateLanAddress(addr: string): boolean {
  if (!addr || addr.includes(':')) return true;
  const parts = addr.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isLoopbackHost(host: string): boolean {
  if (!host) return true;
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower === 'ip6-localhost' || lower === 'ip6-loopback') {
    return true;
  }
  if (lower === '::1') return true;
  if (lower.startsWith('127.')) return true;
  return false;
}

function extractHostname(hostHeader: string): string {
  const trimmed = hostHeader.trim();
  if (!trimmed) return '';
  try {
    return new URL(`http://${trimmed}`).hostname;
  } catch {
    return trimmed.split(':')[0] ?? '';
  }
}

function getMdnsHostname(): string {
  const name = os.hostname();
  return name.endsWith('.local') ? name : `${name}.local`;
}

function getFallbackHost(
  req: express.Request,
  port: number | null
): { host: string; isLocal: boolean } {
  const rawHost = req.headers.host ?? '';
  const hostname = extractHostname(rawHost);
  if (!hostname || isLoopbackHost(hostname)) {
    const mdns = getMdnsHostname();
    return { host: port ? `${mdns}:${port}` : mdns, isLocal: true };
  }
  const isLocal = hostname.endsWith('.local');
  const host = port ? `${hostname}:${port}` : hostname;
  return { host, isLocal };
}

function getRemoteBaseUrl(
  req: express.Request,
  options: RemoteBaseOptions = {}
): string {
  const configured =
    loadedConfig?.config?.server?.remote_url ??
    process.env.CHIBA_REMOTE_URL ??
    '';
  if (configured) {
    return normalizeRemoteBase(configured, getBaseUrl(req));
  }
  const port = options.port ?? PORT;
  const lan = getLanAddress();
  if (lan) {
    const explicitScheme = options.scheme ?? null;
    const scheme =
      explicitScheme ??
      (isPrivateLanAddress(lan) ? 'http' : req.secure ? 'https' : 'http');
    return `${scheme}://${lan}${port ? `:${port}` : ''}`;
  }
  const fallback = getFallbackHost(req, port);
  const explicitScheme = options.scheme ?? null;
  const scheme =
    explicitScheme ?? (fallback.isLocal ? 'http' : req.secure ? 'https' : 'http');
  return `${scheme}://${fallback.host}`;
}

async function sendIndex(req: express.Request, res: express.Response) {
  try {
    const html = await fsp.readFile(indexFile, 'utf-8');
    const remoteBaseUrl = getRemoteBaseUrl(req, { port: PORT });
    const payload = html.replace('__REMOTE_URL__', remoteBaseUrl);
    res.setHeader('Content-Type', 'text/html');
    res.send(payload);
  } catch (err) {
    res.status(500).send('Missing guide build. Run: pnpm -C apps/guide build');
  }
}

async function sendOpsIndex(_req: express.Request, res: express.Response) {
  try {
    const html = await fsp.readFile(opsIndexFile, 'utf-8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res
      .status(500)
      .send('Missing ops build. Run: pnpm -C cable2/apps/ops build');
  }
}

app.get('*', (req, res) => {
  if (req.path.startsWith('/ws')) {
    res.status(426).send('WebSocket only');
    return;
  }
  if (req.path.startsWith('/ops')) {
    if (opsDevUrl) {
      res.redirect(307, `${opsDevUrl}${req.originalUrl}`);
      return;
    }
    sendOpsIndex(req, res);
    return;
  }
  sendIndex(req, res);
});

const heartbeatTimer = setInterval(() => {
  wss.clients.forEach((client) => {
    const alive = wsAlive.get(client);
    if (alive === false) {
      console.warn('[ws] terminating stale client');
      client.terminate();
      return;
    }
    wsAlive.set(client, false);
    try {
      client.ping();
    } catch (err) {
      console.warn('[ws] ping failed', (err as Error).message);
    }
  });
}, WS_HEARTBEAT_MS);

server.on('upgrade', (req, socket, head) => {
  if (!req.url) {
    socket.destroy();
    return;
  }
  const path = req.url.split('?')[0] ?? '';
  if (path === '/ws') {
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit('connection', client, req);
    });
    return;
  }
  if (path.startsWith('/embed/')) {
    handleProxyUpgrade(req, socket, head);
    return;
  }
  socket.destroy();
});

wss.on('connection', (socket, req) => {
  const remoteAddr = req.socket.remoteAddress ?? 'unknown';
  wsAlive.set(socket, true);
  console.log('[ws] client connected', remoteAddr);
  socket.on('pong', () => {
    wsAlive.set(socket, true);
  });
  socket.on('close', (code, reason) => {
    const detail = reason?.toString?.() ?? '';
    console.log('[ws] client closed', code, detail);
  });
  socket.on('error', (err) => {
    console.warn('[ws] client error', err.message);
  });
  socket.on('message', (data) => {
    const message = data.toString();
    try {
      const parsed = JSON.parse(message) as {
        type?: string;
        role?: string;
        origin?: string;
        path?: string;
        appId?: string;
        controls?: RemoteControl[];
      };
      if (parsed?.type === 'hello' && parsed.role) {
        console.log('[ws] hello', remoteAddr, parsed.role, parsed.origin ?? '', parsed.path ?? '');
      }
      if (parsed?.type === 'mouse' || parsed?.type === 'keyboard') {
        console.log('[ws] input', remoteAddr, parsed.type);
      }
      if (parsed?.type === 'controls' && parsed.appId && Array.isArray(parsed.controls)) {
        controlSchemas.set(parsed.appId, {
          appId: parsed.appId,
          controls: parsed.controls,
          updatedAt: Date.now(),
        });
      }
    } catch {
      // ignore parse errors
      console.warn('[ws] message parse failed', message);
    }
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(message);
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`Guide server running on http://localhost:${PORT}`);
  void villageCapture.start();
  void weatherstarCapture.start();
  void swpcAuroraNorth.start();
  void swpcAuroraSouth.start();
  void swpcSwepam24h.start();
});

server.on('close', () => {
  clearInterval(heartbeatTimer);
});
