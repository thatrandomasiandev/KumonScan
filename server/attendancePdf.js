import PDFDocument from 'pdfkit';

/**
 * Build an attendance report PDF buffer from buildAttendanceReport() output.
 */
export function attendanceReportToPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'LETTER' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const title =
      report.period === 'annual'
        ? 'KumonScan attendance — rolling 12 months'
        : 'KumonScan attendance — monthly';

    doc.fontSize(16).text(title, { underline: false });
    doc.moveDown(0.4);
    doc
      .fontSize(10)
      .fillColor('#333333')
      .text(`Period: ${report.start_date} → ${report.end_date}`)
      .text(`Timezone: ${report.timezone}`)
      .text(
        `Summary: ${report.summary.total_visits} visits · ${report.summary.total_minutes} min · ${report.summary.overtime_sessions} overtime sessions`
      );
    doc.moveDown(0.8);

    const rows = (report.students || []).filter((s) => s.visits > 0 || s.active);
    const col = { name: 48, visits: 280, minutes: 340, ot: 420 };

    doc.fontSize(9).fillColor('#000000').font('Helvetica-Bold');
    doc.text('Student', col.name, doc.y, { continued: false });
    const headerY = doc.y - 11;
    doc.text('Visits', col.visits, headerY);
    doc.text('Minutes', col.minutes, headerY);
    doc.text('Overtime', col.ot, headerY);
    doc.moveDown(0.3);
    doc
      .strokeColor('#cccccc')
      .moveTo(48, doc.y)
      .lineTo(564, doc.y)
      .stroke();
    doc.moveDown(0.4);
    doc.font('Helvetica').fillColor('#111111');

    for (const row of rows) {
      if (doc.y > 720) {
        doc.addPage();
        doc.font('Helvetica').fontSize(9);
      }
      const y = doc.y;
      doc.text(row.name || `${row.first_name} ${row.last_name}`, col.name, y, {
        width: 220,
        ellipsis: true,
      });
      const lineY = y;
      doc.text(String(row.visits), col.visits, lineY);
      doc.text(String(row.total_minutes), col.minutes, lineY);
      doc.text(String(row.overtime_count), col.ot, lineY);
      doc.moveDown(0.35);
    }

    if (rows.length === 0) {
      doc.text('No students with visits in this period.');
    }

    doc.end();
  });
}
