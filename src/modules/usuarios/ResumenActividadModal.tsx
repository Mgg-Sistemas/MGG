import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { CorreoReporteModal } from '@/shared/ui/CorreoReporteModal';
import { dateTime, hoyISO } from '@/shared/lib/format';
import { useSession } from '@/modules/auth/authStore';
import { useRealtime } from '@/shared/lib/useRealtime';
import { listConectadosAhora, listSesiones, CONECTADO_MINUTOS, type UserSession } from './userSessions.repository';
import {
  descargarActividadPdf, enviarActividadPorCorreo, fmtDuracionMin,
  type ActividadFila, type ActividadPdfData,
} from './usuariosActividadPdf';

function inicioMes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function haceDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const claveDe = (s: UserSession) => s.usuario_id ?? s.email ?? s.id;
const durMin = (s: UserSession) =>
  Math.max(0, ((s.ended_at ? new Date(s.ended_at).getTime() : new Date(s.last_seen_at).getTime()) - new Date(s.started_at).getTime()) / 60_000);

export function ResumenActividadModal({ onClose }: { onClose: () => void }) {
  const { user } = useSession();
  const [desde, setDesde] = useState(inicioMes());
  const [hasta, setHasta] = useState(hoyISO());
  const [conectados, setConectados] = useState<UserSession[]>([]);
  const [sesiones, setSesiones] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [correoOpen, setCorreoOpen] = useState(false);
  const [tick, setTick] = useState(0); // refresca duraciones "en vivo"

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [con, ses] = await Promise.all([listConectadosAhora(), listSesiones(desde, hasta)]);
      setConectados(con);
      setSesiones(ses);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cargar la actividad', 'error');
    } finally { setLoading(false); }
  }, [desde, hasta]);

  useEffect(() => { void cargar(); }, [cargar]);
  // Auto-refresco de "conectados ahora" cada 30s (cubre la expiración por inactividad).
  useEffect(() => {
    const t = setInterval(() => { setTick((x) => x + 1); void listConectadosAhora().then(setConectados).catch(() => {}); }, 30_000);
    return () => clearInterval(t);
  }, []);
  // Realtime: cuando alguien entra/sale o late, refrescamos la lista de conectados en vivo.
  useRealtime(['user_sessions'], () => { void listConectadosAhora().then(setConectados).catch(() => {}); });

  // Agregado por usuario para el período.
  const filas = useMemo<ActividadFila[]>(() => {
    const conSet = new Set(conectados.map(claveDe));
    const map = new Map<string, ActividadFila>();
    for (const s of sesiones) {
      const key = claveDe(s);
      const cur = map.get(key) ?? { nombre: s.nombre ?? s.email ?? '—', email: s.email ?? '—', sesiones: 0, minutos: 0, ultima: s.last_seen_at, conectado: false };
      cur.sesiones += 1;
      cur.minutos += durMin(s);
      if (new Date(s.last_seen_at) > new Date(cur.ultima)) cur.ultima = s.last_seen_at;
      map.set(key, cur);
    }
    for (const [k, f] of map) f.conectado = conSet.has(k);
    return [...map.values()].sort((a, b) => b.minutos - a.minutos);
  }, [sesiones, conectados]);

  const pdfData = (): ActividadPdfData => ({ desde, hasta, conectadosAhora: conectados.length, filas });

  async function onPdf() {
    try { await descargarActividadPdf(pdfData()); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  const ahora = Date.now();
  void tick; // dependencia para recomputar duraciones en vivo

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      <button type="button" className="btn btn-ghost" onClick={() => setCorreoOpen(true)}>✉ Enviar por correo</button>
      <button type="button" className="btn btn-primary" onClick={onPdf}>↓ PDF (vista previa)</button>
    </>
  );

  return (
    <Modal title="📊 Resumen de Actividad" size="xl" onClose={onClose} footer={footer}>
      {/* Conectados ahora */}
      <div className="card" style={{ margin: '0 0 .9rem', padding: '.6rem .85rem', borderLeft: '3px solid var(--success)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
          <strong>🟢 Conectados ahora · {conectados.length}</strong>
          <button className="btn btn-sm btn-ghost" onClick={() => void cargar()} disabled={loading}>↻ Actualizar</button>
        </div>
        {conectados.length === 0 ? (
          <div className="muted" style={{ fontSize: '.85rem' }}>Nadie conectado en los últimos {CONECTADO_MINUTOS} min.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead><tr><th>Usuario</th><th>Correo</th><th>Desde</th><th style={{ textAlign: 'right' }}>Tiempo conectado</th></tr></thead>
              <tbody>
                {conectados.map((s) => (
                  <tr key={s.id}>
                    <td>{s.nombre ?? s.email ?? '—'}</td>
                    <td className="mono">{s.email ?? '—'}</td>
                    <td>{dateTime(s.started_at)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtDuracionMin((ahora - new Date(s.started_at).getTime()) / 60_000)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Período */}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.7rem' }}>
        <button className="btn btn-sm btn-ghost" onClick={() => { setDesde(hoyISO()); setHasta(hoyISO()); }}>Hoy</button>
        <button className="btn btn-sm btn-ghost" onClick={() => { setDesde(haceDias(6)); setHasta(hoyISO()); }}>Semana</button>
        <button className="btn btn-sm btn-ghost" onClick={() => { setDesde(inicioMes()); setHasta(hoyISO()); }}>Mes</button>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
          Desde <input className="input" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} style={{ width: 'auto' }} />
        </label>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
          Hasta <input className="input" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} style={{ width: 'auto' }} />
        </label>
        {loading && <span className="muted" style={{ fontSize: '.8rem' }}>cargando…</span>}
      </div>

      {/* Supervisión: tiempo total por usuario en el período */}
      <div className="card" style={{ margin: 0, padding: '.6rem .85rem' }}>
        <strong style={{ display: 'block', marginBottom: '.4rem' }}>Tiempo en el sistema por usuario</strong>
        {filas.length === 0 ? (
          <div className="muted" style={{ fontSize: '.85rem' }}>Sin sesiones registradas en el período.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead><tr><th>Usuario</th><th>Correo</th><th style={{ textAlign: 'right' }}>Sesiones</th><th style={{ textAlign: 'right' }}>Tiempo total</th><th>Última conexión</th><th>Estado</th></tr></thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={`${f.email}-${i}`}>
                    <td>{f.nombre}</td>
                    <td className="mono">{f.email}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{f.sesiones}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtDuracionMin(f.minutos)}</td>
                    <td>{dateTime(f.ultima)}</td>
                    <td>{f.conectado ? <span className="badge success">Conectado</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {correoOpen && (
        <CorreoReporteModal
          titulo="Enviar Resumen de Actividad"
          descripcion={`Se enviará el PDF del período ${desde} → ${hasta}.`}
          defaultEmail={user?.email ?? ''}
          onEnviar={async (emails) => enviarActividadPorCorreo(pdfData(), emails)}
          onClose={() => setCorreoOpen(false)}
        />
      )}
    </Modal>
  );
}
