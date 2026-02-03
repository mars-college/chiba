import { DebugPanel, type MemoryStats } from "../components/DebugPanel";
import { DialOverlay } from "../components/DialOverlay";
import { VolumeHud } from "../components/VolumeHud";
import type {
  GuideChannel,
  MediaDebugStats,
  ProgramSlot,
} from "../types/guide";

type ArtViewProps = {
  channels: GuideChannel[];
  channelId: string | null;
  artIndex: number;
  artPaused: boolean;
  showDebug: boolean;
  memoryStats: MemoryStats | null;
  mediaStats: MediaDebugStats | null;
  dialOverlay: string;
  masterVolume: number;
  masterMuted: boolean;
  showVolumeHud: boolean;
};

export function ArtView({
  channels,
  channelId,
  artIndex,
  artPaused,
  showDebug,
  memoryStats,
  mediaStats,
  dialOverlay,
  masterVolume,
  masterMuted,
  showVolumeHud,
}: ArtViewProps) {
  const artChannel =
    channels.find((channel) => channel.id === (channelId ?? "jensen-art")) ??
    channels[0];
  const artItems = artChannel?.schedule.filter((slot) => slot.url) ?? [];
  const artItem: ProgramSlot | undefined =
    artItems[artIndex % Math.max(1, artItems.length)];

  return (
    <div className="art-shell">
      <iframe
        className="art-frame"
        src={artItem?.url}
        title={artItem?.title ?? "Interactive art"}
        allow="autoplay; fullscreen"
        sandbox="allow-scripts allow-same-origin allow-pointer-lock"
      />
      <div className="art-overlay">
        <div className="art-channel">{artChannel?.name ?? "Art Channel"}</div>
        <div className="art-title">{artItem?.title ?? "Loading..."}</div>
        <div className="art-subtitle">{artItem?.subtitle}</div>
        <div className="art-controls">
          {artPaused ? "Paused" : "Auto"} - arrows to navigate, space to pause
        </div>
      </div>
      <VolumeHud
        volume={masterVolume}
        muted={masterMuted}
        visible={showVolumeHud}
      />
      <DebugPanel show={showDebug} memoryStats={memoryStats} mediaStats={mediaStats} />
      <DialOverlay value={dialOverlay} />
    </div>
  );
}
