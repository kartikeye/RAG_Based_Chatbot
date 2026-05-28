// src/auth/AuthContext.tsx
//
// Auth state via React Context.
//
// Why Context (not Redux/Zustand)?
//   Auth is read in many places (nav, every protected page, the API client)
//   and written in very few (login, signup, logout). Context handles that
//   read-heavy + write-rare pattern cleanly with no extra dependency.
//
// What lives here:
//   - user: { id, email } | null
//   - token: string | null
//   - login(email, password) / signup(email, password) / logout()
//
// The token persists in localStorage so a page refresh doesn't kick the user
// out. We read it once at mount; we don't decode the JWT client-side.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, getStoredToken, setStoredToken } from '../api/client';
import type { AuthUser } from '../api/types';

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Lazily read the persisted user from localStorage on first render.
// Storing just the token is enough for auth — we cache the user for nav display.
const USER_KEY = 'rag.user';

function readStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function writeStoredUser(user: AuthUser | null): void {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [user, setUser] = useState<AuthUser | null>(() => readStoredUser());

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    setStoredToken(res.token);
    writeStoredUser(res.user);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const signup = useCallback(async (email: string, password: string) => {
    const res = await api.signup(email, password);
    setStoredToken(res.token);
    writeStoredUser(res.user);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    setStoredToken(null);
    writeStoredUser(null);
    setToken(null);
    setUser(null);
  }, []);

  // Memoize the value object so consumers don't re-render every parent render.
  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: !!token,
      login,
      signup,
      logout,
    }),
    [user, token, login, signup, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
