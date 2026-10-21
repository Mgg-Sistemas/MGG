import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/shared/ui/EmptyState';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { dateTime, money, num } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { AbonoCredito, EstadoOrden, Orden, Proveedor, Usuario } from '@/shared/lib/types';
import { comprobantePagoTesoreria, descargarAdjuntoOc, labelMetodoPago, listAbonos, listOrdenes, listProveedoresActivos, urlAdjuntoOc } from './pedidos.repository';
import { listUsuarios } from '@/modules/usuarios/usuarios.repository';
import { filtrarOrdenes, filtrarPorCreador, opcionesCreador } from './buscarOrdenes';
import { previewFileUrl } from '@/shared/lib/reportPreview';
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
  // Usuarios: para mostrar «KELVIN PEÑA» en vez del correo en «Realizada por» y
  // para que el buscador encuentre por el nombre (16-10-2026).
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros tipo "opciones"
  const [qFree, setQFree] = useState('');
  const [creadorSel, setCreadorSel] = useState('');   // correo del analista que creó la OC ('' = todos)
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
      const [os, pvs, usrs] = await Promise.all([
        listOrdenes(), listProveedoresActivos(), listUsuarios().catch(() => [] as Usuario[]),
      ]);
      setOrdenes(os);
      setProveedores(pvs);
      setUsuarios(usrs);
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

  // Correo → «Nombre Apellido»; si no está en usuarios, el propio correo lo muestra el desplegable.
  const nombreDeCorreo = useCallback(
    (email: string | null | undefined) => {
      const u = email ? usuarios.find((x) => x.email.toLowerCase() === email.toLowerCase()) : undefined;
      return u ? (`${u.nombre ?? ''} ${u.apellido ?? ''}`.trim() || u.email) : undefined;
    },
    [usuarios],
  );
  const creadores = useMemo(() => opcionesCreador(ordenes, nombreDeCorreo), [ordenes, nombreDeCorreo]);

  const filtered = useMemo(() => {
    const desdeMs = desde ? new Date(desde + 'T00:00:00').getTime() : null;
    const hastaMs = hasta ? new Date(hasta + 'T23:59:59.999').getTime() : null;

    const porOpciones = ordenes.filter((o) => {
      if (estadosSel.size > 0 && !estadosSel.has(o.estado)) return false;

      if (desdeMs || hastaMs) {
        const raw = (o as unknown as Record<string, string | null | undefined>)[fechaCampo];
        if (!raw) return false;
        const ts = new Date(raw).getTime();
        if (desdeMs && ts < desdeMs) return false;
        if (hastaMs && ts > hastaMs) return false;
      }
      return true;
    });

    // Buscador ampliado (16-10-2026): el MISMO buscador que el Kanban/Lista de Pedidos
    // (buscarOrdenes.ts): cualquier dato de la orden, sin acentos, varias palabras = todas.
    // Las filas ya están cargadas (listOrdenes trae todo), así que se filtra en cliente.
    const rows = filtrarOrdenes(filtrarPorCreador(porOpciones, creadorSel), qFree, {
      proveedor: (o) => (o.proveedor_id ? proveedorMap.get(o.proveedor_id) : undefined),
      labelMetodo: labelMetodoPago,
      nombreDe: nombreDeCorreo,
    });

    return rows.sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sortDesc ? tb - ta : ta - tb;
    });
  }, [ordenes, proveedorMap, nombreDeCorreo, qFree, creadorSel, estadosSel, fechaCampo, desde, hasta, sortDesc]);

  function toggleEstado(value: EstadoOrden) {
    setEstadosSel((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  const hasFiltro = Boolean(qFree.trim() || creadorSel || estadosSel.size > 0 || desde || hasta);

  function limpiar() {
    setQFree(''); setCreadorSel(''); setEstadosSel(new Set());
    setDesde(''); setHasta(''); setFechaOpen(false); setFechaCampo('created_at');
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Histórico de Pedidos / Compras</h1>
          <p className="hint muted">
            Busca por código de pedido, OC, usuario, proveedor, SKU, estado, monto, fecha, método de pago o cualquier dato del registro; y filtra por quién la realizó.
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
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="input"
            placeholder="🔎 Busca por OP, OC, usuario, proveedor, SKU, estado, monto, fecha, método de pago, nota… (cualquier cosa)"
            value={qFree}
            onChange={(e) => setQFree(e.target.value)}
            style={{ fontSize: '1rem', padding: '.75rem 1rem', flex: '1 1 320px' }}
          />
          {/* Realizada por (16-10-2026): el analista que creó la OC (o cargó la OP si aún no tiene OC). */}
          <select
            className="select"
            style={{ maxWidth: 260 }}
            value={creadorSel}
            onChange={(e) => setCreadorSel(e.target.value)}
            aria-label="Realizada por"
            title="Ver solo las órdenes realizadas por un usuario"
          >
            <option value="">Realizada por: todos los usuarios</option>
            {creadores.map((c) => (
              <option key={c.email} value={c.email}>{c.label}</option>
            ))}
          </select>
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

  // Adjuntos del pago (06-10-2026): el soporte que cargó Tesorería al pagar
  // (factura o nota) y los comprobantes de cada abono si la OC fue a crédito.
  // Estaban en Pedidos pero no en el Histórico: al buscar una OC vieja no había
  // forma de ver el papel del pago.
  const [abonos, setAbonos] = useState<AbonoCredito[]>([]);
  useEffect(() => {
    if (!orden.oc_codigo || !((Number(orden.abonado_total) || 0) > 0)) { setAbonos([]); return; }
    let vivo = true;
    listAbonos(orden.id).then((ab) => { if (vivo) setAbonos(ab.filter((b) => !!b.comprobante_path)); }).catch(() => {});
    return () => { vivo = false; };
  }, [orden.id, orden.oc_codigo, orden.abonado_total]);
  async function verAdjunto(path: string, nombre: string | null | undefined, titulo: string) {
    try { await previewFileUrl(await urlAdjuntoOc(path), nombre ?? 'adjunto', titulo); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir el adjunto', 'error'); }
  }

  return (
    <Modal
      title={`Pedido ${orden.codigo}${orden.oc_codigo ? ` · OC ${orden.oc_codigo}` : ''}`}
      size="lg"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
          <button className="btn btn-ghost"
            onClick={() => void import('./trazabilidadPdf').then(({ descargarTrazabilidadPdf }) => descargarTrazabilidadPdf(orden.id)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar la trazabilidad', 'error'))}>
            🧭 Trazabilidad
          </button>
          {orden.oc_codigo && (
            <button className="btn btn-ghost"
              onClick={() => void import('./ordenCompraPdf').then(({ descargarOrdenCompraPdf }) => descargarOrdenCompraPdf(orden.id)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'))}>
              📄 PDF Orden de Compra
            </button>
          )}
          {/* Comprobante de pago que adjuntó Tesorería (descarga directa) */}
          {orden.oc_codigo && (!!orden.pagada_en || orden.estado === 'finalizada' || (Number(orden.abonado_total) || 0) > 0) && (
            <button
              className="btn btn-ghost"
              onClick={async () => {
                try {
                  const adj = await comprobantePagoTesoreria(orden);
                  if (!adj) {
                    toast('Tesorería no adjuntó comprobante en este pago', 'info');
                    return;
                  }
                  await descargarAdjuntoOc(adj.path, adj.nombre);
                  toast('Descargando comprobante de Tesorería...', 'success');
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'No se pudo descargar el comprobante', 'error');
                }
              }}
              title="Descargar el comprobante de pago que adjuntó Tesorería"
            >
              📥 Comprobante de Tesorería
            </button>
          )}
          {/* Comprobante de pago (voucher, vista previa): solo si la OC tiene pago
              registrado —pagada o con abonos— (una cuenta a crédito sin abonos no tiene pago aún). */}
          {orden.oc_codigo && (!!orden.pagada_en || (Number(orden.abonado_total) || 0) > 0) && (
            <button className="btn btn-ghost"
              onClick={() => void import('./comprobantePagoPdf').then(({ descargarComprobantePagoPdf }) => descargarComprobantePagoPdf(orden.id)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el comprobante de pago', 'error'))}>
              🧾 Comprobante de pago
            </button>
          )}
          {/* Soporte adjunto (factura o nota de entrega / soporte adjunto de la OC). */}
          {orden.factura_path && (
            <button className="btn btn-ghost" onClick={() => void verAdjunto(orden.factura_path!, orden.factura_nombre, 'Comprobante de la OC')}
              title={orden.factura_nombre ?? 'Soporte adjunto de la OC'}>
              📎 {orden.estado === 'finalizada' ? 'Ver factura / soporte' : 'Ver adjunto de pago'}
            </button>
          )}
          {orden.pago_qr_path && (
            <button className="btn btn-ghost" onClick={() => void verAdjunto(orden.pago_qr_path!, orden.pago_qr_nombre, 'QR de pago')}
              title={orden.pago_qr_nombre ?? 'QR de pago'}>
              📎 QR de pago
            </button>
          )}
          {abonos.map((b, i) => (
            <button key={b.id} className="btn btn-ghost" onClick={() => void verAdjunto(b.comprobante_path!, b.comprobante_nombre, `Comprobante del abono ${i + 1}`)}
              title={b.comprobante_nombre ?? 'Comprobante del abono'}>
              📎 Abono {i + 1} · {money(b.monto, b.moneda)}
            </button>
          ))}
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
