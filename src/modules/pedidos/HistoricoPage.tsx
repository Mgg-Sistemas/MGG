import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/shared/ui/EmptyState';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { dateTime, money, num } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { EstadoOrden, Orden, Proveedor } from '@/shared/lib/types';
import { listOrdenes, listProveedoresActivos } from './pedidos.repository';
import { MaterialesDemandaModal } from './MaterialesDemandaModal';
// descargarDetallePedidoPdf / descargarOrdenCompraPdf se importan dinámicamente (al generar) para no cargar jsPDF al abrir.

type FechaCampo = 'created_at' | 'aprobada_en' | 'oc_emitida_en' | 'finalizada_en';

const ESTADOS: Array<{ value: EstadoOrden; label: string }> = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'aprobada', label: 'Aprobada' },
  { value: 'oc_emitida', label: 'OC emitida' },
  { value: 'recibida', label: 'Recibida' },
  { value: 'finalizada', label: 'Finalizada' },
  { value: 'desistida_proveedor', label: 'Proveedor desistió' },
  { value: 'cancelada', label: 'Cancelada' },
];

const FECHA_CAMPOS: Array<{ value: FechaCampo; label: string }> = [
  { value: 'created_at', label: 'Creación' },
  { value: 'aprobada_en', label: 'Aprobación' },
  { value: 'oc_emitida_en', label: 'OC emitida' },
  { value: 'finalizada_en', label: 'Finalización' },
];

export function HistoricoPage() {
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros tipo "opciones"
  const [qFree, setQFree] = useState('');
  const [estadosSel, setEstadosSel] = useState<Set<EstadoOrden>>(new Set());
  const [fechaOpen, setFechaOpen] = useState(false);
  const [fechaCampo, setFechaCampo] = useState<FechaCampo>('created_at');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [sortDesc, setSortDesc] = useState(true);
  const [demandaOpen, setDemandaOpen] = useState(false);
  const [detalle, setDetalle] = useState<Orden | null>(null);   // pedido abierto en el modal de detalle

  const reload = useCallback(async () => {
    try {
      const [os, pvs] = await Promise.all([listOrdenes(), listProveedoresActivos()]);
      setOrdenes(os);
      setProveedores(pvs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar histórico');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  // Realtime: el histórico de compras se actualiza en vivo con cada orden/proveedor.
  useRealtime(['ordenes', 'proveedores'], reload);

  const proveedorMap = useMemo(
    () => new Map(proveedores.map((p) => [p.id, p])),
    [proveedores],
  );

  const filtered = useMemo(() => {
    const free = qFree.trim().toLowerCase();
    const desdeMs = desde ? new Date(desde + 'T00:00:00').getTime() : null;
    const hastaMs = hasta ? new Date(hasta + 'T23:59:59.999').getTime() : null;

    const rows = ordenes.filter((o) => {
      const prov = o.proveedor_id ? proveedorMap.get(o.proveedor_id) : null;

      if (estadosSel.size > 0 && !estadosSel.has(o.estado)) return false;

      if (desdeMs || hastaMs) {
        const raw = (o as unknown as Record<string, string | null | undefined>)[fechaCampo];
        if (!raw) return false;
        const ts = new Date(raw).getTime();
        if (desdeMs && ts < desdeMs) return false;
        if (hastaMs && ts > hastaMs) return false;
      }

      if (free) {
        const hay = [
          o.codigo, o.oc_codigo, o.solicitante, o.solicitante_email, o.ci_solicitante,
          o.notas, prov?.razon_social, prov?.rif, prov?.contacto,
          o.estado,
          o.total != null ? String(o.total) : null,
          ...o.items.map((it) => `${it.sku} ${it.nombre}`),
        ].map((v) => (v ?? '').toString().toLowerCase()).join(' | ');
        if (!hay.includes(free)) return false;
      }
      return true;
    });

    return rows.sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sortDesc ? tb - ta : ta - tb;
    });
  }, [ordenes, proveedorMap, qFree, estadosSel, fechaCampo, desde, hasta, sortDesc]);

  function toggleEstado(value: EstadoOrden) {
    setEstadosSel((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  const hasFiltro = Boolean(qFree.trim() || estadosSel.size > 0 || desde || hasta);

  function limpiar() {
    setQFree(''); setEstadosSel(new Set());
    setDesde(''); setHasta(''); setFechaOpen(false); setFechaCampo('created_at');
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Histórico de Pedidos / Compras</h1>
          <p className="muted">
            Busca por código de pedido, OC, usuario, proveedor, SKU o cualquier dato del registro.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => setDemandaOpen(true)}>📊 Materiales con más demanda</button>
          <Link to="/app/pedidos" className="btn btn-ghost">← Volver a Pedidos</Link>
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '1rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Barra de búsqueda central */}
      <div className="card" style={{ marginBottom: '1rem', padding: '1rem 1.25rem' }}>
        <div style={{ position: 'relative' }}>
          <input
            className="input"
            placeholder="🔎 Busca por OP, OC, usuario, proveedor, SKU, monto, nota… (cualquier cosa)"
            value={qFree}
            onChange={(e) => setQFree(e.target.value)}
            style={{ fontSize: '1rem', padding: '.75rem 1rem' }}
          />
        </div>

        {/* Chips de estado */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', marginTop: '.85rem' }}>
          {ESTADOS.map((s) => {
            const active = estadosSel.has(s.value);
            return (
              <button
                key={s.value}
                onClick={() => toggleEstado(s.value)}
                className={`chip${active ? ' chip-active' : ''}`}
                type="button"
              >
                {active && '✓ '}{s.label}
              </button>
            );
          })}
        </div>

        {/* Chip filtrar por fecha + chip ordenar + chip limpiar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', marginTop: '.6rem' }}>
          <button
            type="button"
            className={`chip${fechaOpen || desde || hasta ? ' chip-active' : ''}`}
            onClick={() => setFechaOpen((v) => !v)}
          >
            ⌚ Filtrar por fecha
            {(desde || hasta) && <span style={{ marginLeft: '.4rem', opacity: 0.85 }}>
              ({desde || '…'} → {hasta || '…'})
            </span>}
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => setSortDesc((v) => !v)}
            title="Cambiar orden cronológico"
          >
            {sortDesc ? '↓ Más reciente primero' : '↑ Más antigua primero'}
          </button>
          {hasFiltro && (
            <button type="button" className="chip chip-danger" onClick={limpiar}>
              ✕ Limpiar filtros
            </button>
          )}
          <span className="muted" style={{ fontSize: '.82rem', marginLeft: 'auto', alignSelf: 'center' }}>
            {filtered.length} resultado(s)
          </span>
        </div>

        {/* Panel desplegable de fecha (solo cuando se activa) */}
        {fechaOpen && (
          <div style={{ marginTop: '.85rem', padding: '.85rem', background: 'var(--bg-2)', borderRadius: 'var(--r-md)', display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: '.82rem' }}>Tipo de fecha:</span>
            {FECHA_CAMPOS.map((f) => (
              <button
                key={f.value}
                type="button"
                className={`chip${fechaCampo === f.value ? ' chip-active' : ''}`}
                onClick={() => setFechaCampo(f.value)}
              >
                {f.label}
              </button>
            ))}
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginLeft: 'auto' }}>
              <label className="muted" style={{ fontSize: '.82rem' }}>Desde</label>
              <input type="date" className="input" style={{ width: 160 }} value={desde} onChange={(e) => setDesde(e.target.value)} />
              <label className="muted" style={{ fontSize: '.82rem' }}>Hasta</label>
              <input type="date" className="input" style={{ width: 160 }} value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <EmptyState message="Cargando histórico…" icon="◔" />
      ) : !filtered.length ? (
        <div className="card">
          <EmptyState
            message={hasFiltro ? 'Sin coincidencias para los filtros aplicados.' : 'Aún no hay órdenes registradas.'}
            icon="◇"
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>OP</th>
                <th>OC</th>
                <th>Solicitante</th>
                <th>Proveedor</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Estado</th>
                <th>Fecha solicitud</th>
                <th>OC emitida</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const prov = o.proveedor_id ? proveedorMap.get(o.proveedor_id) : null;
                return (
                  <tr key={o.id} className="row-selectable" style={{ cursor: 'pointer' }} onClick={() => setDetalle(o)} title="Ver detalle e imprimir PDF">
                    <td className="mono"><strong>{o.codigo}</strong></td>
                    <td className="mono">
                      {o.oc_codigo
                        ? <span className="badge primary">{o.oc_codigo}</span>
                        : <span className="muted" style={{ fontSize: '.78rem' }}>—</span>}
                    </td>
                    <td>
                      <div>{o.solicitante ?? '—'}</div>
                    </td>
                    <td>{prov?.razon_social ?? '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(o.total)}</td>
                    <td><StatusBadge estado={o.estado} /></td>
                    <td className="muted" style={{ fontSize: '.82rem' }}>{dateTime(o.created_at)}</td>
                    <td className="muted" style={{ fontSize: '.82rem' }}>
                      {o.oc_emitida_en ? dateTime(o.oc_emitida_en) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {demandaOpen && (
        <MaterialesDemandaModal ordenes={ordenes} onClose={() => setDemandaOpen(false)} />
      )}

      {detalle && (
        <PedidoDetalleModal
          orden={detalle}
          proveedorNombre={detalle.proveedor_id ? (proveedorMap.get(detalle.proveedor_id)?.razon_social ?? null) : null}
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  );
}

/** Detalle de un pedido/compra (solo lectura) con impresión a PDF (vista previa). */
function PedidoDetalleModal({ orden, proveedorNombre, onClose }: {
  orden: Orden; proveedorNombre: string | null; onClose: () => void;
}) {
  const items = orden.items ?? [];
  const fila = (k: string, v: ReactNode) => (
    <div style={{ display: 'flex', gap: '.5rem', fontSize: '.85rem' }}>
      <span className="muted" style={{ minWidth: 130 }}>{k}</span>
      <span style={{ fontWeight: 500 }}>{v}</span>
    </div>
  );
  const motivo = (orden.motivo ?? orden.finalidad ?? '').trim();
  const notas = (orden.notas ?? '').trim();

  return (
    <Modal
      title={`Pedido ${orden.codigo}${orden.oc_codigo ? ` · OC ${orden.oc_codigo}` : ''}`}
      size="lg"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
          {orden.oc_codigo && (
            <button className="btn btn-ghost"
              onClick={() => void import('./ordenCompraPdf').then(({ descargarOrdenCompraPdf }) => descargarOrdenCompraPdf(orden.id)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'))}>
              📄 PDF Orden de Compra
            </button>
          )}
          <button className="btn btn-primary"
            onClick={() => void import('./historicoPedidoPdf').then(({ descargarDetallePedidoPdf }) => descargarDetallePedidoPdf(orden, proveedorNombre)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'))}>
            🖨 Imprimir PDF
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '.8rem' }}>
        <StatusBadge estado={orden.estado} />
        <span className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{money(orden.total)}</span>
      </div>

      <div className="card" style={{ padding: '.7rem .85rem', marginBottom: '.8rem', display: 'grid', gap: '.3rem' }}>
        {fila('Solicitante', orden.solicitante ?? orden.solicitante_email ?? '—')}
        {fila('Proveedor', proveedorNombre || '—')}
        {(orden.clasificacion ?? []).length > 0 && fila('Clasificación', (orden.clasificacion ?? []).join(', '))}
        {orden.condiciones_pago && fila('Condición de pago', orden.condiciones_pago)}
        {orden.almacen_destino && fila('Almacén destino', orden.almacen_destino)}
        {fila('Fecha solicitud', dateTime(orden.created_at))}
        {orden.aprobada_en && fila('Aprobada', dateTime(orden.aprobada_en))}
        {orden.oc_emitida_en && fila('OC emitida', dateTime(orden.oc_emitida_en))}
        {orden.finalizada_en && fila('Finalizada', dateTime(orden.finalizada_en))}
      </div>

      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.84rem' }}>
          <thead><tr>
            <th>SKU</th><th>Producto</th>
            <th style={{ textAlign: 'right' }}>Cantidad</th>
            <th style={{ textAlign: 'right' }}>Precio</th>
            <th style={{ textAlign: 'right' }}>Subtotal</th>
          </tr></thead>
          <tbody>
            {!items.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>Sin items</td></tr>}
            {items.map((it, i) => (
              <tr key={`${it.sku}-${i}`}>
                <td className="mono" style={{ fontSize: '.78rem' }}>{it.sku ?? '—'}</td>
                <td>{it.nombre ?? '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{num(it.cantidad)}{it.unidad ? ` ${it.unidad}` : ''}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(it.precio)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money((Number(it.cantidad) || 0) * (Number(it.precio) || 0))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>TOTAL</td>
            <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{money(orden.total)}</td>
          </tr></tfoot>
        </table>
      </div>

      {motivo && <div style={{ marginTop: '.8rem' }}><div className="muted" style={{ fontSize: '.78rem' }}>Motivo / finalidad</div><div style={{ fontSize: '.85rem' }}>{motivo}</div></div>}
      {notas && <div style={{ marginTop: '.6rem' }}><div className="muted" style={{ fontSize: '.78rem' }}>Notas</div><div style={{ fontSize: '.85rem' }}>{notas}</div></div>}
    </Modal>
  );
}
