import { useEffect } from 'react';
import { Navigate, Routes, Route, useParams } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import ScanPage from './pages/ScanPage';
import DeskPage from './pages/DeskPage';
import DashboardPage from './pages/DashboardPage';
import AdminPage from './pages/AdminPage';
import RegisterPage from './pages/RegisterPage';
import MessagesPanel from './components/MessagesPanel';
import InsightsPage from './pages/InsightsPage'; // agent-7-insights
import BookingPage from './pages/BookingPage'; // agent-3-self-scheduling
import StatusPage from './pages/StatusPage'; // agent-observability
import ParentApp from './parent/ParentApp'; // agent-13-parent-pwa
import { setCenterSlug } from './api';
import { DEFAULT_CENTER_SLUG } from './centerPath';

/**
 * Sync the URL's :centerSlug into the API client so every request hits
 * /api/c/:centerSlug/... for the center the user is browsing.
 */
function CenterScope({ children }) {
  const { centerSlug } = useParams();
  useEffect(() => {
    setCenterSlug(centerSlug);
  }, [centerSlug]);
  return children;
}

function CenterRoutes() {
  return (
    <CenterScope>
      <Routes>
        <Route path="register" element={<RegisterPage />} />
        {/* agent-3-self-scheduling: public parent booking, outside the staff shell */}
        <Route path="book" element={<BookingPage />} />
        <Route
          path="*"
          element={
            <Layout>
              <Routes>
                <Route index element={<ScanPage />} />
                <Route
                  path="desk"
                  element={
                    <ProtectedRoute>
                      <DeskPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="dashboard"
                  element={
                    <ProtectedRoute>
                      <DashboardPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="messages"
                  element={
                    <ProtectedRoute>
                      <MessagesPanel />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="insights"
                  element={
                    <ProtectedRoute>
                      <InsightsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="admin"
                  element={
                    <ProtectedRoute>
                      <AdminPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="status"
                  element={
                    <ProtectedRoute>
                      <StatusPage />
                    </ProtectedRoute>
                  }
                />
              </Routes>
            </Layout>
          }
        />
      </Routes>
    </CenterScope>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Legacy unprefixed URLs land on the original (seeded) center. */}
      <Route path="/" element={<Navigate to={`/${DEFAULT_CENTER_SLUG}`} replace />} />
      <Route path="/register" element={<Navigate to={`/${DEFAULT_CENTER_SLUG}/register`} replace />} />
      <Route path="/desk" element={<Navigate to={`/${DEFAULT_CENTER_SLUG}/desk`} replace />} />
      {/* agent-13-parent-pwa: parent PWA, global (magic-link auth carries the
          student's tenancy; parentApi talks to the unslugged default-center API). */}
      <Route path="/family/*" element={<ParentApp />} />
      <Route
        path="/dashboard"
        element={<Navigate to={`/${DEFAULT_CENTER_SLUG}/dashboard`} replace />}
      />
      <Route
        path="/messages"
        element={<Navigate to={`/${DEFAULT_CENTER_SLUG}/messages`} replace />}
      />
      <Route
        path="/insights"
        element={<Navigate to={`/${DEFAULT_CENTER_SLUG}/insights`} replace />}
      />
      <Route path="/admin" element={<Navigate to={`/${DEFAULT_CENTER_SLUG}/admin`} replace />} />
      <Route path="/book" element={<Navigate to={`/${DEFAULT_CENTER_SLUG}/book`} replace />} />
      <Route path="/status" element={<Navigate to={`/${DEFAULT_CENTER_SLUG}/status`} replace />} />

      <Route path="/:centerSlug/*" element={<CenterRoutes />} />
    </Routes>
  );
}
