import { useCallback, useEffect, useState } from "react";
import { createLogger } from "../lib/logger";
import type { RemoteControl, RemoteMessage, ViewMode } from "../types/guide";

export type RemoteControlsStatus = "idle" | "loading" | "ready" | "missing";

type RemoteControlsOptions = {
  viewMode: ViewMode;
  activeRemoteAppId: string;
  send: (message: RemoteMessage) => void;
};

const log = createLogger("remote-controls");

export function useRemoteControls({
  viewMode,
  activeRemoteAppId,
  send,
}: RemoteControlsOptions) {
  const [remoteControls, setRemoteControls] = useState<RemoteControl[]>([]);
  const [remoteControlsStatus, setRemoteControlsStatus] =
    useState<RemoteControlsStatus>("idle");

  const mergeRemoteControls = useCallback(
    (incoming: RemoteControl[], current: RemoteControl[]) =>
      incoming.map((control) => {
        const prev = current.find((item) => item.id === control.id);
        if (!prev) return control;
        if ("value" in prev && prev.value !== undefined) {
          return { ...control, value: prev.value } as RemoteControl;
        }
        return control;
      }),
    []
  );

  const handleRemoteControl = useCallback(
    (controlId: string, value: number | string | boolean) => {
      if (!activeRemoteAppId) return;
      setRemoteControls((prev) =>
        prev.map((control): RemoteControl => {
          if (control.id !== controlId) return control;
          if (control.type === "range" && typeof value === "number") {
            return { ...control, value };
          }
          if (control.type === "select" && typeof value === "string") {
            return { ...control, value };
          }
          if (control.type === "toggle" && typeof value === "boolean") {
            return { ...control, value };
          }
          return control;
        })
      );
      send({ type: "control", appId: activeRemoteAppId, controlId, value });
    },
    [activeRemoteAppId, send]
  );

  useEffect(() => {
    if (viewMode !== "remote" || !activeRemoteAppId) return;
    let cancelled = false;

    const loadControls = async () => {
      setRemoteControlsStatus((prev) => (prev === "ready" ? prev : "loading"));
      try {
        const res = await fetch(`/api/controls/${activeRemoteAppId}`);
        if (!res.ok) {
          if (!cancelled && res.status === 404) {
            setRemoteControlsStatus("missing");
          }
          return;
        }
        const data = (await res.json()) as {
          controls?: RemoteControl[];
        };
        if (cancelled) return;
        setRemoteControls((prev) =>
          mergeRemoteControls(data.controls ?? [], prev)
        );
        setRemoteControlsStatus("ready");
      } catch (error) {
        if (!cancelled) setRemoteControlsStatus("missing");
        log.warn("controls-load-failed", error);
      }
    };

    loadControls();
    const interval = window.setInterval(loadControls, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [viewMode, activeRemoteAppId, mergeRemoteControls]);

  useEffect(() => {
    if (viewMode !== "remote") return;
    setRemoteControls([]);
    setRemoteControlsStatus(activeRemoteAppId ? "loading" : "idle");
  }, [viewMode, activeRemoteAppId]);

  return {
    remoteControls,
    remoteControlsStatus,
    handleRemoteControl,
    setRemoteControls,
    setRemoteControlsStatus,
  };
}
