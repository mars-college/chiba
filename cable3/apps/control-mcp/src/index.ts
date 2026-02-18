import process from "node:process";
import { TOOLS, handleToolCall } from "./tools.js";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

function writeMessage(payload: unknown): void {
  const json = JSON.stringify(payload);
  const header = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n`;
  process.stdout.write(header);
  process.stdout.write(json);
}

function success(id: string | number | null, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function failure(
  id: string | number | null,
  message: string,
  code = -32000
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

async function handle(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;
  if (request.method === "initialize") {
    return success(id, {
      protocolVersion: "2024-11-05",
      serverInfo: {
        name: "chiba-cable3-control-mcp",
        version: "0.1.0",
      },
      capabilities: {
        tools: {},
      },
    });
  }

  if (request.method === "notifications/initialized") {
    return null;
  }

  if (request.method === "tools/list") {
    return success(id, {
      tools: TOOLS,
    });
  }

  if (request.method === "tools/call") {
    const name = String(request.params?.name ?? "").trim();
    if (!name) return failure(id, "tool_name_required", -32602);
    const result = await handleToolCall({
      name,
      input: request.params?.arguments ?? {},
    });
    return success(id, result);
  }

  return failure(id, `method_not_found:${request.method}`, -32601);
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const headerText = buffer.slice(0, headerEnd).toString("utf8");
    const headers = new Map<string, string>();
    for (const line of headerText.split("\r\n")) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      headers.set(key, value);
    }
    const contentLength = Number(headers.get("content-length") ?? "0");
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + contentLength;
    if (buffer.length < messageEnd) return;
    const payloadText = buffer.slice(messageStart, messageEnd).toString("utf8");
    buffer = buffer.slice(messageEnd);

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(payloadText) as JsonRpcRequest;
    } catch {
      writeMessage(failure(null, "invalid_json", -32700));
      continue;
    }
    void handle(request)
      .then((response) => {
        if (response) writeMessage(response);
      })
      .catch((error) => {
        writeMessage(
          failure(
            request.id ?? null,
            error instanceof Error ? error.message : String(error)
          )
        );
      });
  }
});

process.stdin.resume();
