'use client';

import { useState, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Calculator as CalculatorIcon, GraduationCap, BarChart3, CalendarDays,
  Image as ImageIcon, FileText, Camera, FolderOpen, Loader2, Trash2,
  Home, ArrowLeft, Plus, TriangleAlert,
} from 'lucide-react';

type ScaleType   = '1pt' | '4pt';
type DisplayMode = 'final' | 'per-period';

interface SubjectRow {
  id:    number;
  name:  string;
  units: string;
  grade: string;
  /** OCR couldn't cleanly separate letters from digits in this name (e.g.
   *  "PTI0I") — likely garbled, worth a manual check. Never set for rows
   *  added or edited by hand. */
  uncertain?: boolean;
}

interface PeriodDataRow {
  id:     number;
  name:   string;
  units:  string;
  grades: string[]; // one entry per period; '' = missing/invalid
  uncertain?: boolean;
}

interface PeriodData {
  periods: string[];
  rows:    PeriodDataRow[];
}

interface ParseResult {
  rows:       SubjectRow[];
  periodData: PeriodData | null;
}

/* ── Shared styles — aligned with the rest of VibeBoard's glass system ── */

const GLASS: React.CSSProperties = {
  background:           'rgba(255,255,255,0.4)',
  backdropFilter:       'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  borderRadius:         '20px',
  border:               '1px solid rgba(255,255,255,0.4)',
  boxShadow:            '0 8px 24px rgba(116,188,217,0.12)',
};

const GLASS_STRONG: React.CSSProperties = {
  background:           'rgba(255,255,255,0.92)',
  backdropFilter:       'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  borderRadius:         '20px',
  border:               '1px solid rgba(255,255,255,0.5)',
  boxShadow:            '0 12px 40px rgba(0,0,0,0.18)',
};

const INPUT: React.CSSProperties = {
  padding:      '8px 12px',
  borderRadius: '10px',
  border:       '1px solid rgba(200,210,230,0.5)',
  background:   'rgba(255,255,255,0.82)',
  fontSize:     '0.88rem',
  fontFamily:   'inherit',
  width:        '100%',
  boxSizing:    'border-box',
};

const BTN: React.CSSProperties = {
  borderRadius: '12px',
  border:       '1px solid rgba(200,210,230,0.4)',
  padding:      '8px 18px',
  cursor:       'pointer',
  fontSize:     '0.82rem',
  fontWeight:   700,
  fontFamily:   'inherit',
  whiteSpace:   'nowrap',
  display:      'inline-flex',
  alignItems:   'center',
  gap:          '6px',
  transition:   'opacity 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease',
};

/* ── Utilities ── */

let _uid = 1;
const uid = () => _uid++;
const blank = (): SubjectRow => ({ id: uid(), name: '', units: '', grade: '' });

function gwaColor(gwa: number, scale: ScaleType) {
  if (gwa === 0) return '#94a3b8';
  if (scale === '1pt') {
    if (gwa <= 1.75) return '#16a34a';
    if (gwa <= 2.50) return '#2563eb';
    if (gwa <= 3.00) return '#d97706';
    return '#dc2626';
  }
  if (gwa >= 3.50) return '#16a34a';
  if (gwa >= 2.50) return '#2563eb';
  if (gwa >= 1.50) return '#d97706';
  return '#dc2626';
}

/* ── Course code extractor ── */

function extractCourseCode(text: string): string | null {
  if (!text) return null;
  const fixed = text
    .replace(/€/g, 'C').replace(/\$/g, 'S')
    .replace(/\|/g, 'I').replace(/°/g, 'O').replace(/©/g, 'C');
  const m = fixed.match(/\b([A-Z]{2,6})[\s-]*(\d{2,5}[A-Z]?)\b/);
  return m ? `${m[1]}${m[2]}` : null;
}

/* ── Period name guesser ── */

function detectPeriodNames(text: string, count: number): string[] {
  const lo = text.toLowerCase();
  if (count === 2) {
    if (/midterm/.test(lo) && /final/.test(lo))   return ['Midterm', 'Finals'];
    if (/prelim/.test(lo) && /midterm/.test(lo))   return ['Preliminary', 'Midterm'];
    if (/(1st|first)/.test(lo) && /(2nd|second)/.test(lo)) return ['1st Shifting', '2nd Shifting'];
    return ['Period 1', 'Period 2'];
  }
  if (count === 3) {
    if (/shift/.test(lo))  return ['1st Shifting', '2nd Shifting', '3rd Shifting'];
    if (/prelim/.test(lo)) return ['Preliminary', 'Midterm', 'Finals'];
    return ['Period 1', 'Period 2', 'Period 3'];
  }
  return Array.from({ length: count }, (_, i) => `Period ${i + 1}`);
}

/* ── Line merger ──
   Tesseract sometimes splits a single table row across two text lines when
   cells contain multiple words. If a line has a course code but no grade
   numbers, and the NEXT line starts with a section code (e.g. TN33), merge
   them into one before parsing.
── */

function mergeOcrLines(raw: string): string {
  const lines = raw.split('\n').map(l => l.trim());
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const cur = lines[i];
    const nxt = lines[i + 1] ?? '';
    // Detect: current line has a course-code-like prefix but zero decimal numbers
    const hasCourseCode    = /^[A-Z]{2,6}\s*\d{1,5}/.test(cur);
    const hasDecimal       = /\d+[.,]\d+/.test(cur);
    const hasStandaloneInt = /(?:^|\s)\d{1,2}(?:\s|$)/.test(cur);
    // Detect: next line starts with a section code token (e.g. TN33, AB12)
    const nxtStartsSection = /^[A-Z]{1,4}\d{2,4}\b/.test(nxt);
    const nxtHasNumbers    = /\d/.test(nxt);

    if (cur.length > 2 && hasCourseCode && !hasDecimal && !hasStandaloneInt
        && nxtStartsSection && nxtHasNumbers) {
      out.push(cur + ' ' + nxt);
      i += 2;
    } else {
      if (cur.length > 1) out.push(cur);
      i++;
    }
  }
  return out.join('\n');
}

/* ── OCR parser ──
   Primary strategy: find a section code (e.g. TN33, AB12) that acts as a
   column divider. Everything after it is: units → grade slots.
   This correctly handles titles that contain numbers (e.g. "CS SPECIALIZATION 3").
   Fallback: rightmost-contiguous grade cluster heuristic.
   Out-of-range values at grade positions are kept as slots so multi-period
   column counts are preserved (Midterm 9.0 → empty slot, not dropped).
── */

function parseOcrText(text: string, scale: ScaleType): ParseResult {
  const gradeMin = scale === '1pt' ? 0.75 : 0.0;
  const gradeMax = scale === '1pt' ? 5.00 : 4.0;

  interface RawRow {
    name:  string;
    units: number | null;
    slots: number[]; // grade-position numbers, including OOR
  }
  const raws: RawRow[] = [];

  const extractNums = (s: string) => {
    const out: { v: number; i: number; raw: string }[] = [];
    const re = /(\d+(?:[.,]\d+)?)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null)
      out.push({ v: parseFloat(m[1].replace(',', '.')), i: m.index, raw: m[1] });
    return out;
  };

  /* Tesseract frequently drops the decimal point: "3.5" → "35", "1.25" → "125".
     If a number at a grade position is a 2–3 digit integer whose /10 or /100
     would fall in the valid grade range, normalise it.
     Examples (4pt): 35→3.5, 40→4.0, 30→3.0
     Examples (1pt): 35→3.5, 125→1.25, 150→1.50, 200→2.00

     Safety rule: only normalise if the result has ≤2 decimal digits AND the
     original value looks like a plausible grade (not a raw percentage like 86).
     Percentages (50–100) normalise to 5–10 which is always OOR, so they are
     naturally rejected — but 50→5.0 would slip through on 1pt scale.
     We therefore restrict 2-digit normalisation to v ≤ 49 (grades ≤ 4.9). */
  /* A grade candidate must have ≥2 digits OR a decimal separator.
     Single-digit OCR fragments (e.g. "3" from "£3" which was actually 86)
     are filtered out so they don't contaminate the grade cluster. */
  const looksLikeGrade = (raw: string) =>
    raw.includes('.') || raw.includes(',') || raw.length >= 2;

  /* Nearest-valid-grade-point snap — corrects single-glyph OCR misreads
     (e.g. "5" read as "0": 2.25 → 2.20) that land close to, but not exactly
     on, a real grade point.  1pt scale steps in 0.25s (1.00 … 3.00, 5.00);
     4pt scale steps in 0.5s using this app's own canonical points (see
     src/lib/gradeScale.ts) — 0.5, 1.0, 1.5 … 4.0.  Only snaps within a small
     tolerance so a genuinely different value (e.g. the deliberately
     out-of-range 9.0 in a Midterm column) is left alone. */
  const SCALE_4PT_POINTS = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];
  const SNAP_TOLERANCE = 0.08;
  const snapToScale = (v: number): number => {
    if (scale === '1pt') {
      const snapped = Math.round(v * 4) / 4;
      return (snapped >= gradeMin && snapped <= gradeMax && Math.abs(snapped - v) <= SNAP_TOLERANCE) ? snapped : v;
    }
    let nearest = v, bestDiff = Infinity;
    for (const p of SCALE_4PT_POINTS) {
      const diff = Math.abs(p - v);
      if (diff < bestDiff) { bestDiff = diff; nearest = p; }
    }
    return bestDiff <= SNAP_TOLERANCE ? nearest : v;
  };

  const normalizeSlot = (v: number): number => {
    if (!Number.isInteger(v)) {
      // Already a decimal — snap to the nearest valid grade point.
      return snapToScale(v);
    }
    // Two-digit (10–49 only): v/10.  Covers 10→1.0 … 49→4.9
    if (v >= 10 && v <= 49) {
      const n = v / 10;
      if (n >= gradeMin && n <= gradeMax) return snapToScale(n);
    }
    // Three-digit: v/100.  Covers 100→1.00 … 500→5.00 (1pt scale)
    if (v >= 100 && v <= 500) {
      const n = v / 100;
      if (n >= gradeMin && n <= gradeMax) return snapToScale(n);
    }
    return v;
  };

  /* Pre-process: merge lines split by OCR mid-row */
  const merged = mergeOcrLines(text);

  for (const rawLine of merged.split('\n')) {
    const line = rawLine.trim();
    if (line.length < 3 || !/\d/.test(line)) continue;

    /* Skip header / summary rows */
    const alpha = line.replace(/[^a-zA-Z\s]/g, '').trim().toLowerCase();
    if (/^(subject|course|description|units?|grade|credit|no\.?|code|midterm|final|shift|prelim|monthly|lec|lab|total|average|gwa)\b/.test(alpha)) continue;

    /* Fix common OCR artifacts */
    const fl = line.replace(/€/g, 'C').replace(/\$/g, 'S').replace(/\|/g, 'I');

    const allNums = extractNums(fl);
    if (allNums.length === 0) continue;

    /* Course code at start of line */
    const codeM = fl.match(/^[A-Z]{2,6}\s*\d{2,5}[A-Z]?\b/);
    const courseCode = codeM ? codeM[0].replace(/\s+/g, '') : null;

    /* ── Strategy 1: section code divider ── */
    /* Look for a token like TN33, AB12, XY123 that appears AFTER the first
       25 % of the line (so we don't mis-identify the course code itself). */
    const skipChars   = Math.max(5, Math.ceil(fl.length * 0.25));
    const sectionRe   = /\b([A-Z]{1,4}\d{2,4})\b/g;
    let   sectionEnd  = -1;
    let   sectionTok  = '';
    let   sm: RegExpExecArray | null;
    while ((sm = sectionRe.exec(fl)) !== null) {
      if (sm.index >= skipChars) { sectionEnd = sm.index + sm[0].length; sectionTok = sm[0]; break; }
    }

    if (sectionEnd > 0) {
      const afterNums = extractNums(fl.substring(sectionEnd));

      /* First int 1–9 after section code = units */
      let unitIdx = -1;
      for (let i = 0; i < afterNums.length; i++) {
        if (Number.isInteger(afterNums[i].v) && afterNums[i].v >= 1 && afterNums[i].v <= 9) {
          unitIdx = i; break;
        }
      }

      /* All numbers after units are grade slots — normalise OCR decimal drops.
         Filter single-digit fragments (OCR noise from garbled percentage scores). */
      const slots = unitIdx >= 0
        ? afterNums.slice(unitIdx + 1).filter(n => looksLikeGrade(n.raw)).map(n => normalizeSlot(n.v))
        : [];
      /* Keep the row if units were found, even when no slot is in the grade
         range (e.g. Finals OCR'd as "=H" — no digits extractable).  The row
         appears with a blank grade so the user can fill it in manually;
         the GWA calculation already skips rows whose grade field is empty. */
      if (unitIdx >= 0) {
        const beforeSection = fl.substring(0, sectionEnd - sectionTok.length).trim();
        raws.push({
          name:  courseCode ?? beforeSection ?? `Subject ${raws.length + 1}`,
          units: afterNums[unitIdx].v,
          slots,
        });
        continue;
      }
    }

    /* ── Strategy 2: fallback — rightmost contiguous grade cluster ── */
    /* Find grades working right-to-left so numbers embedded in titles are
       not mistaken for units. */
    const gradeCluster: number[] = [];
    let firstGradeNumIdx = allNums.length;
    for (let i = allNums.length - 1; i >= 0; i--) {
      const n = allNums[i];
      /* Stop at single-digit OCR fragments like "3" from "£3" (= 86 badly read).
         Real OCR'd grades always have ≥2 digits or a decimal separator. */
      if (!looksLikeGrade(n.raw)) break;
      const nv = normalizeSlot(n.v);
      if (nv >= gradeMin && nv <= gradeMax) {
        gradeCluster.unshift(nv);
        firstGradeNumIdx = i;
      } else break;
    }
    /* No readable grade digits at all (e.g. Tesseract totally missed the
       Finals cell — raw text has letters where a number should be). Don't
       drop the whole row: try to still recover a units value so the name
       and units survive with a blank grade the user can fill in, mirroring
       what Strategy 1 already does above. Only give up entirely if there's
       nothing usable in the line at all. */
    if (gradeCluster.length === 0) {
      let unitIdxNoGrade = -1;
      for (let i = allNums.length - 1; i >= 0; i--) {
        const n = allNums[i];
        if (Number.isInteger(n.v) && n.v >= 1 && n.v <= 6) { unitIdxNoGrade = i; break; }
      }
      if (unitIdxNoGrade === -1) continue;
      const cutPosNoGrade  = allNums[unitIdxNoGrade].i;
      const rawNameNoGrade = fl.substring(0, cutPosNoGrade).trim().replace(/\s+/g, ' ');
      if (!rawNameNoGrade) continue;
      raws.push({
        name:  courseCode ?? rawNameNoGrade ?? `Subject ${raws.length + 1}`,
        units: allNums[unitIdxNoGrade].v,
        slots: [],
      });
      continue;
    }

    /* Last int 1–6 to the LEFT of the grade cluster = units.
       Skip single-digit OCR noise that sits immediately next to the grade
       cluster (e.g. "7" from a garbled "78" percentage score in an adjacent
       column).  "Immediately next to" = within 2 positions of firstGradeNumIdx.
       Cap at 6 to reject clearly-wrong OCR digits (7/8/9 misread from noise). */
    let unitIdx2 = -1;
    for (let i = firstGradeNumIdx - 1; i >= 0; i--) {
      const n = allNums[i];
      if (!looksLikeGrade(n.raw) && i >= firstGradeNumIdx - 2) continue;
      if (Number.isInteger(n.v) && n.v >= 1 && n.v <= 6) {
        unitIdx2 = i; break;
      }
    }
    /* Second-chance: proximity skip can over-fire when the line has very few
       numbers (e.g. OCR glues a letter prefix onto the grade: "Ne225" → only 3
       numbers total, so both the unit "3" and filler "0" fall within the skip
       window).  Re-scan without the proximity gate if nothing was found. */
    if (unitIdx2 === -1) {
      for (let i = firstGradeNumIdx - 1; i >= 0; i--) {
        const n = allNums[i];
        if (Number.isInteger(n.v) && n.v >= 1 && n.v <= 6) {
          unitIdx2 = i; break;
        }
      }
    }

    const cutPos  = unitIdx2 >= 0 ? allNums[unitIdx2].i : allNums[firstGradeNumIdx].i;
    const rawName = fl.substring(0, cutPos).trim().replace(/\s+/g, ' ');
    if (!rawName && unitIdx2 === -1) continue;

    raws.push({
      name:  courseCode ?? rawName ?? `Subject ${raws.length + 1}`,
      units: unitIdx2 >= 0 ? allNums[unitIdx2].v : null,
      slots: gradeCluster,
    });
  }

  if (raws.length === 0) return { rows: [], periodData: null };

  /* ── Determine single vs multi-period ── */
  const slotCounts = raws.map(r => r.slots.length);
  const maxSlots   = Math.max(...slotCounts);
  const multiCount = slotCounts.filter(c => c > 1).length;
  const isMulti    = maxSlots >= 2 && multiCount >= Math.ceil(raws.length * 0.4);

  const fmt  = (v: number) => v.toFixed(2);
  const good = (v: number) => v >= gradeMin && v <= gradeMax;

  /* Resolve the best display name for a row:
     1. Standard alphanumeric course code: CS0027, PT1019L, GED0019
     2. All-caps first token (digit-free codes): LIWORIZ, ETHICS, READ_PH, NSTP
     3. Fall back to whatever text was captured before the unit column
     A name is flagged `uncertain` when it falls back to a token that mixes
     letters and digits without forming a clean code — a strong signal
     Tesseract mangled a digit into a letter (or vice versa) somewhere in the
     middle (e.g. "PT1019" → "PTI0I"). Pure-letter fallback codes (ETHICS,
     LIWORIZ) are legitimate and not flagged. */
  const resolveName = (r: RawRow): { name: string; uncertain: boolean } => {
    if (!r.name) return { name: `Subject ${raws.indexOf(r) + 1}`, uncertain: false };
    const code = extractCourseCode(r.name);
    if (code) return { name: code, uncertain: false };
    // First whitespace-delimited token — normalize to uppercase so mixed-case
    // OCR like "ETHics" or "PTiom" is recognised as a subject code.
    const tokens   = r.name.split(/\s+/).filter(Boolean);
    const firstTok = tokens[0] ?? '';
    // A bare short letter-prefix (e.g. "PT") followed by a token that starts
    // with a digit is very likely a course code the source rendered with a
    // space ("PT 1013") where the primary regex above failed only because
    // OCR noise (e.g. "10M3L") broke the digit run before a clean boundary —
    // pull the next token in too rather than silently dropping it; that's
    // the part that actually identifies the subject.
    const candidate = /^[A-Z]{2,4}$/.test(firstTok) && tokens[1] && /^[0-9]/.test(tokens[1]) && tokens[1].length <= 8
      ? firstTok + tokens[1]
      : firstTok;
    const tokUpper = candidate.toUpperCase();
    if (tokUpper.length >= 2 && /^[A-Z][A-Z0-9_-]{0,11}$/.test(tokUpper)) {
      const uncertain = /[0-9]/.test(tokUpper) && /[A-Z]/.test(tokUpper);
      return { name: tokUpper, uncertain };
    }
    return { name: r.name, uncertain: false };
  };

  if (!isMulti) {
    const rows = raws.map(r => {
      const last = r.slots.findLast?.(good) ?? r.slots.filter(good).at(-1);
      const resolved = resolveName(r);
      // Blank grade when OCR could not read the grade cell — user can type it in.
      return { id: uid(), name: resolved.name, units: r.units !== null ? String(r.units) : '', grade: last ? fmt(last) : '', uncertain: resolved.uncertain } as SubjectRow;
    });
    return { rows, periodData: null };
  }

  /* ── Multi-period: build period rows ── */
  /* For rows with fewer slots than maxSlots, left-pad so the last slot aligns
     with Finals (the most common case for missing/OOR midterm). */
  const periods    = detectPeriodNames(text, maxSlots);
  const periodRows = raws.map(r => {
    const padded = Array.from({ length: maxSlots }, (_, i) => {
      /* Right-align: if row has fewer slots, earlier columns are empty */
      const offset = maxSlots - r.slots.length;
      const slotVal = r.slots[i - offset];
      if (slotVal === undefined || !good(slotVal)) return '';
      return fmt(slotVal);
    });
    const resolved = resolveName(r);
    return { id: uid(), name: resolved.name, units: r.units !== null ? String(r.units) : '', grades: padded, uncertain: resolved.uncertain } as PeriodDataRow;
  });

  /* Final grade = last non-empty grade per subject */
  const finalRows: SubjectRow[] = periodRows.map(r => ({
    id:    uid(),
    name:  r.name,
    units: r.units,
    grade: [...r.grades].reverse().find(g => g !== '') ?? '',
    uncertain: r.uncertain,
  }));

  return { rows: finalRows, periodData: { periods, rows: periodRows } };
}

/* ── Period Mode Modal ── */

function ModeModal({ periods, onSelect }: { periods: string[]; onSelect: (m: DisplayMode) => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,40,0.5)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ ...GLASS_STRONG, padding: '36px 28px', maxWidth: '420px', width: '100%', textAlign: 'center' }}>
        <div style={{ width: '52px', height: '52px', borderRadius: '16px', background: 'linear-gradient(135deg,#f2a7c0,#74bcd9)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
          <BarChart3 size={24} color="white" strokeWidth={2.25} />
        </div>
        <h2 style={{ margin: '0 0 6px', fontSize: '1.05rem', fontWeight: 800, color: '#2d3748' }}>Multiple periods detected</h2>
        <p style={{ margin: '0 0 22px', fontSize: '0.83rem', color: '#8a94a6' }}>
          Found: <strong style={{ color: '#74bcd9' }}>{periods.join(' · ')}</strong>
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          {[
            { mode: 'final' as DisplayMode, Icon: GraduationCap, label: 'Final Grade', desc: 'Overall GWA from final computed grades', color: '#74bcd9' },
            { mode: 'per-period' as DisplayMode, Icon: CalendarDays, label: 'GWA per Period', desc: 'Separate GWA for each period', color: '#e88aa8' },
          ].map(({ mode, Icon, label, desc, color }) => (
            <button key={mode} className="gwa-focusable" onClick={() => onSelect(mode)}
              style={{ background: `${color}14`, border: `1.5px solid ${color}55`, borderRadius: '16px', padding: '20px 14px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
              <Icon size={22} color={color} strokeWidth={2.1} />
              <span style={{ fontWeight: 800, fontSize: '0.87rem', color: '#2d3748' }}>{label}</span>
              <span style={{ fontSize: '0.72rem', color: '#8a94a6', lineHeight: 1.4 }}>{desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   Scale Selection
════════════════════════════════════════════ */

/* Same breakdown data shown in the grading setup wizard's scale step — kept
   identical here so the two places in the app teach the same numbers. */
const SCALE_4PT_CHIPS: [string, string, string][] = [
  ['97–100', 'A', 'Excellent'], ['93–96', 'B+', 'Superior'], ['89–92', 'B', 'Very Good'],
  ['85–88', 'C+', 'Good'], ['80–84', 'C', 'Satisfactory'], ['75–79', 'D+', 'Fair'],
  ['70–74', 'D', 'Pass'], ['<70', 'F', 'Failed'],
];
const SCALE_1PT_CHIPS: [string, string, string][] = [
  ['96–100', '1.00', 'Excellent'], ['94–95', '1.25', 'Very Good'], ['92–93', '1.50', 'Very Good'],
  ['89–91', '1.75', 'Good'], ['87–88', '2.00', 'Good'], ['84–86', '2.25', 'Good'],
  ['82–83', '2.50', 'Fair'], ['79–81', '2.75', 'Fair'], ['75–78', '3.00', 'Passed'], ['<75', '5.00', 'Failed'],
];

function ScaleSelect({ onSelect }: { onSelect: (s: ScaleType) => void }) {
  return (
    <div style={{ maxWidth: '640px', margin: '0 auto' }}>
      <div style={{ ...GLASS, padding: '30px 24px', textAlign: 'center', marginBottom: '24px' }}>
        <div style={{ width: '58px', height: '58px', borderRadius: '50%', position: 'relative', margin: '0 auto 16px' }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid rgba(116,188,217,0.22)' }} />
          <div style={{ position: 'absolute', inset: '5px', borderRadius: '50%', background: 'linear-gradient(135deg, rgba(242,167,192,0.16), rgba(116,188,217,0.16))', border: '2.5px solid rgba(116,188,217,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CalculatorIcon size={20} color="#3a8dba" strokeWidth={2.2} />
          </div>
        </div>
        <h1 style={{ margin: '0 0 6px', fontSize: '1.7rem', fontWeight: 900, color: '#2d3748', fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
          GWA Calculator
        </h1>
        <p style={{ margin: 0, color: '#5c6b80', fontSize: '0.88rem' }}>Select your institution&apos;s grading scale to begin.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {([
          {
            scale: '4pt' as ScaleType, label: '4.0 is Highest', sub: 'US / International',
            summary: 'A (4.0) · B+ (3.5) · B (3.0) · C+ (2.5) · C (2.0) · D+ (1.5) · D (1.0) · F (0.5)',
            chips: SCALE_4PT_CHIPS, color: '#74bcd9', textColor: '#2a7fa8', chipColor: '#3a8dba', chipBg: 'rgba(116,188,217,0.15)',
          },
          {
            scale: '1pt' as ScaleType, label: '1.0 is Highest (5-point scale)', sub: 'Philippine Standard',
            summary: '1.00 (Excellent) → 1.25 → 1.50 → 1.75 → 2.00 → 2.25 → 2.50 → 2.75 → 3.00 (Passed) · Below 75% = 5.00 (Failed)',
            chips: SCALE_1PT_CHIPS, color: '#f2a7c0', textColor: '#c0607c', chipColor: '#c0607c', chipBg: 'rgba(242,167,192,0.15)',
          },
        ]).map(({ scale, label, sub, summary, chips, color, textColor, chipColor, chipBg }) => (
          <button key={scale} className="gwa-focusable" onClick={() => onSelect(scale)}
            style={{
              ...GLASS, padding: '20px 22px', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
              border: `2px solid ${color}55`,
            }}
          >
            <div style={{ fontSize: '1rem', fontWeight: 800, color: textColor, marginBottom: '2px' }}>{label}</div>
            <div style={{ fontSize: '0.73rem', fontWeight: 600, color: '#8a94a6', marginBottom: '8px' }}>{sub}</div>
            <div style={{ fontSize: '0.78rem', color: '#5c6b80', lineHeight: 1.5, marginBottom: '10px' }}>{summary}</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {chips.map(([range, val, desc]) => (
                <span key={val} style={{ background: chipBg, borderRadius: '6px', padding: '2px 8px', fontSize: '0.7rem', color: chipColor, fontWeight: 600 }}>
                  {range} → {val} ({desc})
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   Main Calculator
════════════════════════════════════════════ */

function Calculator({ scale, onBack }: { scale: ScaleType; onBack: () => void }) {
  const router = useRouter();

  const [rows, setRows]                   = useState<SubjectRow[]>([blank(), blank(), blank()]);
  const [periodData, setPeriodData]       = useState<PeriodData | null>(null);
  const [displayMode, setDisplayMode]     = useState<DisplayMode>('final');
  const [activePeriod, setActivePeriod]   = useState(0);
  const [showModeModal, setShowModeModal] = useState(false);

  const [scanning, setScanning]           = useState(false);
  const [scanProgress, setScanProgress]   = useState(0);
  const [scanMsg, setScanMsg]             = useState('');
  const [rawOcrText, setRawOcrText]       = useState('');
  const [exporting, setExporting]         = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const gradeMin = scale === '1pt' ? 0.75 : 0.0;
  const gradeMax = scale === '1pt' ? 5.00 : 4.0;

  /* ── Row helpers ── */
  const setField  = (id: number, f: keyof SubjectRow, v: string) => setRows(p => p.map(r => r.id === id ? { ...r, [f]: v, ...(f === 'name' ? { uncertain: false } : {}) } : r));
  const addRow    = () => setRows(p => [...p, blank()]);
  const removeRow = (id: number) => setRows(p => p.length > 1 ? p.filter(r => r.id !== id) : p);
  const clearAll  = () => { setRows([blank(), blank(), blank()]); setPeriodData(null); setDisplayMode('final'); setScanMsg(''); };

  /* ── Period switching ── */
  const switchToPeriod = useCallback((idx: number, data: PeriodData) => {
    setActivePeriod(idx);
    setRows(data.rows.map(r => ({ id: r.id, name: r.name, units: r.units, grade: r.grades[idx] ?? '', uncertain: r.uncertain })));
  }, []);

  const handleModeSelect = useCallback((mode: DisplayMode) => {
    setDisplayMode(mode);
    setShowModeModal(false);
    if (!periodData) return;
    if (mode === 'per-period') {
      switchToPeriod(0, periodData);
    } else {
      setRows(periodData.rows.map(r => ({ id: r.id, name: r.name, units: r.units, grade: [...r.grades].reverse().find(g => g !== '') ?? '', uncertain: r.uncertain })));
    }
  }, [periodData, switchToPeriod]);

  const handleDisplayToggle = useCallback((mode: DisplayMode) => {
    if (mode === displayMode || !periodData) return;
    handleModeSelect(mode);
  }, [displayMode, periodData, handleModeSelect]);

  /* ── GWA ── */
  const { gwa, totalUnits, validCount } = useMemo(() => {
    let sGU = 0, sU = 0, cnt = 0;
    for (const r of rows) {
      const u = parseFloat(r.units), g = parseFloat(r.grade);
      if (!isNaN(u) && u > 0 && !isNaN(g) && g >= gradeMin && g <= gradeMax) { sGU += g * u; sU += u; cnt++; }
    }
    return { gwa: sU > 0 ? sGU / sU : 0, totalUnits: sU, validCount: cnt };
  }, [rows, gradeMin, gradeMax]);

  const gwaDisplay  = gwa > 0 ? gwa.toFixed(2) : '—';
  const gwaColor_   = gwaColor(gwa, scale);
  const exportLabel = displayMode === 'per-period' && periodData ? periodData.periods[activePeriod] : 'Final Grade';
  const scaleLabel  = scale === '1pt' ? '1.0 Highest' : '4.0 Highest';

  /* ── Image pre-processing ──
     Two independent problems, handled independently:

     SIZE — below ~1400px on the longest edge, character glyphs are small
     enough that Tesseract's LSTM starts dropping and confusing characters
     even on an otherwise clean, high-contrast image (this is a well-known
     Tesseract limitation, not a contrast issue). A small image is upscaled
     regardless of file type or contrast.

     CONTRAST — a coloured table background (yellow, blue, etc.) has poor
     luminance separation between text and background in greyscale; the
     2nd–98th-percentile histogram is stretched to 0–255 so Tesseract's Otsu
     threshold finds a clean bimodal peak. Only applied when actually needed
     — rewriting colour on an already-clean image doesn't help and risks
     introducing artefacts.

     An image that is BOTH already large AND already high-contrast (the
     common case for a clean screenshot) skips all processing — any canvas
     round-trip, even probe-only, measurably shifts LSTM character
     confidences, so it's only worth the risk when something is actually
     wrong to fix. */
  const preprocessForOcr = useCallback(async (file: File): Promise<HTMLCanvasElement | File> => {
    const SMALL_EDGE  = 1400; // below this, glyphs are likely too small for reliable recognition
    const SMALL_TARGET = 2200; // upscale target for a small-but-clean image
    const LOW_CONTRAST_TARGET = 2400; // upscale target for a low-contrast image (existing tuning)

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      const url = URL.createObjectURL(file);
      el.onload = () => { URL.revokeObjectURL(url); resolve(el); };
      el.onerror = reject;
      el.src = url;
    });

    const srcW = img.naturalWidth;
    const srcH = img.naturalHeight;
    const longestEdge = Math.max(srcW, srcH);

    // PNG at adequate resolution: lossless screenshot, correct DPI already —
    // skip everything, exactly as before.
    if (file.type === 'image/png' && longestEdge >= SMALL_EDGE) return file;

    // ── Phase 1: probe contrast on native-size image ──
    const probe = document.createElement('canvas');
    probe.width = srcW; probe.height = srcH;
    const pc = probe.getContext('2d', { willReadFrequently: true })!;
    pc.drawImage(img, 0, 0);
    const pd = pc.getImageData(0, 0, srcW, srcH).data;
    const nn = srcW * srcH;

    const hist = new Int32Array(256);
    for (let i = 0; i < nn; i++) {
      const p = i * 4;
      hist[(0.299 * pd[p] + 0.587 * pd[p + 1] + 0.114 * pd[p + 2]) | 0]++;
    }
    let cum = 0, lo = 0, hi = 255;
    for (let t = 0; t < 256; t++) {
      cum += hist[t];
      if (cum < nn * 0.02) lo = t;
      if (cum < nn * 0.98) hi = t;
    }
    const contrastRange = hi - lo;
    const isLowContrast = contrastRange < 180;
    const isSmall       = longestEdge < SMALL_EDGE;

    // Already large and already high-contrast: nothing to fix.
    if (!isLowContrast && !isSmall) return file;

    const targetEdge = isLowContrast ? LOW_CONTRAST_TARGET : SMALL_TARGET;
    const sf = Math.max(1, Math.min(4, targetEdge / longestEdge));
    const w  = Math.round(srcW * sf);
    const h  = Math.round(srcH * sf);

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);

    // Only rewrite colour for genuinely low-contrast images — a small-but-
    // clean image just needs the upscale, not a grayscale/stretch pass.
    if (isLowContrast) {
      const imageData = ctx.getImageData(0, 0, w, h);
      const d = imageData.data;
      const n = w * h;
      const stretchRange = contrastRange || 1;
      for (let i = 0; i < n; i++) {
        const p = i * 4;
        const g = (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) | 0;
        const v = Math.min(255, Math.max(0, (((g - lo) / stretchRange) * 255) | 0));
        d[p] = d[p + 1] = d[p + 2] = v;
        d[p + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
    }

    return canvas;
  }, []);

  /* ── OCR ── */
  const handleScan = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanning(true); setScanProgress(0); setScanMsg('Enhancing image…');
    try {
      const processedCanvas = await preprocessForOcr(file);
      setScanMsg('Loading OCR engine…');
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng', 1, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'loading tesseract core')       setScanMsg('Loading Tesseract core…');
          if (m.status === 'loading language traineddata') setScanMsg('Loading language data…');
          if (m.status === 'recognizing text') {
            const p = Math.round(m.progress * 100);
            setScanProgress(p);
            setScanMsg(`Recognizing text… ${p}%`);
          }
        },
      });
      /* PSM 6 = assume a single uniform block — better for tables */
      await worker.setParameters({ tessedit_pageseg_mode: '6' } as Record<string, string>);
      const { data: { text } } = await worker.recognize(processedCanvas);
      await worker.terminate();
      setRawOcrText(text);
      const result = parseOcrText(text, scale);
      if (result.rows.length === 0) {
        setScanMsg('No subjects detected. Try a clearer image, or enter data manually.'); return;
      }
      setRows(result.rows); setPeriodData(result.periodData); setActivePeriod(0);
      if (result.periodData) {
        setDisplayMode('final'); setShowModeModal(true);
        setScanMsg(`Found ${result.periodData.rows.length} subject${result.periodData.rows.length !== 1 ? 's' : ''} across ${result.periodData.periods.length} periods.`);
      } else {
        setDisplayMode('final');
        setScanMsg(`Found ${result.rows.length} subject${result.rows.length !== 1 ? 's' : ''}. Review below.`);
      }
    } catch (err) {
      setScanMsg('OCR error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setScanning(false); setScanProgress(0); e.target.value = '';
    }
  }, [scale]);

  const scanSucceeded = scanMsg.startsWith('Found');

  /* ── VibeBoard-branded export HTML ── */
  /* Shared export HTML — used for both PNG and PDF so they look identical */
  const buildExportHtml = () => {
    const tableRows = rows.filter(r => r.name || r.grade);
    return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;background:#eef3fb;width:640px;border-radius:26px;overflow:hidden;box-shadow:0 26px 68px rgba(74,60,120,0.22);border:1px solid rgba(255,255,255,0.6);">

  <!-- Gradient header — the same pastel wash as the app's own background, not a saturated invention -->
  <div style="background:radial-gradient(circle at 28% 18%, rgba(255,255,255,0.5), transparent 55%), linear-gradient(135deg, #a6d8ff 0%, #ffcde1 38%, #c2e9fb 68%, #f9c5d1 100%);padding:44px 48px 40px;text-align:center;position:relative;">
    <div style="font-size:10px;line-height:1;font-weight:800;letter-spacing:0.16em;color:rgba(45,55,72,0.55);text-transform:uppercase;">
      VibeBoard
    </div>
    <div style="width:28px;height:1px;background:rgba(45,55,72,0.28);margin:8px auto 10px;"></div>
    <div style="font-size:11.5px;line-height:1;color:rgba(45,55,72,0.62);margin-bottom:26px;font-weight:600;letter-spacing:0.03em;">
      ${exportLabel} &nbsp;·&nbsp; ${scaleLabel}
    </div>

    <!-- Medallion, matching the live GWA card's ring treatment. Uses table/table-cell
         centering rather than flexbox — html2canvas renders flex vertical-centering
         unreliably, but table-cell vertical-align is rock solid. -->
    <div style="width:176px;height:176px;border-radius:50%;margin:0 auto 22px;position:relative;">
      <div style="position:absolute;inset:0;border-radius:50%;border:1.5px solid rgba(255,255,255,0.6);"></div>
      <div style="position:absolute;inset:9px;width:158px;height:158px;border-radius:50%;background:rgba(255,255,255,0.55);border:2.5px solid ${gwaColor_}66;box-shadow:0 12px 30px rgba(74,60,120,0.14);display:table;">
        <!-- padding-bottom (not top) biases table-cell "middle" upward: html2canvas
             consistently renders text lower than its CSS box implies, so the fix is
             a real box-model nudge, not a font/line-height tweak. -->
        <div style="display:table-cell;vertical-align:middle;text-align:center;padding-bottom:18px;">
          <div style="font-size:54px;line-height:1;font-weight:900;color:${gwaColor_};letter-spacing:-0.03em;font-variant-numeric:tabular-nums;">
            ${gwaDisplay}
          </div>
          <div style="margin-top:6px;font-size:9px;line-height:1;font-weight:800;letter-spacing:0.16em;color:#8a94a6;text-transform:uppercase;">
            GWA
          </div>
        </div>
      </div>
    </div>

    ${validCount > 0 ? `
    <div style="display:inline-block;background:rgba(255,255,255,0.55);border:1px solid rgba(255,255,255,0.75);border-radius:999px;padding:1px 24px 18px;font-size:12.5px;line-height:1;font-weight:700;color:#3a4258;letter-spacing:0.02em;">
      ${validCount}&nbsp;subject${validCount !== 1 ? 's' : ''}&nbsp;&nbsp;·&nbsp;&nbsp;${totalUnits}&nbsp;unit${totalUnits !== 1 ? 's' : ''}
    </div>` : ''}
  </div>

  <!-- Table: rule-line transcript treatment, no striping -->
  <div style="background:#ffffff;padding:34px 40px 38px;">
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
      <colgroup>
        <col style="width:54%;">
        <col style="width:23%;">
        <col style="width:23%;">
      </colgroup>
      <thead>
        <tr>
          <th style="text-align:left;vertical-align:middle;padding:0 0 12px;font-size:9px;line-height:1;font-weight:800;letter-spacing:0.12em;color:#a8779a;text-transform:uppercase;border-bottom:1.5px solid #2d3748;">Course Code</th>
          <th style="text-align:center;vertical-align:middle;padding:0 0 12px;font-size:9px;line-height:1;font-weight:800;letter-spacing:0.12em;color:#a8779a;text-transform:uppercase;border-bottom:1.5px solid #2d3748;">Units</th>
          <th style="text-align:center;vertical-align:middle;padding:0 0 12px;font-size:9px;line-height:1;font-weight:800;letter-spacing:0.12em;color:#a8779a;text-transform:uppercase;border-bottom:1.5px solid #2d3748;">Grade</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows.map(r => `
        <tr>
          <td style="text-align:left;vertical-align:middle;padding:7px 0 17px;font-size:14px;line-height:1;color:#1e293b;font-weight:700;border-bottom:1px solid #eef0f8;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">
            ${r.name || '—'}
          </td>
          <td style="text-align:center;vertical-align:middle;padding:7px 0 17px;font-size:15px;line-height:1;color:#5c6b80;font-weight:800;border-bottom:1px solid #eef0f8;font-variant-numeric:tabular-nums;">
            ${r.units || '—'}
          </td>
          <td style="text-align:center;vertical-align:middle;padding:7px 0 17px;font-size:15px;line-height:1;font-weight:800;color:${gwaColor_};border-bottom:1px solid #eef0f8;font-variant-numeric:tabular-nums;">
            ${r.grade || '—'}
          </td>
        </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr><td colspan="3" style="border-bottom:1.5px solid #2d3748;padding:0;"></td></tr>
      </tfoot>
    </table>
    <div style="text-align:center;margin-top:26px;font-size:9.5px;line-height:1;color:#c3cbe0;letter-spacing:0.1em;font-weight:600;text-transform:uppercase;">
      Generated by VibeBoard &nbsp;·&nbsp; GWA Calculator
    </div>
  </div>

</div>`;
  };

  /* Render the HTML off-screen and return a canvas */
  const renderExportCanvas = async () => {
    const { default: html2canvas } = await import('html2canvas');
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;left:-9999px;top:0;padding:20px;background:#eef3fb;';
    wrap.innerHTML = buildExportHtml();
    document.body.appendChild(wrap);
    const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: '#eef3fb', useCORS: true, logging: false });
    document.body.removeChild(wrap);
    return canvas;
  };

  const handleExportPng = useCallback(async () => {
    setExporting(true);
    try {
      const canvas = await renderExportCanvas();
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `gwa-${new Date().toISOString().split('T')[0]}.png`;
      a.click();
    } finally { setExporting(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gwa, gwaDisplay, gwaColor_, validCount, totalUnits, rows, exportLabel, scaleLabel]);

  const handleExportPdf = useCallback(async () => {
    setExporting(true);
    try {
      const canvas = await renderExportCanvas();
      const { jsPDF } = await import('jspdf');
      const imgData  = canvas.toDataURL('image/png');
      /* A4 = 210 × 297 mm; keep 10 mm margins each side */
      const pdfW  = 190;
      const pdfH  = (canvas.height * pdfW) / canvas.width;
      const doc   = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const xOff  = 10;
      const yOff  = (297 - pdfH) / 2; // centre vertically if content is short
      doc.addImage(imgData, 'PNG', xOff, Math.max(10, yOff), pdfW, pdfH);
      doc.save(`gwa-${new Date().toISOString().split('T')[0]}.pdf`);
    } finally { setExporting(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gwa, gwaDisplay, gwaColor_, validCount, totalUnits, rows, exportLabel, scaleLabel]);

  const gradeHint = scale === '1pt' ? '1.00 – 5.00' : '0.0 – 4.0';

  return (
    <>
      {showModeModal && periodData && <ModeModal periods={periodData.periods} onSelect={handleModeSelect} />}

      <style jsx>{`
        .gwa-focusable { transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, border-color 0.15s ease; }
        .gwa-focusable:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(31,38,68,0.1); }
        .gwa-focusable:active { transform: translateY(0) scale(0.98); }
        .gwa-focusable:focus-visible, .gwa-input:focus-visible {
          outline: 2px solid #74bcd9;
          outline-offset: 2px;
        }
        .gwa-input { transition: border-color 0.15s ease, background 0.15s ease; }
        .gwa-input:focus-visible { border-color: #74bcd9; }
        .gwa-icon-btn { transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease; cursor: pointer; }
        .gwa-icon-btn:hover:not(:disabled) { background: rgba(248,113,113,0.14); color: #dc2626; }
        .gwa-icon-btn:active:not(:disabled) { transform: scale(0.9); }
        .gwa-spin { animation: gwaSpin 0.9s linear infinite; }
        @keyframes gwaSpin { to { transform: rotate(360deg); } }
        .gwa-row {
          display: grid;
          grid-template-columns: minmax(120px, 1fr) 76px 108px 28px;
          gap: 8px;
          align-items: center;
        }
        @media (prefers-reduced-motion: reduce) {
          .gwa-focusable, .gwa-input, .gwa-icon-btn { transition-duration: 1ms !important; }
          .gwa-focusable:hover { transform: none; }
          .gwa-spin { animation: none; }
        }
      `}</style>

      <div style={{ maxWidth: '760px', margin: '0 auto' }}>

        {/* ── Top nav ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '22px', flexWrap: 'wrap' }}>
          <button onClick={onBack} className="gwa-focusable" style={{ ...BTN, background: 'rgba(255,255,255,0.5)', color: '#5c6b80', border: '1px solid rgba(200,210,230,0.45)' }}>
            <ArrowLeft size={14} /> Scale
          </button>
          <button onClick={() => router.push('/studypulse')} className="gwa-focusable" style={{ ...BTN, background: 'rgba(255,255,255,0.5)', color: '#5c6b80', border: '1px solid rgba(200,210,230,0.45)' }}>
            <Home size={14} /> Home
          </button>
          <div style={{ flex: 1 }} />
          <div style={{ background: scale === '1pt' ? 'linear-gradient(to right,#f2a7c0,#e88aa8)' : 'linear-gradient(to right,#74bcd9,#4dabf5)', color: 'white', borderRadius: '999px', padding: '5px 16px', fontSize: '0.75rem', fontWeight: 700, boxShadow: '0 2px 8px rgba(31,38,68,0.12)' }}>
            {scaleLabel}
          </div>
        </div>

        {/* ── GWA Card — echoes the export's medallion, so the live view and the download feel like one thing ── */}
        <div style={{ ...GLASS, padding: '24px 28px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '26px', flexWrap: 'wrap' }}>
          <div style={{ width: '124px', height: '124px', borderRadius: '50%', position: 'relative', flexShrink: 0 }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid rgba(116,188,217,0.22)' }} />
            <div style={{
              position: 'absolute', inset: '7px', borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(242,167,192,0.16), rgba(116,188,217,0.16))',
              border: `2.5px solid ${gwaColor_}4d`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{ fontSize: '2rem', fontWeight: 900, color: gwaColor_, lineHeight: 1 }}>{gwaDisplay}</div>
              <div style={{ marginTop: '4px', fontSize: '0.56rem', fontWeight: 800, letterSpacing: '0.1em', color: '#8a94a6', textTransform: 'uppercase' }}>GWA</div>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: '200px' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#8a94a6', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '4px' }}>General Weighted Average</div>
            {periodData && (
              <div style={{ fontSize: '0.8rem', color: '#74bcd9', fontWeight: 700, marginBottom: '4px' }}>{exportLabel}</div>
            )}
            {validCount > 0 && (
              <div style={{ fontSize: '0.82rem', color: '#5c6b80', fontWeight: 500 }}>
                {validCount} subject{validCount !== 1 ? 's' : ''} &nbsp;·&nbsp; {totalUnits} unit{totalUnits !== 1 ? 's' : ''}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleExportPng} disabled={exporting || validCount === 0} className="gwa-focusable"
              style={{ ...BTN, background: 'rgba(116,188,217,0.12)', color: '#2a7fa8', border: '1.5px solid rgba(116,188,217,0.35)', opacity: exporting || validCount === 0 ? 0.45 : 1, cursor: exporting || validCount === 0 ? 'default' : 'pointer' }}>
              {exporting ? <Loader2 size={14} className="gwa-spin" /> : <ImageIcon size={14} />} PNG
            </button>
            <button onClick={handleExportPdf} disabled={exporting || validCount === 0} className="gwa-focusable"
              style={{ ...BTN, background: 'rgba(242,167,192,0.14)', color: '#c0607c', border: '1.5px solid rgba(242,167,192,0.4)', opacity: exporting || validCount === 0 ? 0.45 : 1, cursor: exporting || validCount === 0 ? 'default' : 'pointer' }}>
              {exporting ? <Loader2 size={14} className="gwa-spin" /> : <FileText size={14} />} PDF
            </button>
          </div>
        </div>

        {/* ── Subject Table ── */}
        <div style={{ ...GLASS, padding: '20px 22px', marginBottom: '14px' }}>
          <div className="gwa-row" style={{ padding: '0 2px 10px', borderBottom: '1px solid rgba(200,210,230,0.3)', marginBottom: '10px' }}>
            <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#8a94a6', letterSpacing: '.07em' }}>COURSE CODE / SUBJECT</div>
            <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#8a94a6', letterSpacing: '.07em', textAlign: 'center' }}>UNITS</div>
            <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#8a94a6', letterSpacing: '.07em', textAlign: 'center' }}>GRADE</div>
            <div />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
            {rows.map(r => {
              const g = parseFloat(r.grade), u = parseFloat(r.units);
              const valid    = !isNaN(g) && g >= gradeMin && g <= gradeMax && !isNaN(u) && u > 0;
              const badGrade = r.grade !== '' && (isNaN(g) || g < gradeMin || g > gradeMax);
              return (
                <div key={r.id} className="gwa-row">
                  <div style={{ position: 'relative' }}>
                    <input className="gwa-input" style={{ ...INPUT, paddingRight: r.uncertain ? '30px' : undefined, borderColor: r.uncertain ? '#fbbf24' : undefined }}
                      placeholder="e.g. CS0027" value={r.name} onChange={e => setField(r.id, 'name', e.target.value)} />
                    {r.uncertain && (
                      <span title="OCR couldn't read this name cleanly — double-check it against the original image."
                        style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', display: 'flex', color: '#d97706', pointerEvents: 'none' }}>
                        <TriangleAlert size={14} />
                      </span>
                    )}
                  </div>
                  <input className="gwa-input" style={{ ...INPUT, textAlign: 'center' }} placeholder="3" type="number" min={0.5} max={12} step={0.5} value={r.units} onChange={e => setField(r.id, 'units', e.target.value)} />
                  <input className="gwa-input" style={{ ...INPUT, textAlign: 'center', borderColor: badGrade ? '#fca5a5' : 'rgba(200,210,230,0.5)', background: valid ? 'rgba(220,252,231,0.55)' : badGrade ? 'rgba(254,226,226,0.55)' : 'rgba(255,255,255,0.82)' }}
                    placeholder={gradeHint} type="number" min={gradeMin} max={gradeMax} step={0.01}
                    value={r.grade} onChange={e => setField(r.id, 'grade', e.target.value)} />
                  <button onClick={() => removeRow(r.id)} disabled={rows.length === 1} aria-label="Remove subject" title="Remove subject"
                    className="gwa-icon-btn" style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: rows.length === 1 ? '#d8dee8' : '#94a3b8', flexShrink: 0 }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
            <button onClick={addRow} className="gwa-focusable"
              style={{ ...BTN, background: 'rgba(116,188,217,0.1)', color: '#2a7fa8', border: '1.5px dashed rgba(116,188,217,0.4)', flexGrow: 1, justifyContent: 'center' }}>
              <Plus size={14} /> Add Subject
            </button>
            <button onClick={clearAll} className="gwa-focusable"
              style={{ ...BTN, background: 'rgba(248,113,113,0.08)', color: '#dc2626', border: '1px solid rgba(248,113,113,0.28)' }}>
              Clear
            </button>
          </div>
        </div>

        {/* ── Scan Section ── */}
        <div style={{ ...GLASS, padding: '20px 22px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '180px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontWeight: 700, fontSize: '0.88rem', color: '#2d3748', marginBottom: '3px' }}>
                <Camera size={15} color="#a78bfa" strokeWidth={2.3} />
                Scan grade report
              </div>
              <div style={{ fontSize: '0.73rem', color: '#8a94a6', lineHeight: 1.4 }}>Upload a photo or screenshot — course codes, units &amp; grades are extracted automatically. Multi-period tables are detected.</div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleScan} />
            <button onClick={() => fileRef.current?.click()} disabled={scanning} className="gwa-focusable"
              style={{ ...BTN, background: scanning ? 'rgba(200,210,230,0.35)' : 'linear-gradient(135deg,#a78bfa,#74bcd9)', color: scanning ? '#8a94a6' : 'white', border: 'none', boxShadow: scanning ? 'none' : '0 4px 12px rgba(116,188,217,0.35)', cursor: scanning ? 'wait' : 'pointer' }}>
              {scanning ? <Loader2 size={14} className="gwa-spin" /> : <FolderOpen size={14} />}
              {scanning ? 'Scanning…' : 'Choose Image'}
            </button>
          </div>

          {/* Progress */}
          {(scanning || scanMsg) && (
            <div style={{ marginTop: '14px' }}>
              {scanning && (
                <div style={{ height: '5px', background: 'rgba(200,210,230,0.3)', borderRadius: '999px', overflow: 'hidden', marginBottom: '6px' }}>
                  <div style={{ height: '100%', width: `${scanProgress}%`, background: 'linear-gradient(to right,#f2a7c0,#a78bfa,#74bcd9)', borderRadius: '999px', transition: 'width 0.25s ease' }} />
                </div>
              )}
              <div style={{ fontSize: '0.77rem', color: scanSucceeded ? '#16a34a' : '#64748b', fontWeight: 500 }}>{scanMsg}</div>
            </div>
          )}

          {/* ── Raw OCR debug panel ── */}
          {rawOcrText && (
            <details style={{ marginTop: '12px' }}>
              <summary style={{ fontSize: '0.72rem', fontWeight: 600, color: '#8a94a6', cursor: 'pointer', userSelect: 'none' }}>
                Raw OCR text (debug)
              </summary>
              <pre style={{ marginTop: '8px', padding: '10px 12px', background: 'rgba(0,0,0,0.04)', borderRadius: '8px', fontSize: '0.68rem', color: '#475569', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '260px', overflowY: 'auto', lineHeight: 1.6 }}>
                {rawOcrText}
              </pre>
            </details>
          )}

        </div>

        {/* ── View Toggle (below scan, only when multi-period data exists) ── */}
        {periodData && (
          <div style={{ ...GLASS, padding: '14px 18px', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#8a94a6', marginRight: '4px' }}>View:</span>
              {(['final', 'per-period'] as DisplayMode[]).map(m => (
                <button key={m} onClick={() => handleDisplayToggle(m)} className="gwa-focusable"
                  style={{ ...BTN, padding: '6px 16px', background: displayMode === m ? 'rgba(255,255,255,0.9)' : 'transparent', border: displayMode === m ? '1px solid rgba(200,210,230,0.55)' : '1px solid transparent', color: displayMode === m ? '#2d3748' : '#8a94a6', boxShadow: displayMode === m ? '0 2px 8px rgba(31,38,68,0.08)' : 'none', fontSize: '0.8rem' }}>
                  {m === 'final' ? <GraduationCap size={13} /> : <CalendarDays size={13} />}
                  {m === 'final' ? 'Final Grade' : 'Per Period'}
                </button>
              ))}

              {/* Period tabs */}
              {displayMode === 'per-period' && (
                <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto', flexWrap: 'wrap' }}>
                  {periodData.periods.map((p, i) => (
                    <button key={i} onClick={() => switchToPeriod(i, periodData)} className="gwa-focusable"
                      style={{ ...BTN, padding: '5px 14px', fontSize: '0.75rem', background: activePeriod === i ? 'linear-gradient(to right,#f2a7c0,#74bcd9)' : 'rgba(255,255,255,0.5)', color: activePeriod === i ? 'white' : '#64748b', border: 'none', boxShadow: activePeriod === i ? '0 2px 8px rgba(116,188,217,0.3)' : 'none' }}>
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <p style={{ textAlign: 'center', fontSize: '0.72rem', color: '#8a94a6', margin: '4px 0 0' }}>
          Out-of-range or empty rows are excluded from GWA. Always review scanned entries — OCR accuracy depends on image quality.
        </p>
      </div>
    </>
  );
}

/* ════════════════════════════════════════════
   Root
════════════════════════════════════════════ */

export default function GwaCalculator() {
  const [scale, setScale] = useState<ScaleType | null>(null);

  return (
    <div className="vb-bg" style={{ minHeight: '100vh', padding: '44px 5% 72px', fontFamily: "'Inter','DM Sans','Segoe UI',sans-serif", color: '#2d3748' }}>
      {scale === null
        ? <ScaleSelect onSelect={setScale} />
        : <Calculator scale={scale} onBack={() => setScale(null)} />
      }
    </div>
  );
}
