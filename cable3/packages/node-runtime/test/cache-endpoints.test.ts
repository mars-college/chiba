import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

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

test("node cache endpoints expose stash summary and can clear cached files", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cable3-node-cache-"));
  const cacheDir = path.join(tempRoot, "cache");
  const runtimeDir = path.join(tempRoot, "runtime");
  const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const localNodePath = path.join(packageDir, "src/local-node.ts");

  const nodeId = "node-cache-test-1";
  const namespace = "test";

  let nodeProcess: ChildProcessWithoutNullStreams | null = null;
  let controlServer: Server | null = null;

  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, "a.bin"), Buffer.from("aaaa", "utf8"));
    await fs.writeFile(path.join(cacheDir, "b.bin"), Buffer.from("bbbbbb", "utf8"));

    const latestRuntimeByKey = new Map<string, unknown>();
    const keyFor = (id: string, ns: string) => `${id}::${ns}`;

    const controlPort = await getFreePort();
    controlServer = http.createServer(async (req, res) => {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = url.pathname;

      if (method === "GET" && pathname === `/api/v1/runtime/resolve/${nodeId}`) {
        sendJson(res, 200, {
          ok: true,
          screenId: nodeId,
          namespace,
          desired: null,
          resolved: {
            items: [],
            warnings: [],
            cache: { total: 0, cacheable: 0 },
            renderers: { mpv: 0, web: 0 },
          },
        });
        return;
      }

      if (
        method === "POST" &&
        pathname.startsWith("/api/v1/nodes/") &&
        pathname.endsWith("/runtime-report")
      ) {
        const payload = await readJson(req);
        const ns = String(payload.namespace ?? "");
        latestRuntimeByKey.set(keyFor(String(payload.nodeId ?? ""), ns), payload);
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { ok: false, error: "not_found" });
    });
    await new Promise<void>((resolve, reject) => {
      controlServer?.once("error", reject);
      controlServer?.listen(controlPort, "127.0.0.1", () => resolve());
    });

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
      ],
      {
        cwd: packageDir,
        stdio: "pipe",
      }
    );

    await waitForHttpOk(`http://127.0.0.1:${nodePort}/health`, 10_000);

    const inspectRes = await fetch(`http://127.0.0.1:${nodePort}/api/cache`);
    assert.equal(inspectRes.status, 200);
    const inspectJson = (await inspectRes.json()) as {
      ok: boolean;
      nodeId: string;
      cache: { fileCount: number; bytes: number; files: Array<{ name: string }> };
    };
    assert.equal(inspectJson.ok, true);
    assert.equal(inspectJson.nodeId, nodeId);
    assert.equal(inspectJson.cache.fileCount, 2);
    assert.equal(inspectJson.cache.bytes, 10);
    assert.deepEqual(
      inspectJson.cache.files.map((row) => row.name).sort(),
      ["a.bin", "b.bin"]
    );

    const clearRes = await fetch(`http://127.0.0.1:${nodePort}/api/cache`, {
      method: "DELETE",
    });
    assert.equal(clearRes.status, 200);
    const clearJson = (await clearRes.json()) as {
      ok: boolean;
      nodeId: string;
      deletedFiles: number;
      deletedBytes: number;
      before: { fileCount: number; bytes: number };
      after: { fileCount: number; bytes: number };
    };
    assert.equal(clearJson.ok, true);
    assert.equal(clearJson.nodeId, nodeId);
    assert.equal(clearJson.deletedFiles, 2);
    assert.equal(clearJson.deletedBytes, 10);
    assert.equal(clearJson.before.fileCount, 2);
    assert.equal(clearJson.after.fileCount, 0);
    assert.equal(clearJson.after.bytes, 0);

    const inspectAfterRes = await fetch(`http://127.0.0.1:${nodePort}/api/cache`);
    assert.equal(inspectAfterRes.status, 200);
    const inspectAfterJson = (await inspectAfterRes.json()) as {
      cache: { fileCount: number; bytes: number };
    };
    assert.equal(inspectAfterJson.cache.fileCount, 0);
    assert.equal(inspectAfterJson.cache.bytes, 0);
  } finally {
    if (nodeProcess) {
      await stopChild(nodeProcess);
    }
    if (controlServer) await closeServer(controlServer);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
