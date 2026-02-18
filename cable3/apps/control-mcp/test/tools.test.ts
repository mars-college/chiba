import assert from "node:assert/strict";
import { test } from "node:test";
import { TOOLS, handleToolCall } from "../src/tools.ts";

test("exposes required control tools", () => {
  const names = TOOLS.map((row) => row.name);
  assert.equal(names.includes("mpbcp_snapshot"), true);
  assert.equal(names.includes("node_state"), true);
  assert.equal(names.includes("apply_mpbcp_to_nodes"), true);
  assert.equal(names.includes("ingest_youtube"), true);
  assert.equal(names.includes("ingest_eden_collection"), true);
  assert.equal(names.includes("ingest_upload_paths"), true);
});

test("returns typed tool error for unknown tools", async () => {
  const result = await handleToolCall({
    name: "does_not_exist",
    input: {},
  });
  assert.equal(result.isError, true);
  assert.equal(result.content[0]?.text.includes("unknown_tool"), true);
});
