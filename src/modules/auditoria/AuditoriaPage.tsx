/* ============================================================
   MGG · Auditoría de Usuarios (solo administradores)
   Overview: KPIs + gráficos (tiempo conectado y acciones) + tabla por usuario.
   Detalle (clic en un usuario): por día, con rango de fechas, timeline de
   sesiones (login/logout) y de acciones (qué hizo, en qué módulo, cuándo).
   ============================================================ */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { toast } from '@/shared/ui/Toast';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { RankedBarChart, BarChart, type ChartPoint } from '@/shared/ui/Chart';
import { dateTime } from '@/shared/lib/format';
import {
  listSesiones, listConectadosAhora, listActividad,
  resumenPorUsuario, duracionSesionMs, fmtDuracion, diaLocal, moduloDeTabla, iconoAccion,
  queHizo, queHizoCorto, tieneDetalle,
  type UserSession, type ActividadEvento, type ResumenUsuario,
} from './auditoria.repository';
import { descargarAuditoriaOverviewPdf, descargarAuditoriaUsuarioPdf, descargarAuditoriaMovimientosPdf } from './auditoriaPdf';
import { Iniciales } from '@/shared/ui/Iniciales';
import './auditoria.css';

const hoyISO = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
const haceDiasISO = (n: number) => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA');
const num = (n: number) => Number(n || 0).toLocaleString('es-VE');
const dt = (iso: string) => dateTime(iso);
const diaLegible = (iso: string) => new Intl.DateTimeFormat('es-VE', { weekday: 'long', day: 'numeric', month: 'long' })
  .format(new Date(`${iso}T12:00:00`));
const horaDe = (iso: string) => new Date(iso).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

/** Actividad agrupada por día, con lo más reciente primero. */
function agruparActividad(items: ActividadEvento[]): { dia: string; eventos: ActividadEvento[] }[] {
  const m = new Map<string, ActividadEvento[]>();
  for (const a of items) {
    const dia = diaLocal(a.ts);
    if (!m.has(dia)) m.set(dia, []);
    m.get(dia)!.push(a);
  }
  return Array.from(m.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dia, eventos]) => ({ dia, eventos }));
}

/** Cuántas acciones de cada día se listan en el panorama. */
const EVENTOS_POR_DIA = 8;

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
  // Cuántos días del timeline se muestran de entrada en el panorama.
  const [diasVisibles, setDiasVisibles] = useState(3);

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
  // «Conectados ahora» se consulta cada 30 s. `user_sessions` salió de la publicación de
  // tiempo real (el latido de cada pestaña la escribía ~220 mil veces y cargaba la base).
  useEffect(() => {
    const t = setInterval(() => { listConectadosAhora().then(setConectados).catch(() => {}); }, 30_000);
    return () => clearInterval(t);
  }, []);

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
    <div className="auditoria-page">
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
            <button className="btn btn-sm btn-ghost" disabled={loading || !filas.length}
              onClick={() => void descargarAuditoriaOverviewPdf({
                desde, hasta, conectadosAhora: conectados.length,
                filas: filas.map((f) => ({ nombre: f.nombre ?? f.email, email: f.email, msConectado: f.msConectado, nSesiones: f.nSesiones, nAcciones: f.nAcciones, ultima: f.ultima, conectado: f.conectadoAhora })),
              }).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'))}>↓ PDF resumen</button>
            <button className="btn btn-sm btn-ghost" disabled={loading || !actividad.length}
              onClick={() => {
                const porActor = new Map<string, ActividadEvento[]>();
                for (const a of actividad) { const e = (a.actor ?? '').toLowerCase(); if (!porActor.has(e)) porActor.set(e, []); porActor.get(e)!.push(a); }
                const usuarios = filas
                  .map((f) => ({ nombre: f.nombre ?? f.email, email: f.email, msConectado: f.msConectado, eventos: porActor.get(f.email) ?? [] }))
                  .filter((u) => u.eventos.length > 0);
                void descargarAuditoriaMovimientosPdf({ desde, hasta, usuarios })
                  .catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'));
              }}>↓ PDF movimientos por usuario</button>
            <div className="aud-periodo">
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

          {/* Lo que pasó, en orden. Los gráficos decían CUÁNTO, pero no
              QUÉ: para ver un hecho concreto había que entrar a la ficha
              de alguien. */}
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="card-title" style={{ marginBottom: '.6rem' }}>🔎 Lo que pasó</div>
            {loading ? (
              <div className="aud-cargando"><p className="muted">Cargando…</p></div>
            ) : !actividad.length ? (
              <p className="muted" style={{ margin: 0 }}>Sin acciones registradas en el período.</p>
            ) : (
              <>
                {agruparActividad(actividad).slice(0, diasVisibles).map(({ dia, eventos }) => (
                  <div key={dia} className="aud-dia">
                    <div className="aud-dia-head">
                      {diaLegible(dia)} <span className="aud-dia-n">· {eventos.length} acción(es)</span>
                    </div>
                    <ol className="aud-riel">
                      {eventos.slice(0, EVENTOS_POR_DIA).map((a, i) => {
                        const info = moduloDeTabla(a.tabla);
                        return (
                          <li key={`${a.tabla}-${a.ts}-${i}`} className="aud-evento">
                            <span className="aud-evento-icono" aria-hidden="true">{iconoAccion(a.accion)}</span>
                            <div className="aud-evento-cuerpo">
                              <div className="aud-evento-titulo">
                                {a.accion}
                                <span className="aud-evento-quien"> · {a.actor_name || a.actor}</span>
                              </div>
                              <div className="aud-evento-detalle">
                                {tieneDetalle(a) ? queHizoCorto(a) : 'sin detalle registrado'}
                              </div>
                              <div className="aud-evento-marcas">
                                <span className="aud-modulo">{info.icon} {info.modulo}</span>
                              </div>
                            </div>
                            <span className="aud-evento-hora">{horaDe(a.ts)}</span>
                          </li>
                        );
                      })}
                    </ol>
                    {eventos.length > EVENTOS_POR_DIA && (
                      <p className="muted" style={{ marginLeft: '1.35rem', fontSize: '.76rem' }}>
                        …y {eventos.length - EVENTOS_POR_DIA} acción(es) más ese día. Entra a la ficha de una persona para ver las suyas completas.
                      </p>
                    )}
                  </div>
                ))}
                {agruparActividad(actividad).length > diasVisibles && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDiasVisibles((n) => n + 5)}>
                    Ver días anteriores
                  </button>
                )}
              </>
            )}
          </div>

          {/* Usuarios en el período: same personas del Directorio, se leen
              igual. Antes eran columnas de cifras sueltas. */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: '.6rem' }}>👥 Usuarios en el período</div>
            {loading ? (
              <div className="aud-cargando"><EmptyState message="Cargando…" icon="◔" /></div>
            ) : !filas.length ? (
              <p className="muted" style={{ margin: 0 }}>Sin actividad en el período.</p>
            ) : (
              <div className="aud-personas">
                {(() => {
                  const tope = Math.max(1, ...filas.map((f) => f.msConectado));
                  return filas.map((f) => (
                    <button
                      key={f.email}
                      type="button"
                      className={`aud-persona${f.conectadoAhora ? ' conectado' : ''}`}
                      onClick={() => setSel(f.email)}
                      title={`Ver el detalle de ${f.nombre ?? f.email}`}
                    >
                      <span className="aud-persona-head">
                        <Iniciales nombre={f.nombre} respaldo={f.email}
                          color={f.conectadoAhora ? 'var(--success)' : undefined} />
                        <span className="aud-persona-datos">
                          <span className="aud-persona-nombre">{f.nombre ?? f.email.split('@')[0]}</span>
                          <span className="aud-persona-correo">{f.email}</span>
                        </span>
                        {f.conectadoAhora && <span className="badge success">● Conectado</span>}
                      </span>
                      <span className="aud-cifras">
                        <span className="aud-cifra fuerte">
                          <span className="aud-cifra-valor">{fmtDuracion(f.msConectado)}</span>
                          <span className="aud-cifra-label">Conectado</span>
                        </span>
                        <span className="aud-cifra">
                          <span className="aud-cifra-valor">{num(f.nSesiones)}</span>
                          <span className="aud-cifra-label">Sesiones</span>
                        </span>
                        <span className="aud-cifra">
                          <span className="aud-cifra-valor">{num(f.nAcciones)}</span>
                          <span className="aud-cifra-label">Acciones</span>
                        </span>
                      </span>
                      <span className="aud-peso" role="img" aria-label={`${fmtDuracion(f.msConectado)} conectado en el período`}>
                        <i style={{ width: `${Math.round((f.msConectado / tope) * 100)}%` }} />
                      </span>
                      {f.ultima && <span className="muted" style={{ fontSize: '.7rem' }}>Última conexión: {dt(f.ultima)}</span>}
                    </button>
                  ));
                })()}
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
  const [selEvento, setSelEvento] = useState<ActividadEvento | null>(null); // detalle de una acción
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
        <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }}
          onClick={() => void descargarAuditoriaUsuarioPdf({ nombre, email, desde, hasta, sesiones, actividad })
            .catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'))}>↓ PDF (vista previa)</button>
        <span className="muted">Período: {desde} → {hasta}</span>
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
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {!actividadFiltrada.length ? (
              <p className="muted" style={{ padding: '1rem 0', margin: 0 }}>Sin acciones.</p>
            ) : agruparActividad(actividadFiltrada).map(({ dia, eventos }) => (
              <div key={dia} className="aud-dia">
                <div className="aud-dia-head">
                  {diaLegible(dia)} <span className="aud-dia-n">· {eventos.length} acción(es)</span>
                </div>
                <ol className="aud-riel">
                  {eventos.map((a, i) => {
                    const info = moduloDeTabla(a.tabla);
                    return (
                      <li key={`${a.tabla}-${a.ts}-${i}`} className="aud-evento">
                        <span className="aud-evento-icono" aria-hidden="true">{iconoAccion(a.accion)}</span>
                        <button type="button" className="aud-evento-cuerpo" onClick={() => setSelEvento(a)} title="Ver detalle de la acción">
                          <span className="aud-evento-titulo">{a.accion}</span>
                          <span className="aud-evento-detalle">
                            {tieneDetalle(a) ? queHizoCorto(a) : 'sin detalle registrado'}
                          </span>
                          <span className="aud-evento-marcas"><span className="aud-modulo">{info.icon} {info.modulo}</span></span>
                        </button>
                        <span className="aud-evento-hora">{horaDe(a.ts)}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
        </div>
      </div>

      {selEvento && (() => {
        const info = moduloDeTabla(selEvento.tabla);
        const fila = (k: string, v: ReactNode) => (
          <div style={{ display: 'flex', gap: '.6rem', padding: '.45rem 0', borderBottom: '1px solid var(--border)' }}>
            <span className="muted" style={{ minWidth: 130, fontSize: '.82rem' }}>{k}</span>
            <span style={{ fontWeight: 600 }}>{v}</span>
          </div>
        );
        return (
          <Modal title="Detalle de la acción" size="sm" onClose={() => setSelEvento(null)}
            footer={<button className="btn btn-primary" onClick={() => setSelEvento(null)}>Cerrar</button>}>
            <div style={{ fontSize: '.9rem', lineHeight: 1.5 }}>
              <p style={{ margin: '0 0 .6rem' }}>
                <strong>{selEvento.actor_name || nombre || selEvento.actor}</strong> {iconoAccion(selEvento.accion)} <strong>{selEvento.accion}</strong> en <strong>{info.modulo}</strong>.
              </p>
              {fila('Qué hizo', <span className="badge">{iconoAccion(selEvento.accion)} {selEvento.accion}</span>)}
              {fila('Sobre qué', tieneDetalle(selEvento)
                ? <span style={{ whiteSpace: 'pre-wrap' }}>{queHizo(selEvento)}</span>
                : <span className="muted" style={{ fontWeight: 400 }}>Este registro no guarda con qué se hizo.</span>)}
              {fila('Módulo', <span>{info.icon} {info.modulo}</span>)}
              {fila('Usuario', selEvento.actor_name || '—')}
              {fila('Correo', <span className="mono" style={{ fontSize: '.82rem' }}>{selEvento.actor}</span>)}
              {fila('Fecha y hora', dt(selEvento.ts))}
              {fila('Registro (técnico)', <span className="mono" style={{ fontSize: '.8rem' }}>{selEvento.tabla}</span>)}
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

export default AuditoriaPage;
