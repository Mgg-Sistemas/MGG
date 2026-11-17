/* ============================================================
   Golden Touch · Administración · página de prueba (SOLO LOCAL)
   App.tsx la registra con import.meta.env.DEV: la vista con el repo EN
   MEMORIA (empresas y gastos ficticios), sin sesión ni base. Sus
   preferencias van con otro prefijo, para no mezclarse con las reales.
   ============================================================ */
import { useMemo } from 'react';
import { AdministracionPage } from '../AdministracionPage';
import { crearPreferenciasAdmin, PREFIJO_ADMIN_DEMO } from '../administracionPreferencias';
import { crearRepoDemo } from './datosDemoAdministracion';

export function AdministracionDemoPage() {
  const repo = useMemo(() => crearRepoDemo(), []);
  const prefs = useMemo(() => crearPreferenciasAdmin(PREFIJO_ADMIN_DEMO), []);
  return (
    <main className="adm-demo">
      <AdministracionPage repo={repo} prefs={prefs}
        aviso={<div className="adm-aviso demo">🧪 Página de prueba local · empresas y gastos ficticios · no toca la base</div>} />
    </main>
  );
}
