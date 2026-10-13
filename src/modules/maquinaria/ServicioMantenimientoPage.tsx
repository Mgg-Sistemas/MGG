import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { VistaPrevia, Dato } from '@/shared/ui/VistaPrevia';
import { toast } from '@/shared/ui/Toast';
import { useSession } from '@/modules/auth/authStore';
import { num as fmtNum, dateTime } from '@/shared/lib/format';
import { BitacoraModal } from './BitacoraModal';
import { FlotaNav } from './FlotaNav';
import { ResumenMantenimientoModal } from './ResumenMantenimientoModal';
import { AccionConEquipo } from './AccionConEquipo';
import { listEquipos, reiniciarMantenimientoDeEquipo, GRUPOS_MANTENIMIENTO, type MaquinariaEquipo } from './maquinariaEquipos.repository';
import { solicitudesServicioPorEquipo, type SolicitudServicioEquipo } from './maquinariaMant.repository';
import { ordenesAbiertasPorEquipo, lecturasVigentesPorEquipo, type LecturaVigente } from './flota.repository';
import { ESTADOS_EQUIPO, estadoEfectivo, type AvisoServicio } from './flota';
import { coincideTexto } from './flotaListados';
import {
  SIN_GRUPO, ESTADOS_SERVICIO, REGLA_PROXIMO, grupoDeEquipo, infoServicio, compararUrgencia, resumenServicio,
  type EstadoServicio, type InfoServicio,
} from './flotaMantenimiento';

/** Etiqueta del estado de un servicio (alineada con la pestaña Servicios de Pedidos). */
const SERVICIO_ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Solicitado', aprobada: 'Aprobado (cotizar)', oc_creada: 'Pendiente por aprobación',
  cuenta_abierta: 'Crédito / cuenta abierta', confirmada_metodo: 'Confirmado (método de pago)',
  oc_aprobada: 'Confirmado pagar', por_recibir: 'Pendiente por realizar', pagada: 'Pagado',
  recibida: 'Servicio realizado', finalizada: 'Finalizado', cancelada: 'Cancelado', anulada: 'Anulado',
};
const estadoServicioLabel = (e: string) => SERVICIO_ESTADO_LABEL[e] ?? e;

/** Ícono de cada grupo de flota. */
const GRUPO_ICON: Record<string, string> = {
  'FLOTA PESADA': '🚜',
  'VEHÍCULOS DE CARGA': '🚚',
  'PLANTAS ELÉCTRICAS': '⚡',
};

type FiltroServicio = EstadoServicio | 'todos';

/** Barra de avance hacia el próximo servicio de una dimensión (horas o km). */
function BarraServicio({ aviso, cada, etiqueta }: { aviso: AvisoServicio | null; cada: number | null; etiqueta: string }) {
  if (!aviso) {
    return (
      <div className="flo-mant-barra sin">
        <div className="fila"><span>{etiqueta}</span><span>{cada ? 'sin lectura' : 'sin intervalo'}</span></div>
        <div className="flo-meter"><i style={{ width: '0%' }} /></div>
      </div>
    );
  }
  const tono = aviso.nivel === 'vencido' ? 'var(--danger)' : aviso.nivel === 'proximo' ? 'var(--warning)' : 'var(--success)';
  return (
    <div className="flo-mant-barra">
      <div className="fila">
        <span>{etiqueta} · cada {fmtNum(cada)} {aviso.unidad}</span>
        <strong style={{ color: tono }}>
          {aviso.restante <= 0 ? `vencido ${fmtNum(Math.abs(aviso.restante))} ${aviso.unidad}` : `faltan ${fmtNum(aviso.restante)} ${aviso.unidad}`}
        </strong>
      </div>
      <div className="flo-meter" style={{ ['--tone' as string]: tono }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(aviso.pct)}
        aria-label={`${etiqueta}: ${Math.round(aviso.pct)} % del intervalo`}><i style={{ width: `${aviso.pct}%` }} /></div>
    </div>
  );
}

/**
 * Submódulo «Servicio de Mantenimiento» de Control de Maquinaria. Los equipos se
 * agrupan por flota (FLOTA PESADA / VEHÍCULOS DE CARGA / PLANTAS ELÉCTRICAS) según el
 * grupo de su ficha o, si no tiene, el que se deduce del tipo. Cada equipo es una
 * tarjeta con su avance hacia el próximo servicio (horas y km), ordenadas por urgencia.
 * La regla es la del catálogo: «próximo» con ≤ 10 % del intervalo, contando desde la
 * base del último mantenimiento.
 */
export function ServicioMantenimientoPage() {
  const { can, appUser } = usePermissions();
  const { user } = useSession();
  const canWrite = can('maquinaria', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;

  const [equipos, setEquipos] = useState<MaquinariaEquipo[]>([]);
  const [lecturas, setLecturas] = useState<Map<string, LecturaVigente>>(new Map());
  const [solMap, setSolMap] = useState<Map<string, SolicitudServicioEquipo[]>>(new Map());
  const [osMap, setOsMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [grupo, setGrupo] = useState<string>(GRUPOS_MANTENIMIENTO[0]);
  const [filtro, setFiltro] = useState<FiltroServicio>('todos');
  const [q, setQ] = useState('');
  const [bitacora, setBitacora] = useState<MaquinariaEquipo | null>(null);
  const [resumenOpen, setResumenOpen] = useState(false);
  const [solDe, setSolDe] = useState<MaquinariaEquipo | null>(null);
  const [nuevaOrden, setNuevaOrden] = useState<MaquinariaEquipo | null>(null);
  const [reiniciar, setReiniciar] = useState<{ e: MaquinariaEquipo; info: InfoServicio } | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [eqs, lecs, sol, os] = await Promise.all([
        listEquipos(),
        lecturasVigentesPorEquipo().catch(() => new Map<string, LecturaVigente>()),
        solicitudesServicioPorEquipo().catch(() => new Map<string, SolicitudServicioEquipo[]>()),
        ordenesAbiertasPorEquipo().catch(() => new Map<string, number>()),
      ]);
      setEquipos(eqs);
      setLecturas(lecs);
      setSolMap(sol);
      setOsMap(os);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['maquinaria_equipos', 'maquinaria_catalogos', 'maquinaria_mantenimientos', 'maquinaria_ordenes_servicio', 'combustible_tanque_movimientos', 'maquinaria_lecturas', 'ordenes'], () => { void cargar(); });

  // Lecturas vigentes (unificadas: Combustible, Maquinaria y bitácora) y estado del servicio.
  const infoEquipo = useMemo(() => {
    const m = new Map<string, InfoServicio>();
    for (const e of equipos) {
      // Contador vigente unificado: Combustible, Maquinaria y bitácora (el mismo del surtidor).
      const lec = lecturas.get(e.id);
      const horo = lec?.horometro ?? null;
      const km = lec?.kilometraje ?? null;
      m.set(e.id, infoServicio(e, horo, km));
    }
    return m;
  }, [equipos, lecturas]);

  // Equipos por grupo (el asignado a mano o el deducido del tipo) + los que no caen en ninguno.
  const porGrupo = useMemo(() => {
    const m = new Map<string, MaquinariaEquipo[]>();
    for (const g of GRUPOS_MANTENIMIENTO) m.set(g, []);
    const sinGrupoList: MaquinariaEquipo[] = [];
    for (const e of equipos) {
      const g = grupoDeEquipo(e);
      if (m.has(g)) m.get(g)!.push(e);
      else sinGrupoList.push(e);
    }
    return { m, sinGrupoList, sinGrupo: sinGrupoList.length };
  }, [equipos]);

  const delGrupo = useMemo(
    () => (grupo === SIN_GRUPO ? porGrupo.sinGrupoList : (porGrupo.m.get(grupo) ?? [])),
    [grupo, porGrupo],
  );
  const grupoLabel = grupo === SIN_GRUPO ? 'SIN CLASIFICAR' : grupo;
  const items = useMemo(
    () => delGrupo.map((e) => ({ e, info: infoEquipo.get(e.id) ?? infoServicio(e, null, null), activo: e.activo !== false, nombre: e.equipo })),
    [delGrupo, infoEquipo],
  );
  const resumen = useMemo(() => resumenServicio(items), [items]);
  const lista = useMemo(() => items
    .filter((it) => filtro === 'todos' || (it.activo && it.info.estado === filtro))
    .filter((it) => coincideTexto([it.e.equipo, it.e.tipo, it.e.marca, it.e.modelo, it.e.serial, it.e.placa, it.e.ubicacion, it.e.status], q))
    .sort(compararUrgencia), [items, filtro, q]);

  // Alerta por KILOMETRAJE del grupo: va en X km · el próximo toca en Y km.
  const enAlertaKm = useMemo(
    () => items.flatMap((it) => {
      const a = it.info.avisoK;
      if (!it.activo || !a || a.nivel === 'ok' || it.info.km == null) return [];
      return [{ e: it.e, ultimoKm: it.info.km, alertaKm: it.info.km + a.restante, restante: a.restante }];
    }),
    [items],
  );

  // Para el Resumen del grupo (PDF): HRS restantes con la misma regla de la tarjeta.
  const infoResumen = useMemo(() => {
    const m = new Map<string, { restantes: number | null; horometro: number | null; alerta: boolean }>();
    for (const [id, i] of infoEquipo) m.set(id, { restantes: i.avisoH?.restante ?? null, horometro: i.horometro, alerta: i.estado === 'vencido' || i.estado === 'proximo' });
    return m;
  }, [infoEquipo]);

  async function confirmarReinicio(e: MaquinariaEquipo) {
    try {
      const { horas, km } = await reiniciarMantenimientoDeEquipo(e.id);
      if (horas == null && km == null) toast(`${e.equipo}: no hay horómetro ni kilometraje vigente para fijar la base.`, 'warning');
      else toast(`Contador reiniciado para ${e.equipo} desde ${[horas != null ? `${fmtNum(horas)} h` : null, km != null ? `${fmtNum(km)} km` : null].filter(Boolean).join(' · ')}.`, 'success');
      await cargar();
    } catch (err) { toast(err instanceof Error ? err.message : 'No se pudo reiniciar el contador', 'error'); }
  }

  const tarjetasResumen: { id: FiltroServicio; n: number; label: string; icon: string; tono: string }[] = [
    { id: 'vencido', n: resumen.vencido, label: 'Vencidos', icon: ESTADOS_SERVICIO.vencido.icon, tono: 'danger' },
    { id: 'proximo', n: resumen.proximo, label: 'Próximos', icon: ESTADOS_SERVICIO.proximo.icon, tono: 'warning' },
    { id: 'al_dia', n: resumen.al_dia, label: 'Al día', icon: ESTADOS_SERVICIO.al_dia.icon, tono: 'success' },
    { id: 'sin_datos', n: resumen.sin_datos, label: 'Sin datos', icon: ESTADOS_SERVICIO.sin_datos.icon, tono: 'retired' },
  ];

  return (
    <div className="flo">
      <FlotaNav />
      <div className="page-head">
        <div>
          <h1 className="flo-h1">🔧 Servicio de Mantenimiento</h1>
          <p className="flo-sub">Avance de cada equipo hacia su próximo servicio por horas y km, ordenado por urgencia.</p>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => setResumenOpen(true)}>📊 Resumen de {grupoLabel}</button>
        </div>
      </div>

      {/* Grupos de flota: cada uno con su número de equipos */}
      <div className="flo-fleet flo-grupos" role="tablist" aria-label="Grupo de flota">
        {GRUPOS_MANTENIMIENTO.map((g) => (
          <button key={g} type="button" role="tab" className="tone-primary" aria-selected={grupo === g} aria-pressed={grupo === g} onClick={() => setGrupo(g)}>
            <strong>{porGrupo.m.get(g)?.length ?? 0}</strong><span>{GRUPO_ICON[g] ?? '🔧'} {g}</span>
          </button>
        ))}
        {porGrupo.sinGrupo > 0 && (
          <button type="button" role="tab" className="tone-retired" aria-selected={grupo === SIN_GRUPO} aria-pressed={grupo === SIN_GRUPO} onClick={() => setGrupo(SIN_GRUPO)}>
            <strong>{porGrupo.sinGrupo}</strong><span>🗂 SIN CLASIFICAR</span>
          </button>
        )}
      </div>

      {porGrupo.sinGrupo > 0 && grupo !== SIN_GRUPO && (
        <div className="aviso info sm" style={{ marginBottom: '.6rem' }}><span className="aviso-icono">ℹ️</span><div>
          {porGrupo.sinGrupo} equipo(s) sin grupo asignado — están en <strong>🗂 SIN CLASIFICAR</strong>. Asígnales un grupo en su ficha («Grupo · Servicio de Mantenimiento») para ordenarlos por flota.
        </div></div>
      )}

      {/* Resumen del grupo: también filtra la lista */}
      <div className="flo-mant-resumen" role="group" aria-label="Filtrar por estado del servicio">
        {tarjetasResumen.map((t) => (
          <button key={t.id} type="button" className={`tone-${t.tono}`} aria-pressed={filtro === t.id} onClick={() => setFiltro(filtro === t.id ? 'todos' : t.id)}>
            <strong>{t.n}</strong><span>{t.icon} {t.label}</span>
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: '.76rem', margin: '-.3rem 0 .7rem' }}>
        «Próximo» = faltan {REGLA_PROXIMO} (por horas o por km), contando desde el último mantenimiento. Los inactivos no cuentan.
      </p>

      {/* Alerta por KILOMETRAJE */}
      {enAlertaKm.length > 0 && (
        <div className="aviso danger" style={{ marginBottom: '.6rem' }}>
          <span className="aviso-icono">🛞</span>
          <div>
            <strong>{enAlertaKm.length} equipo(s) con servicio por kilometraje próximo o vencido</strong>
            <ul className="flo-mini" style={{ color: 'var(--text)' }}>
              {enAlertaKm.map(({ e, ultimoKm, alertaKm, restante }) => (
                <li key={e.id}>
                  <strong>{e.equipo}</strong>: va en <strong className="mono">{fmtNum(ultimoKm)} km</strong> · servicio en <strong className="mono">{fmtNum(alertaKm)} km</strong>
                  {restante > 0 ? <> — faltan <strong className="mono">{fmtNum(restante)} km</strong></> : <> — <strong style={{ color: 'var(--danger)' }}>¡alcanzado! ({fmtNum(Math.abs(restante))} km pasados)</strong></>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="flo-filtros">
        <div className="fila">
          <input className="input flo-buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Buscar equipo, marca, serial, ubicación…" aria-label="Buscar equipo" />
          <div className="flo-seg" role="group" aria-label="Estado del servicio">
            <button type="button" aria-pressed={filtro === 'todos'} onClick={() => setFiltro('todos')}>Todos</button>
            {(['vencido', 'proximo', 'al_dia', 'sin_datos'] as EstadoServicio[]).map((s) => (
              <button key={s} type="button" aria-pressed={filtro === s} onClick={() => setFiltro(s)}>{ESTADOS_SERVICIO[s].icon} {ESTADOS_SERVICIO[s].label}</button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <EmptyState message="Cargando…" />
      ) : !delGrupo.length ? (
        <EmptyState message={`Sin equipos en «${grupoLabel}». Asigna este grupo a los equipos desde su ficha.`} icon="🔧" />
      ) : !lista.length ? (
        <EmptyState message="Ningún equipo con estos filtros." icon="🔎" />
      ) : (
        <div className="flo-lista">
          {lista.map(({ e, info, activo }) => {
            const st = ESTADOS_SERVICIO[info.estado];
            const sols = solMap.get(e.id) ?? [];
            const abiertas = sols.filter((s) => s.abierta).length;
            const nOs = osMap.get(e.id) ?? 0;
            const estadoEq = ESTADOS_EQUIPO[estadoEfectivo(e)];
            const lectura = info.horometro != null ? `${fmtNum(info.horometro)} h` : null;
            const lecturaKm = info.km != null ? `${fmtNum(info.km)} km` : null;
            const alerta = info.estado === 'vencido' || info.estado === 'proximo';
            return (
              <div key={e.id} className={`flo-mant-card tone-${st.tono}${activo ? '' : ' inactivo'}`}>
                <div className="flo-mant-head">
                  <div style={{ minWidth: 0 }}>
                    <Link to={`/app/maquinaria/equipo/${e.id}`} className="flo-code" title="Abrir el expediente del equipo">{e.equipo}</Link>
                    <div className="flo-subl">{[e.tipo, e.marca, e.modelo].filter(Boolean).join(' · ') || '—'}</div>
                  </div>
                  <span className={`flo-chip tone-${st.tono}`}>{st.icon} {st.label}</span>
                </div>
                <div className="flo-meta">
                  <span className={`flo-chip tone-${estadoEq.tono}`}>{estadoEq.icon} {estadoEq.label}</span>
                  {!activo && <span className="flo-chip tone-retired">🚫 Inactivo</span>}
                  {e.ubicacion && <span>📍 {e.ubicacion}</span>}
                  {(lectura || lecturaKm) && <span>⏱️ {[lectura, lecturaKm].filter(Boolean).join(' · ')}</span>}
                </div>
                <div className="flo-mant-barras">
                  <BarraServicio aviso={info.avisoH} cada={e.mantenimiento_cada_hrs} etiqueta="Horas" />
                  {(e.mantenimiento_cada_km || info.km != null) && <BarraServicio aviso={info.avisoK} cada={e.mantenimiento_cada_km} etiqueta="Kilometraje" />}
                </div>
                <div className="flo-meta">
                  {sols.length > 0
                    ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSolDe(e)} title="Ver las solicitudes de servicio de este equipo">
                        🧾 {sols.length} solicitud(es){abiertas > 0 ? ` · ${abiertas} en curso` : ''}
                      </button>
                    : <span>🧾 Sin solicitudes de servicio</span>}
                  {nOs > 0
                    ? <Link className="btn btn-sm btn-ghost" to={`/app/maquinaria/equipo/${e.id}?tab=servicios`}>🔧 {nOs} orden(es) en curso</Link>
                    : <span>🔧 Sin órdenes en curso</span>}
                </div>
                <div className="flo-orden-foot">
                  <button className="btn" onClick={() => setBitacora(e)}>📒 Bitácora</button>
                  <Link className="btn" to={`/app/maquinaria/equipo/${e.id}`}>🚜 Expediente</Link>
                  {canWrite && activo && <button className="btn btn-primary" onClick={() => setNuevaOrden(e)}>🔧 Nueva orden</button>}
                  {canWrite && activo && alerta && <button className="btn btn-success" onClick={() => setReiniciar({ e, info })}>✔ Mantt. hecho</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {solDe && (
        <SolicitudesServicioModal equipo={solDe} solicitudes={solMap.get(solDe.id) ?? []}
          onClose={() => setSolDe(null)}
          onBitacora={() => { const eq = solDe; setSolDe(null); setBitacora(eq); }} />
      )}
      {bitacora && <BitacoraModal equipo={bitacora} canWrite={canWrite} actor={actor} actorName={actorName} onClose={() => setBitacora(null)} />}
      {resumenOpen && (
        <ResumenMantenimientoModal
          grupo={grupoLabel}
          equipos={delGrupo}
          infoEquipo={infoResumen}
          onClose={() => setResumenOpen(false)}
        />
      )}
      {nuevaOrden && <AccionConEquipo accion="orden" equipos={equipos} equipoInicial={nuevaOrden.id} onClose={() => setNuevaOrden(null)} onDone={() => void cargar()} />}
      {reiniciar && (
        <ConfirmDialog title="Mantenimiento hecho" confirmText="Reiniciar contador"
          message="Se marca el mantenimiento como realizado: el contador de horas/km vuelve a empezar desde la lectura vigente."
          preview={<VistaPrevia titulo="Base nueva"><Dato label="Equipo">{reiniciar.e.equipo}</Dato><Dato label="Horómetro">{reiniciar.info.horometro != null ? `${fmtNum(reiniciar.info.horometro)} h` : undefined}</Dato><Dato label="Kilometraje">{reiniciar.info.km != null ? `${fmtNum(reiniciar.info.km)} km` : undefined}</Dato></VistaPrevia>}
          onCancel={() => setReiniciar(null)} onConfirm={() => { const r = reiniciar; setReiniciar(null); void confirmarReinicio(r.e); }} />
      )}
    </div>
  );
}

/**
 * Lista las solicitudes de servicio (tipo='servicio' de Pedidos) vinculadas a un
 * equipo: de dónde se pidió el servicio → aquí se ve. Se gestionan en la pestaña
 * Servicios de Pedidos (aprobar, cotizar, pagar, realizar) y el seguimiento del
 * consumo se lleva en la bitácora del equipo.
 */
function SolicitudesServicioModal({ equipo, solicitudes, onClose, onBitacora }: {
  equipo: MaquinariaEquipo;
  solicitudes: SolicitudServicioEquipo[];
  onClose: () => void;
  onBitacora: () => void;
}) {
  const abiertas = solicitudes.filter((s) => s.abierta).length;
  return (
    <Modal title={`🧾 Solicitudes de servicio · ${equipo.equipo}`} size="lg" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        <button className="btn btn-primary" onClick={onBitacora} title="Registrar el seguimiento (consumos, repuestos) en la bitácora del equipo">🔧 Seguimiento en bitácora</button>
      </>}>
      <p className="muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Servicios pedidos para este equipo desde <strong>Pedidos → 🔧 Servicios</strong>. {abiertas > 0
          ? <>Hay <strong>{abiertas}</strong> en curso.</>
          : 'No hay servicios en curso.'} Se piden y cotizan en <a href="#/app/pedidos">la pestaña Servicios</a>; el seguimiento del consumo (litros, cauchos, repuestos…) se lleva en la <strong>bitácora</strong> de este equipo.
      </p>
      {solicitudes.length === 0 ? (
        <EmptyState message="Este equipo no tiene solicitudes de servicio." icon="🧾" />
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead><tr>
              <th>Código</th><th>Estado</th><th>Descripción</th><th>Solicita</th><th>Unidad</th><th style={{ textAlign: 'right' }}>Fecha</th>
            </tr></thead>
            <tbody>
              {solicitudes.map((s) => (
                <tr key={`${s.id}-${s.equipo_id}`} style={{ opacity: s.abierta ? 1 : 0.55 }}>
                  <td className="mono">{s.codigo}</td>
                  <td><span className="badge" style={s.abierta ? { color: 'var(--warning)', borderColor: 'var(--warning)' } : undefined}>{estadoServicioLabel(s.estado)}</span></td>
                  <td>{s.descripcion}</td>
                  <td>{s.solicitante_persona ?? '—'}</td>
                  <td>{s.solicitante ?? '—'}</td>
                  <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{dateTime(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
