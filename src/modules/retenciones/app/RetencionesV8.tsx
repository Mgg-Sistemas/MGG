/* ============================================================
   MGG · Retenciones v8 · La entrada del módulo nuevo

   Reemplaza al módulo de antes en /app/retenciones (orden del usuario,
   20/10/2026: «la idea es mejorar, remplazar el modulo base de retenciones
   que existe»). Entra quien tenga el permiso de Retenciones, como siempre.
   No va a main hasta estar completa (regla del usuario, 16/10 13:37).

   Esta es la raíz: da la puerta de datos a las pantallas y conecta sus
   acciones (registrar abre el diálogo de registro; al registrar, la
   pantalla se vuelve a leer). Las acciones solo se pasan si quien entra
   puede escribir en Retenciones.
   ============================================================ */

import { useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { PuertaContext, type RetencionItem, type RetencionPracticada } from './datos/puerta';
import { puertaAnfitrion } from './datos/puertaAnfitrion';
import { Principal } from './pantalla/Principal';
import { Parametros } from './parametros/Parametros';
import { AnularDialogo } from './registro/AnularDialogo';
import { RegistroDialogo } from './registro/RegistroDialogo';

export function RetencionesV8() {
  const { loading, can } = usePermissions();
  const [registrar, setRegistrar] = useState<{ item: RetencionItem; impuesto: string } | null>(null);
  const [parametros, setParametros] = useState(false);
  const [anular, setAnular] = useState<RetencionPracticada | null>(null);
  const [lectura, setLectura] = useState(0);
  if (loading) return <div className="p-8 muted">Cargando…</div>;
  const puedeEscribir = can('retenciones', 'escritura');
  return (
    <PuertaContext.Provider value={puertaAnfitrion}>
      <Principal key={lectura}
        onParametros={() => setParametros(true)}
        onRegistrar={puedeEscribir ? (item, impuesto) => setRegistrar({ item, impuesto }) : undefined}
        onAnular={puedeEscribir ? (r) => setAnular(r) : undefined}
        onAdjuntar={puedeEscribir ? (r, archivo) => {
          puertaAnfitrion.adjuntarComprobante(r.id, archivo)
            .then(() => { toast('Comprobante adjuntado.', 'success'); setLectura((n) => n + 1); })
            .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo adjuntar el comprobante.', 'error'));
        } : undefined} />
      {parametros && <Parametros puedeEditar={puedeEscribir} onCerrar={() => setParametros(false)} />}
      {anular && (
        <AnularDialogo retencion={anular} onCerrar={() => setAnular(null)}
          onAnulada={() => { setAnular(null); setLectura((n) => n + 1); }} />
      )}
      {registrar && (
        <RegistroDialogo
          item={registrar.item} impuesto={registrar.impuesto}
          onCerrar={() => setRegistrar(null)}
          onRegistrada={() => { setRegistrar(null); setLectura((n) => n + 1); }}
        />
      )}
    </PuertaContext.Provider>
  );
}
