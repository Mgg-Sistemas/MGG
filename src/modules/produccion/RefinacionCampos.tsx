/* ============================================================
   MGG · Campos de la Refinación (MGG-FR-002) para "MATERIAL A REFINAR".
   Práctico y dinámico: el estaño crudo se TRAE de varias coladas finalizadas
   (suma automática), los reactivos se cargan en la checklist de materiales del
   modal, y las etapas de temperatura son una tabla dinámica. Los resultados y
   el balance de masa se cargan al finalizar. El PDF replica el formato formal.
   ============================================================ */
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { num, money } from '@/shared/lib/format';
import type { RefinacionColadaOrigen, RefinacionDatos, ColadaCargaExtra } from '@/shared/lib/types';
import type { ColadaFinalizada } from './refinacion.repository';
import { calcJornadaHoras, fmtJornada } from './colada.repository';
import { listaPrecintos, resumenPrecintos } from './precintosOrigen';
import { HoraInput } from '@/shared/ui/HoraInput';
import { CampoCatalogo } from '@/shared/ui/CampoCatalogo';

const round2 = (n: number) => Math.round(n * 100) / 100;
let _manualSeq = 0;
const nextManualId = () => `manual-${++_manualSeq}-${Math.round(Math.random() * 1e6)}`;

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
  /** Bloque de reactivos/insumos que se renderiza unido, debajo del origen (mismo bloque «Material a procesar»). */
  slotMaterial?: ReactNode;
  /**
   * Los insumos marcados en «Materiales a utilizar (receta)».
   *
   * Se vuelven a mostrar en cada carga a la olla, para decir cuánto de cada uno
   * entró en esa vuelta sin volver a escribir los nombres.
   */
  materialesReceta?: Array<{ nombre: string; unidad?: string | null }>;
}

export function RefinacionCampos({ refinacionNum, setRefinacionNum, fecha, setFecha, datos, setDatos, coladasFin, slotMaterial, materialesReceta = [] }: Props) {
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
          origen: c.origen, etiqueta: c.etiqueta,
          // El precinto se COPIA al elegir el origen, no se lee después de la
          // colada: este reporte se firma, y si mañana alguien corrige un
          // precinto allá, lo firmado tiene que seguir diciendo lo que decía.
          precintos: c.precintos ?? [],
        };
        arr.push(nueva);
      }
      return { ...p, coladas: arr };
    });
  }
  function setColadaKg(produccionId: string, kg: number) {
    setDatos((p) => ({ ...p, coladas: (p.coladas ?? []).map((c) => c.produccion_id === produccionId ? { ...c, estano_kg: kg } : c) }));
  }
  function setColadaCosto(produccionId: string, costo: number) {
    setDatos((p) => ({ ...p, coladas: (p.coladas ?? []).map((c) => c.produccion_id === produccionId ? { ...c, costo_unitario: costo } : c) }));
  }
  // Líneas MANUALES de material a refinar (sin colada de origen): kg + costo inicial.
  function addManual() {
    const nueva: RefinacionColadaOrigen = {
      produccion_id: nextManualId(), colada_num: 0, fecha: '',
      producto_id: null, producto_nombre: '', almacen: 'Manual',
      estano_kg: 0, costo_unitario: 0, origen: 'manual', etiqueta: '',
    };
    setDatos((p) => ({ ...p, coladas: [...(p.coladas ?? []), nueva] }));
  }
  function setManual(produccionId: string, patch: Partial<RefinacionColadaOrigen>) {
    setDatos((p) => ({ ...p, coladas: (p.coladas ?? []).map((c) => c.produccion_id === produccionId ? { ...c, ...patch } : c) }));
  }
  function delManual(produccionId: string) {
    setDatos((p) => ({ ...p, coladas: (p.coladas ?? []).filter((c) => c.produccion_id !== produccionId) }));
  }
  // La refinación se archiva con la fecha en que EMPEZÓ la jornada: un solo
  // campo manda, no dos que pueden discrepar.
  useEffect(() => {
    const f = (datos.fecha_inicio_jornada ?? '').trim();
    if (f && f !== fecha) setFecha(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos.fecha_inicio_jornada]);

  const manuales = coladas.filter((c) => c.origen === 'manual');
  const costoInicialTotal = round2(coladas.reduce((a, c) => a + (Number(c.estano_kg) || 0) * (Number(c.costo_unitario) || 0), 0));

  // Jornada de refinación = (fecha+hora fin) − (fecha+hora inicio). Se calcula sola
  // y se copia al campo "Turno" (queda editable), igual que en la colada.
  const jornadaH = calcJornadaHoras(datos.fecha_inicio_jornada, datos.hora_inicio_jornada, datos.fecha_fin_jornada, datos.hora_fin_jornada);
  useEffect(() => {
    set('jornada_horas', jornadaH);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jornadaH]);

  /* Cargas a la olla: las vueltas EXTRA de material, cada una con su horario y
     cuánto entró de cada insumo de la receta. La primera está arriba, en el
     inicio de jornada. */
  const cargas = datos.cargas ?? [];
  const setCarga = (i: number, patch: Partial<ColadaCargaExtra>) =>
    setDatos((p) => ({ ...p, cargas: (p.cargas ?? []).map((c, k) => (k === i ? { ...c, ...patch } : c)) }));
  const addCarga = () => setDatos((p) => ({
    ...p,
    cargas: [...(p.cargas ?? []), { fecha: p.fecha_inicio_jornada ?? '', hora_inicio: '', hora_fin: '', materiales: [], obs: '' }],
  }));
  const delCarga = (i: number) => setDatos((p) => ({ ...p, cargas: (p.cargas ?? []).filter((_, k) => k !== i) }));
  const kgDe = (c: ColadaCargaExtra, nombre: string): string => {
    const v = (c.materiales ?? []).find((m) => m.nombre === nombre)?.kg;
    return v == null ? '' : String(v);
  };
  const setKgDe = (i: number, nombre: string, raw: string) => {
    const kg = toNum(raw);
    setCarga(i, {
      materiales: (() => {
        const lista = [...(cargas[i]?.materiales ?? [])];
        const k = lista.findIndex((m) => m.nombre === nombre);
        if (kg == null) { if (k >= 0) lista.splice(k, 1); return lista; }
        if (k >= 0) lista[k] = { nombre, kg }; else lista.push({ nombre, kg });
        return lista;
      })(),
    });
  };
  const horasDeCarga = (c: ColadaCargaExtra): number | null =>
    calcJornadaHoras(c.fecha ?? '', c.hora_inicio ?? '', c.fecha ?? '', c.hora_fin ?? '');
  const horasCargas = cargas.reduce((a, c) => a + (horasDeCarga(c) ?? 0), 0);

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
          {/* Igual que en la colada: la fecha del proceso es la del inicio de
              jornada, que se carga más abajo. Se muestra, no se vuelve a pedir. */}
          <div className="form-row">
            <label>Fecha de proceso</label>
            <input className="input" readOnly value={fecha ? fecha.split('-').reverse().join('/') : '—'}
              style={{ background: 'var(--bg-2)', fontWeight: 700 }} />
            <small className="muted" style={{ fontSize: '.7rem' }}>Sale de la <strong>fecha de inicio de jornada</strong>, más abajo.</small>
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

      {/* Material a procesar — origen (coladas / 2ª refinación / manual) + reactivos, todo en UN bloque */}
      <div style={secStyle}>
        <div style={tituloSec}>Material a procesar · origen del estaño a refinar (coladas, 2ª refinación o manual)</div>
        <div className="table-wrap" style={{ maxHeight: 240, overflowY: 'auto' }}>
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead>
              <tr>
                <th></th>
                <th>Origen</th>
                <th>Producto · almacén</th>
                <th style={{ textAlign: 'right' }}>Disponible</th>
                <th style={{ textAlign: 'right' }}>Kg a tomar</th>
                <th style={{ textAlign: 'right' }}>Costo inicial ($/kg)</th>
              </tr>
            </thead>
            <tbody>
              {coladasFin.map((c) => {
                const sel = selIds.has(c.produccion_id);
                const selRow = coladas.find((x) => x.produccion_id === c.produccion_id);
                const tomado = selRow?.estano_kg ?? c.estano_kg;
                const costo = selRow?.costo_unitario ?? c.costo_unitario;
                const esReRef = c.origen === 'refinacion';
                return (
                  <tr key={c.produccion_id} style={sel ? { background: 'rgba(255,138,0,0.06)' } : undefined}>
                    <td><input type="checkbox" checked={sel} disabled={!sel && c.estano_kg <= 0} onChange={() => toggleColada(c)} /></td>
                    <td>
                      <strong>{esReRef ? '♻ ' : ''}{c.etiqueta ?? `#${c.colada_num || '—'}`}</strong>
                      {esReRef && <span className="badge" style={{ marginLeft: '.35rem', fontSize: '.62rem', background: 'var(--primary)', color: '#1a1205', fontWeight: 700 }}>2ª refinación</span>}
                      {c.fecha ? <div className="muted" style={{ fontSize: '.7rem' }}>{c.fecha}</div> : null}
                      {/* El precinto es lo único que identifica físicamente el bulto:
                          sin esto hay que abrir la colada para saber de qué saco salió. */}
                      {(c.precintos?.length ?? 0) > 0 && (
                        <div style={{ fontSize: '.7rem', color: 'var(--primary-3)', fontWeight: 600 }}
                          title={`${esReRef ? 'Precinto del lote refinado' : 'Precintos de los big bags de casiterita'}: ${listaPrecintos(c.precintos ?? [])}`}>
                          🏷 {resumenPrecintos(c.precintos ?? [])}
                        </div>
                      )}
                    </td>
                    <td>{c.producto_nombre}<div className="muted" style={{ fontSize: '.7rem' }}>{c.almacen}</div></td>
                    <td className="mono" style={{ textAlign: 'right' }}>
                      {num(c.estano_kg)} kg
                      {/* El inventario manda: si se corrigió, se avisa cuánto dio el proceso. */}
                      {c.producido_kg != null && c.producido_kg > c.estano_kg && (
                        <div className="muted" style={{ fontSize: '.68rem', fontWeight: 400 }}>
                          el proceso dio {num(c.producido_kg)} · inventario corregido
                        </div>
                      )}
                      {c.estano_kg <= 0 && <div style={{ fontSize: '.68rem', color: 'var(--danger)', fontWeight: 400 }}>sin stock</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input className="input mono" type="number" min={0} max={c.estano_kg} step="any" style={{ width: 88, textAlign: 'right' }}
                        value={sel ? String(tomado) : ''} disabled={!sel || c.estano_kg <= 0}
                        title={`Máximo ${num(c.estano_kg)} kg: es lo que hay en ${c.almacen}`}
                        onChange={(e) => setColadaKg(c.produccion_id, Math.min(Number(e.target.value) || 0, c.estano_kg))} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input className="input mono" type="number" min={0} step="any" style={{ width: 88, textAlign: 'right' }}
                        value={sel ? String(costo) : ''} disabled={!sel}
                        onChange={(e) => setColadaCosto(c.produccion_id, Number(e.target.value) || 0)} />
                    </td>
                  </tr>
                );
              })}
              {manuales.map((c) => (
                <tr key={c.produccion_id} style={{ background: 'rgba(80,140,255,0.06)' }}>
                  <td title="Material manual" style={{ textAlign: 'center' }}>✎</td>
                  <td colSpan={2}>
                    <input className="input" placeholder="Descripción (ej. estaño externo)" value={c.etiqueta ?? ''}
                      onChange={(e) => setManual(c.produccion_id, { etiqueta: e.target.value, producto_nombre: e.target.value })} style={{ minWidth: 150 }} />
                    <span className="badge" style={{ marginLeft: '.35rem', fontSize: '.62rem', background: '#508cff', color: '#fff', fontWeight: 700 }}>manual</span>
                  </td>
                  <td className="mono muted" style={{ textAlign: 'right' }}>—</td>
                  <td style={{ textAlign: 'right' }}>
                    <input className="input mono" type="number" min={0} step="any" style={{ width: 88, textAlign: 'right' }}
                      value={String(c.estano_kg ?? 0)} onChange={(e) => setManual(c.produccion_id, { estano_kg: Number(e.target.value) || 0 })} />
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <input className="input mono" type="number" min={0} step="any" style={{ width: 76, textAlign: 'right' }}
                      value={String(c.costo_unitario ?? 0)} onChange={(e) => setManual(c.produccion_id, { costo_unitario: Number(e.target.value) || 0 })} />
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => delManual(c.produccion_id)} style={{ color: 'var(--danger)', padding: '0 .3rem' }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!coladasFin.length && !manuales.length && (
          <div className="muted" style={{ fontSize: '.8rem', padding: '.25rem 0' }}>
            No hay coladas ni refinaciones finalizadas. Podés cargar material a refinar a mano con «＋ Añadir material manual».
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '.4rem', flexWrap: 'wrap', gap: '.4rem' }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={addManual}>＋ Añadir material manual</button>
          <span className="muted mono" style={{ fontSize: '.78rem' }}>Costo inicial total: <strong style={{ color: 'var(--primary-3)' }}>{money(costoInicialTotal)}</strong></span>
        </div>
        <div className="form-grid" style={{ marginTop: '.5rem' }}>
          <div className="form-row">
            <label>Estaño crudo cargado (kg)</label>
            <input className="input mono" type="number" step="any" value={numVal(datos.estano_crudo_kg)} onChange={(e) => set('estano_crudo_kg', toNum(e.target.value))} style={numInput} />
            <small className="muted" style={{ fontSize: '.7rem' }}>Σ seleccionadas + manuales = <strong>{crudoTotal} kg</strong></small>
          </div>
          <div className="form-row">
            <label>Pureza inicial estimada (% Sn)</label>
            <input className="input mono" type="number" step="any" value={numVal(datos.pureza_inicial)} onChange={(e) => set('pureza_inicial', toNum(e.target.value))} style={numInput} />
          </div>
        </div>

        {/* Reactivos / insumos: unidos en el MISMO bloque, debajo del origen */}
        {slotMaterial && <div style={{ marginTop: '.7rem', borderTop: '1px dashed var(--border)', paddingTop: '.6rem' }}>{slotMaterial}</div>}
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
        <CampoCatalogo
          scope="proveedor_coque"
          label="Proveedor del coque"
          value={datos.coque_proveedor}
          onChange={(v) => set('coque_proveedor', v)}
          placeholderNuevo="¿Otro proveedor? Escribilo y añadilo"
          ayuda="Sale en el PDF de la refinación. Es el mismo catálogo que usa Fundición." />
      </div>

      {/* Jornada de refinación (inicio/fin + total automático) */}
      <div style={secStyle}>
        <div style={tituloSec}>Jornada de refinación</div>
        <div className="form-grid">
          <div className="form-row">
            <label>Fecha inicio de jornada</label>
            <input className="input" type="date" value={datos.fecha_inicio_jornada ?? ''} onChange={(e) => set('fecha_inicio_jornada', e.target.value)} />
          </div>
          <div className="form-row">
            <label>Hora inicio de jornada</label>
            <input className="input" type="time" value={datos.hora_inicio_jornada ?? ''} onChange={(e) => set('hora_inicio_jornada', e.target.value)} />
          </div>
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Fecha fin de jornada</label>
            <input className="input" type="date" value={datos.fecha_fin_jornada ?? ''} onChange={(e) => set('fecha_fin_jornada', e.target.value)} />
          </div>
          <div className="form-row">
            <label>Hora fin de jornada</label>
            <input className="input" type="time" value={datos.hora_fin_jornada ?? ''} onChange={(e) => set('hora_fin_jornada', e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <label>Total de jornada (automático)</label>
          <input className="input mono" readOnly value={fmtJornada(jornadaH)} style={{ background: 'var(--bg-2)', fontWeight: 700 }} />
          <small className="muted" style={{ fontSize: '.7rem' }}>Fin − Inicio de jornada.</small>
        </div>
      </div>

      {/* Cargas a la olla: las vueltas extra de material */}
      <div style={{ ...secStyle }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <div style={tituloSec}>Cargas a la olla <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· las vueltas extra de material</span></div>
          {cargas.length > 0 && (
            <span className="mono muted" style={{ fontSize: '.76rem' }}>{cargas.length} carga(s) · {fmtJornada(horasCargas || null)}</span>
          )}
        </div>
        <p className="hint muted" style={{ fontSize: '.76rem', margin: '0 0 .5rem' }}>
          La primera vuelta ya está arriba, en <strong>inicio de jornada</strong>. Acá se agregan las que siguen:
          cada una con <strong>su horario</strong> y <strong>cuánto entró de cada insumo</strong> de la receta.
          {materialesReceta.length === 0 && <> Marcá primero los insumos en <strong>«Materiales a utilizar»</strong> y aparecen acá.</>}
        </p>

        {cargas.map((c, i) => {
          const h = horasDeCarga(c);
          return (
            <div key={i} className="card" style={{ padding: '.6rem .7rem', marginBottom: '.5rem', background: 'var(--bg-2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
                <strong style={{ fontSize: '.85rem' }}>Carga #{i + 2}</strong>
                <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => delCarga(i)}>✕ Quitar</button>
              </div>
              <div className="form-grid">
                <div className="form-row">
                  <label>Fecha</label>
                  <input className="input" type="date" value={c.fecha ?? ''} onChange={(e) => setCarga(i, { fecha: e.target.value })} />
                </div>
                <div className="form-row">
                  <label>Hora de inicio</label>
                  <input className="input" type="time" value={c.hora_inicio ?? ''} onChange={(e) => setCarga(i, { hora_inicio: e.target.value })} />
                </div>
                <div className="form-row">
                  <label>Hora de fin</label>
                  <input className="input" type="time" value={c.hora_fin ?? ''} onChange={(e) => setCarga(i, { hora_fin: e.target.value })} />
                </div>
                <div className="form-row">
                  <label>Horas de carga (automático)</label>
                  <input className="input mono" readOnly value={fmtJornada(h)} style={{ background: 'var(--bg-1)', fontWeight: 700 }} />
                </div>
              </div>

              {materialesReceta.length > 0 && (
                <div className="table-wrap" style={{ marginTop: '.35rem' }}>
                  <table className="table" style={{ fontSize: '.8rem' }}>
                    <thead><tr><th>Material de la receta</th><th style={{ textAlign: 'right', width: 120 }}>Kg cargados</th></tr></thead>
                    <tbody>
                      {materialesReceta.map((m) => (
                        <tr key={m.nombre}>
                          <td>{m.nombre}{m.unidad ? <span className="muted" style={{ fontSize: '.74rem' }}> · {m.unidad}</span> : null}</td>
                          <td style={{ textAlign: 'right' }}>
                            <input className="input mono" type="number" step="any" min={0} placeholder="0"
                              value={kgDe(c, m.nombre)} onChange={(e) => setKgDe(i, m.nombre, e.target.value)}
                              style={{ width: 100, textAlign: 'right' }} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="form-row" style={{ marginTop: '.35rem' }}>
                <label>Observación de la carga</label>
                <input className="input" value={c.obs ?? ''} onChange={(e) => setCarga(i, { obs: e.target.value })} placeholder="Ej.: se agregó reactivo por pureza baja…" />
              </div>
            </div>
          );
        })}
        <button type="button" className="btn btn-sm btn-ghost" onClick={addCarga}>＋ Agregar una carga</button>
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
                    <td><HoraInput value={et.hora} onChange={(h) => setEtapa(i, { hora: h })} /></td>
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
