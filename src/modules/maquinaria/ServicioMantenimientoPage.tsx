import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { EmptyState } from '@/shared/ui/EmptyState';
import { useSession } from '@/modules/auth/authStore';
import { num as fmtNum } from '@/shared/lib/format';
import { BitacoraModal } from './BitacoraModal';
import { ResumenMantenimientoModal } from './ResumenMantenimientoModal';
import { listEquipos, GRUPOS_MANTENIMIENTO, type MaquinariaEquipo, type GrupoMantenimiento } from './maquinariaEquipos.repository';
import { horasUltimoPorEquipo } from './maquinariaMant.repository';
import { horometrosVigentesPorEquipo } from '@/modules/combustible/combustible.repository';

const STATUS_COLOR: Record<string, string> = {
  'ACTIVO': 'var(--success)', 'MANTENIMIENTO': 'var(--warning)',
  'FUERA DE SERVICIO': 'var(--danger)', 'INACTIVO': 'var(--muted)',
};

/** Umbral de alerta: si faltan ≤ 250 HRS para el próximo mantenimiento, se avisa. */
const UMBRAL_ALERTA_HRS = 250;

/** Ícono de cada switch (grupo). */
const GRUPO_ICON: Record<string, string> = {
  'FLOTA PESADA': '🚜',
  'VEHÍCULOS DE CARGA': '🚚',
  'PLANTAS ELÉCTRICAS': '⚡',
};

/**
 * HRS restantes hasta el próximo mantenimiento (cada N horas de horómetro):
 * restantes = N − (horómetro mod N). null si falta algún dato.
 */
function hrsRestantes(frecuencia: number | null, horometro: number | null): number | null {
  if (!frecuencia || frecuencia <= 0 || horometro == null) return null;
  return ((frecuencia - (horometro % frecuencia)) % frecuencia);
}

/**
 * Submódulo «Servicio de Mantenimiento» de Control de Maquinaria. Los equipos se
 * agrupan en switches (FLOTA PESADA / VEHÍCULOS DE CARGA / PLANTAS ELÉCTRICAS) según
 * el grupo asignado en su ficha; cada switch muestra los equipos de ese grupo con su
 * estado de mantenimiento (horómetro, HRS restantes, alerta) y acceso a la bitácora.
 */
export function ServicioMantenimientoPage() {
  const { can, appUser } = usePermissions();
  const { user } = useSession();
  const canWrite = can('maquinaria', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;

  const [equipos, setEquipos] = useState<MaquinariaEquipo[]>([]);
  const [horometros, setHorometros] = useState<Map<string, number>>(new Map());
  const [bitMap, setBitMap] = useState<Map<string, { ultimoHorometro: number | null }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [grupo, setGrupo] = useState<GrupoMantenimiento>(GRUPOS_MANTENIMIENTO[0]);
  const [bitacora, setBitacora] = useState<MaquinariaEquipo | null>(null);
  const [resumenOpen, setResumenOpen] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [eqs, horos, bit] = await Promise.all([
        listEquipos(),
        horometrosVigentesPorEquipo().catch(() => new Map<string, number>()),
        horasUltimoPorEquipo().catch(() => new Map()),
      ]);
      setEquipos(eqs);
      setHorometros(horos);
      setBitMap(bit);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['maquinaria_equipos', 'maquinaria_catalogos', 'maquinaria_mantenimientos', 'combustible_tanque_movimientos'], () => { void cargar(); });

  // Horómetro vigente + HRS restantes por equipo (igual que en Control de Maquinaria).
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

  // Conteo por grupo + equipos sin clasificar.
  const porGrupo = useMemo(() => {
    const m = new Map<string, MaquinariaEquipo[]>();
    for (const g of GRUPOS_MANTENIMIENTO) m.set(g, []);
    let sinGrupo = 0;
    for (const e of equipos) {
      const g = (e.grupo_mantenimiento ?? '').trim();
      if (g && m.has(g)) m.get(g)!.push(e);
      else sinGrupo += 1;
    }
    return { m, sinGrupo };
  }, [equipos]);

  const lista = porGrupo.m.get(grupo) ?? [];
  const enAlerta = lista.filter((e) => e.activo && infoEquipo.get(e.id)?.alerta);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🔧 Servicio de Mantenimiento</h1>
          <p className="muted" style={{ margin: '.2rem 0 0', fontSize: '.85rem' }}>
            Equipos de Control de Maquinaria agrupados por flota, con su estado de mantenimiento.
          </p>
        </div>
        <div className="actions" style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => setResumenOpen(true)}>📊 Resumen de {grupo}</button>
        </div>
      </div>

      {/* Switches por grupo */}
      <div className="view-toggle" role="tablist" aria-label="Grupo de mantenimiento" style={{ flexWrap: 'wrap', marginBottom: '.7rem' }}>
        {GRUPOS_MANTENIMIENTO.map((g) => (
          <button key={g} role="tab" aria-selected={grupo === g} className={grupo === g ? 'active' : ''} onClick={() => setGrupo(g)}>
            {GRUPO_ICON[g] ?? '🔧'} {g} <span className="badge" style={{ marginLeft: '.35rem' }}>{porGrupo.m.get(g)?.length ?? 0}</span>
          </button>
        ))}
      </div>

      {porGrupo.sinGrupo > 0 && (
        <div className="muted" style={{ fontSize: '.8rem', marginBottom: '.6rem' }}>
          ℹ️ {porGrupo.sinGrupo} equipo(s) sin grupo asignado — clasificálos en su ficha (Control de Maquinaria → ✎ → «Grupo · Servicio de Mantenimiento») para que aparezcan acá.
        </div>
      )}

      {enAlerta.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warning)', background: 'var(--bg-1)', marginBottom: '.6rem', padding: '.55rem .85rem' }}>
          ⚠️ <strong>{enAlerta.length} equipo(s)</strong> con mantenimiento próximo (≤ {UMBRAL_ALERTA_HRS} HRS): {enAlerta.slice(0, 6).map((e) => e.equipo).join(', ')}{enAlerta.length > 6 ? '…' : ''}
        </div>
      )}

      {loading ? (
        <EmptyState message="Cargando…" />
      ) : !lista.length ? (
        <EmptyState message={`Sin equipos en «${grupo}». Asigná este grupo a los equipos desde su ficha.`} icon="🔧" />
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead><tr>
              <th>Equipo</th><th>Status</th><th>Ubicación</th>
              <th style={{ textAlign: 'right' }}>Horómetro</th>
              <th style={{ textAlign: 'right' }}>Mantt. cada (h)</th>
              <th style={{ textAlign: 'right' }}>HRS restantes</th><th></th>
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
                    <td><span className="badge" style={{ color: STATUS_COLOR[e.status] ?? undefined }}>{e.status}</span></td>
                    <td>{e.ubicacion ?? '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{info?.horometro != null ? fmtNum(info.horometro) : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{e.mantenimiento_cada_hrs != null ? fmtNum(e.mantenimiento_cada_hrs) : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {info?.restantes == null
                        ? <span className="muted" title={!e.mantenimiento_cada_hrs ? 'Definí «Mantenimiento cada (hrs)» en la ficha' : 'Sin horómetro registrado'}>—</span>
                        : info.alerta
                          ? <span style={{ color: 'var(--warning)', fontWeight: 700 }} title={`Faltan ${fmtNum(info.restantes)} h`}>⚠️ {fmtNum(info.restantes)} h</span>
                          : <span>{fmtNum(info.restantes)} h</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button className="btn btn-sm btn-ghost" title="Bitácora / horómetro / mantenimientos" onClick={() => setBitacora(e)}>🔧 Bitácora</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {bitacora && <BitacoraModal equipo={bitacora} canWrite={canWrite} actor={actor} actorName={actorName} onClose={() => setBitacora(null)} />}
      {resumenOpen && (
        <ResumenMantenimientoModal
          grupo={grupo}
          equipos={lista}
          infoEquipo={infoEquipo}
          onClose={() => setResumenOpen(false)}
        />
      )}
    </div>
  );
}
