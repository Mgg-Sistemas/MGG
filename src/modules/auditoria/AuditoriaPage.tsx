/* ============================================================
   MGG · Auditoría de Usuarios (solo administradores)
   Overview: KPIs + gráficos (tiempo conectado y acciones) + tabla por usuario.
   Detalle (clic en un usuario): por día, con rango de fechas, timeline de
   sesiones (login/logout) y de acciones (qué hizo, en qué módulo, cuándo).
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { toast } from '@/shared/ui/Toast';
import { EmptyState } from '@/shared/ui/EmptyState';
import { RankedBarChart, BarChart, type ChartPoint } from '@/shared/ui/Chart';
import { dateTime } from '@/shared/lib/format';
import {
  listSesiones, listConectadosAhora, listActividad,
  resumenPorUsuario, duracionSesionMs, fmtDuracion, diaLocal, moduloDeTabla, iconoAccion,
  type UserSession, type ActividadEvento, type ResumenUsuario,
} from './auditoria.repository';

const hoyISO = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
const haceDiasISO = (n: number) => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA');
const num = (n: number) => Number(n || 0).toLocaleString('es-VE');
const dt = (iso: string) => dateTime(iso);

interface FilaUsuario extends ResumenUsuario { nAcciones: number; conectadoAhora: boolean; }

export function AuditoriaPage() {
  const { isAdmin } = usePermissions();
  const [desde, setDesde] = useState(haceDiasISO(7));
  const [hasta, setHasta] = useState(hoyISO());
  const [sesiones, setSesiones] = useState<UserSession[]>([]);
  const [actividad, setActividad] = useState<ActividadEvento[]>([]);
  const [conectados, setConectados] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string | null>(null); // email del detalle

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [ss, act, con] = await Promise.all([
        listSesiones(desde, hasta),
        listActividad(desde, hasta),
        listConectadosAhora(),
      ]);
      setSesiones(ss); setActividad(act); setConectados(con);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar la auditoría', 'error'); }
    finally { setLoading(false); }
  }, [desde, hasta]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['user_sessions'], () => { listConectadosAhora().then(setConectados).catch(() => {}); });

  const emailsConectados = useMemo(() => new Set(conectados.map((c) => (c.email ?? '').toLowerCase())), [conectados]);
  const accionesPorEmail = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of actividad) { const e = (a.actor ?? '').toLowerCase(); m.set(e, (m.get(e) ?? 0) + 1); }
    return m;
  }, [actividad]);

  const filas: FilaUsuario[] = useMemo(() => {
    const base = resumenPorUsuario(sesiones);
    const byEmail = new Map(base.map((r) => [r.email, r]));
    // Incluir también usuarios que tuvieron actividad aunque no tengamos su sesión en el período.
    for (const [email] of accionesPorEmail) {
      if (!byEmail.has(email)) byEmail.set(email, { email, nombre: null, msConectado: 0, nSesiones: 0, ultima: null });
    }
    return Array.from(byEmail.values()).map((r) => ({
      ...r,
      nAcciones: accionesPorEmail.get(r.email) ?? 0,
      conectadoAhora: emailsConectados.has(r.email),
    })).sort((a, b) => b.msConectado - a.msConectado || b.nAcciones - a.nAcciones);
  }, [sesiones, accionesPorEmail, emailsConectados]);

  const totalMs = useMemo(() => filas.reduce((a, f) => a + f.msConectado, 0), [filas]);
  const nombreDe = useCallback((email: string) => filas.find((f) => f.email === email)?.nombre
    ?? actividad.find((a) => (a.actor ?? '').toLowerCase() === email)?.actor_name
    ?? sesiones.find((s) => (s.email ?? '').toLowerCase() === email)?.nombre ?? email, [filas, actividad, sesiones]);

  if (!isAdmin) return <div className="card"><EmptyState message="Solo los administradores pueden ver la Auditoría de Usuarios." icon="🔒" /></div>;

  // ── Gráficos del overview ──
  const chartHoras: ChartPoint[] = filas.filter((f) => f.msConectado > 0).slice(0, 12)
    .map((f) => ({ label: (f.nombre ?? f.email).split('@')[0], value: Math.round(f.msConectado / 60000), tooltip: `${f.nombre ?? f.email}: ${fmtDuracion(f.msConectado)}` }));
  const chartAccionesUsuario: ChartPoint[] = filas.filter((f) => f.nAcciones > 0).slice(0, 12)
    .map((f) => ({ label: (f.nombre ?? f.email).split('@')[0], value: f.nAcciones, tooltip: `${f.nombre ?? f.email}: ${num(f.nAcciones)} acciones` }));
  const accionesPorDia: ChartPoint[] = (() => {
    const m = new Map<string, number>();
    for (const a of actividad) { const d = diaLocal(a.ts); m.set(d, (m.get(d) ?? 0) + 1); }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([d, v]) => ({ label: d.slice(5), value: v, tooltip: `${d}: ${num(v)} acciones` }));
  })();
  const labelToEmail = new Map(filas.map((f) => [(f.nombre ?? f.email).split('@')[0], f.email]));

  return (
    <div>
      {sel ? (
        <DetalleUsuario email={sel} nombre={nombreDe(sel)} desde={desde} hasta={hasta}
          sesiones={sesiones.filter((s) => (s.email ?? '').toLowerCase() === sel)}
          actividad={actividad.filter((a) => (a.actor ?? '').toLowerCase() === sel)}
          conectado={emailsConectados.has(sel)} onVolver={() => setSel(null)} />
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.75rem', marginBottom: '1rem' }}>
            <h1 style={{ margin: 0 }}>🕵 Auditoría de Usuarios</h1>
            <span className="badge" style={{ background: 'rgba(16,185,129,.15)', color: '#10b981' }}>● {num(conectados.length)} conectado(s) ahora</span>
            <div style={{ display: 'flex', gap: '.5rem', marginLeft: 'auto', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-row" style={{ margin: 0 }}><label style={{ fontSize: '.72rem' }}>Desde</label><input className="input" type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} /></div>
              <div className="form-row" style={{ margin: 0 }}><label style={{ fontSize: '.72rem' }}>Hasta</label><input className="input" type="date" value={hasta} min={desde} max={hoyISO()} onChange={(e) => setHasta(e.target.value)} /></div>
              <div style={{ display: 'flex', gap: '.25rem' }}>
                {[['Hoy', 0], ['7 días', 7], ['30 días', 30]].map(([lbl, n]) => (
                  <button key={lbl as string} className="btn btn-sm btn-ghost" onClick={() => { setDesde(haceDiasISO(n as number)); setHasta(hoyISO()); }}>{lbl}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="kpi-grid" style={{ marginBottom: '1rem' }}>
            <div className="kpi"><div className="icon">●</div><div className="label">Conectados ahora</div><div className="value">{num(conectados.length)}</div><div className="delta">últimos 5 min</div></div>
            <div className="kpi"><div className="icon">⏱</div><div className="label">Tiempo conectado (período)</div><div className="value">{fmtDuracion(totalMs)}</div><div className="delta">suma de todos</div></div>
            <div className="kpi"><div className="icon">⚡</div><div className="label">Acciones (período)</div><div className="value">{num(actividad.length)}</div><div className="delta">creó · aprobó · ejecutó…</div></div>
            <div className="kpi"><div className="icon">👤</div><div className="label">Usuarios activos</div><div className="value">{num(filas.filter((f) => f.msConectado > 0 || f.nAcciones > 0).length)}</div><div className="delta">en el período</div></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            <div className="card">
              <div className="card-title">⏱ Tiempo conectado por usuario</div>
              <RankedBarChart data={chartHoras} valueFormatter={(v) => fmtDuracion(v * 60000)} emptyMessage="Sin sesiones en el período."
                onBarClick={(p) => { const e = labelToEmail.get(p.label); if (e) setSel(e); }} />
            </div>
            <div className="card">
              <div className="card-title">⚡ Acciones por usuario</div>
              <RankedBarChart data={chartAccionesUsuario} valueFormatter={(v) => `${num(v)}`} emptyMessage="Sin acciones en el período."
                onBarClick={(p) => { const e = labelToEmail.get(p.label); if (e) setSel(e); }} />
            </div>
          </div>

          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="card-title">📅 Acciones por día</div>
            <BarChart data={accionesPorDia} height={200} yFormatter={(v) => num(v)} emptyMessage="Sin acciones en el período." />
          </div>

          <div className="card">
            <div className="card-title">👥 Detalle por usuario <span className="muted" style={{ fontWeight: 400, fontSize: '.8rem' }}>(clic para ver su actividad)</span></div>
            {loading ? <EmptyState message="Cargando…" icon="◔" /> : (
              <div className="table-wrap">
                <table className="table" style={{ margin: 0 }}>
                  <thead><tr>
                    <th>Usuario</th><th style={{ textAlign: 'right' }}>Tiempo conectado</th><th style={{ textAlign: 'right' }}>Sesiones</th>
                    <th style={{ textAlign: 'right' }}>Acciones</th><th>Última conexión</th><th></th>
                  </tr></thead>
                  <tbody>
                    {!filas.length && <tr><td colSpan={6}><EmptyState message="Sin actividad en el período." icon="🕵" /></td></tr>}
                    {filas.map((f) => (
                      <tr key={f.email} style={{ cursor: 'pointer' }} onClick={() => setSel(f.email)}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                            {f.conectadoAhora && <span title="Conectado ahora" style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />}
                            <div><strong>{f.nombre ?? f.email.split('@')[0]}</strong><br/><span className="muted" style={{ fontSize: '.72rem' }}>{f.email}</span></div>
                          </div>
                        </td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtDuracion(f.msConectado)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{num(f.nSesiones)}</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(f.nAcciones)}</td>
                        <td className="muted" style={{ fontSize: '.8rem' }}>{f.ultima ? dt(f.ultima) : '—'}</td>
                        <td style={{ textAlign: 'right' }}><span className="muted">ver ›</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ───────────── Detalle de un usuario ───────────── */
function DetalleUsuario({ email, nombre, desde, hasta, sesiones, actividad, conectado, onVolver }: {
  email: string; nombre: string; desde: string; hasta: string;
  sesiones: UserSession[]; actividad: ActividadEvento[]; conectado: boolean; onVolver: () => void;
}) {
  const [dia, setDia] = useState<string | null>(null); // filtro por día (clic en la barra)
  const msTotal = sesiones.reduce((a, s) => a + duracionSesionMs(s), 0);

  // Por día: tiempo conectado y acciones.
  const dias = useMemo(() => {
    const conM = new Map<string, number>(); const actM = new Map<string, number>();
    for (const s of sesiones) conM.set(diaLocal(s.started_at), (conM.get(diaLocal(s.started_at)) ?? 0) + duracionSesionMs(s));
    for (const a of actividad) actM.set(diaLocal(a.ts), (actM.get(diaLocal(a.ts)) ?? 0) + 1);
    const keys = Array.from(new Set([...conM.keys(), ...actM.keys()])).sort();
    return keys.map((d) => ({ dia: d, ms: conM.get(d) ?? 0, acciones: actM.get(d) ?? 0 }));
  }, [sesiones, actividad]);

  const chartHorasDia: ChartPoint[] = dias.map((d) => ({ label: d.dia.slice(5), value: Math.round(d.ms / 60000), tooltip: `${d.dia}: ${fmtDuracion(d.ms)}` }));
  const chartAccionesDia: ChartPoint[] = dias.map((d) => ({ label: d.dia.slice(5), value: d.acciones, tooltip: `${d.dia}: ${num(d.acciones)} acciones` }));

  const actividadFiltrada = dia ? actividad.filter((a) => diaLocal(a.ts) === dia) : actividad;
  const sesionesFiltradas = dia ? sesiones.filter((s) => diaLocal(s.started_at) === dia) : sesiones;

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.6rem', marginBottom: '1rem' }}>
        <button className="btn btn-sm btn-ghost" onClick={onVolver}>← Volver</button>
        <h1 style={{ margin: 0 }}>🕵 {nombre}</h1>
        {conectado && <span className="badge" style={{ background: 'rgba(16,185,129,.15)', color: '#10b981' }}>● conectado ahora</span>}
        <span className="muted">{email}</span>
        <span className="muted" style={{ marginLeft: 'auto' }}>Período: {desde} → {hasta}</span>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1rem' }}>
        <div className="kpi"><div className="icon">⏱</div><div className="label">Tiempo conectado</div><div className="value">{fmtDuracion(msTotal)}</div><div className="delta">{num(sesiones.length)} sesión(es)</div></div>
        <div className="kpi"><div className="icon">⚡</div><div className="label">Acciones</div><div className="value">{num(actividad.length)}</div><div className="delta">en el período</div></div>
        <div className="kpi"><div className="icon">📅</div><div className="label">Días activos</div><div className="value">{num(dias.filter((d) => d.ms > 0 || d.acciones > 0).length)}</div><div className="delta">con sesión o acción</div></div>
        <div className="kpi"><div className="icon">🕘</div><div className="label">Última conexión</div><div className="value" style={{ fontSize: '1rem' }}>{sesiones[0] ? dt(sesiones[0].last_seen_at) : '—'}</div><div className="delta">&nbsp;</div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <div className="card">
          <div className="card-title">⏱ Tiempo conectado por día</div>
          <BarChart data={chartHorasDia} height={200} color="#ff8a00" yFormatter={(v) => fmtDuracion(v * 60000)} emptyMessage="Sin sesiones." />
        </div>
        <div className="card">
          <div className="card-title">⚡ Acciones por día <span className="muted" style={{ fontWeight: 400, fontSize: '.75rem' }}>{dia ? `· filtrando ${dia}` : ''}</span></div>
          <BarChart data={chartAccionesDia} height={200} yFormatter={(v) => num(v)} emptyMessage="Sin acciones." />
        </div>
      </div>

      {dias.length > 0 && (
        <div className="filterbar" style={{ gap: '.4rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: '.78rem' }}>Filtrar por día:</span>
          <button className={`btn btn-sm ${!dia ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setDia(null)}>Todos</button>
          {dias.filter((d) => d.acciones > 0 || d.ms > 0).map((d) => (
            <button key={d.dia} className={`btn btn-sm ${dia === d.dia ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setDia(d.dia)}>{d.dia.slice(5)}</button>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: '1rem' }}>
        <div className="card">
          <div className="card-title">🔗 Sesiones <span className="muted" style={{ fontWeight: 400, fontSize: '.8rem' }}>({num(sesionesFiltradas.length)})</span></div>
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="table" style={{ margin: 0, fontSize: '.82rem' }}>
              <thead><tr><th>Inicio</th><th>Fin</th><th style={{ textAlign: 'right' }}>Duración</th></tr></thead>
              <tbody>
                {!sesionesFiltradas.length && <tr><td colSpan={3} className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Sin sesiones.</td></tr>}
                {sesionesFiltradas.map((s) => (
                  <tr key={s.id}>
                    <td className="muted">{dt(s.started_at)}</td>
                    <td className="muted">{s.ended_at ? dt(s.ended_at) : <span style={{ color: '#10b981' }}>● en curso</span>}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtDuracion(duracionSesionMs(s))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-title">📝 Actividad <span className="muted" style={{ fontWeight: 400, fontSize: '.8rem' }}>({num(actividadFiltrada.length)})</span></div>
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="table" style={{ margin: 0, fontSize: '.82rem' }}>
              <thead><tr><th>Fecha y hora</th><th>Módulo</th><th>Acción</th></tr></thead>
              <tbody>
                {!actividadFiltrada.length && <tr><td colSpan={3} className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Sin acciones.</td></tr>}
                {actividadFiltrada.map((a, i) => {
                  const info = moduloDeTabla(a.tabla);
                  return (
                    <tr key={`${a.tabla}-${a.ts}-${i}`}>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>{dt(a.ts)}</td>
                      <td><span title={a.tabla}>{info.icon} {info.modulo}</span></td>
                      <td><span className="badge">{iconoAccion(a.accion)} {a.accion}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AuditoriaPage;
