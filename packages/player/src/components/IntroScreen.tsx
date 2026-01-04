import type { ContentMetadata } from '@chiba/shared';

interface IntroScreenProps {
  metadata: ContentMetadata;
}

export function IntroScreen({ metadata }: IntroScreenProps) {
  return (
    <div className="intro-screen">
      {metadata.title && (
        <h1 className="intro-title">{metadata.title}</h1>
      )}
      {metadata.author && (
        <p className="intro-author">by {metadata.author}</p>
      )}
    </div>
  );
}
