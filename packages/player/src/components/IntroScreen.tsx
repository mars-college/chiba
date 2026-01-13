import type { ContentMetadata } from '@chiba/shared';

interface IntroScreenProps {
  metadata: ContentMetadata;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function IntroScreen({ metadata }: IntroScreenProps) {
  const title = metadata.title ? truncate(metadata.title, 250) : undefined;

  return (
    <div className="intro-screen">
      {title && (
        <h1 className="intro-title">{title}</h1>
      )}
      {metadata.author && (
        <p className="intro-author">by {metadata.author}</p>
      )}
    </div>
  );
}
