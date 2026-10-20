/* ============================================================
   MGG · Retenciones · Qué pantalla abre /app/retenciones

   · En local (import.meta.env.DEV), siempre la v8: así se ve cada pieza.
   · En producción, la v8 solo con el interruptor `retenciones.pantalla_v8`
     encendido; si no, la pantalla de hoy (RetencionesPage), sin cambios.
   Así cada pieza verificada puede subir a dev aunque dev llegue a main: en
   producción no cambia nada hasta encender el interruptor (orden del
   usuario, 20/10, vía Master: «menos trabas»). La regla de producción
   funcional se cumple: lo que no está encendido no se ve.
   ============================================================ */

import { lazy, Suspense, useEffect, useState } from 'react';
import { interruptorEncendido } from './datos/interruptores';

const RetencionesV8 = lazy(() => import('./RetencionesV8').then((m) => ({ default: m.RetencionesV8 })));
const RetencionesPage = lazy(() => import('../RetencionesPage').then((m) => ({ default: m.RetencionesPage })));

export const CLAVE_PANTALLA_V8 = 'retenciones.pantalla_v8';

export function RetencionesEntrada() {
  const [v8, setV8] = useState<boolean | null>(import.meta.env.DEV ? true : null);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    let vivo = true;
    void interruptorEncendido(CLAVE_PANTALLA_V8).then((x) => { if (vivo) setV8(x); });
    return () => { vivo = false; };
  }, []);
  if (v8 == null) return <div className="p-8 muted">Cargando…</div>;
  return (
    <Suspense fallback={<div className="p-8 muted">Cargando…</div>}>
      {v8 ? <RetencionesV8 /> : <RetencionesPage />}
    </Suspense>
  );
}
