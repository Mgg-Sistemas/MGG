/* ============================================================
   Golden Touch · Retenciones · Parámetros › Clasificaciones (R4)
   Las tablas de clasificación (conceptos del ISLR, actividades del ISAE de un
   municipio…): sus códigos con los valores por sujeto y fecha, «Nuevo valor
   desde…», «Corregir», alta de código, activar o desactivar, y la carga del
   clasificador de una alcaldía pegando una tabla con vista previa.
   Con `impuestoClave`, solo las de ese impuesto (dentro de su ficha).
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { norm } from '@/shared/lib/texto';
import {
  SUJETOS_GT, cargarClasificador, corregirValorCodigo, crearClasificacion, crearCodigo, editarCodigo,
  faltaEnClasificacion, faltaEnCodigoNuevo, faltaEnValorCodigo, leerTablaPegada, listClasificaciones, listCodigos, nuevoValorCodigo,
  planCarga, resumenValor, valorVigenteCodigo,
  type Clasificacion, type CodigoClasificacion, type DatosValorCodigo, type SujetoGt, type UnidadMinimo, type ValorCodigo,
} from './clasificaciones.repository';
import { listEntes, opcionesImpuestoEnte, type Ente } from './entes.repository';
import { desdeMinimo, fechaCorta, labelClave } from './parametrosR1';
import { listTarifas, r5Disponible, type Tarifa } from './tarifas.repository';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { numeroATexto } from './validarCarga';
import { AYUDA_ORDEN, ROTULO_ORDEN, rotuloAutor, rotuloMotivo, rotuloSujeto, rotuloUnidad, siglaSujeto } from './rotulos';
import { leerEntero, leerValorCodigo, normalizarClave, normalizarCodigo, pistaClave, pistaLeido } from './parametrosNumeros';

/** Hoy en Venezuela (no en UTC: después de las 20:00 ya sería mañana). */
const hoyIso = hoyVenezuela;
const mensaje = (e: unknown, d: string) => (e instanceof Error ? e.message : d);
const UNIDADES_MINIMO: UnidadMinimo[] = ['UT', 'Bs', 'MMV'];
/** El sujeto en pantalla: «PJD · Persona jurídica domiciliada»; sin sujeto, todos. */
const nombreSujeto = (s: SujetoGt | null) => (s ? siglaSujeto(s) : 'Todos los sujetos');

export function ParametrosClasificaciones({ puedeEditar, impuestoClave }: { puedeEditar: boolean; impuestoClave?: string }) {
  const [clasificaciones, setClasificaciones] = useState<Clasificacion[] | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [codigos, setCodigos] = useState<CodigoClasificacion[] | null>(null);
  const [entes, setEntes] = useState<Ente[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [verInactivos, setVerInactivos] = useState(false);
  const [modal, setModal] = useState<{ tipo: 'valores' | 'codigo' | 'carga' | 'clasificacion'; codigo?: CodigoClasificacion } | null>(null);

  const cargarClasificaciones = useCallback(async () => {
    try {
      const [ks, es] = await Promise.all([listClasificaciones(), listEntes().catch(() => [] as Ente[])]);
      const visibles = impuestoClave ? ks.filter((k) => k.impuestoClave === impuestoClave) : ks;
      setClasificaciones(visibles); setEntes(es); setError(null);
      setSelId((id) => (id && visibles.some((k) => k.id === id) ? id : visibles[0]?.id ?? null));
    } catch (e) { setError(mensaje(e, 'No se pudieron leer las clasificaciones.')); }
  }, [impuestoClave]);
  const cargarCodigos = useCallback(async () => {
    if (!selId) { setCodigos([]); return; }
    try { setCodigos(await listCodigos(selId)); } catch (e) { setError(mensaje(e, 'No se pudieron leer los códigos.')); }
  }, [selId]);
  useEffect(() => { void cargarClasificaciones(); }, [cargarClasificaciones]);
  useEffect(() => { setCodigos(null); void cargarCodigos(); }, [cargarCodigos]);
  useRealtime(['retencion_clasificaciones'], () => { void cargarClasificaciones(); });
  useRealtime(['retencion_clasificacion_codigos', 'retencion_clasificacion_valores'], () => { void cargarCodigos(); });

  const sel = clasificaciones?.find((k) => k.id === selId) ?? null;
  const filtrados = useMemo(() => {
    const t = norm(q.trim());
    return (codigos ?? []).filter((c) => (verInactivos || c.activo) && (!t || norm(`${c.codigo} ${c.descripcion}`).includes(t)));
  }, [codigos, q, verInactivos]);
  const abierto = modal?.codigo ? codigos?.find((c) => c.id === modal.codigo?.id) ?? modal.codigo : undefined;

  async function alternar(c: CodigoClasificacion) {
    const nota = window.prompt(c.activo ? `¿Por qué se desactiva ${c.codigo}?` : `¿Por qué se reactiva ${c.codigo}?`);
    if (!nota?.trim()) return;
    try { await editarCodigo(c.id, { activo: !c.activo, nota }); toast(c.activo ? 'Código desactivado.' : 'Código activado.', 'success'); void cargarCodigos(); } catch (e) { toast(mensaje(e, 'No se pudo cambiar.'), 'error'); }
  }

  return (
    <div>
      {error && <div className="card" style={{ borderColor: 'var(--danger)' }}>{error} <button type="button" className="btn btn-sm btn-ghost" onClick={() => { void cargarClasificaciones(); void cargarCodigos(); }}>Reintentar</button></div>}
      {!clasificaciones && !error && <p className="muted">Leyendo las clasificaciones…</p>}
      {clasificaciones && (
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.5rem' }}>
          {clasificaciones.map((k) => (
            <button key={k.id} type="button" className={`btn btn-sm ${k.id === selId ? 'btn-primary' : ''}`} aria-pressed={k.id === selId} onClick={() => setSelId(k.id)} style={k.activo ? undefined : { opacity: 0.6 }}>{k.nombre}</button>
          ))}
          {clasificaciones.length === 0 && <span className="muted">No hay clasificaciones{impuestoClave ? ' de este impuesto' : ''}.</span>}
          {puedeEditar && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setModal({ tipo: 'clasificacion' })}>Nueva clasificación</button>}
        </div>
      )}

      {sel && (
        <>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.4rem' }}>
            <span className="muted" style={{ fontSize: '.8rem' }}>
              {sel.impuestoClave ? labelClave(sel.impuestoClave) : ''}{sel.enteId ? ` · ${entes.find((e) => e.id === sel.enteId)?.nombre ?? 'ente'}` : ''}{sel.fuente ? ` · ${sel.fuente}` : ''}
            </span>
            <input className="input" style={{ maxWidth: 260, marginLeft: 'auto' }} placeholder="Buscar código o descripción" aria-label="Buscar código" value={q} onChange={(e) => setQ(e.target.value)} />
            <label style={{ display: 'inline-flex', gap: '.3rem', fontSize: '.8rem' }}><input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Ver inactivos</label>
            {puedeEditar && <button type="button" className="btn btn-sm" onClick={() => setModal({ tipo: 'codigo' })}>Nuevo código</button>}
            {puedeEditar && <button type="button" className="btn btn-sm" onClick={() => setModal({ tipo: 'carga' })}>Cargar tabla pegada</button>}
          </div>
          {!codigos && <p className="muted">Leyendo los códigos…</p>}
          {codigos && filtrados.length === 0 && <p className="muted">{codigos.length ? 'Ningún código coincide.' : 'Sin códigos: agrégalos o pega la tabla del clasificador.'}</p>}
          {filtrados.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ fontSize: '.8rem', width: '100%' }}>
                <thead><tr><th>Código</th><th>Descripción</th><th>Valores de hoy</th><th aria-label="Acciones" /></tr></thead>
                <tbody>
                  {filtrados.map((c) => (
                    <tr key={c.id} style={c.activo ? undefined : { opacity: 0.55 }}>
                      <td className="mono">{c.codigo}</td>
                      <td>{c.descripcion}{!c.activo && <span className="muted"> · inactivo</span>}</td>
                      <td style={{ fontSize: '.76rem' }}>
                        {SUJETOS_GT.map((s) => {
                          const v = c.valores.find((x) => x.sujeto === s.key) ? valorVigenteCodigo(c.valores.filter((x) => x.sujeto === s.key), s.key) : null;
                          return v ? <div key={s.key ?? 'todos'}><strong>{nombreSujeto(s.key)}:</strong> {resumenValor(v)}</div> : null;
                        })}
                        {!c.valores.length && <span className="muted">Sin valores</span>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button type="button" className="btn btn-sm" onClick={() => setModal({ tipo: 'valores', codigo: c })}>Valores</button>
                        {puedeEditar && <button type="button" className="btn btn-sm btn-ghost" onClick={() => void alternar(c)}>{c.activo ? 'Desactivar' : 'Activar'}</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {modal?.tipo === 'valores' && abierto && <ValoresModal codigo={abierto} puedeEditar={puedeEditar} onClose={() => setModal(null)} onCambio={() => void cargarCodigos()} />}
      {modal?.tipo === 'codigo' && sel && <CodigoModal clasificacion={sel} onClose={() => setModal(null)} onHecho={() => { setModal(null); void cargarCodigos(); }} />}
      {modal?.tipo === 'carga' && sel && codigos && <CargaModal clasificacion={sel} codigos={codigos} onClose={() => setModal(null)} onHecho={() => { setModal(null); void cargarCodigos(); }} />}
      {modal?.tipo === 'clasificacion' && <ClasificacionModal entes={entes} impuestoClave={impuestoClave} onClose={() => setModal(null)} onHecho={(id) => { setModal(null); setSelId(id); void cargarClasificaciones(); }} />}
    </div>
  );
}

const VALOR_VACIO: DatosValorCodigo = { sujeto: null, pct: null, basePct: 100, minimo: null, minimoUnidad: null, sustraendoFactor: null, fuente: null, nota: null };
const datosDe = (v: ValorCodigo | null, sujeto: SujetoGt | null): DatosValorCodigo => (v
  ? { sujeto, pct: v.pct, basePct: v.basePct, minimo: v.minimo, minimoUnidad: v.minimoUnidad, sustraendoFactor: v.sustraendoFactor, fuente: v.fuente, nota: v.nota }
  : { ...VALOR_VACIO, sujeto });

function ValoresModal({ codigo, puedeEditar, onClose, onCambio }: { codigo: CodigoClasificacion; puedeEditar: boolean; onClose: () => void; onCambio: () => void }) {
  const [editar, setEditar] = useState<{ sujeto: SujetoGt | null; modo: 'nuevo' | 'corregir' } | null>(null);
  return (
    <Modal title={`${codigo.codigo} · ${codigo.descripcion}`} size="xl" onClose={onClose}
      footer={<button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      {SUJETOS_GT.map((s) => {
        const propios = codigo.valores.filter((v) => v.sujeto === s.key);
        const vig = valorVigenteCodigo(propios, s.key);
        return (
          <div key={s.key ?? 'todos'} className="card" style={{ marginBottom: '.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
              <strong style={{ fontSize: '.86rem' }}>{nombreSujeto(s.key)}</strong>
              <span className="mono" style={{ fontSize: '.84rem' }}>{vig ? `${resumenValor(vig)} · desde ${fechaCorta(vig.desde)}` : <span className="muted">Sin valor vigente</span>}</span>
              {puedeEditar && (
                <span style={{ display: 'flex', gap: '.3rem' }}>
                  <button type="button" className="btn btn-sm" onClick={() => setEditar({ sujeto: s.key, modo: 'nuevo' })}>Nuevo valor desde…</button>
                  {vig && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditar({ sujeto: s.key, modo: 'corregir' })}>Corregir</button>}
                </span>
              )}
            </div>
            {vig?.nota && <div className="muted" style={{ fontSize: '.76rem' }}>{vig.nota}</div>}
            {propios.length > 1 && (
              <details style={{ marginTop: '.3rem' }}>
                <summary className="muted" style={{ cursor: 'pointer', fontSize: '.78rem' }}>Vigencias ({propios.length})</summary>
                {propios.map((v) => (
                  <div key={v.id} style={{ fontSize: '.76rem', padding: '.15rem 0' }}>
                    {fechaCorta(v.desde)} – {v.hasta ? fechaCorta(v.hasta) : 'hoy'} · {resumenValor(v)} · <span className="muted">{rotuloMotivo(v.motivo)} · {rotuloAutor(v.actualizadoPor)}</span>
                  </div>
                ))}
              </details>
            )}
          </div>
        );
      })}
      {editar && (
        <ValorCodigoModal codigo={codigo} sujeto={editar.sujeto} modo={editar.modo}
          onClose={() => setEditar(null)} onHecho={() => { setEditar(null); onCambio(); }} />
      )}
    </Modal>
  );
}

function ValorCodigoModal({ codigo, sujeto, modo, onClose, onHecho }: {
  codigo: CodigoClasificacion; sujeto: SujetoGt | null; modo: 'nuevo' | 'corregir'; onClose: () => void; onHecho: () => void;
}) {
  const propios = codigo.valores.filter((v) => v.sujeto === sujeto);
  const vig = valorVigenteCodigo(propios, sujeto);
  const minimo = modo === 'nuevo' ? desdeMinimo(propios[0] ?? null) : null;
  const inicial = datosDe(vig, sujeto);
  const [pct, setPct] = useState(numeroATexto(inicial.pct));
  const [basePct, setBasePct] = useState(numeroATexto(inicial.basePct));
  const [min, setMin] = useState(numeroATexto(inicial.minimo));
  const [unidad, setUnidad] = useState<UnidadMinimo>(inicial.minimoUnidad ?? 'UT');
  const [sustraendo, setSustraendo] = useState(numeroATexto(inicial.sustraendoFactor));
  const [fuente, setFuente] = useState(modo === 'corregir' ? inicial.fuente ?? '' : '');
  const [nota, setNota] = useState(modo === 'corregir' ? inicial.nota ?? '' : '');
  const [desde, setDesde] = useState(minimo && minimo > hoyIso() ? minimo : hoyIso());
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  // R5: la tasa puede salir de una tarifa por tramos en vez de un %.
  const [tarifas, setTarifas] = useState<Tarifa[] | null>(null);
  const [tarifaId, setTarifaId] = useState(vig?.tarifaId ?? '');
  useEffect(() => { r5Disponible().then((si) => (si ? listTarifas().then(setTarifas) : setTarifas(null))).catch(() => setTarifas(null)); }, []);

  // Un solo lector de números: lo que no se entiende bloquea el guardado (nunca pasa a vacío ni a 0).
  const numeros = leerValorCodigo({ pct, basePct, minimo: min, sustraendo }, !!tarifaId);
  const datos: DatosValorCodigo | null = 'error' in numeros ? null : {
    ...(tarifas ? { tarifaId: tarifaId || null } : {}),
    sujeto, ...numeros.valor, minimoUnidad: numeros.valor.minimo == null ? null : unidad, fuente, nota,
  };
  const falta = 'error' in numeros ? numeros.error
    : faltaEnValorCodigo(datos as DatosValorCodigo, modo === 'nuevo' ? desde : '2000-01-01', motivo)
      ?? (minimo && modo === 'nuevo' && desde < minimo ? `El valor nuevo tiene que empezar el ${fechaCorta(minimo)} o después.` : null);

  async function guardar() {
    if (!datos || falta) { if (falta) toast(falta, 'error'); return; }
    setGuardando(true);
    try {
      if (modo === 'corregir' && vig) await corregirValorCodigo(vig.id, datos, motivo);
      else await nuevoValorCodigo(codigo.id, datos, desde, motivo);
      toast(modo === 'corregir' ? 'Valor corregido.' : 'Valor guardado.', 'success');
      onHecho();
    } catch (e) { toast(mensaje(e, 'No se pudo guardar.'), 'error'); setGuardando(false); }
  }

  return (
    <Modal title={`${codigo.codigo} · ${sujeto ? rotuloSujeto(sujeto) : 'Todos los sujetos'} · ${modo === 'nuevo' ? 'nuevo valor' : `corregir el vigente desde ${fechaCorta(vig?.desde)}`}`} onClose={() => !guardando && onClose()}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={!!falta || guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        </>
      )}>
      <fieldset disabled={guardando} style={{ border: 0, padding: 0, margin: 0 }}>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          {tarifas && (
            <div className="form-row" style={{ flex: '1 1 200px' }}>
              <label>Tasa</label>
              <select className="select" value={tarifaId} onChange={(e) => setTarifaId(e.target.value)}>
                <option value="">Un % fijo</option>
                {tarifas.filter((t) => t.activo).map((t) => <option key={t.id} value={t.id}>Tarifa · {t.nombre}</option>)}
              </select>
            </div>
          )}
          {!tarifaId && <div className="form-row" style={{ flex: '0 1 110px' }}><label>%</label><input className="input mono" type="text" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /><Pista texto={pct} /></div>}
          <div className="form-row" style={{ flex: '0 1 130px' }}><label>Porción de la base (%)</label><input className="input mono" type="text" inputMode="decimal" value={basePct} onChange={(e) => setBasePct(e.target.value)} /><Pista texto={basePct} /></div>
          <div className="form-row" style={{ flex: '0 1 130px' }}><label>Mínimo</label><input className="input mono" type="text" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /><Pista texto={min} /></div>
          <div className="form-row" style={{ flex: '0 1 100px' }}>
            <label>Unidad</label>
            <select className="select" value={unidad} onChange={(e) => setUnidad(e.target.value as UnidadMinimo)}>{UNIDADES_MINIMO.map((u) => <option key={u} value={u}>{rotuloUnidad(u)}</option>)}</select>
          </div>
          <div className="form-row" style={{ flex: '0 1 150px' }}><label>Factor del sustraendo</label><input className="input mono" type="text" inputMode="decimal" value={sustraendo} onChange={(e) => setSustraendo(e.target.value)} /><Pista texto={sustraendo} /></div>
        </div>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          {modo === 'nuevo' && <div className="form-row" style={{ flex: '0 1 160px' }}><label>Vale desde</label><input className="input" type="date" value={desde} min={minimo ?? undefined} onChange={(e) => setDesde(e.target.value)} /></div>}
          <div className="form-row" style={{ flex: '2 1 220px' }}><label>Fuente</label><input className="input" value={fuente} onChange={(e) => setFuente(e.target.value)} /></div>
        </div>
        <div className="form-row"><label>Nota</label><input className="input" value={nota} onChange={(e) => setNota(e.target.value)} /></div>
        <div className="form-row"><label>Motivo</label><input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
        {falta && <small className="hint" style={{ color: motivo || 'error' in numeros ? 'var(--warning)' : undefined }}>{falta}</small>}
      </fieldset>
    </Modal>
  );
}

/** «Se leyó 36.500,00» debajo de un campo de número, cuando el texto tiene punto o coma. */
function Pista({ texto }: { texto: string }) {
  const p = pistaLeido(texto, 0);
  return p ? <small className="hint muted">{p}</small> : null;
}

function CodigoModal({ clasificacion, onClose, onHecho }: { clasificacion: Clasificacion; onClose: () => void; onHecho: () => void }) {
  const [codigo, setCodigo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [orden, setOrden] = useState('100');
  const [guardando, setGuardando] = useState(false);
  const ordenLeido = leerEntero(orden, 'la posición en la lista', 100);
  // El código se guarda sin espacios al borde y en MAYÚSCULAS (así coincide con el catálogo); la pista lo dice.
  const pista = pistaClave(codigo, normalizarCodigo(codigo));
  const falta = 'error' in ordenLeido ? ordenLeido.error : faltaEnCodigoNuevo({ codigo, descripcion, orden: ordenLeido.valor });
  async function guardar() {
    if ('error' in ordenLeido || falta) { toast(falta ?? 'Revisa el código.', 'error'); return; }
    setGuardando(true);
    try { await crearCodigo(clasificacion.id, { codigo, descripcion, orden: ordenLeido.valor }); toast('Código creado. Cárgale sus valores con «Valores».', 'success'); onHecho(); } catch (e) { toast(mensaje(e, 'No se pudo crear.'), 'error'); setGuardando(false); }
  }
  return (
    <Modal title={`Nuevo código · ${clasificacion.nombre}`} onClose={() => !guardando && onClose()}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={!!falta || guardando}>{guardando ? 'Guardando…' : 'Crear'}</button>
        </>
      )}>
      <fieldset disabled={guardando} style={{ border: 0, padding: 0, margin: 0 }}>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          <div className="form-row" style={{ flex: '1 1 120px' }}><label>Código</label><input className="input mono" value={codigo} onChange={(e) => setCodigo(e.target.value)} />{pista && <small className="hint muted">{pista}</small>}</div>
          <div className="form-row" style={{ flex: '1 1 180px' }}><label>{ROTULO_ORDEN}</label><input className="input mono" type="text" inputMode="numeric" value={orden} onChange={(e) => setOrden(e.target.value)} /><small className="hint muted">{AYUDA_ORDEN} Vacío = 100.</small></div>
        </div>
        <div className="form-row"><label>Descripción</label><input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></div>
        {falta && <small className="hint" style={{ color: codigo || descripcion || 'error' in ordenLeido ? 'var(--warning)' : undefined }}>{falta}</small>}
      </fieldset>
    </Modal>
  );
}

function CargaModal({ clasificacion, codigos, onClose, onHecho }: { clasificacion: Clasificacion; codigos: CodigoClasificacion[]; onClose: () => void; onHecho: () => void }) {
  const [crudo, setCrudo] = useState('');
  const [desde, setDesde] = useState(hoyIso());
  const [unidad, setUnidad] = useState<UnidadMinimo>('UT');
  const [fuente, setFuente] = useState(clasificacion.fuente ?? '');
  const [motivo, setMotivo] = useState('');
  const [cargando, setCargando] = useState(false);
  const lectura = useMemo(() => leerTablaPegada(crudo), [crudo]);
  const plan = useMemo(() => planCarga(codigos, lectura.filas, desde), [codigos, lectura, desde]);
  const hayAlgo = plan.nuevos.length + plan.cambian.length > 0;
  /** Por qué «Cargar» está apagado (se dice debajo). */
  const falta = !crudo.trim() ? 'Pega la tabla del clasificador.'
    : !hayAlgo ? 'No hay códigos nuevos ni cambios que cargar.'
      : !desde ? 'Indica desde qué fecha valen las alícuotas.'
        : !motivo.trim() ? 'Indica el motivo de la carga: queda en el historial.' : null;

  async function cargar() {
    if (falta) { toast(falta, 'error'); return; }
    setCargando(true);
    try {
      const r = await cargarClasificador(clasificacion.id, plan, { desde, motivo, minimoUnidad: unidad, fuente });
      const resumen = `${r.creados} código(s) nuevo(s), ${r.actualizados} descripción(es) y ${r.valores} valor(es).`;
      if (r.fallas.length) toast(`Cargado en parte: ${resumen} Fallaron ${r.fallas.length}: ${r.fallas.slice(0, 3).join(' · ')}`, 'error');
      else toast(`Cargado: ${resumen}`, 'success');
      onHecho();
    } catch (e) { toast(mensaje(e, 'No se pudo cargar.'), 'error'); setCargando(false); }
  }

  return (
    <Modal title={`Cargar tabla · ${clasificacion.nombre}`} size="xl" onClose={() => !cargando && onClose()}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={cargando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void cargar()} disabled={!!falta || cargando}>{cargando ? 'Cargando…' : 'Cargar'}</button>
        </>
      )}>
      <p className="muted" style={{ fontSize: '.82rem', marginTop: 0 }}>Pega la tabla (desde Excel o el PDF de la ordenanza): código, descripción, alícuota (%) y mínimo, una fila por línea, separadas por tabulador o «;». La alícuota y el mínimo valen para todos los sujetos desde la fecha.</p>
      <textarea className="input mono" rows={8} value={crudo} onChange={(e) => setCrudo(e.target.value)} placeholder={'Código\tDescripción\tAlícuota\tMínimo\n1.01\tActividad de ejemplo\t2,5\t10'} style={{ width: '100%' }} />
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginTop: '.4rem' }}>
        <div className="form-row" style={{ flex: '0 1 160px' }}><label>Vale desde</label><input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="form-row" style={{ flex: '0 1 120px' }}>
          <label>Mínimo en</label>
          <select className="select" value={unidad} onChange={(e) => setUnidad(e.target.value as UnidadMinimo)}>{UNIDADES_MINIMO.map((u) => <option key={u} value={u}>{rotuloUnidad(u)}</option>)}</select>
        </div>
        <div className="form-row" style={{ flex: '2 1 220px' }}><label>Fuente</label><input className="input" value={fuente} onChange={(e) => setFuente(e.target.value)} placeholder="Ordenanza y gaceta" /></div>
      </div>
      <div className="form-row"><label>Motivo</label><input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: clasificador revisado por el contador" /></div>
      {falta && <small className="hint" style={{ color: crudo.trim() ? 'var(--warning)' : undefined }}>{falta}</small>}

      {crudo.trim() && (
        <div className="card" style={{ marginTop: '.4rem' }}>
          <strong style={{ fontSize: '.86rem' }}>Vista previa</strong>
          <p style={{ fontSize: '.82rem', margin: '.3rem 0' }}>
            {plan.nuevos.length} nuevo(s) · {plan.cambian.length} cambian · {plan.iguales.length} igual(es){lectura.errores.length ? ` · ${lectura.errores.length} con error (no se cargan)` : ''}
          </p>
          {lectura.errores.length > 0 && (
            <ul style={{ color: 'var(--danger)', fontSize: '.78rem', margin: '0 0 .4rem 1rem', padding: 0 }}>
              {lectura.errores.slice(0, 15).map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          <div style={{ maxHeight: 260, overflow: 'auto' }}>
            <table className="table" style={{ fontSize: '.76rem', width: '100%' }}>
              <thead><tr><th>Qué pasa</th><th>Código</th><th>Descripción</th><th>Alícuota</th><th>Mínimo</th></tr></thead>
              <tbody>
                {plan.nuevos.map((f) => <tr key={`n${f.codigo}`}><td>Nuevo</td><td className="mono">{f.codigo}</td><td>{f.descripcion}</td><td>{f.alicuota ?? '—'}</td><td>{f.minimo ?? '—'}</td></tr>)}
                {plan.cambian.map((c) => {
                  // Lo que la fila no trae se conserva del valor vigente (y así se ve antes de cargar).
                  const v = c.cambiaValor ? valorVigenteCodigo(c.codigo.valores, null, desde) : null;
                  const alicuota = c.fila.alicuota ?? (v?.tarifaId ? 'tarifa (se conserva)' : v?.pct != null ? `${v.pct} (se conserva)` : '—');
                  const minimoTxt = c.fila.minimo ?? (v?.minimo != null ? `${v.minimo} ${v.minimoUnidad ?? ''} (se conserva)` : '—');
                  return (
                    <tr key={`c${c.fila.codigo}`}>
                      <td>{[c.cambiaDescripcion && 'descripción', c.cambiaValor && 'valor'].filter(Boolean).join(' y ')}</td>
                      <td className="mono">{c.fila.codigo}</td><td>{c.fila.descripcion}</td><td>{alicuota}</td><td>{minimoTxt}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ClasificacionModal({ entes, impuestoClave, onClose, onHecho }: { entes: Ente[]; impuestoClave?: string; onClose: () => void; onHecho: (id: string) => void }) {
  const [nombre, setNombre] = useState('');
  // La clave se escribe libre y se guarda normalizada (minúsculas, espacios → _); la pista dice cómo queda.
  const [escrita, setEscrita] = useState('');
  const clave = normalizarClave(escrita);
  const pista = pistaClave(escrita, clave);
  const [impuesto, setImpuesto] = useState(impuestoClave ?? '');
  const [enteId, setEnteId] = useState('');
  const [fuente, setFuente] = useState('');
  const [impuestos, setImpuestos] = useState<{ clave: string; nombre: string | null }[]>([]);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { opcionesImpuestoEnte().then(setImpuestos).catch(() => undefined); }, []);
  const datos = { clave: clave || null, nombre, impuestoClave: impuesto || null, enteId: enteId || null, fuente };
  const falta = faltaEnClasificacion(datos);
  async function guardar() {
    setGuardando(true);
    try { const id = await crearClasificacion(datos); toast('Clasificación creada.', 'success'); onHecho(id); } catch (e) { toast(mensaje(e, 'No se pudo crear.'), 'error'); setGuardando(false); }
  }
  return (
    <Modal title="Nueva clasificación" onClose={() => !guardando && onClose()}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={!!falta || guardando}>{guardando ? 'Guardando…' : 'Crear'}</button>
        </>
      )}>
      <fieldset disabled={guardando} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-row"><label>Nombre</label><input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Actividades económicas · Municipio …" /></div>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          <div className="form-row" style={{ flex: '1 1 150px' }}>
            <label>Impuesto</label>
            <select className="select" value={impuesto} onChange={(e) => setImpuesto(e.target.value)}>
              <option value="">—</option>
              {impuestos.map((i) => <option key={i.clave} value={i.clave}>{i.nombre ?? labelClave(i.clave)}</option>)}
            </select>
          </div>
          <div className="form-row" style={{ flex: '2 1 200px' }}>
            <label>Ente</label>
            <select className="select" value={enteId} onChange={(e) => setEnteId(e.target.value)}>
              <option value="">—</option>
              {entes.filter((e) => e.activo).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </div>
          <div className="form-row" style={{ flex: '1 1 150px' }}><label>Clave</label><input className="input mono" value={escrita} onChange={(e) => setEscrita(e.target.value)} placeholder="Ej.: ISAE otro municipio" />{pista && <small className="hint muted">{pista}</small>}</div>
        </div>
        <div className="form-row"><label>Fuente</label><input className="input" value={fuente} onChange={(e) => setFuente(e.target.value)} /></div>
        {falta && <small className="hint" style={{ color: nombre || escrita ? 'var(--warning)' : undefined }}>{falta}</small>}
      </fieldset>
    </Modal>
  );
}
