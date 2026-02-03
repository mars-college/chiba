import type { RefObject } from "react";
import type { GuideChannel, ProgramSlot } from "../types/guide";

type GuideHeaderProps = {
  selectedChannel?: GuideChannel;
  selectedProgram?: ProgramSlot | null;
  playerOpen: boolean;
  playerReady: boolean;
  hasPreviewMedia: boolean;
  posterImageReady: boolean;
  setPosterImageReady: (ready: boolean) => void;
  previewContainerRef: RefObject<HTMLDivElement | null>;
  progressValue: number;
  now: Date;
};

export function GuideHeader({
  selectedChannel,
  selectedProgram,
  playerOpen,
  playerReady,
  hasPreviewMedia,
  posterImageReady,
  setPosterImageReady,
  previewContainerRef,
  progressValue,
  now,
}: GuideHeaderProps) {
  const posterHasVisual = hasPreviewMedia || posterImageReady;

  return (
    <header className="guide-header">
      <div className="header-card">
        <div className="poster">
          <div
            className="poster-preview"
            ref={previewContainerRef}
            aria-hidden="true"
          />
          {selectedChannel?.previewUrl && !hasPreviewMedia ? (
            <img
              className="poster-image"
              src={selectedChannel.previewUrl}
              alt=""
              onLoad={() => setPosterImageReady(true)}
              onError={() => setPosterImageReady(false)}
            />
          ) : null}
          {playerOpen && !playerReady ? (
            <div className="poster-loading is-active" aria-hidden="true">
              <div className="poster-loading-ring" />
              <div className="poster-loading-text">Tuning</div>
            </div>
          ) : null}
          <div className="poster-glow" />
          {!posterHasVisual ? (
            <div className="poster-label">{selectedChannel?.callSign}</div>
          ) : null}
        </div>
        <div className="header-content">
          <span className="header-eyebrow">Guide</span>
          <h1 className="header-title">{selectedProgram?.title}</h1>
          <p className="header-subtitle">
            {selectedProgram?.subtitle ?? "Live schedule"}
          </p>
          <div className="header-meta">
            <span>{selectedChannel?.name}</span>
            <span>-</span>
            <span>{selectedProgram?.tag ?? "SHOW"}</span>
          </div>
          <div className="header-progress">
            <div
              className="header-progress-bar"
              style={{ width: `${progressValue}%` }}
            />
          </div>
        </div>
      </div>
      <div className="header-right">
        <div className="header-clock">
          <span className="clock-time">
            {now.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          <span className="clock-date">
            {now.toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>
      </div>
    </header>
  );
}
