import { useEffect } from 'react';
import { Navigate, Routes, Route, useParams } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import DeskPage from './pages/DeskPage';
import DashboardPage from './pages/DashboardPage';
import AdminPage from './pages/AdminPage';
import InsightsPage from './pages/InsightsPage'; // agent-7-insights
import StatusPage from './pages/StatusPage'; // agent-observability
import { setCenterSlug } from './api';
import { DEFAULT_CENTER_SLUG, centerPath } from './centerPath';

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

/** Old /register URLs land on Desk, where registration now lives. */
function RegisterToDeskRedirect() {
  const { centerSlug } = useParams();
  return <Navigate to={centerPath(centerSlug, '/desk')} replace />;
}

function CenterRoutes() {
  return (
    <CenterScope>
      <Routes>
        {/* Registration lives on Desk; keep old URLs working. */}
        <Route path="register" element={<RegisterToDeskRedirect />} />
        <Route
          path="*"
          element={
            <Layout>
              <Routes>
                <Route index element={<Navigate to="desk" replace />} />
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
      <Route path="/register" element={<Navigate to={`/${DEFAULT_CENTER_SLUG}/desk`} replace />} />
      <Route path="/desk" element={<Navigate to={`/${DEFAULT_CENTER_SLUG}/desk`} replace />} />
      <Route
        path="/dashboard"
        element={<Navigate to={`/${DEFAULT_CENTER_SLUG}/dashboard`} replace />}
      />
      <Route
        path="/insights"
        element={<Navigate to={`/${DEFAULT_CENTER_SLUG}/insights`} replace />}
      />
      <Route path="/admin" element={<Navigate to={`/${DEFAULT_CENTER_SLUG}/admin`} replace />} />
      <Route path="/status" element={<Navigate to={`/${DEFAULT_CENTER_SLUG}/status`} replace />} />

      <Route path="/:centerSlug/*" element={<CenterRoutes />} />
    </Routes>
  );
}
