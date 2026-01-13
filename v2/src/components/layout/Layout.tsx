import type { ReactNode } from 'react';
import { Header } from './Header';
import { Footer } from './Footer';

export type NavigationPage = 'home' | 'leaderboard' | 'how-to-play';

interface LayoutProps {
  children: ReactNode;
  showHeader?: boolean;
  showFooter?: boolean;
  gpuStatus?: 'connected' | 'disconnected' | 'connecting';
  onNavigate?: (page: NavigationPage) => void;
  currentPage?: NavigationPage;
}

export function Layout({
  children,
  showHeader = true,
  showFooter = true,
  gpuStatus = 'disconnected',
  onNavigate,
  currentPage = 'home',
}: LayoutProps) {
  return (
    <div className="flex flex-col min-h-screen">
      {showHeader && (
        <Header
          onNavigate={onNavigate}
          currentPage={currentPage}
        />
      )}

      <main className="flex-1 flex flex-col">
        {children}
      </main>

      {showFooter && <Footer gpuStatus={gpuStatus} />}
    </div>
  );
}
