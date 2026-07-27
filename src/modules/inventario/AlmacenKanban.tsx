import { EmptyState } from '@/shared/ui/EmptyState';
import { num, money } from '@/shared/lib/format';
import type { Producto } from '@/shared/lib/types';
import type { ConsumoProducto } from './almacenes.repository';

/**
 * Vista Kanban del detalle de un almacén: una tarjeta por producto con
 * Total productos (stock), Total productos usados (salidas acumuladas) y
 * Total consumo diario (promedio por día).
 */
export function AlmacenKanban({
  rows,
  consumo,
  onView,
}: {
  rows: Producto[];
  consumo: Map<string, ConsumoProducto>;
  onView: (id: string) => void;
}) {
  if (!rows.length) {
    return <div className="card"><EmptyState message="El almacén no tiene productos." icon="▣" /></div>;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '.85rem' }}>
      {rows.map((p) => {
        const c = consumo.get(p.id);
        const usados = c?.usados ?? 0;
        const diario = c?.diario ?? 0;
        const u = p.unidad ?? '';
        const stock = Number(p.stock) || 0;
        const precio = Number(p.precio) || 0;
        return (
          <div
            key={p.id}
            className="card"
            style={{ margin: 0, padding: '1rem', cursor: 'pointer', borderTop: '3px solid var(--primary)' }}
            onClick={() => onView(p.id)}
            title="Ver detalle del producto"
          >
            <div style={{ fontWeight: 700 }}>{p.nombre}</div>
            <div className="muted mono" style={{ fontSize: '.7rem', marginBottom: '.6rem' }}>{p.sku}</div>

            <div style={{ display: 'grid', gap: '.45rem' }}>
              <Metric label="Stock" value={`${num(stock)} ${u}`} color="var(--primary-3)" />
              <Metric label="Precio UND" value={money(precio)} color="var(--text)" />
              <Metric label="Valor total" value={money(stock * precio)} color="var(--success)" />
              <Metric label="Total usados" value={`${num(usados)} ${u}`} color="var(--warning)" />
              <Metric label="Consumo diario" value={`${num(diario)} ${u}/día`} color="var(--muted, #9aa)" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '.5rem' }}>
      <span className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</span>
      <strong className="mono" style={{ fontSize: '.95rem', color }}>{value}</strong>
    </div>
  );
}
