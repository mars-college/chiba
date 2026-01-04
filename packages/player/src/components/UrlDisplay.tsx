interface UrlDisplayProps {
  url: string;
  onError: (error: string) => void;
}

export function UrlDisplay({ url, onError }: UrlDisplayProps) {
  const handleError = () => {
    onError(`Failed to load URL: ${url}`);
  };

  return (
    <iframe
      className="url-display"
      src={url}
      title="URL Display"
      sandbox="allow-scripts allow-same-origin"
      onError={handleError}
    />
  );
}
