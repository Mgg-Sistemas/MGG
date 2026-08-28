import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { notify } from '@/shared/lib/notify';
import { dateTime, num } from '@/shared/lib/format';
// descargarCompraDirectaPdf se importa dinámicamente (al generar) para no cargar jsPDF al abrir la vista.
import { list as listProveedores, crearProveedorRapido } from '@/modules/proveedores/proveedores.repository';
import { AlmacenPicker } from '@/modules/inventario/AlmacenPicker';
import type { Producto, Proveedor } from '@/shared/lib/types';
import { getCategorias, getUnidades, listProductos, updateProducto, addCategoria, addUnidad } from '@/modules/inventario/inventario.repository';
import { getTasaHoy } from '@/modules/tesoreria/tasas.repository';
import { fmtTasa } from './compraDirectaMoneda';
import {
  crearCompraDirecta, editarCompraDirectaEnProceso, montarCompraDirecta, listComprasDirectas, eliminarCompraDirecta,
  urlAdjuntoCompra, gestionarFacturasCompra, type CompraDirecta, type CompraDirectaItem, type LineaCompra,
} from './compras.repository';
import { FacturasModal } from './FacturasModal';
import { DetalleDirectoModal } from './DetalleDirectoModal';
import { previewFileUrl } from '@/shared/lib/reportPreview';

type Vista = 'kanban' | 'lista';

// Flujo nuevo: tras "Cargar factura y precios" la compra queda ABIERTA (pendiente por
// pagar en Tesorería Y por recibir en Inventario, en paralelo). Se finaliza con las dos.
const COLS: { key: string; label: string }[] = [
  { key: 'en_proceso', label: 'En proceso' },
  { key: 'abierta', label: 'Pendiente (pago + recepción)' },
  { key: 'finalizada', label: 'Finalizada' },
  { key: 'anulada', label: 'Anuladas' },
];
const ESTADO_LABEL: Record<string, string> = { en_proceso: '⏳ En proceso', abierta: '⏳ Pendiente', por_pagar: '💸 Por pagar', por_recibir: '📦 Por recibir', finalizada: '🏁 Finalizada', anulada: '⊘ Anulada' };
/** Columna del kanban para una compra: los estados legados caen en "abierta". */
function colDe(c: CompraDirecta): string {
  if (c.estado === 'en_proceso' || c.estado === 'finalizada' || c.estado === 'anulada') return c.estado;
  return 'abierta'; // abierta + legado por_pagar / por_recibir
}
/** ¿La compra ya está pagada / ya se recibió? (para los chips de estado en paralelo). */
const estaPagada = (c: CompraDirecta) => !!c.caja_mov_id;
const estaRecibida = (c: CompraDirecta) => !!c.recibida_at || !!c.mov_id;

function montoCaja(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${v}` : `${moneda} ${v}`;
}

export function CompraDirectaView({ actor, actorName }: { actor: string; actorName?: string | null }) {
  const [compras, setCompras] = useState<CompraDirecta[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [unidades, setUnidades] = useState<string[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [vista, setVista] = useState<Vista>('kanban');
  const [crear, setCrear] = useState(false);
  const [finalizar, setFinalizar] = useState<CompraDirecta | null>(null);
  const [eliminar, setEliminar] = useState<CompraDirecta | null>(null);
  const [facturas, setFacturas] = useState<CompraDirecta | null>(null);
  const [editarProceso, setEditarProceso] = useState<CompraDirecta | null>(null);
  const [detalle, setDetalle] = useState<CompraDirecta | null>(null);

  // Solo la lista (la tabla/kanban). Lo que se muestra va denormalizado en la fila,
  // así que una mutación o un evento realtime de compras_directas pide UNA consulta.
  const reloadLista = useCallback(async () => {
    setCompras(await listComprasDirectas().catch(() => [] as CompraDirecta[]));
  }, []);

  // Catálogos del formulario de alta (productos, categorías, medidas, cajas, proveedores):
  // casi estáticos; se cargan al entrar y solo se refrescan si cambian en su origen.
  const reloadCatalogos = useCallback(async () => {
    const [pds, cats, unis, provs] = await Promise.all([
      listProductos().catch(() => [] as Producto[]),
      getCategorias().catch(() => [] as string[]),
      getUnidades().catch(() => [] as string[]),
      listProveedores().catch(() => [] as Proveedor[]),
    ]);
    setProductos(pds); setCategorias(cats); setUnidades(unis);
    setProveedores(provs.filter((p) => p.estado === 'activo'));
  }, []);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    Promise.all([reloadLista(), reloadCatalogos()]).catch(() => { /* RLS/red */ }).finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reloadLista, reloadCatalogos]);

  // Realtime: la lista solo depende de compras_directas; productos/proveedores solo
  // alimentan el formulario de alta (no se vuelve a traer todo en cada cambio).
  useRealtime(['compras_directas'], () => { void reloadLista(); });
  useRealtime(['productos', 'proveedores'], () => { void reloadCatalogos(); });

  const porEstado = useMemo(() => {
    const m: Record<string, CompraDirecta[]> = { en_proceso: [], abierta: [], finalizada: [] };
    compras.forEach((c) => { (m[colDe(c)] ??= []).push(c); });
    return m;
  }, [compras]);

  async function handlePdf(c: CompraDirecta) {
    try { const { descargarCompraDirectaPdf } = await import('./compraDirectaPdf'); await descargarCompraDirectaPdf(c); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  async function confirmarEliminar() {
    const c = eliminar;
    if (!c) return;
    setEliminar(null);
    try {
      await eliminarCompraDirecta(c, actor, actorName);
      toast('Compra directa eliminada', 'success');
      await reloadLista();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  return (
    <div>
      <div className="filterbar" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-primary" onClick={() => setCrear(true)}>+ Nueva compra directa</button>
        <div className="view-toggle" role="tablist" aria-label="Modo de vista">
          <button className={vista === 'kanban' ? 'active' : ''} onClick={() => setVista('kanban')}>▦ Kanban</button>
          <button className={vista === 'lista' ? 'active' : ''} onClick={() => setVista('lista')}>☰ Lista</button>
        </div>
      </div>

      {loading ? (
        <EmptyState message="Cargando compras directas..." icon="◔" />
      ) : !compras.length ? (
        <EmptyState message="Sin compras directas. Creá la primera con “+ Nueva compra directa”." icon="🛒" />
      ) : vista === 'kanban' ? (
        <div className="kanban">
          {COLS.map((col) => (
            <div key={col.key} className="kanban-col">
              <div className="kanban-col-head"><strong>{col.label}</strong><span className="badge">{porEstado[col.key]?.length ?? 0}</span></div>
              <div className="kanban-col-body">
                {(porEstado[col.key] ?? []).map((c) => (
                  <CompraCard key={c.id} compra={c} onVer={() => setDetalle(c)}
                    onFinalizar={() => setFinalizar(c)} onPdf={() => handlePdf(c)} onFacturas={() => setFacturas(c)} onEditar={() => setEditarProceso(c)} onEliminar={() => setEliminar(c)} />
                ))}
                {!(porEstado[col.key] ?? []).length && <div className="muted" style={{ padding: '.5rem' }}>—</div>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Código</th><th>Material(es)</th><th>Almacén</th><th>Proveedor</th><th>Cant.</th><th>Estado</th><th>Gasto</th><th>Generó</th><th>Creada</th><th>Comprada</th><th></th></tr></thead>
            <tbody>
              {compras.map((c) => (
                <tr key={c.id} className="row-selectable" style={{ cursor: 'pointer' }} onClick={() => setDetalle(c)} title="Ver el detalle">
                  <td className="mono">{c.codigo ?? '—'}</td>
                  <td>{c.producto_nombre}{c.items.length > 1 ? <span className="muted"> · {c.items.length} ítems</span> : (c.producto_sku ? <span className="muted"> · {c.producto_sku}</span> : null)}</td>
                  <td>{c.almacen}</td>
                  <td>{c.proveedor_nombre || '—'}</td>
                  <td className="mono">{num(c.cantidad)}</td>
                  <td>{ESTADO_LABEL[c.estado] ?? c.estado}</td>
                  <td className="mono">{c.gasto != null ? montoCaja(c.gasto, c.moneda) : '—'}</td>
                  <td>{c.actor_name || c.actor || '—'}</td>
                  <td className="muted">{dateTime(c.created_at)}</td>
                  <td className="muted">{c.finalizada_at ? dateTime(c.finalizada_at) : '—'}</td>
                  <td className="actions" style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-sm btn-ghost" onClick={() => handlePdf(c)} title="Ver detalle en PDF (vista previa)">↓ PDF</button>
                    {c.estado === 'finalizada' && <button className="btn btn-sm btn-ghost" onClick={() => setFacturas(c)} title="Cargar nuevas facturas / quitar anteriores">🧾 Facturas</button>}
                    {c.estado === 'en_proceso' && <button className="btn btn-sm btn-ghost" onClick={() => setEditarProceso(c)} title="Editar la compra: materiales, cantidades, proveedor y almacén">✎ Editar</button>}
                    {c.estado === 'en_proceso' && <button className="btn btn-sm btn-primary" onClick={() => setFinalizar(c)}>Cargar factura y precios</button>}
                    {colDe(c) === 'abierta' && !estaPagada(c) && !estaRecibida(c) && <button className="btn btn-sm btn-ghost" onClick={() => setFinalizar(c)} title="Editar factura/precios (aún no pagada ni recibida)">✎ Factura/precios</button>}
                    {c.estado !== 'finalizada' && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setEliminar(c)} title="Eliminar compra directa (revierte caja e inventario si ya se pagó/recibió)">🗑</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(crear || editarProceso) && (
        <CrearCompraModal productos={productos} categorias={categorias} unidades={unidades} proveedores={proveedores}
          editCompra={editarProceso}
          actor={actor} actorName={actorName}
          onClose={() => { setCrear(false); setEditarProceso(null); }}
          onSaved={async () => { setCrear(false); setEditarProceso(null); await Promise.all([reloadLista(), reloadCatalogos()]); }} />
      )}

      {finalizar && (
        <MontarCompraModal compra={finalizar} actor={actor} actorName={actorName}
          onClose={() => setFinalizar(null)} onSaved={async () => { setFinalizar(null); await reloadLista(); }} />
      )}

      {eliminar && (
        <ConfirmDialog
          title="Eliminar compra directa"
          message={`¿Eliminar la compra directa ${eliminar.codigo ? `${eliminar.codigo} · ` : ''}"${eliminar.producto_nombre}"?${
            estaRecibida(eliminar) || estaPagada(eliminar)
              ? ` Se revertirá${estaPagada(eliminar) ? ' el egreso de caja (Tesorería)' : ''}${estaPagada(eliminar) && estaRecibida(eliminar) ? ' y' : ''}${estaRecibida(eliminar) ? ' la entrada al inventario' : ''} antes de borrar.`
              : ''
          } Esta acción no se puede deshacer.`}
          confirmText="Eliminar"
          danger
          onConfirm={confirmarEliminar}
          onCancel={() => setEliminar(null)}
        />
      )}

      {facturas && (
        <FacturasModal
          title={`Facturas · ${facturas.codigo ?? 'Compra directa'}`}
          facturas={facturas.facturas}
          urlFor={urlAdjuntoCompra}
          onSave={async (nuevos, quitar) => { await gestionarFacturasCompra(facturas, nuevos, quitar); await reloadLista(); }}
          onClose={() => setFacturas(null)}
        />
      )}

      {detalle && (
        <DetalleDirectoModal
          title={`Compra directa · ${detalle.codigo ?? ''}`}
          estadoLabel={ESTADO_LABEL[detalle.estado] ?? detalle.estado}
          ficha={[
            ['Almacén', detalle.almacen || '—'],
            ['Proveedor', detalle.proveedor_nombre || '—'],
            ['Moneda', detalle.moneda === 'Bs' ? 'Bolívares (Bs)' : 'Dólares ($)'],
            ...(detalle.moneda === 'Bs' && detalle.tasa_bcv ? [['Tasa BCV', `${fmtTasa(detalle.tasa_bcv)} · valora los materiales en $ al entrar al inventario`] as [string, string]] : []),
            ...(detalle.descuento_monto > 0 ? [['Descuento', `${detalle.descuento_pct ? `${detalle.descuento_pct}% · ` : ''}${montoCaja(detalle.descuento_monto, detalle.moneda)}`] as [string, string]] : []),
            ...(detalle.iva > 0 ? [['IVA', montoCaja(detalle.iva, detalle.moneda)] as [string, string]] : []),
            ...(detalle.igtf > 0 ? [['IGTF', montoCaja(detalle.igtf, detalle.moneda)] as [string, string]] : []),
            ...(detalle.retencion_monto > 0 ? [['Retención IVA', `${detalle.retencion_pct}% · ${montoCaja(detalle.retencion_monto, detalle.moneda)}`] as [string, string]] : []),
            ['Generó', detalle.actor_name || detalle.actor || '—'],
            ['Creada', dateTime(detalle.created_at)],
            ['Comprada', detalle.finalizada_at ? dateTime(detalle.finalizada_at) : '—'],
          ]}
          itemsTitle="Materiales"
          items={detalle.items.map((it) => ({ nombre: `${it.producto_nombre}${it.producto_sku ? ` · ${it.producto_sku}` : ''}`, cantidad: it.cantidad, gasto: it.gasto }))}
          moneda={detalle.moneda || 'USD'}
          total={detalle.gasto}
          nota={detalle.nota}
          pagoExterno={detalle.pago_externo ? (detalle.pago_externo_datos ?? '') : null}
          facturas={detalle.facturas}
          urlFor={urlAdjuntoCompra}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setDetalle(null)}>Cerrar</button>
              <button className="btn btn-ghost" onClick={() => handlePdf(detalle)}>↓ PDF</button>
              {detalle.estado === 'finalizada' && <button className="btn btn-ghost" onClick={() => { setFacturas(detalle); setDetalle(null); }}>🧾 Facturas</button>}
              {detalle.estado === 'en_proceso' && <button className="btn btn-ghost" onClick={() => { setEditarProceso(detalle); setDetalle(null); }}>✎ Editar</button>}
              {detalle.estado === 'en_proceso' && <button className="btn btn-primary" onClick={() => { setFinalizar(detalle); setDetalle(null); }}>Cargar factura y precios</button>}
              {colDe(detalle) === 'abierta' && !estaPagada(detalle) && !estaRecibida(detalle) && <button className="btn btn-primary" onClick={() => { setFinalizar(detalle); setDetalle(null); }}>✎ Editar factura/precios</button>}
            </>
          }
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  );
}

function CompraCard({ compra, onVer, onFinalizar, onPdf, onFacturas, onEditar, onEliminar }: {
  compra: CompraDirecta; onVer: () => void; onFinalizar: () => void; onPdf: () => void; onFacturas: () => void; onEditar: () => void; onEliminar: () => void;
}) {
  return (
    <div className="card" style={{ margin: 0, cursor: 'pointer' }} onClick={onVer} title="Ver el detalle">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem' }}>
        <strong>{compra.producto_nombre}</strong>
        <span className="badge">{num(compra.cantidad)}</span>
      </div>
      {compra.codigo && <div className="muted mono" style={{ fontSize: '.72rem', marginTop: '.2rem' }}>{compra.codigo}</div>}
      <div className="muted" style={{ fontSize: '.78rem', marginTop: '.25rem' }}>→ {compra.almacen}</div>
      {compra.proveedor_nombre && <div className="muted" style={{ fontSize: '.74rem' }}>🏭 {compra.proveedor_nombre}</div>}
      {compra.items.length > 1 && (
        <ul className="muted" style={{ fontSize: '.72rem', margin: '.35rem 0 0', paddingLeft: '1rem' }}>
          {compra.items.map((it, i) => <li key={i}>{it.producto_nombre} · {num(it.cantidad)}</li>)}
        </ul>
      )}
      <div className="muted" style={{ fontSize: '.72rem', marginTop: '.4rem', lineHeight: 1.5 }}>
        <div>Generó: <strong style={{ color: 'var(--text)' }}>{compra.actor_name || compra.actor || '—'}</strong></div>
        <div>Creada: {dateTime(compra.created_at)}</div>
        {compra.estado === 'finalizada' && <div>Comprada: {compra.finalizada_at ? dateTime(compra.finalizada_at) : '—'}</div>}
      </div>
      {colDe(compra) === 'abierta' && (
        <div style={{ fontSize: '.8rem', marginTop: '.4rem' }}>
          <div>Monto: <strong className="mono">{compra.gasto != null ? montoCaja(compra.gasto, compra.moneda) : '—'}</strong></div>
          <div className="muted" style={{ fontSize: '.72rem', marginTop: '.2rem' }}>
            {estaPagada(compra) ? '✅ Pagada' : '💸 Pendiente de pago (Tesorería)'}
          </div>
          <div className="muted" style={{ fontSize: '.72rem' }}>
            {estaRecibida(compra) ? '✅ Recibida en inventario' : '📦 Pendiente de recepción (Inventario)'}
          </div>
          <div className="muted"><AdjuntoLink compra={compra} /></div>
        </div>
      )}
      {compra.estado === 'finalizada' && (
        <div style={{ fontSize: '.8rem', marginTop: '.4rem' }}>
          <div>Gasto: <strong className="mono">{compra.gasto != null ? montoCaja(compra.gasto, compra.moneda) : '—'}</strong></div>
          {compra.pagada_por && <div className="muted" style={{ fontSize: '.72rem' }}>Pagó: {compra.pagada_por}</div>}
          <div className="muted"><AdjuntoLink compra={compra} /></div>
        </div>
      )}
      <div style={{ display: 'flex', gap: '.4rem', marginTop: '.5rem', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-sm btn-ghost" onClick={onPdf} title="Ver detalle en PDF (vista previa)">↓ PDF</button>
        {compra.estado === 'finalizada' && <button className="btn btn-sm btn-ghost" onClick={onFacturas} title="Cargar nuevas facturas / quitar anteriores">🧾 Facturas</button>}
        {compra.estado === 'en_proceso' && <button className="btn btn-sm btn-ghost" onClick={onEditar} title="Editar la compra: materiales, cantidades, proveedor y almacén">✎ Editar</button>}
        {compra.estado === 'en_proceso' && <button className="btn btn-sm btn-primary" onClick={onFinalizar}>Cargar factura y precios</button>}
        {colDe(compra) === 'abierta' && !estaPagada(compra) && !estaRecibida(compra) && <button className="btn btn-sm btn-ghost" onClick={onFinalizar} title="Editar factura/precios (aún no pagada ni recibida)">✎ Factura/precios</button>}
        {compra.estado !== 'finalizada' && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={onEliminar} title="Eliminar compra directa (revierte caja e inventario si ya se pagó/recibió)">🗑 Eliminar</button>}
      </div>
    </div>
  );
}

function AdjuntoLink({ compra }: { compra: CompraDirecta }) {
  if (!compra.adjunto_path) return <span className="muted">—</span>;
  async function abrir() {
    try { await previewFileUrl(await urlAdjuntoCompra(compra.adjunto_path as string), compra.adjunto_nombre ?? 'factura'); }
    catch { toast('No se pudo abrir el adjunto', 'error'); }
  }
  return <button className="btn btn-sm btn-ghost" onClick={abrir} title={compra.adjunto_nombre ?? 'Adjunto'}>📎 PDF</button>;
}

/* ───────── Modal: nueva compra (varios materiales) ───────── */

interface LineaUI { id: number; modo: 'existente' | 'nuevo'; productoId: string; nombre: string; categoria: string; unidad: string; cantidad: string }

function CrearCompraModal({ productos, categorias, unidades, proveedores, editCompra, actor, actorName, onClose, onSaved }: {
  productos: Producto[]; categorias: string[]; unidades: string[]; proveedores: Proveedor[];
  /** Si viene, el modal edita esa compra EN PROCESO (todos sus datos) en vez de crear una nueva. */
  editCompra?: CompraDirecta | null;
  actor: string; actorName?: string | null; onClose: () => void; onSaved: () => void;
}) {
  const activos = useMemo(() => productos.filter((p) => p.estado === 'activo'), [productos]);
  // El modo (Inventario / Nuevo) es POR RENGLÓN: se pueden mezclar materiales del
  // inventario con materiales nuevos sin que uno pise al otro.
  const nuevaLinea = (id: number): LineaUI => ({
    id, modo: activos.length ? 'existente' : 'nuevo', productoId: activos[0]?.id ?? '',
    nombre: '', categoria: categorias[0] ?? '', unidad: unidades[0] ?? 'und', cantidad: '1',
  });
  // En modo edición, precargar los renglones desde los materiales ya cargados en la compra.
  const [lineas, setLineas] = useState<LineaUI[]>(() => {
    if (editCompra?.items?.length) {
      return editCompra.items.map((it, i) => ({
        id: i + 1, modo: 'existente' as const, productoId: it.producto_id,
        nombre: it.producto_nombre ?? '', categoria: categorias[0] ?? '',
        unidad: productos.find((p) => p.id === it.producto_id)?.unidad ?? unidades[0] ?? 'und',
        cantidad: String(it.cantidad ?? 1),
      }));
    }
    return [nuevaLinea(1)];
  });
  const [almacen, setAlmacen] = useState(editCompra?.almacen ?? '');
  // Proveedor: elegir uno existente (buscable) o dar de alta uno nuevo (razón social + RIF).
  const [provModo, setProvModo] = useState<'existente' | 'nuevo'>('existente');
  const [proveedorId, setProveedorId] = useState(editCompra?.proveedor_id ?? '');
  const [provNombre, setProvNombre] = useState('');
  const [provRif, setProvRif] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seq, setSeq] = useState((editCompra?.items?.length ?? 1) + 1);

  function set(id: number, patch: Partial<LineaUI>) { setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l))); }
  function add() { setLineas((ls) => [...ls, nuevaLinea(seq)]); setSeq((s) => s + 1); }
  function quitar(id: number) { setLineas((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls)); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!almacen) { setError('Elegí la sede y el almacén destino.'); return; }
    const payload: LineaCompra[] = [];
    const medidaUpdates: { id: string; unidad: string }[] = [];   // productos existentes con medida cambiada
    const nuevasCats = new Set<string>();                          // categorías a registrar en el catálogo
    const nuevasUnis = new Set<string>();                          // medidas a registrar en el catálogo
    const tieneUni = (u: string) => unidades.some((x) => x.toLowerCase() === u.toLowerCase());
    const tieneCat = (c: string) => categorias.some((x) => x.toLowerCase() === c.toLowerCase());
    for (const l of lineas) {
      const cant = Number(l.cantidad) || 0;
      if (cant <= 0) { setError('Cada material debe tener cantidad mayor que 0.'); return; }
      if (l.modo === 'existente') {
        if (!l.productoId) { setError('Elegí el material en cada renglón.'); return; }
        payload.push({ modo: 'existente', productoId: l.productoId, cantidad: cant });
        // Si tocaron la medida del producto existente, se actualiza en el inventario.
        const prod = activos.find((p) => p.id === l.productoId);
        const med = l.unidad.trim();
        if (prod && med && med.toLowerCase() !== (prod.unidad ?? '').toLowerCase()) {
          medidaUpdates.push({ id: prod.id, unidad: med });
          if (!tieneUni(med)) nuevasUnis.add(med);
        }
      } else {
        if (!l.nombre.trim()) { setError('Indicá el nombre del material nuevo.'); return; }
        const uni = l.unidad.trim() || 'und';
        const cat = l.categoria.trim();
        payload.push({ modo: 'nuevo', nombre: l.nombre, categoria: cat, unidad: uni, cantidad: cant });
        if (cat && !tieneCat(cat)) nuevasCats.add(cat);
        if (uni && !tieneUni(uni)) nuevasUnis.add(uni);
      }
    }
    setSaving(true);
    try {
      // Registrar en el catálogo las categorías/medidas nuevas + aplicar cambios de medida (best-effort).
      for (const c of nuevasCats) { try { await addCategoria(c, actor); } catch { /* duplicado/red: no bloquea */ } }
      for (const u of nuevasUnis) { try { await addUnidad(u, actor); } catch { /* duplicado/red: no bloquea */ } }
      for (const u of medidaUpdates) { try { await updateProducto(u.id, { unidad: u.unidad }); } catch { /* no bloquea la compra */ } }
      // Resolver el proveedor: existente elegido, o alta rápida si es nuevo.
      let proveedorId2: string | null = null;
      let proveedorNombre: string | null = null;
      if (provModo === 'nuevo' && provNombre.trim()) {
        const prov = await crearProveedorRapido(provNombre, provRif);
        proveedorId2 = prov.id; proveedorNombre = prov.razon_social;
      } else if (provModo === 'existente' && proveedorId) {
        const prov = proveedores.find((p) => p.id === proveedorId) ?? null;
        proveedorId2 = proveedorId; proveedorNombre = prov?.razon_social ?? null;
      }
      if (editCompra) {
        await editarCompraDirectaEnProceso(editCompra.id, { lineas: payload, almacen, proveedorId: proveedorId2, proveedorNombre, actor, actorName }, productos);
        notify(`Compra directa actualizada · ${payload.length} material(es)${proveedorNombre ? ` · ${proveedorNombre}` : ''}`, 'success', { link: '#/app/pedidos' });
      } else {
        await crearCompraDirecta({ lineas: payload, almacen, proveedorId: proveedorId2, proveedorNombre, actor, actorName }, productos);
        notify(`Compra directa creada · ${payload.length} material(es)${proveedorNombre ? ` · ${proveedorNombre}` : ''}`, 'success', { link: '#/app/pedidos' });
      }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : (editCompra ? 'No se pudo editar la compra directa.' : 'No se pudo crear la compra directa.')); setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="cd-form" className="btn btn-primary" disabled={saving}>{saving ? (editCompra ? 'Guardando…' : 'Creando…') : (editCompra ? 'Guardar cambios' : 'Crear compra directa')}</button>
    </>
  );

  return (
    <Modal title={editCompra ? `Editar compra directa${editCompra.codigo ? ` · ${editCompra.codigo}` : ''}` : 'Nueva compra directa'} size="lg" onClose={onClose} footer={footer}>
      <form id="cd-form" onSubmit={handleSubmit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        <AlmacenPicker value={almacen} onChange={setAlmacen} sedeLabel="Sede destino" label="Almacén destino" />

        {/* El modo se elige POR RENGLÓN: podés mezclar inventario + materiales nuevos. */}
        <div className="form-row" style={{ marginBottom: '.3rem' }}>
          <label>Materiales</label>
          <small className="muted">Cada renglón puede ser del 📦 Inventario o ＋ Nuevo (se da de alta con stock 0, sin precio; SKU automático).</small>
        </div>

        {lineas.map((l, idx) => (
          <div key={l.id} className="card" style={{ margin: '0 0 .6rem', padding: '.7rem .85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem', gap: '.5rem', flexWrap: 'wrap' }}>
              <div className="view-toggle" role="tablist" style={{ margin: 0 }}>
                <button type="button" className={l.modo === 'existente' ? 'active' : ''} disabled={!activos.length} onClick={() => set(l.id, { modo: 'existente' })}>📦 Inventario</button>
                <button type="button" className={l.modo === 'nuevo' ? 'active' : ''} onClick={() => set(l.id, { modo: 'nuevo' })}>＋ Nuevo</button>
              </div>
              {lineas.length > 1 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => quitar(l.id)} title="Quitar material">✕ Quitar material #{idx + 1}</button>}
            </div>

            {l.modo === 'existente' ? (
              <>
                <div className="form-row">
                  <label>Material #{idx + 1}</label>
                  <SearchSelect value={l.productoId}
                    onChange={(id) => set(l.id, { productoId: id, unidad: activos.find((p) => p.id === id)?.unidad ?? l.unidad })}
                    options={activos.map((p) => ({ value: p.id, label: `${p.nombre} · ${p.sku}` }))}
                    placeholder="🔎 Buscá el material…" emptyText="Sin materiales." />
                </div>
                <div className="form-grid">
                  <div className="form-row"><label>Medida / unidad</label>
                    <SearchSelect allowCreate value={l.unidad} onChange={(v) => set(l.id, { unidad: v })}
                      options={unidades.map((u) => ({ value: u, label: u }))}
                      placeholder="🔎 Buscá o escribí una medida…" emptyText="Sin medidas." />
                    <small className="muted" style={{ fontSize: '.72rem' }}>Si la cambiás, se actualiza la medida del producto en el inventario.</small></div>
                  <div className="form-row"><label>Cantidad</label>
                    <input className="input mono" type="number" min={1} step="any" value={l.cantidad} onChange={(e) => set(l.id, { cantidad: e.target.value })} required /></div>
                </div>
              </>
            ) : (
              <>
                <div className="form-row">
                  <label>Descripción del material nuevo</label>
                  <input className="input" value={l.nombre} onChange={(e) => set(l.id, { nombre: e.target.value.toUpperCase() })} placeholder="Nombre / descripción" />
                  <small className="muted">Se da de alta en el inventario (stock 0, sin precio). SKU automático.</small>
                </div>
                <div className="form-grid">
                  <div className="form-row"><label>Categoría</label>
                    <SearchSelect allowCreate value={l.categoria} onChange={(v) => set(l.id, { categoria: v.toUpperCase() })}
                      options={categorias.map((c) => ({ value: c, label: c }))}
                      placeholder="🔎 Buscá o escribí una categoría…" emptyText="Sin categorías." /></div>
                  <div className="form-row"><label>Medida / unidad</label>
                    <SearchSelect allowCreate value={l.unidad} onChange={(v) => set(l.id, { unidad: v })}
                      options={unidades.map((u) => ({ value: u, label: u }))}
                      placeholder="🔎 Buscá o escribí una medida…" emptyText="Sin medidas." /></div>
                  <div className="form-row"><label>Cantidad</label>
                    <input className="input mono" type="number" min={1} step="any" value={l.cantidad} onChange={(e) => set(l.id, { cantidad: e.target.value })} required /></div>
                </div>
              </>
            )}
          </div>
        ))}

        <button type="button" className="btn btn-sm btn-ghost" onClick={add}>＋ Agregar material</button>

        {/* Proveedor: se ingresa DESPUÉS de cargar los materiales y cantidades. Existente
            (buscable) o alta rápida de uno nuevo (pasa a la BD). Opcional. */}
        <div className="form-row" style={{ marginTop: '1rem', borderTop: '1px solid var(--border,#3a3a3a)', paddingTop: '.8rem' }}>
          <label>Proveedor (opcional)</label>
          <div className="view-toggle" role="tablist" style={{ margin: '0 0 .4rem' }}>
            <button type="button" className={provModo === 'existente' ? 'active' : ''} onClick={() => setProvModo('existente')}>🔎 Existente</button>
            <button type="button" className={provModo === 'nuevo' ? 'active' : ''} onClick={() => setProvModo('nuevo')}>＋ Nuevo proveedor</button>
          </div>
          {provModo === 'existente' ? (
            <SearchSelect
              value={proveedorId}
              onChange={setProveedorId}
              options={proveedores.map((p) => ({ value: p.id, label: `${p.razon_social}${p.rif ? ` · ${p.rif}` : ''}` }))}
              placeholder="🔎 Buscá el proveedor…"
              emptyText="Sin proveedores. Usá ＋ Nuevo proveedor."
              style={{ maxWidth: 420 }}
            />
          ) : (
            <div className="form-grid">
              <div className="form-row" style={{ margin: 0 }}>
                <label>Razón social del nuevo proveedor</label>
                <input className="input" value={provNombre} onChange={(e) => setProvNombre(e.target.value)} placeholder="Nombre / razón social" />
              </div>
              <div className="form-row" style={{ margin: 0 }}>
                <label>RIF</label>
                <input className="input" value={provRif} onChange={(e) => setProvRif(e.target.value.toUpperCase())} placeholder="J-12345678-9" />
              </div>
              <small className="muted" style={{ gridColumn: '1 / -1' }}>Se da de alta en el módulo Proveedores (razón social + RIF). Lo demás se completa luego.</small>
            </div>
          )}
        </div>

        <p className="hint muted" style={{ fontSize: '.78rem', marginTop: '.5rem' }}>En este método no se cargan precios. El gasto por material y la caja se indican al finalizar.</p>
      </form>
    </Modal>
  );
}

/* ───────── Modal: montar (analista carga factura + precios → POR PAGAR) ───────── */

/** Línea editable del montaje: cantidad y costo unitario modificables; se puede quitar.
 *  El monto del renglón = cantidad × costo unit. (se recalcula al cambiar la cantidad). */
type MontarLinea = { key: number; producto_id: string; producto_nombre: string; producto_sku: string | null; cantidad: string; costoUnit: string };

const IVA_PCT = 16;   // IVA vigente (%). Sugerido; el monto queda editable.
const IGTF_PCT = 3;   // IGTF vigente (%). Sugerido para pagos en divisas; el monto queda editable.

function MontarCompraModal({ compra, actor, actorName, onClose, onSaved }: {
  compra: CompraDirecta; actor: string; actorName?: string | null; onClose: () => void; onSaved: () => void;
}) {
  // Líneas editables: la cantidad de cada material se puede cambiar y los materiales se
  // pueden eliminar (la mercancía aún no entró al inventario, entra recién al pagar).
  const [lineas, setLineas] = useState<MontarLinea[]>(() => compra.items.map((it, i) => {
    const cant = Number(it.cantidad) || 0;
    const g = Number(it.gasto) || 0;
    const cu = cant > 0 && g > 0 ? g / cant : 0;
    return {
      key: i, producto_id: it.producto_id, producto_nombre: it.producto_nombre, producto_sku: it.producto_sku,
      cantidad: String(it.cantidad ?? ''), costoUnit: cu > 0 ? String(Math.round(cu * 1e4) / 1e4) : '',
    };
  }));
  const [moneda, setMoneda] = useState<'USD' | 'Bs'>(compra.moneda === 'Bs' ? 'Bs' : 'USD');
  const [descPctStr, setDescPctStr] = useState(compra.descuento_pct ? String(compra.descuento_pct) : '');
  const [descMontoStr, setDescMontoStr] = useState(compra.descuento_monto ? String(compra.descuento_monto) : '');
  const [ivaStr, setIvaStr] = useState(compra.iva ? String(compra.iva) : '');
  const [ivaPctStr, setIvaPctStr] = useState('');   // IVA en %: sincronizado con el monto (se auto-rellena)
  const [ivaManual, setIvaManual] = useState(!!compra.iva);   // si el usuario tocó el IVA, no se auto-sugiere
  const [retPctStr, setRetPctStr] = useState(compra.retencion_pct ? String(compra.retencion_pct) : '');
  // IGTF (impuesto a grandes transacciones financieras): opcional, se carga por % o en monto.
  // Se suma al total. Aplica sobre todo cuando la compra se paga en divisas ($).
  const [igtfStr, setIgtfStr] = useState(compra.igtf ? String(compra.igtf) : '');
  const [igtfPctStr, setIgtfPctStr] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [nota, setNota] = useState(compra.nota ?? '');
  // Pago a externo: una persona externa YA pagó la compra; Tesorería le reintegra al pagar.
  const [pagoExterno, setPagoExterno] = useState(!!compra.pago_externo);
  const [pagoExternoDatos, setPagoExternoDatos] = useState(compra.pago_externo_datos ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tasa BCV (Bs/$) de la compra. En Bs es OBLIGATORIA: con ella se valoran los materiales
  // en $ al entrar al inventario. Se precarga con la guardada o la del día; es MODIFICABLE.
  const [tasaStr, setTasaStr] = useState(compra.tasa_bcv ? String(compra.tasa_bcv) : '');
  const [tasaBcv, setTasaBcv] = useState(0);
  useEffect(() => {
    getTasaHoy().then((t) => {
      const v = Number(t.usd) || 0;
      if (v > 0) { setTasaBcv(v); setTasaStr((prev) => prev || String(v)); }
    }).catch(() => { /* sin tasa */ });
  }, []);
  const tasaUsd = Number(tasaStr) || 0;

  const setLinea = (key: number, patch: Partial<MontarLinea>) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLinea = (key: number) => setLineas((ls) => ls.filter((l) => l.key !== key));

  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  // Monto del renglón = cantidad × costo unit. (redondeado a centavos).
  const montoLinea = (l: MontarLinea) => round2((Number(l.cantidad) || 0) * (Number(l.costoUnit) || 0));
  const subtotal = useMemo(() => round2(lineas.reduce((a, l) => a + montoLinea(l), 0)), [lineas]);

  // Descuento (sincronizado): editar % recalcula el monto y viceversa. Puede ser NEGATIVO
  // (recargo) cuando el total se ajusta hacia arriba. Nunca deja la base negativa.
  const descMonto = Math.min(round2(Number(descMontoStr) || 0), subtotal);
  const base = round2(subtotal - descMonto);
  const onDescPct = (v: string) => {
    setDescPctStr(v);
    const pct = Math.max(0, Number(v) || 0);
    setDescMontoStr(pct > 0 && subtotal > 0 ? String(round2(subtotal * (pct / 100))) : '');
  };
  const onDescMonto = (v: string) => {
    setDescMontoStr(v);
    const m = Math.max(0, Number(v) || 0);
    setDescPctStr(m > 0 && subtotal > 0 ? String(Math.round((m / subtotal) * 10000) / 100) : '');
  };

  // IVA (sólo Bs): DOBLE entrada — se puede colocar por % o en monto, sincronizados. Se
  // auto-sugiere 16% de la base salvo que el usuario lo edite (a mano o cambiando el %).
  const ivaSugerido = round2(base * (IVA_PCT / 100));
  const iva = moneda === 'Bs' ? round2(Math.max(0, Number(ivaStr) || 0)) : 0;
  const onIvaPct = (v: string) => {
    setIvaManual(true); setIvaPctStr(v);
    const pct = Math.max(0, Number(v) || 0);
    setIvaStr(pct > 0 && base > 0 ? String(round2(base * (pct / 100))) : '');
  };
  const onIvaMonto = (v: string) => {
    setIvaManual(true); setIvaStr(v);
    const m = Math.max(0, Number(v) || 0);
    setIvaPctStr(m > 0 && base > 0 ? String(Math.round((m / base) * 10000) / 100) : '');
  };
  useEffect(() => {
    if (moneda === 'Bs' && !ivaManual) { setIvaPctStr(String(IVA_PCT)); setIvaStr(ivaSugerido > 0 ? String(ivaSugerido) : ''); }
    if (moneda === 'USD') { setIvaStr(''); setIvaPctStr(''); setRetPctStr(''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moneda, base, ivaManual]);
  // Backfill del % de IVA al reabrir una compra ya montada (monto conocido, % vacío).
  useEffect(() => {
    if (ivaManual && !ivaPctStr && iva > 0 && base > 0) setIvaPctStr(String(Math.round((iva / base) * 10000) / 100));
  }, [ivaManual, ivaPctStr, iva, base]);

  // Retención de IVA: % sobre el IVA (sólo cuando hay IVA).
  const retPct = iva > 0 ? Math.max(0, Number(retPctStr) || 0) : 0;
  const retMonto = round2(iva * (retPct / 100));

  // IGTF: opcional, DOBLE entrada (% o monto, sincronizados). Se suma al total. La base de
  // cálculo del % es la base (subtotal − descuento). Aplica al pagar en divisas ($).
  const igtfSugerido = round2(base * (IGTF_PCT / 100));
  const igtf = round2(Math.max(0, Number(igtfStr) || 0));
  const onIgtfPct = (v: string) => {
    setIgtfPctStr(v);
    const pct = Math.max(0, Number(v) || 0);
    setIgtfStr(pct > 0 && base > 0 ? String(round2(base * (pct / 100))) : '');
  };
  const onIgtfMonto = (v: string) => {
    setIgtfStr(v);
    const m = Math.max(0, Number(v) || 0);
    setIgtfPctStr(m > 0 && base > 0 ? String(Math.round((m / base) * 10000) / 100) : '');
  };
  // Backfill del % de IGTF al reabrir (monto conocido, % vacío).
  useEffect(() => {
    if (!igtfPctStr && igtf > 0 && base > 0) setIgtfPctStr(String(Math.round((igtf / base) * 10000) / 100));
  }, [igtfPctStr, igtf, base]);

  const total = round2(base + iva + igtf);   // lo que paga Tesorería
  const monedaLbl = moneda === 'Bs' ? 'Bs' : 'USD';

  // Total editable: al escribir un total, se despeja el descuento para cuajar con él
  // (sincroniza). Mientras se edita el campo no se pisa el texto (respeta decimales).
  const [totalStr, setTotalStr] = useState('');
  const editandoTotal = useRef(false);
  useEffect(() => {
    if (!editandoTotal.current) setTotalStr(total > 0 ? String(total) : '');
  }, [total]);
  const onTotalEdit = (v: string) => {
    setTotalStr(v);
    // Congela el IVA para que el total quede EXACTO al valor tecleado.
    if (moneda === 'Bs') setIvaManual(true);
    const desired = Math.max(0, Number(v) || 0);
    // El descuento absorbe la diferencia: total = subtotal − desc + iva + igtf → desc = subtotal + iva + igtf − total.
    // Puede quedar negativo (recargo) si el total se ajusta hacia arriba.
    const desc = Math.min(subtotal, round2(subtotal + iva + igtf - desired));
    setDescMontoStr(desc !== 0 ? String(desc) : '');
    setDescPctStr(desc !== 0 && subtotal > 0 ? String(Math.round((desc / subtotal) * 10000) / 100) : '');
  };

  // Convierte los costos cargados a la otra moneda ($↔Bs) a la tasa y cambia la moneda.
  // La tasa es la del campo (BCV del día o la que ponga el usuario). El descuento en monto
  // se convierte también (el % se mantiene). El IVA se re-sugiere en la nueva moneda.
  function convertirMoneda() {
    const r = Number(tasaStr) || 0;
    if (r <= 0) { setError('Colocá la tasa (Bs por $) para convertir.'); return; }
    const toBs = moneda === 'USD';
    const conv = (n: number) => round2(toBs ? n * r : n / r);
    setLineas((ls) => ls.map((l) => { const cu = Number(l.costoUnit) || 0; return cu > 0 ? { ...l, costoUnit: String(conv(cu)) } : l; }));
    setDescMontoStr((s) => { const m = Number(s) || 0; return m !== 0 ? String(conv(m)) : s; });
    setIgtfStr((s) => { const m = Number(s) || 0; return m !== 0 ? String(conv(m)) : s; });   // IGTF (monto) se convierte también
    setIvaManual(false);
    setMoneda(toBs ? 'Bs' : 'USD');
    setError(null);
    toast(`Costos convertidos a ${toBs ? 'Bs' : '$'} a la tasa ${r.toLocaleString('es-VE')}`, 'success');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!lineas.length) { setError('Dejá al menos un material en la compra.'); return; }
    if (lineas.some((l) => (Number(l.cantidad) || 0) <= 0)) { setError('Cada material debe tener cantidad mayor que 0.'); return; }
    if (subtotal <= 0) { setError('Indicá el costo unitario de cada material.'); return; }
    if (total <= 0) { setError('El total no puede quedar en 0 (revisá el descuento).'); return; }
    if (moneda === 'Bs' && tasaUsd <= 0) { setError('Colocá la tasa BCV (Bs por $): el inventario se valora en dólares y cada material entrará convertido con esa tasa.'); return; }
    if (file && file.type && file.type !== 'application/pdf' && !file.type.startsWith('image/')) { setError('El adjunto debe ser un PDF o una imagen.'); return; }
    if (pagoExterno && !pagoExternoDatos.trim()) { setError('Ingresá los datos de la persona externa que pagó (para reintegrarle).'); return; }
    const items: CompraDirectaItem[] = lineas.map((l) => ({
      producto_id: l.producto_id, producto_nombre: l.producto_nombre, producto_sku: l.producto_sku,
      cantidad: Number(l.cantidad) || 0, gasto: montoLinea(l),
    }));
    setSaving(true);
    try {
      await montarCompraDirecta({
        compra, items, file, nota, actor, actorName,
        moneda, tasaBcv: moneda === 'Bs' ? tasaUsd : undefined, descuentoMonto: descMonto, iva, igtf, retencionPct: retPct,
        pagoExterno, pagoExternoDatos,
      });
      notify(`Compra enviada a Tesorería · ${montoCaja(total, monedaLbl)} por pagar`, 'success', { link: '#/app/tesoreria' });
      onSaved();
    } catch (err) {
      // Los errores de Supabase (Postgrest/Storage) no siempre son `Error`: sacamos su .message igual.
      const msg = err instanceof Error ? err.message
        : (err && typeof err === 'object' && 'message' in err) ? String((err as { message: unknown }).message)
        : 'No se pudo enviar la compra a Tesorería.';
      setError(msg); setSaving(false);
    }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="cd-fin-form" className="btn btn-primary" disabled={saving}>{saving ? 'Enviando…' : `Enviar a Tesorería · ${montoCaja(total, monedaLbl)}`}</button>
    </>
  );

  return (
    <Modal title="Cargar factura y precios" size="lg" onClose={onClose} footer={footer}>
      <form id="cd-fin-form" onSubmit={handleSubmit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        <p className="hint muted" style={{ marginTop: 0, fontSize: '.84rem' }}>
          Cargá los <strong>precios por material</strong> y la <strong>factura</strong>. Podés <strong>ajustar la cantidad</strong> o <strong>quitar materiales</strong>. La compra queda <strong>Por pagar</strong> y aparece en <strong>Tesorería</strong>; cuando ahí se pague, el gasto sale de la caja y los materiales <strong>entran al inventario</strong> ({compra.almacen}). La <strong>categoría de gasto la elige Tesorería al pagar</strong>.
        </p>

        {/* Moneda de la compra: en Bs se habilita el IVA (16%) y la retención de IVA. */}
        <div className="form-row">
          <label>Moneda de la compra</label>
          <div className="view-toggle" role="tablist" style={{ margin: 0 }}>
            <button type="button" className={moneda === 'USD' ? 'active' : ''} onClick={() => setMoneda('USD')}>$ Dólares</button>
            <button type="button" className={moneda === 'Bs' ? 'active' : ''} onClick={() => setMoneda('Bs')}>Bs Bolívares</button>
          </div>
          {moneda === 'Bs' && <small className="muted">En Bs se suma el IVA (16%) al total y podés registrar la retención de IVA.</small>}
          {/* Convertir los costos a la otra moneda a la tasa (del día o la que ponga el usuario). */}
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '.45rem' }}>
            {/* En Bs la tasa es la del campo «Tasa BCV» de abajo: un solo campo, una sola tasa. */}
            {moneda === 'USD' && (
              <>
                <span className="muted" style={{ fontSize: '.78rem' }}>Tasa (Bs por $)</span>
                <input className="input mono" type="number" min={0} step="any" style={{ maxWidth: 140 }} value={tasaStr} onChange={(e) => setTasaStr(e.target.value)} placeholder="0,00" />
                {tasaBcv > 0 && Number(tasaStr) !== tasaBcv && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTasaStr(String(tasaBcv))}>↻ Hoy ({tasaBcv.toLocaleString('es-VE')})</button>}
              </>
            )}
            <button type="button" className="btn btn-sm btn-primary" onClick={convertirMoneda}>⇄ Convertir a {moneda === 'USD' ? 'Bs' : '$'}</button>
          </div>
          <small className="muted">Convierte los costos cargados a {moneda === 'USD' ? 'Bs' : '$'} a {moneda === 'USD' ? 'esa tasa' : 'la tasa BCV de abajo'}. El total convertido es el que va a Tesorería.</small>
        </div>

        {moneda === 'Bs' && (
          <div className="form-row">
            <label>Tasa BCV (Bs por $) <span style={{ color: 'var(--danger)' }}>*</span> {tasaBcv > 0 && <span className="muted" style={{ fontWeight: 400 }}>· hoy {montoCaja(tasaBcv, 'Bs')}</span>}</label>
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input className="input mono" type="number" min={0} step="any" style={{ maxWidth: 180 }}
                value={tasaStr} onChange={(e) => setTasaStr(e.target.value)} placeholder="0,00" />
              {tasaBcv > 0 && Number(tasaStr) !== tasaBcv && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTasaStr(String(tasaBcv))}>↻ Usar BCV ({montoCaja(tasaBcv, 'Bs')})</button>
              )}
            </div>
            <small className="muted">Cargá la tasa BCV de la <strong>fecha de la factura</strong> (se precarga la de hoy: cambiala si la factura es de otro día). Con esta tasa los materiales se valoran <strong>en dólares</strong> al entrar al inventario.</small>
          </div>
        )}

        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead><tr><th>Material</th><th style={{ width: 110, textAlign: 'right' }}>Cantidad</th><th style={{ width: 150 }}>Costo unit.</th><th style={{ textAlign: 'right' }}>Monto</th><th></th></tr></thead>
            <tbody>
              {!lineas.length ? (
                <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>No quedan materiales. Cancelá o agregá de nuevo.</td></tr>
              ) : lineas.map((l) => (
                <tr key={l.key}>
                  <td>{l.producto_nombre}{l.producto_sku ? <span className="muted"> · {l.producto_sku}</span> : null}</td>
                  <td><input className="input mono" type="number" min={0} step="any" style={{ textAlign: 'right' }} value={l.cantidad} onChange={(e) => setLinea(l.key, { cantidad: e.target.value })} placeholder="0" /></td>
                  <td><input className="input mono" type="number" min={0} step="any" value={l.costoUnit} onChange={(e) => setLinea(l.key, { costoUnit: e.target.value })} placeholder="0,00" /></td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{montoCaja(montoLinea(l), monedaLbl)}</td>
                  <td style={{ textAlign: 'right' }}><button type="button" className="btn btn-sm btn-ghost" onClick={() => removeLinea(l.key)} title="Quitar material">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Descuento (en % o en monto, sincronizados) → baja la base. */}
        <div className="form-grid" style={{ marginTop: '.5rem' }}>
          <div className="form-row" style={{ margin: 0 }}>
            <label>Descuento (%)</label>
            <input className="input mono" type="number" min={0} max={100} step="any" value={descPctStr} onChange={(e) => onDescPct(e.target.value)} placeholder="0" />
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            <label>Descuento ({monedaLbl})</label>
            <input className="input mono" type="number" min={0} step="any" value={descMontoStr} onChange={(e) => onDescMonto(e.target.value)} placeholder="0,00" />
          </div>
        </div>

        {/* IVA (por % o en monto, sincronizados) + retención de IVA (sólo en Bs). */}
        {moneda === 'Bs' && (
          <div className="form-grid" style={{ marginTop: '.5rem' }}>
            <div className="form-row" style={{ margin: 0 }}>
              <label>IVA (%) <span className="muted" style={{ fontWeight: 400 }}>· sugerido {IVA_PCT}%</span></label>
              <input className="input mono" type="number" min={0} step="any" value={ivaPctStr}
                onChange={(e) => onIvaPct(e.target.value)} placeholder={String(IVA_PCT)} />
              <small className="muted">Escribí el % o el monto: se sincronizan.</small>
            </div>
            <div className="form-row" style={{ margin: 0 }}>
              <label>IVA ({monedaLbl}) <span className="muted" style={{ fontWeight: 400 }}>· monto</span></label>
              <input className="input mono" type="number" min={0} step="any" value={ivaStr}
                onChange={(e) => onIvaMonto(e.target.value)} placeholder="0,00" />
              <small className="muted">
                {ivaManual
                  ? <button type="button" className="btn btn-sm btn-ghost" style={{ padding: 0 }} onClick={() => setIvaManual(false)}>↻ Volver a {IVA_PCT}% ({montoCaja(ivaSugerido, monedaLbl)})</button>
                  : `${IVA_PCT}% de la base (${montoCaja(base, monedaLbl)})`}
              </small>
            </div>
            <div className="form-row" style={{ margin: 0 }}>
              <label>Retención de IVA (% sobre el IVA)</label>
              <input className="input mono" type="number" min={0} max={100} step="any" value={retPctStr} onChange={(e) => setRetPctStr(e.target.value)} placeholder="0" disabled={iva <= 0} />
              <small className="muted">{retPct > 0 ? `Se retiene ${montoCaja(retMonto, monedaLbl)} · va a Retenciones` : 'Vincula la compra al módulo de Retenciones'}</small>
            </div>
          </div>
        )}

        {/* IGTF: segmento opcional por % o en monto (sincronizados). Se suma al total.
            Aplica sobre todo cuando la compra se paga en divisas ($). */}
        <div className="form-grid" style={{ marginTop: '.5rem' }}>
          <div className="form-row" style={{ margin: 0 }}>
            <label>IGTF (%) <span className="muted" style={{ fontWeight: 400 }}>· sugerido {IGTF_PCT}%</span></label>
            <input className="input mono" type="number" min={0} step="any" value={igtfPctStr}
              onChange={(e) => onIgtfPct(e.target.value)} placeholder="0" />
            <small className="muted">
              {igtf > 0
                ? <button type="button" className="btn btn-sm btn-ghost" style={{ padding: 0 }} onClick={() => onIgtfPct('')}>✕ Quitar IGTF</button>
                : <button type="button" className="btn btn-sm btn-ghost" style={{ padding: 0 }} onClick={() => onIgtfPct(String(IGTF_PCT))}>+ Aplicar {IGTF_PCT}% de la base ({montoCaja(igtfSugerido, monedaLbl)})</button>}
            </small>
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            <label>IGTF ({monedaLbl}) <span className="muted" style={{ fontWeight: 400 }}>· monto</span></label>
            <input className="input mono" type="number" min={0} step="any" value={igtfStr}
              onChange={(e) => onIgtfMonto(e.target.value)} placeholder="0,00" />
            <small className="muted">Impuesto a grandes transacciones financieras. Se suma al total{moneda === 'USD' ? ' (pago en divisas)' : ''}.</small>
          </div>
        </div>

        {/* Resumen de montos. */}
        <div className="card" style={{ margin: '.6rem 0', fontSize: '.88rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Subtotal</span><strong className="mono">{montoCaja(subtotal, monedaLbl)}</strong></div>
          {descMonto > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Descuento{descPctStr ? ` (${descPctStr}%)` : ''}</span><strong className="mono">− {montoCaja(descMonto, monedaLbl)}</strong></div>}
          {descMonto < 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Ajuste (recargo)</span><strong className="mono">+ {montoCaja(-descMonto, monedaLbl)}</strong></div>}
          {moneda === 'Bs' && iva > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">IVA{ivaPctStr ? ` (${ivaPctStr}%)` : ''}</span><strong className="mono">+ {montoCaja(iva, monedaLbl)}</strong></div>}
          {igtf > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">IGTF{igtfPctStr ? ` (${igtfPctStr}%)` : ''}</span><strong className="mono">+ {montoCaja(igtf, monedaLbl)}</strong></div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', marginTop: '.35rem', paddingTop: '.35rem', gap: '.6rem' }}>
            <strong>Total por pagar ({monedaLbl})</strong>
            <input className="input mono" type="number" min={0} step="any" style={{ maxWidth: 160, textAlign: 'right', fontWeight: 700 }}
              value={totalStr}
              onFocus={() => { editandoTotal.current = true; }}
              onBlur={() => { editandoTotal.current = false; setTotalStr(total > 0 ? String(total) : ''); }}
              onChange={(e) => onTotalEdit(e.target.value)} placeholder="0,00" />
          </div>
          <small className="muted">Podés escribir el total directo y el descuento se ajusta solo para cuajar.</small>
          {moneda === 'Bs' && tasaUsd > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.82rem' }}>
              <span className="muted">Equivalente en $ · tasa {montoCaja(tasaUsd, 'Bs')}</span>
              <span className="mono">≈ {montoCaja(round2(total / tasaUsd), 'USD')}</span>
            </div>
          )}
          {retMonto > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.82rem' }}><span className="muted">Retención de IVA ({retPct}%)</span><span className="mono">{montoCaja(retMonto, monedaLbl)}</span></div>}
        </div>

        <div className="form-row">
          <label>Adjuntar FACTURA de la compra · PDF o imagen</label>
          <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file ? <small className="muted">{file.name}</small> : (compra.facturas?.length ? <small className="muted">Ya hay {compra.facturas.length} factura(s) cargada(s).</small> : null)}
        </div>

        <div className="form-row">
          <label>Nota para Tesorería <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
          <textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: Pago realizado por Equis persona, se le debe reembolsar." />
          <small className="muted">Tesorería la lee al momento de pagar (y elige ahí la categoría de gasto).</small>
        </div>

        {/* Pago a externo: una persona externa YA pagó; MGG debe reintegrarle. Lo ve Tesorería al pagar. */}
        <div className="form-row" style={{ borderTop: '1px solid var(--border,#3a3a3a)', paddingTop: '.8rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={pagoExterno} onChange={(e) => setPagoExterno(e.target.checked)} />
            <span>💳 Pago a externo <span className="muted" style={{ fontWeight: 400 }}>(lo pagó otra persona; hay que reintegrarle)</span></span>
          </label>
          {pagoExterno && (
            <div style={{ marginTop: '.5rem' }}>
              <label>Datos de la persona externa que pagó <span style={{ color: 'var(--danger)' }}>*</span></label>
              <textarea className="input" rows={2} value={pagoExternoDatos} onChange={(e) => setPagoExternoDatos(e.target.value)}
                placeholder="Nombre, C.I. / RIF, teléfono, y cómo reintegrarle (cuenta / pago móvil)…" />
              <small className="muted">Aparece en el detalle y en Tesorería: al pagar, el egreso reintegra el dinero a esta persona.</small>
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
