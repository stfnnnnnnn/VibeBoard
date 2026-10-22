#!/usr/bin/env node
// Workboard + Finance style gate (Workboard spec §18 step 4, Finance spec §4.6).
// Rules: no hex literals outside the token files, nothing under 12px (except 11px uppercase 800 labels),
// no plain "ease" timing, no transitions on layout properties, no 3px side stripes (Workboard refine spec §3).
import { existsSync, readFileSync } from 'node:fs';

const ALLOW_HEX = [/workboard\.css$/, /lib[\\/]workboard[\\/]color\.ts$/, /lib[\\/]workboard[\\/]ui[\\/]tokens\.ts$/, /finance[\\/]finance\.css$/, /lib[\\/]finance[\\/]ui[\\/]colors\.ts$/, /studypulse[\\/]studypulse\.css$/, /lib[\\/]studypulse[\\/]ui[\\/]colors\.ts$/];
const files = process.argv.slice(2);
if (files.length === 0) { console.error('usage: wb-style-gate.mjs <files...>'); process.exit(2); }

const rules = [
  { id: 'hex-literal', test: (l, f) => !ALLOW_HEX.some(r => r.test(f)) && /#[0-9a-fA-F]{3,8}\b/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l) },
  { id: 'small-type-rem', test: l => { const m = l.match(/font-?size['"]?\s*[:=]\s*['"]?(0?\.\d+)rem/i); return m && parseFloat(m[1]) < 0.75; } },
  { id: 'small-type-px', test: l => {
      const m = l.match(/font-?size['"]?\s*[:=]\s*['"]?(\d+(?:\.\d+)?)px/i);
      if (!m) return false;
      const px = parseFloat(m[1]);
      if (px >= 12) return false;
      return !(px === 11 && /wb-fs-11|text-?transform|uppercase/i.test(l));
    } },
  { id: 'plain-ease', test: l => /transition[^;\n]*\bease(?!-)/.test(l) && !/var\(--(wb|sp)-ease/.test(l) },
  { id: 'layout-transition', test: l => /transition[^;\n]*\b(width|height|flex-grow|flex-basis|top|left|right|bottom|margin|padding)\b/.test(l) && !/grid-template-rows/.test(l) },
  // Refine spec §3: no coloured 3px side stripes. The error toast and the palette's selection marker are exempt.
  { id: 'side-stripe', test: l =>
      /inset\s+[23]px\s+0\s+0|border-?(left|top)['"]?\s*[:=]\s*['"`]?\s*3px|border(Left|Top):\s*`3px/i.test(l)
      && !/wb-toast--error|wb-pal__row/.test(l) },
];

let failures = 0;
let checked = 0;
for (const file of files) {
  // `git ls-files -m` lists deleted files too; skip them rather than crash.
  if (!existsSync(file)) { console.log(`skipped (missing): ${file}`); continue; }
  checked++;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of rules) {
      if (rule.test(line, file)) {
        failures++;
        console.log(`${file}:${i + 1}: ${rule.id}: ${line.trim().slice(0, 140)}`);
      }
    }
  });
}
if (failures) { console.log(`\n${failures} style-gate violation(s).`); process.exit(1); }
console.log(`style gate clean (${checked} file(s)).`);
