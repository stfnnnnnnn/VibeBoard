#!/usr/bin/env node
// Auth + email pure-lib tests. Same approach as scripts/sp-test.mjs: transpile pool-free modules with the
// project's TypeScript into a temp dir and run node:test on *.test.ts.
// Usage: node scripts/auth-test.mjs [substring-filter]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { join, relative, dirname, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const ROOT = 'src/lib';
// Only pure modules (no DB pool, no next/*, no node_modules imports) plus their tests.
const INCLUDE = /^(auth\/(__tests__\/[\w-]+\.test|daypart|validate|tokens|limits|lockout|emailTypo|passwordStrength)|email\/templates)\.ts$/;
const out = mkdtempSync(join(tmpdir(), 'auth-test-'));
const walk = d => readdirSync(d).flatMap(n => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.ts') ? [p] : []);
});

const tests = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (!INCLUDE.test(rel)) continue;
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const fromDir = posix.dirname(rel);
  const js = outputText
    .replace(/(from\s+['"])@\/lib\/([^'"]+)(['"])/g, (_, a, p, b) => {
      let r = posix.relative(fromDir, p);
      if (!r.startsWith('.')) r = './' + r;
      return `${a}${r}${b}`;
    })
    .replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, '$1$2.mjs$3');
  const dest = join(out, rel).replace(/\.ts$/, '.mjs');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, js);
  if (file.endsWith('.test.ts')) tests.push(dest);
}

const filter = process.argv[2];
const selected = filter ? tests.filter(t => t.includes(filter)) : tests;
if (selected.length === 0) { console.error('no auth tests matched'); process.exit(1); }
const r = spawnSync(process.execPath, ['--test', ...selected], { stdio: 'inherit' });
process.exit(r.status ?? 1);
