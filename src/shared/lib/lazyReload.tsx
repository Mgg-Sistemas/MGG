import { Component, lazy, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import { recargaDura } from './recargaDura';

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
  // Dura, no `reload()`: un reload común puede volver a servir el index.html de
  // la caché, y ese index pide los chunks que el despliegue acaba de borrar.
  // Ahí la recarga no arregla nada y el aviso se queda pegado.
  recargaDura();
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
interface BoundaryState { fallo: boolean; esChunk: boolean; mensaje: string }

export class ChunkErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { fallo: false, esChunk: false, mensaje: '' };

  // Antes CUALQUIER error de una pantalla mostraba «Actualizando el sistema…».
  // Un error de verdad no se arregla recargando: la persona recargaba, volvía a
  // fallar y el cartel quedaba pegado, además de echarle la culpa a un
  // despliegue que no había ocurrido. Ahora se distingue el caso.
  static getDerivedStateFromError(err: unknown): BoundaryState {
    return {
      fallo: true,
      esChunk: esErrorDeChunk(err),
      mensaje: String((err as Error)?.message || err || '').slice(0, 300),
    };
  }

  componentDidCatch(err: unknown): void {
    // Si es un chunk faltante, intentamos la recarga automática una vez.
    if (esErrorDeChunk(err)) recargarPorChunkFaltante();
  }

  /** El botón de la pantalla. Ignora el guard: si la persona lo aprieta, quiere
   *  recargar ahora, aunque el intento automático haya sido hace un segundo. */
  private reintentar = (): void => {
    try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* da igual */ }
    recargaDura();
  };

  render(): ReactNode {
    if (!this.state.fallo) return this.props.children;

    // Chunk faltante: sí es un despliegue, y recargar lo arregla.
    if (this.state.esChunk) {
      return (
        <div className="card" style={{ padding: '2rem', maxWidth: 520, margin: '2rem auto', textAlign: 'center' }}>
          <h2 style={{ marginTop: 0 }}>Actualizando el sistema…</h2>
          <p className="muted">
            Se publicó una versión nueva. Recargá la página para continuar; tus datos guardados no se pierden.
          </p>
          <button className="btn btn-primary" onClick={this.reintentar}>
            Recargar ahora
          </button>
        </div>
      );
    }

    // Cualquier otro error: no mentir. Recargar puede no arreglarlo, así que se
    // ofrece volver al inicio y se muestra el mensaje para poder reportarlo.
    return (
      <div className="card" style={{ padding: '2rem', maxWidth: 560, margin: '2rem auto', textAlign: 'center' }}>
        <h2 style={{ marginTop: 0 }}>Esta pantalla falló</h2>
        <p className="muted">
          No se pudo mostrar. <strong>Tus datos guardados no se pierden.</strong> Probá recargar;
          si vuelve a fallar, avisá al equipo con el detalle de abajo.
        </p>
        {this.state.mensaje && (
          <pre
            className="mono muted"
            style={{
              fontSize: '.72rem', textAlign: 'left', whiteSpace: 'pre-wrap',
              background: 'var(--surface-2, #0d1117)', padding: '.6rem',
              borderRadius: '.4rem', maxHeight: 160, overflow: 'auto',
            }}
          >
            {this.state.mensaje}
          </pre>
        )}
        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={this.reintentar}>Recargar</button>
          <button className="btn btn-ghost" onClick={() => { window.location.href = '/'; }}>Ir al inicio</button>
        </div>
      </div>
    );
  }
}
