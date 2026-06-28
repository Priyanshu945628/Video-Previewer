/**
 * Root layout — global providers + the font stack + the dark-by-default theme.
 *
 * We deliberately set `dark` on <html> at boot time (no flash), then let a
 * client-side ThemeProvider flip to `light` if the user prefers. Premium dark
 * is the brand default — keep it premium even for the first paint.
 */
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import '@vsp/ui/globals.css';
import { Providers } from './providers';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: { default: 'VSP — Secure Video Review', template: '%s · VSP' },
  description: 'Frame-accurate review for editors who care about the work.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
