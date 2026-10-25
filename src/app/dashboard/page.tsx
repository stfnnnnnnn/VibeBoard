import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { LayoutDashboard } from 'lucide-react';
import { auth, signOut } from '@/auth';
import QuoteWidget  from '@/components/dashboard/QuoteWidget';
import WeatherWidget from '@/components/dashboard/WeatherWidget';
import VerifyEmailBanner from '@/components/dashboard/VerifyEmailBanner';
import { findById } from '@/lib/auth/users';

const MODULES = [
  { href: '/studypulse', src: '/studypulse.png',     alt: 'Study Pulse'     },
  { href: '/finance',    src: '/financetracker.png', alt: 'Finance Tracker' },
  { href: '/habits',     src: '/habittracker.png',   alt: 'Habit Tracker'   },
];

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const firstName = session.user.name?.split(' ')[0] ?? 'Student';
  // Fails open: if the lookup errors, the dashboard still renders (just without the verify banner).
  const me = await findById(Number(session.user.id)).catch(() => null);

  async function handleSignOut() {
    'use server';
    await signOut({ redirectTo: '/login' });
  }

  return (
    <div
      className="vb-bg min-h-screen pb-10"
      style={{
        padding: '50px 5% 40px',
        fontFamily: "'Inter', 'DM Sans', 'Segoe UI', sans-serif",
        color: '#333',
        overflowX: 'hidden',
      }}
    >
      {me && !me.email_verified_at && <VerifyEmailBanner />}

      {/* ── Header row ─────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap' }}>
        <h1
          className="gradient-text text-[2rem] sm:text-[2.75rem] lg:text-[4rem]"
          style={{ marginBottom: '25px', fontWeight: 700, lineHeight: 1.1 }}
        >
          {firstName}&apos;s Home
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '25px' }}>
          <Link
            href="/workboard"
            className="active:scale-[0.97] [@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-[1px]"
            style={{
              background:     'linear-gradient(to right, #f2a7c0, #74bcd9)',
              color:          'rgba(255,255,255,0.99)',
              border:         '1.5px solid rgba(255,255,255,0.95)',
              borderRadius:   '20px',
              boxShadow:      '0 0 0 3px rgba(255,255,255,0.45), 0 6px 18px rgba(240,103,157,0.38), 0 4px 12px rgba(77,171,245,0.28)',
              padding:        '8px 18px',
              fontWeight:     700,
              fontSize:       '1rem',
              display:        'inline-flex',
              alignItems:     'center',
              gap:            '8px',
              textDecoration: 'none',
              cursor:         'pointer',
              transition:     'transform 160ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 200ms cubic-bezier(0.23, 1, 0.32, 1)',
            }}
          >
            <LayoutDashboard size={18} strokeWidth={2.2} />
            <span>My Work</span>
          </Link>
          <form action={handleSignOut} style={{ margin: 0 }}>
            <button
              type="submit"
              className="active:scale-[0.97]"
              style={{
                background:    'linear-gradient(to right, #f2a7c0, #74bcd9)',
                color:         'rgba(255,255,255,0.97)',
                border:        '1px solid #ddd',
                borderRadius:  '20px',
                boxShadow:     '0 4px 12px rgba(77,171,245,0.3)',
                padding:       '8px 16px',
                fontWeight:    700,
                fontSize:      '1rem',
                display:       'flex',
                alignItems:    'center',
                gap:           '8px',
                cursor:        'pointer',
                transition:    'transform 160ms cubic-bezier(0.23, 1, 0.32, 1), opacity 160ms ease',
              }}
            >
              Sign-Out
            </button>
          </form>
        </div>
      </div>

      {/* ── Quote + Weather two-col ─────────────── */}
      <div
        style={{
          display:    'flex',
          gap:        '20px',
          marginBottom: '20px',
          alignItems:  'stretch',
          flexWrap:   'wrap',
        }}
      >
        {/* Quote widget */}
        <div
          className="hover:-translate-y-1.5 transition-all duration-300"
          style={{
            flex:             1,
            minWidth:         '280px',
            minHeight:        '120px',
            background:       'rgba(255,255,255,0.2)',
            backdropFilter:   'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderRadius:     '20px',
            padding:          '28px 32px',
            boxShadow:        '0 8px 20px rgba(0,0,0,0.15)',
            display:          'flex',
            alignItems:       'center',
          }}
        >
          <QuoteWidget />
        </div>

        {/* Weather widget */}
        <div
          className="hover:-translate-y-1.5 transition-all duration-300"
          style={{
            flex:             1,
            minWidth:         '280px',
            minHeight:        '120px',
            background:       'rgba(255,255,255,0.2)',
            backdropFilter:   'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderRadius:     '20px',
            padding:          '28px 32px',
            boxShadow:        '0 8px 20px rgba(0,0,0,0.15)',
            fontSize:         '0.95rem',
            display:          'flex',
            alignItems:       'center',
          }}
        >
          <WeatherWidget />
        </div>
      </div>

      {/* ── Module tiles ────────────────────────── */}
      {/* mobile/tablet: responsive grid | lg+: original flex row (unchanged) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:justify-center gap-5 py-5">
        {MODULES.map((mod) => (
          <Link key={mod.href} href={mod.href} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div
              className="hover:-translate-y-2.5 transition-all duration-300 shadow-[0_8px_20px_rgba(0,0,0,0.15)] hover:shadow-[0_15px_35px_rgba(0,0,0,0.25)] w-full lg:w-[400px] lg:h-[300px] lg:flex-shrink-0"
              style={{
                background:          'rgba(255,255,255,0.2)',
                backdropFilter:      'blur(12px)',
                WebkitBackdropFilter:'blur(12px)',
                borderRadius:        '20px',
                padding:             '20px',
                cursor:              'pointer',
              }}
            >
              <div
                className="relative w-full overflow-hidden rounded-[14px] aspect-video lg:aspect-auto lg:h-[220px]"
                style={{ marginBottom: '10px' }}
              >
                <Image
                  src={mod.src}
                  alt={mod.alt}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px"
                  className="object-cover"
                  style={{ borderRadius: '14px' }}
                  unoptimized
                />
              </div>
              <p style={{ textAlign: 'center', fontWeight: 700, color: '#333', margin: 0 }}>{mod.alt}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Footer */}
      <footer style={{ marginTop: '60px', textAlign: 'center', color: '#444', fontSize: '0.9rem' }}>
        &copy; {new Date().getFullYear()} VibeBoard Dashboard
      </footer>
    </div>
  );
}
