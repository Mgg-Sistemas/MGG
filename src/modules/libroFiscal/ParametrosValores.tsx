/* ============================================================
   Golden Touch · Retenciones · Parámetros › Valores (R3)
   La UT, las alícuotas y los porcentajes con vigencia: cada uno con su valor
   de hoy, «Nuevo valor desde…», «Corregir», fuente, motivo e historial, y el
   alta de valores y claves nuevas. Una retención usa los valores de la fecha
   de su factura.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import {
  claveRenglon, corregirValor, renglones, type Renglon, crearClaveParametro, faltaEnClave, faltaEnRangoValor, faltaEnValor, historialValor, leerValor,
  listClavesParametro, listValores, mostrarValor, nuevoValor, valorEnFecha,
  type Ambito, type ClaveParametro, type TipoValor, type Unidad, type Valor, type ValorParametro,
} from './parametros.repository';
import { opcionesImpuestoEnte } from './entes.repository';
import { desdeMinimo, fechaCorta, labelClave } from './parametrosR1';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { numeroATexto } from './validarCarga';
import { normalizarClave, pistaClave, pistaLeido } from './parametrosNumeros';
import { lineaHistorial } from './parametrosR2';
import { rotuloAmbito, rotuloAutor, rotuloMotivo, rotuloParametro, rotuloTipoValor, rotuloUnidad } from './rotulos';

/** El nombre de un valor: el de la base o el del diccionario (nunca la clave cruda). */
const nombreValor = (k: Pick<ClaveParametro, 'clave' | 'nombre'>) => rotuloParametro(k.clave, k.nombre);
const AMBITOS: Ambito[] = ['impuesto', 'general'];
const TIPOS_VALOR: TipoValor[] = ['numero', 'texto', 'si_no'];
const UNIDADES: Unidad[] = ['%', 'Bs', 'UT', 'dias'];

/** Hoy en Venezuela (no en UTC: después de las 20:00 ya sería mañana). */
const hoyIso = hoyVenezuela;
const mensaje = (e: unknown, d: string) => (e instanceof Error ? e.message : d);

export function ParametrosValores({ puedeEditar }: { puedeEditar: boolean }) {
  const [claves, setClaves] = useState<ClaveParametro[] | null>(null);
  const [valores, setValores] = useState<ValorParametro[]>([]);
  const [impuestos, setImpuestos] = useState<{ clave: string; nombre: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editar, setEditar] = useState<{ renglon: Renglon | null; modo: 'nuevo' | 'corregir' | 'alta' } | null>(null);
  const [altaClave, setAltaClave] = useState(false);
  const [historial, setHistorial] = useState<Renglon | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [ks, vs, imps] = await Promise.all([listClavesParametro(), listValores(), opcionesImpuestoEnte().catch(() => [])]);
      setClaves(ks); setValores(vs); setImpuestos(imps); setError(null);
    } catch (e) { setError(mensaje(e, 'No se pudieron leer los valores.')); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['retencion_parametros', 'retencion_parametro_claves'], () => { void cargar(); });

  const filas = useMemo(() => renglones(claves ?? [], valores), [claves, valores]);
  const nombreImpuesto = (c: string | null) => (c ? impuestos.find((i) => i.clave === c)?.nombre ?? labelClave(c) : 'General');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.6rem' }}>
        <p className="muted" style={{ fontSize: '.84rem', margin: 0 }}>
          Cada valor vale desde su fecha. Una retención se calcula con los valores de la fecha de su factura; si para esa fecha no hay UT cargada, no se registra.
        </p>
        {puedeEditar && (
          <span style={{ display: 'flex', gap: '.4rem' }}>
            <button type="button" className="btn" onClick={() => setEditar({ renglon: null, modo: 'alta' })}>Nuevo valor</button>
            <button type="button" className="btn btn-ghost" onClick={() => setAltaClave(true)}>Nueva clave</button>
          </span>
        )}
      </div>
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          {error} <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cargar()}>Reintentar</button>
        </div>
      )}
      {!claves && !error && <p className="muted">Leyendo los valores…</p>}
      {claves && filas.length === 0 && <p className="muted">No hay valores cargados.</p>}
      {filas.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: '.84rem', width: '100%' }}>
            <thead><tr><th>Valor</th><th>Impuesto</th><th>Hoy</th><th>Desde</th><th>Fuente</th><th aria-label="Acciones" /></tr></thead>
            <tbody>
              {filas.map((r) => {
                const hoy = valorEnFecha(r.versiones, r.impuesto, r.clave.clave);
                return (
                  <tr key={claveRenglon(r.impuesto, r.clave.clave)}>
                    <td><strong>{nombreValor(r.clave)}</strong>{r.clave.descripcion && <div className="muted" style={{ fontSize: '.74rem' }}>{r.clave.descripcion}</div>}</td>
                    <td>{nombreImpuesto(r.impuesto)}</td>
                    <td className="mono" style={{ fontWeight: 700 }}>{hoy ? mostrarValor(hoy.valor, r.clave.unidad) : <span className="muted">Sin valor hoy</span>}</td>
                    <td>{hoy ? fechaCorta(hoy.desde) : '—'}</td>
                    <td style={{ maxWidth: 260 }}>{hoy?.fuente ?? <span className="muted">—</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {puedeEditar && <button type="button" className="btn btn-sm" onClick={() => setEditar({ renglon: r, modo: 'nuevo' })}>Nuevo valor desde…</button>}
                      {puedeEditar && hoy && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditar({ renglon: r, modo: 'corregir' })}>Corregir</button>}
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setHistorial(r)}>Historial</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editar && claves && (
        <ValorModal renglon={editar.renglon} modo={editar.modo} claves={claves} impuestos={impuestos}
          onClose={() => setEditar(null)} onHecho={() => { setEditar(null); void cargar(); }} />
      )}
      {altaClave && <ClaveModal onClose={() => setAltaClave(false)} onHecho={() => { setAltaClave(false); void cargar(); }} />}
      {historial && <HistorialModal renglon={historial} nombreImpuesto={nombreImpuesto(historial.impuesto)} onClose={() => setHistorial(null)} />}
    </div>
  );
}

function CampoValor({ tipo, valor, onValor }: { tipo: TipoValor; valor: string; onValor: (v: string) => void }) {
  if (tipo === 'si_no') {
    return (
      <select className="select" value={valor === 'true' || valor === 'si' ? 'si' : 'no'} onChange={(e) => onValor(e.target.value)}>
        <option value="si">Sí</option><option value="no">No</option>
      </select>
    );
  }
  const pista = tipo === 'numero' ? pistaLeido(valor, 0) : null;
  return (
    <>
      <input className={`input${tipo === 'numero' ? ' mono' : ''}`} type="text" inputMode={tipo === 'numero' ? 'decimal' : undefined} value={valor} onChange={(e) => onValor(e.target.value)} />
      {pista && <small className="hint muted">{pista}</small>}
    </>
  );
}

function ValorModal({ renglon, modo, claves, impuestos, onClose, onHecho }: {
  renglon: Renglon | null; modo: 'nuevo' | 'corregir' | 'alta'; claves: ClaveParametro[];
  impuestos: { clave: string; nombre: string | null }[]; onClose: () => void; onHecho: () => void;
}) {
  const vigente = renglon ? valorEnFecha(renglon.versiones, renglon.impuesto, renglon.clave.clave) : null;
  const ultima = renglon?.versiones[0] ?? null;
  const minimo = modo === 'nuevo' ? desdeMinimo(ultima) : null;
  const [clave, setClave] = useState(renglon?.clave.clave ?? claves.find((k) => k.activo)?.clave ?? '');
  const [impuesto, setImpuesto] = useState<string>(renglon?.impuesto ?? '');
  const k = claves.find((x) => x.clave === clave) ?? null;
  const [crudo, setCrudo] = useState(vigente ? (typeof vigente.valor === 'number' ? numeroATexto(vigente.valor) : String(vigente.valor)) : '');
  const [desde, setDesde] = useState(minimo && minimo > hoyIso() ? minimo : hoyIso());
  const [fuente, setFuente] = useState(modo === 'corregir' ? vigente?.fuente ?? '' : '');
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);

  const leido = k ? leerValor(k.tipoValor, crudo) : { error: 'Elige qué valor.' };
  const imp = k?.ambito === 'impuesto' ? impuesto || null : null;
  const falta = 'error' in leido ? leido.error
    : !k ? 'Elige qué valor.'
      : faltaEnRangoValor(k, leido.valor) ?? (modo === 'corregir' ? (motivo.trim() ? null : 'Indica el motivo de la corrección.')
        : faltaEnValor(k, imp, desde, motivo) ?? (minimo && desde < minimo ? `El valor nuevo tiene que empezar el ${fechaCorta(minimo)} o después.` : null));

  async function guardar() {
    if (falta || !k || 'error' in leido) return;
    setGuardando(true);
    try {
      if (modo === 'corregir' && vigente) await corregirValor(vigente.id, leido.valor as Valor, fuente, motivo, k);
      else await nuevoValor(k, { impuestoClave: imp, clave: k.clave, valor: leido.valor as Valor, desde, fuente, motivo });
      toast(modo === 'corregir' ? 'Valor corregido.' : 'Valor guardado.', 'success');
      onHecho();
    } catch (e) {
      toast(mensaje(e, 'No se pudo guardar el valor.'), 'error');
      setGuardando(false);
    }
  }

  const impuestoDe = (c: string) => impuestos.find((i) => i.clave === c)?.nombre ?? labelClave(c);
  const titulo = modo === 'alta' ? 'Nuevo valor' : `${renglon ? nombreValor(renglon.clave) : ''}${renglon?.impuesto ? ` · ${impuestoDe(renglon.impuesto)}` : ''} · ${modo === 'corregir' ? `corregir el vigente desde ${fechaCorta(vigente?.desde)}` : 'nuevo valor'}`;
  return (
    <Modal title={titulo} onClose={() => !guardando && onClose()}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={!!falta || guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        </>
      )}>
      <fieldset disabled={guardando} style={{ border: 0, padding: 0, margin: 0 }}>
        {modo === 'alta' && (
          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
            <div className="form-row" style={{ flex: '2 1 220px' }}>
              <label>Qué valor</label>
              <select className="select" value={clave} onChange={(e) => setClave(e.target.value)}>
                {claves.filter((x) => x.activo).map((x) => <option key={x.clave} value={x.clave}>{nombreValor(x)}</option>)}
              </select>
            </div>
            {k?.ambito === 'impuesto' && (
              <div className="form-row" style={{ flex: '1 1 160px' }}>
                <label>Impuesto</label>
                <select className="select" value={impuesto} onChange={(e) => setImpuesto(e.target.value)}>
                  <option value="">—</option>
                  {impuestos.map((i) => <option key={i.clave} value={i.clave}>{i.nombre ?? labelClave(i.clave)}</option>)}
                </select>
              </div>
            )}
          </div>
        )}
        {modo === 'corregir'
          ? <p className="muted" style={{ fontSize: '.82rem', marginTop: 0 }}>Corrige lo que se cargó mal, sin cambiar su fecha. Para un valor que cambia desde una fecha, usa «Nuevo valor desde…».</p>
          : vigente && <p className="muted" style={{ fontSize: '.82rem', marginTop: 0 }}>Hoy vale {mostrarValor(vigente.valor, k?.unidad ?? null)} desde el {fechaCorta(vigente.desde)}. El nuevo lo reemplaza desde su fecha; lo anterior conserva el suyo.</p>}
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          <div className="form-row" style={{ flex: '1 1 140px' }}>
            <label>Valor{k?.unidad ? ` (${rotuloUnidad(k.unidad)})` : ''}</label>
            {k && <CampoValor tipo={k.tipoValor} valor={crudo} onValor={setCrudo} />}
          </div>
          {modo !== 'corregir' && (
            <div className="form-row" style={{ flex: '0 1 170px' }}>
              <label>Vale desde</label>
              <input className="input" type="date" value={desde} min={minimo ?? undefined} onChange={(e) => setDesde(e.target.value)} />
            </div>
          )}
        </div>
        <div className="form-row">
          <label>Fuente (providencia, gaceta o acto)</label>
          <input className="input" value={fuente} onChange={(e) => setFuente(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Motivo</label>
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        {falta && <small className="hint" style={{ color: crudo || motivo ? 'var(--warning)' : undefined }}>{falta}</small>}
      </fieldset>
    </Modal>
  );
}

function ClaveModal({ onClose, onHecho }: { onClose: () => void; onHecho: () => void }) {
  // La clave se escribe libre y se normaliza al guardar (minúsculas, espacios → _); la pista dice cómo queda.
  const [escrita, setEscrita] = useState('');
  const clave = normalizarClave(escrita);
  const [nombre, setNombre] = useState('');
  const [ambito, setAmbito] = useState<Ambito>('impuesto');
  const [tipoValor, setTipoValor] = useState<TipoValor>('numero');
  const [unidad, setUnidad] = useState<Unidad | ''>('%');
  const [descripcion, setDescripcion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const falta = faltaEnClave({ clave, nombre, ambito, tipoValor, unidad: unidad || null });
  const pista = pistaClave(escrita, clave);

  async function crear() {
    setGuardando(true);
    try {
      await crearClaveParametro({ clave, nombre, ambito, tipoValor, unidad: unidad || null, descripcion, orden: 50 });
      toast('Clave creada. Ahora cárgale su valor con «Nuevo valor».', 'success');
      onHecho();
    } catch (e) {
      toast(mensaje(e, 'No se pudo crear la clave.'), 'error');
      setGuardando(false);
    }
  }

  return (
    <Modal title="Nueva clave de valor" onClose={() => !guardando && onClose()}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void crear()} disabled={!!falta || guardando}>{guardando ? 'Guardando…' : 'Crear'}</button>
        </>
      )}>
      <fieldset disabled={guardando} style={{ border: 0, padding: 0, margin: 0 }}>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          <div className="form-row" style={{ flex: '1 1 160px' }}>
            <label>Clave</label>
            <input className="input mono" value={escrita} onChange={(e) => setEscrita(e.target.value)} placeholder="Ej.: mínimo ISAE" />
            {pista && <small className="hint muted">{pista}</small>}
          </div>
          <div className="form-row" style={{ flex: '2 1 220px' }}>
            <label>Nombre</label>
            <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          <div className="form-row" style={{ flex: '1 1 160px' }}>
            <label>Ámbito</label>
            <select className="select" value={ambito} onChange={(e) => setAmbito(e.target.value as Ambito)}>
              {AMBITOS.map((a) => <option key={a} value={a}>{rotuloAmbito(a)}</option>)}
            </select>
          </div>
          <div className="form-row" style={{ flex: '1 1 140px' }}>
            <label>Tipo</label>
            <select className="select" value={tipoValor} onChange={(e) => setTipoValor(e.target.value as TipoValor)}>
              {TIPOS_VALOR.map((t) => <option key={t} value={t}>{rotuloTipoValor(t)}</option>)}
            </select>
          </div>
          <div className="form-row" style={{ flex: '1 1 120px' }}>
            <label>Unidad</label>
            <select className="select" value={unidad} onChange={(e) => setUnidad(e.target.value as Unidad | '')}>
              <option value="">—</option>
              {UNIDADES.map((u) => <option key={u} value={u}>{rotuloUnidad(u)}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <label>Descripción</label>
          <input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        </div>
        {falta && <small className="hint" style={{ color: escrita || nombre ? 'var(--warning)' : undefined }}>{falta}</small>}
      </fieldset>
    </Modal>
  );
}

/** El valor guardado en el historial, como se lee en pantalla (75 %, Sí, 9,00 Bs…). */
function valorLegible(v: unknown, unidad: Unidad | null): string {
  if (v == null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return mostrarValor(v as Valor | null, unidad);
  return JSON.stringify(v);
}

function HistorialModal({ renglon, nombreImpuesto, onClose }: { renglon: Renglon; nombreImpuesto: string; onClose: () => void }) {
  const [cambios, setCambios] = useState<Awaited<ReturnType<typeof historialValor>> | null>(null);
  useEffect(() => {
    historialValor(renglon.impuesto, renglon.clave.clave).then(setCambios).catch((e) => { toast(mensaje(e, 'No se pudo leer el historial.'), 'error'); setCambios([]); });
  }, [renglon]);
  return (
    <Modal title={`${nombreValor(renglon.clave)} · ${nombreImpuesto}`} size="lg" onClose={onClose}
      footer={<button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <h4 style={{ margin: '0 0 .3rem' }}>Vigencias</h4>
      <table className="table" style={{ fontSize: '.8rem', width: '100%' }}>
        <thead><tr><th>Desde</th><th>Hasta</th><th>Valor</th><th>Fuente</th><th>Motivo</th><th>Quién</th></tr></thead>
        <tbody>
          {renglon.versiones.map((v) => (
            <tr key={v.id}>
              <td>{fechaCorta(v.desde)}</td><td>{v.hasta ? fechaCorta(v.hasta) : '—'}</td>
              <td className="mono">{mostrarValor(v.valor, renglon.clave.unidad)}</td>
              <td>{v.fuente ?? '—'}</td><td>{rotuloMotivo(v.motivo)}</td><td>{rotuloAutor(v.actualizadoPor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4 style={{ margin: '.8rem 0 .3rem' }}>Cambios</h4>
      {!cambios && <p className="muted">Leyendo…</p>}
      {cambios?.length === 0 && <p className="muted">Sin cambios registrados.</p>}
      {cambios?.map((c) => {
        const l = lineaHistorial(c);
        const valor = c.despues?.valor;
        return (
          <div key={c.id} style={{ fontSize: '.78rem', padding: '.2rem 0', borderBottom: '1px solid var(--border)' }}>
            <strong>{new Date(c.at).toLocaleString('es-VE')}</strong> · {l.quien} · {c.antes ? 'Cambio' : 'Alta'}
            <div className="muted">{l.motivo}{valor !== undefined ? ` · valor ${valorLegible(valor, renglon.clave.unidad)}` : ''}</div>
          </div>
        );
      })}
    </Modal>
  );
}
