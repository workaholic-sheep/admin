import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import TrackPage from './TrackPage.jsx';
import './styles.css';

// Client tracking links (/track/<token>) open a public page without the admin login.
const trackMatch = window.location.pathname.match(/^\/track\/([A-Za-z0-9_-]+)\/?$/);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {trackMatch ? <TrackPage token={trackMatch[1]} /> : <App />}
  </React.StrictMode>,
);
