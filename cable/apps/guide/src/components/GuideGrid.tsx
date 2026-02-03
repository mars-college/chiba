import type { RefObject } from "react";
import { DEBUG_CHANNEL_ID, DEBUG_CHANNEL_NUMBER } from "../constants/guide";
import type { GuideChannel, GuideIndex, ProgramSlot } from "../types/guide";

type GuideGridProps = {
  now: Date;
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
};

export function GuideGrid({
  now,
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
}: GuideGridProps) {
  return (
    <section className="guide-grid">
      <div className="time-row">
        <div className="time-label">
          <div className="time-now">
            {now.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </div>
          <div className="time-label-text">Network</div>
        </div>
        <div className="time-slots">
          {indexData.timeSlots
            .slice(
              visibleStartSlot,
              visibleStartSlot + Math.min(slotCount, visibleSlotCount)
            )
            .map((slot, index) => {
              const slotIndex = visibleStartSlot + index;
              return (
                <div
                  key={slotIndex}
                  className={`time-slot ${
                    slotIndex === selectedCol ? "is-active" : ""
                  }`}
                >
                  {slot}
                </div>
              );
            })}
        </div>
      </div>

      <div className="channel-viewport" ref={viewportRef}>
        <div
          className={`channel-rows ${isPaused ? "is-paused" : "is-auto"}`}
          ref={rowsRef}
        >
          {channels.map((channel, rowIndex) => (
            <div
              key={channel.id}
              className={`channel-row ${
                rowIndex === activeRow ? "is-active" : ""
              }`}
            >
              <div
                className="channel-cell"
                style={{ borderColor: channel.accent }}
              >
                <div className="channel-number">{channel.number}</div>
                <div className="channel-name">{channel.name}</div>
                <div className="channel-call">{channel.callSign}</div>
              </div>
              <div className="program-grid">
                {channel.schedule
                  .filter(
                    (program) =>
                      program.end >= visibleStartSlot &&
                      program.start < visibleStartSlot + visibleSlotCount
                  )
                  .map((program, index) => {
                    const clippedStart = Math.max(
                      program.start,
                      visibleStartSlot
                    );
                    const clippedEnd = Math.min(
                      program.end,
                      visibleStartSlot + visibleSlotCount - 1
                    );
                    const span = Math.max(1, clippedEnd - clippedStart + 1);
                    const gridColumnStart = clippedStart - visibleStartSlot + 1;
                    const isActive =
                      rowIndex === activeRow &&
                      selectedCol >= program.start &&
                      selectedCol <= program.end;
                    const isCurrentSlot =
                      currentSlotIndex >= program.start &&
                      currentSlotIndex <= program.end;
                    return (
                      <div
                        key={`${channel.id}-${index}`}
                        className={`program-card ${
                          isActive ? "is-active" : ""
                        }`}
                        style={{
                          gridColumn: `${gridColumnStart} / span ${span}`,
                          borderColor: channel.accent,
                        }}
                        onClick={() => {
                          onSelectRow(rowIndex);
                          onSelectCol(Math.max(clippedStart, currentSlotIndex));
                        }}
                        onDoubleClick={() => {
                          if (
                            channel.id === DEBUG_CHANNEL_ID ||
                            channel.number === DEBUG_CHANNEL_NUMBER
                          ) {
                            onToggleDebug();
                            return;
                          }
                          if (program.url && isCurrentSlot) {
                            onOpenProgram(program, channel);
                          }
                        }}
                      >
                        <div className="program-tag">
                          {program.tag ?? "SHOW"}
                        </div>
                        <div className="program-title">{program.title}</div>
                        <div className="program-subtitle">
                          {program.subtitle}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
