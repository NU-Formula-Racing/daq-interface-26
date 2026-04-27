import { useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { apiGet } from './api/client.ts';

interface CatalogResponse {
  active: string | null;
  entries: Array<{ name: string; path: string; reachable: boolean }>;
}

export default function App() {
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    if (loc.pathname === '/setup' || loc.pathname === '/storage-setup') return;

    // Check for an active database first; if there isn't one, redirect to
    // the storage-setup picker. The /api/db/catalog endpoint may not exist
    // on older servers, so failures fall through to the legacy setup flow.
    let cancelled = false;
    apiGet<CatalogResponse>('/api/db/catalog')
      .then((cat) => {
        if (cancelled) return;
        if (cat.active === null) {
          nav('/storage-setup', { replace: true });
          return;
        }
        // Active DB known; verify backend is reachable.
        apiGet<{ pg: string }>('/api/setup/status')
          .then((s) => {
            if (cancelled) return;
            if (s.pg !== 'ok') nav('/setup', { replace: true });
          })
          .catch(() => {
            if (!cancelled) nav('/setup', { replace: true });
          });
      })
      .catch(() => {
        if (cancelled) return;
        // Catalog endpoint missing — fall back to legacy setup-status check.
        apiGet<{ pg: string }>('/api/setup/status')
          .then((s) => {
            if (cancelled) return;
            if (s.pg !== 'ok') nav('/setup', { replace: true });
          })
          .catch(() => {
            if (!cancelled) nav('/setup', { replace: true });
          });
      });

    return () => {
      cancelled = true;
    };
  }, [loc.pathname, nav]);

  return (
    <div className="h-full flex flex-col">
      <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </main>
    </div>
  );
}
