import { randomUUID } from "node:crypto";
import type {
  IngestJob,
  IngestJobKind,
  IngestJobStatus,
  IngestProgress,
  IngestUploadMetadata,
} from "@chiba-cable3/contracts";
import type { Cable3Db } from "@chiba-cable3/db";
import {
  ingestEdenCollection,
  ingestUploadedFiles,
  ingestYouTube,
  type UploadedFile,
} from "./runtime.js";
import type { EdenDb } from "./service.js";

export type { IngestJob, IngestJobKind, IngestJobStatus } from "@chiba-cable3/contracts";

type QueueRunner = (args: {
  onProgress: (progress: IngestProgress) => void;
}) => Promise<{ status: number; payload: Record<string, unknown> }>;

function now(): number {
  return Date.now();
}

export class IngestJobQueue {
  private readonly jobs = new Map<string, IngestJob>();
  private readonly order: string[] = [];
  private readonly maxJobs: number;

  constructor(args?: { maxJobs?: number }) {
    this.maxJobs = args?.maxJobs ?? 500;
  }

  enqueue(args: { kind: IngestJobKind; runner: QueueRunner }): IngestJob {
    const id = `ing-${randomUUID()}`;
    const job: IngestJob = {
      id,
      kind: args.kind,
      status: "queued",
      createdAt: now(),
      updatedAt: now(),
      progress: {
        current: 0,
        total: 1,
        percent: 0,
        message: "queued",
      },
    };
    this.jobs.set(id, job);
    this.order.unshift(id);
    this.gc();

    void this.run({
      id,
      runner: args.runner,
    });
    return job;
  }

  get(jobId: string): IngestJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  list(limit = 50): IngestJob[] {
    const max = Math.max(1, Math.min(200, limit));
    return this.order
      .slice(0, max)
      .map((id) => this.jobs.get(id))
      .filter((row): row is IngestJob => row !== undefined);
  }

  private update(jobId: string, patch: Partial<IngestJob>): void {
    const current = this.jobs.get(jobId);
    if (!current) return;
    const next = {
      ...current,
      ...patch,
      updatedAt: now(),
    };
    this.jobs.set(jobId, next);
  }

  private gc(): void {
    while (this.order.length > this.maxJobs) {
      const id = this.order.pop();
      if (!id) break;
      this.jobs.delete(id);
    }
  }

  private async run(args: { id: string; runner: QueueRunner }): Promise<void> {
    this.update(args.id, {
      status: "running",
      startedAt: now(),
      progress: {
        current: 0,
        total: 1,
        percent: 0,
        message: "running",
      },
    });
    try {
      const result = await args.runner({
        onProgress: (progress) => {
          this.update(args.id, { progress });
        },
      });
      if (result.status >= 200 && result.status < 300) {
        this.update(args.id, {
          status: "succeeded",
          finishedAt: now(),
          progress: {
            current: 1,
            total: 1,
            percent: 100,
            message: "complete",
          },
          result: result.payload,
        });
        return;
      }
      this.update(args.id, {
        status: "failed",
        finishedAt: now(),
        error:
          typeof result.payload.error === "string"
            ? result.payload.error
            : `status_${result.status}`,
        result: result.payload,
      });
    } catch (error) {
      this.update(args.id, {
        status: "failed",
        finishedAt: now(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function createIngestJobQueue(): IngestJobQueue {
  return new IngestJobQueue();
}

export function enqueueUploadIngest(args: {
  queue: IngestJobQueue;
  db: Cable3Db;
  contentLength: number;
  files: UploadedFile[];
  metadata?: IngestUploadMetadata;
}): IngestJob {
  return args.queue.enqueue({
    kind: "upload",
    runner: ({ onProgress }) =>
      ingestUploadedFiles({
        db: args.db,
        contentLength: args.contentLength,
        files: args.files,
        ...(args.metadata ? { metadata: args.metadata } : {}),
        onProgress,
      }),
  });
}

export function enqueueYouTubeIngest(args: {
  queue: IngestJobQueue;
  db: Cable3Db;
  input: {
    url: string;
    mediaId?: string;
    title?: string;
    artist?: string;
    cache?: boolean;
  };
}): IngestJob {
  return args.queue.enqueue({
    kind: "youtube",
    runner: ({ onProgress }) =>
      ingestYouTube({
        db: args.db,
        ...args.input,
        onProgress,
      }),
  });
}

export function enqueueEdenCollectionIngest(args: {
  queue: IngestJobQueue;
  db: Cable3Db;
  input: {
    input: string;
    dbName?: EdenDb;
    playlistId?: string;
    apiKey?: string;
  };
}): IngestJob {
  return args.queue.enqueue({
    kind: "eden_collection",
    runner: ({ onProgress }) =>
      ingestEdenCollection({
        db: args.db,
        ...args.input,
        onProgress,
      }),
  });
}
