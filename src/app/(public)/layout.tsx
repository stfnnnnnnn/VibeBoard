import type { Viewport } from 'next';
import { daypartScript } from '@/lib/auth/daypart';
import './public.css';

/* Shared by the landing and every auth page. The inline script picks the sky (data-daypart on <html>)
   from the visitor's own clock before first paint (spec §6.1). The server default is "afternoon" (CSS). */
/* viewport-fit=cover makes env(safe-area-inset-*) real, so the auth shell and the landing pad themselves clear
   of the notch and home indicator (without it those insets are always 0). */
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: daypartScript(process.env.NODE_ENV !== 'production') }} />
      {children}
    </>
  );
}
