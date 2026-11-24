// src/auth/ProtectedRoute.tsx
//
// Route guard. Wrap any route element that requires authentication;
// unauthenticated users are redirected to /login.
//
// Why use Navigate component vs useEffect + navigate()?
//   <Navigate> declaratively replaces the route in a single render.
//   useEffect would render the protected page once and then redirect,
//   which can flash a logged-in screen to a logged-out user.

import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    // Pass the attempted location in state so login can redirect back.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}
