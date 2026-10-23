/* ============================================================
   MGG · Choferes / Conductores · Nómina de viajes (planilla)

   Formato de la planilla de viajes:
   FECHA | NOMBRE Y APELLIDO | NÓMINA FIJA | VEHÍCULO | EQUIPO / MOVIMIENTO |
   PROVIENE | DESTINO | CANTIDAD VIAJES | MONTO | TOTAL A PAGAR | OBSERVACIONES

   Permite ver de inmediato los viajes pagados vs pendientes,
   y marcar viajes pagados por lote hasta una fecha de corte (ej. hasta el 14).
   ============================================================ */
import { useMemo, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { money, date as fmtDate } from '@/shared/lib/format';
import {
  categoriaDeViaje, cantidadViajes, tarifaTotalViaje, infoPagoViaje,
} from './choferes';
import {
  eliminarViaje, marcarViajesPagadosHastaFecha, type Viaje,
} from './choferes.repository';
import { nombreConductor, type PropsTab } from './ChoferesPage';
import { generarNominaViajesPdf, type GrupoChoferNomina, type FilaNominaViaje } from './nominaViajesPdf';
import { generarReciboPagoViajesPdf } from './reciboPagoViajesPdf';
import { ViajeModal, DetalleViajeModal, AccionViajeModal } from './ViajesTab';

export function NominaViajesTab({ datos, canWrite, actor, actorName }: PropsTab) {
  const { conductores, flota, viajes, pagos, loading, recargar } = datos;

  const [choferId, setChoferId] = useState('');
  const [empresaFiltro, setEmpresaFiltro] = useState('');
  const [estadoPagoFiltro, setEstadoPagoFiltro] = useState<'' | 'pendientes' | 'pagados'>('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [busquedaTexto, setBusquedaTexto] = useState('');
  const [modalPagarLote, setModalPagarLote] = useState(false);
  const [fechaDesdeModal, setFechaDesdeModal] = useState('');
  const [fechaCorteModal, setFechaCorteModal] = useState('');
  const [fechaPagoModal, setFechaPagoModal] = useState(new Date().toISOString().slice(0, 10));
  const [choferModal, setChoferModal] = useState('');
  const [guardandoPago, setGuardandoPago] = useState(false);

  // Modales operativos de viaje unificados en Nómina de viajes
  const [formViaje, setFormViaje] = useState<Viaje | 'nuevo' | null>(null);
  const [detalleViaje, setDetalleViaje] = useState<Viaje | null>(null);
  const [accionViaje, setAccionViaje] = useState<{ tipo: 'iniciar' | 'finalizar' | 'cancelar'; viaje: Viaje } | null>(null);
  const [borrarViaje, setBorrarViaje] = useState<Viaje | null>(null);

  // Conductores desplegados (por defecto sin mostrar los detalles)
  const [desplegados, setDesplegados] = useState<Record<string, boolean>>({});

  const toggleDesplegar = (id: string) => {
    setDesplegados((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const desplegarTodos = () => {
    const todos: Record<string, boolean> = {};
    gruposPorChofer.forEach((g) => { todos[g.choferId] = true; });
    setDesplegados(todos);
  };

  const colapsarTodos = () => {
    setDesplegados({});
  };

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
    const q = busquedaTexto.trim().toLowerCase();
    return filasConDetalle.filter((f) => {
      if (choferId && f.choferId !== choferId) return false;
      if (empresaFiltro && f.nominaFija !== empresaFiltro) return false;
      if (estadoPagoFiltro === 'pendientes' && f.pagado) return false;
      if (estadoPagoFiltro === 'pagados' && !f.pagado) return false;
      if (fechaHasta && f.fecha > fechaHasta) return false;
      if (q) {
        const txt = `${f.nombre} ${f.nominaFija} ${f.vehiculo} ${f.movimiento} ${f.proviene} ${f.destino} ${f.observaciones} ${f.viaje.numero}`.toLowerCase();
        if (!txt.includes(q)) return false;
      }
      return true;
    });
  }, [filasConDetalle, choferId, empresaFiltro, estadoPagoFiltro, fechaHasta, busquedaTexto]);

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
        viaje: f.viaje,
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

  async function exportarReciboIndividual(g: GrupoChoferNomina) {
    try {
      await generarReciboPagoViajesPdf({
        grupos: [g],
        fechaDesde: fechaDesdeModal || undefined,
        fechaHasta: fechaHasta || undefined,
        fechaPago: fechaPagoModal,
        conductoresMap: porId,
        flotaMap: vehPorId,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el recibo de pago', 'error');
    }
  }

  async function exportarRecibosLote() {
    if (!gruposPorChofer.length) {
      toast('No hay viajes en el listado para generar recibos', 'error');
      return;
    }
    try {
      await generarReciboPagoViajesPdf({
        grupos: gruposPorChofer,
        fechaDesde: fechaDesdeModal || undefined,
        fechaHasta: fechaHasta || undefined,
        fechaPago: fechaPagoModal,
        conductoresMap: porId,
        flotaMap: vehPorId,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron generar los recibos en lote', 'error');
    }
  }

  const viajesACerrar = useMemo(() => {
    if (!modalPagarLote) return [];
    return filasConDetalle.filter((f) => {
      if (choferModal && f.choferId !== choferModal) return false;
      if (fechaDesdeModal && f.fecha < fechaDesdeModal) return false;
      if (fechaCorteModal && f.fecha > fechaCorteModal) return false;
      return !f.pagado;
    });
  }, [modalPagarLote, filasConDetalle, choferModal, fechaDesdeModal, fechaCorteModal]);

  async function ejecutarMarcarPagados() {
    if (!fechaCorteModal) {
      toast('Indica la fecha de corte (hasta qué fecha se liquidan los viajes)', 'error');
      return;
    }
    setGuardandoPago(true);
    try {
      const res = await marcarViajesPagadosHastaFecha({
        choferId: choferModal || undefined,
        fechaDesde: fechaDesdeModal || undefined,
        fechaHasta: fechaCorteModal,
        fechaPago: fechaPagoModal,
        actor: actorName || actor,
      });
      toast(`Cierre de nómina completado: se liquidaron ${res.actualizados} viaje(s)`, 'success');
      setModalPagarLote(false);
      await recargar();

      // Al cerrar nómina, emitir el recibo de pago si se liquidaron viajes
      if (res.actualizados > 0) {
        const gruposAImprimir = choferModal
          ? gruposPorChofer.filter((g) => g.choferId === choferModal)
          : gruposPorChofer;
        if (gruposAImprimir.length > 0) {
          void generarReciboPagoViajesPdf({
            grupos: gruposAImprimir,
            fechaDesde: fechaDesdeModal || undefined,
            fechaHasta: fechaCorteModal,
            fechaPago: fechaPagoModal,
            conductoresMap: porId,
            flotaMap: vehPorId,
          });
        }
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron liquidar los viajes', 'error');
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
          <div className="form-row" style={{ flex: '1 1 180px', margin: 0 }}>
            <label>Buscar</label>
            <input
              className="input"
              placeholder="🔍 Chofer, ruta, placa, carga…"
              value={busquedaTexto}
              onChange={(e) => setBusquedaTexto(e.target.value)}
            />
          </div>

          <div className="form-row" style={{ flex: '1 1 180px', margin: 0 }}>
            <label>Conductor</label>
            <select className="select" value={choferId} onChange={(e) => setChoferId(e.target.value)}>
              <option value="">— Todos los conductores —</option>
              {conductores.map((c) => <option key={c.id} value={c.id}>{nombreConductor(c)}</option>)}
            </select>
          </div>

          <div className="form-row" style={{ flex: '0 1 140px', margin: 0 }}>
            <label>Nómina fija</label>
            <select className="select" value={empresaFiltro} onChange={(e) => setEmpresaFiltro(e.target.value)}>
              <option value="">Todas</option>
              {empresasDisponibles.map((emp) => <option key={emp} value={emp}>{emp}</option>)}
            </select>
          </div>

          <div className="form-row" style={{ flex: '0 1 150px', margin: 0 }}>
            <label>Estado de pago</label>
            <select className="select" value={estadoPagoFiltro} onChange={(e) => setEstadoPagoFiltro(e.target.value as typeof estadoPagoFiltro)}>
              <option value="">Todos los viajes</option>
              <option value="pendientes">⏳ Solo pendientes</option>
              <option value="pagados">✅ Solo pagados</option>
            </select>
          </div>

          <div className="form-row" style={{ flex: '0 1 150px', margin: 0 }}>
            <label>Viajes hasta (corte)</label>
            <input className="input" type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
          </div>

          {fechaHasta && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFechaHasta('')} title="Quitar fecha límite">✕ Quitar corte</button>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
            {canWrite && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => setFormViaje('nuevo')}
                disabled={!conductores.some((c) => c.activo)}
                title="Programar una nueva orden de ruta o registrar un viaje ya realizado"
              >
                + Orden de ruta
              </button>
            )}
            {gruposPorChofer.length > 0 && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={Object.values(desplegados).filter(Boolean).length === gruposPorChofer.length ? colapsarTodos : desplegarTodos}
                title="Desplegar u ocultar los viajes de todos los conductores"
              >
                {Object.values(desplegados).filter(Boolean).length === gruposPorChofer.length ? '▴ Colapsar todos' : '▾ Desplegar todos'}
              </button>
            )}
            {canWrite && (
              <button className="btn btn-sm btn-primary" onClick={() => {
                setFechaDesdeModal('');
                setFechaCorteModal(fechaHasta || new Date().toISOString().slice(0, 10));
                setChoferModal(choferId);
                setModalPagarLote(true);
              }} title="Cerrar la nómina de viajes por rango de fecha para que queden saldados y generar recibo de pago">
                🔒 Cierre de Nómina…
              </button>
            )}
            <button className="btn btn-sm btn-ghost" onClick={() => void exportarRecibosLote()} disabled={!filasFiltradas.length} title="Imprimir recibos de pago en lote para firma del chofer">
              🧾 Recibos de Pago (Lote)
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => void exportarPdf()} disabled={!filasFiltradas.length}>
              🖨 Planilla PDF
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

      {/* ── Formato visual: Lista desplegable por conductor ── */}
      {!loading && gruposPorChofer.map((g) => {
        const abierto = !!desplegados[g.choferId];
        const totalViajesChofer = g.filas.reduce((a, f) => a + f.viajes, 0);

        // Vehículos únicos utilizados por este conductor
        const vehiculosSet = new Set<string>();
        g.filas.forEach((f) => {
          const v = (f.vehiculo || '').trim();
          if (v && v !== '—') vehiculosSet.add(v);
        });
        const listaVehiculos = Array.from(vehiculosSet);

        const nLargos = g.filas.filter(f => f.observaciones === 'VIAJE LARGO').reduce((a, f) => a + f.viajes, 0);
        const nCortos = g.filas.filter(f => f.observaciones === 'VIAJE CORTO').reduce((a, f) => a + f.viajes, 0);
        const nInternos = g.filas.filter(f => f.observaciones === 'VIAJE INTERNO').reduce((a, f) => a + f.viajes, 0);

        return (
          <div key={g.choferId} className="card" style={{ padding: 0, marginBottom: '.85rem', overflow: 'hidden', border: '1px solid var(--border)' }}>
            {/* Barra desplegable del conductor */}
            <div
              onClick={() => toggleDesplegar(g.choferId)}
              style={{
                background: abierto ? '#182b49' : '#131b26',
                color: '#fff',
                padding: '.75rem 1rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '.7rem',
                cursor: 'pointer',
                userSelect: 'none',
                borderBottom: abierto ? '1px solid rgba(255, 138, 0, 0.35)' : 'none',
                transition: 'background .15s ease',
              }}
              title={abierto ? 'Clic para ocultar detalle de rutas y precios' : 'Clic para desplegar detalle de rutas y precios'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '.9rem', color: 'var(--primary)', display: 'inline-block', transform: abierto ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' }}>
                  ▶
                </span>
                <strong style={{ fontSize: '.95rem', letterSpacing: '.03em', color: '#fff' }}>{g.nombre.toUpperCase()}</strong>
                <span style={{ fontSize: '.76rem', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', padding: '.15rem .5rem', borderRadius: '4px', color: '#cbd5e1' }}>
                  NÓMINA FIJA: <strong>{g.nominaFija}</strong>
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '.85rem', flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: '.84rem', color: 'var(--text-muted)' }}>
                  {totalViajesChofer} viajes · {g.filas.length} reg.
                </span>
                <span className="mono" style={{ fontSize: '.88rem', color: 'var(--primary)', fontWeight: 700 }}>
                  Total: {money(g.totalGeneral)}
                </span>
                <span className="mono" style={{ fontSize: '.84rem', color: g.totalPendiente > 0 ? '#ff7b7b' : '#69db7c' }}>
                  Pendiente: {money(g.totalPendiente)}
                </span>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    void exportarReciboIndividual(g);
                  }}
                  style={{ color: '#fff', border: '1px solid rgba(255,255,255,0.3)', padding: '.2rem .55rem' }}
                  title="Imprimir recibo de pago para firma de este conductor"
                >
                  🧾 Recibo de pago
                </button>
                <span
                  className="btn btn-xs btn-primary"
                  style={{ pointerEvents: 'none' }}
                >
                  {abierto ? 'Ocultar ▲' : 'Desplegar rutas ▼'}
                </span>
              </div>
            </div>

            {/* Detalles de rutas, precios y vehículos (solo al desplegar) */}
            {abierto && (
              <div>
                {/* Franja de resumen de vehículo y tipos de viaje */}
                <div style={{ background: '#0e1622', padding: '.55rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.6rem', fontSize: '.8rem', color: 'var(--text-muted)' }}>
                  <div>
                    {listaVehiculos.length === 1 ? (
                      <span>🚗 Vehículo asignado: <strong className="mono" style={{ color: 'var(--text)' }}>{listaVehiculos[0]}</strong></span>
                    ) : listaVehiculos.length > 1 ? (
                      <span>🚗 Vehículos utilizados ({listaVehiculos.length}): <strong className="mono" style={{ color: 'var(--text)' }}>{listaVehiculos.join(', ')}</strong></span>
                    ) : (
                      <span>🚗 Vehículo: <em>Sin vehículo registrado</em></span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '.85rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span>Largos: <strong className="mono" style={{ color: 'var(--text)' }}>{nLargos}</strong></span>
                    <span>Cortos: <strong className="mono" style={{ color: 'var(--text)' }}>{nCortos}</strong></span>
                    <span>Internos: <strong className="mono" style={{ color: 'var(--text)' }}>{nInternos}</strong></span>
                    <button
                      type="button"
                      className="btn btn-xs btn-ghost"
                      onClick={() => void exportarReciboIndividual(g)}
                      style={{ padding: '.15rem .5rem', fontSize: '.76rem', color: 'var(--primary)', borderColor: 'var(--primary)' }}
                      title="Imprimir recibo de pago para este conductor"
                    >
                      🧾 Recibo de Pago
                    </button>
                  </div>
                </div>

                <div className="table-wrap">
                  <table className="table" style={{ fontSize: '.84rem', margin: 0 }}>
                    <thead>
                      <tr style={{ background: '#243a5e', color: '#fff' }}>
                        <th style={{ width: 85, color: '#fff' }}>FECHA</th>
                        <th style={{ width: 95, color: '#fff' }}>VEHÍCULO</th>
                        <th style={{ color: '#fff' }}>EQUIPOS / MOVIMIENTO</th>
                        <th style={{ color: '#fff' }}>ORIGEN (PROVIENE)</th>
                        <th style={{ color: '#fff' }}>DESTINO</th>
                        <th style={{ textAlign: 'center', width: 65, color: '#fff' }}>VIAJES</th>
                        <th style={{ textAlign: 'right', width: 85, color: '#fff' }}>PRECIO ($)</th>
                        <th style={{ textAlign: 'right', width: 100, color: '#fff' }}>TOTAL A PAGAR</th>
                        <th style={{ width: 135, color: '#fff' }}>TIPO DE VIAJE</th>
                        <th style={{ textAlign: 'center', width: 110, color: '#fff' }}>ESTADO PAGO</th>
                        <th style={{ textAlign: 'center', width: 115, color: '#fff' }}>ACCIONES</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.filas.map((f, idx) => (
                        <tr key={idx} style={{ background: f.pagado ? 'rgba(40, 150, 90, 0.04)' : undefined }}>
                          <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDate(f.fecha)}</td>
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
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {f.viaje && (
                              <button
                                type="button"
                                className="btn btn-xs btn-ghost"
                                onClick={() => setDetalleViaje(f.viaje)}
                                title="Ver detalles, paradas y horas del viaje"
                                style={{ padding: '.12rem .35rem' }}
                              >
                                👁
                              </button>
                            )}
                            {canWrite && f.viaje && !f.pagado && (
                              <button
                                type="button"
                                className="btn btn-xs btn-ghost"
                                onClick={() => setFormViaje(f.viaje)}
                                title="Editar viaje"
                                style={{ padding: '.12rem .35rem' }}
                              >
                                ✎
                              </button>
                            )}
                            {canWrite && f.viaje && f.viaje.estado === 'programado' && (
                              <button
                                type="button"
                                className="btn btn-xs btn-primary"
                                onClick={() => setAccionViaje({ tipo: 'iniciar', viaje: f.viaje })}
                                title="Iniciar ruta (marcar salida)"
                                style={{ padding: '.12rem .35rem' }}
                              >
                                ▶
                              </button>
                            )}
                            {canWrite && f.viaje && f.viaje.estado === 'en_ruta' && (
                              <button
                                type="button"
                                className="btn btn-xs btn-success"
                                onClick={() => setAccionViaje({ tipo: 'finalizar', viaje: f.viaje })}
                                title="Finalizar ruta (marcar llegada)"
                                style={{ padding: '.12rem .35rem' }}
                              >
                                🏁
                              </button>
                            )}
                            {canWrite && f.viaje && !f.pagado && (
                              <button
                                type="button"
                                className="btn btn-xs btn-ghost"
                                style={{ color: 'var(--danger)', padding: '.12rem .35rem' }}
                                onClick={() => setBorrarViaje(f.viaje)}
                                title="Eliminar viaje"
                              >
                                🗑
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {/* Celda de totales armonizada */}
                    <tfoot>
                      <tr style={{ background: '#162232', borderTop: '2px solid rgba(255, 138, 0, 0.45)' }}>
                        <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700, textTransform: 'uppercase', fontSize: '.82rem', letterSpacing: '.05em', color: 'var(--text-muted)' }}>
                          TOTAL A PAGAR {g.nombre.toUpperCase()}
                        </td>
                        <td className="mono" style={{ textAlign: 'center', fontWeight: 800, fontSize: '.92rem', color: 'var(--text)' }}>
                          {g.filas.reduce((a, f) => a + f.viajes, 0)}
                        </td>
                        <td></td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 800, fontSize: '1.05rem', color: 'var(--primary)' }}>
                          {money(g.totalGeneral)}
                        </td>
                        <td colSpan={3} style={{ fontSize: '.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          <span>Pagado: <strong className="mono" style={{ color: 'var(--text)' }}>{money(g.totalPagado)}</strong></span>
                          <span style={{ margin: '0 .45rem', opacity: .4 }}>·</span>
                          <span>Pendiente: <strong className="mono" style={{ color: g.totalPendiente > 0 ? 'var(--danger)' : 'var(--success)' }}>{money(g.totalPendiente)}</strong></span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* ── Modal Cierre de Nómina de Viajes ── */}
      {modalPagarLote && (
        <Modal title="🔒 Cierre de Nómina de Viajes" size="md" onClose={() => setModalPagarLote(false)} footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModalPagarLote(false)} disabled={guardandoPago}>Cancelar</button>
            <button className="btn btn-primary" onClick={() => void ejecutarMarcarPagados()} disabled={guardandoPago || !fechaCorteModal}>
              {guardandoPago ? 'Procesando cierre…' : 'Confirmar Cierre de Nómina'}
            </button>
          </>
        }>
          <div style={{ fontSize: '.88rem', marginBottom: '.8rem', lineHeight: 1.5 }}>
            Establece el rango de fechas para el cierre de nómina de viajes. Al confirmar, los viajes pendientes en este rango quedarán marcados como pagados y se generará el recibo de pago para la firma del chofer.
          </div>

          <div className="form-grid">
            <div className="form-row" style={{ gridColumn: '1 / -1' }}>
              <label>Conductor</label>
              <select className="select" value={choferModal} onChange={(e) => setChoferModal(e.target.value)}>
                <option value="">— Todos los conductores (Cierre por lote) —</option>
                {conductores.map((c) => <option key={c.id} value={c.id}>{nombreConductor(c)}</option>)}
              </select>
            </div>

            <div className="form-row">
              <label>Fecha desde (inicio corte)</label>
              <input className="input" type="date" value={fechaDesdeModal} onChange={(e) => setFechaDesdeModal(e.target.value)} />
              <small className="hint muted">Opcional. Vacío = desde los más antiguos.</small>
            </div>

            <div className="form-row">
              <label>Fecha hasta (fin corte) *</label>
              <input className="input" type="date" value={fechaCorteModal} onChange={(e) => setFechaCorteModal(e.target.value)} required />
              <small className="hint muted">Límite de viajes que entran al cierre.</small>
            </div>

            <div className="form-row" style={{ gridColumn: '1 / -1' }}>
              <label>Fecha de pago</label>
              <input className="input" type="date" value={fechaPagoModal} onChange={(e) => setFechaPagoModal(e.target.value)} required />
            </div>
          </div>

          {/* Resumen en tiempo real del corte */}
          <div style={{ marginTop: '.85rem', padding: '.75rem .9rem', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: '.35rem' }}>
              Resumen de viajes pendientes a liquidar en este corte:
            </div>
            <div style={{ display: 'flex', gap: '.9rem', flexWrap: 'wrap', fontSize: '.82rem' }}>
              <span>Total: <strong className="mono" style={{ color: 'var(--primary)' }}>{viajesACerrar.reduce((a, f) => a + f.viajes, 0)} viajes</strong> ({viajesACerrar.length} reg.)</span>
              <span>Largos: <strong className="mono">{viajesACerrar.filter(f => f.observaciones === 'VIAJE LARGO').reduce((a, f) => a + f.viajes, 0)}</strong></span>
              <span>Cortos: <strong className="mono">{viajesACerrar.filter(f => f.observaciones === 'VIAJE CORTO').reduce((a, f) => a + f.viajes, 0)}</strong></span>
              <span>Internos: <strong className="mono">{viajesACerrar.filter(f => f.observaciones === 'VIAJE INTERNO').reduce((a, f) => a + f.viajes, 0)}</strong></span>
              <span>Monto total: <strong className="mono" style={{ color: 'var(--primary)', fontSize: '.95rem' }}>{money(viajesACerrar.reduce((a, f) => a + f.totalPagar, 0))}</strong></span>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Modales operativos integrados de viaje ── */}
      {formViaje && (
        <ViajeModal
          inicial={formViaje === 'nuevo' ? null : formViaje}
          conductores={conductores}
          flota={flota}
          viajes={viajes}
          descansos={datos.descansos}
          hoy={datos.hoy}
          canWrite={canWrite}
          actor={actor}
          actorName={actorName}
          onClose={() => setFormViaje(null)}
          onSaved={async () => {
            setFormViaje(null);
            await recargar();
          }}
        />
      )}

      {detalleViaje && (
        <DetalleViajeModal
          viaje={viajes.find((x) => x.id === detalleViaje.id) ?? detalleViaje}
          conductor={porId.get(detalleViaje.chofer_id)}
          vehiculo={vehPorId.get(detalleViaje.vehiculo_id ?? '')}
          canWrite={canWrite}
          onClose={() => setDetalleViaje(null)}
          onChanged={recargar}
        />
      )}

      {accionViaje && (
        <AccionViajeModal
          accion={accionViaje.tipo}
          viaje={accionViaje.viaje}
          conductor={porId.get(accionViaje.viaje.chofer_id)}
          onClose={() => setAccionViaje(null)}
          onDone={async () => {
            setAccionViaje(null);
            await recargar();
          }}
        />
      )}

      {borrarViaje && (
        <ConfirmDialog
          title={`Eliminar viaje ${borrarViaje.numero}`}
          danger
          confirmText="Sí, eliminar"
          message={
            <>
              ¿Seguro que deseas eliminar la orden <strong>{borrarViaje.numero}</strong> ({borrarViaje.origen} ➔ {borrarViaje.destino}) de{' '}
              <strong>{nombreConductor(porId.get(borrarViaje.chofer_id))}</strong>? Esta acción no se puede deshacer.
            </>
          }
          onConfirm={async () => {
            const v = borrarViaje;
            setBorrarViaje(null);
            if (!v) return;
            try {
              await eliminarViaje(v);
              toast(`${v.numero} eliminado`, 'success');
              await recargar();
            } catch (err) {
              toast(err instanceof Error ? err.message : 'No se pudo eliminar el viaje', 'error');
            }
          }}
          onCancel={() => setBorrarViaje(null)}
        />
      )}
    </div>
  );
}
