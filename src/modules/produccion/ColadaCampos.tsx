/* ============================================================
   MGG · Campos de la Colada (MGG-FR-001) para "INICIAR COLADA".
   Carga VISUAL (chips/toggles y números grandes), no el checkbox de papel.
   Captura: Identificación · Materias primas · Proceso · Temperaturas de carga.
   El control de temperatura horario, el sangrado y los resultados se cargan
   luego (en curso / al finalizar). El PDF replica el formato formal.
   ============================================================ */
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import type { ColadaDatos, ColadaBigBag, ColadaBigBagLey } from '@/shared/lib/types';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import type { CasiteritaDetalle } from '@/modules/inventario/casiteritaDetalle.repository';
import { calcJornadaHoras, fmtJornada } from './colada.repository';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Grupo de chips seleccionables (una sola opción). */
function Chips({ value, options, onChange }: { value?: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
      {options.map((op) => {
        const active = (value ?? '') === op;
        return (
          <button key={op} type="button" onClick={() => onChange(active ? '' : op)}
            className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: 999 }}>
            {op}
          </button>
        );
      })}
    </div>
  );
}

/** Mini-tarjeta del resumen en vivo (etiqueta + valor). */
function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ flex: '1 1 120px', minWidth: 110, padding: '.25rem .5rem', borderRight: '1px solid var(--border)' }}>
      <div className="muted" style={{ fontSize: '.66rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div className="mono" style={{ fontSize: strong ? '1.05rem' : '.92rem', fontWeight: strong ? 800 : 600, color: strong ? 'var(--primary-3)' : undefined }}>{value}</div>
    </div>
  );
}

const secStyle: CSSProperties = { margin: '0 0 .8rem', padding: '.7rem .85rem', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-1)' };
const tituloSec: CSSProperties = { fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, color: 'var(--primary-3)', marginBottom: '.55rem' };
const numInput: CSSProperties = { textAlign: 'right' };

interface Props {
  coladaNum: string;
  setColadaNum: (v: string) => void;
  fecha: string;
  setFecha: (v: string) => void;
  datos: ColadaDatos;
  setDatos: (updater: (prev: ColadaDatos) => ColadaDatos) => void;
  /** Bloque de materiales (receta) que se renderiza unido, debajo de la casiterita (mismo bloque «Material a procesar»). */
  slotMaterial?: ReactNode;
  /** Inventario detallado de casiterita: para "traer" un big bag ya cargado (o dejarlo manual). */
  casiteritaDetalle?: CasiteritaDetalle[];
  /** Kg ya consumidos por OTRAS coladas, por id de big bag (disponible = peso − consumido). */
  consumoBigBags?: Map<string, number>;
}

export function ColadaCampos({ coladaNum, setColadaNum, fecha, setFecha, datos, setDatos, slotMaterial, casiteritaDetalle = [], consumoBigBags }: Props) {
  const set = <K extends keyof ColadaDatos>(key: K, val: ColadaDatos[K]) => setDatos((p) => ({ ...p, [key]: val }));
  const numVal = (v: number | null | undefined) => (v == null ? '' : String(v));
  const toNum = (s: string): number | null => (s.trim() === '' ? null : Number(s));

  const bigBags = datos.big_bags ?? [];
  const totalBigBags = round2(bigBags.reduce((a, b) => a + (Number(b.kg) || 0), 0));

  // Total Casiterita = Σ big bags (se mantiene en sync; editable manualmente igual).
  useEffect(() => {
    set('total_casiterita', totalBigBags || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalBigBags]);

  // Ley (prom) de un big bag = promedio de sus letras de laboratorio; si no cargó
  // letras, usa la ley que se escriba a mano (ley_prom).
  const promDe = (b: ColadaBigBag): number => {
    const vals = (b.leyes ?? []).map((l) => Number(l.valor)).filter((v) => Number.isFinite(v) && v > 0);
    if (vals.length) return round2(vals.reduce((a, v) => a + v, 0) / vals.length);
    return Number(b.ley_prom) || 0;
  };
  const pesoPuroDe = (b: ColadaBigBag): number => round2(((Number(b.kg) || 0) * promDe(b)) / 100);
  const costoDe = (b: ColadaBigBag): number => round2((Number(b.kg) || 0) * (Number(b.tasa) || 0));
  // Sn contenido (kg) = Σ peso puro; ley global = Sn ÷ casiterita × 100; costo = Σ (kg × tasa).
  const snTotal = round2(bigBags.reduce((a, b) => a + pesoPuroDe(b), 0));
  const costoCasiterita = round2(bigBags.reduce((a, b) => a + costoDe(b), 0));
  const leyGlobal = totalBigBags > 0 ? round2((snTotal / totalBigBags) * 100) : 0;
  useEffect(() => {
    set('sn_kg', snTotal || null);
    set('ley_sn', leyGlobal || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snTotal, leyGlobal]);

  // Jornada laboral = (fecha+hora fin) − (fecha+hora inicio) de la carga. Se calcula
  // sola y se copia al campo "Turno" (queda editable, igual que Total Casiterita).
  const jornadaH = calcJornadaHoras(datos.fecha_inicio_carga, datos.hora_inicio_carga, datos.fecha_fin_carga, datos.hora_fin_carga);
  useEffect(() => {
    set('jornada_horas', jornadaH);
    if (jornadaH != null) set('turno', `${String(jornadaH).replace('.', ',')} horas`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jornadaH]);

  const setBag = (i: number, patch: Partial<ColadaBigBag>) =>
    setDatos((p) => {
      const arr = [...(p.big_bags ?? [])];
      arr[i] = { ...arr[i], ...patch };
      return { ...p, big_bags: arr };
    });

  // ── Inventario detallado de casiterita: disponibilidad por big bag ──
  // Un big bag NO se puede usar dos veces, pero SÍ una parte: disponible = peso_casiterita
  // − consumido por otras coladas − lo ya tomado por otras bolsas de ESTA colada.
  const detalleById = new Map(casiteritaDetalle.map((d) => [d.id, d]));
  const consumido = (id: string) => Number(consumoBigBags?.get(id)) || 0;
  // Kg de ese big bag ya tomados por otras filas del formulario actual (excluye la fila `exclude`).
  const tomadoEnForm = (id: string, exclude: number) =>
    (datos.big_bags ?? []).reduce((a, b, k) => (k !== exclude && b.origen_detalle_id === id ? a + (Number(b.kg) || 0) : a), 0);
  // Disponible para una fila dada (lo que puede tomar esa bolsa como máximo).
  const disponiblePara = (id: string, exclude: number) => {
    const d = detalleById.get(id); if (!d) return 0;
    return round2(Math.max(0, round2(d.peso_casiterita_kgs) - consumido(id) - tomadoEnForm(id, exclude)));
  };

  // Opciones para la fila `i`: big bags con saldo disponible (+ el ya elegido en esa fila).
  const opcionesPara = (i: number) => casiteritaDetalle
    .filter((d) => disponiblePara(d.id, i) > 0.01 || bigBags[i]?.origen_detalle_id === d.id)
    .map((d) => {
      const disp = disponiblePara(d.id, i);
      const total = round2(d.peso_casiterita_kgs);
      const saldoTxt = disp < total ? ` · disp. ${disp} de ${total} kg` : ` · ${total} kg`;
      return {
        value: d.id,
        label: `${d.procedencia}${d.precinto ? ` · precinto ${d.precinto}` : ''}${saldoTxt}${d.prom_sn != null ? ` · ${round2(d.prom_sn)}%` : ''}${d.tasa != null ? ` · $${round2(d.tasa)}/kg` : ''}`,
      };
    });

  const traerDetalle = (i: number, id: string) => {
    if (!id) { setBag(i, { origen_detalle_id: null }); return; }
    const d = detalleById.get(id);
    if (!d) return;
    const disp = disponiblePara(id, i); // por defecto toma TODO el saldo disponible del big bag
    setBag(i, {
      origen_detalle_id: d.id,
      kg: disp || null,
      aliado: d.procedencia ?? '',
      precinto: d.precinto ?? '',
      analisis: d.n_analisis ?? '',
      ley_prom: d.prom_sn ?? null,
      tasa: d.tasa ?? null,
      leyes: [], // usa el promedio traído como ley manual del big bag
    });
  };
  // Cambio de kg de una bolsa traída del inventario: capea al disponible (no puede exceder el saldo).
  const setKgBag = (i: number) => (raw: string) => {
    const id = bigBags[i]?.origen_detalle_id;
    let v = toNum(raw);
    if (id && v != null) {
      const max = disponiblePara(id, i);
      if (v > max) v = max;
    }
    setBag(i, { kg: v });
  };
  const addBag = () => setDatos((p) => ({ ...p, big_bags: [...(p.big_bags ?? []), { kg: null, precinto: '', leyes: [] }] }));
  const delBag = (i: number) => setDatos((p) => ({ ...p, big_bags: (p.big_bags ?? []).filter((_, k) => k !== i) }));
  // Leyes de laboratorio (A, B, C…) por big bag.
  const setLey = (bi: number, li: number, patch: Partial<ColadaBigBagLey>) =>
    setDatos((p) => { const arr = [...(p.big_bags ?? [])]; const leyes = [...(arr[bi].leyes ?? [])]; leyes[li] = { ...leyes[li], ...patch }; arr[bi] = { ...arr[bi], leyes }; return { ...p, big_bags: arr }; });
  const addLey = (bi: number) =>
    setDatos((p) => { const arr = [...(p.big_bags ?? [])]; const leyes = [...(arr[bi].leyes ?? [])]; leyes.push({ letra: String.fromCharCode(65 + leyes.length), valor: null }); arr[bi] = { ...arr[bi], leyes }; return { ...p, big_bags: arr }; });
  const delLey = (bi: number, li: number) =>
    setDatos((p) => { const arr = [...(p.big_bags ?? [])]; const leyes = (arr[bi].leyes ?? []).filter((_, k) => k !== li); arr[bi] = { ...arr[bi], leyes }; return { ...p, big_bags: arr }; });

  // Lecturas de temperatura del proceso (tabla dinámica: cada ~1 h).
  const temperaturas = datos.temperaturas ?? [];
  const setTemp = (i: number, patch: Partial<(typeof temperaturas)[number]>) =>
    setDatos((p) => ({ ...p, temperaturas: (p.temperaturas ?? []).map((t, k) => k === i ? { ...t, ...patch } : t) }));
  const addTemp = () => setDatos((p) => ({ ...p, temperaturas: [...(p.temperaturas ?? []), { hora: '', temp_int: null, temp_ext: null, obs: '' }] }));
  const delTemp = (i: number) => setDatos((p) => ({ ...p, temperaturas: (p.temperaturas ?? []).filter((_, k) => k !== i) }));

  return (
    <div className="card" style={{ padding: '.85rem', margin: '.5rem 0 .2rem', borderLeft: '3px solid var(--primary)' }}>
      <div style={{ fontWeight: 700, marginBottom: '.6rem' }}>🔥 Reporte de colada <span className="muted" style={{ fontWeight: 400, fontSize: '.8rem' }}>· MGG-FR-001 (horno de fundición primaria)</span></div>

      {/* Resumen en vivo (fijo arriba): los totales calculados se ven mientras se carga. */}
      <div style={{ position: 'sticky', top: 0, zIndex: 3, display: 'flex', gap: '.45rem', flexWrap: 'wrap', padding: '.5rem .55rem', margin: '0 0 .75rem', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 2px 6px rgba(0,0,0,.15)' }}>
        <Stat label="Total casiterita" value={totalBigBags ? `${totalBigBags} kg` : '—'} />
        <Stat label="Ley global" value={leyGlobal ? `${leyGlobal.toFixed(2)} %` : '—'} strong />
        <Stat label="Sn contenido" value={snTotal ? `${snTotal} kg` : '—'} />
        <Stat label="Costo casiterita" value={costoCasiterita ? `$ ${costoCasiterita.toFixed(2)}` : '—'} />
        <Stat label="Jornada" value={jornadaH != null ? fmtJornada(jornadaH) : '—'} />
      </div>

      {/* Identificación */}
      <div style={secStyle}>
        <div style={tituloSec}>Identificación</div>
        <div className="form-grid">
          <div className="form-row">
            <label>Colada N°</label>
            <input className="input mono" value={coladaNum} onChange={(e) => setColadaNum(e.target.value)} placeholder="Ej.: 02" style={numInput} />
            <small className="muted" style={{ fontSize: '.7rem' }}>La 1ª vez la ingresás; luego se sugiere incremental.</small>
          </div>
          <div className="form-row">
            <label>Fecha de la colada</label>
            <input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Turno / Jornada</label>
            <input className="input" value={datos.turno ?? ''} onChange={(e) => set('turno', e.target.value)} placeholder="Ej.: 21,5 horas" />
            <small className="muted" style={{ fontSize: '.7rem' }}>Se calcula solo de las horas de carga (podés ajustarlo).</small>
          </div>
          <div className="form-row">
            <label>Responsable de colada</label>
            <input className="input" value={datos.responsable ?? ''} onChange={(e) => set('responsable', e.target.value)} placeholder="Nombre del responsable" />
          </div>
        </div>
      </div>

      {/* Casiterita — segmento por big bag: peso, aliado, precinto, análisis de
          laboratorio (letras A/B/C…), promedio, tasa de recepción y costo total.
          Los fundentes (coque, otro fundente, CaCO₃) van como insumos de la RECETA
          ("Materiales a utilizar" del modal), que se consumen del inventario. */}
      <div style={secStyle}>
        <div style={tituloSec}>Casiterita — big bags (ley, laboratorio y tasa por bolsa)</div>

        <div style={{ display: 'grid', gap: '.6rem' }}>
          {bigBags.map((b, i) => {
            const prom = promDe(b); const puro = pesoPuroDe(b); const costo = costoDe(b);
            return (
              <div key={i} className="card" style={{ padding: '.6rem .7rem', background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
                  <strong style={{ fontSize: '.82rem' }}>Big bag #{i + 1}</strong>
                  {bigBags.length > 1 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => delBag(i)} style={{ color: 'var(--danger)' }}>✕ Quitar</button>}
                </div>
                {/* Traer del inventario detallado de casiterita (o dejarlo manual). */}
                {casiteritaDetalle.length > 0 && (
                  <div className="form-row" style={{ marginBottom: '.4rem' }}>
                    <label>📦 Traer del inventario de casiterita <span className="muted" style={{ fontWeight: 400 }}>(opcional · autollena y controla el saldo)</span></label>
                    <SearchSelect
                      value={b.origen_detalle_id ?? ''}
                      onChange={(v) => traerDetalle(i, v)}
                      options={opcionesPara(i)}
                      placeholder="🔎 Elegí un big bag del inventario…"
                      emptyText="Sin big bags con saldo disponible."
                    />
                    <small className="muted" style={{ fontSize: '.7rem' }}>
                      {b.origen_detalle_id ? 'Traído del inventario — podés usar solo una parte; el saldo queda para otra colada.' : 'O cargá los datos a mano abajo. Un big bag no se puede usar dos veces, pero sí por partes.'}
                    </small>
                  </div>
                )}
                <div className="form-grid">
                  <div className="form-row">
                    <label>Peso casiterita (kg)</label>
                    <input className="input mono" type="number" step="any" value={numVal(b.kg)}
                      onChange={(e) => (b.origen_detalle_id ? setKgBag(i)(e.target.value) : setBag(i, { kg: toNum(e.target.value) }))}
                      style={numInput} />
                    {b.origen_detalle_id && (() => {
                      const d = detalleById.get(b.origen_detalle_id); if (!d) return null;
                      const total = round2(d.peso_casiterita_kgs);
                      const disp = disponiblePara(b.origen_detalle_id, i); // sin contar esta bolsa
                      const usa = Number(b.kg) || 0;
                      const pct = total > 0 ? round2((usa / total) * 100) : 0;
                      const queda = round2(Math.max(0, disp - usa));
                      return <small className="muted" style={{ fontSize: '.7rem' }}>Usás <strong>{usa} kg</strong> ({pct}% del big bag) · disponible hasta <strong>{round2(disp)} kg</strong> · quedará <strong>{queda} kg</strong> para otra colada.</small>;
                    })()}
                  </div>
                  <div className="form-row"><label>Aliado / centro de acopio</label><input className="input" value={b.aliado ?? ''} onChange={(e) => setBag(i, { aliado: e.target.value })} placeholder="Ej.: JUAN BODEGA" /></div>
                </div>
                <div className="form-grid">
                  <div className="form-row"><label>N° Precinto</label><input className="input" value={b.precinto} onChange={(e) => setBag(i, { precinto: e.target.value })} /></div>
                  <div className="form-row"><label>N° Análisis (laboratorio)</label><input className="input" value={b.analisis ?? ''} onChange={(e) => setBag(i, { analisis: e.target.value })} placeholder="Ej.: 2214, 2217, 2216" /></div>
                </div>
                <label style={{ fontSize: '.76rem', fontWeight: 600, display: 'block', margin: '.3rem 0 .2rem' }}>Sn de laboratorio (%) — por letra</label>
                <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {(b.leyes ?? []).map((l, li) => (
                    <div key={li} style={{ display: 'flex', alignItems: 'center', gap: '.2rem' }}>
                      <span className="mono muted" style={{ fontSize: '.74rem', width: 12 }}>{l.letra || String.fromCharCode(65 + li)}</span>
                      <input className="input mono" type="number" step="any" value={l.valor ?? ''} onChange={(e) => setLey(i, li, { valor: toNum(e.target.value) })} style={{ width: 76, textAlign: 'right' }} />
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => delLey(i, li)} style={{ color: 'var(--danger)', padding: '0 .3rem' }}>✕</button>
                    </div>
                  ))}
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => addLey(i)}>＋ Letra</button>
                  <span className="muted" style={{ fontSize: '.78rem' }}>Prom.: <strong className="mono">{prom ? prom.toFixed(2) + ' %' : '—'}</strong></span>
                </div>
                {!(b.leyes ?? []).length && (
                  <div className="form-row" style={{ marginTop: '.35rem', maxWidth: 220 }}>
                    <label>Ley / Prom. (%) — manual</label>
                    <input className="input mono" type="number" step="any" value={numVal(b.ley_prom)} onChange={(e) => setBag(i, { ley_prom: toNum(e.target.value) })} style={numInput} />
                  </div>
                )}
                <div className="form-grid" style={{ marginTop: '.35rem' }}>
                  <div className="form-row"><label>Tasa de recepción ($/kg)</label><input className="input mono" type="number" step="any" value={numVal(b.tasa)} onChange={(e) => setBag(i, { tasa: toNum(e.target.value) })} style={numInput} /></div>
                  <div className="form-row">
                    <label>Resultado (automático)</label>
                    <div className="mono" style={{ fontSize: '.8rem', lineHeight: 1.5 }}>
                      Peso puro Sn: <strong>{puro} kg</strong><br />
                      Costo total: <strong style={{ color: 'var(--primary-3)' }}>{costo ? '$ ' + costo.toFixed(2) : '—'}</strong>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <button type="button" className="btn btn-sm btn-ghost" onClick={addBag} style={{ alignSelf: 'start' }}>＋ Big bag</button>
        </div>

        <div className="form-grid" style={{ marginTop: '.6rem' }}>
          <div className="form-row">
            <label>Total Casiterita (kg)</label>
            <input className="input mono" type="number" step="any" value={numVal(datos.total_casiterita)} onChange={(e) => set('total_casiterita', toNum(e.target.value))} style={numInput} />
            <small className="muted" style={{ fontSize: '.7rem' }}>Σ big bags = {totalBigBags} kg</small>
          </div>
          <div className="form-row">
            <label>Ley global (%) — automática</label>
            <input className="input mono" readOnly value={leyGlobal ? leyGlobal.toFixed(2) : ''} style={{ ...numInput, background: 'var(--bg-2)', fontWeight: 700 }} />
            <small className="muted" style={{ fontSize: '.7rem' }}>Sn ≈ <strong>{snTotal} kg</strong> · Costo casiterita <strong>$ {costoCasiterita.toFixed(2)}</strong></small>
          </div>
        </div>
        <small className="muted" style={{ fontSize: '.72rem' }}>
          Los <strong>fundentes</strong> (coque, otro fundente, CaCO₃…) se cargan abajo, en el mismo bloque, y se consumen del inventario.
        </small>

        {/* Materiales / fundentes: unidos en el MISMO bloque, debajo de la casiterita */}
        {slotMaterial && <div style={{ marginTop: '.7rem', borderTop: '1px dashed var(--border)', paddingTop: '.6rem' }}>{slotMaterial}</div>}
      </div>

      {/* Fundentes (detalle del formato MGG-FR-001): coque, CaCO₃ y otro fundente,
          con proveedor y granulometrías. Es DESCRIPTIVO del formato; el descuento real
          del inventario se hace con la receta (materiales) del bloque de arriba. */}
      <div style={secStyle}>
        <div style={tituloSec}>Fundentes (detalle del formato)</div>
        <div className="form-grid">
          <div className="form-row"><label>Coque (kg)</label><input className="input mono" type="number" step="any" value={numVal(datos.coque_kg)} onChange={(e) => set('coque_kg', toNum(e.target.value))} style={numInput} /></div>
          <div className="form-row"><label>CaCO₃ (kg)</label><input className="input mono" type="number" step="any" value={numVal(datos.caco3_kg)} onChange={(e) => set('caco3_kg', toNum(e.target.value))} style={numInput} /></div>
        </div>
        <div className="form-row">
          <label>Proveedor de coque</label>
          <Chips value={datos.coque_proveedor} options={['CARBOMORCA', 'CIVCA']} onChange={(v) => set('coque_proveedor', v)} />
        </div>
        <div className="form-row">
          <label>Granulometría coque</label>
          <Chips value={datos.coque_granulometria} options={['2–6 mm', '25–50 mm', '25–100 mm']} onChange={(v) => set('coque_granulometria', v)} />
        </div>
        <div className="form-row">
          <label>Granulometría CaCO₃ (malla)</label>
          <Chips value={datos.caco3_granulometria} options={['4', '6', '10', '20', '200']} onChange={(v) => set('caco3_granulometria', v)} />
        </div>
        <div className="form-grid">
          <div className="form-row"><label>Otro fundente</label><input className="input" value={datos.otro_fundente ?? ''} onChange={(e) => set('otro_fundente', e.target.value)} placeholder="Ej.: PIRULITA" /></div>
          <div className="form-row"><label>Otro fundente (kg)</label><input className="input mono" type="number" step="any" value={numVal(datos.otro_fundente_kg)} onChange={(e) => set('otro_fundente_kg', toNum(e.target.value))} style={numInput} /></div>
        </div>
        <small className="muted" style={{ fontSize: '.72rem' }}>Describe los fundentes usados (van en el PDF del reporte). El <strong>descuento del inventario</strong> se hace con la receta de materiales del bloque de arriba.</small>
      </div>

      {/* Proceso */}
      <div style={secStyle}>
        <div style={tituloSec}>Proceso</div>
        <div className="form-row">
          <label>Modo de homogenización</label>
          <Chips value={datos.homogeneizacion} options={['Manual (pala)', 'Trompo hidráulico']} onChange={(v) => set('homogeneizacion', v)} />
        </div>
        <div className="form-row">
          <label>Modo de carga al horno</label>
          <Chips value={datos.carga_horno} options={['Manual (pala)', 'Minicargador (mini shower)']} onChange={(v) => set('carga_horno', v)} />
        </div>
      </div>

      {/* Temperaturas y tiempos — carga */}
      <div style={{ ...secStyle, marginBottom: 0 }}>
        <div style={tituloSec}>Temperaturas y tiempos — carga</div>
        <div className="form-grid">
          <div className="form-row">
            <label>Temp. int. al abrir (°C)</label>
            <input className="input mono" type="number" step="any" value={numVal(datos.temp_int_abrir)} onChange={(e) => set('temp_int_abrir', toNum(e.target.value))} style={numInput} />
          </div>
          <div className="form-row">
            <label>Temp. ext. al abrir (°C)</label>
            <input className="input mono" type="number" step="any" value={numVal(datos.temp_ext_abrir)} onChange={(e) => set('temp_ext_abrir', toNum(e.target.value))} style={numInput} />
          </div>
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Fecha inicio de carga</label>
            <input className="input" type="date" value={datos.fecha_inicio_carga ?? ''} onChange={(e) => set('fecha_inicio_carga', e.target.value)} />
          </div>
          <div className="form-row">
            <label>Hora inicio de carga</label>
            <input className="input" type="time" value={datos.hora_inicio_carga ?? ''} onChange={(e) => set('hora_inicio_carga', e.target.value)} />
          </div>
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Fecha fin de carga</label>
            <input className="input" type="date" value={datos.fecha_fin_carga ?? ''} onChange={(e) => set('fecha_fin_carga', e.target.value)} />
          </div>
          <div className="form-row">
            <label>Hora fin de carga</label>
            <input className="input" type="time" value={datos.hora_fin_carga ?? ''} onChange={(e) => set('hora_fin_carga', e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <label>Jornada laboral (automática)</label>
          <input className="input mono" readOnly value={fmtJornada(jornadaH)} style={{ background: 'var(--bg-2)', fontWeight: 700 }} />
          <small className="muted" style={{ fontSize: '.7rem' }}>Fin − Inicio de carga.</small>
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Temp. int. al cerrar (°C)</label>
            <input className="input mono" type="number" step="any" value={numVal(datos.temp_int_cerrar)} onChange={(e) => set('temp_int_cerrar', toNum(e.target.value))} style={numInput} />
          </div>
          <div className="form-row">
            <label>Temp. ext. al cerrar (°C)</label>
            <input className="input mono" type="number" step="any" value={numVal(datos.temp_ext_cerrar)} onChange={(e) => set('temp_ext_cerrar', toNum(e.target.value))} style={numInput} />
          </div>
        </div>
      </div>

      {/* Control de temperatura del proceso — lecturas dinámicas */}
      <details style={{ ...secStyle, marginTop: '.8rem', marginBottom: 0 }} open={temperaturas.length > 0}>
        <summary style={{ ...tituloSec, marginBottom: 0, cursor: 'pointer' }}>Lecturas de temperatura del proceso (cada ~1 h · se puede llenar durante la colada)</summary>
        <div style={{ marginTop: '.55rem' }}>
          <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table className="table" style={{ fontSize: '.8rem' }}>
              <thead>
                <tr>
                  <th style={{ width: 24 }}>N°</th>
                  <th>Hora</th>
                  <th style={{ textAlign: 'right' }}>T. int. (°C)</th>
                  <th style={{ textAlign: 'right' }}>T. ext. (°C)</th>
                  <th>Observación / acción</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {temperaturas.map((t, i) => (
                  <tr key={i}>
                    <td className="mono">{i + 1}</td>
                    <td><input className="input" value={t.hora ?? ''} onChange={(e) => setTemp(i, { hora: e.target.value })} placeholder="HH:MM" style={{ minWidth: 72 }} /></td>
                    <td style={{ textAlign: 'right' }}><input className="input mono" type="number" step="any" value={t.temp_int ?? ''} onChange={(e) => setTemp(i, { temp_int: toNum(e.target.value) })} style={{ ...numInput, width: 84 }} /></td>
                    <td style={{ textAlign: 'right' }}><input className="input mono" type="number" step="any" value={t.temp_ext ?? ''} onChange={(e) => setTemp(i, { temp_ext: toNum(e.target.value) })} style={{ ...numInput, width: 84 }} /></td>
                    <td><input className="input" value={t.obs ?? ''} onChange={(e) => setTemp(i, { obs: e.target.value })} placeholder="Observación / acción" /></td>
                    <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => delTemp(i)} style={{ color: 'var(--danger)' }}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={addTemp} style={{ marginTop: '.4rem' }}>＋ Lectura de temperatura</button>
        </div>
      </details>
    </div>
  );
}
