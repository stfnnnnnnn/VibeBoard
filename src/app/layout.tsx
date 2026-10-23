import type { Metadata } from 'next';
import { Providers } from '@/components/providers/Providers';
// Self-hosted Inter + DM Sans (see fonts.css for why next/font/google was dropped).
import './fonts.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'VibeBoard',
  description: 'Your personal student productivity dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* suppressHydrationWarning: (public)/layout sets data-daypart before hydration. */
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* The latin subsets next/font used to preload. */}
        <link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/dm-sans-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="vb-font-vars font-inter antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
