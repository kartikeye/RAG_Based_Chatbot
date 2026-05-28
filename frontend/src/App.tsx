import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { ProtectedRoute } from './auth/ProtectedRoute';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Documents from './pages/Documents';
import Chat from './pages/Chat';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/documents" element={<Documents />} />
        <Route path="/chat" element={<Chat />} />
      </Route>

      <Route path="/" element={<Navigate to="/documents" replace />} />
      <Route path="*" element={<Navigate to="/documents" replace />} />
    </Routes>
  );
}
