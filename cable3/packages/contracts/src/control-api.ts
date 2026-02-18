import { z } from "zod";
import {
  IngestEdenCollectionRequestSchema,
  IngestJobSchema,
  IngestYouTubeRequestSchema,
  MediaResourceSchema,
  ResourceImportPayloadSchema,
  ResourceSnapshotSchema,
  type IngestEdenCollectionRequest,
  type IngestYouTubeRequest,
  type ResourceImportPayload,
} from "./index.js";

export const ImportCountsSchema = z
  .object({
    media: z.number().int().nonnegative(),
    playlists: z.number().int().nonnegative(),
    blocks: z.number().int().nonnegative(),
    channels: z.number().int().nonnegative(),
    profiles: z.number().int().nonnegative(),
  })
  .strict();
export type ImportCounts = z.infer<typeof ImportCountsSchema>;

export const ImportResourcesResponseSchema = z
  .object({
    ok: z.literal(true),
    counts: ImportCountsSchema,
  })
  .strict();
export type ImportResourcesResponse = z.infer<typeof ImportResourcesResponseSchema>;

export const ResourceSnapshotResponseSchema = z
  .object({
    ok: z.literal(true),
    snapshot: ResourceSnapshotSchema,
  })
  .strict();
export type ResourceSnapshotResponse = z.infer<typeof ResourceSnapshotResponseSchema>;

export const DeleteMediaResponseSchema = z
  .object({
    ok: z.literal(true),
    mediaId: z.string().min(1),
    deleted: z.boolean(),
    removedPlaylistItems: z.number().int().nonnegative(),
    removedBlockItems: z.number().int().nonnegative(),
    removedProfileAssignments: z.number().int().nonnegative(),
    updatedProfiles: z.number().int().nonnegative(),
    removedPlaylists: z.number().int().nonnegative(),
    removedBlocks: z.number().int().nonnegative(),
    removedChannels: z.number().int().nonnegative(),
    removedProfiles: z.number().int().nonnegative(),
  })
  .strict();
export type DeleteMediaResponse = z.infer<typeof DeleteMediaResponseSchema>;

export const IngestResponseSchema = z
  .object({
    ok: z.boolean(),
    counts: ImportCountsSchema.optional(),
    media: MediaResourceSchema.optional(),
    playlistId: z.string().optional(),
    warnings: z.array(z.string()).optional(),
    error: z.string().optional(),
  })
  .passthrough();
export type IngestResponse = z.infer<typeof IngestResponseSchema>;

export const IngestJobResponseSchema = z
  .object({
    ok: z.literal(true),
    job: IngestJobSchema,
  })
  .strict();
export type IngestJobResponse = z.infer<typeof IngestJobResponseSchema>;

export const IngestJobsResponseSchema = z
  .object({
    ok: z.literal(true),
    jobs: z.array(IngestJobSchema),
  })
  .strict();
export type IngestJobsResponse = z.infer<typeof IngestJobsResponseSchema>;

export type ControlApiErrorPayload = {
  error?: string;
  detail?: unknown;
  issues?: unknown;
};

export class ControlApiError extends Error {
  readonly status: number;
  readonly payload: ControlApiErrorPayload;

  constructor(args: { status: number; message: string; payload?: ControlApiErrorPayload }) {
    super(args.message);
    this.name = "ControlApiError";
    this.status = args.status;
    this.payload = args.payload ?? {};
  }
}

export type HttpResponseLike = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

export type HttpClientLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  }
) => Promise<HttpResponseLike>;

export type ControlApiClient = {
  importResources(payload: ResourceImportPayload): Promise<ImportResourcesResponse>;
  getResourceSnapshot(): Promise<ResourceSnapshotResponse>;
  deleteMedia(mediaId: string): Promise<DeleteMediaResponse>;
  ingestYouTube(payload: IngestYouTubeRequest): Promise<IngestResponse>;
  ingestEdenCollection(payload: IngestEdenCollectionRequest): Promise<IngestResponse>;
  ingestUpload(formData: FormData): Promise<IngestResponse>;
  startYouTubeIngestJob(payload: IngestYouTubeRequest): Promise<IngestJobResponse>;
  startEdenCollectionIngestJob(
    payload: IngestEdenCollectionRequest
  ): Promise<IngestJobResponse>;
  startUploadIngestJob(formData: FormData): Promise<IngestJobResponse>;
  getIngestJob(jobId: string): Promise<IngestJobResponse>;
  listIngestJobs(limit?: number): Promise<IngestJobsResponse>;
  mediaStreamUrl(mediaId: string): string;
};

function normalizeBase(pathPrefix: string): string {
  return pathPrefix.endsWith("/") ? pathPrefix.slice(0, -1) : pathPrefix;
}

async function readJsonOrThrow<Schema extends z.ZodTypeAny>(
  response: HttpResponseLike,
  schema: Schema
): Promise<z.output<Schema>> {
  const raw = await response.text().catch(() => "");
  let parsedJson: unknown = {};
  if (raw) {
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      parsedJson = { error: raw.slice(0, 240) };
    }
  }
  if (!response.ok) {
    const payload =
      parsedJson && typeof parsedJson === "object"
        ? (parsedJson as ControlApiErrorPayload)
        : { error: raw.slice(0, 240) };
    throw new ControlApiError({
      status: response.status,
      message: String(payload.error ?? "request_failed"),
      payload,
    });
  }
  return schema.parse(parsedJson) as z.output<Schema>;
}

export function createControlApiClient(args?: {
  basePath?: string;
  fetchFn?: HttpClientLike;
}): ControlApiClient {
  const basePath = normalizeBase(args?.basePath ?? "/api/v1");
  const fetchFn: HttpClientLike =
    args?.fetchFn ?? ((input, init) => fetch(input, init as RequestInit));

  const build = (path: string): string => `${basePath}${path}`;

  return {
    async importResources(payload) {
      const safePayload = ResourceImportPayloadSchema.parse(payload);
      const response = await fetchFn(build("/resources/import"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(safePayload),
      });
      return readJsonOrThrow(response, ImportResourcesResponseSchema);
    },
    async getResourceSnapshot() {
      const response = await fetchFn(build("/resources/snapshot"));
      return readJsonOrThrow(response, ResourceSnapshotResponseSchema);
    },
    async deleteMedia(mediaId) {
      const id = String(mediaId ?? "").trim();
      if (!id) {
        throw new ControlApiError({
          status: 400,
          message: "media_id_required",
          payload: { error: "media_id_required" },
        });
      }
      const response = await fetchFn(
        build(`/resources/media/${encodeURIComponent(id)}`),
        {
          method: "DELETE",
        }
      );
      return readJsonOrThrow(response, DeleteMediaResponseSchema);
    },
    async ingestYouTube(payload) {
      const safePayload = IngestYouTubeRequestSchema.parse(payload);
      const response = await fetchFn(build("/ingest/youtube"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(safePayload),
      });
      return readJsonOrThrow(response, IngestResponseSchema);
    },
    async ingestEdenCollection(payload) {
      const safePayload = IngestEdenCollectionRequestSchema.parse(payload);
      const response = await fetchFn(build("/ingest/eden-collection"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(safePayload),
      });
      return readJsonOrThrow(response, IngestResponseSchema);
    },
    async ingestUpload(formData) {
      const response = await fetchFn(build("/ingest/upload"), {
        method: "POST",
        body: formData,
      });
      return readJsonOrThrow(response, IngestResponseSchema);
    },
    async startYouTubeIngestJob(payload) {
      const safePayload = IngestYouTubeRequestSchema.parse(payload);
      const response = await fetchFn(build("/ingest/jobs/youtube"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(safePayload),
      });
      return readJsonOrThrow(response, IngestJobResponseSchema);
    },
    async startEdenCollectionIngestJob(payload) {
      const safePayload = IngestEdenCollectionRequestSchema.parse(payload);
      const response = await fetchFn(build("/ingest/jobs/eden-collection"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(safePayload),
      });
      return readJsonOrThrow(response, IngestJobResponseSchema);
    },
    async startUploadIngestJob(formData) {
      const response = await fetchFn(build("/ingest/jobs/upload"), {
        method: "POST",
        body: formData,
      });
      return readJsonOrThrow(response, IngestJobResponseSchema);
    },
    async getIngestJob(jobId) {
      const id = String(jobId ?? "").trim();
      if (!id) {
        throw new ControlApiError({
          status: 400,
          message: "job_id_required",
          payload: { error: "job_id_required" },
        });
      }
      const response = await fetchFn(build(`/ingest/jobs/${encodeURIComponent(id)}`));
      return readJsonOrThrow(response, IngestJobResponseSchema);
    },
    async listIngestJobs(limit = 50) {
      const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
      const response = await fetchFn(
        build(`/ingest/jobs?limit=${encodeURIComponent(String(safeLimit))}`)
      );
      return readJsonOrThrow(response, IngestJobsResponseSchema);
    },
    mediaStreamUrl(mediaId) {
      const id = String(mediaId ?? "").trim();
      if (!id) return build("/resources/media/invalid/stream");
      return build(`/resources/media/${encodeURIComponent(id)}/stream`);
    },
  };
}
