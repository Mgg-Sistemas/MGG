/* ============================================================
   MGG · Campos de la Colada (MGG-FR-001) para "INICIAR COLADA".
   Carga VISUAL (chips/toggles y números grandes), no el checkbox de papel.
   Captura: Identificación · Materias primas · Proceso · Temperaturas de carga.
   El control de temperatura horario, el sangrado y los resultados se cargan
   luego (en curso / al finalizar). El PDF replica el formato formal.
   ============================================================ */
import { useEffect, type CSSProperties } from 'react';
import type { ColadaDatos } from '@/shared/lib/types';

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
}

export function ColadaCampos({ coladaNum, setColadaNum, fecha, setFecha, datos, setDatos }: Props) {
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

  // Sn (kg) = Total Casiterita × Ley / 100.
  const snKg = round2(((Number(datos.total_casiterita) || 0) * (Number(datos.ley_sn) || 0)) / 100);
  useEffect(() => {
    set('sn_kg', snKg || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snKg]);

  const setBag = (i: number, patch: Partial<{ kg: number | null; precinto: string }>) =>
    setDatos((p) => {
      const arr = [...(p.big_bags ?? [])];
      arr[i] = { ...arr[i], ...patch };
      return { ...p, big_bags: arr };
    });
  const addBag = () => setDatos((p) => ({ ...p, big_bags: [...(p.big_bags ?? []), { kg: null, precinto: '' }] }));
  const delBag = (i: number) => setDatos((p) => ({ ...p, big_bags: (p.big_bags ?? []).filter((_, k) => k !== i) }));

  return (
    <div className="card" style={{ padding: '.85rem', margin: '.5rem 0 .2rem', borderLeft: '3px solid var(--primary)' }}>
      <div style={{ fontWeight: 700, marginBottom: '.6rem' }}>🔥 Reporte de colada <span className="muted" style={{ fontWeight: 400, fontSize: '.8rem' }}>· MGG-FR-001 (horno de fundición primaria)</span></div>

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
            <label>Turno</label>
            <input className="input" value={datos.turno ?? ''} onChange={(e) => set('turno', e.target.value)} placeholder="Ej.: 21,5 horas" />
          </div>
          <div className="form-row">
            <label>Responsable de colada</label>
            <input className="input" value={datos.responsable ?? ''} onChange={(e) => set('responsable', e.target.value)} placeholder="Nombre del responsable" />
          </div>
        </div>
      </div>

      {/* Materias primas */}
      <div style={secStyle}>
        <div style={tituloSec}>Materias primas</div>

        <label style={{ fontSize: '.8rem', fontWeight: 600 }}>Big bags de casiterita</label>
        <div style={{ display: 'grid', gap: '.4rem', margin: '.35rem 0 .5rem' }}>
          {bigBags.map((b, i) => (
            <div key={i} style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
              <span className="muted mono" style={{ width: 20 }}>{i + 1}</span>
              <input className="input mono" type="number" step="any" placeholder="kg" value={numVal(b.kg)} onChange={(e) => setBag(i, { kg: toNum(e.target.value) })} style={{ ...numInput, flex: '1 1 90px' }} />
              <input className="input" placeholder={`N° Precinto ${i + 1}`} value={b.precinto} onChange={(e) => setBag(i, { precinto: e.target.value })} style={{ flex: '2 1 130px' }} />
              {bigBags.length > 1 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => delBag(i)} style={{ color: 'var(--danger)' }}>✕</button>}
            </div>
          ))}
          <button type="button" className="btn btn-sm btn-ghost" onClick={addBag} style={{ alignSelf: 'start' }}>＋ Big bag</button>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Total Casiterita (kg)</label>
            <input className="input mono" type="number" step="any" value={numVal(datos.total_casiterita)} onChange={(e) => set('total_casiterita', toNum(e.target.value))} style={numInput} />
            <small className="muted" style={{ fontSize: '.7rem' }}>Σ big bags = {totalBigBags} kg</small>
          </div>
          <div className="form-row">
            <label>Ley de Sn / Tenor (%)</label>
            <input className="input mono" type="number" step="any" value={numVal(datos.ley_sn)} onChange={(e) => set('ley_sn', toNum(e.target.value))} style={numInput} />
            <small className="muted" style={{ fontSize: '.7rem' }}>Sn contenido ≈ <strong>{snKg} kg</strong></small>
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Coque (kg)</label>
            <input className="input mono" type="number" step="any" value={numVal(datos.coque_kg)} onChange={(e) => set('coque_kg', toNum(e.target.value))} style={numInput} />
          </div>
          <div className="form-row">
            <label>Proveedor de coque</label>
            <Chips value={datos.coque_proveedor} options={['CARBOMORCA', 'CIVCA']} onChange={(v) => set('coque_proveedor', v)} />
          </div>
        </div>
        <div className="form-row">
          <label>Granulometría coque</label>
          <Chips value={datos.coque_granulometria} options={['2–6 mm', '25–50 mm', '25–100 mm']} onChange={(v) => set('coque_granulometria', v)} />
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Otro fundente</label>
            <input className="input" value={datos.otro_fundente ?? ''} onChange={(e) => set('otro_fundente', e.target.value)} placeholder="Ej.: Pirulita" />
          </div>
          <div className="form-row">
            <label>Otro fundente (kg)</label>
            <input className="input mono" type="number" step="any" value={numVal(datos.otro_fundente_kg)} onChange={(e) => set('otro_fundente_kg', toNum(e.target.value))} style={numInput} />
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>CaCO₃ (tipo)</label>
            <input className="input" value={datos.caco3_tipo ?? ''} onChange={(e) => set('caco3_tipo', e.target.value)} placeholder="Ej.: Caliza" />
          </div>
          <div className="form-row">
            <label>CaCO₃ (kg)</label>
            <input className="input mono" type="number" step="any" value={numVal(datos.caco3_kg)} onChange={(e) => set('caco3_kg', toNum(e.target.value))} style={numInput} />
          </div>
        </div>
        <div className="form-row">
          <label>Granulometría CaCO₃ (malla)</label>
          <Chips value={datos.caco3_granulometria} options={['4', '6', '10', '20', '200']} onChange={(v) => set('caco3_granulometria', v)} />
        </div>
      </div>

      {/* Proceso */}
      <div style={secStyle}>
        <div style={tituloSec}>Proceso</div>
        <div className="form-row">
          <label>Modo de homogeneización</label>
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
            <label>Hora inicio de carga</label>
            <input className="input" value={datos.hora_inicio_carga ?? ''} onChange={(e) => set('hora_inicio_carga', e.target.value)} placeholder="Ej.: 20/03/26 6am" />
          </div>
          <div className="form-row">
            <label>Hora fin de carga</label>
            <input className="input" value={datos.hora_fin_carga ?? ''} onChange={(e) => set('hora_fin_carga', e.target.value)} placeholder="Ej.: 21/03/26 3am" />
          </div>
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
    </div>
  );
}
