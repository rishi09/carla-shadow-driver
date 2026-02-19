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

    const handlePlaying = () => setIsPlaying(true);
    video.addEventListener('playing', handlePlaying);

    return () => {
      video.removeEventListener('playing', handlePlaying);
    };
  }, []);

  return (
    <div className={`relative ${className}`} style={{ width: '100%', maxHeight: '80vh' }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="bg-dark-500 rounded-lg"
        style={{ width: '100%', height: 'auto', maxHeight: '80vh', objectFit: 'contain' }}
      />
      {!isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-dark-500">
          <span className="text-white/40 text-lg font-mono animate-pulse">
            Waiting for video feed...
          </span>
        </div>
      )}
    </div>
  );
}
