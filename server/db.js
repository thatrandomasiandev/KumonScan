import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'kumonscan.db');

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function getStudentColumns() {
  return db.prepare('PRAGMA table_info(students)').all().map((col) => col.name);
}

function migrateStudentsTable() {
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='students'")
    .get();

  if (!tableExists) {
    db.exec(`
      CREATE TABLE students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        qr_code_value TEXT NOT NULL UNIQUE,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        registered_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    return;
  }

  const columns = getStudentColumns();

  if (columns.includes('name') && !columns.includes('first_name')) {
    db.pragma('foreign_keys = OFF');
    db.exec('DROP TABLE IF EXISTS students_new');

    db.exec(`
      CREATE TABLE students_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        qr_code_value TEXT NOT NULL UNIQUE,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        registered_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const students = db.prepare('SELECT * FROM students').all();
    const insert = db.prepare(`
      INSERT INTO students_new (id, first_name, last_name, qr_code_value, active, created_at, registered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const migrateAll = db.transaction((rows) => {
      for (const student of rows) {
        const parts = student.name.trim().split(/\s+/);
        const first_name = parts[0] || 'Unknown';
        const last_name = parts.slice(1).join(' ') || 'Student';
        insert.run(
          student.id,
          first_name,
          last_name,
          student.qr_code_value,
          student.active,
          student.created_at,
          student.created_at
        );
      }
    });

    migrateAll(students);
    db.exec('DROP TABLE students');
    db.exec('ALTER TABLE students_new RENAME TO students');
    db.pragma('foreign_keys = ON');
  } else if (!columns.includes('first_name')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        qr_code_value TEXT NOT NULL UNIQUE,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        registered_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  const updatedColumns = getStudentColumns();
  if (updatedColumns.includes('first_name') && !updatedColumns.includes('registered_at')) {
    db.exec(`
      ALTER TABLE students
      ADD COLUMN registered_at TEXT NOT NULL DEFAULT (datetime('now'))
    `);
  }
}

migrateStudentsTable();

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    check_in_time TEXT NOT NULL,
    check_out_time TEXT,
    duration_minutes REAL,
    FOREIGN KEY (student_id) REFERENCES students(id)
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_student_id ON sessions(student_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_check_in ON sessions(check_in_time);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_students_name_ci
    ON students(LOWER(first_name), LOWER(last_name));
`);

export default db;
