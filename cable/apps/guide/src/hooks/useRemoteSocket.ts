import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from "../lib/logger";
import { getWsUrl } from "../lib/remote";
import type { RemoteMessage, RemoteStatus } from "../types/guide";

const log = createLogger("remote-socket");

export function useRemoteSocket(onMessage?: (msg: RemoteMessage) => void) {
  const [status, setStatus] = useState<RemoteStatus>("connecting");
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const retryRef = useRef(0);
  const handlerRef = useRef(onMessage);

  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    let cancelled = false;
    const connect = () => {
      if (cancelled) return;
      const url = getWsUrl();
      log.info("connecting", { url });
      const socket = new WebSocket(url);
      socketRef.current = socket;
      setStatus("connecting");

      socket.addEventListener("open", () => {
        if (cancelled) return;
        retryRef.current = 0;
        setStatus("open");
        log.info("open");
      });
      socket.addEventListener("close", () => {
        if (cancelled) return;
        setStatus("closed");
        log.warn("closed");
        scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        if (cancelled) return;
        setStatus("closed");
        log.error("error");
        scheduleReconnect();
      });
      socket.addEventListener("message", (event) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(event.data as string) as RemoteMessage;
          handlerRef.current?.(data);
        } catch (error) {
          log.warn("bad-message", error);
        }
      });
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimerRef.current !== null) return;
      const attempt = retryRef.current + 1;
      retryRef.current = attempt;
      const delay = Math.min(1000 * 2 ** attempt, 10000);
      log.info("reconnect", { attempt, delay });
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      socketRef.current?.close();
    };
  }, []);

  const send = useCallback((message: RemoteMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    } else {
      log.warn("send-failed", message);
    }
  }, []);

  return { send, status };
}
