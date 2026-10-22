#!/usr/bin/env node
// Finance unit tests without a test framework (plan ruling R7). Transpiles src/lib/finance/**/*.ts
// with the project's own TypeScript into a temp dir, then runs node:test on the *.test files.
// Usage: node scripts/fin-test.mjs [substring-filter]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const ROOT = 'src/lib/finance';
const out = mkdtempSync(join(tmpdir(), 'fin-test-'));
const walk = d => readdirSync(d).flatMap(n => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.ts') ? [p] : []);
});

const tests = [];
// *Server.ts files import the DB pool and are never unit-tested here.
for (const file of walk(ROOT).filter(f => !f.endsWith('Server.ts'))) {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  // Relative specifiers get the .mjs extension Node's ESM loader needs.
  const js = outputText.replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, '$1$2.mjs$3');
  const dest = join(out, relative(ROOT, file)).replace(/\.ts$/, '.mjs');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, js);
  if (file.endsWith('.test.ts')) tests.push(dest);
}

const filter = process.argv[2];
const selected = filter ? tests.filter(t => t.includes(filter)) : tests;
if (selected.length === 0) { console.error('no finance tests matched'); process.exit(1); }
const r = spawnSync(process.execPath, ['--test', ...selected], { stdio: 'inherit' });
process.exit(r.status ?? 1);
