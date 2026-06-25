import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { instalarSelectOnFocusMonto } from './shared/lib/selectOnFocus';
import { instalarRecuperacionChunks } from './shared/lib/lazyReload';
import { instalarMayusculaAutomatica } from './shared/lib/autoUpper';
import { instalarPreviewPdf } from './shared/lib/reportPreview';
import './styles/index.css';

// Al enfocar un campo numérico que muestra 0, selecciona el 0 para reemplazarlo.
instalarSelectOnFocusMonto();
// Ante un chunk borrado por un despliegue nuevo, recarga sola (no pantalla negra).
instalarRecuperacionChunks();
// Todos los campos de texto del sistema se escriben en MAYÚSCULA automáticamente.
instalarMayusculaAutomatica();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
);

// Reportes: en vez de descargar directo, muestran una vista previa (PDF embebido).
// El parche carga jsPDF (~600 kB); se instala en tiempo OCIOSO tras el primer
// render para no competir con los recursos críticos del arranque. La preview ya
// está lista mucho antes de que el usuario pueda navegar y generar un reporte.
const instalarEnOcio = () => { void instalarPreviewPdf(); };
type IdleWin = Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
const w = window as IdleWin;
if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(instalarEnOcio, { timeout: 3000 });
else setTimeout(instalarEnOcio, 1500);
