import db, { sqlNow } from './db.js';
import { v4 as uuidv4 } from 'uuid';
import { splitFullName } from './utils/names.js';

const sampleStudents = [
  'Emma Johnson',
  'Liam Chen',
  'Sophia Martinez',
  'Noah Williams',
  'Olivia Davis',
  'Ethan Kim',
  'Ava Thompson',
  'Mason Rodriguez',
];

async function main() {
  const insertStudent = db.prepare(
    `INSERT INTO students (first_name, last_name, qr_code_value, registered_at)
     VALUES (?, ?, ?, ?)`
  );

  const existing = await db.prepare('SELECT COUNT(*) as count FROM students').get();

  if (existing.count > 0) {
    console.log(`Database already has ${existing.count} students. Skipping seed.`);
  } else {
    for (const name of sampleStudents) {
      const { first_name, last_name } = splitFullName(name);
      await insertStudent.run(
        first_name,
        last_name,
        `KUMON-${uuidv4().slice(0, 8).toUpperCase()}`,
        sqlNow()
      );
    }
    console.log(`Seeded ${sampleStudents.length} students.`);
  }

  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
