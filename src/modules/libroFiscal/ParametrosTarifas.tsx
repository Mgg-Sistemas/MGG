/* ============================================================
   Golden Touch · Retenciones · Tarifas progresivas (R5), dentro de la ficha
   Las tarifas por tramos (p. ej. la Tarifa N° 2 del ISLR) por versiones: los
   tramos de una versión sin publicar se editan con la revisión en vivo (la
   misma que hace la base al publicar); una vez publicada no cambia. «Probar»
   muestra el tramo y el monto que aplica la base para una base y una fecha.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import {
  crearTarifa, faltaEnTarifa, faltaEnTramos, guardarTramos, listTarifas, nuevaVersionTarifa, probarTarifa, publicarVersion, quitarTramo,
  revisarTramos, revisarVersion, versionAplicable, type Tarifa, type Tramo, type UnidadTarifa, type VersionTarifa,
} from './tarifas.repository';
import { desdeMinimo, fechaCorta } from './parametrosR1';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { numeroATexto } from './validarCarga';
import { rotuloMotivo, rotuloUnidad } from './rotulos';
import { faltaPositivo, filasATramos, leerObligatorio, leerOpcional, normalizarClave, pistaClave, pistaLeido, type FilaTramo } from './parametrosNumeros';

/** Hoy en Venezuela (no en UTC: después de las 20:00 ya sería mañana). */
const hoyIso = hoyVenezuela;
const mensaje = (e: unknown, d: string) => (e instanceof Error ? e.message : d);

export function ParametrosTarifas({ puedeEditar, impuestoClave }: { puedeEditar: boolean; impuestoClave?: string }) {
  const [tarifas, setTarifas] = useState<Tarifa[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);

  const cargar = useCallback(async () => {
    try { const xs = await listTarifas(); setTarifas(impuestoClave ? xs.filter((t) => t.impuestoClave === impuestoClave) : xs); setError(null); } catch (e) { setError(mensaje(e, 'No se pudieron leer las tarifas.')); }
  }, [impuestoClave]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['retencion_tarifas', 'retencion_tarifa_versiones', 'retencion_tarifa_tramos'], () => { void cargar(); });

  return (
    <div>
      {error && <div className="card" style={{ borderColor: 'var(--danger)' }}>{error} <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cargar()}>Reintentar</button></div>}
      {!tarifas && !error && <p className="muted">Leyendo las tarifas…</p>}
      {tarifas?.length === 0 && <p className="muted" style={{ fontSize: '.82rem' }}>Sin tarifas{impuestoClave ? ' de este impuesto' : ''}.</p>}
      {tarifas?.map((t) => <TarifaCard key={t.id} tarifa={t} puedeEditar={puedeEditar} onCambio={() => void cargar()} />)}
      {puedeEditar && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNueva(true)}>Nueva tarifa</button>}
      {nueva && <NuevaTarifaModal impuestoClave={impuestoClave ?? null} onClose={() => setNueva(false)} onHecho={() => { setNueva(false); void cargar(); }} />}
    </div>
  );
}

function TarifaCard({ tarifa, puedeEditar, onCambio }: { tarifa: Tarifa; puedeEditar: boolean; onCambio: () => void }) {
  const [selId, setSelId] = useState<string | null>(tarifa.versiones[0]?.id ?? null);
  const [nuevaVersion, setNuevaVersion] = useState(false);
  const [probar, setProbar] = useState(false);
  useEffect(() => { if (!tarifa.versiones.some((v) => v.id === selId)) setSelId(tarifa.versiones[0]?.id ?? null); }, [tarifa.versiones, selId]);
  const sel = tarifa.versiones.find((v) => v.id === selId) ?? null;
  const aplicable = versionAplicable(tarifa);

  return (
    <div className="card" style={{ marginBottom: '.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <strong>{tarifa.nombre}</strong>
        <span className="muted" style={{ fontSize: '.78rem' }}>Montos en {rotuloUnidad(tarifa.unidad)} · {aplicable ? `aplica la versión desde el ${fechaCorta(aplicable.desde)}` : 'ninguna versión publicada: todavía no se aplica'}</span>
      </div>
      {tarifa.nota && <div className="muted" style={{ fontSize: '.76rem' }}>{tarifa.nota}</div>}
      <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', margin: '.4rem 0' }}>
        {tarifa.versiones.map((v) => (
          <button key={v.id} type="button" className={`btn btn-sm ${v.id === selId ? 'btn-primary' : ''}`} onClick={() => setSelId(v.id)}>
            Desde {fechaCorta(v.desde)} · {v.cerrada ? 'publicada' : 'sin publicar'}
          </button>
        ))}
        {puedeEditar && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNuevaVersion(true)}>Nueva versión desde…</button>}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setProbar(true)}>Probar</button>
      </div>
      {sel && <EditorTramos tarifa={tarifa} version={sel} puedeEditar={puedeEditar} onCambio={onCambio} />}
      {!sel && <p className="muted" style={{ fontSize: '.8rem' }}>Sin versiones: crea la primera con «Nueva versión desde…».</p>}
      {nuevaVersion && <NuevaVersionModal tarifa={tarifa} onClose={() => setNuevaVersion(false)} onHecho={(id) => { setNuevaVersion(false); setSelId(id); onCambio(); }} />}
      {probar && <ProbarTarifaModal tarifa={tarifa} onClose={() => setProbar(false)} />}
    </div>
  );
}

/** Cómo se llama cada casilla del tramo (para quien usa lector de pantalla). */
const COLUMNA_TRAMO: Record<'desde' | 'hasta' | 'pct' | 'sustraendo', string> = { desde: 'Más de', hasta: 'Hasta', pct: '%', sustraendo: 'Sustraendo' };

const aFila = (t: Tramo): FilaTramo => ({ id: t.id, desde: numeroATexto(t.desdeMonto), hasta: numeroATexto(t.hastaMonto), pct: numeroATexto(t.pct), sustraendo: numeroATexto(t.sustraendo) });

function EditorTramos({ tarifa, version, puedeEditar, onCambio }: { tarifa: Tarifa; version: VersionTarifa; puedeEditar: boolean; onCambio: () => void }) {
  const editable = puedeEditar && !version.cerrada;
  const [filas, setFilas] = useState<FilaTramo[]>(version.tramos.map(aFila));
  const [trabajando, setTrabajando] = useState(false);
  useEffect(() => { setFilas(version.tramos.map(aFila)); }, [version]);
  const leidos = useMemo(() => filasATramos(filas), [filas]);
  const ilegible = 'error' in leidos ? leidos.error : null;
  // Lo que la base rechaza al guardar (rangos de cada tramo): se dice antes, no solo al publicar.
  const faltaGuardar = ilegible ?? ('valor' in leidos ? faltaEnTramos(leidos.valor) : null);
  const problemas = 'error' in leidos ? [leidos.error] : revisarTramos(leidos.valor);
  const set = (i: number, p: Partial<FilaTramo>) => setFilas((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const cambio = JSON.stringify(filas) !== JSON.stringify(version.tramos.map(aFila));

  async function quitar(i: number) {
    const f = filas[i];
    if (!f.id) { setFilas((xs) => xs.filter((_, j) => j !== i)); return; }
    try { await quitarTramo(f.id); toast('Tramo quitado.', 'success'); onCambio(); } catch (e) { toast(mensaje(e, 'No se pudo quitar.'), 'error'); }
  }
  async function guardar() {
    if ('error' in leidos || faltaGuardar) { toast(faltaGuardar ?? 'Revisa los tramos.', 'error'); return; }
    setTrabajando(true);
    try { await guardarTramos(version.id, leidos.valor); toast('Tramos guardados.', 'success'); onCambio(); } catch (e) { toast(mensaje(e, 'No se pudieron guardar.'), 'error'); } finally { setTrabajando(false); }
  }
  async function publicar() {
    setTrabajando(true);
    try {
      const enBase = await revisarVersion(version.id);
      if (enBase.length) { toast(`La base no deja publicar: ${enBase.join('; ')}.`, 'error'); return; }
      if (!window.confirm('Al publicar, los tramos ya no cambian y la tarifa se aplica desde su fecha. ¿Publicar?')) return;
      await publicarVersion(version.id); toast('Versión publicada.', 'success'); onCambio();
    } catch (e) { toast(mensaje(e, 'No se pudo publicar.'), 'error'); } finally { setTrabajando(false); }
  }

  return (
    <div>
      <div className="muted" style={{ fontSize: '.76rem', marginBottom: '.3rem' }}>{rotuloMotivo(version.motivo)}{version.fuente ? ` · ${version.fuente}` : ''}</div>
      <table className="table" style={{ fontSize: '.8rem', width: '100%' }}>
        <thead><tr><th>Más de ({rotuloUnidad(tarifa.unidad)})</th><th>Hasta ({rotuloUnidad(tarifa.unidad)}){editable && <div className="muted" style={{ fontWeight: 400, fontSize: '.72rem' }}>Vacío = sin tope</div>}</th><th>%</th><th>Sustraendo ({rotuloUnidad(tarifa.unidad)})</th>{editable && <th aria-label="Quitar" />}</tr></thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={f.id ?? `n${i}`}>
              {(['desde', 'hasta', 'pct', 'sustraendo'] as const).map((k) => (
                <td key={k}>{editable
                  ? <><input className="input mono" type="text" inputMode="decimal" value={f[k]} placeholder={k === 'hasta' ? 'sin tope' : ''} onChange={(e) => set(i, { [k]: e.target.value })} aria-label={COLUMNA_TRAMO[k]} />{pistaLeido(f[k], 0) && <small className="hint muted">{pistaLeido(f[k], 0)}</small>}</>
                  : (k === 'hasta' && !f.hasta ? 'sin tope' : f[k])}</td>
              ))}
              {editable && <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => void quitar(i)}>Quitar</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: '.3rem' }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFilas((xs) => [...xs, { desde: xs.length ? xs[xs.length - 1].hasta : '0', hasta: '', pct: '', sustraendo: '0' }])}>Agregar tramo</button>
          <button type="button" className="btn btn-sm" onClick={() => void guardar()} disabled={!cambio || !!faltaGuardar || trabajando}>Guardar tramos</button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void publicar()} disabled={cambio || problemas.length > 0 || trabajando}>Publicar</button>
        </div>
      )}
      {editable && cambio && faltaGuardar && <small className="hint" style={{ color: 'var(--warning)', display: 'block' }}>No se puede guardar: {faltaGuardar}</small>}
      {editable && (problemas.length > 0
        ? <ul style={{ color: 'var(--warning)', fontSize: '.78rem', margin: '.3rem 0 0 1rem', padding: 0 }}>{problemas.map((p, i) => <li key={i}>{p}</li>)}</ul>
        : <small className="hint" style={{ color: 'var(--success)' }}>Los tramos están completos{cambio ? ': guárdalos antes de publicar.' : '.'}</small>)}
    </div>
  );
}

function NuevaVersionModal({ tarifa, onClose, onHecho }: { tarifa: Tarifa; onClose: () => void; onHecho: (id: string) => void }) {
  const ultima = tarifa.versiones[0] ?? null;
  const minimo = desdeMinimo(ultima);
  const [desde, setDesde] = useState(minimo && minimo > hoyIso() ? minimo : hoyIso());
  const [motivo, setMotivo] = useState('');
  const [fuente, setFuente] = useState('');
  const [copiar, setCopiar] = useState(!!ultima?.tramos.length);
  const [guardando, setGuardando] = useState(false);
  const falta = !desde ? 'Indica desde qué fecha vale la versión.'
    : minimo && desde < minimo ? `La versión nueva tiene que empezar el ${fechaCorta(minimo)} o después.`
      : !motivo.trim() ? 'Indica el motivo: queda en el historial.' : null;
  async function crear() {
    if (falta) { toast(falta, 'error'); return; }
    setGuardando(true);
    try { const id = await nuevaVersionTarifa(tarifa.id, desde, motivo, { fuente, copiarTramos: copiar ? ultima?.tramos : undefined }); toast('Versión creada sin publicar.', 'success'); onHecho(id); } catch (e) { toast(mensaje(e, 'No se pudo crear.'), 'error'); setGuardando(false); }
  }
  return (
    <Modal title={`${tarifa.nombre} · nueva versión`} onClose={() => !guardando && onClose()}
      footer={(<><button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void crear()} disabled={guardando || !!falta}>{guardando ? 'Guardando…' : 'Crear'}</button></>)}>
      <fieldset disabled={guardando} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-row"><label>Vale desde</label><input className="input" type="date" value={desde} min={minimo ?? undefined} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="form-row"><label>Fuente</label><input className="input" value={fuente} onChange={(e) => setFuente(e.target.value)} placeholder="Decreto, gaceta" /></div>
        <div className="form-row"><label>Motivo</label><input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
        {!!ultima?.tramos.length && <label style={{ display: 'inline-flex', gap: '.3rem', fontSize: '.84rem' }}><input type="checkbox" checked={copiar} onChange={(e) => setCopiar(e.target.checked)} /> Copiar los tramos de la versión del {fechaCorta(ultima.desde)}</label>}
        {falta && <small className="hint" style={{ color: motivo ? 'var(--warning)' : undefined, display: 'block' }}>{falta}</small>}
      </fieldset>
    </Modal>
  );
}

function ProbarTarifaModal({ tarifa, onClose }: { tarifa: Tarifa; onClose: () => void }) {
  const [base, setBase] = useState('');
  const [fecha, setFecha] = useState(hoyIso());
  const [ut, setUt] = useState('');
  const [res, setRes] = useState<Awaited<ReturnType<typeof probarTarifa>> | 'nada' | null>(null);
  useEffect(() => {
    if (tarifa.unidad !== 'UT') return;
    import('./parametros.repository').then(async ({ r3Disponible, parametroEnFecha }) => {
      if (await r3Disponible()) { const v = await parametroEnFecha(null, 'ut', fecha); if (typeof v === 'number') setUt(numeroATexto(v)); }
    }).catch(() => undefined);
  }, [tarifa.unidad, fecha]);
  const baseLeida = leerObligatorio(base, 'la base', 'Indica la base.');
  const utLeida = leerOpcional(ut, 'la UT');
  /** Por qué no se puede probar (se dice debajo, también con la base vacía o en 0). */
  const errorPrueba = 'error' in baseLeida ? baseLeida.error
    : 'error' in utLeida ? utLeida.error
      : faltaPositivo(baseLeida.valor, 'la base') ?? (tarifa.unidad === 'UT' ? faltaPositivo(utLeida.valor, 'la UT') : null);
  async function probar() {
    if (errorPrueba || 'error' in baseLeida || 'error' in utLeida) { toast(errorPrueba ?? 'Revisa la base y la UT.', 'error'); return; }
    try { const r = await probarTarifa(tarifa.id, baseLeida.valor, utLeida.valor, fecha); setRes(r ?? 'nada'); } catch (e) { toast(mensaje(e, 'No se pudo probar.'), 'error'); }
  }
  return (
    <Modal title={`Probar ${tarifa.nombre}`} onClose={onClose} footer={<button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-row" style={{ flex: '1 1 140px', margin: 0 }}><label>Base (Bs)</label><input className="input mono" type="text" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} />{pistaLeido(base) && <small className="hint muted">{pistaLeido(base)}</small>}</div>
        <div className="form-row" style={{ flex: '0 1 150px', margin: 0 }}><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        {tarifa.unidad === 'UT' && <div className="form-row" style={{ flex: '0 1 110px', margin: 0 }}><label>UT (Bs)</label><input className="input mono" type="text" inputMode="decimal" value={ut} onChange={(e) => setUt(e.target.value)} />{pistaLeido(ut) && <small className="hint muted">{pistaLeido(ut)}</small>}</div>}
        <button type="button" className="btn btn-primary" onClick={() => void probar()} disabled={!!errorPrueba}>Probar</button>
      </div>
      {errorPrueba && <small className="hint" style={{ color: base.trim() || ut.trim() ? 'var(--warning)' : undefined }}>{errorPrueba}</small>}
      {res === 'nada' && <p className="muted" style={{ marginTop: '.5rem' }}>Sin resultado: no hay versión publicada para esa fecha, o falta la UT.</p>}
      {res && res !== 'nada' && (
        <div className="card" style={{ marginTop: '.5rem' }}>
          <div>Tramo: más de {res.desdeMonto} hasta {res.hastaMonto ?? 'sin tope'} {rotuloUnidad(tarifa.unidad)} · {res.pct} % · sustraendo {res.sustraendo.toLocaleString('es-VE')} Bs</div>
          <div className="mono" style={{ fontSize: '1.2rem', fontWeight: 700 }}>Retención: {res.monto.toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs</div>
        </div>
      )}
    </Modal>
  );
}

function NuevaTarifaModal({ impuestoClave, onClose, onHecho }: { impuestoClave: string | null; onClose: () => void; onHecho: () => void }) {
  // La clave se escribe libre y se guarda normalizada (minúsculas, espacios → _); la pista dice cómo queda.
  const [escrita, setEscrita] = useState('');
  const clave = normalizarClave(escrita);
  const [nombre, setNombre] = useState('');
  const [unidad, setUnidad] = useState<UnidadTarifa>('UT');
  const [fuente, setFuente] = useState('');
  const [guardando, setGuardando] = useState(false);
  const falta = faltaEnTarifa({ clave, nombre, unidad });
  const pista = pistaClave(escrita, clave);
  async function crear() {
    if (falta) { toast(falta, 'error'); return; }
    setGuardando(true);
    try { await crearTarifa({ clave, nombre, impuestoClave, unidad, fuente }); toast('Tarifa creada: agrégale su primera versión.', 'success'); onHecho(); } catch (e) { toast(mensaje(e, 'No se pudo crear.'), 'error'); setGuardando(false); }
  }
  return (
    <Modal title="Nueva tarifa" onClose={() => !guardando && onClose()}
      footer={(<><button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void crear()} disabled={guardando || !!falta}>{guardando ? 'Guardando…' : 'Crear'}</button></>)}>
      <fieldset disabled={guardando} style={{ border: 0, padding: 0, margin: 0 }}>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          <div className="form-row" style={{ flex: '1 1 150px' }}><label>Clave</label><input className="input mono" value={escrita} onChange={(e) => setEscrita(e.target.value)} placeholder="Ej.: tarifa 1 ISLR" />{pista && <small className="hint muted">{pista}</small>}</div>
          <div className="form-row" style={{ flex: '0 1 100px' }}><label>Unidad</label><select className="select" value={unidad} onChange={(e) => setUnidad(e.target.value as UnidadTarifa)}>{(['UT', 'Bs'] as const).map((u) => <option key={u} value={u}>{rotuloUnidad(u)}</option>)}</select></div>
        </div>
        <div className="form-row"><label>Nombre</label><input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <div className="form-row"><label>Fuente</label><input className="input" value={fuente} onChange={(e) => setFuente(e.target.value)} /></div>
        {falta && <small className="hint" style={{ color: escrita || nombre ? 'var(--warning)' : undefined }}>{falta}</small>}
      </fieldset>
    </Modal>
  );
}
