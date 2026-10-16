/* ============================================================
   MGG · Retenciones v8 · La entrada del módulo nuevo

   Ruta de desarrollo /app/retenciones/nueva, solo para el administrador y
   solo en la rama de integración: no va a main hasta estar completa (regla
   del usuario, 16/10 13:37). Al terminar, /app/retenciones elegirá esta o la
   de hoy con el interruptor retenciones.pantalla_nueva.

   Esta es la raíz: da la puerta de datos a las pantallas. La pantalla
   principal (pieza A) vive en pantalla/Principal.tsx.
   ============================================================ */

import { Navigate } from 'react-router-dom';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { PuertaContext } from './datos/puerta';
import { puertaAnfitrion } from './datos/puertaAnfitrion';
import { Principal } from './pantalla/Principal';

export function RetencionesV8() {
  const { isAdmin, loading } = usePermissions();
  if (loading) return <div className="p-8 muted">Cargando…</div>;
  if (!isAdmin) return <Navigate to="/app/retenciones" replace />;
  return (
    <PuertaContext.Provider value={puertaAnfitrion}>
      <Principal />
    </PuertaContext.Provider>
  );
}
