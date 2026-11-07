/* ============================================================
   MGG · Delivery · Recarga al volver y cada tanto (07-11-2026)
   En el teléfono, con la pantalla apagada el navegador corta la conexión en vivo:
   al volver no llegaba ningún aviso y la lista quedaba vieja (OC-2026-0244 confirmada
   y el delivery no la veía). Ahora se recarga al volver a la app, al recuperar la
   conexión y cada 45 segundos mientras está a la vista.
   ============================================================ */
import { useEffect, useRef } from 'react';

export const RECARGA_DELIVERY_MS = 45_000;

export function useRecargaAlVolver(recargar: () => unknown, cadaMs: number = RECARGA_DELIVERY_MS): void {
  const ref = useRef(recargar);
  ref.current = recargar;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const correr = () => {
      if (document.hidden) return;
      try { void Promise.resolve(ref.current()).catch(() => { /* la próxima vuelta reintenta */ }); } catch { /* idem */ }
    };
    document.addEventListener('visibilitychange', correr);
    window.addEventListener('focus', correr);
    window.addEventListener('online', correr);
    window.addEventListener('pageshow', correr);
    const t = window.setInterval(correr, cadaMs);
    return () => {
      document.removeEventListener('visibilitychange', correr);
      window.removeEventListener('focus', correr);
      window.removeEventListener('online', correr);
      window.removeEventListener('pageshow', correr);
      window.clearInterval(t);
    };
  }, [cadaMs]);
}
