import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { EmptyState } from '@/shared/ui/EmptyState';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useSession } from '@/modules/auth/authStore';
import { num as fmtNum } from '@/shared/lib/format';
import { MaquinariaCatalogoModal } from './MaquinariaCatalogoModal';
import { EquipoFormModal } from './EquipoFormModal';
import { BitacoraModal } from './BitacoraModal';
import { ResumenMaquinariaModal } from './ResumenMaquinariaModal';
import { CorreoReporteModal } from '@/shared/ui/CorreoReporteModal';
import { listEquipos, setEquipoActivo, eliminarEquipo, type MaquinariaEquipo } from './maquinariaEquipos.repository';
import { horasUltimoPorEquipo, consumosPorEquipo, ultimoServicioPorEquipo, type ConsumoMant, type UltimoServicio } from './maquinariaMant.repository';
import { horometrosVigentesPorEquipo } from '@/modules/combustible/combustible.repository';
// generadores de ./maquinariaReportes: import dinámico (al generar) para no cargar jsPDF/xlsx al abrir.

const STATUS_COLOR: Record<string, string> = {
  'ACTIVO': 'var(--success)', 'MANTENIMIENTO': 'var(--warning)',
  'FUERA DE SERVICIO': 'var(--danger)', 'INACTIVO': 'var(--muted)',
};

/** Umbral de alerta: si faltan ≤ 250 HRS para el próximo mantenimiento, se avisa. */
const UMBRAL_ALERTA_HRS = 250;

/** Quita acentos y pasa a minúsculas para una búsqueda tolerante. */
const normTxt = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * HRS restantes hasta el próximo mantenimiento. El mantenimiento se hace cada N horas
 * de horómetro (N = mantenimiento_cada_hrs); el próximo toca en el siguiente múltiplo de N.
 * restantes = N − (horómetro mod N). Devuelve null si falta el dato.
 */
function hrsRestantes(frecuencia: number | null, horometro: number | null): number | null {
  if (!frecuencia || frecuencia <= 0 || horometro == null) return null;
  return ((frecuencia - (horometro % frecuencia)) % frecuencia);
}

/** Un motivo por el que un equipo está en estado crítico (ítem vencido / sin registro / fuera de servicio). */
interface CritIssue {
  key: 'aceite' | 'filtro' | 'combustible' | 'servicio';
  label: string;
  vencidoHrs: number | null;   // horas pasadas del intervalo (si aplica)
  sinRegistro?: boolean;       // intervalo definido pero nunca registrado en la bitácora
}

/**
 * Motivos críticos de un equipo: fuera de servicio + cada ítem con intervalo cuyo
 * último servicio (de la bitácora) ya superó el intervalo, o que nunca se registró.
 */
function issuesCriticos(e: MaquinariaEquipo, horometro: number | null, us: UltimoServicio | undefined): CritIssue[] {
  const out: CritIssue[] = [];
  if (e.status === 'FUERA DE SERVICIO') out.push({ key: 'servicio', label: 'Fuera de servicio', vencidoHrs: null });
  const items: { key: CritIssue['key']; label: string; interval: number | null; last: number | null }[] = [
    { key: 'aceite', label: 'Aceite', interval: e.aceite_cada_hrs, last: us?.aceite ?? null },
    { key: 'filtro', label: 'Filtro', interval: e.filtro_cada_hrs, last: us?.filtro ?? null },
    { key: 'combustible', label: 'Combustible', interval: e.combustible_cada_hrs, last: us?.combustible ?? null },
  ];
  for (const it of items) {
    if (!it.interval || it.interval <= 0) continue;
    if (it.last == null) { out.push({ key: it.key, label: it.label, vencidoHrs: null, sinRegistro: true }); continue; }
    if (horometro == null) continue;
    const desde = horometro - it.last;
    if (desde >= it.interval) out.push({ key: it.key, label: it.label, vencidoHrs: Math.round((desde - it.interval) * 100) / 100 });
  }
  return out;
}

export function MaquinariaPage() {
  const { can, appUser } = usePermissions();
  const { user } = useSession();
  const canWrite = can('maquinaria', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;

  const navigate = useNavigate();
  const [equipos, setEquipos] = useState<MaquinariaEquipo[]>([]);
  const [horometros, setHorometros] = useState<Map<string, number>>(new Map());     // combustible: nombre→horómetro
  const [bitMap, setBitMap] = useState<Map<string, { ultimoHorometro: number | null }>>(new Map()); // bitácora: equipo_id→…
  const [consumos, setConsumos] = useState<Map<string, ConsumoMant>>(new Map());     // bitácora: equipo_id→consumos
  const [ultimoServ, setUltimoServ] = useState<Map<string, UltimoServicio>>(new Map()); // bitácora: equipo_id→último servicio
  const [vista, setVista] = useState<'activa' | 'mantenimiento' | 'critico'>('activa');
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState('');
  // Por defecto mostramos también los inactivos: desactivar NO borra, solo marca
  // inactivo, así que el equipo debe seguir visible (con su distintivo «Inactivo»).
  const [verInactivos, setVerInactivos] = useState(true);

  const [catalogoOpen, setCatalogoOpen] = useState(false);
  const [resumenOpen, setResumenOpen] = useState(false);
  const [correoOpen, setCorreoOpen] = useState(false);
  const [form, setForm] = useState<{ open: boolean; equipo: MaquinariaEquipo | null }>({ open: false, equipo: null });
  const [bitacora, setBitacora] = useState<MaquinariaEquipo | null>(null);
  const [borrar, setBorrar] = useState<MaquinariaEquipo | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [eqs, horos, bit, cons, us] = await Promise.all([
        listEquipos(),
        horometrosVigentesPorEquipo().catch(() => new Map<string, number>()),
        horasUltimoPorEquipo().catch(() => new Map()),
        consumosPorEquipo().catch(() => new Map<string, ConsumoMant>()),
        ultimoServicioPorEquipo().catch(() => new Map<string, UltimoServicio>()),
      ]);
      setEquipos(eqs);
      setHorometros(horos);
      setBitMap(bit);
      setConsumos(cons);
      setUltimoServ(us);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  // También vigila los movimientos de combustible: el horómetro vigente sale de ahí.
  useRealtime(['maquinaria_equipos', 'maquinaria_catalogos', 'maquinaria_mantenimientos', 'combustible_tanque_movimientos'], () => { void cargar(); });

  // HRS restantes + alerta por equipo. Horómetro vigente: el de Combustible (si está
  // vinculado), si no el último de la bitácora.
  const infoEquipo = useMemo(() => {
    const m = new Map<string, { restantes: number | null; alerta: boolean; horometro: number | null }>();
    for (const e of equipos) {
      const horo = (e.combustible_equipo ? horometros.get(e.combustible_equipo.trim()) : undefined)
        ?? bitMap.get(e.id)?.ultimoHorometro ?? null;
      const restantes = hrsRestantes(e.mantenimiento_cada_hrs, horo);
      m.set(e.id, { restantes, horometro: horo, alerta: restantes != null && restantes <= UMBRAL_ALERTA_HRS });
    }
    return m;
  }, [equipos, horometros, bitMap]);

  const lista = useMemo(() => {
    const q = normTxt(filtro.trim());
    return equipos.filter((e) => {
      if (!verInactivos && !e.activo) return false;
      if (!q) return true;
      return [e.equipo, e.tipo, e.propietario, e.status, e.ubicacion, e.serial, e.placa, e.marca, e.modelo]
        .some((v) => normTxt(v ?? '').includes(q));
    });
  }, [equipos, filtro, verInactivos]);

  // Equipos activos que requieren mantenimiento pronto (≤ 250 HRS).
  const enAlerta = useMemo(
    () => equipos.filter((e) => e.activo && infoEquipo.get(e.id)?.alerta),
    [equipos, infoEquipo],
  );

  // ── Las 3 categorías de las tarjetas ──
  // ACTIVA: equipos operativos (registrados y con status ACTIVO).
  const activos = useMemo(() => equipos.filter((e) => e.activo && e.status === 'ACTIVO'), [equipos]);
  // MANTENIMIENTO: status MANTENIMIENTO o con registros de bitácora (aceite/filtro/etc.).
  const enMantenimiento = useMemo(
    () => equipos.filter((e) => e.activo && (e.status === 'MANTENIMIENTO' || (consumos.get(e.id)?.registros ?? 0) > 0)),
    [equipos, consumos],
  );
  // CRÍTICO: motivos por equipo (fuera de servicio + ítems vencidos/sin registro).
  const critMap = useMemo(() => {
    const m = new Map<string, CritIssue[]>();
    for (const e of equipos) {
      if (!e.activo) continue;
      const issues = issuesCriticos(e, infoEquipo.get(e.id)?.horometro ?? null, ultimoServ.get(e.id));
      if (issues.length) m.set(e.id, issues);
    }
    return m;
  }, [equipos, infoEquipo, ultimoServ]);
  const criticos = useMemo(() => equipos.filter((e) => critMap.has(e.id)), [equipos, critMap]);

  async function toggleActivo(e: MaquinariaEquipo) {
    try { await setEquipoActivo(e.id, !e.activo); await cargar(); }
    catch (err) { toast(err instanceof Error ? err.message : 'No se pudo cambiar', 'error'); }
  }
  async function doBorrar(e: MaquinariaEquipo) {
    try { await eliminarEquipo(e.id); await cargar(); toast('Equipo eliminado', 'success'); }
    catch (err) { toast(err instanceof Error ? err.message : 'No se pudo eliminar', 'error'); }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🚜 Control de Maquinaria y Vehículos</h1>
        </div>
        <div className="actions" style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          {canWrite && <button className="btn btn-primary" onClick={() => setForm({ open: true, equipo: null })}>+ Nuevo equipo</button>}
          <button className="btn btn-ghost" onClick={() => setResumenOpen(true)}>📊 Resumen</button>
          <button className="btn btn-ghost" onClick={() => setCatalogoOpen(true)}>🏷 Catálogo</button>
          <button className="btn btn-ghost" disabled={!lista.length} onClick={() => void import('./maquinariaReportes').then(({ descargarEquiposPdf }) => descargarEquiposPdf(lista)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'))}>↓ PDF</button>
          <button className="btn btn-ghost" disabled={!lista.length} onClick={() => void import('./maquinariaReportes').then(({ descargarEquiposExcel }) => descargarEquiposExcel(lista)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el Excel', 'error'))}>↓ Excel</button>
          <button className="btn btn-ghost" disabled={!lista.length} onClick={() => setCorreoOpen(true)}>✉ Correo</button>
        </div>
      </div>

      {enAlerta.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warning)', background: 'var(--bg-1)', marginBottom: '.6rem', padding: '.55rem .85rem' }}>
          ⚠️ <strong>{enAlerta.length} equipo(s)</strong> con mantenimiento próximo (≤ {UMBRAL_ALERTA_HRS} HRS): {enAlerta.slice(0, 6).map((e) => e.equipo).join(', ')}{enAlerta.length > 6 ? '…' : ''}
        </div>
      )}

      {/* 3 tarjetas: ACTIVA · MANTENIMIENTO · ESTADO CRÍTICO (cada una abre su detalle al tocar). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.75rem', marginBottom: '1rem' }}>
        <EstadoCard
          activa={vista === 'activa'} onClick={() => setVista('activa')}
          icon="✅" titulo="Vehículos / Maquinaria ACTIVA" total={activos.length} color="var(--success)"
          hint="Equipos operativos · ver el detalle" />
        <EstadoCard
          activa={vista === 'mantenimiento'} onClick={() => setVista('mantenimiento')}
          icon="🔧" titulo="En MANTENIMIENTO" total={enMantenimiento.length} color="var(--warning)"
          hint="Con servicio registrado · ir al control de mantenimiento" />
        <EstadoCard
          activa={vista === 'critico'} onClick={() => setVista('critico')}
          icon="⛔" titulo="En ESTADO CRÍTICO" total={criticos.length} color="var(--danger)"
          hint="Falta aceite / filtro / combustible vencido" />
      </div>

      {loading ? <EmptyState message="Cargando…" /> : vista === 'activa' ? (
      <>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.6rem' }}>
        <input className="input" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="🔍 Buscar equipo, tipo, propietario, serial…" style={{ flex: '1 1 280px' }} />
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.82rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Ver inactivos
        </label>
        <span className="muted" style={{ fontSize: '.8rem' }}>{lista.length} equipo(s)</span>
      </div>

      {!lista.length ? (
        <EmptyState message={filtro.trim() ? 'Sin resultados.' : 'Aún no hay equipos registrados.'} />
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead><tr>
              <th>Equipo</th><th>Tipo</th><th>Propietario</th><th>Status</th><th>Ubicación</th>
              <th style={{ textAlign: 'right' }}>Mantt. cada (h)</th><th style={{ textAlign: 'right' }}>HRS restantes</th><th></th>
            </tr></thead>
            <tbody>
              {lista.map((e) => {
                const info = infoEquipo.get(e.id);
                return (
                <tr key={e.id} style={{ opacity: e.activo ? 1 : 0.5, background: info?.alerta ? 'rgba(255,165,0,.10)' : undefined }}>
                  <td>
                    <strong>{e.equipo}</strong>
                    {!e.activo && <span className="badge" style={{ marginLeft: '.4rem', color: 'var(--danger)', borderColor: 'var(--danger)', fontSize: '.7rem' }}>🚫 Inactivo</span>}
                    {e.serial ? <div className="muted mono" style={{ fontSize: '.72rem' }}>{e.serial}</div> : null}
                  </td>
                  <td>{e.tipo ?? '—'}</td>
                  <td>{e.propietario ?? '—'}</td>
                  <td><span className="badge" style={{ color: STATUS_COLOR[e.status] ?? undefined }}>{e.status}</span></td>
                  <td>{e.ubicacion ?? '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{e.mantenimiento_cada_hrs != null ? fmtNum(e.mantenimiento_cada_hrs) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {info?.restantes == null
                      ? <span className="muted" title={!e.mantenimiento_cada_hrs ? 'Definí «Mantenimiento cada (hrs)» en la ficha' : 'Sin horómetro registrado'}>—</span>
                      : info.alerta
                        ? <span style={{ color: 'var(--warning)', fontWeight: 700 }} title={`Faltan ${fmtNum(info.restantes)} h · horómetro ${info.horometro != null ? fmtNum(info.horometro) : '—'}`}>⚠️ {fmtNum(info.restantes)} h</span>
                        : <span title={`horómetro ${info.horometro != null ? fmtNum(info.horometro) : '—'}`}>{fmtNum(info.restantes)} h</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button className="btn btn-sm btn-ghost" title="Bitácora / horómetro" onClick={() => setBitacora(e)}>🔧</button>
                    {canWrite && <button className="btn btn-sm btn-ghost" title="Editar" onClick={() => setForm({ open: true, equipo: e })}>✎</button>}
                    {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => void toggleActivo(e)}>{e.activo ? 'Desactivar' : 'Activar'}</button>}
                    {canWrite && <button className="btn btn-sm btn-ghost" title="Eliminar" onClick={() => setBorrar(e)}>🗑</button>}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </>
      ) : vista === 'mantenimiento' ? (
        !enMantenimiento.length ? <EmptyState icon="🔧" message="No hay equipos en mantenimiento." /> : (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.85rem' }}>
              <thead><tr>
                <th>Equipo</th><th>Tipo</th><th>Status</th><th>Grupo</th>
                <th style={{ textAlign: 'right' }}>Aceite (L)</th><th style={{ textAlign: 'right' }}>Filtros</th><th style={{ textAlign: 'right' }}>Registros</th><th></th>
              </tr></thead>
              <tbody>
                {enMantenimiento.map((e) => {
                  const c = consumos.get(e.id);
                  return (
                    <tr key={e.id} style={{ cursor: 'pointer' }} title="Ir al control de Servicio de Mantenimiento"
                      onClick={() => navigate('/app/maquinaria/servicio-mantenimiento')}>
                      <td><strong>{e.equipo}</strong>{e.serial ? <div className="muted mono" style={{ fontSize: '.72rem' }}>{e.serial}</div> : null}</td>
                      <td>{e.tipo ?? '—'}</td>
                      <td><span className="badge" style={{ color: STATUS_COLOR[e.status] ?? undefined }}>{e.status}</span></td>
                      <td>{e.grupo_mantenimiento ?? <span className="muted">—</span>}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{c?.aceite ? fmtNum(c.aceite) : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{c?.filtros ? fmtNum(c.filtros) : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{c?.registros ?? 0}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm btn-ghost" title="Bitácora / horómetro" onClick={(ev) => { ev.stopPropagation(); setBitacora(e); }}>🔧</button>
                        <button className="btn btn-sm btn-ghost" title="Ir al Servicio de Mantenimiento" onClick={(ev) => { ev.stopPropagation(); navigate('/app/maquinaria/servicio-mantenimiento'); }}>↗</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        !criticos.length ? <EmptyState icon="✅" message="Ningún equipo en estado crítico." /> : (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.85rem' }}>
              <thead><tr>
                <th>Equipo</th><th>Tipo</th><th>Status</th><th>¿Qué le falta?</th><th style={{ textAlign: 'right' }}>Horómetro</th><th></th>
              </tr></thead>
              <tbody>
                {criticos.map((e) => {
                  const issues = critMap.get(e.id) ?? [];
                  const info = infoEquipo.get(e.id);
                  return (
                    <tr key={e.id} style={{ background: 'rgba(239,68,68,.08)' }}>
                      <td><strong>{e.equipo}</strong>{e.serial ? <div className="muted mono" style={{ fontSize: '.72rem' }}>{e.serial}</div> : null}</td>
                      <td>{e.tipo ?? '—'}</td>
                      <td><span className="badge" style={{ color: STATUS_COLOR[e.status] ?? undefined }}>{e.status}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
                          {issues.map((it, i) => (
                            <span key={i} className="badge" style={{ color: 'var(--danger)', borderColor: 'var(--danger)', fontSize: '.72rem' }}
                              title={it.sinRegistro ? 'Intervalo definido pero sin registro en la bitácora' : it.vencidoHrs != null ? `Pasó ${fmtNum(it.vencidoHrs)} h del intervalo` : undefined}>
                              {it.key === 'servicio' ? '⛔' : '🛢'} {it.label}{it.sinRegistro ? ' · sin registro' : it.vencidoHrs != null ? ` · vencido ${fmtNum(it.vencidoHrs)} h` : ''}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>{info?.horometro != null ? fmtNum(info.horometro) : '—'}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm btn-ghost" title="Bitácora / horómetro" onClick={() => setBitacora(e)}>🔧</button>
                        {canWrite && <button className="btn btn-sm btn-ghost" title="Editar ficha / intervalos" onClick={() => setForm({ open: true, equipo: e })}>✎</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {catalogoOpen && <MaquinariaCatalogoModal canWrite={canWrite} onClose={() => setCatalogoOpen(false)} />}
      {resumenOpen && <ResumenMaquinariaModal equipos={equipos.filter((e) => e.activo)} onClose={() => setResumenOpen(false)} />}
      {form.open && <EquipoFormModal equipo={form.equipo} actor={actor} onClose={() => setForm({ open: false, equipo: null })} onSaved={cargar} />}
      {bitacora && <BitacoraModal equipo={bitacora} canWrite={canWrite} actor={actor} actorName={actorName} onClose={() => setBitacora(null)} />}
      {correoOpen && (
        <CorreoReporteModal
          titulo="Enviar Control de Maquinaria y Vehículos"
          descripcion={`Se enviará el PDF con ${lista.length} equipo(s).`}
          defaultEmail={actor}
          onEnviar={async (emails) => { const { enviarEquiposPorCorreo } = await import('./maquinariaReportes'); return (await enviarEquiposPorCorreo(lista, emails)).destinatarios; }}
          onClose={() => setCorreoOpen(false)}
        />
      )}
      {borrar && (
        <ConfirmDialog title="Eliminar equipo" message={`¿Eliminar "${borrar.equipo}" y toda su bitácora?`} confirmText="Eliminar" danger
          onCancel={() => setBorrar(null)} onConfirm={() => { const e = borrar; setBorrar(null); void doBorrar(e); }} />
      )}
    </div>
  );
}

/** Tarjeta de estado (ACTIVA / MANTENIMIENTO / CRÍTICO): muestra el total y al tocar abre su detalle. */
function EstadoCard({ activa, onClick, icon, titulo, total, color, hint }: {
  activa: boolean; onClick: () => void; icon: string; titulo: string; total: number; color: string; hint: string;
}) {
  return (
    <button type="button" onClick={onClick} className="card" style={{
      textAlign: 'left', cursor: 'pointer', margin: 0, padding: '.85rem 1rem', width: '100%',
      borderColor: activa ? color : 'var(--border)', borderWidth: activa ? 2 : 1, borderStyle: 'solid',
      background: activa ? 'var(--surface-2)' : undefined,
    }}>
      <div className="muted" style={{ fontSize: '.74rem', textTransform: 'uppercase', letterSpacing: '.03em' }}>{icon} {titulo}</div>
      <div className="mono" style={{ fontSize: '2rem', fontWeight: 800, color }}>{total}</div>
      <div className="muted" style={{ fontSize: '.72rem' }}>{hint}</div>
    </button>
  );
}
