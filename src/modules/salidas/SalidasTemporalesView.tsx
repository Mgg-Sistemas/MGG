/* ============================================================
   MGG · Salidas Temporales (submódulo de Salidas / Traslados)
   Saca material a mantenimiento y lo retorna al inventario.
   Flujo: por_aprobar → aprobada (descuenta stock + firma Leidys/
   Jesús) → en_transito → finalizada (reingresa stock + tiempos).
   Vista tipo kanban (tarjetas) + histórico buscable. Editar y
   eliminar solo antes de aprobar. Todo con realtime.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal as ModalUI, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { num, dateTime, date as fmtDate } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import type {
  Producto, Existencia, Chofer,
  SalidaTemporal, ItemSalidaTemporal, EstadoSalidaTemporal, AprobadorSalidaTemporal,
} from '@/shared/lib/types';
import { listProductos } from '@/modules/inventario/inventario.repository';
import { listExistencias } from '@/modules/inventario/almacenes.repository';
import { listChoferes, crearChofer } from './salidasCatalogos.repository';
import {
  listSalidasTemporales, crearSalidaTemporal, editarSalidaTemporal, eliminarSalidaTemporal,
  aprobarSalidaTemporal, ponerEnTransitoSalidaTemporal, finalizarSalidaTemporal,
  duracionesSalidaTemporal, fmtDuracion, APROBADORES_SALIDA_TEMPORAL,
} from './salidasTemporales.repository';

const COLS: { key: EstadoSalidaTemporal; label: string }[] = [
  { key: 'por_aprobar', label: 'Por aprobar' },
  { key: 'aprobada', label: 'Aprobada (mantenimiento)' },
  { key: 'en_transito', label: 'En tránsito' },
  { key: 'finalizada', label: 'Finalizada' },
];
const ESTADO_CLASS: Record<EstadoSalidaTemporal, string> = {
  por_aprobar: 'warning', aprobada: 'info', en_transito: 'info', finalizada: 'success',
};
const ESTADO_TXT: Record<EstadoSalidaTemporal, string> = {
  por_aprobar: 'Por aprobar', aprobada: 'Aprobada (en mantenimiento)',
  en_transito: 'En tránsito (de regreso)', finalizada: 'Finalizada',
};

/** Resumen corto de los materiales de una solicitud. */
function resumenItems(s: SalidaTemporal): string {
  const its = s.items ?? [];
  if (!its.length) return '—';
  const first = its[0];
  const extra = its.length > 1 ? ` +${its.length - 1} más` : '';
  return `${num(Number(first.cantidad) || 0)} × ${first.producto_nombre}${extra}`;
}

export function SalidasTemporalesView({ nuevoNonce }: { nuevoNonce?: number }) {
  const { can, appUser, isAdmin, role } = usePermissions();
  const canWrite = can('salidas', 'escritura');
  const r = role ?? '';
  const NO_APRUEBA = r === 'analista' || r === 'analista_de_lectura';
  const puedeAprobar = !NO_APRUEBA && (isAdmin || can('salidas', 'full') || /^analista/.test(r) || /^jef[ae]/.test(r));
  const puedeEjecutar = !NO_APRUEBA && (puedeAprobar || canWrite);
  const actor = appUser?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;

  const [vista, setVista] = useState<'kanban' | 'lista'>('kanban');
  const [loading, setLoading] = useState(true);
  const [sols, setSols] = useState<SalidaTemporal[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [existencias, setExistencias] = useState<Existencia[]>([]);
  const [modal, setModal] = useState<{ kind: 'none' } | { kind: 'form'; sol?: SalidaTemporal } | { kind: 'detalle'; sol: SalidaTemporal }>({ kind: 'none' });

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [ss, pds, exs] = await Promise.all([
        listSalidasTemporales(),
        listProductos().catch(() => [] as Producto[]),
        listExistencias().catch(() => [] as Existencia[]),
      ]);
      setSols(ss); setProductos(pds); setExistencias(exs);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cargar Salidas Temporales', 'error');
    } finally {
      setLoading(false);
    }
  }, []);
  useRealtime(['solicitudes_salida_temporal', 'movimientos', 'productos', 'existencias'], () => { void reload(); });
  useEffect(() => { void reload(); }, [reload]);
  // El botón "+ Nueva salida temporal" del encabezado (SalidasPage) abre el formulario vía nonce.
  useEffect(() => { if (nuevoNonce && nuevoNonce > 0) setModal({ kind: 'form' }); }, [nuevoNonce]);

  // Origen (almacén con más stock) por producto: de dónde sale y a dónde retorna.
  const origenDe = useMemo(() => {
    const m = new Map<string, { almacen: string; stock: number }>();
    for (const e of existencias) {
      const st = Number(e.stock) || 0;
      if (st <= 0) continue;
      const cur = m.get(e.producto_id);
      if (!cur || st > cur.stock) m.set(e.producto_id, { almacen: e.almacen, stock: st });
    }
    return m;
  }, [existencias]);

  return (
    <div>
      <div className="view-toggle" role="tablist" aria-label="Kanban o histórico" style={{ marginBottom: '1rem' }}>
        <button className={vista === 'kanban' ? 'active' : ''} onClick={() => setVista('kanban')}>🗂 Solicitudes</button>
        <button className={vista === 'lista' ? 'active' : ''} onClick={() => setVista('lista')}>📜 Histórico</button>
      </div>

      {loading ? (
        <EmptyState message="Cargando…" icon="◔" />
      ) : vista === 'kanban' ? (
        <Kanban sols={sols} onVer={(sol) => setModal({ kind: 'detalle', sol })} />
      ) : (
        <Historico sols={sols} onVer={(sol) => setModal({ kind: 'detalle', sol })} />
      )}

      {modal.kind === 'form' && (
        <FormModal
          sol={modal.sol}
          productos={productos}
          origenDe={origenDe}
          actor={actor}
          actorName={actorName}
          onClose={() => setModal({ kind: 'none' })}
          onSaved={() => { setModal({ kind: 'none' }); void reload(); }}
        />
      )}

      {modal.kind === 'detalle' && (
        <DetalleModal
          sol={modal.sol}
          puedeAprobar={puedeAprobar}
          puedeEjecutar={puedeEjecutar}
          canWrite={canWrite}
          actor={actor}
          actorName={actorName}
          onEditar={(sol) => setModal({ kind: 'form', sol })}
          onClose={() => setModal({ kind: 'none' })}
          onChanged={() => { setModal({ kind: 'none' }); void reload(); }}
        />
      )}
    </div>
  );
}

/* ───────────── Kanban ───────────── */
function Kanban({ sols, onVer }: { sols: SalidaTemporal[]; onVer: (s: SalidaTemporal) => void }) {
  if (!sols.length) return <EmptyState message="Sin salidas temporales todavía. Creá la primera con “+ Nueva salida temporal”." icon="🔧" />;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '.75rem' }}>
      {COLS.map((col) => {
        const items = sols.filter((s) => s.estado === col.key);
        return (
          <div key={col.key} className="card" style={{ background: 'var(--bg-1)', padding: '.6rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem' }}>
              <strong style={{ fontSize: '.82rem' }}>{col.label}</strong>
              <span className={`badge ${ESTADO_CLASS[col.key]}`}>{items.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', maxHeight: 'max(320px, calc(100vh - 300px))', overflowY: 'auto' }}>
              {items.map((s) => (
                <button key={s.id} className="card" onClick={() => onVer(s)}
                  style={{ textAlign: 'left', padding: '.55rem .6rem', cursor: 'pointer', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.4rem' }}>
                    <span className="mono" style={{ fontWeight: 700, color: 'var(--primary-3)' }}>N° {String(s.num_usuario ?? 0).padStart(3, '0')}</span>
                    <span className="mono muted" style={{ fontSize: '.7rem' }}>{s.codigo}</span>
                  </div>
                  <div style={{ fontSize: '.82rem', marginTop: '.2rem' }}>🔧 {resumenItems(s)}</div>
                  {s.responsable && <div className="muted" style={{ fontSize: '.75rem' }}>👤 {s.responsable}</div>}
                  <div style={{ fontSize: '.75rem', color: 'var(--success)' }}>👤 {s.solicitante}</div>
                  <div className="muted" style={{ fontSize: '.72rem' }}>{dateTime(s.created_at)}</div>
                </button>
              ))}
              {!items.length && <span className="muted" style={{ fontSize: '.75rem', padding: '.2rem' }}>—</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────── Histórico buscable ───────────── */
function Historico({ sols, onVer }: { sols: SalidaTemporal[]; onVer: (s: SalidaTemporal) => void }) {
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<'' | EstadoSalidaTemporal>('');
  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return sols.filter((s) => {
      if (estado && s.estado !== estado) return false;
      if (!t) return true;
      const hay = [s.codigo, s.solicitante, s.responsable, s.unidad_solicitante, s.motivo, ...(s.items ?? []).map((it) => it.producto_nombre)]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(t);
    });
  }, [sols, q, estado]);

  return (
    <div>
      <div className="filterbar" style={{ gap: '.6rem', marginBottom: '.8rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-row" style={{ margin: 0, flex: '2 1 220px' }}>
          <label style={{ fontSize: '.72rem' }}>🔎 Buscar (código, solicitante, responsable, material…)</label>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escribí para filtrar…" />
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <label style={{ fontSize: '.72rem' }}>Estado</label>
          <select className="select" value={estado} onChange={(e) => setEstado(e.target.value as '' | EstadoSalidaTemporal)}>
            <option value="">Todos</option>
            {COLS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <span className="muted" style={{ fontSize: '.8rem', marginLeft: 'auto' }}>{filtradas.length} de {sols.length}</span>
      </div>
      {!filtradas.length ? (
        <EmptyState message="Sin resultados." icon="🔎" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>N°</th><th>Código</th><th>Materiales</th><th>Solicitante</th><th>Responsable</th><th>Estado</th><th>Fecha</th><th></th></tr>
            </thead>
            <tbody>
              {filtradas.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{String(s.num_usuario ?? 0).padStart(3, '0')}</td>
                  <td className="mono muted">{s.codigo}</td>
                  <td>{resumenItems(s)}</td>
                  <td>{s.solicitante}</td>
                  <td>{s.responsable || '—'}</td>
                  <td><span className={`badge ${ESTADO_CLASS[s.estado]}`}>{ESTADO_TXT[s.estado]}</span></td>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{dateTime(s.created_at)}</td>
                  <td><button className="btn btn-sm btn-ghost" onClick={() => onVer(s)}>Ver</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ───────────── Form (crear / editar) ───────────── */
interface LineaUI {
  id: string;
  esNuevo: boolean;
  productoId: string;
  nombreNuevo: string;
  cantidad: string;
  unidad: string;
  observacion: string;
}
let _lid = 0;
const nuevaLinea = (): LineaUI => ({ id: `l${++_lid}`, esNuevo: false, productoId: '', nombreNuevo: '', cantidad: '', unidad: '', observacion: '' });

function FormModal({ sol, productos, origenDe, actor, actorName, onClose, onSaved }: {
  sol?: SalidaTemporal;
  productos: Producto[];
  origenDe: Map<string, { almacen: string; stock: number }>;
  actor: string;
  actorName: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editando = !!sol;
  const activos = useMemo(() => productos.filter((p) => p.estado === 'activo'), [productos]);
  const opProductos = useMemo(() => activos.map((p) => ({ value: p.id, label: `${p.nombre} · ${p.sku}` })), [activos]);

  const [lineas, setLineas] = useState<LineaUI[]>(() => {
    if (sol && sol.items?.length) {
      return sol.items.map((it) => ({
        id: `l${++_lid}`, esNuevo: !!it.es_nuevo, productoId: it.producto_id ?? '',
        nombreNuevo: it.es_nuevo ? it.producto_nombre : '', cantidad: String(it.cantidad ?? ''),
        unidad: it.unidad ?? '', observacion: it.observacion ?? '',
      }));
    }
    return [nuevaLinea()];
  });
  const [solicitante, setSolicitante] = useState(sol?.solicitante ?? actorName ?? actor);
  const [unidad, setUnidad] = useState(sol?.unidad_solicitante ?? '');
  const [dirDespacho, setDirDespacho] = useState(sol?.direccion_despacho ?? '');
  const [dirDestino, setDirDestino] = useState(sol?.direccion_destino ?? '');
  const [motivo, setMotivo] = useState(sol?.motivo ?? '');
  const [nota, setNota] = useState(sol?.nota ?? '');
  const [saving, setSaving] = useState(false);

  // Responsable (catálogo de choferes: nombre + cédula, reutilizable).
  const [choferes, setChoferes] = useState<Chofer[]>([]);
  const [responsable, setResponsable] = useState(sol?.responsable ?? '');
  const [responsableCedula, setResponsableCedula] = useState(sol?.responsable_cedula ?? '');
  const [nResp, setNResp] = useState(''); const [nCed, setNCed] = useState(''); const [addingResp, setAddingResp] = useState(false);
  useEffect(() => { void listChoferes(true).then(setChoferes).catch(() => setChoferes([])); }, []);
  async function addResponsable() {
    const nombre = nResp.trim();
    if (!nombre) { toast('Escribí el nombre del responsable', 'error'); return; }
    const ya = choferes.find((c) => c.nombre.toLowerCase() === nombre.toLowerCase());
    if (ya) { setResponsable(ya.nombre); setResponsableCedula(ya.cedula ?? ''); setNResp(''); setNCed(''); toast(`"${ya.nombre}" ya existe — se seleccionó`, 'warning'); return; }
    setAddingResp(true);
    try {
      const c = await crearChofer({ nombre, cedula: nCed, actor });
      setChoferes((p) => [...p, c].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
      setResponsable(c.nombre); setResponsableCedula(c.cedula ?? ''); setNResp(''); setNCed('');
      toast(`Responsable "${c.nombre}" agregado`, 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo agregar el responsable', 'error'); }
    finally { setAddingResp(false); }
  }

  const setLinea = (id: string, patch: Partial<LineaUI>) => setLineas((p) => p.map((l) => l.id === id ? { ...l, ...patch } : l));
  const addLinea = () => setLineas((p) => [...p, nuevaLinea()]);
  const quitarLinea = (id: string) => setLineas((p) => (p.length > 1 ? p.filter((l) => l.id !== id) : p));

  function construirItems(): ItemSalidaTemporal[] {
    return lineas.map((l) => {
      const cant = Number(String(l.cantidad).replace(',', '.')) || 0;
      if (l.esNuevo) {
        return { producto_id: null, producto_nombre: l.nombreNuevo.trim(), cantidad: cant, unidad: l.unidad.trim() || null, es_nuevo: true, observacion: l.observacion.trim() || null };
      }
      const p = activos.find((x) => x.id === l.productoId);
      const orig = origenDe.get(l.productoId) ?? null;
      return {
        producto_id: l.productoId || null,
        producto_nombre: p?.nombre ?? '',
        sku: p?.sku ?? null,
        cantidad: cant,
        unidad: p?.unidad ?? null,
        almacen: orig?.almacen ?? null,
        es_nuevo: false,
        observacion: l.observacion.trim() || null,
      };
    }).filter((it) => it.producto_nombre && it.cantidad > 0);
  }

  async function submit() {
    if (!solicitante.trim()) { toast('Indicá quién solicita', 'error'); return; }
    const items = construirItems();
    if (!items.length) { toast('Agregá al menos un material con cantidad', 'error'); return; }
    const invSinStock = items.find((it) => !it.es_nuevo && it.producto_id && !it.almacen);
    if (invSinStock) { toast(`"${invSinStock.producto_nombre}" no tiene stock en ningún almacén. Marcalo como "Nuevo" si va fuera de inventario.`, 'error'); return; }
    setSaving(true);
    try {
      if (editando && sol) {
        await editarSalidaTemporal(sol, {
          items, unidadSolicitante: unidad, solicitante, responsable, responsableCedula,
          direccionDespacho: dirDespacho, direccionDestino: dirDestino, motivo, nota,
        }, actor);
        toast('Salida temporal actualizada', 'success');
      } else {
        await crearSalidaTemporal({
          items, unidadSolicitante: unidad, solicitante, responsable, responsableCedula,
          direccionDespacho: dirDespacho, direccionDestino: dirDestino, motivo, nota, actor, actorName,
        });
        toast('Salida temporal creada', 'success');
      }
      onSaved();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
    finally { setSaving(false); }
  }

  return (
    <ModalUI
      title={editando ? `Editar salida temporal · ${sol!.codigo}` : 'Nueva salida temporal (a mantenimiento)'}
      size="lg"
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? '…' : (editando ? 'Guardar cambios' : 'Crear solicitud')}</button>
      </>}
    >
      <p className="hint muted" style={{ marginTop: 0 }}>Fecha: <strong>{fmtDate(new Date().toISOString())}</strong> · El material sale a mantenimiento, pasa por aprobación y retorna al inventario al finalizar.</p>

      {/* Datos de la solicitud */}
      <div style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, color: 'var(--primary-3)', margin: '.8rem 0 .4rem' }}>Datos de la solicitud</div>
      <div className="form-grid">
        <div className="form-row"><label>Solicitante</label><input className="input" value={solicitante} onChange={(e) => setSolicitante(e.target.value)} placeholder="Quién solicita" /></div>
        <div className="form-row"><label>Unidad solicitante</label>
          <input className="input" list="stemp-unidades" value={unidad} onChange={(e) => setUnidad(e.target.value)} placeholder="Ej.: Mantenimiento, Fundición…" /></div>
      </div>

      {/* Responsable (nombre + cédula, reutilizable) */}
      <div className="form-grid">
        <div className="form-row">
          <label>Responsable (nombre y apellido)</label>
          <SearchSelect value={responsable ? (choferes.find((c) => c.nombre === responsable)?.id ?? '') : ''}
            onChange={(id) => { const c = choferes.find((x) => x.id === id); setResponsable(c?.nombre ?? ''); setResponsableCedula(c?.cedula ?? ''); }}
            options={choferes.map((c) => ({ value: c.id, label: `${c.nombre}${c.cedula ? ` · C.I. ${c.cedula}` : ''}` }))}
            placeholder="🔎 Buscá el responsable…" emptyText="Sin responsables guardados." />
          {responsable && <small className="muted">Elegido: <strong>{responsable}</strong>{responsableCedula ? ` · C.I. ${responsableCedula}` : ''}</small>}
          <div style={{ display: 'flex', gap: '.4rem', marginTop: '.35rem', flexWrap: 'wrap' }}>
            <input className="input" value={nResp} onChange={(e) => setNResp(e.target.value)} placeholder="¿No está? Nombre y apellido"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addResponsable(); } }} style={{ flex: '2 1 140px', fontSize: '.82rem' }} />
            <input className="input mono" value={nCed} onChange={(e) => setNCed(e.target.value)} placeholder="Cédula"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addResponsable(); } }} style={{ flex: '1 1 100px', fontSize: '.82rem' }} />
            <button type="button" className="btn btn-sm btn-ghost" onClick={addResponsable} disabled={addingResp || !nResp.trim()}>{addingResp ? '…' : '+ Añadir'}</button>
          </div>
        </div>
        <div className="form-row"><label>Motivo / mantenimiento</label><input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: Reparación de bomba" /></div>
      </div>

      <div className="form-grid">
        <div className="form-row"><label>Dirección de despacho (origen)</label><input className="input" value={dirDespacho} onChange={(e) => setDirDespacho(e.target.value)} placeholder="Desde dónde sale" /></div>
        <div className="form-row"><label>Dirección destino (mantenimiento)</label><input className="input" value={dirDestino} onChange={(e) => setDirDestino(e.target.value)} placeholder="A dónde va" /></div>
      </div>
      <div className="form-row"><label>Nota (opcional)</label><textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Notas adicionales" /></div>

      {/* Materiales (de segundo: después de los datos de la solicitud) */}
      <div style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, color: 'var(--primary-3)', margin: '.8rem 0 .4rem' }}>Materiales</div>
      <div style={{ display: 'grid', gap: '.55rem' }}>
        {lineas.map((l, i) => {
          const orig = l.productoId ? origenDe.get(l.productoId) ?? null : null;
          return (
            <div key={l.id} className="card" style={{ padding: '.55rem .65rem', background: 'var(--bg-1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.35rem' }}>
                <strong style={{ fontSize: '.8rem' }}>Material #{i + 1}</strong>
                <div style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
                  <div className="view-toggle" style={{ margin: 0 }}>
                    <button type="button" className={!l.esNuevo ? 'active' : ''} onClick={() => setLinea(l.id, { esNuevo: false })} style={{ fontSize: '.72rem' }}>Del inventario</button>
                    <button type="button" className={l.esNuevo ? 'active' : ''} onClick={() => setLinea(l.id, { esNuevo: true })} style={{ fontSize: '.72rem' }}>Nuevo</button>
                  </div>
                  {lineas.length > 1 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => quitarLinea(l.id)} style={{ color: 'var(--danger)' }}>✕</button>}
                </div>
              </div>
              <div className="form-grid">
                {l.esNuevo ? (
                  <div className="form-row"><label>Material (nuevo, fuera de inventario)</label>
                    <input className="input" value={l.nombreNuevo} onChange={(e) => setLinea(l.id, { nombreNuevo: e.target.value })} placeholder="Ej.: Motor eléctrico 5HP" /></div>
                ) : (
                  <div className="form-row"><label>Material del inventario</label>
                    <SearchSelect value={l.productoId} onChange={(id) => setLinea(l.id, { productoId: id })} options={opProductos} placeholder="🔎 Buscá el material…" emptyText="Sin productos." />
                    {orig ? <small className="muted">Sale de <strong>{orig.almacen}</strong> · stock {num(orig.stock)}</small>
                      : l.productoId ? <small style={{ color: 'var(--danger)' }}>Sin stock en ningún almacén.</small> : null}
                  </div>
                )}
                <div className="form-row"><label>Cantidad</label>
                  <input className="input mono" inputMode="decimal" value={l.cantidad} onChange={(e) => setLinea(l.id, { cantidad: e.target.value })} placeholder="0" style={{ textAlign: 'right' }} /></div>
              </div>
              <div className="form-grid">
                {l.esNuevo && <div className="form-row"><label>Unidad</label><input className="input" value={l.unidad} onChange={(e) => setLinea(l.id, { unidad: e.target.value })} placeholder="u, kg, m…" /></div>}
                <div className="form-row" style={{ gridColumn: l.esNuevo ? 'auto' : '1 / -1' }}><label>Observación (opcional)</label>
                  <input className="input" value={l.observacion} onChange={(e) => setLinea(l.id, { observacion: e.target.value })} placeholder="Serial, condición, detalle…" /></div>
              </div>
            </div>
          );
        })}
        <button type="button" className="btn btn-sm btn-ghost" onClick={addLinea} style={{ alignSelf: 'start' }}>＋ Añadir material</button>
      </div>

      <datalist id="stemp-unidades">
        {['Mantenimiento', 'Fundición', 'Producción', 'Acopio', 'Administración', 'Taller'].map((u) => <option key={u} value={u} />)}
      </datalist>
    </ModalUI>
  );
}

/* ───────────── Detalle + acciones + trazabilidad ───────────── */
function DetalleModal({ sol, puedeAprobar, puedeEjecutar, canWrite, actor, actorName, onEditar, onClose, onChanged }: {
  sol: SalidaTemporal;
  puedeAprobar: boolean;
  puedeEjecutar: boolean;
  canWrite: boolean;
  actor: string;
  actorName: string | null;
  onEditar: (s: SalidaTemporal) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [aprobando, setAprobando] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const editable = sol.estado === 'por_aprobar';
  const dur = duracionesSalidaTemporal(sol);

  async function run(fn: () => Promise<void>, okMsg: string) {
    setBusy(true);
    try { await fn(); toast(okMsg, 'success'); onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo completar la acción', 'error'); setBusy(false); }
  }
  async function aprobar(a: AprobadorSalidaTemporal) {
    await run(() => aprobarSalidaTemporal(sol, a, actor, actorName), `Aprobada por ${APROBADORES_SALIDA_TEMPORAL[a]} · stock descontado`);
  }
  async function verPdf() {
    try { const { descargarOrdenSalidaTemporalPdf } = await import('./salidaTemporalPdf'); await descargarOrdenSalidaTemporalPdf(sol); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  const ficha: Array<[string, string]> = [
    ['Estado', ESTADO_TXT[sol.estado]],
    ['Solicitante', sol.solicitante],
    ...(sol.unidad_solicitante ? [['Unidad solicitante', sol.unidad_solicitante] as [string, string]] : []),
    ...(sol.responsable ? [['Responsable', `${sol.responsable}${sol.responsable_cedula ? ` · C.I. ${sol.responsable_cedula}` : ''}`] as [string, string]] : []),
    ...(sol.direccion_despacho ? [['Despacho (origen)', sol.direccion_despacho] as [string, string]] : []),
    ...(sol.direccion_destino ? [['Destino (mantenimiento)', sol.direccion_destino] as [string, string]] : []),
    ...(sol.motivo ? [['Motivo', sol.motivo] as [string, string]] : []),
    ...(sol.nota ? [['Nota', sol.nota] as [string, string]] : []),
    ['Creada', dateTime(sol.created_at)],
    ...(sol.aprobador ? [['Aprobada por', `${sol.aprobador} · ${sol.aprobada_en ? dateTime(sol.aprobada_en) : ''}`] as [string, string]] : []),
    ...(sol.transito_en ? [['En tránsito desde', dateTime(sol.transito_en)] as [string, string]] : []),
    ...(sol.finalizada_en ? [['Finalizada', dateTime(sol.finalizada_en)] as [string, string]] : []),
  ];

  return (
    <ModalUI
      title={`Salida temporal N° ${String(sol.num_usuario ?? 0).padStart(3, '0')} · ${sol.codigo}`}
      size="lg"
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={verPdf}>📄 Ver PDF</button>
        {editable && canWrite && <button className="btn btn-ghost" onClick={() => onEditar(sol)}>✎ Editar</button>}
        {editable && canWrite && <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDel(true)}>🗑 Eliminar</button>}
        {sol.estado === 'por_aprobar' && puedeAprobar && !aprobando && <button className="btn btn-primary" disabled={busy} onClick={() => setAprobando(true)}>✓ Aprobar…</button>}
        {sol.estado === 'aprobada' && puedeEjecutar && <button className="btn btn-primary" disabled={busy} onClick={() => run(() => ponerEnTransitoSalidaTemporal(sol, actor), 'Marcada en tránsito')}>🚚 Poner en tránsito</button>}
        {sol.estado === 'en_transito' && puedeEjecutar && <button className="btn btn-success" disabled={busy} onClick={() => run(() => finalizarSalidaTemporal(sol, actor, actorName), 'Finalizada · stock reingresado')}>✓ Finalizar (retorna al inventario)</button>}
      </>}
    >
      {aprobando && (
        <div className="card" style={{ padding: '.6rem .7rem', marginBottom: '.7rem', background: 'var(--bg-1)', borderLeft: '3px solid var(--primary)' }}>
          <div style={{ fontWeight: 600, marginBottom: '.4rem' }}>¿Quién aprueba y firma?</div>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => aprobar('leidys')}>Leidys Rengel</button>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => aprobar('jesus')}>Jesús Lozada</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setAprobando(false)}>Cancelar</button>
          </div>
          <small className="muted">Al aprobar se descuenta el material del inventario y se estampa su firma en el PDF.</small>
        </div>
      )}

      {/* Materiales */}
      <div className="table-wrap" style={{ marginBottom: '.7rem' }}>
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>Material</th><th>Origen</th><th style={{ textAlign: 'right' }}>Cantidad</th></tr></thead>
          <tbody>
            {(sol.items ?? []).map((it, i) => (
              <tr key={i}>
                <td>{it.producto_nombre}{it.es_nuevo && <span className="badge warning" style={{ marginLeft: '.3rem' }}>nuevo</span>}{it.observacion && <div className="muted" style={{ fontSize: '.75rem' }}>Obs: {it.observacion}</div>}</td>
                <td className="muted">{it.es_nuevo ? 'Fuera de inventario' : (it.almacen || '—')}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{num(Number(it.cantidad) || 0)}{it.unidad ? ` ${it.unidad}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tiempos (al finalizar) */}
      {sol.estado === 'finalizada' && (
        <div className="card" style={{ padding: '.55rem .7rem', marginBottom: '.7rem', background: 'var(--bg-1)' }}>
          <div style={{ fontWeight: 600, marginBottom: '.3rem' }}>⏱ Tiempos</div>
          <div style={{ fontSize: '.85rem', lineHeight: 1.7 }}>
            En mantenimiento: <strong>{fmtDuracion(dur.mant)}</strong><br />
            En tránsito: <strong>{fmtDuracion(dur.tran)}</strong><br />
            Total fuera del inventario: <strong style={{ color: 'var(--primary-3)' }}>{fmtDuracion(dur.total)}</strong>
          </div>
        </div>
      )}

      {/* Ficha */}
      <table className="table" style={{ fontSize: '.85rem' }}>
        <tbody>{ficha.map(([k, v]) => (<tr key={k}><th style={{ width: 190, textAlign: 'left' }}>{k}</th><td>{v}</td></tr>))}</tbody>
      </table>

      {/* Trazabilidad */}
      <div style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, color: 'var(--primary-3)', margin: '.7rem 0 .3rem' }}>Trazabilidad</div>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '.82rem' }}>
        {(sol.historial ?? []).map((h, i) => (
          <li key={i}><strong>{h.evento}</strong> · {h.actor} · <span className="muted">{dateTime(h.at)}</span>{(h as { motivo?: string }).motivo ? ` — ${(h as { motivo?: string }).motivo}` : ''}</li>
        ))}
      </ul>

      {confirmDel && (
        <ConfirmDialog
          title="Eliminar salida temporal"
          message={`¿Eliminar la solicitud ${sol.codigo}? Esta acción no se puede deshacer (solo se permite antes de aprobar).`}
          confirmText="Eliminar" danger
          onCancel={() => setConfirmDel(false)}
          onConfirm={() => { setConfirmDel(false); void run(() => eliminarSalidaTemporal(sol), 'Salida temporal eliminada'); }}
        />
      )}
    </ModalUI>
  );
}
