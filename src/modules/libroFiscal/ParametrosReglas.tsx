/* ============================================================
   Golden Touch · Retenciones · Reglas de un impuesto (R7), dentro de su ficha
   Cuándo se retiene (condiciones) y cómo (los 8 pasos), por versiones: solo
   «en prueba» se edita; «Probar la regla» corre el motor con datos de la fecha
   y lo compara con el cálculo de hoy antes de activarla. Activar, retirar y
   versión nueva, con motivo.

   Todo en palabras de quien usa la pantalla (usuario, 21/10): condiciones y
   pasos se eligen con selectores rotulados, nunca con claves ni JSON; los
   textos salen del diccionario único (rotulos.ts).
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { CAMPOS_MONTO, OPERACIONES_PASO, PIEZAS, VALORES_PIEZA, type CampoMonto, type Operador, type PasoRegla, type Pieza, type SujetoGt } from './motorReglas';
import {
  activarRegla, crearRegla, faltaEnEstadoRegla, faltaEnReglaNueva, guardarCondicion, guardarPaso, listReglas, nuevaVersionRegla, quitarCondicion,
  quitarPaso, retirarRegla, type ReglaGuardada,
} from './reglas.repository';
import { cargarDatosPrueba, correrPrueba, loQueUsa, type EntradaPrueba, type ResultadoPrueba } from './probarRegla';
import { fechaCorta } from './parametrosR1';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { entradaDePrueba, leerPrioridad, pistaLeido } from './parametrosNumeros';
import {
  AYUDA_ACCION, ESTADO_REGLA, NOMBRE_MONTO, NOMBRE_OPERACION, NOMBRE_OPERADOR, NOMBRE_PIEZA, PASO_LEGIBLE, ROTULO_VALOR, TOPE_MAXIMO,
  detalleFoto, fraseCondicion, frasePaso, rotuloAutor, rotuloDatoFoto, rotuloImpuesto, rotuloMotivo, rotuloParametro, rotuloSujeto, sinRotulo,
} from './rotulos';
import { condicionDeForm, formCondicionVacio, formDePaso, valoresDeForm, type FormCondicion, type FormPaso } from './formularioRegla';
import { listClavesParametro, parametroEnFecha, r3Disponible } from './parametros.repository';
import { listClasificaciones, r4Disponible } from './clasificaciones.repository';
import { listTarifas, r5Disponible } from './tarifas.repository';

/** Hoy en Venezuela (no en UTC: después de las 20:00 ya sería mañana). */
const hoyIso = hoyVenezuela;
const mensaje = (e: unknown, d: string) => (e instanceof Error ? e.message : d);
const COLOR: Record<ReglaGuardada['estado'], string> = { en_prueba: 'var(--warning)', vigente: 'var(--success)', retirada: 'var(--text-muted)' };

/** Lo que la pantalla ofrece en los selectores: valores de Parámetros, clasificaciones y tarifas (si su tabla existe). */
interface Catalogos {
  parametros: { clave: string; nombre: string }[];
  clasificaciones: { clave: string; nombre: string }[];
  tarifas: { clave: string; nombre: string }[];
  /** El valor vigente hoy de cada parámetro (para «el % de retención (75 %)»). */
  vigentes: Record<string, number>;
}
const SIN_CATALOGOS: Catalogos = { parametros: [], clasificaciones: [], tarifas: [], vigentes: {} };

/** Los parámetros que nombran los pasos, para leer su valor vigente. */
function parametrosDe(reglas: ReglaGuardada[]): string[] {
  const xs = new Set<string>();
  for (const r of reglas) for (const p of r.pasos) for (const k of ['parametro', 'supuestos']) if (typeof p.valores?.[k] === 'string') xs.add(p.valores[k] as string);
  return [...xs];
}

export function ParametrosReglas({ puedeEditar, impuestoClave }: { puedeEditar: boolean; impuestoClave: string }) {
  const [reglas, setReglas] = useState<ReglaGuardada[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [accion, setAccion] = useState<'nueva' | 'activar' | 'retirar' | 'version' | 'probar' | null>(null);
  const [cat, setCat] = useState<Catalogos>(SIN_CATALOGOS);

  const cargar = useCallback(async () => {
    try {
      const xs = await listReglas(impuestoClave);
      setReglas(xs); setError(null);
      setSelId((id) => (id && xs.some((r) => r.id === id) ? id : xs.find((r) => r.estado === 'vigente')?.id ?? xs[0]?.id ?? null));
    } catch (e) { setError(mensaje(e, 'No se pudieron leer las reglas.')); }
  }, [impuestoClave]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['retencion_reglas', 'retencion_regla_condiciones', 'retencion_regla_pasos'], () => { void cargar(); });

  // Los catálogos de los selectores y los valores vigentes que nombran los pasos.
  const claves = useMemo(() => parametrosDe(reglas ?? []).join(','), [reglas]);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [con3, con4, con5] = await Promise.all([r3Disponible(), r4Disponible(), r5Disponible()]).catch(() => [false, false, false]);
      const [ps, cs, ts] = await Promise.all([
        con3 ? listClavesParametro().catch(() => []) : [],
        con4 ? listClasificaciones().catch(() => []) : [],
        con5 ? listTarifas().catch(() => []) : [],
      ]);
      const vigentes: Record<string, number> = {};
      if (con3) {
        for (const k of claves.split(',').filter(Boolean)) {
          const v = await parametroEnFecha(impuestoClave, k, hoyIso()).catch(() => null);
          if (typeof v === 'number') vigentes[k] = v;
        }
      }
      if (!vivo) return;
      setCat({
        parametros: ps.filter((p) => p.activo && p.tipoValor === 'numero').map((p) => ({ clave: p.clave, nombre: p.nombre })),
        clasificaciones: cs.filter((c) => c.activo && c.clave && (!c.impuestoClave || c.impuestoClave === impuestoClave)).map((c) => ({ clave: c.clave as string, nombre: c.nombre })),
        tarifas: ts.filter((t) => t.activo && (!t.impuestoClave || t.impuestoClave === impuestoClave)).map((t) => ({ clave: t.clave, nombre: t.nombre })),
        vigentes,
      });
    })();
    return () => { vivo = false; };
  }, [impuestoClave, claves]);

  const sel = reglas?.find((r) => r.id === selId) ?? null;
  const editable = puedeEditar && sel?.estado === 'en_prueba';

  return (
    <div>
      {error && <div className="card" style={{ borderColor: 'var(--danger)' }}>{error} <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cargar()}>Reintentar</button></div>}
      {!reglas && !error && <p className="muted">Leyendo las reglas…</p>}
      {reglas && (
        <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.4rem' }}>
          {reglas.map((r) => (
            <button key={r.id} type="button" className={`btn btn-sm ${r.id === selId ? 'btn-primary' : ''}`} aria-pressed={r.id === selId} onClick={() => setSelId(r.id)}>
              {r.nombre} · versión {r.version} · <span style={{ color: r.id === selId ? undefined : COLOR[r.estado] }}>{ESTADO_REGLA[r.estado].nombre}</span>
            </button>
          ))}
          {reglas.length === 0 && <span className="muted">Sin reglas: el registro calcula como siempre.</span>}
          {puedeEditar && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAccion('nueva')}>Nueva regla</button>}
        </div>
      )}

      {sel && (
        <div className="card" style={{ margin: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
            <strong>{sel.nombre} · versión {sel.version}</strong>
            <span className="muted" style={{ fontSize: '.8rem' }}>
              {ESTADO_REGLA[sel.estado].nombre} · desde el {fechaCorta(sel.desde)}{sel.hasta ? ` hasta el ${fechaCorta(sel.hasta)}` : ''} · se revisa en el lugar {sel.prioridad}
            </span>
          </div>
          <div className="muted" style={{ fontSize: '.76rem' }}>{rotuloMotivo(sel.motivo)} · {rotuloAutor(sel.actualizadoPor)}</div>
          <p className="hint muted" style={{ fontSize: '.76rem', margin: '.2rem 0' }}>{ESTADO_REGLA[sel.estado].ayuda}</p>
          <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', margin: '.4rem 0' }}>
            <button type="button" className="btn btn-sm btn-primary" title={AYUDA_ACCION.probar} onClick={() => setAccion('probar')}>Probar la regla</button>
            {puedeEditar && sel.estado === 'en_prueba' && <button type="button" className="btn btn-sm" title={AYUDA_ACCION.activar} onClick={() => setAccion('activar')}>Activar</button>}
            {puedeEditar && sel.estado === 'vigente' && <button type="button" className="btn btn-sm" title={AYUDA_ACCION.retirar} onClick={() => setAccion('retirar')}>Retirar</button>}
            {puedeEditar && <button type="button" className="btn btn-sm btn-ghost" title={AYUDA_ACCION.nuevaVersion} onClick={() => setAccion('version')}>Nueva versión desde…</button>}
          </div>
          <ul className="hint muted" style={{ fontSize: '.74rem', margin: '0 0 .4rem 1rem', padding: 0 }}>
            <li>{AYUDA_ACCION.probar}</li>
            {puedeEditar && sel.estado === 'en_prueba' && <li>{AYUDA_ACCION.activar}</li>}
            {puedeEditar && sel.estado === 'vigente' && <li>{AYUDA_ACCION.retirar}</li>}
            {puedeEditar && <li>{AYUDA_ACCION.nuevaVersion}</li>}
          </ul>

          <Condiciones regla={sel} editable={editable} cat={cat} onCambio={() => void cargar()} />
          <Pasos regla={sel} editable={editable} cat={cat} onCambio={() => void cargar()} />
        </div>
      )}

      {accion === 'nueva' && <NuevaReglaModal impuestoClave={impuestoClave} onClose={() => setAccion(null)} onHecho={(id) => { setAccion(null); setSelId(id); void cargar(); }} />}
      {sel && (accion === 'activar' || accion === 'retirar' || accion === 'version') && (
        <EstadoReglaModal regla={sel} accion={accion} onClose={() => setAccion(null)} onHecho={(id) => { setAccion(null); if (id) setSelId(id); void cargar(); }} />
      )}
      {sel && accion === 'probar' && <ProbarModal regla={sel} cat={cat} onClose={() => setAccion(null)} />}
    </div>
  );
}

function Condiciones({ regla, editable, cat, onCambio }: { regla: ReglaGuardada; editable: boolean; cat: Catalogos; onCambio: () => void }) {
  const [f, setF] = useState<FormCondicion>(formCondicionVacio());
  const lista = VALORES_PIEZA[f.pieza];
  const multiple = f.operador === 'en' || f.operador === 'no_en';
  const leido = condicionDeForm(f);
  const set = (p: Partial<FormCondicion>) => setF((x) => ({ ...x, ...p }));

  async function agregar() {
    if ('error' in leido) { toast(leido.error, 'error'); return; }
    try { await guardarCondicion(regla.id, leido.condicion); toast('Condición agregada.', 'success'); setF(formCondicionVacio(f.pieza)); onCambio(); } catch (e) { toast(mensaje(e, 'No se pudo guardar.'), 'error'); }
  }
  async function quitar(i: number) {
    try { await quitarCondicion(regla.idsCondiciones[i]); toast('Condición quitada.', 'success'); onCambio(); } catch (e) { toast(mensaje(e, 'No se pudo quitar.'), 'error'); }
  }

  return (
    <div style={{ marginTop: '.4rem' }}>
      <strong style={{ fontSize: '.84rem' }}>Cuándo se aplica</strong>
      {regla.condiciones.length === 0 && <p className="muted" style={{ fontSize: '.8rem', margin: '.2rem 0' }}>Siempre (sin condiciones).</p>}
      {regla.condiciones.map((c, i) => (
        <div key={regla.idsCondiciones[i] ?? i} style={{ display: 'flex', gap: '.4rem', alignItems: 'center', fontSize: '.8rem', padding: '.15rem 0' }}>
          <span style={{ flex: 1 }}>• {fraseCondicion(c)}</span>
          {editable && <button type="button" className="btn btn-sm btn-ghost" onClick={() => void quitar(i)}>Quitar</button>}
        </div>
      ))}
      {editable && (
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '.3rem' }}>
          <div className="form-row" style={{ margin: 0, flex: '0 1 220px' }}>
            <label>Qué se mira</label>
            <select className="select" value={f.pieza} onChange={(e) => setF(formCondicionVacio(e.target.value as Pieza))}>
              {PIEZAS.map((p) => <option key={p} value={p}>{NOMBRE_PIEZA[p]}</option>)}
            </select>
          </div>
          <div className="form-row" style={{ margin: 0, flex: '0 1 160px' }}>
            <label>Cómo</label>
            <select className="select" value={f.operador} onChange={(e) => set({ operador: e.target.value as Operador, elegidos: f.elegidos.slice(0, e.target.value === 'en' || e.target.value === 'no_en' ? undefined : 1) })}>
              {(lista ? (['es', 'no_es', 'en', 'no_en'] as Operador[]) : (['es', 'no_es'] as Operador[])).map((o) => (
                <option key={o} value={o}>{f.pieza === 'monto_minimo' ? (o === 'es' ? 'llega a' : 'no llega a') : NOMBRE_OPERADOR[o]}</option>
              ))}
            </select>
          </div>
          {lista && !multiple && (
            <div className="form-row" style={{ margin: 0, flex: '1 1 220px' }}>
              <label>Valor</label>
              <select className="select" value={f.elegidos[0] ?? ''} onChange={(e) => set({ elegidos: e.target.value ? [e.target.value] : [] })}>
                <option value="">— elige —</option>
                {lista.map((v) => <option key={v} value={v}>{ROTULO_VALOR[f.pieza]?.[v] ?? sinRotulo(v)}</option>)}
              </select>
            </div>
          )}
          {lista && multiple && (
            <div className="form-row" style={{ margin: 0, flex: '1 1 260px' }}>
              <label>Valores</label>
              <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
                {lista.map((v) => (
                  <label key={v} style={{ display: 'inline-flex', gap: '.25rem', alignItems: 'center', fontSize: '.8rem' }}>
                    <input type="checkbox" checked={f.elegidos.includes(v)}
                      onChange={(e) => set({ elegidos: e.target.checked ? [...f.elegidos, v] : f.elegidos.filter((x) => x !== v) })} />
                    {ROTULO_VALOR[f.pieza]?.[v] ?? sinRotulo(v)}
                  </label>
                ))}
              </div>
            </div>
          )}
          {f.pieza === 'clasificacion' && (
            <>
              <div className="form-row" style={{ margin: 0, flex: '1 1 220px' }}>
                <label>Clasificación</label>
                {cat.clasificaciones.length ? (
                  <select className="select" value={f.clasificacion} onChange={(e) => set({ clasificacion: e.target.value })}>
                    <option value="">— elige —</option>
                    {cat.clasificaciones.map((c) => <option key={c.clave} value={c.clave}>{c.nombre}</option>)}
                  </select>
                ) : <small className="hint muted">Primero carga una clasificación en «Clasificaciones» de este impuesto.</small>}
              </div>
              <div className="form-row" style={{ margin: 0, flex: '1 1 200px' }}>
                <label>Códigos (vacío = todos)</label>
                <input className="input mono" value={f.codigos} onChange={(e) => set({ codigos: e.target.value })} placeholder="Ej.: 1.01, 1.02" />
              </div>
            </>
          )}
          {f.pieza === 'monto_minimo' && (
            <>
              <div className="form-row" style={{ margin: 0, flex: '0 1 140px' }}>
                <label>Sobre</label>
                <select className="select" value={f.sobre} onChange={(e) => set({ sobre: e.target.value === 'pago' ? 'pago' : 'base' })}>
                  <option value="base">La base imponible</option><option value="pago">El pago</option>
                </select>
              </div>
              <div className="form-row" style={{ margin: 0, flex: '0 1 120px' }}>
                <label>Monto</label>
                <input className="input mono" inputMode="decimal" value={f.monto} onChange={(e) => set({ monto: e.target.value })} />
              </div>
              <div className="form-row" style={{ margin: 0, flex: '0 1 100px' }}>
                <label>En</label>
                <select className="select" value={f.unidad} onChange={(e) => set({ unidad: e.target.value === 'Bs' ? 'Bs' : 'UT' })}>
                  <option value="UT">UT</option><option value="Bs">Bs</option>
                </select>
              </div>
            </>
          )}
          <button type="button" className="btn btn-sm" onClick={() => void agregar()} disabled={'error' in leido}>Agregar condición</button>
          {'error' in leido ? <small className="hint muted" style={{ width: '100%' }}>{leido.error}</small>
            : <small className="hint muted" style={{ width: '100%' }}>Se agregará: {fraseCondicion(leido.condicion)}</small>}
        </div>
      )}
    </div>
  );
}

function Pasos({ regla, editable, cat, onCambio }: { regla: ReglaGuardada; editable: boolean; cat: Catalogos; onCambio: () => void }) {
  const [editando, setEditando] = useState<number | null>(null);
  const vigente = (k: string) => cat.vigentes[k];
  return (
    <div style={{ marginTop: '.6rem' }}>
      <strong style={{ fontSize: '.84rem' }}>Cómo se calcula (8 pasos)</strong>
      {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
        const p = regla.pasos.find((x) => x.paso === n) ?? null;
        return (
          <div key={n} style={{ fontSize: '.8rem', padding: '.2rem 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
              <span className="mono" style={{ width: 18 }}>{n}</span>
              <span style={{ flex: 1 }}>
                {p ? frasePaso(p, vigente) : <span className="muted">{PASO_LEGIBLE[n].nombre}: {frasePaso(null)}</span>}
                <small className="muted" style={{ display: 'block', fontSize: '.72rem' }}>{PASO_LEGIBLE[n].explica}</small>
              </span>
              {editable && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditando(editando === n ? null : n)}>{p ? 'Editar' : 'Usar'}</button>}
              {editable && p && n !== 1 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => void quitarPaso(regla.id, n).then(() => { toast('Paso quitado.', 'success'); onCambio(); }).catch((e) => toast(mensaje(e, 'No se pudo quitar.'), 'error'))}>Quitar</button>}
            </div>
            {editando === n && <EditorPaso reglaId={regla.id} paso={n} actual={p} cat={cat} onHecho={() => { setEditando(null); onCambio(); }} />}
          </div>
        );
      })}
    </div>
  );
}

function EditorPaso({ reglaId, paso, actual, cat, onHecho }: { reglaId: string; paso: number; actual: PasoRegla | null; cat: Catalogos; onHecho: () => void }) {
  const ops = OPERACIONES_PASO[paso];
  const [operacion, setOperacion] = useState(actual?.operacion ?? ops[0]);
  const [f, setF] = useState<FormPaso>(() => formDePaso(actual?.operacion ?? ops[0], actual?.valores));
  const set = (p: Partial<FormPaso>) => setF((x) => ({ ...x, ...p }));
  const leido = valoresDeForm(paso, operacion, f);

  async function guardar() {
    if ('error' in leido) { toast(leido.error, 'error'); return; }
    try { await guardarPaso(reglaId, { paso, operacion, valores: leido.valores }); toast(`Paso ${paso} guardado.`, 'success'); onHecho(); } catch (e) { toast(mensaje(e, 'No se pudo guardar.'), 'error'); }
  }

  const selectorParametro = (valor: string, onChange: (v: string) => void, vacio = '— elige —') => (cat.parametros.length ? (
    <select className="select" value={valor} onChange={(e) => onChange(e.target.value)}>
      <option value="">{vacio}</option>
      {cat.parametros.map((p) => <option key={p.clave} value={p.clave}>{rotuloParametro(p.clave, p.nombre)}</option>)}
      {valor && !cat.parametros.some((p) => p.clave === valor) && <option value={valor}>{rotuloParametro(valor)}</option>}
    </select>
  ) : <small className="hint muted">Los valores se cargan en Parámetros › Valores con vigencia.</small>);

  return (
    <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'flex-end', margin: '.3rem 0 .2rem 1.4rem' }}>
      <div className="form-row" style={{ margin: 0, flex: '1 1 220px' }}>
        <label>Qué hace</label>
        <select className="select" value={operacion} onChange={(e) => { setOperacion(e.target.value); setF(formDePaso(e.target.value)); }}>
          {ops.map((o) => <option key={o} value={o}>{NOMBRE_OPERACION[o] ?? sinRotulo(o)}</option>)}
        </select>
      </div>

      {operacion === 'componer_base' && (
        <div className="form-row" style={{ margin: 0, flex: '1 1 100%' }}>
          <label>Montos de la factura</label>
          {f.componentes.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: '.3rem', marginBottom: '.2rem' }}>
              <select className="select" style={{ maxWidth: 110 }} value={c.signo} onChange={(e) => set({ componentes: f.componentes.map((x, j) => (j === i ? { ...x, signo: e.target.value === '-' ? '-' : '+' } : x)) })}>
                <option value="+">Suma</option><option value="-">Resta</option>
              </select>
              <select className="select" value={c.campo} onChange={(e) => set({ componentes: f.componentes.map((x, j) => (j === i ? { ...x, campo: e.target.value as CampoMonto } : x)) })}>
                {CAMPOS_MONTO.map((m) => <option key={m} value={m}>{NOMBRE_MONTO[m].charAt(0).toUpperCase() + NOMBRE_MONTO[m].slice(1)}</option>)}
              </select>
              {f.componentes.length > 1 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => set({ componentes: f.componentes.filter((_, j) => j !== i) })}>Quitar</button>}
            </div>
          ))}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => set({ componentes: [...f.componentes, { campo: 'descuento', signo: '-' }] })}>Agregar monto</button>
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', marginTop: '.3rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '.8rem' }}>De ese total se toma:</span>
            <select className="select" style={{ maxWidth: 220 }} value={f.porcionDe} onChange={(e) => set({ porcionDe: e.target.value as FormPaso['porcionDe'] })}>
              <option value="toda">Todo</option><option value="concepto">La porción que dice el concepto</option><option value="pct">Un porcentaje</option>
            </select>
            {f.porcionDe === 'pct' && <><input className="input mono" style={{ width: 80 }} inputMode="decimal" value={f.porcion} onChange={(e) => set({ porcion: e.target.value })} /> %</>}
          </div>
        </div>
      )}

      {operacion === 'comparar_minimo' && (
        <>
          <label style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center', fontSize: '.8rem', minHeight: 36 }}>
            <input type="checkbox" checked={f.desdeConcepto} onChange={(e) => set({ desdeConcepto: e.target.checked })} /> El mínimo que dice el concepto
          </label>
          {!f.desdeConcepto && <CampoMontoUnidad f={f} set={set} unidades={['UT', 'Bs', 'MMV']} />}
        </>
      )}
      {operacion === 'monto_fijo' && <CampoMontoUnidad f={f} set={set} unidades={['UT', 'Bs']} />}

      {(operacion === 'pct_fijo' || (operacion === 'retener_pct' && f.pctDe === 'fijo')) && (
        <div className="form-row" style={{ margin: 0, flex: '0 1 120px' }}>
          <label>Porcentaje</label>
          <input className="input mono" inputMode="decimal" value={f.pct} onChange={(e) => set({ pct: e.target.value })} />
        </div>
      )}
      {operacion === 'retener_pct' && (
        <div className="form-row" style={{ margin: 0, flex: '0 1 220px' }}>
          <label>El porcentaje sale de</label>
          <select className="select" value={f.pctDe} onChange={(e) => set({ pctDe: e.target.value === 'fijo' ? 'fijo' : 'parametro' })}>
            <option value="parametro">Un valor de Parámetros</option><option value="fijo">Un porcentaje fijo</option>
          </select>
        </div>
      )}
      {(operacion === 'pct_parametro' || (operacion === 'retener_pct' && f.pctDe === 'parametro')) && (
        <div className="form-row" style={{ margin: 0, flex: '1 1 220px' }}>
          <label>Valor de Parámetros</label>
          {selectorParametro(f.parametro, (v) => set({ parametro: v }))}
        </div>
      )}
      {operacion === 'retener_pct' && f.pctDe === 'parametro' && (
        <div className="form-row" style={{ margin: 0, flex: '1 1 220px' }}>
          <label>Si aplica un supuesto del art. 5, usar</label>
          {selectorParametro(f.supuestos, (v) => set({ supuestos: v }), '— no cambia —')}
        </div>
      )}
      {operacion === 'pct_clasificacion' && (
        <div className="form-row" style={{ margin: 0, flex: '1 1 220px' }}>
          <label>Clasificación</label>
          {cat.clasificaciones.length ? (
            <select className="select" value={f.clasificacion} onChange={(e) => set({ clasificacion: e.target.value })}>
              <option value="">— elige —</option>
              {cat.clasificaciones.map((c) => <option key={c.clave} value={c.clave}>{c.nombre}</option>)}
            </select>
          ) : <small className="hint muted">Primero carga una clasificación en «Clasificaciones».</small>}
        </div>
      )}
      {operacion === 'tramos' && (
        <div className="form-row" style={{ margin: 0, flex: '1 1 220px' }}>
          <label>Tarifa por tramos</label>
          {cat.tarifas.length ? (
            <select className="select" value={f.tarifa} onChange={(e) => set({ tarifa: e.target.value })}>
              <option value="">— elige —</option>
              {cat.tarifas.map((t) => <option key={t.clave} value={t.clave}>{t.nombre}</option>)}
            </select>
          ) : <small className="hint muted">Primero carga una tarifa en «Tarifas».</small>}
        </div>
      )}
      {operacion === 'restar_sustraendo' && (
        <>
          <div className="form-row" style={{ margin: 0, flex: '0 1 220px' }}>
            <label>El sustraendo sale de</label>
            <select className="select" value={f.sustraendoPor} onChange={(e) => set({ sustraendoPor: e.target.value as FormPaso['sustraendoPor'] })}>
              <option value="concepto">Lo que dice el concepto</option><option value="factor">Un factor × UT</option><option value="monto">Un monto en Bs</option>
            </select>
          </div>
          {f.sustraendoPor !== 'concepto' && (
            <div className="form-row" style={{ margin: 0, flex: '0 1 120px' }}>
              <label>{f.sustraendoPor === 'factor' ? 'Factor' : 'Monto (Bs)'}</label>
              <input className="input mono" inputMode="decimal" value={f.sustraendoPor === 'factor' ? f.factor : f.monto}
                onChange={(e) => set(f.sustraendoPor === 'factor' ? { factor: e.target.value } : { monto: e.target.value })} />
            </div>
          )}
        </>
      )}
      {operacion === 'topes' && (
        <>
          <div className="form-row" style={{ margin: 0, flex: '0 1 120px' }}>
            <label>Mínimo (vacío = sin mínimo)</label>
            <input className="input mono" inputMode="decimal" value={f.minimo} onChange={(e) => set({ minimo: e.target.value })} />
          </div>
          <div className="form-row" style={{ margin: 0, flex: '0 1 200px' }}>
            <label>Máximo</label>
            <select className="select" value={f.maximo} onChange={(e) => set({ maximo: e.target.value as FormPaso['maximo'] })}>
              <option value="">Sin máximo</option>
              {Object.keys(TOPE_MAXIMO).map((k) => <option key={k} value={k}>{TOPE_MAXIMO[k].charAt(0).toUpperCase() + TOPE_MAXIMO[k].slice(1)}</option>)}
            </select>
          </div>
        </>
      )}
      {operacion === 'redondear' && (
        <div className="form-row" style={{ margin: 0, flex: '0 1 120px' }}>
          <label>Decimales</label>
          <select className="select" value={f.decimales} onChange={(e) => set({ decimales: e.target.value })}>
            {['0', '1', '2', '3', '4'].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      )}
      {operacion === 'convertir_moneda' && <small className="hint muted">Con la tasa BCV de la fecha de la factura.</small>}
      {operacion === 'retener_todo' && <small className="hint muted">Se retiene el 100 % del impuesto.</small>}

      <button type="button" className="btn btn-sm" onClick={() => void guardar()} disabled={'error' in leido}>Guardar paso</button>
      {'error' in leido ? <small className="hint muted" style={{ width: '100%' }}>{leido.error}</small>
        : <small className="hint muted" style={{ width: '100%' }}>Quedará: {frasePaso({ paso, operacion, valores: leido.valores }, (k) => cat.vigentes[k])}</small>}
    </div>
  );
}

function CampoMontoUnidad({ f, set, unidades }: { f: FormPaso; set: (p: Partial<FormPaso>) => void; unidades: FormPaso['unidad'][] }) {
  return (
    <>
      <div className="form-row" style={{ margin: 0, flex: '0 1 120px' }}>
        <label>Monto</label>
        <input className="input mono" inputMode="decimal" value={f.monto} onChange={(e) => set({ monto: e.target.value })} />
      </div>
      <div className="form-row" style={{ margin: 0, flex: '0 1 120px' }}>
        <label>En</label>
        <select className="select" value={f.unidad} onChange={(e) => set({ unidad: e.target.value as FormPaso['unidad'] })}>
          {unidades.map((u) => <option key={u} value={u}>{u === 'MMV' ? 'MMV (moneda de mayor valor)' : u}</option>)}
        </select>
      </div>
    </>
  );
}

function NuevaReglaModal({ impuestoClave, onClose, onHecho }: { impuestoClave: string; onClose: () => void; onHecho: (id: string) => void }) {
  const [nombre, setNombre] = useState('');
  const [desde, setDesde] = useState(hoyIso());
  const [prioridad, setPrioridad] = useState('100');
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const prioridadLeida = leerPrioridad(prioridad);
  /** Por qué «Crear» está apagado (se dice debajo). */
  const falta = 'error' in prioridadLeida ? prioridadLeida.error : faltaEnReglaNueva({ nombre, desde, prioridad: prioridadLeida.valor, motivo });
  async function crear() {
    if ('error' in prioridadLeida || falta) { toast(falta ?? 'Revisa la regla.', 'error'); return; }
    setGuardando(true);
    try { const id = await crearRegla({ impuestoClave, nombre, desde, prioridad: prioridadLeida.valor, motivo }); toast('Regla creada en prueba. Agrega sus condiciones y pasos.', 'success'); onHecho(id); } catch (e) { toast(mensaje(e, 'No se pudo crear.'), 'error'); setGuardando(false); }
  }
  return (
    <Modal title={`Nueva regla · ${rotuloImpuesto(impuestoClave)}`} onClose={() => !guardando && onClose()}
      footer={(<><button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void crear()} disabled={guardando || !!falta}>{guardando ? 'Guardando…' : 'Crear'}</button></>)}>
      <fieldset disabled={guardando} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-row"><label>Nombre</label><input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: ISAE de otro municipio" /></div>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          <div className="form-row" style={{ flex: '0 1 160px' }}><label>Desde</label><input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div className="form-row" style={{ flex: '0 1 200px' }}>
            <label>Orden de revisión</label>
            <input className="input mono" type="text" inputMode="numeric" value={prioridad} onChange={(e) => setPrioridad(e.target.value)} />
            <small className="hint muted">Si varias reglas aplican, gana la de número menor. Vacío = 100.</small>
          </div>
        </div>
        <div className="form-row"><label>Motivo</label><input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
        {falta && <small className="hint" style={{ color: nombre || motivo || 'error' in prioridadLeida ? 'var(--warning)' : undefined, display: 'block' }}>{falta}</small>}
        <small className="hint muted">Nace «En prueba»: no calcula retenciones reales hasta que la actives.</small>
      </fieldset>
    </Modal>
  );
}

function EstadoReglaModal({ regla, accion, onClose, onHecho }: { regla: ReglaGuardada; accion: 'activar' | 'retirar' | 'version'; onClose: () => void; onHecho: (id?: string) => void }) {
  const [fecha, setFecha] = useState(hoyIso());
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const titulo = { activar: 'Activar', retirar: 'Retirar', version: 'Nueva versión de' }[accion];
  const ayuda = { activar: AYUDA_ACCION.activar, retirar: AYUDA_ACCION.retirar, version: AYUDA_ACCION.nuevaVersion }[accion];
  const falta = faltaEnEstadoRegla(accion, fecha, motivo);
  async function confirmar() {
    if (falta) { toast(falta, 'error'); return; }
    setGuardando(true);
    try {
      if (accion === 'activar') { await activarRegla(regla.id, motivo); toast('Regla activada: desde su fecha se usa al registrar.', 'success'); onHecho(); }
      else if (accion === 'retirar') { await retirarRegla(regla.id, fecha, motivo); toast('Regla retirada.', 'success'); onHecho(); }
      else { const id = await nuevaVersionRegla(regla.id, fecha, motivo); toast('Versión nueva creada en prueba.', 'success'); onHecho(id); }
    } catch (e) { toast(mensaje(e, 'No se pudo.'), 'error'); setGuardando(false); }
  }
  return (
    <Modal title={`${titulo} «${regla.nombre}» · versión ${regla.version}`} compact onClose={() => !guardando && onClose()}
      footer={(<><button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void confirmar()} disabled={guardando || !!falta}>{guardando ? 'Guardando…' : titulo}</button></>)}>
      <p style={{ fontSize: '.84rem' }}>{ayuda}</p>
      {accion === 'activar' && <p style={{ fontSize: '.84rem' }}>Antes de activarla, pruébala y compárala con el cálculo de hoy. Desde el {fechaCorta(regla.desde)} el registro la usa.</p>}
      {accion !== 'activar' && <div className="form-row"><label>{accion === 'retirar' ? 'Vale hasta' : 'Vale desde'}</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>}
      <div className="form-row"><label>Motivo</label><input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
      {falta && <small className="hint" style={{ color: motivo ? 'var(--warning)' : undefined }}>{falta}</small>}
    </Modal>
  );
}

function ProbarModal({ regla, cat, onClose }: { regla: ReglaGuardada; cat: Catalogos; onClose: () => void }) {
  const usa = loQueUsa(regla);
  const [e, setE] = useState<Omit<EntradaPrueba, 'tasa' | 'pago' | 'baseImponible' | 'iva'>>({ fecha: hoyIso(), direccion: 'practicada', sujeto: 'PJD', moneda: 'Bs', supuesto: false, codigo: null });
  // Los montos se escriben como texto (con decimales, en formato venezolano) y se leen al probar.
  const [textos, setTextos] = useState({ tasa: '', pago: '1000', base: '1000', iva: '160' });
  const [resultado, setResultado] = useState<ResultadoPrueba | null>(null);
  const [probando, setProbando] = useState(false);
  const set = (p: Partial<EntradaPrueba>) => setE((x) => ({ ...x, ...p }));
  const setTexto = (p: Partial<typeof textos>) => setTextos((x) => ({ ...x, ...p }));
  const entrada = entradaDePrueba(e, textos);
  const pista = (t: string) => { const x = pistaLeido(t); return x ? <small className="hint muted">{x}</small> : null; };
  const nombreClasificacion = usa.clasificacion ? cat.clasificaciones.find((c) => c.clave === usa.clasificacion)?.nombre ?? sinRotulo(usa.clasificacion) : null;

  async function probar() {
    if ('error' in entrada) { toast(entrada.error, 'error'); return; }
    const datos = entrada.valor;
    setProbando(true);
    try { setResultado(correrPrueba(regla, datos, await cargarDatosPrueba(regla, datos))); } catch (err) { toast(mensaje(err, 'No se pudo probar.'), 'error'); } finally { setProbando(false); }
  }

  return (
    <Modal title={`Probar «${regla.nombre}» · versión ${regla.version}`} size="xl" onClose={onClose} footer={<button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <p className="hint muted" style={{ fontSize: '.8rem', marginTop: 0 }}>{AYUDA_ACCION.probar}</p>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-row" style={{ flex: '0 1 150px', margin: 0 }}><label>Fecha de la factura</label><input className="input" type="date" value={e.fecha} onChange={(x) => set({ fecha: x.target.value })} /></div>
        <div className="form-row" style={{ flex: '0 1 200px', margin: 0 }}><label>Quién retiene</label><select className="select" value={e.direccion} onChange={(x) => set({ direccion: x.target.value as EntradaPrueba['direccion'] })}><option value="practicada">La practica la empresa</option><option value="sufrida">Recibida</option></select></div>
        <div className="form-row" style={{ flex: '0 1 230px', margin: 0 }}><label>Tipo de proveedor</label><select className="select" value={e.sujeto ?? ''} onChange={(x) => set({ sujeto: (x.target.value || null) as SujetoGt | null })}>{(['PJD', 'PJND', 'PNR', 'PNNR'] as const).map((s) => <option key={s} value={s}>{rotuloSujeto(s)}</option>)}</select></div>
        <div className="form-row" style={{ flex: '0 1 100px', margin: 0 }}><label>Moneda</label><select className="select" value={e.moneda} onChange={(x) => set({ moneda: x.target.value })}><option value="Bs">Bs</option><option value="USD">$</option></select></div>
        {e.moneda !== 'Bs' && <div className="form-row" style={{ flex: '0 1 110px', margin: 0 }}><label>Tasa</label><input className="input mono" type="text" inputMode="decimal" value={textos.tasa} onChange={(x) => setTexto({ tasa: x.target.value })} />{pista(textos.tasa)}</div>}
        <div className="form-row" style={{ flex: '0 1 120px', margin: 0 }}><label>Pago</label><input className="input mono" type="text" inputMode="decimal" value={textos.pago} onChange={(x) => setTexto({ pago: x.target.value })} />{pista(textos.pago)}</div>
        <div className="form-row" style={{ flex: '0 1 120px', margin: 0 }}><label>Base imponible</label><input className="input mono" type="text" inputMode="decimal" value={textos.base} onChange={(x) => setTexto({ base: x.target.value })} />{pista(textos.base)}</div>
        <div className="form-row" style={{ flex: '0 1 110px', margin: 0 }}><label>IVA</label><input className="input mono" type="text" inputMode="decimal" value={textos.iva} onChange={(x) => setTexto({ iva: x.target.value })} />{pista(textos.iva)}</div>
        {usa.clasificacion && <div className="form-row" style={{ flex: '0 1 180px', margin: 0 }}><label>Código de {nombreClasificacion}</label><input className="input mono" value={e.codigo ?? ''} onChange={(x) => set({ codigo: x.target.value.trim().toUpperCase() || null })} /></div>}
        <label style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center', fontSize: '.84rem', minHeight: 36 }}><input type="checkbox" checked={e.supuesto} onChange={(x) => set({ supuesto: x.target.checked })} /> Aplica un supuesto del art. 5</label>
        <button type="button" className="btn btn-primary" onClick={() => void probar()} disabled={probando || 'error' in entrada}>{probando ? 'Probando…' : 'Probar'}</button>
      </div>
      {'error' in entrada && <small className="hint" style={{ color: 'var(--warning)' }}>{entrada.error}</small>}

      {resultado && (
        <div style={{ marginTop: '.7rem' }}>
          {resultado.condicionesQueFallan.length > 0 && (
            <div className="card" style={{ borderColor: 'var(--warning)' }}>
              <strong style={{ fontSize: '.84rem' }}>Con estos datos la regla no aplicaría:</strong>
              <ul style={{ margin: '.2rem 0 0 1rem', padding: 0, fontSize: '.8rem' }}>{resultado.condicionesQueFallan.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </div>
          )}
          <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', margin: '.5rem 0' }}>
            <div><div className="muted" style={{ fontSize: '.72rem' }}>Con la regla</div><div className="mono" style={{ fontSize: '1.2rem', fontWeight: 700 }}>{resultado.motor.monto.toLocaleString('es-VE', { minimumFractionDigits: 2 })} {e.moneda}</div>{resultado.motor.motivo && <small className="muted">{resultado.motor.motivo}</small>}</div>
            <div><div className="muted" style={{ fontSize: '.72rem' }}>Con el cálculo de hoy</div><div className="mono" style={{ fontSize: '1.2rem' }}>{resultado.hoy ? `${resultado.hoy.monto.toLocaleString('es-VE', { minimumFractionDigits: 2 })} ${e.moneda}` : '—'}</div>{resultado.hoy && <small className="muted">{resultado.hoy.explicacion}</small>}</div>
            <div style={{ alignSelf: 'center', fontWeight: 700, color: resultado.coinciden == null ? 'var(--text-muted)' : resultado.coinciden ? 'var(--success)' : 'var(--danger)' }}>
              {resultado.coinciden == null ? 'Sin cálculo de hoy para comparar' : resultado.coinciden ? 'Coinciden' : 'Difieren: revisa la regla antes de activarla'}
            </div>
          </div>
          <table className="table" style={{ fontSize: '.78rem', width: '100%' }}>
            <thead><tr><th>Paso</th><th>Qué hizo</th><th>Datos</th></tr></thead>
            <tbody>
              {resultado.motor.foto.pasos.map((p) => (
                <tr key={p.paso}>
                  <td>{p.paso} · {PASO_LEGIBLE[p.paso]?.nombre ?? `Paso ${p.paso}`}</td>
                  <td>{detalleFoto(p.operacion, p.detalle)}</td>
                  <td className="mono">{Object.entries(p.valores).map(([k, v]) => `${rotuloDatoFoto(k)}: ${v == null ? '—' : typeof v === 'string' ? (TOPE_MAXIMO[v] ?? sinRotulo(v)) : v}`).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
