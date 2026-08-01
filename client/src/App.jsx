import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import ScanPage from './pages/ScanPage';
import DeskPage from './pages/DeskPage';
import DashboardPage from './pages/DashboardPage';
import AdminPage from './pages/AdminPage';
import RegisterPage from './pages/RegisterPage';
import ParentApp from './parent/ParentApp';

export default function App() {
  return (
    <Routes>
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/family/*" element={<ParentApp />} />
      <Route
        path="/*"
        element={
          <Layout>
            <Routes>
              <Route path="/" element={<ScanPage />} />
              <Route
                path="/desk"
                element={
                  <ProtectedRoute>
                    <DeskPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <DashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute>
                    <AdminPage />
                  </ProtectedRoute>
                }
              />
            </Routes>
          </Layout>
        }
      />
    </Routes>
  );
}
