/* ============================================================
   MGG · Retenciones v8 · La entrada del módulo nuevo

   Ruta de desarrollo /app/retenciones/nueva, solo para el administrador:
   no se publica hasta estar completa (regla del usuario, 16/10 13:37). Al
   terminar, /app/retenciones elegirá esta o la de hoy con el interruptor
   retenciones.pantalla_nueva.

   Esta es la raíz: da la puerta de datos a las pantallas y conecta sus
   acciones (registrar abre el diálogo de registro; al registrar, la
   pantalla se vuelve a leer). Las acciones solo se pasan si quien entra
   puede escribir en Retenciones.
   ============================================================ */

import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { PuertaContext, type RetencionItem, type RetencionPracticada } from './datos/puerta';
import { puertaAnfitrion } from './datos/puertaAnfitrion';
import { Principal } from './pantalla/Principal';
import { Parametros } from './parametros/Parametros';
import { AnularDialogo } from './registro/AnularDialogo';
import { RegistroDialogo } from './registro/RegistroDialogo';

export function RetencionesV8() {
  const { isAdmin, loading, can } = usePermissions();
  const [registrar, setRegistrar] = useState<{ item: RetencionItem; impuesto: string } | null>(null);
  const [parametros, setParametros] = useState(false);
  const [anular, setAnular] = useState<RetencionPracticada | null>(null);
  const [lectura, setLectura] = useState(0);
  if (loading) return <div className="p-8 muted">Cargando…</div>;
  if (!isAdmin) return <Navigate to="/app/retenciones" replace />;
  const puedeEscribir = can('retenciones', 'escritura');
  return (
    <PuertaContext.Provider value={puertaAnfitrion}>
      <Principal key={lectura}
        onParametros={() => setParametros(true)}
        onRegistrar={puedeEscribir ? (item, impuesto) => setRegistrar({ item, impuesto }) : undefined}
        onAnular={puedeEscribir ? (r) => setAnular(r) : undefined} />
      {parametros && <Parametros onCerrar={() => setParametros(false)} />}
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
