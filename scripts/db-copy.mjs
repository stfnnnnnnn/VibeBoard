#!/usr/bin/env node
// Copies every table (schema + rows) from one MySQL-compatible database to another, e.g. Aiven -> TiDB.
// Triggers are deliberately not copied: their rule lives in src/lib/studypulse/entryStatus.ts now.
// The source is only read. The target must be empty unless --drop is passed (drops each table first).
// Usage:
//   node scripts/db-copy.mjs <source-url> <target-url> [--src-ca file.pem] [--dst-ca file.pem] [--drop]
//   URLs look like mysql://user:password@host:port/database (URL-encode special characters in the password).
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const srcCa = flag('--src-ca');
const dstCa = flag('--dst-ca');
const drop = args.includes('--drop');
const [srcUrl, dstUrl] = args.filter((a) => a !== '--drop');
if (!srcUrl || !dstUrl) {
  console.error('Usage: node scripts/db-copy.mjs <source-url> <target-url> [--src-ca file] [--dst-ca file] [--drop]');
  process.exit(1);
}

// dateStrings keeps DATE/DATETIME values byte-for-byte; letting them become JS Dates would shift them by timezone.
const connect = (uri, ca) => mysql.createConnection({
  uri, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
  ssl: ca ? { ca: readFileSync(ca, 'utf8'), rejectUnauthorized: true } : undefined,
});
const BATCH = 500;

const src = await connect(srcUrl, srcCa);
const dst = await connect(dstUrl, dstCa);
try {
  // Plain sql_mode so SHOW CREATE TABLE quotes names with backticks (Aiven defaults to ANSI_QUOTES).
  // The target is non-strict for this session only, so rows the source already holds copy as-is
  // (e.g. legacy '' enum values imported from the old XAMPP dump) instead of being rejected.
  await src.query("SET SESSION sql_mode = ''");
  await dst.query("SET SESSION sql_mode = ''");
  await dst.query('SET FOREIGN_KEY_CHECKS = 0');
  const [tables] = await src.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
  const names = tables.map((r) => Object.values(r)[0]);

  for (const t of names) {
    const [[{ 'Create Table': ddl }]] = await src.query('SHOW CREATE TABLE ??', [t]);
    if (drop) await dst.query('DROP TABLE IF EXISTS ??', [t]);
    await dst.query(ddl);

    const [rows, fields] = await src.query({ sql: 'SELECT * FROM ??', values: [t], rowsAsArray: true });
    const cols = fields.map((f) => f.name);
    for (let i = 0; i < rows.length; i += BATCH) {
      await dst.query('INSERT INTO ?? (??) VALUES ?', [t, cols, rows.slice(i, i + BATCH)]);
    }
    const [[{ n }]] = await dst.query('SELECT COUNT(*) AS n FROM ??', [t]);
    if (Number(n) !== rows.length) throw new Error(`${t}: copied ${rows.length} rows but target has ${n}`);
    console.log(`${t.padEnd(36)} ${rows.length} rows`);
  }
  await dst.query('SET FOREIGN_KEY_CHECKS = 1');
  console.log(`\nDone: ${names.length} tables copied, row counts verified.`);
} finally {
  await src.end();
  await dst.end();
}
