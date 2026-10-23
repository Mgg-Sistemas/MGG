/* ============================================================
   MGG · Choferes / Conductores · Nómina de viajes (planilla)

   Formato de la planilla de viajes:
   FECHA | NOMBRE Y APELLIDO | NÓMINA FIJA | VEHÍCULO | EQUIPO / MOVIMIENTO |
   PROVIENE | DESTINO | CANTIDAD VIAJES | MONTO | TOTAL A PAGAR | OBSERVACIONES

   Permite ver de inmediato los viajes pagados vs pendientes,
   y marcar viajes pagados por lote hasta una fecha de corte (ej. hasta el 14).
   ============================================================ */
import { useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { money, date as fmtDate } from '@/shared/lib/format';
import {
  categoriaDeViaje, cantidadViajes, tarifaTotalViaje, infoPagoViaje,
} from './choferes';
import {
  marcarViajesPagadosHastaFecha,
} from './choferes.repository';
import { nombreConductor, type PropsTab } from './ChoferesPage';
import { generarNominaViajesPdf, type GrupoChoferNomina, type FilaNominaViaje } from './nominaViajesPdf';

export function NominaViajesTab({ datos, canWrite, actor, actorName }: PropsTab) {
  const { conductores, flota, viajes, pagos, loading, recargar } = datos;

  const [choferId, setChoferId] = useState('');
  const [empresaFiltro, setEmpresaFiltro] = useState('');
  const [estadoPagoFiltro, setEstadoPagoFiltro] = useState<'' | 'pendientes' | 'pagados'>('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [modalPagarLote, setModalPagarLote] = useState(false);
  const [fechaCorteModal, setFechaCorteModal] = useState('');
  const [fechaPagoModal, setFechaPagoModal] = useState(new Date().toISOString().slice(0, 10));
  const [choferModal, setChoferModal] = useState('');
  const [guardandoPago, setGuardandoPago] = useState(false);

  const porId = useMemo(() => new Map(conductores.map((c) => [c.id, c])), [conductores]);
  const vehPorId = useMemo(() => new Map(flota.map((v) => [v.id, v])), [flota]);
  const pagosMap = useMemo(() => new Map(pagos.map((p) => [p.id, p])), [pagos]);

  // Empresas disponibles en nómina fija
  const empresasDisponibles = useMemo(() => {
    const s = new Set<string>();
    for (const c of conductores) {
      if (c.personal?.empresa) s.add(c.personal.empresa);
      else if (c.empresa_externa) s.add(c.empresa_externa);
    }
    return Array.from(s).sort();
  }, [conductores]);

  // Transformar viajes a la estructura de la nómina
  const filasConDetalle = useMemo(() => {
    return viajes.map((v) => {
      const c = porId.get(v.chofer_id);
      const veh = vehPorId.get(v.vehiculo_id ?? '');
      const nominaFija = c?.personal?.empresa || c?.empresa_externa || (c?.externo ? 'EXTERNO' : 'MGG');
      const vehiculoTxt = veh?.placa || (veh ? `${veh.marca || ''} ${veh.modelo || ''}`.trim() : '—');
      const obs = categoriaDeViaje(v);
      const infoPago = infoPagoViaje(v, pagosMap);
      const fSalida = (v.salida_real_at ?? v.fecha_salida).slice(0, 10);
      const nViajes = cantidadViajes(v.viajes);
      const montoUnit = Number(v.tarifa_usd) || 0;
      const totalPagar = tarifaTotalViaje(v);

      return {
        viaje: v,
        choferId: v.chofer_id,
        fecha: fSalida,
        nombre: nombreConductor(c),
        nominaFija,
        vehiculo: vehiculoTxt,
        movimiento: v.carga || '—',
        proviene: v.origen,
        destino: v.destino,
        viajes: nViajes,
        monto: montoUnit,
        totalPagar,
        observaciones: obs,
        pagado: infoPago.pagado,
        fechaPago: infoPago.fechaPago,
      };
    });
  }, [viajes, porId, vehPorId, pagosMap]);

  // Filtrado
  const filasFiltradas = useMemo(() => {
    return filasConDetalle.filter((f) => {
      if (choferId && f.choferId !== choferId) return false;
      if (empresaFiltro && f.nominaFija !== empresaFiltro) return false;
      if (estadoPagoFiltro === 'pendientes' && f.pagado) return false;
      if (estadoPagoFiltro === 'pagados' && !f.pagado) return false;
      if (fechaHasta && f.fecha > fechaHasta) return false;
      return true;
    });
  }, [filasConDetalle, choferId, empresaFiltro, estadoPagoFiltro, fechaHasta]);

  // Agrupado por chofer para el formato de la planilla
  const gruposPorChofer: GrupoChoferNomina[] = useMemo(() => {
    const map = new Map<string, FilaNominaViaje[]>();
    for (const f of filasFiltradas) {
      if (!map.has(f.choferId)) map.set(f.choferId, []);
      map.get(f.choferId)!.push({
        fecha: f.fecha,
        nombre: f.nombre,
        nominaFija: f.nominaFija,
        vehiculo: f.vehiculo,
        movimiento: f.movimiento,
        proviene: f.proviene,
        destino: f.destino,
        viajes: f.viajes,
        monto: f.monto,
        totalPagar: f.totalPagar,
        observaciones: f.observaciones,
        pagado: f.pagado,
        fechaPago: f.fechaPago,
      });
    }

    const out: GrupoChoferNomina[] = [];
    for (const [cId, rows] of map.entries()) {
      const c = porId.get(cId);
      const totalGeneral = rows.reduce((a, r) => a + r.totalPagar, 0);
      const totalPagado = rows.filter((r) => r.pagado).reduce((a, r) => a + r.totalPagar, 0);
      const totalPendiente = totalGeneral - totalPagado;
      out.push({
        choferId: cId,
        nombre: nombreConductor(c),
        nominaFija: c?.personal?.empresa || c?.empresa_externa || (c?.externo ? 'EXTERNO' : 'MGG'),
        filas: rows.sort((a, b) => a.fecha.localeCompare(b.fecha)),
        totalGeneral,
        totalPagado,
        totalPendiente,
      });
    }
    return out.sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [filasFiltradas, porId]);

  // Totales generales
  const resumenGeneral = useMemo(() => {
    const totalGral = filasFiltradas.reduce((a, f) => a + f.totalPagar, 0);
    const totalPag = filasFiltradas.filter((f) => f.pagado).reduce((a, f) => a + f.totalPagar, 0);
    const totalPend = totalGral - totalPag;
    const totalViajesCont = filasFiltradas.reduce((a, f) => a + f.viajes, 0);
    return { totalGral, totalPag, totalPend, totalViajesCont };
  }, [filasFiltradas]);

  async function exportarPdf() {
    try {
      await generarNominaViajesPdf({
        grupos: gruposPorChofer,
        fechaHasta: fechaHasta || null,
        filtroChofer: choferId ? nombreConductor(porId.get(choferId)) : null,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error');
    }
  }

  function exportarExcel() {
    const encabezados = [
      'FECHA', 'NOMBRE Y APELLIDO', 'NOMINA FIJA', 'VEHICULO', 'EQUIPOS / MOVIMIENTOS',
      'PROVIENE', 'DESTINO', 'CANTIDAD VIAJES', 'MONTO', 'TOTAL A PAGAR', 'OBSERVACIONES', 'ESTADO PAGO',
    ];
    const lineas = [encabezados.join(';')];
    for (const g of gruposPorChofer) {
      for (const f of g.filas) {
        lineas.push([
          f.fecha,
          `"${f.nombre.replace(/"/g, '""')}"`,
          `"${f.nominaFija}"`,
          `"${f.vehiculo}"`,
          `"${f.movimiento.replace(/"/g, '""')}"`,
          `"${f.proviene.replace(/"/g, '""')}"`,
          `"${f.destino.replace(/"/g, '""')}"`,
          f.viajes,
          f.monto.toFixed(2),
          f.totalPagar.toFixed(2),
          `"${f.observaciones}"`,
          `"${f.pagado ? `PAGADO (${f.fechaPago ? fmtDate(f.fechaPago) : ''})` : 'PENDIENTE'}"`,
        ].join(';'));
      }
      lineas.push(['', '', '', '', '', '', 'TOTAL A PAGAR CONDUCTOR', '', '', g.totalGeneral.toFixed(2), `Pagado: ${g.totalPagado.toFixed(2)} | Debe: ${g.totalPendiente.toFixed(2)}`, ''].join(';'));
      lineas.push('');
    }

    const blob = new Blob(['\ufeff' + lineas.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nomina-viajes-choferes-${fechaHasta || 'completa'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function ejecutarMarcarPagados() {
    if (!fechaCorteModal) {
      toast('Indica la fecha de corte (hasta qué fecha se pagaron los viajes)', 'error');
      return;
    }
    setGuardandoPago(true);
    try {
      const res = await marcarViajesPagadosHastaFecha({
        choferId: choferModal || undefined,
        fechaHasta: fechaCorteModal,
        fechaPago: fechaPagoModal,
        actor: actorName || actor,
      });
      toast(`Se marcaron como pagados ${res.actualizados} viaje(s) hasta el ${fmtDate(fechaCorteModal)}`, 'success');
      setModalPagarLote(false);
      await recargar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron actualizar los viajes', 'error');
    } finally {
      setGuardandoPago(false);
    }
  }

  return (
    <div>
      {/* ── Tarjetas de resumen estilo planilla ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.7rem', marginBottom: '1rem' }}>
        <div className="card" style={{ padding: '.75rem .9rem', borderLeft: '4px solid var(--primary)' }}>
          <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>Total a pagar en lo filtrado</div>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--primary)', margin: '.15rem 0' }}>{money(resumenGeneral.totalGral)}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>{resumenGeneral.totalViajesCont} viajes · {gruposPorChofer.length} conductor(es)</div>
        </div>

        <div className="card" style={{ padding: '.75rem .9rem', borderLeft: '4px solid var(--success)' }}>
          <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>Total ya pagado</div>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--success)', margin: '.15rem 0' }}>{money(resumenGeneral.totalPag)}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>registrados como saldados</div>
        </div>

        <div className="card" style={{ padding: '.75rem .9rem', borderLeft: '4px solid var(--danger)' }}>
          <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>Pendiente por pagar</div>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: resumenGeneral.totalPend > 0 ? 'var(--danger)' : 'var(--success)', margin: '.15rem 0' }}>{money(resumenGeneral.totalPend)}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>{resumenGeneral.totalPend > 0 ? 'por liquidar a conductores' : 'todo al día'}</div>
        </div>
      </div>

      {/* ── Filtros y Acciones ── */}
      <div className="card" style={{ padding: '.7rem .85rem', marginBottom: '.9rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'flex-end' }}>
          <div className="form-row" style={{ flex: '1 1 200px', margin: 0 }}>
            <label>Conductor</label>
            <select className="select" value={choferId} onChange={(e) => setChoferId(e.target.value)}>
              <option value="">— Todos los conductores —</option>
              {conductores.map((c) => <option key={c.id} value={c.id}>{nombreConductor(c)}</option>)}
            </select>
          </div>

          <div className="form-row" style={{ flex: '0 1 150px', margin: 0 }}>
            <label>Nómina fija</label>
            <select className="select" value={empresaFiltro} onChange={(e) => setEmpresaFiltro(e.target.value)}>
              <option value="">Todas</option>
              {empresasDisponibles.map((emp) => <option key={emp} value={emp}>{emp}</option>)}
            </select>
          </div>

          <div className="form-row" style={{ flex: '0 1 160px', margin: 0 }}>
            <label>Estado de pago</label>
            <select className="select" value={estadoPagoFiltro} onChange={(e) => setEstadoPagoFiltro(e.target.value as typeof estadoPagoFiltro)}>
              <option value="">Todos los viajes</option>
              <option value="pendientes">⏳ Solo pendientes</option>
              <option value="pagados">✅ Solo pagados</option>
            </select>
          </div>

          <div className="form-row" style={{ flex: '0 1 160px', margin: 0 }}>
            <label>Viajes hasta (corte)</label>
            <input className="input" type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
          </div>

          {fechaHasta && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFechaHasta('')} title="Quitar fecha límite">✕ Quitar corte</button>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
            {canWrite && (
              <button className="btn btn-sm btn-primary" onClick={() => {
                setFechaCorteModal(fechaHasta || new Date().toISOString().slice(0, 10));
                setChoferModal(choferId);
                setModalPagarLote(true);
              }} title="Marcar como pagados todos los viajes hasta una fecha determinada (ej. hasta el 14)">
                ✔ Marcar pagados hasta fecha…
              </button>
            )}
            <button className="btn btn-sm btn-ghost" onClick={() => void exportarPdf()} disabled={!filasFiltradas.length}>
              🖨 Imprimir Nómina PDF
            </button>
            <button className="btn btn-sm btn-ghost" onClick={exportarExcel} disabled={!filasFiltradas.length}>
              📊 Exportar a Excel
            </button>
          </div>
        </div>
      </div>

      {loading && <div className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Cargando nómina de viajes…</div>}
      {!loading && !gruposPorChofer.length && (
        <EmptyState icon="📋" message="No hay viajes registrados que coincidan con los filtros." />
      )}

      {/* ── Formato visual idéntico a la planilla física ── */}
      {!loading && gruposPorChofer.map((g) => (
        <div key={g.choferId} className="card" style={{ padding: 0, marginBottom: '1.2rem', overflow: 'hidden', border: '1px solid var(--border)' }}>
          {/* Cabecera del conductor */}
          <div style={{ background: '#182b49', color: '#fff', padding: '.6rem .9rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
            <div>
              <strong style={{ fontSize: '.95rem', letterSpacing: '.03em' }}>{g.nombre.toUpperCase()}</strong>
              <span style={{ marginLeft: '.6rem', fontSize: '.8rem', opacity: .85 }}>NÓMINA FIJA: <strong>{g.nominaFija}</strong></span>
            </div>
            <div className="mono" style={{ fontSize: '.88rem' }}>
              {g.filas.length} registro(s) · {g.filas.reduce((a, f) => a + f.viajes, 0)} viajes
            </div>
          </div>

          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.84rem', margin: 0 }}>
              <thead>
                <tr style={{ background: '#243a5e', color: '#fff' }}>
                  <th style={{ width: 85, color: '#fff' }}>FECHA</th>
                  <th style={{ color: '#fff' }}>NOMBRE Y APELLIDO</th>
                  <th style={{ width: 95, color: '#fff' }}>NÓMINA FIJA</th>
                  <th style={{ width: 95, color: '#fff' }}>VEHÍCULO</th>
                  <th style={{ color: '#fff' }}>EQUIPOS / MOVIMIENTOS</th>
                  <th style={{ color: '#fff' }}>PROVIENE</th>
                  <th style={{ color: '#fff' }}>DESTINO</th>
                  <th style={{ textAlign: 'center', width: 65, color: '#fff' }}>VIAJES</th>
                  <th style={{ textAlign: 'right', width: 80, color: '#fff' }}>MONTO</th>
                  <th style={{ textAlign: 'right', width: 95, color: '#fff' }}>TOTAL A PAGAR</th>
                  <th style={{ width: 140, color: '#fff' }}>OBSERVACIONES</th>
                  <th style={{ textAlign: 'center', width: 110, color: '#fff' }}>ESTADO PAGO</th>
                </tr>
              </thead>
              <tbody>
                {g.filas.map((f, idx) => (
                  <tr key={idx} style={{ background: f.pagado ? 'rgba(40, 150, 90, 0.04)' : undefined }}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDate(f.fecha)}</td>
                    <td style={{ fontWeight: 600 }}>{f.nombre}</td>
                    <td className="muted">{f.nominaFija}</td>
                    <td className="mono">{f.vehiculo}</td>
                    <td>{f.movimiento}</td>
                    <td className="muted">{f.proviene}</td>
                    <td className="muted">{f.destino}</td>
                    <td className="mono" style={{ textAlign: 'center', fontWeight: 700 }}>{f.viajes}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(f.monto)}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--primary)' }}>{money(f.totalPagar)}</td>
                    <td>
                      <span className={`badge ${f.observaciones === 'VIAJE INTERNO' ? 'warning' : f.observaciones === 'VIAJE LARGO' ? 'info' : 'primary'}`}>
                        {f.observaciones}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {f.pagado ? (
                        <span className="badge success" title={`Pagado el ${f.fechaPago ? fmtDate(f.fechaPago) : ''}`}>
                          ✅ Pagado{f.fechaPago ? ` (${f.fechaPago.slice(8, 10)}/${f.fechaPago.slice(5, 7)})` : ''}
                        </span>
                      ) : (
                        <span className="badge warning">⏳ Por pagar</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Celda dorada/naranja idéntica a la planilla física */}
              <tfoot>
                <tr style={{ background: '#162232', borderTop: '2px solid rgba(255, 138, 0, 0.45)' }}>
                  <td colSpan={7} style={{ textAlign: 'right', fontWeight: 700, textTransform: 'uppercase', fontSize: '.82rem', letterSpacing: '.05em', color: 'var(--text-muted)' }}>
                    TOTAL A PAGAR {g.nombre.toUpperCase()}
                  </td>
                  <td className="mono" style={{ textAlign: 'center', fontWeight: 800, fontSize: '.92rem', color: 'var(--text)' }}>
                    {g.filas.reduce((a, f) => a + f.viajes, 0)}
                  </td>
                  <td></td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 800, fontSize: '1.05rem', color: 'var(--primary)' }}>
                    {money(g.totalGeneral)}
                  </td>
                  <td colSpan={2} style={{ fontSize: '.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    <span>Pagado: <strong className="mono" style={{ color: 'var(--text)' }}>{money(g.totalPagado)}</strong></span>
                    <span style={{ margin: '0 .45rem', opacity: .4 }}>·</span>
                    <span>Pendiente: <strong className="mono" style={{ color: g.totalPendiente > 0 ? 'var(--danger)' : 'var(--success)' }}>{money(g.totalPendiente)}</strong></span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ))}

      {/* ── Modal Marcar Pagados hasta Fecha ── */}
      {modalPagarLote && (
        <Modal title="✔ Marcar viajes pagados por lote" size="md" onClose={() => setModalPagarLote(false)} footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModalPagarLote(false)} disabled={guardandoPago}>Cancelar</button>
            <button className="btn btn-primary" onClick={() => void ejecutarMarcarPagados()} disabled={guardandoPago || !fechaCorteModal}>
              {guardandoPago ? 'Guardando…' : 'Confirmar pago de viajes'}
            </button>
          </>
        }>
          <div style={{ fontSize: '.88rem', marginBottom: '.8rem', lineHeight: 1.5 }}>
            Permite registrar que se pagaron todos los viajes finalizados hasta una fecha de corte (por ejemplo: <strong>«se pagaron todos los viajes hasta la fecha del 14»</strong>).
          </div>

          <div className="form-grid">
            <div className="form-row" style={{ gridColumn: '1 / -1' }}>
              <label>Conductor a saldar</label>
              <select className="select" value={choferModal} onChange={(e) => setChoferModal(e.target.value)}>
                <option value="">— Todos los conductores —</option>
                {conductores.map((c) => <option key={c.id} value={c.id}>{nombreConductor(c)}</option>)}
              </select>
            </div>

            <div className="form-row">
              <label>Fecha de corte (viajes hasta)</label>
              <input className="input" type="date" value={fechaCorteModal} onChange={(e) => setFechaCorteModal(e.target.value)} required />
              <small className="hint muted">Todos los viajes realizados hasta esta fecha quedarán marcados como pagados.</small>
            </div>

            <div className="form-row">
              <label>Fecha en que se efectuó el pago</label>
              <input className="input" type="date" value={fechaPagoModal} onChange={(e) => setFechaPagoModal(e.target.value)} required />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
