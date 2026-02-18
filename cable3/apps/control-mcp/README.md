# cable3 control-mcp

MCP stdio server that exposes `cable3` control-api operations to agents.

Tools:
- `mpbcp_snapshot`
- `node_state`
- `apply_mpbcp_to_nodes`
- `ingest_youtube`
- `ingest_eden_collection`
- `ingest_upload_paths`

Environment:
- `CHIBA3_CONTROL_API_URL` (default: `http://127.0.0.1:8795`)

Run:

```bash
pnpm -C apps/control-mcp dev
```

With compose profile:

```bash
docker compose --profile mcp up --build control-mcp
```

The server speaks JSON-RPC over stdio with `Content-Length` framing and supports:

- `initialize`
- `tools/list`
- `tools/call`
