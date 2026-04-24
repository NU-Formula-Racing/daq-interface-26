import { createBrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { Placeholder } from './pages/Placeholder.tsx';
import Live from './pages/Live.tsx';
import Sessions from './pages/Sessions.tsx';
import Replay from './pages/Replay.tsx';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Live /> },
      { path: 'sessions', element: <Sessions /> },
      { path: 'sessions/:id', element: <Replay /> },
      { path: 'settings', element: <Placeholder title="Settings" /> },
    ],
  },
]);
