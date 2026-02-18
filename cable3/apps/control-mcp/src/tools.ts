import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type NodeStateInput = {
  screenId: string;
  namespace?: string;
};

type ApplyInput = {
  targetKind: "media" | "playlist" | "block" | "channel" | "profile";
  targetId: string;
  nodeIds: string[];
  namespace?: string;
  registryId?: string;
  controllerId?: string;
  launch?: {
    mode?: "guide" | "gallery";
    lock?: boolean;
    qr?: boolean;
    nosplash?: boolean;
    hudMode?: "always" | "start" | "never";
    hudShowSec?: number;
    theme?: string;
    displayRotate?: 0 | 90 | 180 | 270;
  };
};

type IngestYoutubeInput = {
  url: string;
  mediaId?: string;
  title?: string;
  artist?: string;
  cache?: boolean;
  wait?: boolean;
  timeoutMs?: number;
};

type IngestEdenInput = {
  input: string;
  db?: "PROD" | "STAGE";
  playlistId?: string;
  apiKey?: string;
  wait?: boolean;
  timeoutMs?: number;
};

type IngestUploadPathsInput = {
  paths: string[];
  wait?: boolean;
  timeoutMs?: number;
};

function controlApiBase(): string {
  return process.env.CHIBA3_CONTROL_API_URL?.trim() || "http://127.0.0.1:8795";
}

async function fetchJson(args: {
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
}): Promise<unknown> {
  const url = new URL(args.path, controlApiBase());
  const init: RequestInit = {
    method: args.method ?? "GET",
    ...(args.body ? { headers: { "content-type": "application/json" } } : {}),
    ...(args.body ? { body: JSON.stringify(args.body) } : {}),
  };
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`http_${res.status}:${JSON.stringify(data)}`);
  }
  return data;
}

function ensureObject(input: unknown, context: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`invalid_args:${context}:expected_object`);
  }
  return input as Record<string, unknown>;
}

function readRequiredString(
  obj: Record<string, unknown>,
  key: string,
  context: string
): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`invalid_args:${context}:${key}`);
  }
  return value.trim();
}

function readOptionalString(
  obj: Record<string, unknown>,
  key: string,
  context: string
): string | undefined {
  if (!(key in obj) || obj[key] == null) return undefined;
  const value = obj[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`invalid_args:${context}:${key}`);
  }
  return value.trim();
}

function readOptionalBoolean(
  obj: Record<string, unknown>,
  key: string,
  context: string
): boolean | undefined {
  if (!(key in obj) || obj[key] == null) return undefined;
  const value = obj[key];
  if (typeof value !== "boolean") {
    throw new Error(`invalid_args:${context}:${key}`);
  }
  return value;
}

function readOptionalPositiveInt(
  obj: Record<string, unknown>,
  key: string,
  context: string,
  max = Number.MAX_SAFE_INTEGER
): number | undefined {
  if (!(key in obj) || obj[key] == null) return undefined;
  const value = obj[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > max) {
    throw new Error(`invalid_args:${context}:${key}`);
  }
  return value;
}

function readEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  values: readonly T[],
  context: string
): T {
  const raw = readRequiredString(obj, key, context);
  if (!values.includes(raw as T)) {
    throw new Error(`invalid_args:${context}:${key}`);
  }
  return raw as T;
}

function readOptionalEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  values: readonly T[],
  context: string
): T | undefined {
  const value = readOptionalString(obj, key, context);
  if (value == null) return undefined;
  if (!values.includes(value as T)) {
    throw new Error(`invalid_args:${context}:${key}`);
  }
  return value as T;
}

function readStringArray(
  obj: Record<string, unknown>,
  key: string,
  context: string
): string[] {
  const value = obj[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`invalid_args:${context}:${key}`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`invalid_args:${context}:${key}`);
    }
    out.push(item.trim());
  }
  return out;
}

function parseNodeStateInput(input: unknown): NodeStateInput {
  const obj = ensureObject(input, "node_state");
  const out: NodeStateInput = {
    screenId: readRequiredString(obj, "screenId", "node_state"),
  };
  const namespace = readOptionalString(obj, "namespace", "node_state");
  if (namespace !== undefined) out.namespace = namespace;
  return out;
}

function parseApplyInput(input: unknown): ApplyInput {
  const obj = ensureObject(input, "apply_mpbcp_to_nodes");
  const launchRaw = obj.launch;
  let launch: ApplyInput["launch"];
  if (launchRaw != null) {
    const launchObj = ensureObject(launchRaw, "apply_mpbcp_to_nodes.launch");
    const displayRotateRaw = launchObj.displayRotate;
    let displayRotate: 0 | 90 | 180 | 270 | undefined;
    if (displayRotateRaw != null) {
      if (
        typeof displayRotateRaw !== "number" ||
        ![0, 90, 180, 270].includes(displayRotateRaw)
      ) {
        throw new Error("invalid_args:apply_mpbcp_to_nodes:launch.displayRotate");
      }
      displayRotate = displayRotateRaw as 0 | 90 | 180 | 270;
    }
    const hudShowSec = readOptionalPositiveInt(
      launchObj,
      "hudShowSec",
      "apply_mpbcp_to_nodes.launch"
    );
    const mode = readOptionalEnum(
      launchObj,
      "mode",
      ["guide", "gallery"],
      "apply_mpbcp_to_nodes.launch"
    );
    const lock = readOptionalBoolean(launchObj, "lock", "apply_mpbcp_to_nodes.launch");
    const qr = readOptionalBoolean(launchObj, "qr", "apply_mpbcp_to_nodes.launch");
    const nosplash = readOptionalBoolean(
      launchObj,
      "nosplash",
      "apply_mpbcp_to_nodes.launch"
    );
    const hudMode = readOptionalEnum(
      launchObj,
      "hudMode",
      ["always", "start", "never"],
      "apply_mpbcp_to_nodes.launch"
    );
    const theme = readOptionalString(launchObj, "theme", "apply_mpbcp_to_nodes.launch");
    launch = {};
    if (mode !== undefined) launch.mode = mode;
    if (lock !== undefined) launch.lock = lock;
    if (qr !== undefined) launch.qr = qr;
    if (nosplash !== undefined) launch.nosplash = nosplash;
    if (hudMode !== undefined) launch.hudMode = hudMode;
    if (hudShowSec !== undefined) launch.hudShowSec = hudShowSec;
    if (theme !== undefined) launch.theme = theme;
    if (displayRotate !== undefined) launch.displayRotate = displayRotate;
  }

  const out: ApplyInput = {
    targetKind: readEnum(
      obj,
      "targetKind",
      ["media", "playlist", "block", "channel", "profile"],
      "apply_mpbcp_to_nodes"
    ),
    targetId: readRequiredString(obj, "targetId", "apply_mpbcp_to_nodes"),
    nodeIds: readStringArray(obj, "nodeIds", "apply_mpbcp_to_nodes"),
  };
  const namespace = readOptionalString(obj, "namespace", "apply_mpbcp_to_nodes");
  const registryId = readOptionalString(obj, "registryId", "apply_mpbcp_to_nodes");
  const controllerId = readOptionalString(obj, "controllerId", "apply_mpbcp_to_nodes");
  if (namespace !== undefined) out.namespace = namespace;
  if (registryId !== undefined) out.registryId = registryId;
  if (controllerId !== undefined) out.controllerId = controllerId;
  if (launch !== undefined) out.launch = launch;
  return out;
}

function parseIngestYoutubeInput(input: unknown): IngestYoutubeInput {
  const obj = ensureObject(input, "ingest_youtube");
  const url = readRequiredString(obj, "url", "ingest_youtube");
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("invalid");
  } catch {
    throw new Error("invalid_args:ingest_youtube:url");
  }
  const timeoutMs = readOptionalPositiveInt(obj, "timeoutMs", "ingest_youtube", 600_000);
  const mediaId = readOptionalString(obj, "mediaId", "ingest_youtube");
  const title = readOptionalString(obj, "title", "ingest_youtube");
  const artist = readOptionalString(obj, "artist", "ingest_youtube");
  const cache = readOptionalBoolean(obj, "cache", "ingest_youtube");
  const wait = readOptionalBoolean(obj, "wait", "ingest_youtube");
  const out: IngestYoutubeInput = {
    url,
  };
  if (mediaId !== undefined) out.mediaId = mediaId;
  if (title !== undefined) out.title = title;
  if (artist !== undefined) out.artist = artist;
  if (cache !== undefined) out.cache = cache;
  if (wait !== undefined) out.wait = wait;
  if (timeoutMs !== undefined) out.timeoutMs = timeoutMs;
  return out;
}

function parseIngestEdenInput(input: unknown): IngestEdenInput {
  const obj = ensureObject(input, "ingest_eden_collection");
  const timeoutMs = readOptionalPositiveInt(
    obj,
    "timeoutMs",
    "ingest_eden_collection",
    600_000
  );
  const db = readOptionalEnum(obj, "db", ["PROD", "STAGE"], "ingest_eden_collection");
  const playlistId = readOptionalString(obj, "playlistId", "ingest_eden_collection");
  const apiKey = readOptionalString(obj, "apiKey", "ingest_eden_collection");
  const wait = readOptionalBoolean(obj, "wait", "ingest_eden_collection");
  const out: IngestEdenInput = {
    input: readRequiredString(obj, "input", "ingest_eden_collection"),
  };
  if (db !== undefined) out.db = db;
  if (playlistId !== undefined) out.playlistId = playlistId;
  if (apiKey !== undefined) out.apiKey = apiKey;
  if (wait !== undefined) out.wait = wait;
  if (timeoutMs !== undefined) out.timeoutMs = timeoutMs;
  return out;
}

function parseIngestUploadPathsInput(input: unknown): IngestUploadPathsInput {
  const obj = ensureObject(input, "ingest_upload_paths");
  const timeoutMs = readOptionalPositiveInt(obj, "timeoutMs", "ingest_upload_paths", 600_000);
  const wait = readOptionalBoolean(obj, "wait", "ingest_upload_paths");
  const out: IngestUploadPathsInput = {
    paths: readStringArray(obj, "paths", "ingest_upload_paths"),
  };
  if (wait !== undefined) out.wait = wait;
  if (timeoutMs !== undefined) out.timeoutMs = timeoutMs;
  return out;
}

export const TOOLS: McpTool[] = [
  {
    name: "mpbcp_snapshot",
    description: "Query the current MPBCP resource snapshot (media/playlists/blocks/channels/profiles).",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "node_state",
    description: "Query desired/runtime node state for a screen/node id.",
    inputSchema: {
      type: "object",
      properties: {
        screenId: { type: "string" },
        namespace: { type: "string" },
      },
      required: ["screenId"],
    },
  },
  {
    name: "apply_mpbcp_to_nodes",
    description: "Apply a media/playlist/block/channel/profile target to one or more nodes.",
    inputSchema: {
      type: "object",
      properties: {
        targetKind: { type: "string", enum: ["media", "playlist", "block", "channel", "profile"] },
        targetId: { type: "string" },
        nodeIds: { type: "array", items: { type: "string" } },
        namespace: { type: "string" },
        registryId: { type: "string" },
        controllerId: { type: "string" },
        launch: { type: "object" },
      },
      required: ["targetKind", "targetId", "nodeIds"],
    },
  },
  {
    name: "ingest_youtube",
    description: "Ingest YouTube media via control-api ingestion jobs.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        mediaId: { type: "string" },
        title: { type: "string" },
        artist: { type: "string" },
        cache: { type: "boolean" },
        wait: { type: "boolean" },
        timeoutMs: { type: "number" },
      },
      required: ["url"],
    },
  },
  {
    name: "ingest_eden_collection",
    description: "Ingest an Eden collection into media + playlist via control-api ingestion jobs.",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string" },
        db: { type: "string", enum: ["PROD", "STAGE"] },
        playlistId: { type: "string" },
        apiKey: { type: "string" },
        wait: { type: "boolean" },
        timeoutMs: { type: "number" },
      },
      required: ["input"],
    },
  },
  {
    name: "ingest_upload_paths",
    description: "Ingest local media files or zip archives by file path through control-api upload jobs.",
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" } },
        wait: { type: "boolean" },
        timeoutMs: { type: "number" },
      },
      required: ["paths"],
    },
  },
];

function asText(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function asError(error: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: error }],
  };
}

async function waitForJob(args: {
  jobId: string;
  timeoutMs: number;
}): Promise<unknown> {
  const started = Date.now();
  while (Date.now() - started < args.timeoutMs) {
    const jobRes = (await fetchJson({
      path: `/api/v1/ingest/jobs/${encodeURIComponent(args.jobId)}`,
    })) as Record<string, unknown>;
    const job =
      jobRes && typeof jobRes === "object" && jobRes.job && typeof jobRes.job === "object"
        ? (jobRes.job as Record<string, unknown>)
        : null;
    if (!job) return jobRes;
    const status = String(job.status ?? "");
    if (status === "succeeded" || status === "failed") return jobRes;
    await sleep(1000);
  }
  throw new Error(`job_timeout:${args.jobId}`);
}

async function toUploadForm(pathsInput: string[]): Promise<FormData> {
  const form = new FormData();
  for (const raw of pathsInput) {
    const filePath = path.resolve(raw);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error(`path_not_file:${filePath}`);
    const bytes = await fs.readFile(filePath);
    const base = path.basename(filePath);
    if (base.toLowerCase().endsWith(".zip")) {
      form.append("archive", new File([bytes], base, { type: "application/zip" }));
      continue;
    }
    form.append("files", new File([bytes], base));
  }
  return form;
}

export async function handleToolCall(args: {
  name: string;
  input: unknown;
}): Promise<ToolResult> {
  try {
    if (args.name === "mpbcp_snapshot") {
      const data = await fetchJson({ path: "/api/v1/resources/snapshot" });
      return asText(data);
    }

    if (args.name === "node_state") {
      const parsed = parseNodeStateInput(args.input ?? {});
      const ns = parsed.namespace ? `?namespace=${encodeURIComponent(parsed.namespace)}` : "";
      const data = await fetchJson({
        path: `/api/v1/screen-assignment/${encodeURIComponent(parsed.screenId)}${ns}`,
      });
      return asText(data);
    }

    if (args.name === "apply_mpbcp_to_nodes") {
      const parsed = parseApplyInput(args.input ?? {});
      const data = await fetchJson({
        path: "/api/ops/apply-target",
        method: "POST",
        body: {
          target: parsed.targetKind,
          id: parsed.targetId,
          piIds: parsed.nodeIds,
          ...(parsed.namespace ? { namespace: parsed.namespace } : {}),
          ...(parsed.registryId ? { registryId: parsed.registryId } : {}),
          ...(parsed.controllerId ? { controllerId: parsed.controllerId } : {}),
          ...(parsed.launch ?? {}),
        },
      });
      return asText(data);
    }

    if (args.name === "ingest_youtube") {
      const parsed = parseIngestYoutubeInput(args.input ?? {});
      const queueStart = (await fetchJson({
        path: "/api/v1/ingest/jobs/youtube",
        method: "POST",
        body: {
          url: parsed.url,
          ...(parsed.mediaId ? { mediaId: parsed.mediaId } : {}),
          ...(parsed.title ? { title: parsed.title } : {}),
          ...(parsed.artist ? { artist: parsed.artist } : {}),
          ...(typeof parsed.cache === "boolean" ? { cache: parsed.cache } : {}),
        },
      })) as Record<string, unknown>;
      if (parsed.wait === false) return asText(queueStart);
      const jobId = String(
        (queueStart.job as Record<string, unknown> | undefined)?.id ?? ""
      );
      if (!jobId) return asText(queueStart);
      const done = await waitForJob({
        jobId,
        timeoutMs: parsed.timeoutMs ?? 300_000,
      });
      return asText(done);
    }

    if (args.name === "ingest_eden_collection") {
      const parsed = parseIngestEdenInput(args.input ?? {});
      const queueStart = (await fetchJson({
        path: "/api/v1/ingest/jobs/eden-collection",
        method: "POST",
        body: {
          input: parsed.input,
          ...(parsed.db ? { db: parsed.db } : {}),
          ...(parsed.playlistId ? { playlistId: parsed.playlistId } : {}),
          ...(parsed.apiKey ? { apiKey: parsed.apiKey } : {}),
        },
      })) as Record<string, unknown>;
      if (parsed.wait === false) return asText(queueStart);
      const jobId = String(
        (queueStart.job as Record<string, unknown> | undefined)?.id ?? ""
      );
      if (!jobId) return asText(queueStart);
      const done = await waitForJob({
        jobId,
        timeoutMs: parsed.timeoutMs ?? 300_000,
      });
      return asText(done);
    }

    if (args.name === "ingest_upload_paths") {
      const parsed = parseIngestUploadPathsInput(args.input ?? {});
      const form = await toUploadForm(parsed.paths);
      const startRes = await fetch(new URL("/api/v1/ingest/jobs/upload", controlApiBase()), {
        method: "POST",
        body: form,
      });
      const startJson = (await startRes.json().catch(() => null)) as Record<string, unknown> | null;
      if (!startRes.ok) {
        throw new Error(
          `http_${startRes.status}:${JSON.stringify(startJson ?? {})}`
        );
      }
      if (parsed.wait === false) return asText(startJson);
      const jobId = String((startJson?.job as Record<string, unknown> | undefined)?.id ?? "");
      if (!jobId) return asText(startJson);
      const done = await waitForJob({
        jobId,
        timeoutMs: parsed.timeoutMs ?? 300_000,
      });
      return asText(done);
    }

    return asError(`unknown_tool:${args.name}`);
  } catch (error) {
    return asError(error instanceof Error ? error.message : String(error));
  }
}
