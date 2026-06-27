import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { notify } from '@/shared/lib/notify';
import { dateTime, money, num, dosDecimales } from '@/shared/lib/format';
// descargarCompraDirectaPdf se importa dinámicamente (al generar) para no cargar jsPDF al abrir la vista.
import { list as listProveedores, crearProveedorRapido } from '@/modules/proveedores/proveedores.repository';
import { AlmacenPicker } from '@/modules/inventario/AlmacenPicker';
import type { Caja, Producto, Proveedor } from '@/shared/lib/types';
import { getCategorias, getUnidades, listProductos, updateProducto, addCategoria, addUnidad } from '@/modules/inventario/inventario.repository';
import { listCajasActivas } from '@/modules/salidas/cajas.repository';
import { listCategoriasGasto, soloCategorias, subcategoriasDe, type CategoriaGasto } from '@/modules/tesoreria/categoriasGasto.repository';
import {
  crearCompraDirecta, montarCompraDirecta, listComprasDirectas, eliminarCompraDirecta,
  urlAdjuntoCompra, gestionarFacturasCompra, editarCompraDirectaFinalizada, type CompraDirecta, type CompraDirectaItem, type LineaCompra,
} from './compras.repository';
import { FacturasModal } from './FacturasModal';
import { EditarMontosModal } from './EditarMontosModal';
import { DetalleDirectoModal } from './DetalleDirectoModal';
import { previewFileUrl } from '@/shared/lib/reportPreview';

type Vista = 'kanban' | 'lista';

const COLS: { key: CompraDirecta['estado']; label: string }[] = [
  { key: 'en_proceso', label: 'En proceso' },
  { key: 'por_pagar', label: 'Por pagar' },
  { key: 'finalizada', label: 'Finalizada' },
];
const ESTADO_LABEL: Record<string, string> = { en_proceso: '⏳ En proceso', por_pagar: '💸 Por pagar', finalizada: '🏁 Finalizada' };

function montoCaja(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${v}` : `${moneda} ${v}`;
}

export function CompraDirectaView({ actor, actorName }: { actor: string; actorName?: string | null }) {
  const [compras, setCompras] = useState<CompraDirecta[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [unidades, setUnidades] = useState<string[]>([]);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [vista, setVista] = useState<Vista>('kanban');
  const [crear, setCrear] = useState(false);
  const [finalizar, setFinalizar] = useState<CompraDirecta | null>(null);
  const [eliminar, setEliminar] = useState<CompraDirecta | null>(null);
  const [facturas, setFacturas] = useState<CompraDirecta | null>(null);
  const [editarMontos, setEditarMontos] = useState<CompraDirecta | null>(null);
  const [detalle, setDetalle] = useState<CompraDirecta | null>(null);

  // Solo la lista (la tabla/kanban). Lo que se muestra va denormalizado en la fila,
  // así que una mutación o un evento realtime de compras_directas pide UNA consulta.
  const reloadLista = useCallback(async () => {
    setCompras(await listComprasDirectas().catch(() => [] as CompraDirecta[]));
  }, []);

  // Catálogos del formulario de alta (productos, categorías, medidas, cajas, proveedores):
  // casi estáticos; se cargan al entrar y solo se refrescan si cambian en su origen.
  const reloadCatalogos = useCallback(async () => {
    const [pds, cats, unis, cjs, provs] = await Promise.all([
      listProductos().catch(() => [] as Producto[]),
      getCategorias().catch(() => [] as string[]),
      getUnidades().catch(() => [] as string[]),
      listCajasActivas().catch(() => [] as Caja[]),
      listProveedores().catch(() => [] as Proveedor[]),
    ]);
    setProductos(pds); setCategorias(cats); setUnidades(unis); setCajas(cjs);
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
    const m: Record<string, CompraDirecta[]> = { en_proceso: [], finalizada: [] };
    compras.forEach((c) => { (m[c.estado] ??= []).push(c); });
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
      await eliminarCompraDirecta(c);
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
                    onFinalizar={() => setFinalizar(c)} onPdf={() => handlePdf(c)} onFacturas={() => setFacturas(c)} onEditarMontos={() => setEditarMontos(c)} onEliminar={() => setEliminar(c)} />
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
                  <td className="mono">{c.gasto != null ? money(c.gasto) : '—'}</td>
                  <td>{c.actor_name || c.actor || '—'}</td>
                  <td className="muted">{dateTime(c.created_at)}</td>
                  <td className="muted">{c.finalizada_at ? dateTime(c.finalizada_at) : '—'}</td>
                  <td className="actions" style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-sm btn-ghost" onClick={() => handlePdf(c)} title="Ver detalle en PDF (vista previa)">↓ PDF</button>
                    {c.estado === 'finalizada' && <button className="btn btn-sm btn-ghost" onClick={() => setEditarMontos(c)} title="Editar montos (sincroniza Tesorería e inventario)">✎ Editar</button>}
                    {c.estado === 'finalizada' && <button className="btn btn-sm btn-ghost" onClick={() => setFacturas(c)} title="Cargar nuevas facturas / quitar anteriores">🧾 Facturas</button>}
                    {c.estado === 'en_proceso' && <button className="btn btn-sm btn-primary" onClick={() => setFinalizar(c)}>Cargar factura y precios</button>}
                    {c.estado === 'por_pagar' && <button className="btn btn-sm btn-ghost" onClick={() => setFinalizar(c)} title="Editar factura/precios (en Tesorería para pagar)">✎ Factura/precios</button>}
                    {c.estado === 'en_proceso' && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setEliminar(c)} title="Eliminar compra directa">🗑</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {crear && (
        <CrearCompraModal productos={productos} categorias={categorias} unidades={unidades} proveedores={proveedores}
          actor={actor} actorName={actorName} onClose={() => setCrear(false)} onSaved={async () => { setCrear(false); await Promise.all([reloadLista(), reloadCatalogos()]); }} />
      )}

      {finalizar && (
        <MontarCompraModal compra={finalizar} actor={actor} actorName={actorName}
          onClose={() => setFinalizar(null)} onSaved={async () => { setFinalizar(null); await reloadLista(); }} />
      )}

      {eliminar && (
        <ConfirmDialog
          title="Eliminar compra directa"
          message={`¿Eliminar la compra directa ${eliminar.codigo ? `${eliminar.codigo} · ` : ''}"${eliminar.producto_nombre}"? Esta acción no se puede deshacer.`}
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

      {editarMontos && (
        <EditarMontosModal
          title={`Editar montos · ${editarMontos.codigo ?? 'Compra directa'}`}
          moneda={cajas.find((c) => c.id === editarMontos.caja_id)?.moneda ?? 'USD'}
          rows={editarMontos.items.map((it) => ({ nombre: `${it.producto_nombre}${it.producto_sku ? ` · ${it.producto_sku}` : ''}`, cantidad: it.cantidad, gasto: Number(it.gasto) || 0 }))}
          onSave={async (gastos) => {
            const items = editarMontos.items.map((it, i) => ({ ...it, gasto: gastos[i] ?? 0 }));
            await editarCompraDirectaFinalizada({ compra: editarMontos, items, actor, actorName });
            await reloadLista();
          }}
          onClose={() => setEditarMontos(null)}
        />
      )}

      {detalle && (
        <DetalleDirectoModal
          title={`Compra directa · ${detalle.codigo ?? ''}`}
          estadoLabel={ESTADO_LABEL[detalle.estado] ?? detalle.estado}
          ficha={[
            ['Almacén', detalle.almacen || '—'],
            ['Proveedor', detalle.proveedor_nombre || '—'],
            ['Generó', detalle.actor_name || detalle.actor || '—'],
            ['Creada', dateTime(detalle.created_at)],
            ['Comprada', detalle.finalizada_at ? dateTime(detalle.finalizada_at) : '—'],
          ]}
          itemsTitle="Materiales"
          items={detalle.items.map((it) => ({ nombre: `${it.producto_nombre}${it.producto_sku ? ` · ${it.producto_sku}` : ''}`, cantidad: it.cantidad, gasto: it.gasto }))}
          moneda={cajas.find((c) => c.id === detalle.caja_id)?.moneda ?? 'USD'}
          total={detalle.gasto}
          facturas={detalle.facturas}
          urlFor={urlAdjuntoCompra}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setDetalle(null)}>Cerrar</button>
              <button className="btn btn-ghost" onClick={() => handlePdf(detalle)}>↓ PDF</button>
              {detalle.estado === 'finalizada' && <button className="btn btn-ghost" onClick={() => { setFacturas(detalle); setDetalle(null); }}>🧾 Facturas</button>}
              {detalle.estado === 'finalizada' && <button className="btn btn-primary" onClick={() => { setEditarMontos(detalle); setDetalle(null); }}>✎ Editar montos</button>}
              {detalle.estado === 'en_proceso' && <button className="btn btn-primary" onClick={() => { setFinalizar(detalle); setDetalle(null); }}>Cargar factura y precios</button>}
              {detalle.estado === 'por_pagar' && <button className="btn btn-primary" onClick={() => { setFinalizar(detalle); setDetalle(null); }}>✎ Editar factura/precios</button>}
            </>
          }
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  );
}

function CompraCard({ compra, onVer, onFinalizar, onPdf, onFacturas, onEditarMontos, onEliminar }: {
  compra: CompraDirecta; onVer: () => void; onFinalizar: () => void; onPdf: () => void; onFacturas: () => void; onEditarMontos: () => void; onEliminar: () => void;
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
      {compra.estado === 'por_pagar' && (
        <div style={{ fontSize: '.8rem', marginTop: '.4rem' }}>
          <div>Por pagar: <strong className="mono">{compra.gasto != null ? money(compra.gasto) : '—'}</strong></div>
          <div className="muted" style={{ fontSize: '.72rem' }}>💸 En Tesorería para pagar</div>
          <div className="muted"><AdjuntoLink compra={compra} /></div>
        </div>
      )}
      {compra.estado === 'finalizada' && (
        <div style={{ fontSize: '.8rem', marginTop: '.4rem' }}>
          <div>Gasto: <strong className="mono">{compra.gasto != null ? money(compra.gasto) : '—'}</strong></div>
          {compra.pagada_por && <div className="muted" style={{ fontSize: '.72rem' }}>Pagó: {compra.pagada_por}</div>}
          <div className="muted"><AdjuntoLink compra={compra} /></div>
        </div>
      )}
      <div style={{ display: 'flex', gap: '.4rem', marginTop: '.5rem', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-sm btn-ghost" onClick={onPdf} title="Ver detalle en PDF (vista previa)">↓ PDF</button>
        {compra.estado === 'finalizada' && <button className="btn btn-sm btn-ghost" onClick={onEditarMontos} title="Editar montos (sincroniza Tesorería e inventario)">✎ Editar</button>}
        {compra.estado === 'finalizada' && <button className="btn btn-sm btn-ghost" onClick={onFacturas} title="Cargar nuevas facturas / quitar anteriores">🧾 Facturas</button>}
        {compra.estado === 'en_proceso' && <button className="btn btn-sm btn-primary" onClick={onFinalizar}>Cargar factura y precios</button>}
        {compra.estado === 'por_pagar' && <button className="btn btn-sm btn-ghost" onClick={onFinalizar} title="Editar factura/precios (en Tesorería para pagar)">✎ Factura/precios</button>}
        {compra.estado === 'en_proceso' && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={onEliminar} title="Eliminar compra directa">🗑 Eliminar</button>}
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

interface LineaUI { id: number; productoId: string; nombre: string; categoria: string; unidad: string; cantidad: string }

function CrearCompraModal({ productos, categorias, unidades, proveedores, actor, actorName, onClose, onSaved }: {
  productos: Producto[]; categorias: string[]; unidades: string[]; proveedores: Proveedor[];
  actor: string; actorName?: string | null; onClose: () => void; onSaved: () => void;
}) {
  const activos = useMemo(() => productos.filter((p) => p.estado === 'activo'), [productos]);
  const nuevaLinea = (id: number): LineaUI => ({
    id, productoId: activos[0]?.id ?? '',
    nombre: '', categoria: categorias[0] ?? '', unidad: unidades[0] ?? 'und', cantidad: '1',
  });
  // Modo ÚNICO para todos los materiales: inventario (existente) o nuevo (alta).
  const [modo, setModo] = useState<'existente' | 'nuevo'>(activos.length ? 'existente' : 'nuevo');
  const [lineas, setLineas] = useState<LineaUI[]>([nuevaLinea(1)]);
  const [almacen, setAlmacen] = useState('');
  // Proveedor: elegir uno existente (buscable) o dar de alta uno nuevo (razón social + RIF).
  const [provModo, setProvModo] = useState<'existente' | 'nuevo'>('existente');
  const [proveedorId, setProveedorId] = useState('');
  const [provNombre, setProvNombre] = useState('');
  const [provRif, setProvRif] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seq, setSeq] = useState(2);

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
      if (modo === 'existente') {
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
      await crearCompraDirecta({ lineas: payload, almacen, proveedorId: proveedorId2, proveedorNombre, actor, actorName }, productos);
      notify(`Compra directa creada · ${payload.length} material(es)${proveedorNombre ? ` · ${proveedorNombre}` : ''}`, 'success', { link: '#/app/pedidos' });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo crear la compra directa.'); setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="cd-form" className="btn btn-primary" disabled={saving}>{saving ? 'Creando…' : 'Crear compra directa'}</button>
    </>
  );

  return (
    <Modal title="Nueva compra directa" size="lg" onClose={onClose} footer={footer}>
      <form id="cd-form" onSubmit={handleSubmit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        <AlmacenPicker value={almacen} onChange={setAlmacen} sedeLabel="Sede destino" label="Almacén destino" />

        {/* Proveedor: existente (buscable) o alta rápida de uno nuevo (pasa a la BD). */}
        <div className="form-row">
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

        {/* Modo ÚNICO para todos los materiales (no se repite por renglón). */}
        <div className="form-row">
          <label>Materiales</label>
          <div className="view-toggle" role="tablist" style={{ margin: '0 0 .4rem' }}>
            <button type="button" className={modo === 'existente' ? 'active' : ''} onClick={() => setModo('existente')}>📦 Inventario</button>
            <button type="button" className={modo === 'nuevo' ? 'active' : ''} onClick={() => setModo('nuevo')}>＋ Nuevo</button>
          </div>
          <small className="muted">{modo === 'existente' ? 'Elegí materiales del inventario.' : 'Se dan de alta en el inventario (stock 0, sin precio). SKU automático.'}</small>
        </div>

        {lineas.map((l, idx) => (
          <div key={l.id} className="card" style={{ margin: '0 0 .6rem', padding: '.7rem .85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '.5rem' }}>
              {lineas.length > 1 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => quitar(l.id)} title="Quitar material">✕ Quitar material #{idx + 1}</button>}
            </div>

            {modo === 'existente' ? (
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
        <p className="muted" style={{ fontSize: '.78rem', marginTop: '.5rem' }}>En este método no se cargan precios. El gasto por material y la caja se indican al finalizar.</p>
      </form>
    </Modal>
  );
}

/* ───────── Modal: montar (analista carga factura + precios → POR PAGAR) ───────── */

function MontarCompraModal({ compra, actor, actorName, onClose, onSaved }: {
  compra: CompraDirecta; actor: string; actorName?: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [gastos, setGastos] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    compra.items.forEach((it, i) => { if (it.gasto != null && Number(it.gasto) > 0) init[i] = String(it.gasto); });
    return init;
  });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Categoría → subcategoría de gasto (las mismas de Tesorería); etiqueta el egreso al pagar.
  const [catRows, setCatRows] = useState<CategoriaGasto[]>([]);
  const [catId, setCatId] = useState('');
  const [subId, setSubId] = useState('');
  useEffect(() => { listCategoriasGasto(true).then(setCatRows).catch(() => setCatRows([])); }, []);
  const categorias = useMemo(() => soloCategorias(catRows), [catRows]);
  const subcategorias = useMemo(() => (catId ? subcategoriasDe(catRows, catId) : []), [catRows, catId]);
  // Pre-carga la categoría/subcategoría si la compra ya estaba montada (por_pagar).
  useEffect(() => {
    if (!catRows.length || !compra.gasto_categoria) return;
    const c = soloCategorias(catRows).find((x) => x.nombre === compra.gasto_categoria);
    if (c) setCatId(c.id);
  }, [catRows, compra.gasto_categoria]);
  useEffect(() => {
    if (!catId || !compra.gasto_subcategoria) return;
    const s = subcategoriasDe(catRows, catId).find((x) => x.nombre === compra.gasto_subcategoria);
    if (s) setSubId(s.id);
  }, [catId, catRows, compra.gasto_subcategoria]);
  const catNombre = categorias.find((c) => c.id === catId)?.nombre ?? '';
  const subNombre = subcategorias.find((s) => s.id === subId)?.nombre ?? '';

  const total = useMemo(
    () => Math.round(compra.items.reduce((a, _it, i) => a + (Number(gastos[i]) || 0), 0) * 100) / 100,
    [gastos, compra.items],
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!catId) { setError('Elegí la categoría de gasto.'); return; }
    if (!subId) { setError('Elegí la subcategoría de gasto.'); return; }
    if (total <= 0) { setError('Indicá cuánto se gastó en cada material.'); return; }
    if (file && file.type && file.type !== 'application/pdf' && !file.type.startsWith('image/')) { setError('El adjunto debe ser un PDF o una imagen.'); return; }
    const items: CompraDirectaItem[] = compra.items.map((it, i) => ({ ...it, gasto: Number(gastos[i]) || 0 }));
    setSaving(true);
    try {
      await montarCompraDirecta({ compra, items, file, gastoCategoria: catNombre, gastoSubcategoria: subNombre, actor, actorName });
      notify(`Compra enviada a Tesorería · ${montoCaja(total, 'USD')} por pagar`, 'success', { link: '#/app/tesoreria' });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo enviar la compra a Tesorería.'); setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="cd-fin-form" className="btn btn-primary" disabled={saving}>{saving ? 'Enviando…' : `Enviar a Tesorería · ${montoCaja(total, 'USD')}`}</button>
    </>
  );

  return (
    <Modal title="Cargar factura y precios" size="lg" onClose={onClose} footer={footer}>
      <form id="cd-fin-form" onSubmit={handleSubmit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        <p className="muted" style={{ marginTop: 0, fontSize: '.84rem' }}>
          Cargá los <strong>precios por material</strong> y la <strong>factura</strong>. La compra queda <strong>Por pagar</strong> y aparece en <strong>Tesorería</strong>; cuando ahí se pague, el gasto sale de la caja y los materiales <strong>entran al inventario</strong> ({compra.almacen}).
        </p>

        {/* Categoría → subcategoría de gasto (las mismas de Tesorería): etiqueta el egreso. */}
        <div className="form-grid">
          <div className="form-row">
            <label>Categoría de gasto <span style={{ color: 'var(--danger)' }}>*</span></label>
            <SearchSelect value={catId} onChange={setCatId}
              options={categorias.map((c) => ({ value: c.id, label: c.nombre }))}
              placeholder="Buscar categoría…" emptyText="Cargá categorías en Tesorería → 🗂️ Categorías de gasto" />
          </div>
          <div className="form-row">
            <label>Subcategoría <span style={{ color: 'var(--danger)' }}>*</span></label>
            <SearchSelect value={subId} onChange={setSubId}
              options={subcategorias.map((s) => ({ value: s.id, label: s.nombre }))}
              placeholder={catId ? 'Buscar subcategoría…' : 'Elegí primero la categoría'}
              emptyText={catId ? 'Esta categoría no tiene subcategorías.' : 'Elegí una categoría'} />
          </div>
        </div>
        <small className="muted" style={{ display: 'block', marginBottom: '.6rem' }}>El gasto queda etiquetado por <strong>categoría → subcategoría</strong> y se reflejará así en el movimiento de Tesorería al pagarse.</small>

        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead><tr><th>Material</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ width: 160 }}>Precio</th><th style={{ textAlign: 'right' }}>Costo unit.</th></tr></thead>
            <tbody>
              {compra.items.map((it, i) => {
                const g = Number(gastos[i]) || 0;
                const cu = it.cantidad > 0 && g > 0 ? g / it.cantidad : 0;
                return (
                  <tr key={i}>
                    <td>{it.producto_nombre}{it.producto_sku ? <span className="muted"> · {it.producto_sku}</span> : null}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{num(it.cantidad)}</td>
                    <td><input className="input mono" type="number" min={0} step="any" value={gastos[i] ?? ''} onChange={(e) => setGastos((m) => ({ ...m, [i]: dosDecimales(e.target.value) }))} placeholder="0,00" /></td>
                    <td className="mono" style={{ textAlign: 'right' }}>{montoCaja(cu, 'USD')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ margin: '.5rem 0' }}>Total por pagar: <strong className="mono">{montoCaja(total, 'USD')}</strong></div>

        <div className="form-row">
          <label>Adjuntar FACTURA de la compra · PDF o imagen</label>
          <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file ? <small className="muted">{file.name}</small> : (compra.facturas?.length ? <small className="muted">Ya hay {compra.facturas.length} factura(s) cargada(s).</small> : null)}
        </div>
      </form>
    </Modal>
  );
}
