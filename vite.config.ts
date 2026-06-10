import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { execSync } from 'node:child_process';

// Identificador de versión del build = hash corto del commit de main desplegado.
// Se hornea en el cliente (import.meta.env.VITE_APP_VERSION) y se emite en
// `version.json`. El cliente compara ambos para detectar un despliegue real.
function appVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return `b${Date.now()}`; // fallback si no hay git disponible en el build
  }
}
const APP_VERSION = appVersion();

// Plugin que escribe dist/version.json al construir (lo sirve nginx).
const versionJsonPlugin = {
  name: 'mgg-version-json',
  generateBundle() {
    // @ts-expect-error this.emitFile existe en el contexto de Rollup
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: APP_VERSION }) });
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
