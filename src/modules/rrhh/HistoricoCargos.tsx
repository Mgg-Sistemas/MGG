/* ============================================================
   MGG · RRHH · Histórico de cambios de cargo · pantallas (04-11-2026)

   · En la ficha de la persona: la lista de sus cambios (fecha, de qué cargo a
     cuál, motivo y quién lo registró), «＋ Cargar cambio pasado» para lo que
     pasó antes de que existiera el histórico, y «📄 Ver PDF».
   · En la lista de personal: «🔁 Histórico de cargos» con todos los cambios en PDF.
   Realtime: se actualiza solo cuando alguien registra un cambio.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useQuien } from '@/shared/lib/directorioUsuarios';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { hoyISO } from '@/shared/lib/format';
import type { Personal } from '@/shared/lib/types';
import { errorCambioCargo, fechaCorta, textoCambioCargo, type CambioCargo, type FilaReporteCargo } from './cambiosCargo';
import { listCambiosCargo, registrarCambioCargo } from './personal.repository';

const nombreDe = (p: Pick<Personal, 'nombre' | 'apellido'>) => `${p.nombre ?? ''} ${p.apellido ?? ''}`.trim();

/** El histórico de cargos dentro de la ficha de una persona. */
export function HistoricoCargos({ persona, canWrite }: { persona: Personal; canWrite: boolean }) {
  const quien = useQuien();
  const { user } = useSession();
  const { appUser } = usePermissions();
  const [cambios, setCambios] = useState<CambioCargo[] | null>(null);
  const [nuevo, setNuevo] = useState<{ fecha: string; anterior: string; cargo: string; motivo: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [generando, setGenerando] = useState(false);

  const cargar = useCallback(() => {
    listCambiosCargo(persona.id).then(setCambios).catch(() => setCambios([]));
  }, [persona.id]);
  useEffect(() => { cargar(); }, [cargar]);
  useRealtime(['rrhh_cambios_cargo'], cargar);

  const registro = (c: CambioCargo) => quien(c.actor_name, c.actor) || c.actor_name || c.actor || '—';

  async function verPdf() {
    setGenerando(true);
    try {
      const { verCambiosCargoPdf } = await import('./cambiosCargoPdf');
      const filas: FilaReporteCargo[] = (cambios ?? []).map((c) => ({ cambio: c, persona: nombreDe(persona), cedula: persona.cedula ?? '', registro: registro(c) }));
      await verCambiosCargoPdf(filas, {
        titulo: `Histórico de cargos · ${nombreDe(persona)}`,
        subtitulo: `C.I. ${persona.cedula || '—'} · cargo actual: ${persona.cargo || 'sin cargo'}`,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo armar el PDF', 'error');
    } finally { setGenerando(false); }
  }

  async function guardarNuevo() {
    if (!nuevo) return;
    const falla = errorCambioCargo({ cargoNuevo: nuevo.cargo, fecha: nuevo.fecha, motivo: nuevo.motivo, hoy: hoyISO() });
    if (falla) { toast(falla, 'error'); return; }
    setGuardando(true);
    try {
      await registrarCambioCargo({
        personal_id: persona.id, cargo_anterior: nuevo.anterior.trim().toUpperCase() || null, cargo_nuevo: nuevo.cargo.trim().toUpperCase(),
        departamento_anterior: persona.departamento ?? null, departamento_nuevo: persona.departamento ?? null,
        fecha: nuevo.fecha, motivo: nuevo.motivo.trim(), origen: 'historico',
        actor: user?.email ?? null, actor_name: appUser?.nombre ?? null,
      });
      toast('Cambio de cargo agregado al histórico.', 'success');
      setNuevo(null);
      cargar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error');
    } finally { setGuardando(false); }
  }

  return (
    <div className="card" style={{ margin: '.6rem 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.4rem' }}>
        <div style={{ fontWeight: 700 }}>🔁 Histórico de cargos</div>
        <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
          {canWrite && !nuevo && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNuevo({ fecha: '', anterior: '', cargo: persona.cargo ?? '', motivo: '' })}
              title="Para los cambios que pasaron antes de que existiera el histórico">＋ Cargar cambio pasado</button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" disabled={generando || cambios === null} onClick={() => void verPdf()}>
            {generando ? 'Generando…' : '📄 Ver PDF'}
          </button>
        </div>
      </div>
      {cambios === null ? <small className="muted">Cargando…</small>
        : !cambios.length ? <small className="muted">Sin cambios de cargo registrados. Al cambiarle el cargo en «Editar datos» se piden la fecha y el motivo.</small>
          : (
            <div className="table-wrap">
              <table className="table" style={{ fontSize: '.85rem' }}>
                <thead><tr><th>Fecha</th><th>Cambio</th><th>Motivo</th><th>Registró</th></tr></thead>
                <tbody>
                  {cambios.map((c) => (
                    <tr key={c.id}>
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fechaCorta(c.fecha)}</td>
                      <td><strong>{textoCambioCargo(c)}</strong></td>
                      <td>{c.motivo}</td>
                      <td className="muted">{registro(c)}{c.origen === 'historico' && <span className="badge" style={{ marginLeft: '.3rem', fontSize: '.65rem' }}>Histórico</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      {nuevo && (
        <div className="card" style={{ marginTop: '.5rem', padding: '.6rem .75rem' }}>
          <div style={{ fontWeight: 600, marginBottom: '.35rem' }}>Cambio de cargo pasado</div>
          <div className="form-grid">
            <div className="form-row"><label>Fecha del cambio</label>
              <input className="input" type="date" value={nuevo.fecha} max={hoyISO()} onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })} /></div>
            <div className="form-row"><label>Cargo anterior</label>
              <input className="input" value={nuevo.anterior} onChange={(e) => setNuevo({ ...nuevo, anterior: e.target.value.toUpperCase() })} placeholder="El que tenía" /></div>
            <div className="form-row"><label>Cargo nuevo</label>
              <input className="input" value={nuevo.cargo} onChange={(e) => setNuevo({ ...nuevo, cargo: e.target.value.toUpperCase() })} /></div>
            <div className="form-row"><label>Motivo</label>
              <input className="input" value={nuevo.motivo} onChange={(e) => setNuevo({ ...nuevo, motivo: e.target.value })} placeholder="Ascenso, reubicación…" /></div>
          </div>
          <div style={{ display: 'flex', gap: '.4rem', justifyContent: 'flex-end', marginTop: '.4rem' }}>
            <button type="button" className="btn btn-ghost" disabled={guardando} onClick={() => setNuevo(null)}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={guardando} onClick={() => void guardarNuevo()}>{guardando ? 'Guardando…' : '✓ Agregar'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** «🔁 Histórico de cargos» de todo el personal, en PDF (botón de la lista). */
export function HistoricoCargosTodos({ personas }: { personas: Personal[] }) {
  const quien = useQuien();
  const [generando, setGenerando] = useState(false);
  async function verPdf() {
    setGenerando(true);
    try {
      const [cambios, { verCambiosCargoPdf }] = await Promise.all([listCambiosCargo(), import('./cambiosCargoPdf')]);
      const porId = new Map(personas.map((p) => [p.id, p]));
      const filas: FilaReporteCargo[] = cambios
        .filter((c) => porId.has(c.personal_id))
        .map((c) => {
          const p = porId.get(c.personal_id)!;
          return { cambio: c, persona: nombreDe(p), cedula: p.cedula ?? '', registro: quien(c.actor_name, c.actor) || c.actor_name || c.actor || '—' };
        });
      await verCambiosCargoPdf(filas, { titulo: 'Histórico de cambios de cargo', subtitulo: `Todo el personal de la lista (${personas.length})` });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo armar el PDF', 'error');
    } finally { setGenerando(false); }
  }
  return (
    <button className="btn btn-ghost" onClick={() => void verPdf()} disabled={generando}
      title="Todos los cambios de cargo del personal, con su fecha y su motivo, en PDF">{generando ? 'Generando…' : '🔁 Histórico de cargos'}</button>
  );
}
