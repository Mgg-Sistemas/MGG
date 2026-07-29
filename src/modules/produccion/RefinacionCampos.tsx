/* ============================================================
   MGG · Campos de la Refinación (MGG-FR-002) para "MATERIAL A REFINAR".
   Práctico y dinámico: el estaño crudo se TRAE de varias coladas finalizadas
   (suma automática), los reactivos se cargan en la checklist de materiales del
   modal, y las etapas de temperatura son una tabla dinámica. Los resultados y
   el balance de masa se cargan al finalizar. El PDF replica el formato formal.
   ============================================================ */
import { useEffect, type CSSProperties } from 'react';
import { num } from '@/shared/lib/format';
import type { RefinacionColadaOrigen, RefinacionDatos } from '@/shared/lib/types';
import type { ColadaFinalizada } from './refinacion.repository';

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
  refinacionNum: string;
  setRefinacionNum: (v: string) => void;
  fecha: string;
  setFecha: (v: string) => void;
  datos: RefinacionDatos;
  setDatos: (updater: (prev: RefinacionDatos) => RefinacionDatos) => void;
  /** Coladas finalizadas disponibles como origen de estaño crudo. */
  coladasFin: ColadaFinalizada[];
}

export function RefinacionCampos({ refinacionNum, setRefinacionNum, fecha, setFecha, datos, setDatos, coladasFin }: Props) {
  const set = <K extends keyof RefinacionDatos>(key: K, val: RefinacionDatos[K]) => setDatos((p) => ({ ...p, [key]: val }));
  const numVal = (v: number | null | undefined) => (v == null ? '' : String(v));
  const toNum = (s: string): number | null => (s.trim() === '' ? null : Number(s));

  const coladas = datos.coladas ?? [];
  const selIds = new Set(coladas.map((c) => c.produccion_id));
  const crudoTotal = round2(coladas.reduce((a, c) => a + (Number(c.estano_kg) || 0), 0));

  // Estaño Crudo Cargado = Σ coladas seleccionadas (se mantiene en sync; editable).
  useEffect(() => {
    set('estano_crudo_kg', crudoTotal || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crudoTotal]);

  function toggleColada(c: ColadaFinalizada) {
    setDatos((p) => {
      const arr = [...(p.coladas ?? [])];
      const i = arr.findIndex((x) => x.produccion_id === c.produccion_id);
      if (i >= 0) { arr.splice(i, 1); }
      else {
        const nueva: RefinacionColadaOrigen = {
          produccion_id: c.produccion_id, colada_num: c.colada_num, fecha: c.fecha,
          producto_id: c.producto_id, producto_nombre: c.producto_nombre, almacen: c.almacen,
          estano_kg: c.estano_kg, costo_unitario: c.costo_unitario,
        };
        arr.push(nueva);
      }
      return { ...p, coladas: arr };
    });
  }
  function setColadaKg(produccionId: string, kg: number) {
    setDatos((p) => ({ ...p, coladas: (p.coladas ?? []).map((c) => c.produccion_id === produccionId ? { ...c, estano_kg: kg } : c) }));
  }

  // Etapas de temperatura (tabla dinámica).
  const etapas = datos.etapas ?? [];
  const setEtapa = (i: number, patch: Partial<(typeof etapas)[number]>) =>
    setDatos((p) => ({ ...p, etapas: (p.etapas ?? []).map((e, k) => k === i ? { ...e, ...patch } : e) }));
  const addEtapa = () => setDatos((p) => ({ ...p, etapas: [...(p.etapas ?? []), { etapa: '', hora: '', temp_bano: null, temp_quemador: null, accion: '' }] }));
  const delEtapa = (i: number) => setDatos((p) => ({ ...p, etapas: (p.etapas ?? []).filter((_, k) => k !== i) }));

  return (
    <div className="card" style={{ padding: '.85rem', margin: '.5rem 0 .2rem', borderLeft: '3px solid var(--primary)' }}>
      <div style={{ fontWeight: 700, marginBottom: '.6rem' }}>⚗️ Reporte de refinación <span className="muted" style={{ fontWeight: 400, fontSize: '.8rem' }}>· MGG-FR-002 (lingotes de estaño)</span></div>

      {/* Identificación */}
      <div style={secStyle}>
        <div style={tituloSec}>Identificación del lote / proceso</div>
        <div className="form-grid">
          <div className="form-row">
            <label>Lote de Refinación N°</label>
            <input className="input mono" value={refinacionNum} onChange={(e) => setRefinacionNum(e.target.value)} placeholder="Ej.: 01" style={numInput} />
            <small className="muted" style={{ fontSize: '.7rem' }}>La 1ª vez la ingresás; luego se sugiere incremental.</small>
          </div>
          <div className="form-row">
            <label>Fecha de proceso</label>
            <input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Turno</label>
            <Chips value={datos.turno} options={['Mañana', 'Tarde', 'Noche']} onChange={(v) => set('turno', v)} />
          </div>
          <div className="form-row">
            <label>N° Horno / Olla de refinación</label>
            <input className="input" value={datos.n_horno_olla ?? ''} onChange={(e) => set('n_horno_olla', e.target.value)} placeholder="Ej.: 01 - Refinación" />
          </div>
        </div>
        <div className="form-row">
          <label>Responsable de refinación</label>
          <input className="input" value={datos.responsable ?? ''} onChange={(e) => set('responsable', e.target.value)} placeholder="Nombre del responsable" />
        </div>
      </div>

      {/* Origen del estaño crudo — selección de coladas */}
      <div style={secStyle}>
        <div style={tituloSec}>Origen del estaño crudo · coladas primarias</div>
        {!coladasFin.length ? (
          <div className="muted" style={{ fontSize: '.82rem', padding: '.25rem 0' }}>
            No hay coladas de fundición finalizadas para tomar como estaño crudo. Finalizá una colada primero.
          </div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead>
                <tr>
                  <th></th>
                  <th>Colada</th>
                  <th>Producto · almacén</th>
                  <th style={{ textAlign: 'right' }}>Obtenido</th>
                  <th style={{ textAlign: 'right' }}>Kg a tomar</th>
                </tr>
              </thead>
              <tbody>
                {coladasFin.map((c) => {
                  const sel = selIds.has(c.produccion_id);
                  const tomado = coladas.find((x) => x.produccion_id === c.produccion_id)?.estano_kg ?? c.estano_kg;
                  return (
                    <tr key={c.produccion_id} style={sel ? { background: 'rgba(255,138,0,0.06)' } : undefined}>
                      <td><input type="checkbox" checked={sel} onChange={() => toggleColada(c)} /></td>
                      <td><strong>#{c.colada_num || '—'}</strong>{c.fecha ? <div className="muted" style={{ fontSize: '.7rem' }}>{c.fecha}</div> : null}</td>
                      <td>{c.producto_nombre}<div className="muted" style={{ fontSize: '.7rem' }}>{c.almacen}</div></td>
                      <td className="mono" style={{ textAlign: 'right' }}>{num(c.estano_kg)} kg</td>
                      <td style={{ textAlign: 'right' }}>
                        <input className="input mono" type="number" min={0} step="any" style={{ width: 90, textAlign: 'right' }}
                          value={sel ? String(tomado) : ''} disabled={!sel}
                          onChange={(e) => setColadaKg(c.produccion_id, Number(e.target.value) || 0)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="form-grid" style={{ marginTop: '.5rem' }}>
          <div className="form-row">
            <label>Estaño crudo cargado (kg)</label>
            <input className="input mono" type="number" step="any" value={numVal(datos.estano_crudo_kg)} onChange={(e) => set('estano_crudo_kg', toNum(e.target.value))} style={numInput} />
            <small className="muted" style={{ fontSize: '.7rem' }}>Σ coladas seleccionadas = <strong>{crudoTotal} kg</strong></small>
          </div>
          <div className="form-row">
            <label>Pureza inicial estimada (% Sn)</label>
            <input className="input mono" type="number" step="any" value={numVal(datos.pureza_inicial)} onChange={(e) => set('pureza_inicial', toNum(e.target.value))} style={numInput} />
          </div>
        </div>
        <small className="muted" style={{ fontSize: '.72rem' }}>
          Los <strong>agentes refinantes / reactivos</strong> (azufre, soda cáustica, carbón, cal, Al/Zn…) se cargan abajo en <strong>«Materiales a utilizar»</strong> (se consumen del inventario).
        </small>
      </div>

      {/* Parámetros de operación */}
      <div style={secStyle}>
        <div style={tituloSec}>Parámetros de operación y proceso</div>
        <div className="form-row">
          <label>Método de agitación</label>
          <Chips value={datos.metodo_agitacion} options={['Mecánica (hélice)', 'Neumática (aire/gas)', 'Manual (pala)']} onChange={(v) => set('metodo_agitacion', v)} />
        </div>
        <div className="form-row">
          <label>Sistema de desespumado / descoriado</label>
          <Chips value={datos.desespumado} options={['Raspado manual de dross', 'Separador mecánico']} onChange={(v) => set('desespumado', v)} />
        </div>
      </div>

      {/* Control de temperatura y etapas */}
      <details style={{ ...secStyle, marginBottom: 0 }}>
        <summary style={{ ...tituloSec, marginBottom: 0, cursor: 'pointer' }}>Control de temperatura y etapas (opcional · se puede llenar durante el proceso)</summary>
        <div style={{ marginTop: '.55rem' }}>
          <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table className="table" style={{ fontSize: '.8rem' }}>
              <thead>
                <tr>
                  <th style={{ width: 24 }}>N°</th>
                  <th>Hora</th>
                  <th style={{ textAlign: 'right' }}>T. baño (°C)</th>
                  <th style={{ textAlign: 'right' }}>T. quemador (°C)</th>
                  <th>Acción / reactivo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {etapas.map((et, i) => (
                  <tr key={i}>
                    <td className="mono">{i + 1}</td>
                    <td><input className="input" value={et.hora ?? ''} onChange={(e) => setEtapa(i, { hora: e.target.value })} placeholder="HH:MM" style={{ minWidth: 72 }} /></td>
                    <td style={{ textAlign: 'right' }}><input className="input mono" type="number" step="any" value={et.temp_bano ?? ''} onChange={(e) => setEtapa(i, { temp_bano: toNum(e.target.value) })} style={{ ...numInput, width: 84 }} /></td>
                    <td style={{ textAlign: 'right' }}><input className="input mono" type="number" step="any" value={et.temp_quemador ?? ''} onChange={(e) => setEtapa(i, { temp_quemador: toNum(e.target.value) })} style={{ ...numInput, width: 84 }} /></td>
                    <td><input className="input" value={et.accion ?? ''} onChange={(e) => setEtapa(i, { accion: e.target.value })} placeholder="Acción operativa / reactivo añadido" /></td>
                    <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => delEtapa(i)} style={{ color: 'var(--danger)' }}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={addEtapa} style={{ marginTop: '.4rem' }}>＋ Etapa</button>
        </div>
      </details>
    </div>
  );
}
