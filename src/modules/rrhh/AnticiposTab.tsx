/* ============================================================
   MGG · RRHH · Préstamos y anticipos

   Tres cosas en una pantalla (con el estilo de listados de Golden Touch):

   1. CARGAR, incluso lo viejo. Un préstamo lleva la fecha en que se DIO, que
      puede ser de hace meses, y en modo histórico entra con lo que ya se había
      abonado y hasta qué fecha. Sin eso, cargar el historial de alguien
      metería todo fechado hoy.

   2. VER DE UN GOLPE cuánto hay prestado y a cuánta gente. Las dos tarjetas de
      arriba se tocan y abren el detalle; no son adornos.

   3. BUSCAR. Por trabajador, tipo, estado, origen, departamento, rango de
      fechas, rango de monto y texto libre. Los filtros mandan sobre las
      tarjetas, la tabla y el PDF: lo que se ve es lo que se imprime.

   El SALDO no se escribe nunca a mano: sale de los abonos, que los mantiene la
   base. Lo que descuenta la nómina entra solo, por un puente en la base.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { VistaPrevia, Dato } from '@/shared/ui/VistaPrevia';
import { toast } from '@/shared/ui/Toast';
import { money, date, dateTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Personal, AnticipoPrestamo, PagoAnticipo } from '@/shared/lib/types';
import { listPersonal } from './personal.repository';
import {
  listAnticipos, listPagosAnticipos, crearAnticipo, editarAnticipo, eliminarAnticipo,
  agregarPagoAnticipo, editarPagoAnticipo, eliminarPagoAnticipo,
  sincronizarPrestamosDuplicadosAutomatico, type AnticipoInput,
} from './anticipos.repository';
import { EMPRESA_POR_DEFECTO, type Empresa } from './empresa';
import { nombreDeCarnet, numeroFicha } from './fichaPersonal';
import {
  FILTRO_PRESTAMOS_VACIO, deudaPorTrabajador, errorPago, estadoDeCuenta,
  fechaDePrestamo, filtrarPagos, filtrarPrestamos, labelOrigen, pagosPorPrestamo,
  rangosRapidos, resumenPrestamos, obtenerEntregas, unificarPrestamosActivos,
  type DeudaTrabajador, type FiltroPrestamos,
} from './prestamos';

import { getTasaHoy } from '../tesoreria/tasas.repository';
import { MONEDAS_PAGO_RRHH, simboloMoneda, etiquetaMonedaPago, convertirMonedaAUsd, type MonedaPagoRrhh } from './sueldoQuincena';
import { verReciboPrestamoPdf } from './prestamosPdf';

const hoyIso = () => new Date().toISOString().slice(0, 10);

const VACIO = (): AnticipoInput => ({
  personal_id: '', tipo: 'prestamo', monto_total: 0, cuota_sugerida: null, motivo: '',
  fecha: hoyIso(), ya_pagado: null, fecha_abono: hoyIso(), moneda: 'USD', monto_original: null, tasa_cambio: null,
});

/** Por defecto la lista muestra lo que todavía se debe, como en Golden Touch. */
const FILTRO_INICIAL: FiltroPrestamos = { ...FILTRO_PRESTAMOS_VACIO, estado: 'activos', origen: 'todos' };

/** Cuántos filtros hay puestos (el estado cuenta solo si no es el de arranque), para «✕ Limpiar (n)». */
function filtrosPuestos(f: FiltroPrestamos, depto: string): number {
  return [
    f.texto?.trim(), f.trabajadorId, f.tipo, f.desde, f.hasta, f.soloHistoricos,
    f.montoMin != null, f.montoMax != null, f.saldoMin != null,
    f.origen && f.origen !== 'todos', depto,
  ].filter(Boolean).length + (f.estado !== FILTRO_INICIAL.estado ? 1 : 0);
}

const etiquetaTipo = (t: AnticipoPrestamo['tipo']) => (t === 'anticipo' ? 'Anticipo' : 'Préstamo');

function Kpi({ label, value, sub, color, onClick }: {
  label: string; value: string; sub?: string; color?: string; onClick?: () => void;
}) {
  const clase = `lt-kpi${color ? ` ${color}` : ''}`;
  const cuerpo = (
    <>
      <span className="lt-kpi-label">{label}</span>
      <span className="lt-kpi-valor">{value}</span>
      {sub && <span className="lt-kpi-sub">{sub}</span>}
    </>
  );
  return onClick
    ? <button type="button" className={clase} onClick={onClick} title="Toca para ver el detalle">{cuerpo}</button>
    : <div className={clase}>{cuerpo}</div>;
}

export function AnticiposTab({ canWrite, actor, actorName, empresa = EMPRESA_POR_DEFECTO }: {
  canWrite: boolean; actor: string; actorName: string | null; empresa?: Empresa;
}) {
  const [personal, setPersonal] = useState<Personal[]>([]);
  const [lista, setLista] = useState<AnticipoPrestamo[]>([]);
  const [pagos, setPagos] = useState<PagoAnticipo[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<AnticipoInput>(VACIO);
  const [historicoForm, setHistoricoForm] = useState(false);
  const [abrirForm, setAbrirForm] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroPrestamos>(FILTRO_INICIAL);
  const [depto, setDepto] = useState('');
  const [masFiltros, setMasFiltros] = useState(false);
  const [verPendientes, setVerPendientes] = useState(false);
  const [verTrabajadores, setVerTrabajadores] = useState(false);
  const [detalle, setDetalle] = useState<AnticipoPrestamo | null>(null);
  const [cuentaDe, setCuentaDe] = useState<string | null>(null);
  const [porBorrar, setPorBorrar] = useState<AnticipoPrestamo | null>(null);
  const [tasaBcv, setTasaBcv] = useState<number | null>(null);
  const [monedaForm, setMonedaForm] = useState<MonedaPagoRrhh>('USD');
  const [montoMonedaForm, setMontoMonedaForm] = useState<number | null>(null);
  const [tasaCambioForm, setTasaCambioForm] = useState<number | null>(null);
  const [generandoPdf, setGenerandoPdf] = useState(false);

  useEffect(() => {
    void getTasaHoy().then((t) => {
      if (t.usd) setTasaBcv(t.usd);
    }).catch(() => null);
  }, []);

  const prestamoActivoExistente = useMemo(() => {
    if (!form.personal_id) return null;
    return lista.find((p) => p.personal_id === form.personal_id && p.estado === 'activo' && Number(p.saldo) > 0) ?? null;
  }, [form.personal_id, lista]);

  const recargar = useCallback(async () => {
    setLoading(true);
    const [ps, asRaw] = await Promise.all([
      listPersonal(false, empresa).catch((e) => { toast(e instanceof Error ? e.message : 'No se pudo cargar el personal', 'error'); return [] as Personal[]; }),
      listAnticipos(undefined, false, empresa).catch(() => [] as AnticipoPrestamo[]),
    ]);

    // Unificación automática inmediata en memoria (sin requerir que el usuario presione ningún botón)
    const as = unificarPrestamosActivos(asRaw);

    // Los abonos se piden después, ya sabiendo de qué préstamos
    const gs = as.length ? await listPagosAnticipos(as.map((a) => a.id)).catch(() => [] as PagoAnticipo[]) : [];
    setPersonal(ps); setLista(as); setPagos(gs);
    setDetalle((prev) => (prev ? as.find((x) => x.id === prev.id) ?? null : null));
    setLoading(false);

    // Sincronización automática de persistencia en la base de datos si hay duplicados
    void sincronizarPrestamosDuplicadosAutomatico(empresa).then((hubo) => {
      if (hubo) {
        void listAnticipos(undefined, false, empresa).then((refrescados) => {
          setLista(unificarPrestamosActivos(refrescados));
        });
      }
    });
  }, [empresa]);
  useEffect(() => { void recargar(); }, [recargar]);
  useRealtime(['anticipos_prestamos', 'anticipos_pagos', 'personal'], () => { void recargar(); });

  const personaPorId = useMemo(() => new Map(personal.map((p) => [p.id, p])), [personal]);
  const nombreDe = useCallback((id: string) => {
    const p = personaPorId.get(id);
    return p ? `${p.nombre} ${p.apellido ?? ''}`.trim() : '—';
  }, [personaPorId]);
  /** Lo que se busca con el cuadro de texto: nombre, cédula, ficha, cargo y departamento. */
  const pajarDe = useCallback((id: string) => {
    const p = personaPorId.get(id);
    return p ? `${nombreDe(id)} ${p.cedula ?? ''} ${p.numero_ficha ?? ''} ${p.cargo ?? ''} ${p.departamento ?? ''}` : '';
  }, [personaPorId, nombreDe]);
  const departamentos = useMemo(
    () => [...new Set(personal.map((p) => p.departamento).filter((d): d is string => !!d))].sort(),
    [personal],
  );

  /* Lo filtrado manda en TODO: tarjetas, tabla y PDF. Que la tarjeta diga una
     cosa y la tabla otra es la forma más rápida de que nadie confíe en ninguna.
     Las tarjetas ignoran el estado (lo pendiente es, por definición, activo). */
  const delDepto = useCallback(
    (l: AnticipoPrestamo[]) => (depto ? l.filter((a) => (personaPorId.get(a.personal_id)?.departamento ?? '') === depto) : l),
    [depto, personaPorId],
  );
  const baseKpi = useMemo(
    () => delDepto(filtrarPrestamos(lista, { ...filtro, estado: 'todos' }, pajarDe)),
    [lista, filtro, pajarDe, delDepto],
  );
  const visibles = useMemo(() => delDepto(filtrarPrestamos(lista, filtro, pajarDe)), [lista, filtro, pajarDe, delDepto]);
  const pagosVisibles = useMemo(
    () => filtrarPagos(pagos, filtro).filter((g) => visibles.some((p) => p.id === g.anticipo_id)),
    [pagos, filtro, visibles],
  );
  const resumen = useMemo(() => resumenPrestamos(baseKpi, pagos), [baseKpi, pagos]);
  const resumenVisible = useMemo(() => resumenPrestamos(visibles, pagos), [visibles, pagos]);
  const deudas = useMemo(() => deudaPorTrabajador(baseKpi, pagos, nombreDe), [baseKpi, pagos, nombreDe]);
  const pagosDe = useMemo(() => pagosPorPrestamo(pagos), [pagos]);
  const rangos = useMemo(() => rangosRapidos(), []);
  const nFiltros = filtrosPuestos(filtro, depto);

  const setF = <K extends keyof FiltroPrestamos>(k: K, v: FiltroPrestamos[K]) => setFiltro((f) => ({ ...f, [k]: v }));

  function textoFiltros(): string {
    const partes: string[] = [];
    if (filtro.desde || filtro.hasta) {
      partes.push(`Préstamos ${filtro.desde ? `desde ${date(filtro.desde)}` : ''} ${filtro.hasta ? `hasta ${date(filtro.hasta)}` : ''}`.replace(/\s+/g, ' ').trim());
    }
    if (filtro.estado && filtro.estado !== 'todos') partes.push(filtro.estado === 'activos' ? 'Solo con saldo' : 'Solo saldados');
    if (filtro.tipo) partes.push(`Solo ${etiquetaTipo(filtro.tipo).toLowerCase()}s`);
    if (filtro.origen === 'historico' || filtro.soloHistoricos) partes.push('Solo históricos');
    if (filtro.origen === 'sistema') partes.push('Solo cargados en el sistema');
    if (depto) partes.push(`Departamento ${depto}`);
    if (filtro.trabajadorId) partes.push(nombreDe(filtro.trabajadorId));
    if (filtro.texto?.trim()) partes.push(`Búsqueda «${filtro.texto.trim()}»`);
    if (filtro.montoMin != null || filtro.montoMax != null) {
      partes.push(`Monto ${filtro.montoMin != null ? `≥ ${filtro.montoMin}` : ''} ${filtro.montoMax != null ? `≤ ${filtro.montoMax}` : ''}`.replace(/\s+/g, ' ').trim());
    }
    return partes.join(' · ') || 'Sin filtros';
  }

  function abrirAlta() {
    setForm(VACIO()); setHistoricoForm(false); setError(null);
    setMonedaForm('USD'); setMontoMonedaForm(null); setTasaCambioForm(null);
    setAbrirForm(true);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!form.personal_id) { setError('Elige el trabajador.'); return; }
    let montoTotalUsd = Number(form.monto_total) || 0;
    if (monedaForm !== 'USD') {
      const orig = Number(montoMonedaForm) || 0;
      if (orig <= 0) { setError(`Indica el monto a entregar en ${etiquetaMonedaPago(monedaForm)}.`); return; }
      const tasa = Number(tasaCambioForm) || (monedaForm === 'Bs' || monedaForm === 'VES' ? tasaBcv : null);
      if (!tasa || tasa <= 0) { setError('Indica una tasa de cambio válida para la conversión.'); return; }
      montoTotalUsd = convertirMonedaAUsd(orig, monedaForm, tasa).montoUsd;
    }
    if (!(montoTotalUsd > 0)) { setError('Indica el monto.'); return; }
    const yaPagado = historicoForm ? (form.ya_pagado ?? null) : null;
    if ((yaPagado ?? 0) > montoTotalUsd) { setError('Lo ya pagado no puede superar el monto del préstamo.'); return; }
    if ((yaPagado ?? 0) > 0 && (form.fecha_abono ?? '') < (form.fecha ?? '')) { setError('Lo abonado no puede ser anterior al préstamo.'); return; }
    setGuardando(true);
    try {
      const inputCompleto: AnticipoInput = {
        ...form,
        monto_total: montoTotalUsd,
        ya_pagado: yaPagado,
        fecha_abono: yaPagado ? form.fecha_abono : null,
        moneda: monedaForm,
        monto_original: monedaForm === 'USD' ? montoTotalUsd : montoMonedaForm,
        tasa_cambio: monedaForm === 'USD' ? null : (tasaCambioForm || (monedaForm === 'Bs' || monedaForm === 'VES' ? tasaBcv : null)),
      };
      await crearAnticipo(inputCompleto, actor, actorName);
      toast(historicoForm ? 'Préstamo histórico cargado' : 'Registrado exitosamente', 'success');
      setForm(VACIO());
      setMonedaForm('USD'); setMontoMonedaForm(null); setTasaCambioForm(null);
      setAbrirForm(false);
      await recargar();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); }
    finally { setGuardando(false); }
  }

  async function confirmarBorrado() {
    if (!porBorrar) return;
    try { await eliminarAnticipo(porBorrar.id); setPorBorrar(null); await recargar(); toast('Eliminado', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); setPorBorrar(null); }
  }

  async function verConsolidado(deudasPdf: DeudaTrabajador[]) {
    setGenerandoPdf(true);
    try {
      const { verConsolidadoPrestamosPdf } = await import('./prestamosPdf');
      await verConsolidadoPrestamosPdf(deudasPdf, { desde: filtro.desde, hasta: filtro.hasta }, empresa);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
    finally { setGenerandoPdf(false); }
  }

  async function verEstadoCuenta(persona: Personal) {
    setGenerandoPdf(true);
    try {
      const { verEstadoCuentaPrestamosPdf } = await import('./prestamosPdf');
      await verEstadoCuentaPrestamosPdf(persona, lista, pagos, { desde: filtro.desde, hasta: filtro.hasta });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
    finally { setGenerandoPdf(false); }
  }

  const hoy = hoyIso();
  const rangoActivo = rangos.find((r) => filtro.desde === r.desde && filtro.hasta === r.hasta)?.key;

  return (
    <div>
      {/* ── Tarjetas. Se tocan. ── */}
      <div className="lt-kpis">
        <Kpi color="rojo" label="Total préstamos pendientes" value={money(resumen.totalPendiente)}
          sub={`${resumen.prestamosAbiertos} préstamo(s) sin saldar · toca para ver el detalle`}
          onClick={() => setVerPendientes(true)} />
        <Kpi color="ambar" label="Trabajadores con préstamos pendientes" value={String(resumen.trabajadoresConSaldo)}
          sub={`${resumen.trabajadoresConSaldo === 1 ? 'persona debiendo' : 'personas debiendo'} · toca para ver el detalle`}
          onClick={() => setVerTrabajadores(true)} />
        <Kpi color="naranja" label="Prestado / cobrado en lo filtrado" value={money(resumen.totalPrestado)}
          sub={`cobrado ${money(resumen.totalPagado)}`} />
      </div>

      {/* ── Filtros ── */}
      <div className="lt-filtros">
        <div className="lt-fila">
          <div className="lt-campo lt-ancho">
            <label htmlFor="ant-buscar">Buscar</label>
            <input id="ant-buscar" name="anticipos-buscar" className="input" value={filtro.texto ?? ''}
              onChange={(e) => setF('texto', e.target.value)} placeholder="Nombre del trabajador o motivo…" />
          </div>
          <div className="lt-campo">
            <label htmlFor="ant-trab">Trabajador</label>
            <select id="ant-trab" className="select" value={filtro.trabajadorId ?? ''} onChange={(e) => setF('trabajadorId', e.target.value)}>
              <option value="">— todos —</option>
              {personal.map((p) => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}{p.numero_ficha ? ` · Ficha ${p.numero_ficha}` : ''}</option>)}
            </select>
          </div>
          <div className="lt-campo">
            <label htmlFor="ant-tipo">Tipo</label>
            <select id="ant-tipo" className="select" value={filtro.tipo ?? ''} onChange={(e) => setF('tipo', e.target.value as FiltroPrestamos['tipo'])}>
              <option value="">Todos</option>
              <option value="prestamo">Solo préstamos</option>
              <option value="anticipo">Solo anticipos</option>
            </select>
          </div>
          <div className="lt-campo">
            <label htmlFor="ant-estado">Estado</label>
            <select id="ant-estado" className="select" value={filtro.estado ?? 'todos'} onChange={(e) => setF('estado', e.target.value as FiltroPrestamos['estado'])}>
              <option value="todos">Todos</option>
              <option value="activos">Con saldo</option>
              <option value="saldados">Saldados</option>
            </select>
          </div>
          <div className="lt-campo">
            <label htmlFor="ant-desde">Desde</label>
            <input id="ant-desde" name="anticipos-desde" className="input" type="date" value={filtro.desde ?? ''} onChange={(e) => setF('desde', e.target.value)} />
          </div>
          <div className="lt-campo">
            <label htmlFor="ant-hasta">Hasta</label>
            <input id="ant-hasta" name="anticipos-hasta" className="input" type="date" value={filtro.hasta ?? ''} onChange={(e) => setF('hasta', e.target.value)} />
          </div>
        </div>

        {/* Los rangos que se piden siempre, ya calculados: escribir dos fechas
            a mano para ver «este mes» es pedirle la cuenta del calendario. */}
        <div className="lt-pie">
          {rangos.map((r) => (
            <button key={r.key} type="button" className={`lt-chip${rangoActivo === r.key ? ' activo' : ''}`}
              onClick={() => setFiltro((f) => ({ ...f, desde: r.desde, hasta: r.hasta }))}>
              {r.label}
            </button>
          ))}
          <button type="button" className={`lt-chip${masFiltros ? ' activo' : ''}`} onClick={() => setMasFiltros((v) => !v)}>▾ Más filtros</button>
          {nFiltros > 0 && (
            <button type="button" className="lt-chip" onClick={() => { setFiltro(FILTRO_INICIAL); setDepto(''); }}>✕ Limpiar ({nFiltros})</button>
          )}
          <span className="lt-contador">
            {visibles.length} de {lista.length} · {resumenVisible.prestamosAbiertos} con saldo · {pagosVisibles.length} abono(s) en el rango
          </span>
        </div>

        {masFiltros && (
          <div className="lt-mas lt-fila">
            <div className="lt-campo">
              <label htmlFor="ant-origen">Origen</label>
              <select id="ant-origen" className="select" value={filtro.origen ?? 'todos'} onChange={(e) => setF('origen', e.target.value as FiltroPrestamos['origen'])}>
                <option value="todos">Todos</option>
                <option value="historico">Históricos (anteriores al sistema)</option>
                <option value="sistema">Cargados en el sistema</option>
              </select>
            </div>
            <div className="lt-campo">
              <label htmlFor="ant-depto">Departamento</label>
              <select id="ant-depto" className="select" value={depto} onChange={(e) => setDepto(e.target.value)}>
                <option value="">Todos</option>
                {departamentos.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="lt-campo">
              <label htmlFor="ant-min">Monto mínimo (USD)</label>
              <input id="ant-min" name="anticipos-monto-min" className="input mono" type="number" min={0} step="any" value={filtro.montoMin ?? ''}
                onChange={(e) => setF('montoMin', e.target.value === '' ? null : Number(e.target.value))} placeholder="0,00" />
            </div>
            <div className="lt-campo">
              <label htmlFor="ant-max">Monto máximo (USD)</label>
              <input id="ant-max" name="anticipos-monto-max" className="input mono" type="number" min={0} step="any" value={filtro.montoMax ?? ''}
                onChange={(e) => setF('montoMax', e.target.value === '' ? null : Number(e.target.value))} placeholder="Sin tope" />
            </div>
            <div className="lt-campo">
              <label htmlFor="ant-saldo-min">Debe al menos (USD)</label>
              <input id="ant-saldo-min" name="anticipos-saldo-min" className="input mono" type="number" min={0} step="any" value={filtro.saldoMin ?? ''}
                onChange={(e) => setF('saldoMin', e.target.value === '' ? null : Number(e.target.value))} placeholder="0,00" />
            </div>
          </div>
        )}
      </div>

      {/* ── Acciones ── */}
      <div className="lt-acciones">
        {canWrite && <button className="btn btn-primary" onClick={abrirAlta}>+ Registrar préstamo o anticipo</button>}
        <button className="btn btn-ghost" disabled={generandoPdf || !deudaPorTrabajador(visibles, pagos, nombreDe).length}
          title="PDF de lo que se ve en la lista: total prestado, pagado y deuda por trabajador, con sus abonos"
          onClick={() => void verConsolidado(deudaPorTrabajador(visibles, pagos, nombreDe))}>
          {generandoPdf ? 'Generando…' : '📄 Consolidado en PDF'}
        </button>
      </div>

      {/* ── Tabla ── */}
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead>
            <tr>
              <th>Fecha</th><th>Trabajador</th><th>Tipo</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th style={{ textAlign: 'right' }}>Pagado</th>
              <th style={{ textAlign: 'right' }}>Debe</th>
              <th style={{ textAlign: 'center' }}>Cuota</th>
              <th style={{ textAlign: 'center' }}>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !visibles.length && (
              <tr><td colSpan={9}>
                <EmptyState message={nFiltros ? 'Nada coincide con los filtros' : 'Sin préstamos ni anticipos'} icon="💵" />
              </td></tr>
            )}
            {!loading && visibles.map((a) => {
              const pagado = (pagosDe.get(a.id) ?? []).reduce((s, p) => s + (Number(p.monto) || 0), 0);
              const entregas = obtenerEntregas(a);
              const p = personaPorId.get(a.personal_id);
              const conSaldo = Number(a.saldo) > 0;
              return (
                <tr key={a.id} style={{ opacity: conSaldo ? 1 : 0.65, cursor: 'pointer' }} onClick={() => setDetalle(a)} title="Ver detalle y abonos">
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    <div style={{ fontWeight: 600 }}>{date(fechaDePrestamo(a))}</div>
                    {entregas.slice(1).map((ent, idx) => (
                      <div key={idx} className="muted" style={{ fontSize: '.72rem', marginTop: '2px', lineHeight: 1.25 }}
                        title={`Entrega adicional: ${money(ent.monto)}${ent.motivo ? ` · ${ent.motivo}` : ''}`}>
                        + {date(ent.fecha)} ({money(ent.monto)})
                      </div>
                    ))}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap' }}>
                      <button className="btn-link" style={{ padding: 0, textAlign: 'left', fontWeight: 500 }} title="Estado de cuenta del trabajador"
                        onClick={(e) => { e.stopPropagation(); setCuentaDe(a.personal_id); }}>
                        {nombreDe(a.personal_id)}
                      </button>
                      {entregas.length > 1 && (
                        <span className="badge" style={{ fontSize: '.7rem', padding: '1px 6px', background: 'rgba(234, 88, 12, 0.15)', color: '#ea580c', borderColor: '#ea580c' }}
                          title={`${entregas.length} préstamos acumulados`}>
                          {entregas.length} préstamos
                        </span>
                      )}
                    </div>
                    {p?.numero_ficha && <div className="muted" style={{ fontSize: '.74rem' }}>Ficha {p.numero_ficha}{p.cargo ? ` · ${p.cargo}` : ''}</div>}
                  </td>
                  <td>
                    <span className="badge">{etiquetaTipo(a.tipo)}</span>
                    {esHistoricoFila(a) && <span className="badge" style={{ marginLeft: '.25rem' }} title="Cargado como histórico (anterior al sistema)">📜</span>}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(a.monto_total)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--success)' }}>{money(pagado)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: conSaldo ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>{money(a.saldo)}</td>
                  <td className="mono muted" style={{ textAlign: 'center' }}>{a.cuota_sugerida != null ? money(a.cuota_sugerida) : '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span className={`lt-pill ${conSaldo ? 'ambar' : 'verde'}`}>{conSaldo ? 'Activo' : 'Saldado'}</span>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-sm btn-ghost" onClick={() => {
                      if (p) {
                        void verReciboPrestamoPdf({
                          tipo: 'entrega',
                          persona: p,
                          prestamo: a,
                          montoUsd: Number(a.monto_total) || 0,
                          fecha: fechaDePrestamo(a),
                          moneda: a.moneda,
                          montoOriginal: a.monto_original,
                          tasaCambio: a.tasa_cambio,
                          motivo: a.motivo,
                          saldoRestante: Number(a.saldo) || 0,
                        });
                      }
                    }} title="Imprimir recibo / comprobante de entrega en PDF">📄 Recibo</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setDetalle(a)} title="Detalle y abonos">🔍</button>
                    {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setPorBorrar(a)} title="Eliminar" style={{ color: 'var(--danger)' }}>🗑</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {!loading && visibles.length > 0 && (
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={3} style={{ textAlign: 'right' }}>Totales ({visibles.length})</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(resumenVisible.totalPrestado)}</td>
                <td className="mono" style={{ textAlign: 'right', color: 'var(--success)' }}>{money(resumenVisible.totalPagado)}</td>
                <td className="mono" style={{ textAlign: 'right', color: resumenVisible.totalPendiente > 0 ? 'var(--danger)' : 'var(--success)' }}>{money(resumenVisible.totalPendiente)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── Alta ── */}
      {abrirForm && (
        <Modal title={historicoForm ? '📜 Cargar préstamo histórico' : prestamoActivoExistente ? 'Sumar al préstamo activo' : '+ Registrar préstamo o anticipo'} size="md"
          onClose={() => { if (!guardando) { setAbrirForm(false); setError(null); } }}
          footer={<>
            <button className="btn btn-ghost" onClick={() => { setAbrirForm(false); setError(null); }} disabled={guardando}>Cancelar</button>
            <button type="submit" form="form-anticipo" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando…' : historicoForm ? '📜 Cargar histórico' : prestamoActivoExistente ? '+ Sumar al préstamo activo' : '+ Registrar'}
            </button>
          </>}>
          <form id="form-anticipo" onSubmit={guardar}>
            {error && <div className="aviso danger" style={{ marginBottom: '.6rem' }}><span className="aviso-icono">⛔</span><div><strong>Error:</strong> {error}</div></div>}
            <label style={{ display: 'flex', alignItems: 'center', gap: '.45rem', fontSize: '.88rem', cursor: 'pointer', marginBottom: '.7rem' }}
              title="Para los préstamos que ya existían antes del sistema: se carga con lo que ya se había abonado">
              <input type="checkbox" checked={historicoForm} onChange={(e) => setHistoricoForm(e.target.checked)} />
              📜 Modo histórico (ya existía antes del sistema)
            </label>
            <div className="form-grid">
              <div className="form-row" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="alta-trab">Trabajador *</label>
                <SearchSelect id="alta-trab" value={form.personal_id} onChange={(v) => setForm((f) => ({ ...f, personal_id: v }))} placeholder="🔍 Buscar trabajador…"
                  options={personal.filter((p) => p.activo || historicoForm).map((p) => ({
                    value: p.id,
                    label: `${p.nombre} ${p.apellido ?? ''}`.trim() + `${p.numero_ficha ? ` · Ficha ${p.numero_ficha}` : ''}${p.activo ? '' : ' · inactivo'}`,
                    keywords: [p.cedula ?? '', p.cargo ?? ''].filter(Boolean),
                  }))} />
              </div>
              <div className="form-row">
                <label htmlFor="alta-tipo">Tipo</label>
                <select id="alta-tipo" className="select" value={form.tipo} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value as 'anticipo' | 'prestamo' }))}>
                  <option value="prestamo">Préstamo</option>
                  <option value="anticipo">Anticipo</option>
                </select>
              </div>
              <div className="form-row">
                <label htmlFor="alta-moneda">Moneda de entrega</label>
                <select id="alta-moneda" className="select" value={monedaForm} onChange={(e) => {
                  const m = e.target.value as MonedaPagoRrhh;
                  setMonedaForm(m);
                  if ((m === 'Bs' || m === 'VES') && tasaBcv && !tasaCambioForm) setTasaCambioForm(tasaBcv);
                }}>
                  {MONEDAS_PAGO_RRHH.map((m) => (
                    <option key={m} value={m}>{etiquetaMonedaPago(m)}</option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label htmlFor="alta-fecha">Fecha del préstamo *</label>
                <input id="alta-fecha" name="anticipo-fecha" className="input" type="date" max={hoy} value={form.fecha ?? hoy} required
                  onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))} />
                {historicoForm && <small className="muted">El día en que se dio, aunque sea de hace meses.</small>}
              </div>

              {/* Aviso si ya tiene un préstamo activo al que se sumará */}
              {prestamoActivoExistente && !historicoForm && (
                <div className="aviso info" style={{ gridColumn: '1 / -1', marginBottom: '.35rem', fontSize: '.84rem' }}>
                  <span className="aviso-icono">💡</span>
                  <div>
                    <strong>Este trabajador ya tiene un préstamo activo debiendo {money(prestamoActivoExistente.saldo)}</strong> (total prestado anterior: {money(prestamoActivoExistente.monto_total)}).
                    <div style={{ marginTop: '.25rem' }}>
                      El monto que registres abajo se <strong>sumará al préstamo existente</strong> y se registrarán ambas fechas de entrega.
                      {Number(form.monto_total) > 0 && monedaForm === 'USD' && (
                        <span> Nuevo total acumulado: <strong>{money(Number(prestamoActivoExistente.monto_total) + Number(form.monto_total))}</strong> · Nuevo saldo pendiente: <strong>{money(Number(prestamoActivoExistente.saldo) + Number(form.monto_total))}</strong>.</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {monedaForm === 'USD' ? (
                <div className="form-row">
                  <label htmlFor="alta-monto">Monto total (USD) *</label>
                  <input id="alta-monto" name="anticipo-monto-total" className="input mono" type="number" min={0} step="any" value={form.monto_total || ''} required
                    onChange={(e) => setForm((f) => ({ ...f, monto_total: Number(e.target.value) || 0 }))} placeholder="0,00" />
                </div>
              ) : (
                <>
                  <div className="form-row">
                    <label htmlFor="alta-monto-orig">Monto a entregar ({simboloMoneda(monedaForm)}) *</label>
                    <input id="alta-monto-orig" name="anticipo-monto-original" className="input mono" type="number" min={0} step="any" value={montoMonedaForm ?? ''} required
                      onChange={(e) => setMontoMonedaForm(e.target.value === '' ? null : Number(e.target.value))} placeholder="0,00" />
                  </div>
                  <div className="form-row">
                    <label htmlFor="alta-tasa">Tasa de cambio ({simboloMoneda(monedaForm)} por $) *</label>
                    <input id="alta-tasa" name="anticipo-tasa-cambio" className="input mono" type="number" min={0} step="any" value={tasaCambioForm ?? ''} required
                      onChange={(e) => setTasaCambioForm(e.target.value === '' ? null : Number(e.target.value))} placeholder={(monedaForm === 'Bs' || monedaForm === 'VES') && tasaBcv ? String(tasaBcv) : '0,00'} />
                    {(monedaForm === 'Bs' || monedaForm === 'VES') && tasaBcv && (
                      <small className="muted">Tasa sugerida hoy: {tasaBcv.toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs/$</small>
                    )}
                  </div>
                  <div className="aviso success" style={{ gridColumn: '1 / -1' }}>
                    <span className="aviso-icono">💱</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: '.75rem', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 }}>Conversión en $ al cambio</span>
                      <div className="mono" style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                        $ {convertirMonedaAUsd(montoMonedaForm || 0, monedaForm, tasaCambioForm || ((monedaForm === 'Bs' || monedaForm === 'VES') ? tasaBcv : null)).montoUsd.toFixed(2)} USD
                      </div>
                      <div className="muted" style={{ fontSize: '.8rem' }}>
                        {montoMonedaForm ? `${simboloMoneda(monedaForm)} ${Number(montoMonedaForm).toLocaleString('es-VE', { minimumFractionDigits: 2 })}` : '0,00'} @ {tasaCambioForm || ((monedaForm === 'Bs' || monedaForm === 'VES') ? tasaBcv : '—')}
                      </div>
                    </div>
                  </div>
                </>
              )}
              <div className="form-row">
                <label htmlFor="alta-cuota">Cuota sugerida por quincena</label>
                <input id="alta-cuota" name="anticipo-cuota-sugerida" className="input mono" type="number" min={0} step="any" value={form.cuota_sugerida ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, cuota_sugerida: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="0,00" />
              </div>
              {historicoForm && (
                <>
                  <div className="form-row">
                    <label htmlFor="alta-abonado">Ya abonado hasta hoy (USD)</label>
                    <input id="alta-abonado" name="anticipo-abonado" className="input mono" type="number" min={0} step="any" value={form.ya_pagado ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, ya_pagado: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="0,00" />
                    <small className="muted">
                      {Number(form.monto_total) > 0
                        ? `Queda debiendo ${money(Math.max(0, Number(form.monto_total) - Number(form.ya_pagado ?? 0)))}`
                        : 'Lo que ya pagó antes de cargarlo aquí; queda como un abono «histórico».'}
                    </small>
                  </div>
                  <div className="form-row">
                    <label htmlFor="alta-fabono">Abonado hasta (fecha)</label>
                    <input id="alta-fabono" name="anticipo-fecha-abono" className="input" type="date" max={hoy} value={form.fecha_abono ?? hoy}
                      onChange={(e) => setForm((f) => ({ ...f, fecha_abono: e.target.value }))} />
                  </div>
                </>
              )}
              <div className="form-row" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="alta-motivo">Motivo</label>
                <input id="alta-motivo" name="anticipo-motivo" className="input" value={form.motivo ?? ''} onChange={(e) => setForm((f) => ({ ...f, motivo: e.target.value }))}
                  placeholder="Adelanto de quincena, préstamo personal…" />
              </div>
            </div>
            <p className="muted" style={{ fontSize: '.82rem', marginTop: '.6rem', marginBottom: 0 }}>
              El saldo se descuenta automáticamente al pagar la nómina, hasta saldar. Los pagos por fuera se registran como abono desde el detalle del préstamo.
            </p>
          </form>
        </Modal>
      )}

      {/* ── Detalle de las tarjetas ── */}
      {verPendientes && (
        <PendientesModal
          prestamos={baseKpi.filter((p) => Number(p.saldo) > 0)}
          pagosDe={pagosDe} nombreDe={nombreDe} personaPorId={personaPorId}
          total={resumen.totalPendiente} filtrosTxt={textoFiltros()}
          generando={generandoPdf}
          onClose={() => setVerPendientes(false)}
          onAbrir={(a) => { setVerPendientes(false); setDetalle(a); }}
          onPdf={() => void verConsolidado(deudas.filter((d) => d.debe > 0))}
        />
      )}

      {verTrabajadores && (
        <TrabajadoresModal
          deudas={deudas.filter((d) => d.debe > 0)}
          prestamos={baseKpi} pagosDe={pagosDe} personaPorId={personaPorId}
          generando={generandoPdf}
          onClose={() => setVerTrabajadores(false)}
          onAbrir={(a) => { setVerTrabajadores(false); setDetalle(a); }}
          onPdf={(p) => void verEstadoCuenta(p)}
        />
      )}

      {/* ── Abonos de un préstamo ── */}
      {detalle && (
        <AbonosModal
          prestamo={detalle}
          persona={personaPorId.get(detalle.personal_id)}
          pagos={pagosDe.get(detalle.id) ?? []}
          nombre={nombreDe(detalle.personal_id)}
          tasaBcv={tasaBcv}
          canWrite={canWrite} actor={actor} actorName={actorName}
          onClose={() => setDetalle(null)}
          onCambio={() => void recargar()}
        />
      )}

      {/* ── Estado de cuenta de una persona ── */}
      {cuentaDe && personaPorId.get(cuentaDe) && (
        <EstadoCuentaModal
          persona={personaPorId.get(cuentaDe)!}
          prestamos={lista}
          pagos={pagos}
          rango={{ desde: filtro.desde, hasta: filtro.hasta }}
          onAbrirPrestamo={(a) => { setCuentaDe(null); setDetalle(a); }}
          onClose={() => setCuentaDe(null)}
        />
      )}

      {porBorrar && (
        <ConfirmDialog
          title={porBorrar.tipo === 'anticipo' ? 'Eliminar anticipo' : 'Eliminar préstamo'}
          danger
          confirmText="Sí, eliminar"
          message={Number(porBorrar.saldo) < Number(porBorrar.monto_total)
            ? <>Este registro <strong>ya tiene abonos</strong> (descuentos de nómina o pagos). Al eliminarlo se borran también sus abonos y lo que falta deja de restarse en los próximos pagos.</>
            : <>Se elimina el registro. Lo que falta por descontar deja de restarse en los próximos pagos de nómina.</>}
          preview={
            <VistaPrevia titulo="Se va a eliminar">
              <Dato label="Trabajador">{nombreDe(porBorrar.personal_id)}</Dato>
              <Dato label="Tipo">{etiquetaTipo(porBorrar.tipo)}{esHistoricoFila(porBorrar) ? ' · histórico' : ''}</Dato>
              <Dato label="Fecha"><span className="mono">{date(fechaDePrestamo(porBorrar))}</span></Dato>
              <Dato label="Motivo">{porBorrar.motivo || undefined}</Dato>
              <Dato label="Monto total"><span className="mono">{money(porBorrar.monto_total)}</span></Dato>
              <Dato label="Ya pagado"><span className="mono">{money(Math.max(0, (Number(porBorrar.monto_total) || 0) - (Number(porBorrar.saldo) || 0)))}</span></Dato>
              <Dato label="Saldo pendiente"><strong className="mono">{money(porBorrar.saldo)}</strong></Dato>
            </VistaPrevia>
          }
          onConfirm={() => void confirmarBorrado()}
          onCancel={() => setPorBorrar(null)} />
      )}
    </div>
  );
}

/** Se dio antes del día en que se cargó (la misma regla del filtro «Origen»). */
function esHistoricoFila(p: AnticipoPrestamo): boolean {
  const dado = fechaDePrestamo(p);
  const cargado = (p.created_at ?? '').slice(0, 10);
  return !!dado && !!cargado && dado < cargado;
}

/* ───────────────────── Piezas ───────────────────── */

/** El detalle de la tarjeta de pendientes: cada préstamo abierto, clickeable. */
function PendientesModal({ prestamos, pagosDe, nombreDe, personaPorId, total, filtrosTxt, generando, onClose, onAbrir, onPdf }: {
  prestamos: AnticipoPrestamo[];
  pagosDe: Map<string, { monto: number }[]>;
  nombreDe: (id: string) => string;
  personaPorId: Map<string, Personal>;
  total: number; filtrosTxt: string; generando: boolean;
  onClose: () => void; onAbrir: (a: AnticipoPrestamo) => void; onPdf: () => void;
}) {
  const [q, setQ] = useState('');
  const orden = useMemo(() => {
    const t = q.trim().toLowerCase();
    const f = !t ? prestamos : prestamos.filter((a) => {
      const p = personaPorId.get(a.personal_id);
      return `${nombreDe(a.personal_id)} ${p?.cedula ?? ''} ${p?.numero_ficha ?? ''} ${a.motivo ?? ''}`.toLowerCase().includes(t);
    });
    return [...f].sort((a, b) => (Number(b.saldo) || 0) - (Number(a.saldo) || 0));
  }, [prestamos, personaPorId, nombreDe, q]);

  return (
    <Modal title="💰 Préstamos pendientes" size="lg" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onPdf} disabled={generando || !prestamos.length}>{generando ? 'Generando…' : '↓ PDF'}</button>
        <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
      </>}>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.7rem' }}>
        <div className="tira danger" style={{ flex: '1 1 160px' }}>
          <div className="tira-titulo">Total pendiente</div>
          <div className="tira-valor mono">{money(total)}</div>
        </div>
        <div className="tira" style={{ flex: '1 1 160px' }}>
          <div className="tira-titulo">Préstamos con saldo</div>
          <div className="tira-valor mono">{prestamos.length}</div>
        </div>
        <div className="tira" style={{ flex: '2 1 220px' }}>
          <div className="tira-titulo">Filtros aplicados</div>
          <div className="tira-valor" style={{ fontSize: '.85rem', fontWeight: 500 }}>{filtrosTxt}</div>
        </div>
      </div>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Buscar por trabajador, cédula, ficha o motivo…" style={{ marginBottom: '.5rem' }} />
      {!orden.length && <EmptyState icon="✅" message={q ? 'Nada coincide con la búsqueda' : 'Nadie debe nada con estos filtros'} />}
      {!!orden.length && (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.84rem' }}>
            <thead><tr><th>Trabajador</th><th>Tipo</th><th>Fecha</th><th>Motivo</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Pagado</th><th style={{ textAlign: 'right' }}>Debe</th><th /></tr></thead>
            <tbody>
              {orden.map((a) => {
                const p = personaPorId.get(a.personal_id);
                const pagado = (pagosDe.get(a.id) ?? []).reduce((s, g) => s + (Number(g.monto) || 0), 0);
                return (
                  <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => onAbrir(a)} title="Ver detalle y abonos">
                    <td>{nombreDe(a.personal_id)}{p?.numero_ficha && <div className="muted" style={{ fontSize: '.74rem' }}>Ficha {p.numero_ficha}</div>}</td>
                    <td><span className="badge">{etiquetaTipo(a.tipo)}</span>{esHistoricoFila(a) ? ' 📜' : ''}</td>
                    <td className="mono">{date(fechaDePrestamo(a))}</td>
                    <td className="muted">{a.motivo || '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(a.monto_total)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--success)' }}>{money(pagado)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--danger)', fontWeight: 600 }}>{money(a.saldo)}</td>
                    <td style={{ textAlign: 'center' }}><button className="btn btn-sm btn-ghost" title="Detalle">🔍</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/** El detalle de la tarjeta de trabajadores: la lista buscable de quién debe y, al tocar uno, sus préstamos. */
function TrabajadoresModal({ deudas, prestamos, pagosDe, personaPorId, generando, onClose, onAbrir, onPdf }: {
  deudas: DeudaTrabajador[];
  prestamos: AnticipoPrestamo[];
  pagosDe: Map<string, { monto: number }[]>;
  personaPorId: Map<string, Personal>;
  generando: boolean;
  onClose: () => void; onAbrir: (a: AnticipoPrestamo) => void; onPdf: (p: Personal) => void;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [verSaldados, setVerSaldados] = useState(false);

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return deudas;
    return deudas.filter((d) => {
      const p = personaPorId.get(d.personalId);
      return `${d.nombre} ${p?.cedula ?? ''} ${p?.cargo ?? ''} ${p?.departamento ?? ''} ${p?.numero_ficha ?? ''}`.toLowerCase().includes(t);
    });
  }, [deudas, personaPorId, q]);
  const totalDeuda = useMemo(() => deudas.reduce((s, d) => s + d.debe, 0), [deudas]);

  const persona = sel ? personaPorId.get(sel) : undefined;
  if (sel && persona) {
    // La ficha completa del trabajador elegido: TODOS sus préstamos (con el
    // interruptor de saldados), no solo los que deben.
    const suyos = prestamos
      .filter((a) => a.personal_id === sel && (verSaldados || (Number(a.saldo) || 0) > 0))
      .sort((a, b) => fechaDePrestamo(b).localeCompare(fechaDePrestamo(a)));
    const todos = prestamos.filter((a) => a.personal_id === sel);
    const prestado = todos.reduce((s, a) => s + (Number(a.monto_total) || 0), 0);
    const pagado = todos.reduce((s, a) => s + (pagosDe.get(a.id) ?? []).reduce((x, g) => x + (Number(g.monto) || 0), 0), 0);
    const debe = todos.reduce((s, a) => s + (Number(a.saldo) || 0), 0);
    return (
      <Modal title={`👤 ${nombreDeCarnet(persona.nombre, persona.apellido)}`} size="lg" onClose={onClose}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setSel(null)}>← Volver a la lista</button>
          <button className="btn btn-ghost" onClick={() => onPdf(persona)} disabled={generando || !todos.length}
            title="Estado de cuenta: total de préstamos, total pagado y lo que debe">{generando ? 'Generando…' : '↓ PDF estado de cuenta'}</button>
          <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
        </>}>
        <div className="muted" style={{ fontSize: '.85rem', marginBottom: '.6rem' }}>
          {[persona.numero_ficha ? `Ficha ${persona.numero_ficha}` : '', persona.cedula ? `C.I. ${persona.cedula}` : '', persona.cargo, persona.departamento, persona.activo ? '' : 'Inactivo'].filter(Boolean).join(' · ')}
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.7rem' }}>
          <div className="tira" style={{ flex: '1 1 140px' }}><div className="tira-titulo">Total préstamos</div><div className="tira-valor mono">{money(prestado)}</div></div>
          <div className="tira" style={{ flex: '1 1 140px' }}><div className="tira-titulo">Total pagado</div><div className="tira-valor mono" style={{ color: 'var(--success)' }}>{money(pagado)}</div></div>
          <div className={`tira${debe > 0 ? ' danger' : ''}`} style={{ flex: '1 1 140px' }}><div className="tira-titulo">Lo que debe</div><div className="tira-valor mono">{money(debe)}</div></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '.4rem' }}>
          <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.85rem' }}>
            <input type="checkbox" checked={verSaldados} onChange={(e) => setVerSaldados(e.target.checked)} /> Mostrar saldados
          </label>
        </div>
        {!suyos.length && <EmptyState icon="💵" message="Sin préstamos para mostrar" />}
        {!!suyos.length && (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.84rem' }}>
              <thead><tr><th>Fecha</th><th>Tipo</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Pagado</th><th style={{ textAlign: 'right' }}>Debe</th><th style={{ textAlign: 'center' }}>Estado</th><th /></tr></thead>
              <tbody>
                {suyos.map((a) => {
                  const pag = (pagosDe.get(a.id) ?? []).reduce((s, g) => s + (Number(g.monto) || 0), 0);
                  const conSaldo = Number(a.saldo) > 0;
                  return (
                    <tr key={a.id} style={{ cursor: 'pointer', opacity: conSaldo ? 1 : 0.65 }} onClick={() => onAbrir(a)} title="Ver detalle y abonos">
                      <td className="mono">{date(fechaDePrestamo(a))}</td>
                      <td><span className="badge">{etiquetaTipo(a.tipo)}</span>{esHistoricoFila(a) ? ' 📜' : ''}</td>
                      <td className="muted">{a.motivo || '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{money(a.monto_total)}</td>
                      <td className="mono" style={{ textAlign: 'right', color: 'var(--success)' }}>{money(pag)}</td>
                      <td className="mono" style={{ textAlign: 'right', color: conSaldo ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>{money(a.saldo)}</td>
                      <td style={{ textAlign: 'center' }}><span className={`lt-pill ${conSaldo ? 'ambar' : 'verde'}`}>{conSaldo ? 'Activo' : 'Saldado'}</span></td>
                      <td style={{ textAlign: 'center' }}><button className="btn btn-sm btn-ghost" title="Detalle">🔍</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal title="👥 Trabajadores con préstamos pendientes" size="lg" onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.7rem' }}>
        <div className="tira" style={{ flex: '1 1 160px' }}><div className="tira-titulo">Trabajadores que deben</div><div className="tira-valor mono">{deudas.length}</div></div>
        <div className="tira danger" style={{ flex: '1 1 160px' }}><div className="tira-titulo">Deuda total</div><div className="tira-valor mono">{money(totalDeuda)}</div></div>
      </div>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Buscar por nombre, cédula, ficha, cargo o departamento…" style={{ marginBottom: '.5rem' }} autoFocus />
      {!filtradas.length && <EmptyState icon="✅" message={q ? 'Nadie coincide con la búsqueda' : 'Nadie debe nada con estos filtros'} />}
      {!!filtradas.length && (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.84rem' }}>
            <thead><tr><th>Trabajador</th><th>Cargo</th><th style={{ textAlign: 'center' }}>Préstamos</th><th>Desde</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Pagado</th><th style={{ textAlign: 'right' }}>Debe</th><th /></tr></thead>
            <tbody>
              {filtradas.map((d) => {
                const p = personaPorId.get(d.personalId);
                return (
                  <tr key={d.personalId} style={{ cursor: 'pointer' }} onClick={() => setSel(d.personalId)} title="Ver sus préstamos">
                    <td>
                      {d.nombre}
                      <div className="muted" style={{ fontSize: '.74rem' }}>{[p?.numero_ficha ? `Ficha ${p.numero_ficha}` : '', p?.cedula ? `C.I. ${p.cedula}` : ''].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="muted">{p?.cargo || <span style={{ color: 'var(--warning)' }}>Sin cargo</span>}{p?.departamento ? <div style={{ fontSize: '.74rem' }}>{p.departamento}</div> : null}</td>
                    <td style={{ textAlign: 'center' }}>{d.abiertos}</td>
                    <td className="muted mono">{d.desde ? date(d.desde) : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(d.total)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--success)' }}>{money(d.pagado)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--danger)', fontWeight: 600 }}>{money(d.debe)}</td>
                    <td style={{ textAlign: 'center' }}><button className="btn btn-sm btn-ghost" title="Ver sus préstamos">→</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/** Los abonos de UN préstamo: los que hay, y el formulario para cargar otro. */
function AbonosModal({ prestamo, pagos, nombre, persona, tasaBcv, canWrite, actor, actorName, onClose, onCambio }: {
  prestamo: AnticipoPrestamo;
  pagos: PagoAnticipo[];
  nombre: string;
  persona?: Personal | null;
  tasaBcv?: number | null;
  canWrite: boolean; actor: string; actorName: string | null;
  onClose: () => void; onCambio: () => void;
}) {
  const [monto, setMonto] = useState('');
  const [monedaAbono, setMonedaAbono] = useState<MonedaPagoRrhh>('USD');
  const [montoMonedaAbono, setMontoMonedaAbono] = useState('');
  const [tasaAbono, setTasaAbono] = useState('');
  const [fecha, setFecha] = useState(hoyIso());
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [porBorrar, setPorBorrar] = useState<PagoAnticipo | null>(null);
  const [editando, setEditando] = useState(false);
  const [edFecha, setEdFecha] = useState(fechaDePrestamo(prestamo));
  const [edMonto, setEdMonto] = useState(String(prestamo.monto_total ?? ''));
  const [edMotivo, setEdMotivo] = useState(prestamo.motivo ?? '');

  const [editandoPago, setEditandoPago] = useState<PagoAnticipo | null>(null);
  const [edPagoMonto, setEdPagoMonto] = useState('');
  const [edPagoFecha, setEdPagoFecha] = useState('');
  const [edPagoOrigen, setEdPagoOrigen] = useState<'manual' | 'historico' | 'nomina'>('manual');
  const [edPagoNota, setEdPagoNota] = useState('');

  const pagado = pagos.reduce((a, p) => a + (Number(p.monto) || 0), 0);
  const debe = Number(prestamo.saldo) || 0;
  const entregas = useMemo(() => obtenerEntregas(prestamo), [prestamo]);

  async function imprimirReciboEntrega() {
    if (!persona) return;
    try {
      await verReciboPrestamoPdf({
        tipo: 'entrega',
        persona,
        prestamo,
        montoUsd: Number(prestamo.monto_total) || 0,
        fecha: fechaDePrestamo(prestamo),
        moneda: prestamo.moneda,
        montoOriginal: prestamo.monto_original,
        tasaCambio: prestamo.tasa_cambio,
        motivo: prestamo.motivo,
        saldoRestante: Number(prestamo.saldo) || 0,
      });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el recibo', 'error'); }
  }

  async function imprimirReciboAbono(p: PagoAnticipo) {
    if (!persona) return;
    try {
      await verReciboPrestamoPdf({
        tipo: 'abono',
        persona,
        prestamo,
        montoUsd: Number(p.monto) || 0,
        fecha: p.fecha,
        moneda: p.moneda,
        montoOriginal: p.monto_original,
        tasaCambio: p.tasa_cambio,
        motivo: p.nota,
        saldoRestante: Math.max(0, (Number(prestamo.saldo) || 0) - (Number(p.monto) || 0)),
      });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el recibo', 'error'); }
  }

  function iniciarEdicionPago(p: PagoAnticipo) {
    setEditandoPago(p);
    setEdPagoMonto(String(p.monto ?? ''));
    setEdPagoFecha(p.fecha ? p.fecha.slice(0, 10) : hoyIso());
    setEdPagoOrigen(p.origen);
    setEdPagoNota(p.nota ?? '');
    setErr(null);
  }

  async function guardarEdicionPago(e: FormEvent) {
    e.preventDefault();
    if (!editandoPago) return;
    const nuevoM = Number(edPagoMonto);
    if (!Number.isFinite(nuevoM) || nuevoM <= 0) {
      setErr('El abono tiene que ser mayor que 0.');
      return;
    }
    const disponibleParaEste = debe + (Number(editandoPago.monto) || 0);
    const malo = errorPago(nuevoM, disponibleParaEste, edPagoFecha);
    if (malo) { setErr(malo); return; }

    setBusy(true); setErr(null);
    try {
      await editarPagoAnticipo(editandoPago.id, {
        monto: nuevoM,
        fecha: edPagoFecha,
        origen: edPagoOrigen,
        nota: edPagoNota,
      }, actor, actorName);
      setEditandoPago(null);
      toast('Abono editado y sincronizado', 'success');
      onCambio();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'No se pudo editar el abono');
    } finally {
      setBusy(false);
    }
  }

  async function guardarEdicion(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await editarAnticipo(prestamo.id, {
        fecha: edFecha, monto_total: Number(edMonto) || 0, motivo: edMotivo,
      });
      setEditando(false);
      toast('Préstamo corregido', 'success');
      onCambio();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'No se pudo corregir'); }
    finally { setBusy(false); }
  }

  async function agregar(e: FormEvent) {
    e.preventDefault();
    let montoUsd = Number(monto) || 0;
    if (monedaAbono !== 'USD') {
      const orig = Number(montoMonedaAbono) || 0;
      if (orig <= 0) { setErr(`Indicá el monto del abono en ${etiquetaMonedaPago(monedaAbono)}.`); return; }
      const tasa = Number(tasaAbono) || (monedaAbono === 'VES' ? tasaBcv : null);
      if (!tasa || tasa <= 0) { setErr('Indicá una tasa de cambio válida para la conversión.'); return; }
      montoUsd = convertirMonedaAUsd(orig, monedaAbono, tasa).montoUsd;
    }
    const malo = errorPago(montoUsd, debe, fecha);
    if (malo) { setErr(malo); return; }
    setBusy(true); setErr(null);
    try {
      await agregarPagoAnticipo({
        anticipo_id: prestamo.id,
        monto: montoUsd,
        fecha,
        origen: fecha < hoyIso() ? 'historico' : 'manual',
        nota,
        moneda: monedaAbono,
        monto_original: monedaAbono === 'USD' ? montoUsd : Number(montoMonedaAbono),
        tasa_cambio: monedaAbono === 'USD' ? null : (Number(tasaAbono) || (monedaAbono === 'VES' ? tasaBcv : null)),
      }, actor, actorName);
      setMonto(''); setMontoMonedaAbono(''); setTasaAbono(''); setNota(''); setFecha(hoyIso());
      toast('Abono cargado con éxito', 'success');
      onCambio();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'No se pudo cargar el abono'); }
    finally { setBusy(false); }
  }

  async function borrar() {
    if (!porBorrar) return;
    try { await eliminarPagoAnticipo(porBorrar); setPorBorrar(null); toast('Abono borrado', 'success'); onCambio(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error'); setPorBorrar(null); }
  }

  return (
    <Modal title={`Abonos · ${nombre}`} size="lg" onClose={onClose}
      footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.7rem' }}>
        <div className="tira" style={{ flex: '1 1 140px' }}>
          <div className="tira-titulo">Total del préstamo</div>
          <div className="tira-valor mono">{money(prestamo.monto_total)}</div>
        </div>
        <div className="tira" style={{ flex: '1 1 140px' }}>
          <div className="tira-titulo">Total pagado</div>
          <div className="tira-valor mono" style={{ color: 'var(--success)' }}>{money(pagado)}</div>
        </div>
        <div className={`tira${debe > 0 ? ' danger' : ''}`} style={{ flex: '1 1 140px' }}>
          <div className="tira-titulo">Lo que debe</div>
          <div className="tira-valor mono">{money(debe)}</div>
        </div>
        <div className="tira" style={{ flex: '1 1 140px' }}>
          <div className="tira-titulo">Estado</div>
          <div className="tira-valor" style={{ color: debe > 0 ? 'var(--warning)' : 'var(--success)' }}>{debe > 0 ? 'Activo' : 'Saldado'}</div>
        </div>
      </div>

      <div className="card" style={{ padding: '.6rem .8rem', marginBottom: '.7rem', background: 'var(--bg-1)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'baseline' }}>
          <div className="mono" style={{ fontSize: '.9rem' }}>
            {prestamo.tipo === 'anticipo' ? 'Anticipo' : 'Préstamo'} de <strong>{nombre}</strong>{persona?.numero_ficha ? ` · Ficha ${persona.numero_ficha}` : ''}{persona?.cedula ? ` · C.I. ${persona.cedula}` : ''} del <strong>{date(fechaDePrestamo(prestamo))}</strong>
            {prestamo.cuota_sugerida != null && <> · cuota sugerida {money(prestamo.cuota_sugerida)}</>}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '.35rem' }}>
            {persona && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void imprimirReciboEntrega()} title="Imprimir recibo / comprobante de entrega en PDF">
                📄 Recibo entrega
              </button>
            )}
            {canWrite && !editando && (
              <button className="btn btn-sm btn-ghost" onClick={() => setEditando(true)}>✎ Corregir</button>
            )}
          </div>
        </div>
        {prestamo.motivo && !editando && <div className="muted" style={{ fontSize: '.82rem', marginTop: '.2rem' }}>{entregas[0]?.motivo || prestamo.motivo}</div>}

        {editando && (
          <form onSubmit={guardarEdicion} style={{ marginTop: '.5rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'flex-end' }}>
              <div className="form-row" style={{ flex: '0 1 160px', margin: 0 }}>
                <label>Fecha en que se dio</label>
                <input className="input" type="date" max={hoyIso()} value={edFecha} onChange={(e) => setEdFecha(e.target.value)} />
              </div>
              <div className="form-row" style={{ flex: '0 1 150px', margin: 0 }}>
                <label>Monto total</label>
                <input className="input mono" type="number" min={0} step="any" value={edMonto} onChange={(e) => setEdMonto(e.target.value)} />
              </div>
              <div className="form-row" style={{ flex: '1 1 200px', margin: 0 }}>
                <label>Motivo</label>
                <input className="input" value={edMotivo} onChange={(e) => setEdMotivo(e.target.value)} />
              </div>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Guardar</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setEditando(false); setErr(null); }}>Cancelar</button>
            </div>
            <small className="hint muted">El monto no puede quedar por debajo de lo ya abonado ({money(pagado)}).</small>
          </form>
        )}
      </div>

      {entregas.length > 1 && !editando && (
        <div style={{ marginTop: '.8rem', marginBottom: '.8rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textTransform: 'uppercase', fontSize: '.84rem', letterSpacing: '.04em' }}>
            <span>HISTORIAL DE ENTREGAS DEL PRÉSTAMO <span className="badge">{entregas.length}</span></span>
            <span className="mono" style={{ fontSize: '.86rem', fontWeight: 700 }}>TOTAL: {money(prestamo.monto_total)}</span>
          </div>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.84rem' }}>
              <thead>
                <tr>
                  <th style={{ textTransform: 'uppercase', fontSize: '.76rem', letterSpacing: '.04em' }}>Fecha entrega</th>
                  <th style={{ textTransform: 'uppercase', fontSize: '.76rem', letterSpacing: '.04em' }}>Concepto / Motivo de la entrega</th>
                  <th style={{ textAlign: 'right', textTransform: 'uppercase', fontSize: '.76rem', letterSpacing: '.04em' }}>Monto entregado</th>
                </tr>
              </thead>
              <tbody>
                {entregas.map((e, idx) => (
                  <tr key={idx}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{date(e.fecha)}</td>
                    <td className="muted">{e.motivo || '—'}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{money(e.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Fuera de los dos formularios: un error al corregir con el préstamo ya
          saldado no tendría dónde mostrarse, porque el de abonar no se dibuja. */}
      {err && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.5rem' }}><strong>Error:</strong> {err}</div>}

      {canWrite && debe > 0 && (
        <form onSubmit={agregar} style={{ marginBottom: '.8rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'flex-end' }}>
            <div className="form-row" style={{ flex: '0 1 130px', margin: 0 }}>
              <label>Moneda</label>
              <select className="select" value={monedaAbono} onChange={(e) => {
                const m = e.target.value as MonedaPagoRrhh;
                setMonedaAbono(m);
                if (m === 'VES' && tasaBcv && !tasaAbono) setTasaAbono(String(tasaBcv));
              }}>
                {MONEDAS_PAGO_RRHH.map((m) => (
                  <option key={m} value={m}>{etiquetaMonedaPago(m)}</option>
                ))}
              </select>
            </div>
            {monedaAbono === 'USD' ? (
              <div className="form-row" style={{ flex: '0 1 140px', margin: 0 }}>
                <label>Monto (USD)</label>
                <input className="input mono" type="number" min={0} step="any" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0,00" required />
              </div>
            ) : (
              <>
                <div className="form-row" style={{ flex: '0 1 140px', margin: 0 }}>
                  <label>Monto ({simboloMoneda(monedaAbono)})</label>
                  <input className="input mono" type="number" min={0} step="any" value={montoMonedaAbono} onChange={(e) => setMontoMonedaAbono(e.target.value)} placeholder="0,00" required />
                </div>
                <div className="form-row" style={{ flex: '0 1 120px', margin: 0 }}>
                  <label>Tasa ({simboloMoneda(monedaAbono)}/$)</label>
                  <input className="input mono" type="number" min={0} step="any" value={tasaAbono} onChange={(e) => setTasaAbono(e.target.value)} placeholder={monedaAbono === 'VES' && tasaBcv ? String(tasaBcv) : '0,00'} required />
                </div>
              </>
            )}
            <div className="form-row" style={{ flex: '0 1 150px', margin: 0 }}>
              <label>Fecha</label>
              <input className="input" type="date" max={hoyIso()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="form-row" style={{ flex: '1 1 200px', margin: 0 }}>
              <label>Nota (opcional)</label>
              <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Efectivo, transferencia…" />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? '…' : '+ Abonar'}</button>
          </div>
          {monedaAbono !== 'USD' && (
            <div className="card" style={{ marginTop: '.4rem', background: 'rgba(40, 150, 90, 0.08)', borderLeft: '4px solid var(--success)', padding: '.45rem .65rem' }}>
              <span style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--success)' }}>
                Conversión en $ al cambio: <strong>$ {convertirMonedaAUsd(Number(montoMonedaAbono) || 0, monedaAbono, Number(tasaAbono) || (monedaAbono === 'VES' ? tasaBcv : null)).montoUsd.toFixed(2)} USD</strong> (Máximo a deber: {money(debe)})
              </span>
            </div>
          )}
          <small className="hint muted">Con una fecha anterior queda marcado como carga histórica. Máximo {money(debe)}.</small>
        </form>
      )}

      {canWrite && editandoPago && (
        <form onSubmit={guardarEdicionPago} className="card" style={{ padding: '.6rem .8rem', marginBottom: '.8rem', background: 'var(--bg-2)', borderColor: 'var(--primary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.4rem' }}>
            <strong style={{ fontSize: '.88rem' }}>✎ Editar movimiento de abono</strong>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setEditandoPago(null); setErr(null); }}>✕</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'flex-end' }}>
            <div className="form-row" style={{ flex: '0 1 140px', margin: 0 }}>
              <label>Monto</label>
              <input className="input mono" type="number" min={0} step="any" value={edPagoMonto} onChange={(e) => setEdPagoMonto(e.target.value)} required />
            </div>
            <div className="form-row" style={{ flex: '0 1 150px', margin: 0 }}>
              <label>Fecha</label>
              <input className="input" type="date" max={hoyIso()} value={edPagoFecha} onChange={(e) => setEdPagoFecha(e.target.value)} required />
            </div>
            <div className="form-row" style={{ flex: '0 1 160px', margin: 0 }}>
              <label>Origen</label>
              <select className="input" value={edPagoOrigen} onChange={(e) => setEdPagoOrigen(e.target.value as 'manual' | 'historico' | 'nomina')}>
                <option value="manual">Abono directo</option>
                <option value="historico">Carga histórica</option>
                <option value="nomina">Descuento de nómina</option>
              </select>
            </div>
            <div className="form-row" style={{ flex: '1 1 200px', margin: 0 }}>
              <label>Nota</label>
              <input className="input" value={edPagoNota} onChange={(e) => setEdPagoNota(e.target.value)} placeholder="Nota / referencia…" />
            </div>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? '…' : 'Guardar y sincronizar'}</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setEditandoPago(null); setErr(null); }}>Cancelar</button>
          </div>
          <small className="hint muted">Al guardar se actualiza el movimiento y se sincroniza automáticamente el saldo del préstamo.</small>
        </form>
      )}

      <div className="card-title" style={{ margin: '.8rem 0 .4rem', textTransform: 'uppercase', fontSize: '.84rem', letterSpacing: '.04em' }}>
        ABONOS <span className="badge">{pagos.length}</span>
      </div>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.84rem' }}>
          <thead>
            <tr>
              <th style={{ textTransform: 'uppercase', fontSize: '.76rem', letterSpacing: '.04em' }}>Fecha</th>
              <th style={{ textTransform: 'uppercase', fontSize: '.76rem', letterSpacing: '.04em' }}>Origen</th>
              <th style={{ textTransform: 'uppercase', fontSize: '.76rem', letterSpacing: '.04em' }}>Nota</th>
              <th style={{ textAlign: 'right', textTransform: 'uppercase', fontSize: '.76rem', letterSpacing: '.04em' }}>Monto</th>
              <th style={{ textTransform: 'uppercase', fontSize: '.76rem', letterSpacing: '.04em' }}>Cargado</th>
              {canWrite && <th style={{ textAlign: 'center', textTransform: 'uppercase', fontSize: '.76rem', letterSpacing: '.04em' }}>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {!pagos.length && <tr><td colSpan={6}><EmptyState message="Todavía no se abonó nada" icon="💵" /></td></tr>}
            {pagos.map((p) => (
              <tr key={p.id}>
                <td className="mono muted">{date(p.fecha)}</td>
                <td><span className="badge">{labelOrigen(p.origen)}</span></td>
                <td className="muted">{p.nota || '—'}</td>
                <td className="mono" style={{ textAlign: 'right', color: 'var(--success)' }}>
                  {money(p.monto)}
                  {p.moneda && p.moneda !== 'USD' && p.monto_original ? (
                    <div className="muted" style={{ fontSize: '.72rem' }}>
                      {p.moneda} {Number(p.monto_original).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                    </div>
                  ) : null}
                </td>
                <td className="muted" style={{ fontSize: '.76rem' }}>
                  {dateTime(p.created_at)}
                  {(p.actor_name || p.actor) && <div style={{ fontWeight: 600 }}>{p.actor_name || p.actor}</div>}
                </td>
                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                  {persona && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => void imprimirReciboAbono(p)} title="Ver recibo de pago / abono en PDF" style={{ marginRight: '.25rem' }}>📄</button>
                  )}
                  {canWrite && (
                    <>
                      <button className="btn btn-sm btn-ghost" onClick={() => iniciarEdicionPago(p)} title="Editar movimiento (monto, fecha, origen, nota)" style={{ marginRight: '.25rem' }}>✏</button>
                      {p.origen === 'nomina'
                        ? <span className="muted" title="Se revierte anulando el pago de la nómina" style={{ fontSize: '.78rem', marginLeft: '.3rem' }}>de nómina</span>
                        : <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setPorBorrar(p)} title="Borrar abono">🗑</button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {porBorrar && (
        <ConfirmDialog
          title="Borrar abono"
          message={`¿Borrar el abono de ${money(porBorrar.monto)} del ${date(porBorrar.fecha)}? El saldo del préstamo vuelve a subir.`}
          confirmText="Borrar" danger
          onConfirm={() => void borrar()} onCancel={() => setPorBorrar(null)} />
      )}
    </Modal>
  );
}

/** El estado de cuenta de una persona, con su PDF. */
function EstadoCuentaModal({ persona, prestamos, pagos, rango, onAbrirPrestamo, onClose }: {
  persona: Personal;
  prestamos: AnticipoPrestamo[];
  pagos: PagoAnticipo[];
  rango: { desde?: string; hasta?: string };
  onAbrirPrestamo: (a: AnticipoPrestamo) => void;
  onClose: () => void;
}) {
  const [abriendo, setAbriendo] = useState(false);
  // Sin filtrar por fecha: el estado de cuenta de una persona es TODO lo que
  // debe. Recortarlo a un mes daría un «debe» que no es el que se le cobra.
  const ec = useMemo(() => estadoDeCuenta(persona.id, prestamos, pagos), [persona.id, prestamos, pagos]);

  async function pdf() {
    setAbriendo(true);
    try {
      const { verEstadoCuentaPrestamosPdf } = await import('./prestamosPdf');
      await verEstadoCuentaPrestamosPdf(persona, prestamos, pagos, rango);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
    finally { setAbriendo(false); }
  }

  return (
    <Modal title={`Estado de cuenta · ${nombreDeCarnet(persona.nombre, persona.apellido)}`} size="lg" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        <button className="btn btn-primary" onClick={() => void pdf()} disabled={abriendo}>
          {abriendo ? 'Generando…' : '📄 Ver en PDF'}
        </button>
      </>}>
      <div className="muted" style={{ fontSize: '.85rem', marginBottom: '.6rem' }}>
        {numeroFicha(persona.numero_ficha)}
        {persona.cedula ? ` · C.I. ${persona.cedula}` : ''}
        {persona.cargo ? ` · ${persona.cargo}` : ''}
      </div>

      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.8rem' }}>
        <div className="tira" style={{ flex: '1 1 140px' }}>
          <div className="tira-titulo">Total prestado · {ec.renglones.length} movimiento(s)</div>
          <div className="tira-valor mono">{money(ec.total)}</div>
        </div>
        <div className="tira" style={{ flex: '1 1 140px' }}>
          <div className="tira-titulo">Total pagado · hasta hoy</div>
          <div className="tira-valor mono" style={{ color: 'var(--success)' }}>{money(ec.pagado)}</div>
        </div>
        <div className={`tira${ec.debe > 0 ? ' danger' : ''}`} style={{ flex: '1 1 140px' }}>
          <div className="tira-titulo">Debe · {ec.abiertos} sin saldar</div>
          <div className="tira-valor mono">{money(ec.debe)}</div>
        </div>
      </div>

      {!ec.renglones.length && <EmptyState message="Sin préstamos ni anticipos" icon="💵" />}

      {ec.renglones.map((r) => (
        <div key={r.prestamo.id} className="card" style={{ padding: '.6rem .8rem', marginBottom: '.5rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'baseline' }}>
            <strong>{r.prestamo.tipo === 'anticipo' ? 'Anticipo' : 'Préstamo'}</strong>
            <span className="muted mono">{date(fechaDePrestamo(r.prestamo))}</span>
            <span className="mono" style={{ marginLeft: 'auto' }}>
              {money(r.prestamo.monto_total)} · pagado <span style={{ color: 'var(--success)' }}>{money(r.pagado)}</span> ·{' '}
              debe <strong style={{ color: r.debe > 0 ? 'var(--danger)' : 'var(--success)' }}>{money(r.debe)}</strong>
            </span>
            <button className="btn btn-sm btn-ghost" onClick={() => void verReciboPrestamoPdf({
              tipo: 'entrega',
              persona,
              prestamo: r.prestamo,
              montoUsd: Number(r.prestamo.monto_total) || 0,
              fecha: fechaDePrestamo(r.prestamo),
              moneda: r.prestamo.moneda,
              montoOriginal: r.prestamo.monto_original,
              tasaCambio: r.prestamo.tasa_cambio,
              motivo: r.prestamo.motivo,
              saldoRestante: Number(r.debe) || 0,
            })} title="Imprimir recibo / comprobante de entrega en PDF">📄 Recibo</button>
            <button className="btn btn-sm btn-ghost" onClick={() => onAbrirPrestamo(r.prestamo as AnticipoPrestamo)}>💵 Abonos</button>
          </div>
          {(() => {
            const entregas = obtenerEntregas(r.prestamo);
            const motivoInicial = entregas[0]?.motivo || r.prestamo.motivo;
            return (
              <>
                {motivoInicial && <div className="muted" style={{ fontSize: '.82rem' }}>{motivoInicial}</div>}
                {entregas.length > 1 && (
                  <div style={{ fontSize: '.79rem', color: 'var(--primary)', marginTop: '.25rem' }}>
                    <strong>Entregas otorgadas:</strong>{' '}
                    {entregas.map((e) => `${date(e.fecha)} (${money(e.monto)}${e.motivo ? `: ${e.motivo}` : ''})`).join(' · ')}
                  </div>
                )}
              </>
            );
          })()}
          {!!r.pagos.length && (
            <div className="muted" style={{ fontSize: '.8rem', marginTop: '.3rem' }}>
              {r.pagos.map((p) => `${date(p.fecha)} ${money(p.monto)} (${labelOrigen(p.origen)})`).join(' · ')}
            </div>
          )}
        </div>
      ))}
    </Modal>
  );
}
