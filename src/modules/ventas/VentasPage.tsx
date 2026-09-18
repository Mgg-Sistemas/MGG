import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { RankedBarChart } from '@/shared/ui/Chart';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { money, num, date, dateTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { listProductos } from '@/modules/inventario/inventario.repository';
import { listAlmacenes, listExistencias } from '@/modules/inventario/almacenes.repository';
import type { Almacen, Producto, Existencia } from '@/shared/lib/types';
import { almacenVentaInicial, almacenesDeVenta, existenciaEn, productosVendibles } from './almacenVenta';
import {
  listVentas, crearVenta, actualizarVenta, emitirVenta, marcarPagada, anularVenta, eliminarVenta,
  resumenVentas, esVentaACredito, esIntercambio, sincronizarCredito, saldoPorCobrar, efectosAnulacion,
  enviarAAutorizar, autorizarVenta, devolverVenta, puedeAutorizarVentas, nombreAutorizante, yaEmitida,
  type Venta, type VentaInput, type EstadoVenta,
} from './ventas.repository';
import {
  calcItem, calcVenta, impuestosAplicados, valorMaterial, costoUnitMaterial, errorIntercambio,
  diferenciasStock, cambiosVenta, nombreDocumento, nombreCondicion, r2,
  IVA_PCT_DEFECTO, IGTF_PCT_DEFECTO,
  type VentaItem, type PagoMaterial, type TipoDocumentoVenta, type CondicionPagoVenta, type EventoVenta,
} from './ventasLogica';
import { listCajasActivas } from '@/modules/salidas/cajas.repository';
import { listSaldos } from '@/modules/tesoreria/cajaSaldos.repository';
import type { Caja, CajaSaldo, CuentaCaja } from '@/shared/lib/types';
import type { CuentaPorCobrar } from '@/modules/tesoreria/cuentasPorCobrar.repository';
import { listClientes, crearCliente, actualizarCliente, eliminarCliente, type Cliente, type ClienteInput } from './clientes.repository';
// Los PDF se importan al generar (dinámico) para no cargar jsPDF al abrir la página.

const ESTADO: Record<EstadoVenta, { label: string; color: string }> = {
  borrador: { label: '● Borrador', color: 'var(--muted)' },
  por_aprobar: { label: '⏳ Por autorizar', color: 'var(--warning)' },
  aprobada: { label: '✔ Autorizada', color: 'var(--primary)' },
  emitida: { label: '✔ Emitida', color: 'var(--primary-3)' },
  pagada: { label: '✓ Pagada', color: 'var(--success, #45c08a)' },
  anulada: { label: '✖ Anulada', color: 'var(--danger)' },
};

// Columnas tipo kanban (igual que Compras): una por estado, en orden de flujo.
const COLS_VENTAS: { key: EstadoVenta; label: string; accent: string }[] = [
  { key: 'borrador', label: 'Borrador', accent: 'var(--muted)' },
  { key: 'por_aprobar', label: 'Por autorizar', accent: 'var(--warning)' },
  { key: 'aprobada', label: 'Autorizada', accent: 'var(--primary)' },
  { key: 'emitida', label: 'Emitida', accent: 'var(--primary-3)' },
  { key: 'pagada', label: 'Pagada', accent: 'var(--success, #45c08a)' },
  { key: 'anulada', label: 'Anulada', accent: 'var(--danger)' },
];

const pdf = () => import('./ventasPdf');
const errMsg = (e: unknown, def: string) => (e instanceof Error ? e.message : def);

/** Chip corto del documento (FAC / NE) para tarjetas y lista. */
function ChipDoc({ v }: { v: Pick<Venta, 'tipo_documento'> }) {
  const ne = v.tipo_documento === 'nota_entrega';
  return (
    <span className="badge" title={nombreDocumento(v.tipo_documento)}
      style={{ fontSize: '.62rem', borderColor: ne ? 'var(--muted)' : 'var(--primary)', color: ne ? 'var(--muted)' : 'var(--primary-3)' }}>
      {ne ? 'Nota de entrega' : 'Factura'}
    </span>
  );
}

export function VentasPage() {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('ventas', 'escritura');
  // Autorizan SOLO Leydis Rengel y Jesús Lozada (por correo, no por rol).
  const autoriza = puedeAutorizarVentas(user?.email);
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre?.trim() || user?.email || null;

  const [ventas, setVentas] = useState<Venta[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [existencias, setExistencias] = useState<Existencia[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [saldos, setSaldos] = useState<CajaSaldo[]>([]);
  // Estado en vivo de la cuenta por cobrar de cada venta a crédito.
  const [cxc, setCxc] = useState<Map<string, CuentaPorCobrar>>(new Map());
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<'nueva' | 'clientes' | 'reporte' | null>(null);
  const [editar, setEditar] = useState<Venta | null>(null);
  const [detalle, setDetalle] = useState<Venta | null>(null);
  const [cobrar, setCobrar] = useState<Venta | null>(null);
  const [anular, setAnular] = useState<Venta | null>(null);
  const [emitirConf, setEmitirConf] = useState<Venta | null>(null);
  const [eliminarConf, setEliminarConf] = useState<Venta | null>(null);
  const [enviarConf, setEnviarConf] = useState<Venta | null>(null);
  const [autorizarConf, setAutorizarConf] = useState<Venta | null>(null);
  const [devolver, setDevolver] = useState<Venta | null>(null);
  const [vista, setVista] = useState<'tarjetas' | 'lista'>('tarjetas');
  const [busca, setBusca] = useState('');
  const [filtroDoc, setFiltroDoc] = useState<'todos' | TipoDocumentoVenta>('todos');

  const cargar = useCallback(async () => {
    try {
      const [vs, cs, ps, ex, als, cjs, sds] = await Promise.all([
        listVentas(), listClientes(), listProductos(), listExistencias(), listAlmacenes(),
        listCajasActivas(), listSaldos(),
      ]);
      setClientes(cs); setProductos(ps); setExistencias(ex); setAlmacenes(als);
      setCajas(cjs); setSaldos(sds);
      // Las ventas a crédito se cobran en Tesorería: acá se leen sus cuentas y
      // la que ya quedó saldada pasa sola a «pagada».
      const cuentas = await sincronizarCredito(vs).catch(() => new Map<string, CuentaPorCobrar>());
      setCxc(cuentas);
      setVentas(vs.map((v) => {
        const c = v.cxc_id ? cuentas.get(v.cxc_id) : null;
        return c && v.estado === 'emitida' && c.estado === 'saldada' && Number(c.monto) > 0
          ? { ...v, estado: 'pagada' as EstadoVenta } : v;
      }));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { cargar().catch((e) => toast(errMsg(e, 'Error al cargar'), 'error')); }, [cargar]);
  useRealtime(
    ['ventas', 'clientes', 'existencias', 'productos', 'almacenes',
     'cuentas_por_cobrar', 'cuentas_por_cobrar_abonos', 'caja_saldos'],
    cargar,
  );
  // El detalle abierto sigue a la venta en vivo (otro usuario la edita o la cobra).
  useEffect(() => {
    if (detalle) { const v = ventas.find((x) => x.id === detalle.id); if (v && v.updated_at !== detalle.updated_at) setDetalle(v); }
  }, [ventas, detalle]);

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return ventas.filter((v) =>
      (filtroDoc === 'todos' || (v.tipo_documento ?? 'factura') === filtroDoc)
      && (!q || `${v.numero} ${v.cliente_nombre ?? ''} ${(v.items ?? []).map((i) => i.producto_nombre).join(' ')}`.toLowerCase().includes(q)));
  }, [ventas, busca, filtroDoc]);
  const resumen = useMemo(() => resumenVentas(visibles), [visibles]);
  const porEstado = useMemo(() => {
    const m = new Map<EstadoVenta, Venta[]>();
    COLS_VENTAS.forEach((c) => m.set(c.key, []));
    visibles.forEach((v) => m.get(v.estado)?.push(v));
    return m;
  }, [visibles]);

  async function confirmarEmitir(v: Venta) {
    try {
      const r = await emitirVenta(v, actor, actorName);
      notify(`${nombreDocumento(v.tipo_documento)} ${v.numero} emitida · inventario actualizado`, 'success', { link: '#/app/ventas' });
      setEmitirConf(null);
      if (r.estado === 'pagada') toast('El material cubrió el total: la venta quedó pagada', 'success');
      await cargar();
    } catch (e) { toast(errMsg(e, 'No se pudo emitir'), 'error'); }
  }
  async function confirmarEnviar(v: Venta) {
    try {
      await enviarAAutorizar(v, actor, actorName);
      notify(`${nombreDocumento(v.tipo_documento)} ${v.numero} por autorizar · Leydis Rengel / Jesús Lozada`, 'info', { link: '#/app/ventas' });
      setEnviarConf(null); await cargar();
    } catch (e) { toast(errMsg(e, 'No se pudo enviar'), 'error'); }
  }
  async function confirmarAutorizar(v: Venta) {
    try {
      await autorizarVenta(v, actor, actorName);
      notify(`${nombreDocumento(v.tipo_documento)} ${v.numero} autorizada · ya se puede emitir`, 'success', { link: '#/app/ventas' });
      setAutorizarConf(null); await cargar();
    } catch (e) { toast(errMsg(e, 'No se pudo autorizar'), 'error'); }
  }
  async function confirmarEliminar(v: Venta) {
    try { await eliminarVenta(v.id); toast('Borrador eliminado', 'success'); setEliminarConf(null); await cargar(); }
    catch (e) { toast(errMsg(e, 'No se pudo eliminar'), 'error'); }
  }

  const Kpi = ({ t, v, c, destacar }: { t: string; v: string; c?: string; destacar?: boolean }) => (
    <div className="card" style={destacar ? { borderColor: 'var(--primary)', background: 'linear-gradient(135deg, var(--surface-2), var(--surface))' } : undefined}>
      <div className="card-title"><span>{t}</span></div>
      <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: c }}>{v}</div>
    </div>
  );

  // Botones de acción de una venta (compartidos por tarjeta y lista).
  const Acciones = ({ v }: { v: Venta }) => {
    const falta = saldoPorCobrar(v);
    return (
      <>
        <button className="btn btn-sm btn-ghost" title="Detalle y trazabilidad" onClick={() => setDetalle(v)}>👁</button>
        <button className="btn btn-sm btn-ghost" title={`${nombreDocumento(v.tipo_documento)} en PDF (vista previa)`}
          onClick={() => void pdf().then((m) => m.verDocumentoVentaPdf(v)).catch((e) => toast(errMsg(e, 'Error PDF'), 'error'))}>↓ PDF</button>
        {canWrite && v.estado !== 'anulada' && <button className="btn btn-sm btn-ghost" title="Editar" onClick={() => setEditar(v)}>✎</button>}
        {canWrite && v.estado === 'borrador' && <button className="btn btn-sm btn-primary" title="Enviar a Leydis Rengel / Jesús Lozada" onClick={() => setEnviarConf(v)}>Enviar a autorizar</button>}
        {canWrite && v.estado === 'borrador' && <button className="btn btn-sm btn-ghost" title="Eliminar borrador" onClick={() => setEliminarConf(v)}>🗑</button>}
        {v.estado === 'por_aprobar' && (autoriza
          ? <button className="btn btn-sm btn-success" title="Autorizar la venta" onClick={() => setAutorizarConf(v)}>✔ Autorizar</button>
          : <span className="badge" style={{ fontSize: '.66rem', borderColor: 'var(--warning)', color: 'var(--warning)' }} title="La autorizan Leydis Rengel o Jesús Lozada">esperando autorización</span>)}
        {autoriza && (v.estado === 'por_aprobar' || v.estado === 'aprobada') && (
          <button className="btn btn-sm btn-ghost" title="Devolver a borrador para corregir" onClick={() => setDevolver(v)}>↩ Devolver</button>
        )}
        {canWrite && v.estado === 'aprobada' && <button className="btn btn-sm btn-primary" title="Emitir (mueve el inventario)" onClick={() => setEmitirConf(v)}>Emitir</button>}
        {/* A crédito no se cobra acá: el dinero (o el material) entra por Tesorería. */}
        {canWrite && v.estado === 'emitida' && !esVentaACredito(v) && falta > 0 && (
          <button className="btn btn-sm btn-primary" title="Registrar cobro (entra a caja)" onClick={() => setCobrar(v)}>
            {esIntercambio(v) ? 'Cobrar diferencia' : 'Cobrar'}
          </button>
        )}
        {v.estado === 'emitida' && esVentaACredito(v) && (
          <a className="btn btn-sm btn-ghost" href="#/app/tesoreria"
            title="Se cobra en Tesorería → Cuentas por cobrar, en dinero o en material">→ Cobrar en Tesorería</a>
        )}
        {canWrite && v.estado !== 'anulada' && v.estado !== 'borrador' && (
          <button className="btn btn-sm btn-danger" title="Anular (revierte inventario y dinero)" onClick={() => setAnular(v)}>Anular</button>
        )}
      </>
    );
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🧾 Ventas</h1>
          <p className="hint muted">Factura (con IVA e IGTF opcionales) o nota de entrega. Se cobra de contado, a crédito o con material (intercambio). Al emitir sale lo vendido del inventario y, si pagan con material, ese material entra.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <button className="btn btn-ghost" onClick={() => setModal('clientes')}>👤 Clientes</button>
        <button className="btn btn-ghost" onClick={() => setModal('reporte')}>📊 Reporte</button>
        {canWrite && <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setModal('nueva')}>+ Nueva venta</button>}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        <Kpi t="💰 Total vendido" v={money(resumen.totalVendido)} c="var(--primary-3)" destacar />
        <Kpi t="📈 Ganancia" v={money(resumen.ganancia)} c="var(--success, #45c08a)" />
        <Kpi t="% Ganancia" v={`${num(resumen.gananciaPct)}%`} />
        <Kpi t="🧾 Documentos" v={String(resumen.facturas)} />
        <Kpi t="⏳ Por cobrar" v={money(resumen.porCobrar)} c={resumen.porCobrar > 0 ? 'var(--danger)' : undefined} />
        <Kpi t="🧾 A crédito" v={money(resumen.aCredito)} c={resumen.aCredito > 0 ? 'var(--primary-3)' : undefined} />
        <Kpi t="✓ Cobrado" v={money(resumen.cobrado)} c="var(--success, #45c08a)" />
        <Kpi t="🏛 IVA + IGTF" v={money(resumen.impuestos)} />
        <Kpi t="⛏ Material recibido" v={money(resumen.materialRecibido)} />
      </div>

      {/* Filtros + toggle */}
      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', marginBottom: '.8rem', flexWrap: 'wrap' }}>
        <div className="view-toggle" role="tablist" aria-label="Modo de vista">
          <button className={vista === 'tarjetas' ? 'active' : ''} onClick={() => setVista('tarjetas')} title="Vista tarjetas">▦ Tarjetas</button>
          <button className={vista === 'lista' ? 'active' : ''} onClick={() => setVista('lista')} title="Vista lista">☰ Lista</button>
        </div>
        <div className="view-toggle" role="tablist" aria-label="Tipo de documento">
          {([['todos', 'Todos'], ['factura', 'Facturas'], ['nota_entrega', 'Notas de entrega']] as const).map(([k, l]) => (
            <button key={k} className={filtroDoc === k ? 'active' : ''} onClick={() => setFiltroDoc(k)}>{l}</button>
          ))}
        </div>
        <input className="input" style={{ maxWidth: 260 }} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔎 N°, cliente o producto…" />
        <span className="muted" style={{ fontSize: '.8rem' }}>{visibles.length} de {ventas.length}</span>
      </div>

      {loading ? <EmptyState message="Cargando…" icon="◔" /> : !visibles.length ? (
        <EmptyState message={ventas.length ? 'Ninguna venta coincide con el filtro.' : 'Sin ventas. Creá una con + Nueva venta.'} icon="🧾" />
      ) : vista === 'tarjetas' ? (
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
                    <div className="kanban-empty">Sin ventas</div>
                  ) : items.map((v) => (
                    <div className="kanban-card" key={v.id} style={{ cursor: 'default' }}>
                      <div className="code" style={{ display: 'flex', gap: '.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        {v.numero} <ChipDoc v={v} />
                      </div>
                      <div className="prov">{v.cliente_nombre || 'Cliente ocasional'}</div>
                      <div className="meta">
                        <span>{date(v.fecha)}</span>
                        <span>{nombreCondicion(v.condicion_pago)}</span>
                      </div>
                      <EstadoCredito venta={v} cuenta={v.cxc_id ? cxc.get(v.cxc_id) : undefined} />
                      <EstadoIntercambio venta={v} />
                      <div className="foot">
                        <span className="total">{money(v.total, v.moneda)}</span>
                        <span className="when" style={{ color: v.ganancia < 0 ? 'var(--danger)' : 'var(--success, #45c08a)' }}>
                          {money(v.ganancia, v.moneda)} · {num(v.ganancia_pct)}%
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
                <th>N°</th><th>Documento</th><th>Fecha</th><th>Cliente</th><th>Pago</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Ganancia</th>
                <th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((v) => (
                <tr key={v.id}>
                  <td className="mono">{v.numero}</td>
                  <td><ChipDoc v={v} /></td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{date(v.fecha)}</td>
                  <td>{v.cliente_nombre || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{nombreCondicion(v.condicion_pago)}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{money(v.total, v.moneda)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--success, #45c08a)' }}>{money(v.ganancia, v.moneda)} · {num(v.ganancia_pct)}%</td>
                  <td style={{ whiteSpace: 'nowrap', color: ESTADO[v.estado].color, fontWeight: 600 }}>{ESTADO[v.estado].label}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}><Acciones v={v} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(modal === 'nueva' || editar) && (
        <VentaModal venta={editar} clientes={clientes} productos={productos} existencias={existencias} almacenes={almacenes}
          vendedorDefault={actorName ?? ''} actor={actor} actorName={actorName} autoriza={autoriza}
          onClose={() => { setModal(null); setEditar(null); }}
          onSaved={async () => { setModal(null); setEditar(null); await cargar(); }} />
      )}
      {modal === 'clientes' && <ClientesModal canWrite={canWrite} actor={actor} actorName={actorName} onClose={() => setModal(null)} onChanged={cargar} />}
      {modal === 'reporte' && <ReporteModal ventas={ventas} onClose={() => setModal(null)} />}
      {detalle && <DetalleVentaModal venta={detalle} cuenta={detalle.cxc_id ? cxc.get(detalle.cxc_id) : undefined} onClose={() => setDetalle(null)} />}

      {cobrar && <CobrarModal venta={cobrar} cajas={cajas} saldos={saldos} actor={actor} actorName={actorName}
        onClose={() => setCobrar(null)} onSaved={async () => { setCobrar(null); await cargar(); }} />}
      {anular && <AnularModal venta={anular} actor={actor} actorName={actorName}
        onClose={() => setAnular(null)} onDone={async () => { setAnular(null); await cargar(); }} />}
      {emitirConf && (
        <ConfirmDialog title={`Emitir ${emitirConf.numero}`} message={resumenEmision(emitirConf)} confirmText="Emitir"
          onConfirm={() => void confirmarEmitir(emitirConf)} onCancel={() => setEmitirConf(null)} />
      )}
      {enviarConf && (
        <ConfirmDialog title={`Enviar ${enviarConf.numero} a autorizar`} confirmText="Enviar a autorizar"
          message={`La ${nombreDocumento(enviarConf.tipo_documento).toLowerCase()} ${enviarConf.numero} de ${enviarConf.cliente_nombre || 'cliente ocasional'} por ${money(enviarConf.total, enviarConf.moneda)} queda esperando la autorización de Leydis Rengel o Jesús Lozada.\n\nTodavía no mueve inventario ni dinero: eso pasa al emitirla, después de autorizada.`}
          onConfirm={() => void confirmarEnviar(enviarConf)} onCancel={() => setEnviarConf(null)} />
      )}
      {autorizarConf && (
        <ConfirmDialog title={`Autorizar ${autorizarConf.numero}`} confirmText="Autorizar" success
          message={`¿Autorizás la ${nombreDocumento(autorizarConf.tipo_documento).toLowerCase()} ${autorizarConf.numero}?\n\n${resumenEmision(autorizarConf)}\n\nQueda autorizada a tu nombre (${nombreAutorizante(actor)}). Después se emite y recién ahí se mueve el inventario.`}
          onConfirm={() => void confirmarAutorizar(autorizarConf)} onCancel={() => setAutorizarConf(null)} />
      )}
      {devolver && <DevolverModal venta={devolver} actor={actor} actorName={actorName}
        onClose={() => setDevolver(null)} onDone={async () => { setDevolver(null); await cargar(); }} />}
      {eliminarConf && (
        <ConfirmDialog title={`Eliminar ${eliminarConf.numero}`} danger confirmText="Eliminar borrador"
          message={`¿Eliminar el borrador ${eliminarConf.numero}? No movió inventario ni dinero, así que no hay nada que revertir.`}
          onConfirm={() => void confirmarEliminar(eliminarConf)} onCancel={() => setEliminarConf(null)} />
      )}
    </div>
  );
}

/** Texto de la confirmación de emitir: qué sale, qué entra y qué pasa con el cobro. */
function resumenEmision(v: Pick<Venta, 'tipo_documento' | 'items' | 'condicion_pago' | 'pago_material' | 'total' | 'moneda' | 'cliente_nombre' | 'valor_material'>): string {
  const lineas: string[] = [`Se emite la ${nombreDocumento(v.tipo_documento).toLowerCase()} por ${money(v.total, v.moneda)}.`];
  const items = (v.items ?? []).filter((i) => i.producto_id && Number(i.cantidad) > 0);
  if (items.length) lineas.push(`\nSale del inventario:\n${items.map((i) => `• ${num(i.cantidad)} ${i.unidad ?? ''} ${i.producto_nombre} (${i.almacen})`.replace(/\s+\(/, ' (')).join('\n')}`);
  if (v.condicion_pago === 'intercambio') {
    const mat = (v.pago_material ?? []).filter((p) => Number(p.cantidad) > 0);
    lineas.push(`\nEntra al inventario como pago:\n${mat.map((p) => `• ${num(p.cantidad)} ${p.unidad ?? ''} ${p.producto_nombre}${p.producto_id ? '' : ' (ficha nueva)'} → ${p.almacen} · ${money(p.valor, v.moneda)}`).join('\n')}`);
    const dif = r2(Number(v.total) - valorMaterial(mat));
    lineas.push(dif > 0 ? `\nQueda por cobrar en dinero: ${money(dif, v.moneda)}.` : '\nEl material cubre el total: la venta queda pagada.');
  } else if (v.condicion_pago === 'credito') {
    lineas.push(`\nSe crea la cuenta por cobrar a ${v.cliente_nombre ?? 'el cliente'} por ${money(v.total, v.moneda)}.`);
  } else {
    lineas.push('\nDespués se cobra con «Cobrar» y el dinero entra a la caja que elijas.');
  }
  return lineas.join('\n');
}

/* ───────────── Modal Nueva / Editar venta ───────────── */

interface FilaItem extends VentaItem { _k: number }
interface FilaMaterial extends PagoMaterial { _k: number; nuevo: boolean }

function VentaModal({ venta, clientes, productos, existencias, almacenes, vendedorDefault, actor, actorName, autoriza, onClose, onSaved }: {
  venta: Venta | null; clientes: Cliente[]; productos: Producto[]; existencias: Existencia[]; almacenes: Almacen[];
  vendedorDefault: string; actor: string; actorName: string | null; autoriza: boolean; onClose: () => void; onSaved: () => void;
}) {
  const editando = !!venta;
  // «emitida» = ya movió inventario o dinero (emitida o pagada): ahí se edita con motivo.
  const emitida = !!venta && yaEmitida(venta);
  // En autorización (por autorizar / autorizada): se edita libre, pero si estaba
  // autorizada vuelve a autorización.
  const enAutorizacion = !!venta && (venta.estado === 'por_aprobar' || venta.estado === 'aprobada');
  const [tipo, setTipo] = useState<TipoDocumentoVenta>(venta?.tipo_documento ?? 'factura');
  const [fecha, setFecha] = useState(venta?.fecha ?? new Date().toISOString().slice(0, 10));
  // La venta sale de UN almacén: por defecto el padre de Matanza.
  const [almacen, setAlmacen] = useState(() => venta?.items?.[0]?.almacen || almacenVentaInicial(almacenes));
  const [clienteId, setClienteId] = useState(venta?.cliente_id ?? '');
  const [clienteNombre, setClienteNombre] = useState(venta?.cliente_nombre ?? '');
  const [moneda, setMoneda] = useState(venta?.moneda ?? 'USD');
  const [condicion, setCondicion] = useState<CondicionPagoVenta>(venta?.condicion_pago ?? 'contado');
  const [descuento, setDescuento] = useState(String(venta?.descuento ?? 0));
  const [aplicaIva, setAplicaIva] = useState(venta ? !!venta.aplica_iva || Number(venta.iva_pct) > 0 : false);
  const [ivaPct, setIvaPct] = useState(String(Number(venta?.iva_pct) || IVA_PCT_DEFECTO));
  const [aplicaIgtf, setAplicaIgtf] = useState(venta ? !!venta.aplica_igtf || Number(venta.igtf_pct) > 0 : false);
  const [igtfPct, setIgtfPct] = useState(String(Number(venta?.igtf_pct) || IGTF_PCT_DEFECTO));
  const [vendedor, setVendedor] = useState(venta?.vendedor ?? vendedorDefault);
  const [nota, setNota] = useState(venta?.nota ?? '');
  const [motivo, setMotivo] = useState('');
  const [filas, setFilas] = useState<FilaItem[]>(() =>
    (venta?.items ?? []).length ? venta!.items.map((it, i) => ({ ...calcItem(it), _k: i })) : [{ ...calcItem({}), _k: 0 }]);
  const [material, setMaterial] = useState<FilaMaterial[]>(() =>
    (venta?.pago_material ?? []).map((p, i) => ({ ...p, _k: i, nuevo: !p.producto_id })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<'enviar' | 'autorizar' | 'guardar' | null>(null);

  const gruposAlmacen = useMemo(() => almacenesDeVenta(almacenes), [almacenes]);
  // Solo se ofrece lo que se puede despachar: ficha activa y con stock en ese almacén.
  // Al editar una emitida, lo ya vendido cuenta como disponible (vuelve si se quita).
  const vendibles = useMemo(() => {
    const base = productosVendibles(productos, existencias, almacen);
    if (!emitida) return base;
    const ya = new Set((venta?.items ?? []).map((i) => i.producto_id));
    return [...base, ...productos.filter((p) => ya.has(p.id) && !base.some((b) => b.id === p.id))];
  }, [productos, existencias, almacen, emitida, venta]);
  const productosActivos = useMemo(() => productos.filter((p) => p.estado !== 'inactivo'), [productos]);
  const almacenFueraDeLista = !!almacen && !gruposAlmacen.some(([, ds]) => ds.some((d) => d.nombre === almacen));

  const items = useMemo(() => filas.map((f) => calcItem(f)), [filas]);
  const imp = impuestosAplicados({ tipo, aplicaIva, ivaPct: Number(ivaPct) || 0, aplicaIgtf, igtfPct: Number(igtfPct) || 0 });
  const totales = useMemo(() => calcVenta(items, Number(descuento) || 0, imp.iva_pct, imp.igtf_pct), [items, descuento, imp.iva_pct, imp.igtf_pct]);
  const valorMat = valorMaterial(material);
  const errInter = condicion === 'intercambio' ? errorIntercambio(totales.total, material) : null;

  function setFila(k: number, patch: Partial<VentaItem>) {
    setFilas((prev) => prev.map((f) => (f._k === k ? { ...calcItem({ ...f, ...patch }), _k: k } : f)));
  }
  function addFila() { setFilas((prev) => [...prev, { ...calcItem({ almacen }), _k: (prev.at(-1)?._k ?? 0) + 1 }]); }
  function delFila(k: number) { setFilas((prev) => prev.filter((f) => f._k !== k)); }

  function setMat(k: number, patch: Partial<FilaMaterial>) {
    setMaterial((prev) => prev.map((m) => (m._k === k ? { ...m, ...patch } : m)));
  }
  function addMat() {
    setMaterial((prev) => [...prev, {
      _k: (prev.at(-1)?._k ?? 0) + 1, nuevo: false, producto_id: null, producto_nombre: '', unidad: null,
      almacen: almacen || almacenVentaInicial(almacenes), cantidad: 0, valor: 0,
    }]);
  }

  // Al elegir producto precarga unidad y costo (PMP) DEL ALMACÉN de la venta.
  function elegirProducto(k: number, productoId: string) {
    const p = productos.find((x) => x.id === productoId);
    const ex = existenciaEn(existencias, productoId, almacen);
    setFila(k, { producto_id: productoId, producto_nombre: p?.nombre ?? '', unidad: p?.unidad ?? null, almacen, costo_unit: ex.costo });
  }

  /** Cambiar de almacén re-apunta los renglones y les recalcula el costo de ahí. */
  function cambiarAlmacen(nuevo: string) {
    setAlmacen(nuevo);
    setFilas((prev) => prev.map((f) => ({
      ...calcItem({ ...f, almacen: nuevo, costo_unit: f.producto_id ? existenciaEn(existencias, f.producto_id, nuevo).costo : f.costo_unit }),
      _k: f._k,
    })));
  }

  function input(): VentaInput {
    return {
      fecha, tipo_documento: tipo,
      cliente_id: clienteId || null, cliente_nombre: clienteNombre || (clientes.find((c) => c.id === clienteId)?.nombre ?? null),
      moneda, items, descuento: Number(descuento) || 0,
      aplica_iva: aplicaIva, iva_pct: Number(ivaPct) || 0, aplica_igtf: aplicaIgtf, igtf_pct: Number(igtfPct) || 0,
      condicion_pago: condicion,
      pago_material: material.map(({ _k: _omit, nuevo, ...p }) => ({ ...p, producto_id: nuevo ? null : p.producto_id })),
      vendedor, nota,
    };
  }

  function validar(): string | null {
    if (!clienteId && !clienteNombre.trim()) return 'Elegí o escribí el cliente.';
    if (!items.some((i) => i.cantidad > 0 && i.precio_unit > 0)) return 'Agregá al menos una línea con cantidad y precio.';
    if (items.some((i) => i.cantidad > 0 && !i.producto_id)) return 'Cada línea tiene que tener un producto.';
    if (errInter) return errInter;
    if (emitida && motivo.trim().length < 4) return 'Escribí el motivo del cambio: la venta ya está emitida y queda en la trazabilidad.';
    return null;
  }

  function pedir(accion: 'enviar' | 'autorizar' | 'guardar') {
    setError(null);
    const e = validar();
    if (e) { setError(e); return; }
    // Guardar un borrador o una venta en autorización no mueve nada: sin confirmación.
    if (accion === 'guardar' && !emitida && !(enAutorizacion && venta?.estado === 'aprobada')) { void guardar('guardar'); return; }
    setConfirmar(accion);
  }

  /**
   * guardar = solo guarda · enviar = guarda y la manda a autorizar ·
   * autorizar = (solo Leydis / Jesús) guarda, autoriza y emite en un paso.
   */
  async function guardar(accion: 'enviar' | 'autorizar' | 'guardar') {
    setSaving(true); setConfirmar(null);
    try {
      let v: Venta;
      if (editando) v = await actualizarVenta(venta!, input(), actor, actorName, motivo);
      else v = await crearVenta(input(), actor, actorName);
      if (accion === 'enviar' || accion === 'autorizar') {
        if (v.estado === 'borrador') v = await enviarAAutorizar(v, actor, actorName);
      }
      if (accion === 'autorizar') {
        if (v.estado === 'por_aprobar') v = await autorizarVenta(v, actor, actorName);
        const r = await emitirVenta(v, actor, actorName);
        notify(`${nombreDocumento(v.tipo_documento)} ${v.numero} autorizada y emitida · inventario actualizado`, 'success', { link: '#/app/ventas' });
        if (r.estado === 'pagada') toast('El material cubrió el total: la venta quedó pagada', 'success');
      } else if (accion === 'enviar') {
        notify(`${nombreDocumento(v.tipo_documento)} ${v.numero} por autorizar · Leydis Rengel / Jesús Lozada`, 'info', { link: '#/app/ventas' });
      } else {
        notify(emitida ? `${v.numero} editada · inventario ajustado por la diferencia`
          : v.estado === 'por_aprobar' && venta?.estado === 'aprobada' ? `${v.numero} editada · vuelve a autorización`
          : `${nombreDocumento(v.tipo_documento)} ${v.numero} guardada`, 'success', { link: '#/app/ventas' });
      }
      onSaved();
    } catch (e) { setError(errMsg(e, 'No se pudo guardar.')); setSaving(false); }
  }

  // Lo que se va a mover al guardar una emitida (para la confirmación).
  const resumenEdicion = useMemo(() => {
    if (!emitida || !venta) return '';
    const inp = input();
    const vend = diferenciasStock(venta.items ?? [], items);
    const mat = condicion === 'intercambio' ? diferenciasStock(venta.pago_material ?? [], (inp.pago_material ?? []).filter((p) => p.producto_id)) : [];
    const nuevos = condicion === 'intercambio' ? (inp.pago_material ?? []).filter((p) => !p.producto_id && Number(p.cantidad) > 0) : [];
    const cambios = cambiosVenta(venta, { ...inp, total: totales.total, iva_pct: imp.iva_pct, igtf_pct: imp.igtf_pct });
    const l: string[] = [];
    l.push(cambios.length ? `Cambios:\n${cambios.map((c) => `• ${c}`).join('\n')}` : 'No hay cambios.');
    const mov = [
      ...vend.map((d) => `• ${d.delta > 0 ? 'Sale' : 'Vuelve'} ${num(Math.abs(d.delta))} ${d.producto_nombre} (${d.almacen})`),
      ...mat.map((d) => `• Material: ${d.delta > 0 ? 'entra' : 'sale'} ${num(Math.abs(d.delta))} ${d.producto_nombre} (${d.almacen})`),
      ...nuevos.map((p) => `• Material nuevo: entra ${num(p.cantidad)} ${p.producto_nombre} (${p.almacen})`),
    ];
    l.push(mov.length ? `\nInventario (solo la diferencia):\n${mov.join('\n')}` : '\nEl inventario no cambia.');
    if (r2(totales.total) !== r2(venta.total)) {
      if (condicion === 'credito') l.push(`\nLa cuenta por cobrar pasa de ${money(venta.total, moneda)} a ${money(totales.total, moneda)}.`);
      else if (venta.caja_id && venta.estado === 'pagada') l.push('\nLa diferencia de dinero entra o sale de la caja donde se cobró.');
    }
    l.push(`\nMotivo: ${motivo.trim()}`);
    return l.join('\n');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emitida, venta, items, material, condicion, totales.total, motivo, imp.iva_pct, imp.igtf_pct]);

  const cellNum: React.CSSProperties = { width: 84, textAlign: 'right' };
  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      {emitida || enAutorizacion ? (
        <button className="btn btn-primary" onClick={() => pedir('guardar')} disabled={saving}>{saving ? '…' : 'Guardar cambios'}</button>
      ) : (
        <>
          <button className="btn btn-ghost" onClick={() => pedir('guardar')} disabled={saving}>{saving ? '…' : 'Guardar borrador'}</button>
          <button className="btn btn-primary" onClick={() => pedir('enviar')} disabled={saving}
            title="La autorizan Leydis Rengel o Jesús Lozada">{saving ? '…' : 'Enviar a autorizar'}</button>
          {autoriza && (
            <button className="btn btn-success" onClick={() => pedir('autorizar')} disabled={saving}
              title="Solo Leydis Rengel / Jesús Lozada: autoriza y emite en un paso">{saving ? '…' : 'Autorizar y emitir'}</button>
          )}
        </>
      )}
    </>
  );

  return (
    <Modal title={editando ? `Editar ${venta!.numero}` : 'Nueva venta'} size="xl" onClose={onClose} footer={footer}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
      {enAutorizacion && (
        <div className="card" style={{ borderLeft: '3px solid var(--warning)', padding: '.55rem .8rem', marginBottom: '.75rem', fontSize: '.84rem' }}>
          {venta!.estado === 'aprobada'
            ? <>Esta venta ya está <strong>autorizada</strong> por {nombreAutorizante(venta!.aprobada_por)}. Si la cambiás, <strong>vuelve a autorización</strong>.</>
            : <>Esta venta está <strong>esperando autorización</strong>. Podés corregirla: la autorización se hace sobre lo último que guardes.</>}
        </div>
      )}
      {emitida && (
        <div className="card" style={{ borderLeft: '3px solid var(--warning)', padding: '.55rem .8rem', marginBottom: '.75rem', fontSize: '.84rem' }}>
          Esta venta ya está <strong>{venta!.estado}</strong>. Al guardar, el inventario se mueve <strong>solo por la diferencia</strong>
          {condicion === 'credito' ? ', la cuenta por cobrar se ajusta al nuevo total' : venta!.caja_id ? ' y la diferencia de dinero entra o sale de la caja donde se cobró' : ''}.
          El documento y la forma de pago no se cambian: para eso se anula y se hace otra.
        </div>
      )}

      {/* Documento */}
      <div className="form-row">
        <label>Tipo de documento</label>
        <div className="view-toggle" role="tablist" aria-label="Tipo de documento" style={{ width: 'fit-content' }}>
          <button type="button" className={tipo === 'factura' ? 'active' : ''} disabled={emitida || enAutorizacion} onClick={() => setTipo('factura')}>🧾 Factura</button>
          <button type="button" className={tipo === 'nota_entrega' ? 'active' : ''} disabled={emitida || enAutorizacion} onClick={() => setTipo('nota_entrega')}>📄 Nota de entrega</button>
        </div>
        <small className="muted">{tipo === 'nota_entrega' ? 'Sin impuestos. Correlativo NE-AAAA-NNNN.' : 'IVA e IGTF opcionales con su casilla. Correlativo FAC-AAAA-NNNN.'}</small>
      </div>

      <div className="form-grid" style={{ gap: '.6rem 1rem' }}>
        <div className="form-row">
          <label>Cliente</label>
          <SearchSelect value={clienteId} onChange={(id) => { setClienteId(id); setClienteNombre(clientes.find((c) => c.id === id)?.nombre ?? ''); }}
            options={clientes.filter((c) => c.activo).map((c) => ({ value: c.id, label: c.nombre }))}
            placeholder="🔎 Elegí el cliente…" emptyText="Sin clientes. Agregalos en 👤 Clientes." />
          <input className="input" style={{ marginTop: '.3rem' }} value={clienteNombre} onChange={(e) => { setClienteNombre(e.target.value); setClienteId(''); }} placeholder="…o escribí un cliente ocasional" />
        </div>
        <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        <div className="form-row">
          <label>Almacén (de dónde sale)</label>
          <select className="select" value={almacen} onChange={(e) => cambiarAlmacen(e.target.value)}>
            {almacenFueraDeLista && <optgroup label="Almacén actual"><option value={almacen}>{almacen}</option></optgroup>}
            {gruposAlmacen.map(([sede, destinos]) => (
              <optgroup key={sede} label={sede}>
                {destinos.map((d) => <option key={d.nombre} value={d.nombre}>{d.label}</option>)}
              </optgroup>
            ))}
          </select>
          <small className="muted">Solo se listan los productos con stock acá.</small>
        </div>
        <div className="form-row"><label>Moneda</label>
          <select className="select" value={moneda} onChange={(e) => setMoneda(e.target.value)}>
            <option value="USD">USD</option><option value="Bs">Bs</option><option value="USDT">USDT</option><option value="COP">COP</option>
          </select>
        </div>
        <div className="form-row">
          <label>Forma de pago</label>
          <select className="select" value={condicion} disabled={emitida} onChange={(e) => setCondicion(e.target.value as CondicionPagoVenta)}>
            <option value="contado">Contado — se cobra y entra a caja</option>
            <option value="credito">Crédito — queda como cuenta por cobrar</option>
            <option value="intercambio">Intercambio — paga con material</option>
          </select>
          <small className="muted">
            {condicion === 'credito' ? 'Al emitir se crea la cuenta por cobrar. Se cobra en Tesorería, en dinero o en material.'
              : condicion === 'intercambio' ? 'Al emitir sale lo vendido y ENTRA el material que entrega el cliente. Si no cubre el total, la diferencia se cobra en caja.'
              : 'Al cobrarla elegís la caja donde entra el dinero.'}
          </small>
        </div>
        <div className="form-row"><label>Vendedor</label><input className="input" value={vendedor} onChange={(e) => setVendedor(e.target.value)} /></div>
      </div>

      {/* Productos vendidos */}
      <div className="card-title" style={{ marginTop: '.8rem' }}><span>📦 Productos vendidos (salen del inventario)</span></div>
      <div className="table-wrap">
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
              const stockAqui = existenciaEn(existencias, f.producto_id, almacen).stock;
              return (
                <tr key={f._k}>
                  <td>
                    <SearchSelect value={f.producto_id ?? ''} onChange={(id) => elegirProducto(f._k, id)}
                      options={vendibles.map((p) => ({ value: p.id, label: `${p.nombre}${p.sku ? ` (${p.sku})` : ''}` }))}
                      placeholder="🔎 Producto…" emptyText={`Sin productos con stock en ${almacen || 'este almacén'}.`} />
                    {f.producto_id && (
                      <small className="muted" style={{ display: 'block', marginTop: '.2rem' }}>
                        {stockAqui > 0 ? <>📦 {almacen} · stock {num(stockAqui)}</> : <span style={{ color: 'var(--danger)' }}>Sin stock en {almacen || 'el almacén elegido'}</span>}
                      </small>
                    )}
                  </td>
                  <td><input className="input mono" style={cellNum} type="number" min={0} step="any" value={f.cantidad || ''} onChange={(e) => setFila(f._k, { cantidad: Number(e.target.value) || 0 })} placeholder="0" /></td>
                  <td><input className="input mono" style={cellNum} type="number" min={0} step="any" value={f.tenor_pct || ''} onChange={(e) => setFila(f._k, { tenor_pct: Number(e.target.value) || 0 })} placeholder="0" /></td>
                  <td><input className="input mono" style={cellNum} type="number" min={0} step="any" value={f.precio_unit || ''} onChange={(e) => setFila(f._k, { precio_unit: Number(e.target.value) || 0 })} placeholder="0.00" /></td>
                  <td><input className="input mono" style={cellNum} type="number" min={0} step="any" value={f.costo_unit || ''} onChange={(e) => setFila(f._k, { costo_unit: Number(e.target.value) || 0 })} placeholder="0.00" /></td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{money(f.subtotal, moneda)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: f.ganancia < 0 ? 'var(--danger)' : 'var(--success, #45c08a)' }}>{money(f.ganancia, moneda)}</td>
                  <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => delFila(f._k)} title="Quitar">✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: '.4rem' }} onClick={addFila}>+ Agregar línea</button>

      {/* Material recibido como pago */}
      {condicion === 'intercambio' && (
        <div className="card" style={{ marginTop: '1rem', padding: '.7rem .85rem', borderLeft: '3px solid var(--primary)' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}><span>⛏ Material que entrega el cliente (entra al inventario)</span></div>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.78rem' }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 230 }}>Material</th>
                  <th>Almacén donde entra</th>
                  <th style={{ textAlign: 'right' }}>Cantidad</th>
                  <th style={{ textAlign: 'right' }} title="Valor total que se le reconoce al cliente">Valor ({moneda})</th>
                  <th style={{ textAlign: 'right' }} title="Valor ÷ cantidad: costo con que entra">Valor/u</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {!material.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '.7rem' }}>Agregá el material con «+ Agregar material».</td></tr>}
                {material.map((m) => (
                  <tr key={m._k}>
                    <td>
                      <label style={{ display: 'flex', gap: '.35rem', alignItems: 'center', fontSize: '.72rem', marginBottom: '.25rem', cursor: 'pointer' }}>
                        <input type="checkbox" checked={m.nuevo} disabled={emitida && !!m.producto_id && (venta?.pago_material ?? []).some((x) => x.producto_id === m.producto_id)}
                          onChange={(e) => setMat(m._k, { nuevo: e.target.checked, producto_id: null, producto_nombre: '' })} /> Material nuevo (crear ficha)
                      </label>
                      {m.nuevo ? (
                        <div style={{ display: 'flex', gap: '.3rem' }}>
                          <input className="input" value={m.producto_nombre} onChange={(e) => setMat(m._k, { producto_nombre: e.target.value })} placeholder="Nombre del material" />
                          <select className="select" style={{ width: 80 }} value={m.unidad ?? 'KG'} onChange={(e) => setMat(m._k, { unidad: e.target.value })}>
                            {['KG', 'TON', 'UND', 'LT', 'GR'].map((u) => <option key={u}>{u}</option>)}
                          </select>
                        </div>
                      ) : (
                        <SearchSelect value={m.producto_id ?? ''} onChange={(id) => { const p = productos.find((x) => x.id === id); setMat(m._k, { producto_id: id, producto_nombre: p?.nombre ?? '', unidad: p?.unidad ?? null }); }}
                          options={productosActivos.map((p) => ({ value: p.id, label: `${p.nombre}${p.sku ? ` (${p.sku})` : ''}` }))}
                          placeholder="🔎 Producto del inventario…" emptyText="Sin productos." />
                      )}
                    </td>
                    <td>
                      <select className="select" value={m.almacen} onChange={(e) => setMat(m._k, { almacen: e.target.value })}>
                        {m.almacen && !gruposAlmacen.some(([, ds]) => ds.some((d) => d.nombre === m.almacen)) && <option value={m.almacen}>{m.almacen}</option>}
                        {gruposAlmacen.map(([sede, destinos]) => (
                          <optgroup key={sede} label={sede}>{destinos.map((d) => <option key={d.nombre} value={d.nombre}>{d.label}</option>)}</optgroup>
                        ))}
                      </select>
                    </td>
                    <td><input className="input mono" style={cellNum} type="number" min={0} step="any" value={m.cantidad || ''} onChange={(e) => setMat(m._k, { cantidad: Number(e.target.value) || 0 })} placeholder="0" /></td>
                    <td><input className="input mono" style={{ ...cellNum, width: 100 }} type="number" min={0} step="any" value={m.valor || ''} onChange={(e) => setMat(m._k, { valor: Number(e.target.value) || 0 })} placeholder="0.00" /></td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(costoUnitMaterial(m), moneda)}</td>
                    <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => setMaterial((prev) => prev.filter((x) => x._k !== m._k))} title="Quitar">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: '.4rem' }} onClick={addMat}>+ Agregar material</button>
          <div className="mono" style={{ fontSize: '.84rem', marginTop: '.5rem' }}>
            Material: <strong>{money(valorMat, moneda)}</strong> de {money(totales.total, moneda)}
            {' · '}{r2(totales.total - valorMat) > 0
              ? <>queda por cobrar en dinero <strong style={{ color: 'var(--primary-3)' }}>{money(r2(totales.total - valorMat), moneda)}</strong></>
              : r2(totales.total - valorMat) === 0 ? <strong style={{ color: 'var(--success, #45c08a)' }}>cubre el total</strong> : null}
          </div>
          {errInter && material.length > 0 && <small style={{ color: 'var(--danger)', display: 'block', marginTop: '.25rem' }}>{errInter}</small>}
        </div>
      )}

      {/* Totales */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
        <div style={{ minWidth: 300, display: 'grid', gap: '.35rem' }}>
          <Row l="Subtotal" v={money(totales.subtotal, moneda)} />
          <Row l="Descuento" v={<input className="input mono" type="number" min={0} step="any" value={descuento} onChange={(e) => setDescuento(e.target.value)} style={{ width: 110, textAlign: 'right' }} />} />
          {tipo === 'factura' && (
            <>
              <Row l={<label style={{ display: 'flex', gap: '.35rem', alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={aplicaIva} onChange={(e) => setAplicaIva(e.target.checked)} /> IVA</label>}
                v={<span style={{ display: 'flex', gap: '.35rem', alignItems: 'center' }}>
                  <input className="input mono" type="number" min={0} step="any" value={ivaPct} disabled={!aplicaIva} onChange={(e) => setIvaPct(e.target.value)} style={{ width: 64, textAlign: 'right' }} />%
                  <span style={{ minWidth: 90, textAlign: 'right' }}>{money(totales.iva_monto, moneda)}</span>
                </span>} />
              <Row l={<label style={{ display: 'flex', gap: '.35rem', alignItems: 'center', cursor: 'pointer' }} title="Impuesto a las Grandes Transacciones Financieras: sobre lo que se paga (base + IVA)"><input type="checkbox" checked={aplicaIgtf} onChange={(e) => setAplicaIgtf(e.target.checked)} /> IGTF</label>}
                v={<span style={{ display: 'flex', gap: '.35rem', alignItems: 'center' }}>
                  <input className="input mono" type="number" min={0} step="any" value={igtfPct} disabled={!aplicaIgtf} onChange={(e) => setIgtfPct(e.target.value)} style={{ width: 64, textAlign: 'right' }} />%
                  <span style={{ minWidth: 90, textAlign: 'right' }}>{money(totales.igtf_monto, moneda)}</span>
                </span>} />
            </>
          )}
          <Row l="TOTAL" v={<strong>{money(totales.total, moneda)}</strong>} big />
          <Row l="Costo" v={money(totales.costo_total, moneda)} muted />
          <Row l="Ganancia (sin impuestos)" v={<span style={{ color: totales.ganancia < 0 ? 'var(--danger)' : 'var(--success, #45c08a)', fontWeight: 700 }}>{money(totales.ganancia, moneda)} ({num(totales.ganancia_pct)}%)</span>} />
        </div>
      </div>

      <div className="form-row" style={{ marginTop: '.6rem' }}>
        <label>Nota</label>
        <textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Opcional" />
      </div>
      {emitida && (
        <div className="form-row">
          <label>Motivo del cambio <span style={{ color: 'var(--danger)' }}>*</span></label>
          <textarea className="input" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: el cliente pidió 2 lingotes más; se corrigió el precio acordado" />
          <small className="muted">Obligatorio. Queda en la trazabilidad de la venta y en el kardex de cada producto que se mueva.</small>
        </div>
      )}

      {confirmar === 'enviar' && (
        <ConfirmDialog title="Enviar a autorizar" confirmText="Enviar a autorizar"
          message={`La ${nombreDocumento(tipo).toLowerCase()} de ${clienteNombre || 'cliente ocasional'} por ${money(totales.total, moneda)} queda esperando la autorización de Leydis Rengel o Jesús Lozada.\n\nTodavía no mueve inventario ni dinero: eso pasa al emitirla, después de autorizada.`}
          onConfirm={() => void guardar('enviar')} onCancel={() => setConfirmar(null)} />
      )}
      {confirmar === 'autorizar' && (
        <ConfirmDialog title={`Autorizar y emitir ${nombreDocumento(tipo).toLowerCase()}`} confirmText="Autorizar y emitir" success
          message={`${resumenEmision({ ...input(), items, total: totales.total, moneda, pago_material: input().pago_material ?? [], valor_material: valorMat } as Venta)}\n\nQueda autorizada a tu nombre (${nombreAutorizante(actor)}).`}
          onConfirm={() => void guardar('autorizar')} onCancel={() => setConfirmar(null)} />
      )}
      {confirmar === 'guardar' && (
        <ConfirmDialog title={`Guardar cambios en ${venta!.numero}`} confirmText="Guardar cambios"
          message={emitida ? resumenEdicion : 'Esta venta está autorizada. Si guardás los cambios, vuelve a autorización (Leydis Rengel / Jesús Lozada) antes de poder emitirse.'}
          onConfirm={() => void guardar('guardar')} onCancel={() => setConfirmar(null)} />
      )}
    </Modal>
  );
}

/** Chip de la venta a crédito con lo que ya se cobró contra su cuenta. */
function EstadoCredito({ venta, cuenta }: { venta: Venta; cuenta?: CuentaPorCobrar }) {
  if (!esVentaACredito(venta) || venta.estado === 'anulada') return null;
  const total = Number(cuenta?.monto) || Number(venta.total) || 0;
  const abonado = Number(cuenta?.abonado) || 0;
  const saldo = Math.max(0, Math.round((total - abonado) * 100) / 100);
  return (
    <div style={{ fontSize: '.72rem', marginTop: '.25rem' }}>
      <span className="badge" style={{ borderColor: 'var(--primary-3)', color: 'var(--primary-3)' }}>A crédito</span>
      {cuenta ? (
        <span className="muted" style={{ marginLeft: '.35rem' }}>
          {saldo > 0 ? <>abonado {money(abonado)} de {money(total)} · falta <strong>{money(saldo)}</strong></> : <>cobrada por completo</>}
        </span>
      ) : <span className="muted" style={{ marginLeft: '.35rem' }}>sin cuenta por cobrar</span>}
    </div>
  );
}

/** Chip del intercambio: cuánto pagó en material y cuánto falta en dinero. */
function EstadoIntercambio({ venta }: { venta: Venta }) {
  if (!esIntercambio(venta) || venta.estado === 'anulada') return null;
  const falta = saldoPorCobrar(venta);
  return (
    <div style={{ fontSize: '.72rem', marginTop: '.25rem' }}>
      <span className="badge" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>⛏ Intercambio</span>
      <span className="muted" style={{ marginLeft: '.35rem' }}>
        material {money(Number(venta.valor_material) || 0, venta.moneda)}{falta > 0 ? <> · falta <strong>{money(falta, venta.moneda)}</strong></> : null}
      </span>
    </div>
  );
}

function Row({ l, v, big, muted }: { l: ReactNode; v: ReactNode; big?: boolean; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', fontSize: big ? '1.05rem' : '.85rem' }}>
      <span className={muted ? 'muted' : undefined} style={{ fontWeight: big ? 800 : 600 }}>{l}</span>
      <span className="mono">{v}</span>
    </div>
  );
}

/* ───────────── Detalle + trazabilidad ───────────── */

const ACCION_UI: Record<EventoVenta['accion'], { icon: string; label: string; color: string }> = {
  creada: { icon: '➕', label: 'Creada', color: 'var(--muted)' },
  enviada: { icon: '📨', label: 'Enviada a autorizar', color: 'var(--warning)' },
  autorizada: { icon: '✔', label: 'Autorizada', color: 'var(--primary)' },
  devuelta: { icon: '↩', label: 'Devuelta a borrador', color: 'var(--warning)' },
  editada: { icon: '✎', label: 'Editada', color: 'var(--warning)' },
  emitida: { icon: '✔', label: 'Emitida', color: 'var(--primary-3)' },
  cobrada: { icon: '💵', label: 'Cobrada', color: 'var(--success, #45c08a)' },
  anulada: { icon: '✖', label: 'Anulada', color: 'var(--danger)' },
};

function DetalleVentaModal({ venta: v, cuenta, onClose }: { venta: Venta; cuenta?: CuentaPorCobrar; onClose: () => void }) {
  const hist = [...(v.historial ?? [])].sort((a, b) => b.at.localeCompare(a.at));
  const falta = saldoPorCobrar(v);
  const ver = (f: 'doc' | 'traza') => void pdf()
    .then((m) => (f === 'doc' ? m.verDocumentoVentaPdf(v) : m.verTrazabilidadVentaPdf(v)))
    .catch((e) => toast(errMsg(e, 'Error PDF'), 'error'));
  const dato = (k: string, val: ReactNode) => (
    <div><div className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>{k}</div><div style={{ fontWeight: 600 }}>{val}</div></div>
  );
  return (
    <Modal title={`${nombreDocumento(v.tipo_documento)} ${v.numero}`} size="lg" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={() => ver('traza')}>↓ PDF trazabilidad</button>
        <button className="btn btn-ghost" onClick={() => ver('doc')}>↓ PDF {nombreDocumento(v.tipo_documento).toLowerCase()}</button>
        <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
      </>
    }>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.7rem', marginBottom: '.9rem' }}>
        {dato('Estado', <span style={{ color: ESTADO[v.estado].color }}>{ESTADO[v.estado].label}</span>)}
        {dato('Cliente', v.cliente_nombre || 'Cliente ocasional')}
        {dato('Fecha', date(v.fecha))}
        {dato('Forma de pago', nombreCondicion(v.condicion_pago))}
        {dato('Autorizada por', v.aprobada_por
          ? <>{nombreAutorizante(v.aprobada_por)}{v.aprobada_en ? <span className="muted" style={{ fontWeight: 400 }}> · {dateTime(v.aprobada_en)}</span> : null}</>
          : <span style={{ color: 'var(--warning)' }}>{v.estado === 'por_aprobar' ? 'esperando a Leydis / Jesús' : 'sin autorizar'}</span>)}
        {dato('Total', <span className="mono">{money(v.total, v.moneda)}</span>)}
        {dato('Cobrado', <span className="mono">{money(v.pagado_monto, v.moneda)}{falta > 0 ? <span style={{ color: 'var(--danger)' }}> · falta {money(falta, v.moneda)}</span> : null}</span>)}
        {esVentaACredito(v) && dato('Cuenta por cobrar', cuenta ? `${money(cuenta.abonado, v.moneda)} de ${money(cuenta.monto, v.moneda)}` : '—')}
        {Number(v.iva_monto) + Number(v.igtf_monto) > 0 && dato('IVA + IGTF', <span className="mono">{money(Number(v.iva_monto) + Number(v.igtf_monto), v.moneda)}</span>)}
        {dato('Ganancia', <span className="mono">{money(v.ganancia, v.moneda)} · {num(v.ganancia_pct)}%</span>)}
      </div>

      {v.estado === 'anulada' && (
        <div className="card" style={{ borderLeft: '3px solid var(--danger)', padding: '.55rem .8rem', marginBottom: '.8rem', fontSize: '.85rem' }}>
          <strong>Anulada</strong> {v.anulada_en ? `el ${dateTime(v.anulada_en)}` : ''} · {v.motivo_anulacion || 'sin motivo'}
        </div>
      )}

      <div className="table-wrap" style={{ marginBottom: '.8rem' }}>
        <table className="table" style={{ fontSize: '.8rem', margin: 0 }}>
          <thead><tr><th>Producto vendido</th><th>Almacén</th><th style={{ textAlign: 'right' }}>Cant.</th><th style={{ textAlign: 'right' }}>Precio</th><th style={{ textAlign: 'right' }}>Subtotal</th></tr></thead>
          <tbody>
            {(v.items ?? []).map((i, k) => (
              <tr key={k}><td>{i.producto_nombre}</td><td className="muted">{i.almacen}</td><td className="mono" style={{ textAlign: 'right' }}>{num(i.cantidad)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(i.precio_unit, v.moneda)}</td><td className="mono" style={{ textAlign: 'right' }}>{money(i.subtotal, v.moneda)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {esIntercambio(v) && (v.pago_material ?? []).length > 0 && (
        <div className="table-wrap" style={{ marginBottom: '.8rem' }}>
          <table className="table" style={{ fontSize: '.8rem', margin: 0 }}>
            <thead><tr><th>Material recibido</th><th>Almacén</th><th style={{ textAlign: 'right' }}>Cant.</th><th style={{ textAlign: 'right' }}>Valor</th></tr></thead>
            <tbody>
              {(v.pago_material ?? []).map((p, k) => (
                <tr key={k}><td>{p.producto_nombre}</td><td className="muted">{p.almacen}</td><td className="mono" style={{ textAlign: 'right' }}>{num(p.cantidad)} {p.unidad ?? ''}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(p.valor, v.moneda)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card-title"><span>🧭 Trazabilidad</span></div>
      {!hist.length ? <EmptyState message="Sin historial registrado." icon="🧭" /> : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '.5rem' }}>
          {hist.map((e, i) => {
            const a = ACCION_UI[e.accion] ?? { icon: '•', label: e.accion, color: 'var(--muted)' };
            return (
              <li key={i} style={{ borderLeft: `3px solid ${a.color}`, padding: '.35rem .7rem', background: 'var(--surface-2)', borderRadius: 6 }}>
                <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <strong style={{ color: a.color }}>{a.icon} {a.label}</strong>
                  <span className="muted" style={{ fontSize: '.78rem' }}>{dateTime(e.at)} · {e.actor_name || e.actor}</span>
                </div>
                {e.detalle && <div style={{ fontSize: '.82rem' }}>{e.detalle}</div>}
                {!!e.cambios?.length && <ul style={{ margin: '.2rem 0 0', paddingLeft: '1.1rem', fontSize: '.8rem' }}>{e.cambios.map((c, j) => <li key={j}>{c}</li>)}</ul>}
                {e.motivo && <div style={{ fontSize: '.8rem', marginTop: '.15rem' }}><span className="muted">Motivo:</span> {e.motivo}</div>}
              </li>
            );
          })}
        </ol>
      )}
    </Modal>
  );
}

/* ───────────── Devolver (autorizantes) ───────────── */

function DevolverModal({ venta, actor, actorName, onClose, onDone }: {
  venta: Venta; actor: string; actorName: string | null; onClose: () => void; onDone: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirmar() {
    setError(null); setSaving(true);
    try {
      await devolverVenta(venta, actor, actorName, motivo);
      notify(`${venta.numero} devuelta a borrador: ${motivo.trim()}`, 'info', { link: '#/app/ventas' });
      onDone();
    } catch (e) { setError(errMsg(e, 'No se pudo devolver')); setSaving(false); }
  }
  return (
    <Modal title={`Devolver ${venta.numero}`} size="md" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void confirmar()} disabled={saving || motivo.trim().length < 4}>{saving ? '…' : 'Devolver a borrador'}</button>
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
      <p style={{ marginTop: 0 }}>La venta vuelve a <strong>borrador</strong> para que la corrijan y la envíen de nuevo. No se movió nada todavía.</p>
      <div className="form-row">
        <label>Qué hay que corregir <span style={{ color: 'var(--danger)' }}>*</span></label>
        <textarea className="input" rows={2} value={motivo} autoFocus onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: revisar el precio del estaño; falta el RIF del cliente" />
        <small className="muted">Queda en la trazabilidad de la venta.</small>
      </div>
    </Modal>
  );
}

/* ───────────── Anular ───────────── */

function AnularModal({ venta, actor, actorName, onClose, onDone }: {
  venta: Venta; actor: string; actorName: string | null; onClose: () => void; onDone: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const efectos = efectosAnulacion(venta);
  async function confirmar() {
    setError(null); setSaving(true);
    try {
      await anularVenta(venta, actor, actorName, motivo);
      notify(`${nombreDocumento(venta.tipo_documento)} ${venta.numero} anulada`, 'info', { link: '#/app/ventas' });
      onDone();
    } catch (e) { setError(errMsg(e, 'No se pudo anular')); setSaving(false); }
  }
  return (
    <Modal title={`Anular ${venta.numero}`} size="md" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-danger" onClick={() => void confirmar()} disabled={saving || motivo.trim().length < 4}>{saving ? 'Anulando…' : 'Anular venta'}</button>
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
      <p style={{ marginTop: 0 }}>
        ¿Anular la {nombreDocumento(venta.tipo_documento).toLowerCase()} <strong>{venta.numero}</strong> de {venta.cliente_nombre || 'cliente ocasional'} por <strong>{money(venta.total, venta.moneda)}</strong>? Esto no se puede deshacer.
      </p>
      <div className="card" style={{ borderLeft: '3px solid var(--danger)', padding: '.55rem .8rem', marginBottom: '.7rem' }}>
        <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.25rem' }}>Qué se revierte</div>
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '.84rem' }}>{efectos.map((e, i) => <li key={i}>{e}</li>)}</ul>
      </div>
      <div className="form-row">
        <label>Motivo de la anulación <span style={{ color: 'var(--danger)' }}>*</span></label>
        <textarea className="input" rows={2} value={motivo} autoFocus onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: el cliente devolvió el material; se facturó al cliente equivocado" />
        <small className="muted">Obligatorio. Queda en la trazabilidad, en el kardex y en la caja si se devuelve dinero.</small>
      </div>
    </Modal>
  );
}

/* ───────────── Cobrar ───────────── */

function CobrarModal({ venta, cajas, saldos, actor, actorName, onClose, onSaved }: {
  venta: Venta; cajas: Caja[]; saldos: CajaSaldo[]; actor: string; actorName: string | null;
  onClose: () => void; onSaved: () => void;
}) {
  const falta = saldoPorCobrar(venta);
  const [metodo, setMetodo] = useState('Efectivo');
  const [monto, setMonto] = useState(String(falta));
  const [cajaId, setCajaId] = useState(cajas[0]?.id ?? '');
  const [cuentaCaja, setCuentaCaja] = useState<CuentaCaja>('general');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);

  // Las cuentas de esa caja EN LA MONEDA de la venta: en Bs una caja se parte
  // en jurídica y personal, y el dinero tiene que entrar a la correcta.
  const cuentasMoneda = useMemo(
    () => saldos.filter((s) => s.caja_id === cajaId && s.moneda === (venta.moneda || 'USD')),
    [saldos, cajaId, venta.moneda],
  );
  useEffect(() => {
    if (cuentasMoneda.length && !cuentasMoneda.some((c) => c.cuenta === cuentaCaja)) setCuentaCaja(cuentasMoneda[0].cuenta as CuentaCaja);
  }, [cuentasMoneda, cuentaCaja]);

  const caja = cajas.find((c) => c.id === cajaId);
  function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!(Number(monto) > 0)) { setError('Indicá el monto cobrado.'); return; }
    setConfirmar(true);
  }
  async function registrar() {
    setConfirmar(false); setSaving(true);
    try {
      await marcarPagada({ venta, metodo, monto: Number(monto) || falta, cajaId, cuentaCaja, actor, actorName });
      toast('Cobro registrado · entró a caja', 'success');
      onSaved();
    } catch (err) { setError(errMsg(err, 'No se pudo registrar')); setSaving(false); }
  }
  return (
    <Modal title={`${esIntercambio(venta) ? 'Cobrar diferencia de' : 'Cobrar'} ${venta.numero}`} size="md" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="cobrar-f" className="btn btn-primary" disabled={saving || !cajaId}>{saving ? '…' : 'Registrar cobro (entra a caja)'}</button></>
    }>
      <form id="cobrar-f" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        {esIntercambio(venta) && (
          <p className="hint muted" style={{ marginTop: 0 }}>El material cubrió {money(Number(venta.valor_material) || 0, venta.moneda)} de {money(venta.total, venta.moneda)}: se cobra la diferencia.</p>
        )}
        <div className="form-row"><label>Método de pago</label>
          <select className="select" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
            <option>Efectivo</option><option>Transferencia</option><option>Pago móvil</option><option>USDT</option><option>Otro</option>
          </select>
        </div>
        <div className="form-row"><label>Monto cobrado ({venta.moneda})</label>
          <input className="input mono" type="number" min={0} step="any" value={monto} onChange={(e) => setMonto(e.target.value)} /></div>
        <div className="form-row">
          <label>Caja donde entra el dinero</label>
          {cajas.length ? (
            <>
              <select className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
                {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              {cuentasMoneda.length > 1 && (
                <select className="select" style={{ marginTop: '.35rem' }} value={cuentaCaja} onChange={(e) => setCuentaCaja(e.target.value as CuentaCaja)}>
                  {cuentasMoneda.map((r) => (
                    <option key={r.cuenta} value={r.cuenta}>
                      Entra en {r.cuenta === 'general' ? 'general' : r.cuenta === 'juridica' ? 'Jurídica' : r.cuenta === 'personal' ? 'Personal' : r.cuenta}{' · '}{money(Number(r.saldo))}
                    </option>
                  ))}
                </select>
              )}
              <small className="muted">Queda como ingreso en el Libro Mayor de esa caja, en <strong>{venta.moneda}</strong>.</small>
            </>
          ) : <small style={{ color: 'var(--danger)' }}>No hay cajas activas: creá una en Tesorería para poder cobrar.</small>}
        </div>
      </form>
      {confirmar && (
        <ConfirmDialog title="Confirmar cobro" confirmText="Registrar cobro" success
          message={`Entran ${money(Number(monto) || 0, venta.moneda)} a ${caja?.nombre ?? 'la caja'} por ${venta.numero}${venta.cliente_nombre ? ` (${venta.cliente_nombre})` : ''}.\nMétodo: ${metodo}.`}
          onConfirm={() => void registrar()} onCancel={() => setConfirmar(false)} />
      )}
    </Modal>
  );
}

/* ───────────── Clientes ───────────── */

function ClientesModal({ canWrite, actor, actorName, onClose, onChanged }: {
  canWrite: boolean; actor: string; actorName: string | null; onClose: () => void; onChanged: () => void;
}) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [edit, setEdit] = useState<Cliente | 'nuevo' | null>(null);
  const [borrarConf, setBorrarConf] = useState<Cliente | null>(null);
  const cargar = useCallback(() => { listClientes().then(setClientes).catch(() => setClientes([])); }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useRealtime(['clientes'], cargar);

  async function borrar(c: Cliente) {
    try { await eliminarCliente(c.id); toast('Cliente eliminado', 'success'); setBorrarConf(null); cargar(); onChanged(); }
    catch (e) { toast(errMsg(e, 'No se pudo eliminar'), 'error'); }
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
                    {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setBorrarConf(c)}>🗑</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <ClienteForm cliente={edit === 'nuevo' ? null : edit} actor={actor} actorName={actorName}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); cargar(); onChanged(); }} />}
      {borrarConf && (
        <ConfirmDialog title={`Eliminar ${borrarConf.nombre}`} danger confirmText="Eliminar cliente"
          message={`¿Eliminar el cliente ${borrarConf.nombre}? Sus ventas se conservan con el nombre escrito en cada una.`}
          onConfirm={() => void borrar(borrarConf)} onCancel={() => setBorrarConf(null)} />
      )}
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
    } catch (err) { setError(errMsg(err, 'No se pudo guardar')); setSaving(false); }
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
  const hoy = new Date().toLocaleDateString('en-CA');
  const [desde, setDesde] = useState(() => `${hoy.slice(0, 8)}01`);
  const [hasta, setHasta] = useState(hoy);
  const [doc, setDoc] = useState<'todos' | TipoDocumentoVenta>('todos');
  const [pago, setPago] = useState<'todos' | CondicionPagoVenta>('todos');
  const [anuladas, setAnuladas] = useState(false);

  const filtradas = useMemo(() => ventas.filter((v) =>
    v.fecha >= desde && v.fecha <= hasta
    // Solo lo emitido es venta: un borrador o una venta por autorizar todavía no.
    && (yaEmitida(v) || (anuladas && v.estado === 'anulada'))
    && (doc === 'todos' || (v.tipo_documento ?? 'factura') === doc)
    && (pago === 'todos' || (v.condicion_pago ?? 'contado') === pago)), [ventas, desde, hasta, doc, pago, anuladas]);
  const vivas = filtradas.filter(yaEmitida);
  const r = resumenVentas(vivas);
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

  const filtroTxt = [
    doc === 'todos' ? 'Todos los documentos' : nombreDocumento(doc),
    pago === 'todos' ? 'toda forma de pago' : nombreCondicion(pago),
    anuladas ? 'incluye anuladas' : null,
  ].filter(Boolean).join(' · ');

  return (
    <Modal title="📊 Reporte de ventas" size="lg" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        <button className="btn btn-primary" disabled={!filtradas.length}
          onClick={() => void pdf().then((m) => m.verReporteVentasPdf({ ventas: filtradas, desde, hasta, filtro: filtroTxt })).catch((e) => toast(errMsg(e, 'Error PDF'), 'error'))}>
          ↓ PDF (vista previa)
        </button>
      </>
    }>
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '.9rem' }}>
        <div className="form-row" style={{ margin: 0 }}><label>Desde</label><input className="input" type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="form-row" style={{ margin: 0 }}><label>Hasta</label><input className="input" type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} /></div>
        <div className="form-row" style={{ margin: 0 }}><label>Documento</label>
          <select className="select" value={doc} onChange={(e) => setDoc(e.target.value as typeof doc)}>
            <option value="todos">Todos</option><option value="factura">Facturas</option><option value="nota_entrega">Notas de entrega</option>
          </select></div>
        <div className="form-row" style={{ margin: 0 }}><label>Forma de pago</label>
          <select className="select" value={pago} onChange={(e) => setPago(e.target.value as typeof pago)}>
            <option value="todos">Todas</option><option value="contado">Contado</option><option value="credito">Crédito</option><option value="intercambio">Intercambio</option>
          </select></div>
        <label style={{ display: 'flex', gap: '.35rem', alignItems: 'center', fontSize: '.84rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={anuladas} onChange={(e) => setAnuladas(e.target.checked)} /> Incluir anuladas
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '.6rem', marginBottom: '1rem' }}>
        {[['Vendido', money(r.totalVendido)], ['Ganancia', `${money(r.ganancia)} · ${num(r.gananciaPct)}%`], ['IVA + IGTF', money(r.impuestos)],
          ['Material recibido', money(r.materialRecibido)], ['Documentos', String(r.facturas)]].map(([k, val]) => (
          <div key={k} className="card" style={{ padding: '.5rem .7rem' }}>
            <div className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>{k}</div>
            <div className="mono" style={{ fontWeight: 800 }}>{val}</div>
          </div>
        ))}
      </div>
      <div className="card-title"><span>Ventas por cliente</span></div>
      <RankedBarChart data={porCliente} valueFormatter={(v) => money(v)} emptyMessage="Sin ventas en el período." />
      <div className="card-title" style={{ marginTop: '1rem' }}><span>Ventas por producto</span></div>
      <RankedBarChart data={porProducto} valueFormatter={(v) => money(v)} emptyMessage="Sin ventas en el período." />
    </Modal>
  );
}
