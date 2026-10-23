/* ============================================================
   MGG · Choferes / Conductores · Nómina de viajes (planilla)

   Formato de la planilla de viajes:
   FECHA | NOMBRE Y APELLIDO | NÓMINA FIJA | VEHÍCULO | EQUIPO / MOVIMIENTO |
   PROVIENE | DESTINO | CANTIDAD VIAJES | MONTO | TOTAL A PAGAR | OBSERVACIONES

   Permite ver de inmediato los viajes pagados vs pendientes,
   y marcar viajes pagados por lote hasta una fecha de corte (ej. hasta el 14).
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { money, date as fmtDate } from '@/shared/lib/format';
import {
  categoriaDeViaje, cantidadViajes, tarifaTotalViaje, infoPagoViaje, calcularSiguientePeriodoCierre,
} from './choferes';
import {
  eliminarViaje, marcarViajesPagadosConCantidades, revertirCierreNomina, type Conductor, type Viaje,
} from './choferes.repository';
import { nombreConductor, type PropsTab } from './ChoferesPage';
import { generarNominaViajesPdf, type GrupoChoferNomina, type FilaNominaViaje } from './nominaViajesPdf';
import { generarNominaViajesExcel } from './nominaViajesExcel';
import { generarReciboPagoViajesPdf } from './reciboPagoViajesPdf';
import { ViajeModal, DetalleViajeModal, AccionViajeModal } from './ViajesTab';

export function NominaViajesTab({ datos, canWrite, actor, actorName }: PropsTab) {
  const { conductores, flota, viajes, pagos, loading, recargar } = datos;

  const [choferId, setChoferId] = useState('');
  const [empresaFiltro, setEmpresaFiltro] = useState('');
  const [estadoPagoFiltro, setEstadoPagoFiltro] = useState<'' | 'pendientes' | 'pagados'>('pendientes');
  const [fechaHasta, setFechaHasta] = useState('');
  const [busquedaTexto, setBusquedaTexto] = useState('');
  const [modalPagarLote, setModalPagarLote] = useState(false);
  const [fechaDesdeModal, setFechaDesdeModal] = useState('');
  const [fechaCorteModal, setFechaCorteModal] = useState('');
  const [fechaPagoModal, setFechaPagoModal] = useState(new Date().toISOString().slice(0, 10));
  const [choferModal, setChoferModal] = useState('');
  const [guardandoPago, setGuardandoPago] = useState(false);

  // Reversión de cierre y control de cantidad de viajes a liquidar
  const [modalRevertir, setModalRevertir] = useState(false);
  const [revertiendo, setRevertiendo] = useState(false);
  const [cantViajesPorFila, setCantViajesPorFila] = useState<Record<string, number>>({});
  const [mostrarDetalleViajesCierre, setMostrarDetalleViajesCierre] = useState(false);

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

  // Conductores que tienen al menos un viaje registrado en el sistema
  const conductoresConViajes = useMemo(() => {
    const idsConViaje = new Set(viajes.map((v) => v.chofer_id));
    return conductores
      .filter((c) => idsConViaje.has(c.id))
      .sort((a, b) => nombreConductor(a).localeCompare(nombreConductor(b)));
  }, [conductores, viajes]);

  // Transformar viajes a la estructura de la nómina
  const filasConDetalle = useMemo(() => {
    return viajes.map((v) => {
      const c = porId.get(v.chofer_id);
      const veh = vehPorId.get(v.vehiculo_id ?? '');
      const nominaFija = c?.personal?.empresa || c?.empresa_externa || (c?.externo ? 'EXTERNO' : 'MGG');
      const vehiculoTxt = veh?.placa || (veh ? `${veh.marca || ''} ${veh.modelo || ''}`.trim() : '—');
      const obs = categoriaDeViaje(v, c);
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
        conductoresMap: porId,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error');
    }
  }

  async function exportarExcel() {
    try {
      await generarNominaViajesExcel({
        grupos: gruposPorChofer,
        fechaDesde: fechaDesdeModal || undefined,
        fechaHasta: fechaHasta || undefined,
        filtroChofer: choferId ? nombreConductor(porId.get(choferId)) : undefined,
        conductoresMap: porId,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el archivo Excel', 'error');
    }
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

  // Viajes candidatos en el rango del cierre (ordenados por fecha cronológica ascendente)
  const viajesCandidatosCierre = useMemo(() => {
    if (!modalPagarLote) return [];
    return filasConDetalle
      .filter((f) => {
        if (choferModal && f.choferId !== choferModal) return false;
        if (fechaDesdeModal && f.fecha < fechaDesdeModal) return false;
        if (fechaCorteModal && f.fecha > fechaCorteModal) return false;
        return !f.pagado;
      })
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [modalPagarLote, filasConDetalle, choferModal, fechaDesdeModal, fechaCorteModal]);

  const totalViajesCandidatos = useMemo(() => {
    return viajesCandidatosCierre.reduce((a, f) => a + f.viajes, 0);
  }, [viajesCandidatosCierre]);

  const totalMontoCandidatos = useMemo(() => {
    return viajesCandidatosCierre.reduce((a, f) => a + f.totalPagar, 0);
  }, [viajesCandidatosCierre]);

  // Choferes con viajes pendientes en este corte
  const choferesEnCorte = useMemo(() => {
    if (!modalPagarLote) return [];
    const map = new Map<string, FilaNominaViaje[]>();
    for (const f of viajesCandidatosCierre) {
      if (!map.has(f.choferId)) map.set(f.choferId, []);
      map.get(f.choferId)!.push(f);
    }
    const res: {
      choferId: string;
      chofer: Conductor | undefined;
      nombre: string;
      nominaFija: string;
      filas: FilaNominaViaje[];
      totalViajes: number;
      totalMonto: number;
    }[] = [];
    for (const [cId, filas] of map.entries()) {
      const c = porId.get(cId);
      res.push({
        choferId: cId,
        chofer: c,
        nombre: nombreConductor(c),
        nominaFija: c?.personal?.empresa || c?.empresa_externa || (c?.externo ? 'EXTERNO' : 'MGG'),
        filas,
        totalViajes: filas.reduce((a, f) => a + f.viajes, 0),
        totalMonto: filas.reduce((a, f) => a + f.totalPagar, 0),
      });
    }
    return res.sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [modalPagarLote, viajesCandidatosCierre, porId]);

  // Al abrir el modal o cambiar conductor/fechas de corte, por defecto todas las órdenes se seleccionan con sus viajes completos
  useEffect(() => {
    if (modalPagarLote) {
      const init: Record<string, number> = {};
      for (const f of viajesCandidatosCierre) {
        init[f.viaje.id] = f.viajes;
      }
      setCantViajesPorFila(init);
    }
  }, [modalPagarLote, choferModal, fechaDesdeModal, fechaCorteModal, totalViajesCandidatos]);

  // Actualiza la cantidad de viajes a liquidar de un chofer específico (distribuyendo cronológicamente en sus órdenes)
  const actualizarCantidadChofer = (cId: string, cantDeseada: number) => {
    const filasChofer = viajesCandidatosCierre
      .filter((f) => f.choferId === cId)
      .sort((a, b) => a.fecha.localeCompare(b.fecha));

    let remanentePorAsignar = Math.max(0, cantDeseada);
    setCantViajesPorFila((prev) => {
      const next = { ...prev };
      for (const f of filasChofer) {
        if (remanentePorAsignar >= f.viajes) {
          next[f.viaje.id] = f.viajes;
          remanentePorAsignar -= f.viajes;
        } else if (remanentePorAsignar > 0) {
          next[f.viaje.id] = remanentePorAsignar;
          remanentePorAsignar = 0;
        } else {
          next[f.viaje.id] = 0;
        }
      }
      return next;
    });
  };

  // Modifica la cantidad de viajes a liquidar en una fila puntual de la lista
  const actualizarViajesFila = (viajeId: string, maxViajes: number, cant: number) => {
    const seguro = Math.max(0, Math.min(maxViajes, cant));
    setCantViajesPorFila((prev) => ({
      ...prev,
      [viajeId]: seguro,
    }));
  };

  // Alterna inclusión completa de una fila
  const toggleFila = (viajeId: string, maxViajes: number) => {
    setCantViajesPorFila((prev) => {
      const actual = prev[viajeId] ?? 0;
      return {
        ...prev,
        [viajeId]: actual > 0 ? 0 : maxViajes,
      };
    });
  };

  // Filas efectivas que se van a procesar (con viajes > 0)
  const filasAProcesar = useMemo(() => {
    return viajesCandidatosCierre
      .filter((f) => (cantViajesPorFila[f.viaje.id] ?? 0) > 0)
      .map((f) => {
        const cant = cantViajesPorFila[f.viaje.id] ?? f.viajes;
        return {
          ...f,
          viajes: cant,
          totalPagar: cant * f.monto,
        };
      });
  }, [viajesCandidatosCierre, cantViajesPorFila]);

  const totalViajesALiquidar = useMemo(() => {
    return filasAProcesar.reduce((a, f) => a + f.viajes, 0);
  }, [filasAProcesar]);

  const totalMontoALiquidar = useMemo(() => {
    return filasAProcesar.reduce((a, f) => a + f.totalPagar, 0);
  }, [filasAProcesar]);

  const totalViajesRestantes = Math.max(0, totalViajesCandidatos - totalViajesALiquidar);
  const totalMontoRestante = Math.max(0, totalMontoCandidatos - totalMontoALiquidar);

  async function ejecutarMarcarPagados() {
    if (!filasAProcesar.length) {
      toast('No hay viajes seleccionados para liquidar en este cierre', 'error');
      return;
    }
    setGuardandoPago(true);
    try {
      const items = filasAProcesar.map((f) => ({
        viajeId: f.viaje.id,
        viajesAPagar: f.viajes,
      }));
      const res = await marcarViajesPagadosConCantidades({
        items,
        fechaPago: fechaPagoModal,
        actor: actorName || actor,
      });
      toast(`Cierre de nómina completado: se liquidaron ${totalViajesALiquidar} viaje(s) (${res.actualizados} registro(s))`, 'success');
      setModalPagarLote(false);
      await recargar();

      // Al cerrar nómina, emitir el recibo de pago si se liquidaron viajes
      if (res.actualizados > 0) {
        // Construir grupos para el recibo solo con los viajes liquidados
        const mapaGrupos = new Map<string, FilaNominaViaje[]>();
        for (const f of filasAProcesar) {
          if (!mapaGrupos.has(f.choferId)) mapaGrupos.set(f.choferId, []);
          mapaGrupos.get(f.choferId)!.push({ ...f, pagado: true, fechaPago: fechaPagoModal });
        }
        const gruposRecibo: GrupoChoferNomina[] = [];
        for (const [cId, rows] of mapaGrupos.entries()) {
          const c = porId.get(cId);
          const total = rows.reduce((a, r) => a + r.totalPagar, 0);
          gruposRecibo.push({
            choferId: cId,
            nombre: nombreConductor(c),
            nominaFija: c?.personal?.empresa || c?.empresa_externa || 'MGG',
            filas: rows,
            totalGeneral: total,
            totalPagado: total,
            totalPendiente: 0,
          });
        }
        void generarReciboPagoViajesPdf({
          grupos: gruposRecibo,
          fechaDesde: fechaDesdeModal || undefined,
          fechaHasta: fechaCorteModal,
          fechaPago: fechaPagoModal,
          conductoresMap: porId,
          flotaMap: vehPorId,
        });
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron liquidar los viajes', 'error');
    } finally {
      setGuardandoPago(false);
    }
  }

  async function ejecutarRevertirCierre() {
    setRevertiendo(true);
    try {
      const res = await revertirCierreNomina({ choferId: choferId || undefined });
      toast(`Cierre revertido: se pasaron ${res.actualizados} viaje(s) a pendientes`, 'success');
      setModalRevertir(false);
      await recargar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo revertir el cierre', 'error');
    } finally {
      setRevertiendo(false);
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
              {conductoresConViajes.map((c) => <option key={c.id} value={c.id}>{nombreConductor(c)}</option>)}
            </select>
          </div>

          <div className="form-row" style={{ flex: '0 1 140px', margin: 0 }}>
            <label>Nómina fija</label>
            <select className="select" value={empresaFiltro} onChange={(e) => setEmpresaFiltro(e.target.value)}>
              <option value="">Todas</option>
              {empresasDisponibles.map((emp) => <option key={emp} value={emp}>{emp}</option>)}
            </select>
          </div>

          <div className="form-row" style={{ flex: '0 1 180px', margin: 0 }}>
            <label>Estado de pago</label>
            <select className="select" value={estadoPagoFiltro} onChange={(e) => setEstadoPagoFiltro(e.target.value as typeof estadoPagoFiltro)}>
              <option value="pendientes">⏳ Solo pendientes ({filasConDetalle.filter(f => !f.pagado).length})</option>
              <option value="pagados">✅ Solo pagados ({filasConDetalle.filter(f => f.pagado).length})</option>
              <option value="">Todos los viajes ({filasConDetalle.length})</option>
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
                // Calcular último corte de viajes cerrados/pagados para proponer el próximo rango consecutivo
                const viajesPagados = viajes.filter((v) => {
                  if (choferId && v.chofer_id !== choferId) return false;
                  return !!(v.pagado_at || (v.nota && /\[PAGADO:\s*([^\]]+)\]/i.test(v.nota)) || v.pago_id);
                });
                let ultimoCorte: string | null = null;
                if (viajesPagados.length > 0) {
                  viajesPagados.sort((a, b) => b.fecha_salida.slice(0, 10).localeCompare(a.fecha_salida.slice(0, 10)));
                  ultimoCorte = viajesPagados[0].fecha_salida.slice(0, 10);
                }
                const sugerido = calcularSiguientePeriodoCierre(ultimoCorte);
                setFechaDesdeModal(sugerido.desde);
                setFechaCorteModal(sugerido.hasta);
                setFechaPagoModal(new Date().toISOString().slice(0, 10));
                setChoferModal(choferId);
                setModalPagarLote(true);
              }} title="Cerrar la nómina de viajes por rango de fecha para que queden saldados y generar recibo de pago">
                🔒 Cierre de Nómina…
              </button>
            )}
            {canWrite && filasConDetalle.some((f) => f.pagado) && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ color: 'var(--danger)', border: '1px solid rgba(239, 68, 68, 0.4)' }}
                onClick={() => setModalRevertir(true)}
                title="Revertir el cierre actual para que los viajes pagados vuelvan a quedar pendientes"
              >
                ↩ Revertir Cierre…
              </button>
            )}
            <button className="btn btn-sm btn-ghost" onClick={() => void exportarRecibosLote()} disabled={!filasFiltradas.length} title="Imprimir recibos de pago en lote para firma del chofer">
              🧾 Recibos de Pago (Lote)
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => void exportarPdf()} disabled={!filasFiltradas.length}>
              🖨 Planilla PDF
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => void exportarExcel()} disabled={!filasFiltradas.length}>
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
                            {canWrite && f.viaje && f.pagado && (
                              <button
                                type="button"
                                className="btn btn-xs btn-ghost"
                                style={{ color: 'var(--warning)', padding: '.12rem .35rem' }}
                                onClick={async () => {
                                  if (confirm(`¿Revertir estado de pago del viaje ${f.viaje.numero}? Volverá a quedar pendiente.`)) {
                                    try {
                                      await revertirCierreNomina({ viajeIds: [f.viaje.id] });
                                      toast(`Viaje ${f.viaje.numero} revertido a pendiente`, 'success');
                                      await recargar();
                                    } catch (err) {
                                      toast(err instanceof Error ? err.message : 'No se pudo revertir el viaje', 'error');
                                    }
                                  }
                                }}
                                title="Revertir este viaje a pendiente"
                              >
                                ↩
                              </button>
                            )}
                            {canWrite && f.viaje && (
                              <button
                                type="button"
                                className="btn btn-xs btn-ghost"
                                style={{ color: 'var(--danger)', padding: '.12rem .35rem' }}
                                onClick={() => setBorrarViaje(f.viaje)}
                                title={f.pagado ? 'Eliminar viaje pagado' : 'Eliminar viaje'}
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
        <Modal title="🔒 Cierre de Nómina de Viajes" size="lg" onClose={() => setModalPagarLote(false)} footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModalPagarLote(false)} disabled={guardandoPago}>Cancelar</button>
            <button className="btn btn-primary" onClick={() => void ejecutarMarcarPagados()} disabled={guardandoPago || !fechaCorteModal || !totalViajesALiquidar}>
              {guardandoPago ? 'Procesando cierre…' : `Confirmar Cierre (${totalViajesALiquidar} viajes)`}
            </button>
          </>
        }>
          <div style={{ fontSize: '.88rem', marginBottom: '.8rem', lineHeight: 1.5 }}>
            Establece el rango de fechas para el corte y define la cantidad de viajes a liquidar por conductor o individualmente. Al confirmar, los viajes liquidados quedarán saldados y se generará el recibo de pago para la firma del chofer.
          </div>

          <div className="form-grid">
            <div className="form-row" style={{ gridColumn: '1 / -1' }}>
              <label>Conductor</label>
              <select className="select" value={choferModal} onChange={(e) => setChoferModal(e.target.value)}>
                <option value="">— Todos los conductores (Cierre por lote) —</option>
                {conductoresConViajes.map((c) => {
                  const totalV = viajes.filter(v => v.chofer_id === c.id).reduce((a, v) => a + (v.viajes || 1), 0);
                  return (
                    <option key={c.id} value={c.id}>
                      {nombreConductor(c)} ({totalV} viajes)
                    </option>
                  );
                })}
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

          {/* Sección de Selección de Viajes por Conductor */}
          <div style={{ marginTop: '.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.45rem' }}>
              <div style={{ fontSize: '.84rem', fontWeight: 700, color: 'var(--text)' }}>
                Viajes a pagar por conductor:
              </div>
              {choferesEnCorte.length > 1 && (
                <div style={{ display: 'flex', gap: '.4rem' }}>
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost"
                    onClick={() => {
                      for (const ch of choferesEnCorte) {
                        actualizarCantidadChofer(ch.choferId, ch.totalViajes);
                      }
                    }}
                  >
                    Pagar todos ({totalViajesCandidatos})
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost"
                    style={{ color: 'var(--text-muted)' }}
                    onClick={() => {
                      for (const ch of choferesEnCorte) {
                        actualizarCantidadChofer(ch.choferId, 0);
                      }
                    }}
                  >
                    Desmarcar todos
                  </button>
                </div>
              )}
            </div>

            {!choferesEnCorte.length ? (
              <div className="muted" style={{ padding: '.8rem', textAlign: 'center', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', fontSize: '.85rem' }}>
                No hay viajes pendientes en este rango de fechas.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                {choferesEnCorte.map((ch) => {
                  const cantActualChofer = ch.filas.reduce((a, f) => a + (cantViajesPorFila[f.viaje.id] ?? 0), 0);
                  const montoActualChofer = ch.filas.reduce((a, f) => a + (cantViajesPorFila[f.viaje.id] ?? 0) * f.monto, 0);
                  const cantPendienteChofer = Math.max(0, ch.totalViajes - cantActualChofer);
                  const montoPendienteChofer = Math.max(0, ch.totalMonto - montoActualChofer);

                  return (
                    <div key={ch.choferId} style={{ padding: '.65rem .85rem', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.4rem', marginBottom: '.4rem' }}>
                        <div>
                          <strong style={{ fontSize: '.9rem' }}>{ch.nombre}</strong>
                          <span className="badge" style={{ marginLeft: '.5rem', fontSize: '.68rem' }}>
                            {ch.nominaFija}
                          </span>
                        </div>
                        <div className="mono" style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>
                          Disponibles: <strong style={{ color: 'var(--primary)' }}>{ch.totalViajes} viajes</strong> ({money(ch.totalMonto)})
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                          <label style={{ fontSize: '.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Viajes a pagar:</label>
                          <input
                            type="number"
                            className="input mono"
                            min={0}
                            max={ch.totalViajes}
                            value={cantActualChofer}
                            onChange={(e) => {
                              const val = e.target.value === '' ? 0 : Number(e.target.value);
                              actualizarCantidadChofer(ch.choferId, val);
                            }}
                            style={{ width: '85px', fontWeight: 800, fontSize: '1rem', color: 'var(--primary)', textAlign: 'center' }}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost"
                          onClick={() => actualizarCantidadChofer(ch.choferId, ch.totalViajes)}
                          title="Pagar todos los viajes de este conductor"
                        >
                          Todos ({ch.totalViajes})
                        </button>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost"
                          style={{ color: 'var(--text-muted)' }}
                          onClick={() => actualizarCantidadChofer(ch.choferId, 0)}
                          title="No pagar viajes a este conductor en este corte"
                        >
                          Ninguno (0)
                        </button>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '.8rem', fontSize: '.8rem' }}>
                          <span style={{ color: 'var(--success)' }}>
                            A liquidar: <strong className="mono">{money(montoActualChofer)}</strong> ({cantActualChofer} v.)
                          </span>
                          {cantPendienteChofer > 0 && (
                            <span style={{ color: 'var(--danger)' }}>
                              Pendiente: <strong className="mono">{money(montoPendienteChofer)}</strong> ({cantPendienteChofer} v.)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Resumen dinámico del cierre */}
          <div style={{ marginTop: '.85rem', padding: '.75rem .9rem', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
              <div style={{ fontSize: '.82rem', fontWeight: 700, color: 'var(--text)' }}>
                Balance global del corte:
              </div>
              <button
                type="button"
                className="btn btn-xs btn-primary"
                onClick={() => setMostrarDetalleViajesCierre(!mostrarDetalleViajesCierre)}
                style={{
                  fontWeight: 700,
                  fontSize: '.82rem',
                  padding: '.35rem .85rem',
                }}
              >
                {mostrarDetalleViajesCierre ? '▴ Ocultar lista individual' : `👁 Ver / Seleccionar viajes individuales (${totalViajesALiquidar} de ${totalViajesCandidatos})`}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '.6rem', fontSize: '.82rem' }}>
              <div style={{ padding: '.5rem .65rem', background: 'rgba(34, 197, 94, 0.08)', borderRadius: 'var(--r-sm)', border: '1px solid rgba(34, 197, 94, 0.25)' }}>
                <div style={{ color: 'var(--success)', fontWeight: 700, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>A liquidar en este cierre</div>
                <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--success)', marginTop: 2 }}>
                  {money(totalMontoALiquidar)}
                </div>
                <div className="muted" style={{ fontSize: '.75rem', marginTop: 2 }}>
                  {totalViajesALiquidar} viajes ({filasAProcesar.length} reg.)
                </div>
              </div>

              <div style={{ padding: '.5rem .65rem', background: 'rgba(239, 68, 68, 0.08)', borderRadius: 'var(--r-sm)', border: '1px solid rgba(239, 68, 68, 0.25)' }}>
                <div style={{ color: 'var(--danger)', fontWeight: 700, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>Quedarán pendientes</div>
                <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--danger)', marginTop: 2 }}>
                  {money(totalMontoRestante)}
                </div>
                <div className="muted" style={{ fontSize: '.75rem', marginTop: 2 }}>
                  {totalViajesRestantes} viajes restantes
                </div>
              </div>
            </div>

            {/* Lista individual desplegable con inputs de cantidad por viaje y checkboxes */}
            {mostrarDetalleViajesCierre && (
              <div style={{ marginTop: '.75rem', maxHeight: '280px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
                <table className="table" style={{ fontSize: '.78rem', margin: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ width: '32px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={viajesCandidatosCierre.length > 0 && totalViajesALiquidar === totalViajesCandidatos}
                          onChange={(e) => {
                            if (e.target.checked) {
                              const allMap: Record<string, number> = {};
                              for (const f of viajesCandidatosCierre) allMap[f.viaje.id] = f.viajes;
                              setCantViajesPorFila(allMap);
                            } else {
                              setCantViajesPorFila({});
                            }
                          }}
                        />
                      </th>
                      <th>Fecha</th>
                      <th>Chofer</th>
                      <th>Ruta / Movimiento</th>
                      <th>Cat.</th>
                      <th style={{ textAlign: 'right', minWidth: '95px' }}>Viajes a pagar</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viajesCandidatosCierre.map((f) => {
                      const cantFila = cantViajesPorFila[f.viaje.id] ?? 0;
                      const sel = cantFila > 0;
                      const totalFila = cantFila * f.monto;
                      return (
                        <tr key={f.viaje.id} style={{ background: sel ? 'rgba(255, 138, 0, 0.08)' : undefined }}>
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={sel}
                              onChange={() => toggleFila(f.viaje.id, f.viaje.viajes)}
                            />
                          </td>
                          <td className="mono">{fmtDate(f.fecha)}</td>
                          <td>{f.nombre}</td>
                          <td>{f.proviene} ➔ {f.destino}</td>
                          <td><span className="badge" style={{ fontSize: '.68rem' }}>{f.observaciones}</span></td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '.3rem' }}>
                              <input
                                type="number"
                                className="input mono"
                                min={0}
                                max={f.viaje.viajes}
                                value={cantFila}
                                onChange={(e) => {
                                  const val = e.target.value === '' ? 0 : Number(e.target.value);
                                  actualizarViajesFila(f.viaje.id, f.viaje.viajes, val);
                                }}
                                style={{ width: '60px', textAlign: 'center', fontWeight: 800, padding: '2px 4px', fontSize: '.85rem', color: 'var(--primary)' }}
                              />
                              <span className="muted" style={{ fontSize: '.72rem' }}>/ {f.viaje.viajes}</span>
                            </div>
                          </td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: sel ? 'var(--primary)' : 'var(--text-muted)' }}>
                            {money(totalFila)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ── Confirmación de Reversión de Cierre ── */}
      {modalRevertir && (
        <ConfirmDialog
          title="↩ Revertir Cierre de Nómina de Viajes"
          danger
          confirmText={revertiendo ? 'Revirtiendo…' : 'Sí, revertir cierre'}
          message={
            <div>
              <p>
                ¿Seguro que deseas <strong>revertir el cierre de nómina de viajes</strong>
                {choferId ? ` para ${nombreConductor(porId.get(choferId))}` : ''}?
              </p>
              <p style={{ marginTop: '.5rem', fontSize: '.85rem', color: 'var(--text-muted)' }}>
                Todos los viajes registrados como pagados en este corte volverán al estado <strong>pendiente</strong> para que puedas editarlos, eliminarlos o volver a incluirlos en el corte con la cantidad deseada.
              </p>
            </div>
          }
          onConfirm={() => void ejecutarRevertirCierre()}
          onCancel={() => !revertiendo && setModalRevertir(false)}
        />
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
              {(borrarViaje.pagado_at || (borrarViaje.nota && /\[PAGADO:/i.test(borrarViaje.nota)) || borrarViaje.pago_id) && (
                <div className="aviso warning sm" style={{ marginTop: '.6rem' }}>
                  ⚠️ Este viaje figura como <strong>PAGADO</strong>. Al eliminarlo, se descontará del historial y de los cálculos de nómina del conductor.
                </div>
              )}
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
