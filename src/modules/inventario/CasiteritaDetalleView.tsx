/* ============================================================
   MGG · Inventario · Casiterita — Inventario Detallado (SnO₂)
   Vista dentro de ⛏ Casiterita (Los Pinos). Dos partes:
   · CasiteritaResumen  → banner valorizado (Peso Casiterita × Tasa) por centro/aliado
                          + botón «Inventario Detallado (SnO₂)».
   · CasiteritaDetalleView → la vista completa (con «← Volver»): tabla con precinto,
                          # análisis, prom, peso puro SN, tasa y valor, editable.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { money } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { PESO_FACTOR } from '@/modules/recepciones/recepciones.repository';
import {
  listCasiteritaDetalle, crearCasiteritaDetalle, actualizarCasiteritaDetalle, eliminarCasiteritaDetalle,
  sugerenciasCasiteritaDesdeCierre, listCierresParaTraer,
  calcPesoCasiterita, calcPesoPuroSn,
  type CasiteritaDetalle, type CasiteritaCategoria, type CasiteritaDetalleInput, type CasiteritaSugerencia, type CierreOpcion,
} from './casiteritaDetalle.repository';

const CAT_LABEL: Record<CasiteritaCategoria, string> = {
  bigbag: 'BIG BAG', saco: 'SACO', tobo: 'TOBO', hielo: 'BOLSA DE HIELO',
};
const CAT_ORDEN: CasiteritaCategoria[] = ['bigbag', 'saco', 'tobo', 'hielo'];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const n2 = (v: number | null | undefined) =>
  v == null || !Number.isFinite(Number(v)) ? '—'
    : Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parseNum = (s: string): number | null => {
  const t = String(s ?? '').trim().replace(/\./g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const numInput = (v: number | null | undefined) =>
  v == null || !Number.isFinite(Number(v)) ? '' : String(v).replace('.', ',');

/** Valor de una fila = Peso Casiterita × Tasa (0 si no hay tasa). */
const valorFila = (d: CasiteritaDetalle) => round2(Number(d.peso_casiterita_kgs) * Number(d.tasa ?? 0));

interface Grupo { peso: number; casiterita: number; puro: number; valor: number; }
function agrupaPorProc(rows: CasiteritaDetalle[]): Map<string, Grupo> {
  const m = new Map<string, Grupo>();
  for (const d of rows) {
    const k = d.procedencia || '—';
    const g = m.get(k) ?? { peso: 0, casiterita: 0, puro: 0, valor: 0 };
    g.peso += Number(d.peso_neto_kgs) || 0;
    g.casiterita += Number(d.peso_casiterita_kgs) || 0;
    g.puro += Number(d.peso_puro_sn) || 0;
    g.valor += valorFila(d);
    m.set(k, g);
  }
  return m;
}

/* ───────────── Banner resumen (dentro de ⛏ Casiterita) ───────────── */
export function CasiteritaResumen({ onOpenDetalle }: { onOpenDetalle: () => void }) {
  const [rows, setRows] = useState<CasiteritaDetalle[]>([]);
  const cargar = useCallback(() => { listCasiteritaDetalle().then(setRows).catch(() => setRows([])); }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useRealtime(['casiterita_detalle'], cargar);

  const grupos = useMemo(() => Array.from(agrupaPorProc(rows).entries()).sort((a, b) => a[0].localeCompare(b[0])), [rows]);
  const tot = useMemo(() => rows.reduce((a, d) => ({
    casiterita: a.casiterita + (Number(d.peso_casiterita_kgs) || 0),
    valor: a.valor + valorFila(d),
  }), { casiterita: 0, valor: 0 }), [rows]);

  return (
    <div className="card" style={{ marginBottom: '.8rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '.6rem', marginBottom: grupos.length ? '.6rem' : 0 }}>
        <div className="card-title" style={{ margin: 0 }}>⛏ Casiterita valorizada <span className="muted" style={{ fontWeight: 400, fontSize: '.8rem' }}>(Peso Casiterita × Tasa, por centro/aliado)</span></div>
        <button className="btn btn-sm btn-primary" onClick={onOpenDetalle}>🔎 Inventario Detallado (SnO₂)</button>
      </div>
      {grupos.length === 0 ? (
        <p className="hint muted" style={{ fontSize: '.82rem', margin: 0 }}>Sin registros. Entrá a <strong>Inventario Detallado (SnO₂)</strong> para cargar la mercancía o traerla desde una recepción.</p>
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem', margin: 0 }}>
            <thead><tr>
              <th>PROCEDENCIA (centro / aliado)</th>
              <th style={{ textAlign: 'right' }}>PESO CASITERITA (Kg)</th>
              <th style={{ textAlign: 'right' }}>TASA prom.</th>
              <th style={{ textAlign: 'right' }}>VALOR</th>
            </tr></thead>
            <tbody>
              {grupos.map(([proc, g]) => (
                <tr key={proc}>
                  <td style={{ fontWeight: 700, textTransform: 'uppercase' }}>{proc}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{n2(g.casiterita)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{g.casiterita > 0 ? n2(round2(g.valor / g.casiterita)) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{money(g.valor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr style={{ background: 'rgba(255,138,0,0.12)' }}>
              <td style={{ fontWeight: 800 }}>TOTAL</td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{n2(tot.casiterita)}</td>
              <td></td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{money(tot.valor)}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* ───────────── Vista completa (con «← Volver») ───────────── */
export function CasiteritaDetalleView({ actor, actorName, canWrite, onClose }: {
  actor: string; actorName: string | null; canWrite: boolean; onClose: () => void;
}) {
  const [rows, setRows] = useState<CasiteritaDetalle[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<CasiteritaDetalle | 'nuevo' | null>(null);
  const [traer, setTraer] = useState(false);
  const [borrar, setBorrar] = useState<CasiteritaDetalle | null>(null);

  const cargar = useCallback(() => {
    setLoading(true);
    listCasiteritaDetalle().then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useRealtime(['casiterita_detalle'], cargar);

  // Orden: por procedencia, luego por creación. Subtotales por procedencia.
  const ordenadas = useMemo(
    () => [...rows].sort((a, b) => (a.procedencia || '').localeCompare(b.procedencia || '') || a.created_at.localeCompare(b.created_at)),
    [rows],
  );
  const subtot = useMemo(() => agrupaPorProc(rows), [rows]);
  const tot = useMemo(() => rows.reduce((a, d) => ({
    peso: a.peso + (Number(d.peso_neto_kgs) || 0),
    casiterita: a.casiterita + (Number(d.peso_casiterita_kgs) || 0),
    puro: a.puro + (Number(d.peso_puro_sn) || 0),
    valor: a.valor + valorFila(d),
  }), { peso: 0, casiterita: 0, puro: 0, valor: 0 }), [rows]);

  // Filas + subtotal cuando cambia la procedencia.
  const filas: Array<{ tipo: 'dato'; d: CasiteritaDetalle } | { tipo: 'sub'; proc: string }> = [];
  ordenadas.forEach((d, i) => {
    filas.push({ tipo: 'dato', d });
    const sig = ordenadas[i + 1];
    if (!sig || (sig.procedencia || '') !== (d.procedencia || '')) filas.push({ tipo: 'sub', proc: d.procedencia || '—' });
  });

  const COLS = 11;
  return (
    <div className="card">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.6rem', marginBottom: '.8rem' }}>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>← Volver</button>
        <div className="card-title" style={{ margin: 0 }}>⛏ Inventario Detallado (SnO₂)</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '.4rem' }}>
          {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setTraer(true)}>⬇ Traer desde recepción</button>}
          {canWrite && <button className="btn btn-sm btn-primary" onClick={() => setEditor('nuevo')}>+ Agregar</button>}
        </div>
      </div>

      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.82rem', margin: 0 }}>
          <thead><tr>
            <th>PRECINTO</th>
            <th># ANÁLISIS</th>
            <th>PROCEDENCIA</th>
            <th style={{ textAlign: 'center' }}>CATEGORÍA</th>
            <th style={{ textAlign: 'center' }}>CANT.</th>
            <th style={{ textAlign: 'right' }}>PESO NETO</th>
            <th style={{ textAlign: 'right' }}>PESO CASITERITA</th>
            <th style={{ textAlign: 'right' }}>Tenor SN Prom%</th>
            <th style={{ textAlign: 'right' }}>PESO PURO SN</th>
            <th style={{ textAlign: 'right' }}>TASA</th>
            <th style={{ textAlign: 'right' }}>VALOR</th>
            {canWrite && <th></th>}
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={COLS + (canWrite ? 1 : 0)} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>
            ) : !rows.length ? (
              <tr><td colSpan={COLS + (canWrite ? 1 : 0)}><EmptyState message="Sin mercancía cargada. Usá «+ Agregar» o «Traer desde recepción»." icon="⛏" /></td></tr>
            ) : filas.map((f, i) => f.tipo === 'sub' ? (
              <tr key={`sub-${f.proc}-${i}`} style={{ background: 'rgba(148,163,184,0.10)' }}>
                <td colSpan={5} style={{ fontWeight: 700, textAlign: 'right', textTransform: 'uppercase' }}>Subtotal {f.proc}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{n2(subtot.get(f.proc)?.peso)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{n2(subtot.get(f.proc)?.casiterita)}</td>
                <td></td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{n2(subtot.get(f.proc)?.puro)}</td>
                <td></td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{money(subtot.get(f.proc)?.valor ?? 0)}</td>
                {canWrite && <td></td>}
              </tr>
            ) : (
              <tr key={f.d.id}>
                <td style={{ fontWeight: 600 }}>{f.d.precinto || '—'}</td>
                <td className="muted">{f.d.n_analisis || '—'}</td>
                <td style={{ fontWeight: 700, textTransform: 'uppercase' }}>{f.d.procedencia || '—'}</td>
                <td style={{ textAlign: 'center' }}>{CAT_LABEL[f.d.categoria] ?? f.d.categoria}</td>
                <td className="mono" style={{ textAlign: 'center' }}>{f.d.cant}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{n2(f.d.peso_neto_kgs)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{n2(f.d.peso_casiterita_kgs)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{f.d.prom_sn != null ? `${n2(f.d.prom_sn)} %` : '—'}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{n2(f.d.peso_puro_sn)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{f.d.tasa != null ? n2(f.d.tasa) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{money(valorFila(f.d))}</td>
                {canWrite && (
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditor(f.d)} title="Editar">✎</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setBorrar(f.d)} title="Borrar">🗑</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot><tr style={{ background: 'rgba(255,138,0,0.14)' }}>
              <td colSpan={5} style={{ fontWeight: 800, textAlign: 'right' }}>TOTAL GENERAL</td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{n2(tot.peso)}</td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{n2(tot.casiterita)}</td>
              <td></td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{n2(tot.puro)}</td>
              <td></td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{money(tot.valor)}</td>
              {canWrite && <td></td>}
            </tr></tfoot>
          )}
        </table>
      </div>

      {editor && (
        <EntradaModal
          entrada={editor === 'nuevo' ? null : editor}
          actor={actor} actorName={actorName}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); cargar(); }}
        />
      )}
      {traer && (
        <TraerRecepcionModal
          actor={actor} actorName={actorName}
          onClose={() => setTraer(false)}
          onSaved={() => { setTraer(false); cargar(); }}
        />
      )}
      {borrar && (
        <ConfirmDialog
          title="Borrar entrada" danger confirmText="Borrar"
          message={`¿Borrar la entrada de ${borrar.procedencia || '—'}${borrar.precinto ? ` (precinto ${borrar.precinto})` : ''}?`}
          onCancel={() => setBorrar(null)}
          onConfirm={async () => { try { await eliminarCasiteritaDetalle(borrar.id); toast('Entrada borrada', 'success'); setBorrar(null); cargar(); } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error'); } }}
        />
      )}
    </div>
  );
}

/* ───────────── Modal alta/edición de una entrada ───────────── */
type Draft = { procedencia: string; precinto: string; n_analisis: string; categoria: CasiteritaCategoria; cant: string; peso_neto: string; prom_sn: string; tasa: string };
function EntradaModal({ entrada, actor, actorName, onClose, onSaved }: {
  entrada: CasiteritaDetalle | null; actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [d, setD] = useState<Draft>(() => ({
    procedencia: entrada?.procedencia ?? '',
    precinto: entrada?.precinto ?? '',
    n_analisis: entrada?.n_analisis ?? '',
    categoria: entrada?.categoria ?? 'bigbag',
    cant: entrada?.cant == null ? '1' : String(entrada.cant),
    peso_neto: numInput(entrada?.peso_neto_kgs),
    prom_sn: numInput(entrada?.prom_sn ?? null),
    tasa: numInput(entrada?.tasa ?? null),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Draft, v: string) => setD((p) => ({ ...p, [k]: v }));

  const pesoNeto = parseNum(d.peso_neto) ?? 0;
  const cant = (parseNum(d.cant) ?? 0) > 0 ? Math.floor(parseNum(d.cant) as number) : 1;
  const prom = parseNum(d.prom_sn);
  const tasa = parseNum(d.tasa);
  const casiterita = calcPesoCasiterita(pesoNeto, d.categoria, cant);
  const puro = calcPesoPuroSn(prom, casiterita);
  const valor = round2(casiterita * (tasa ?? 0));

  async function guardar() {
    if (!d.procedencia.trim()) { setError('Indicá la procedencia (centro o aliado).'); return; }
    setError(null); setSaving(true);
    const input: CasiteritaDetalleInput = {
      grupo_id: entrada?.grupo_id ?? null,
      procedencia: d.procedencia, precinto: d.precinto, n_analisis: d.n_analisis,
      categoria: d.categoria, cant, peso_neto_kgs: pesoNeto, prom_sn: prom, tasa,
    };
    try {
      if (entrada) await actualizarCasiteritaDetalle(entrada.id, input);
      else await crearCasiteritaDetalle(input, actor, actorName);
      toast(entrada ? 'Entrada actualizada' : 'Entrada agregada', 'success');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); setSaving(false); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cerrar</button>
      <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving}>{saving ? 'Guardando…' : 'GUARDAR'}</button>
    </>
  );
  return (
    <Modal title={entrada ? '✎ Editar entrada (SnO₂)' : '+ Nueva entrada (SnO₂)'} size="lg" onClose={onClose} footer={footer}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.7rem' }}>
        <div className="form-row"><label>Procedencia (centro / aliado)</label><input className="input" style={{ textTransform: 'uppercase' }} value={d.procedencia} onChange={(e) => set('procedencia', e.target.value)} placeholder="EL BURRO, ENDER MEJIA…" /></div>
        <div className="form-row"><label>N° de precinto</label><input className="input" value={d.precinto} onChange={(e) => set('precinto', e.target.value)} placeholder="Ej. 001234" /></div>
        <div className="form-row"><label># de análisis</label><input className="input" value={d.n_analisis} onChange={(e) => set('n_analisis', e.target.value)} placeholder="Ej. 34, 35" /></div>
        <div className="form-row"><label>Categoría</label>
          <select className="select" value={d.categoria} onChange={(e) => set('categoria', e.target.value as CasiteritaCategoria)}>
            {CAT_ORDEN.map((c) => <option key={c} value={c}>{CAT_LABEL[c]} (×{PESO_FACTOR[c]})</option>)}
          </select>
        </div>
        <div className="form-row"><label>Cantidad</label><input className="input mono" inputMode="numeric" value={d.cant} onChange={(e) => set('cant', e.target.value)} placeholder="1" /></div>
        <div className="form-row"><label>Peso Neto Kgs <span className="muted" style={{ fontWeight: 400 }}>(de la recepción)</span></label><input className="input mono" inputMode="decimal" value={d.peso_neto} onChange={(e) => set('peso_neto', e.target.value)} placeholder="0,00" /></div>
        <div className="form-row"><label>Prom SN (%)</label><input className="input mono" inputMode="decimal" value={d.prom_sn} onChange={(e) => set('prom_sn', e.target.value)} placeholder="Ej. 61,24" /></div>
        <div className="form-row"><label>Tasa (USD/Kg)</label><input className="input mono" inputMode="decimal" value={d.tasa} onChange={(e) => set('tasa', e.target.value)} placeholder="0,00" /></div>
      </div>
      <div className="card" style={{ marginTop: '.8rem', background: 'rgba(255,138,0,0.08)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.5rem', fontSize: '.85rem' }}>
          <div>Peso Casiterita Kgs<br/><strong className="mono" style={{ fontSize: '1.05rem' }}>{n2(casiterita)}</strong><br/><span className="muted" style={{ fontSize: '.7rem' }}>= {n2(pesoNeto)} − {PESO_FACTOR[d.categoria]}×{cant}</span></div>
          <div>Peso Puro SN<br/><strong className="mono" style={{ fontSize: '1.05rem' }}>{n2(puro)}</strong><br/><span className="muted" style={{ fontSize: '.7rem' }}>= Prom × Casiterita ÷ 100</span></div>
          <div>Valor<br/><strong className="mono" style={{ fontSize: '1.05rem' }}>{money(valor)}</strong><br/><span className="muted" style={{ fontSize: '.7rem' }}>= Casiterita × Tasa</span></div>
        </div>
      </div>
    </Modal>
  );
}

/* ───────────── Modal «Traer desde recepción» ───────────── */
type FilaTraer = Omit<CasiteritaSugerencia, 'tasa'> & { incluir: boolean; categoria: CasiteritaCategoria; cant: string; precinto: string; tasa: string };
function TraerRecepcionModal({ actor, actorName, onClose, onSaved }: {
  actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [cierres, setCierres] = useState<CierreOpcion[]>([]);
  const [sel, setSel] = useState(''); // "cierre:<id>" (recepción cerrada)
  const [filas, setFilas] = useState<FilaTraer[]>([]);
  const [cargando, setCargando] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Solo recepciones CERRADAS (las abiertas ya no tienen datos: se vaciaron al cerrar).
    listCierresParaTraer().then(setCierres).catch(() => setCierres([]));
  }, []);

  async function cargarSug(value: string) {
    setSel(value); setFilas([]); setError(null);
    if (!value) return;
    setCargando(true);
    try {
      const [, id] = value.split(':'); // value = "cierre:<id>"
      const sug = await sugerenciasCasiteritaDesdeCierre(id);
      setFilas(sug.map((s) => ({ ...s, incluir: s.peso_neto_kgs > 0, categoria: s.categoria_sug, cant: '1', precinto: '', tasa: s.tasa != null ? numInput(s.tasa) : '' })));
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo leer la recepción'); }
    finally { setCargando(false); }
  }
  const setFila = (i: number, patch: Partial<FilaTraer>) => setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const aGuardar = filas.filter((f) => f.incluir);

  // Trazabilidad del cierre seleccionado: grupo_id (tarjeta) + cierre_id (recepción puntual).
  // El cierre_id se guarda en cada fila para poder excluir la recepción del selector una
  // vez usada (no se vuelve a traer lo ya cargado).
  const { grupoIdGuardar, cierreIdGuardar } = (() => {
    const [tipo, id] = sel.split(':');
    if (tipo === 'cierre') {
      const c = cierres.find((x) => x.id === id);
      return { grupoIdGuardar: c?.grupo_id ?? null, cierreIdGuardar: c?.id ?? null };
    }
    return { grupoIdGuardar: null, cierreIdGuardar: null };
  })();

  async function guardar() {
    if (!aGuardar.length) { setError('Marcá al menos una procedencia.'); return; }
    setError(null); setSaving(true);
    try {
      for (const f of aGuardar) {
        const cant = (parseNum(f.cant) ?? 0) > 0 ? Math.floor(parseNum(f.cant) as number) : 1;
        await crearCasiteritaDetalle({
          grupo_id: grupoIdGuardar, cierre_id: cierreIdGuardar, procedencia: f.procedencia, precinto: f.precinto, n_analisis: f.n_analisis,
          categoria: f.categoria, cant, peso_neto_kgs: f.peso_neto_kgs, prom_sn: f.prom_sn, tasa: parseNum(f.tasa),
        }, actor, actorName);
      }
      toast(`${aGuardar.length} entrada(s) agregada(s)`, 'success');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); setSaving(false); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cerrar</button>
      <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving || !aGuardar.length}>{saving ? 'Guardando…' : `Guardar ${aGuardar.length || ''} fila(s)`}</button>
    </>
  );
  return (
    <Modal title="⬇ Traer desde recepción" size="xl" onClose={onClose} footer={footer}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
      <div className="form-row" style={{ maxWidth: 420, marginBottom: '.7rem' }}>
        <label>Recepción</label>
        <select className="select" value={sel} onChange={(e) => void cargarSug(e.target.value)}>
          <option value="">— elegí una recepción cerrada —</option>
          {cierres.map((c) => <option key={c.id} value={`cierre:${c.id}`}>{c.grupo_nombre} · Cierre #{c.numero}</option>)}
        </select>
        <small className="muted" style={{ marginTop: '.25rem' }}>Se trae Peso Neto (seco), Prom SN y la tasa por procedencia; completá categoría y precinto. Incluye recepciones ya <strong>cerradas</strong>.</small>
      </div>
      {cargando ? <p className="muted">Leyendo recepción…</p> : filas.length > 0 && (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.8rem', margin: 0 }}>
            <thead><tr>
              <th style={{ textAlign: 'center' }}>✓</th>
              <th>PROCEDENCIA</th>
              <th style={{ textAlign: 'right' }}>PESO NETO</th>
              <th style={{ textAlign: 'right' }}>Tenor SN Prom%</th>
              <th style={{ textAlign: 'center' }}>CATEGORÍA</th>
              <th style={{ textAlign: 'center' }}>CANT.</th>
              <th>PRECINTO</th>
              <th style={{ textAlign: 'right' }}>TASA</th>
              <th style={{ textAlign: 'right' }}>PESO CASITERITA</th>
            </tr></thead>
            <tbody>
              {filas.map((f, i) => {
                const cant = (parseNum(f.cant) ?? 0) > 0 ? Math.floor(parseNum(f.cant) as number) : 1;
                const cas = calcPesoCasiterita(f.peso_neto_kgs, f.categoria, cant);
                return (
                  <tr key={f.procedencia + i} style={{ opacity: f.incluir ? 1 : 0.5 }}>
                    <td style={{ textAlign: 'center' }}><input type="checkbox" checked={f.incluir} onChange={(e) => setFila(i, { incluir: e.target.checked })} /></td>
                    <td style={{ fontWeight: 700, textTransform: 'uppercase' }}>{f.procedencia}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{n2(f.peso_neto_kgs)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{f.prom_sn != null ? `${n2(f.prom_sn)} %` : '—'}</td>
                    <td style={{ padding: 2 }}>
                      <select className="select" style={{ padding: '.2rem .3rem', fontSize: '.78rem' }} value={f.categoria} onChange={(e) => setFila(i, { categoria: e.target.value as CasiteritaCategoria })}>
                        {CAT_ORDEN.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: 2 }}><input className="input mono" style={{ width: 52, textAlign: 'center', padding: '.2rem .3rem' }} inputMode="numeric" value={f.cant} onChange={(e) => setFila(i, { cant: e.target.value })} /></td>
                    <td style={{ padding: 2 }}><input className="input" style={{ width: 90, padding: '.2rem .3rem' }} value={f.precinto} onChange={(e) => setFila(i, { precinto: e.target.value })} placeholder="precinto" /></td>
                    <td style={{ padding: 2 }}><input className="input mono" style={{ width: 72, textAlign: 'right', padding: '.2rem .3rem' }} inputMode="decimal" value={f.tasa} onChange={(e) => setFila(i, { tasa: e.target.value })} placeholder="0,00" /></td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{n2(cas)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!cargando && sel && !filas.length && <p className="muted">Esta recepción no tiene procedencias con peso/análisis.</p>}
    </Modal>
  );
}
