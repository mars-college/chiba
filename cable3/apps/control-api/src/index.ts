import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";
import type { IncomingMessage, ServerResponse } from "node:http";
import Fastify, { type FastifyReply } from "fastify";
import { lookup as lookupMimeType } from "mime-types";
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

function mediaContentTypeForPath(filePath: string): string {
  const guessed = lookupMimeType(filePath);
  return typeof guessed === "string" && guessed ? guessed : "application/octet-stream";
}

const DEFAULT_NAMESPACE = process.env.CHIBA3_NAMESPACE?.trim() || "local";
const DEFAULT_REGISTRY_ID =
  process.env.CHIBA3_REGISTRY_ID?.trim() || DEFAULT_NAMESPACE;

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

function resolveTargetMedia(args: {
  snapshot: ResourceSnapshot;
  target: DesiredTarget;
  streamBaseUrl: string;
}): { items: ResolvedPlaybackItem[]; warnings: string[] } {
  const mediaById = new Map(args.snapshot.media.map((row) => [row.id, row]));
  const playlistById = new Map(args.snapshot.playlists.map((row) => [row.id, row]));
  const blockById = new Map(args.snapshot.blocks.map((row) => [row.id, row]));
  const channelById = new Map(args.snapshot.channels.map((row) => [row.id, row]));
  const profileById = new Map(args.snapshot.profiles.map((row) => [row.id, row]));
  const warnings: string[] = [];
  const items: ResolvedPlaybackItem[] = [];

  const mediaStreamVersion = (media: MediaResource): string => {
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
  };

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
      const version = mediaStreamVersion(media);
      sourceValue = `${args.streamBaseUrl}/api/v1/resources/media/${encodeURIComponent(media.id)}/stream?v=${version}`;
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

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "cable3-control-api", ts: Date.now() });
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
    const resolved = resolveTargetMedia({
      snapshot,
      target,
      streamBaseUrl,
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
      if (!desired) {
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

      const target: DesiredTarget = {
        kind: desired.targetKind as DesiredTarget["kind"],
        id: desired.targetId,
      };
      const launch = mergeLaunch(desired.launch, overrideLaunch);
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
