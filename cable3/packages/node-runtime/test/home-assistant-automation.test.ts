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

test("home assistant automation emits key/text input sequence when env creds are configured", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "c3-node-ha-auto-"));
  const cacheDir = path.join(tempRoot, "cache");
  const runtimeDir = path.join(tempRoot, "runtime");
  const chromiumLog = path.join(tempRoot, "mock-chromium.log");
  const inputLog = path.join(tempRoot, "mock-input.log");
  const chromiumBinPath = path.join(tempRoot, "mock-chromium.sh");
  const inputBinPath = path.join(tempRoot, "mock-input.sh");
  const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const localNodePath = path.join(packageDir, "src/local-node.ts");

  const nodeId = "node-ha-automation";
  const namespace = "test";
  const haUser = "martian";
  const haPass = "marscollege!";

  let nodeProcess: ChildProcessWithoutNullStreams | null = null;
  let controlServer: Server | null = null;
  let webServer: Server | null = null;

  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.mkdir(runtimeDir, { recursive: true });

    await fs.writeFile(
      chromiumBinPath,
      `#!/usr/bin/env bash
echo "$@" >> "${chromiumLog}"
sleep 3600
`,
      { mode: 0o755 }
    );
    await fs.writeFile(
      inputBinPath,
      `#!/usr/bin/env bash
echo "$@" >> "${inputLog}"
exit 0
`,
      { mode: 0o755 }
    );

    const webPort = await getFreePort();
    const webUrl = `http://127.0.0.1:${webPort}/home-assistant`;
    webServer = http.createServer((req, res) => {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname === "/home-assistant") {
        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end("<html><body>ha</body></html>");
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
        sendJson(res, 200, {
          ok: true,
          screenId: nodeId,
          namespace,
          desired: {
            revision: 1,
            target: { kind: "media", id: "m-home-assistant" },
            launch: { mode: "gallery" },
          },
          resolved: {
            items: [
              {
                itemId: "m-home-assistant:0",
                mediaId: "m-home-assistant",
                sourceType: "url",
                sourceValue: webUrl,
                cache: false,
                renderer: "web",
                title: "Home Assistant",
              },
            ],
            warnings: [],
            cache: { total: 0, cacheable: 0 },
            renderers: { mpv: 0, web: 1 },
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
        "--chromium-bin",
        chromiumBinPath,
        "--input-bin",
        inputBinPath,
        "--allow-input-any-platform",
        "1",
        "--switch-overlap-ms",
        "0",
        "--ha-start-delay-ms",
        "40",
        "--ha-step-delay-ms",
        "10",
      ],
      {
        cwd: packageDir,
        stdio: "pipe",
        env: {
          ...process.env,
          CHIBA3_HOME_ASSISTANT_USER: haUser,
          CHIBA3_HOME_ASSISTANT_PASS: haPass,
          CHIBA3_HOME_ASSISTANT_URL: webUrl,
        },
      }
    );

    await waitForHttpOk(`http://127.0.0.1:${nodePort}/health`, 10_000);
    await waitFor(
      async () => {
        const statusRes = await fetch(`http://127.0.0.1:${nodePort}/status`);
        return (await statusRes.json()) as {
          runtime: { backend: string; phase: string };
        };
      },
      (json) =>
        json.runtime.backend === "chromium" &&
        (json.runtime.phase === "ready" || json.runtime.phase === "active"),
      10_000,
      "chromium_backend_active"
    );

    const inputLogRaw = await waitFor(
      async () => {
        try {
          return await fs.readFile(inputLog, "utf8");
        } catch {
          return "";
        }
      },
      (raw) => raw.includes(haUser) && raw.includes(haPass) && raw.includes("Return"),
      10_000,
      "ha_input_sequence"
    );
    assert.ok(inputLogRaw.includes("Escape"));
    assert.ok(inputLogRaw.includes("Tab"));
    assert.ok(inputLogRaw.includes(haUser));
    assert.ok(inputLogRaw.includes(haPass));
    assert.ok(inputLogRaw.includes("Return"));

    const chromiumLogRaw = await fs.readFile(chromiumLog, "utf8");
    assert.ok(chromiumLogRaw.includes("--kiosk"));
    assert.ok(chromiumLogRaw.includes(webUrl));
  } finally {
    if (nodeProcess) await stopChild(nodeProcess);
    if (controlServer) await closeServer(controlServer);
    if (webServer) await closeServer(webServer);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
