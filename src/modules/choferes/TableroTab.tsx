/* ============================================================
   MGG · Choferes / Conductores · Tablero

   Lo que hay que saber de un vistazo: cuántos conductores hay, cuántos están
   en la vía, cuántos de descanso y qué documentos están vencidos o por
   vencer. Cada tarjeta lleva a la pestaña donde se resuelve.
   ============================================================ */
import { useMemo, useState } from 'react';
import { money, date as fmtDate } from '@/shared/lib/format';
import { EmptyState } from '@/shared/ui/EmptyState';
import { ESTADO_CHOFER, ESTADO_FLOTA, alertasDocumentos, estadoChofer, liquidarViaticos, textoRuta, type EstadoChofer, type EstadoFlota } from './choferes';
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

  /* «Estado de cada conductor hoy» (12-10-2026, «son muchos choferes»): en vez de
     una nube de etiquetas, tres grupos —en ruta, de descanso, disponibles— con su
     conteo, cada uno plegable, en una lista compacta de dos o tres columnas, y un
     buscador por nombre. Lo que importa (quién está en la vía y con qué viaje)
     va arriba; los disponibles, que son la mayoría, se despliegan si hace falta. */
  const [busca, setBusca] = useState('');
  const [plegados, setPlegados] = useState<Set<EstadoChofer>>(() => new Set(activos.length > 12 ? ['disponible'] : []));
  const grupos = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const viajeDe = new Map(enRuta.map((v) => [v.chofer_id, v]));
    const m: Record<EstadoChofer, typeof activos> = { en_ruta: [], descanso: [], disponible: [], inactivo: [] };
    for (const c of activos) {
      if (q && !nombreConductor(c).toLowerCase().includes(q)) continue;
      m[estadoChofer({ activo: c.activo, enRuta: enRutaIds.has(c.id), deDescanso: descansoHoy.has(c.personal_id) })].push(c);
    }
    for (const k of Object.keys(m) as EstadoChofer[]) m[k].sort((a, b) => nombreConductor(a).localeCompare(nombreConductor(b)));
    return { m, viajeDe };
  }, [activos, busca, enRuta, enRutaIds, descansoHoy]);
  const togglePlegado = (k: EstadoChofer) => setPlegados((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

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

        <div className="card" style={{ gridColumn: activos.length > 12 ? '1 / -1' : undefined }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
            👥 Estado de cada conductor hoy <span className="muted" style={{ fontWeight: 400 }}>· {activos.length} activos</span>
            {activos.length > 6 && (
              <input className="input" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔍 Buscar conductor…"
                style={{ marginLeft: 'auto', maxWidth: 240, fontSize: '.82rem', padding: '.25rem .5rem' }} aria-label="Buscar conductor" />
            )}
          </div>
          {!activos.length ? <EmptyState icon="🪪" message="Todavía no hay conductores con expediente. Ábrelos en «Expediente y flota»." /> : (
            <div style={{ display: 'grid', gap: '.5rem' }}>
              {(['en_ruta', 'descanso', 'disponible'] as EstadoChofer[]).map((k) => {
                const e = ESTADO_CHOFER[k];
                const lista = grupos.m[k];
                const abierto = !plegados.has(k) || !!busca.trim();
                return (
                  <div key={k} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '.4rem .6rem' }}>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => togglePlegado(k)} aria-expanded={abierto}
                      style={{ width: '100%', justifyContent: 'flex-start', gap: '.5rem', padding: '.15rem .2rem' }}>
                      <span className={`badge ${e.clase}`}>{e.icon} {e.label}</span>
                      <strong>{lista.length}</strong>
                      <span className="muted" style={{ marginLeft: 'auto', fontSize: '.78rem' }}>{abierto ? '▴ ocultar' : '▾ ver'}</span>
                    </button>
                    {abierto && (lista.length
                      ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '.15rem .8rem', marginTop: '.3rem', fontSize: '.82rem' }}>
                          {lista.map((c) => {
                            const v = k === 'en_ruta' ? grupos.viajeDe.get(c.id) : null;
                            return (
                              <div key={c.id} style={{ display: 'flex', gap: '.35rem', alignItems: 'baseline', minWidth: 0, padding: '.1rem 0', borderBottom: '1px dashed var(--border)' }}
                                title={v ? `${v.numero} · ${textoRuta(v)}` : e.label}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombreConductor(c)}</span>
                                {v && <span className="muted mono" style={{ fontSize: '.7rem', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{v.numero}</span>}
                              </div>
                            );
                          })}
                        </div>
                      )
                      : <div className="muted" style={{ fontSize: '.78rem', marginTop: '.2rem' }}>{busca.trim() ? 'Nadie con ese nombre en este grupo.' : 'Nadie.'}</div>)}
                  </div>
                );
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
