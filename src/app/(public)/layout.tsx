import { daypartScript } from '@/lib/auth/daypart';
import './public.css';

/* Shared by the landing and every auth page. The inline script picks the sky (data-daypart on <html>)
   from the visitor's own clock before first paint (spec §6.1). The server default is "afternoon" (CSS). */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: daypartScript(process.env.NODE_ENV !== 'production') }} />
      {children}
    </>
  );
}
