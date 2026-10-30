import Link from 'next/link';
import Image from 'next/image';
import type { CSSProperties, ReactNode } from 'react';

export function Chip({ dot, children }: { dot: string; children: ReactNode }) {
  return (
    <span className="db-item db-chip">
      <span className="db-gdot" style={{ '--d': dot } as CSSProperties} />
      {children}
    </span>
  );
}

/** Glass module tile (spec §5.4): same artwork, live chip in the title row. */
export default function ModuleTile({ href, src, name, chip, index }: {
  href: string; src: string; name: string; chip: ReactNode; index: number;
}) {
  return (
    <Link href={href} className="db-panel db-tile db-enter" style={{ '--i': index } as CSSProperties}>
      <div className="db-art">
        <Image src={src} alt="" fill sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 33vw" className="db-art-img" unoptimized priority />
      </div>
      <div className="db-tname"><span>{name}</span>{chip}</div>
    </Link>
  );
}
