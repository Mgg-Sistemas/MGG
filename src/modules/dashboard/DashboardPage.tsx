import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { date, money, num, relTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Producto, TipoMovimiento } from '@/shared/lib/types';
import { listProductos } from '@/modules/inventario/inventario.repository';
import { ProductoDetail } from '@/modules/inventario/ProductoDetail';
import {
  loadDashboardData,
  type DashboardKpis,
  type MovimientoConProducto,
} from './dashboard.repository';

const DashboardCharts = lazy(() => import('./DashboardCharts'));

const MOV_ICON: Record<TipoMovimiento, string> = {
  creacion: '+',
  entrada: '⬇',
  salida: '⬆',
  consumo: '⊖',
  transferencia: '↔',
  ajuste: '✎',
  fundicion: '🔥',
  fin_fundicion: '🏁',
};

const MOV_LABEL: Record<TipoMovimiento, string> = {
  creacion: 'Creación',
  entrada: 'Entrada',
  salida: 'Salida',
  consumo: 'Consumo',
  transferencia: 'Transferencia',
  ajuste: 'Ajuste',
  fundicion: 'Fundición',
  fin_fundicion: 'Fin de fundición',
};

export function DashboardPage() {
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [criticos, setCriticos] = useState<Producto[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoConProducto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Producto | null>(null);

  // Abre el detalle/trazabilidad del producto en un modal sobre el dashboard.
  async function verDetalle(productoId: string) {
    try {
      const productos = await listProductos();
      const p = productos.find((x) => x.id === productoId);
      if (!p) { toast('El producto ya no está disponible', 'error'); return; }
      setDetalle(p);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo abrir el detalle', 'error');
    }
  }

  const reload = useCallback(async () => {
    try {
      const data = await loadDashboardData();
      setKpis(data.kpis);
      setCriticos(data.criticos);
      setMovimientos(data.movimientos);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar el dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setLoading(true); void reload(); }, [reload]);
  // Realtime: el tablero refleja en vivo movimientos, compras, producción y catálogo.
  useRealtime(['movimientos', 'ordenes', 'produccion', 'productos', 'existencias'], reload);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Resumen operativo del sistema MGG al {date(new Date().toISOString())}.</p>
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '1rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading && !kpis ? (
        <EmptyState message="Cargando datos del dashboard..." icon="◔" />
      ) : (
        <>
          <KpiGrid kpis={kpis} />

          <Suspense fallback={<div className="card" style={{ padding: '1.25rem' }}><p className="muted">Cargando gráficas…</p></div>}>
            <DashboardCharts />
          </Suspense>

          <div className="card" style={{ marginTop: '1rem' }}>
            <CriticosTable criticos={criticos} />
          </div>

          <div className="card" style={{ marginTop: '1rem' }}>
            <MovimientosFeed movimientos={movimientos} onVerDetalle={verDetalle} />
          </div>
        </>
      )}

      {detalle && <ProductoDetail producto={detalle} onClose={() => setDetalle(null)} />}
    </div>
  );
}

function KpiGrid({ kpis }: { kpis: DashboardKpis | null }) {
  const navigate = useNavigate();
  if (!kpis) return null;
  const restCls = kpis.productosARestablecer > 0 ? 'delta down' : 'delta';
  const restMsg = kpis.productosARestablecer > 0 ? 'requieren atención' : 'todo en orden';
  const pendCls = kpis.ordenesPendientes > 0 ? 'delta down' : 'delta';

  return (
    <div className="kpi-grid">
      <Kpi
        icon="⬢"
        label="Productos activos"
        value={num(kpis.totalProductosActivos)}
        deltaClassName="delta"
        deltaText={`${num(kpis.totalProductosActivos)} SKUs registrados`}
        onClick={() => navigate('/app/inventario')}
      />
      <Kpi
        icon="⚠"
        label="A reabastecer"
        value={num(kpis.productosARestablecer)}
        deltaClassName={restCls}
        deltaText={restMsg}
        onClick={() => navigate('/app/inventario')}
      />
      <Kpi
        icon="✉"
        label="Órdenes pendientes"
        value={num(kpis.ordenesPendientes)}
        deltaClassName={pendCls}
        deltaText="esperando aprobación"
        onClick={() => navigate('/app/pedidos')}
      />
      <Kpi
        icon="$"
        label="Valor del inventario"
        value={money(kpis.valorInventario)}
        deltaClassName="delta"
        deltaText="stock × precio (activos)"
        onClick={() => navigate('/app/inventario')}
      />
    </div>
  );
}

interface KpiProps {
  icon: string;
  label: string;
  value: string;
  deltaClassName: string;
  deltaText: string;
  onClick?: () => void;
}

function Kpi({ icon, label, value, deltaClassName, deltaText, onClick }: KpiProps) {
  return (
    <div
      className="kpi"
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => { if (onClick && e.key === 'Enter') onClick(); }}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <div className="icon">{icon}</div>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className={deltaClassName}>{deltaText}</div>
    </div>
  );
}

function CriticosTable({ criticos }: { criticos: Producto[] }) {
  const navigate = useNavigate();

  if (!criticos.length) {
    return (
      <>
        <div className="card-title">
          <span>Productos a reabastecer</span>
        </div>
        <EmptyState message="Ningún producto cruzó su umbral de reabastecimiento." icon="✓" />
      </>
    );
  }

  return (
    <>
      <div className="card-title">
        <span>Productos a reabastecer</span>
        <span className="muted mono">{num(criticos.length)} en alerta · click para abrir el detalle</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Producto</th>
              <th>Categoría</th>
              <th style={{ textAlign: 'right' }}>Stock</th>
              <th style={{ textAlign: 'right' }}>Mínimo</th>
              <th>Estado</th>
              <th>Indicador</th>
            </tr>
          </thead>
          <tbody>
            {criticos.map((p) => {
              const stock = p.stock ?? 0;
              const min = p.stock_min ?? 0;
              const critical = stock < min;
              const ratio = min > 0 ? Math.min(1, stock / min) : 0;
              const meterCls = critical ? 'stock-meter crit' : 'stock-meter low';
              const goToDetalle = () => navigate(`/app/inventario?detalle=${encodeURIComponent(p.id)}`);

              return (
                <tr
                  key={p.id}
                  onClick={goToDetalle}
                  onKeyDown={(e) => { if (e.key === 'Enter') goToDetalle(); }}
                  tabIndex={0}
                  role="button"
                  style={{ cursor: 'pointer' }}
                  title={`Ver detalle de ${p.sku} en Inventario`}
                >
                  <td className="mono">{p.sku}</td>
                  <td>{p.nombre}</td>
                  <td>{p.categoria}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {num(stock)} {p.unidad}
                  </td>
                  <td className="mono muted" style={{ textAlign: 'right' }}>
                    {num(min)}
                  </td>
                  <td>
                    {critical ? (
                      <span className="badge danger">⚠ crítico</span>
                    ) : (
                      <span className="badge warning">reabastecer</span>
                    )}
                  </td>
                  <td>
                    <div className={meterCls}>
                      <div className="fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MovimientosFeed({ movimientos, onVerDetalle }: { movimientos: MovimientoConProducto[]; onVerDetalle: (productoId: string) => void }) {
  return (
    <>
      <div className="card-title">
        <span>Movimientos recientes</span>
        <span className="muted mono">últimos {movimientos.length}</span>
      </div>
      {movimientos.length === 0 ? (
        <EmptyState message="Sin movimientos registrados aún." icon="◇" />
      ) : (
        <div className="feed">
          {movimientos.map((m) => {
            const icon = MOV_ICON[m.tipo] ?? '◔';
            const label = MOV_LABEL[m.tipo] ?? m.tipo;
            const deltaTxt = m.delta > 0 ? `+${num(m.delta)}` : num(m.delta);
            const producto = m.producto;
            const titulo = producto
              ? `${label} · ${producto.sku} — ${producto.nombre}`
              : `${label} · producto eliminado`;
            const unidad = producto?.unidad ?? '';
            const verTraza = producto
              ? () => onVerDetalle(producto.id)
              : undefined;

            return (
              <div
                className="feed-item"
                key={m.id}
                onClick={verTraza}
                onKeyDown={verTraza ? (e) => { if (e.key === 'Enter') verTraza(); } : undefined}
                tabIndex={verTraza ? 0 : undefined}
                role={verTraza ? 'button' : undefined}
                style={verTraza ? { cursor: 'pointer' } : undefined}
                title={producto ? `Ver detalle y trazabilidad de ${producto.sku}` : undefined}
              >
                <div className="pin">{icon}</div>
                <div className="body">
                  <div className="title">{titulo}</div>
                  <div className="meta">
                    <span className="mono">{deltaTxt} {unidad}</span>
                    {' · '}
                    {relTime(m.at)}
                    {m.actor_name ? ` · ${m.actor_name}` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
