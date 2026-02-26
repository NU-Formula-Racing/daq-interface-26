import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { BrowserRouter } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SessionProvider } from './context/SessionContext';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Analytics />
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
)
