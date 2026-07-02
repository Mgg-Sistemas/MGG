import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { RankedBarChart } from '@/shared/ui/Chart';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { money, num, date } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { listProductos } from '@/modules/inventario/inventario.repository';
import { listExistencias } from '@/modules/inventario/almacenes.repository';
import type { Producto, Existencia } from '@/shared/lib/types';
import {
  listVentas, crearVenta, actualizarVenta, emitirVenta, marcarPagada, anularVenta, eliminarVenta,
  calcItem, calcVenta, resumenVentas,
  type Venta, type VentaItem, type EstadoVenta,
} from './ventas.repository';
import { listClientes, crearCliente, actualizarCliente, eliminarCliente, type Cliente, type ClienteInput } from './clientes.repository';
// descargarFacturaPdf se importa dinámicamente (al generar) para no cargar jsPDF al abrir.

const ESTADO: Record<EstadoVenta, { label: string; color: string }> = {
  borrador: { label: '● Borrador', color: 'var(--muted)' },
  emitida: { label: '✔ Emitida', color: 'var(--primary-3)' },
  pagada: { label: '✓ Pagada', color: 'var(--success, #45c08a)' },
  anulada: { label: '✖ Anulada', color: 'var(--danger)' },
};

// Columnas tipo kanban (igual que Compras): una por estado, en orden de flujo.
const COLS_VENTAS: { key: EstadoVenta; label: string; accent: string }[] = [
  { key: 'borrador', label: 'Borrador', accent: 'var(--muted)' },
  { key: 'emitida', label: 'Emitida', accent: 'var(--primary-3)' },
  { key: 'pagada', label: 'Pagada', accent: 'var(--success, #45c08a)' },
  { key: 'anulada', label: 'Anulada', accent: 'var(--danger)' },
];

export function VentasPage() {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('ventas', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre?.trim() || user?.email || null;

  const [ventas, setVentas] = useState<Venta[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [existencias, setExistencias] = useState<Existencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<'nueva' | 'clientes' | 'reporte' | null>(null);
  const [editar, setEditar] = useState<Venta | null>(null);
  const [cobrar, setCobrar] = useState<Venta | null>(null);
  const [anular, setAnular] = useState<Venta | null>(null);
  const [vista, setVista] = useState<'tarjetas' | 'lista'>('tarjetas');

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [vs, cs, ps, ex] = await Promise.all([listVentas(), listClientes(), listProductos(), listExistencias()]);
      setVentas(vs); setClientes(cs); setProductos(ps); setExistencias(ex);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { cargar().catch((e) => toast(e instanceof Error ? e.message : 'Error al cargar', 'error')); }, [cargar]);
  useRealtime(['ventas', 'clientes', 'existencias', 'productos'], cargar);

  const resumen = useMemo(() => resumenVentas(ventas), [ventas]);
  const porEstado = useMemo(() => {
    const m = new Map<EstadoVenta, Venta[]>();
    COLS_VENTAS.forEach((c) => m.set(c.key, []));
    ventas.forEach((v) => m.get(v.estado)?.push(v));
    return m;
  }, [ventas]);

  async function emitir(v: Venta) {
    try { await emitirVenta(v, actor, actorName); notify(`Factura ${v.numero} emitida · stock descontado`, 'success', { link: '#/app/ventas' }); await cargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo emitir', 'error'); }
  }
  async function eliminar(v: Venta) {
    if (!window.confirm(`¿Eliminar el borrador ${v.numero}?`)) return;
    try { await eliminarVenta(v.id); toast('Borrador eliminado', 'success'); await cargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  const Kpi = ({ t, v, c, destacar }: { t: string; v: string; c?: string; destacar?: boolean }) => (
    <div className="card" style={destacar ? { borderColor: 'var(--primary)', background: 'linear-gradient(135deg, var(--surface-2), var(--surface))' } : undefined}>
      <div className="card-title"><span>{t}</span></div>
      <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: c }}>{v}</div>
    </div>
  );

  // Botones de acción de una factura (compartidos por tarjeta y lista).
  const Acciones = ({ v }: { v: Venta }) => (
    <>
      <button className="btn btn-sm btn-ghost" title="PDF" onClick={() => void import('./facturaPdf').then(({ descargarFacturaPdf }) => descargarFacturaPdf(v)).catch((e) => toast(e instanceof Error ? e.message : 'Error PDF', 'error'))}>↓ PDF</button>
      {canWrite && v.estado === 'borrador' && <button className="btn btn-sm btn-ghost" title="Editar" onClick={() => setEditar(v)}>✎</button>}
      {canWrite && v.estado === 'borrador' && <button className="btn btn-sm btn-primary" title="Emitir (descuenta stock)" onClick={() => void emitir(v)}>Emitir</button>}
      {canWrite && v.estado === 'borrador' && <button className="btn btn-sm btn-ghost" title="Eliminar" onClick={() => void eliminar(v)}>🗑</button>}
      {canWrite && v.estado === 'emitida' && <button className="btn btn-sm btn-primary" title="Registrar cobro" onClick={() => setCobrar(v)}>Cobrar</button>}
      {canWrite && (v.estado === 'emitida' || v.estado === 'pagada') && <button className="btn btn-sm btn-danger" title="Anular (revierte stock)" onClick={() => setAnular(v)}>Anular</button>}
    </>
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🧾 Ventas</h1>
          <p className="hint muted">Facturación de productos: clientes, precio, tenor (ley), costo y ganancia. Al emitir una factura se descuenta el stock del inventario.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <button className="btn btn-ghost" onClick={() => setModal('clientes')}>👤 Clientes</button>
        <button className="btn btn-ghost" onClick={() => setModal('reporte')}>📊 Reporte</button>
        {canWrite && <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setModal('nueva')}>+ Nueva venta</button>}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        <Kpi t="💰 Total vendido" v={money(resumen.totalVendido)} c="var(--primary-3)" destacar />
        <Kpi t="📈 Ganancia" v={money(resumen.ganancia)} c="var(--success, #45c08a)" />
        <Kpi t="% Ganancia" v={`${num(resumen.gananciaPct)}%`} />
        <Kpi t="🧾 Facturas" v={String(resumen.facturas)} />
        <Kpi t="⏳ Por cobrar" v={money(resumen.porCobrar)} c={resumen.porCobrar > 0 ? 'var(--danger)' : undefined} />
        <Kpi t="✓ Cobrado" v={money(resumen.cobrado)} c="var(--success, #45c08a)" />
      </div>

      {/* Toggle tarjetas / lista */}
      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', marginBottom: '.8rem' }}>
        <div className="view-toggle" role="tablist" aria-label="Modo de vista">
          <button className={vista === 'tarjetas' ? 'active' : ''} onClick={() => setVista('tarjetas')} title="Vista tarjetas">▦ Tarjetas</button>
          <button className={vista === 'lista' ? 'active' : ''} onClick={() => setVista('lista')} title="Vista lista">☰ Lista</button>
        </div>
        <span className="muted" style={{ fontSize: '.8rem' }}>{ventas.length} factura(s)</span>
      </div>

      {loading ? <EmptyState message="Cargando…" icon="◔" /> : !ventas.length ? (
        <EmptyState message="Sin facturas. Creá una con + Nueva venta." icon="🧾" />
      ) : vista === 'tarjetas' ? (
        /* Kanban tipo Compras: una columna por estado */
        <div className="kanban">
          {COLS_VENTAS.map((col) => {
            const items = porEstado.get(col.key) ?? [];
            return (
              <div className="kanban-col" data-state={col.key} key={col.key} style={{ '--col-accent': col.accent } as React.CSSProperties}>
                <div className="kanban-col-head">
                  <span className="title">{col.label}</span>
                  <span className="count">{items.length}</span>
                </div>
                <div className="kanban-col-body">
                  {items.length === 0 ? (
                    <div className="kanban-empty">Sin facturas</div>
                  ) : items.map((v) => (
                    <div className="kanban-card" key={v.id} style={{ cursor: 'default' }}>
                      <div className="code">{v.numero}</div>
                      <div className="prov">{v.cliente_nombre || 'Cliente ocasional'}</div>
                      <div className="meta">
                        <span>{date(v.fecha)}</span>
                        <span>{(v.items?.length ?? 0)} ítem{(v.items?.length ?? 0) !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="foot">
                        <span className="total">{money(v.total)}</span>
                        <span className="when" style={{ color: v.ganancia < 0 ? 'var(--danger)' : 'var(--success, #45c08a)' }}>
                          {money(v.ganancia)} · {num(v.ganancia_pct)}%
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25rem', marginTop: '.5rem' }}>
                        <Acciones v={v} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead>
              <tr>
                <th>N°</th><th>Fecha</th><th>Cliente</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Ganancia</th>
                <th style={{ textAlign: 'right' }}>%</th>
                <th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {ventas.map((v) => (
                <tr key={v.id}>
                  <td className="mono">{v.numero}</td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{date(v.fecha)}</td>
                  <td>{v.cliente_nombre || '—'}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{money(v.total)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--success, #45c08a)' }}>{money(v.ganancia)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(v.ganancia_pct)}%</td>
                  <td style={{ whiteSpace: 'nowrap', color: ESTADO[v.estado].color, fontWeight: 600 }}>{ESTADO[v.estado].label}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <Acciones v={v} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(modal === 'nueva' || editar) && (
        <VentaModal venta={editar} clientes={clientes} productos={productos} existencias={existencias}
          vendedorDefault={actorName ?? ''} actor={actor} actorName={actorName}
          onClose={() => { setModal(null); setEditar(null); }}
          onSaved={async () => { setModal(null); setEditar(null); await cargar(); }} />
      )}
      {modal === 'clientes' && <ClientesModal canWrite={canWrite} actor={actor} actorName={actorName} onClose={() => setModal(null)} onChanged={cargar} />}
      {modal === 'reporte' && <ReporteModal ventas={ventas} onClose={() => setModal(null)} />}

      {cobrar && <CobrarModal venta={cobrar} onClose={() => setCobrar(null)} onSaved={async () => { setCobrar(null); await cargar(); }} />}
      {anular && (
        <ConfirmDialog title={`Anular ${anular.numero}`}
          message={`¿Anular la factura ${anular.numero}? Si estaba emitida/pagada, se revierte el stock al inventario.`}
          confirmText="Anular" danger
          onConfirm={async () => { try { await anularVenta(anular, actor, actorName); notify(`Factura ${anular.numero} anulada`, 'info'); setAnular(null); await cargar(); } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo anular', 'error'); } }}
          onCancel={() => setAnular(null)} />
      )}
    </div>
  );
}

/* ───────────── Modal Nueva / Editar venta ───────────── */

interface FilaItem extends VentaItem { _k: number }

function VentaModal({ venta, clientes, productos, existencias, vendedorDefault, actor, actorName, onClose, onSaved }: {
  venta: Venta | null; clientes: Cliente[]; productos: Producto[]; existencias: Existencia[];
  vendedorDefault: string; actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const editando = !!venta;
  const [fecha, setFecha] = useState(venta?.fecha ?? new Date().toISOString().slice(0, 10));
  const [clienteId, setClienteId] = useState(venta?.cliente_id ?? '');
  const [clienteNombre, setClienteNombre] = useState(venta?.cliente_nombre ?? '');
  const [moneda, setMoneda] = useState(venta?.moneda ?? 'USD');
  const [descuento, setDescuento] = useState(String(venta?.descuento ?? 0));
  const [ivaPct, setIvaPct] = useState(String(venta?.iva_pct ?? 0));
  const [vendedor, setVendedor] = useState(venta?.vendedor ?? vendedorDefault);
  const [nota, setNota] = useState(venta?.nota ?? '');
  const [filas, setFilas] = useState<FilaItem[]>(() =>
    (venta?.items ?? []).length ? venta!.items.map((it, i) => ({ ...calcItem(it), _k: i })) : [{ ...calcItem({}), _k: 0 }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => filas.map((f) => calcItem(f)), [filas]);
  const totales = useMemo(() => calcVenta(items, Number(descuento) || 0, Number(ivaPct) || 0), [items, descuento, ivaPct]);

  function setFila(k: number, patch: Partial<VentaItem>) {
    setFilas((prev) => prev.map((f) => (f._k === k ? { ...calcItem({ ...f, ...patch }), _k: k } : f)));
  }
  function addFila() { setFilas((prev) => [...prev, { ...calcItem({}), _k: (prev.at(-1)?._k ?? 0) + 1 }]); }
  function delFila(k: number) { setFilas((prev) => prev.filter((f) => f._k !== k)); }

  // Al elegir producto, precarga unidad + costo (PMP) y AUTO-asigna el almacén con
  // MÁS stock (el "correspondiente"): la venta descuenta de ahí, sin pedir almacén.
  function elegirProducto(k: number, productoId: string) {
    const p = productos.find((x) => x.id === productoId);
    const exs = existencias
      .filter((e) => e.producto_id === productoId && (Number(e.stock) || 0) > 0)
      .sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0));
    const ex = exs[0];
    setFila(k, {
      producto_id: productoId, producto_nombre: p?.nombre ?? '', unidad: p?.unidad ?? null,
      almacen: ex?.almacen ?? '', costo_unit: Number(ex?.costo_promedio) || 0,
    });
  }

  function input(): Parameters<typeof crearVenta>[0] {
    return {
      fecha, cliente_id: clienteId || null, cliente_nombre: clienteNombre || (clientes.find((c) => c.id === clienteId)?.nombre ?? null),
      moneda, items, descuento: Number(descuento) || 0, iva_pct: Number(ivaPct) || 0, vendedor, nota,
    };
  }

  async function guardar(emitir: boolean) {
    setError(null);
    if (!clienteId && !clienteNombre.trim()) { setError('Elegí o escribí el cliente.'); return; }
    if (!items.some((i) => i.cantidad > 0 && i.precio_unit > 0)) { setError('Agregá al menos una línea con cantidad y precio.'); return; }
    setSaving(true);
    try {
      let v: Venta;
      if (editando) v = await actualizarVenta(venta!.id, input());
      else v = await crearVenta(input(), actor, actorName);
      if (emitir) { await emitirVenta(v, actor, actorName); notify(`Factura ${v.numero} emitida · stock descontado`, 'success', { link: '#/app/ventas' }); }
      else notify(`Factura ${v.numero} guardada (borrador)`, 'success', { link: '#/app/ventas' });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.'); setSaving(false); }
  }

  const cellNum: React.CSSProperties = { width: 84, textAlign: 'right' };
  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button className="btn btn-ghost" onClick={() => void guardar(false)} disabled={saving}>{saving ? '…' : 'Guardar borrador'}</button>
      <button className="btn btn-primary" onClick={() => void guardar(true)} disabled={saving}>{saving ? '…' : 'Emitir factura'}</button>
    </>
  );

  return (
    <Modal title={editando ? `Editar ${venta!.numero}` : 'Nueva venta'} size="xl" onClose={onClose} footer={footer}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

      <div className="form-grid" style={{ gap: '.6rem 1rem' }}>
        <div className="form-row">
          <label>Cliente</label>
          <SearchSelect value={clienteId} onChange={(id) => { setClienteId(id); setClienteNombre(clientes.find((c) => c.id === id)?.nombre ?? ''); }}
            options={clientes.filter((c) => c.activo).map((c) => ({ value: c.id, label: c.nombre }))}
            placeholder="🔎 Elegí el cliente…" emptyText="Sin clientes. Agregalos en 👤 Clientes." />
          <input className="input" style={{ marginTop: '.3rem' }} value={clienteNombre} onChange={(e) => { setClienteNombre(e.target.value); setClienteId(''); }} placeholder="…o escribí un cliente ocasional" />
        </div>
        <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        <div className="form-row"><label>Moneda</label>
          <select className="select" value={moneda} onChange={(e) => setMoneda(e.target.value)}>
            <option value="USD">USD</option><option value="Bs">Bs</option><option value="USDT">USDT</option><option value="COP">COP</option>
          </select>
        </div>
        <div className="form-row"><label>Vendedor</label><input className="input" value={vendedor} onChange={(e) => setVendedor(e.target.value)} /></div>
      </div>

      {/* Items */}
      <div className="table-wrap" style={{ marginTop: '.8rem' }}>
        <table className="table" style={{ fontSize: '.78rem' }}>
          <thead>
            <tr>
              <th style={{ minWidth: 220 }}>Producto</th>
              <th style={{ textAlign: 'right' }}>Cantidad</th>
              <th style={{ textAlign: 'right' }} title="Ley / tenor del mineral">Tenor %</th>
              <th style={{ textAlign: 'right' }}>Precio</th>
              <th style={{ textAlign: 'right' }} title="Costo unitario (PMP)">Costo</th>
              <th style={{ textAlign: 'right' }}>Subtotal</th>
              <th style={{ textAlign: 'right' }} title="Subtotal − Costo">Ganancia</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              // Stock total del producto (sumando todos los almacenes) — solo informativo.
              const stockTotal = existencias.filter((e) => e.producto_id === f.producto_id).reduce((a, e) => a + (Number(e.stock) || 0), 0);
              return (
                <tr key={f._k}>
                  <td>
                    <SearchSelect value={f.producto_id ?? ''} onChange={(id) => elegirProducto(f._k, id)}
                      options={productos.map((p) => ({ value: p.id, label: `${p.nombre}${p.sku ? ` (${p.sku})` : ''}` }))}
                      placeholder="🔎 Producto…" />
                    {f.producto_id && (
                      <small className="muted" style={{ display: 'block', marginTop: '.2rem' }}>
                        {f.almacen ? <>📦 {f.almacen} · stock {num(stockTotal)}</> : <span style={{ color: 'var(--danger)' }}>Sin stock en ningún almacén</span>}
                      </small>
                    )}
                  </td>
                  <td><input className="input mono" style={cellNum} type="number" min={0} step="any" value={f.cantidad || ''} onChange={(e) => setFila(f._k, { cantidad: Number(e.target.value) || 0 })} placeholder="0" /></td>
                  <td><input className="input mono" style={cellNum} type="number" min={0} step="any" value={f.tenor_pct || ''} onChange={(e) => setFila(f._k, { tenor_pct: Number(e.target.value) || 0 })} placeholder="0" /></td>
                  <td><input className="input mono" style={cellNum} type="number" min={0} step="any" value={f.precio_unit || ''} onChange={(e) => setFila(f._k, { precio_unit: Number(e.target.value) || 0 })} placeholder="0.00" /></td>
                  <td><input className="input mono" style={cellNum} type="number" min={0} step="any" value={f.costo_unit || ''} onChange={(e) => setFila(f._k, { costo_unit: Number(e.target.value) || 0 })} placeholder="0.00" /></td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{money(f.subtotal)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: f.ganancia < 0 ? 'var(--danger)' : 'var(--success, #45c08a)' }}>{money(f.ganancia)}</td>
                  <td><button className="btn btn-sm btn-ghost" onClick={() => delFila(f._k)} title="Quitar">✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button className="btn btn-sm btn-ghost" style={{ marginTop: '.4rem' }} onClick={addFila}>+ Agregar línea</button>

      {/* Totales */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
        <div style={{ minWidth: 280, display: 'grid', gap: '.35rem' }}>
          <Row l="Subtotal" v={money(totales.subtotal)} />
          <Row l="Descuento" v={<input className="input mono" type="number" min={0} step="any" value={descuento} onChange={(e) => setDescuento(e.target.value)} style={{ width: 110, textAlign: 'right' }} />} />
          <Row l="IVA %" v={<input className="input mono" type="number" min={0} step="any" value={ivaPct} onChange={(e) => setIvaPct(e.target.value)} style={{ width: 110, textAlign: 'right' }} />} />
          <Row l="IVA monto" v={money(totales.iva_monto)} />
          <Row l="TOTAL" v={<strong>{money(totales.total)}</strong>} big />
          <Row l="Costo" v={money(totales.costo_total)} muted />
          <Row l="Ganancia" v={<span style={{ color: 'var(--success, #45c08a)', fontWeight: 700 }}>{money(totales.ganancia)} ({num(totales.ganancia_pct)}%)</span>} />
        </div>
      </div>

      <div className="form-row" style={{ marginTop: '.6rem' }}>
        <label>Nota</label>
        <textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Opcional" />
      </div>
    </Modal>
  );
}

function Row({ l, v, big, muted }: { l: string; v: React.ReactNode; big?: boolean; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', fontSize: big ? '1.05rem' : '.85rem' }}>
      <span className={muted ? 'muted' : undefined} style={{ fontWeight: big ? 800 : 600 }}>{l}</span>
      <span className="mono">{v}</span>
    </div>
  );
}

/* ───────────── Cobrar ───────────── */

function CobrarModal({ venta, onClose, onSaved }: { venta: Venta; onClose: () => void; onSaved: () => void }) {
  const [metodo, setMetodo] = useState('Efectivo');
  const [monto, setMonto] = useState(String(venta.total));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    try { await marcarPagada(venta, metodo, Number(monto) || venta.total); toast('Cobro registrado', 'success'); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo registrar'); setSaving(false); }
  }
  return (
    <Modal title={`Cobrar ${venta.numero}`} size="md" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="cobrar-f" className="btn btn-primary" disabled={saving}>{saving ? '…' : 'Registrar cobro'}</button></>
    }>
      <form id="cobrar-f" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-row"><label>Método de pago</label>
          <select className="select" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
            <option>Efectivo</option><option>Transferencia</option><option>Pago móvil</option><option>USDT</option><option>Otro</option>
          </select>
        </div>
        <div className="form-row"><label>Monto cobrado ({venta.moneda})</label>
          <input className="input mono" type="number" min={0} step="any" value={monto} onChange={(e) => setMonto(e.target.value)} /></div>
      </form>
    </Modal>
  );
}

/* ───────────── Clientes ───────────── */

function ClientesModal({ canWrite, actor, actorName, onClose, onChanged }: {
  canWrite: boolean; actor: string; actorName: string | null; onClose: () => void; onChanged: () => void;
}) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [edit, setEdit] = useState<Cliente | 'nuevo' | null>(null);
  const cargar = useCallback(() => { listClientes().then(setClientes).catch(() => setClientes([])); }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useRealtime(['clientes'], cargar);

  async function borrar(c: Cliente) {
    if (!window.confirm(`¿Eliminar el cliente ${c.nombre}?`)) return;
    try { await eliminarCliente(c.id); toast('Cliente eliminado', 'success'); cargar(); onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  return (
    <Modal title="👤 Clientes" size="lg" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      {canWrite && <button className="btn btn-primary" onClick={() => setEdit('nuevo')}>+ Nuevo cliente</button>}</>
    }>
      {!clientes.length ? <EmptyState message="Sin clientes." icon="👤" /> : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead><tr><th>Nombre</th><th>RIF/CI</th><th>Teléfono</th><th>Email</th><th></th></tr></thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.nombre} {!c.activo && <span className="badge" style={{ fontSize: '.62rem' }}>inactivo</span>}</td>
                  <td className="mono">{c.rif || '—'}</td><td>{c.telefono || '—'}</td><td>{c.email || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setEdit(c)}>✎</button>}
                    {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => void borrar(c)}>🗑</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <ClienteForm cliente={edit === 'nuevo' ? null : edit} actor={actor} actorName={actorName}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); cargar(); onChanged(); }} />}
    </Modal>
  );
}

function ClienteForm({ cliente, actor, actorName, onClose, onSaved }: {
  cliente: Cliente | null; actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState<ClienteInput>({
    nombre: cliente?.nombre ?? '', rif: cliente?.rif ?? '', telefono: cliente?.telefono ?? '',
    email: cliente?.email ?? '', direccion: cliente?.direccion ?? '', activo: cliente?.activo ?? true, nota: cliente?.nota ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<ClienteInput>) => setF((prev) => ({ ...prev, ...p }));
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    try {
      if (cliente) await actualizarCliente(cliente.id, f);
      else await crearCliente(f, actor, actorName);
      toast('Cliente guardado', 'success'); onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }
  return (
    <Modal title={cliente ? `Editar ${cliente.nombre}` : 'Nuevo cliente'} size="md" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="cliente-f" className="btn btn-primary" disabled={saving}>{saving ? '…' : 'Guardar'}</button></>
    }>
      <form id="cliente-f" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-row"><label>Nombre / Razón social</label><input className="input" value={f.nombre} onChange={(e) => set({ nombre: e.target.value })} autoFocus required /></div>
        <div className="form-grid">
          <div className="form-row"><label>RIF / C.I.</label><input className="input" value={f.rif ?? ''} onChange={(e) => set({ rif: e.target.value })} /></div>
          <div className="form-row"><label>Teléfono</label><input className="input" value={f.telefono ?? ''} onChange={(e) => set({ telefono: e.target.value })} /></div>
          <div className="form-row"><label>Email</label><input className="input" type="email" value={f.email ?? ''} onChange={(e) => set({ email: e.target.value })} /></div>
          <div className="form-row"><label>Dirección</label><input className="input" value={f.direccion ?? ''} onChange={(e) => set({ direccion: e.target.value })} /></div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontSize: '.85rem' }}>
          <input type="checkbox" checked={f.activo ?? true} onChange={(e) => set({ activo: e.target.checked })} /> Cliente activo
        </label>
      </form>
    </Modal>
  );
}

/* ───────────── Reporte ───────────── */

function ReporteModal({ ventas, onClose }: { ventas: Venta[]; onClose: () => void }) {
  const vivas = ventas.filter((v) => v.estado === 'emitida' || v.estado === 'pagada');
  const porCliente = useMemo(() => {
    const m = new Map<string, number>();
    vivas.forEach((v) => m.set(v.cliente_nombre || '—', (m.get(v.cliente_nombre || '—') || 0) + (Number(v.total) || 0)));
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [vivas]);
  const porProducto = useMemo(() => {
    const m = new Map<string, number>();
    vivas.forEach((v) => (v.items ?? []).forEach((it) => m.set(it.producto_nombre || '—', (m.get(it.producto_nombre || '—') || 0) + (Number(it.subtotal) || 0))));
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [vivas]);

  return (
    <Modal title="📊 Reporte de ventas" size="lg" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <div className="card-title"><span>Ventas por cliente</span></div>
      <RankedBarChart data={porCliente} valueFormatter={(v) => money(v)} emptyMessage="Sin facturas emitidas." />
      <div className="card-title" style={{ marginTop: '1rem' }}><span>Ventas por producto</span></div>
      <RankedBarChart data={porProducto} valueFormatter={(v) => money(v)} emptyMessage="Sin facturas emitidas." />
    </Modal>
  );
}
