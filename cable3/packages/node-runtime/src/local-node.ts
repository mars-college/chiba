import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import http, { type ServerResponse } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, type ChildProcess } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";
import {
  NodeRuntimeInputRequestSchema,
  NodeRuntimeInputResponseSchema,
} from "@chiba-cable3/contracts";
import type {
  DesiredTarget,
  LaunchOptions,
  NodeRuntimeInputAction,
  NodeRuntimeInputRequest,
  NodeRuntimeInputResponse,
  NodeRuntimePlayback,
  NodeRuntimeReportV1,
  RuntimePhase,
} from "@chiba-cable3/contracts";

type ResolvedPlaybackItem = {
  itemId: string;
  mediaId: string;
  sourceType: "path" | "url";
  sourceValue: string;
  cache: boolean;
  durationSec?: number;
  title?: string;
  artist?: string;
  description?: string;
  renderer: "mpv" | "web";
};

type ResolveResponse = {
  ok: boolean;
  screenId: string;
  namespace: string;
  desired: {
    revision: number;
    target: DesiredTarget;
    launch: LaunchOptions;
  } | null;
  resolved: {
    items: ResolvedPlaybackItem[];
    warnings: string[];
    cache: { total: number; cacheable: number };
    renderers: { mpv: number; web: number };
  };
};

type CacheSummary = {
  dir: string;
  files: Array<{ name: string; size: number; mtimeMs: number }>;
  bytes: number;
  fileCount: number;
};

type RuntimeState = {
  desiredRevision: number | null;
  activeRevision: number | null;
  phase: RuntimePhase;
  currentTarget: DesiredTarget | null;
  launch: LaunchOptions;
  kioskUrl: string;
  updatedAt: number;
  backend: NodeRuntimeReportV1["backend"];
  cacheReady: number;
  cacheTotal: number;
  currentItemId: string | null;
  cacheBytes: number;
  cacheFileCount: number;
  lastWarnings: string[];
  lastError: string | null;
  playback: NodeRuntimePlayback | null;
};

type ActivePlaybackMeta = {
  itemId: string;
  mediaId: string;
  title?: string;
  artist?: string;
  description?: string;
};

const MEDIA_URL_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
  ".avi",
  ".mp3",
  ".wav",
  ".flac",
  ".aac",
  ".m4a",
  ".ogg",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".avif",
  ".tif",
  ".tiff",
]);

function readArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  const next = process.argv[idx + 1];
  return next && !next.startsWith("-") ? next : undefined;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parsePositive(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function toNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function parseMpvMaxHeight(value: string | undefined, fallback: number | null): number | null {
  if (typeof value !== "string") return fallback;
  const raw = value.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "0" || raw === "off" || raw === "none") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function normalizeGuideBaseUrl(value: string | undefined, guidePort: number): string {
  const raw = value?.trim();
  if (raw) {
    try {
      const parsed = new URL(raw);
      parsed.search = "";
      parsed.hash = "";
      const text = parsed.toString();
      return text.endsWith("/") ? text.slice(0, -1) : text;
    } catch {
      // fall through to localhost default
    }
  }
  return `http://localhost:${guidePort}`;
}

function toLog(level: "info" | "warn" | "error", event: string, data: Record<string, unknown>): void {
  const payload = {
    ts: Date.now(),
    level,
    event,
    ...data,
  };
  if (level === "error") {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(payload));
    return;
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
}

function buildKioskUrl(args: {
  guideBaseUrl: string;
  nodeId: string;
  target: DesiredTarget | null;
  launch: LaunchOptions;
}): string {
  const params = new URLSearchParams();
  params.set("screenId", args.nodeId);
  if (args.target) {
    params.set("targetKind", args.target.kind);
    params.set("targetId", args.target.id);
  }
  if (args.launch.mode) params.set("mode", args.launch.mode);
  if (typeof args.launch.nosplash === "boolean") {
    params.set("nosplash", args.launch.nosplash ? "1" : "0");
  }
  if (typeof args.launch.lock === "boolean") {
    params.set("lock", args.launch.lock ? "1" : "0");
  }
  if (typeof args.launch.qr === "boolean") {
    params.set("qr", args.launch.qr ? "1" : "0");
  }
  if (args.launch.theme) params.set("theme", args.launch.theme);
  if (typeof args.launch.displayRotate === "number") {
    params.set("displayRotate", String(args.launch.displayRotate));
  }
  if (args.launch.hudMode) params.set("hud", args.launch.hudMode);
  if (typeof args.launch.hudSec === "number") {
    params.set("hudSec", String(args.launch.hudSec));
  }
  const url = new URL(args.guideBaseUrl);
  url.search = params.toString();
  return url.toString();
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

function hashKey(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function sourceExt(sourceValue: string): string {
  const raw = sourceValue.trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return path.extname(parsed.pathname || "").toLowerCase();
  } catch {
    return path.extname(raw).toLowerCase();
  }
}

function isLikelyMediaUrl(sourceValue: string): boolean {
  const ext = sourceExt(sourceValue);
  if (ext && MEDIA_URL_EXTENSIONS.has(ext)) return true;
  const lower = sourceValue.toLowerCase();
  if (lower.startsWith("data:image/") || lower.startsWith("data:video/")) return true;
  return false;
}

async function readCacheSummary(cacheDir: string): Promise<CacheSummary> {
  await ensureDir(cacheDir);
  const entries = await fs.readdir(cacheDir, { withFileTypes: true });
  const files: CacheSummary["files"] = [];
  let bytes = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(cacheDir, entry.name);
    try {
      const stat = await fs.stat(filePath);
      bytes += stat.size;
      files.push({
        name: entry.name,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    } catch {
      // best-effort listing
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return {
    dir: cacheDir,
    files,
    bytes,
    fileCount: files.length,
  };
}

async function clearCacheFiles(cacheDir: string): Promise<{
  deletedFiles: number;
  deletedBytes: number;
}> {
  await ensureDir(cacheDir);
  const entries = await fs.readdir(cacheDir, { withFileTypes: true });
  let deletedFiles = 0;
  let deletedBytes = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(cacheDir, entry.name);
    try {
      const stat = await fs.stat(filePath);
      await fs.unlink(filePath);
      deletedFiles += 1;
      deletedBytes += stat.size;
    } catch {
      // best-effort clear
    }
  }
  return { deletedFiles, deletedBytes };
}

async function copyFileCached(args: {
  sourcePath: string;
  destPath: string;
}): Promise<void> {
  const sourceStat = await fs.stat(args.sourcePath);
  try {
    const destStat = await fs.stat(args.destPath);
    if (destStat.size === sourceStat.size) {
      return;
    }
  } catch {
    // destination missing
  }

  const tempPath = `${args.destPath}.tmp-${Date.now()}`;
  await fs.copyFile(args.sourcePath, tempPath);
  await fs.rename(tempPath, args.destPath);
}

async function downloadFileCached(args: {
  url: string;
  destPath: string;
}): Promise<void> {
  try {
    const existing = await fs.stat(args.destPath);
    if (existing.size > 0) return;
  } catch {
    // destination missing
  }

  const response = await fetch(args.url);
  if (!response.ok || !response.body) {
    throw new Error(`download_failed:${response.status}`);
  }
  const tempPath = `${args.destPath}.tmp-${Date.now()}`;
  const write = createWriteStream(tempPath, { flags: "w" });
  const body = Readable.fromWeb(response.body as never);
  await pipeline(body, write);
  await fs.rename(tempPath, args.destPath);
}

function chooseChromiumBinary(explicit: string | null): string {
  if (explicit && explicit.trim()) return explicit.trim();
  if (process.platform === "darwin") return "open";
  return "chromium";
}

async function terminateChild(child: ChildProcess | null, name: string): Promise<void> {
  if (!child || child.killed || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    }),
    sleep(1_500).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }),
  ]);
  toLog("info", "child_stopped", { name });
}

async function runInputCommand(args: {
  binary: string;
  action: NodeRuntimeInputAction;
}): Promise<{
  command: string[];
  code: number;
  stdout: string;
  stderr: string;
}> {
  const command: string[] = [];
  if (args.action.kind === "key") {
    command.push("key", "--delay", "0");
    if (args.action.repeat && args.action.repeat > 1) {
      command.push("--repeat", String(args.action.repeat));
    }
    command.push(args.action.key);
  } else if (args.action.kind === "text") {
    command.push("type", "--delay", "0", args.action.text);
  } else if (args.action.kind === "mouse_move") {
    command.push("mousemove", String(args.action.x), String(args.action.y));
  } else {
    const button =
      args.action.button === "left"
        ? "1"
        : args.action.button === "middle"
          ? "2"
          : "3";
    command.push("click");
    if (args.action.repeat && args.action.repeat > 1) {
      command.push("--repeat", String(args.action.repeat));
    }
    command.push(button);
  }

  const child = spawn(args.binary, command, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout?.on("data", (chunk) =>
    stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  );
  child.stderr?.on("data", (chunk) =>
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  );

  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => resolve(exitCode ?? 0));
  });

  return {
    command: [args.binary, ...command],
    code,
    stdout: Buffer.concat(stdoutChunks).toString("utf8").trim(),
    stderr: Buffer.concat(stderrChunks).toString("utf8").trim(),
  };
}

async function waitForWebReady(args: {
  url: string;
  timeoutMs: number;
  pollMs: number;
}): Promise<{
  ready: boolean;
  status: number | null;
  elapsedMs: number;
  error?: string;
}> {
  const startedAt = Date.now();
  const timeoutMs = Math.max(0, args.timeoutMs);
  const pollMs = Math.max(20, args.pollMs);
  const deadline = startedAt + timeoutMs;
  let lastStatus: number | null = null;
  let lastError: string | undefined;

  while (Date.now() <= deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const res = await fetch(args.url, {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal,
      });
      lastStatus = res.status;
      if (res.ok) {
        return {
          ready: true,
          status: res.status,
          elapsedMs: Date.now() - startedAt,
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }
    if (Date.now() >= deadline) break;
    await sleep(Math.min(pollMs, Math.max(20, deadline - Date.now())));
  }

  return {
    ready: false,
    status: lastStatus,
    elapsedMs: Date.now() - startedAt,
    ...(lastError ? { error: lastError } : {}),
  };
}

async function waitForSpawn(child: ChildProcess, name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onSpawn = () => {
      child.off("error", onError);
      resolve();
    };
    const onError = (error: Error) => {
      child.off("spawn", onSpawn);
      reject(new Error(`${name}_spawn_failed:${error.message}`));
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

async function queryMpvPlayback(args: {
  ipcPath: string;
  timeoutMs: number;
}): Promise<{
  path: string | null;
  positionSec: number | null;
  durationSec: number | null;
  progressPercent: number | null;
  paused: boolean | null;
} | null> {
  return await new Promise((resolve) => {
    const expected = new Map<number, string>([
      [1, "path"],
      [2, "time-pos"],
      [3, "duration"],
      [4, "percent-pos"],
      [5, "pause"],
    ]);
    const values: Record<string, unknown> = {};
    let buffer = "";
    let settled = false;

    const finish = (result: {
      path: string | null;
      positionSec: number | null;
      durationSec: number | null;
      progressPercent: number | null;
      paused: boolean | null;
    } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), Math.max(100, args.timeoutMs));
    const socket = net.createConnection(args.ipcPath);

    socket.once("error", () => finish(null));
    socket.once("connect", () => {
      for (const [requestId, prop] of expected) {
        const cmd = JSON.stringify({
          command: ["get_property", prop],
          request_id: requestId,
        });
        socket.write(`${cmd}\n`);
      }
    });
    socket.on("data", (chunk) => {
      buffer += String(chunk);
      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx < 0) break;
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let payload: unknown;
        try {
          payload = JSON.parse(line);
        } catch {
          continue;
        }
        if (!payload || typeof payload !== "object") continue;
        const entry = payload as Record<string, unknown>;
        const requestId = Number(entry.request_id);
        if (!Number.isFinite(requestId)) continue;
        const prop = expected.get(requestId);
        if (!prop) continue;
        values[prop] = entry.error === "success" ? entry.data : null;
        expected.delete(requestId);
        if (expected.size > 0) continue;

        const pathValue = typeof values.path === "string" ? values.path : null;
        const positionSec = toNonNegativeNumber(values["time-pos"]);
        const durationSec = toNonNegativeNumber(values.duration);
        const rawPercent = toNonNegativeNumber(values["percent-pos"]);
        const progressPercent =
          rawPercent !== null
            ? Math.max(0, Math.min(100, rawPercent))
            : durationSec && durationSec > 0 && positionSec !== null
              ? Math.max(0, Math.min(100, (positionSec / durationSec) * 100))
              : null;
        const paused =
          typeof values.pause === "boolean"
            ? values.pause
            : values.pause === null
              ? null
              : null;
        finish({
          path: pathValue,
          positionSec,
          durationSec,
          progressPercent,
          paused,
        });
      }
    });
  });
}

function normalizeMpvSourceValue(value: string): string {
  const raw = value.trim();
  if (!raw) return raw;
  if (!raw.startsWith("file://")) return raw;
  try {
    return decodeURIComponent(new URL(raw).pathname);
  } catch {
    return raw;
  }
}

function sourcesLikelyMatch(a: string, b: string): boolean {
  const left = normalizeMpvSourceValue(a);
  const right = normalizeMpvSourceValue(b);
  if (left === right) return true;
  const leftLooksUrl = left.includes("://");
  const rightLooksUrl = right.includes("://");
  if (leftLooksUrl || rightLooksUrl) return false;
  return path.basename(left) === path.basename(right);
}

async function waitForMpvReady(args: {
  ipcPath: string;
  expectedSource: string | null;
  timeoutMs: number;
  pollMs: number;
}): Promise<{
  ready: boolean;
  observedSource: string | null;
  elapsedMs: number;
}> {
  const startedAt = Date.now();
  const timeoutMs = Math.max(0, args.timeoutMs);
  const pollMs = Math.max(20, args.pollMs);
  const deadline = startedAt + timeoutMs;
  let observedSource: string | null = null;

  while (Date.now() <= deadline) {
    const remaining = Math.max(80, deadline - Date.now());
    const probe = await queryMpvPlayback({
      ipcPath: args.ipcPath,
      timeoutMs: Math.min(250, remaining),
    });
    const source = probe?.path ?? null;
    if (source) {
      observedSource = source;
      if (!args.expectedSource || sourcesLikelyMatch(source, args.expectedSource)) {
        return {
          ready: true,
          observedSource,
          elapsedMs: Date.now() - startedAt,
        };
      }
    }
    if (Date.now() >= deadline) break;
    await sleep(Math.min(pollMs, Math.max(20, deadline - Date.now())));
  }

  return {
    ready: false,
    observedSource,
    elapsedMs: Date.now() - startedAt,
  };
}

async function spawnMpv(args: {
  binary: string;
  playlistFile: string | null;
  singleSource: string | null;
  imageDurationSec: number;
  hwdec: string;
  framedrop: string;
  maxHeight: number | null;
  ipcPath: string;
}): Promise<ChildProcess> {
  const baseArgs = [
    "--no-config",
    "--fs",
    "--force-window=yes",
    "--idle=no",
    "--keep-open=no",
    "--image-display-duration=" + String(args.imageDurationSec),
    "--really-quiet",
    "--hwdec=" + args.hwdec,
    "--framedrop=" + args.framedrop,
    "--vd-lavc-threads=2",
    "--input-ipc-server=" + args.ipcPath,
  ];
  if (typeof args.maxHeight === "number" && args.maxHeight > 0) {
    baseArgs.push(`--vf=scale=-2:${args.maxHeight}`);
  }
  if (args.singleSource) {
    baseArgs.push("--loop-file=inf");
    baseArgs.push(args.singleSource);
  } else if (args.playlistFile) {
    baseArgs.push("--loop-playlist=inf");
    baseArgs.push("--playlist=" + args.playlistFile);
  }

  const child = spawn(args.binary, baseArgs, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => {
    const line = String(chunk).trim();
    if (line) toLog("info", "mpv_stdout", { line });
  });
  child.stderr?.on("data", (chunk) => {
    const line = String(chunk).trim();
    if (line) toLog("warn", "mpv_stderr", { line });
  });
  child.once("exit", (code, signal) => {
    toLog("warn", "mpv_exit", { code, signal });
  });
  await waitForSpawn(child, "mpv");
  return child;
}

async function spawnChromium(args: {
  binary: string;
  url: string;
  explicitBinary: string | null;
}): Promise<ChildProcess> {
  if (process.platform === "darwin" && !args.explicitBinary) {
    const child = spawn(args.binary, ["-a", "Google Chrome", "--args", "--kiosk", args.url], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr?.on("data", (chunk) => {
      const line = String(chunk).trim();
      if (line) toLog("warn", "chromium_stderr", { line });
    });
    child.once("exit", (code, signal) => {
      toLog("warn", "chromium_exit", { code, signal });
    });
    await waitForSpawn(child, "chromium");
    return child;
  }

  const child = spawn(args.binary, ["--kiosk", "--start-fullscreen", args.url], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk) => {
    const line = String(chunk).trim();
    if (line) toLog("warn", "chromium_stderr", { line });
  });
  child.once("exit", (code, signal) => {
    toLog("warn", "chromium_exit", { code, signal });
  });
  await waitForSpawn(child, "chromium");
  return child;
}

async function postRuntimeReport(args: {
  apiBase: string;
  report: NodeRuntimeReportV1;
}): Promise<void> {
  const url = new URL(`/api/v1/nodes/${encodeURIComponent(args.report.nodeId)}/runtime-report`, args.apiBase);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args.report),
  });
  if (!res.ok) {
    throw new Error(`runtime_report_failed:${res.status}`);
  }
}

async function fetchResolved(args: {
  apiBase: string;
  nodeId: string;
  namespace: string;
}): Promise<ResolveResponse> {
  const url = new URL(
    `/api/v1/runtime/resolve/${encodeURIComponent(args.nodeId)}`,
    args.apiBase
  );
  url.searchParams.set("namespace", args.namespace);
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`resolve_fetch_failed:${res.status}`);
  }
  const payload = (await res.json()) as ResolveResponse;
  if (!payload.ok) {
    throw new Error("resolve_payload_not_ok");
  }
  return payload;
}

async function buildCachedSources(args: {
  items: ResolvedPlaybackItem[];
  cacheDir: string;
  onProgress: (progress: { ready: number; total: number; currentItemId: string | null }) => Promise<void>;
}): Promise<Array<{ source: string; item: ResolvedPlaybackItem }>> {
  await ensureDir(args.cacheDir);
  const mediaItems = args.items.filter((item) => item.renderer === "mpv");
  const total = mediaItems.filter((item) => item.cache).length;
  let ready = 0;
  const out: Array<{ source: string; item: ResolvedPlaybackItem }> = [];

  for (const item of mediaItems) {
    if (!item.cache) {
      out.push({ source: item.sourceValue, item });
      continue;
    }

    const ext = sourceExt(item.sourceValue);
    const cacheName = `${hashKey(`${item.mediaId}:${item.sourceValue}`)}${ext || ".bin"}`;
    const cachePath = path.join(args.cacheDir, cacheName);
    if (item.sourceType === "path") {
      await copyFileCached({
        sourcePath: item.sourceValue,
        destPath: cachePath,
      });
    } else {
      await downloadFileCached({
        url: item.sourceValue,
        destPath: cachePath,
      });
    }
    out.push({ source: cachePath, item });
    ready += 1;
    await args.onProgress({
      ready,
      total,
      currentItemId: item.itemId,
    });
  }

  return out;
}

function createNodeApiServer(args: {
  nodeId: string;
  state: RuntimeState;
  cacheDir: string;
  getCacheSummary: () => Promise<CacheSummary>;
  inputBinary: string;
  allowInputAnyPlatform: boolean;
}): http.Server {
  return http.createServer((req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");

    if (method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "cable3-node-runtime",
        ts: Date.now(),
        nodeId: args.nodeId,
      });
      return;
    }

    if (method === "GET" && url.pathname === "/status") {
      sendJson(res, 200, {
        ok: true,
        node: {
          id: args.nodeId,
          name: args.nodeId,
          version: "0.0.0",
          gitSha: null,
          ip: "127.0.0.1",
          platform: process.platform,
          hostname: os.hostname(),
          kioskUrl: args.state.kioskUrl,
          capabilities: {
            supportsWindowManager: true,
            supportsRotation: true,
            supportsHardwareMetrics: true,
            supportsNativeKioskRestart: false,
          },
        },
        runtime: {
          phase: args.state.phase,
          desiredRevision: args.state.desiredRevision,
          activeRevision: args.state.activeRevision,
          backend: args.state.backend,
          currentTarget: args.state.currentTarget,
          cacheReady: args.state.cacheReady,
          cacheTotal: args.state.cacheTotal,
          currentItemId: args.state.currentItemId,
          warnings: args.state.lastWarnings,
          error: args.state.lastError,
          playback: args.state.playback,
        },
        apply: {
          lastAppliedAt: args.state.updatedAt,
        },
        cache: {
          dir: args.cacheDir,
          bytes: args.state.cacheBytes,
          fileCount: args.state.cacheFileCount,
          truncated: false,
        },
        process: {
          pid: process.pid,
          memory: process.memoryUsage(),
        },
      });
      return;
    }

    if (method === "GET" && url.pathname === "/kiosk-url") {
      sendJson(res, 200, {
        ok: true,
        nodeId: args.nodeId,
        kioskUrl: args.state.kioskUrl,
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, {
        ok: true,
        nodeId: args.nodeId,
        state: {
          version: 1,
          nodeId: args.nodeId,
          updatedAt: args.state.updatedAt,
          lastAppliedAt: args.state.updatedAt,
          lastRequest: null,
          history: [],
        },
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/cache") {
      args
        .getCacheSummary()
        .then((summary) => {
          sendJson(res, 200, {
            ok: true,
            nodeId: args.nodeId,
            cache: summary,
          });
        })
        .catch((error) => {
          sendJson(res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return;
    }

    if (method === "DELETE" && url.pathname === "/api/cache") {
      (async () => {
        const before = await args.getCacheSummary();
        const cleared = await clearCacheFiles(args.cacheDir);
        const after = await args.getCacheSummary();
        sendJson(res, 200, {
          ok: true,
          nodeId: args.nodeId,
          deletedFiles: cleared.deletedFiles,
          deletedBytes: cleared.deletedBytes,
          before,
          after,
        });
      })().catch((error) => {
        sendJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }

    if (method === "POST" && url.pathname === "/api/input") {
      (async () => {
        if (process.platform !== "linux" && !args.allowInputAnyPlatform) {
          sendJson(res, 501, {
            ok: false,
            error: "input_passthrough_unsupported_platform",
            detail: process.platform,
          });
          return;
        }
        if (args.state.backend !== "chromium") {
          sendJson(res, 409, {
            ok: false,
            error: "input_passthrough_requires_chromium_backend",
            detail: args.state.backend,
          });
          return;
        }
        let payloadRaw: unknown = {};
        try {
          payloadRaw = await readJsonBody(req);
        } catch {
          sendJson(res, 400, { ok: false, error: "invalid_json_body" });
          return;
        }
        const parsed = NodeRuntimeInputRequestSchema.safeParse(payloadRaw);
        if (!parsed.success) {
          sendJson(res, 400, {
            ok: false,
            error: "invalid_input_payload",
            issues: parsed.error.issues,
          });
          return;
        }
        const payload: NodeRuntimeInputRequest = parsed.data;
        const exec = await runInputCommand({
          binary: args.inputBinary,
          action: payload.action,
        });
        if (exec.code !== 0) {
          sendJson(res, 500, {
            ok: false,
            error: "input_passthrough_command_failed",
            command: exec.command,
            code: exec.code,
            stdout: exec.stdout,
            stderr: exec.stderr,
          });
          return;
        }
        const body: NodeRuntimeInputResponse = NodeRuntimeInputResponseSchema.parse({
          ok: true,
          nodeId: args.nodeId,
          backend: args.state.backend,
          action: payload.action,
          command: exec.command,
          code: exec.code,
          ...(exec.stdout ? { stdout: exec.stdout } : {}),
          ...(exec.stderr ? { stderr: exec.stderr } : {}),
        });
        sendJson(res, 200, body);
      })().catch((error) => {
        sendJson(res, 500, {
          ok: false,
          error: "input_passthrough_failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }

    sendJson(res, 404, { ok: false, error: "not_found" });
  });
}

function createServerApiServer(args: { nodeId: string }): http.Server {
  return http.createServer((req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");
    if (method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (method === "GET" && url.pathname === "/api/version") {
      sendJson(res, 200, {
        app: "cable3-local-server",
        version: "0.0.0",
        gitSha: null,
        git: { sha: null },
        deployedAt: new Date().toISOString(),
        nodeId: args.nodeId,
      });
      return;
    }
    sendJson(res, 404, { ok: false, error: "not_found" });
  });
}

async function main(): Promise<void> {
  const apiBase =
    readArg("--api") ??
    process.env.CHIBA3_CONTROL_API_URL ??
    "http://127.0.0.1:8795";
  const nodeId = readArg("--node-id") ?? process.env.CHIBA3_NODE_ID ?? "commander";
  const namespace = readArg("--namespace") ?? process.env.CHIBA3_NAMESPACE ?? "local";

  const pollMs = parsePort(readArg("--poll-ms") ?? process.env.CHIBA3_NODE_POLL_MS, 1_000);
  const warmDelayMs = parsePort(readArg("--warm-ms") ?? process.env.CHIBA3_NODE_WARM_MS, 50);
  const activateDelayMs = parsePort(
    readArg("--activate-ms") ?? process.env.CHIBA3_NODE_ACTIVATE_MS,
    50
  );
  const switchOverlapMs = parseNonNegativeInt(
    readArg("--switch-overlap-ms") ?? process.env.CHIBA3_SWITCH_OVERLAP_MS,
    700
  );
  const switchReadyTimeoutMs = parseNonNegativeInt(
    readArg("--switch-ready-timeout-ms") ?? process.env.CHIBA3_SWITCH_READY_TIMEOUT_MS,
    4_000
  );
  const webReadyTimeoutMs = parseNonNegativeInt(
    readArg("--web-ready-timeout-ms") ?? process.env.CHIBA3_WEB_READY_TIMEOUT_MS,
    5_000
  );
  const webReadyPollMs = parseNonNegativeInt(
    readArg("--web-ready-poll-ms") ?? process.env.CHIBA3_WEB_READY_POLL_MS,
    200
  );
  const imageDurationSec = parsePositive(
    readArg("--image-sec") ?? process.env.CHIBA3_IMAGE_DURATION_SEC,
    15
  );

  const nodePort = parsePort(readArg("--node-port") ?? process.env.CHIBA3_NODE_PORT, 8080);
  const serverPort = parsePort(
    readArg("--server-port") ?? process.env.CHIBA3_SERVER_PORT,
    8787
  );
  const guidePort = parsePort(readArg("--guide-port") ?? process.env.CHIBA3_GUIDE_PORT, 5173);
  const guideBaseUrl = normalizeGuideBaseUrl(
    readArg("--guide-base-url") ?? process.env.CHIBA3_GUIDE_BASE_URL,
    guidePort
  );

  const cacheDir =
    readArg("--cache-dir") ??
    process.env.CHIBA3_CACHE_DIR ??
    path.join("/tmp/chiba-cable3-cache", nodeId);
  const runtimeDir =
    readArg("--runtime-dir") ??
    process.env.CHIBA3_RUNTIME_DIR ??
    path.join("/tmp/chiba-cable3-runtime", nodeId);

  const mpvBin = readArg("--mpv-bin") ?? process.env.CHIBA3_MPV_BIN ?? "mpv";
  const mpvHwdec = readArg("--mpv-hwdec") ?? process.env.CHIBA3_MPV_HWDEC ?? "auto-safe";
  const mpvFramedrop =
    readArg("--mpv-framedrop") ?? process.env.CHIBA3_MPV_FRAMEDROP ?? "decoder+vo";
  const defaultMpvMaxHeight =
    process.platform === "linux" && (process.arch === "arm" || process.arch === "arm64")
      ? 1080
      : null;
  const mpvMaxHeight = parseMpvMaxHeight(
    readArg("--mpv-max-height") ?? process.env.CHIBA3_MPV_MAX_HEIGHT,
    defaultMpvMaxHeight
  );
  const chromiumExplicit = readArg("--chromium-bin") ?? process.env.CHIBA3_CHROMIUM_BIN ?? null;
  const chromiumBin = chooseChromiumBinary(chromiumExplicit);
  const inputBinary = readArg("--input-bin") ?? process.env.CHIBA3_INPUT_BIN ?? "xdotool";
  const allowInputAnyPlatform =
    readArg("--allow-input-any-platform") === "1" ||
    process.env.CHIBA3_INPUT_ALLOW_ANY_PLATFORM === "1";

  await ensureDir(cacheDir);
  await ensureDir(runtimeDir);

  const runtimeState: RuntimeState = {
    desiredRevision: null,
    activeRevision: null,
    phase: "idle",
    currentTarget: null,
    launch: {},
    kioskUrl: buildKioskUrl({
      guideBaseUrl,
      nodeId,
      target: null,
      launch: {},
    }),
    updatedAt: Date.now(),
    backend: "unknown",
    cacheReady: 0,
    cacheTotal: 0,
    currentItemId: null,
    cacheBytes: 0,
    cacheFileCount: 0,
    lastWarnings: [],
    lastError: null,
    playback: null,
  };

  let mpvChild: ChildProcess | null = null;
  let chromiumChild: ChildProcess | null = null;
  const mpvIpcPath = path.join(runtimeDir, "mpv.sock");
  let playbackMetaBySource = new Map<string, ActivePlaybackMeta>();

  const refreshCacheSummary = async () => {
    const summary = await readCacheSummary(cacheDir);
    runtimeState.cacheBytes = summary.bytes;
    runtimeState.cacheFileCount = summary.fileCount;
    return summary;
  };

  const emitRuntime = async (patch: Partial<NodeRuntimeReportV1>) => {
    runtimeState.updatedAt = Date.now();
    const report: NodeRuntimeReportV1 = {
      nodeId,
      namespace,
      desiredRevision: runtimeState.desiredRevision,
      activeRevision: runtimeState.activeRevision,
      phase: runtimeState.phase,
      backend: runtimeState.backend,
      updatedAt: runtimeState.updatedAt,
      currentTarget: runtimeState.currentTarget ?? undefined,
      currentItemId: runtimeState.currentItemId ?? undefined,
      cacheReady: runtimeState.cacheReady,
      cacheTotal: runtimeState.cacheTotal,
      errorCode: runtimeState.lastError ? "runtime_error" : undefined,
      errorMessage: runtimeState.lastError ?? undefined,
      ...patch,
    };
    await postRuntimeReport({ apiBase, report });
  };

  const nodeApi = createNodeApiServer({
    nodeId,
    state: runtimeState,
    cacheDir,
    getCacheSummary: refreshCacheSummary,
    inputBinary,
    allowInputAnyPlatform,
  });
  const serverApi = createServerApiServer({ nodeId });

  await new Promise<void>((resolve, reject) => {
    nodeApi.once("error", reject);
    nodeApi.listen(nodePort, "0.0.0.0", () => resolve());
  });
  await new Promise<void>((resolve, reject) => {
    serverApi.once("error", reject);
    serverApi.listen(serverPort, "0.0.0.0", () => resolve());
  });

  toLog("info", "runtime_started", {
    apiBase,
    nodeId,
    namespace,
    nodePort,
    serverPort,
    guidePort,
    guideBaseUrl,
    cacheDir,
    runtimeDir,
    mpvBin,
    mpvHwdec,
    mpvFramedrop,
    mpvMaxHeight,
    switchOverlapMs,
    webReadyTimeoutMs,
    webReadyPollMs,
    chromiumBin,
    inputBinary,
    allowInputAnyPlatform,
  });

  let stopped = false;
  const shutdown = async () => {
    if (stopped) return;
    stopped = true;
    await terminateChild(mpvChild, "mpv");
    await terminateChild(chromiumChild, "chromium");
    nodeApi.close();
    serverApi.close();
  };

  process.on("SIGINT", () => {
    shutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    shutdown().finally(() => process.exit(0));
  });

  while (!stopped) {
    try {
      const resolved = await fetchResolved({ apiBase, nodeId, namespace });
      runtimeState.lastWarnings = resolved.resolved.warnings;
      runtimeState.lastError = null;
      runtimeState.launch = resolved.desired?.launch ?? {};
      runtimeState.currentTarget = resolved.desired?.target ?? null;
      runtimeState.desiredRevision = resolved.desired?.revision ?? null;
      runtimeState.kioskUrl = buildKioskUrl({
        guideBaseUrl,
        nodeId,
        target: runtimeState.currentTarget,
        launch: runtimeState.launch,
      });

      if (!resolved.desired || !runtimeState.currentTarget) {
        runtimeState.phase = "idle";
        runtimeState.activeRevision = null;
        runtimeState.backend = "unknown";
        runtimeState.cacheReady = 0;
        runtimeState.cacheTotal = 0;
        runtimeState.currentItemId = null;
        runtimeState.playback = null;
        playbackMetaBySource = new Map();
        await terminateChild(mpvChild, "mpv");
        mpvChild = null;
        await terminateChild(chromiumChild, "chromium");
        chromiumChild = null;
        await refreshCacheSummary();
        await emitRuntime({});
        await sleep(pollMs);
        continue;
      }

      if (runtimeState.activeRevision !== runtimeState.desiredRevision) {
        runtimeState.phase = "warming";
        runtimeState.cacheReady = 0;
        runtimeState.cacheTotal = resolved.resolved.cache.cacheable;
        runtimeState.currentItemId = null;
        await emitRuntime({
          phase: "warming",
          desiredRevision: runtimeState.desiredRevision,
          activeRevision: runtimeState.activeRevision,
        });

        const useGuideChromium =
          runtimeState.launch.mode === "guide" || resolved.resolved.items.length === 0;
        const hasWebOnlyItems =
          resolved.resolved.items.length > 0 &&
          resolved.resolved.items.every((item) => item.renderer === "web");
        const wantsChromium = useGuideChromium || hasWebOnlyItems;
        const previousMpv: ChildProcess | null = mpvChild;
        const previousChromium: ChildProcess | null = chromiumChild;

        if (wantsChromium) {
          const chromiumUrl = useGuideChromium
            ? runtimeState.kioskUrl
            : resolved.resolved.items[0]?.sourceValue ?? runtimeState.kioskUrl;
          const webReady = await waitForWebReady({
            url: chromiumUrl,
            timeoutMs: webReadyTimeoutMs,
            pollMs: webReadyPollMs,
          });
          toLog("info", "web_switch_ready", {
            ready: webReady.ready,
            elapsedMs: webReady.elapsedMs,
            status: webReady.status,
            url: chromiumUrl,
            ...(webReady.error ? { error: webReady.error } : {}),
          });
          if (previousMpv && !previousChromium) {
            // Keep prior fullscreen visible briefly while Chromium maps to avoid desktop flashes.
            chromiumChild = await spawnChromium({
              binary: chromiumBin,
              url: chromiumUrl,
              explicitBinary: chromiumExplicit,
            });
            if (!webReady.ready && switchOverlapMs > 0) await sleep(switchOverlapMs);
            await terminateChild(previousMpv, "mpv");
            if (mpvChild === previousMpv) mpvChild = null;
          } else {
            await terminateChild(previousMpv, "mpv");
            mpvChild = null;
            await terminateChild(previousChromium, "chromium");
            chromiumChild = null;
            chromiumChild = await spawnChromium({
              binary: chromiumBin,
              url: chromiumUrl,
              explicitBinary: chromiumExplicit,
            });
          }
          runtimeState.backend = "chromium";
          runtimeState.phase = "ready";
          runtimeState.playback = null;
          playbackMetaBySource = new Map();
          await emitRuntime({
            phase: "ready",
            desiredRevision: runtimeState.desiredRevision,
          });
          if (activateDelayMs > 0) await sleep(activateDelayMs);
        } else {
          const playableEntries = await buildCachedSources({
            items: resolved.resolved.items,
            cacheDir,
            onProgress: async ({ ready, total, currentItemId }) => {
              runtimeState.cacheReady = ready;
              runtimeState.cacheTotal = total;
              runtimeState.currentItemId = currentItemId;
              await emitRuntime({
                phase: "warming",
                cacheReady: ready,
                cacheTotal: total,
                currentItemId: currentItemId ?? undefined,
              });
            },
          });
          const playableSources = playableEntries.map((row) => row.source);
          playbackMetaBySource = new Map(
            playableEntries.map((row) => [
              row.source,
              {
                itemId: row.item.itemId,
                mediaId: row.item.mediaId,
                ...(row.item.title ? { title: row.item.title } : {}),
                ...(row.item.artist ? { artist: row.item.artist } : {}),
                ...(row.item.description ? { description: row.item.description } : {}),
              } as ActivePlaybackMeta,
            ])
          );

          const playlistFile = path.join(runtimeDir, "current.m3u8");
          if (playableSources.length > 1) {
            await fs.writeFile(playlistFile, playableSources.map((line) => `${line}\n`).join(""), "utf8");
          }

          const single =
            playableSources.length === 1 ? (playableSources[0] ?? null) : null;
          const expectedSource = single ?? playableSources[0] ?? null;
          await fs.rm(mpvIpcPath, { force: true }).catch(() => undefined);
          // Start new mpv first; keep prior fullscreen backend alive during handover.
          const nextMpv = await spawnMpv({
            binary: mpvBin,
            playlistFile: playableSources.length > 1 ? playlistFile : null,
            singleSource: single,
            imageDurationSec,
            hwdec: mpvHwdec,
            framedrop: mpvFramedrop,
            maxHeight: mpvMaxHeight,
            ipcPath: mpvIpcPath,
          });
          mpvChild = nextMpv;
          const ready = await waitForMpvReady({
            ipcPath: mpvIpcPath,
            expectedSource,
            timeoutMs: switchReadyTimeoutMs,
            pollMs: 90,
          });
          toLog("info", "mpv_switch_ready", {
            ready: ready.ready,
            elapsedMs: ready.elapsedMs,
            expectedSource,
            observedSource: ready.observedSource,
          });
          if (!ready.ready && switchOverlapMs > 0) await sleep(switchOverlapMs);
          if (previousMpv && previousMpv !== nextMpv) {
            await terminateChild(previousMpv, "mpv");
            if (mpvChild === previousMpv) mpvChild = null;
          }
          if (previousChromium) {
            await terminateChild(previousChromium, "chromium");
            if (chromiumChild === previousChromium) chromiumChild = null;
          }
          runtimeState.backend = "mpv";
          runtimeState.phase = "ready";
          runtimeState.currentItemId = playableEntries[0]?.item.itemId ?? null;
          runtimeState.playback = {
            state: "unknown",
            ...(playableEntries[0]?.item.itemId
              ? { itemId: playableEntries[0].item.itemId }
              : {}),
            ...(playableEntries[0]?.item.mediaId
              ? { mediaId: playableEntries[0].item.mediaId }
              : {}),
            ...(playableEntries[0]?.item.title
              ? { title: playableEntries[0].item.title }
              : {}),
            ...(playableEntries[0]?.item.artist
              ? { artist: playableEntries[0].item.artist }
              : {}),
            ...(playableEntries[0]?.item.description
              ? { description: playableEntries[0].item.description }
              : {}),
            updatedAt: Date.now(),
          };
          await emitRuntime({
            phase: "ready",
            cacheReady: runtimeState.cacheReady,
            cacheTotal: runtimeState.cacheTotal,
            currentItemId: runtimeState.currentItemId ?? undefined,
          });
          if (warmDelayMs > 0) await sleep(warmDelayMs);
          if (activateDelayMs > 0) await sleep(activateDelayMs);
        }

        runtimeState.activeRevision = runtimeState.desiredRevision;
      }

      if (
        runtimeState.backend === "mpv" &&
        mpvChild &&
        !mpvChild.killed &&
        mpvChild.exitCode === null
      ) {
        const playback = await queryMpvPlayback({
          ipcPath: mpvIpcPath,
          timeoutMs: 300,
        });
        if (playback) {
          const byPath = playback.path ? playbackMetaBySource.get(playback.path) : undefined;
          if (byPath?.itemId) runtimeState.currentItemId = byPath.itemId;
          runtimeState.playback = {
            state:
              playback.paused === true
                ? "paused"
                : playback.path || playback.positionSec !== null
                  ? "playing"
                  : "unknown",
            ...(playback.path ? { path: playback.path } : {}),
            ...(playback.positionSec !== null
              ? { positionSec: playback.positionSec }
              : {}),
            ...(playback.durationSec !== null
              ? { durationSec: playback.durationSec }
              : {}),
            ...(playback.progressPercent !== null
              ? { progressPercent: playback.progressPercent }
              : {}),
            ...(byPath?.itemId ? { itemId: byPath.itemId } : {}),
            ...(byPath?.mediaId ? { mediaId: byPath.mediaId } : {}),
            ...(byPath?.title ? { title: byPath.title } : {}),
            ...(byPath?.artist ? { artist: byPath.artist } : {}),
            ...(byPath?.description ? { description: byPath.description } : {}),
            updatedAt: Date.now(),
          };
        } else if (runtimeState.playback) {
          runtimeState.playback = {
            ...runtimeState.playback,
            state: "unknown",
            updatedAt: Date.now(),
          };
        }
      } else {
        runtimeState.playback = null;
      }

      runtimeState.phase = "active";
      await refreshCacheSummary();
      await emitRuntime({
        phase: "active",
        activeRevision: runtimeState.activeRevision,
      });
    } catch (error) {
      runtimeState.phase = "degraded";
      runtimeState.lastError =
        error instanceof Error ? error.message : String(error);
      try {
        await emitRuntime({
          phase: "degraded",
          errorCode: "runtime_loop_error",
          errorMessage: runtimeState.lastError,
        });
      } catch {
        // best effort
      }
      toLog("error", "runtime_loop_error", {
        error: runtimeState.lastError,
      });
    }
    await sleep(pollMs);
  }
}

main().catch((error) => {
  toLog("error", "runtime_fatal", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
