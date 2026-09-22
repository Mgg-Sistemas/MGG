import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { money, date as fmtDate } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Personal, RrhhEvento } from '@/shared/lib/types';
import { listPersonal } from './personal.repository';
import { listEventos, crearEvento, eliminarEvento, marcarVacacionProcesada } from './eventos.repository';
import { EMPRESA_POR_DEFECTO, type Empresa } from './empresa';
import { procesarVacacion, montoVacacion } from './nomina.repository';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function parseDate(s?: string | null): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function diasInclusive(desde: string, hasta: string): number {
  const a = parseDate(desde), b = parseDate(hasta);
  if (!a || !b) return 0;
  return Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
}
function solapan(aDesde: string, aHasta: string, bDesde: string, bHasta: string): boolean {
  const a1 = parseDate(aDesde), a2 = parseDate(aHasta), b1 = parseDate(bDesde), b2 = parseDate(bHasta);
  if (!a1 || !a2 || !b1 || !b2) return false;
  return a1 <= b2 && b1 <= a2;
}

export function VacacionesTab({ canWrite, actor, actorName, empresa = EMPRESA_POR_DEFECTO }: {
  canWrite: boolean; actor: string; actorName: string | null; empresa?: Empresa;
}) {
  const now = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [personal, setPersonal] = useState<Personal[]>([]);
  const [eventos, setEventos] = useState<RrhhEvento[]>([]);
  const [loading, setLoading] = useState(true);
  const [detalle, setDetalle] = useState<RrhhEvento | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const recargar = useCallback(async () => {
    setLoading(true);
    // Cada carga con su propio catch: un fallo en eventos no deja sin personal al selector.
    const [ps, ev] = await Promise.all([
      listPersonal(false, empresa).catch((e) => { toast(e instanceof Error ? e.message : 'No se pudo cargar el personal', 'error'); return [] as Personal[]; }),
      listEventos(undefined, 'vacacion', empresa).catch(() => [] as RrhhEvento[]),
    ]);
    setPersonal(ps); setEventos(ev);
    setLoading(false);
  }, []);
  useEffect(() => { void recargar(); }, [recargar]);
  useRealtime(['rrhh_eventos', 'personal'], () => { void recargar(); });

  const persById = useMemo(() => new Map(personal.map((p) => [p.id, p])), [personal]);
  const deptOf = (e: RrhhEvento) => persById.get(e.personal_id)?.departamento || '';

  // Conflictos: vacaciones del MISMO departamento con fechas que se solapan.
  const conflictoIds = useMemo(() => {
    const ids = new Set<string>();
    const conFechas = eventos.filter((e) => e.fecha_desde && e.fecha_hasta);
    for (let i = 0; i < conFechas.length; i++) {
      for (let j = i + 1; j < conFechas.length; j++) {
        const a = conFechas[i], b = conFechas[j];
        const da = deptOf(a), db = deptOf(b);
        if (da && db && da.toLowerCase() === db.toLowerCase() && a.personal_id !== b.personal_id &&
          solapan(a.fecha_desde!, a.fecha_hasta!, b.fecha_desde!, b.fecha_hasta!)) {
          ids.add(a.id); ids.add(b.id);
        }
      }
    }
    return ids;
  }, [eventos, persById]);

  // Mes visible.
  const D = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const mesIni = new Date(cursor.y, cursor.m, 1);
  const mesFin = new Date(cursor.y, cursor.m, D);
  const esMesActual = cursor.y === now.getFullYear() && cursor.m === now.getMonth();

  // Eventos del mes (que se solapen con el mes visible), agrupados por persona.
  const delMes = eventos.filter((e) => {
    const a = parseDate(e.fecha_desde), b = parseDate(e.fecha_hasta);
    return a && b && a <= mesFin && b >= mesIni;
  });
  const filas = useMemo(() => {
    const byPers = new Map<string, RrhhEvento[]>();
    for (const e of delMes) {
      const arr = byPers.get(e.personal_id) ?? [];
      arr.push(e); byPers.set(e.personal_id, arr);
    }
    return [...byPers.entries()].map(([pid, evs]) => ({ persona: persById.get(pid), pid, evs }))
      .sort((a, b) => (a.persona?.nombre || '').localeCompare(b.persona?.nombre || ''));
  }, [delMes, persById]);

  function mover(delta: number) {
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  const hayConflictos = filas.some((f) => f.evs.some((e) => conflictoIds.has(e.id)));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <button className="btn btn-sm btn-ghost" onClick={() => mover(-1)}>←</button>
          <strong style={{ minWidth: 150, textAlign: 'center' }}>{MESES[cursor.m]} {cursor.y}</strong>
          <button className="btn btn-sm btn-ghost" onClick={() => mover(1)}>→</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setCursor({ y: now.getFullYear(), m: now.getMonth() })}>Hoy</button>
        </div>
        {canWrite && <button className="btn btn-primary" onClick={() => setAddOpen(true)}>+ Programar vacaciones</button>}
      </div>

      {hayConflictos && (
        <div className="card" style={{ borderColor: 'var(--warning)', background: 'rgba(255,170,0,.06)', marginBottom: '.6rem', fontSize: '.85rem' }}>
          ⚠ <strong>Cruce de vacaciones en un mismo departamento.</strong> Las barras marcadas en naranja se solapan con otra persona del mismo departamento.
        </div>
      )}

      {loading ? <div className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Cargando…</div>
        : !filas.length ? <EmptyState message="Sin vacaciones programadas este mes" icon="🏖" />
        : (
          <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: `160px repeat(${D}, minmax(26px, 1fr))`,
              gridAutoRows: '36px',
              minWidth: 160 + D * 26,
            }}>
              {/* Encabezado */}
              <div style={{ gridColumn: 1, gridRow: 1, position: 'sticky', left: 0, zIndex: 2, background: 'var(--card, #15181d)', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 .5rem', fontSize: '.78rem', fontWeight: 700 }}>Trabajador</div>
              {Array.from({ length: D }, (_, i) => i + 1).map((d) => (
                <div key={`h${d}`} style={{ gridColumn: d + 1, gridRow: 1, borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.7rem', color: esMesActual && d === now.getDate() ? '#fff' : 'var(--muted)', background: esMesActual && d === now.getDate() ? 'var(--danger, #e5484d)' : 'transparent', fontWeight: esMesActual && d === now.getDate() ? 700 : 400 }}>{d}</div>
              ))}

              {/* Filas */}
              {filas.map((f, i) => {
                const row = i + 2;
                return (
                  <FilaCalendario key={f.pid} row={row} D={D} persona={f.persona} evs={f.evs}
                    cursorY={cursor.y} cursorM={cursor.m} conflictoIds={conflictoIds} onClick={setDetalle} />
                );
              })}
            </div>
          </div>
        )}

      {detalle && (
        <VacacionDetalleModal evento={detalle} persona={persById.get(detalle.personal_id) ?? null}
          enConflicto={conflictoIds.has(detalle.id)} canWrite={canWrite} actor={actor} actorName={actorName}
          onClose={() => setDetalle(null)} onChanged={async () => { setDetalle(null); await recargar(); }} />
      )}
      {addOpen && (
        <ProgramarVacacionModal personal={personal} eventos={eventos} actor={actor} actorName={actorName}
          onClose={() => setAddOpen(false)} onSaved={async () => { setAddOpen(false); await recargar(); }} />
      )}
    </div>
  );
}

function FilaCalendario({ row, D, persona, evs, cursorY, cursorM, conflictoIds, onClick }: {
  row: number; D: number; persona?: Personal; evs: RrhhEvento[]; cursorY: number; cursorM: number;
  conflictoIds: Set<string>; onClick: (e: RrhhEvento) => void;
}) {
  const mesIni = new Date(cursorY, cursorM, 1);
  const mesFin = new Date(cursorY, cursorM, D);
  return (
    <>
      <div style={{ gridColumn: 1, gridRow: row, position: 'sticky', left: 0, zIndex: 1, background: 'var(--card, #15181d)', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 .5rem', fontSize: '.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {persona ? `${persona.nombre} ${persona.apellido}` : '—'}
        {persona?.departamento && <span className="muted" style={{ fontSize: '.68rem', marginLeft: '.3rem' }}>· {persona.departamento}</span>}
      </div>
      {Array.from({ length: D }, (_, i) => i + 1).map((d) => (
        <div key={`c${row}-${d}`} style={{ gridColumn: d + 1, gridRow: row, borderBottom: '1px solid var(--border)', borderRight: '1px solid rgba(255,255,255,.05)' }} />
      ))}
      {evs.map((e) => {
        const a = parseDate(e.fecha_desde), b = parseDate(e.fecha_hasta);
        if (!a || !b) return null;
        const ini = a < mesIni ? mesIni : a;
        const fin = b > mesFin ? mesFin : b;
        const startDay = ini.getDate();
        const endDay = fin.getDate();
        const conflicto = conflictoIds.has(e.id);
        const procesada = !!e.procesada;
        return (
          <div key={e.id} role="button" title="Ver detalle" onClick={() => onClick(e)}
            style={{
              gridColumn: `${startDay + 1} / ${endDay + 2}`, gridRow: row,
              alignSelf: 'center', margin: '0 2px', height: 24, borderRadius: 6, cursor: 'pointer',
              background: procesada ? 'var(--success, #16a05a)' : 'var(--danger, #e5484d)',
              border: conflicto ? '2px solid var(--warning, #ffae00)' : '2px solid transparent',
              color: '#fff', fontSize: '.7rem', display: 'flex', alignItems: 'center', padding: '0 .4rem', overflow: 'hidden', whiteSpace: 'nowrap',
            }}>
            {procesada ? '✓ ' : ''}Vacaciones{e.dias ? ` · ${e.dias}d` : ''}
          </div>
        );
      })}
    </>
  );
}

/* ───────── Detalle de una vacación (monto + procesar) ───────── */
function VacacionDetalleModal({ evento, persona, enConflicto, canWrite, actor, actorName, onClose, onChanged }: {
  evento: RrhhEvento; persona: Personal | null; enConflicto: boolean; canWrite: boolean; actor: string; actorName: string | null;
  onClose: () => void; onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const dias = Number(evento.dias) || (evento.fecha_desde && evento.fecha_hasta ? diasInclusive(evento.fecha_desde, evento.fecha_hasta) : 0);
  const sueldo = Number(persona?.sueldo_base) || 0;
  const monto = montoVacacion(sueldo, dias);

  async function procesar() {
    if (!persona) { toast('Sin trabajador asociado', 'error'); return; }
    if (sueldo <= 0) { toast('El trabajador no tiene sueldo base cargado', 'error'); return; }
    setSaving(true);
    try {
      const { renglonId, neto } = await procesarVacacion({ persona, dias, desde: evento.fecha_desde, hasta: evento.fecha_hasta, actorEmail: actor, actorName });
      await marcarVacacionProcesada(evento.id, renglonId);
      notify(`Vacaciones de ${persona.nombre} enviadas a Tesorería · ${money(neto)}`, 'success', { link: '#/app/tesoreria' });
      onChanged();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo procesar', 'error'); setSaving(false); }
  }

  // El cartel del navegador se reemplaza por el diálogo del sistema.
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);
  async function borrar() {
    try { await eliminarEvento(evento.id); setConfirmarBorrar(false); onChanged(); toast('Eliminada', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); setConfirmarBorrar(false); }
  }

  return (
    <Modal title="Detalle de vacaciones" size="md" onClose={onClose} footer={
      <>
        {canWrite && !evento.procesada && <button className="btn btn-ghost" onClick={() => setConfirmarBorrar(true)} style={{ color: 'var(--danger)' }}>🗑 Eliminar</button>}
        {canWrite && !evento.procesada && <button className="btn btn-primary" onClick={procesar} disabled={saving || sueldo <= 0}>{saving ? 'Procesando…' : '💸 Procesar Vacación'}</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>
    }>
      {enConflicto && (
        <div className="card" style={{ borderColor: 'var(--warning)', background: 'rgba(255,170,0,.06)', marginBottom: '.6rem', fontSize: '.84rem' }}>
          ⚠ Se solapa con otra persona del <strong>mismo departamento</strong>.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.4rem .9rem', fontSize: '.86rem' }}>
        <div><span className="muted">Trabajador:</span> <strong>{persona ? `${persona.nombre} ${persona.apellido}` : '—'}</strong></div>
        <div><span className="muted">Departamento:</span> <strong>{persona?.departamento || '—'}</strong></div>
        <div><span className="muted">Desde:</span> <strong>{fmtDate(evento.fecha_desde)}</strong></div>
        <div><span className="muted">Hasta:</span> <strong>{fmtDate(evento.fecha_hasta)}</strong></div>
        <div><span className="muted">Días:</span> <strong>{dias}</strong></div>
        <div><span className="muted">Sueldo mensual:</span> <strong className="mono">{sueldo > 0 ? money(sueldo) : '—'}</strong></div>
      </div>
      {evento.descripcion && <div style={{ marginTop: '.5rem', fontSize: '.84rem' }}><span className="muted">Nota:</span> {evento.descripcion}</div>}

      <div className="card" style={{ marginTop: '.7rem', padding: '.7rem', borderColor: 'var(--brand, #ff8a00)' }}>
        <div style={{ fontSize: '.86rem' }}>
          Pago de vacaciones = sueldo diario (mensual ÷ 30) × {dias} día(s) =
          {' '}<strong className="mono" style={{ fontSize: '1.1rem', color: 'var(--success)' }}>{money(monto)}</strong>
        </div>
        {sueldo <= 0 && <small style={{ color: 'var(--danger)' }}>Cargá el sueldo base del trabajador en la pestaña Personal para poder procesar.</small>}
      </div>

      {evento.procesada ? (
        <div className="muted" style={{ marginTop: '.6rem', fontSize: '.84rem' }}>✓ Ya procesada — está en la cola de pago de Tesorería (o ya pagada).</div>
      ) : (
        <div className="muted" style={{ marginTop: '.6rem', fontSize: '.84rem' }}>Al <strong>Procesar Vacación</strong> se genera un renglón en Tesorería (motivo <strong>Vacaciones</strong>) para pagarlo.</div>
      )}

      {confirmarBorrar && (
        <ConfirmDialog
          title="Eliminar vacación"
          message="¿Eliminar esta vacación? El registro sale del histórico del trabajador."
          confirmText="Eliminar" danger
          onConfirm={() => void borrar()}
          onCancel={() => setConfirmarBorrar(false)} />
      )}
    </Modal>
  );
}

/* ───────── Programar vacaciones (con chequeo de cruce por depto) ───────── */
function ProgramarVacacionModal({ personal, eventos, actor, actorName, onClose, onSaved }: {
  personal: Personal[]; eventos: RrhhEvento[]; actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [personaId, setPersonaId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persona = personal.find((p) => p.id === personaId) ?? null;
  const dias = desde && hasta ? diasInclusive(desde, hasta) : 0;

  // Cruce con el mismo departamento.
  const conflicto = useMemo(() => {
    if (!persona?.departamento || !desde || !hasta) return null;
    const dep = persona.departamento.toLowerCase();
    for (const e of eventos) {
      if (e.personal_id === personaId || !e.fecha_desde || !e.fecha_hasta) continue;
      const otra = personal.find((p) => p.id === e.personal_id);
      if ((otra?.departamento || '').toLowerCase() !== dep) continue;
      if (solapan(desde, hasta, e.fecha_desde, e.fecha_hasta)) return otra ? `${otra.nombre} ${otra.apellido}` : 'otro trabajador';
    }
    return null;
  }, [persona, desde, hasta, eventos, personal, personaId]);

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!persona) { setError('Elegí el trabajador.'); return; }
    if (!desde || !hasta) { setError('Indicá las fechas.'); return; }
    if (dias <= 0) { setError('La fecha "hasta" debe ser posterior o igual a "desde".'); return; }
    if (conflicto) { setError(`Cruce de vacaciones: ${conflicto} (mismo departamento) ya está de vacaciones en esas fechas.`); return; }
    setSaving(true);
    try {
      await crearEvento({ personal_id: persona.id, tipo: 'vacacion', fecha_desde: desde, fecha_hasta: hasta, dias, descripcion }, actor, actorName);
      toast('Vacaciones programadas', 'success');
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }

  return (
    <Modal title="Programar vacaciones" size="md" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" form="prog-vac" className="btn btn-primary" disabled={saving || !!conflicto}>{saving ? 'Guardando…' : 'Programar'}</button>
      </>
    }>
      <form id="prog-vac" onSubmit={guardar}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-grid">
          <div className="form-row" style={{ gridColumn: '1 / -1' }}>
            <label>Trabajador</label>
            <select className="select" value={personaId} onChange={(e) => setPersonaId(e.target.value)} required>
              <option value="">— elegir —</option>
              {personal.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}{p.departamento ? ` · ${p.departamento}` : ''}</option>)}
            </select>
          </div>
          <div className="form-row"><label>Desde</label><input className="input" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} required /></div>
          <div className="form-row"><label>Hasta</label><input className="input" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} required /></div>
          <div className="form-row" style={{ gridColumn: '1 / -1' }}><label>Nota (opcional)</label><input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Detalle" /></div>
        </div>
        {dias > 0 && <div className="muted" style={{ marginTop: '.4rem', fontSize: '.84rem' }}>{dias} día(s){persona && Number(persona.sueldo_base) > 0 ? ` · pago estimado ${money(montoVacacion(Number(persona.sueldo_base), dias))}` : ''}</div>}
        {conflicto && <div className="card" style={{ borderColor: 'var(--warning)', background: 'rgba(255,170,0,.06)', marginTop: '.5rem', fontSize: '.84rem' }}>⚠ <strong>{conflicto}</strong> (mismo departamento) ya tiene vacaciones que se cruzan con esas fechas. Ajustá las fechas.</div>}
      </form>
    </Modal>
  );
}
