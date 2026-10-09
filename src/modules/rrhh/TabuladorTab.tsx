/* ============================================================
   MGG · RRHH · Tabulador por cargo (09-10-2026)

   Un sueldo base (USD mensual) por cargo. Se edita, se agregan cargos y se
   desactivan; cada movimiento pide motivo y queda en el historial del
   tabulador. «⚡ Aplicar tabulador» pone a todo el personal activo en el sueldo
   de su cargo, con vista previa y confirmación, en una sola transacción, y
   cada persona tocada queda con su renglón en el historial salarial.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { DecimalInput } from '@/shared/ui/DecimalInput';
import { toast } from '@/shared/ui/Toast';
import { money, date, dateTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Personal } from '@/shared/lib/types';
import { listPersonal } from './personal.repository';
import { listCargos } from './catalogos';
import { EMPRESA_POR_DEFECTO, type Empresa } from './empresa';
import { textoVariacion, variacionSueldo } from './cambioSueldo';
import {
  diffAplicarTabulador, filtrarHistorialPorCargo, labelAccionTabulador, motivoTabulador, normalizarCargo,
  resumenAplicacion, validarFilaTabulador, filaAplicable, type FilaTabulador, type HistorialTabulador,
} from './tabulador';
import { aplicarTabulador, guardarFilaTabulador, listHistorialTabulador, listTabulador } from './tabulador.repository';
import { textoPct } from './historicoSalarial';

const hoyIso = () => new Date().toISOString().slice(0, 10);

export function TabuladorTab({ canWrite, actor, actorName, empresa = EMPRESA_POR_DEFECTO }: {
  canWrite: boolean; actor: string; actorName: string | null; empresa?: Empresa;
}) {
  const [filas, setFilas] = useState<FilaTabulador[]>([]);
  const [personal, setPersonal] = useState<Personal[]>([]);
  const [loading, setLoading] = useState(true);
  const [texto, setTexto] = useState('');
  const [verInactivos, setVerInactivos] = useState(false);
  const [edicion, setEdicion] = useState<FilaTabulador | 'nuevo' | null>(null);
  const [estadoDe, setEstadoDe] = useState<FilaTabulador | null>(null);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [aplicando, setAplicando] = useState(false);

  const recargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    const [t, ps] = await Promise.all([
      listTabulador().catch((e) => { toast(e instanceof Error ? e.message : 'No se pudo cargar el tabulador', 'error'); return [] as FilaTabulador[]; }),
      listPersonal(false, empresa).catch(() => [] as Personal[]),
    ]);
    setFilas(t); setPersonal(ps);
    setLoading(false);
  }, [empresa]);
  useEffect(() => { void recargar(); }, [recargar]);
  // Silencioso: un cambio ajeno no tiene por qué dejar la tabla en «Cargando…».
  useRealtime(['tabulador_cargos', 'tabulador_cargos_historial', 'personal'], () => { void recargar(true); });

  // Cuántos activos tienen cada cargo y cuántos cobran distinto de lo tabulado.
  const porCargo = useMemo(() => {
    const m = new Map<string, { activos: number; distinto: number }>();
    for (const f of filas) m.set(normalizarCargo(f.cargo), { activos: 0, distinto: 0 });
    for (const p of personal) {
      if (!p.activo) continue;
      const c = normalizarCargo(p.cargo);
      const e = m.get(c);
      if (!e) continue;
      e.activos += 1;
      const f = filas.find((x) => normalizarCargo(x.cargo) === c);
      if (f && filaAplicable(f) && variacionSueldo(p.sueldo_base, f.sueldoBase).direccion !== 'igual') e.distinto += 1;
    }
    return m;
  }, [filas, personal]);

  const visibles = useMemo(() => {
    const q = normalizarCargo(texto);
    return filas.filter((f) => (verInactivos || f.activo) && (!q || normalizarCargo(f.cargo).includes(q)));
  }, [filas, texto, verInactivos]);

  const diff = useMemo(() => diffAplicarTabulador(personal, filas), [personal, filas]);
  const sinDefinir = filas.filter((f) => f.activo && f.sueldoBase <= 0).length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.75rem' }}>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="input" placeholder="Buscar cargo…" value={texto} onChange={(e) => setTexto(e.target.value)} style={{ minWidth: 220 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.85rem' }}>
            <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Ver desactivados
          </label>
        </div>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={() => setHistorialAbierto(true)} title="Cada cambio del tabulador, con su motivo">📜 Historial</button>
          {canWrite && (
            <>
              <button className="btn" onClick={() => setAplicando(true)} disabled={loading || !filas.length}
                title="Poner a todo el personal activo en el sueldo de su cargo (con vista previa)">
                ⚡ Aplicar tabulador{diff.cambios.length ? ` (${diff.cambios.length})` : ''}
              </button>
              <button className="btn btn-primary" onClick={() => setEdicion('nuevo')}>+ Agregar cargo</button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '.7rem', marginBottom: '.75rem' }}>
        <Cifra titulo="Cargos tabulados" valor={filas.filter((f) => f.activo).length} pie={sinDefinir ? `${sinDefinir} sin monto definido` : 'Todos con monto'} color={sinDefinir ? 'var(--warning)' : undefined} />
        <Cifra titulo="Cobran distinto" valor={diff.cambios.length} pie="Cambiarían al aplicar" color={diff.cambios.length ? 'var(--warning)' : 'var(--success)'} />
        <Cifra titulo="Ya en tabulador" valor={diff.sinCambio.length} pie="Cobran lo de su cargo" />
        <Cifra titulo="Fuera del tabulador" valor={diff.sinTabulador.length + diff.sinCargo.length} pie="Sin fila aplicable o sin cargo" />
      </div>

      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.86rem' }}>
          <thead>
            <tr>
              <th>Cargo</th>
              <th style={{ textAlign: 'right' }}>Sueldo base (USD/mes)</th>
              <th>Vigente desde</th>
              <th style={{ textAlign: 'center' }}>Personas activas</th>
              <th style={{ textAlign: 'center' }}>Cobran distinto</th>
              <th>Último cambio</th>
              <th style={{ textAlign: 'center' }}>Estado</th>
              {canWrite && <th style={{ textAlign: 'right' }}>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !visibles.length && (
              <tr><td colSpan={8}><EmptyState icon="📐" message={filas.length ? 'Ningún cargo coincide con la búsqueda' : 'Sin cargos en el tabulador'} /></td></tr>
            )}
            {!loading && visibles.map((f) => {
              const c = porCargo.get(normalizarCargo(f.cargo)) ?? { activos: 0, distinto: 0 };
              return (
                <tr key={f.id} style={f.activo ? undefined : { opacity: .55 }}>
                  <td><strong>{f.cargo}</strong></td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: f.sueldoBase > 0 ? undefined : 'var(--warning)' }}>
                    {f.sueldoBase > 0 ? money(f.sueldoBase) : 'Sin definir'}
                  </td>
                  <td className="mono">{date(f.vigenteDesde)}</td>
                  <td className="mono" style={{ textAlign: 'center' }}>{c.activos}</td>
                  <td className="mono" style={{ textAlign: 'center', color: c.distinto ? 'var(--warning)' : undefined }}>{c.distinto || '—'}</td>
                  <td className="muted" style={{ fontSize: '.76rem' }}>
                    {f.updatedAt ? dateTime(f.updatedAt) : '—'}
                    <div>{f.actualizadoPorNombre || f.actualizadoPor || ''}</div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span className="badge" style={{ color: f.activo ? 'var(--success)' : 'var(--muted)' }}>{f.activo ? 'Activo' : 'Desactivado'}</span>
                  </td>
                  {canWrite && (
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEdicion(f)} title="Cambiar el sueldo o la vigencia">✎</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEstadoDe(f)} title={f.activo ? 'Desactivar (no se aplica)' : 'Reactivar'}>{f.activo ? '⏸' : '▶'}</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <small className="hint muted" style={{ display: 'block', marginTop: '.5rem' }}>
        El tabulador es la <strong>referencia</strong>: cargarlo no cambia ningún sueldo. Los sueldos se mueven solo con
        <strong> ⚡ Aplicar tabulador</strong>, que muestra antes a quién toca y pide confirmar. Una fila <strong>«Sin definir»</strong> (0)
        o <strong>desactivada</strong> no se aplica a nadie. Cada cambio de esta tabla pide <strong>motivo</strong> y queda en 📜 Historial.
      </small>

      {edicion && (
        <EditarFilaModal fila={edicion === 'nuevo' ? null : edicion} existentes={filas} actor={actor} actorName={actorName}
          onClose={() => setEdicion(null)} onGuardado={() => { setEdicion(null); void recargar(true); }} />
      )}
      {estadoDe && (
        <CambiarEstadoModal fila={estadoDe} actor={actor} actorName={actorName}
          onClose={() => setEstadoDe(null)} onGuardado={() => { setEstadoDe(null); void recargar(true); }} />
      )}
      {historialAbierto && <HistorialTabuladorModal cargos={filas.map((f) => f.cargo)} onClose={() => setHistorialAbierto(false)} />}
      {aplicando && (
        <AplicarTabuladorModal personal={personal} filas={filas} actor={actor} actorName={actorName}
          onClose={() => setAplicando(false)} onAplicado={() => { setAplicando(false); void recargar(true); }} />
      )}
    </div>
  );
}

function Cifra({ titulo, valor, pie, color }: { titulo: string; valor: number; pie: string; color?: string }) {
  return (
    <div className="card" style={{ padding: '.6rem .8rem' }}>
      <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase' }}>{titulo}</div>
      <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 800, color }}>{valor}</div>
      <div className="muted" style={{ fontSize: '.74rem' }}>{pie}</div>
    </div>
  );
}

/* ───────── Alta / edición de una fila ───────── */
function EditarFilaModal({ fila, existentes, actor, actorName, onClose, onGuardado }: {
  fila: FilaTabulador | null; existentes: FilaTabulador[]; actor: string; actorName: string | null;
  onClose: () => void; onGuardado: () => void;
}) {
  const [cargo, setCargo] = useState(fila?.cargo ?? '');
  const [sueldo, setSueldo] = useState<number | null>(fila ? fila.sueldoBase : null);
  const [vigente, setVigente] = useState(fila?.vigenteDesde || hoyIso());
  const [motivo, setMotivo] = useState('');
  const [cargos, setCargos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (fila) return;
    listCargos().then(setCargos).catch(() => setCargos([]));
  }, [fila]);

  // Al dar de alta, los cargos que ya están en el tabulador no se ofrecen: se editan.
  const opciones = useMemo(() => {
    const ya = new Set(existentes.map((f) => normalizarCargo(f.cargo)));
    return cargos.filter((c) => !ya.has(normalizarCargo(c))).map((c) => ({ value: c, label: c }));
  }, [cargos, existentes]);

  const repetido = !fila && existentes.find((f) => normalizarCargo(f.cargo) === normalizarCargo(cargo));
  const v = fila ? variacionSueldo(fila.sueldoBase, sueldo ?? 0) : null;

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (repetido) { setError(`«${repetido.cargo}» ya está en el tabulador${repetido.activo ? '' : ' (desactivado)'}: editalo en vez de cargarlo de nuevo.`); return; }
    const falla = validarFilaTabulador({ cargo, sueldoBase: sueldo ?? 0, vigenteDesde: vigente, motivo });
    if (falla) { setError(falla); return; }
    setGuardando(true);
    try {
      await guardarFilaTabulador({ cargo, sueldoBase: sueldo ?? 0, vigenteDesde: vigente, motivo, activo: fila?.activo ?? true, actor, actorName });
      toast(fila ? 'Tabulador actualizado' : 'Cargo agregado al tabulador', 'success');
      onGuardado();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); }
    finally { setGuardando(false); }
  }

  return (
    <Modal title={fila ? `Tabulador · ${fila.cargo}` : 'Agregar cargo al tabulador'} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
        <button className="btn btn-primary" onClick={(e) => void guardar(e)} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
      </>}>
      <form onSubmit={(e) => void guardar(e)}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-grid">
          <div className="form-row" style={{ gridColumn: '1 / -1' }}>
            <label>Cargo</label>
            {fila ? (
              <input className="input" value={fila.cargo} disabled />
            ) : (
              <SearchSelect options={opciones} value={cargo} onChange={setCargo} allowCreate placeholder="Elegí o escribí el cargo…" />
            )}
            {!fila && <small className="hint muted">Se guarda en mayúsculas. Si el cargo no existe se crea acá; para la ficha del personal también vale.</small>}
          </div>
          <div className="form-row">
            <label>Sueldo base (USD / mes)</label>
            <DecimalInput className="input mono" value={sueldo} onChange={setSueldo} placeholder="0,00" />
            {v && <small className="hint muted">{textoVariacion(v)}</small>}
            {(sueldo ?? 0) <= 0 && <small className="hint" style={{ color: 'var(--warning)' }}>Con 0 queda «sin definir»: no se aplica a nadie.</small>}
          </div>
          <div className="form-row">
            <label>Vigente desde</label>
            <input className="input" type="date" value={vigente} onChange={(e) => setVigente(e.target.value)} />
          </div>
          <div className="form-row" style={{ gridColumn: '1 / -1' }}>
            <label>Motivo</label>
            <textarea className="input" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)}
              placeholder={fila ? 'Ej.: Revisión general de sueldos octubre 2026' : 'Ej.: Cargo nuevo, sueldo acordado con gerencia'} />
            <small className="hint muted">Queda en el historial del tabulador con la fecha y tu nombre.</small>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ───────── Desactivar / reactivar, con motivo ───────── */
function CambiarEstadoModal({ fila, actor, actorName, onClose, onGuardado }: {
  fila: FilaTabulador; actor: string; actorName: string | null; onClose: () => void; onGuardado: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const nuevoEstado = !fila.activo;

  async function guardar() {
    setError(null);
    const falla = validarFilaTabulador({ cargo: fila.cargo, sueldoBase: fila.sueldoBase, vigenteDesde: fila.vigenteDesde, motivo });
    if (falla) { setError(falla); return; }
    setGuardando(true);
    try {
      await guardarFilaTabulador({ cargo: fila.cargo, sueldoBase: fila.sueldoBase, vigenteDesde: fila.vigenteDesde, motivo, activo: nuevoEstado, actor, actorName });
      toast(nuevoEstado ? 'Cargo reactivado' : 'Cargo desactivado del tabulador', 'success');
      onGuardado();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); }
    finally { setGuardando(false); }
  }

  return (
    <Modal title={`${nuevoEstado ? 'Reactivar' : 'Desactivar'} · ${fila.cargo}`} size="sm" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
        <button className={`btn ${nuevoEstado ? 'btn-primary' : 'btn-danger'}`} onClick={() => void guardar()} disabled={guardando}>
          {guardando ? 'Guardando…' : nuevoEstado ? 'Reactivar' : 'Desactivar'}
        </button>
      </>}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
      <p style={{ marginTop: 0, fontSize: '.9rem' }}>
        {nuevoEstado
          ? <>El cargo vuelve a aplicarse al personal que lo tenga, con {fila.sueldoBase > 0 ? <strong className="mono">{money(fila.sueldoBase)}</strong> : 'su monto (hoy sin definir)'}.</>
          : <>El cargo <strong>deja de aplicarse</strong>: quien lo tenga conserva su sueldo actual. La fila no se borra, queda en gris.</>}
      </p>
      <div className="form-row">
        <label>Motivo</label>
        <textarea className="input" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: El cargo ya no existe en la empresa" />
      </div>
    </Modal>
  );
}

/* ───────── Historial del tabulador, con filtro por cargo ───────── */
function HistorialTabuladorModal({ cargos, onClose }: { cargos: string[]; onClose: () => void }) {
  const [filas, setFilas] = useState<HistorialTabulador[]>([]);
  const [loading, setLoading] = useState(true);
  const [cargo, setCargo] = useState('');

  useEffect(() => {
    let vivo = true;
    listHistorialTabulador()
      .then((r) => { if (vivo) setFilas(r); })
      .catch((e) => toast(e instanceof Error ? e.message : 'No se pudo cargar el historial', 'error'))
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, []);

  const opciones = useMemo(() => {
    const set = new Set<string>([...cargos, ...filas.map((f) => f.cargo)].map(normalizarCargo).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, 'es'));
  }, [cargos, filas]);
  const visibles = filtrarHistorialPorCargo(filas, cargo);

  return (
    <Modal title="Historial del tabulador" size="lg" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '.6rem', flexWrap: 'wrap' }}>
        <select className="select" value={cargo} onChange={(e) => setCargo(e.target.value)} style={{ minWidth: 240 }}>
          <option value="">Todos los cargos</option>
          {opciones.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="muted" style={{ fontSize: '.82rem' }}>{visibles.length} movimiento(s)</span>
      </div>
      <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead>
            <tr>
              <th>Fecha</th><th>Cargo</th><th>Acción</th>
              <th style={{ textAlign: 'right' }}>Antes</th>
              <th style={{ textAlign: 'right' }}>Después</th>
              <th style={{ textAlign: 'center' }}>Var. %</th>
              <th>Vigente desde</th><th>Motivo</th><th>Cambiado por</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !visibles.length && <tr><td colSpan={9}><EmptyState icon="📜" message="Sin movimientos" /></td></tr>}
            {!loading && visibles.map((h) => {
              const v = variacionSueldo(h.sueldoAnterior, h.sueldoNuevo);
              return (
                <tr key={h.id}>
                  <td className="mono muted" style={{ fontSize: '.76rem' }}>{dateTime(h.createdAt)}</td>
                  <td><strong>{h.cargo}</strong></td>
                  <td><span className="badge">{labelAccionTabulador(h.accion)}</span></td>
                  <td className="mono" style={{ textAlign: 'right' }}>{h.sueldoAnterior > 0 ? money(h.sueldoAnterior) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{h.sueldoNuevo > 0 ? money(h.sueldoNuevo) : 'Sin definir'}</td>
                  <td className="mono" style={{ textAlign: 'center', color: v.direccion === 'aumento' ? 'var(--success)' : v.direccion === 'rebaja' ? 'var(--danger)' : undefined }}>{textoPct(v)}</td>
                  <td className="mono">{h.vigenteDesde ? date(h.vigenteDesde) : '—'}</td>
                  <td style={{ maxWidth: 260, whiteSpace: 'normal' }}>{h.motivo}</td>
                  <td className="muted" style={{ fontSize: '.76rem' }}>{h.cambiadoPorNombre || h.cambiadoPor || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <small className="hint muted" style={{ display: 'block', marginTop: '.4rem' }}>
        El historial <strong>no se edita ni se borra</strong>: si algo quedó mal, se registra otro cambio que lo corrija.
      </small>
    </Modal>
  );
}

/* ───────── Aplicar: vista previa y confirmación ───────── */
function AplicarTabuladorModal({ personal, filas, actor, actorName, onClose, onAplicado }: {
  personal: Personal[]; filas: FilaTabulador[]; actor: string; actorName: string | null;
  onClose: () => void; onAplicado: () => void;
}) {
  const [vigente, setVigente] = useState(hoyIso());
  const [confirmo, setConfirmo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const diff = useMemo(() => diffAplicarTabulador(personal, filas), [personal, filas]);
  const fechaOk = /^\d{4}-\d{2}-\d{2}$/.test(vigente);

  async function aplicar() {
    setError(null);
    if (!fechaOk) { setError('Indicá desde cuándo rigen los sueldos nuevos.'); return; }
    setCorriendo(true);
    try {
      const r = await aplicarTabulador(vigente, actor, actorName);
      toast(r.cambiados ? `Tabulador aplicado: ${r.cambiados} sueldo(s) actualizado(s)` : 'Nadie cobraba distinto: no hubo cambios', 'success');
      onAplicado();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo aplicar el tabulador'); }
    finally { setCorriendo(false); }
  }

  return (
    <Modal title="Aplicar tabulador al personal" size="lg" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={corriendo}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void aplicar()} disabled={corriendo || !diff.cambios.length || !confirmo || !fechaOk}>
          {corriendo ? 'Aplicando…' : `Aplicar a ${diff.cambios.length} persona(s)`}
        </button>
      </>}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '.6rem' }}>
        <div className="form-row" style={{ margin: 0 }}>
          <label>Los sueldos nuevos rigen desde</label>
          <input className="input" type="date" value={vigente} onChange={(e) => setVigente(e.target.value)} />
        </div>
        <div className="muted" style={{ fontSize: '.84rem' }}>
          En el historial de cada persona quedará: <strong>«{motivoTabulador(fechaOk ? vigente : hoyIso())}»</strong>
        </div>
      </div>

      <div className="card" style={{ padding: '.6rem .8rem', marginBottom: '.6rem', fontSize: '.88rem' }}>
        {resumenAplicacion(diff)}{diff.sinCargo.length ? ` · ${diff.sinCargo.length} sin cargo cargado` : ''}.
      </div>

      {!diff.cambios.length ? (
        <EmptyState icon="✓" message="Todo el personal activo con cargo tabulado ya cobra lo del tabulador. No hay nada que aplicar." />
      ) : (
        <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead>
              <tr>
                <th>Empleado</th><th>Cédula</th><th>Cargo</th>
                <th style={{ textAlign: 'right' }}>Cobra hoy</th>
                <th style={{ textAlign: 'right' }}>Pasa a</th>
                <th style={{ textAlign: 'center' }}>Var. %</th>
              </tr>
            </thead>
            <tbody>
              {diff.cambios.map((c) => (
                <tr key={c.persona.id}>
                  <td>{c.persona.nombre} {c.persona.apellido ?? ''}</td>
                  <td className="mono">{c.persona.cedula || '—'}</td>
                  <td>{c.cargo}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{c.anterior > 0 ? money(c.anterior) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{money(c.nuevo)}</td>
                  <td className="mono" style={{ textAlign: 'center', color: c.variacion.direccion === 'aumento' ? 'var(--success)' : 'var(--danger)' }}>{textoPct(c.variacion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {diff.sinTabulador.length > 0 && (
        <details style={{ marginTop: '.6rem', fontSize: '.82rem' }}>
          <summary className="muted">{diff.sinTabulador.length} persona(s) con cargo fuera del tabulador (no se tocan)</summary>
          <div className="muted" style={{ marginTop: '.3rem' }}>
            {diff.sinTabulador.map((p) => `${p.nombre} ${p.apellido ?? ''} · ${p.cargo}`).join(' — ')}
          </div>
        </details>
      )}

      {diff.cambios.length > 0 && (
        <label style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start', marginTop: '.8rem', fontSize: '.88rem' }}>
          <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} style={{ marginTop: 3 }} />
          <span>Revisé la lista. Entiendo que se cambian <strong>{diff.cambios.length}</strong> sueldo(s) de una vez (todo o nada) y que cada
            cambio queda en el historial salarial de la persona con la fecha y mi nombre.</span>
        </label>
      )}
    </Modal>
  );
}
