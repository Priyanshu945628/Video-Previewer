import Link from 'next/link';
import { cn } from '@vsp/ui';

const TABS = [
  { href: '/settings/profile', label: 'Profile' },
  { href: '/settings/security', label: 'Security & 2FA' },
  { href: '/settings/notifications', label: 'Notifications' },
  { href: '/settings/workspace', label: 'Workspace' },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mb-8 text-sm text-muted-foreground">Your account and workspace preferences.</p>

      <div className="mb-6 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              'border-b-2 px-3 py-2 text-sm transition-colors',
              'border-transparent text-muted-foreground hover:text-foreground',
              'aria-[current=page]:border-primary aria-[current=page]:text-foreground',
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {children}
    </div>
  );
}
