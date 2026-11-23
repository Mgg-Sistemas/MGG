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
import './documentacion.css';

type Vista = 'documentos' | 'envios';

/* La vista se recuerda, como en Usuarios y Maquinaria. La primera vez abre
   en «envíos», que es el trabajo del día. */
const CLAVE_VISTA = 'mgg.documentacion.v1.vista';

function leerVista(): Vista {
  try {
    const v = localStorage.getItem(CLAVE_VISTA);
    if (v === 'documentos' || v === 'envios') return v;
  } catch { /* navegador sin almacenamiento: se usa el valor por defecto */ }
  return 'envios';
}

export function DocumentacionPage() {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('documentacion', 'escritura');
  const actor = { email: user?.email ?? 'sistema', nombre: appUser?.nombre ?? null };
  const [vista, setVista] = useState<Vista>(leerVista);
  const cambiarVista = (v: Vista) => {
    setVista(v);
    try { localStorage.setItem(CLAVE_VISTA, v); } catch { /* no es crítico */ }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Documentación</h1>
          <p className="muted" style={{ maxWidth: '70ch' }}>
            Documentos de la empresa y notas de envío de documentación con su correlativo.
          </p>
        </div>
        {/* El orden acompaña a lo que la página abre. */}
        <div className="view-toggle" role="tablist" aria-label="Apartado de documentación">
          <button
            type="button" role="tab" aria-selected={vista === 'envios'}
            className={vista === 'envios' ? 'active' : ''}
            onClick={() => cambiarVista('envios')}
          >
            📨 Formato de envío
          </button>
          <button
            type="button" role="tab" aria-selected={vista === 'documentos'}
            className={vista === 'documentos' ? 'active' : ''}
            onClick={() => cambiarVista('documentos')}
          >
            🗂 Documentos
          </button>
        </div>
      </div>

      {/* Cada apartado se anuncia: antes solo se deducía del botón encendido. */}
      <div className="doc-apartado">
        <h2 className="doc-apartado-titulo">
          {vista === 'envios' ? 'Notas de envío' : 'Documentos de la empresa'}
        </h2>
        <p className="doc-apartado-nota">
          {vista === 'envios'
            ? 'Histórico con correlativo. Una nota nunca se borra: se anula.'
            : 'Archivo de la empresa con su vencimiento. Se avisa 30 días antes.'}
        </p>
      </div>

      {vista === 'documentos'
        ? <DocumentosPanel canWrite={canWrite} actor={actor} />
        : <NotasEnvioPanel canWrite={canWrite} actor={actor} />}
    </div>
  );
}
