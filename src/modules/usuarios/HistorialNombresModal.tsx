/* ============================================================
   MGG · Usuarios · Historial de cambios de nombre (07-10-2026)
   Todos los renombres de todos los usuarios: cuándo, de qué a qué, por
   qué y quién lo cambió. Buscable.
   ============================================================ */
import { useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { dateTime } from '@/shared/lib/format';
import type { CambioNombreUsuario } from './usuarios.repository';

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function HistorialNombresModal({ historial, onClose }: { historial: CambioNombreUsuario[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const visibles = useMemo(() => {
    const t = norm(q).trim();
    if (!t) return historial;
    return historial.filter((h) => norm(`${h.email} ${h.nombre_anterior} ${h.nombre_nuevo} ${h.motivo} ${h.cambiado_por ?? ''} ${h.cambiado_por_nombre ?? ''}`).includes(t));
  }, [historial, q]);

  return (
    <Modal title="📜 Historial de cambios de nombre" size="lg" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.84rem' }}>
        Cada vez que a un usuario se le cambia el nombre o el apellido queda acá: de qué nombre a cuál, cuándo, quién lo cambió y el motivo.
        Lo que la persona hizo con el nombre anterior se sigue mostrando con ese nombre.
      </p>
      <div className="form-row">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Buscar por nombre, correo, motivo o quién lo cambió…" />
      </div>
      {!visibles.length ? (
        <EmptyState icon="📜" message={historial.length ? 'Ningún cambio coincide con la búsqueda' : 'Todavía no se le ha cambiado el nombre a ningún usuario'} />
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead><tr><th>Cuándo</th><th>Usuario</th><th>Antes</th><th>Después</th><th>Motivo</th><th>Lo cambió</th></tr></thead>
            <tbody>
              {visibles.map((h) => (
                <tr key={h.id}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{dateTime(h.created_at)}</td>
                  <td className="muted" style={{ fontSize: '.8rem' }}>{h.email}</td>
                  <td><strong>{h.nombre_anterior}</strong></td>
                  <td><strong>{h.nombre_nuevo}</strong></td>
                  <td>{h.motivo}</td>
                  <td style={{ fontSize: '.8rem' }}>{h.cambiado_por_nombre || h.cambiado_por || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
