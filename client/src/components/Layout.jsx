import { Link, useLocation } from 'react-router-dom';
import BrandMark from './BrandMark';

const navItems = [
  { path: '/', label: 'Scan' },
  { path: '/register', label: 'Register' },
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/admin', label: 'Admin' },
];

function NavLink({ path, label, mobile = false }) {
  const location = useLocation();
  const active = location.pathname === path;

  if (mobile) {
    return (
      <Link
        to={path}
        className={active ? 'nav-link-mobile-active' : 'nav-link-mobile-inactive'}
      >
        <NavIcon path={path} active={active} />
        {label}
      </Link>
    );
  }

  return (
    <Link
      to={path}
      className={active ? 'nav-link-active' : 'nav-link-inactive'}
    >
      {label}
    </Link>
  );
}

function NavIcon({ path, active }) {
  const className = `w-5 h-5 ${active ? 'text-kumon-blue' : 'text-slate-400'}`;

  switch (path) {
    case '/':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    case '/register':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0" />
        </svg>
      );
    case '/dashboard':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      );
    case '/admin':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    default:
      return null;
  }
}

export default function Layout({ children }) {
  return (
    <div className="min-h-screen flex flex-col bg-kumon-light">
      <header className="bg-kumon-blue text-white shadow-md relative">
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-kumon-red" aria-hidden="true" />
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <BrandMark subtitle="Attendance" compact />
          <nav className="hidden md:flex gap-1">
            {navItems.map(({ path, label }) => (
              <NavLink key={path} path={path} label={label} />
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 shadow-nav z-40">
        <div className="flex items-center justify-around px-2 py-1.5 safe-area-pb">
          {navItems.map(({ path, label }) => (
            <NavLink key={path} path={path} label={label} mobile />
          ))}
        </div>
      </nav>
    </div>
  );
}
