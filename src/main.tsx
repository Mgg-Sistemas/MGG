import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { instalarSelectOnFocusMonto } from './shared/lib/selectOnFocus';
import { instalarRecuperacionChunks } from './shared/lib/lazyReload';
import './styles/index.css';

// Al enfocar un campo numérico que muestra 0, selecciona el 0 para reemplazarlo.
instalarSelectOnFocusMonto();
// Ante un chunk borrado por un despliegue nuevo, recarga sola (no pantalla negra).
instalarRecuperacionChunks();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
);
