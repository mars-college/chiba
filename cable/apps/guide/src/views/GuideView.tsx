import type { CSSProperties, RefObject } from "react";
import { DebugPanel, type MemoryStats } from "../components/DebugPanel";
import { DialOverlay } from "../components/DialOverlay";
import { GuideFooter } from "../components/GuideFooter";
import { GuideGrid } from "../components/GuideGrid";
import { GuideHeader } from "../components/GuideHeader";
import { PlayerOverlay } from "../components/PlayerOverlay";
import { VolumeHud } from "../components/VolumeHud";
import type {
  GuideChannel,
  GuideIndex,
  MediaDebugStats,
  MediaKind,
  PlayerMeta,
  ProgramSlot,
} from "../types/guide";

type GuideViewProps = {
  gridStyle: CSSProperties;
  now: Date;
  selectedChannel?: GuideChannel;
  selectedProgram?: ProgramSlot | null;
  playerOpen: boolean;
  playerReady: boolean;
  playerSurfaceRef: RefObject<HTMLDivElement | null>;
  remoteCursor?: { x: number; y: number; visible: boolean; pressed: boolean };
  hasPreviewMedia: boolean;
  posterImageReady: boolean;
  setPosterImageReady: (ready: boolean) => void;
  previewContainerRef: RefObject<HTMLDivElement | null>;
  progressValue: number;
  indexData: GuideIndex;
  visibleStartSlot: number;
  visibleSlotCount: number;
  slotCount: number;
  selectedCol: number;
  currentSlotIndex: number;
  channels: GuideChannel[];
  activeRow: number;
  isPaused: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
  rowsRef: RefObject<HTMLDivElement | null>;
  onSelectRow: (row: number) => void;
  onSelectCol: (col: number) => void;
  onOpenProgram: (program: ProgramSlot, channel: GuideChannel) => void;
  onToggleDebug: () => void;
  showQr: boolean;
  qrUrl: string;
  playerUrl: string | null;
  playerKind: MediaKind | null;
  playerMeta: PlayerMeta | null;
  showPlayerHud: boolean;
  ambientAudio: {
    url: string;
    volume?: number;
    offsetMinSec?: number;
    offsetMaxSec?: number;
  } | null;
  masterVolume: number;
  masterMuted: boolean;
  showVolumeHud: boolean;
  setPlayerReady: (ready: boolean) => void;
  showDebug: boolean;
  memoryStats: MemoryStats | null;
  mediaStats: MediaDebugStats | null;
  dialOverlay: string;
};

export function GuideView({
  gridStyle,
  now,
  selectedChannel,
  selectedProgram,
  playerOpen,
  playerReady,
  playerSurfaceRef,
  remoteCursor,
  hasPreviewMedia,
  posterImageReady,
  setPosterImageReady,
  previewContainerRef,
  progressValue,
  indexData,
  visibleStartSlot,
  visibleSlotCount,
  slotCount,
  selectedCol,
  currentSlotIndex,
  channels,
  activeRow,
  isPaused,
  viewportRef,
  rowsRef,
  onSelectRow,
  onSelectCol,
  onOpenProgram,
  onToggleDebug,
  showQr,
  qrUrl,
  playerUrl,
  playerKind,
  playerMeta,
  showPlayerHud,
  ambientAudio,
  masterVolume,
  masterMuted,
  showVolumeHud,
  setPlayerReady,
  showDebug,
  memoryStats,
  mediaStats,
  dialOverlay,
}: GuideViewProps) {
  return (
    <div
      className={`guide-shell ${playerOpen ? "player-open" : ""}`}
      style={gridStyle}
    >
      <div className="guide-noise" aria-hidden="true" />

      <GuideHeader
        selectedChannel={selectedChannel}
        selectedProgram={selectedProgram}
        playerOpen={playerOpen}
        playerReady={playerReady}
        hasPreviewMedia={hasPreviewMedia}
        posterImageReady={posterImageReady}
        setPosterImageReady={setPosterImageReady}
        previewContainerRef={previewContainerRef}
        progressValue={progressValue}
        now={now}
      />

      <GuideGrid
        now={now}
        indexData={indexData}
        visibleStartSlot={visibleStartSlot}
        visibleSlotCount={visibleSlotCount}
        slotCount={slotCount}
        selectedCol={selectedCol}
        currentSlotIndex={currentSlotIndex}
        channels={channels}
        activeRow={activeRow}
        isPaused={isPaused}
        viewportRef={viewportRef}
        rowsRef={rowsRef}
        onSelectRow={onSelectRow}
        onSelectCol={onSelectCol}
        onOpenProgram={onOpenProgram}
        onToggleDebug={onToggleDebug}
      />

      <GuideFooter selectedChannel={selectedChannel} />

      <VolumeHud
        volume={masterVolume}
        muted={masterMuted}
        visible={showVolumeHud}
      />

      {showQr ? (
        <div className="qr-card">
          <div className="qr-label">Remote</div>
          <img className="qr-image" src={qrUrl} alt="Remote QR code" />
        </div>
      ) : null}

      <PlayerOverlay
        playerUrl={playerUrl}
        playerOpen={playerOpen}
        playerReady={playerReady}
        playerKind={playerKind}
        playerMeta={playerMeta}
        selectedChannel={selectedChannel}
        selectedProgram={selectedProgram}
        showPlayerHud={showPlayerHud}
        ambientAudio={ambientAudio}
        masterVolume={masterVolume}
        masterMuted={masterMuted}
        setPlayerReady={setPlayerReady}
        surfaceRef={playerSurfaceRef}
        remoteCursor={remoteCursor}
      />

      <DebugPanel
        show={showDebug}
        memoryStats={memoryStats}
        mediaStats={mediaStats}
      />
      <DialOverlay value={dialOverlay} />
    </div>
  );
}
