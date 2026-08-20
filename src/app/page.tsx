'use client';

import { useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';

/* ── Original feature data with the exact SVG paths from start.php ── */
const features = [
  {
    id:    'tasks',
    color: 'pink' as const,
    title: 'Tasks',
    desc:  'Track classes, to-dos, and upcoming deadlines — all in one place.',
    path:  'M9 16.2l-3.5-3.5L4 14.2l5 5 12-12-1.5-1.5z',
  },
  {
    id:    'grades',
    color: 'blue' as const,
    title: 'Grades',
    desc:  'Stay updated on scores and progress across all your subjects.',
    path:  'M3 17h2v-7H3v7zm4 0h2v-4H7v4zm4 0h2v-10h-2v10zm4 0h2v-6h-2v6zm4 0h2v-2h-2v2z',
  },
  {
    id:    'habits',
    color: 'pink' as const,
    title: 'Habits',
    desc:  'Build routines, set daily goals, and track your personal growth.',
    path:  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  },
  {
    id:    'finances',
    color: 'blue' as const,
    title: 'Finances',
    desc:  'Manage spending, set budgets, and keep your money organized.',
    path:  'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v2h-2zm0 4h2v6h-2z',
  },
];

const PINK = '#e88aa8';
const BLUE = '#5fa8cc';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

export default function LandingPage() {
  const [authOpen, setAuthOpen] = useState(false);

  return (
    <div
      className="vb-bg"
      style={{
        position: 'relative',
        width:    '100%',
        height:   '100vh',
        overflow: 'hidden',
        fontFamily: "'Segoe UI', sans-serif",
      }}
    >
      {/* ── Auth panel ─────────────────────────────────────────── */}
      <div
        style={{
          position:           'absolute',
          top:                0,
          left:               0,
          width:              '25%',
          minWidth:           '260px',
          height:             '100%',
          background:         'rgba(255,255,255,0.25)',
          backdropFilter:     'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          padding:            '40px 20px',
          display:            'flex',
          flexDirection:      'column',
          alignItems:         'center',
          justifyContent:     'center',
          borderRight:        '1px solid rgba(255,255,255,0.2)',
          borderTopRightRadius:    '40px',
          borderBottomRightRadius: '40px',
          transform:          authOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition:         'transform 0.4s ease',
          zIndex:             5,
        }}
      >
        {/* Logo */}
        <div style={{ fontSize: '32px', fontWeight: 700, marginBottom: '20px' }}>
          <span style={{ color: '#f2a7c0' }}>Vibe</span>
          <span style={{ color: '#74bcd9' }}>Board</span>
        </div>

        {/* Continue with Google */}
        <button
          onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            gap:            '8px',
            width:          '100%',
            padding:        '10px 12px',
            borderRadius:   '10px',
            background:     'rgba(255,255,255,0.5)',
            border:         '1px solid rgba(255,255,255,0.4)',
            fontWeight:     600,
            fontSize:       '14px',
            color:          '#444',
            cursor:         'pointer',
            marginBottom:   '8px',
            transition:     'background 0.2s',
          }}
        >
          <GoogleIcon />
          Continue with Google
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', margin: '4px 0' }}>
          <div style={{ flex: 1, height: '1px', background: 'rgba(180,180,180,0.5)' }} />
          <span style={{ fontSize: '11px', color: '#aaa' }}>or</span>
          <div style={{ flex: 1, height: '1px', background: 'rgba(180,180,180,0.5)' }} />
        </div>

        {/* Sign Up */}
        <Link
          href="/signup"
          style={{
            display:         'block',
            width:           '100%',
            textAlign:       'center',
            padding:         '12px',
            borderRadius:    '10px',
            textDecoration:  'none',
            fontWeight:      'bold',
            margin:          '8px 0',
            fontSize:        '15px',
            backgroundColor: '#f2a7c0',
            color:           'white',
            transition:      'background-color 0.3s ease',
          }}
        >
          Sign Up
        </Link>

        {/* Log In */}
        <Link
          href="/login"
          style={{
            display:         'block',
            width:           '100%',
            textAlign:       'center',
            padding:         '12px',
            borderRadius:    '10px',
            textDecoration:  'none',
            fontWeight:      'bold',
            margin:          '10px 0',
            fontSize:        '15px',
            backgroundColor: '#91cbe6',
            color:           'white',
            transition:      'background-color 0.3s ease',
          }}
        >
          Log In
        </Link>
      </div>

      {/* ── Main panel ──────────────────────────────────────────── */}
      <div
        style={{
          width:          authOpen ? '75%' : '100%',
          marginLeft:     authOpen ? '25%' : '0',
          height:         '100vh',
          padding:        '5px 80px 100px',
          display:        'flex',
          flexDirection:  'column',
          justifyContent: 'center',
          alignItems:     authOpen ? 'flex-start' : 'center',
          textAlign:      'left',
          color:          '#333',
          overflowY:      'auto',
          transition:     'all 0.4s ease',
        }}
      >
        {/* Toggle button */}
        <button
          id="toggle-auth"
          onClick={() => setAuthOpen(!authOpen)}
          style={{
            position:     'absolute',
            top:          '20px',
            left:         '20px',
            fontSize:     '24px',
            background:   'rgba(255,255,255,0.5)',
            border:       'none',
            padding:      '10px 16px',
            borderRadius: '10px',
            cursor:       'pointer',
            zIndex:       10,
            transition:   'background 0.3s ease',
            lineHeight:   1,
          }}
          aria-label="Toggle menu"
        >
          ☰
        </button>

        {/* Heading */}
        <h1
          className="gradient-text"
          style={{
            fontSize:     authOpen ? '70px' : '74px',
            marginBottom: '20px',
            maxWidth:     '1000px',
            lineHeight:   1.2,
            fontWeight:   700,
            transition:   'font-size 0.3s ease',
          }}
        >
          <span>Bring Colors to Your</span><br />
          <span>Productivity With VibeBoard</span>
        </h1>

        {/* Description */}
        <p
          style={{
            textAlign:    'left',
            marginTop:    '20px',
            fontSize:     '18px',
            maxWidth:     '1000px',
            padding:      '16px 24px',
            borderRadius: '14px',
            background:   'linear-gradient(90deg, rgba(116,188,217,0.2), rgba(242,167,192,0.2))',
            fontWeight:   500,
            color:        '#444',
          }}
        >
          <strong>VibeBoard</strong> is your personal, visual-first student dashboard designed to
          organize tasks, grades, finances, and habits into one sleek platform. Built by students,
          for students, it simplifies your academic life while reflecting your personality.
        </p>

        {/* Feature grid */}
        <div
          style={{
            display:             'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap:                 '40px',
            marginTop:           '20px',
            maxWidth:            '1000px',
            width:               '100%',
          }}
        >
          {features.map(({ id, color, title, desc, path }) => {
            const fill  = color === 'pink' ? PINK : BLUE;
            const tColor = color === 'pink' ? PINK : BLUE;

            return (
              <div
                key={id}
                className="group"
                style={{
                  background:     'rgba(255,255,255,0.25)',
                  borderRadius:   '16px',
                  padding:        '20px',
                  textAlign:      'center',
                  backdropFilter: 'blur(10px)',
                  color:          '#333',
                  overflow:       'hidden',
                  height:         '115px',
                  transition:     'all 0.3s ease',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.height = '160px';
                  el.style.paddingBottom = '40px';
                  el.style.boxShadow = '0 10px 20px rgba(0,0,0,0.1)';
                  const desc = el.querySelector<HTMLDivElement>('.feature-desc');
                  if (desc) desc.style.opacity = '1';
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.height = '115px';
                  el.style.paddingBottom = '20px';
                  el.style.boxShadow = 'none';
                  const desc = el.querySelector<HTMLDivElement>('.feature-desc');
                  if (desc) desc.style.opacity = '0';
                }}
              >
                {/* Icon */}
                <svg viewBox="0 0 24 24" width="36" height="36" style={{ margin: '0 auto', display: 'block' }}>
                  <path d={path} fill={fill} />
                </svg>

                {/* Title */}
                <div style={{ marginTop: '5px', color: tColor, fontSize: '16px', fontWeight: 'bold' }}>
                  {title}
                </div>

                {/* Description — fades in on hover */}
                <div
                  className="feature-desc"
                  style={{
                    textAlign:        'left',
                    marginTop:        '12px',
                    fontSize:         '14px',
                    color:            tColor,
                    opacity:          0,
                    transition:       'opacity 0.3s ease',
                    display:          '-webkit-box',
                    WebkitLineClamp:  3,
                    WebkitBoxOrient:  'vertical',
                    overflow:         'hidden',
                  }}
                >
                  {desc}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
