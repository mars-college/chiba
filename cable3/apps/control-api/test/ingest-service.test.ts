import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INGEST_MAX_UPLOAD_BYTES,
  INGEST_MAX_UPLOAD_FILES,
  buildDeterministicMediaId,
  classifyMediaFile,
  normalizeUploadPlan,
  parseEdenCollectionInput,
} from "../src/ingest/service.ts";

test("classifies common image/video/audio files", () => {
  assert.equal(classifyMediaFile({ filename: "photo.JPG" }), "image");
  assert.equal(classifyMediaFile({ filename: "clip.mp4" }), "video");
  assert.equal(classifyMediaFile({ filename: "track.flac" }), "audio");
  assert.equal(classifyMediaFile({ filename: "notes.txt" }), "unsupported");
});

test("builds deterministic media ids from source keys", () => {
  const a = buildDeterministicMediaId("upload", "file:/nas/assets/a.jpg");
  const b = buildDeterministicMediaId("upload", "file:/nas/assets/a.jpg");
  const c = buildDeterministicMediaId("upload", "file:/nas/assets/b.jpg");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^m-upload-[a-f0-9]{12}$/);
});

test("normalizes direct-file upload and enforces max file count", () => {
  const valid = normalizeUploadPlan({
    contentLength: 1024,
    files: Array.from({ length: INGEST_MAX_UPLOAD_FILES }, (_, i) => ({
      filename: `f-${i}.jpg`,
      mimeType: "image/jpeg",
      sizeBytes: 100,
      fieldName: "files",
    })),
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.mode, "files");
    assert.equal(valid.files.length, INGEST_MAX_UPLOAD_FILES);
  }

  const tooMany = normalizeUploadPlan({
    contentLength: 1024,
    files: Array.from({ length: INGEST_MAX_UPLOAD_FILES + 1 }, (_, i) => ({
      filename: `f-${i}.jpg`,
      mimeType: "image/jpeg",
      sizeBytes: 100,
      fieldName: "files",
    })),
  });
  assert.equal(tooMany.ok, false);
  if (!tooMany.ok) {
    assert.equal(tooMany.status, 413);
    assert.equal(tooMany.error, "too_many_files");
  }
});

test("normalizes zip upload mode and bypasses per-file count limit", () => {
  const result = normalizeUploadPlan({
    contentLength: 1024,
    files: [
      {
        filename: "bulk-media.zip",
        mimeType: "application/zip",
        sizeBytes: 1000,
        fieldName: "archive",
      },
    ],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mode, "zip");
    assert.equal(result.archive.filename, "bulk-media.zip");
  }
});

test("rejects payloads larger than 2GB", () => {
  const result = normalizeUploadPlan({
    contentLength: INGEST_MAX_UPLOAD_BYTES + 1,
    files: [
      {
        filename: "bulk-media.zip",
        mimeType: "application/zip",
        sizeBytes: 1000,
        fieldName: "archive",
      },
    ],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 413);
    assert.equal(result.error, "payload_too_large");
  }
});

test("parses Eden collection URL and raw collection id deterministically", () => {
  const fromUrl = parseEdenCollectionInput({
    input: "https://app.eden.art/collections/6980dc94fec7de4f6abca3a9",
  });
  assert.deepEqual(fromUrl, {
    collectionId: "6980dc94fec7de4f6abca3a9",
    db: "PROD",
  });

  const fromId = parseEdenCollectionInput({
    input: "698739a2eb7e84c5958045d3",
  });
  assert.deepEqual(fromId, {
    collectionId: "698739a2eb7e84c5958045d3",
    db: "PROD",
  });

  const stage = parseEdenCollectionInput({
    input: "https://staging.eden.art/collections/698739a2eb7e84c5958045d3",
  });
  assert.deepEqual(stage, {
    collectionId: "698739a2eb7e84c5958045d3",
    db: "STAGE",
  });
});

test("rejects non-Eden URLs for collection parsing", () => {
  assert.throws(
    () =>
      parseEdenCollectionInput({
        input: "https://example.com/collections/abc123",
      }),
    /eden_host_required/
  );
});
