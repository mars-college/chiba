import assert from "node:assert/strict";
import { test } from "node:test";
import { createControlApiClient } from "../src/control-api.js";
import {
  OpsNodeCacheClearResponseSchema,
  OpsNodeCacheInspectResponseSchema,
  OpsNodeRuntimeStatusResponseSchema,
} from "../src/index.js";

type MockResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

function response(args: { status?: number; body?: unknown }): MockResponse {
  const status = args.status ?? 200;
  const body = args.body ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("deleteMedia uses canonical DELETE route and parses payload", async () => {
  const calls: Array<{ input: string; init?: { method?: string } }> = [];
  const client = createControlApiClient({
    fetchFn: async (input, init) => {
      calls.push({ input, init: { method: init?.method } });
      return response({
        body: {
          ok: true,
          mediaId: "m-1",
          deleted: true,
          removedPlaylistItems: 1,
          removedBlockItems: 0,
          removedProfileAssignments: 0,
          updatedProfiles: 0,
          removedPlaylists: 0,
          removedBlocks: 0,
          removedChannels: 0,
          removedProfiles: 0,
        },
      });
    },
  });

  const result = await client.deleteMedia(" m-1 ");
  assert.equal(result.mediaId, "m-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, "/api/v1/resources/media/m-1");
  assert.equal(calls[0]?.init?.method, "DELETE");
});

test("startYouTubeIngestJob validates request and returns typed job", async () => {
  let callCount = 0;
  const client = createControlApiClient({
    // Unit test only: the injected fetch mock ensures no real network/resource access.
    fetchFn: async () => {
      callCount += 1;
      return response({
        body: {
          ok: true,
          job: {
            id: "ing-1",
            kind: "youtube",
            status: "queued",
            createdAt: 1,
            updatedAt: 1,
            progress: { current: 0, total: 1, percent: 0, message: "queued" },
          },
        },
      });
    },
  });

  const result = await client.startYouTubeIngestJob({
    url: "https://example.invalid/fake-youtube-id",
  });
  assert.equal(result.ok, true);
  assert.equal(result.job.kind, "youtube");
  assert.equal(callCount, 1);
});

test("getResourceSnapshot parses snapshot defaults", async () => {
  const client = createControlApiClient({
    fetchFn: async () =>
      response({
        body: {
          ok: true,
          snapshot: {},
        },
      }),
  });

  const result = await client.getResourceSnapshot();
  assert.deepEqual(result.snapshot.media, []);
  assert.deepEqual(result.snapshot.playlists, []);
  assert.deepEqual(result.snapshot.blocks, []);
  assert.deepEqual(result.snapshot.channels, []);
  assert.deepEqual(result.snapshot.profiles, []);
});

test("non-JSON error bodies are surfaced as ControlApiError instead of parse crashes", async () => {
  const client = createControlApiClient({
    fetchFn: async () => ({
      ok: false,
      status: 404,
      async text() {
        return "<!DOCTYPE html><html><body>Cannot DELETE /api/v1/resources/media/x</body></html>";
      },
    }),
  });

  await assert.rejects(
    () => client.deleteMedia("x"),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "ControlApiError" &&
      error.message.includes("Cannot DELETE /api/v1/resources/media/x")
  );
});

test("ops node cache schemas validate typed inspect + clear payloads", () => {
  const inspect = OpsNodeCacheInspectResponseSchema.parse({
    ok: true,
    nodeId: "pluto-local",
    registryId: "local",
    namespace: "local",
    host: "192.168.0.172",
    nodePort: 8080,
    cache: {
      dir: "/tmp/chiba-cable3-cache/pluto-local",
      files: [{ name: "abc.mp4", size: 120, mtimeMs: 1700000000000 }],
      bytes: 120,
      fileCount: 1,
    },
  });
  assert.equal(inspect.cache.fileCount, 1);

  const clear = OpsNodeCacheClearResponseSchema.parse({
    ok: true,
    nodeId: "pluto-local",
    registryId: "local",
    namespace: "local",
    host: "192.168.0.172",
    nodePort: 8080,
    deletedFiles: 2,
    deletedBytes: 1024,
    before: {
      dir: "/tmp/chiba-cable3-cache/pluto-local",
      files: [{ name: "a.mp4", size: 512, mtimeMs: 1700000000000 }],
      bytes: 1024,
      fileCount: 2,
    },
    after: {
      dir: "/tmp/chiba-cable3-cache/pluto-local",
      files: [],
      bytes: 0,
      fileCount: 0,
    },
  });
  assert.equal(clear.after.fileCount, 0);
});

test("ops node runtime status schema validates playback progress payload", () => {
  const parsed = OpsNodeRuntimeStatusResponseSchema.parse({
    ok: true,
    nodeId: "pluto-local",
    registryId: "local",
    namespace: "local",
    host: "192.168.0.172",
    nodePort: 8080,
    status: {
      phase: "active",
      desiredRevision: 2,
      activeRevision: 2,
      backend: "mpv",
      currentTarget: { kind: "playlist", id: "new" },
      currentItemId: "new:1:m-upload-123",
      cacheReady: 2,
      cacheTotal: 2,
      warnings: [],
      error: null,
      playback: {
        state: "playing",
        positionSec: 4.2,
        durationSec: 15,
        progressPercent: 28,
        itemId: "new:1:m-upload-123",
        mediaId: "m-upload-123",
        title: "image.png",
        updatedAt: 1700000000000,
      },
    },
  });
  assert.equal(parsed.status.playback?.progressPercent, 28);
});
