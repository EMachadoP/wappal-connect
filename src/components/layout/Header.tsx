import { MessageSquare, BarChart3, Settings, LogOut, Bot, Contact } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useUserRole } from '@/hooks/useUserRole';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/inbox', label: 'Conversas', icon: MessageSquare },
  { path: '/dashboard', label: 'Dashboard', icon: BarChart3 },
  { path: '/admin', label: 'Admin', icon: Settings, adminOnly: true },
  { path: '/admin/ai', label: 'IA', icon: Bot, adminOnly: true },
  { path: '/admin/contacts', label: 'Duplicados', icon: Contact, adminOnly: true },
];

export function Header() {
  const location = useLocation();
  const { signOut } = useAuth();
  const { profile } = useProfile();
  const { isAdmin } = useUserRole();

  const visibleNavItems = navItems.filter(item => !item.adminOnly || isAdmin);

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4">
      <div className="flex items-center gap-6">
        <Link to="/inbox" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-semibold text-foreground">G7 Client Connector</span>
        </Link>

        <nav className="flex items-center gap-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.path);
            
            return (
              <Link key={item.path} to={item.path}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "gap-2",
                    isActive && "bg-muted text-foreground"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Button>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {profile?.name || profile?.email}
        </span>
        <Button variant="ghost" size="icon" onClick={signOut}>
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
}