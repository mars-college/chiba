import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { IngestJobQueue } from "../src/ingest/queue.ts";

test("queue transitions job queued -> running -> succeeded with progress", async () => {
  const queue = new IngestJobQueue();
  const job = queue.enqueue({
    kind: "youtube",
    runner: async ({ onProgress }) => {
      onProgress({
        current: 10,
        total: 100,
        percent: 10,
        message: "downloading",
      });
      await sleep(25);
      onProgress({
        current: 100,
        total: 100,
        percent: 100,
        message: "done",
      });
      return {
        status: 200,
        payload: { ok: true },
      };
    },
  });

  assert.equal(job.status, "queued");
  await sleep(80);
  const after = queue.get(job.id);
  assert.ok(after);
  assert.equal(after.status, "succeeded");
  assert.equal(after.progress.percent, 100);
});

test("queue marks failed jobs and keeps error details", async () => {
  const queue = new IngestJobQueue();
  const job = queue.enqueue({
    kind: "upload",
    runner: async () => {
      await sleep(10);
      return {
        status: 502,
        payload: { ok: false, error: "downstream_error" },
      };
    },
  });
  await sleep(60);
  const after = queue.get(job.id);
  assert.ok(after);
  assert.equal(after.status, "failed");
  assert.equal(after.error, "downstream_error");
});
