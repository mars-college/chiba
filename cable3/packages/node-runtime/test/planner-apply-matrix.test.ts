import assert from "node:assert/strict";
import { test } from "node:test";
import type { ResourceSnapshot } from "@chiba-cable3/contracts";
import { planNodeAssignments } from "../src/planner.ts";

function createSnapshot(): ResourceSnapshot {
  return {
    media: [
      { id: "m-1", sourceType: "path", sourceValue: "/tmp/m-1.jpg", cache: true },
      { id: "m-2", sourceType: "path", sourceValue: "/tmp/m-2.jpg", cache: true },
    ],
    playlists: [
      {
        id: "pl-main",
        items: [
          { index: 0, mediaId: "m-1" },
          { index: 1, mediaId: "m-2" },
        ],
      },
      {
        id: "pl-node-b",
        items: [{ index: 0, mediaId: "m-2" }],
      },
    ],
    blocks: [
      {
        id: "block-main",
        mode: "loop",
        items: [{ index: 0, playlistId: "pl-main" }],
      },
    ],
    channels: [
      {
        id: "ch-main",
        blockIds: ["block-main"],
      },
    ],
    profiles: [
      {
        id: "profile-main",
        defaults: {
          mode: "gallery",
          nosplash: true,
        },
        defaultTarget: {
          kind: "channel",
          id: "ch-main",
        },
        nodes: [
          {
            nodeId: "node-b",
            target: {
              kind: "playlist",
              id: "pl-node-b",
            },
            launch: {
              qr: true,
            },
          },
        ],
      },
    ],
  };
}

test("plans deterministic assignments for each target kind", () => {
  const nodeIds = ["node-b", "node-a"];
  const snapshot = createSnapshot();

  const matrix = [
    { kind: "media", id: "m-1" },
    { kind: "playlist", id: "pl-main" },
    { kind: "block", id: "block-main" },
    { kind: "channel", id: "ch-main" },
  ] as const;

  for (const target of matrix) {
    const result = planNodeAssignments({
      nodeIds,
      target,
      launch: { mode: "gallery", theme: "amber" },
      snapshot,
    });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(
      result.assignments.map((row) => row.nodeId),
      ["node-a", "node-b"]
    );
    assert.deepEqual(
      result.assignments.map((row) => row.target),
      [target, target]
    );
    assert.equal(result.assignments[0]?.source, "direct");
    assert.equal(result.assignments[1]?.source, "direct");
    assert.deepEqual(result.assignments[0]?.launch, { mode: "gallery", theme: "amber" });
    assert.deepEqual(result.assignments[1]?.launch, { mode: "gallery", theme: "amber" });
  }
});

test("plans profile assignments across multiple nodes with override + defaults", () => {
  const snapshot = createSnapshot();
  const result = planNodeAssignments({
    nodeIds: ["node-b", "node-a"],
    target: { kind: "profile", id: "profile-main" },
    launch: { theme: "amber" },
    snapshot,
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.assignments.map((row) => row.nodeId),
    ["node-a", "node-b"]
  );
  assert.deepEqual(result.assignments[0]?.target, {
    kind: "channel",
    id: "ch-main",
  });
  assert.deepEqual(result.assignments[1]?.target, {
    kind: "playlist",
    id: "pl-node-b",
  });
  assert.equal(result.assignments[0]?.source, "profile-default");
  assert.equal(result.assignments[1]?.source, "profile-node-override");
  assert.deepEqual(result.assignments[0]?.launch, {
    mode: "gallery",
    nosplash: true,
    theme: "amber",
  });
  assert.deepEqual(result.assignments[1]?.launch, {
    mode: "gallery",
    nosplash: true,
    qr: true,
    theme: "amber",
  });
});

test("reports deterministic errors when profile is missing", () => {
  const result = planNodeAssignments({
    nodeIds: ["node-b", "node-a"],
    target: { kind: "profile", id: "does-not-exist" },
    launch: { theme: "amber" },
    snapshot: createSnapshot(),
  });

  assert.deepEqual(result.assignments, []);
  assert.deepEqual(result.errors, [
    { nodeId: "node-a", error: "profile_not_found:does-not-exist" },
    { nodeId: "node-b", error: "profile_not_found:does-not-exist" },
  ]);
});
