import { useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { money, num, dateTime } from '@/shared/lib/format';
import { listRecetas, type RecetaResumen, type ProduccionTipo } from './produccion.repository';

/**
 * Lista de recetas (una por producto producible, según su fundición/refinación más
 * reciente). Al hacer clic en una fila se abre su detalle.
 */
export function RecetasModal({
  tipo = 'fundicion',
  onClose,
  onVer,
}: {
  tipo?: ProduccionTipo;
  onClose: () => void;
  onVer: (r: RecetaResumen) => void;
}) {
  const [recetas, setRecetas] = useState<RecetaResumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    let cancel = false;
    listRecetas(tipo)
      .then((r) => { if (!cancel) setRecetas(r); })
      .catch((e) => { if (!cancel) toast(e instanceof Error ? e.message : 'No se pudieron cargar las recetas', 'error'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [tipo]);

  const filtradas = recetas.filter((r) =>
    !q.trim() || r.producto_nombre.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Modal title={tipo === 'refinacion' ? 'Recetas de refinación' : 'Recetas de fundición'} size="lg" onClose={onClose}
      footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <input
        className="input"
        type="search"
        placeholder="Buscar receta por producto…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ marginBottom: '.75rem' }}
      />
      {loading ? (
        <EmptyState message="Cargando recetas…" icon="◔" />
      ) : !filtradas.length ? (
        <div className="card" style={{ padding: '1.5rem' }}>
          <EmptyState message={q ? 'Sin coincidencias.' : 'Aún no hay recetas. Se crean al producir un material.'} icon="📋" />
        </div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Receta</th>
                <th style={{ textAlign: 'right' }}>Rinde (und)</th>
                <th style={{ textAlign: 'right' }}>Materiales</th>
                <th style={{ textAlign: 'right' }}>Costo unit.</th>
                <th>Última</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((r) => (
                <tr
                  key={r.producto_id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onVer(r)}
                  title="Ver detalle de la receta"
                >
                  <td><strong>{r.producto_nombre}</strong></td>
                  <td>{r.receta_num != null ? <span className="badge">#{num(r.receta_num)}</span> : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(r.rendimiento)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(r.n_materiales)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(r.costo_unitario)}</td>
                  <td className="muted" style={{ fontSize: '.78rem' }}>{dateTime(r.fecha)}</td>
                  <td className="actions">
                    <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); onVer(r); }}>Ver</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
