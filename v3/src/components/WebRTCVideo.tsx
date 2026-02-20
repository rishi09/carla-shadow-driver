import { useRef, useEffect, useState } from 'react';

interface WebRTCVideoProps {
  remoteStream: MediaStream | null;
  className?: string;
}

export function WebRTCVideo({ remoteStream, className = '' }: WebRTCVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (remoteStream) {
      video.srcObject = remoteStream;
    } else {
      video.srcObject = null;
      setIsPlaying(false);
    }
  }, [remoteStream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlaying = () => {
      setIsPlaying(true);
      // Log WebRTC video stats periodically
      const pc = video.srcObject && (video.srcObject as MediaStream).getTracks()[0];
      if (pc) {
        const interval = setInterval(async () => {
          // getStats is on RTCPeerConnection, not available here directly.
          // Instead log basic video element metrics.
          const vw = video.videoWidth, vh = video.videoHeight;
          const buffered = video.buffered.length > 0
            ? (video.buffered.end(0) - video.currentTime) * 1000
            : 0;
          console.log(`[WebRTC video] ${vw}x${vh}, buffer=${buffered.toFixed(0)}ms`);
        }, 5000);
        return () => clearInterval(interval);
      }
    };
    video.addEventListener('playing', handlePlaying);

    return () => {
      video.removeEventListener('playing', handlePlaying);
    };
  }, []);

  return (
    <div className={`relative ${className}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="bg-dark-500 w-full h-full"
        style={{ objectFit: 'cover' }}
      />
      {!isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center bg-dark-500">
          <span className="text-white/40 text-lg font-mono animate-pulse">
            Waiting for video feed...
          </span>
        </div>
      )}
    </div>
  );
}
