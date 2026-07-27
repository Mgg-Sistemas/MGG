import { memo } from 'react';
import { money, num } from '@/shared/lib/format';
import { EmptyState } from '@/shared/ui/EmptyState';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import type { ProductoDecorado } from './restock';

interface ProductosTableProps {
  rows: ProductoDecorado[];
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onMovimiento: (id: string) => void;
  onToggleEstado: (id: string) => void;
  /** Si es false, solo se muestra la acción de ver detalle (rol sin escritura). */
  canWrite?: boolean;
  /** Si viene, agrega columnas Entradas/Salidas por producto (vista de almacén). */
  movStats?: Map<string, { entradas: number; salidas: number }>;
  /** Si viene (vista de almacén), agrega la acción "Mover" para trasladar ese producto a otro almacén. */
  onMover?: (p: ProductoDecorado) => void;
}

export const ProductosTable = memo(function ProductosTable({ rows, onView, onEdit, onMovimiento, onToggleEstado, canWrite = true, movStats, onMover }: ProductosTableProps) {
  if (!rows.length) {
    return (
      <div className="card">
        <EmptyState message="Sin productos que coincidan con los filtros." icon="⬢" />
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Producto</th>
            <th>Categoría</th>
            <th>Receta</th>
            <th title="Clasificación ABC (Pareto)">ABC</th>
            {movStats && <th style={{ textAlign: 'right' }} title="Total de entradas históricas">Entradas</th>}
            {movStats && <th style={{ textAlign: 'right' }} title="Total de salidas históricas">Salidas</th>}
            <th style={{ textAlign: 'right' }}>Stock</th>
            <th style={{ textAlign: 'right' }} title="Umbral efectivo según la política">Umbral</th>
            <th style={{ textAlign: 'right' }}>Precio UND</th>
            <th style={{ textAlign: 'right' }} title="Precio total = stock × precio UND">Valor</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const threshold = p._threshold;
            const ratio = Math.min(1, (p.stock ?? 0) / Math.max(1, threshold));
            const meterCls = p._critical ? 'crit' : ratio < 0.75 ? 'low' : '';
            const klass = p._klass;
            const stockBadge = p._critical ? (
              <span className="badge danger" style={{ marginLeft: '.25rem' }} title="Stock por debajo del mínimo">
                ⚠ crítico
              </span>
            ) : p._needsRestock ? (
              <span className="badge warning" style={{ marginLeft: '.25rem' }}>reabastecer</span>
            ) : null;

            return (
              <tr key={p.id}>
                <td className="mono">{p.sku}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                    <span>{p.nombre}</span>
                    {p.en_fundicion && (
                      <span className="badge warning" title="Hay un proceso de fundición activo para este producto">
                        🔥 EN PROCESO DE FUNDICIÓN
                      </span>
                    )}
                  </div>
                  <div className={`stock-meter ${meterCls}`} style={{ width: 140 }}>
                    <div className="fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
                  </div>
                </td>
                <td><span className="badge">{p.categoria}</span></td>
                <td>
                  {p.receta_fundicion ? (
                    <span className="badge info">{p.receta_fundicion}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td><span className={`badge abc-${klass}`}>{klass}</span></td>
                {movStats && (
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--success)' }}>
                    +{num(movStats.get(p.id)?.entradas ?? 0)}
                  </td>
                )}
                {movStats && (
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--danger)' }}>
                    −{num(movStats.get(p.id)?.salidas ?? 0)}
                  </td>
                )}
                <td className="mono" style={{ textAlign: 'right' }}>
                  {num(p.stock)} {stockBadge}
                </td>
                <td className="mono muted" style={{ textAlign: 'right' }} title={`${p.stock_min} mín × ${p._pct}%`}>
                  ≤ {num(threshold)}
                  {p._hasCustom && (
                    <span
                      className="badge primary"
                      style={{ marginLeft: '.3rem', fontSize: '.62rem', padding: '.05rem .35rem' }}
                      title={`Umbral personalizado (${p.restock_pct}%)`}
                    >
                      ★ {p.restock_pct}%
                    </span>
                  )}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(p.precio)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(p._valor)}</td>
                <td><StatusBadge estado={p.estado} /></td>
                <td className="actions">
                  <button className="btn btn-sm btn-ghost" onClick={() => onView(p.id)} title="Ver detalle y kardex">
                    📋
                  </button>
                  {canWrite && (
                    <>
                      <button className="btn btn-sm btn-ghost" onClick={() => onMovimiento(p.id)} title="Registrar movimiento">
                        ↕
                      </button>
                      {onMover && (
                        <button className="btn btn-sm btn-ghost" onClick={() => onMover(p)} title="Mover a otro almacén">
                          ⇄
                        </button>
                      )}
                      <button className="btn btn-sm btn-ghost" onClick={() => onEdit(p.id)}>
                        Editar
                      </button>
                      <button
                        className={`btn btn-sm ${p.estado === 'activo' ? 'btn-danger' : 'btn-success'}`}
                        onClick={() => onToggleEstado(p.id)}
                        title={p.estado === 'activo' ? 'Desactivar' : 'Activar'}
                      >
                        {p.estado === 'activo' ? '✕' : '✓'}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
