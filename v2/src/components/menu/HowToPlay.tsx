import { useState } from 'react';
import { Button } from '../common/Button';
import { Card, CardContent } from '../common/Card';

interface HowToPlayProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Callback when user is ready to play */
  onStartPlaying?: () => void;
}

/**
 * HowToPlay - Modal explaining the game in simple terms
 *
 * Designed for accessibility:
 * - Simple language for non-native English speakers
 * - Large, clear visuals
 * - Step-by-step explanation
 * - Big buttons for easy clicking
 * - High contrast colors
 */
export function HowToPlay({ isOpen, onClose, onStartPlaying }: HowToPlayProps) {
  const [currentPage, setCurrentPage] = useState(0);

  if (!isOpen) return null;

  const pages = [
    {
      title: 'Welcome to Shadow Driver!',
      content: (
        <div className="space-y-6">
          <p className="text-lg text-white/80 leading-relaxed">
            This is a <strong className="text-white">racing game</strong> where you drive a car around a track.
          </p>
          <div className="bg-dark-400/50 rounded-lg p-4">
            <h4 className="text-base font-semibold text-accent mb-3">Your Goal:</h4>
            <ul className="space-y-2 text-base">
              <li className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-human/20 text-human flex items-center justify-center font-bold">1</span>
                <span className="text-white/80">Drive around the track</span>
              </li>
              <li className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-human/20 text-human flex items-center justify-center font-bold">2</span>
                <span className="text-white/80">Complete 3 laps</span>
              </li>
              <li className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-human/20 text-human flex items-center justify-center font-bold">3</span>
                <span className="text-white/80">Try to finish as fast as you can!</span>
              </li>
            </ul>
          </div>
        </div>
      ),
    },
    {
      title: 'How to Control Your Car',
      content: (
        <div className="space-y-6">
          <p className="text-lg text-white/80 leading-relaxed">
            Use your <strong className="text-white">keyboard</strong> to drive. Here are the keys:
          </p>

          <div className="grid grid-cols-1 gap-4">
            {/* Forward */}
            <div className="flex items-center gap-4 bg-dark-400/50 rounded-lg p-4">
              <div className="flex gap-2">
                <kbd className="inline-flex items-center justify-center w-12 h-12 bg-dark-300 border-2 border-human rounded-lg text-human font-bold text-lg">
                  W
                </kbd>
                <span className="text-white/40 self-center">or</span>
                <kbd className="inline-flex items-center justify-center w-12 h-12 bg-dark-300 border-2 border-human rounded-lg text-human font-bold text-sm">
                  Up
                </kbd>
              </div>
              <div>
                <div className="text-white font-semibold">Go Forward</div>
                <div className="text-white/60 text-sm">Hold to speed up</div>
              </div>
            </div>

            {/* Steering */}
            <div className="flex items-center gap-4 bg-dark-400/50 rounded-lg p-4">
              <div className="flex gap-2">
                <kbd className="inline-flex items-center justify-center w-12 h-12 bg-dark-300 border-2 border-accent rounded-lg text-accent font-bold text-lg">
                  A
                </kbd>
                <kbd className="inline-flex items-center justify-center w-12 h-12 bg-dark-300 border-2 border-accent rounded-lg text-accent font-bold text-lg">
                  D
                </kbd>
              </div>
              <div>
                <div className="text-white font-semibold">Turn Left / Right</div>
                <div className="text-white/60 text-sm">Steer around corners</div>
              </div>
            </div>

            {/* Brake */}
            <div className="flex items-center gap-4 bg-dark-400/50 rounded-lg p-4">
              <div className="flex gap-2">
                <kbd className="inline-flex items-center justify-center w-12 h-12 bg-dark-300 border-2 border-warning rounded-lg text-warning font-bold text-lg">
                  S
                </kbd>
                <span className="text-white/40 self-center">or</span>
                <kbd className="inline-flex items-center justify-center w-12 h-12 bg-dark-300 border-2 border-warning rounded-lg text-warning font-bold text-sm">
                  Down
                </kbd>
              </div>
              <div>
                <div className="text-white font-semibold">Slow Down / Brake</div>
                <div className="text-white/60 text-sm">Use before sharp turns!</div>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: 'Game Modes',
      content: (
        <div className="space-y-6">
          <div className="bg-dark-400/50 rounded-lg p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-human/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-human" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2" y="8" width="8" height="4" rx="1" />
                  <circle cx="4" cy="13" r="1.5" />
                  <circle cx="8" cy="13" r="1.5" />
                  <rect x="14" y="8" width="8" height="4" rx="1" />
                  <circle cx="16" cy="13" r="1.5" />
                  <circle cx="20" cy="13" r="1.5" />
                </svg>
              </div>
              <h4 className="text-lg font-semibold text-human">Race Against AI</h4>
            </div>
            <p className="text-base text-white/70 leading-relaxed">
              Race against a computer driver! Both cars start together.
              <strong className="text-white"> The car that finishes first wins.</strong>
            </p>
          </div>

          <div className="bg-dark-400/50 rounded-lg p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="13" r="8" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="13" x2="15" y2="13" />
                  <line x1="12" y1="5" x2="12" y2="3" />
                  <line x1="9" y1="3" x2="15" y2="3" />
                </svg>
              </div>
              <h4 className="text-lg font-semibold text-accent">Practice Mode</h4>
            </div>
            <p className="text-base text-white/70 leading-relaxed">
              Race by yourself! No opponent, just you and the track.
              <strong className="text-white"> Try to beat your best time.</strong>
            </p>
          </div>
        </div>
      ),
    },
    {
      title: 'Tips for Success',
      content: (
        <div className="space-y-4">
          <div className="flex items-start gap-4 bg-dark-400/50 rounded-lg p-4">
            <div className="w-10 h-10 rounded-full bg-human/20 flex items-center justify-center flex-shrink-0">
              <span className="text-human font-bold text-lg">1</span>
            </div>
            <div>
              <div className="text-white font-semibold text-base">Start with Easy Track</div>
              <p className="text-white/60 text-base">Begin with "Sunset Speedway" - it has wide roads and gentle turns.</p>
            </div>
          </div>

          <div className="flex items-start gap-4 bg-dark-400/50 rounded-lg p-4">
            <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
              <span className="text-accent font-bold text-lg">2</span>
            </div>
            <div>
              <div className="text-white font-semibold text-base">Slow Down Before Turns</div>
              <p className="text-white/60 text-base">If you go too fast around corners, you will slide off the road!</p>
            </div>
          </div>

          <div className="flex items-start gap-4 bg-dark-400/50 rounded-lg p-4">
            <div className="w-10 h-10 rounded-full bg-warning/20 flex items-center justify-center flex-shrink-0">
              <span className="text-warning font-bold text-lg">3</span>
            </div>
            <div>
              <div className="text-white font-semibold text-base">Stay on the Road</div>
              <p className="text-white/60 text-base">Driving off the track slows you down. Keep your car between the lines!</p>
            </div>
          </div>

          <div className="flex items-start gap-4 bg-dark-400/50 rounded-lg p-4">
            <div className="w-10 h-10 rounded-full bg-ai/20 flex items-center justify-center flex-shrink-0">
              <span className="text-ai font-bold text-lg">4</span>
            </div>
            <div>
              <div className="text-white font-semibold text-base">Have Fun!</div>
              <p className="text-white/60 text-base">Do not worry about being perfect. Practice and enjoy the game!</p>
            </div>
          </div>
        </div>
      ),
    },
  ];

  const currentPageData = pages[currentPage];
  const isLastPage = currentPage === pages.length - 1;
  const isFirstPage = currentPage === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-dark-500/95 backdrop-blur-md p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="how-to-play-title"
    >
      <Card variant="default" className="max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <h2 id="how-to-play-title" className="text-2xl font-bold text-white">
              {currentPageData.title}
            </h2>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Page indicator */}
          <div className="flex items-center gap-2 mt-4">
            {pages.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentPage(index)}
                className={`
                  h-2 rounded-full transition-all duration-300
                  ${index === currentPage ? 'w-8 bg-accent' : 'w-2 bg-white/30 hover:bg-white/50'}
                `}
                aria-label={`Go to page ${index + 1}`}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <CardContent className="flex-1 overflow-y-auto">
          {currentPageData.content}
        </CardContent>

        {/* Footer with navigation */}
        <div className="p-6 border-t border-white/10 flex items-center justify-between gap-4">
          <Button
            variant="ghost"
            size="md"
            onClick={() => setCurrentPage((p) => p - 1)}
            disabled={isFirstPage}
            className={isFirstPage ? 'invisible' : ''}
            leftIcon={
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            }
          >
            Back
          </Button>

          <span className="text-white/40 text-sm">
            {currentPage + 1} of {pages.length}
          </span>

          {isLastPage ? (
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                onClose();
                onStartPlaying?.();
              }}
              rightIcon={
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              }
            >
              Let's Play!
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              onClick={() => setCurrentPage((p) => p + 1)}
              rightIcon={
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              }
            >
              Next
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

export default HowToPlay;
