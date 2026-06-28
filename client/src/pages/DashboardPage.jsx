import { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { api, formatTime, formatDate, formatDuration } from '../api';

function SessionChart({ dailySessions }) {
  const chartData = dailySessions.map((d) => ({
    date: new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
    sessions: d.count,
  }));

  if (chartData.length === 0) {
    return (
      <p className="text-gray-400 text-sm py-4 text-center">No sessions in the last 30 days</p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="sessions" fill="#003087" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function StudentRow({ student, timezone }) {
  const [expanded, setExpanded] = useState(false);
  const [sessions, setSessions] = useState(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (!expanded && !sessions) {
      setLoading(true);
      try {
        const data = await api.getStudentSessions(student.id);
        setSessions(data.sessions);
      } catch {
        setSessions([]);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  }

  const { stats } = student;

  return (
    <>
      <tr
        className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${
          stats.isRegular ? 'bg-blue-50/50' : ''
        }`}
        onClick={toggle}
      >
        <td className="px-4 py-3 font-medium text-gray-900">
          <div className="flex items-center gap-2">
            {student.name}
            {stats.isRegular && (
              <span className="text-xs bg-kumon-blue text-white px-2 py-0.5 rounded-full">
                Regular
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-gray-600 text-center">{stats.totalVisits}</td>
        <td className="px-4 py-3 text-gray-600 text-center">
          {formatDuration(stats.avgDurationMinutes)}
        </td>
        <td className="px-4 py-3 text-gray-600">
          {stats.lastVisit ? formatDate(stats.lastVisit, timezone) : '—'}
        </td>
        <td className="px-4 py-3 text-gray-400 text-center">
          {expanded ? '▲' : '▼'}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className="px-4 py-4 bg-gray-50">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold text-sm text-gray-700 mb-3">
                  Session History
                </h4>
                {loading ? (
                  <p className="text-gray-400 text-sm">Loading...</p>
                ) : sessions?.length === 0 ? (
                  <p className="text-gray-400 text-sm">No sessions yet</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {sessions?.map((s) => (
                      <div
                        key={s.id}
                        className="flex justify-between text-sm bg-white rounded-lg px-3 py-2 border border-gray-100"
                      >
                        <span className="text-gray-600">
                          {formatTime(s.check_in_time, timezone)}
                        </span>
                        <span className="text-gray-400">
                          {s.check_out_time
                            ? formatDuration(s.duration_minutes)
                            : 'In progress'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4 className="font-semibold text-sm text-gray-700 mb-3">
                  Sessions — Last 30 Days
                </h4>
                <SessionChart dailySessions={student.dailySessions || []} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getDashboard()
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = data?.students.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-gray-400">Loading dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  const { summary, timezone } = data;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Dashboard</h2>
        <p className="text-gray-500 text-sm">
          Attendance overview · {timezone}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="card text-center">
          <p className="text-3xl font-bold text-kumon-blue">
            {summary.totalActiveStudents}
          </p>
          <p className="text-gray-500 text-sm mt-1">Active Students</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-kumon-blue">
            {summary.totalSessionsToday}
          </p>
          <p className="text-gray-500 text-sm mt-1">Sessions Today</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-green-600">
            {summary.currentlyCheckedIn}
          </p>
          <p className="text-gray-500 text-sm mt-1">Currently Here</p>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <h3 className="font-semibold text-gray-900">All Students</h3>
          <input
            type="search"
            placeholder="Search students..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-kumon-blue/30"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium text-center">Visits</th>
                <th className="px-4 py-2 font-medium text-center">Avg. Duration</th>
                <th className="px-4 py-2 font-medium">Last Visit</th>
                <th className="px-4 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filtered?.map((student) => (
                <StudentRow
                  key={student.id}
                  student={student}
                  timezone={timezone}
                />
              ))}
              {filtered?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    No students found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
