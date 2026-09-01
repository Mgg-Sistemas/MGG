import { useState } from 'react';
import type { DetalleServicioItem } from '@/shared/lib/types';

/**
 * Editor desplegable y OPCIONAL del detalle de un renglón de servicio
 * (piezas a reparar / trabajos a realizar). Se puede agregar/quitar varios ítems.
 * Se usa tanto en Servicio (OP) como en Servicio Directo. El detalle sale en el PDF.
 */
export function DetalleItemsEditor({ value, onChange, compact }: {
  value: DetalleServicioItem[];
  onChange: (v: DetalleServicioItem[]) => void;
  compact?: boolean;
}) {
  const items = value ?? [];
  const [abierto, setAbierto] = useState(items.length > 0);

  function setItem(i: number, patch: Partial<DetalleServicioItem>) {
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function add() {
    const next = [...items, { descripcion: '', cantidad: null } as DetalleServicioItem];
    onChange(next);
    setAbierto(true);
  }
  function quitar(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }

  return (
    <div style={{ marginTop: '.4rem' }}>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={() => { if (!abierto && items.length === 0) add(); else setAbierto((v) => !v); }}
        style={{ fontSize: compact ? '.72rem' : '.78rem' }}
        title="Detallar las piezas / trabajos de este renglón (opcional)"
      >
        {abierto ? '▾' : '▸'} Detalle {items.length > 0 ? `(${items.length})` : '(opcional)'}
      </button>

      {abierto && (
        <div style={{ marginTop: '.35rem', paddingLeft: '.5rem', borderLeft: '2px solid var(--border)' }}>
          {items.length === 0 && (
            <div className="muted" style={{ fontSize: '.72rem', marginBottom: '.3rem' }}>
              Sin detalle. Agregá las piezas o trabajos (ej. “pastillas de freno delanteras”).
            </div>
          )}
          {items.map((it, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 30px', gap: '.35rem', marginBottom: '.3rem' }} className="m-stack">
              <input
                className="input"
                placeholder="Pieza / reparación / trabajo"
                value={it.descripcion}
                onChange={(e) => setItem(i, { descripcion: e.target.value })}
              />
              <input
                className="input"
                type="number"
                min={0}
                step="any"
                placeholder="Cant."
                value={it.cantidad ?? ''}
                onChange={(e) => setItem(i, { cantidad: e.target.value === '' ? null : Number(e.target.value) })}
              />
              <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => quitar(i)} title="Quitar">✕</button>
            </div>
          ))}
          <button type="button" className="btn btn-sm btn-ghost" onClick={add} style={{ fontSize: '.74rem' }}>+ Agregar ítem</button>
        </div>
      )}
    </div>
  );
}
