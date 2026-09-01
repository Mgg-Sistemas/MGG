import { useState } from 'react';
import type { DetalleServicioItem } from '@/shared/lib/types';

/** Suma de los precios OPCIONALES del detalle (0 si ninguno lleva precio). */
export function sumaDetallePrecios(items?: DetalleServicioItem[] | null): number {
  const s = (items ?? []).reduce((a, d) => a + (Number(d.precio) || 0), 0);
  return Math.round(s * 100) / 100;
}

/**
 * Editor desplegable y OPCIONAL del detalle de un renglón de servicio
 * (piezas a reparar / trabajos a realizar). Se puede agregar/quitar varios ítems.
 * Se usa tanto en Servicio (OP) como en Servicio Directo. El detalle sale en el PDF.
 * El precio de cada pieza es opcional; su suma alimenta el precio de la línea.
 */
export function DetalleItemsEditor({ value, onChange, compact }: {
  value: DetalleServicioItem[];
  onChange: (v: DetalleServicioItem[]) => void;
  compact?: boolean;
}) {
  const items = value ?? [];
  const [abierto, setAbierto] = useState(items.length > 0);
  const subtotal = sumaDetallePrecios(items);

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
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 90px 30px', gap: '.35rem', marginBottom: '.3rem' }} className="m-stack">
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
              <input
                className="input mono"
                type="number"
                min={0}
                step="any"
                placeholder="Precio"
                title="Precio de esta pieza / trabajo (opcional). La suma alimenta el precio de la línea."
                value={it.precio ?? ''}
                onChange={(e) => setItem(i, { precio: e.target.value === '' ? null : Number(e.target.value) })}
              />
              <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => quitar(i)} title="Quitar">✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '.15rem' }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={add} style={{ fontSize: '.74rem' }}>+ Agregar ítem</button>
            {subtotal > 0 && (
              <span className="muted" style={{ fontSize: '.74rem' }}>
                Subtotal detalle: <strong className="mono">{subtotal.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
