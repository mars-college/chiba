interface OfflineScreenProps {
  message?: string;
}

export function OfflineScreen({ message }: OfflineScreenProps) {
  return (
    <div className="offline-screen">
      <div className="offline-icon">📡</div>
      <h1 className="offline-title">Connecting...</h1>
      <p className="offline-message">
        {message || 'Waiting for connection to the node server. This screen will update automatically when connected.'}
      </p>
    </div>
  );
}
