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
import type { Caja, Producto, CajaSaldo, CuentaCaja, Proveedor } from '@/shared/lib/types';
import { getCategorias, getUnidades, listProductos, updateProducto, addCategoria, addUnidad } from '@/modules/inventario/inventario.repository';
import { listCajasActivas } from '@/modules/salidas/cajas.repository';
import { saldosDeCaja, listSaldos, round2 } from '@/modules/tesoreria/cajaSaldos.repository';
import { getTasaHoy, getTasasMercado, type TasasMercado } from '@/modules/tesoreria/tasas.repository';
import { listCategoriasGasto, soloCategorias, subcategoriasDe, type CategoriaGasto } from '@/modules/tesoreria/categoriasGasto.repository';
import {
  crearCompraDirecta, finalizarCompraDirecta, listComprasDirectas, eliminarCompraDirecta,
  urlAdjuntoCompra, type CompraDirecta, type CompraDirectaItem, type LineaCompra, type PagoLeg,
} from './compras.repository';

type Vista = 'kanban' | 'lista';

const COLS: { key: CompraDirecta['estado']; label: string }[] = [
  { key: 'en_proceso', label: 'En proceso' },
  { key: 'finalizada', label: 'Finalizada' },
];
const ESTADO_LABEL: Record<string, string> = { en_proceso: '⏳ En proceso', finalizada: '🏁 Finalizada' };

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

  const reload = useCallback(async () => {
    // Cada fuente con su propio catch: si una falla (RLS/red), las demás cargan igual
    // (antes, un error en cualquiera dejaba sin proveedores el formulario).
    const [cs, pds, cats, unis, cjs, provs] = await Promise.all([
      listComprasDirectas().catch(() => [] as CompraDirecta[]),
      listProductos().catch(() => [] as Producto[]),
      getCategorias().catch(() => [] as string[]),
      getUnidades().catch(() => [] as string[]),
      listCajasActivas().catch(() => [] as Caja[]),
      listProveedores().catch(() => [] as Proveedor[]),
    ]);
    setCompras(cs); setProductos(pds); setCategorias(cats); setUnidades(unis); setCajas(cjs);
    setProveedores(provs.filter((p) => p.estado === 'activo'));
  }, []);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    reload().catch(() => { /* RLS/red */ }).finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reload]);

  // Realtime multiusuario: las compras directas se reflejan al instante.
  useRealtime(['compras_directas', 'productos', 'proveedores'], () => { void reload(); });

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
      await reload();
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
                  <CompraCard key={c.id} compra={c}
                    onFinalizar={() => setFinalizar(c)} onPdf={() => handlePdf(c)} onEliminar={() => setEliminar(c)} />
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
                <tr key={c.id}>
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
                  <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => handlePdf(c)} title="Descargar detalle en PDF">↓ PDF</button>
                    {c.estado === 'en_proceso' && <button className="btn btn-sm btn-primary" onClick={() => setFinalizar(c)}>Cargar factura y precios</button>}
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
          actor={actor} actorName={actorName} onClose={() => setCrear(false)} onSaved={async () => { setCrear(false); await reload(); }} />
      )}

      {finalizar && (
        <FinalizarCompraModal compra={finalizar} cajas={cajas} actor={actor} actorName={actorName}
          onClose={() => setFinalizar(null)} onSaved={async () => { setFinalizar(null); await reload(); }} />
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
    </div>
  );
}

function CompraCard({ compra, onFinalizar, onPdf, onEliminar }: {
  compra: CompraDirecta; onFinalizar: () => void; onPdf: () => void; onEliminar: () => void;
}) {
  return (
    <div className="card" style={{ margin: 0 }}>
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
      {compra.estado === 'finalizada' && (
        <div style={{ fontSize: '.8rem', marginTop: '.4rem' }}>
          <div>Gasto: <strong className="mono">{compra.gasto != null ? money(compra.gasto) : '—'}</strong></div>
          <div className="muted"><AdjuntoLink compra={compra} /></div>
        </div>
      )}
      <div style={{ display: 'flex', gap: '.4rem', marginTop: '.5rem', flexWrap: 'wrap' }}>
        <button className="btn btn-sm btn-ghost" onClick={onPdf} title="Descargar detalle en PDF">↓ PDF</button>
        {compra.estado === 'en_proceso' && <button className="btn btn-sm btn-primary" onClick={onFinalizar}>Cargar factura y precios</button>}
        {compra.estado === 'en_proceso' && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={onEliminar} title="Eliminar compra directa">🗑 Eliminar</button>}
      </div>
    </div>
  );
}

function AdjuntoLink({ compra }: { compra: CompraDirecta }) {
  if (!compra.adjunto_path) return <span className="muted">—</span>;
  async function abrir() {
    try { window.open(await urlAdjuntoCompra(compra.adjunto_path as string), '_blank', 'noopener'); }
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

/* ───────── Modal: finalizar (gasto por material + caja) ───────── */

function FinalizarCompraModal({ compra, cajas, actor, actorName, onClose, onSaved }: {
  compra: CompraDirecta; cajas: Caja[]; actor: string; actorName?: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [cajaId, setCajaId] = useState(cajas[0]?.id ?? '');
  const [gastos, setGastos] = useState<Record<number, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const caja = cajas.find((c) => c.id === cajaId) ?? null;
  const moneda = caja?.moneda ?? 'USD';

  // Categoría → subcategoría de gasto (las mismas de Tesorería); el egreso queda etiquetado.
  const [catRows, setCatRows] = useState<CategoriaGasto[]>([]);
  const [catId, setCatId] = useState('');
  const [subId, setSubId] = useState('');
  useEffect(() => { listCategoriasGasto(true).then(setCatRows).catch(() => setCatRows([])); }, []);
  const categorias = useMemo(() => soloCategorias(catRows), [catRows]);
  const subcategorias = useMemo(() => (catId ? subcategoriasDe(catRows, catId) : []), [catRows, catId]);
  useEffect(() => { setSubId(''); }, [catId]);
  const catNombre = categorias.find((c) => c.id === catId)?.nombre ?? '';
  const subNombre = subcategorias.find((s) => s.id === subId)?.nombre ?? '';

  // Saldo REAL de cada caja desde caja_saldos (lo mismo que descuenta el egreso y muestra
  // Tesorería). Antes el desplegable mostraba el saldo legado de `cajas`, que no se movía.
  const [saldoReal, setSaldoReal] = useState<Map<string, { saldo: number; moneda: string }>>(new Map());
  useEffect(() => {
    listSaldos().then((rows) => {
      const m = new Map<string, { saldo: number; moneda: string }>();
      for (const c of cajas) {
        // Agrupa los saldos de la caja por moneda (una caja puede tener varias billeteras).
        const porMoneda = new Map<string, number>();
        for (const r of rows) {
          if (r.caja_id !== c.id) continue;
          porMoneda.set(r.moneda, (porMoneda.get(r.moneda) ?? 0) + (Number(r.saldo) || 0));
        }
        // Prefiere la moneda de la caja; si ahí no hay saldo, usa la moneda con mayor saldo
        // (evita mostrar 0 cuando la caja tiene el dinero en otra moneda, p. ej. USDT).
        let moneda: string = c.moneda;
        let saldo = porMoneda.get(c.moneda) ?? 0;
        if (saldo === 0 && porMoneda.size) {
          const mejor = [...porMoneda.entries()].sort((a, b) => b[1] - a[1])[0];
          moneda = mejor[0]; saldo = mejor[1];
        }
        m.set(c.id, { saldo, moneda });
      }
      setSaldoReal(m);
    }).catch(() => { /* sin saldos: cae al saldo legado */ });
  }, [cajas]);

  const total = useMemo(
    () => Math.round(compra.items.reduce((a, _it, i) => a + (Number(gastos[i]) || 0), 0) * 100) / 100,
    [gastos, compra.items],
  );

  // Saldos multimoneda de la caja elegida (para pagar repartiendo por cuenta/moneda).
  const [saldosCaja, setSaldosCaja] = useState<CajaSaldo[]>([]);
  const [legMontos, setLegMontos] = useState<Record<string, string>>({});
  const [tasa, setTasa] = useState<number>(0);
  const [mercado, setMercado] = useState<TasasMercado | null>(null);
  useEffect(() => {
    if (!cajaId) { setSaldosCaja([]); return; }
    saldosDeCaja(cajaId).then((rows) => setSaldosCaja(rows.filter((r) => Number(r.saldo) > 0))).catch(() => setSaldosCaja([]));
    setLegMontos({});
  }, [cajaId]);
  useEffect(() => { getTasaHoy().then((t) => { if (t.usd != null) setTasa(t.usd); }).catch(() => { /* sin tasa */ }); }, []);
  useEffect(() => { getTasasMercado().then(setMercado).catch(() => setMercado(null)); }, []);

  // Caja con varias monedas (Multimoneda) → se paga repartiendo por cuenta.
  const esMultimoneda = saldosCaja.length >= 2;
  // El total a pagar está en USD (moneda de la caja Multimoneda). Equivalente en USD de cada pata.
  function legUsd(monedaLeg: string, n: number): number {
    if (!n || n <= 0) return 0;
    if (monedaLeg === 'USD' || monedaLeg === 'USDT') return round2(n);
    if (monedaLeg === 'Bs') return tasa > 0 ? round2(n / tasa) : 0;
    if (monedaLeg === 'COP') return mercado?.copUsd ? round2(n / mercado.copUsd) : 0;
    return round2(n);
  }
  const sumUsdMulti = round2(saldosCaja.reduce((a, s) => a + legUsd(s.moneda, Number(legMontos[s.id]) || 0), 0));
  const cubreTotalMulti = sumUsdMulti >= total - 0.01;
  // No se puede pagar más que el total de la compra.
  const excedeTotalMulti = esMultimoneda && sumUsdMulti > total + 0.01;
  const cuentaLabel = (c: string) => c === 'general' ? '' : c === 'juridica' ? ' · Jurídica' : c === 'personal' ? ' · Personal' : ` · ${c}`;
  // Nombre de la billetera/cuenta para mostrar al elegir la caja (sin el '·' inicial).
  const billeteraNombre = (c: string) => c === 'general' ? 'General' : c === 'juridica' ? 'Jurídica' : c === 'personal' ? 'Personal' : c;

  // Conversión del total a Bs con la tasa BCV (editable), para cualquier caja.
  // El total se expresa en la moneda de la caja; lo llevamos a USD y a Bs.
  const totalUsd = moneda === 'Bs' ? (tasa > 0 ? round2(total / tasa) : 0) : total;
  const totalBs = moneda === 'Bs' ? total : (tasa > 0 ? round2(total * tasa) : 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!cajaId) { setError('Elegí la caja de la que sale el dinero.'); return; }
    if (!catId) { setError('Elegí la categoría de gasto.'); return; }
    if (!subId) { setError('Elegí la subcategoría de gasto.'); return; }
    if (total <= 0) { setError('Indicá cuánto se gastó en cada material.'); return; }
    if (file && file.type && file.type !== 'application/pdf' && !file.type.startsWith('image/')) { setError('El adjunto debe ser un PDF o una imagen.'); return; }
    let legs: PagoLeg[] | undefined;
    if (esMultimoneda) {
      legs = saldosCaja
        .map((s) => ({ cuenta: s.cuenta as CuentaCaja, moneda: s.moneda, monto: Number(legMontos[s.id]) || 0 }))
        .filter((l) => l.monto > 0);
      if (!legs.length) { setError('Indicá cuánto pagar en al menos una moneda.'); return; }
      if (excedeTotalMulti) { setError(`No podés pagar más que el total de la compra. Cargado ${montoCaja(sumUsdMulti, 'USD')}, total ${montoCaja(total, 'USD')} (te pasaste por ${montoCaja(round2(sumUsdMulti - total), 'USD')}).`); return; }
      if (!cubreTotalMulti) { setError(`Lo cargado (${montoCaja(sumUsdMulti, 'USD')}) no cubre el total (${montoCaja(total, 'USD')}).`); return; }
    }
    const items: CompraDirectaItem[] = compra.items.map((it, i) => ({ ...it, gasto: Number(gastos[i]) || 0 }));
    setSaving(true);
    try {
      await finalizarCompraDirecta({ compra, items, cajaId, legs, file, gastoCategoria: catNombre, gastoSubcategoria: subNombre, actor, actorName });
      const resumenPago = esMultimoneda ? `multipago ${montoCaja(sumUsdMulti, 'USD')}` : montoCaja(total, moneda);
      notify(`Compra finalizada · ${resumenPago} desde ${caja?.nombre ?? ''}`, 'success', { link: '#/app/inventario' });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo finalizar la compra.'); setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="cd-fin-form" className="btn btn-primary" disabled={saving || excedeTotalMulti}>{saving ? 'Finalizando…' : excedeTotalMulti ? 'Excede el total' : `Finalizar · ${montoCaja(total, moneda)}`}</button>
    </>
  );

  return (
    <Modal title="Cargar factura y precios" size="lg" onClose={onClose} footer={footer}>
      <form id="cd-fin-form" onSubmit={handleSubmit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        <div className="form-row">
          <label>Caja (de dónde sale el dinero)</label>
          <select className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)} required style={{ maxWidth: 320 }}>
            {!cajas.length && <option value="">— sin cajas —</option>}
            {cajas.map((c) => { const sr = saldoReal.get(c.id); return <option key={c.id} value={c.id}>{c.nombre} · {montoCaja(sr?.saldo ?? c.saldo, sr?.moneda ?? c.moneda)}</option>; })}
          </select>
          <small className="muted">El gasto total se descuenta de esta caja (egreso en Tesorería / registro de movimientos).{esMultimoneda ? ' Es Multimoneda: repartí el pago por moneda abajo.' : ''}</small>
          {cajaId && saldosCaja.length > 0 && (
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '.4rem' }}>
              <span className="muted" style={{ fontSize: '.8rem' }}>💳 Billetera{saldosCaja.length > 1 ? 's' : ''}:</span>
              {saldosCaja.map((s) => (
                <span key={s.id} className="badge" title="Billetera de la caja · saldo disponible">
                  {billeteraNombre(s.cuenta)} · <span className="mono">{montoCaja(Number(s.saldo), s.moneda)}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Categoría → subcategoría de gasto (las mismas de Tesorería): el egreso queda etiquetado. */}
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
        <small className="muted" style={{ display: 'block', marginBottom: '.6rem' }}>El gasto queda etiquetado por <strong>categoría → subcategoría</strong> y se refleja así en el movimiento de Tesorería (GASTOS / MOVIMIENTOS).</small>

        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead><tr><th>Material</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ width: 160 }}>Gasto</th><th style={{ textAlign: 'right' }}>Costo unit.</th></tr></thead>
            <tbody>
              {compra.items.map((it, i) => {
                const g = Number(gastos[i]) || 0;
                const cu = it.cantidad > 0 && g > 0 ? g / it.cantidad : 0;
                return (
                  <tr key={i}>
                    <td>{it.producto_nombre}{it.producto_sku ? <span className="muted"> · {it.producto_sku}</span> : null}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{num(it.cantidad)}</td>
                    <td><input className="input mono" type="number" min={0} step="any" value={gastos[i] ?? ''} onChange={(e) => setGastos((m) => ({ ...m, [i]: dosDecimales(e.target.value) }))} placeholder="0,00" /></td>
                    <td className="mono" style={{ textAlign: 'right' }}>{montoCaja(cu, moneda)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ margin: '.5rem 0' }}>Total a descontar: <strong className="mono">{montoCaja(total, moneda)}</strong> → entra a inventario en <strong>{compra.almacen}</strong></div>

        {/* Conversión del total a Bs con la tasa BCV (editable) — para cualquier caja. */}
        {cajaId && (
          <div className="card" style={{ marginBottom: '.75rem', borderColor: 'var(--brand, #ff8a00)', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
            <div>
              <div className="muted" style={{ fontSize: '.72rem' }}>Total en USD</div>
              <strong className="mono" style={{ fontSize: '1.05rem' }}>{tasa > 0 || moneda !== 'Bs' ? montoCaja(totalUsd, 'USD') : '—'}</strong>
            </div>
            <div className="muted" style={{ fontSize: '1.1rem' }}>⇄</div>
            <div>
              <div className="muted" style={{ fontSize: '.72rem' }}>Equivale en Bs (BCV)</div>
              <strong className="mono" style={{ fontSize: '1.05rem' }}>{tasa > 0 || moneda === 'Bs' ? montoCaja(totalBs, 'Bs') : '—'}</strong>
            </div>
            <div className="form-row" style={{ marginLeft: 'auto', minWidth: 150, margin: 0 }}>
              <label style={{ fontSize: '.72rem' }}>Tasa BCV (Bs por $)</label>
              <input className="input mono" type="number" min={0} step="any" value={tasa || ''}
                onChange={(e) => setTasa(Number(e.target.value) || 0)} placeholder="0,00" />
            </div>
          </div>
        )}

        {/* Multipago por cuenta: repartí el total entre las monedas de la caja Multimoneda. */}
        {esMultimoneda && (
          <div className="card" style={{ marginBottom: '.75rem', borderColor: 'var(--brand, #ff8a00)' }}>
            <div className="card-title" style={{ marginBottom: '.4rem' }}>Pago por moneda · ¿cuánto sale de cada una?</div>
            <div className="table-wrap">
              <table className="table" style={{ fontSize: '.84rem' }}>
                <thead><tr><th>Moneda</th><th style={{ textAlign: 'right' }}>Disponible</th><th style={{ textAlign: 'right' }}>A pagar (en su moneda)</th><th style={{ textAlign: 'right' }}>Equiv. USD</th></tr></thead>
                <tbody>
                  {saldosCaja.map((s) => {
                    const n = Number(legMontos[s.id]) || 0;
                    const excede = n > Number(s.saldo);
                    return (
                      <tr key={s.id}>
                        <td><span className="badge">{s.moneda}</span>{cuentaLabel(s.cuenta)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{montoCaja(Number(s.saldo), s.moneda)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <input className="input mono" type="number" min={0} max={Number(s.saldo)} step="any"
                            value={legMontos[s.id] ?? ''} placeholder="0,00"
                            onChange={(e) => setLegMontos((m) => ({ ...m, [s.id]: dosDecimales(e.target.value) }))}
                            style={{ width: 130, textAlign: 'right', borderColor: excede ? 'var(--danger)' : undefined }} />
                        </td>
                        <td className="mono" style={{ textAlign: 'right' }}>{n > 0 ? montoCaja(legUsd(s.moneda, n), 'USD') : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'right', fontWeight: 600 }}>Cubierto / Total</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: excedeTotalMulti ? 'var(--danger)' : cubreTotalMulti ? 'var(--success)' : 'var(--warning)' }}>
                      {montoCaja(sumUsdMulti, 'USD')} / {montoCaja(total, 'USD')}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <small className="muted" style={{ display: 'block', marginTop: '.3rem' }}>
              {excedeTotalMulti
                ? <span style={{ color: 'var(--danger)' }}>⚠ Te pasaste por <strong>{montoCaja(round2(sumUsdMulti - total), 'USD')}</strong>. No podés pagar más que el total de la compra ({montoCaja(total, 'USD')}).</span>
                : cubreTotalMulti
                ? <>✓ Cubre exactamente el total. Cada moneda se descuenta de su saldo real con la tasa del día.</>
                : <>Faltan <strong>{montoCaja(round2(total - sumUsdMulti), 'USD')}</strong>. Bs↔$ usa la tasa BCV de arriba.</>}
            </small>
          </div>
        )}

        <div className="form-row">
          <label>Adjuntar comprobante de la compra · PDF o imagen (opcional)</label>
          <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file && <small className="muted">{file.name}</small>}
        </div>
      </form>
    </Modal>
  );
}
