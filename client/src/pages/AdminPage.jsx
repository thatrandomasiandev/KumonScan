import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, formatTime, formatDuration } from '../api';

function elapsedMinutes(checkInTime) {
  return Math.max(0, Math.round((Date.now() - new Date(checkInTime).getTime()) / 60000));
}

function CurrentlyHere({ present, timezone }) {
  const { students, count } = present;

  return (
    <div className="card mb-8 border-l-4 border-l-green-500">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">Currently Here</h3>
          <p className="text-gray-500 text-sm">Students checked in right now</p>
        </div>
        <span className="text-2xl font-bold text-green-600 tabular-nums">{count}</span>
      </div>

      {students.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-4">No students checked in</p>
      ) : (
        <div className="space-y-2">
          {students.map((student) => (
            <div
              key={student.session_id}
              className="flex items-center justify-between p-3 rounded-lg border border-green-100 bg-green-50/50"
            >
              <div>
                <p className="font-medium text-gray-900">{student.name}</p>
                <p className="text-xs text-gray-500">
                  Checked in {formatTime(student.check_in_time, timezone)}
                </p>
              </div>
              <span className="text-sm font-medium text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
                {formatDuration(elapsedMinutes(student.check_in_time))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QRDisplay({ student, onClose }) {
  const [qrDataUrl, setQrDataUrl] = useState(null);

  useEffect(() => {
    QRCode.toDataURL(student.qr_code_value, {
      width: 256,
      margin: 2,
      color: { dark: '#003087', light: '#ffffff' },
    }).then(setQrDataUrl);
  }, [student.qr_code_value]);

  function downloadQR() {
    const link = document.createElement('a');
    link.download = `${student.name.replace(/\s+/g, '_')}_QR.png`;
    link.href = qrDataUrl;
    link.click();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="card max-w-sm w-full text-center">
        <h3 className="text-lg font-bold text-gray-900 mb-1">{student.name}</h3>
        <p className="text-gray-400 text-xs mb-4 font-mono">{student.qr_code_value}</p>
        {qrDataUrl ? (
          <img src={qrDataUrl} alt={`QR code for ${student.name}`} className="mx-auto mb-4" />
        ) : (
          <div className="w-64 h-64 bg-gray-100 mx-auto mb-4 rounded-lg animate-pulse" />
        )}
        <div className="flex gap-3 justify-center">
          <button onClick={downloadQR} className="btn-primary" disabled={!qrDataUrl}>
            Download QR
          </button>
          <button onClick={onClose} className="btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [students, setStudents] = useState([]);
  const [present, setPresent] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [newStudent, setNewStudent] = useState(null);
  const [qrStudent, setQrStudent] = useState(null);

  async function loadData() {
    try {
      const [studentsData, presentData] = await Promise.all([
        api.getStudents(),
        api.getPresent(),
      ]);
      setStudents(studentsData);
      setPresent(presentData);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const student = await api.createStudent(firstName.trim(), lastName.trim());
      setNewStudent(student);
      setQrStudent(student);
      setFirstName('');
      setLastName('');
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate(id) {
    if (!confirm('Deactivate this student? Their QR code will no longer work.')) return;

    try {
      await api.deactivateStudent(id);
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Student Management</h2>
        <p className="text-gray-500 text-sm">Add students and manage QR codes</p>
      </div>

      {present && (
        <CurrentlyHere present={present} timezone={present.timezone} />
      )}

      <div className="card mb-8">
        <h3 className="font-semibold text-gray-900 mb-4">Add New Student</h3>
        <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 gap-3">
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="First name"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-kumon-blue/30"
            required
          />
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Last name"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-kumon-blue/30"
            required
          />
          <button
            type="submit"
            className="btn-primary whitespace-nowrap sm:col-span-2"
            disabled={submitting}
          >
            {submitting ? 'Adding...' : 'Add Student'}
          </button>
        </form>
        {newStudent && (
          <p className="text-green-600 text-sm mt-3">
            ✓ {newStudent.name} added successfully — QR code displayed below
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-6">
          {error}
        </div>
      )}

      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-4">
          All Students ({students.length})
        </h3>
        <div className="space-y-2">
          {students.map((student) => (
            <div
              key={student.id}
              className={`flex items-center justify-between p-3 rounded-lg border ${
                student.active
                  ? 'border-gray-100 bg-white'
                  : 'border-gray-100 bg-gray-50 opacity-60'
              }`}
            >
              <div>
                <p className="font-medium text-gray-900">{student.name}</p>
                <p className="text-xs text-gray-400 font-mono">{student.qr_code_value}</p>
              </div>
              <div className="flex gap-2">
                {student.active && (
                  <>
                    <button
                      onClick={() => setQrStudent(student)}
                      className="text-sm text-kumon-blue hover:underline"
                    >
                      View QR
                    </button>
                    <button
                      onClick={() => handleDeactivate(student.id)}
                      className="text-sm text-red-500 hover:underline"
                    >
                      Deactivate
                    </button>
                  </>
                )}
                {!student.active && (
                  <span className="text-xs text-gray-400">Inactive</span>
                )}
              </div>
            </div>
          ))}
          {students.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-6">No students yet</p>
          )}
        </div>
      </div>

      {qrStudent && (
        <QRDisplay student={qrStudent} onClose={() => setQrStudent(null)} />
      )}
    </div>
  );
}
