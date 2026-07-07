/* ============================================================
   MGG · Realtime · Suscripción a cambios de Supabase
   El sistema es multiusuario: lo que registra un usuario se refleja
   en los demás sin recargar. Este hook se suscribe a los cambios
   (INSERT/UPDATE/DELETE) de una o varias tablas y llama a `onChange`
   (debounced) para que la vista vuelva a cargar sus datos.

   Requiere que las tablas estén en la publicación `supabase_realtime`
   (ver supabase/schema.sql, sección realtime).
   ============================================================ */
import { useEffect, useRef } from 'react';
import { getSupabase, isSupabaseConfigured } from './supabase';
import { bustCache } from './queryCache';

/**
 * Suscribe `onChange` a los cambios de `tables`. Recarga con debounce (300 ms)
 * para agrupar ráfagas de eventos. Se desuscribe al desmontar o cambiar tablas.
 */
export function useRealtime(tables: string[], onChange: () => void, opts?: { enabled?: boolean }): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  const enabled = opts?.enabled ?? true;
  const key = [...tables].sort().join(',');

  useEffect(() => {
    if (!enabled || !isSupabaseConfigured || !tables.length) return;
    let sb;
    try { sb = getSupabase(); } catch { return; }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendienteOculto = false;            // hubo cambios mientras la pestaña no estaba visible
    const ocultaApi = typeof document !== 'undefined';

    // Recarga con debounce (400 ms) para agrupar ráfagas de eventos relacionados.
    const programar = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => cb.current(), 400); };
    const alEvento = () => {
      // Un cambio real ⇒ la caché de estas tablas ya no es válida: la invalidamos
      // para que la próxima lectura (esta u otra pestaña) traiga lo fresco.
      bustCache(tables);
      // En segundo plano no recargamos (ahorra red/CPU); marcamos para ponernos al día al volver.
      if (ocultaApi && document.hidden) { pendienteOculto = true; return; }
      programar();
    };
    const alVolver = () => {
      if (ocultaApi && !document.hidden && pendienteOculto) { pendienteOculto = false; programar(); }
    };
    if (ocultaApi) document.addEventListener('visibilitychange', alVolver);

    const channel = sb.channel(`rt-${key}-${Math.floor(Math.random() * 1e9)}`);
    tables.forEach((t) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, alEvento);
    });
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      if (ocultaApi) document.removeEventListener('visibilitychange', alVolver);
      sb.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
}
