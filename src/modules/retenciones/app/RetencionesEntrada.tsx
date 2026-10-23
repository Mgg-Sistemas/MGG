/* ============================================================
   MGG · Retenciones · Qué pantalla abre /app/retenciones

   · La pantalla v8 sustituye oficialmente al módulo viejo en producción.
   · Si se requiere volver temporalmente a la versión clásica de emergencia,
     se puede activar mediante el interruptor `retenciones.usar_modulo_antiguo`.
   ============================================================ */

import { lazy, Suspense, useEffect, useState } from 'react';
import { interruptorEncendido } from './datos/interruptores';

const RetencionesV8 = lazy(() => import('./RetencionesV8').then((m) => ({ default: m.RetencionesV8 })));
const RetencionesPage = lazy(() => import('../RetencionesPage').then((m) => ({ default: m.RetencionesPage })));

export const CLAVE_MODULO_ANTIGUO = 'retenciones.usar_modulo_antiguo';

export function RetencionesEntrada() {
  const [usarAntiguo, setUsarAntiguo] = useState(false);

  useEffect(() => {
    let vivo = true;
    void interruptorEncendido(CLAVE_MODULO_ANTIGUO).then((x) => {
      if (vivo && x) setUsarAntiguo(true);
    });
    return () => { vivo = false; };
  }, []);

  return (
    <Suspense fallback={<div className="p-8 muted">Cargando…</div>}>
      {usarAntiguo ? <RetencionesPage /> : <RetencionesV8 />}
    </Suspense>
  );
}
