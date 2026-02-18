import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import type { LaunchOptions, NodeRuntimeReportV1 } from "@chiba-cable3/contracts";

type DesiredTarget = { kind: "playlist"; id: string };

type DesiredState = {
  revision: number;
  target: DesiredTarget;
  launch: LaunchOptions;
} | null;

type MediaResource = {
  id: string;
  sourceType: "url";
  sourceValue: string;
  cache: boolean;
};

type PlaylistItem = {
  index: number;
  mediaId?: string;
};

type PlaylistResource = {
  id: string;
  items: PlaylistItem[];
};

function hashKey(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function sourceExt(sourceValue: string): string {
  const raw = sourceValue.trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return path.extname(parsed.pathname || "").toLowerCase();
  } catch {
    return path.extname(raw).toLowerCase();
  }
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (!body.trim()) return {};
  return JSON.parse(body) as Record<string, unknown>;
}

async function getFreePort(): Promise<number> {
  const server = http.createServer((_req, res) => {
    res.statusCode = 204;
    res.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitFor<T>(
  read: () => T | Promise<T>,
  predicate: (value: T) => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (await predicate(value)) return value;
    await sleep(100);
  }
  throw new Error(`timeout:${label}:${timeoutMs}ms`);
}

async function waitForHttpOk(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await sleep(100);
  }
  throw new Error(`timeout:http_ready:${url}`);
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    }),
    sleep(2_000).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }),
  ]);
}

test("deterministic switchover increments revision and reactivates with updated playlist", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cable3-switchover-"));
  const cacheDir = path.join(tempRoot, "cache");
  const runtimeDir = path.join(tempRoot, "runtime");
  const assetsDir = path.join(tempRoot, "assets");
  const mpvLogPath = path.join(tempRoot, "mock-mpv.log");
  const mpvBinPath = path.join(tempRoot, "mock-mpv.sh");
  const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const localNodePath = path.join(packageDir, "src/local-node.ts");

  const nodeId = "node-deterministic-switch";
  const namespace = "test";
  const playlistAId = "playlist-a";
  const playlistBId = "playlist-b";
  const mediaY = "media-y";
  const mediaZ = "media-z";
  const mediaW = "media-w";
  const imageDurationSec = 4;

  let nodeProcess: ChildProcessWithoutNullStreams | null = null;
  let assetServer: Server | null = null;
  let controlServer: Server | null = null;

  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.mkdir(assetsDir, { recursive: true });

    const assetYPath = path.join(assetsDir, "y.jpg");
    const assetZPath = path.join(assetsDir, "z.jpg");
    const assetWPath = path.join(assetsDir, "w.jpg");
    await fs.writeFile(assetYPath, "asset-y\n", "utf8");
    await fs.writeFile(assetZPath, "asset-z\n", "utf8");
    await fs.writeFile(assetWPath, "asset-w\n", "utf8");

    const assetHits = {
      y: 0,
      z: 0,
      w: 0,
    };

    const assetPort = await getFreePort();
    assetServer = http.createServer(async (req, res) => {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname === "/y.jpg") {
        assetHits.y += 1;
        res.statusCode = 200;
        res.setHeader("content-type", "image/jpeg");
        res.end(await fs.readFile(assetYPath));
        return;
      }
      if (pathname === "/z.jpg") {
        assetHits.z += 1;
        res.statusCode = 200;
        res.setHeader("content-type", "image/jpeg");
        res.end(await fs.readFile(assetZPath));
        return;
      }
      if (pathname === "/w.jpg") {
        assetHits.w += 1;
        res.statusCode = 200;
        res.setHeader("content-type", "image/jpeg");
        res.end(await fs.readFile(assetWPath));
        return;
      }
      sendJson(res, 404, { ok: false, error: "not_found" });
    });
    await new Promise<void>((resolve, reject) => {
      assetServer?.once("error", reject);
      assetServer?.listen(assetPort, "127.0.0.1", () => resolve());
    });

    const mediaResources: MediaResource[] = [
      {
        id: mediaY,
        sourceType: "url",
        sourceValue: `http://127.0.0.1:${assetPort}/y.jpg`,
        cache: true,
      },
      {
        id: mediaZ,
        sourceType: "url",
        sourceValue: `http://127.0.0.1:${assetPort}/z.jpg`,
        cache: true,
      },
      {
        id: mediaW,
        sourceType: "url",
        sourceValue: `http://127.0.0.1:${assetPort}/w.jpg`,
        cache: true,
      },
    ];
    const mediaById = new Map(mediaResources.map((row) => [row.id, row]));
    const playlists: PlaylistResource[] = [
      {
        id: playlistAId,
        items: [
          { index: 0, mediaId: mediaY },
          { index: 1, mediaId: mediaZ },
        ],
      },
      {
        id: playlistBId,
        items: [
          { index: 0, mediaId: mediaZ },
          { index: 1, mediaId: mediaW },
        ],
      },
    ];
    const playlistById = new Map(playlists.map((row) => [row.id, row]));

    const desiredByKey = new Map<string, DesiredState>();
    const latestRuntimeByKey = new Map<string, NodeRuntimeReportV1>();

    const keyFor = (screenId: string, ns: string) => `${screenId}::${ns}`;
    const resolveItems = (target: DesiredTarget) => {
      const playlist = playlistById.get(target.id);
      assert.ok(playlist, `missing_playlist:${target.id}`);
      return [...playlist.items]
        .sort((a, b) => a.index - b.index)
        .map((item, idx) => {
          assert.ok(item.mediaId, `playlist_item_missing_media:${playlist.id}:${item.index}`);
          const media = mediaById.get(item.mediaId);
          assert.ok(media, `missing_media:${item.mediaId}`);
          return {
            itemId: `${media.id}:${idx}`,
            mediaId: media.id,
            sourceType: media.sourceType,
            sourceValue: media.sourceValue,
            cache: media.cache,
            renderer: "mpv" as const,
          };
        });
    };

    const controlPort = await getFreePort();
    controlServer = http.createServer(async (req, res) => {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = url.pathname;

      if (method === "POST" && pathname === "/api/v1/apply/screen-assignment") {
        const body = await readJson(req);
        const screenId = String(body.screenId ?? "").trim();
        const ns = String(body.namespace ?? "").trim();
        const operationId = String(body.operationId ?? "").trim();
        const launch = (body.launch ?? {}) as LaunchOptions;
        const targetRaw = body.target as Record<string, unknown>;
        const targetKind = String(targetRaw?.kind ?? "");
        const targetId = String(targetRaw?.id ?? "");
        if (!screenId || !ns || !operationId || targetKind !== "playlist" || !targetId) {
          sendJson(res, 400, { ok: false, error: "invalid_apply_request" });
          return;
        }

        const key = keyFor(screenId, ns);
        const previous = desiredByKey.get(key);
        const nextRevision = previous ? previous.revision + 1 : 1;
        desiredByKey.set(key, {
          revision: nextRevision,
          target: { kind: "playlist", id: targetId },
          launch,
        });

        sendJson(res, 200, {
          ok: true,
          screenId,
          namespace: ns,
          desiredRevision: nextRevision,
          operationId,
          conditions: [
            {
              type: "Accepted",
              status: true,
              reason: "desired_state_present",
              updatedAt: Date.now(),
            },
          ],
        });
        return;
      }

      if (method === "GET" && pathname.startsWith("/api/v1/runtime/resolve/")) {
        const screenId = decodeURIComponent(pathname.slice("/api/v1/runtime/resolve/".length));
        const ns = String(url.searchParams.get("namespace") ?? "").trim() || namespace;
        const desired = desiredByKey.get(keyFor(screenId, ns)) ?? null;
        if (!desired) {
          sendJson(res, 200, {
            ok: true,
            screenId,
            namespace: ns,
            desired: null,
            resolved: {
              items: [],
              warnings: ["desired_state_missing"],
              cache: { total: 0, cacheable: 0 },
              renderers: { mpv: 0, web: 0 },
            },
          });
          return;
        }
        const items = resolveItems(desired.target);
        sendJson(res, 200, {
          ok: true,
          screenId,
          namespace: ns,
          desired: {
            revision: desired.revision,
            target: desired.target,
            launch: desired.launch,
          },
          resolved: {
            items,
            warnings: [],
            cache: {
              total: items.length,
              cacheable: items.filter((row) => row.cache).length,
            },
            renderers: {
              mpv: items.length,
              web: 0,
            },
          },
        });
        return;
      }

      if (
        method === "POST" &&
        pathname.startsWith("/api/v1/nodes/") &&
        pathname.endsWith("/runtime-report")
      ) {
        const payload = (await readJson(req)) as unknown as NodeRuntimeReportV1;
        const ns = String(payload.namespace ?? "");
        latestRuntimeByKey.set(keyFor(payload.nodeId, ns), payload);
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { ok: false, error: "not_found" });
    });
    await new Promise<void>((resolve, reject) => {
      controlServer?.once("error", reject);
      controlServer?.listen(controlPort, "127.0.0.1", () => resolve());
    });

    await fs.writeFile(
      mpvBinPath,
      [
        "#!/bin/sh",
        "echo \"$*\" >> \"$MOCK_MPV_LOG_FILE\"",
        "while true; do",
        "  sleep 1",
        "done",
      ].join("\n"),
      { mode: 0o755 }
    );
    await fs.writeFile(mpvLogPath, "", "utf8");

    const nodePort = await getFreePort();
    const serverPort = await getFreePort();
    const guidePort = await getFreePort();
    const controlBase = `http://127.0.0.1:${controlPort}`;

    nodeProcess = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        localNodePath,
        "--api",
        controlBase,
        "--node-id",
        nodeId,
        "--namespace",
        namespace,
        "--poll-ms",
        "120",
        "--warm-ms",
        "20",
        "--activate-ms",
        "20",
        "--image-sec",
        String(imageDurationSec),
        "--node-port",
        String(nodePort),
        "--server-port",
        String(serverPort),
        "--guide-port",
        String(guidePort),
        "--cache-dir",
        cacheDir,
        "--runtime-dir",
        runtimeDir,
        "--mpv-bin",
        mpvBinPath,
      ],
      {
        cwd: packageDir,
        env: {
          ...process.env,
          MOCK_MPV_LOG_FILE: mpvLogPath,
        },
        stdio: "pipe",
      }
    );

    await waitForHttpOk(`http://127.0.0.1:${nodePort}/health`, 10_000);

    const apply = async (operationId: string, playlistId: string) => {
      const res = await fetch(`${controlBase}/api/v1/apply/screen-assignment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          screenId: nodeId,
          namespace,
          controllerId: "deterministic-test",
          operationId,
          target: {
            kind: "playlist",
            id: playlistId,
          },
          launch: {
            mode: "gallery",
            nosplash: true,
          },
        }),
      });
      assert.equal(res.status, 200);
    };

    const runtimeKey = keyFor(nodeId, namespace);

    await apply("op-switch-1", playlistAId);
    await waitFor(
      () => latestRuntimeByKey.get(runtimeKey) ?? null,
      (report) =>
        report !== null &&
        report.phase === "active" &&
        report.desiredRevision === 1 &&
        report.activeRevision === 1 &&
        report.backend === "mpv",
      15_000,
      "active_revision_1"
    );
    await sleep(350);

    assert.equal(assetHits.y, 1);
    assert.equal(assetHits.z, 1);
    assert.equal(assetHits.w, 0);

    await apply("op-switch-2", playlistBId);
    const runtime2 = await waitFor(
      () => latestRuntimeByKey.get(runtimeKey) ?? null,
      (report) =>
        report !== null &&
        report.phase === "active" &&
        report.desiredRevision === 2 &&
        report.activeRevision === 2 &&
        report.backend === "mpv",
      15_000,
      "active_revision_2"
    );
    await sleep(450);

    assert.equal(assetHits.y, 1);
    assert.equal(assetHits.z, 1, "asset Z should be cache-reused across revisions");
    assert.equal(assetHits.w, 1);
    assert.equal(runtime2.cacheReady, 2);
    assert.equal(runtime2.cacheTotal, 2);

    const expectedY = `${hashKey(`${mediaY}:http://127.0.0.1:${assetPort}/y.jpg`)}${sourceExt(`http://127.0.0.1:${assetPort}/y.jpg`)}`;
    const expectedZ = `${hashKey(`${mediaZ}:http://127.0.0.1:${assetPort}/z.jpg`)}${sourceExt(`http://127.0.0.1:${assetPort}/z.jpg`)}`;
    const expectedW = `${hashKey(`${mediaW}:http://127.0.0.1:${assetPort}/w.jpg`)}${sourceExt(`http://127.0.0.1:${assetPort}/w.jpg`)}`;

    const cacheEntries = (await fs.readdir(cacheDir)).sort();
    assert.deepEqual(cacheEntries, [expectedW, expectedY, expectedZ].sort());

    const playlistFilePath = path.join(runtimeDir, "current.m3u8");
    const playlistRaw = await fs.readFile(playlistFilePath, "utf8");
    const playlistLines = playlistRaw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    assert.deepEqual(playlistLines, [
      path.join(cacheDir, expectedZ),
      path.join(cacheDir, expectedW),
    ]);

    const mpvRaw = await waitFor(
      () => fs.readFile(mpvLogPath, "utf8"),
      (raw) => raw.trim().split("\n").filter(Boolean).length >= 2,
      10_000,
      "mpv_two_invocations"
    );
    const mpvLines = mpvRaw
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    assert.equal(mpvLines.length, 2);
    assert.ok(mpvLines[0]?.includes("--loop-playlist=inf"));
    assert.ok(mpvLines[1]?.includes("--loop-playlist=inf"));
    assert.ok(mpvLines[0]?.includes(`--image-display-duration=${imageDurationSec}`));
    assert.ok(mpvLines[1]?.includes(`--image-display-duration=${imageDurationSec}`));

    const statusRes = await fetch(`http://127.0.0.1:${nodePort}/status`);
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as {
      runtime: {
        phase: string;
        desiredRevision: number | null;
        activeRevision: number | null;
      };
    };
    assert.equal(statusJson.runtime.phase, "active");
    assert.equal(statusJson.runtime.desiredRevision, 2);
    assert.equal(statusJson.runtime.activeRevision, 2);
  } finally {
    if (nodeProcess) {
      await stopChild(nodeProcess);
    }
    if (assetServer) await closeServer(assetServer);
    if (controlServer) await closeServer(controlServer);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
