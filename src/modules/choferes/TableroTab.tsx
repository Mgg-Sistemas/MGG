/* ============================================================
   MGG · Choferes / Conductores · Tablero

   Lo que hay que saber de un vistazo: cuántos conductores hay, cuántos están
   en la vía, cuántos de descanso y qué documentos están vencidos o por
   vencer. Cada tarjeta lleva a la pestaña donde se resuelve.
   ============================================================ */
import { useMemo } from 'react';
import { money, date as fmtDate } from '@/shared/lib/format';
import { EmptyState } from '@/shared/ui/EmptyState';
import { ESTADO_CHOFER, ESTADO_FLOTA, alertasDocumentos, estadoChofer, liquidarViaticos, textoRuta, type EstadoFlota } from './choferes';
import { fechaHora, nombreConductor, textoVehiculo, type PropsTab } from './ChoferesPage';

type Vista = 'tablero' | 'expediente' | 'viajes' | 'viaticos' | 'pagos' | 'descansos';

export function TableroTab({ datos, irA }: PropsTab & { irA: (v: Vista) => void }) {
  const { conductores, flota, viajes, viaticos, pagos, descansos, hoy, loading } = datos;

  const activos = useMemo(() => conductores.filter((c) => c.activo), [conductores]);
  const enRutaIds = useMemo(() => new Set(viajes.filter((v) => v.estado === 'en_ruta').map((v) => v.chofer_id)), [viajes]);
  const descansoHoy = useMemo(() => new Set(descansos.filter((d) => d.desde <= hoy && hoy <= d.hasta).map((d) => d.personal_id)), [descansos, hoy]);

  const porEstado = useMemo(() => {
    const m = { en_ruta: 0, descanso: 0, disponible: 0, inactivo: 0 };
    for (const c of conductores) m[estadoChofer({ activo: c.activo, enRuta: enRutaIds.has(c.id), deDescanso: descansoHoy.has(c.personal_id) })]++;
    return m;
  }, [conductores, enRutaIds, descansoHoy]);

  const alertas = useMemo(() => activos
    .flatMap((c) => alertasDocumentos(c, hoy).map((a) => ({ ...a, conductor: c })))
    .sort((a, b) => (a.estado === b.estado ? 0 : a.estado === 'vencido' ? -1 : 1)), [activos, hoy]);
  const vencidos = alertas.filter((a) => a.estado === 'vencido').length;

  const flotaPorEstado = useMemo(() => {
    const m: Record<EstadoFlota, number> = { operativo: 0, taller: 0, inactivo: 0 };
    for (const v of flota) if (v.activo) m[(v.estado_flota ?? 'operativo') as EstadoFlota]++;
    return m;
  }, [flota]);
  const segurosFlota = useMemo(() => flota.filter((v) => v.activo && v.seguro_vence && v.seguro_vence <= hoy).length, [flota, hoy]);

  const enRuta = useMemo(() => viajes.filter((v) => v.estado === 'en_ruta'), [viajes]);
  const programados = useMemo(() => viajes.filter((v) => v.estado === 'programado').sort((a, b) => a.fecha_salida.localeCompare(b.fecha_salida)).slice(0, 6), [viajes]);
  const sinLiquidar = useMemo(() => viajes.filter((v) => v.estado === 'finalizado' && !v.liquidado_at && viaticos.some((m) => m.viaje_id === v.id)), [viajes, viaticos]);
  const anticiposAbiertos = useMemo(() => liquidarViaticos(viaticos.filter((m) => {
    if (m.tipo !== 'anticipo') return false;
    const v = m.viaje_id ? viajes.find((x) => x.id === m.viaje_id) : null;
    return !v || !v.liquidado_at;
  })).anticipos, [viaticos, viajes]);
  const pendientes = useMemo(() => pagos.filter((p) => p.estado === 'pendiente'), [pagos]);
  const porPagar = pendientes.reduce((a, p) => a + p.neto_usd, 0);
  const mes = hoy.slice(0, 7);
  const viajesMes = viajes.filter((v) => v.estado === 'finalizado' && (v.llegada_real_at ?? v.fecha_salida).slice(0, 7) === mes).length;

  const porId = useMemo(() => new Map(conductores.map((c) => [c.id, c])), [conductores]);
  const vehiculoPorId = useMemo(() => new Map(flota.map((v) => [v.id, v])), [flota]);

  if (loading) return <div className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Cargando…</div>;

  return (
    <div className="descansos">
      <div className="kpi-grid" style={{ marginBottom: '1rem' }}>
        <button type="button" className="kpi desc-kpi" onClick={() => irA('expediente')}>
          <div className="label">Conductores activos</div>
          <div className="value">{activos.length}<small> / {conductores.length}</small></div>
          <div className="muted" style={{ fontSize: '.78rem' }}>{porEstado.disponible} disponibles hoy</div>
          <div className="icon" aria-hidden="true">🪪</div>
        </button>
        <button type="button" className="kpi desc-kpi" onClick={() => irA('viajes')}>
          <div className="label">En ruta ahora</div>
          <div className="value">{porEstado.en_ruta}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>{programados.length ? `${viajes.filter((v) => v.estado === 'programado').length} viaje(s) programados` : 'Sin viajes programados'}</div>
          <div className="icon" aria-hidden="true">🚛</div>
        </button>
        <button type="button" className="kpi desc-kpi" onClick={() => irA('descansos')}>
          <div className="label">De descanso hoy</div>
          <div className="value">{porEstado.descanso}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>Rotación como en RRHH</div>
          <div className="icon" aria-hidden="true">🏠</div>
        </button>
        <button type="button" className={`kpi desc-kpi${vencidos ? ' alerta' : ''}`} onClick={() => irA('expediente')}>
          <div className="label">Alertas de documentos</div>
          <div className="value">{alertas.length}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>{vencidos} vencido(s) · {alertas.length - vencidos} por vencer (30 días)</div>
          <div className="icon" aria-hidden="true">⚠</div>
        </button>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1rem' }}>
        <button type="button" className={`kpi desc-kpi${segurosFlota ? ' alerta' : ''}`} onClick={() => irA('expediente')}>
          <div className="label">Flota</div>
          <div className="value">{flotaPorEstado.operativo}<small> operativos</small></div>
          <div className="muted" style={{ fontSize: '.78rem' }}>{flotaPorEstado.taller} en taller · {flotaPorEstado.inactivo} inactivos{segurosFlota ? ` · ${segurosFlota} seguro(s) vencido(s)` : ''}</div>
          <div className="icon" aria-hidden="true">🚚</div>
        </button>
        <button type="button" className="kpi desc-kpi" onClick={() => irA('viajes')}>
          <div className="label">Viajes finalizados este mes</div>
          <div className="value">{viajesMes}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>{viajes.length} en el histórico</div>
          <div className="icon" aria-hidden="true">🏁</div>
        </button>
        <button type="button" className={`kpi desc-kpi${sinLiquidar.length ? ' alerta' : ''}`} onClick={() => irA('viaticos')}>
          <div className="label">Viáticos por liquidar</div>
          <div className="value">{sinLiquidar.length}<small> viaje(s)</small></div>
          <div className="muted" style={{ fontSize: '.78rem' }}>{money(anticiposAbiertos)} en anticipos abiertos</div>
          <div className="icon" aria-hidden="true">💵</div>
        </button>
        <button type="button" className="kpi desc-kpi" onClick={() => irA('pagos')}>
          <div className="label">Recibos por pagar</div>
          <div className="value">{pendientes.length}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>{money(porPagar)} pendientes</div>
          <div className="icon" aria-hidden="true">🧾</div>
        </button>
      </div>

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <div className="card">
          <div className="card-title">⚠ Documentos vencidos o por vencer</div>
          {!alertas.length ? <EmptyState icon="✅" message="Todos los documentos de los conductores activos están vigentes." /> : (
            <div className="table-wrap"><table className="table" style={{ fontSize: '.85rem' }}>
              <thead><tr><th>Conductor</th><th>Documento</th><th>Vence</th><th>Estado</th></tr></thead>
              <tbody>{alertas.map((a) => (
                <tr key={`${a.conductor.id}-${a.key}`}>
                  <td>{nombreConductor(a.conductor)}</td>
                  <td>{a.label}</td>
                  <td className="mono">{fmtDate(a.vence)}</td>
                  <td><span className={`badge ${a.estado === 'vencido' ? 'danger' : 'warning'}`}>{a.estado === 'vencido' ? 'Vencido' : 'Por vencer'}</span></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>

        <div className="card">
          <div className="card-title">🚛 En ruta ahora</div>
          {!enRuta.length ? <EmptyState icon="🅿" message="Nadie está en ruta en este momento." /> : (
            <div className="table-wrap"><table className="table" style={{ fontSize: '.85rem' }}>
              <thead><tr><th>N°</th><th>Chofer</th><th>Ruta</th><th>Vehículo</th><th>Salió</th></tr></thead>
              <tbody>{enRuta.map((v) => (
                <tr key={v.id}>
                  <td className="mono">{v.numero}</td>
                  <td>{nombreConductor(porId.get(v.chofer_id))}</td>
                  <td>{textoRuta(v)}</td>
                  <td>{textoVehiculo(vehiculoPorId.get(v.vehiculo_id ?? ''))}</td>
                  <td className="mono">{fechaHora(v.salida_real_at ?? v.fecha_salida)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {!!programados.length && (
            <>
              <div className="card-title" style={{ marginTop: '.8rem' }}>📅 Próximas salidas</div>
              <div className="table-wrap"><table className="table" style={{ fontSize: '.85rem' }}>
                <tbody>{programados.map((v) => (
                  <tr key={v.id}>
                    <td className="mono">{v.numero}</td>
                    <td>{nombreConductor(porId.get(v.chofer_id))}</td>
                    <td>{textoRuta(v)}</td>
                    <td className="mono">{fechaHora(v.fecha_salida)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </>
          )}
        </div>

        <div className="card">
          <div className="card-title">👥 Estado de cada conductor hoy</div>
          {!activos.length ? <EmptyState icon="🪪" message="Todavía no hay conductores con expediente. Ábrelos en «Expediente y flota»." /> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
              {activos.map((c) => {
                const e = ESTADO_CHOFER[estadoChofer({ activo: c.activo, enRuta: enRutaIds.has(c.id), deDescanso: descansoHoy.has(c.personal_id) })];
                return <span key={c.id} className={`badge ${e.clase}`} title={e.label}>{e.icon} {nombreConductor(c)}</span>;
              })}
            </div>
          )}
          <div className="muted" style={{ fontSize: '.78rem', marginTop: '.6rem' }}>
            {Object.entries(ESTADO_FLOTA).map(([k, v]) => `${v.icon} ${v.label}: ${flotaPorEstado[k as EstadoFlota]}`).join(' · ')} (flota)
          </div>
        </div>
      </div>
    </div>
  );
}
