/* ============================================================
   MGG · RRHH · Histórico de cargos de una persona (04-11-2026, como en GT)

   Se abre con 🧭 en la lista de personal. Arriba: cargo actual, departamento,
   cuántos cambios y el último. Abajo: cada cambio —de cuál a cuál, desde
   cuándo y con qué motivo— y es el ÚNICO lugar donde se cambia el cargo de una
   ficha que ya existe. «📄 PDF» abre el reporte en vista previa.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { Quien } from '@/shared/ui/Quien';
import { ConfirmDialog, Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { date, dateTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useQuien } from '@/shared/lib/directorioUsuarios';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import type { Personal } from '@/shared/lib/types';
import { MOTIVOS_CARGO, errorCambioCargo, motivoCargoFinal, type CambioCargo } from './cambiosCargo';
import { borrarCambioCargo, cambiarCargoPersona, listCambiosCargo } from './personal.repository';

export function HistorialCargoModal({
  persona, canWrite, isAdmin, cargos, departamentos, actor, actorName, onClose, onCambio,
}: {
  persona: Personal;
  canWrite: boolean;
  isAdmin: boolean;
  /** Catálogo de cargos y departamentos (se puede escribir uno nuevo). */
  cargos: string[];
  departamentos: string[];
  actor: string;
  actorName?: string | null;
  onClose: () => void;
  /** Para que la lista de atrás muestre el cargo nuevo sin recargar la página. */
  onCambio: () => void;
}) {
  const hoy = hoyVenezuela();
  const quien = useQuien();
  const [filas, setFilas] = useState<CambioCargo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [abriendoPdf, setAbriendoPdf] = useState(false);
  const [porBorrar, setPorBorrar] = useState<CambioCargo | null>(null);
  const [cargoHoy, setCargoHoy] = useState(persona.cargo ?? '');
  const [deptoHoy, setDeptoHoy] = useState(persona.departamento ?? '');

  const [cargoNuevo, setCargoNuevo] = useState('');
  const [deptoNuevo, setDeptoNuevo] = useState('');
  const [motivo, setMotivo] = useState<string>(MOTIVOS_CARGO[0]);
  const [otro, setOtro] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [nota, setNota] = useState('');

  const recargar = useCallback(async () => {
    try { setFilas(await listCambiosCargo(persona.id)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar el historial'); }
    finally { setCargando(false); }
  }, [persona.id]);
  useEffect(() => { void recargar(); }, [recargar]);
  useRealtime(['rrhh_cambios_cargo'], () => { void recargar(); });

  const motivoElegido = motivoCargoFinal(motivo, otro);
  const mismo = cargoNuevo.trim().toUpperCase() === cargoHoy.trim().toUpperCase() && (!deptoNuevo.trim() || deptoNuevo.trim().toUpperCase() === deptoHoy.trim().toUpperCase());
  const problema = abierto
    ? (errorCambioCargo({ cargoNuevo, fecha, motivo: motivoElegido, hoy }) ?? (mismo ? 'El cargo nuevo es el mismo que tiene hoy.' : null))
    : null;

  function limpiar() { setCargoNuevo(''); setDeptoNuevo(''); setMotivo(MOTIVOS_CARGO[0]); setOtro(''); setFecha(hoy); setNota(''); }

  async function guardar() {
    if (problema) { setError(problema); return; }
    setGuardando(true); setError(null);
    try {
      const r = await cambiarCargoPersona({
        personalId: persona.id, cargoNuevo, departamentoNuevo: deptoNuevo || null, fecha, motivo: motivoElegido,
        nota: nota || null, actor, actorName: actorName ?? null,
      });
      setCargoHoy(r.cargo_nuevo); setDeptoHoy(r.departamento_nuevo ?? deptoHoy);
      toast('Cargo cambiado y registrado en el historial', 'success');
      limpiar(); setAbierto(false);
      await recargar();
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar el cargo');
    } finally { setGuardando(false); }
  }

  async function verPdf() {
    setAbriendoPdf(true);
    try {
      const { verCambiosCargoPdf } = await import('./cambiosCargoPdf');
      const nombre = `${persona.nombre} ${persona.apellido ?? ''}`.trim();
      await verCambiosCargoPdf(filas.map((c) => ({ cambio: c, persona: nombre, cedula: persona.cedula ?? '', registro: quien(c.actor_name, c.actor) || c.actor_name || c.actor || '—' })), {
        titulo: `Histórico de cargos · ${nombre}`,
        subtitulo: `C.I. ${persona.cedula || '—'} · cargo actual: ${cargoHoy || 'sin cargo'} · ${deptoHoy || 'sin departamento'}`,
      });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
    finally { setAbriendoPdf(false); }
  }

  async function borrar(r: CambioCargo) {
    setPorBorrar(null);
    try { await borrarCambioCargo(r.id); await recargar(); toast('Renglón borrado', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error'); }
  }

  const nombre = `${persona.nombre} ${persona.apellido ?? ''}`.trim();
  const tira = (titulo: string, valor: string, mono = false) => (
    <div className="card" style={{ flex: '1 1 160px', margin: 0, padding: '.5rem .75rem' }}>
      <div className="muted" style={{ fontSize: '.74rem' }}>{titulo}</div>
      <div className={mono ? 'mono' : undefined} style={{ fontWeight: 800, fontSize: '.95rem' }}>{valor}</div>
    </div>
  );

  return (
    <Modal
      title={`Histórico de cargos · ${nombre}`}
      size="lg"
      onClose={() => { if (!guardando) onClose(); }}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cerrar</button>
          <button className="btn btn-ghost" onClick={() => void verPdf()} disabled={abriendoPdf}
            title="El reporte para el expediente, en vista previa">{abriendoPdf ? 'Armando…' : '📄 PDF'}</button>
          {canWrite && !abierto && (
            <button className="btn btn-primary" onClick={() => { limpiar(); setAbierto(true); setError(null); }}>🧭 Cambiar cargo</button>
          )}
          {canWrite && abierto && (
            <button className="btn btn-primary" onClick={() => void guardar()} disabled={guardando || !!problema}>
              {guardando ? 'Guardando…' : 'Guardar el cambio'}
            </button>
          )}
        </>
      }
    >
      {error && (
        <div className="aviso danger" style={{ marginBottom: '.6rem' }}>
          <span className="aviso-icono">⛔</span><div><strong>Error:</strong> {error}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.7rem' }}>
        {tira('Cargo actual', cargoHoy || '—')}
        {tira('Departamento', deptoHoy || '—')}
        {tira('Cambios registrados', String(filas.length), true)}
        {tira('Último cambio', filas.length ? date(filas[0].fecha) : '—', true)}
      </div>

      {abierto && (
        <div className="card" style={{ marginBottom: '.8rem', padding: '.8rem' }}>
          <datalist id="hc-cargos">{cargos.map((c) => <option key={c} value={c} />)}</datalist>
          <datalist id="hc-deptos">{departamentos.map((d) => <option key={d} value={d} />)}</datalist>
          <div className="form-grid">
            <div className="form-row">
              <label>Cargo nuevo *</label>
              <input className="input" list="hc-cargos" value={cargoNuevo} autoFocus
                onChange={(e) => setCargoNuevo(e.target.value.toUpperCase())} placeholder="Elige o escribe el cargo" />
              <small className="muted">Antes: {cargoHoy || '—'}</small>
            </div>
            <div className="form-row">
              <label>Departamento (si cambia)</label>
              <input className="input" list="hc-deptos" value={deptoNuevo}
                onChange={(e) => setDeptoNuevo(e.target.value.toUpperCase())} placeholder={deptoHoy || 'Sin cambio'} />
            </div>
            <div className="form-row">
              <label>Fecha del cambio *</label>
              <input className="input" type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} />
              <small className="muted">Desde cuándo rige. Puede ser anterior a hoy.</small>
            </div>
            <div className="form-row">
              <label>Motivo del cambio *</label>
              <select className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                {MOTIVOS_CARGO.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              {motivo === 'Otro' && (
                <input className="input" style={{ marginTop: '.35rem' }} value={otro} onChange={(e) => setOtro(e.target.value)} placeholder="Escribe el motivo" />
              )}
            </div>
            <div className="form-row">
              <label>Nota (opcional)</label>
              <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej. aprobado por la gerencia el 01/11" />
            </div>
          </div>
          {problema && <div className="aviso warning sm" style={{ marginTop: '.5rem' }}><span className="aviso-icono">⚠</span><div>{problema}</div></div>}
          <button className="btn btn-sm btn-ghost" style={{ marginTop: '.5rem' }} onClick={() => { setAbierto(false); setError(null); }} disabled={guardando}>Cancelar</button>
        </div>
      )}

      {cargando && <p className="muted">Cargando…</p>}
      {!cargando && !filas.length && <EmptyState icon="🧭" message="Todavía no hay cambios de cargo registrados para esta persona." />}

      {!cargando && !!filas.length && (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.84rem' }}>
            <thead>
              <tr>
                <th>Fecha del cambio</th><th>Cargo anterior</th><th>Cargo nuevo</th><th>Departamento</th><th>Motivo</th><th>Cargado</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {filas.map((r) => {
                const deptoCambio = (r.departamento_anterior || '') !== (r.departamento_nuevo || '');
                return (
                  <tr key={r.id}>
                    <td className="mono">{date(r.fecha)}</td>
                    <td className="muted">{r.cargo_anterior || '—'}</td>
                    <td><strong>{r.cargo_nuevo || '—'}</strong></td>
                    <td>{deptoCambio ? `${r.departamento_anterior || '—'} → ${r.departamento_nuevo || '—'}` : (r.departamento_nuevo || '—')}</td>
                    <td>
                      {r.motivo}
                      {r.nota && <div className="muted" style={{ fontSize: '.76rem' }}>{r.nota}</div>}
                    </td>
                    <td className="muted" style={{ fontSize: '.76rem' }}>
                      {dateTime(r.created_at)}
                      {(r.actor || r.actor_name) && <div><Quien nombre={r.actor_name} correo={r.actor} /></div>}
                      {r.origen === 'historico' && <span className="badge" style={{ fontSize: '.65rem' }}>Histórico</span>}
                    </td>
                    {isAdmin && (
                      <td style={{ textAlign: 'center' }}>
                        <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }}
                          title="Borrar este renglón (no cambia el cargo de hoy)" onClick={() => setPorBorrar(r)}>🗑</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <small className="muted" style={{ display: 'block', marginTop: '.6rem' }}>
        Los renglones <strong>no se editan</strong>: si uno quedó mal, un administrador lo borra y se vuelve a cargar.
      </small>

      {porBorrar && (
        <ConfirmDialog
          title="Borrar renglón del historial"
          danger
          confirmText="Sí, borrar"
          message={<>Sale del historial el cambio <strong>{porBorrar.cargo_anterior || '—'} → {porBorrar.cargo_nuevo || '—'}</strong> del {date(porBorrar.fecha)}.
            <strong> No cambia el cargo que la persona tiene hoy</strong> ({cargoHoy || '—'}).</>}
          onConfirm={() => { void borrar(porBorrar); }}
          onCancel={() => setPorBorrar(null)}
        />
      )}
    </Modal>
  );
}
