import { DebugPanel } from "../components/DebugPanel";
import { DialOverlay } from "../components/DialOverlay";
import { GuideFooter } from "../components/GuideFooter";
import { GuideGrid } from "../components/GuideGrid";
import { GuideHeader } from "../components/GuideHeader";
import { PlayerOverlay } from "../components/PlayerOverlay";
import { VolumeHud } from "../components/VolumeHud";
import { useGuideViewStore } from "../store/useGuideViewStore";

export function GuideView() {
  const {
    gridStyle,
    now,
    selectedChannel,
    selectedProgram,
    playerOpen,
    playerReady,
    playerSurfaceRef,
    remoteCursor,
    hasKeyboardMouse,
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
    cacheWarmStatus,
    showPlayerHud,
    loopVideo,
    onPlayerEnded,
    onPlayerError,
    ambientAudio,
    masterVolume,
    masterMuted,
    showVolumeHud,
    setPlayerReady,
    showDebug,
    memoryStats,
    mediaStats,
    dialOverlay,
    galleryMode,
  } = useGuideViewStore();
  return (
    <div
      className={`guide-shell ${playerOpen ? "player-open" : ""} ${
        galleryMode ? "gallery-mode" : ""
      }`}
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
        loadingStatus={cacheWarmStatus}
        selectedChannel={selectedChannel}
        selectedProgram={selectedProgram}
        showPlayerHud={showPlayerHud}
        loopVideo={loopVideo}
        imageDurationSec={selectedProgram?.durationSec}
        onMediaEnded={onPlayerEnded}
        onMediaError={onPlayerError}
        ambientAudio={ambientAudio}
        masterVolume={masterVolume}
        masterMuted={masterMuted}
        setPlayerReady={setPlayerReady}
        surfaceRef={playerSurfaceRef}
        remoteCursor={remoteCursor}
        forceCursor={hasKeyboardMouse}
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
