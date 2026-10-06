/* ============================================================
   MGG · Módulo Documentación (06-10-2026) · igual al de Golden Touch
   Dos apartados:
     · 🗂 Documentos de la empresa (archivo con vencimientos).
     · 📨 Formato de envío de documentación (notas de envío con
       correlativo e histórico).
   ============================================================ */
import { useState } from 'react';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { DocumentosPanel } from './DocumentosPanel';
import { NotasEnvioPanel } from './NotasEnvioPanel';

type Vista = 'documentos' | 'envios';

export function DocumentacionPage() {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('documentacion', 'escritura');
  const actor = { email: user?.email ?? 'sistema', nombre: appUser?.nombre ?? null };
  const [vista, setVista] = useState<Vista>('envios');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>🗂 Documentación</h1>
          <p className="muted" style={{ margin: '.25rem 0 0' }}>
            Documentos de la empresa y notas de envío de documentación con su correlativo.
          </p>
        </div>
        <div className="view-toggle" role="tablist" aria-label="Apartado de documentación">
          <button className={vista === 'documentos' ? 'active' : ''} onClick={() => setVista('documentos')}>🗂 Documentos</button>
          <button className={vista === 'envios' ? 'active' : ''} onClick={() => setVista('envios')}>📨 Formato envío de documentación</button>
        </div>
      </div>
      {vista === 'documentos'
        ? <DocumentosPanel canWrite={canWrite} actor={actor} />
        : <NotasEnvioPanel canWrite={canWrite} actor={actor} />}
    </div>
  );
}
