/* ============================================================
   MGG · Realtime · Suscripción a cambios de Supabase
   El sistema es multiusuario: lo que registra un usuario se refleja
   en los demás sin recargar. Este hook se suscribe a los cambios
   (INSERT/UPDATE/DELETE) de una o varias tablas y llama a `onChange`
   (debounced) para que la vista vuelva a cargar sus datos.

   Requiere que las tablas estén en la publicación `supabase_realtime`
   (ver supabase/schema.sql, sección realtime).

   12-11-2026 · CANALES COMPARTIDOS. Antes cada pantalla abría su propio
   canal y lo cerraba al desmontar: la campana y el panel escuchaban
   `notificaciones` por separado, varias vistas de Compras `ordenes`, y al
   pasar de un módulo a otro se borraban y volvían a crear las suscripciones
   (medido: 271.850 escrituras en realtime.subscription y el sondeo de cambios
   de Realtime = 94,5 % del tiempo de la base). Ahora hay UN canal por tabla
   por navegador, compartido por todas las pantallas que la escuchan, y se
   cierra 30 s después de que la última deja de usarlo (ir y volver de un
   módulo reutiliza la suscripción). Si la conexión se cae y vuelve, las
   pantallas recargan (los cambios de mientras no llegan como eventos).
   ============================================================ */
import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from './supabase';
import { bustCache } from './queryCache';

type Oyente = () => void;

interface CanalTabla {
  channel: RealtimeChannel;
  oyentes: Set<Oyente>;
  cierre: ReturnType<typeof setTimeout> | null;
  /** Ya estuvo suscrito una vez: un nuevo SUBSCRIBED es una reconexión. */
  suscrito: boolean;
}

/** Cuánto se mantiene vivo un canal sin pantallas que lo escuchen. */
const GRACIA_MS = 30_000;
const canales = new Map<string, CanalTabla>();

function avisar(c: CanalTabla): void {
  // Copia: un oyente puede desuscribirse mientras recorremos.
  for (const o of [...c.oyentes]) {
    try { o(); } catch { /* un oyente roto no frena a los demás */ }
  }
}

/** Engancha `oyente` al canal compartido de `tabla`. Devuelve la función para soltarlo. */
export function escucharTabla(tabla: string, oyente: Oyente): () => void {
  const sb = getSupabase();
  let c = canales.get(tabla);
  if (c?.cierre) { clearTimeout(c.cierre); c.cierre = null; }
  if (!c) {
    // Sufijo aleatorio: si el canal anterior de esta tabla todavía se está
    // cerrando, el nuevo no debe confundirse con él.
    const channel = sb.channel(`rt:${tabla}:${Math.floor(Math.random() * 1e9)}`);
    const nuevo: CanalTabla = { channel, oyentes: new Set(), cierre: null, suscrito: false };
    channel.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, () => avisar(nuevo));
    channel.subscribe((estado) => {
      if (estado !== 'SUBSCRIBED') return;
      if (nuevo.suscrito) avisar(nuevo);   // reconexión: ponerse al día
      nuevo.suscrito = true;
    });
    canales.set(tabla, nuevo);
    c = nuevo;
  }
  const canal = c;
  canal.oyentes.add(oyente);
  return () => {
    canal.oyentes.delete(oyente);
    if (canal.oyentes.size > 0 || canal.cierre) return;
    canal.cierre = setTimeout(() => {
      canal.cierre = null;
      if (canal.oyentes.size > 0 || canales.get(tabla) !== canal) return;
      canales.delete(tabla);
      void sb.removeChannel(canal.channel);
    }, GRACIA_MS);
  };
}

/** Solo para pruebas: cuántos canales compartidos hay abiertos. */
export function canalesRealtimeAbiertos(): string[] {
  return [...canales.keys()].sort();
}

/**
 * Suscribe `onChange` a los cambios de `tables`. Recarga con debounce (400 ms)
 * para agrupar ráfagas de eventos. Se desuscribe al desmontar o cambiar tablas.
 */
export function useRealtime(tables: string[], onChange: () => void, opts?: { enabled?: boolean }): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  const enabled = opts?.enabled ?? true;
  const key = [...new Set(tables)].sort().join(',');

  useEffect(() => {
    if (!enabled || !isSupabaseConfigured || !key) return;
    try { getSupabase(); } catch { return; }
    const tablas = key.split(',');

    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendienteOculto = false;            // hubo cambios mientras la pestaña no estaba visible
    const ocultaApi = typeof document !== 'undefined';

    // Recarga con debounce (400 ms) para agrupar ráfagas de eventos relacionados.
    const programar = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => cb.current(), 400); };
    const alEvento = () => {
      // Un cambio real ⇒ la caché de estas tablas ya no es válida: la invalidamos
      // para que la próxima lectura (esta u otra pestaña) traiga lo fresco.
      bustCache(tablas);
      // En segundo plano no recargamos (ahorra red/CPU); marcamos para ponernos al día al volver.
      if (ocultaApi && document.hidden) { pendienteOculto = true; return; }
      programar();
    };
    const alVolver = () => {
      if (ocultaApi && !document.hidden && pendienteOculto) { pendienteOculto = false; programar(); }
    };
    if (ocultaApi) document.addEventListener('visibilitychange', alVolver);

    const soltar = tablas.map((t) => escucharTabla(t, alEvento));

    return () => {
      if (timer) clearTimeout(timer);
      if (ocultaApi) document.removeEventListener('visibilitychange', alVolver);
      soltar.forEach((s) => s());
    };
  }, [key, enabled]);
}
