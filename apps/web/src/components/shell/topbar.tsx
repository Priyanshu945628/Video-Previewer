'use client';
import { signOut } from 'next-auth/react';
import { Bell, Search, ChevronDown } from 'lucide-react';
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from '@vsp/ui';
import { useWorkspace } from './workspace-provider';

export function Topbar() {
  const { user } = useWorkspace();
  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-card/30 px-6 backdrop-blur-xl">
      <div className="relative flex-1 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search projects, assets, comments…" />
      </div>
      <div className="flex-1" />
      <Button variant="ghost" size="icon" aria-label="Notifications">
        <Bell className="h-4 w-4" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 rounded-full px-1.5 py-1 transition-colors hover:bg-accent">
            <Avatar name={user.name ?? user.email} src={user.image} size={28} />
            <span className="text-sm">{user.name ?? user.email}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href="/settings/profile">Profile</a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href="/settings/security">Security & 2FA</a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href="/settings/notifications">Notifications</a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void signOut({ callbackUrl: '/login' })}>
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
