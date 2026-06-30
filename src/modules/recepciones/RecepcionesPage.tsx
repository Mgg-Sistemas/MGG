import { Fragment, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { num, dateTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { AlmacenSelectAgrupado } from '@/modules/inventario/AlmacenPicker';
import { listAlmacenes, crearAlmacen } from '@/modules/inventario/almacenes.repository';
import type { Almacen } from '@/shared/lib/types';
import {
  listRecepciones, crearRecepcion, actualizarRecepcion, eliminarRecepcion,
  listMinerales, crearMineral, actualizarMineral, setMineralActivo,
  listAnalisis, crearAnalisis, actualizarAnalisis, eliminarAnalisis,
  promMineral, promedioDelLote,
  listHumedadProv, crearHumedadProv, actualizarHumedadProv, eliminarHumedadProv,
  listHumedadFinal, crearHumedadFinal, actualizarHumedadFinal, eliminarHumedadFinal,
  promedioCol, sumaCol,
  listPesajes, crearPesaje, actualizarPesaje, eliminarPesaje, bigBagLado, totalNetoLado,
  listConciliaciones, crearConciliacion, actualizarConciliacion, eliminarConciliacion,
  totalReportadoConcil, kgFaltanteConcil, kgNoLlegoConcil, pctNoLlegoConcil,
  listTotales, crearTotales, actualizarTotales, eliminarTotales,
  totalMonedaCentro, sumSnO2, totalMonedaTotal, tasaRecepcionada,
  listGrupos, crearGrupo, eliminarGrupo,
  listCierres, nextNumeroCierre, crearCierre, eliminarCierre,
  type Recepcion, type RecepcionMineral, type RecepcionAnalisis, type ValorMineral,
  type HumedadProv, type HumedadFinal, type RecepcionPesaje, type PesajeBigbag, type PesoModo,
  type RecepcionConciliacion, type CentroConcil, type RecepcionTotales, type CentroTotal,
  type RecepcionGrupo, type RecepcionCierre,
} from './recepciones.repository';

/* es-VE: acepta coma o punto como decimal al tipear. */
function parseNum(s: string): number | null {
  const t = String(s ?? '').trim().replace(/\./g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Columnas de la grilla por mineral: abc = A/B/C/Prom (4) · prom = solo Prom (1).
const colsPorMineral = (m: RecepcionMineral) => (m.modo === 'abc' ? 4 : 1);

// Fecha (día) en formato es-VE: 30/06/2026.
const diaVE = (iso: string) => new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/* ───────────── Una tabla del laboratorio (subconjunto de minerales) ─────────────
   El grid completo se parte en dos tablas apiladas (5 minerales arriba, 5 abajo)
   para no tener scroll horizontal: ambas comparten las mismas filas de análisis. */
function LabTable({ minerales, analisis, canWrite, showActions, onBorrar, onReload }: {
  minerales: RecepcionMineral[]; analisis: RecepcionAnalisis[]; canWrite: boolean;
  showActions: boolean; onBorrar: (a: RecepcionAnalisis) => void; onReload: () => Promise<void>;
}) {
  if (!minerales.length) return null;
  const accion = canWrite && showActions;
  const totalCols = 1 + minerales.reduce((a, m) => a + colsPorMineral(m), 0) + (accion ? 1 : 0);
  return (
    <div className="table-wrap" style={{ overflowX: 'auto' }}>
      <table className="table" style={{ fontSize: '.82rem' }}>
        <thead>
          {/* Fila 1: nombre del mineral (agrupado) */}
          <tr>
            <th rowSpan={2} style={{ verticalAlign: 'bottom' }}>N° Análisis</th>
            {minerales.map((m) => (
              <th key={m.id} colSpan={colsPorMineral(m)} style={{ textAlign: 'center', background: m.color ?? undefined, color: m.color ? '#1a1a1a' : undefined, borderLeft: '2px solid var(--border-strong, #888)' }}>
                {m.nombre}{m.subtitulo ? <div style={{ fontSize: '.72rem', fontWeight: 500 }}>{m.subtitulo}</div> : null}
              </th>
            ))}
            {accion && <th rowSpan={2}></th>}
          </tr>
          {/* Fila 2: A / B / C / Prom (o solo Prom) */}
          <tr>
            {minerales.flatMap((m) => (
              m.modo === 'abc'
                ? ['A', 'B', 'C', 'Prom.'].map((h, i) => (
                    <th key={`${m.id}-${h}`} style={{ textAlign: 'center', background: m.color ? `${m.color}99` : undefined, color: m.color ? '#1a1a1a' : undefined, borderLeft: i === 0 ? '2px solid var(--border-strong, #888)' : undefined }}>{h}</th>
                  ))
                : [<th key={`${m.id}-prom`} style={{ textAlign: 'center', background: m.color ? `${m.color}99` : undefined, color: m.color ? '#1a1a1a' : undefined, borderLeft: '2px solid var(--border-strong, #888)' }}>Prom.</th>]
            ))}
          </tr>
        </thead>
        <tbody>
          {!analisis.length ? (
            <tr><td colSpan={totalCols} className="muted" style={{ textAlign: 'center' }}>Sin análisis. Agregá uno con “+ Nuevo análisis”.</td></tr>
          ) : analisis.map((a) => (
            <AnalisisRow key={a.id} analisis={a} minerales={minerales} canWrite={canWrite} showActions={showActions} onBorrar={() => void onBorrar(a)} onReload={onReload} />
          ))}
        </tbody>
        {analisis.length > 0 && (
          <tfoot>
            <tr>
              <td style={{ fontWeight: 800 }}>Promedio del lote</td>
              {minerales.flatMap((m) => {
                const prom = promedioDelLote(m.modo, m.clave, analisis);
                if (m.modo === 'abc') {
                  return [
                    <td key={`${m.id}-pad`} colSpan={3} style={{ borderLeft: '2px solid var(--border-strong, #888)' }}></td>,
                    <td key={`${m.id}-prom`} className="mono" style={{ textAlign: 'center', fontWeight: 800, background: m.color ? `${m.color}55` : undefined }}>{prom != null ? `${num(prom)}%` : '—'}</td>,
                  ];
                }
                return [<td key={`${m.id}-prom`} className="mono" style={{ textAlign: 'center', fontWeight: 800, background: m.color ? `${m.color}55` : undefined, borderLeft: '2px solid var(--border-strong, #888)' }}>{prom != null ? `${num(prom)}%` : '—'}</td>];
              })}
              {accion && <td></td>}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/* ───────────── Home: tarjetas de recepción (como Combustible) ───────────── */
export function RecepcionesPage() {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('recepciones', 'escritura');
  const actor = user?.email ?? 'sistema';
  const miNombre = appUser?.nombre?.trim() || user?.email || '';

  const [grupos, setGrupos] = useState<RecepcionGrupo[]>([]);
  const [sel, setSel] = useState<RecepcionGrupo | null>(null);
  const [loading, setLoading] = useState(true);
  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [confirmar, setConfirmar] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const cargar = useCallback(async () => { setGrupos(await listGrupos()); }, []);
  useEffect(() => {
    let c = false; setLoading(true);
    cargar().catch((e) => { if (!c) toast(e instanceof Error ? e.message : 'Error al cargar', 'error'); }).finally(() => { if (!c) setLoading(false); });
    return () => { c = true; };
  }, [cargar]);
  useRealtime(['recepcion_grupos'], cargar);

  if (sel) return <RecepcionDetalle grupo={sel} onBack={() => { setSel(null); void cargar(); }} />;

  async function crear() {
    if (!nombreNuevo.trim()) { toast('Indicá el nombre', 'error'); return; }
    try { await crearGrupo(nombreNuevo, actor, miNombre); setNuevoOpen(false); setNombreNuevo(''); await cargar(); toast('Recepción creada', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo crear', 'error'); }
  }
  function borrar(g: RecepcionGrupo) {
    setConfirmar({ message: `¿Borrar la tarjeta "${g.nombre}" y TODOS sus datos?`, onConfirm: async () => {
      setConfirmar(null);
      try { await eliminarGrupo(g.id); await cargar(); toast('Recepción borrada', 'success'); }
      catch (e) { toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error'); }
    } });
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>📥 Recepciones</h1>
          <p className="muted" style={{ margin: 0 }}>
            Cada centro tiene su <strong>tarjeta</strong> (se crea sola al cerrar su caja). Entrá a una para cargar sus análisis,
            humedad, pesos, conciliación y totales.
          </p>
        </div>
        {canWrite && <button className="btn btn-primary" onClick={() => setNuevoOpen(true)}>+ Añadir recepción</button>}
      </div>

      {loading ? <p className="muted">Cargando…</p> : !grupos.length ? (
        <EmptyState message="Sin recepciones todavía. Se crean al cerrar una caja del acopio (o agregá una manual)." icon="📥" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
          {grupos.map((g) => (
            <div key={g.id} className="card" style={{ margin: 0, cursor: 'pointer', position: 'relative' }} onClick={() => setSel(g)} title="Abrir recepción">
              <div style={{ fontSize: '2rem', lineHeight: 1 }}>📥</div>
              <strong style={{ display: 'block', marginTop: '.4rem' }}>{g.nombre}</strong>
              {g.es_general && <span className="badge" style={{ marginTop: '.35rem', display: 'inline-block' }}>General</span>}
              <div className="muted" style={{ fontSize: '.76rem', marginTop: '.35rem' }}>Abrir →</div>
              {canWrite && !g.es_general && (
                <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); borrar(g); }} title="Borrar" style={{ position: 'absolute', top: 6, right: 6 }}>🗑</button>
              )}
            </div>
          ))}
        </div>
      )}

      {nuevoOpen && (
        <Modal title="+ Nueva recepción" size="sm" onClose={() => setNuevoOpen(false)} footer={
          <>
            <button className="btn btn-ghost" onClick={() => setNuevoOpen(false)}>Cancelar</button>
            <button className="btn btn-primary" onClick={() => void crear()}>Crear</button>
          </>
        }>
          <div className="form-row">
            <label>Nombre</label>
            <input className="input" autoFocus value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void crear(); }} placeholder="RECEPCIÓN LA ESPERANZA" />
          </div>
          <small className="muted">Sus datos van manuales (sin vínculo a un cierre de caja).</small>
        </Modal>
      )}
      {confirmar && (
        <ConfirmDialog title="Confirmar" message={confirmar.message} confirmText="Borrar" danger
          onConfirm={confirmar.onConfirm} onCancel={() => setConfirmar(null)} />
      )}
    </div>
  );
}

function RecepcionDetalle({ grupo, onBack }: { grupo: RecepcionGrupo; onBack: () => void }) {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('recepciones', 'escritura');
  const actor = user?.email ?? 'sistema';
  const miNombre = appUser?.nombre?.trim() || user?.email || '';
  const grupoId = grupo.id;

  const [recepciones, setRecepciones] = useState<Recepcion[]>([]);
  const [minerales, setMinerales] = useState<RecepcionMineral[]>([]);
  const [analisis, setAnalisis] = useState<RecepcionAnalisis[]>([]);
  const [humProv, setHumProv] = useState<HumedadProv[]>([]);
  const [humFinal, setHumFinal] = useState<HumedadFinal[]>([]);
  const [pesajes, setPesajes] = useState<RecepcionPesaje[]>([]);
  const [pesajeModal, setPesajeModal] = useState<RecepcionPesaje | 'nuevo' | null>(null);
  const [conciliaciones, setConciliaciones] = useState<RecepcionConciliacion[]>([]);
  const [conciliacionOpen, setConciliacionOpen] = useState(false);
  const [totales, setTotales] = useState<RecepcionTotales[]>([]);
  const [totalesOpen, setTotalesOpen] = useState(false);
  const [cerrarOpen, setCerrarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recEdit, setRecEdit] = useState<Recepcion | null>(null);
  const [recNueva, setRecNueva] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [confirmar, setConfirmar] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const reload = useCallback(async () => {
    const [rs, ms, as, hp, hf, ps, cc, tt] = await Promise.all([listRecepciones(grupoId), listMinerales(true), listAnalisis(grupoId), listHumedadProv(grupoId), listHumedadFinal(grupoId), listPesajes(grupoId), listConciliaciones(grupoId), listTotales(grupoId)]);
    setRecepciones(rs); setMinerales(ms); setAnalisis(as); setHumProv(hp); setHumFinal(hf); setPesajes(ps); setConciliaciones(cc); setTotales(tt);
  }, [grupoId]);
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    reload().catch((e) => { if (!cancel) toast(e instanceof Error ? e.message : 'Error al cargar', 'error'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reload]);
  useRealtime(['recepciones', 'recepcion_analisis', 'recepcion_minerales', 'recepcion_humedad_prov', 'recepcion_humedad_final', 'recepcion_pesajes', 'recepcion_conciliaciones', 'recepcion_totales'], reload);

  // Partir los minerales en dos grupos (mitad arriba, mitad abajo) para evitar el scroll horizontal.
  const mitad = Math.ceil(minerales.length / 2);
  const grupos = minerales.length > mitad ? [minerales.slice(0, mitad), minerales.slice(mitad)] : [minerales];

  function borrarRecepcion(r: Recepcion) {
    setConfirmar({
      message: `¿Borrar la recepción #${r.item} (${num(r.peso_kg)} Kg · ${r.procedencia})?`,
      onConfirm: async () => {
        setConfirmar(null);
        try { await eliminarRecepcion(r.id); await reload(); toast('Recepción borrada', 'success'); }
        catch (e) { toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error'); }
      },
    });
  }
  async function nuevoAnalisis() {
    try { await crearAnalisis(grupoId, {}, actor, miNombre); await reload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo crear el análisis', 'error'); }
  }
  function borrarAnalisis(a: RecepcionAnalisis) {
    setConfirmar({
      message: `¿Borrar el análisis N° ${a.n_analisis}?`,
      onConfirm: async () => {
        setConfirmar(null);
        try { await eliminarAnalisis(a.id); await reload(); toast('Análisis borrado', 'success'); }
        catch (e) { toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error'); }
      },
    });
  }
  async function agregarHumProv() {
    try { await crearHumedadProv(grupoId, actor, miNombre); await reload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo agregar', 'error'); }
  }
  async function agregarHumFinal() {
    try { await crearHumedadFinal(grupoId, actor, miNombre); await reload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo agregar', 'error'); }
  }
  function borrarHumProv(h: HumedadProv) {
    setConfirmar({ message: '¿Borrar esta fila de Humedad Provisional?', onConfirm: async () => {
      setConfirmar(null);
      try { await eliminarHumedadProv(h.id); await reload(); } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error'); }
    } });
  }
  function borrarHumFinal(h: HumedadFinal) {
    setConfirmar({ message: '¿Borrar esta fila de Humedad Final?', onConfirm: async () => {
      setConfirmar(null);
      try { await eliminarHumedadFinal(h.id); await reload(); } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error'); }
    } });
  }
  function borrarPesaje(p: RecepcionPesaje) {
    setConfirmar({ message: `¿Borrar el pesaje #${p.item} (${p.bigbags.length} bigbag/s)?`, onConfirm: async () => {
      setConfirmar(null);
      try { await eliminarPesaje(p.id); await reload(); toast('Pesaje borrado', 'success'); }
      catch (e) { toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error'); }
    } });
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="btn btn-sm btn-ghost" onClick={onBack} style={{ marginBottom: '.4rem' }}>← Volver a recepciones</button>
          <h1 style={{ margin: 0 }}>📥 {grupo.nombre}</h1>
          <p className="muted" style={{ margin: 0 }}>
            Paso intermedio del acopio: al cerrar la caja de un centro, su <strong>saldo de Kg de casiterita</strong> entra acá como recepción
            (no al inventario todavía). El laboratorio carga sus análisis por mineral.
          </p>
        </div>
      </div>

      {/* ───────────── Barra de acciones (CONCILIACIÓN · TOTALES · RESÚMENES · CERRAR) ───────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginBottom: '1.25rem' }}>
        <button className="btn btn-primary" onClick={() => setConciliacionOpen(true)}>⚖ Conciliación</button>
        <button className="btn btn-primary" onClick={() => setTotalesOpen(true)}>Σ Totales</button>
        <button className="btn btn-primary" onClick={() => toast('Resúmenes: próximamente', 'info')}>📊 Resúmenes</button>
        {canWrite && <button className="btn btn-warning" onClick={() => setCerrarOpen(true)} style={{ marginLeft: 'auto' }}>🔒 Cerrar recepción</button>}
      </div>

      {/* ───────────── Tabla de Recepciones ───────────── */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>📦 Recepciones</span>
          {canWrite && <button className="btn btn-sm btn-primary" onClick={() => setRecNueva(true)}>+ Nueva recepción</button>}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ width: 70 }}>Item</th><th>Fecha y hora</th><th style={{ textAlign: 'right' }}>Peso (Kg)</th><th>Procedencia</th><th>Centro de Acopio</th>{canWrite && <th></th>}</tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="muted">Cargando…</td></tr>
              ) : !recepciones.length ? (
                <tr><td colSpan={6}><EmptyState message="Sin recepciones. Se crean al cerrar una caja del acopio (o agregá una manual)." icon="📥" /></td></tr>
              ) : recepciones.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.item}</td>
                  <td className="muted" style={{ fontSize: '.85rem' }}>{dateTime(r.fecha)}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(r.peso_kg)}</td>
                  <td><strong>{r.procedencia}</strong></td>
                  <td>{r.centro_nombre ? `Centro de Acopio ${r.centro_nombre}` : '—'}</td>
                  {canWrite && (
                    <td className="actions" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => setRecEdit(r)} title="Editar">✎</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => void borrarRecepcion(r)} title="Borrar">🗑</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {recepciones.length > 0 && (
              <tfoot>
                <tr><td colSpan={2} style={{ fontWeight: 700 }}>Total recibido</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(recepciones.reduce((a, r) => a + Number(r.peso_kg), 0))} Kg</td>
                  <td colSpan={canWrite ? 3 : 2}></td></tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ───────────── Título de la grilla de laboratorio ───────────── */}
      <div className="card" style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.05rem', letterSpacing: '.04em', background: 'rgba(255,138,0,.10)', color: 'var(--primary, #ff8a00)', borderBottom: '2px solid rgba(255,138,0,.45)', marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
        RECEPCIÓN GLOBAL LABORATORIO
      </div>

      {/* ───────────── Grilla de Laboratorio (análisis × minerales) ───────────── */}
      <div className="card" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', marginBottom: '.6rem' }}>
          <span className="muted" style={{ fontSize: '.78rem' }}>Todos los valores están en <strong>porcentaje (%)</strong>. Prom. = (A + B + C) ÷ 3. Promedio del lote = Σ Prom. ÷ N° de análisis.</span>
          <span style={{ display: 'flex', gap: '.5rem' }}>
            {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setConfigOpen(true)}>⚙ Configurar minerales</button>}
            {canWrite && <button className="btn btn-sm btn-primary" onClick={() => void nuevoAnalisis()}>+ Nuevo análisis</button>}
          </span>
        </div>
        <div style={{ display: 'grid', gap: '1rem' }}>
          {grupos.map((grupo, i) => (
            <LabTable key={i} minerales={grupo} analisis={analisis} canWrite={canWrite}
              showActions={i === grupos.length - 1} onBorrar={borrarAnalisis} onReload={reload} />
          ))}
        </div>
      </div>

      {/* ───────────── Humedad (Provisional + Final, lado a lado) ───────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1rem', marginTop: '1.25rem' }}>
        <HumedadProvCard filas={humProv} canWrite={canWrite} onAgregar={agregarHumProv} onBorrar={borrarHumProv} onReload={reload} />
        <HumedadFinalCard filas={humFinal} canWrite={canWrite} onAgregar={agregarHumFinal} onBorrar={borrarHumFinal} onReload={reload} />
      </div>

      {/* ───────────── Pesos (Bigbags) · histórico ───────────── */}
      <div className="card" style={{ marginTop: '1.25rem' }}>
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚖ Pesos (Bigbags)</span>
          {canWrite && <button className="btn btn-sm btn-primary" onClick={() => setPesajeModal('nuevo')}>+ Añadir pesos</button>}
        </div>
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead><tr><th>Pesos guardados</th><th style={{ textAlign: 'right' }}>Bigbags</th><th style={{ textAlign: 'right' }}>Total neto húmedo</th><th style={{ textAlign: 'right' }}>Total neto seco</th>{canWrite && <th></th>}</tr></thead>
            <tbody>
              {!pesajes.length ? (
                <tr><td colSpan={canWrite ? 5 : 4}><EmptyState message="Sin pesos guardados. Usá «+ Añadir pesos»." icon="⚖" /></td></tr>
              ) : pesajes.map((p) => (
                <tr key={p.id} style={{ cursor: canWrite ? 'pointer' : undefined }} onClick={canWrite ? () => setPesajeModal(p) : undefined} title={canWrite ? 'Ver / editar el detalle de ese día' : undefined}>
                  <td><strong>📅 PESOS GUARDADOS DÍA {diaVE(p.fecha)}</strong> <span className="muted" style={{ fontSize: '.8rem' }}>· {dateTime(p.fecha)}</span></td>
                  <td className="mono" style={{ textAlign: 'right' }}>{p.bigbags.length}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(p.total_neto_humedo ?? totalNetoLado(p.bigbags, 'h'))}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(p.total_neto_seco ?? totalNetoLado(p.bigbags, 's'))}</td>
                  {canWrite && (
                    <td className="actions" style={{ whiteSpace: 'nowrap', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-sm btn-ghost" onClick={() => setPesajeModal(p)} title="Ver / editar">✎</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => void borrarPesaje(p)} title="Borrar">🗑</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {pesajeModal && (
        <PesajeModal grupoId={grupoId} pesaje={pesajeModal === 'nuevo' ? null : pesajeModal} actor={actor} miNombre={miNombre}
          onClose={() => setPesajeModal(null)} onSaved={async () => { setPesajeModal(null); await reload(); }} />
      )}
      {conciliacionOpen && (
        <ConciliacionModal grupoId={grupoId} conciliaciones={conciliaciones} recepciones={recepciones} canWrite={canWrite} actor={actor} miNombre={miNombre}
          onReload={reload} onClose={() => setConciliacionOpen(false)} confirmar={setConfirmar} />
      )}
      {totalesOpen && (
        <TotalesModal grupoId={grupoId} totales={totales} recepciones={recepciones} canWrite={canWrite} actor={actor} miNombre={miNombre}
          onReload={reload} onClose={() => setTotalesOpen(false)} confirmar={setConfirmar} />
      )}
      {cerrarOpen && (
        <CerrarRecepcionModal grupo={grupo} actor={actor} miNombre={miNombre} confirmar={setConfirmar}
          datos={{ recepciones, minerales, analisis, humProv, humFinal, pesajes, conciliaciones, totales }}
          onClose={() => setCerrarOpen(false)} />
      )}

      {recNueva && (
        <RecepcionFormModal grupoId={grupoId} actor={actor} miNombre={miNombre} onClose={() => setRecNueva(false)} onSaved={async () => { setRecNueva(false); await reload(); }} />
      )}
      {recEdit && (
        <RecepcionFormModal grupoId={grupoId} recepcion={recEdit} actor={actor} miNombre={miNombre} onClose={() => setRecEdit(null)} onSaved={async () => { setRecEdit(null); await reload(); }} />
      )}
      {configOpen && (
        <ConfigMineralesModal onClose={() => setConfigOpen(false)} onChanged={reload} />
      )}
      {confirmar && (
        <ConfirmDialog title="Confirmar" message={confirmar.message} confirmText="Borrar" danger
          onConfirm={confirmar.onConfirm} onCancel={() => setConfirmar(null)} />
      )}
    </div>
  );
}

/* ───────────── Fila de análisis (edición inline, guarda al salir del campo) ───────────── */
function AnalisisRow({ analisis, minerales, canWrite, showActions, onBorrar, onReload }: {
  analisis: RecepcionAnalisis; minerales: RecepcionMineral[]; canWrite: boolean; showActions: boolean; onBorrar: () => void; onReload: () => Promise<void>;
}) {
  // Borrador local por campo: `${clave}:${campo}` → string.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const valor = (clave: string): ValorMineral => analisis.valores?.[clave] ?? {};
  const cellVal = (clave: string, campo: 'a' | 'b' | 'c' | 'prom'): string => {
    const k = `${clave}:${campo}`;
    if (k in draft) return draft[k];
    const v = valor(clave)[campo];
    return v == null ? '' : String(v);
  };

  async function guardarCampo(clave: string, campo: 'a' | 'b' | 'c' | 'prom') {
    const k = `${clave}:${campo}`;
    if (!(k in draft)) return;
    const nuevoVal = parseNum(draft[k]);
    const valores: Record<string, ValorMineral> = { ...(analisis.valores ?? {}) };
    valores[clave] = { ...(valores[clave] ?? {}), [campo]: nuevoVal };
    try { await actualizarAnalisis(analisis.id, { valores }); setDraft((d) => { const n = { ...d }; delete n[k]; return n; }); await onReload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
  }

  const cell = (clave: string, campo: 'a' | 'b' | 'c', primero: boolean) => (
    <td key={`${clave}-${campo}`} style={{ padding: 2, borderLeft: primero ? '2px solid var(--border-strong, #888)' : undefined }}>
      {canWrite ? (
        <input className="input mono" style={{ width: 64, textAlign: 'center', padding: '.2rem .25rem' }}
          value={cellVal(clave, campo)} inputMode="decimal"
          onChange={(e) => setDraft((d) => ({ ...d, [`${clave}:${campo}`]: e.target.value }))}
          onBlur={() => void guardarCampo(clave, campo)} />
      ) : <span className="mono">{cellVal(clave, campo) || '—'}</span>}
    </td>
  );

  return (
    <tr>
      <td className="mono" style={{ fontWeight: 700 }}>{analisis.n_analisis}</td>
      {minerales.flatMap((m) => {
        if (m.modo === 'abc') {
          const prom = promMineral('abc', {
            a: parseNum(cellVal(m.clave, 'a')), b: parseNum(cellVal(m.clave, 'b')), c: parseNum(cellVal(m.clave, 'c')),
          });
          return [
            cell(m.clave, 'a', true),
            cell(m.clave, 'b', false),
            cell(m.clave, 'c', false),
            <td key={`${m.clave}-prom`} className="mono" style={{ textAlign: 'center', fontWeight: 700, background: m.color ? `${m.color}33` : undefined }}>{prom != null ? `${num(prom)}%` : '—'}</td>,
          ];
        }
        // modo prom: una sola celda editable
        return [(
          <td key={`${m.clave}-prom`} style={{ padding: 2, borderLeft: '2px solid var(--border-strong, #888)' }}>
            {canWrite ? (
              <input className="input mono" style={{ width: 64, textAlign: 'center', padding: '.2rem .25rem' }}
                value={cellVal(m.clave, 'prom')} inputMode="decimal"
                onChange={(e) => setDraft((d) => ({ ...d, [`${m.clave}:prom`]: e.target.value }))}
                onBlur={() => void guardarCampo(m.clave, 'prom')} />
            ) : <span className="mono">{cellVal(m.clave, 'prom') || '—'}</span>}
          </td>
        )];
      })}
      {canWrite && showActions && <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-ghost" onClick={onBorrar} title="Borrar análisis">🗑</button></td>}
    </tr>
  );
}

/* ───────────── Celda numérica editable (guarda al salir del campo) ───────────── */
function NumCell({ value, suffix, canWrite, onSave }: {
  value: number | null; suffix?: string; canWrite: boolean; onSave: (n: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft != null ? draft : (value == null ? '' : String(value));
  return (
    <td style={{ padding: 2, textAlign: 'center' }}>
      {canWrite ? (
        <input className="input mono" style={{ width: 96, textAlign: 'right', padding: '.2rem .3rem' }} inputMode="decimal"
          value={shown} onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (draft != null) { onSave(parseNum(draft)); setDraft(null); } }} />
      ) : <span className="mono">{value != null ? `${num(value)}${suffix ?? ''}` : '—'}</span>}
    </td>
  );
}

/* ───────────── Humedad Provisional ─────────────
   % Humedad   = 100 − (Peso seco ÷ Peso Húmedos) × 4   (calculada, no se escribe)
   Merma peso H2O = Peso (Gr) Húmedos × % Humedad ÷ 100 (calculada, no se escribe). */
const pctHumProv = (humedo: number | null, seco: number | null): number | null => {
  const h = Number(humedo) || 0;
  if (h === 0) return null;
  return 100 - (Number(seco) || 0) / h * 4;
};
const mermaProv = (humedo: number | null, seco: number | null) => {
  const pct = pctHumProv(humedo, seco);
  return pct == null ? 0 : (Number(humedo) || 0) * pct / 100;
};
function HumedadProvCard({ filas, canWrite, onAgregar, onBorrar, onReload }: {
  filas: HumedadProv[]; canWrite: boolean; onAgregar: () => void; onBorrar: (h: HumedadProv) => void; onReload: () => Promise<void>;
}) {
  const promPct = promedioCol(filas.map((f) => pctHumProv(f.peso_humedo, f.peso_seco)));
  const sumMerma = filas.reduce((a, f) => a + mermaProv(f.peso_humedo, f.peso_seco), 0);
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ background: '#9db8e0', color: '#13294b', fontWeight: 800, textAlign: 'center', padding: '.6rem', fontSize: '1rem', letterSpacing: '.02em' }}>Humedad Provisional</div>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.82rem', margin: 0 }}>
          <thead>
            <tr>
              <th>Peso (Gr) Húmedos</th><th>Peso (Gr) seco</th>
              <th style={{ textAlign: 'center' }}>% Humedad</th><th style={{ textAlign: 'center' }}>Merma peso H2O</th>
              {canWrite && <th></th>}
            </tr>
          </thead>
          <tbody>
            {!filas.length ? (
              <tr><td colSpan={canWrite ? 5 : 4} className="muted" style={{ textAlign: 'center' }}>Sin filas. Agregá con “+ Agregar Humedad Provisional”.</td></tr>
            ) : filas.map((f) => <HumedadProvRow key={f.id} fila={f} canWrite={canWrite} onBorrar={() => onBorrar(f)} onReload={onReload} />)}
          </tbody>
          {filas.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={2} style={{ fontWeight: 800 }}>Promedio del lote</td>
                <td className="mono" style={{ textAlign: 'center', fontWeight: 800 }}>{promPct != null ? `${num(promPct)}%` : '0,00%'}</td>
                <td className="mono" style={{ textAlign: 'center', fontWeight: 800 }}>{num(sumMerma)}</td>
                {canWrite && <td></td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {canWrite && <div style={{ padding: '.6rem', textAlign: 'right' }}><button className="btn btn-sm btn-primary" onClick={onAgregar}>+ Agregar Humedad Provisional</button></div>}
    </div>
  );
}
function HumedadProvRow({ fila, canWrite, onBorrar, onReload }: {
  fila: HumedadProv; canWrite: boolean; onBorrar: () => void; onReload: () => Promise<void>;
}) {
  const save = async (patch: Partial<Pick<HumedadProv, 'peso_humedo' | 'peso_seco'>>) => {
    try { await actualizarHumedadProv(fila.id, patch); await onReload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
  };
  const pct = pctHumProv(fila.peso_humedo, fila.peso_seco);
  return (
    <tr>
      <NumCell value={fila.peso_humedo} canWrite={canWrite} onSave={(n) => void save({ peso_humedo: n })} />
      <NumCell value={fila.peso_seco} canWrite={canWrite} onSave={(n) => void save({ peso_seco: n })} />
      <td className="mono" style={{ textAlign: 'center' }} title="100 − (Peso seco ÷ Peso Húmedos) × 4">{pct != null ? `${num(pct)}%` : '—'}</td>
      <td className="mono" style={{ textAlign: 'center' }} title="Peso Húmedos × % Humedad">{num(mermaProv(fila.peso_humedo, fila.peso_seco))}</td>
      {canWrite && <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-ghost" onClick={onBorrar} title="Borrar fila">🗑</button></td>}
    </tr>
  );
}

/* ───────────── Humedad Final ─────────────
   Merma peso H2O   = Peso (Kg) − Peso (Kg) recogido          (calculada, no se escribe)
   % Humedad final  = Merma peso H2O ÷ Peso (Kg) × 100        (calculada, no se escribe). */
const mermaFinal = (pesoKg: number | null, recogido: number | null) => (Number(pesoKg) || 0) - (Number(recogido) || 0);
const pctHumFinal = (pesoKg: number | null, recogido: number | null): number | null => {
  const h = Number(pesoKg) || 0;
  if (h === 0) return null;
  return mermaFinal(pesoKg, recogido) / h * 100;
};
function HumedadFinalCard({ filas, canWrite, onAgregar, onBorrar, onReload }: {
  filas: HumedadFinal[]; canWrite: boolean; onAgregar: () => void; onBorrar: (h: HumedadFinal) => void; onReload: () => Promise<void>;
}) {
  const sumPesoKg = sumaCol(filas.map((f) => f.peso_kg));
  const sumRecogido = sumaCol(filas.map((f) => f.peso_recogido));
  const sumMerma = filas.reduce((a, f) => a + mermaFinal(f.peso_kg, f.peso_recogido), 0);
  const promPct = promedioCol(filas.map((f) => pctHumFinal(f.peso_kg, f.peso_recogido)));
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ background: '#cdddf3', color: '#13294b', fontWeight: 800, textAlign: 'center', padding: '.6rem', fontSize: '1rem', letterSpacing: '.02em' }}>Humedad Final</div>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.82rem', margin: 0 }}>
          <thead>
            <tr>
              <th>Peso (Kg)</th><th>Peso (Kg) recogido</th>
              <th style={{ textAlign: 'center' }}>Merma peso H2O</th><th style={{ textAlign: 'center' }}>% Humedad final</th>
              {canWrite && <th></th>}
            </tr>
          </thead>
          <tbody>
            {!filas.length ? (
              <tr><td colSpan={canWrite ? 5 : 4} className="muted" style={{ textAlign: 'center' }}>Sin filas. Agregá con “+ Agregar Humedad Final”.</td></tr>
            ) : filas.map((f) => <HumedadFinalRow key={f.id} fila={f} canWrite={canWrite} onBorrar={() => onBorrar(f)} onReload={onReload} />)}
          </tbody>
          {filas.length > 0 && (
            <tfoot>
              <tr>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{num(sumPesoKg)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{num(sumRecogido)}</td>
                <td className="mono" style={{ textAlign: 'center', fontWeight: 800 }}>{num(sumMerma)}</td>
                <td className="mono" style={{ textAlign: 'center', fontWeight: 800 }}>{promPct != null ? `${num(promPct)}%` : '0,00%'}</td>
                {canWrite && <td></td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {canWrite && <div style={{ padding: '.6rem', textAlign: 'right' }}><button className="btn btn-sm btn-primary" onClick={onAgregar}>+ Agregar Humedad Final</button></div>}
    </div>
  );
}
function HumedadFinalRow({ fila, canWrite, onBorrar, onReload }: {
  fila: HumedadFinal; canWrite: boolean; onBorrar: () => void; onReload: () => Promise<void>;
}) {
  const save = async (patch: Partial<Pick<HumedadFinal, 'peso_kg' | 'peso_recogido'>>) => {
    try { await actualizarHumedadFinal(fila.id, patch); await onReload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
  };
  const pct = pctHumFinal(fila.peso_kg, fila.peso_recogido);
  return (
    <tr>
      <NumCell value={fila.peso_kg} canWrite={canWrite} onSave={(n) => void save({ peso_kg: n })} />
      <NumCell value={fila.peso_recogido} canWrite={canWrite} onSave={(n) => void save({ peso_recogido: n })} />
      <td className="mono" style={{ textAlign: 'center' }} title="Peso (Kg) − Peso (Kg) recogido">{num(mermaFinal(fila.peso_kg, fila.peso_recogido))}</td>
      <td className="mono" style={{ textAlign: 'center' }} title="Merma ÷ Peso (Kg) × 100">{pct != null ? `${num(pct)}%` : '—'}</td>
      {canWrite && <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-ghost" onClick={onBorrar} title="Borrar fila">🗑</button></td>}
    </tr>
  );
}

/* ───────────── Pesos (Pesaje): modal con dos tablas (húmedos / secos) ───────────── */
type RowDraft = { proc_h: string; peso_h: string; proc_s: string; peso_s: string; categoria: PesoModo };
/** Categorías por fila: en una misma corrida pueden convivir las 3. */
const PESO_MODES: Record<PesoModo, { label: string; factor: number }> = {
  bigbag: { label: 'BIG BAG', factor: 1.5 },
  saco:   { label: 'SACO',    factor: 0.06 },
  hielo:  { label: 'BOLSA DE HIELO', factor: 0.05 },
};
const PESO_MODOS_ORDEN: PesoModo[] = ['bigbag', 'saco', 'hielo'];

function PesajeModal({ grupoId, pesaje, actor, miNombre, onClose, onSaved }: {
  grupoId: string; pesaje: RecepcionPesaje | null; actor: string; miNombre: string; onClose: () => void; onSaved: () => void;
}) {
  const [rows, setRows] = useState<RowDraft[]>(() => (pesaje?.bigbags ?? []).map((b) => ({
    proc_h: b.proc_h ?? '', peso_h: b.peso_h == null ? '' : String(b.peso_h),
    proc_s: b.proc_s ?? '', peso_s: b.peso_s == null ? '' : String(b.peso_s),
    categoria: (b.categoria ?? 'bigbag') as PesoModo,
  })));
  const [nota, setNota] = useState(pesaje?.nota ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bigbags: PesajeBigbag[] = rows.map((r) => ({
    proc_h: r.proc_h.trim() || null, peso_h: parseNum(r.peso_h),
    proc_s: r.proc_s.trim() || null, peso_s: parseNum(r.peso_s),
    categoria: r.categoria,
  }));

  const addBigbag = () => setRows((rs) => [...rs, { proc_h: '', peso_h: '', proc_s: '', peso_s: '', categoria: 'bigbag' }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const setCell = (i: number, key: 'proc_h' | 'peso_h' | 'proc_s' | 'peso_s', val: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: val } : r)));
  const setCat = (i: number, cat: PesoModo) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, categoria: cat } : r)));

  async function guardar() {
    setError(null); setSaving(true);
    try {
      const dia = diaVE(pesaje?.fecha ?? new Date().toISOString());
      if (pesaje) await actualizarPesaje(pesaje.id, { bigbags, nota });
      else await crearPesaje({ grupo_id: grupoId, bigbags, nota }, actor, miNombre);
      toast(`PESOS GUARDADOS DÍA ${dia}`, 'success');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); setSaving(false); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cerrar</button>
      <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving}>{saving ? 'Guardando…' : 'GUARDAR PESOS'}</button>
    </>
  );

  return (
    <Modal title={pesaje ? `⚖ PESOS GUARDADOS DÍA ${diaVE(pesaje.fecha)}` : '⚖ Añadir pesos — Pesaje'} size="xl" onClose={onClose} footer={footer}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '.6rem', marginBottom: '.6rem' }}>
        <span className="muted" style={{ fontSize: '.8rem' }}>Cada fila lleva su <strong>categoría</strong> (BIG BAG ×1,5 · SACO ×0,06 · BOLSA DE HIELO ×0,05). DESCUENTO = −Σ del factor de cada fila con peso · TOTAL NETO = suma de pesos + DESCUENTO.</span>
        <button className="btn btn-sm btn-primary" onClick={addBigbag}>+ Añadir peso</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1rem' }}>
        <PesajeTabla titulo="PESOS HÚMEDOS" bg="#9db8e0" rows={rows} lado="h"
          bigBag={bigBagLado(bigbags, 'h')} totalNeto={totalNetoLado(bigbags, 'h')} onCell={setCell} onCat={setCat} onRemove={removeRow} />
        <PesajeTabla titulo="PESOS SECOS" bg="#cdddf3" rows={rows} lado="s"
          bigBag={bigBagLado(bigbags, 's')} totalNeto={totalNetoLado(bigbags, 's')} onCell={setCell} onCat={setCat} onRemove={removeRow} />
      </div>
      <div className="form-row" style={{ marginTop: '.85rem' }}>
        <label>Nota <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
        <textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Observaciones del pesaje…" />
      </div>
    </Modal>
  );
}

function PesajeTabla({ titulo, bg, rows, lado, bigBag, totalNeto, onCell, onCat, onRemove }: {
  titulo: string; bg: string; rows: RowDraft[]; lado: 'h' | 's';
  bigBag: number; totalNeto: number;
  onCell: (i: number, key: 'proc_h' | 'peso_h' | 'proc_s' | 'peso_s', val: string) => void;
  onCat: (i: number, cat: PesoModo) => void; onRemove: (i: number) => void;
}) {
  const procKey = lado === 'h' ? 'proc_h' as const : 'proc_s' as const;
  const pesoKey = lado === 'h' ? 'peso_h' as const : 'peso_s' as const;
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ background: bg, color: '#13294b', fontWeight: 800, textAlign: 'center', padding: '.55rem', letterSpacing: '.04em' }}>{titulo}</div>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.82rem', margin: 0 }}>
          <thead><tr><th>PROCEDENCIA</th><th style={{ textAlign: 'right' }}>PESO</th><th style={{ textAlign: 'center' }}>CATEGORÍA</th><th></th></tr></thead>
          <tbody>
            {!rows.length ? (
              <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>Sin pesos. Usá «+ Añadir peso».</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i}>
                <td style={{ padding: 2 }}><input className="input" style={{ padding: '.2rem .35rem', textTransform: 'uppercase' }} value={r[procKey]} onChange={(e) => onCell(i, procKey, e.target.value)} placeholder="A / B / Ali" /></td>
                <td style={{ padding: 2 }}><input className="input mono" style={{ width: 96, textAlign: 'right', padding: '.2rem .3rem' }} inputMode="decimal" value={r[pesoKey]} onChange={(e) => onCell(i, pesoKey, e.target.value)} placeholder="0,00" /></td>
                <td style={{ padding: 2 }}>
                  <select className="select" style={{ padding: '.2rem .3rem', fontSize: '.78rem' }} value={r.categoria} onChange={(e) => onCat(i, e.target.value as PesoModo)}>
                    {PESO_MODOS_ORDEN.map((m) => <option key={m} value={m}>{PESO_MODES[m].label}</option>)}
                  </select>
                </td>
                <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-ghost" onClick={() => onRemove(i)} title="Quitar peso">✕</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td></td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: 'var(--danger, #e5484d)' }}>{num(bigBag)}</td>
              <td style={{ fontWeight: 800, color: 'var(--danger, #e5484d)' }}>DESCUENTO</td>
              <td></td>
            </tr>
            <tr>
              <td></td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{num(totalNeto)}</td>
              <td style={{ fontWeight: 800 }}>TOTAL NETO</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ───────────── Conciliación de Centros de Acopio (todo dentro del modal) ───────────── */
const ROJO = 'var(--danger, #e5484d)';

function ConciliacionModal({ grupoId, conciliaciones, recepciones, canWrite, actor, miNombre, onReload, onClose, confirmar }: {
  grupoId: string; conciliaciones: RecepcionConciliacion[]; recepciones: Recepcion[]; canWrite: boolean; actor: string; miNombre: string;
  onReload: () => Promise<void>; onClose: () => void;
  confirmar: (c: { message: string; onConfirm: () => void } | null) => void;
}) {
  const [editor, setEditor] = useState<RecepcionConciliacion | 'nueva' | null>(null);
  const nextNum = conciliaciones.reduce((m, c) => Math.max(m, c.numero), 0) + 1;

  if (editor) {
    return (
      <ConciliacionEditorModal grupoId={grupoId} conciliacion={editor === 'nueva' ? null : editor} recepciones={recepciones}
        defaultNumero={nextNum} actor={actor} miNombre={miNombre} canWrite={canWrite}
        onCancel={() => setEditor(null)} onSaved={async () => { setEditor(null); await onReload(); }} />
    );
  }

  function borrar(c: RecepcionConciliacion) {
    confirmar({ message: `¿Borrar la conciliación N° ${c.numero}?`, onConfirm: async () => {
      confirmar(null);
      try { await eliminarConciliacion(c.id); await onReload(); toast('Conciliación borrada', 'success'); }
      catch (e) { toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error'); }
    } });
  }

  return (
    <Modal title="⚖ Conciliación de Centros de Acopio" size="xl" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        {canWrite && <button className="btn btn-primary" onClick={() => setEditor('nueva')}>+ Nueva conciliación</button>}
      </>
    }>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th style={{ width: 110 }}>N° Recepción</th><th>Fecha</th><th style={{ textAlign: 'right' }}>Reportado (Kg)</th><th style={{ textAlign: 'right' }}>Kg No Llegó</th><th style={{ textAlign: 'right' }}>% no llegó</th>{canWrite && <th></th>}</tr></thead>
          <tbody>
            {!conciliaciones.length ? (
              <tr><td colSpan={canWrite ? 6 : 5}><EmptyState message="Sin conciliaciones. Usá «+ Nueva conciliación»." icon="⚖" /></td></tr>
            ) : conciliaciones.map((c) => (
              <tr key={c.id} style={{ cursor: canWrite ? 'pointer' : undefined }} onClick={canWrite ? () => setEditor(c) : undefined} title={canWrite ? 'Ver / editar' : undefined}>
                <td className="mono"><strong>N° {c.numero}</strong></td>
                <td className="muted">{dateTime(c.fecha)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(c.total_reportado ?? 0)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: ROJO }}>{num(c.kg_no_llego ?? 0)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: ROJO }}>{c.pct_no_llego != null ? `${num(c.pct_no_llego)}%` : '—'}</td>
                {canWrite && (
                  <td className="actions" style={{ whiteSpace: 'nowrap', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditor(c)} title="Ver / editar">✎</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => borrar(c)} title="Borrar">🗑</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/** Fila editable de un centro en la conciliación (con soporte de resguardo). */
type CentroRow = { nombre: string; saldo: string; categoria: '' | 'resguardo'; entra: boolean; almacen: string; movId: string | null };

/** Mini-formulario inline para crear un almacén nuevo (se sincroniza con el inventario REAL). */
function InlineAlmacen({ onCrear, onCancel }: { onCrear: (nombre: string) => void; onCancel: () => void }) {
  const [nombre, setNombre] = useState('');
  return (
    <span style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center' }}>
      <input className="input" autoFocus style={{ padding: '.2rem .3rem', fontSize: '.8rem', minWidth: 160, textTransform: 'uppercase' }}
        value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del almacén"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCrear(nombre); } if (e.key === 'Escape') onCancel(); }} />
      <button className="btn btn-sm btn-primary" onClick={() => onCrear(nombre)} disabled={!nombre.trim()}>Crear</button>
      <button className="btn btn-sm btn-ghost" onClick={onCancel}>✕</button>
    </span>
  );
}

function ConciliacionEditorModal({ grupoId, conciliacion, recepciones, defaultNumero, actor, miNombre, canWrite, onCancel, onSaved }: {
  grupoId: string; conciliacion: RecepcionConciliacion | null; recepciones: Recepcion[]; defaultNumero: number;
  actor: string; miNombre: string; canWrite: boolean; onCancel: () => void; onSaved: () => void;
}) {
  const [numero, setNumero] = useState(String(conciliacion?.numero ?? defaultNumero));
  const [centros, setCentros] = useState<CentroRow[]>(() =>
    conciliacion
      ? conciliacion.centros.map((c) => ({
          nombre: c.nombre ?? '', saldo: c.saldo_kg == null ? '' : String(c.saldo_kg),
          categoria: c.categoria === 'resguardo' ? 'resguardo' : '',
          entra: !!c.entra_inventario, almacen: c.almacen ?? '', movId: c.inventario_mov_id ?? null,
        }))
      : recepciones.map((r) => ({
          nombre: r.centro_nombre || r.procedencia || '', saldo: r.peso_kg == null ? '' : String(r.peso_kg),
          categoria: '' as const, entra: false, almacen: '', movId: null,
        })));
  const [pesoTotal, setPesoTotal] = useState(conciliacion?.peso_kg_total == null ? '' : String(conciliacion.peso_kg_total));
  const [bolsas, setBolsas] = useState(conciliacion?.kg_peso_bolsas == null ? '' : String(conciliacion.kg_peso_bolsas));
  const [muestras, setMuestras] = useState(conciliacion?.muestras_laboratorio == null ? '' : String(conciliacion.muestras_laboratorio));
  const [nota, setNota] = useState(conciliacion?.nota ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Almacenes para los resguardos que entran al inventario (con alta inline).
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [nuevoAlm, setNuevoAlm] = useState<number | null>(null);  // índice de fila creando almacén
  const cargarAlmacenes = useCallback(() => { listAlmacenes().then(setAlmacenes).catch(() => { /* RLS/red */ }); }, []);
  useEffect(() => { cargarAlmacenes(); }, [cargarAlmacenes]);

  const centrosParsed: CentroConcil[] = centros.map((c) => {
    const esResg = c.categoria === 'resguardo';
    return {
      nombre: c.nombre.trim() || null, saldo_kg: parseNum(c.saldo),
      categoria: esResg ? 'resguardo' : null,
      entra_inventario: esResg ? c.entra : false,
      almacen: esResg && c.entra ? (c.almacen || null) : null,
      inventario_mov_id: c.movId,
    };
  });
  const totalReportado = totalReportadoConcil(centrosParsed);
  const kgFaltante = kgFaltanteConcil(parseNum(pesoTotal), totalReportado);
  const kgNoLlego = kgNoLlegoConcil(kgFaltante, parseNum(bolsas), parseNum(muestras));
  const pctNoLlego = pctNoLlegoConcil(kgNoLlego, totalReportado);

  const addCentro = () => setCentros((cs) => [...cs, { nombre: '', saldo: '', categoria: '', entra: false, almacen: '', movId: null }]);
  const removeCentro = (i: number) => setCentros((cs) => cs.filter((_, j) => j !== i));
  const setCentroRow = (i: number, patch: Partial<CentroRow>) => setCentros((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  async function crearAlmacenInline(i: number, nombre: string) {
    const n = nombre.trim();
    if (!n) return;
    try {
      const a = await crearAlmacen({ nombre: n }, actor);
      cargarAlmacenes();
      setCentroRow(i, { almacen: a.nombre });
      setNuevoAlm(null);
      toast(`Almacén «${a.nombre}» creado`, 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo crear el almacén', 'error'); }
  }

  async function guardar() {
    setError(null);
    const numN = Math.floor(Number(numero) || 0);
    if (numN <= 0) { setError('Indicá el número de la recepción.'); return; }
    // Resguardo que entra al inventario sin almacén: no se puede ingresar.
    if (centrosParsed.some((c) => c.categoria === 'resguardo' && c.entra_inventario && !c.almacen)) {
      setError('Elegí el almacén destino de los resguardos que entran al inventario.'); return;
    }
    setSaving(true);
    try {
      const input = { grupo_id: grupoId, numero: numN, centros: centrosParsed, peso_kg_total: parseNum(pesoTotal), kg_peso_bolsas: parseNum(bolsas), muestras_laboratorio: parseNum(muestras), nota };
      if (conciliacion) await actualizarConciliacion(conciliacion.id, input, actor, miNombre);
      else await crearConciliacion(input, actor, miNombre);
      toast('Conciliación guardada', 'success');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); setSaving(false); }
  }

  // Fila del resumen (valor a la izquierda, etiqueta a la derecha; como el Excel).
  const filaResumen = (valor: ReactNode, etiqueta: string, opts?: { rojo?: boolean; bold?: boolean }) => (
    <tr>
      <td className="mono" style={{ textAlign: 'right', width: 180, fontWeight: opts?.bold || opts?.rojo ? 800 : 600, color: opts?.rojo ? ROJO : undefined }}>{valor}</td>
      <td style={{ fontWeight: opts?.bold || opts?.rojo ? 800 : 600, color: opts?.rojo ? ROJO : undefined }}>{etiqueta}</td>
    </tr>
  );

  return (
    <Modal title={conciliacion ? `⚖ Conciliación N° ${conciliacion.numero}` : '⚖ Nueva conciliación'} size="xl" onClose={onCancel} footer={
      <>
        <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>← Volver</button>
        {canWrite && <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving}>{saving ? 'Guardando…' : 'GUARDAR CONCILIACIÓN'}</button>}
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}

      <div className="form-grid" style={{ marginBottom: '.8rem' }}>
        <div className="form-row" style={{ maxWidth: 240 }}>
          <label>N° de Recepción</label>
          <input className="input mono" type="number" min={1} value={numero} onChange={(e) => setNumero(e.target.value)} disabled={!canWrite} placeholder="1" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1rem', alignItems: 'start' }}>
        {/* Centros de Acopio (saldos) */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', margin: 0 }}>
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.55rem .7rem', margin: 0 }}>
            <span>Centros de Acopio</span>
            {canWrite && <button className="btn btn-sm btn-ghost" onClick={addCentro}>+ Añadir centro</button>}
          </div>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.82rem', margin: 0 }}>
              <thead><tr><th style={{ textAlign: 'right', width: 110 }}>Saldo (Kg)</th><th>Centro de Acopio</th><th style={{ width: 120 }}>Categoría</th>{canWrite && <th></th>}</tr></thead>
              <tbody>
                {!centros.length ? (
                  <tr><td colSpan={canWrite ? 4 : 3} className="muted" style={{ textAlign: 'center' }}>Sin centros. Usá «+ Añadir centro».</td></tr>
                ) : centros.map((c, i) => {
                  const esResg = c.categoria === 'resguardo';
                  const ingresado = !!c.movId;
                  return (
                  <Fragment key={i}>
                    <tr>
                      <td style={{ padding: 2 }}><input className="input mono" style={{ width: 100, textAlign: 'right', padding: '.2rem .3rem' }} inputMode="decimal" value={c.saldo} onChange={(e) => setCentroRow(i, { saldo: e.target.value })} disabled={!canWrite} placeholder="0,00" /></td>
                      <td style={{ padding: 2 }}><input className="input" style={{ padding: '.2rem .35rem', textTransform: 'uppercase' }} value={c.nombre} onChange={(e) => setCentroRow(i, { nombre: e.target.value })} disabled={!canWrite} placeholder="P-MGG04- A LOS PIJIGUAOS" /></td>
                      <td style={{ padding: 2 }}>
                        <select className="select" style={{ padding: '.2rem .3rem', fontSize: '.8rem' }} value={c.categoria}
                          onChange={(e) => setCentroRow(i, { categoria: e.target.value as CentroRow['categoria'], ...(e.target.value !== 'resguardo' ? { entra: false } : {}) })}
                          disabled={!canWrite || ingresado}>
                          <option value="">Normal</option>
                          <option value="resguardo">RESGUARDO</option>
                        </select>
                      </td>
                      {canWrite && <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-ghost" onClick={() => removeCentro(i)} title="Quitar" disabled={ingresado}>✕</button></td>}
                    </tr>
                    {esResg && (
                      <tr>
                        <td colSpan={canWrite ? 4 : 3} style={{ background: 'var(--bg-1)', borderTop: 'none', padding: '.35rem .6rem' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem .8rem', alignItems: 'center', fontSize: '.8rem' }}>
                            <strong style={{ color: ROJO }}>🔒 Resguardo</strong>
                            <span className="muted">no suma · se RESTA del total</span>
                            {ingresado ? (
                              <span className="badge" style={{ background: 'var(--success)', color: '#fff' }}>✓ Ingresado al inventario (sin tasa)</span>
                            ) : (
                              <>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '.3rem', margin: 0 }}>
                                  <input type="checkbox" checked={c.entra} onChange={(e) => setCentroRow(i, { entra: e.target.checked })} disabled={!canWrite} />
                                  ¿Entra al inventario REAL? <span className="muted">(sin tasa)</span>
                                </label>
                                {c.entra && (nuevoAlm === i ? (
                                  <InlineAlmacen onCrear={(n) => void crearAlmacenInline(i, n)} onCancel={() => setNuevoAlm(null)} />
                                ) : (
                                  <>
                                    <AlmacenSelectAgrupado value={c.almacen} onChange={(n) => setCentroRow(i, { almacen: n })} almacenes={almacenes} style={{ minWidth: 180, padding: '.2rem .3rem', fontSize: '.8rem' }} disabled={!canWrite} />
                                    {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setNuevoAlm(i)} title="Crear almacén">+ nuevo almacén</button>}
                                  </>
                                ))}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Resumen / cálculos */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', margin: 0 }}>
          <div className="card-title" style={{ padding: '.55rem .7rem', margin: 0 }}>Resumen</div>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.85rem', margin: 0 }}>
              <tbody>
                <tr>
                  <td style={{ width: 180, padding: 2 }}><input className="input mono" style={{ width: '100%', textAlign: 'right', padding: '.2rem .3rem' }} inputMode="decimal" value={pesoTotal} onChange={(e) => setPesoTotal(e.target.value)} disabled={!canWrite} placeholder="Peso Kg Total" /></td>
                  <td style={{ fontWeight: 600 }}>Peso Kg Total <span className="muted" style={{ fontWeight: 400 }}>(lo que llegó / pesado)</span></td>
                </tr>
                {filaResumen(num(totalReportado), 'Kg Reportado por Centros de Acopio', { bold: true })}
                {filaResumen(num(kgFaltante), 'Kg Faltante', { rojo: true })}
                <tr>
                  <td style={{ width: 180, padding: 2 }}><input className="input mono" style={{ width: '100%', textAlign: 'right', padding: '.2rem .3rem' }} inputMode="decimal" value={bolsas} onChange={(e) => setBolsas(e.target.value)} disabled={!canWrite} placeholder="0,00" /></td>
                  <td style={{ fontWeight: 600 }}>Kg Peso de Bolsas</td>
                </tr>
                <tr>
                  <td style={{ width: 180, padding: 2 }}><input className="input mono" style={{ width: '100%', textAlign: 'right', padding: '.2rem .3rem' }} inputMode="decimal" value={muestras} onChange={(e) => setMuestras(e.target.value)} disabled={!canWrite} placeholder="0,00" /></td>
                  <td style={{ fontWeight: 600 }}>Muestras tomadas por Laboratorio MGG</td>
                </tr>
                {filaResumen(num(kgNoLlego), 'Kg No Llegó', { rojo: true })}
                {filaResumen(pctNoLlego != null ? `${num(pctNoLlego)}%` : '—', '% de lo que no llegó (descontando bolsas y muestras)', { rojo: true })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="form-row" style={{ marginTop: '.85rem' }}>
        <label>Nota <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
        <textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} disabled={!canWrite} placeholder="Observaciones de la conciliación…" />
      </div>
    </Modal>
  );
}

/* ───────────── Totales · PROMEDIO DE PRECIO DE COMPRA (todo dentro del modal) ───────────── */
const fmt4 = (x: number | null | undefined) => (x == null ? '—' : Number(x).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 }));

function TotalesModal({ grupoId, totales, recepciones, canWrite, actor, miNombre, onReload, onClose, confirmar }: {
  grupoId: string; totales: RecepcionTotales[]; recepciones: Recepcion[]; canWrite: boolean; actor: string; miNombre: string;
  onReload: () => Promise<void>; onClose: () => void;
  confirmar: (c: { message: string; onConfirm: () => void } | null) => void;
}) {
  const [editor, setEditor] = useState<RecepcionTotales | 'nuevo' | null>(null);
  const nextNum = totales.reduce((m, t) => Math.max(m, t.numero), 0) + 1;

  if (editor) {
    return (
      <TotalesEditorModal grupoId={grupoId} totales={editor === 'nuevo' ? null : editor} recepciones={recepciones}
        defaultNumero={nextNum} actor={actor} miNombre={miNombre} canWrite={canWrite}
        onCancel={() => setEditor(null)} onSaved={async () => { setEditor(null); await onReload(); }} />
    );
  }

  function borrar(t: RecepcionTotales) {
    confirmar({ message: `¿Borrar los totales N° ${t.numero}?`, onConfirm: async () => {
      confirmar(null);
      try { await eliminarTotales(t.id); await onReload(); toast('Totales borrados', 'success'); }
      catch (e) { toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error'); }
    } });
  }

  return (
    <Modal title="Σ Totales · Promedio de precio de compra" size="xl" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        {canWrite && <button className="btn btn-primary" onClick={() => setEditor('nuevo')}>+ Nuevos totales</button>}
      </>
    }>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th style={{ width: 110 }}>N° Recepción</th><th>Fecha</th><th style={{ textAlign: 'right' }}>Total SnO2</th><th style={{ textAlign: 'right' }}>Tasa recep.</th><th style={{ textAlign: 'right' }}>Total Moneda</th>{canWrite && <th></th>}</tr></thead>
          <tbody>
            {!totales.length ? (
              <tr><td colSpan={canWrite ? 6 : 5}><EmptyState message="Sin totales. Usá «+ Nuevos totales»." icon="Σ" /></td></tr>
            ) : totales.map((t) => (
              <tr key={t.id} style={{ cursor: canWrite ? 'pointer' : undefined }} onClick={canWrite ? () => setEditor(t) : undefined} title={canWrite ? 'Ver / editar' : undefined}>
                <td className="mono"><strong>N° {t.numero}</strong></td>
                <td className="muted">{dateTime(t.fecha)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(t.total_sno2 ?? 0)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>$ {fmt4(t.tasa_recepcionada)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(t.total_moneda ?? 0)}</td>
                {canWrite && (
                  <td className="actions" style={{ whiteSpace: 'nowrap', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditor(t)} title="Ver / editar">✎</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => borrar(t)} title="Borrar">🗑</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function TotalesEditorModal({ grupoId, totales, recepciones, defaultNumero, actor, miNombre, canWrite, onCancel, onSaved }: {
  grupoId: string; totales: RecepcionTotales | null; recepciones: Recepcion[]; defaultNumero: number;
  actor: string; miNombre: string; canWrite: boolean; onCancel: () => void; onSaved: () => void;
}) {
  const [numero, setNumero] = useState(String(totales?.numero ?? defaultNumero));
  const [rows, setRows] = useState<{ nombre: string; sno2: string; precio: string }[]>(() =>
    totales
      ? totales.centros.map((c) => ({ nombre: c.nombre ?? '', sno2: c.sno2 == null ? '' : String(c.sno2), precio: c.precio == null ? '' : String(c.precio) }))
      : recepciones.map((r) => ({ nombre: r.centro_nombre || r.procedencia || '', sno2: r.peso_kg == null ? '' : String(r.peso_kg), precio: '' })));
  const [gastos, setGastos] = useState(totales?.gastos == null ? '' : String(totales.gastos));
  const [pesosKg, setPesosKg] = useState(totales?.pesos_kg == null ? '' : String(totales.pesos_kg));
  const [hProv, setHProv] = useState(totales?.humedad_prov == null ? '' : String(totales.humedad_prov));
  const [hFinal, setHFinal] = useState(totales?.humedad_final == null ? '' : String(totales.humedad_final));
  const [fe, setFe] = useState(totales?.fe_esteril == null ? '' : String(totales.fe_esteril));
  const [nota, setNota] = useState(totales?.nota ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const centrosParsed: CentroTotal[] = rows.map((r) => ({ nombre: r.nombre.trim() || null, sno2: parseNum(r.sno2), precio: parseNum(r.precio) }));
  const totalSnO2 = sumSnO2(centrosParsed);
  const totalMoneda = totalMonedaTotal(centrosParsed, parseNum(gastos));
  const pesosKgN = parseNum(pesosKg);
  const tasaRec = tasaRecepcionada(totalMoneda, pesosKgN);
  const hp = parseNum(hProv) ?? 0, hf = parseNum(hFinal) ?? 0, fe2 = parseNum(fe) ?? 0;
  const sum3 = hp + hf + fe2;
  const totalSnO2Final = (pesosKgN ?? 0) + sum3;
  const totalMonedaFinal = sum3 !== 0 ? sum3 : totalMoneda;
  const tasaFinal = totalSnO2Final !== 0 ? totalMonedaFinal / totalSnO2Final : null;

  const addCentro = () => setRows((rs) => [...rs, { nombre: '', sno2: '', precio: '' }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const setCell = (i: number, key: 'nombre' | 'sno2' | 'precio', val: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: val } : r)));

  async function guardar() {
    setError(null);
    const numN = Math.floor(Number(numero) || 0);
    if (numN <= 0) { setError('Indicá el número de la recepción.'); return; }
    setSaving(true);
    try {
      const input = { grupo_id: grupoId, numero: numN, centros: centrosParsed, gastos: parseNum(gastos), pesos_kg: pesosKgN,
        humedad_prov: parseNum(hProv), humedad_final: parseNum(hFinal), fe_esteril: parseNum(fe), nota };
      if (totales) await actualizarTotales(totales.id, input);
      else await crearTotales(input, actor, miNombre);
      toast('Totales guardados', 'success');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); setSaving(false); }
  }

  // Celda numérica editable simple (para SnO2 de humedades, gastos, etc.).
  const inputCell = (value: string, onCh: (v: string) => void, opts?: { rojo?: boolean; ph?: string }) => (
    <input className="input mono" style={{ width: '100%', textAlign: 'right', padding: '.2rem .3rem', color: opts?.rojo ? ROJO : undefined }} inputMode="decimal" value={value} onChange={(e) => onCh(e.target.value)} disabled={!canWrite} placeholder={opts?.ph ?? '0,00'} />
  );

  return (
    <Modal title={totales ? `Σ Totales N° ${totales.numero}` : 'Σ Nuevos totales'} size="xl" onClose={onCancel} footer={
      <>
        <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>← Volver</button>
        {canWrite && <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving}>{saving ? 'Guardando…' : 'GUARDAR TOTALES'}</button>}
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
      <div className="form-grid" style={{ marginBottom: '.7rem' }}>
        <div className="form-row" style={{ maxWidth: 240 }}>
          <label>N° de Recepción</label>
          <input className="input mono" type="number" min={1} value={numero} onChange={(e) => setNumero(e.target.value)} disabled={!canWrite} placeholder="1" />
        </div>
      </div>

      {/* Centros de costo */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', margin: '0 0 1rem' }}>
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.55rem .7rem', margin: 0 }}>
          <span>Centros de costo</span>
          {canWrite && <button className="btn btn-sm btn-ghost" onClick={addCentro}>+ Añadir centro</button>}
        </div>
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.82rem', margin: 0 }}>
            <thead><tr><th style={{ textAlign: 'right', width: 130 }}>Total SnO2</th><th style={{ textAlign: 'right', width: 130 }}>Precio / Tasa</th><th style={{ textAlign: 'right', width: 150 }}>Total Moneda</th><th>Centro de costo</th>{canWrite && <th></th>}</tr></thead>
            <tbody>
              {!rows.length ? (
                <tr><td colSpan={canWrite ? 5 : 4} className="muted" style={{ textAlign: 'center' }}>Sin centros. Usá «+ Añadir centro».</td></tr>
              ) : rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: 2 }}>{inputCell(r.sno2, (v) => setCell(i, 'sno2', v))}</td>
                  <td style={{ padding: 2 }}>{inputCell(r.precio, (v) => setCell(i, 'precio', v), { ph: '$ 0,00' })}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{num(totalMonedaCentro(centrosParsed[i]))}</td>
                  <td style={{ padding: 2 }}><input className="input" style={{ padding: '.2rem .35rem', textTransform: 'uppercase' }} value={r.nombre} onChange={(e) => setCell(i, 'nombre', e.target.value)} disabled={!canWrite} placeholder="LOS PIJIGUAOS" /></td>
                  {canWrite && <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-ghost" onClick={() => removeRow(i)} title="Quitar">✕</button></td>}
                </tr>
              ))}
              {canWrite && (
                <tr>
                  <td colSpan={2} style={{ textAlign: 'right', fontWeight: 600 }}>GASTOS →</td>
                  <td style={{ padding: 2 }}>{inputCell(gastos, setGastos)}</td>
                  <td className="muted" style={{ fontSize: '.78rem' }}>se suma al Total Moneda</td>
                  <td></td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{num(totalSnO2)}</td>
                <td></td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{num(totalMoneda)}</td>
                <td style={{ fontWeight: 800 }}>TOTALES</td>
                {canWrite && <td></td>}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Resumen (recepcionada + costo final) */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', margin: 0 }}>
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem', margin: 0 }}>
            <thead><tr><th style={{ textAlign: 'right', width: 150 }}>Total SnO2</th><th style={{ textAlign: 'right', width: 130 }}>Precio / Tasa</th><th style={{ textAlign: 'right', width: 160 }}>Total Moneda</th><th>Concepto</th></tr></thead>
            <tbody>
              <tr style={{ background: 'rgba(255,138,0,.08)' }}>
                <td style={{ padding: 2 }}>{inputCell(pesosKg, setPesosKg, { ph: 'Pesos Kg' })}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>$ {fmt4(tasaRec)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{num(totalMoneda)}</td>
                <td style={{ fontWeight: 800 }}>PROMEDIO DE PRECIO DE COMPRA RECEPCIONADA</td>
              </tr>
              <tr>
                <td style={{ padding: 2 }}>{inputCell(hProv, setHProv, { rojo: true })}</td>
                <td></td><td></td>
                <td>HUMEDAD PROVISIONAL (LABORATORIO)</td>
              </tr>
              <tr>
                <td style={{ padding: 2 }}>{inputCell(hFinal, setHFinal, { rojo: true })}</td>
                <td></td><td></td>
                <td>HUMEDAD ADICIONAL (FINAL)</td>
              </tr>
              <tr>
                <td style={{ padding: 2 }}>{inputCell(fe, setFe, { rojo: true })}</td>
                <td></td><td></td>
                <td>Fe esteril</td>
              </tr>
              <tr style={{ borderTop: '2px solid var(--border-strong, #888)' }}>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{num(totalSnO2Final)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>$ {fmt4(tasaFinal)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{num(totalMonedaFinal)}</td>
                <td style={{ fontWeight: 800 }}>PROMEDIO DE PRECIO DE COSTO FINAL</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <small className="muted" style={{ display: 'block', marginTop: '.6rem' }}>
        Total Moneda = Total SnO2 × Precio/Tasa (+ Gastos). Tasa recepcionada = Total Moneda ÷ Pesos Kg.
        Costo final: SnO2 = Pesos Kg + Humedad Prov. + Humedad Final + Fe estéril; Total Moneda = la suma de esas 3 filas
        (si es 0, se toma el Total Moneda recepcionado); Tasa = Total Moneda ÷ SnO2.
      </small>

      <div className="form-row" style={{ marginTop: '.6rem' }}>
        <label>Nota <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
        <textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} disabled={!canWrite} placeholder="Observaciones…" />
      </div>
    </Modal>
  );
}

/* ───────────── CERRAR RECEPCIÓN · snapshot + histórico ───────────── */
function CerrarRecepcionModal({ grupo, actor, miNombre, datos, confirmar, onClose }: {
  grupo: RecepcionGrupo; actor: string; miNombre: string;
  datos: Record<string, unknown>;
  confirmar: (c: { message: string; onConfirm: () => void } | null) => void; onClose: () => void;
}) {
  const [cierres, setCierres] = useState<RecepcionCierre[]>([]);
  const [numero, setNumero] = useState('');
  const [ver, setVer] = useState<RecepcionCierre | null>(null);
  const [saving, setSaving] = useState(false);

  const cargar = useCallback(async () => {
    const [cs, nn] = await Promise.all([listCierres(grupo.id), nextNumeroCierre()]);
    setCierres(cs); setNumero((n) => n || String(nn));
  }, [grupo.id]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function cerrar() {
    const n = Math.floor(Number(numero) || 0);
    if (n <= 0) { toast('Indicá el número de la recepción', 'error'); return; }
    setSaving(true);
    try { await crearCierre({ grupoId: grupo.id, grupoNombre: grupo.nombre, numero: n, datos }, actor, miNombre); toast(`Recepción N° ${n} cerrada`, 'success'); await cargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cerrar', 'error'); }
    finally { setSaving(false); }
  }
  function borrar(c: RecepcionCierre) {
    confirmar({ message: `¿Borrar el cierre N° ${c.numero}?`, onConfirm: async () => {
      confirmar(null);
      try { await eliminarCierre(c.id); await cargar(); } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error'); }
    } });
  }

  if (ver) return <CierreDetalleModal cierre={ver} onClose={() => setVer(null)} />;

  return (
    <Modal title={`🔒 Cerrar recepción · ${grupo.nombre}`} size="lg" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <div className="card" style={{ marginBottom: '.9rem' }}>
        <div className="card-title"><span>Cerrar la recepción actual</span></div>
        <p className="muted" style={{ fontSize: '.84rem', marginTop: 0 }}>Guarda un snapshot con <strong>TODOS los datos</strong> de esta tarjeta (recepciones, laboratorio, humedad, pesos, conciliación y totales) en el histórico.</p>
        <div className="form-grid">
          <div className="form-row" style={{ maxWidth: 200 }}>
            <label>N° de Recepción</label>
            <input className="input mono" type="number" min={1} value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="1" />
          </div>
        </div>
        <button className="btn btn-warning" onClick={() => void cerrar()} disabled={saving}>{saving ? 'Cerrando…' : '🔒 Cerrar recepción'}</button>
      </div>

      <h4 style={{ margin: '.4rem 0' }}>Histórico de cierres</h4>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th style={{ width: 100 }}>N°</th><th>Fecha</th><th></th></tr></thead>
          <tbody>
            {!cierres.length ? (
              <tr><td colSpan={3}><EmptyState message="Sin cierres todavía." icon="🔒" /></td></tr>
            ) : cierres.map((c) => (
              <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setVer(c)} title="Ver el detalle">
                <td className="mono"><strong>N° {c.numero}</strong></td>
                <td className="muted">{dateTime(c.fecha)}</td>
                <td className="actions" style={{ whiteSpace: 'nowrap', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setVer(c)} title="Ver detalle">👁 Ver</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => borrar(c)} title="Borrar">🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function CierreDetalleModal({ cierre, onClose }: { cierre: RecepcionCierre; onClose: () => void }) {
  const d = cierre.datos as {
    recepciones?: Recepcion[]; minerales?: RecepcionMineral[]; analisis?: RecepcionAnalisis[];
    humProv?: HumedadProv[]; humFinal?: HumedadFinal[]; pesajes?: RecepcionPesaje[];
    conciliaciones?: RecepcionConciliacion[]; totales?: RecepcionTotales[];
  };
  const minerales = d.minerales ?? [];
  const analisis = d.analisis ?? [];
  const recepciones = d.recepciones ?? [];
  const mitad = Math.ceil(minerales.length / 2);
  const gruposMin = minerales.length > mitad ? [minerales.slice(0, mitad), minerales.slice(mitad)] : [minerales];
  const noop = () => {};
  const noopReload = async () => {};

  return (
    <Modal title={`🔒 RECEPCIÓN CERRADA · N° ${cierre.numero}`} size="xl" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <div className="muted" style={{ marginBottom: '.8rem' }}>{cierre.grupo_nombre} · {dateTime(cierre.fecha)}</div>

      <h4 style={{ margin: '.4rem 0' }}>📦 Recepciones</h4>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead><tr><th>Item</th><th>Fecha</th><th style={{ textAlign: 'right' }}>Peso (Kg)</th><th>Procedencia</th><th>Centro de Acopio</th></tr></thead>
          <tbody>
            {!recepciones.length ? <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>Sin recepciones.</td></tr>
            : recepciones.map((r) => (
              <tr key={r.id}><td className="mono">{r.item}</td><td className="muted" style={{ fontSize: '.8rem' }}>{dateTime(r.fecha)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(r.peso_kg)}</td><td><strong>{r.procedencia}</strong></td>
                <td>{r.centro_nombre ? `Centro de Acopio ${r.centro_nombre}` : '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 style={{ margin: '1rem 0 .4rem', textAlign: 'center', color: 'var(--primary, #ff8a00)' }}>RECEPCIÓN GLOBAL LABORATORIO</h4>
      <div style={{ display: 'grid', gap: '1rem' }}>
        {gruposMin.map((g, i) => <LabTable key={i} minerales={g} analisis={analisis} canWrite={false} showActions={false} onBorrar={noop} onReload={noopReload} />)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
        <HumedadProvCard filas={d.humProv ?? []} canWrite={false} onAgregar={noop} onBorrar={noop} onReload={noopReload} />
        <HumedadFinalCard filas={d.humFinal ?? []} canWrite={false} onAgregar={noop} onBorrar={noop} onReload={noopReload} />
      </div>

      <h4 style={{ margin: '1rem 0 .4rem' }}>⚖ Pesos (Bigbags)</h4>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead><tr><th>#</th><th>Fecha</th><th style={{ textAlign: 'right' }}>Bigbags</th><th style={{ textAlign: 'right' }}>Total húmedo</th><th style={{ textAlign: 'right' }}>Total seco</th></tr></thead>
          <tbody>
            {!(d.pesajes ?? []).length ? <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>Sin pesos.</td></tr>
            : (d.pesajes ?? []).map((p) => (
              <tr key={p.id}><td className="mono">{p.item}</td><td className="muted" style={{ fontSize: '.8rem' }}>{dateTime(p.fecha)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{p.bigbags.length}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(p.total_neto_humedo ?? 0)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(p.total_neto_seco ?? 0)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 style={{ margin: '1rem 0 .4rem' }}>⚖ Conciliación</h4>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead><tr><th>N°</th><th style={{ textAlign: 'right' }}>Reportado (Kg)</th><th style={{ textAlign: 'right' }}>Kg No Llegó</th><th style={{ textAlign: 'right' }}>% no llegó</th></tr></thead>
          <tbody>
            {!(d.conciliaciones ?? []).length ? <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>Sin conciliaciones.</td></tr>
            : (d.conciliaciones ?? []).map((c) => (
              <tr key={c.id}><td className="mono"><strong>N° {c.numero}</strong></td>
                <td className="mono" style={{ textAlign: 'right' }}>{num(c.total_reportado ?? 0)}</td>
                <td className="mono" style={{ textAlign: 'right', color: ROJO }}>{num(c.kg_no_llego ?? 0)}</td>
                <td className="mono" style={{ textAlign: 'right', color: ROJO }}>{c.pct_no_llego != null ? `${num(c.pct_no_llego)}%` : '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 style={{ margin: '1rem 0 .4rem' }}>Σ Totales</h4>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead><tr><th>N°</th><th style={{ textAlign: 'right' }}>Total SnO2</th><th style={{ textAlign: 'right' }}>Tasa recep.</th><th style={{ textAlign: 'right' }}>Total Moneda</th></tr></thead>
          <tbody>
            {!(d.totales ?? []).length ? <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>Sin totales.</td></tr>
            : (d.totales ?? []).map((t) => (
              <tr key={t.id}><td className="mono"><strong>N° {t.numero}</strong></td>
                <td className="mono" style={{ textAlign: 'right' }}>{num(t.total_sno2 ?? 0)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>$ {fmt4(t.tasa_recepcionada)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{num(t.total_moneda ?? 0)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/* ───────────── Alta / edición de una recepción ───────────── */
function RecepcionFormModal({ grupoId, recepcion, actor, miNombre, onClose, onSaved }: {
  grupoId: string; recepcion?: Recepcion; actor: string; miNombre: string; onClose: () => void; onSaved: () => void;
}) {
  const esEdicion = !!recepcion;
  const [item, setItem] = useState(recepcion ? String(recepcion.item) : '');
  const [fecha, setFecha] = useState(recepcion ? recepcion.fecha.slice(0, 16) : new Date().toISOString().slice(0, 16));
  const [peso, setPeso] = useState(recepcion ? String(recepcion.peso_kg) : '');
  const [procedencia, setProcedencia] = useState(recepcion?.procedencia ?? '');
  const [centro, setCentro] = useState(recepcion?.centro_nombre ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    const pesoNum = parseNum(peso) ?? 0;
    if (!procedencia.trim()) { setError('Indicá la procedencia.'); return; }
    setSaving(true);
    try {
      const fechaIso = fecha ? new Date(fecha).toISOString() : new Date().toISOString();
      if (esEdicion && recepcion) {
        await actualizarRecepcion(recepcion.id, { item: item ? Number(item) : undefined, fecha: fechaIso, peso_kg: pesoNum, procedencia, centro_nombre: centro });
      } else {
        await crearRecepcion({ grupo_id: grupoId, item: item ? Number(item) : null, fecha: fechaIso, peso_kg: pesoNum, procedencia, centro_nombre: centro, origen: 'manual' }, actor, miNombre);
      }
      toast(esEdicion ? 'Recepción actualizada' : 'Recepción creada', 'success');
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }

  return (
    <Modal title={esEdicion ? `✎ Recepción #${recepcion?.item}` : '+ Nueva recepción'} size="md" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" form="rec-form" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
      <form id="rec-form" onSubmit={submit}>
        <div className="form-grid">
          <div className="form-row"><label>Item <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label><input className="input mono" type="number" min={1} value={item} onChange={(e) => setItem(e.target.value)} placeholder="auto" /></div>
          <div className="form-row"><label>Fecha y hora</label><input className="input" type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        </div>
        <div className="form-grid">
          <div className="form-row"><label>Peso (Kg)</label><input className="input mono" inputMode="decimal" value={peso} onChange={(e) => setPeso(e.target.value)} placeholder="0,00" /></div>
          <div className="form-row"><label>Procedencia</label><input className="input" value={procedencia} onChange={(e) => setProcedencia(e.target.value)} placeholder="LA ESPERANZA" style={{ textTransform: 'uppercase' }} /></div>
        </div>
        <div className="form-row"><label>Centro de Acopio <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label><input className="input" value={centro} onChange={(e) => setCentro(e.target.value)} placeholder="LA ESPERANZA" /></div>
        <small className="muted">La procedencia se guarda en MAYÚSCULAS. Para las recepciones creadas desde el cierre de caja, la procedencia (centro o aliado) y el Centro de Acopio se completan solos.</small>
      </form>
    </Modal>
  );
}

/* ───────────── Configurar minerales (columnas del laboratorio) ───────────── */
function ConfigMineralesModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> }) {
  const [minerales, setMinerales] = useState<RecepcionMineral[]>([]);
  const [nombre, setNombre] = useState('');
  const [subtitulo, setSubtitulo] = useState('');
  const [modo, setModo] = useState<'abc' | 'prom'>('abc');
  const [color, setColor] = useState('#cccccc');
  const [busy, setBusy] = useState(false);
  const [renombrando, setRenombrando] = useState<RecepcionMineral | null>(null);
  const [nuevoNombre, setNuevoNombre] = useState('');

  const cargar = useCallback(async () => { setMinerales(await listMinerales(false)); }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  async function agregar() {
    if (!nombre.trim()) { toast('Indicá el nombre del mineral', 'error'); return; }
    setBusy(true);
    try { await crearMineral({ nombre, subtitulo: subtitulo || null, modo, color }); setNombre(''); setSubtitulo(''); await cargar(); await onChanged(); toast('Mineral agregado', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo agregar', 'error'); }
    finally { setBusy(false); }
  }
  async function toggle(m: RecepcionMineral) {
    try { await setMineralActivo(m.id, !m.activo); await cargar(); await onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cambiar', 'error'); }
  }
  function abrirRenombrar(m: RecepcionMineral) { setRenombrando(m); setNuevoNombre(m.nombre); }
  async function confirmarRenombrar() {
    if (!renombrando) return;
    const n = nuevoNombre.trim();
    if (!n) { toast('Indicá el nombre', 'error'); return; }
    try { await actualizarMineral(renombrando.id, { nombre: n }); setRenombrando(null); await cargar(); await onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo renombrar', 'error'); }
  }

  return (
    <Modal title="⚙ Configurar minerales" size="lg" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-title"><span>Nuevo mineral</span></div>
        <div className="form-grid">
          <div className="form-row"><label>Nombre</label><input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Cu (Cobre)" /></div>
          <div className="form-row"><label>Subtítulo (opcional)</label><input className="input" value={subtitulo} onChange={(e) => setSubtitulo(e.target.value)} placeholder="Laboratorio…" /></div>
        </div>
        <div className="form-grid">
          <div className="form-row"><label>Columnas</label>
            <select className="select" value={modo} onChange={(e) => setModo(e.target.value as 'abc' | 'prom')}>
              <option value="abc">A / B / C / Prom.</option>
              <option value="prom">Solo Prom. (como UCV)</option>
            </select>
          </div>
          <div className="form-row"><label>Color</label><input className="input" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 38, padding: 2 }} /></div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => void agregar()} disabled={busy}>+ Agregar mineral</button>
      </div>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>Orden</th><th>Mineral</th><th>Columnas</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {!minerales.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>Sin minerales.</td></tr>}
            {minerales.map((m) => (
              <tr key={m.id} style={{ opacity: m.activo ? 1 : .5 }}>
                <td className="mono">{m.orden}</td>
                <td><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: m.color ?? '#ccc', marginRight: 6 }} /><strong>{m.nombre}</strong>{m.subtitulo ? <span className="muted"> · {m.subtitulo}</span> : null}</td>
                <td>{m.modo === 'abc' ? 'A/B/C/Prom.' : 'Solo Prom.'}</td>
                <td>{m.activo ? '🟢 Activo' : '⚪ Oculto'}</td>
                <td className="actions" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => abrirRenombrar(m)}>✎</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => void toggle(m)}>{m.activo ? 'Ocultar' : 'Mostrar'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small className="muted">Ocultar un mineral lo saca de la grilla sin borrar el histórico de análisis.</small>

      {renombrando && (
        <Modal title="✎ Renombrar mineral" size="sm" onClose={() => setRenombrando(null)} footer={
          <>
            <button className="btn btn-ghost" onClick={() => setRenombrando(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={() => void confirmarRenombrar()}>Guardar</button>
          </>
        }>
          <div className="form-row">
            <label>Nuevo nombre</label>
            <input className="input" autoFocus value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void confirmarRenombrar(); }} placeholder="Sn (Estaño)" />
          </div>
        </Modal>
      )}
    </Modal>
  );
}
