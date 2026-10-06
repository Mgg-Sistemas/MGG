import { useState } from 'react';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { DocumentosEmpresaTab } from './DocumentosEmpresaTab';
import { NotaEnvioTab } from './NotaEnvioTab';

type Vista = 'documentos' | 'nota';

const TABS: { key: Vista; label: string; icon: string }[] = [
  { key: 'documentos', label: 'Documentos de la empresa', icon: '📁' },
  { key: 'nota', label: 'Formato envío de documentación', icon: '📨' },
];

/**
 * Documentación (06-10-2026): los papeles de la empresa en un solo lugar y el
 * formato con el que se entrega documentación a terceros (nota de envío con
 * correlativo e histórico).
 */
export function DocumentacionPage() {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('documentacion', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;
  const [vista, setVista] = useState<Vista>('documentos');

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>📁 Documentación</h1>
        <p className="hint muted" style={{ margin: '.25rem 0 0' }}>
          Documentos de la empresa y <strong>notas de envío de documentación</strong> con correlativo e histórico.
        </p>
      </div>

      <div className="view-toggle" role="tablist" aria-label="Vista de Documentación" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.key} className={vista === t.key ? 'active' : ''} onClick={() => setVista(t.key)}>{t.icon} {t.label}</button>
        ))}
      </div>

      {vista === 'documentos' && <DocumentosEmpresaTab canWrite={canWrite} actor={actor} actorName={actorName} />}
      {vista === 'nota' && <NotaEnvioTab canWrite={canWrite} actor={actor} actorName={actorName} />}
    </div>
  );
}
