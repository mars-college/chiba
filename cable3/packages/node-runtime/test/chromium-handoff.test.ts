import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import type { LaunchOptions } from "@chiba-cable3/contracts";

type DesiredTarget = { kind: "media"; id: string };

type DesiredState = {
  revision: number;
  target: DesiredTarget;
  launch: LaunchOptions;
} | null;

type ChromiumLogEntry = {
  event: "spawn" | "term";
  ts: number;
  pid: number;
  args?: string[];
};

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
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  label: string
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (predicate(value)) return value;
    await sleep(120);
  }
  throw new Error(`timeout:${label}:${timeoutMs}`);
}

async function waitForHttpOk(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not ready yet
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

async function readChromiumLog(logPath: string): Promise<ChromiumLogEntry[]> {
  const raw = await fs.readFile(logPath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChromiumLogEntry);
}

test("chromium handoff stages next window before terminating current window", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "c3-node-chromium-handoff-"));
  const cacheDir = path.join(tempRoot, "cache");
  const runtimeDir = path.join(tempRoot, "runtime");
  const chromiumLog = path.join(tempRoot, "mock-chromium.jsonl");
  const chromiumBinPath = path.join(tempRoot, "mock-chromium.js");
  const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const localNodePath = path.join(packageDir, "src/local-node.ts");

  const nodeId = "node-web-handoff";
  const namespace = "test";
  let desired: DesiredState = {
    revision: 1,
    target: { kind: "media", id: "guide-target" },
    launch: { mode: "guide" },
  };

  let nodeProcess: ChildProcessWithoutNullStreams | null = null;
  let controlServer: Server | null = null;
  let webServer: Server | null = null;

  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.mkdir(runtimeDir, { recursive: true });

    await fs.writeFile(
      chromiumBinPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
const logPath = process.env.C3_MOCK_CHROMIUM_LOG;
function write(entry) {
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\\n");
}
write({ event: "spawn", ts: Date.now(), pid: process.pid, args: process.argv.slice(2) });
process.on("SIGTERM", () => {
  write({ event: "term", ts: Date.now(), pid: process.pid });
  process.exit(0);
});
setInterval(() => {}, 1000);
`,
      { mode: 0o755 }
    );

    const webPort = await getFreePort();
    const guideBase = `http://127.0.0.1:${webPort}/guide`;
    const webUrl = `http://127.0.0.1:${webPort}/web`;
    webServer = http.createServer((req, res) => {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname === "/guide" || pathname === "/web") {
        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end("<html><body>ok</body></html>");
        return;
      }
      res.statusCode = 404;
      res.end("not_found");
    });
    await new Promise<void>((resolve, reject) => {
      webServer?.once("error", reject);
      webServer?.listen(webPort, "127.0.0.1", () => resolve());
    });

    const controlPort = await getFreePort();
    controlServer = http.createServer(async (req, res) => {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = url.pathname;

      if (method === "GET" && pathname === `/api/v1/runtime/resolve/${nodeId}`) {
        const isGuide = desired?.target.id === "guide-target";
        sendJson(res, 200, {
          ok: true,
          screenId: nodeId,
          namespace,
          desired,
          resolved: {
            items:
              desired && !isGuide
                ? [
                    {
                      itemId: "m-web-1:0",
                      mediaId: "m-web-1",
                      sourceType: "url",
                      sourceValue: webUrl,
                      cache: false,
                      renderer: "web",
                      title: "Web target",
                    },
                  ]
                : [],
            warnings: [],
            cache: { total: 0, cacheable: 0 },
            renderers: {
              mpv: 0,
              web: desired && !isGuide ? 1 : 0,
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
        await readJson(req);
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
        "--guide-base-url",
        guideBase,
        "--cache-dir",
        cacheDir,
        "--runtime-dir",
        runtimeDir,
        "--chromium-bin",
        chromiumBinPath,
        "--switch-overlap-ms",
        "120",
      ],
      {
        cwd: packageDir,
        stdio: "pipe",
        env: {
          ...process.env,
          C3_MOCK_CHROMIUM_LOG: chromiumLog,
        },
      }
    );

    await waitForHttpOk(`http://127.0.0.1:${nodePort}/health`, 10_000);
    await waitFor(
      async () => {
        const statusRes = await fetch(`http://127.0.0.1:${nodePort}/status`);
        return (await statusRes.json()) as {
          runtime: { backend: string; activeRevision: number | null };
        };
      },
      (json) => json.runtime.backend === "chromium" && json.runtime.activeRevision === 1,
      10_000,
      "guide_ready"
    );

    desired = {
      revision: 2,
      target: { kind: "media", id: "web-target" },
      launch: { mode: "gallery" },
    };

    await waitFor(
      async () => {
        const statusRes = await fetch(`http://127.0.0.1:${nodePort}/status`);
        return (await statusRes.json()) as {
          runtime: { backend: string; activeRevision: number | null };
        };
      },
      (json) => json.runtime.backend === "chromium" && json.runtime.activeRevision === 2,
      10_000,
      "web_ready"
    );

    const logEntries = await waitFor(
      async () => readChromiumLog(chromiumLog),
      (entries) => entries.filter((entry) => entry.event === "spawn").length >= 2,
      10_000,
      "chromium_spawns"
    );
    const spawnEntries = logEntries.filter((entry) => entry.event === "spawn");
    const firstSpawn = spawnEntries[0];
    const secondSpawn = spawnEntries[1];
    assert.ok(firstSpawn, "missing_first_spawn");
    assert.ok(secondSpawn, "missing_second_spawn");
    assert.ok(firstSpawn.args?.some((arg) => arg.includes("/guide")), "first_spawn_guide_url");
    assert.ok(secondSpawn.args?.some((arg) => arg.includes("/web")), "second_spawn_web_url");

    const firstTerm = await waitFor(
      async () => readChromiumLog(chromiumLog),
      (entries) => entries.some((entry) => entry.event === "term" && entry.pid === firstSpawn.pid),
      10_000,
      "first_chromium_term"
    );
    const firstTermEntry = firstTerm.find(
      (entry) => entry.event === "term" && entry.pid === firstSpawn.pid
    );
    assert.ok(firstTermEntry, "missing_first_term");
    // Critical handoff guarantee: new chromium is mapped before old fullscreen window is torn down.
    assert.ok(
      secondSpawn.ts <= firstTermEntry.ts,
      `expected_second_spawn_before_first_term:spawn=${secondSpawn.ts}:term=${firstTermEntry.ts}`
    );
  } finally {
    if (nodeProcess) await stopChild(nodeProcess);
    if (controlServer) await closeServer(controlServer);
    if (webServer) await closeServer(webServer);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
