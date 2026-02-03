type DialOverlayProps = {
  value: string;
};

export function DialOverlay({ value }: DialOverlayProps) {
  if (!value) return null;
  return <div className="dial-overlay">CH {value}</div>;
}
