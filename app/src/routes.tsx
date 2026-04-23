import { createBrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { Placeholder } from './pages/Placeholder.tsx';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Placeholder title="Live dashboard" /> },
      { path: 'sessions', element: <Placeholder title="Sessions" /> },
      { path: 'sessions/:id', element: <Placeholder title="Replay" /> },
      { path: 'settings', element: <Placeholder title="Settings" /> },
    ],
  },
]);
