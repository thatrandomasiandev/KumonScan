import db from './db.js';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { formatFullName } from './utils/names.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, 'qr-codes');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

async function main() {
  // Default to the original center; pass a slug as argv[2] for another center.
  const slug = process.argv[2] || null;
  const students = slug
    ? await db
        .prepare(
          `SELECT s.* FROM students s
           JOIN centers c ON c.id = s.center_id
           WHERE c.slug = ? AND s.active = 1`
        )
        .all(slug)
    : await db
        .prepare(
          `SELECT * FROM students
           WHERE center_id = (SELECT id FROM centers ORDER BY id ASC LIMIT 1)
             AND active = 1`
        )
        .all();

  console.log(`Generating QR codes for ${students.length} students...\n`);

  for (const student of students) {
    const fullName = formatFullName(student);
    const filename = path.join(
      outputDir,
      `${fullName.replace(/\s+/g, '_')}_${student.qr_code_value}.png`
    );
    await QRCode.toFile(filename, student.qr_code_value, {
      width: 400,
      margin: 2,
      color: { dark: '#003087', light: '#ffffff' },
    });
    console.log(`  ✓ ${fullName} → ${student.qr_code_value}`);
  }

  console.log(`\nQR codes saved to ${outputDir}/`);
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
