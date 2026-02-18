export type ConnectivityChecks = {
  dnsOk: boolean;
  pingOk: boolean;
  sshOk: boolean;
  nodeApiOk: boolean;
  cableApiOk: boolean;
};

export function buildConnectivitySummary(args: ConnectivityChecks): {
  score: number;
  total: 5;
  status: "online" | "degraded" | "offline";
} {
  const checks = [args.dnsOk, args.pingOk, args.sshOk, args.nodeApiOk, args.cableApiOk];
  const score = checks.filter(Boolean).length;
  const status = score >= 5 ? "online" : score >= 3 ? "degraded" : "offline";
  return { score, total: 5, status };
}

export type RegistryNodeLike = {
  nodeId: string;
  host: string | null;
  ip: string | null;
  nodeName: string | null;
  orientation: string | null;
  displayRotate: number | null;
  guidePort: number | null;
  nodePort: number | null;
  serverPort: number | null;
  apiKey: string | null;
};

export function toRegistryToml(args: {
  nodes: RegistryNodeLike[];
}): string {
  const lines: string[] = ["[defaults]", ""];
  const q = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
  for (const row of args.nodes) {
    lines.push(`[pis.${row.nodeId}]`);
    if (row.host) lines.push(`host = ${q(row.host)}`);
    if (row.ip) lines.push(`ip = ${q(row.ip)}`);
    if (row.nodeName) lines.push(`node_name = ${q(row.nodeName)}`);
    if (row.orientation) lines.push(`orientation = ${q(row.orientation)}`);
    if (typeof row.displayRotate === "number") lines.push(`display_rotate = ${row.displayRotate}`);
    if (typeof row.guidePort === "number") lines.push(`guide_port = ${row.guidePort}`);
    if (typeof row.nodePort === "number") lines.push(`node_port = ${row.nodePort}`);
    if (typeof row.serverPort === "number") lines.push(`server_port = ${row.serverPort}`);
    if (row.apiKey) lines.push(`api_key = ${q(row.apiKey)}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
