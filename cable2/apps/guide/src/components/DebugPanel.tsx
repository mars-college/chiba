import type { MediaDebugStats } from "../types/guide";

export type MemoryStats = {
  used: number;
  total: number;
  limit: number;
};

type DebugPanelProps = {
  show: boolean;
  memoryStats: MemoryStats | null;
  mediaStats: MediaDebugStats | null;
};

const formatMb = (bytes: number) => {
  if (!Number.isFinite(bytes)) return "n/a";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function DebugPanel({ show, memoryStats, mediaStats }: DebugPanelProps) {
  if (!show) return null;

  return (
    <div className="debug-panel">
      <div className="debug-title">Diagnostics</div>
      {memoryStats ? (
        <>
          <div>Heap: {formatMb(memoryStats.used)} used</div>
          <div>Total: {formatMb(memoryStats.total)}</div>
          <div>Limit: {formatMb(memoryStats.limit)}</div>
        </>
      ) : (
        <div>Heap: unavailable</div>
      )}
      {mediaStats ? (
        <>
          <div>Streams: {mediaStats.active} active</div>
          <div>Requests: {mediaStats.requests} total</div>
          <div>Bytes: {formatMb(mediaStats.bytesSent)} sent</div>
          <div>Errors: {mediaStats.errors}</div>
          {mediaStats.lastRequestAt ? (
            <div>
              Last:{" "}
              {new Date(mediaStats.lastRequestAt).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
              })}
            </div>
          ) : null}
          {mediaStats.topPaths?.length ? (
            <div className="debug-paths">
              {mediaStats.topPaths.slice(0, 3).map((item) => (
                <div key={item.path}>
                  {item.path.split("/").slice(-1)[0]} · {formatMb(item.bytes)}
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div>Media: unavailable</div>
      )}
    </div>
  );
}
