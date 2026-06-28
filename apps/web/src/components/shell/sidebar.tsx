'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  FolderOpen,
  Inbox,
  Activity,
  Settings,
  Shield,
  Sparkles,
  Archive,
  Share2,
} from 'lucide-react';
import { cn } from '@vsp/ui';

const NAV = [
  { href: '/', label: 'Projects', icon: FolderOpen },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/shares', label: 'Share links', icon: Share2 },
  { href: '/archive', label: 'Archive', icon: Archive },
];

const SECONDARY = [
  { href: '/admin', label: 'Admin', icon: Shield },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="flex flex-col border-r border-border bg-card/40 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-2 px-4 border-b border-border">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold tracking-tight">VSP</span>
      </div>

      <nav className="flex-1 space-y-0.5 p-3">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive(item.href)
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="space-y-0.5 border-t border-border p-3">
        {SECONDARY.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive(item.href)
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
