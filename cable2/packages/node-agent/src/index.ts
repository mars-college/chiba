import fs from "node:fs/promises";
import fsSync from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  NodeApplyRequestSchema,
  NodeApplyResponseSchema,
  NodeStatusReportSchema,
  type ApplyNodeIntent,
  type NodeApplyRequest,
  type NodeStatusReport,
} from "@chiba-cable2/contracts";

const port = Number(process.env.PORT ?? 8080);
const nodeId = (process.env.CHIBA_NODE_ID ?? os.hostname()).trim();
const nodeName = (process.env.CHIBA_NODE_NAME ?? nodeId).trim();
const platform = (process.env.CHIBA_NODE_PLATFORM ?? process.platform).trim();
const apiKey = (process.env.CHIBA_NODE_API_KEY ?? process.env.CHIBA_API_KEY ?? "").trim();
const controlPlaneUrl = (process.env.CHIBA_CONTROL_PLANE_URL ?? "").trim().replace(/\/$/, "");
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.resolve(moduleDir, "../package.json");
const deployMetaPath = process.env.CHIBA_DEPLOY_META ?? path.resolve(process.cwd(), ".chiba-deploy.json");
const localCablePort = Number(process.env.CHIBA_SERVER_PORT ?? process.env.PORT_CABLE ?? "8787");
const localGuidePort = Number(process.env.CHIBA_GUIDE_PORT ?? "5173");
const kioskUrlFilePath =
  process.env.CHIBA_KIOSK_URL_FILE ??
  path.resolve(process.cwd(), ".kiosk-url");
const kioskRestartSignalPath =
  process.env.CHIBA_KIOSK_RESTART_SIGNAL ??
  "/tmp/chiba-kiosk-restart";
const displayRotateFilePath =
  process.env.CHIBA_DISPLAY_ROTATE_FILE ??
  path.resolve(process.cwd(), ".display-rotate");
const rotateSignalPath =
  process.env.CHIBA_ROTATE_SIGNAL_FILE ??
  "/tmp/chiba-rotate-signal";
const heartbeatMsRaw = Number(process.env.CHIBA_NODE_HEARTBEAT_MS ?? "15000");
const heartbeatMs = Number.isFinite(heartbeatMsRaw) && heartbeatMsRaw >= 3000 ? Math.floor(heartbeatMsRaw) : 15000;
const cacheScanLimitRaw = Number(process.env.CHIBA_NODE_CACHE_SCAN_LIMIT ?? "2000");
const cacheScanLimit =
  Number.isFinite(cacheScanLimitRaw) && cacheScanLimitRaw > 0
    ? Math.floor(cacheScanLimitRaw)
    : 2000;
const stateFilePath =
  process.env.CHIBA_NODE_STATE_FILE ??
  path.resolve(process.cwd(), `cable2/data/node-agent-${nodeId}.json`);
const cacheDirPath =
  process.env.CHIBA_NODE_CACHE_DIR ??
  path.resolve(process.cwd(), `cable2/data/cache/${nodeId}`);

const capabilities = {
  supportsWindowManager: platform === "darwin" || platform === "linux",
  supportsRotation: platform === "linux",
  supportsHardwareMetrics: true,
  supportsNativeKioskRestart: platform === "linux",
};

type NodeRuntimeState = {
  version: 1;
  nodeId: string;
  updatedAt: number;
  lastAppliedAt: number | null;
  lastRequest: NodeApplyRequest | null;
  history: Array<{
    appliedAt: number;
    request: NodeApplyRequest;
  }>;
};

type CacheFileInfo = {
  relativePath: string;
  size: number;
  mtimeMs: number;
};

type RuntimeVersionInfo = {
  nodeAgentVersion: string | null;
  deployGitSha: string | null;
};

type LocalCableProbe = {
  reachable: boolean;
  status: number | null;
  version: string | null;
  gitSha: string | null;
  checkedAt: number;
};

type ResourceLookups = {
  byBlock: Map<string, string[]>;
  byPlaylist: Map<string, string[]>;
  byMedia: Map<string, string[]>;
};

const execFileAsync = promisify(execFile);

function readNodeAgentVersion(): string | null {
  try {
    const raw = fsSync.readFileSync(packageJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
      return parsed.version.trim();
    }
  } catch {
    // ignore
  }
  return null;
}

function readDeployGitSha(): string | null {
  try {
    if (!fsSync.existsSync(deployMetaPath)) return null;
    const raw = fsSync.readFileSync(deployMetaPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const direct = parsed.gitSha;
    if (typeof direct === "string" && direct.trim().length > 0) return direct.trim();
    const nested = (parsed.git as Record<string, unknown> | undefined)?.sha;
    if (typeof nested === "string" && nested.trim().length > 0) return nested.trim();
  } catch {
    // ignore
  }
  return null;
}

const runtimeVersionInfo: RuntimeVersionInfo = {
  nodeAgentVersion: readNodeAgentVersion(),
  deployGitSha: readDeployGitSha(),
};

let lookupCache: ResourceLookups | null = null;
let lookupCachePromise: Promise<ResourceLookups> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function truthyBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function readKioskUrl(): Promise<string | null> {
  try {
    const raw = await fs.readFile(kioskUrlFilePath, "utf-8");
    const normalized = raw.trim();
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

function defaultGuideUrl(): string {
  const base = new URL(`http://localhost:${localGuidePort}/`);
  base.searchParams.set("screenId", nodeName);
  base.searchParams.set("nosplash", "1");
  return base.toString();
}

async function writeKioskUrl(url: string): Promise<void> {
  await fs.mkdir(path.dirname(kioskUrlFilePath), { recursive: true });
  await fs.writeFile(kioskUrlFilePath, `${url}\n`, "utf-8");
}

async function readEffectiveKioskUrl(): Promise<string> {
  return (await readKioskUrl()) ?? defaultGuideUrl();
}

async function bestEffortPkill(pattern: string): Promise<void> {
  try {
    await execFileAsync("pkill", ["-f", pattern]);
  } catch {
    // ignore when no processes match
  }
}

async function restartKioskRuntime(): Promise<void> {
  try {
    await fs.writeFile(kioskRestartSignalPath, `${Date.now()}\n`, "utf-8");
  } catch {
    // ignore
  }
  await Promise.all([
    bestEffortPkill("chromium --kiosk"),
    bestEffortPkill("chromium-browser --kiosk"),
    bestEffortPkill("cage"),
  ]);
}

async function buildResourceLookups(): Promise<ResourceLookups> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  let payload: Record<string, unknown> | null = null;
  try {
    const response = await fetch(`http://127.0.0.1:${localCablePort}/api/catalog`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        byBlock: new Map<string, string[]>(),
        byPlaylist: new Map<string, string[]>(),
        byMedia: new Map<string, string[]>(),
      };
    }
    const text = await response.text();
    try {
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      payload = null;
    }
  } catch {
    return {
      byBlock: new Map<string, string[]>(),
      byPlaylist: new Map<string, string[]>(),
      byMedia: new Map<string, string[]>(),
    };
  } finally {
    clearTimeout(timer);
  }

  const catalog = (isRecord(payload?.catalog) ? payload?.catalog : null) as Record<string, unknown> | null;
  const channels = Array.isArray(catalog?.channels) ? catalog.channels : [];
  const blocks = Array.isArray(catalog?.blocks) ? catalog.blocks : [];
  const playlists = Array.isArray(catalog?.playlists) ? catalog.playlists : [];

  const blockById = new Map<string, Record<string, unknown>>();
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    const id = typeof block.id === "string" ? block.id.trim() : "";
    if (id) blockById.set(id, block);
  }

  const playlistById = new Map<string, Record<string, unknown>>();
  for (const playlist of playlists) {
    if (!isRecord(playlist)) continue;
    const id = typeof playlist.id === "string" ? playlist.id.trim() : "";
    if (id) playlistById.set(id, playlist);
  }

  const byBlock = new Map<string, Set<string>>();
  const byPlaylist = new Map<string, Set<string>>();
  const byMedia = new Map<string, Set<string>>();

  for (const channel of channels) {
    if (!isRecord(channel)) continue;
    const channelId = typeof channel.id === "string" ? channel.id.trim() : "";
    if (!channelId) continue;
    const channelBlocks = Array.isArray(channel.blocks)
      ? channel.blocks
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : [];
    for (const blockId of channelBlocks) {
      if (!byBlock.has(blockId)) byBlock.set(blockId, new Set<string>());
      byBlock.get(blockId)?.add(channelId);

      const block = blockById.get(blockId);
      const playlistId =
        block && typeof block.playlist === "string" && block.playlist.trim().length > 0
          ? block.playlist.trim()
          : "";
      if (!playlistId) continue;
      if (!byPlaylist.has(playlistId)) byPlaylist.set(playlistId, new Set<string>());
      byPlaylist.get(playlistId)?.add(channelId);

      const playlist = playlistById.get(playlistId);
      if (!playlist) continue;
      const playlistItems = Array.isArray(playlist.items) ? playlist.items : [];
      for (const item of playlistItems) {
        if (!isRecord(item)) continue;
        const mediaId =
          typeof item.media === "string" && item.media.trim().length > 0
            ? item.media.trim()
            : "";
        if (!mediaId) continue;
        if (!byMedia.has(mediaId)) byMedia.set(mediaId, new Set<string>());
        byMedia.get(mediaId)?.add(channelId);
      }
    }
  }

  const normalize = (input: Map<string, Set<string>>): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    for (const [key, value] of input.entries()) {
      out.set(key, Array.from(value).sort((a, b) => a.localeCompare(b)));
    }
    return out;
  };

  return {
    byBlock: normalize(byBlock),
    byPlaylist: normalize(byPlaylist),
    byMedia: normalize(byMedia),
  };
}

async function getResourceLookups(): Promise<ResourceLookups> {
  if (lookupCache) return lookupCache;
  if (!lookupCachePromise) {
    lookupCachePromise = buildResourceLookups()
      .then((lookups) => {
        lookupCache = lookups;
        return lookups;
      })
      .finally(() => {
        lookupCachePromise = null;
      });
  }
  return await lookupCachePromise;
}

function chooseFirst(values: string[] | undefined): string | null {
  if (!values || values.length === 0) return null;
  return values[0] ?? null;
}

function resolveProfileChannel(intent: ApplyNodeIntent): string | null {
  const params = intent.profileParams;
  if (!isRecord(params)) return null;
  const channel = params.channel;
  if (typeof channel === "string" && channel.trim().length > 0) {
    return channel.trim();
  }
  return null;
}

async function resolveChannelForIntent(intent: ApplyNodeIntent): Promise<string | null> {
  if (intent.channelId) return intent.channelId;
  if (intent.target.kind === "channel") return intent.target.id;

  if (intent.target.kind === "profile") {
    return resolveProfileChannel(intent);
  }

  const lookups = await getResourceLookups();

  if (intent.target.kind === "block") {
    return chooseFirst(lookups.byBlock.get(intent.blockId ?? intent.target.id));
  }
  if (intent.target.kind === "playlist") {
    return chooseFirst(lookups.byPlaylist.get(intent.playlistId ?? intent.target.id));
  }
  if (intent.target.kind === "media") {
    return chooseFirst(lookups.byMedia.get(intent.mediaId ?? intent.target.id));
  }
  return null;
}

async function buildKioskUrlForIntent(intent: ApplyNodeIntent): Promise<{
  url: string;
  warning?: string;
}> {
  const base = new URL(defaultGuideUrl());
  base.searchParams.set("nosplash", "1");
  let resolvedChannel = await resolveChannelForIntent(intent);
  let warning: string | undefined;
  const profileParams = isRecord(intent.profileParams) ? intent.profileParams : null;

  if (
    ["media", "playlist", "block"].includes(intent.target.kind) &&
    !resolvedChannel
  ) {
    warning = `no_channel_mapping_for_${intent.target.kind}:${intent.target.id}`;
  }

  if (intent.target.kind === "profile" && profileParams) {
    const modeRaw = profileParams.mode;
    const mode =
      typeof modeRaw === "string" && (modeRaw === "gallery" || modeRaw === "guide")
        ? modeRaw
        : null;
    if (mode === "gallery") base.searchParams.set("gallery", "1");

    const lockValue = truthyBoolean(profileParams.lock);
    if (lockValue === true) base.searchParams.set("lock", "1");
    if (mode === "gallery" && lockValue === false) base.searchParams.set("lock", "0");

    const qrValue = truthyBoolean(profileParams.qr);
    if (qrValue === true) base.searchParams.set("qr", "1");
    if (qrValue === false) base.searchParams.set("qr", "0");

    const playlistValue = truthyBoolean(profileParams.playlist);
    if (playlistValue === true) base.searchParams.set("playlist", "1");

    const nosplashValue = truthyBoolean(profileParams.nosplash);
    if (nosplashValue === true) base.searchParams.set("nosplash", "1");
    if (nosplashValue === false) {
      base.searchParams.delete("nosplash");
      base.searchParams.set("splash", "1");
    }

    const theme = profileParams.theme;
    if (typeof theme === "string" && theme.trim().length > 0) {
      base.searchParams.set("theme", theme.trim());
    }

    const scale = coerceFiniteNumber(profileParams.scale);
    if (scale !== null) base.searchParams.set("scale", String(scale));
    const textScale = coerceFiniteNumber(profileParams.text_scale);
    if (textScale !== null) base.searchParams.set("textScale", String(textScale));
    const hours = coerceFiniteNumber(profileParams.hours);
    if (hours !== null) base.searchParams.set("hours", String(hours));
  } else if (
    intent.target.kind === "channel" ||
    intent.target.kind === "block" ||
    intent.target.kind === "playlist" ||
    intent.target.kind === "media"
  ) {
    base.searchParams.set("gallery", "1");
    base.searchParams.set("lock", "1");
    if (intent.target.kind === "playlist" || intent.target.kind === "media") {
      base.searchParams.set("playlist", "1");
    }
  }

  if (resolvedChannel) {
    base.searchParams.set("channel", resolvedChannel);
  }

  if (warning) {
    return { url: base.toString(), warning };
  }
  return { url: base.toString() };
}

async function applyIntentToDisplay(intent: ApplyNodeIntent): Promise<{
  url: string;
  warning?: string;
}> {
  const resolved = await buildKioskUrlForIntent(intent);
  await writeKioskUrl(resolved.url);
  await restartKioskRuntime();
  return resolved;
}

async function probeLocalCableVersion(timeoutMs = 1200): Promise<LocalCableProbe> {
  const checkedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${localCablePort}/api/version`, {
      signal: controller.signal,
    });
    const status = response.status;
    const text = await response.text();
    let payload: Record<string, unknown> | null = null;
    try {
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      payload = null;
    }

    const version =
      typeof payload?.version === "string" && payload.version.trim().length > 0
        ? payload.version.trim()
        : null;
    const gitSha =
      typeof payload?.gitSha === "string" && payload.gitSha.trim().length > 0
        ? payload.gitSha.trim()
        : typeof (payload?.git as Record<string, unknown> | undefined)?.sha === "string" &&
            ((payload?.git as Record<string, unknown>).sha as string).trim().length > 0
          ? (((payload?.git as Record<string, unknown>).sha as string).trim())
          : null;

    return {
      reachable: response.ok,
      status,
      version,
      gitSha,
      checkedAt,
    };
  } catch {
    return {
      reachable: false,
      status: null,
      version: null,
      gitSha: null,
      checkedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function loadState(): Promise<NodeRuntimeState> {
  try {
    const raw = await fs.readFile(stateFilePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<NodeRuntimeState>;
    if (
      parsed.version === 1 &&
      parsed.nodeId === nodeId &&
      Array.isArray(parsed.history)
    ) {
      return {
        version: 1,
        nodeId,
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
        lastAppliedAt: typeof parsed.lastAppliedAt === "number" ? parsed.lastAppliedAt : null,
        lastRequest: (parsed.lastRequest as NodeApplyRequest | null) ?? null,
        history: parsed.history as Array<{ appliedAt: number; request: NodeApplyRequest }>,
      };
    }
  } catch {
    // ignore
  }

  return {
    version: 1,
    nodeId,
    updatedAt: Date.now(),
    lastAppliedAt: null,
    lastRequest: null,
    history: [],
  };
}

async function saveState(state: NodeRuntimeState): Promise<void> {
  await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
  const tmp = `${stateFilePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
  await fs.rename(tmp, stateFilePath);
}

async function readJsonBody<T>(req: http.IncomingMessage): Promise<T | null> {
  return await new Promise<T | null>((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 2_000_000) {
        resolve(null);
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function isAuthenticated(req: http.IncomingMessage): boolean {
  if (!apiKey) return true;

  const headerKey = req.headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey === apiKey) return true;

  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length) === apiKey;
  }

  return false;
}

async function walkCacheDir(rootDir: string, scanLimit: number): Promise<CacheFileInfo[]> {
  const out: CacheFileInfo[] = [];
  const queue: string[] = [rootDir];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = await fs.stat(fullPath);
        out.push({
          relativePath: path.relative(rootDir, fullPath),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        // ignore unstable files
      }
      if (out.length >= scanLimit) return out;
    }
  }
  return out;
}

async function readCacheState(): Promise<{
  dir: string;
  files: CacheFileInfo[];
  bytes: number;
  fileCount: number;
  truncated: boolean;
}> {
  await fs.mkdir(cacheDirPath, { recursive: true });
  const files = await walkCacheDir(cacheDirPath, cacheScanLimit);
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  return {
    dir: cacheDirPath,
    files: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    bytes,
    fileCount: files.length,
    truncated: files.length >= cacheScanLimit,
  };
}

async function pruneCache(maxBytes: number): Promise<{
  bytesBefore: number;
  bytesAfter: number;
  removedFiles: number;
}> {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new Error("invalid_max_bytes");
  }

  const state = await readCacheState();
  const byAge = [...state.files].sort((a, b) => a.mtimeMs - b.mtimeMs);
  let bytes = state.bytes;
  let removedFiles = 0;

  for (const file of byAge) {
    if (bytes <= maxBytes) break;
    const fullPath = path.join(cacheDirPath, file.relativePath);
    try {
      await fs.unlink(fullPath);
      bytes -= file.size;
      removedFiles += 1;
    } catch {
      // ignore failures; continue pruning best-effort
    }
  }

  return {
    bytesBefore: state.bytes,
    bytesAfter: Math.max(0, bytes),
    removedFiles,
  };
}

function buildNodeStatusReport(args: {
  state: NodeRuntimeState;
  cache: { dir: string; bytes: number; fileCount: number };
  cable: LocalCableProbe;
  kioskUrl: string | null;
}): NodeStatusReport {
  const memory = process.memoryUsage();
  return NodeStatusReportSchema.parse({
    nodeId,
    nodeName,
    platform,
    hostname: os.hostname(),
    seenAt: Date.now(),
    capabilities,
    process: {
      pid: process.pid,
      uptimeSec: Math.floor(process.uptime()),
      memory: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers,
      },
    },
    apply: {
      lastAppliedAt: args.state.lastAppliedAt,
    },
    cache: {
      dir: args.cache.dir,
      bytes: args.cache.bytes,
      fileCount: args.cache.fileCount,
    },
    runtime: {
      nodeAgentVersion: runtimeVersionInfo.nodeAgentVersion,
      deployGitSha: runtimeVersionInfo.deployGitSha,
      cableVersion: args.cable.version,
      cableGitSha: args.cable.gitSha,
      cableReachable: args.cable.reachable,
      cableStatus: args.cable.status,
      cableCheckedAt: args.cable.checkedAt,
      kioskUrl: args.kioskUrl,
    },
  });
}

async function sendHeartbeat(): Promise<void> {
  if (!controlPlaneUrl) return;
  try {
    const [state, cache, kioskUrl] = await Promise.all([
      loadState(),
      readCacheState(),
      readEffectiveKioskUrl(),
    ]);
    const cable = await probeLocalCableVersion();
    const report = buildNodeStatusReport({
      state,
      cache: {
        dir: cache.dir,
        bytes: cache.bytes,
        fileCount: cache.fileCount,
      },
      cable,
      kioskUrl,
    });

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (apiKey) headers["x-api-key"] = apiKey;

    await fetch(`${controlPlaneUrl}/api/node-status`, {
      method: "POST",
      headers,
      body: JSON.stringify(report),
    });
  } catch (error) {
    console.warn(`node-agent heartbeat failed: ${(error as Error).message}`);
  }
}

function readPrimaryIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (!entry || entry.internal) continue;
      if (entry.family === "IPv4" && entry.address) return entry.address;
    }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { ok: false, error: "missing_url" });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const method = req.method ?? "GET";

  if (url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "node-agent",
      ts: Date.now(),
      nodeId,
      stateFilePath,
      cacheDirPath,
      controlPlaneConfigured: Boolean(controlPlaneUrl),
    });
    return;
  }

  if (url.pathname === "/status") {
    const [state, cache, kioskUrl] = await Promise.all([
      loadState(),
      readCacheState(),
      readEffectiveKioskUrl(),
    ]);
    const cable = await probeLocalCableVersion();
    const ip = readPrimaryIp();
    sendJson(res, 200, {
      ok: true,
      node: {
        id: nodeId,
        name: nodeName,
        version: runtimeVersionInfo.nodeAgentVersion,
        gitSha: runtimeVersionInfo.deployGitSha,
        ip,
        kioskUrl,
        platform,
        hostname: os.hostname(),
        uptimeSec: Math.floor(process.uptime()),
        capabilities,
      },
      apply: {
        lastAppliedAt: state.lastAppliedAt,
      },
      cache: {
        dir: cache.dir,
        bytes: cache.bytes,
        fileCount: cache.fileCount,
        truncated: cache.truncated,
      },
      process: {
        pid: process.pid,
        memory: process.memoryUsage(),
      },
      cableServer: {
        reachable: cable.reachable,
        status: cable.status,
        version: cable.version,
        gitSha: cable.gitSha,
        checkedAt: cable.checkedAt,
      },
    });
    return;
  }

  if (method === "GET" && url.pathname === "/kiosk-url") {
    const kioskUrl = await readEffectiveKioskUrl();
    sendJson(res, 200, { ok: true, nodeId, kioskUrl });
    return;
  }

  if (method === "POST" && url.pathname === "/kiosk-url") {
    if (!isAuthenticated(req)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const body = await readJsonBody<Record<string, unknown>>(req);
    const kioskUrl = typeof body?.url === "string" ? body.url.trim() : "";
    if (!kioskUrl) {
      sendJson(res, 400, { ok: false, error: "missing_url" });
      return;
    }
    try {
      await writeKioskUrl(kioskUrl);
      await restartKioskRuntime();
      void sendHeartbeat();
      sendJson(res, 200, { ok: true, nodeId, kioskUrl });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: (error as Error).message });
    }
    return;
  }

  if (method === "POST" && url.pathname === "/rotate") {
    if (!isAuthenticated(req)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const body = await readJsonBody<Record<string, unknown>>(req);
    const rotation = Number(body?.rotation ?? Number.NaN);
    if (![0, 90, 180, 270].includes(rotation)) {
      sendJson(res, 400, { ok: false, error: "invalid_rotation" });
      return;
    }
    try {
      await fs.writeFile(displayRotateFilePath, `${rotation}\n`, "utf-8");
      await fs.writeFile(rotateSignalPath, `${rotation}\n`, "utf-8");
      // Rotation usually requires kiosk restart to be visible across all runtimes.
      await restartKioskRuntime();
      sendJson(res, 200, { ok: true, nodeId, rotation });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: (error as Error).message });
    }
    return;
  }

  if (method === "GET" && url.pathname === "/api/state") {
    const state = await loadState();
    sendJson(res, 200, {
      ok: true,
      nodeId,
      state,
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/cache") {
    const cache = await readCacheState();
    sendJson(res, 200, {
      ok: true,
      nodeId,
      cache,
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/cache/prune") {
    if (!isAuthenticated(req)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }

    const body = await readJsonBody<Record<string, unknown>>(req);
    if (!body) {
      sendJson(res, 400, { ok: false, error: "invalid_json" });
      return;
    }

    const maxBytes = Number(body.maxBytes ?? Number.NaN);
    try {
      const result = await pruneCache(maxBytes);
      sendJson(res, 200, {
        ok: true,
        nodeId,
        ...result,
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: (error as Error).message });
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/apply") {
    if (!isAuthenticated(req)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }

    const body = await readJsonBody<Record<string, unknown>>(req);
    if (!body) {
      sendJson(res, 400, { ok: false, error: "invalid_json" });
      return;
    }

    try {
      const request = NodeApplyRequestSchema.parse(body);
      const now = Date.now();
      const state = await loadState();
      state.lastAppliedAt = now;
      state.updatedAt = now;
      state.lastRequest = request;
      state.history.unshift({ appliedAt: now, request });
      if (state.history.length > 200) {
        state.history = state.history.slice(0, 200);
      }
      await saveState(state);
      let warning: string | undefined;
      try {
        const resolved = await applyIntentToDisplay(request.intent);
        warning = resolved.warning;
      } catch (error) {
        warning = `display_apply_failed:${(error as Error).message}`;
      }

      const response = NodeApplyResponseSchema.parse({
        ok: true,
        nodeId,
        appliedAt: now,
        target: request.intent.target,
        warning,
      });

      sendJson(res, 200, response);
      void sendHeartbeat();
    } catch (error) {
      sendJson(res, 400, { ok: false, error: (error as Error).message });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: "not_found" });
});

let heartbeatInterval: NodeJS.Timeout | null = null;

server.listen(port, () => {
  console.log(`cable2 node-agent (${nodeName}) listening on http://localhost:${port}`);
  if (controlPlaneUrl) {
    console.log(`node-agent heartbeat -> ${controlPlaneUrl}/api/node-status (${heartbeatMs}ms)`);
    void sendHeartbeat();
    heartbeatInterval = setInterval(() => {
      void sendHeartbeat();
    }, heartbeatMs);
  }
});

function shutdown(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
