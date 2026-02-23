import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import process from "node:process";
import type { ServerResponse } from "node:http";
import Fastify, { type FastifyReply } from "fastify";
import { lookup as lookupMimeType } from "mime-types";
import { WebSocketServer, type WebSocket } from "ws";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  ApplyScreenAssignmentRequestSchema,
  ApplyScreenAssignmentResponseSchema,
  LaunchOptionsSchema,
  NodeRuntimeReportV1Schema,
  NodeInventoryWriteSchema,
  IngestYouTubeRequestSchema,
  IngestEdenCollectionRequestSchema,
  IngestUploadMetadataSchema,
  ResourceImportPayloadSchema,
  ResourceSnapshotSchema,
  type ResourceSnapshot,
  type DesiredTarget,
  type LaunchOptions,
  type MediaResource,
  type ScreenCondition,
  ScreenAssignmentStatusResponseSchema,
  ScreenConditionTypeSchema,
  NodeRuntimeCacheInspectResponseSchema,
  NodeRuntimeCacheClearResponseSchema,
  NodeRuntimeStatusSnapshotSchema,
  OpsNodeCacheInspectResponseSchema,
  OpsNodeCacheClearResponseSchema,
  OpsNodeRuntimeStatusResponseSchema,
  NodeRuntimeInputRequestSchema,
  NodeRuntimeInputResponseSchema,
  OpsNodeInputResponseSchema,
} from "@chiba-cable3/contracts";
import {
  applyScreenAssignment,
  createDb,
  createDbPool,
  getDesiredScreenState,
  getNodeRuntimeReport,
  listNodeConnectivity,
  listRegistryNodes,
  getResourceSnapshot,
  deleteMediaResource,
  importResources,
  listDesiredScreenStates,
  schema,
  upsertNodeConnectivity,
  upsertRegistryNode,
  deleteRegistryNode,
  upsertNodeRuntimeReport,
} from "@chiba-cable3/db";
import {
  createIngestJobQueue,
  enqueueEdenCollectionIngest,
  enqueueUploadIngest,
  enqueueYouTubeIngest,
} from "./ingest/queue.js";
import {
  ingestEdenCollection,
  ingestUploadedFiles,
  ingestYouTube,
  readMultipartUploadFromRequest,
  readThumbnail,
} from "./ingest/runtime.js";
import { normalizeOpsApplyLaunch } from "./launch-policy.js";
import { buildConnectivitySummary, toRegistryToml } from "./nodes-utils.js";

declare module "fastify" {
  interface FastifyReply {
    json(payload: unknown): FastifyReply;
    setHeader(name: string, value: string): FastifyReply;
  }
}

type WaitCondition =
  | "Accepted"
  | "ManifestResolved"
  | "Warming"
  | "Ready"
  | "Activated"
  | "Degraded"
  | "Error";

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

const IMAGE_URL_EXTENSIONS = new Set([
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

const GUIDE_LOCAL_ROUTE_PREFIXES = [
  "/weatherstar",
  "/home-assistant",
  "/roadmap",
  "/ambient/",
  "/swpc/",
  "/embed/",
  "/village",
  "/mars",
];

const DEFAULT_EMBED_URLS: Record<string, string> = {
  "ai-village": "https://theaidigest.org/village",
  "ai-village-2": "https://theaidigest.org/village",
  "mars-public-access":
    "https://vdo.ninja/?view=QQA3g6X316&room=Mars_Public_Access_Network&pw=marscollege&scene&api=1",
};

const DEFAULT_WEATHERSTAR_LOCATION =
  process.env.CHIBA3_WEATHERSTAR_LOCATION?.trim() ||
  process.env.CHIBA_WEATHERSTAR_LOCATION?.trim() ||
  "Niland, CA, USA";
const DEFAULT_WEATHERSTAR_LAT = Number(
  process.env.CHIBA3_WEATHERSTAR_LAT ??
    process.env.CHIBA_WEATHERSTAR_LAT ??
    "33.2400366"
);
const DEFAULT_WEATHERSTAR_LON = Number(
  process.env.CHIBA3_WEATHERSTAR_LON ??
    process.env.CHIBA_WEATHERSTAR_LON ??
    "-115.5188756"
);

function buildWeatherstarKioskUrl(args: {
  locationQuery: string;
  lat: number;
  lon: number;
}): string {
  const params = new URLSearchParams();
  params.set("hazards-checkbox", "true");
  params.set("current-weather-checkbox", "true");
  params.set("latest-observations-checkbox", "true");
  params.set("hourly-checkbox", "true");
  params.set("hourly-graph-checkbox", "true");
  params.set("travel-checkbox", "true");
  params.set("regional-forecast-checkbox", "true");
  params.set("local-forecast-checkbox", "true");
  params.set("extended-forecast-checkbox", "true");
  params.set("almanac-checkbox", "true");
  params.set("spc-outlook-checkbox", "true");
  params.set("radar-checkbox", "true");
  params.set("settings-wide-checkbox", "true");
  params.set("settings-kiosk-checkbox", "true");
  params.set("settings-scanLines-checkbox", "false");
  params.set("settings-speed-select", "1.00");
  params.set("settings-units-select", "us");
  params.set("settings-mediaPlaying-boolean", "true");
  params.set("latLonQuery", args.locationQuery);
  params.set("latLon", JSON.stringify({ lat: args.lat, lon: args.lon }));
  params.set("kiosk", "true");
  return `https://weatherstar.netbymatt.com/?${params.toString()}`;
}

const DEFAULT_WEATHERSTAR_URL =
  process.env.CHIBA3_WEATHERSTAR_URL?.trim() ||
  process.env.CHIBA_WEATHERSTAR_URL?.trim() ||
  buildWeatherstarKioskUrl({
    locationQuery: DEFAULT_WEATHERSTAR_LOCATION,
    lat: Number.isFinite(DEFAULT_WEATHERSTAR_LAT) ? DEFAULT_WEATHERSTAR_LAT : 33.2400366,
    lon: Number.isFinite(DEFAULT_WEATHERSTAR_LON) ? DEFAULT_WEATHERSTAR_LON : -115.5188756,
  });

const DEFAULT_HOME_ASSISTANT_URL =
  process.env.CHIBA3_HOME_ASSISTANT_URL?.trim() ||
  process.env.CHIBA_HOME_ASSISTANT_URL?.trim() ||
  "http://100.128.3.217:8123/";

const GUIDE_SLOT_MINUTES = 30;
const GUIDE_SLOT_COUNT = 6;
const QR_BASE =
  "https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=";

function mediaContentTypeForPath(filePath: string): string {
  const guessed = lookupMimeType(filePath);
  return typeof guessed === "string" && guessed ? guessed : "application/octet-stream";
}

const DEFAULT_NAMESPACE = process.env.CHIBA3_NAMESPACE?.trim() || "local";
const DEFAULT_REGISTRY_ID =
  process.env.CHIBA3_REGISTRY_ID?.trim() || DEFAULT_NAMESPACE;
const DEFAULT_GUIDE_BASE_URL =
  normalizeGuideBaseUrl(process.env.CHIBA3_GUIDE_BASE_URL) ??
  normalizeGuideBaseUrl(process.env.CHIBA_GUIDE_BASE_URL) ??
  null;

const OpsApplyTargetSchema = z.enum([
  "profile",
  "channel",
  "block",
  "playlist",
  "media",
]);

const OpsApplyTargetRequestSchema = z
  .object({
    target: OpsApplyTargetSchema,
    id: z.string().min(1),
    piIds: z.array(z.string().min(1)).default([]),
    dryRun: z.boolean().optional(),
    mode: z.enum(["guide", "gallery"]).optional(),
    lock: z.boolean().optional(),
    showQr: z.boolean().optional(),
    qr: z.boolean().optional(),
    nosplash: z.boolean().optional(),
    hudMode: z.enum(["always", "start", "never"]).optional(),
    hudShowSec: z.number().positive().optional(),
    theme: z.string().min(1).optional(),
    displayRotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
    namespace: z.string().min(1).optional(),
    registryId: z.string().min(1).optional(),
    controllerId: z.string().min(1).optional(),
  })
  .passthrough();

const OpsOpenGuideRequestSchema = z
  .object({
    piIds: z.array(z.string().min(1)).default([]),
    dryRun: z.boolean().optional(),
    lock: z.boolean().optional(),
    showQr: z.boolean().optional(),
    qr: z.boolean().optional(),
    nosplash: z.boolean().optional(),
    namespace: z.string().min(1).optional(),
    registryId: z.string().min(1).optional(),
    controllerId: z.string().min(1).optional(),
  })
  .passthrough();

function sanitizeLaunch(input: unknown): LaunchOptions {
  const parsed = LaunchOptionsSchema.safeParse(input);
  return parsed.success ? parsed.data : {};
}

function mergeLaunch(...inputs: Array<unknown>): LaunchOptions {
  const merged = Object.assign({}, ...inputs);
  return sanitizeLaunch(merged);
}

type RequestLike = {
  body?: unknown;
  query?: unknown;
  params?: unknown;
};

function pickField(req: RequestLike, key: string): unknown {
  const bodyField =
    req.body && typeof req.body === "object" && req.body !== null
      ? (req.body as Record<string, unknown>)[key]
      : undefined;
  if (typeof bodyField === "string") return bodyField;
  const queryField =
    req.query && typeof req.query === "object" && req.query !== null
      ? (req.query as Record<string, unknown>)[key]
      : undefined;
  return queryField;
}

function paramsOf(req: RequestLike): Record<string, unknown> {
  if (req.params && typeof req.params === "object") {
    return req.params as Record<string, unknown>;
  }
  return {};
}

function queryOf(req: RequestLike): Record<string, unknown> {
  if (req.query && typeof req.query === "object") {
    return req.query as Record<string, unknown>;
  }
  return {};
}

function bodyOf(req: RequestLike): Record<string, unknown> {
  if (req.body && typeof req.body === "object") {
    return req.body as Record<string, unknown>;
  }
  return {};
}

function readNamespace(req: RequestLike): string {
  const field = pickField(req, "namespace");
  const value = (typeof field === "string" ? field : "").trim();
  return value || DEFAULT_NAMESPACE;
}

function readRegistryId(req: RequestLike, namespace: string): string {
  const field = pickField(req, "registryId");
  const value = (typeof field === "string" ? field : "").trim();
  return value || namespace || DEFAULT_REGISTRY_ID;
}

function targetExistsInSnapshot(args: {
  snapshot: ResourceSnapshot;
  target: "media" | "playlist" | "block" | "channel";
  id: string;
}): boolean {
  if (args.target === "media") {
    return args.snapshot.media.some((row) => row.id === args.id);
  }
  if (args.target === "playlist") {
    return args.snapshot.playlists.some((row) => row.id === args.id);
  }
  if (args.target === "block") {
    return args.snapshot.blocks.some((row) => row.id === args.id);
  }
  return args.snapshot.channels.some((row) => row.id === args.id);
}

function looksLikeImageSource(value: string): boolean {
  const ext = getSourceExt(value);
  return ext.length > 0 && IMAGE_URL_EXTENSIONS.has(ext);
}

function mediaStreamVersion(media: MediaResource): string {
  let seed = `${media.sourceType}:${media.sourceValue}`;
  if (media.sourceType === "path") {
    try {
      const stat = fs.statSync(path.normalize(media.sourceValue));
      seed = `${seed}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
    } catch {
      // keep base seed when file metadata is unavailable
    }
  }
  return createHash("sha1").update(seed).digest("hex").slice(0, 12);
}

function buildMediaStreamUrl(args: {
  streamBaseUrl: string;
  media: MediaResource;
}): string {
  const version = mediaStreamVersion(args.media);
  return `${args.streamBaseUrl}/api/v1/resources/media/${encodeURIComponent(args.media.id)}/stream?v=${version}`;
}

function buildFallbackPreviewDataUrl(args: {
  title: string;
  subtitle?: string;
}): string {
  const safeTitle = args.title.trim() || "Web Content";
  const safeSubtitle = (args.subtitle ?? "").trim() || "preview unavailable";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0b1f49"/><stop offset="100%" stop-color="#123268"/></linearGradient></defs><rect width="1280" height="720" rx="28" fill="url(#bg)"/><rect x="44" y="44" width="1192" height="632" rx="22" fill="#061126" stroke="#2d61aa" stroke-opacity=".6"/><text x="84" y="338" fill="#dce9ff" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="66" font-weight="700">${safeTitle}</text><text x="84" y="402" fill="#8eb2e7" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="34">${safeSubtitle}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function channelCallSign(args: { id: string; name?: string | null | undefined }): string {
  const name = (args.name ?? "").trim();
  if (!name) return args.id.slice(0, 4).toUpperCase();
  const fromWords = name
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .join("")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  if (fromWords.length > 0) return fromWords.slice(0, 4);
  return name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || args.id.slice(0, 4).toUpperCase();
}

function pickFallbackTarget(snapshot: ResourceSnapshot): DesiredTarget | null {
  const firstChannel = snapshot.channels[0];
  if (firstChannel) {
    return { kind: "channel", id: firstChannel.id };
  }
  const firstBlock = snapshot.blocks[0];
  if (firstBlock) {
    return { kind: "block", id: firstBlock.id };
  }
  const firstPlaylist = snapshot.playlists[0];
  if (firstPlaylist) {
    return { kind: "playlist", id: firstPlaylist.id };
  }
  const firstMedia = snapshot.media[0];
  if (firstMedia) {
    return { kind: "media", id: firstMedia.id };
  }
  return null;
}

function toOpsNodeRecord(row: typeof schema.registryNodes.$inferSelect): Record<string, unknown> {
  return {
    registryId: row.registryId,
    nodeId: row.nodeId,
    host: row.host ?? undefined,
    ip: row.ip ?? undefined,
    nodeName: row.nodeName ?? undefined,
    orientation: row.orientation ?? undefined,
    displayRotate: row.displayRotate ?? undefined,
    guidePort: row.guidePort ?? undefined,
    nodePort: row.nodePort ?? undefined,
    serverPort: row.serverPort ?? undefined,
    apiKey: row.apiKey ?? undefined,
    importedAt: row.importedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildKioskUrl(args: {
  screenId: string;
  guidePort: number;
  target: DesiredTarget;
  launch: LaunchOptions;
}): string {
  const params = new URLSearchParams();
  params.set("screenId", args.screenId);
  params.set("targetKind", args.target.kind);
  params.set("targetId", args.target.id);
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
  return `http://localhost:${args.guidePort}/?${params.toString()}`;
}

function getSourceExt(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const pathname = parsed.pathname || "";
    const idx = pathname.lastIndexOf(".");
    if (idx < 0) return "";
    return pathname.slice(idx).toLowerCase();
  } catch {
    const idx = raw.lastIndexOf(".");
    if (idx < 0) return "";
    return raw.slice(idx).toLowerCase();
  }
}

function isMediaSource(media: MediaResource): boolean {
  if (media.sourceType === "path") return true;
  const ext = getSourceExt(media.sourceValue);
  if (ext && MEDIA_URL_EXTENSIONS.has(ext)) return true;
  const lower = media.sourceValue.toLowerCase();
  if (lower.startsWith("data:image/") || lower.startsWith("data:video/")) return true;
  return false;
}

function readPublicApiBaseUrl(req: { headers?: Record<string, unknown> }): string {
  const headers = req.headers ?? {};
  const forwardedHostRaw = String(headers["x-forwarded-host"] ?? "").trim();
  const forwardedProtoRaw = String(headers["x-forwarded-proto"] ?? "").trim();
  const hostHeaderRaw = String(headers.host ?? "").trim();

  const host = (forwardedHostRaw || hostHeaderRaw || `127.0.0.1:${process.env.PORT ?? "8795"}`)
    .split(",")[0]
    ?.trim();
  const proto = (forwardedProtoRaw || "http").split(",")[0]?.trim() || "http";
  return `${proto}://${host}`;
}

function repairMissingScheme(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.replace(/^([a-z][a-z0-9+.-]*)\/\//i, "$1://");
}

function normalizeGuideBaseUrl(raw: string | null | undefined): string | null {
  const repaired = repairMissingScheme(String(raw ?? ""));
  if (!repaired) return null;
  try {
    const parsed = new URL(repaired);
    parsed.search = "";
    parsed.hash = "";
    const out = parsed.toString();
    return out.endsWith("/") ? out.slice(0, -1) : out;
  } catch {
    return null;
  }
}

function isGuideLocalPath(pathname: string): boolean {
  return GUIDE_LOCAL_ROUTE_PREFIXES.some((prefix) =>
    pathname === prefix || pathname.startsWith(prefix)
  );
}

function normalizeGuideProgramUrl(args: {
  sourceValue: string;
  mode: "index" | "runtime";
  guideBaseUrl?: string | null;
}): string {
  const raw = repairMissingScheme(args.sourceValue);
  if (!raw) return "";

  if (raw.startsWith("/")) {
    if (args.mode === "runtime" && args.guideBaseUrl) {
      try {
        return new URL(raw, args.guideBaseUrl).toString();
      } catch {
        return raw;
      }
    }
    return raw;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }

  if (isGuideLocalPath(parsed.pathname)) {
    if (args.mode === "index") {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    if (args.guideBaseUrl) {
      try {
        const rewritten = new URL(parsed.pathname + parsed.search + parsed.hash, args.guideBaseUrl);
        return rewritten.toString();
      } catch {
        return parsed.toString();
      }
    }
  }

  return parsed.toString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function renderFullscreenIframePage(args: {
  title: string;
  src: string;
  allow?: string;
  showOverlay?: boolean;
  overlayTitle?: string;
  overlaySubtitle?: string;
}): string {
  const allow = args.allow ?? "autoplay; fullscreen; camera; microphone";
  const showOverlay = args.showOverlay === true;
  const overlayTitle = args.overlayTitle ?? args.title;
  const overlaySubtitle = args.overlaySubtitle ?? "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(args.title)}</title>
    <style>
      html, body { height: 100%; margin: 0; background: #02050e; overflow: hidden; }
      body { position: relative; }
      iframe {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        border: 0;
        background: #02050e;
      }
      #overlay {
        position: fixed;
        inset: auto 16px 16px auto;
        max-width: min(44vw, 560px);
        border-radius: 16px;
        padding: 14px 16px;
        color: rgba(235, 244, 255, 0.92);
        background: rgba(8, 12, 24, 0.78);
        border: 1px solid rgba(118, 198, 255, 0.28);
        box-shadow: 0 10px 26px rgba(2, 6, 12, 0.45);
        font-family: "Alegreya Sans", "Segoe UI", sans-serif;
        line-height: 1.25;
        ${showOverlay ? "" : "display: none;"}
      }
      #overlay .title {
        font-size: 19px;
        font-weight: 700;
        margin-bottom: 4px;
      }
      #overlay .subtitle {
        font-size: 13px;
        opacity: 0.82;
      }
    </style>
  </head>
  <body>
    <iframe src="${escapeHtml(args.src)}" allow="${escapeHtml(allow)}"></iframe>
    <div id="overlay">
      <div class="title">${escapeHtml(overlayTitle)}</div>
      <div class="subtitle">${escapeHtml(overlaySubtitle)}</div>
    </div>
  </body>
</html>`;
}

function renderRoadmapPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Roadmap Channel</title>
    <style>
      html, body { height: 100%; margin: 0; background: #01030a; color: #dce9ff; overflow: hidden; }
      body { font-family: "Alegreya Sans", "Segoe UI", sans-serif; display: grid; place-items: center; }
      .panel {
        width: min(92vw, 1320px);
        border: 1px solid rgba(122, 184, 255, 0.34);
        border-radius: 18px;
        background: radial-gradient(circle at 12% 18%, #18315f, #09172f 45%, #040a16 90%);
        box-shadow: 0 20px 48px rgba(2, 6, 12, 0.45);
        padding: 36px 46px;
      }
      .label {
        font-size: 15px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(164, 204, 255, 0.86);
        margin-bottom: 10px;
      }
      .title {
        font-size: clamp(42px, 6.4vw, 94px);
        line-height: 1.02;
        letter-spacing: 0.01em;
        margin: 0 0 18px;
        min-height: 1.1em;
      }
      .hint {
        font-size: 20px;
        color: rgba(198, 222, 255, 0.7);
      }
    </style>
  </head>
  <body>
    <div class="panel">
      <div class="label">Roadmap Channel</div>
      <h1 class="title" id="title">ROADMAP</h1>
      <div class="hint">Arrow Left/Right or remote app controls.</div>
    </div>
    <script>
      const slides = [
        "ROADMAP",
        "LET CHIBA CONTROL THE TV",
        "BUMPERS + COMMERCIALS MODULE",
        "AV STREAMS OF CLASSES",
        "MORE CHANNELS",
        "CURATE THE NAS",
        "CHIBA CABLE SCREENS AROUND CAMP",
        "CALL-IN SHOWS",
        "BIENNALE INSTALLATION"
      ];
      let index = 0;
      const titleEl = document.getElementById("title");
      const render = () => {
        titleEl.textContent = slides[((index % slides.length) + slides.length) % slides.length];
      };
      const next = () => { index += 1; render(); };
      const prev = () => { index -= 1; render(); };
      document.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight") next();
        if (event.key === "ArrowLeft") prev();
      });
      const params = new URLSearchParams(window.location.search);
      const appId = params.get("appId") || params.get("app") || "roadmap";
      const wsParam = params.get("ws");
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const wsUrl = wsParam || (protocol + "://" + window.location.host + "/ws");
      try {
        const socket = new WebSocket(wsUrl);
        socket.addEventListener("open", () => {
          socket.send(JSON.stringify({
            type: "controls",
            appId,
            controls: [
              { id: "prev", label: "Prev", type: "button" },
              { id: "next", label: "Next", type: "button" }
            ]
          }));
        });
        socket.addEventListener("message", (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type !== "control" || msg.appId !== appId) return;
            if (msg.controlId === "next") next();
            if (msg.controlId === "prev") prev();
          } catch {}
        });
      } catch {}
      render();
    </script>
  </body>
</html>`;
}

function isPrivateLanAddress(addr: string): boolean {
  if (!addr || addr.includes(":")) return true;
  const parts = addr.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  const a = parts[0] ?? -1;
  const b = parts[1] ?? -1;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function getLanAddress(): string | null {
  const nets = os.networkInterfaces();
  const candidates: Array<{ addr: string; score: number }> = [];
  for (const entries of Object.values(nets)) {
    for (const info of entries ?? []) {
      if (!info) continue;
      if (info.family !== "IPv4" || info.internal) continue;
      const addr = info.address;
      if (addr.startsWith("169.254.")) continue;
      let score = 1;
      if (addr.startsWith("192.168.")) score = 4;
      else if (addr.startsWith("10.")) score = 3;
      else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(addr)) score = 3;
      else if (addr.startsWith("100.")) score = 2;
      candidates.push({ addr, score });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.addr ?? null;
}

function extractHostname(hostHeader: string): string {
  const trimmed = hostHeader.trim();
  if (!trimmed) return "";
  try {
    return new URL(`http://${trimmed}`).hostname;
  } catch {
    return trimmed.split(":")[0] ?? "";
  }
}

function isLoopbackHost(host: string): boolean {
  if (!host) return true;
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower === "ip6-localhost" || lower === "ip6-loopback") {
    return true;
  }
  if (lower === "::1") return true;
  if (lower.startsWith("127.")) return true;
  return false;
}

function normalizeRemoteBase(input: string, fallback: string): string {
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function getRemoteBaseUrl(args: {
  req: { headers?: Record<string, unknown> };
  port: number;
  scheme?: string;
}): string {
  const configured =
    process.env.CHIBA3_REMOTE_URL?.trim() ||
    process.env.CHIBA_REMOTE_URL?.trim() ||
    "";
  const fallback = readPublicApiBaseUrl(args.req);
  if (configured) {
    return normalizeRemoteBase(configured, fallback);
  }
  const lan = getLanAddress();
  if (lan) {
    const scheme = args.scheme?.trim() || (isPrivateLanAddress(lan) ? "http" : "https");
    return `${scheme}://${lan}${args.port ? `:${args.port}` : ""}`;
  }

  const hostHeaderRaw = String(args.req.headers?.host ?? "").trim();
  const hostname = extractHostname(hostHeaderRaw);
  const safeHost =
    !hostname || isLoopbackHost(hostname)
      ? `${os.hostname().replace(/\.local$/i, "")}.local`
      : hostname;
  const scheme = args.scheme?.trim() || (safeHost.endsWith(".local") ? "http" : "https");
  return `${scheme}://${safeHost}${args.port ? `:${args.port}` : ""}`;
}

function extractScreenIdFromQuery(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim().length > 0) {
    return value[0].trim();
  }
  return "";
}

function resolveTargetMedia(args: {
  snapshot: ResourceSnapshot;
  target: DesiredTarget;
  streamBaseUrl: string;
  guideBaseUrl?: string | null;
}): { items: ResolvedPlaybackItem[]; warnings: string[] } {
  const mediaById = new Map(args.snapshot.media.map((row) => [row.id, row]));
  const playlistById = new Map(args.snapshot.playlists.map((row) => [row.id, row]));
  const blockById = new Map(args.snapshot.blocks.map((row) => [row.id, row]));
  const channelById = new Map(args.snapshot.channels.map((row) => [row.id, row]));
  const profileById = new Map(args.snapshot.profiles.map((row) => [row.id, row]));
  const warnings: string[] = [];
  const items: ResolvedPlaybackItem[] = [];

  const pushMedia = (mediaId: string, durationSec?: number) => {
    const media = mediaById.get(mediaId);
    if (!media) {
      warnings.push(`missing_media:${mediaId}`);
      return;
    }
    const renderer: ResolvedPlaybackItem["renderer"] = isMediaSource(media) ? "mpv" : "web";
    let sourceType: ResolvedPlaybackItem["sourceType"] = media.sourceType;
    let sourceValue = media.sourceValue;
    // Nodes must consume media via control API (stream/cache), not control-plane local filesystem paths.
    if (media.sourceType === "path") {
      sourceType = "url";
      sourceValue = buildMediaStreamUrl({
        streamBaseUrl: args.streamBaseUrl,
        media,
      });
    } else {
      sourceValue = normalizeGuideProgramUrl({
        sourceValue,
        mode: "runtime",
        guideBaseUrl: args.guideBaseUrl ?? null,
      });
    }
    const item: ResolvedPlaybackItem = {
      itemId: `${media.id}:${items.length}`,
      mediaId: media.id,
      sourceType,
      sourceValue,
      cache: media.cache,
      renderer,
    };
    if (typeof durationSec === "number") item.durationSec = durationSec;
    if (media.title) item.title = media.title;
    if (media.artist) item.artist = media.artist;
    if (media.description) item.description = media.description;
    items.push(item);
  };

  const walkPlaylist = (playlistId: string, seen: Set<string>) => {
    if (seen.has(playlistId)) {
      warnings.push(`playlist_cycle:${playlistId}`);
      return;
    }
    const playlist = playlistById.get(playlistId);
    if (!playlist) {
      warnings.push(`missing_playlist:${playlistId}`);
      return;
    }
    seen.add(playlistId);
    const sortedItems = [...playlist.items].sort((a, b) => a.index - b.index);
    for (const item of sortedItems) {
      if (item.mediaId) {
        pushMedia(item.mediaId, item.durationSec);
        continue;
      }
      if (item.playlistId) {
        walkPlaylist(item.playlistId, seen);
        continue;
      }
      warnings.push(`playlist_item_missing_target:${playlistId}:${item.index}`);
    }
    seen.delete(playlistId);
  };

  const walkBlock = (blockId: string, seenPlaylists: Set<string>) => {
    const block = blockById.get(blockId);
    if (!block) {
      warnings.push(`missing_block:${blockId}`);
      return;
    }
    const sortedItems = [...block.items].sort((a, b) => a.index - b.index);
    for (const item of sortedItems) {
      if (item.mediaId) {
        pushMedia(item.mediaId, item.durationSec);
        continue;
      }
      if (item.playlistId) {
        walkPlaylist(item.playlistId, seenPlaylists);
        continue;
      }
      warnings.push(`block_item_missing_target:${blockId}:${item.index}`);
    }
  };

  const walkTarget = (target: DesiredTarget) => {
    if (target.kind === "media") {
      pushMedia(target.id);
      return;
    }
    if (target.kind === "playlist") {
      walkPlaylist(target.id, new Set<string>());
      return;
    }
    if (target.kind === "block") {
      walkBlock(target.id, new Set<string>());
      return;
    }
    if (target.kind === "channel") {
      const channel = channelById.get(target.id);
      if (!channel) {
        warnings.push(`missing_channel:${target.id}`);
        return;
      }
      for (const blockId of channel.blockIds) {
        walkBlock(blockId, new Set<string>());
      }
      return;
    }
    if (target.kind === "profile") {
      const profile = profileById.get(target.id);
      if (!profile) {
        warnings.push(`missing_profile:${target.id}`);
        return;
      }
      if (!profile.defaultTarget) {
        warnings.push(`profile_missing_default_target:${target.id}`);
        return;
      }
      walkTarget(profile.defaultTarget);
      return;
    }
    warnings.push(`unsupported_target_kind:${target.kind}`);
  };

  walkTarget(args.target);
  return { items, warnings };
}

function buildLegacyCatalog(args: {
  snapshot: ResourceSnapshot;
  streamBaseUrl: string;
}): {
  media: Array<Record<string, unknown>>;
  playlists: Array<Record<string, unknown>>;
  blocks: Array<Record<string, unknown>>;
  channels: Array<Record<string, unknown>>;
} {
  const mediaById = new Map(args.snapshot.media.map((row) => [row.id, row]));
  const playlists = args.snapshot.playlists.map((playlist) => ({
    id: playlist.id,
    ...(playlist.title ? { title: playlist.title } : {}),
    ...(playlist.artist ? { artist: playlist.artist } : {}),
    ...(playlist.description ? { description: playlist.description } : {}),
    items: [...playlist.items]
      .sort((a, b) => a.index - b.index)
      .map((item, index) => ({
        index,
        ...(item.mediaId ? { media: item.mediaId } : {}),
        ...(item.playlistId ? { playlist: item.playlistId } : {}),
        ...(typeof item.durationSec === "number" ? { duration_sec: item.durationSec } : {}),
      })),
  }));
  const blocks = args.snapshot.blocks.map((block) => ({
    id: block.id,
    ...(block.title ? { title: block.title } : {}),
    ...(block.mode ? { mode: block.mode } : {}),
    items: [...block.items]
      .sort((a, b) => a.index - b.index)
      .map((item, index) => ({
        index,
        ...(item.mediaId ? { media: item.mediaId } : {}),
        ...(item.playlistId ? { playlist: item.playlistId } : {}),
        ...(typeof item.durationSec === "number" ? { duration_sec: item.durationSec } : {}),
      })),
  }));
  const channels = args.snapshot.channels.map((channel) => ({
    id: channel.id,
    ...(channel.number ? { number: channel.number } : {}),
    ...(channel.name ? { name: channel.name } : {}),
    blocks: channel.blockIds,
  }));
  const media = args.snapshot.media.map((row) => {
    const playableUrl =
      row.sourceType === "path"
        ? buildMediaStreamUrl({
            streamBaseUrl: args.streamBaseUrl,
            media: row,
          })
        : row.sourceValue;
    const thumbnailUrl =
      row.thumbnailUrl && row.thumbnailUrl.trim().length > 0
        ? row.thumbnailUrl
        : row.sourceType === "path" && looksLikeImageSource(row.sourceValue)
          ? playableUrl
          : row.sourceType === "url" && looksLikeImageSource(row.sourceValue)
            ? row.sourceValue
            : row.sourceType === "url"
              ? buildFallbackPreviewDataUrl({
                  title: row.title || row.id,
                  subtitle: row.artist || "Web source",
                })
              : undefined;
    const source = {
      type: "url",
      value: playableUrl,
      cache: false,
    };
    return {
      id: row.id,
      ...(row.title ? { title: row.title } : {}),
      ...(row.artist ? { artist: row.artist } : {}),
      ...(row.description ? { description: row.description } : {}),
      source,
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    };
  });

  // Ensure legacy references only include catalog media that exists.
  const knownMediaIds = new Set(media.map((row) => String(row.id)));
  const normalizedPlaylists = playlists.map((playlist) => ({
    ...playlist,
    items: (playlist.items as Array<Record<string, unknown>>).filter((item) => {
      const media = String(item.media ?? "").trim();
      const nested = String(item.playlist ?? "").trim();
      return (media && knownMediaIds.has(media)) || nested.length > 0;
    }),
  }));
  const knownPlaylistIds = new Set(normalizedPlaylists.map((row) => row.id));
  const normalizedBlocks = blocks.map((block) => ({
    ...block,
    items: (block.items as Array<Record<string, unknown>>).filter((item) => {
      const media = String(item.media ?? "").trim();
      const playlist = String(item.playlist ?? "").trim();
      return (media && knownMediaIds.has(media)) || (playlist && knownPlaylistIds.has(playlist));
    }),
  }));
  const knownBlockIds = new Set(normalizedBlocks.map((row) => row.id));
  const normalizedChannels = channels.map((channel) => ({
    ...channel,
    blocks: (channel.blocks as string[]).filter((blockId) => knownBlockIds.has(blockId)),
  }));

  return {
    media,
    playlists: normalizedPlaylists,
    blocks: normalizedBlocks,
    channels: normalizedChannels,
  };
}

function buildGuideIndex(args: {
  snapshot: ResourceSnapshot;
  streamBaseUrl: string;
  guideBaseUrl?: string | null;
}): {
  generatedAt: number;
  slotMinutes: number;
  slotCount: number;
  startTime: string;
  timeSlots: string[];
  channels: Array<Record<string, unknown>>;
} {
  const now = new Date();
  const slotAnchor = new Date(now);
  slotAnchor.setMinutes(slotAnchor.getMinutes() < 30 ? 0 : 30, 0, 0);

  const timeSlots = Array.from({ length: GUIDE_SLOT_COUNT }, (_, index) => {
    const next = new Date(slotAnchor.getTime() + index * GUIDE_SLOT_MINUTES * 60_000);
    return next.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  });
  const startTime = slotAnchor.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const mediaById = new Map(args.snapshot.media.map((row) => [row.id, row]));
  const sortedChannels = [...args.snapshot.channels].sort((a, b) => {
    const aNumber = Number(a.number ?? "");
    const bNumber = Number(b.number ?? "");
    if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) {
      return aNumber - bNumber;
    }
    return (a.name ?? a.id).localeCompare(b.name ?? b.id);
  });

  const channels = sortedChannels.map((channel, index) => {
    const resolved = resolveTargetMedia({
      snapshot: args.snapshot,
      target: { kind: "channel", id: channel.id },
      streamBaseUrl: args.streamBaseUrl,
      guideBaseUrl: args.guideBaseUrl ?? null,
    });
    const callSign = channelCallSign({
      id: channel.id,
      name: channel.name,
    });
    const fallbackTitle = channel.name || channel.id;
    const mediaWithThumb = resolved.items
      .map((item) => mediaById.get(item.mediaId))
      .find((row) => Boolean(row?.thumbnailUrl));
    const previewUrl =
      mediaWithThumb?.thumbnailUrl ||
      (() => {
        const imageSource = resolved.items.find((item) => looksLikeImageSource(item.sourceValue))
          ?.sourceValue;
        if (!imageSource) return undefined;
        return normalizeGuideProgramUrl({
          sourceValue: imageSource,
          mode: "index",
          guideBaseUrl: args.guideBaseUrl ?? null,
        });
      })() ||
      undefined;
    const schedule: Array<Record<string, unknown>> = [];
    const fallbackDurationSec = GUIDE_SLOT_MINUTES * 60;
    const totalSlots = GUIDE_SLOT_COUNT;
    if (resolved.items.length === 0) {
      for (let slot = 0; slot < totalSlots; slot += 1) {
        schedule.push({
          title: "Off Air",
          subtitle: "Standby",
          tag: "ID",
          start: slot,
          span: 1,
          end: 0,
          durationSec: fallbackDurationSec,
        });
      }
    } else {
      let slot = 0;
      let cursor = 0;
      while (slot < totalSlots) {
        const item = resolved.items[cursor % resolved.items.length];
        if (!item) break;
        const desiredSec =
          typeof item.durationSec === "number" && item.durationSec > 0
            ? item.durationSec
            : fallbackDurationSec;
        const slotSpan = Math.max(1, Math.round(desiredSec / fallbackDurationSec));
        const clampedSpan = Math.min(slotSpan, totalSlots - slot);
        schedule.push({
          title: item.title || fallbackTitle,
          ...(item.description ? { subtitle: item.description } : {}),
          tag: callSign,
          ...(item.artist ? { artist: item.artist } : {}),
          ...(item.description ? { description: item.description } : {}),
          start: slot,
          span: clampedSpan,
          end: clampedSpan - 1,
          durationSec: desiredSec,
          url: normalizeGuideProgramUrl({
            sourceValue: item.sourceValue,
            mode: "index",
            guideBaseUrl: args.guideBaseUrl ?? null,
          }),
        });
        slot += clampedSpan;
        cursor += 1;
      }
    }
    return {
      id: channel.id,
      number: channel.number || String(index + 1).padStart(3, "0"),
      name: channel.name || channel.id,
      callSign,
      description: channel.name || channel.id,
      accent: "#88d6ff",
      ...(previewUrl ? { previewUrl } : {}),
      schedule,
    };
  });

  return {
    generatedAt: Date.now(),
    slotMinutes: GUIDE_SLOT_MINUTES,
    slotCount: GUIDE_SLOT_COUNT,
    startTime,
    timeSlots,
    channels,
  };
}

async function fetchJson(args: {
  url: string;
  timeoutMs: number;
  method?: "GET" | "DELETE" | "POST";
  body?: unknown;
}): Promise<{
  ok: boolean;
  status: number | null;
  ms: number | null;
  data: unknown;
  error?: string;
}> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const requestHeaders: Record<string, string> = { accept: "application/json" };
    const requestInit: RequestInit = {
      method: args.method ?? "GET",
      signal: controller.signal,
      headers: requestHeaders,
    };
    if (args.body !== undefined) {
      requestHeaders["content-type"] = "application/json";
      requestInit.body = JSON.stringify(args.body);
    }
    const response = await fetch(args.url, requestInit);
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      ms: Date.now() - started,
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildConditions(args: {
  desired:
    | {
        revision: number;
      }
    | null;
  runtime:
    | {
        desiredRevision: number | null;
        activeRevision: number | null;
        phase: string;
        errorCode?: string | undefined;
      }
    | null;
}): ScreenCondition[] {
  const now = Date.now();
  const accepted = args.desired !== null;
  const phase = args.runtime?.phase ?? "idle";
  const activated =
    args.desired !== null &&
    phase === "active" &&
    typeof args.runtime?.activeRevision === "number" &&
    args.runtime.activeRevision === args.desired.revision;

  return [
    {
      type: "Accepted",
      status: accepted,
      updatedAt: now,
      reason: accepted ? "desired_state_present" : "desired_state_missing",
    },
    {
      type: "ManifestResolved",
      status: accepted,
      updatedAt: now,
      reason: accepted ? "resolver_pending_or_ready" : "desired_state_missing",
    },
    {
      type: "Warming",
      status: phase === "warming",
      updatedAt: now,
      reason: phase === "warming" ? "runtime_warming" : "runtime_not_warming",
    },
    {
      type: "Ready",
      status: phase === "ready" || phase === "active",
      updatedAt: now,
      reason:
        phase === "ready" || phase === "active"
          ? "runtime_ready_or_active"
          : "runtime_not_ready",
    },
    {
      type: "Activated",
      status: activated,
      updatedAt: now,
      reason: activated ? "active_revision_matches_desired" : "not_active_or_revision_mismatch",
    },
    {
      type: "Degraded",
      status: phase === "degraded",
      updatedAt: now,
      reason: phase === "degraded" ? "runtime_degraded" : "runtime_not_degraded",
    },
    {
      type: "Error",
      status: phase === "error" || Boolean(args.runtime?.errorCode),
      updatedAt: now,
      reason:
        phase === "error" || Boolean(args.runtime?.errorCode)
          ? "runtime_error"
          : "runtime_no_error",
      message: args.runtime?.errorCode,
    },
  ];
}

async function loadStatus(args: {
  db: ReturnType<typeof createDb>;
  screenId: string;
  namespace: string;
}) {
  const desired = await getDesiredScreenState({
    db: args.db,
    screenId: args.screenId,
    namespace: args.namespace,
  });
  const runtime = await getNodeRuntimeReport({
    db: args.db,
    nodeId: args.screenId,
    namespace: args.namespace,
  });
  const conditions = buildConditions({
    desired: desired ? { revision: desired.revision } : null,
    runtime: runtime
      ? {
          desiredRevision: runtime.desiredRevision,
          activeRevision: runtime.activeRevision,
          phase: runtime.phase,
          errorCode: runtime.errorCode,
        }
      : null,
  });

  return ScreenAssignmentStatusResponseSchema.parse({
    ok: true,
    screenId: args.screenId,
    namespace: args.namespace,
    desired: desired
      ? {
          revision: desired.revision,
          target: {
            kind: desired.targetKind,
            id: desired.targetId,
          },
          launch: desired.launch,
          controllerId: desired.controllerId,
          operationId: desired.operationId,
          updatedAt: desired.createdAt,
        }
      : null,
    runtime: runtime ?? null,
    conditions,
  });
}

async function probeFleetNode(args: {
  db: ReturnType<typeof createDb>;
  node: typeof schema.registryNodes.$inferSelect;
  namespace: string;
  timeoutMs: number;
}) {
  const now = Date.now();
  const hostResolved = args.node.ip || args.node.host || null;
  const nodePort = args.node.nodePort ?? 8080;
  const serverPort = args.node.serverPort ?? 8787;
  const guidePort = args.node.guidePort ?? 5173;

  const nodeStatus = hostResolved
    ? await fetchJson({
        url: `http://${hostResolved}:${nodePort}/status`,
        timeoutMs: args.timeoutMs,
      })
    : { ok: false, status: null, ms: null, data: null, error: "missing_host_or_ip" };

  const cableVersion = hostResolved
    ? await fetchJson({
        url: `http://${hostResolved}:${serverPort}/api/version`,
        timeoutMs: args.timeoutMs,
      })
    : { ok: false, status: null, ms: null, data: null, error: "missing_host_or_ip" };

  const desired = await getDesiredScreenState({
    db: args.db,
    screenId: args.node.nodeId,
    namespace: args.namespace,
  });

  const nodeStatusJson =
    nodeStatus.data && typeof nodeStatus.data === "object"
      ? (nodeStatus.data as Record<string, unknown>)
      : null;
  const nodeInfo =
    nodeStatusJson &&
    typeof nodeStatusJson.node === "object" &&
    nodeStatusJson.node !== null
      ? (nodeStatusJson.node as Record<string, unknown>)
      : null;

  const versionJson =
    cableVersion.data && typeof cableVersion.data === "object"
      ? (cableVersion.data as Record<string, unknown>)
      : null;

  const target = desired
    ? ({
        kind: desired.targetKind as DesiredTarget["kind"],
        id: desired.targetId,
      } satisfies DesiredTarget)
    : null;

  const fallbackKioskUrl =
    target && desired
      ? buildKioskUrl({
          screenId: args.node.nodeId,
          guidePort,
          target,
          launch: desired.launch,
        })
      : null;

  const dnsOk = Boolean(hostResolved);
  const pingOk = nodeStatus.ok || cableVersion.ok;
  const sshOk = nodeStatus.ok || cableVersion.ok;
  const nodeApiOk = nodeStatus.ok;
  const cableApiOk = cableVersion.ok;
  const connectivity = buildConnectivitySummary({
    dnsOk,
    pingOk,
    sshOk,
    nodeApiOk,
    cableApiOk,
  });
  const latencyMs =
    typeof (nodeStatus.ms ?? cableVersion.ms) === "number"
      ? Math.max(0, Math.trunc(nodeStatus.ms ?? cableVersion.ms ?? 0))
      : null;
  const errorSummary = (nodeStatus.error ?? cableVersion.error ?? null) || undefined;

  await upsertNodeConnectivity({
    db: args.db,
    snapshot: {
      registryId: args.node.registryId,
      nodeId: args.node.nodeId,
      namespace: args.namespace,
      dnsOk,
      pingOk,
      sshOk,
      nodeApiOk,
      cableApiOk,
      connectivityScore: connectivity.score,
      connectivityTotal: connectivity.total,
      status: connectivity.status,
      latencyMs,
      ...(errorSummary ? { errorSummary } : {}),
      checkedAt: now,
    },
  });

  return {
    registryId: args.node.registryId,
    id: args.node.nodeId,
    host: args.node.host ?? "",
    ip: args.node.ip ?? null,
    nodeName: args.node.nodeName ?? args.node.nodeId,
    resolvedIp: hostResolved,
    dnsOk,
    ping: {
      ok: pingOk,
      ms: nodeStatus.ms ?? cableVersion.ms,
      error: nodeStatus.error ?? cableVersion.error,
    },
    tcp: {
      ssh22: {
        ok: sshOk,
        ms: nodeStatus.ms ?? cableVersion.ms,
        error: nodeStatus.error ?? cableVersion.error,
      },
      node8080: {
        ok: nodeApiOk,
        ms: nodeStatus.ms,
        error: nodeStatus.error,
      },
      cable8787: {
        ok: cableApiOk,
        ms: cableVersion.ms,
        error: cableVersion.error,
      },
    },
    http: {
      nodeStatus: {
        ok: nodeStatus.ok,
        ms: nodeStatus.ms,
        status: nodeStatus.status,
        error: nodeStatus.error,
      },
      cableVersion: {
        ok: cableVersion.ok,
        ms: cableVersion.ms,
        status: cableVersion.status,
        error: cableVersion.error,
      },
    },
    connectivity: {
      ...connectivity,
      lastCheckedAt: now,
    },
    chibaNode: {
      version:
        typeof nodeInfo?.version === "string"
          ? nodeInfo.version
          : typeof nodeStatusJson?.version === "string"
            ? nodeStatusJson.version
            : null,
      ipReported:
        typeof nodeInfo?.ip === "string"
          ? nodeInfo.ip
          : typeof args.node.ip === "string"
            ? args.node.ip
            : null,
      kioskUrl:
        typeof nodeInfo?.kioskUrl === "string" ? nodeInfo.kioskUrl : fallbackKioskUrl,
    },
    cableServer: versionJson
      ? {
          version:
            typeof versionJson.version === "string" ? versionJson.version : "0.0.0",
          gitSha:
            typeof versionJson.gitSha === "string"
              ? versionJson.gitSha
              : typeof versionJson.sha === "string"
                ? versionJson.sha
                : null,
        }
      : null,
    needsUpdate: null,
    lastCheckedAt: now,
  };
}

function eventWrite(res: ServerResponse, type: string, data: unknown): void {
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function main(): Promise<void> {
  const app = Fastify({
    bodyLimit: 1 * 1024 * 1024,
  });
  app.addContentTypeParser(/^multipart\/form-data/i, (request, payload, done) => {
    done(null, payload);
  });

  app.decorateReply("json", function json(this: FastifyReply, payload: unknown) {
    this.send(payload);
    return this;
  });
  app.decorateReply("setHeader", function setHeader(
    this: FastifyReply,
    name: string,
    value: string
  ) {
    this.header(name, value);
    return this;
  });

  const pool = createDbPool();
  const db = createDb(pool);
  const ingestQueue = createIngestJobQueue();
  const wss = new WebSocketServer({ noServer: true });
  const wsMeta = new Map<WebSocket, { screenId: string; role: string; alive: boolean }>();

  const wsScreenIdFromUrl = (rawUrl: string | undefined): string => {
    if (!rawUrl) return "";
    try {
      const parsed = new URL(rawUrl, "http://localhost");
      return (
        extractScreenIdFromQuery(parsed.searchParams.get("screenId")) ||
        extractScreenIdFromQuery(parsed.searchParams.get("screen")) ||
        ""
      );
    } catch {
      return "";
    }
  };

  const wsBroadcast = (message: string, scopeScreenId: string) => {
    for (const client of wss.clients) {
      const meta = wsMeta.get(client);
      if (!meta) continue;
      if (scopeScreenId && meta.screenId && meta.screenId !== scopeScreenId) continue;
      if (client.readyState === client.OPEN) {
        try {
          client.send(message);
        } catch {
          // ignore send failures for individual clients
        }
      }
    }
  };

  app.server.on("upgrade", (req, socket, head) => {
    const rawUrl = req.url || "";
    let pathname = "";
    try {
      pathname = new URL(rawUrl, "http://localhost").pathname;
    } catch {
      pathname = "";
    }
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit("connection", client, req);
    });
  });

  wss.on("connection", (socket, req) => {
    const initialScreenId = wsScreenIdFromUrl(req.url);
    wsMeta.set(socket, {
      screenId: initialScreenId,
      role: "unknown",
      alive: true,
    });

    socket.on("pong", () => {
      const meta = wsMeta.get(socket);
      if (meta) meta.alive = true;
    });

    socket.on("close", () => {
      wsMeta.delete(socket);
    });

    socket.on("error", () => {
      wsMeta.delete(socket);
    });

    socket.on("message", (raw) => {
      const message = raw.toString();
      let scopeScreenId = wsMeta.get(socket)?.screenId || "";
      try {
        const parsed = JSON.parse(message) as {
          type?: string;
          role?: string;
          screenId?: string;
          screen?: string;
        };
        const meta = wsMeta.get(socket);
        if (meta) {
          const incomingScreenId =
            extractScreenIdFromQuery(parsed.screenId) ||
            extractScreenIdFromQuery(parsed.screen) ||
            meta.screenId;
          if (incomingScreenId) {
            meta.screenId = incomingScreenId;
            scopeScreenId = incomingScreenId;
          }
          if (parsed.type === "hello" && parsed.role) {
            meta.role = parsed.role;
          }
        }
      } catch {
        // ignore parse errors and forward raw payload for compatibility
      }
      wsBroadcast(message, scopeScreenId);
    });
  });

  const wsHeartbeatTimer = setInterval(() => {
    for (const client of wss.clients) {
      const meta = wsMeta.get(client);
      if (!meta) continue;
      if (!meta.alive) {
        client.terminate();
        wsMeta.delete(client);
        continue;
      }
      meta.alive = false;
      try {
        client.ping();
      } catch {
        client.terminate();
        wsMeta.delete(client);
      }
    }
  }, 20_000);

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "cable3-control-api", ts: Date.now() });
  });

  app.get("/api/remote", (req, res) => {
    const query = queryOf(req);
    const rawPort = String(query.guide_port ?? query.port ?? "").trim();
    const guidePort = Number.isFinite(Number(rawPort)) ? Number(rawPort) : 5173;
    const scheme = String(query.scheme ?? "").replace(":", "").trim() || undefined;
    const screenId =
      extractScreenIdFromQuery(query.screen_id) ||
      extractScreenIdFromQuery(query.screenId) ||
      extractScreenIdFromQuery(query.screen);

    const baseUrl = getRemoteBaseUrl({
      req: req as { headers?: Record<string, unknown> },
      port: guidePort,
      ...(scheme ? { scheme } : {}),
    });
    const wsBaseUrl = getRemoteBaseUrl({
      req: req as { headers?: Record<string, unknown> },
      port: Number(process.env.PORT ?? "8795"),
      ...(scheme ? { scheme } : {}),
    });
    let wsUrl = "";
    try {
      const parsed = new URL(wsBaseUrl);
      parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
      parsed.pathname = "/ws";
      if (screenId) parsed.searchParams.set("screenId", screenId);
      wsUrl = parsed.toString();
    } catch {
      wsUrl = "";
    }
    let remoteUrl = `${baseUrl}/remote`;
    if (wsUrl) {
      remoteUrl = `${remoteUrl}?ws=${encodeURIComponent(wsUrl)}`;
    }
    if (screenId) {
      const join = remoteUrl.includes("?") ? "&" : "?";
      remoteUrl = `${remoteUrl}${join}screenId=${encodeURIComponent(screenId)}`;
    }
    const qrUrl = `${QR_BASE}${encodeURIComponent(remoteUrl)}`;
    res.json({ baseUrl, remoteUrl, qrUrl, wsUrl });
  });

  app.post("/api/v1/apply/screen-assignment", async (req, res) => {
    const parsed = ApplyScreenAssignmentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: "invalid_request",
        issues: parsed.error.issues,
      });
      return;
    }

    const result = await applyScreenAssignment({ db, input: parsed.data });
    if (!result.ok) {
      const payload = ApplyScreenAssignmentResponseSchema.parse({
        ok: false,
        screenId: parsed.data.screenId,
        namespace: parsed.data.namespace,
        desiredRevision: result.conflict.actualRevision,
        operationId: parsed.data.operationId,
        conflict: result.conflict,
        conditions: buildConditions({
          desired:
            result.conflict.actualRevision > 0
              ? { revision: result.conflict.actualRevision }
              : null,
          runtime: null,
        }),
      });
      res.status(409).json(payload);
      return;
    }

    const status = await loadStatus({
      db,
      screenId: parsed.data.screenId,
      namespace: parsed.data.namespace,
    });
    const payload = ApplyScreenAssignmentResponseSchema.parse({
      ok: true,
      screenId: parsed.data.screenId,
      namespace: parsed.data.namespace,
      desiredRevision: result.row.revision,
      operationId: parsed.data.operationId,
      conditions: status.conditions,
    });
    res.json(payload);
  });

  app.get("/api/v1/screen-assignment/:screenId", async (req, res) => {
    const params = paramsOf(req);
    const query = queryOf(req);
    const screenId = String(params.screenId ?? "").trim();
    const namespace = String(query.namespace ?? DEFAULT_NAMESPACE).trim() || DEFAULT_NAMESPACE;
    if (!screenId) {
      res.status(400).json({ ok: false, error: "screen_id_required" });
      return;
    }
    const payload = await loadStatus({ db, screenId, namespace });
    res.json(payload);
  });

  app.get("/api/v1/runtime/resolve/:screenId", async (req, res) => {
    const params = paramsOf(req);
    const query = queryOf(req);
    const screenId = String(params.screenId ?? "").trim();
    const namespace =
      String(query.namespace ?? DEFAULT_NAMESPACE).trim() || DEFAULT_NAMESPACE;
    if (!screenId) {
      res.status(400).json({ ok: false, error: "screen_id_required" });
      return;
    }

    const desired = await getDesiredScreenState({ db, screenId, namespace });
    if (!desired) {
      res.json({
        ok: true,
        screenId,
        namespace,
        desired: null,
        resolved: {
          items: [],
          warnings: ["desired_state_missing"],
          cache: { total: 0, cacheable: 0 },
          renderers: { mpv: 0, web: 0 },
        },
      });
      return;
    }

    const snapshot = await getResourceSnapshot({ db });
    const target: DesiredTarget = {
      kind: desired.targetKind as DesiredTarget["kind"],
      id: desired.targetId,
    };
    const streamBaseUrl = readPublicApiBaseUrl(req as { headers?: Record<string, unknown> });
    const guideBaseUrl =
      normalizeGuideBaseUrl(String(query.guideBaseUrl ?? "")) ?? DEFAULT_GUIDE_BASE_URL;
    const resolved = resolveTargetMedia({
      snapshot,
      target,
      streamBaseUrl,
      guideBaseUrl,
    });
    const cacheable = resolved.items.filter((item) => item.cache).length;
    const mpvCount = resolved.items.filter((item) => item.renderer === "mpv").length;
    const webCount = resolved.items.length - mpvCount;

    res.json({
      ok: true,
      screenId,
      namespace,
      desired: {
        revision: desired.revision,
        target,
        launch: desired.launch,
      },
      resolved: {
        items: resolved.items,
        warnings: resolved.warnings,
        cache: {
          total: resolved.items.length,
          cacheable,
        },
        renderers: {
          mpv: mpvCount,
          web: webCount,
        },
      },
    });
  });

  app.get("/api/v1/screen-assignments", async (req, res) => {
    const query = queryOf(req);
    const namespace = String(query.namespace ?? DEFAULT_NAMESPACE).trim() || DEFAULT_NAMESPACE;
    const screenIdRaw = String(query.screenId ?? "").trim();
    const rows = await listDesiredScreenStates(
      screenIdRaw
        ? {
            db,
            namespace,
            screenId: screenIdRaw,
          }
        : {
            db,
            namespace,
          }
    );
    res.json({
      ok: true,
      namespace,
      count: rows.length,
      items: rows.map((row) => ({
        screenId: row.screenId,
        namespace: row.namespace,
        revision: row.revision,
        controllerId: row.controllerId,
        operationId: row.operationId,
        target: {
          kind: row.targetKind,
          id: row.targetId,
        },
        launch: row.launch,
        updatedAt: row.createdAt,
      })),
    });
  });

  app.get("/api/v1/nodes/:nodeId/runtime", async (req, res) => {
    const params = paramsOf(req);
    const query = queryOf(req);
    const nodeId = String(params.nodeId ?? "").trim();
    const namespace = String(query.namespace ?? DEFAULT_NAMESPACE).trim() || DEFAULT_NAMESPACE;
    if (!nodeId) {
      res.status(400).json({ ok: false, error: "node_id_required" });
      return;
    }
    const runtime = await getNodeRuntimeReport({ db, nodeId, namespace });
    res.json({ ok: true, nodeId, namespace, runtime });
  });

  app.post("/api/v1/nodes/:nodeId/runtime-report", async (req, res) => {
    const params = paramsOf(req);
    const nodeId = String(params.nodeId ?? "").trim();
    if (!nodeId) {
      res.status(400).json({ ok: false, error: "node_id_required" });
      return;
    }
    const parsed = NodeRuntimeReportV1Schema.safeParse({
      ...bodyOf(req),
      nodeId,
    });
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: "invalid_runtime_report",
        issues: parsed.error.issues,
      });
      return;
    }
    await upsertNodeRuntimeReport({
      db,
      report: parsed.data,
    });
    res.json({ ok: true, nodeId, namespace: parsed.data.namespace });
  });

  app.post("/api/v1/resources/import", async (req, res) => {
    const parsed = ResourceImportPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: "invalid_resource_payload",
        issues: parsed.error.issues,
      });
      return;
    }
    const counts = await importResources({
      db,
      payload: parsed.data,
    });
    res.json({ ok: true, counts });
  });

  app.get("/api/v1/resources/snapshot", async (_req, res) => {
    const snapshot = await getResourceSnapshot({ db });
    const payload = ResourceSnapshotSchema.parse(snapshot);
    res.json({
      ok: true,
      snapshot: payload,
    });
  });

  const handleDeleteMedia = async (req: any, res: FastifyReply) => {
    const mediaId = String(req.params.mediaId ?? "").trim();
    if (!mediaId) {
      res.status(400).json({
        ok: false,
        error: "media_id_required",
      });
      return;
    }
    const result = await deleteMediaResource({
      db,
      mediaId,
    });
    res.json({
      ok: true,
      ...result,
    });
  };

  app.delete("/api/v1/resources/media/:mediaId", handleDeleteMedia);

  app.get("/api/v1/resources/media/:mediaId/stream", async (req, res) => {
    const params = paramsOf(req);
    const mediaId = String(params.mediaId ?? "").trim();
    if (!mediaId) {
      res.status(400).json({
        ok: false,
        error: "media_id_required",
      });
      return;
    }
    const snapshot = await getResourceSnapshot({ db });
    const media = snapshot.media.find((row) => row.id === mediaId);
    if (!media) {
      res.status(404).json({
        ok: false,
        error: "media_not_found",
      });
      return;
    }
    if (media.sourceType === "url") {
      res.redirect(media.sourceValue);
      return;
    }
    const sourceValue = String(media.sourceValue ?? "").trim();
    if (!sourceValue) {
      res.status(404).json({
        ok: false,
        error: "media_path_missing",
      });
      return;
    }
    const normalizedPath = path.normalize(sourceValue);
    if (!path.isAbsolute(normalizedPath)) {
      res.status(400).json({
        ok: false,
        error: "media_path_not_absolute",
      });
      return;
    }
    const stat = await fs.promises.stat(normalizedPath).catch(() => null);
    if (!stat || !stat.isFile()) {
      res.status(404).json({
        ok: false,
        error: "media_file_not_found",
      });
      return;
    }

    const total = stat.size;
    res.setHeader("Accept-Ranges", "bytes");
    res.type(mediaContentTypeForPath(normalizedPath));

    const range = String(req.headers.range ?? "").trim();
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
      if (!match) {
        res.status(416).setHeader("Content-Range", `bytes */${total}`).send();
        return;
      }
      const startRaw = match[1];
      const endRaw = match[2];
      const start = startRaw ? Number(startRaw) : 0;
      const end = endRaw ? Number(endRaw) : total - 1;
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end < 0 ||
        start > end ||
        start >= total
      ) {
        res.status(416).setHeader("Content-Range", `bytes */${total}`).send();
        return;
      }
      const clampedEnd = Math.min(end, total - 1);
      const chunkSize = clampedEnd - start + 1;
      res.status(206);
      res.header("Content-Type", mediaContentTypeForPath(normalizedPath));
      res.header("Accept-Ranges", "bytes");
      res.header("Content-Range", `bytes ${start}-${clampedEnd}/${total}`);
      res.header("Content-Length", String(chunkSize));
      const fileStream = fs.createReadStream(normalizedPath, {
        start,
        end: clampedEnd,
      });
      return res.send(fileStream);
    }

    res.status(200);
    res.header("Content-Type", mediaContentTypeForPath(normalizedPath));
    res.header("Accept-Ranges", "bytes");
    res.header("Content-Length", String(total));
    const fileStream = fs.createReadStream(normalizedPath);
    return res.send(fileStream);
  });

  app.post("/api/v1/ingest/upload", async (req, res) => {
    const parsed = await readMultipartUploadFromRequest(req.raw);
    const metadataParsed = IngestUploadMetadataSchema.safeParse(parsed.fields);
    if (!metadataParsed.success) {
      res.status(400).json({
        ok: false,
        error: "invalid_upload_metadata",
        issues: metadataParsed.error.issues,
      });
      return;
    }
    const result = await ingestUploadedFiles({
      db,
      contentLength: parsed.contentLength,
      files: parsed.files,
      metadata: metadataParsed.data,
    });
    res.status(result.status).json(result.payload);
  });

  app.post("/api/v1/ingest/youtube", async (req, res) => {
    const parsed = IngestYouTubeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: "invalid_youtube_ingest_request",
        issues: parsed.error.issues,
      });
      return;
    }
    const result = await ingestYouTube({
      db,
      url: parsed.data.url,
      ...(parsed.data.mediaId ? { mediaId: parsed.data.mediaId } : {}),
      ...(parsed.data.title ? { title: parsed.data.title } : {}),
      ...(parsed.data.artist ? { artist: parsed.data.artist } : {}),
      ...(typeof parsed.data.cache === "boolean"
        ? { cache: parsed.data.cache }
        : {}),
    });
    res.status(result.status).json(result.payload);
  });

  app.post("/api/v1/ingest/eden-collection", async (req, res) => {
    const parsed = IngestEdenCollectionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: "invalid_eden_ingest_request",
        issues: parsed.error.issues,
      });
      return;
    }
    const input =
      parsed.data.input?.trim() ||
      parsed.data.url?.trim() ||
      parsed.data.collectionId?.trim() ||
      "";
    if (!input) {
      res.status(400).json({
        ok: false,
        error: "missing_collection_input",
      });
      return;
    }
    const result = await ingestEdenCollection({
      db,
      input,
      ...(parsed.data.db ? { dbName: parsed.data.db } : {}),
      ...(parsed.data.playlistId ? { playlistId: parsed.data.playlistId } : {}),
      ...(parsed.data.apiKey ? { apiKey: parsed.data.apiKey } : {}),
    });
    res.status(result.status).json(result.payload);
  });

  app.post("/api/v1/ingest/jobs/upload", async (req, res) => {
    const parsed = await readMultipartUploadFromRequest(req.raw);
    const metadataParsed = IngestUploadMetadataSchema.safeParse(parsed.fields);
    if (!metadataParsed.success) {
      res.status(400).json({
        ok: false,
        error: "invalid_upload_metadata",
        issues: metadataParsed.error.issues,
      });
      return;
    }
    const job = enqueueUploadIngest({
      queue: ingestQueue,
      db,
      contentLength: parsed.contentLength,
      files: parsed.files,
      metadata: metadataParsed.data,
    });
    res.status(202).json({ ok: true, job });
  });

  app.post("/api/v1/ingest/jobs/youtube", async (req, res) => {
    const parsed = IngestYouTubeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: "invalid_youtube_ingest_request",
        issues: parsed.error.issues,
      });
      return;
    }
    const job = enqueueYouTubeIngest({
      queue: ingestQueue,
      db,
      input: {
        url: parsed.data.url,
        ...(parsed.data.mediaId ? { mediaId: parsed.data.mediaId } : {}),
        ...(parsed.data.title ? { title: parsed.data.title } : {}),
        ...(parsed.data.artist ? { artist: parsed.data.artist } : {}),
        ...(typeof parsed.data.cache === "boolean"
          ? { cache: parsed.data.cache }
          : {}),
      },
    });
    res.status(202).json({ ok: true, job });
  });

  app.post("/api/v1/ingest/jobs/eden-collection", async (req, res) => {
    const parsed = IngestEdenCollectionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: "invalid_eden_ingest_request",
        issues: parsed.error.issues,
      });
      return;
    }
    const input =
      parsed.data.input?.trim() ||
      parsed.data.url?.trim() ||
      parsed.data.collectionId?.trim() ||
      "";
    if (!input) {
      res.status(400).json({
        ok: false,
        error: "missing_collection_input",
      });
      return;
    }
    const job = enqueueEdenCollectionIngest({
      queue: ingestQueue,
      db,
      input: {
        input,
        ...(parsed.data.db ? { dbName: parsed.data.db } : {}),
        ...(parsed.data.playlistId ? { playlistId: parsed.data.playlistId } : {}),
        ...(parsed.data.apiKey ? { apiKey: parsed.data.apiKey } : {}),
      },
    });
    res.status(202).json({ ok: true, job });
  });

  app.get("/api/v1/ingest/jobs/:jobId", async (req, res) => {
    const params = paramsOf(req);
    const jobId = String(params.jobId ?? "").trim();
    if (!jobId) {
      res.status(400).json({ ok: false, error: "job_id_required" });
      return;
    }
    const job = ingestQueue.get(jobId);
    if (!job) {
      res.status(404).json({ ok: false, error: "job_not_found" });
      return;
    }
    res.json({ ok: true, job });
  });

  app.get("/api/v1/ingest/jobs", async (req, res) => {
    const query = queryOf(req);
    const limit = Math.max(1, Math.min(200, Number(query.limit ?? 50) || 50));
    res.json({ ok: true, jobs: ingestQueue.list(limit) });
  });

  app.get("/api/v1/assets/thumbs/:fileName", async (req, res) => {
    const params = paramsOf(req);
    const fileName = String(params.fileName ?? "").trim();
    if (!fileName) {
      res.status(404).json({ ok: false, error: "thumbnail_not_found" });
      return;
    }
    const result = await readThumbnail({ fileName });
    if (result.status !== 200 || !result.filePath) {
      res.status(result.status).json({ ok: false, error: result.error ?? "thumbnail_not_found" });
      return;
    }
    const stat = await fs.promises.stat(result.filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      res.status(404).json({ ok: false, error: "thumbnail_not_found" });
      return;
    }
    res.status(200);
    res.header("Content-Type", mediaContentTypeForPath(result.filePath));
    res.header("Content-Length", String(stat.size));
    const fileStream = fs.createReadStream(result.filePath);
    return res.send(fileStream);
  });

  app.get("/weatherstar", async (_req, res) => {
    res.type("text/html; charset=utf-8");
    res.send(
      renderFullscreenIframePage({
        title: "WeatherStar 4000+",
        src: DEFAULT_WEATHERSTAR_URL,
        allow: "autoplay; fullscreen",
        showOverlay: true,
        overlayTitle: "WeatherStar 4000+",
        overlaySubtitle: "Live weather feed",
      })
    );
  });

  app.get("/home-assistant", async (_req, res) => {
    res.redirect(DEFAULT_HOME_ASSISTANT_URL);
  });

  app.get("/roadmap", async (_req, res) => {
    res.type("text/html; charset=utf-8");
    res.send(renderRoadmapPage());
  });

  app.get("/embed/:id", async (req, res) => {
    const params = paramsOf(req);
    const embedId = String(params.id ?? "").trim();
    const embedUrl = DEFAULT_EMBED_URLS[embedId];
    if (!embedUrl) {
      res.status(404).type("text/plain; charset=utf-8").send("embed_not_found");
      return;
    }
    res.type("text/html; charset=utf-8");
    res.send(
      renderFullscreenIframePage({
        title: embedId,
        src: embedUrl,
        allow: "autoplay; fullscreen; camera; microphone",
        showOverlay: embedId === "mars-public-access",
        overlayTitle: "Mars Public Access Network",
        overlaySubtitle: "Live transmission",
      })
    );
  });

  app.get("/mars", async (_req, res) => {
    res.redirect("/embed/mars-public-access");
  });

  app.get("/village", async (_req, res) => {
    res.redirect("/embed/ai-village");
  });

  app.get("/api/catalog", async (req, res) => {
    const snapshot = await getResourceSnapshot({ db });
    const streamBaseUrl = readPublicApiBaseUrl(req as { headers?: Record<string, unknown> });
    res.json({
      ok: true,
      catalog: buildLegacyCatalog({
        snapshot,
        streamBaseUrl,
      }),
    });
  });

  app.get("/api/index", async (req, res) => {
    const query = queryOf(req);
    const snapshot = await getResourceSnapshot({ db });
    const streamBaseUrl = readPublicApiBaseUrl(req as { headers?: Record<string, unknown> });
    const guideBaseUrl =
      normalizeGuideBaseUrl(String(query.guideBaseUrl ?? "")) ?? DEFAULT_GUIDE_BASE_URL;
    res.json(
      buildGuideIndex({
        snapshot,
        streamBaseUrl,
        guideBaseUrl,
      })
    );
  });

  app.get("/api/v1/watch/screen-assignment", async (req, res) => {
    const query = queryOf(req);
    const screenId = String(query.screenId ?? "").trim();
    const namespace = String(query.namespace ?? DEFAULT_NAMESPACE).trim() || DEFAULT_NAMESPACE;
    const waitForRaw = String(query.waitFor ?? "Activated").trim();
    const timeoutMs = Math.max(
      500,
      Math.min(120_000, Number(query.timeoutMs ?? 30_000) || 30_000)
    );
    const waitForParsed = ScreenConditionTypeSchema.safeParse(waitForRaw);
    if (!screenId || !waitForParsed.success) {
      res.status(400).json({
        ok: false,
        error: "invalid_watch_request",
        detail: { screenId, waitFor: waitForRaw },
      });
      return;
    }

    const waitFor = waitForParsed.data as WaitCondition;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const status = await loadStatus({ db, screenId, namespace });
      const cond = status.conditions.find((c) => c.type === waitFor);
      if (cond?.status) {
        res.json({
          ok: true,
          screenId,
          namespace,
          waitFor,
          met: true,
          status,
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const status = await loadStatus({ db, screenId, namespace });
    res.status(408).json({
      ok: false,
      error: "wait_timeout",
      screenId,
      namespace,
      waitFor,
      timeoutMs,
      status,
    });
  });

  // Ops compatibility endpoints (cable3-native).
  app.get("/api/ops/catalog", async (_req, res) => {
    const snapshot = await getResourceSnapshot({ db });
    res.json({
      ok: true,
      configPath: "db://cable3/resources",
      manifestDir: "db://cable3/resources",
      libraryRoots: [],
      counts: {
        channels: snapshot.channels.length,
        blocks: snapshot.blocks.length,
        playlists: snapshot.playlists.length,
        media: snapshot.media.length,
      },
      channels: snapshot.channels.map((row) => ({
        id: row.id,
        number: row.number,
        name: row.name,
      })),
      blocks: snapshot.blocks.map((row) => ({
        id: row.id,
        title: row.title,
      })),
      playlists: snapshot.playlists.map((row) => ({
        id: row.id,
        title: row.title,
        artist: row.artist,
        description: row.description,
      })),
      media: snapshot.media.map((row) => ({
        id: row.id,
        title: row.title,
        artist: row.artist,
        description: row.description,
        sourceType: row.sourceType,
        sourceValue: row.sourceValue,
        thumbnailUrl: row.thumbnailUrl,
        thumbnailObjectKey: row.thumbnailObjectKey,
        cache: row.cache,
      })),
    });
  });

  app.get("/api/ops/profiles", async (_req, res) => {
    const snapshot = await getResourceSnapshot({ db });
    res.json({
      ok: true,
      profiles: snapshot.profiles.map((profile) => ({
        id: profile.id,
        file: `db://profiles/${profile.id}`,
        modePath: `db://profiles/${profile.id}`,
        defaults: {
          ...(profile.defaults ?? {}),
          target_kind: profile.defaultTarget?.kind,
          target_id: profile.defaultTarget?.id,
        },
        overridePis: profile.nodes.map((row) => row.nodeId),
      })),
    });
  });

  app.get("/api/ops/nodes", async (req, res) => {
    const namespace = readNamespace(req);
    const registryId = readRegistryId(req, namespace);
    const nodes = await listRegistryNodes({ db, registryId });
    const connectivityRows = await listNodeConnectivity({ db, registryId, namespace });
    const connectivityByNodeId = new Map(connectivityRows.map((row) => [row.nodeId, row]));
    res.json({
      ok: true,
      registryId,
      namespace,
      count: nodes.length,
      nodes: nodes.map((row) => {
        const connectivity = connectivityByNodeId.get(row.nodeId);
        return {
          ...toOpsNodeRecord(row),
          connectivity: connectivity
            ? {
                registryId: connectivity.registryId,
                nodeId: connectivity.nodeId,
                namespace: connectivity.namespace,
                dnsOk: connectivity.dnsOk,
                pingOk: connectivity.pingOk,
                sshOk: connectivity.sshOk,
                nodeApiOk: connectivity.nodeApiOk,
                cableApiOk: connectivity.cableApiOk,
                connectivityScore: connectivity.connectivityScore,
                connectivityTotal: connectivity.connectivityTotal,
                status: connectivity.status,
                latencyMs: connectivity.latencyMs,
                errorSummary: connectivity.errorSummary ?? undefined,
                checkedAt: connectivity.checkedAt,
              }
            : null,
        };
      }),
    });
  });

  app.post("/api/ops/nodes", async (req, res) => {
    const namespace = readNamespace(req);
    const registryId = readRegistryId(req, namespace);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const parsed = NodeInventoryWriteSchema.safeParse({
      ...(body as Record<string, unknown>),
      registryId:
        typeof (body as Record<string, unknown>).registryId === "string"
          ? String((body as Record<string, unknown>).registryId)
          : registryId,
    });
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: "invalid_node_payload",
        issues: parsed.error.issues,
      });
      return;
    }
    const row = await upsertRegistryNode({ db, input: parsed.data });
    res.status(201).json({
      ok: true,
      registryId: row.registryId,
      node: toOpsNodeRecord(row),
    });
  });

  app.put("/api/ops/nodes/:nodeId", async (req, res) => {
    const params = paramsOf(req);
    const nodeId = String(params.nodeId ?? "").trim();
    if (!nodeId) {
      res.status(400).json({ ok: false, error: "node_id_required" });
      return;
    }
    const namespace = readNamespace(req);
    const registryId = readRegistryId(req, namespace);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const parsed = NodeInventoryWriteSchema.safeParse({
      ...(body as Record<string, unknown>),
      nodeId,
      registryId:
        typeof (body as Record<string, unknown>).registryId === "string"
          ? String((body as Record<string, unknown>).registryId)
          : registryId,
    });
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: "invalid_node_payload",
        issues: parsed.error.issues,
      });
      return;
    }
    const row = await upsertRegistryNode({ db, input: parsed.data });
    res.json({
      ok: true,
      registryId: row.registryId,
      node: toOpsNodeRecord(row),
    });
  });

  app.delete("/api/ops/nodes/:nodeId", async (req, res) => {
    const params = paramsOf(req);
    const nodeId = String(params.nodeId ?? "").trim();
    if (!nodeId) {
      res.status(400).json({ ok: false, error: "node_id_required" });
      return;
    }
    const namespace = readNamespace(req);
    const registryId = readRegistryId(req, namespace);
    const deleted = await deleteRegistryNode({ db, registryId, nodeId });
    if (deleted === 0) {
      res.status(404).json({ ok: false, error: "node_not_found" });
      return;
    }
    res.json({ ok: true, registryId, nodeId, deleted });
  });

  app.get("/api/ops/nodes/:nodeId/cache", async (req, res) => {
    const params = paramsOf(req);
    const query = queryOf(req);
    const nodeId = String(params.nodeId ?? "").trim();
    if (!nodeId) {
      res.status(400).json({ ok: false, error: "node_id_required" });
      return;
    }
    const namespace = readNamespace(req);
    const registryId = readRegistryId(req, namespace);
    const timeoutMs = Math.max(
      200,
      Math.min(5_000, Number(query.timeoutMs ?? 1_200) || 1_200)
    );
    const rows = await db
      .select()
      .from(schema.registryNodes)
      .where(
        and(
          eq(schema.registryNodes.registryId, registryId),
          eq(schema.registryNodes.nodeId, nodeId)
        )
      )
      .limit(1);
    const node = rows[0] ?? null;
    if (!node) {
      res.status(404).json({ ok: false, error: "node_not_found" });
      return;
    }
    const hostResolved = (node.ip || node.host || "").trim();
    if (!hostResolved) {
      res.status(400).json({ ok: false, error: "node_host_or_ip_required" });
      return;
    }
    const nodePort = node.nodePort ?? 8080;
    const remote = await fetchJson({
      url: `http://${hostResolved}:${nodePort}/api/cache`,
      timeoutMs,
      method: "GET",
    });
    if (!remote.ok) {
      res.status(502).json({
        ok: false,
        error: "node_cache_fetch_failed",
        detail: remote.error ?? `status_${remote.status ?? "unknown"}`,
      });
      return;
    }
    const parsed = NodeRuntimeCacheInspectResponseSchema.safeParse(remote.data);
    if (!parsed.success) {
      res.status(502).json({
        ok: false,
        error: "node_cache_payload_invalid",
        issues: parsed.error.issues,
      });
      return;
    }
    res.json(
      OpsNodeCacheInspectResponseSchema.parse({
        ok: true,
        nodeId,
        registryId,
        namespace,
        host: hostResolved,
        nodePort,
        cache: parsed.data.cache,
      })
    );
  });

  app.delete("/api/ops/nodes/:nodeId/cache", async (req, res) => {
    const params = paramsOf(req);
    const query = queryOf(req);
    const nodeId = String(params.nodeId ?? "").trim();
    if (!nodeId) {
      res.status(400).json({ ok: false, error: "node_id_required" });
      return;
    }
    const namespace = readNamespace(req);
    const registryId = readRegistryId(req, namespace);
    const timeoutMs = Math.max(
      200,
      Math.min(5_000, Number(query.timeoutMs ?? 3_000) || 3_000)
    );
    const rows = await db
      .select()
      .from(schema.registryNodes)
      .where(
        and(
          eq(schema.registryNodes.registryId, registryId),
          eq(schema.registryNodes.nodeId, nodeId)
        )
      )
      .limit(1);
    const node = rows[0] ?? null;
    if (!node) {
      res.status(404).json({ ok: false, error: "node_not_found" });
      return;
    }
    const hostResolved = (node.ip || node.host || "").trim();
    if (!hostResolved) {
      res.status(400).json({ ok: false, error: "node_host_or_ip_required" });
      return;
    }
    const nodePort = node.nodePort ?? 8080;
    const remote = await fetchJson({
      url: `http://${hostResolved}:${nodePort}/api/cache`,
      timeoutMs,
      method: "DELETE",
    });
    if (!remote.ok) {
      res.status(502).json({
        ok: false,
        error: "node_cache_clear_failed",
        detail: remote.error ?? `status_${remote.status ?? "unknown"}`,
      });
      return;
    }
    const parsed = NodeRuntimeCacheClearResponseSchema.safeParse(remote.data);
    if (!parsed.success) {
      res.status(502).json({
        ok: false,
        error: "node_cache_clear_payload_invalid",
        issues: parsed.error.issues,
      });
      return;
    }
    res.json(
      OpsNodeCacheClearResponseSchema.parse({
        ok: true,
        nodeId,
        registryId,
        namespace,
        host: hostResolved,
        nodePort,
        deletedFiles: parsed.data.deletedFiles,
        deletedBytes: parsed.data.deletedBytes,
        before: parsed.data.before,
        after: parsed.data.after,
      })
    );
  });

  app.get("/api/ops/nodes/:nodeId/runtime-status", async (req, res) => {
    const params = paramsOf(req);
    const query = queryOf(req);
    const nodeId = String(params.nodeId ?? "").trim();
    if (!nodeId) {
      res.status(400).json({ ok: false, error: "node_id_required" });
      return;
    }
    const namespace = readNamespace(req);
    const registryId = readRegistryId(req, namespace);
    const timeoutMs = Math.max(
      200,
      Math.min(5_000, Number(query.timeoutMs ?? 1_200) || 1_200)
    );
    const rows = await db
      .select()
      .from(schema.registryNodes)
      .where(
        and(
          eq(schema.registryNodes.registryId, registryId),
          eq(schema.registryNodes.nodeId, nodeId)
        )
      )
      .limit(1);
    const node = rows[0] ?? null;
    if (!node) {
      res.status(404).json({ ok: false, error: "node_not_found" });
      return;
    }
    const hostResolved = (node.ip || node.host || "").trim();
    if (!hostResolved) {
      res.status(400).json({ ok: false, error: "node_host_or_ip_required" });
      return;
    }
    const nodePort = node.nodePort ?? 8080;
    const remote = await fetchJson({
      url: `http://${hostResolved}:${nodePort}/status`,
      timeoutMs,
      method: "GET",
    });
    if (!remote.ok) {
      res.status(502).json({
        ok: false,
        error: "node_runtime_status_fetch_failed",
        detail: remote.error ?? `status_${remote.status ?? "unknown"}`,
      });
      return;
    }
    const payload =
      remote.data && typeof remote.data === "object"
        ? (remote.data as Record<string, unknown>)
        : null;
    const runtimeParsed = NodeRuntimeStatusSnapshotSchema.safeParse(
      payload?.runtime
    );
    if (!runtimeParsed.success) {
      res.status(502).json({
        ok: false,
        error: "node_runtime_status_payload_invalid",
        issues: runtimeParsed.error.issues,
      });
      return;
    }
    res.json(
      OpsNodeRuntimeStatusResponseSchema.parse({
        ok: true,
        nodeId,
        registryId,
        namespace,
        host: hostResolved,
        nodePort,
        status: runtimeParsed.data,
      })
    );
  });

  app.post("/api/ops/nodes/:nodeId/input", async (req, res) => {
    const params = paramsOf(req);
    const query = queryOf(req);
    const nodeId = String(params.nodeId ?? "").trim();
    if (!nodeId) {
      res.status(400).json({ ok: false, error: "node_id_required" });
      return;
    }
    const parsedBody = NodeRuntimeInputRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        ok: false,
        error: "invalid_node_input_payload",
        issues: parsedBody.error.issues,
      });
      return;
    }
    const namespace = readNamespace(req);
    const registryId = readRegistryId(req, namespace);
    const timeoutMs = Math.max(
      200,
      Math.min(5_000, Number(query.timeoutMs ?? 1_500) || 1_500)
    );
    const rows = await db
      .select()
      .from(schema.registryNodes)
      .where(
        and(
          eq(schema.registryNodes.registryId, registryId),
          eq(schema.registryNodes.nodeId, nodeId)
        )
      )
      .limit(1);
    const node = rows[0] ?? null;
    if (!node) {
      res.status(404).json({ ok: false, error: "node_not_found" });
      return;
    }
    const hostResolved = (node.ip || node.host || "").trim();
    if (!hostResolved) {
      res.status(400).json({ ok: false, error: "node_host_or_ip_required" });
      return;
    }
    const nodePort = node.nodePort ?? 8080;
    const remote = await fetchJson({
      url: `http://${hostResolved}:${nodePort}/api/input`,
      timeoutMs,
      method: "POST",
      body: parsedBody.data,
    });
    if (!remote.ok) {
      const remoteData =
        remote.data && typeof remote.data === "object"
          ? (remote.data as Record<string, unknown>)
          : null;
      const detail =
        (remoteData && typeof remoteData.error === "string"
          ? remoteData.error
          : null) ??
        remote.error ??
        `status_${remote.status ?? "unknown"}`;
      res.status(502).json({
        ok: false,
        error: "node_input_passthrough_failed",
        detail,
      });
      return;
    }
    const parsed = NodeRuntimeInputResponseSchema.safeParse(remote.data);
    if (!parsed.success) {
      res.status(502).json({
        ok: false,
        error: "node_input_payload_invalid",
        issues: parsed.error.issues,
      });
      return;
    }
    res.json(
      OpsNodeInputResponseSchema.parse({
        ok: true,
        nodeId,
        registryId,
        namespace,
        host: hostResolved,
        nodePort,
        backend: parsed.data.backend,
        action: parsed.data.action,
        command: parsed.data.command,
        code: parsed.data.code,
        ...(parsed.data.stdout ? { stdout: parsed.data.stdout } : {}),
        ...(parsed.data.stderr ? { stderr: parsed.data.stderr } : {}),
      })
    );
  });

  app.get("/api/ops/nodes/export", async (req, res) => {
    const namespace = readNamespace(req);
    const registryId = readRegistryId(req, namespace);
    const query = queryOf(req);
    const formatRaw = String(query.format ?? "json").trim().toLowerCase();
    const format = formatRaw === "toml" ? "toml" : "json";
    const nodes = await listRegistryNodes({ db, registryId });
    const connectivityRows = await listNodeConnectivity({ db, registryId, namespace });

    if (format === "toml") {
      const toml = toRegistryToml({ nodes });
      res.setHeader("content-type", "application/toml; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="registry.${registryId}.toml"`
      );
      res.send(toml);
      return;
    }

    const payload = {
      ok: true,
      registryId,
      namespace,
      exportedAt: Date.now(),
      nodes: nodes.map((row) => toOpsNodeRecord(row)),
      connectivity: connectivityRows.map((row) => ({
        registryId: row.registryId,
        nodeId: row.nodeId,
        namespace: row.namespace,
        dnsOk: row.dnsOk,
        pingOk: row.pingOk,
        sshOk: row.sshOk,
        nodeApiOk: row.nodeApiOk,
        cableApiOk: row.cableApiOk,
        connectivityScore: row.connectivityScore,
        connectivityTotal: row.connectivityTotal,
        status: row.status,
        latencyMs: row.latencyMs,
        errorSummary: row.errorSummary ?? undefined,
        checkedAt: row.checkedAt,
      })),
    };
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader(
      "content-disposition",
      `attachment; filename="registry.${registryId}.json"`
    );
    res.send(JSON.stringify(payload, null, 2));
  });

  app.get("/api/ops/fleet", async (req, res) => {
    const namespace = readNamespace(req);
    const registryId = readRegistryId(req, namespace);
    const query = queryOf(req);
    const timeoutMs = Math.max(
      200,
      Math.min(5_000, Number(query.timeoutMs ?? 1_200) || 1_200)
    );
    const nodes = await listRegistryNodes({ db, registryId });
    const pis = await Promise.all(
      nodes.map((node) => probeFleetNode({ db, node, namespace, timeoutMs }))
    );
    res.json({
      now: Date.now(),
      local: { gitSha: null, registryPath: `db://registries/${registryId}` },
      pis,
    });
  });

  app.get("/api/ops/fleet/stream", async (req, res) => {
    const namespace = readNamespace(req);
    const registryId = readRegistryId(req, namespace);
    const query = queryOf(req);
    const timeoutMs = Math.max(
      200,
      Math.min(5_000, Number(query.timeoutMs ?? 1_200) || 1_200)
    );
    const nodes = await listRegistryNodes({ db, registryId });

    const stream = res.raw;
    stream.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });

    eventWrite(stream, "meta", {
      now: Date.now(),
      local: { gitSha: null, registryPath: `db://registries/${registryId}` },
      pis: nodes.map((node) => ({
        registryId: node.registryId,
        id: node.nodeId,
        host: node.host ?? "",
        ip: node.ip,
        nodeName: node.nodeName ?? node.nodeId,
      })),
      probes: {
        timeoutMs,
        concurrency: 8,
        mode: "control-plane",
      },
    });

    for (const node of nodes) {
      const payload = await probeFleetNode({ db, node, namespace, timeoutMs });
      eventWrite(stream, "pi", payload);
    }
    eventWrite(stream, "done", { ok: true });
    stream.end();
  });

  app.get("/api/ops/pi", async (req, res) => {
    const namespace = readNamespace(req);
    const registryId = readRegistryId(req, namespace);
    const query = queryOf(req);
    const id = String(query.id ?? "").trim();
    const timeoutMs = Math.max(
      200,
      Math.min(5_000, Number(query.timeoutMs ?? 1_200) || 1_200)
    );
    if (!id) {
      res.status(400).json({ ok: false, error: "id_required" });
      return;
    }
    const rows = await db
      .select()
      .from(schema.registryNodes)
      .where(
        and(
          eq(schema.registryNodes.registryId, registryId),
          eq(schema.registryNodes.nodeId, id)
        )
      );
    const row = rows[0];
    if (!row) {
      res.status(404).json({ ok: false, error: "node_not_found" });
      return;
    }
    const payload = await probeFleetNode({
      db,
      node: row,
      namespace,
      timeoutMs,
    });
    res.json(payload);
  });

  app.post("/api/ops/apply-target", async (req, res) => {
    const parsed = OpsApplyTargetRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: "invalid_target",
        message: "Provide { target: \"profile|channel|block|playlist|media\", id: \"...\" }",
        issues: parsed.error.issues,
      });
      return;
    }

    const namespace = parsed.data.namespace?.trim() || readNamespace(req);
    const registryId = parsed.data.registryId?.trim() || readRegistryId(req, namespace);
    const controllerId =
      parsed.data.controllerId?.trim() || "ops-ui";
    const dryRun = parsed.data.dryRun === true;

    const nodes = await listRegistryNodes({ db, registryId });
    const nodeMap = new Map(nodes.map((node) => [node.nodeId, node]));
    const requestedNodeIds =
      parsed.data.piIds.length > 0
        ? parsed.data.piIds
        : nodes.map((node) => node.nodeId);

    const requestLaunch = sanitizeLaunch({
      mode: parsed.data.mode,
      lock: parsed.data.lock,
      qr: parsed.data.showQr ?? parsed.data.qr,
      nosplash: parsed.data.nosplash,
      hudMode: parsed.data.hudMode,
      hudSec: parsed.data.hudShowSec,
      theme: parsed.data.theme,
      displayRotate: parsed.data.displayRotate,
    });
    const modeExplicit = typeof parsed.data.mode === "string";

    const snapshot = await getResourceSnapshot({ db });
    if (
      parsed.data.target !== "profile" &&
      !targetExistsInSnapshot({
        snapshot,
        target: parsed.data.target,
        id: parsed.data.id,
      })
    ) {
      res.status(404).json({
        ok: false,
        error: `${parsed.data.target}_not_found`,
        target: parsed.data.target,
        id: parsed.data.id,
      });
      return;
    }
    const profile =
      parsed.data.target === "profile"
        ? snapshot.profiles.find((row) => row.id === parsed.data.id)
        : null;

    const results: Array<{
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
      state: { ok: boolean; status: number | null; ms: number | null; error?: string } | null;
      prefetch: null;
    }> = [];

    const applyStarted = Date.now();
    for (const nodeId of requestedNodeIds) {
      const node = nodeMap.get(nodeId);
      if (!node) {
        results.push({
          id: nodeId,
          host: "",
          ip: null,
          nodeName: nodeId,
          guidePort: 5173,
          url: "",
          ok: false,
          status: 404,
          ms: 0,
          error: "node_not_found",
          state: { ok: false, status: 404, ms: 0, error: "node_not_found" },
          prefetch: null,
        });
        continue;
      }

      let target: DesiredTarget | null = null;
      let launch: LaunchOptions = normalizeOpsApplyLaunch({
        target: parsed.data.target,
        launch: requestLaunch,
        modeExplicit,
      });
      if (parsed.data.target === "profile") {
        if (!profile) {
          results.push({
            id: nodeId,
            host: node.host ?? "",
            ip: node.ip ?? null,
            nodeName: node.nodeName ?? nodeId,
            guidePort: node.guidePort ?? 5173,
            url: "",
            ok: false,
            status: 404,
            ms: 0,
            error: "profile_not_found",
            state: {
              ok: false,
              status: 404,
              ms: 0,
              error: "profile_not_found",
            },
            prefetch: null,
          });
          continue;
        }
        const nodeOverride = profile.nodes.find((row) => row.nodeId === nodeId);
        target = nodeOverride?.target ?? profile.defaultTarget ?? null;
        launch = mergeLaunch(profile.defaults ?? {}, nodeOverride?.launch ?? {}, requestLaunch);
      } else {
        target = {
          kind: parsed.data.target,
          id: parsed.data.id,
        };
      }

      if (!target) {
        results.push({
          id: nodeId,
          host: node.host ?? "",
          ip: node.ip ?? null,
          nodeName: node.nodeName ?? nodeId,
          guidePort: node.guidePort ?? 5173,
          url: "",
          ok: false,
          status: 400,
          ms: 0,
          error: "missing_target",
          state: { ok: false, status: 400, ms: 0, error: "missing_target" },
          prefetch: null,
        });
        continue;
      }

      const url = buildKioskUrl({
        screenId: nodeId,
        guidePort: node.guidePort ?? 5173,
        target,
        launch,
      });

      if (dryRun) {
        results.push({
          id: nodeId,
          host: node.host ?? "",
          ip: node.ip ?? null,
          nodeName: node.nodeName ?? nodeId,
          guidePort: node.guidePort ?? 5173,
          url,
          ok: true,
          status: 200,
          ms: 0,
          error: null,
          state: { ok: true, status: 200, ms: 0 },
          prefetch: null,
        });
        continue;
      }

      const started = Date.now();
      const applyResult = await applyScreenAssignment({
        db,
        input: {
          screenId: nodeId,
          namespace,
          controllerId,
          operationId: `${controllerId}:${nodeId}:${randomUUID()}`,
          target,
          launch,
        },
      });
      const elapsed = Date.now() - started;

      if (!applyResult.ok) {
        results.push({
          id: nodeId,
          host: node.host ?? "",
          ip: node.ip ?? null,
          nodeName: node.nodeName ?? nodeId,
          guidePort: node.guidePort ?? 5173,
          url,
          ok: false,
          status: 409,
          ms: elapsed,
          error: `revision_conflict:${applyResult.conflict.actualRevision}`,
          state: {
            ok: false,
            status: 409,
            ms: elapsed,
            error: `revision_conflict:${applyResult.conflict.actualRevision}`,
          },
          prefetch: null,
        });
      } else {
        results.push({
          id: nodeId,
          host: node.host ?? "",
          ip: node.ip ?? null,
          nodeName: node.nodeName ?? nodeId,
          guidePort: node.guidePort ?? 5173,
          url,
          ok: true,
          status: 200,
          ms: elapsed,
          error: null,
          state: { ok: true, status: 200, ms: elapsed },
          prefetch: null,
        });
      }
    }

    const overallOk = results.every((row) => row.ok);
    res.json({
      ok: overallOk,
      target: parsed.data.target,
      id: parsed.data.id,
      modePath:
        parsed.data.target === "profile"
          ? `db://profiles/${parsed.data.id}`
          : undefined,
      results,
      ms: Date.now() - applyStarted,
    });
  });

  app.post("/api/ops/open-guide", async (req, res) => {
    const parsed = OpsOpenGuideRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: "invalid_open_guide_request",
        issues: parsed.error.issues,
      });
      return;
    }
    const namespace = parsed.data.namespace?.trim() || readNamespace(req);
    const registryId = parsed.data.registryId?.trim() || readRegistryId(req, namespace);
    const controllerId =
      parsed.data.controllerId?.trim() || "ops-ui";
    const dryRun = parsed.data.dryRun === true;

    const nodes = await listRegistryNodes({ db, registryId });
    const nodeMap = new Map(nodes.map((node) => [node.nodeId, node]));
    const requestedNodeIds =
      parsed.data.piIds.length > 0
        ? parsed.data.piIds
        : nodes.map((node) => node.nodeId);

    const overrideLaunch = sanitizeLaunch({
      mode: "guide",
      lock: parsed.data.lock,
      qr: parsed.data.showQr ?? parsed.data.qr,
      nosplash: parsed.data.nosplash,
    });
    const snapshot = await getResourceSnapshot({ db });

    const results: Array<{
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
      state: { ok: boolean; status: number | null; ms: number | null; error?: string } | null;
      prefetch: null;
    }> = [];

    for (const nodeId of requestedNodeIds) {
      const node = nodeMap.get(nodeId);
      if (!node) {
        results.push({
          id: nodeId,
          host: "",
          ip: null,
          nodeName: nodeId,
          guidePort: 5173,
          url: "",
          ok: false,
          status: 404,
          ms: 0,
          error: "node_not_found",
          state: { ok: false, status: 404, ms: 0, error: "node_not_found" },
          prefetch: null,
        });
        continue;
      }
      const desired = await getDesiredScreenState({
        db,
        screenId: nodeId,
        namespace,
      });
      const fallbackTarget = pickFallbackTarget(snapshot);
      if (!desired && !fallbackTarget) {
        results.push({
          id: nodeId,
          host: node.host ?? "",
          ip: node.ip ?? null,
          nodeName: node.nodeName ?? nodeId,
          guidePort: node.guidePort ?? 5173,
          url: "",
          ok: false,
          status: 400,
          ms: 0,
          error: "no_existing_target_for_guide_mode",
          state: {
            ok: false,
            status: 400,
            ms: 0,
            error: "no_existing_target_for_guide_mode",
          },
          prefetch: null,
        });
        continue;
      }

      const target: DesiredTarget = desired
        ? {
            kind: desired.targetKind as DesiredTarget["kind"],
            id: desired.targetId,
          }
        : (fallbackTarget as DesiredTarget);
      const launch = mergeLaunch(desired?.launch ?? {}, overrideLaunch);
      const url = buildKioskUrl({
        screenId: nodeId,
        guidePort: node.guidePort ?? 5173,
        target,
        launch,
      });

      if (dryRun) {
        results.push({
          id: nodeId,
          host: node.host ?? "",
          ip: node.ip ?? null,
          nodeName: node.nodeName ?? nodeId,
          guidePort: node.guidePort ?? 5173,
          url,
          ok: true,
          status: 200,
          ms: 0,
          error: null,
          state: { ok: true, status: 200, ms: 0 },
          prefetch: null,
        });
        continue;
      }

      const started = Date.now();
      const applyResult = await applyScreenAssignment({
        db,
        input: {
          screenId: nodeId,
          namespace,
          controllerId,
          operationId: `${controllerId}:${nodeId}:${randomUUID()}`,
          target,
          launch,
        },
      });
      const elapsed = Date.now() - started;
      if (!applyResult.ok) {
        results.push({
          id: nodeId,
          host: node.host ?? "",
          ip: node.ip ?? null,
          nodeName: node.nodeName ?? nodeId,
          guidePort: node.guidePort ?? 5173,
          url,
          ok: false,
          status: 409,
          ms: elapsed,
          error: `revision_conflict:${applyResult.conflict.actualRevision}`,
          state: {
            ok: false,
            status: 409,
            ms: elapsed,
            error: `revision_conflict:${applyResult.conflict.actualRevision}`,
          },
          prefetch: null,
        });
      } else {
        results.push({
          id: nodeId,
          host: node.host ?? "",
          ip: node.ip ?? null,
          nodeName: node.nodeName ?? nodeId,
          guidePort: node.guidePort ?? 5173,
          url,
          ok: true,
          status: 200,
          ms: elapsed,
          error: null,
          state: { ok: true, status: 200, ms: elapsed },
          prefetch: null,
        });
      }
    }

    res.json({
      ok: results.every((row) => row.ok),
      results,
    });
  });

  const port = Number(process.env.PORT ?? "8795");
  const host = process.env.HOST ?? "0.0.0.0";
  await app.listen({ port, host });
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ok: true,
      service: "cable3-control-api",
      host,
      port,
      ts: Date.now(),
    })
  );

  const shutdown = async () => {
    clearInterval(wsHeartbeatTimer);
    for (const client of wss.clients) {
      try {
        client.close();
      } catch {
        // ignore close failures
      }
    }
    wss.close();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  );
  process.exit(1);
});
