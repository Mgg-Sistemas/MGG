import { Component, lazy, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';

/* ============================================================
   Recuperación ante "chunk faltante" tras un despliegue.
   El sitio se carga por partes (lazy). Cuando se redespliega,
   los chunks viejos se borran; una pestaña que aún pide un chunk
   viejo recibe 404 → "Failed to fetch dynamically imported module".
   Sin red de seguridad eso deja la pantalla en negro.
   Solución: ante ese fallo, recargar UNA sola vez (toma el
   index.html y los chunks frescos). Un guard evita bucles de
   recarga si el error es real y persiste.
   ============================================================ */

const RELOAD_FLAG = 'mgg.chunkReload';
const VENTANA_MS = 20_000; // si recargamos hace <20s, no insistir (evita loop)

function recargoReciente(): boolean {
  try {
    const t = Number(sessionStorage.getItem(RELOAD_FLAG) || '0');
    return Date.now() - t < VENTANA_MS;
  } catch {
    return false;
  }
}

function marcarRecarga(): void {
  try {
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    /* sessionStorage no disponible: igual intentamos recargar */
  }
}

/** Recarga una sola vez ante un chunk inexistente. Devuelve true si disparó la recarga. */
export function recargarPorChunkFaltante(): boolean {
  if (recargoReciente()) return false; // ya veníamos de una recarga: no insistir
  marcarRecarga();
  window.location.reload();
  return true;
}

/** ¿El error parece un chunk dinámico que ya no existe (deploy nuevo)?
 *  Solo mensajes específicos de import dinámico; NO "Failed to fetch" a secas,
 *  que también lo lanza un parpadeo de red de Supabase (evitamos recargas falsas). */
function esErrorDeChunk(err: unknown): boolean {
  const msg = String((err as Error)?.message || err || '');
  return (
    /dynamically imported module/i.test(msg) ||  // Chrome / Firefox
    /Importing a module script failed/i.test(msg) ||  // Safari
    /error loading dynamically imported module/i.test(msg) ||
    /ChunkLoadError/i.test(msg) ||
    /Loading chunk \d+ failed/i.test(msg)
  );
}

/**
 * lazy() endurecido. Si el import dinámico falla porque el chunk fue borrado por
 * un despliegue nuevo, recarga la página una sola vez para tomar el index.html y
 * los chunks frescos. Si ya recargamos hace poco (error real), propaga el error
 * para que lo muestre el ChunkErrorBoundary.
 */
export function lazyReload<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      if (esErrorDeChunk(err) && recargarPorChunkFaltante()) {
        // La página se está recargando: devolvemos una promesa que nunca resuelve.
        return await new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}

/** Registra los listeners globales que recargan ante un fallo de carga de chunk. */
export function instalarRecuperacionChunks(): void {
  // Vite emite este evento cuando falla la precarga de un módulo dinámico.
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault();
    recargarPorChunkFaltante();
  });
  // Rechazo de promesa no atrapado que sea un chunk faltante (red de seguridad extra).
  window.addEventListener('unhandledrejection', (e) => {
    if (esErrorDeChunk(e.reason)) recargarPorChunkFaltante();
  });
}

/* ───────────── Última red: error boundary ─────────────
   Si pese a todo una vista falla (y ya no podemos recargar por el guard),
   mostramos un aviso claro con botón de recargar, NUNCA pantalla negra. */

interface BoundaryProps { children: ReactNode; }
interface BoundaryState { fallo: boolean; }

export class ChunkErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { fallo: false };

  static getDerivedStateFromError(): BoundaryState {
    return { fallo: true };
  }

  componentDidCatch(err: unknown): void {
    // Si es un chunk faltante, intentamos la recarga automática una vez.
    if (esErrorDeChunk(err)) recargarPorChunkFaltante();
  }

  render(): ReactNode {
    if (!this.state.fallo) return this.props.children;
    return (
      <div className="card" style={{ padding: '2rem', maxWidth: 520, margin: '2rem auto', textAlign: 'center' }}>
        <h2 style={{ marginTop: 0 }}>Actualizando el sistema…</h2>
        <p className="muted">
          Se publicó una versión nueva. Recargá la página para continuar; tus datos guardados no se pierden.
        </p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          Recargar ahora
        </button>
      </div>
    );
  }
}
