import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import {
  ingestUploadedFiles,
  ingestUploadedMultipart,
  ingestYouTube,
  readMultipartUploadFromRequest,
} from "../src/ingest/runtime.ts";
import {
  IngestUploadMetadataSchema,
  type ResourceImportPayload,
} from "@chiba-cable3/contracts";

type PersistCall = {
  payload: ResourceImportPayload;
};

function commandPath(name: string): string | null {
  const out = spawnSync("which", [name], { encoding: "utf8" });
  if (out.status !== 0) return null;
  const value = (out.stdout || "").trim();
  return value || null;
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function startServer(app: express.Express): Promise<{ baseUrl: string; server: http.Server }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
  };
}

async function withStubbedTools<T>(run: (ctx: { logPath: string }) => Promise<T>): Promise<T> {
  const unzipReal = commandPath("unzip");
  const zipReal = commandPath("zip");
  if (!unzipReal || !zipReal) {
    return run({ logPath: "" });
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "c3-ingest-http-"));
  const binDir = path.join(tmp, "bin");
  const logPath = path.join(tmp, "stub.log");
  await fs.mkdir(binDir, { recursive: true });

  const writeStub = async (name: string, content: string) => {
    const filePath = path.join(binDir, name);
    await fs.writeFile(filePath, content, { mode: 0o755 });
  };

  await writeStub(
    "unzip",
    [
      "#!/bin/sh",
      "echo \"unzip $*\" >> \"$INGEST_STUB_LOG\"",
      `exec "${unzipReal}" "$@"`,
    ].join("\n")
  );
  await writeStub(
    "ffmpeg",
    [
      "#!/bin/sh",
      "echo \"ffmpeg $*\" >> \"$INGEST_STUB_LOG\"",
      "out=\"\"",
      "for arg in \"$@\"; do out=\"$arg\"; done",
      "printf 'stub-thumbnail' > \"$out\"",
      "exit 0",
    ].join("\n")
  );
  await writeStub(
    "yt-dlp",
    [
      "#!/bin/sh",
      "echo \"yt-dlp $*\" >> \"$INGEST_STUB_LOG\"",
      "template=\"\"",
      "prev=\"\"",
      "for arg in \"$@\"; do",
      "  if [ \"$prev\" = \"-o\" ]; then template=\"$arg\"; fi",
      "  prev=\"$arg\"",
      "done",
      "if [ -z \"$template\" ]; then exit 1; fi",
      "out=$(printf '%s' \"$template\" | sed 's/%(ext)s/mp4/g')",
      "printf 'stub-video' > \"$out\"",
      "echo \"[download] 50.0% of 1MiB\"",
      "echo \"[download] 100.0% of 1MiB\"",
      "exit 0",
    ].join("\n")
  );

  const prevPath = process.env.PATH;
  const prevLog = process.env.INGEST_STUB_LOG;
  process.env.PATH = `${binDir}:${prevPath || ""}`;
  process.env.INGEST_STUB_LOG = logPath;

  try {
    return await run({ logPath });
  } finally {
    if (typeof prevPath === "string") process.env.PATH = prevPath;
    else delete process.env.PATH;
    if (typeof prevLog === "string") process.env.INGEST_STUB_LOG = prevLog;
    else delete process.env.INGEST_STUB_LOG;
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

test("upload endpoint ingests multipart files and persists media resources", async () => {
  await withStubbedTools(async () => {
    const calls: PersistCall[] = [];
    const app = express();
    app.post("/api/v1/ingest/upload", async (req, res) => {
      const result = await ingestUploadedMultipart({
        req,
        db: {} as never,
        persistResources: async ({ payload }) => {
          calls.push({ payload });
          return {
            media: payload.media.length,
            playlists: payload.playlists.length,
            blocks: payload.blocks.length,
            channels: payload.channels.length,
            profiles: payload.profiles.length,
          };
        },
      });
      res.status(result.status).json(result.payload);
    });

    const { baseUrl, server } = await startServer(app);
    try {
      const body = new FormData();
      body.append("files", new File([Buffer.from("image-a")], "a.jpg", { type: "image/jpeg" }));
      body.append("files", new File([Buffer.from("video-b")], "b.mp4", { type: "video/mp4" }));

      const res = await fetch(`${baseUrl}/api/v1/ingest/upload`, {
        method: "POST",
        body,
      });
      assert.equal(res.status, 200);
      const json = (await res.json()) as { ok: boolean; counts: { media: number } };
      assert.equal(json.ok, true);
      assert.equal(json.counts.media, 2);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.payload.media.length, 2);
    } finally {
      await closeServer(server);
    }
  });
});

test("upload endpoint accepts zip multipart and invokes unzip stub", async () => {
  await withStubbedTools(async ({ logPath }) => {
    const zipPath = commandPath("zip");
    if (!zipPath) return;

    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "c3-zip-fixture-"));
    const fixtureFile = path.join(fixtureRoot, "inside.jpg");
    const fixtureZip = path.join(fixtureRoot, "bundle.zip");
    try {
      await fs.writeFile(fixtureFile, "zip-image", "utf8");
      const zipRun = spawnSync(zipPath, ["-q", fixtureZip, "inside.jpg"], {
        cwd: fixtureRoot,
        encoding: "utf8",
      });
      assert.equal(zipRun.status, 0);

      const calls: PersistCall[] = [];
      const app = express();
      app.post("/api/v1/ingest/upload", async (req, res) => {
        const result = await ingestUploadedMultipart({
          req,
          db: {} as never,
          persistResources: async ({ payload }) => {
            calls.push({ payload });
            return {
              media: payload.media.length,
              playlists: payload.playlists.length,
              blocks: payload.blocks.length,
              channels: payload.channels.length,
              profiles: payload.profiles.length,
            };
          },
        });
        res.status(result.status).json(result.payload);
      });

      const { baseUrl, server } = await startServer(app);
      try {
        const zipBytes = await fs.readFile(fixtureZip);
        const body = new FormData();
        body.append("archive", new File([zipBytes], "bundle.zip", { type: "application/zip" }));
        const res = await fetch(`${baseUrl}/api/v1/ingest/upload`, {
          method: "POST",
          body,
        });
        assert.equal(res.status, 200);
        const json = (await res.json()) as { ok: boolean; counts: { media: number } };
        assert.equal(json.ok, true);
        assert.equal(json.counts.media >= 1, true);
        assert.equal(calls.length, 1);
        const log = await fs.readFile(logPath, "utf8").catch(() => "");
        assert.equal(log.includes("unzip"), true);
      } finally {
        await closeServer(server);
      }
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});

test("upload multipart metadata applies artist/description to imported media", async () => {
  await withStubbedTools(async () => {
    const calls: PersistCall[] = [];
    const app = express();
    app.post("/api/v1/ingest/upload", async (req, res) => {
      const parsed = await readMultipartUploadFromRequest(req);
      const metadata = IngestUploadMetadataSchema.parse(parsed.fields);
      const result = await ingestUploadedFiles({
        db: {} as never,
        contentLength: parsed.contentLength,
        files: parsed.files,
        metadata,
        persistResources: async ({ payload }) => {
          calls.push({ payload });
          return {
            media: payload.media.length,
            playlists: payload.playlists.length,
            blocks: payload.blocks.length,
            channels: payload.channels.length,
            profiles: payload.profiles.length,
          };
        },
      });
      res.status(result.status).json(result.payload);
    });

    const { baseUrl, server } = await startServer(app);
    try {
      const body = new FormData();
      body.append("artist", "Ops Artist");
      body.append("description", "Batch import from staging");
      body.append("files", new File([Buffer.from("image-a")], "a.jpg", { type: "image/jpeg" }));

      const res = await fetch(`${baseUrl}/api/v1/ingest/upload`, {
        method: "POST",
        body,
      });
      assert.equal(res.status, 200);
      assert.equal(calls.length, 1);
      const media = calls[0]?.payload.media[0];
      assert.equal(media?.artist, "Ops Artist");
      assert.equal(media?.description, "Batch import from staging");
    } finally {
      await closeServer(server);
    }
  });
});

test("youtube endpoint invokes yt-dlp and ffmpeg stubs via ingest runtime", async () => {
  await withStubbedTools(async ({ logPath }) => {
    const prevMaxHeight = process.env.CHIBA3_INGEST_YOUTUBE_MAX_HEIGHT;
    const prevFormat = process.env.CHIBA3_INGEST_YOUTUBE_FORMAT;
    delete process.env.CHIBA3_INGEST_YOUTUBE_FORMAT;
    delete process.env.CHIBA3_INGEST_YOUTUBE_MAX_HEIGHT;
    const calls: PersistCall[] = [];
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.post("/api/v1/ingest/youtube", async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await ingestYouTube({
        db: {} as never,
        url: String(body.url ?? ""),
        persistResources: async ({ payload }) => {
          calls.push({ payload });
          return {
            media: payload.media.length,
            playlists: payload.playlists.length,
            blocks: payload.blocks.length,
            channels: payload.channels.length,
            profiles: payload.profiles.length,
          };
        },
      });
      res.status(result.status).json(result.payload);
    });

    const { baseUrl, server } = await startServer(app);
    try {
      const res = await fetch(`${baseUrl}/api/v1/ingest/youtube`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        }),
      });
      assert.equal(res.status, 200);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.payload.media.length, 1);
      const log = await fs.readFile(logPath, "utf8").catch(() => "");
      assert.equal(log.includes("yt-dlp"), true);
      assert.equal(log.includes("ffmpeg"), true);
      assert.equal(log.includes("libx264"), true);
      assert.equal(log.includes("height<=720"), true);
      assert.equal(log.includes("vcodec~='^avc1'"), true);
      assert.equal(log.includes("acodec~='^(mp4a|aac)'"), true);
    } finally {
      if (typeof prevMaxHeight === "string") process.env.CHIBA3_INGEST_YOUTUBE_MAX_HEIGHT = prevMaxHeight;
      else delete process.env.CHIBA3_INGEST_YOUTUBE_MAX_HEIGHT;
      if (typeof prevFormat === "string") process.env.CHIBA3_INGEST_YOUTUBE_FORMAT = prevFormat;
      else delete process.env.CHIBA3_INGEST_YOUTUBE_FORMAT;
      await closeServer(server);
    }
  });
});

test("youtube endpoint can disable Pi-safe transcode via env override", async () => {
  await withStubbedTools(async ({ logPath }) => {
    const prevTranscode = process.env.CHIBA3_INGEST_YOUTUBE_TRANSCODE;
    process.env.CHIBA3_INGEST_YOUTUBE_TRANSCODE = "0";
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.post("/api/v1/ingest/youtube", async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await ingestYouTube({
        db: {} as never,
        url: String(body.url ?? ""),
        persistResources: async ({ payload }) => ({
          media: payload.media.length,
          playlists: payload.playlists.length,
          blocks: payload.blocks.length,
          channels: payload.channels.length,
          profiles: payload.profiles.length,
        }),
      });
      res.status(result.status).json(result.payload);
    });

    const { baseUrl, server } = await startServer(app);
    try {
      const res = await fetch(`${baseUrl}/api/v1/ingest/youtube`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        }),
      });
      assert.equal(res.status, 200);
      const log = await fs.readFile(logPath, "utf8").catch(() => "");
      assert.equal(log.includes("ffmpeg"), true);
      assert.equal(log.includes("libx264"), false);
    } finally {
      if (typeof prevTranscode === "string") process.env.CHIBA3_INGEST_YOUTUBE_TRANSCODE = prevTranscode;
      else delete process.env.CHIBA3_INGEST_YOUTUBE_TRANSCODE;
      await closeServer(server);
    }
  });
});

test("youtube endpoint uses explicit CHIBA3_INGEST_YOUTUBE_FORMAT when provided", async () => {
  await withStubbedTools(async ({ logPath }) => {
    const prevFormat = process.env.CHIBA3_INGEST_YOUTUBE_FORMAT;
    process.env.CHIBA3_INGEST_YOUTUBE_FORMAT = "bestvideo[height<=360]+bestaudio/best[height<=360]";
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.post("/api/v1/ingest/youtube", async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const result = await ingestYouTube({
        db: {} as never,
        url: String(body.url ?? ""),
        persistResources: async ({ payload }) => ({
          media: payload.media.length,
          playlists: payload.playlists.length,
          blocks: payload.blocks.length,
          channels: payload.channels.length,
          profiles: payload.profiles.length,
        }),
      });
      res.status(result.status).json(result.payload);
    });

    const { baseUrl, server } = await startServer(app);
    try {
      const res = await fetch(`${baseUrl}/api/v1/ingest/youtube`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        }),
      });
      assert.equal(res.status, 200);
      const log = await fs.readFile(logPath, "utf8").catch(() => "");
      assert.equal(log.includes("bestvideo[height<=360]+bestaudio/best[height<=360]"), true);
    } finally {
      if (typeof prevFormat === "string") process.env.CHIBA3_INGEST_YOUTUBE_FORMAT = prevFormat;
      else delete process.env.CHIBA3_INGEST_YOUTUBE_FORMAT;
      await closeServer(server);
    }
  });
});
