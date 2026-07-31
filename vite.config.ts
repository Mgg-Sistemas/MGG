import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Hash del commit desplegado. Se hornea (import.meta.env.VITE_APP_VERSION) y se
// guarda en version.json solo como referencia de soporte ("¿en qué commit estoy?").
// NO se usa para avisar de actualización: eso lo decide la huella del bundle.
function appVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return `b${Date.now()}`; // fallback si no hay git disponible en el build
  }
}
const APP_VERSION = appVersion();

// Plugin que escribe dist/version.json al construir (lo sirve nginx).
// La "versión" es una HUELLA del contenido servido: los nombres de los .js/.css,
// que ya llevan hash de contenido de Vite. Si el bundle no cambió (p.ej. un commit
// que solo toca el manual o el SQL), la huella es idéntica y NO se avisa nada.
// Solo cuando cambia el JS/CSS que corre el navegador, la huella cambia → aviso.
const versionJsonPlugin = {
  name: 'mgg-version-json',
  generateBundle(_options: unknown, bundle: Record<string, unknown>) {
    const files = Object.keys(bundle).filter((f) => /\.(js|css)$/.test(f)).sort();
    const fingerprint = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
    // @ts-expect-error this.emitFile existe en el contexto de Rollup
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: fingerprint, commit: APP_VERSION }) });
  },
};

export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.VITE_BASE_PATH ?? '/proyecto/') : '/',
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
  },
  plugins: [react(), versionJsonPlugin],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  // Pre-bundla jspdf/autotable al arrancar el dev server. Sin esto, Vite los
  // re-optimiza al vuelo y crea OTRA instancia del módulo, perdiendo el parche
  // de vista previa (instalarPreviewPdf) → el PDF se baja directo en vez de
  // mostrarse en el visor. Fijarlos mantiene una sola instancia estable.
  optimizeDeps: {
    include: ['jspdf', 'jspdf-autotable', 'xlsx-js-style'],
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Vendors estables en chunks separados: se cachean entre deploys y
        // se descargan en paralelo, en vez de re-bajar ~400kB ante cada cambio.
        manualChunks(id) {
          // El helper de precarga de Vite (__vitePreload) lo usa el entry; si cae
          // en el chunk 'pdf', el entry lo importa estático y precarga ~200kB de
          // jsPDF en el arranque. Lo fijamos en 'react' (siempre presente).
          if (id.includes('preload-helper') || id.includes('modulepreload')) return 'react';
          if (!id.includes('node_modules')) return;
          if (id.includes('@supabase')) return 'supabase';
          if (id.includes('react-router') || id.includes('/history/')) return 'router';
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('/scheduler/')) return 'react';
          // Librerías pesadas que solo se cargan bajo demanda (PDF/Excel/captura):
          // nombre de chunk estable → el navegador conserva la caché entre deploys.
          if (id.includes('jspdf') || id.includes('/canvg/') || id.includes('dompurify')) return 'pdf';
          if (id.includes('xlsx')) return 'xlsx';
          if (id.includes('html2canvas')) return 'html2canvas';
        },
      },
    },
  },
}));
