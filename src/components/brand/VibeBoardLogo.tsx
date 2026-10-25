import Link from 'next/link';

interface VibeBoardLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showMark?: boolean;
  showText?: boolean;
  className?: string;
  href?: string;
  asLink?: boolean;
}

export function VibeBoardLogo({
  size = 'md',
  showMark = true,
  showText = true,
  className = '',
  href = '/',
  asLink = true,
}: VibeBoardLogoProps) {
  const sizeMap = {
    sm: {
      mark: 22,
      text: 'text-[1.125rem]',
      gap: 'gap-2',
    },
    md: {
      mark: 26,
      text: 'text-[1.375rem]',
      gap: 'gap-2.5',
    },
    lg: {
      mark: 34,
      text: 'text-[1.75rem]',
      gap: 'gap-3',
    },
  };

  const { mark, text, gap } = sizeMap[size];

  const content = (
    <span
      className={`inline-flex items-center ${gap} select-none ${className} transition-transform duration-150 ease-out active:scale-[0.97]`}
      style={{ textDecoration: 'none' }}
    >
      {showMark && (
        <span
          className="inline-flex items-center justify-center rounded-[8px] flex-shrink-0"
          style={{
            width: mark,
            height: mark,
            background: 'linear-gradient(135deg, #fff5f8 0%, #fdfbfd 50%, #f0f8fd 100%)',
            border: '1px solid rgba(249, 197, 209, 0.7)',
            boxShadow: '0 2px 6px rgba(217, 98, 140, 0.15)',
          }}
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 32 32"
            width={mark * 0.82}
            height={mark * 0.82}
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* V */}
            <path
              d="M 6.8 9.5 L 10.8 9.5 L 13.8 19.8 L 14.0 19.8 L 17.0 9.5 L 20.8 9.5 L 15.6 23.5 L 12.0 23.5 Z"
              fill="var(--pub-logo-a, #d9628c)"
            />
            {/* B */}
            <path
              d="M 16.5 9.5 L 21.6 9.5 C 23.8 9.5 25.2 10.5 25.2 12.2 C 25.2 13.4 24.5 14.3 23.4 14.7 C 24.8 15.1 25.6 16.2 25.6 17.8 C 25.6 19.8 23.9 21.0 21.4 21.0 L 16.5 21.0 Z M 19.8 11.8 L 19.8 14.1 L 21.2 14.1 C 22.2 14.1 22.8 13.6 22.8 12.9 C 22.8 12.2 22.2 11.8 21.2 11.8 Z M 19.8 16.2 L 19.8 18.7 L 21.4 18.7 C 22.5 18.7 23.1 18.1 23.1 17.4 C 23.1 16.7 22.5 16.2 21.4 16.2 Z"
              fill="var(--pub-logo-b, #3d8fbf)"
            />
          </svg>
        </span>
      )}
      {showText && (
        <span
          className={`${text} tracking-[-0.03em] font-extrabold leading-none flex items-center`}
          style={{ fontFamily: "'Inter', 'DM Sans', -apple-system, sans-serif" }}
        >
          <span style={{ color: 'var(--pub-logo-a, #d9628c)' }}>Vibe</span>
          <span style={{ color: 'var(--pub-logo-b, #3d8fbf)' }}>Board</span>
        </span>
      )}
    </span>
  );

  if (asLink) {
    return (
      <Link href={href} aria-label="VibeBoard home" className="pub-logo inline-flex items-center no-underline">
        {content}
      </Link>
    );
  }

  return content;
}

export default VibeBoardLogo;
