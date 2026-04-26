import { useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { apiGet } from './api/client.ts';

export default function App() {
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    if (loc.pathname === '/setup') return;
    apiGet<{ pg: string }>('/api/setup/status')
      .then((s) => {
        if (s.pg !== 'ok') nav('/setup', { replace: true });
      })
      .catch(() => {
        nav('/setup', { replace: true });
      });
  }, [loc.pathname, nav]);

  return (
    <div className="h-full flex flex-col">
      <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </main>
    </div>
  );
}
