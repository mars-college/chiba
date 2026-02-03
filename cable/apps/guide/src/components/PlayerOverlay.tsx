import { useEffect, useRef, useState, useMemo } from "react";
import { createLogger } from "../lib/logger";
import type {
  GuideChannel,
  MediaKind,
  PlayerMeta,
  ProgramSlot,
} from "../types/guide";

const log = createLogger("player-overlay");

type PlayerOverlayProps = {
  playerUrl: string | null;
  playerOpen: boolean;
  playerReady: boolean;
  playerKind: MediaKind | null;
  playerMeta: PlayerMeta | null;
  selectedChannel?: GuideChannel;
  selectedProgram?: ProgramSlot | null;
  showPlayerHud: boolean;
  ambientAudio: {
    url: string;
    volume?: number;
    offsetMinSec?: number;
    offsetMaxSec?: number;
  } | null;
  masterVolume: number;
  masterMuted: boolean;
  setPlayerReady: (ready: boolean) => void;
};

export function PlayerOverlay({
  playerUrl,
  playerOpen,
  playerReady,
  playerKind,
  playerMeta,
  selectedChannel,
  selectedProgram,
  showPlayerHud,
  ambientAudio,
  masterVolume,
  masterMuted,
  setPlayerReady,
}: PlayerOverlayProps) {
  const ambientAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaVideoRef = useRef<HTMLVideoElement | null>(null);
  const didSeekRef = useRef(false);
  const [ambientOffsetSec, setAmbientOffsetSec] = useState<number | null>(null);
  useEffect(() => {
    if (!playerUrl) return;
    log.info("mount", { url: playerUrl, kind: playerKind, open: playerOpen });
    return () => {
      log.info("unmount", { url: playerUrl, kind: playerKind });
    };
  }, [playerUrl, playerKind, playerOpen]);

  useEffect(() => {
    if (!playerUrl) return;
    log.debug("state", { url: playerUrl, kind: playerKind, open: playerOpen });
  }, [playerUrl, playerKind, playerOpen]);

  const iframePolicy = useMemo(() => {
    if (!playerUrl) {
      return {
        allow: "autoplay; fullscreen",
        sandbox: "allow-scripts allow-same-origin allow-pointer-lock",
      };
    }
    const isTrusted =
      playerUrl.startsWith("/mars") ||
      playerUrl.startsWith("/village/live") ||
      playerUrl.startsWith("/embed/");
    return {
      allow: isTrusted
        ? "autoplay; fullscreen; camera; microphone"
        : "autoplay; fullscreen",
      sandbox: isTrusted
        ? undefined
        : "allow-scripts allow-same-origin allow-pointer-lock",
    };
  }, [playerUrl]);

  useEffect(() => {
    if (!ambientAudio?.url || !playerOpen) {
      setAmbientOffsetSec(null);
      return;
    }
    const rawMin = ambientAudio.offsetMinSec ?? 0;
    const rawMax = ambientAudio.offsetMaxSec ?? rawMin;
    const min = Number.isFinite(rawMin) ? Math.max(0, rawMin) : 0;
    const max = Number.isFinite(rawMax) ? Math.max(min, rawMax) : min;
    const nextOffset = max <= min ? min : min + Math.random() * (max - min);
    setAmbientOffsetSec(nextOffset);
  }, [
    ambientAudio?.url,
    ambientAudio?.offsetMinSec,
    ambientAudio?.offsetMaxSec,
    playerOpen,
  ]);

  useEffect(() => {
    didSeekRef.current = false;
  }, [ambientAudio?.url, playerOpen]);

  useEffect(() => {
    const audio = ambientAudioRef.current;
    if (!audio) return;
    const base =
      typeof ambientAudio?.volume === "number" &&
      Number.isFinite(ambientAudio.volume)
        ? ambientAudio.volume
        : 1;
    audio.volume = Math.min(1, Math.max(0, base * masterVolume));
    audio.muted = masterMuted || !playerOpen;
  }, [
    ambientAudio?.volume,
    ambientAudio?.url,
    masterVolume,
    masterMuted,
    playerOpen,
  ]);

  useEffect(() => {
    const audio = mediaAudioRef.current;
    if (audio) {
      audio.volume = Math.min(1, Math.max(0, masterVolume));
      audio.muted = masterMuted || !playerOpen;
    }
    const video = mediaVideoRef.current;
    if (video) {
      video.volume = Math.min(1, Math.max(0, masterVolume));
      video.muted = masterMuted || !playerOpen;
    }
  }, [masterVolume, masterMuted, playerOpen, playerKind]);

  useEffect(() => {
    const audio = ambientAudioRef.current;
    if (!audio || ambientOffsetSec === null) return;
    const target = Math.max(0, ambientOffsetSec);
    const seek = () => {
      if (didSeekRef.current) return;
      try {
        const duration = Number.isFinite(audio.duration)
          ? audio.duration
          : null;
        audio.currentTime =
          duration && duration > 0 ? Math.min(target, duration - 0.5) : target;
        didSeekRef.current = true;
      } catch {
        return;
      }
    };
    if (audio.readyState >= 1) {
      seek();
    }
    audio.addEventListener("loadedmetadata", seek);
    return () => {
      audio.removeEventListener("loadedmetadata", seek);
    };
  }, [ambientOffsetSec, ambientAudio?.url]);

  if (!playerUrl) return null;

  return (
    <div
      className={`player-overlay ${playerOpen ? "is-open" : ""}`}
      aria-hidden={!playerOpen}
    >
      <div className="player-surface">
        {playerKind === "image" ? (
          <img
            className="player-media player-image"
            src={playerUrl}
            alt={playerMeta?.title ?? "Program image"}
            onLoad={() => {
              log.info("loaded", { url: playerUrl, kind: "image" });
              setPlayerReady(true);
            }}
          />
        ) : playerKind === "video" ? (
          <video
            className="player-media player-video"
            src={playerUrl}
            autoPlay
            loop
            muted={masterMuted || !playerOpen}
            playsInline
            ref={mediaVideoRef}
            onLoadedData={() => {
              log.info("loaded", { url: playerUrl, kind: "video" });
              setPlayerReady(true);
            }}
          />
        ) : playerKind === "audio" ? (
          <div className="player-audio">
            <div className="player-audio-visual" />
            <audio
              ref={mediaAudioRef}
              src={playerUrl}
              autoPlay
              loop
              muted={masterMuted || !playerOpen}
              onCanPlay={() => {
                log.info("loaded", { url: playerUrl, kind: "audio" });
                setPlayerReady(true);
              }}
            />
          </div>
        ) : (
          <iframe
            className="player-frame"
            src={playerUrl}
            title={playerMeta?.title ?? "Program"}
            allow={iframePolicy.allow}
            sandbox={iframePolicy.sandbox}
            onLoad={() => {
              log.info("loaded", { url: playerUrl, kind: "iframe" });
              setPlayerReady(true);
            }}
          />
        )}
        {playerOpen && ambientAudio?.url ? (
          <audio
            ref={ambientAudioRef}
            className="player-ambient-audio"
            src={ambientAudio.url}
            autoPlay
            loop
            playsInline
            muted={masterMuted || !playerOpen}
          />
        ) : null}
        <div className={`player-loading ${playerReady ? "is-hidden" : ""}`}>
          <div className="player-loading-content">
            <span className="player-loading-label">Tuning…</span>
            <span className="player-loading-sub">Signal lock</span>
          </div>
        </div>
        {showPlayerHud ? (
          <div className="player-hud">
            <div className="player-channel">
              {playerMeta?.callSign ?? selectedChannel?.callSign ?? "CH"}
            </div>
            <div className="player-title">
              {playerMeta?.title ?? selectedProgram?.title}
            </div>
            <div className="player-subtitle">
              {playerMeta?.subtitle ?? selectedProgram?.subtitle}
            </div>
            <div className="player-hint">Press Guide or Esc to return</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
