import '@fontsource-variable/outfit';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker : appli installable et utilisable hors-ligne. Mise à jour silencieuse
// (aucune donnée de progression n'est touchée : elle vit dans IndexedDB).
registerSW({ immediate: true });
