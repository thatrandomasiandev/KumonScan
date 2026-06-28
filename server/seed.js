import db from './db.js';
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

const insertStudent = db.prepare(
  `INSERT INTO students (first_name, last_name, qr_code_value, registered_at)
   VALUES (?, ?, ?, datetime('now'))`
);

const existing = db.prepare('SELECT COUNT(*) as count FROM students').get();

if (existing.count > 0) {
  console.log(`Database already has ${existing.count} students. Skipping seed.`);
} else {
  const insertMany = db.transaction((students) => {
    for (const name of students) {
      const { first_name, last_name } = splitFullName(name);
      insertStudent.run(
        first_name,
        last_name,
        `KUMON-${uuidv4().slice(0, 8).toUpperCase()}`
      );
    }
  });

  insertMany(sampleStudents);
  console.log(`Seeded ${sampleStudents.length} students.`);
}

db.close();
