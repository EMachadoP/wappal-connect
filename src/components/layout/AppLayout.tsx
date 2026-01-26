import { ReactNode } from 'react';
import { Header } from './Header';
import { MobileBottomNav } from './MobileBottomNav';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface AppLayoutProps {
  children: ReactNode;
  hideHeader?: boolean;
  hideBottomNav?: boolean;
}

export function AppLayout({ children, hideHeader = false, hideBottomNav = false }: AppLayoutProps) {
  const isMobile = useIsMobile();

  return (
    <div className="h-screen-safe flex flex-col bg-background">
      {/* Desktop: show header, Mobile: hide header */}
      {!isMobile && !hideHeader && <Header />}

      <main className={cn(
        "flex-1 flex flex-col min-h-0",
        isMobile && "pt-safe mt-2",
        isMobile && !hideBottomNav ? 'pb-bottom-nav' : 'pb-safe'
      )}>
        {children}
      </main>

      {/* Mobile: show bottom nav */}
      {isMobile && !hideBottomNav && <MobileBottomNav />}
    </div>
  );
}
