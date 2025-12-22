import { MessageSquare, BarChart3, Settings, Bot, MoreHorizontal } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useUserRole } from '@/hooks/useUserRole';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const navItems = [
  { path: '/inbox', label: 'Conversas', icon: MessageSquare },
  { path: '/dashboard', label: 'Dashboard', icon: BarChart3 },
];

const adminItems = [
  { path: '/admin', label: 'Admin', icon: Settings },
  { path: '/admin/ai', label: 'IA', icon: Bot },
];

export function MobileBottomNav() {
  const location = useLocation();
  const { isAdmin } = useUserRole();

  const isActive = (path: string) => {
    if (path === '/inbox') {
      return location.pathname === '/inbox' || location.pathname.startsWith('/inbox/');
    }
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="bottom-nav">
      <div className="flex items-center justify-around h-14">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);

          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn('bottom-nav-item flex-1', active && 'active')}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs mt-1">{item.label}</span>
            </Link>
          );
        })}

        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  'bottom-nav-item flex-1',
                  (isActive('/admin') || isActive('/admin/ai')) && 'active'
                )}
              >
                <MoreHorizontal className="w-5 h-5" />
                <span className="text-xs mt-1">Menu</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 mb-2">
              {adminItems.map((item) => {
                const Icon = item.icon;
                return (
                  <DropdownMenuItem key={item.path} asChild>
                    <Link to={item.path} className="flex items-center gap-2">
                      <Icon className="w-4 h-4" />
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuItem asChild>
                <Link to="/status" className="flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Status
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {!isAdmin && (
          <Link
            to="/status"
            className={cn('bottom-nav-item flex-1', isActive('/status') && 'active')}
          >
            <Settings className="w-5 h-5" />
            <span className="text-xs mt-1">Status</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
