/** A letter grade as in mockup v8 `.lg`: the base letter with a raised +/− modifier, a centred dot, then the meaning.
    Read as one phrase ("C plus, Good"); the visual parts are hidden from assistive tech. */
export default function LetterGrade({ letter, description }: { letter: string; description: string }) {
  const base = letter.replace(/[+\-−]$/, '');
  const mod = letter.slice(base.length);
  const spoken = mod === '' ? base : `${base} ${mod === '+' ? 'plus' : 'minus'}`;
  return (
    <span className="sp-lg" role="img" aria-label={`${spoken}, ${description}`}>
      <span className="sp-lg__l" aria-hidden>{base}{mod && <span className="sp-lg__m">{mod === '-' ? '−' : mod}</span>}</span>
      <span className="sp-lg__dot" aria-hidden />
      <span className="sp-lg__d" aria-hidden>{description}</span>
    </span>
  );
}
