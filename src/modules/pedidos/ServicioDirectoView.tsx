import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { notify } from '@/shared/lib/notify';
import { dateTime, money, num, dosDecimales } from '@/shared/lib/format';
import { list as listProveedores, crearProveedorRapido } from '@/modules/proveedores/proveedores.repository';
import type { Caja, CajaSaldo, CuentaCaja, Proveedor } from '@/shared/lib/types';
import { listCajasActivas } from '@/modules/salidas/cajas.repository';
import { saldosDeCaja, listSaldos, round2 } from '@/modules/tesoreria/cajaSaldos.repository';
import { getTasaHoy, getTasasMercado, type TasasMercado } from '@/modules/tesoreria/tasas.repository';
import { listCategoriasGasto, soloCategorias, subcategoriasDe, type CategoriaGasto } from '@/modules/tesoreria/categoriasGasto.repository';
import { listCatalogoPedido, type CatalogoPedido } from './pedidos.repository';
import { listEquipos, type MaquinariaEquipo } from '@/modules/maquinaria/maquinariaEquipos.repository';
import {
  crearServicioDirecto, finalizarServicioDirecto, listServiciosDirectos, eliminarServicioDirecto,
  urlAdjuntoServicio, gestionarFacturasServicio, esRecargaGas, type ServicioDirecto, type ServicioDirectoItem, type LineaServicioInput, type FinalizarServicioDirectoInput,
} from './serviciosDirectos.repository';
import type { PagoLeg } from './compras.repository';
import { FacturasModal } from './FacturasModal';

type Vista = 'kanban' | 'lista';

/** Lista curada de tipos de servicio (con íconos), igual que en Nuevo Servicio. */
const TIPOS_SERVICIO: { value: string; label: string }[] = [
  { value: 'CAMBIO DE ACEITE', label: '🛢️ Cambio de aceite' },
  { value: 'CAMBIO DE FILTRO', label: '🧯 Cambio de filtro' },
  { value: 'CAMBIO DE CAUCHOS / NEUMÁTICOS', label: '🛞 Cambio de cauchos / neumáticos' },
  { value: 'REPUESTOS', label: '🛠️ Repuestos' },
  { value: 'CAMBIO DE PIEZA', label: '⚙️ Cambio de pieza' },
  { value: 'PINTURA / LATONERÍA', label: '🎨 Pintura / latonería' },
  { value: 'FRENOS', label: '🛑 Frenos' },
  { value: 'BATERÍA', label: '🔋 Batería' },
  { value: 'SISTEMA ELÉCTRICO', label: '💡 Sistema eléctrico' },
  { value: 'SISTEMA HIDRÁULICO', label: '💧 Sistema hidráulico' },
  { value: 'SOLDADURA', label: '🔥 Soldadura' },
  { value: 'SERVICIO / PREVENTIVO', label: '🔧 Servicio / preventivo' },
  { value: 'REPARACIÓN', label: '🛠️ Reparación' },
  { value: 'OTRO', label: '• Otro' },
];

const COLS: { key: ServicioDirecto['estado']; label: string }[] = [
  { key: 'en_proceso', label: 'En proceso' },
  { key: 'finalizada', label: 'Finalizada' },
];
const ESTADO_LABEL: Record<string, string> = { en_proceso: '⏳ En proceso', finalizada: '🏁 Finalizada' };

function montoCaja(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${v}` : `${moneda} ${v}`;
}

export function ServicioDirectoView({ actor, actorName }: { actor: string; actorName?: string | null }) {
  const [servicios, setServicios] = useState<ServicioDirecto[]>([]);
  const [categorias, setCategorias] = useState<CatalogoPedido[]>([]);
  const [tipos, setTipos] = useState<CatalogoPedido[]>([]);
  const [equipos, setEquipos] = useState<MaquinariaEquipo[]>([]);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [vista, setVista] = useState<Vista>('kanban');
  const [crear, setCrear] = useState(false);
  const [finalizar, setFinalizar] = useState<ServicioDirecto | null>(null);
  const [eliminar, setEliminar] = useState<ServicioDirecto | null>(null);
  const [facturas, setFacturas] = useState<ServicioDirecto | null>(null);

  const reload = useCallback(async () => {
    const [ss, cats, tps, eqs, cjs, provs] = await Promise.all([
      listServiciosDirectos().catch(() => [] as ServicioDirecto[]),
      listCatalogoPedido('servicio_categoria', true).catch(() => [] as CatalogoPedido[]),
      listCatalogoPedido('servicio_tipo', true).catch(() => [] as CatalogoPedido[]),
      listEquipos().catch(() => [] as MaquinariaEquipo[]),
      listCajasActivas().catch(() => [] as Caja[]),
      listProveedores().catch(() => [] as Proveedor[]),
    ]);
    setServicios(ss); setCategorias(cats); setTipos(tps);
    setEquipos(eqs.filter((e) => e.activo)); setCajas(cjs);
    setProveedores(provs.filter((p) => p.estado === 'activo'));
  }, []);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    reload().catch(() => { /* RLS/red */ }).finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reload]);

  useRealtime(['servicios_directos', 'proveedores', 'maquinaria_equipos'], () => { void reload(); });

  const porEstado = useMemo(() => {
    const m: Record<string, ServicioDirecto[]> = { en_proceso: [], finalizada: [] };
    servicios.forEach((s) => { (m[s.estado] ??= []).push(s); });
    return m;
  }, [servicios]);

  async function handlePdf(s: ServicioDirecto) {
    try { const { descargarServicioDirectoPdf } = await import('./servicioDirectoPdf'); await descargarServicioDirectoPdf(s); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  async function confirmarEliminar() {
    const s = eliminar;
    if (!s) return;
    setEliminar(null);
    try { await eliminarServicioDirecto(s); toast('Servicio directo eliminado', 'success'); await reload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  return (
    <div>
      <div className="filterbar" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-primary" onClick={() => setCrear(true)}>+ Nuevo servicio directo</button>
        <div className="view-toggle" role="tablist" aria-label="Modo de vista">
          <button className={vista === 'kanban' ? 'active' : ''} onClick={() => setVista('kanban')}>▦ Kanban</button>
          <button className={vista === 'lista' ? 'active' : ''} onClick={() => setVista('lista')}>☰ Lista</button>
        </div>
      </div>

      {loading ? (
        <EmptyState message="Cargando servicios directos..." icon="◔" />
      ) : !servicios.length ? (
        <EmptyState message="Sin servicios directos. Creá el primero con “+ Nuevo servicio directo”." icon="🛠" />
      ) : vista === 'kanban' ? (
        <div className="kanban">
          {COLS.map((col) => (
            <div key={col.key} className="kanban-col">
              <div className="kanban-col-head"><strong>{col.label}</strong><span className="badge">{porEstado[col.key]?.length ?? 0}</span></div>
              <div className="kanban-col-body">
                {(porEstado[col.key] ?? []).map((s) => (
                  <ServicioCard key={s.id} servicio={s} onFinalizar={() => setFinalizar(s)} onPdf={() => handlePdf(s)} onFacturas={() => setFacturas(s)} onEliminar={() => setEliminar(s)} />
                ))}
                {!(porEstado[col.key] ?? []).length && <div className="muted" style={{ padding: '.5rem' }}>—</div>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Código</th><th>Servicio(s)</th><th>Equipo</th><th>Proveedor</th><th>Estado</th><th>Monto</th><th>Generó</th><th>Creado</th><th>Pagado</th><th></th></tr></thead>
            <tbody>
              {servicios.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.codigo ?? '—'}</td>
                  <td>{s.descripcion}{s.items.length > 1 ? <span className="muted"> · {s.items.length} ítems</span> : null}</td>
                  <td>{s.equipo_nombre || '—'}</td>
                  <td>{s.proveedor_nombre || '—'}</td>
                  <td>{ESTADO_LABEL[s.estado] ?? s.estado}</td>
                  <td className="mono">{s.gasto != null ? money(s.gasto) : '—'}</td>
                  <td>{s.actor_name || s.actor || '—'}</td>
                  <td className="muted">{dateTime(s.created_at)}</td>
                  <td className="muted">{s.finalizada_at ? dateTime(s.finalizada_at) : '—'}</td>
                  <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => handlePdf(s)} title="Ver detalle en PDF (vista previa)">↓ PDF</button>
                    {s.estado === 'finalizada' && <button className="btn btn-sm btn-ghost" onClick={() => setFacturas(s)} title="Cargar nuevas facturas / quitar anteriores">🧾 Facturas</button>}
                    {s.estado === 'en_proceso' && <button className="btn btn-sm btn-primary" onClick={() => setFinalizar(s)}>Cargar factura y monto</button>}
                    {s.estado === 'en_proceso' && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setEliminar(s)} title="Eliminar servicio directo">🗑</button>}
                    {s.estado === 'finalizada' && <AdjuntoLink servicio={s} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {crear && (
        <CrearServicioModal categorias={categorias} tipos={tipos} equipos={equipos} proveedores={proveedores}
          actor={actor} actorName={actorName} onClose={() => setCrear(false)} onSaved={async () => { setCrear(false); await reload(); }} />
      )}
      {finalizar && (
        <FinalizarServicioModal servicio={finalizar} cajas={cajas} actor={actor} actorName={actorName}
          onClose={() => setFinalizar(null)} onSaved={async () => { setFinalizar(null); await reload(); }} />
      )}
      {eliminar && (
        <ConfirmDialog title="Eliminar servicio directo"
          message={`¿Eliminar el servicio directo ${eliminar.codigo ? `${eliminar.codigo} · ` : ''}"${eliminar.descripcion}"? Esta acción no se puede deshacer.`}
          confirmText="Eliminar" danger onConfirm={confirmarEliminar} onCancel={() => setEliminar(null)} />
      )}
      {facturas && (
        <FacturasModal
          title={`Facturas · ${facturas.codigo ?? 'Servicio directo'}`}
          facturas={facturas.facturas}
          urlFor={urlAdjuntoServicio}
          onSave={async (nuevos, quitar) => { await gestionarFacturasServicio(facturas, nuevos, quitar); await reload(); }}
          onClose={() => setFacturas(null)}
        />
      )}
    </div>
  );
}

function ServicioCard({ servicio, onFinalizar, onPdf, onFacturas, onEliminar }: { servicio: ServicioDirecto; onFinalizar: () => void; onPdf: () => void; onFacturas: () => void; onEliminar: () => void }) {
  return (
    <div className="card" style={{ margin: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem' }}>
        <strong>{servicio.descripcion}</strong>
        <span className="badge">{num(servicio.cantidad)}</span>
      </div>
      {servicio.codigo && <div className="muted mono" style={{ fontSize: '.72rem', marginTop: '.2rem' }}>{servicio.codigo}</div>}
      {servicio.equipo_nombre && <div className="muted" style={{ fontSize: '.78rem', marginTop: '.25rem' }}>🚜 {servicio.equipo_nombre}</div>}
      {servicio.proveedor_nombre && <div className="muted" style={{ fontSize: '.74rem' }}>🏭 {servicio.proveedor_nombre}</div>}
      {servicio.items.length > 1 && (
        <ul className="muted" style={{ fontSize: '.72rem', margin: '.35rem 0 0', paddingLeft: '1rem' }}>
          {servicio.items.map((it, i) => <li key={i}>{it.descripcion} · {num(it.cantidad)}</li>)}
        </ul>
      )}
      <div className="muted" style={{ fontSize: '.72rem', marginTop: '.4rem', lineHeight: 1.5 }}>
        <div>Generó: <strong style={{ color: 'var(--text)' }}>{servicio.actor_name || servicio.actor || '—'}</strong></div>
        <div>Creado: {dateTime(servicio.created_at)}</div>
        {servicio.estado === 'finalizada' && <div>Pagado: {servicio.finalizada_at ? dateTime(servicio.finalizada_at) : '—'}</div>}
      </div>
      {servicio.estado === 'finalizada' && (
        <div style={{ fontSize: '.8rem', marginTop: '.4rem' }}>
          <div>Monto: <strong className="mono">{servicio.gasto != null ? money(servicio.gasto) : '—'}</strong></div>
          <div className="muted"><AdjuntoLink servicio={servicio} /></div>
        </div>
      )}
      <div style={{ display: 'flex', gap: '.4rem', marginTop: '.5rem', flexWrap: 'wrap' }}>
        <button className="btn btn-sm btn-ghost" onClick={onPdf} title="Ver detalle en PDF (vista previa)">↓ PDF</button>
        {servicio.estado === 'finalizada' && <button className="btn btn-sm btn-ghost" onClick={onFacturas} title="Cargar nuevas facturas / quitar anteriores">🧾 Facturas</button>}
        {servicio.estado === 'en_proceso' && <button className="btn btn-sm btn-primary" onClick={onFinalizar}>Cargar factura y monto</button>}
        {servicio.estado === 'en_proceso' && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={onEliminar} title="Eliminar">🗑 Eliminar</button>}
      </div>
    </div>
  );
}

function AdjuntoLink({ servicio }: { servicio: ServicioDirecto }) {
  if (!servicio.adjunto_path) return <span className="muted">— sin factura</span>;
  async function abrir() {
    try { window.open(await urlAdjuntoServicio(servicio.adjunto_path as string), '_blank', 'noopener'); }
    catch { toast('No se pudo abrir la factura', 'error'); }
  }
  return <button className="btn btn-sm btn-ghost" onClick={abrir} title={servicio.adjunto_nombre ?? 'Factura'}>📎 Factura</button>;
}

/* ───────── Modal: nuevo servicio directo (varios servicios) ───────── */

interface LineaUI { id: number; categoria: string; tipo: string; equipoId: string; cantidad: string; bombonas: string; kg: string }

function CrearServicioModal({ categorias, tipos, equipos, proveedores, actor, actorName, onClose, onSaved }: {
  categorias: CatalogoPedido[]; tipos: CatalogoPedido[]; equipos: MaquinariaEquipo[]; proveedores: Proveedor[];
  actor: string; actorName?: string | null; onClose: () => void; onSaved: () => void;
}) {
  const nuevaLinea = (id: number): LineaUI => ({ id, categoria: '', tipo: '', equipoId: '', cantidad: '1', bombonas: '', kg: '' });
  const [lineas, setLineas] = useState<LineaUI[]>([nuevaLinea(1)]);
  const [provModo, setProvModo] = useState<'existente' | 'nuevo'>('existente');
  const [proveedorId, setProveedorId] = useState('');
  const [provNombre, setProvNombre] = useState('');
  const [provRif, setProvRif] = useState('');
  const [solicitante, setSolicitante] = useState('');
  const [solicitantePersona, setSolicitantePersona] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seq, setSeq] = useState(2);

  const tipoOptions = useMemo(() => [
    ...TIPOS_SERVICIO,
    ...tipos.filter((t) => !TIPOS_SERVICIO.some((x) => x.value === t.nombre.trim().toUpperCase())).map((t) => ({ value: t.nombre.toUpperCase(), label: t.nombre })),
  ], [tipos]);

  function set(id: number, patch: Partial<LineaUI>) { setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l))); }
  function add() { setLineas((ls) => [...ls, nuevaLinea(seq)]); setSeq((s) => s + 1); }
  function quitar(id: number) { setLineas((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls)); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(null);
    const payload: LineaServicioInput[] = [];
    for (const l of lineas) {
      if (!l.categoria.trim()) { setError('Indicá la categoría del servicio en cada renglón.'); return; }
      const recargaCat = esRecargaGas(l.categoria);
      const bombonas = recargaCat ? (Number(l.bombonas) || 0) : 0;
      const kgTotal = recargaCat ? Math.round(bombonas * (Number(l.kg) || 0) * 100) / 100 : null;
      const cant = recargaCat ? bombonas : (Number(l.cantidad) || 0);
      if (cant <= 0) { setError(recargaCat ? 'Indicá la cantidad de bombonas.' : 'Cada servicio debe tener cantidad mayor que 0.'); return; }
      const eq = equipos.find((x) => x.id === l.equipoId) ?? null;
      payload.push({ servicioCategoria: l.categoria, servicioTipo: l.tipo || null, equipoId: l.equipoId || null, equipoNombre: eq?.equipo ?? null, cantidad: cant, bombonas: recargaCat ? bombonas : null, kgRecarga: kgTotal });
    }
    setSaving(true);
    try {
      let proveedorId2: string | null = null;
      let proveedorNombre: string | null = null;
      if (provModo === 'nuevo' && provNombre.trim()) {
        const prov = await crearProveedorRapido(provNombre, provRif);
        proveedorId2 = prov.id; proveedorNombre = prov.razon_social;
      } else if (provModo === 'existente' && proveedorId) {
        proveedorId2 = proveedorId; proveedorNombre = proveedores.find((p) => p.id === proveedorId)?.razon_social ?? null;
      }
      await crearServicioDirecto({ lineas: payload, proveedorId: proveedorId2, proveedorNombre, solicitante: solicitante || null, solicitantePersona: solicitantePersona || null, actor, actorName });
      notify(`Servicio directo creado · ${payload.length} servicio(s)${proveedorNombre ? ` · ${proveedorNombre}` : ''}`, 'success', { link: '#/app/pedidos' });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo crear el servicio directo.'); setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="sd-form" className="btn btn-primary" disabled={saving}>{saving ? 'Creando…' : 'Crear servicio directo'}</button>
    </>
  );

  return (
    <Modal title="Nuevo servicio directo" size="lg" onClose={onClose} footer={footer}>
      <form id="sd-form" onSubmit={handleSubmit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        {/* Proveedor / taller */}
        <div className="form-row">
          <label>Proveedor / taller (opcional)</label>
          <div className="view-toggle" role="tablist" style={{ margin: '0 0 .4rem' }}>
            <button type="button" className={provModo === 'existente' ? 'active' : ''} onClick={() => setProvModo('existente')}>🔎 Existente</button>
            <button type="button" className={provModo === 'nuevo' ? 'active' : ''} onClick={() => setProvModo('nuevo')}>＋ Nuevo</button>
          </div>
          {provModo === 'existente' ? (
            <SearchSelect value={proveedorId} onChange={setProveedorId}
              options={proveedores.map((p) => ({ value: p.id, label: `${p.razon_social}${p.rif ? ` · ${p.rif}` : ''}` }))}
              placeholder="🔎 Buscá el proveedor / taller…" emptyText="Sin proveedores. Usá ＋ Nuevo." style={{ maxWidth: 420 }} />
          ) : (
            <div className="form-grid">
              <div className="form-row" style={{ margin: 0 }}><label>Razón social</label><input className="input" value={provNombre} onChange={(e) => setProvNombre(e.target.value)} placeholder="Taller / razón social" /></div>
              <div className="form-row" style={{ margin: 0 }}><label>RIF</label><input className="input" value={provRif} onChange={(e) => setProvRif(e.target.value.toUpperCase())} placeholder="J-12345678-9" /></div>
            </div>
          )}
        </div>

        {/* Quién solicita */}
        <div className="form-grid">
          <div className="form-row"><label>Unidad solicitante (opcional)</label><input className="input" value={solicitante} onChange={(e) => setSolicitante(e.target.value.toUpperCase())} placeholder="Ej. TRANSPORTE" /></div>
          <div className="form-row"><label>Quién lo solicita (opcional)</label><input className="input" value={solicitantePersona} onChange={(e) => setSolicitantePersona(e.target.value)} placeholder="Nombre de la persona" /></div>
        </div>

        <div className="form-row"><label>Servicios</label><small className="muted">Categoría + tipo + equipo de maquinaria. Los montos se cargan al finalizar (con la factura).</small></div>

        {lineas.map((l, idx) => (
          <div key={l.id} className="card" style={{ margin: '0 0 .6rem', padding: '.7rem .85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '.5rem' }}>
              {lineas.length > 1 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => quitar(l.id)} title="Quitar servicio">✕ Quitar servicio #{idx + 1}</button>}
            </div>
            <div className="form-grid">
              <div className="form-row">
                <label>Categoría del servicio #{idx + 1} <span style={{ color: 'var(--danger)' }}>*</span></label>
                <SearchSelect allowCreate value={l.categoria} onChange={(v) => set(l.id, { categoria: v.toUpperCase() })}
                  options={categorias.map((c) => ({ value: c.nombre.toUpperCase(), label: c.nombre }))}
                  placeholder="🔎 Buscá o escribí (mantenimiento de vehículos…)" emptyText="Escribí una nueva." />
              </div>
              {/* En recarga (gas/oxígeno/extintores) solo se pide cantidad de bombonas y KG: sin tipo ni equipo. */}
              {esRecargaGas(l.categoria) ? (
                <div className="form-row">
                  <label>🛢️ Cantidad de bombonas</label>
                  <input className="input mono" type="number" min={0} step="any" value={l.bombonas} onChange={(e) => set(l.id, { bombonas: e.target.value })} placeholder="N° de bombonas" required />
                </div>
              ) : (
                <div className="form-row">
                  <label>Tipo de servicio</label>
                  <SearchSelect allowCreate value={l.tipo} onChange={(v) => set(l.id, { tipo: v.toUpperCase() })}
                    options={tipoOptions}
                    placeholder="🔎 Elegí el tipo (caucho, aceite, pintura…)" emptyText="Escribí uno nuevo." />
                </div>
              )}
            </div>
            {esRecargaGas(l.categoria) ? (
              <div className="form-grid">
                <div className="form-row">
                  <label>⚖️ KG por bombona</label>
                  <input className="input mono" type="number" min={0} step="any" value={l.kg} onChange={(e) => set(l.id, { kg: e.target.value })} placeholder="Kg de cada una" />
                </div>
                <div className="form-row">
                  <label>Total recarga</label>
                  <div className="card mono" style={{ margin: 0, padding: '.45rem .7rem', fontWeight: 700 }}>
                    {(Number(l.bombonas) || 0)} bombona(s) · {Math.round((Number(l.bombonas) || 0) * (Number(l.kg) || 0) * 100) / 100} KG
                  </div>
                </div>
              </div>
            ) : (
              <div className="form-grid">
                <div className="form-row">
                  <label>Equipo (Control de Maquinaria)</label>
                  <SearchSelect value={l.equipoId} onChange={(v) => set(l.id, { equipoId: v })}
                    options={equipos.map((e) => ({ value: e.id, label: `${e.equipo}${e.placa ? ` · ${e.placa}` : ''}` }))}
                    placeholder="🔎 Buscá el equipo / vehículo…" emptyText="Sin equipos." />
                  <small className="muted" style={{ fontSize: '.72rem' }}>Vincula el servicio al equipo (aparece en Control de Mantenimiento).</small>
                </div>
                <div className="form-row"><label>Cantidad</label><input className="input mono" type="number" min={1} step="any" value={l.cantidad} onChange={(e) => set(l.id, { cantidad: e.target.value })} required /></div>
              </div>
            )}
          </div>
        ))}

        <button type="button" className="btn btn-sm btn-ghost" onClick={add}>＋ Agregar servicio</button>
        <p className="muted" style={{ fontSize: '.78rem', marginTop: '.5rem' }}>En este método no se cargan montos al crear. La factura, el monto y la caja se indican al finalizar.</p>
      </form>
    </Modal>
  );
}

/* ───────── Modal: finalizar (monto por servicio + caja + factura) ───────── */

function FinalizarServicioModal({ servicio, cajas, actor, actorName, onClose, onSaved }: {
  servicio: ServicioDirecto; cajas: Caja[]; actor: string; actorName?: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [cajaId, setCajaId] = useState(cajas[0]?.id ?? '');
  const [gastos, setGastos] = useState<Record<number, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const caja = cajas.find((c) => c.id === cajaId) ?? null;
  const moneda = caja?.moneda ?? 'USD';

  const [catRows, setCatRows] = useState<CategoriaGasto[]>([]);
  const [catId, setCatId] = useState('');
  const [subId, setSubId] = useState('');
  useEffect(() => { listCategoriasGasto(true).then(setCatRows).catch(() => setCatRows([])); }, []);
  const categorias = useMemo(() => soloCategorias(catRows), [catRows]);
  const subcategorias = useMemo(() => (catId ? subcategoriasDe(catRows, catId) : []), [catRows, catId]);
  useEffect(() => { setSubId(''); }, [catId]);
  const catNombre = categorias.find((c) => c.id === catId)?.nombre ?? '';
  const subNombre = subcategorias.find((s) => s.id === subId)?.nombre ?? '';

  const [saldoReal, setSaldoReal] = useState<Map<string, { saldo: number; moneda: string }>>(new Map());
  useEffect(() => {
    listSaldos().then((rows) => {
      const m = new Map<string, { saldo: number; moneda: string }>();
      for (const c of cajas) {
        const porMoneda = new Map<string, number>();
        for (const r of rows) { if (r.caja_id !== c.id) continue; porMoneda.set(r.moneda, (porMoneda.get(r.moneda) ?? 0) + (Number(r.saldo) || 0)); }
        let mon: string = c.moneda; let saldo = porMoneda.get(c.moneda) ?? 0;
        if (saldo === 0 && porMoneda.size) { const mejor = [...porMoneda.entries()].sort((a, b) => b[1] - a[1])[0]; mon = mejor[0]; saldo = mejor[1]; }
        m.set(c.id, { saldo, moneda: mon });
      }
      setSaldoReal(m);
    }).catch(() => { /* sin saldos */ });
  }, [cajas]);

  const total = useMemo(() => Math.round(servicio.items.reduce((a, _it, i) => a + (Number(gastos[i]) || 0), 0) * 100) / 100, [gastos, servicio.items]);

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

  const esMultimoneda = saldosCaja.length >= 2;
  function legUsd(monedaLeg: string, n: number): number {
    if (!n || n <= 0) return 0;
    if (monedaLeg === 'USD' || monedaLeg === 'USDT') return round2(n);
    if (monedaLeg === 'Bs') return tasa > 0 ? round2(n / tasa) : 0;
    if (monedaLeg === 'COP') return mercado?.copUsd ? round2(n / mercado.copUsd) : 0;
    return round2(n);
  }
  const sumUsdMulti = round2(saldosCaja.reduce((a, s) => a + legUsd(s.moneda, Number(legMontos[s.id]) || 0), 0));
  const cubreTotalMulti = sumUsdMulti >= total - 0.01;
  const excedeTotalMulti = esMultimoneda && sumUsdMulti > total + 0.01;
  const cuentaLabel = (c: string) => c === 'general' ? '' : c === 'juridica' ? ' · Jurídica' : c === 'personal' ? ' · Personal' : ` · ${c}`;

  const totalUsd = moneda === 'Bs' ? (tasa > 0 ? round2(total / tasa) : 0) : total;
  const totalBs = moneda === 'Bs' ? total : (tasa > 0 ? round2(total * tasa) : 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!cajaId) { setError('Elegí la caja de la que sale el dinero.'); return; }
    if (!catId) { setError('Elegí la categoría de gasto.'); return; }
    if (!subId) { setError('Elegí la subcategoría de gasto.'); return; }
    if (total <= 0) { setError('Indicá cuánto costó cada servicio.'); return; }
    if (file && file.type && file.type !== 'application/pdf' && !file.type.startsWith('image/')) { setError('La factura debe ser un PDF o una imagen.'); return; }
    let legs: PagoLeg[] | undefined;
    if (esMultimoneda) {
      legs = saldosCaja.map((s) => ({ cuenta: s.cuenta as CuentaCaja, moneda: s.moneda, monto: Number(legMontos[s.id]) || 0 })).filter((l) => l.monto > 0);
      if (!legs.length) { setError('Indicá cuánto pagar en al menos una moneda.'); return; }
      if (excedeTotalMulti) { setError(`No podés pagar más que el total (${montoCaja(total, 'USD')}).`); return; }
      if (!cubreTotalMulti) { setError(`Lo cargado (${montoCaja(sumUsdMulti, 'USD')}) no cubre el total (${montoCaja(total, 'USD')}).`); return; }
    }
    const items: ServicioDirectoItem[] = servicio.items.map((it, i) => ({ ...it, gasto: Number(gastos[i]) || 0 }));
    setSaving(true);
    try {
      const payload: FinalizarServicioDirectoInput = { servicio, items, cajaId, legs, file, gastoCategoria: catNombre, gastoSubcategoria: subNombre, actor, actorName };
      await finalizarServicioDirecto(payload);
      const resumenPago = esMultimoneda ? `multipago ${montoCaja(sumUsdMulti, 'USD')}` : montoCaja(total, moneda);
      notify(`Servicio directo pagado · ${resumenPago} desde ${caja?.nombre ?? ''}`, 'success', { link: '#/app/tesoreria' });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo finalizar el servicio.'); setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="sd-fin-form" className="btn btn-primary" disabled={saving || excedeTotalMulti}>{saving ? 'Finalizando…' : excedeTotalMulti ? 'Excede el total' : `Finalizar · ${montoCaja(total, moneda)}`}</button>
    </>
  );

  return (
    <Modal title="Cargar factura y monto del servicio" size="lg" onClose={onClose} footer={footer}>
      <form id="sd-fin-form" onSubmit={handleSubmit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        <div className="form-row">
          <label>Caja (de dónde sale el dinero)</label>
          <select className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)} required style={{ maxWidth: 320 }}>
            {!cajas.length && <option value="">— sin cajas —</option>}
            {cajas.map((c) => { const sr = saldoReal.get(c.id); return <option key={c.id} value={c.id}>{c.nombre} · {montoCaja(sr?.saldo ?? c.saldo, sr?.moneda ?? c.moneda)}</option>; })}
          </select>
          <small className="muted">El monto se descuenta de esta caja (egreso en Tesorería).{esMultimoneda ? ' Es Multimoneda: repartí el pago por moneda abajo.' : ''}</small>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Categoría de gasto <span style={{ color: 'var(--danger)' }}>*</span></label>
            <SearchSelect value={catId} onChange={setCatId} options={categorias.map((c) => ({ value: c.id, label: c.nombre }))}
              placeholder="Buscar categoría…" emptyText="Cargá categorías en Tesorería → 🗂️ Categorías de gasto" />
          </div>
          <div className="form-row">
            <label>Subcategoría <span style={{ color: 'var(--danger)' }}>*</span></label>
            <SearchSelect value={subId} onChange={setSubId} options={subcategorias.map((s) => ({ value: s.id, label: s.nombre }))}
              placeholder={catId ? 'Buscar subcategoría…' : 'Elegí primero la categoría'} emptyText={catId ? 'Sin subcategorías.' : 'Elegí una categoría'} />
          </div>
        </div>
        <small className="muted" style={{ display: 'block', marginBottom: '.6rem' }}>El gasto queda etiquetado por <strong>categoría → subcategoría</strong> en el movimiento de Tesorería.</small>

        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead><tr><th>Servicio</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ width: 160 }}>Monto</th><th style={{ textAlign: 'right' }}>Costo unit.</th></tr></thead>
            <tbody>
              {servicio.items.map((it, i) => {
                const g = Number(gastos[i]) || 0;
                const cu = it.cantidad > 0 && g > 0 ? g / it.cantidad : 0;
                return (
                  <tr key={i}>
                    <td>{it.descripcion}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{num(it.cantidad)}</td>
                    <td><input className="input mono" type="number" min={0} step="any" value={gastos[i] ?? ''} onChange={(e) => setGastos((m) => ({ ...m, [i]: dosDecimales(e.target.value) }))} placeholder="0,00" /></td>
                    <td className="mono" style={{ textAlign: 'right' }}>{montoCaja(cu, moneda)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ margin: '.5rem 0' }}>Total a descontar: <strong className="mono">{montoCaja(total, moneda)}</strong></div>

        {cajaId && (
          <div className="card" style={{ marginBottom: '.75rem', borderColor: 'var(--brand, #ff8a00)', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
            <div><div className="muted" style={{ fontSize: '.72rem' }}>Total en USD</div><strong className="mono" style={{ fontSize: '1.05rem' }}>{tasa > 0 || moneda !== 'Bs' ? montoCaja(totalUsd, 'USD') : '—'}</strong></div>
            <div className="muted" style={{ fontSize: '1.1rem' }}>⇄</div>
            <div><div className="muted" style={{ fontSize: '.72rem' }}>Equivale en Bs (BCV)</div><strong className="mono" style={{ fontSize: '1.05rem' }}>{tasa > 0 || moneda === 'Bs' ? montoCaja(totalBs, 'Bs') : '—'}</strong></div>
            <div className="form-row" style={{ marginLeft: 'auto', minWidth: 150, margin: 0 }}>
              <label style={{ fontSize: '.72rem' }}>Tasa BCV (Bs por $)</label>
              <input className="input mono" type="number" min={0} step="any" value={tasa || ''} onChange={(e) => setTasa(Number(e.target.value) || 0)} placeholder="0,00" />
            </div>
          </div>
        )}

        {esMultimoneda && (
          <div className="card" style={{ marginBottom: '.75rem', borderColor: 'var(--brand, #ff8a00)' }}>
            <div className="card-title" style={{ marginBottom: '.4rem' }}>Pago por moneda · ¿cuánto sale de cada una?</div>
            <div className="table-wrap">
              <table className="table" style={{ fontSize: '.84rem' }}>
                <thead><tr><th>Moneda</th><th style={{ textAlign: 'right' }}>Disponible</th><th style={{ textAlign: 'right' }}>A pagar</th><th style={{ textAlign: 'right' }}>Equiv. USD</th></tr></thead>
                <tbody>
                  {saldosCaja.map((s) => {
                    const n = Number(legMontos[s.id]) || 0;
                    const excede = n > Number(s.saldo);
                    return (
                      <tr key={s.id}>
                        <td><span className="badge">{s.moneda}</span>{cuentaLabel(s.cuenta)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{montoCaja(Number(s.saldo), s.moneda)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <input className="input mono" type="number" min={0} max={Number(s.saldo)} step="any" value={legMontos[s.id] ?? ''} placeholder="0,00"
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
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: excedeTotalMulti ? 'var(--danger)' : cubreTotalMulti ? 'var(--success)' : 'var(--warning)' }}>{montoCaja(sumUsdMulti, 'USD')} / {montoCaja(total, 'USD')}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        <div className="form-row">
          <label>Adjuntar FACTURA del servicio · PDF o imagen (opcional)</label>
          <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file && <small className="muted">{file.name}</small>}
        </div>
      </form>
    </Modal>
  );
}
