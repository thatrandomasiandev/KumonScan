import db from './db.js';

/** Demo / test students to soft-deactivate. Joshua Terranova is intentionally omitted. */
const SEED_NAMES = [
  ['Emma', 'Johnson'],
  ['Liam', 'Chen'],
  ['Sophia', 'Martinez'],
  ['Noah', 'Williams'],
  ['Olivia', 'Davis'],
  ['Ethan', 'Kim'],
  ['Ava', 'Thompson'],
  ['Mason', 'Rodriguez'],
  ['Test', 'Student'],
  ['New', 'Student'],
  ['Devon', 'Williams'],
];

const findByName = db.prepare(
  `SELECT id, first_name, last_name, active
   FROM students
   WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)`
);

const deactivate = db.prepare(`UPDATE students SET active = 0 WHERE id = ? AND active = 1`);

const summary = { deactivated: [], already_inactive: [], not_found: [] };

for (const [first, last] of SEED_NAMES) {
  const row = findByName.get(first, last);
  if (!row) {
    summary.not_found.push(`${first} ${last}`);
    continue;
  }

  const label = `${row.id} ${row.first_name} ${row.last_name}`;
  if (!row.active) {
    summary.already_inactive.push(label);
    continue;
  }

  deactivate.run(row.id);
  summary.deactivated.push(label);
  console.log(`Deactivated: ${label}`);
}

console.log('\nCleanup summary:');
console.log(`  deactivated: ${summary.deactivated.length}`);
console.log(`  already_inactive: ${summary.already_inactive.length}`);
console.log(`  not_found: ${summary.not_found.length}`);
if (summary.not_found.length) {
  console.log(`  missing: ${summary.not_found.join(', ')}`);
}

db.close();
