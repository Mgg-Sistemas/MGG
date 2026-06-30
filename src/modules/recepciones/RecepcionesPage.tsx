import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { num, dateTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import {
  listRecepciones, crearRecepcion, actualizarRecepcion, eliminarRecepcion,
  listMinerales, crearMineral, actualizarMineral, setMineralActivo,
  listAnalisis, crearAnalisis, actualizarAnalisis, eliminarAnalisis,
  promMineral, promedioDelLote,
  type Recepcion, type RecepcionMineral, type RecepcionAnalisis, type ValorMineral,
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

export function RecepcionesPage() {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('recepciones', 'escritura');
  const actor = user?.email ?? 'sistema';
  const miNombre = appUser?.nombre?.trim() || user?.email || '';

  const [recepciones, setRecepciones] = useState<Recepcion[]>([]);
  const [minerales, setMinerales] = useState<RecepcionMineral[]>([]);
  const [analisis, setAnalisis] = useState<RecepcionAnalisis[]>([]);
  const [loading, setLoading] = useState(true);
  const [recEdit, setRecEdit] = useState<Recepcion | null>(null);
  const [recNueva, setRecNueva] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [confirmar, setConfirmar] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const reload = useCallback(async () => {
    const [rs, ms, as] = await Promise.all([listRecepciones(), listMinerales(true), listAnalisis()]);
    setRecepciones(rs); setMinerales(ms); setAnalisis(as);
  }, []);
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    reload().catch((e) => { if (!cancel) toast(e instanceof Error ? e.message : 'Error al cargar', 'error'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reload]);
  useRealtime(['recepciones', 'recepcion_analisis', 'recepcion_minerales'], reload);

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
    try { await crearAnalisis({}, actor, miNombre); await reload(); }
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

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>📥 Recepciones</h1>
          <p className="muted" style={{ margin: 0 }}>
            Paso intermedio del acopio: al cerrar la caja de un centro, su <strong>saldo de Kg de casiterita</strong> entra acá como recepción
            (no al inventario todavía). El laboratorio carga sus análisis por mineral.
          </p>
        </div>
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
      <div className="card" style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.05rem', letterSpacing: '.04em', background: 'var(--primary-2, rgba(255,138,0,.12))', marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
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

      {recNueva && (
        <RecepcionFormModal actor={actor} miNombre={miNombre} onClose={() => setRecNueva(false)} onSaved={async () => { setRecNueva(false); await reload(); }} />
      )}
      {recEdit && (
        <RecepcionFormModal recepcion={recEdit} actor={actor} miNombre={miNombre} onClose={() => setRecEdit(null)} onSaved={async () => { setRecEdit(null); await reload(); }} />
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

/* ───────────── Alta / edición de una recepción ───────────── */
function RecepcionFormModal({ recepcion, actor, miNombre, onClose, onSaved }: {
  recepcion?: Recepcion; actor: string; miNombre: string; onClose: () => void; onSaved: () => void;
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
        await crearRecepcion({ item: item ? Number(item) : null, fecha: fechaIso, peso_kg: pesoNum, procedencia, centro_nombre: centro, origen: 'manual' }, actor, miNombre);
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
