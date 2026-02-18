import assert from "node:assert/strict";
import { test } from "node:test";
import { buildConnectivitySummary, toRegistryToml } from "../src/nodes-utils.js";

test("buildConnectivitySummary computes score and status deterministically", () => {
  const online = buildConnectivitySummary({
    dnsOk: true,
    pingOk: true,
    sshOk: true,
    nodeApiOk: true,
    cableApiOk: true,
  });
  assert.deepEqual(online, { score: 5, total: 5, status: "online" });

  const degraded = buildConnectivitySummary({
    dnsOk: true,
    pingOk: true,
    sshOk: false,
    nodeApiOk: true,
    cableApiOk: false,
  });
  assert.deepEqual(degraded, { score: 3, total: 5, status: "degraded" });

  const offline = buildConnectivitySummary({
    dnsOk: false,
    pingOk: false,
    sshOk: false,
    nodeApiOk: false,
    cableApiOk: true,
  });
  assert.deepEqual(offline, { score: 1, total: 5, status: "offline" });
});

test("toRegistryToml exports expected node fields", () => {
  const out = toRegistryToml({
    nodes: [
      {
        nodeId: "node-a",
        host: "node-a.local",
        ip: "10.0.0.10",
        nodeName: "Node A",
        orientation: "landscape",
        displayRotate: 90,
        guidePort: 5173,
        nodePort: 8080,
        serverPort: 8787,
        apiKey: "secret",
      },
    ],
  });
  assert.equal(out.includes("[pis.node-a]"), true);
  assert.equal(out.includes("host = \"node-a.local\""), true);
  assert.equal(out.includes("display_rotate = 90"), true);
  assert.equal(out.includes("guide_port = 5173"), true);
  assert.equal(out.includes("api_key = \"secret\""), true);
});
