import { createHash } from "node:crypto";

export const INGEST_MAX_UPLOAD_FILES = 20;
export const INGEST_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

export type IngestMediaKind = "image" | "video" | "audio" | "unsupported";
export type EdenDb = "PROD" | "STAGE";

export type UploadCandidate = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  fieldName: string;
};

type UploadPlanOk =
  | {
      ok: true;
      mode: "files";
      files: UploadCandidate[];
    }
  | {
      ok: true;
      mode: "zip";
      archive: UploadCandidate;
    };

type UploadPlanError = {
  ok: false;
  status: 400 | 413 | 422;
  error:
    | "payload_too_large"
    | "no_files"
    | "too_many_files"
    | "multiple_archives"
    | "mixed_archive_and_files";
};

export type UploadPlan = UploadPlanOk | UploadPlanError;

const IMAGE_EXTENSIONS = new Set([
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

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
  ".avi",
]);

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".flac",
  ".aac",
  ".m4a",
  ".ogg",
]);

function extOf(filename: string): string {
  const lower = filename.trim().toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return "";
  return lower.slice(dot);
}

function looksLikeZip(file: UploadCandidate): boolean {
  const ext = extOf(file.filename);
  if (ext === ".zip") return true;
  const mime = file.mimeType.toLowerCase();
  return mime === "application/zip" || mime === "application/x-zip-compressed";
}

export function classifyMediaFile(args: {
  filename: string;
  mimeType?: string | null;
}): IngestMediaKind {
  const ext = extOf(args.filename);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";

  const mime = String(args.mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "unsupported";
}

export function buildDeterministicMediaId(prefix: string, sourceKey: string): string {
  const safePrefix = prefix.trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/-+/g, "-");
  const digest = createHash("sha1").update(sourceKey).digest("hex").slice(0, 12);
  return `m-${safePrefix || "ingest"}-${digest}`;
}

export function normalizeUploadPlan(args: {
  contentLength: number;
  files: UploadCandidate[];
}): UploadPlan {
  if (args.contentLength > INGEST_MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "payload_too_large",
    };
  }

  const files = args.files.filter((file) => file.filename.trim().length > 0);
  if (files.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "no_files",
    };
  }

  const archives = files.filter(looksLikeZip);
  if (archives.length > 1) {
    return {
      ok: false,
      status: 400,
      error: "multiple_archives",
    };
  }
  if (archives.length === 1 && files.length > 1) {
    return {
      ok: false,
      status: 400,
      error: "mixed_archive_and_files",
    };
  }
  if (archives.length === 1) {
    return {
      ok: true,
      mode: "zip",
      archive: archives[0]!,
    };
  }

  if (files.length > INGEST_MAX_UPLOAD_FILES) {
    return {
      ok: false,
      status: 413,
      error: "too_many_files",
    };
  }

  return {
    ok: true,
    mode: "files",
    files,
  };
}

export function parseEdenCollectionInput(args: {
  input: string;
  db?: EdenDb;
}): { collectionId: string; db: EdenDb } {
  const raw = args.input.trim();
  if (!raw) throw new Error("eden_collection_input_required");

  const dbOverride = args.db;
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }

  if (url) {
    const host = url.hostname.toLowerCase();
    if (!host.includes("eden.art")) throw new Error("eden_host_required");
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((part) => {
      const lower = part.toLowerCase();
      return lower === "collection" || lower === "collections";
    });
    const collectionId = idx >= 0 ? (parts[idx + 1] ?? "").trim() : "";
    if (!collectionId) throw new Error("eden_collection_id_missing");
    const db: EdenDb = dbOverride ?? (host.includes("staging") ? "STAGE" : "PROD");
    return { collectionId, db };
  }

  const collectionId = raw.replace(/^collections?\//i, "").trim();
  if (!collectionId || collectionId.includes("/")) {
    throw new Error("eden_collection_id_invalid");
  }
  return { collectionId, db: dbOverride ?? "PROD" };
}
