import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type {
  IngestProgress,
  IngestUploadMetadata,
  ResourceImportPayload,
} from "@chiba-cable3/contracts";
import type { Cable3Db } from "@chiba-cable3/db";
import { importResources } from "@chiba-cable3/db";
import {
  buildDeterministicMediaId,
  classifyMediaFile,
  normalizeUploadPlan,
  parseEdenCollectionInput,
  type EdenDb,
} from "./service.js";

export type UploadedFile = {
  fieldName: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
};

export type { IngestProgress } from "@chiba-cable3/contracts";

type IngestWarning = string;

export type ImportCounts = {
  media: number;
  playlists: number;
  blocks: number;
  channels: number;
  profiles: number;
};

type PersistResourcesFn = (args: {
  db: Cable3Db;
  payload: ResourceImportPayload;
}) => Promise<ImportCounts>;

function getShareRoot(): string {
  return process.env.SHARE_ROOT?.trim() || path.join(os.tmpdir(), "share-root");
}

function getAssetsRoot(): string {
  return path.join(getShareRoot(), "chiba-cable", "assets");
}

function getThumbsRoot(): string {
  return path.join(getAssetsRoot(), ".thumbs");
}

function getThumbPublicUrl(fileName: string): string {
  return `/api/v1/assets/thumbs/${encodeURIComponent(fileName)}`;
}

function parsePositiveIntEnv(raw: string | undefined): number | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const normalized = Math.floor(num);
  return normalized > 0 ? normalized : null;
}

function parseBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function defaultYtDlpFormat(): string {
  const maxHeight =
    parsePositiveIntEnv(process.env.CHIBA3_INGEST_YOUTUBE_MAX_HEIGHT) ?? 720;
  // Prefer Pi-safe H.264/AAC first, then progressively fall back.
  return [
    `bestvideo[vcodec~='^avc1'][height<=${maxHeight}]+bestaudio[acodec~='^(mp4a|aac)']`,
    `best[vcodec~='^avc1'][acodec~='^(mp4a|aac)'][height<=${maxHeight}]`,
    `best[ext=mp4][height<=${maxHeight}]`,
    `best[height<=${maxHeight}]`,
    "best",
  ].join("/");
}

function youtubeFormatSelector(): string {
  const envValue = process.env.CHIBA3_INGEST_YOUTUBE_FORMAT?.trim();
  if (envValue) return envValue;
  return defaultYtDlpFormat();
}

function youtubeTranscodeEnabled(): boolean {
  return parseBooleanEnv(process.env.CHIBA3_INGEST_YOUTUBE_TRANSCODE, true);
}

function youtubeTranscodeMaxHeight(): number {
  return parsePositiveIntEnv(process.env.CHIBA3_INGEST_YOUTUBE_MAX_HEIGHT) ?? 720;
}

async function ensureIngestDirs(): Promise<void> {
  await fs.mkdir(getAssetsRoot(), { recursive: true });
  await fs.mkdir(getThumbsRoot(), { recursive: true });
}

function extFromName(name: string): string {
  const ext = path.extname(name).trim().toLowerCase();
  return ext || "";
}

function stripUnsafeName(name: string): string {
  return (
    name
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+/, "")
      .slice(0, 128) || "file"
  );
}

function digestHex(bytes: Buffer): string {
  return createHash("sha1").update(bytes).digest("hex");
}

async function writeAsset(args: {
  bytes: Buffer;
  originalName: string;
}): Promise<string> {
  const ext = extFromName(args.originalName);
  const digest = digestHex(args.bytes);
  const filename = `${digest}${ext || ".bin"}`;
  const outPath = path.join(getAssetsRoot(), filename);
  try {
    const stat = await fs.stat(outPath);
    if (stat.size === args.bytes.length) return outPath;
  } catch {
    // new file
  }
  await fs.writeFile(outPath, args.bytes);
  return outPath;
}

async function runProcess(args: {
  command: string;
  argv: string[];
  onStdoutLine?: (line: string) => void;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(args.command, args.argv, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      if (args.onStdoutLine) {
        for (const line of text.split(/\r?\n/).filter(Boolean)) args.onStdoutLine(line);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => reject(error));
    child.once("close", (code) =>
      resolve({
        code: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      })
    );
  });
}

async function pushThumbnailToMinio(args: {
  thumbPath: string;
  thumbName: string;
}): Promise<{ thumbnailUrl: string; thumbnailObjectKey: string } | null> {
  const backend = (process.env.CHIBA3_THUMBNAIL_BACKEND || "filesystem").trim().toLowerCase();
  if (backend !== "minio") return null;

  const endpoint = process.env.CHIBA3_S3_ENDPOINT_URL?.trim();
  const bucket = process.env.CHIBA3_S3_BUCKET?.trim();
  const publicBase = process.env.CHIBA3_S3_PUBLIC_BASE_URL?.trim();
  const accessKey = process.env.CHIBA3_S3_ACCESS_KEY?.trim();
  const secretKey = process.env.CHIBA3_S3_SECRET_KEY?.trim();
  if (!endpoint || !bucket || !publicBase || !accessKey || !secretKey) return null;

  const objectKey = `thumbs/${args.thumbName}`;
  const upload = await runProcess({
    command: "aws",
    argv: [
      "--endpoint-url",
      endpoint,
      "s3",
      "cp",
      args.thumbPath,
      `s3://${bucket}/${objectKey}`,
      "--acl",
      "public-read",
    ],
  }).catch(() => null);

  if (!upload || upload.code !== 0) return null;
  const base = publicBase.replace(/\/+$/, "");
  return {
    thumbnailObjectKey: objectKey,
    thumbnailUrl: `${base}/${bucket}/${objectKey}`,
  };
}

async function maybeCreateThumbnail(args: {
  assetPath: string;
  mediaKind: "image" | "video" | "audio";
}): Promise<{ thumbnailUrl?: string; thumbnailObjectKey?: string }> {
  if (args.mediaKind === "audio") return {};
  const basename = path.basename(args.assetPath, path.extname(args.assetPath));
  if (args.mediaKind === "image") {
    const ext = extFromName(args.assetPath) || ".jpg";
    const thumbName = `${basename}${ext}`;
    const thumbPath = path.join(getThumbsRoot(), thumbName);
    await fs.copyFile(args.assetPath, thumbPath);
    const remote = await pushThumbnailToMinio({ thumbPath, thumbName });
    if (remote) return remote;
    return { thumbnailUrl: getThumbPublicUrl(thumbName) };
  }

  const thumbName = `${basename}.jpg`;
  const thumbPath = path.join(getThumbsRoot(), thumbName);
  const ffmpeg = await runProcess({
    command: "ffmpeg",
    argv: ["-y", "-ss", "00:00:01", "-i", args.assetPath, "-frames:v", "1", thumbPath],
  }).catch(() => null);
  if (!ffmpeg || ffmpeg.code !== 0) return {};
  const remote = await pushThumbnailToMinio({ thumbPath, thumbName });
  if (remote) return remote;
  return { thumbnailUrl: getThumbPublicUrl(thumbName) };
}

export async function readMultipartUploadFromRequest(
  req: IncomingMessage
): Promise<{
  contentLength: number;
  files: UploadedFile[];
  fields: Record<string, string>;
}> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value.join(", ");
  }
  const nodeRequest = new Request("http://localhost/upload", {
    method: req.method,
    headers,
    body: Readable.toWeb(req) as never,
    duplex: "half",
  } as RequestInit);
  const form = await nodeRequest.formData();
  const files: UploadedFile[] = [];
  const fields: Record<string, string> = {};
  for (const [fieldName, value] of form.entries()) {
    if (!(value instanceof File)) {
      if (typeof value === "string") fields[fieldName] = value;
      continue;
    }
    const bytes = Buffer.from(await value.arrayBuffer());
    files.push({
      fieldName,
      filename: value.name || "file",
      mimeType: value.type || "application/octet-stream",
      bytes,
    });
  }
  const contentLength = Number(req.headers["content-length"] ?? "0") || 0;
  return { contentLength, files, fields };
}

async function listFilesRecursively(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const next = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursively(next)));
      continue;
    }
    if (entry.isFile()) out.push(next);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function calcPercent(current: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

function toPersist(args: { persistResources?: PersistResourcesFn }): PersistResourcesFn {
  return args.persistResources ?? importResources;
}

export async function ingestUploadedFiles(args: {
  db: Cable3Db;
  contentLength: number;
  files: UploadedFile[];
  metadata?: IngestUploadMetadata;
  persistResources?: PersistResourcesFn;
  onProgress?: (progress: IngestProgress) => void;
}): Promise<{
  status: number;
  payload: Record<string, unknown>;
}> {
  await ensureIngestDirs();
  const plan = normalizeUploadPlan({
    contentLength: args.contentLength,
    files: args.files.map((file) => ({
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.bytes.length,
      fieldName: file.fieldName,
    })),
  });
  if (!plan.ok) {
    return {
      status: plan.status,
      payload: { ok: false, error: plan.error },
    };
  }

  const warnings: IngestWarning[] = [];
  const media: ResourceImportPayload["media"] = [];
  let processed = 0;
  let total = plan.mode === "files" ? plan.files.length : 1;

  const report = (message?: string) => {
    const progress: IngestProgress = {
      current: processed,
      total,
      percent: calcPercent(processed, total),
      ...(message ? { message } : {}),
    };
    args.onProgress?.(progress);
  };

  const ingestBuffer = async (file: {
    filename: string;
    mimeType: string;
    bytes: Buffer;
  }) => {
    const kind = classifyMediaFile({
      filename: file.filename,
      mimeType: file.mimeType,
    });
    if (kind === "unsupported") {
      warnings.push(`unsupported_file:${file.filename}`);
      processed += 1;
      report(`unsupported:${file.filename}`);
      return;
    }
    const outPath = await writeAsset({
      bytes: file.bytes,
      originalName: stripUnsafeName(file.filename),
    });
    const thumb = await maybeCreateThumbnail({
      assetPath: outPath,
      mediaKind: kind,
    });
    media.push({
      id: buildDeterministicMediaId("upload", `file:${outPath}`),
      title: stripUnsafeName(file.filename),
      artist: args.metadata?.artist,
      description: args.metadata?.description,
      sourceType: "path",
      sourceValue: outPath,
      thumbnailUrl: thumb.thumbnailUrl,
      thumbnailObjectKey: thumb.thumbnailObjectKey,
      cache: true,
    });
    processed += 1;
    report(`ingested:${file.filename}`);
  };

  if (plan.mode === "files") {
    const filesByName = new Map(args.files.map((file) => [file.filename, file]));
    total = plan.files.length;
    report("starting");
    for (const filePlan of plan.files) {
      const file = filesByName.get(filePlan.filename);
      if (!file) {
        processed += 1;
        report(`missing:${filePlan.filename}`);
        continue;
      }
      await ingestBuffer(file);
    }
  } else {
    const archive = args.files.find((file) => file.filename === plan.archive.filename);
    if (!archive) {
      return {
        status: 400,
        payload: { ok: false, error: "archive_missing" },
      };
    }
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "c3-upload-zip-"));
    try {
      const zipPath = path.join(tempDir, stripUnsafeName(archive.filename));
      const extractDir = path.join(tempDir, "extract");
      await fs.mkdir(extractDir, { recursive: true });
      await fs.writeFile(zipPath, archive.bytes);
      const unzip = await runProcess({
        command: "unzip",
        argv: ["-oq", zipPath, "-d", extractDir],
      });
      if (unzip.code !== 0) {
        return {
          status: 422,
          payload: {
            ok: false,
            error: "zip_extract_failed",
            detail: unzip.stderr.slice(0, 500),
          },
        };
      }
      const files = await listFilesRecursively(extractDir);
      total = files.length;
      report("extracted");
      for (const filePath of files) {
        const bytes = await fs.readFile(filePath);
        await ingestBuffer({
          filename: path.basename(filePath),
          mimeType: "",
          bytes,
        });
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  const dedupedMedia = Array.from(new Map(media.map((row) => [row.id, row])).values());
  const payload: ResourceImportPayload = {
    media: dedupedMedia,
    playlists: [],
    blocks: [],
    channels: [],
    profiles: [],
  };
  const counts = await toPersist(args)({
    db: args.db,
    payload,
  });
  report("complete");
  return {
    status: 200,
    payload: {
      ok: true,
      mode: plan.mode,
      counts,
      imported: {
        media: dedupedMedia.map((row) => ({
          id: row.id,
          title: row.title,
          sourceValue: row.sourceValue,
          thumbnailUrl: row.thumbnailUrl,
          thumbnailObjectKey: row.thumbnailObjectKey,
        })),
      },
      warnings,
    },
  };
}

export async function ingestUploadedMultipart(args: {
  req: IncomingMessage;
  db: Cable3Db;
  metadata?: IngestUploadMetadata;
  persistResources?: PersistResourcesFn;
  onProgress?: (progress: IngestProgress) => void;
}): Promise<{
  status: number;
  payload: Record<string, unknown>;
}> {
  const parsed = await readMultipartUploadFromRequest(args.req);
  const nextArgs: {
    db: Cable3Db;
    contentLength: number;
    files: UploadedFile[];
    persistResources?: PersistResourcesFn;
    onProgress?: (progress: IngestProgress) => void;
  } = {
    db: args.db,
    contentLength: parsed.contentLength,
    files: parsed.files,
    ...(args.metadata ? { metadata: args.metadata } : {}),
    ...(args.persistResources ? { persistResources: args.persistResources } : {}),
    ...(args.onProgress ? { onProgress: args.onProgress } : {}),
  };
  return ingestUploadedFiles(nextArgs);
}

export async function ingestYouTube(args: {
  db: Cable3Db;
  url: string;
  mediaId?: string;
  title?: string;
  artist?: string;
  cache?: boolean;
  persistResources?: PersistResourcesFn;
  onProgress?: (progress: IngestProgress) => void;
}): Promise<{
  status: number;
  payload: Record<string, unknown>;
}> {
  await ensureIngestDirs();
  const url = args.url.trim();
  if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
    return {
      status: 400,
      payload: { ok: false, error: "invalid_youtube_url" },
    };
  }

  args.onProgress?.({ current: 0, total: 100, percent: 0, message: "starting" });

  const hash = createHash("sha1").update(url).digest("hex").slice(0, 14);
  const outPrefix = path.join(getAssetsRoot(), `yt-${hash}`);
  const formatSelector = youtubeFormatSelector();
  let latestPercent = 0;
  const ytdlp = await runProcess({
    command: "yt-dlp",
    argv: [
      "-f",
      formatSelector,
      "--merge-output-format",
      "mp4",
      "--no-playlist",
      "--no-warnings",
      "--progress",
      "--newline",
      "-o",
      `${outPrefix}.%(ext)s`,
      url,
    ],
    onStdoutLine: (line) => {
      const match = line.match(/(\d+\.?\d*)%/);
      if (!match || !match[1]) return;
      const value = Math.max(0, Math.min(99, Math.floor(Number(match[1]))));
      if (Number.isFinite(value) && value > latestPercent) {
        latestPercent = value;
        args.onProgress?.({
          current: value,
          total: 100,
          percent: value,
          message: "downloading",
        });
      }
    },
  }).catch((error) => ({
    code: 1,
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
  }));

  if (ytdlp.code !== 0) {
    return {
      status: 502,
      payload: {
        ok: false,
        error: "youtube_download_failed",
        detail: ytdlp.stderr.slice(0, 500),
      },
    };
  }

  const outNamePrefix = `yt-${hash}.`;
  const entries = await fs.readdir(getAssetsRoot());
  const fileName = entries
    .filter((name) => name.startsWith(outNamePrefix))
    .sort((a, b) => a.localeCompare(b))[0];
  if (!fileName) {
    return {
      status: 500,
      payload: { ok: false, error: "youtube_output_missing" },
    };
  }
  let outPath = path.join(getAssetsRoot(), fileName);

  if (youtubeTranscodeEnabled()) {
    const safeOutPath = path.join(getAssetsRoot(), `yt-${hash}-safe.mp4`);
    const transcode = await runProcess({
      command: "ffmpeg",
      argv: [
        "-y",
        "-i",
        outPath,
        "-vf",
        `scale=-2:${youtubeTranscodeMaxHeight()}:force_original_aspect_ratio=decrease`,
        "-r",
        "30",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        safeOutPath,
      ],
    }).catch((error) => ({
      code: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    }));

    if (transcode.code !== 0) {
      return {
        status: 502,
        payload: {
          ok: false,
          error: "youtube_transcode_failed",
          detail: transcode.stderr.slice(0, 500),
        },
      };
    }
    outPath = safeOutPath;
  }

  const thumb = await maybeCreateThumbnail({
    assetPath: outPath,
    mediaKind: "video",
  });
  const mediaId = args.mediaId?.trim() || buildDeterministicMediaId("youtube", url);
  const payload: ResourceImportPayload = {
    media: [
      {
        id: mediaId,
        title: args.title?.trim() || fileName,
        artist: args.artist?.trim() || undefined,
        sourceType: "path",
        sourceValue: outPath,
        thumbnailUrl: thumb.thumbnailUrl,
        thumbnailObjectKey: thumb.thumbnailObjectKey,
        cache: args.cache ?? true,
      },
    ],
    playlists: [],
    blocks: [],
    channels: [],
    profiles: [],
  };
  const counts = await toPersist(args)({ db: args.db, payload });
  args.onProgress?.({ current: 100, total: 100, percent: 100, message: "complete" });
  return {
    status: 200,
    payload: {
      ok: true,
      counts,
      media: payload.media[0],
    },
  };
}

type EdenCreation = {
  id: string;
  url: string;
  title?: string;
  artist?: string;
};

function edenApiBase(db: EdenDb): string {
  return db === "STAGE" ? "https://staging.api.eden.art" : "https://api.eden.art";
}

async function edenApiGet(args: {
  apiBase: string;
  apiKey: string;
  endpointPath: string;
}): Promise<unknown> {
  const res = await fetch(`${args.apiBase}${args.endpointPath}`, {
    headers: { "X-Api-Key": args.apiKey },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eden_api_failed:${res.status}:${text.slice(0, 280)}`);
  }
  return res.json();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseEdenCreation(value: unknown): EdenCreation | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = String(row._id ?? row.id ?? "").trim();
  const url = String(row.url ?? "").trim();
  if (!id || !url) return null;
  const user = asRecord(row.user);
  const out: EdenCreation = { id, url };
  const title = String(row.title ?? row.name ?? "").trim();
  if (title) out.title = title;
  const artist = String(user?.username ?? "").trim();
  if (artist) out.artist = artist;
  return out;
}

async function fetchEdenCollectionCreations(args: {
  collectionId: string;
  db: EdenDb;
  apiKey: string;
}): Promise<{
  collectionTitle?: string;
  creations: EdenCreation[];
}> {
  const apiBase = edenApiBase(args.db);
  const collectionRaw = await edenApiGet({
    apiBase,
    apiKey: args.apiKey,
    endpointPath: `/v2/collections/${args.collectionId}`,
  }).catch(() => null);
  const collectionObj = asRecord(collectionRaw);
  const collectionTitle =
    String(collectionObj?.name ?? collectionObj?.title ?? "").trim() || undefined;

  const creationIds: string[] = [];
  for (let page = 1; page <= 2000; page += 1) {
    const pageRaw = await edenApiGet({
      apiBase,
      apiKey: args.apiKey,
      endpointPath: `/v2/collections/${args.collectionId}/creations?page=${page}&limit=100`,
    });
    const pageObj = asRecord(pageRaw);
    const docs = Array.isArray(pageObj?.docs) ? pageObj.docs : [];
    for (const doc of docs) {
      const row = asRecord(doc);
      const id = String(row?._id ?? "").trim();
      if (id) creationIds.push(id);
    }
    const hasNext = Boolean(pageObj?.hasNextPage);
    if (!hasNext) break;
  }

  const uniqueIds = Array.from(new Set(creationIds));
  const creations: EdenCreation[] = [];
  for (const creationId of uniqueIds) {
    const creationRaw = await edenApiGet({
      apiBase,
      apiKey: args.apiKey,
      endpointPath: `/v2/creations/${creationId}`,
    });
    const obj = asRecord(creationRaw);
    const parsed = parseEdenCreation(obj?.creation ?? creationRaw);
    if (parsed) creations.push(parsed);
  }
  return {
    ...(collectionTitle ? { collectionTitle } : {}),
    creations,
  };
}

async function downloadUrlToBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download_failed:${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function ingestEdenCollection(args: {
  db: Cable3Db;
  input: string;
  dbName?: EdenDb;
  playlistId?: string;
  apiKey?: string;
  persistResources?: PersistResourcesFn;
  onProgress?: (progress: IngestProgress) => void;
}): Promise<{
  status: number;
  payload: Record<string, unknown>;
}> {
  await ensureIngestDirs();
  const parsed = parseEdenCollectionInput({
    input: args.input,
    ...(args.dbName ? { db: args.dbName } : {}),
  });
  const apiKey = args.apiKey?.trim() || process.env.EDEN_API_KEY?.trim() || "";
  if (!apiKey) {
    return {
      status: 400,
      payload: { ok: false, error: "eden_api_key_required" },
    };
  }

  let collection: { collectionTitle?: string; creations: EdenCreation[] };
  try {
    collection = await fetchEdenCollectionCreations({
      collectionId: parsed.collectionId,
      db: parsed.db,
      apiKey,
    });
  } catch (error) {
    return {
      status: 502,
      payload: {
        ok: false,
        error: "eden_fetch_failed",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const warnings: string[] = [];
  const media: ResourceImportPayload["media"] = [];
  const total = collection.creations.length;
  let current = 0;
  args.onProgress?.({
    current,
    total,
    percent: calcPercent(current, total),
    message: "starting",
  });
  for (const creation of collection.creations) {
    try {
      const bytes = await downloadUrlToBuffer(creation.url);
      const originalName =
        path.basename(new URL(creation.url).pathname || "") || `${creation.id}.bin`;
      const outPath = await writeAsset({
        bytes,
        originalName,
      });
      const kind = classifyMediaFile({ filename: outPath });
      const thumb =
        kind === "image" || kind === "video"
          ? await maybeCreateThumbnail({
              assetPath: outPath,
              mediaKind: kind,
            })
          : {};
      media.push({
        id: `m-eden-${creation.id}`,
        title: creation.title || undefined,
        artist: creation.artist || undefined,
        sourceType: "path",
        sourceValue: outPath,
        thumbnailUrl: thumb.thumbnailUrl,
        thumbnailObjectKey: thumb.thumbnailObjectKey,
        cache: true,
      });
    } catch (error) {
      warnings.push(
        `creation_ingest_failed:${creation.id}:${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    current += 1;
    args.onProgress?.({
      current,
      total,
      percent: calcPercent(current, total),
      message: `creation:${creation.id}`,
    });
  }

  const playlistId =
    args.playlistId?.trim() || `pl-eden-${parsed.collectionId.toLowerCase()}`;
  const playlistTitle =
    collection.collectionTitle || `Eden Collection ${parsed.collectionId}`;
  const payload: ResourceImportPayload = {
    media,
    playlists: [
      {
        id: playlistId,
        title: playlistTitle,
        items: media.map((row, index) => ({
          index,
          mediaId: row.id,
        })),
      },
    ],
    blocks: [],
    channels: [],
    profiles: [],
  };
  const counts = await toPersist(args)({ db: args.db, payload });
  args.onProgress?.({
    current: total,
    total,
    percent: 100,
    message: "complete",
  });
  return {
    status: 200,
    payload: {
      ok: true,
      collectionId: parsed.collectionId,
      db: parsed.db,
      playlistId,
      counts,
      warnings,
    },
  };
}

export async function readThumbnail(args: {
  fileName: string;
}): Promise<{ status: number; filePath?: string; error?: string }> {
  const fileName = stripUnsafeName(args.fileName);
  const fullPath = path.join(getThumbsRoot(), fileName);
  try {
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) {
      return { status: 404, error: "thumbnail_not_found" };
    }
    return { status: 200, filePath: fullPath };
  } catch {
    return { status: 404, error: "thumbnail_not_found" };
  }
}
