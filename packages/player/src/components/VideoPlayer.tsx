import { useRef, useEffect, useMemo, useCallback } from 'react';
import type { Content } from '@chiba/shared';

interface VideoPlayerProps {
  content: Content;
  paused: boolean;
  volume: number;
  onEnded: () => void;
  onError: (error: string) => void;
}

// Get base URL for node API (derive from ws query param or use current host)
function getNodeBaseUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const wsParam = params.get('ws');
  if (wsParam) {
    try {
      const wsUrl = new URL(wsParam);
      const protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
      return `${protocol}//${wsUrl.host}`;
    } catch {
      // Fall through to default
    }
  }
  return '';
}

export function VideoPlayer({
  content,
  paused,
  volume,
  onEnded,
  onError,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playAttemptRef = useRef<Promise<void> | null>(null);
  const hasStartedRef = useRef(false);
  const volumeRef = useRef(volume);

  // Keep volume ref in sync
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  // Construct the media URL using node base URL
  const mediaUrl = useMemo(() => {
    const baseUrl = getNodeBaseUrl();
    return `${baseUrl}/media/${content.filename}`;
  }, [content.filename]);

  // Stable play function that handles autoplay policy
  // Uses volumeRef to avoid recreating this callback when volume changes
  const attemptPlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video || playAttemptRef.current) return;

    // Always ensure muted for autoplay compliance
    video.muted = true;

    try {
      playAttemptRef.current = video.play();
      await playAttemptRef.current;
      hasStartedRef.current = true;
      console.log('Video playing (muted for autoplay compliance)');

      // Video is playing, now try to unmute if volume > 0
      // Note: In kiosk mode with --autoplay-policy flag, this will work
      // In regular browser, it may stay muted which is acceptable
      const currentVolume = volumeRef.current;
      if (currentVolume > 0) {
        video.muted = false;
        video.volume = currentVolume / 100;
      }
    } catch (err) {
      const error = err as Error;
      // Don't treat autoplay interruptions as fatal errors
      if (error.name === 'AbortError' ||
          error.message.includes('interrupted') ||
          error.message.includes('removed from the document')) {
        console.log('Play interrupted (component unmounting or state change), ignoring');
      } else if (error.name === 'NotAllowedError') {
        console.log('Autoplay not allowed, video should still be muted and ready');
        // Video is muted, try one more time
        try {
          await video.play();
          hasStartedRef.current = true;
        } catch {
          console.log('Even muted play failed, waiting for user interaction');
        }
      } else {
        console.error('Video play error:', error);
        // Only report actual errors (not autoplay policy)
        // onError(error.message); // Don't show error screen for play failures
      }
    } finally {
      playAttemptRef.current = null;
    }
  }, []); // No dependencies - uses refs for mutable values

  // Initial play when component mounts or src changes (only depends on mediaUrl)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Reset state for new video
    hasStartedRef.current = false;
    playAttemptRef.current = null;

    // Wait for video to be ready
    const handleCanPlay = () => {
      if (!hasStartedRef.current) {
        attemptPlay();
      }
    };

    video.addEventListener('canplay', handleCanPlay);

    // If already can play, start immediately
    if (video.readyState >= 3) {
      attemptPlay();
    }

    return () => {
      video.removeEventListener('canplay', handleCanPlay);
    };
  }, [mediaUrl, attemptPlay]);

  // Handle pause/resume from external control
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    console.log('Pause effect triggered:', { paused, hasStarted: hasStartedRef.current, readyState: video.readyState });

    if (paused) {
      video.pause();
      console.log('Video paused');
    } else if (hasStartedRef.current) {
      // Only resume if we've started before
      attemptPlay();
      console.log('Video resuming');
    }
  }, [paused, attemptPlay]);

  // Handle volume changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    console.log('Volume effect triggered:', { volume, hasStarted: hasStartedRef.current, currentMuted: video.muted });

    // Always apply volume
    video.volume = volume / 100;

    // Handle mute state - only unmute if we've started and volume > 0
    if (hasStartedRef.current) {
      if (volume > 0) {
        video.muted = false;
        console.log('Unmuted video, volume:', volume);
      } else {
        video.muted = true;
        console.log('Muted video (volume is 0)');
      }
    } else {
      console.log('Video not started yet, keeping muted state');
    }
  }, [volume]);

  // Handle video end - always notify node, playlist logic handles looping
  const handleEnded = useCallback(() => {
    onEnded();
  }, [onEnded]);

  // Handle actual video errors (network, decode, etc.)
  const handleError = useCallback(() => {
    const video = videoRef.current;
    const error = video?.error;

    // Only report actual media errors, not playback interruptions
    if (error && error.code) {
      const errorMessages: Record<number, string> = {
        1: 'Video loading aborted',
        2: 'Network error while loading video',
        3: 'Video decode error',
        4: 'Video format not supported',
      };
      const message = errorMessages[error.code] || error.message || 'Unknown video error';
      console.error('Video error:', message, error);
      onError(message);
    }
  }, [onError]);

  return (
    <video
      ref={videoRef}
      className="video-player"
      src={mediaUrl}
      autoPlay
      muted  // Always start muted for autoplay compliance
      playsInline
      controls={false}  // Hide controls for kiosk mode
      onEnded={handleEnded}
      onError={handleError}
    />
  );
}
