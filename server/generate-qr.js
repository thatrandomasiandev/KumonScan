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
  const students = await db.prepare('SELECT * FROM students WHERE active = 1').all();

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
