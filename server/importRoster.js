/**
 * importRoster.js — Upsert students from a CSV/TSV file into the KumonScan database.
 *
 * Usage:
 *   npm run import-roster -- ./roster.tsv          (from server/)
 *   node importRoster.js ./roster.tsv
 */

import fs from 'fs';
import path from 'path';
import { importRosterFromContent } from './rosterImport.js';
import db from './db.js';

const csvPath = process.argv[2];

if (!csvPath) {
  console.error('Usage: node importRoster.js <path-to-csv-or-tsv>');
  console.error('Example: node importRoster.js ./roster.tsv');
  process.exit(1);
}

const resolvedPath = path.resolve(csvPath);

if (!fs.existsSync(resolvedPath)) {
  console.error(`File not found: ${resolvedPath}`);
  process.exit(1);
}

let result;
try {
  const content = fs.readFileSync(resolvedPath, 'utf8');
  result = importRosterFromContent(content);
} catch (err) {
  console.error(`Roster import failed: ${err.message}`);
  process.exit(1);
}

const { totalProcessed, delimiterLabel, summary } = result;
const anomalies = summary.skipped.length + summary.errored.length;

console.log(`Detected delimiter: ${delimiterLabel}`);
console.log('');
console.log('─────────────────────────────────────');
console.log('  KumonScan roster import complete');
console.log('─────────────────────────────────────');
console.log(`  Rows processed : ${totalProcessed}`);
console.log(`  Created        : ${summary.created}`);
console.log(`  Updated        : ${summary.updated}`);
console.log(`  Skipped        : ${summary.skipped.length}`);
console.log(`  Errored        : ${summary.errored.length}`);
console.log('─────────────────────────────────────');

if (summary.skipped.length > 0) {
  console.log('');
  console.log('Skipped rows:');
  for (const { row, reason } of summary.skipped) {
    console.log(`  ${row}: ${reason}`);
  }
}

if (summary.errored.length > 0) {
  console.log('');
  console.log('Errored rows:');
  for (const { row, error } of summary.errored) {
    console.log(`  ${row}: ${error}`);
  }
}

if (anomalies === 0) {
  console.log('  No anomalies.');
}

console.log('');

db.close();
