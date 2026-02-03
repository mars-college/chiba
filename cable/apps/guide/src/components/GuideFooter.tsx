import type { GuideChannel } from "../types/guide";

type GuideFooterProps = {
  selectedChannel?: GuideChannel;
};

export function GuideFooter({ selectedChannel }: GuideFooterProps) {
  return (
    <footer className="guide-footer">
      <div className="ticker">
        <span>
          Auto scroll active - now browsing channel {selectedChannel?.number}
        </span>
      </div>
    </footer>
  );
}
