import { useEffect, useState } from 'react';
import { api } from '../api';

export default function ProtectedRoute({ children }) {
  const [status, setStatus] = useState({ loading: true, authenticated: false, protectionEnabled: false });
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function checkAuth() {
    try {
      const data = await api.getAuthStatus();
      setStatus({ loading: false, authenticated: data.authenticated, protectionEnabled: data.protectionEnabled });
    } catch {
      setStatus({ loading: false, authenticated: false, protectionEnabled: true });
    }
  }

  useEffect(() => {
    checkAuth();
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await api.login(password);
      setPassword('');
      await checkAuth();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (status.loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-gray-400">Checking access...</p>
      </div>
    );
  }

  if (status.authenticated) {
    return children;
  }

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="card">
        <h2 className="text-xl font-bold text-gray-900 mb-1">Admin Access Required</h2>
        <p className="text-gray-500 text-sm mb-6">
          Enter the admin password to continue.
        </p>

        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin password"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-kumon-blue/30"
            autoComplete="current-password"
            required
          />

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 text-sm">
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
