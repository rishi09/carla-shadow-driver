import type { ReactNode } from 'react';
import { Header } from './Header';
import { Footer } from './Footer';

interface LayoutProps {
  children: ReactNode;
  showHeader?: boolean;
  showFooter?: boolean;
  gpuStatus?: 'connected' | 'disconnected' | 'connecting';
}

export function Layout({
  children,
  showHeader = true,
  showFooter = true,
  gpuStatus = 'disconnected',
}: LayoutProps) {
  return (
    <div className="flex flex-col min-h-screen">
      {showHeader && <Header />}

      <main className="flex-1 flex flex-col">
        {children}
      </main>

      {showFooter && <Footer gpuStatus={gpuStatus} />}
    </div>
  );
}
