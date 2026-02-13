#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const sharedApiKey = (
  process.env.CHIBA_NODE_API_KEY ??
  process.env.CHIBA_API_KEY ??
  "dev-shared-key"
).trim();
const controlPlanePort = Number(process.env.CHIBA_CONTROL_PLANE_PORT ?? 8790);
const nodePort = Number(process.env.CHIBA_NODE_PORT ?? 8080);
const controlPlaneUrl =
  (process.env.CHIBA_CONTROL_PLANE_URL ?? `http://127.0.0.1:${controlPlanePort}`)
    .trim()
    .replace(/\/$/, "");
const controlDbUrl =
  (process.env.CHIBA_CONTROL_DB_URL ?? "postgresql://chiba:chiba@127.0.0.1:54329/chiba")
    .trim();
const registryPath = (process.env.CHIBA_REGISTRY_PATH ?? "./config/registry.local.toml").trim();
const opsDevUrl = (process.env.CHIBA_OPS_DEV_URL ?? "http://127.0.0.1:8792")
  .trim()
  .replace(/\/$/, "");

const children = new Set();
let stopping = false;

function log(message) {
  process.stdout.write(`[dev:local] ${message}\n`);
}

function withPrefix(prefix, stream, target = process.stdout) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      target.write(`[${prefix}] ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) {
      target.write(`[${prefix}] ${buffer}\n`);
      buffer = "";
    }
  });
}

function spawnCommand({ name, cmd, args, env, detached = false }) {
  const child = spawn(cmd, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached,
  });
  children.add(child);
  withPrefix(name, child.stdout, process.stdout);
  withPrefix(name, child.stderr, process.stderr);
  child.on("exit", () => {
    children.delete(child);
  });
  return child;
}

async function runStep(name, cmd, args, env = {}) {
  log(`${name}...`);
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: rootDir,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    withPrefix(name, child.stdout, process.stdout);
    withPrefix(name, child.stderr, process.stderr);
    child.on("exit", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`${name} failed with exit code ${code ?? 1}`));
    });
    child.on("error", reject);
  });
}

function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  log("shutting down...");
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }

  setTimeout(() => {
    for (const child of children) {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
    process.exit(exitCode);
  }, 1200).unref();
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

async function main() {
  log("starting local stack");
  log(`control-plane: ${controlPlaneUrl}`);
  log(`registry: ${registryPath}`);
  log(`ops dev: ${opsDevUrl}/ops`);

  await runStep("db:up", "pnpm", ["db:up"]);
  await runStep("build:guide", "pnpm", ["build:guide"]);

  const ops = spawnCommand({
    name: "ops",
    cmd: "pnpm",
    args: ["-C", "apps/ops", "dev"],
  });

  const controlPlane = spawnCommand({
    name: "control-plane",
    cmd: "pnpm",
    args: ["-C", "packages/control-plane", "dev"],
    env: {
      PORT: String(controlPlanePort),
      CHIBA_NODE_API_KEY: sharedApiKey,
      CHIBA_REGISTRY_PATH: registryPath,
      CHIBA_REGISTRY_LOCAL_PATH: "",
      CHIBA_CONTROL_DB_URL: controlDbUrl,
    },
  });

  const nodeAgent = spawnCommand({
    name: "node-agent",
    cmd: "pnpm",
    args: ["-C", "packages/node-agent", "dev"],
    env: {
      PORT: String(nodePort),
      CHIBA_NODE_ID: "commander",
      CHIBA_NODE_NAME: "commander",
      CHIBA_NODE_API_KEY: sharedApiKey,
      CHIBA_CONTROL_PLANE_URL: controlPlaneUrl,
    },
  });

  const server = spawnCommand({
    name: "server",
    cmd: "pnpm",
    args: ["-C", "apps/server", "dev"],
    env: {
      CHIBA_NODE_API_KEY: sharedApiKey,
      CHIBA_OPS_CONTROL_PLANE_URL: controlPlaneUrl,
      CHIBA_CONTROL_PLANE_URL: controlPlaneUrl,
      CHIBA_OPS_REGISTRY: registryPath,
      CHIBA_OPS_DEV_URL: opsDevUrl,
    },
  });

  const watch = (name, child) => {
    child.on("exit", (code, signal) => {
      if (stopping) return;
      const reason = signal ? `signal ${signal}` : `code ${code ?? 1}`;
      log(`${name} exited (${reason})`);
      stopAll(code ?? 1);
    });
  };
  watch("control-plane", controlPlane);
  watch("node-agent", nodeAgent);
  watch("server", server);
  watch("ops", ops);

  log("stack is running");
  log(`open (hot reload): ${opsDevUrl}/ops`);
  log("open (server route): http://127.0.0.1:8787/ops");
}

main().catch((error) => {
  process.stderr.write(`[dev:local] ${(error).message}\n`);
  stopAll(1);
});
