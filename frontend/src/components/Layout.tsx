import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <nav className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4">
        <Link to="/documents" className="text-lg font-semibold text-slate-900">
          RAG Chatbot
        </Link>
        <div className="flex items-center gap-4">
          <NavLink
            to="/documents"
            className={({ isActive }) =>
              `text-sm font-medium ${isActive ? 'text-indigo-600' : 'text-slate-600 hover:text-slate-900'}`
            }
          >
            Documents
          </NavLink>
          <NavLink
            to="/chat"
            className={({ isActive }) =>
              `text-sm font-medium ${isActive ? 'text-indigo-600' : 'text-slate-600 hover:text-slate-900'}`
            }
          >
            Chat
          </NavLink>
          <span className="text-sm text-slate-500 hidden sm:inline">{user?.email}</span>
          <button
            type="button"
            onClick={logout}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            Log out
          </button>
        </div>
      </nav>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
