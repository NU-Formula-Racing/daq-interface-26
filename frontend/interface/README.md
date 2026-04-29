# nfrInterface website

The marketing / landing site for the nfrInterface desktop app. Deployed at https://nfrinterface.com (Vercel).

Built with Vite + React 19 + framer-motion. Not the same as the desktop app's frontend (that lives in `app/`).

## Pages

- `/` — landing page. Hero, two cards (Live and Replay) that act as session entry points, and a link down to the desktop-app page.
- `/app` — editorial "field guide" page about the desktop app, with a mini animated dashboard demo and a Download button that points at the latest GitHub release.
- `/dashboard`, `/replay`, `/graphs` — the public read-only views that show data pulled from Supabase (when the team broadcasts a session).

## Local development

```
npm install
npm run dev
```

Opens on http://localhost:5173. Changes hot-reload.

## Building

```
npm run build
```

Output is in `dist/`. Vercel runs this automatically on every push to `main`.

## Notes

- Path alias: `@/` → `./src/` (configured in `vite.config.js`).
- Fonts loaded from Google Fonts in `index.html`: JetBrains Mono, DM Sans, Instrument Sans, Instrument Serif, Space Grotesk.
- The animated `FRWindow` demo on `/app` is a self-contained mock dashboard at `src/components/FRWindow.jsx` — it does not talk to any real backend.
