import assert from "node:assert/strict";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import {
  ingestEdenCollection,
  ingestYouTube,
  readThumbnail,
} from "../src/ingest/runtime.ts";

test("youtube ingest rejects non-youtube URLs", async () => {
  const result = await ingestYouTube({
    db: {} as never,
    url: "https://example.com/video.mp4",
  });
  const payload = result.payload as Record<string, unknown>;
  assert.equal(result.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, "invalid_youtube_url");
});

test("eden ingest requires api key when not provided in env/request", async () => {
  const original = process.env.EDEN_API_KEY;
  delete process.env.EDEN_API_KEY;
  try {
    const result = await ingestEdenCollection({
      db: {} as never,
      input: "6980dc94fec7de4f6abca3a9",
    });
    const payload = result.payload as Record<string, unknown>;
    assert.equal(result.status, 400);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "eden_api_key_required");
  } finally {
    if (typeof original === "string") process.env.EDEN_API_KEY = original;
    else delete process.env.EDEN_API_KEY;
  }
});

test("thumbnail read returns 404 for missing files", async () => {
  const prevShareRoot = process.env.SHARE_ROOT;
  process.env.SHARE_ROOT = path.join(os.tmpdir(), `c3-thumb-missing-${Date.now()}`);
  try {
    const result = await readThumbnail({ fileName: "not-found.jpg" });
    assert.equal(result.status, 404);
    assert.equal(result.error, "thumbnail_not_found");
  } finally {
    if (typeof prevShareRoot === "string") process.env.SHARE_ROOT = prevShareRoot;
    else delete process.env.SHARE_ROOT;
  }
});
