import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import {
  listCategoriasGasto, soloCategorias, subcategoriasDe, ensureCategoriaGasto,
  renombrarCategoriaGasto, setActivoCategoriaGasto, eliminarCategoriaGasto,
  type CategoriaGasto,
} from './categoriasGasto.repository';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { dateTime, date as fmtDate, dosDecimales, redondearArriba5, num } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { GestionarCajasModal } from '@/modules/salidas/GestionarCajasModal';
import {
  listRenglonesPorPagar, countRenglonesPorPagar, pagarRenglon, getRenglonById, urlComprobanteNomina, labelMotivoNomina,
} from '@/modules/rrhh/nomina.repository';
import type { NominaRenglon } from '@/shared/lib/types';
import type { Caja, MovimientoCaja, Orden, Producto, Almacen } from '@/shared/lib/types';
import { listProductos } from '@/modules/inventario/inventario.repository';
import { listAlmacenes, nombreCortoAlmacen } from '@/modules/inventario/almacenes.repository';
import { HistorialTasasModal } from './HistorialTasasModal';
import { TasasView } from './TasasView';
import { getTasaHoy, aBs, aExtranjero, round2, getTasasMercado, refrescarBinanceP2P, getBinance3, refrescarTasasSiVencido, type TasasMercado, type Binance3 } from './tasas.repository';
import { saldosDeCaja, ingresarDivisa, listLotes, listSaldos, trasladoEntreCajasMulti, convertirDivisa, ajustarSaldoDivisa } from './cajaSaldos.repository';
// Vínculo Tesorería → Centro de Acopio interno: el traspaso se refleja como entrada (USD ENTREGADOS) en el acopio.
import { entradaTesoreriaACentroAcopio, centroAcopioShort } from '@/modules/acopio/caja.repository';
import {
  crearTransferenciaSaliente, confirmarTransferenciaEntrante, reintentarTransferencia,
  listTransferenciasInter,
} from './transferenciasInter.repository';
import type { TransferenciaInter, TransferLeg } from '@/shared/lib/types';
import { listMonedas, addMoneda, MONEDAS_BASE } from './monedas';
import type { MonedaCaja, CuentaCaja, CajaSaldo, CajaLote } from '@/shared/lib/types';
import { BarChart, type ChartPoint } from '@/shared/ui/Chart';
import {
  listCajasActivas, listCentrosAcopio,
  registrarGasto, disponibilidadFinanciera, listLibroMayor,
  categoriaLlevaCorrelativo, proximoCorrelativoGasto,
  editarMovimientoCajaFull, eliminarMovimientoCaja, movEstaVinculado,
  type Disponibilidad,
} from './tesoreria.repository';
import {
  computeReporteCierre, crearCierre, listCierres, reabrirCierre,
  type ReporteCierre, type Cierre,
} from './cierres.repository';
// descargarCierrePdf y descargarCierreExcel se importan dinámicamente (al generar) para no cargar jsPDF/xlsx al abrir.
import { periodoLargo } from './cierreReporte';
import {
  listContrapartes, crearContraparte, actualizarContraparte, eliminarContraparte,
  type Contraparte, type TipoContraparte,
} from './contrapartes.repository';
import { list as listProveedoresCatalogo } from '@/modules/proveedores/proveedores.repository';
import {
  registrarIngresoCxP, listCuentasPorPagar, listAbonosCuenta, registrarAbonoCuenta, listIngresosCxP,
  type CuentaPorPagar, type AbonoCxP, type IngresoCxP,
} from './cuentasPorPagar.repository';
import {
  listCuentasPorCobrar, listAbonosCobrar, registrarAbonoCobrar, crearCuentaPorCobrar,
  registrarCobrarPorTraspaso, registrarAbonoCobrarProducto, labelTipoCxC,
  type CuentaPorCobrar, type AbonoCxC,
} from './cuentasPorCobrar.repository';
import {
  listOrdenesPorPagar, pagarOrdenCompra, pagarOrdenCompraMulti, labelMetodoPago, pagoSinComprobante, type OrdenPorPagar,
  listOrdenesEnCredito, registrarAbonoMulti, listAbonos, type AbonoLeg,
  getOrdenById, urlAdjuntoOc,
  getProveedorConDatosPago, guardarDatosPagoProveedor,
} from '@/modules/pedidos/pedidos.repository';
import { labelCondicionPago } from '@/modules/pedidos/ofertas.repository';
import { listComprasDirectasCredito, getCompraDirectaByCajaMov, type CompraDirecta } from '@/modules/pedidos/compras.repository';
import { cargarDirectosPorPagar, PagarDirectoModal, type DirectoFila } from '@/modules/pedidos/DirectosPorPagarModal';
import { resumenDatosPago, DatosPagoFields, validarDatosPago } from '@/shared/ui/DatosPagoFields';
import { METODOS_CON_DATOS, type DatosPago } from '@/modules/pedidos/datosPago.repository';
import type { Proveedor } from '@/shared/lib/types';
import { comprobantesDeOrden, urlRetencion, labelRetencionModo, listRetencionesHechas, type RetencionItem } from '@/modules/retenciones/retenciones.repository';
// Generadores de PDF/Excel: se importan dinámicamente (al generar) para no cargar jsPDF/xlsx al abrir la página.
import { type ReporteMeta } from './reportePdf';
import { ChatOC } from '@/modules/pedidos/ChatOC';
import { noLeidosPorOrden } from '@/modules/pedidos/ocChat.repository';
// enviarReportePorCorreo, enviarMovimientoDetallePorCorreo, enviarCuentaPorPagarPorCorreo y
// descargarOrdenCompraPdf se importan dinámicamente (al generar/enviar) para no cargar jsPDF al abrir.
import type { AbonoCredito } from '@/shared/lib/types';
import { listOfertasByOrden, getPdfOfertaSignedUrl, descuentoEfectivo } from '@/modules/pedidos/ofertas.repository';
import type { OfertaProveedor } from '@/shared/lib/types';

const TIPO_MOV_LABEL: Record<string, string> = {
  ingreso: '⬇ Ingreso', salida: '⬆ Egreso', traslado_salida: '↔ Traslado (sale)',
  traslado_entrada: '↔ Traslado (entra)', ajuste: '⚙ Ajuste',
};
const CAT_LABEL: Record<string, string> = {
  gasto: 'Gasto', pago_personal: 'Pago a personal', pago_oc: 'Pago de compra', pago_nomina: 'Pago de nómina',
  traslado: 'Traslado', conversion: 'Conversión', compra_directa: 'Compra directa',
  cobro_cxc: 'Cobro por cobrar', abono_cxp: 'Abono por pagar', combustible: 'Combustible',
};

/** Etiqueta legible de una categoría de movimiento (cae al valor crudo si no está mapeada). */
function catLabel(cat: string | null | undefined): string {
  const c = (cat ?? '').trim();
  return c ? (CAT_LABEL[c] ?? c) : '—';
}

/** Formatea un monto con el símbolo de su moneda (2 decimales). */
function monto(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${v}` : `${moneda} ${v}`;
}

/** Etiqueta de una cuenta/billetera: '—' para general, nombres fijos para Bs y el
 *  nombre tal cual para billeteras nombradas (usdt1, usdt2…). */
function labelCuentaCaja(c: string | null | undefined): string {
  const v = c ?? 'general';
  return v === 'general' ? '—' : v === 'juridica' ? 'Jurídica' : v === 'personal' ? 'Personal' : v;
}

/** Normaliza texto para buscar: minúsculas y sin acentos (búsqueda tolerante). */
function normalizarBusqueda(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/** Agrupa los almacenes activos por SEDE, con cada subalmacén anidado bajo su
 *  almacén padre (nivel = sangría). Mismo criterio que la recepción de compras. */
function agruparAlmacenesPorSede(almacenes: Almacen[]): [string, { a: Almacen; nivel: number }[]][] {
  const activos = almacenes.filter((a) => a.estado === 'activo');
  const hijosDe = (pid: string | null) => activos
    .filter((a) => (a.parent_id ?? null) === pid)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const ids = new Set(activos.map((a) => a.id));
  const ordenar = (pid: string | null, nivel: number, acc: { a: Almacen; nivel: number }[]) => {
    for (const a of hijosDe(pid)) { acc.push({ a, nivel }); ordenar(a.id, nivel + 1, acc); }
  };
  const porSede = new Map<string, { a: Almacen; nivel: number }[]>();
  for (const sede of [...new Set(activos.map((a) => a.sede?.trim() || 'Sin sede'))].sort((x, y) => x.localeCompare(y, 'es'))) {
    const delaSede = activos.filter((a) => (a.sede?.trim() || 'Sin sede') === sede);
    const setSede = new Set(delaSede.map((a) => a.id));
    const acc: { a: Almacen; nivel: number }[] = [];
    for (const r of delaSede.filter((a) => !a.parent_id || !setSede.has(a.parent_id) || !ids.has(a.parent_id)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))) {
      acc.push({ a: r, nivel: 0 });
      ordenar(r.id, 1, acc);
    }
    porSede.set(sede, acc);
  }
  return [...porSede.entries()];
}

export function TesoreriaPage() {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('tesoreria', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;

  const [disp, setDisp] = useState<Disponibilidad | null>(null);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [saldos, setSaldos] = useState<CajaSaldo[]>([]);
  const [libro, setLibro] = useState<MovimientoCaja[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<'none' | 'gasto' | 'traslado' | 'pago' | 'cajas' | 'tasas' | 'porpagar' | 'creditos' | 'cobrar' | 'conversor' | 'calculadora' | 'resumen' | 'retencion' | 'grafico' | 'contrapartes' | 'categorias-gasto' | 'cierre'>('none');
  const [cajaSel, setCajaSel] = useState<Caja | null>(null);
  const [porPagarCount, setPorPagarCount] = useState(0);
  const [directos, setDirectos] = useState<DirectoFila[]>([]);
  const [creditosCount, setCreditosCount] = useState(0);
  const [cobrarCount, setCobrarCount] = useState(0);
  const [cxpList, setCxpList] = useState<CuentaPorPagar[]>([]);
  const [cxcList, setCxcList] = useState<CuentaPorCobrar[]>([]);
  // Dataset COMPLETO de movimientos activos para el Libro Mayor (independiente de
  // los filtros del Registro): así sus sumas Debe/Haber no se descuadran cuando el
  // usuario filtra el registro, y la vista por moneda muestra todos los movimientos.
  const [lmMovs, setLmMovs] = useState<MovimientoCaja[]>([]);
  const [retencionListas, setRetencionListas] = useState<RetencionItem[]>([]);
  const [nominaCount, setNominaCount] = useState(0);
  const [vista, setVista] = useState<'tesoreria' | 'tasas' | 'movimientos' | 'gastos'>('tesoreria');
  const [correoMovOpen, setCorreoMovOpen] = useState(false);
  const [movSel, setMovSel] = useState<MovimientoCaja | null>(null);

  // Filtros del registro de movimientos
  const [fMoneda, setFMoneda] = useState<string>('');
  const [monedasReg, setMonedasReg] = useState<string[]>(['Bs', 'USD', 'USDT', 'COP']);
  useEffect(() => { listMonedas().then(setMonedasReg).catch(() => { /* base */ }); }, []);
  const [fTipo, setFTipo] = useState('');
  const [fCategoria, setFCategoria] = useState('');
  const [fCuenta, setFCuenta] = useState(''); // filtro por billetera / cuenta (usdt2, juridica…)
  const [fDesde, setFDesde] = useState('');
  const [fHasta, setFHasta] = useState('');
  const [fBuscar, setFBuscar] = useState('');

  const [transfers, setTransfers] = useState<TransferenciaInter[]>([]);

  const reload = useCallback(async () => {
    const [d, cs, sal, mov, lm, pp, cr, cxp, tr, nc, cxc, ret] = await Promise.all([
      disponibilidadFinanciera(),
      listCajasActivas(),
      listSaldos().catch(() => [] as CajaSaldo[]),
      listLibroMayor({ moneda: fMoneda || undefined, tipo: fTipo || undefined, desde: fDesde || undefined, hasta: fHasta || undefined }),
      // Libro Mayor: TODOS los movimientos activos (sin los filtros del registro), tope alto.
      listLibroMayor({ limite: 10000 }).catch(() => [] as MovimientoCaja[]),
      listOrdenesPorPagar().catch(() => [] as OrdenPorPagar[]),
      listOrdenesEnCredito().catch(() => [] as OrdenPorPagar[]),
      listCuentasPorPagar(true).catch(() => [] as CuentaPorPagar[]),
      listTransferenciasInter().catch(() => [] as TransferenciaInter[]),
      countRenglonesPorPagar().catch(() => 0),
      listCuentasPorCobrar(true).catch(() => [] as CuentaPorCobrar[]),
      listRetencionesHechas().catch(() => [] as RetencionItem[]),
    ]);
    const crPendientes = cr.filter((x) => (Number(x.orden.total) - (Number(x.orden.abonado_total) || 0)) > 0.01);
    // Compras + servicios directos POR PAGAR (los montó el analista): se suman a las órdenes
    // pendientes por pagar (mismo botón) con una etiqueta DIRECTO.
    const dir = await cargarDirectosPorPagar().catch(() => [] as DirectoFila[]);
    // El contador del botón suma créditos de OC + cuentas por pagar manuales (cliente/proveedor) abiertas.
    setDisp(d); setCajas(cs); setSaldos(sal); setLibro(mov); setLmMovs(lm); setPorPagarCount(pp.length + dir.length); setCreditosCount(crPendientes.length + cxp.length); setTransfers(tr); setNominaCount(nc); setCobrarCount(cxc.length); setRetencionListas(ret);
    setCxpList(cxp); setCxcList(cxc); setDirectos(dir);
  }, [fMoneda, fTipo, fDesde, fHasta]);

  // Realtime: multiusuario · lo que registra otro usuario (o el otro sistema) se refleja acá.
  useRealtime(['movimientos_caja', 'caja_saldos', 'cajas', 'transferencias_inter', 'ordenes', 'nomina_renglones', 'cuentas_por_pagar', 'cuentas_por_pagar_abonos', 'cuentas_por_cobrar', 'cuentas_por_cobrar_abonos', 'compras_directas', 'servicios_directos'], () => { void reload(); });

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((e) => {
        const msg = e instanceof Error ? e.message
          : (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message)
          : 'Error al cargar';
        toast(msg, 'error');
      })
      .finally(() => setLoading(false));
  }, [reload]);

  const cerrarYRecargar = async () => { setModal('none'); await reload(); };

  // Búsqueda general (client-side) sobre los movimientos ya cargados: caja,
  // concepto, beneficiario, motivo, moneda, monto, saldo y fecha. Cada palabra
  // tecleada debe aparecer en algún campo (búsqueda tipo "todas las palabras").
  // Categorías presentes en el registro (para el filtro), ordenadas por etiqueta.
  const categoriasReg = useMemo(() => {
    const set = new Set<string>();
    libro.forEach((m) => { const c = (m.categoria ?? '').trim(); if (c) set.add(c); });
    return Array.from(set).sort((a, b) => catLabel(a).localeCompare(catLabel(b), 'es'));
  }, [libro]);

  // Billeteras / cuentas presentes en el registro (para el filtro): usdt2, usdt-1,
  // juridica, personal, general… etiquetadas con su nombre legible.
  const cuentasReg = useMemo(() => {
    const set = new Set<string>();
    libro.forEach((m) => { const c = (m.cuenta ?? '').trim(); if (c) set.add(c); });
    return Array.from(set).sort((a, b) => labelCuentaCaja(a).localeCompare(labelCuentaCaja(b), 'es'));
  }, [libro]);

  const libroView = useMemo(() => {
    const q = normalizarBusqueda(fBuscar);
    const palabras = q ? q.split(/\s+/).filter(Boolean) : [];
    return libro.filter((m) => {
      if (fCategoria && (m.categoria ?? '') !== fCategoria) return false;
      if (fCuenta && (m.cuenta ?? '') !== fCuenta) return false;
      if (!palabras.length) return true;
      const heno = normalizarBusqueda([
        m.caja?.nombre, TIPO_MOV_LABEL[m.tipo] ?? m.tipo, catLabel(m.categoria),
        m.beneficiario, m.motivo, m.destino, m.cuenta, m.moneda,
        monto(m.monto, m.moneda), monto(m.saldo_despues, m.moneda), dateTime(m.at),
      ].filter(Boolean).join(' '));
      return palabras.every((p) => heno.includes(p));
    });
  }, [libro, fBuscar, fCategoria, fCuenta]);

  // Metadatos del reporte PDF/correo del registro de movimientos (según filtros).
  const reporteMeta = () => ({
    titulo: 'REPORTE DE MOVIMIENTOS',
    subtitulo: [
      fDesde && `Desde ${fDesde}`, fHasta && `Hasta ${fHasta}`,
      fMoneda && `Moneda ${fMoneda}`, fTipo && `Tipo ${fTipo}`,
      fCategoria && `Categoría ${catLabel(fCategoria)}`,
      fCuenta && `Billetera ${labelCuentaCaja(fCuenta)}`,
      fBuscar.trim() && `Búsqueda "${fBuscar.trim()}"`,
    ].filter(Boolean).join(' · ') || 'Todos los movimientos',
  });

  // Respaldo del cron: si las tasas están vencidas (>11h), las refresca al abrir.
  useEffect(() => { void refrescarTasasSiVencido().catch(() => { /* sin conexión */ }); }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>🏦 Tesorería</h1>
          <p className="hint muted" style={{ margin: '.25rem 0 0' }}>Flujo de dinero, registro de movimientos y pagos.</p>
        </div>
        <div className="view-toggle" role="tablist" aria-label="Vista de tesorería">
          <button className={vista === 'tesoreria' ? 'active' : ''} onClick={() => setVista('tesoreria')}>🏦 Tesorería</button>
          <button className={vista === 'tasas' ? 'active' : ''} onClick={() => setVista('tasas')}>📈 Tasas del Día</button>
          <button className={vista === 'movimientos' ? 'active' : ''} onClick={() => setVista('movimientos')}>📒 Registro de Movimientos</button>
          <button className={vista === 'gastos' ? 'active' : ''} onClick={() => setVista('gastos')}>💸 Gastos / Movimientos</button>
        </div>
      </div>

      {vista === 'tasas' && <TasasView />}

      {vista === 'tesoreria' && (
      <>
          {/* Disponibilidad financiera */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            <DispCard titulo="Disponible en USD" valor={monto(disp?.usd ?? 0, 'USD')} />
            <DispCard titulo="Disponible en USDT" valor={monto(disp?.usdt ?? 0, 'USDT')} />
            <DispCard titulo="Total en Bs" valor={monto(disp?.bs ?? 0, 'Bs')} nota="solo lo ingresado en la cuenta Bs" destacado />
          </div>

          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {canWrite && (
              <>
                <button className="btn btn-primary" onClick={() => setModal('porpagar')}>
                  🧾 ÓRDENES PENDIENTES POR PAGAR{porPagarCount ? ` (${porPagarCount})` : ''}
                </button>
                <button className="btn btn-primary" onClick={() => setModal('creditos')} title={`${creditosCount} cuenta(s) por pagar pendiente(s)`}>
                  💳 CUENTAS POR PAGAR (CRÉDITOS)
                  <span
                    className="mono"
                    style={{
                      marginLeft: '.5rem', padding: '.05rem .5rem', borderRadius: '999px',
                      fontWeight: 800, fontSize: '.85rem',
                      background: creditosCount > 0 ? 'var(--danger, #e5484d)' : 'rgba(0,0,0,.25)',
                      color: '#fff', minWidth: '1.4rem', display: 'inline-block', textAlign: 'center',
                    }}
                  >
                    {creditosCount}
                  </span>
                </button>
                <button className="btn btn-primary" onClick={() => setModal('cobrar')} title={`${cobrarCount} cuenta(s) por cobrar abierta(s)`}>
                  📥 CUENTAS POR COBRAR
                  <span
                    className="mono"
                    style={{
                      marginLeft: '.5rem', padding: '.05rem .5rem', borderRadius: '999px',
                      fontWeight: 800, fontSize: '.85rem',
                      background: cobrarCount > 0 ? 'var(--success, #16c784)' : 'rgba(0,0,0,.25)',
                      color: '#fff', minWidth: '1.4rem', display: 'inline-block', textAlign: 'center',
                    }}
                  >
                    {cobrarCount}
                  </span>
                </button>
                <button className={nominaCount > 0 ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => setModal('pago')}>
                  {nominaCount > 0 ? `💸 PAGAR NÓMINA (${nominaCount})` : '👥 Pago a personal'}
                </button>
                <button className="btn btn-ghost" onClick={() => setModal('retencion')} title={`${retencionListas.length} retención(es) lista(s)`}>
                  🧾 Retención
                  {retencionListas.length > 0 && (
                    <span className="mono" style={{
                      marginLeft: '.5rem', padding: '.05rem .5rem', borderRadius: '999px',
                      fontWeight: 800, fontSize: '.85rem', background: 'var(--success, #16c784)',
                      color: '#fff', minWidth: '1.4rem', display: 'inline-block', textAlign: 'center',
                    }}>{retencionListas.length}</span>
                  )}
                </button>
                <button className="btn btn-ghost" onClick={() => setModal('gasto')}>− Gasto</button>
                <button className="btn btn-ghost" onClick={() => setModal('traslado')}>↔ Traspaso de dinero</button>
                <button className="btn btn-ghost" onClick={() => setModal('cajas')}>🏦 Cajas</button>
                <button className="btn btn-ghost" onClick={() => setModal('contrapartes')}>👥 Clientes / Proveedores</button>
                <button className="btn btn-ghost" onClick={() => setModal('categorias-gasto')}>🗂️ Categorías de gasto</button>
                <button className="btn btn-ghost" onClick={() => setModal('cierre')}>📅 Cierre de mes</button>
              </>
            )}
            <button className="btn btn-ghost" onClick={() => setModal('conversor')}>💱 Conversor</button>
            <button className="btn btn-ghost" onClick={() => setModal('calculadora')}>🧮 Calculadora</button>
            <button className="btn btn-ghost" onClick={() => setModal('grafico')}>📊 Tasas Binance</button>
            <button className="btn btn-ghost" onClick={() => setModal('tasas')}>📈 Historial Tasas</button>
            <button className="btn btn-ghost" onClick={() => setModal('resumen')}>📊 Resumen</button>
          </div>

          {/* Saldos por caja (multimoneda; clic = detalle, ingreso, trazabilidad) */}
          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {cajas.map((c) => {
              const sc = saldos.filter((s) => s.caja_id === c.id && (Number(s.saldo) || 0) !== 0);
              // Saldo en la moneda "casa" de la caja (cifra principal) y otras monedas con saldo.
              const saldoHome = sc.filter((s) => s.moneda === c.moneda).reduce((a, s) => a + (Number(s.saldo) || 0), 0);
              const otras = sc.filter((s) => s.moneda !== c.moneda);
              return (
                <button key={c.id} className="card" onClick={() => setCajaSel(c)}
                  style={{ padding: '.6rem .9rem', minWidth: 170, textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--card, transparent)' }}
                  title="Ver detalle, ingresar dinero y trazabilidad">
                  <div className="muted" style={{ fontSize: '.72rem' }}>{c.nombre} <span style={{ float: 'right' }}>⚙</span></div>
                  {/* Cifra principal en la moneda "casa" de la caja: $ en Multimoneda (USD),
                      USDT en la de USDT, Bs en la de Bs. Si es multimoneda (hay otras monedas
                      con saldo), se muestran TODAS con buena visibilidad, una por renglón. */}
                  <strong className="mono" style={{ fontSize: '.95rem', display: 'block', margin: '.2rem 0 .1rem', color: 'var(--text, #fff)' }}>
                    {monto(saldoHome, c.moneda)}
                  </strong>
                  {otras.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.1rem', marginTop: '.15rem', paddingTop: '.2rem', borderTop: '1px dashed var(--border)' }}>
                      {otras.map((s) => (
                        <span key={s.id} className="mono" style={{ fontSize: '.82rem', color: 'var(--text)' }}>
                          + {monto(s.saldo, s.moneda)}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Transferencias inter-sistema (centros de acopio externos / otra Supabase) */}
          <TransferenciasInterPanel transfers={transfers} cajas={cajas} canWrite={canWrite} actor={actor} actorName={actorName} onChanged={reload} />

          {/* Libro mayor: Debe / Haber / Saldo en cajas + Cuentas por Pagar / por Cobrar, por moneda.
              Filtros propios (fecha + moneda) y cada moneda es clickeable para ver sus movimientos. */}
          <LibroMayorPanel movs={lmMovs} saldos={saldos} cxp={cxpList} cxc={cxcList} monedas={monedasReg} onVerMov={setMovSel} />
      </>
      )}

      {vista === 'movimientos' && (
      <>
          {/* Registro de movimientos (vista propia) */}
          <div className="card">
            <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
              <span>Registro de movimientos</span>
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative' }}>
                  <input className="input" type="search" value={fBuscar} onChange={(e) => setFBuscar(e.target.value)}
                    placeholder="🔍 Buscar (caja, concepto, monto…)" style={{ width: 240, paddingRight: fBuscar ? '1.6rem' : undefined }} />
                  {fBuscar && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFBuscar('')}
                      title="Limpiar búsqueda"
                      style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', padding: '0 .3rem', lineHeight: 1 }}>✕</button>
                  )}
                </div>
                <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
                  Desde <input className="input" type="date" value={fDesde} onChange={(e) => setFDesde(e.target.value)} style={{ width: 'auto' }} />
                </label>
                <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
                  Hasta <input className="input" type="date" value={fHasta} onChange={(e) => setFHasta(e.target.value)} style={{ width: 'auto' }} />
                </label>
                {(fDesde || fHasta) && <button className="btn btn-sm btn-ghost" onClick={() => { setFDesde(''); setFHasta(''); }}>✕ Fechas</button>}
                <select className="select" value={fMoneda} onChange={(e) => setFMoneda(e.target.value)} style={{ width: 'auto' }}>
                  <option value="">Toda moneda</option>
                  {monedasReg.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <select className="select" value={fTipo} onChange={(e) => setFTipo(e.target.value)} style={{ width: 'auto' }}>
                  <option value="">Todo movimiento</option>
                  <option value="ingreso">Ingresos</option><option value="salida">Egresos</option>
                  <option value="traslado_salida">Traslados</option><option value="ajuste">Ajustes</option>
                </select>
                <select className="select" value={fCategoria} onChange={(e) => setFCategoria(e.target.value)} style={{ width: 'auto' }}>
                  <option value="">Toda categoría</option>
                  {categoriasReg.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
                </select>
                <select className="select" value={fCuenta} onChange={(e) => setFCuenta(e.target.value)} style={{ width: 'auto' }} title="Filtrar por billetera / cuenta (USDT, Jurídica…)">
                  <option value="">Toda billetera</option>
                  {cuentasReg.map((c) => <option key={c} value={c}>{labelCuentaCaja(c)}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.5rem', alignItems: 'center' }}>
              <button className="btn btn-sm btn-ghost" disabled={!libroView.length} onClick={async () => {
                try { const { descargarReportePdf } = await import('./reportePdf'); await descargarReportePdf(libroView, reporteMeta()); } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
              }}>↓ PDF</button>
              <button className="btn btn-sm btn-ghost" disabled={!libroView.length} onClick={() => setCorreoMovOpen(true)}>✉ Enviar por correo</button>
              {(fBuscar.trim() || fCategoria || fCuenta) && (
                <span className="muted" style={{ fontSize: '.8rem' }}>
                  {libroView.length} de {libro.length} {libro.length === 1 ? 'movimiento' : 'movimientos'}
                </span>
              )}
            </div>
            <div className="table-wrap">
              <table className="table" style={{ fontSize: '.85rem' }}>
                <thead><tr><th>Fecha</th><th>Caja</th><th>Movimiento</th><th>Categoría</th><th>Concepto</th><th style={{ textAlign: 'right' }}>Monto</th><th style={{ textAlign: 'right' }}>Saldo</th><th style={{ textAlign: 'center' }}>Detalle</th></tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
                  {!loading && !libroView.length && <tr><td colSpan={8}><EmptyState message={fBuscar.trim() ? `Sin resultados para "${fBuscar.trim()}"` : 'Sin movimientos'} /></td></tr>}
                  {!loading && libroView.map((m) => {
                    const egreso = m.tipo === 'salida' || m.tipo === 'traslado_salida'
                  || (m.tipo === 'ajuste' && Number(m.saldo_despues) < Number(m.saldo_antes));
                    const concepto = [m.beneficiario, m.motivo].filter(Boolean).join(' · ') || '—';
                    return (
                      <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => setMovSel(m)} title="Ver todos los detalles">
                        <td>{dateTime(m.at)}</td>
                        <td>{m.caja?.nombre ?? '—'}</td>
                        <td>{TIPO_MOV_LABEL[m.tipo] ?? m.tipo}</td>
                        <td>{m.categoria ? <span className="badge">{catLabel(m.categoria)}</span> : <span className="muted">—</span>}</td>
                        <td>{concepto}</td>
                        <td className="mono" style={{ textAlign: 'right', color: egreso ? 'var(--danger)' : 'var(--success)' }}>{egreso ? '−' : '+'}{monto(m.monto, m.moneda)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{monto(m.saldo_despues, m.moneda)}</td>
                        <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                          <button className="btn btn-sm btn-ghost" onClick={() => setMovSel(m)}>🔍 Detalles</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {!loading && libroView.length > 0 && (
                  <tfoot>
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700 }}>
                        Total {fTipo === 'ingreso' ? 'ingresos' : fTipo === 'salida' ? 'egresos' : 'neto'} · {libroView.length} mov.
                      </td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>
                        {totalesMontoPorMoneda(libroView).map(([mon, tot]) => (
                          <div key={mon} style={{ whiteSpace: 'nowrap', color: tot < 0 ? 'var(--danger)' : 'var(--success)' }}>
                            {tot < 0 ? '−' : '+'}{monto(Math.abs(tot), mon)}
                          </div>
                        ))}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
      </>
      )}

      {vista === 'gastos' && <GastosView libro={libro} onVerMov={setMovSel} />}

      {movSel && (
        <MovimientoDetalleModal
          mov={movSel}
          cajas={cajas}
          defaultEmail={actor}
          canWrite={canWrite}
          onChanged={async () => { setMovSel(null); await reload(); }}
          onClose={() => setMovSel(null)}
        />
      )}
      {correoMovOpen && <EnviarReporteModal movs={libroView} meta={reporteMeta()} defaultEmail={actor} onClose={() => setCorreoMovOpen(false)} />}
      {modal === 'gasto' && <GastoModal cajas={cajas} actor={actor} actorName={actorName} onClose={() => setModal('none')} onSaved={cerrarYRecargar} />}
      {modal === 'traslado' && <TrasladoModal cajas={cajas} actor={actor} actorName={actorName} onClose={() => setModal('none')} onSaved={cerrarYRecargar} />}
      {modal === 'pago' && <NominaPorPagarModal cajas={cajas} actor={actor} actorName={actorName} onClose={() => setModal('none')} onPaid={reload} />}
      {modal === 'cajas' && <GestionarCajasModal actor={actor} actorName={actorName} onClose={() => setModal('none')} onCambioAplicado={reload} />}
      {modal === 'tasas' && <TasasGate onClose={() => setModal('none')} />}
      {modal === 'conversor' && <ConversorModal cajas={cajas} saldos={saldos} actor={actor} actorName={actorName} onClose={() => setModal('none')} onSaved={reload} />}
      {modal === 'calculadora' && <CalculadoraModal actor={actor} onClose={() => setModal('none')} />}
      {modal === 'resumen' && <ResumenMovimientosModal monedas={monedasReg} defaultMoneda={fMoneda || 'USD'} defaultDesde={fDesde} defaultHasta={fHasta} cajas={cajas} canWrite={canWrite} actor={actor} onClose={() => setModal('none')} onChanged={reload} />}
      {modal === 'retencion' && <RetencionesTesoreriaModal items={retencionListas} onClose={() => setModal('none')} />}
      {modal === 'grafico' && <GraficoTasasModal onClose={() => setModal('none')} />}
      {modal === 'porpagar' && <OrdenesPorPagarModal cajas={cajas} actor={actor} actorName={actorName} userId={user?.id ?? ''} directos={directos} onClose={() => setModal('none')} onPaid={reload} />}
      {modal === 'creditos' && <CuentasCreditoModal cajas={cajas} actor={actor} actorName={actorName} onClose={() => setModal('none')} onChanged={reload} />}
      {modal === 'cobrar' && <CuentasPorCobrarModal cajas={cajas} actor={actor} actorName={actorName} onClose={() => setModal('none')} onChanged={reload} />}
      {modal === 'contrapartes' && <ContrapartesModal onClose={() => setModal('none')} />}
      {modal === 'categorias-gasto' && <CategoriasGastoModal actor={actor} onClose={() => setModal('none')} />}
      {modal === 'cierre' && <CierreMesModal actor={actor} actorName={actorName} onClose={() => setModal('none')} onChanged={reload} />}
      {cajaSel && <CajaDetalleModal caja={cajaSel} canWrite={canWrite} actor={actor} actorName={actorName} onClose={() => setCajaSel(null)} onChanged={async () => { await reload(); }} />}
    </div>
  );
}

/* ───────────── Detalle de un movimiento del registro ───────────── */

function MovimientoDetalleModal({ mov, cajas = [], defaultEmail, canWrite, onChanged, onClose }: {
  mov: MovimientoCaja; cajas?: Caja[]; defaultEmail: string; canWrite?: boolean; onChanged?: () => void | Promise<void>; onClose: () => void;
}) {
  const egreso = mov.tipo === 'salida' || mov.tipo === 'traslado_salida'
    || (mov.tipo === 'ajuste' && Number(mov.saldo_despues) < Number(mov.saldo_antes));
  const [orden, setOrden] = useState<Orden | null>(null);
  const [cargandoOrden, setCargandoOrden] = useState(false);
  const [renglon, setRenglon] = useState<NominaRenglon | null>(null);
  const [cargandoReng, setCargandoReng] = useState(false);
  // Si el movimiento es el pago de una compra directa, traemos qué se compró + el requerimiento.
  const [compraDir, setCompraDir] = useState<CompraDirecta | null>(null);
  const [cargandoCd, setCargandoCd] = useState(false);
  const [abriendo, setAbriendo] = useState(false);
  const [generandoPdf, setGenerandoPdf] = useState(false);
  const [correoOpen, setCorreoOpen] = useState(false);

  // Edición / eliminación del movimiento (con reversión y recálculo del saldo).
  const puedeEditar = !!canWrite && mov.tipo !== 'ajuste';
  const vinculado = movEstaVinculado(mov);
  const [editando, setEditando] = useState(false);
  const [eMonto, setEMonto] = useState(String(Number(mov.monto) || 0));
  const [eMotivo, setEMotivo] = useState(mov.motivo ?? '');
  // Fecha/hora editable (formato input datetime-local en hora local del navegador).
  const isoAInputLocal = (iso: string | null | undefined): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const [eFecha, setEFecha] = useState(isoAInputLocal(mov.at));
  const [confirmDel, setConfirmDel] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Edición de la PARTICIÓN: caja + billetera (cuenta + moneda). Al cambiar la caja se
  // cargan sus billeteras; la elegida define cuenta+moneda. Sin billeteras = caja legada.
  const [eCajaId, setECajaId] = useState(mov.caja_id);
  const [billeteras, setBilleteras] = useState<CajaSaldo[]>([]);
  // Clave de la billetera elegida: `${cuenta}|${moneda}` ('|' + moneda para la caja legada).
  const [eBilletera, setEBilletera] = useState(`${mov.cuenta ?? ''}|${mov.moneda}`);
  useEffect(() => {
    if (!editando || !eCajaId) { setBilleteras([]); return; }
    saldosDeCaja(eCajaId).then((rows) => {
      setBilleteras(rows);
      // Si la caja elegida no es la del movimiento, predefine la primera billetera (o la legada).
      if (eCajaId !== mov.caja_id) {
        const first = rows[0];
        setEBilletera(first ? `${first.cuenta}|${first.moneda}` : `|${cajas.find((c) => c.id === eCajaId)?.moneda ?? mov.moneda}`);
      }
    }).catch(() => setBilleteras([]));
  }, [editando, eCajaId, mov.caja_id, mov.moneda, cajas]);

  async function guardarEdicion() {
    const m = round2(Number(eMonto) || 0);
    if (m <= 0) { toast('El monto debe ser mayor que 0.', 'error'); return; }
    let atISO: string | undefined;
    if (eFecha) {
      const d = new Date(eFecha);
      if (isNaN(d.getTime())) { toast('Fecha inválida.', 'error'); return; }
      atISO = d.toISOString();
    }
    const [cuentaStr, monedaStr] = eBilletera.split('|');
    const nuevaCuenta = cuentaStr ? cuentaStr : null;
    setGuardando(true);
    try {
      await editarMovimientoCajaFull(mov, {
        monto: m, motivo: eMotivo, at: atISO,
        cajaId: eCajaId, cuenta: nuevaCuenta, moneda: monedaStr || mov.moneda,
      });
      toast('Movimiento actualizado · saldos recalculados', 'success');
      setEditando(false);
      await onChanged?.();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo editar', 'error'); }
    finally { setGuardando(false); }
  }

  async function eliminar() {
    setGuardando(true);
    try {
      await eliminarMovimientoCaja(mov);
      toast('Movimiento eliminado · saldo revertido', 'success');
      setConfirmDel(false);
      await onChanged?.();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); setGuardando(false); }
  }

  // Si el movimiento es un pago de compra (pago_oc), traemos la OC para mostrar
  // seriales de billetes, comprobante y datos de la orden pagada.
  useEffect(() => {
    if (!mov.ref_orden_id) { setOrden(null); return; }
    setCargandoOrden(true);
    getOrdenById(mov.ref_orden_id)
      .then((o) => setOrden(o))
      .catch(() => setOrden(null))
      .finally(() => setCargandoOrden(false));
  }, [mov.ref_orden_id]);

  // Si es un pago de nómina, traemos el renglón (persona, período, seriales, comprobante).
  useEffect(() => {
    if (!mov.ref_nomina_renglon_id) { setRenglon(null); return; }
    setCargandoReng(true);
    getRenglonById(mov.ref_nomina_renglon_id)
      .then((r) => setRenglon(r))
      .catch(() => setRenglon(null))
      .finally(() => setCargandoReng(false));
  }, [mov.ref_nomina_renglon_id]);

  // Pago de compra directa (categoría 'compra_directa'): traemos la compra por su
  // movimiento de caja para listar qué se compró y el requerimiento/nota.
  useEffect(() => {
    if (mov.categoria !== 'compra_directa') { setCompraDir(null); return; }
    setCargandoCd(true);
    getCompraDirectaByCajaMov(mov.id)
      .then((c) => setCompraDir(c))
      .catch(() => setCompraDir(null))
      .finally(() => setCargandoCd(false));
  }, [mov.categoria, mov.id]);

  async function verComprobante(path: string) {
    setAbriendo(true);
    try {
      const url = await urlAdjuntoOc(path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch { toast('No se pudo abrir el comprobante', 'error'); }
    finally { setAbriendo(false); }
  }
  async function verComprobanteNomina(path: string) {
    setAbriendo(true);
    try {
      const url = await urlComprobanteNomina(path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch { toast('No se pudo abrir el comprobante', 'error'); }
    finally { setAbriendo(false); }
  }

  const seriales = orden?.seriales_billetes ?? [];
  const serialesNomina = renglon?.seriales_billetes ?? [];

  async function descargarPdf() {
    setGenerandoPdf(true);
    try { const { descargarMovimientoDetallePdf } = await import('./movimientoDetallePdf'); await descargarMovimientoDetallePdf(mov, orden); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
    finally { setGenerandoPdf(false); }
  }

  return (
    <Modal title="Detalle del movimiento" size="lg" onClose={onClose} footer={
      editando ? (
        <>
          <button className="btn btn-ghost" onClick={() => { setEditando(false); setEMonto(String(Number(mov.monto) || 0)); setEMotivo(mov.motivo ?? ''); setEFecha(isoAInputLocal(mov.at)); setECajaId(mov.caja_id); setEBilletera(`${mov.cuenta ?? ''}|${mov.moneda}`); }} disabled={guardando}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardarEdicion} disabled={guardando}>{guardando ? 'Guardando…' : '✓ Guardar cambios'}</button>
        </>
      ) : (
        <>
          {puedeEditar && <button className="btn btn-ghost" onClick={() => setEditando(true)} title="Editar monto y concepto (recalcula el saldo)" style={{ marginRight: 'auto' }}>✎ Editar</button>}
          {canWrite && <button className="btn btn-danger" onClick={() => setConfirmDel(true)} title="Eliminar y revertir el saldo">🗑 Eliminar</button>}
          <button className="btn btn-ghost" onClick={descargarPdf} disabled={generandoPdf || cargandoOrden}>
            {generandoPdf ? 'Generando…' : '↓ PDF'}
          </button>
          <button className="btn btn-ghost" onClick={() => setCorreoOpen(true)} disabled={cargandoOrden}>✉ Enviar por correo</button>
          <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
        </>
      )
    }>
      {/* Edición inline: monto + concepto (sincroniza el saldo al guardar) */}
      {editando && (
        <div className="card" style={{ marginBottom: '.75rem', borderColor: 'var(--primary-3, #ff8a00)' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}>✎ Editar movimiento</div>
          {vinculado && (
            <p className="hint muted" style={{ fontSize: '.78rem', marginTop: 0, color: 'var(--warning)' }}>
              ⚠ Este movimiento está vinculado a otro módulo (compra, nómina o traslado). Al editarlo se recalcula el saldo de la caja, pero el módulo vinculado NO se entera del cambio.
            </p>
          )}
          <div className="form-grid">
            <div className="form-row">
              <label>Caja (de dónde sale / entra)</label>
              <select className="select" value={eCajaId} onChange={(e) => setECajaId(e.target.value)}>
                {!cajas.length && <option value={mov.caja_id}>{mov.caja?.nombre ?? 'Caja actual'}</option>}
                {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              <small className="muted">Si la cambiás, el monto sale de la nueva caja y se reajustan los saldos de ambas.</small>
            </div>
            <div className="form-row">
              <label>Billetera / moneda</label>
              <select className="select" value={eBilletera} onChange={(e) => setEBilletera(e.target.value)}>
                {billeteras.length === 0 && <option value={`|${cajas.find((c) => c.id === eCajaId)?.moneda ?? mov.moneda}`}>{cajas.find((c) => c.id === eCajaId)?.moneda ?? mov.moneda} (caja simple)</option>}
                {billeteras.map((b) => <option key={b.id} value={`${b.cuenta}|${b.moneda}`}>{b.cuenta} · {b.moneda} (disp. {monto(Number(b.saldo), b.moneda)})</option>)}
              </select>
              <small className="muted">Define la cuenta y la moneda del movimiento.</small>
            </div>
            <div className="form-row">
              <label>Fecha y hora</label>
              <input className="input" type="datetime-local" value={eFecha} onChange={(e) => setEFecha(e.target.value)} />
              <small className="muted">Cambiarla reordena el movimiento en el Libro Mayor y recalcula los saldos.</small>
            </div>
            <div className="form-row">
              <label>Monto</label>
              <input className="input mono" type="number" min={0} step={0.01} value={eMonto}
                onChange={(e) => setEMonto(dosDecimales(e.target.value))} style={{ textAlign: 'right' }} />
            </div>
            <div className="form-row" style={{ gridColumn: '1 / -1' }}>
              <label>Concepto / motivo</label>
              <input className="input" value={eMotivo} onChange={(e) => setEMotivo(e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {/* Datos generales del movimiento */}
      <div className="card" style={{ marginBottom: '.75rem' }}>
        <div className="card-title" style={{ marginBottom: '.4rem' }}>Movimiento</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.35rem .9rem', fontSize: '.84rem' }}>
          <div><span className="muted">Fecha:</span> <strong>{dateTime(mov.at)}</strong></div>
          <div><span className="muted">Caja:</span> <strong>{mov.caja?.nombre ?? '—'}</strong></div>
          <div><span className="muted">Tipo:</span> <strong>{TIPO_MOV_LABEL[mov.tipo] ?? mov.tipo}</strong></div>
          <div><span className="muted">Categoría:</span> <strong>{CAT_LABEL[mov.categoria ?? ''] ?? (mov.categoria || '—')}</strong></div>
          <div><span className="muted">Monto:</span> <strong className="mono" style={{ color: egreso ? 'var(--danger)' : 'var(--success)' }}>{egreso ? '−' : '+'}{monto(mov.monto, mov.moneda)}</strong></div>
          {mov.cuenta && <div><span className="muted">Cuenta:</span> <strong>{mov.cuenta}</strong></div>}
          {mov.tasa_bs != null && mov.tasa_bs > 0 && <div><span className="muted">Tasa aplicada:</span> <strong className="mono">{monto(mov.tasa_bs, 'Bs')} / $</strong></div>}
          <div><span className="muted">Saldo antes:</span> <strong className="mono">{monto(mov.saldo_antes, mov.moneda)}</strong></div>
          <div><span className="muted">Saldo después:</span> <strong className="mono">{monto(mov.saldo_despues, mov.moneda)}</strong></div>
          {mov.beneficiario && <div><span className="muted">Beneficiario:</span> <strong>{mov.beneficiario}</strong></div>}
          {mov.destino && <div><span className="muted">Destino:</span> <strong>{mov.destino}</strong></div>}
          <div><span className="muted">Registrado por:</span> <strong>{mov.actor_name || mov.actor}</strong></div>
        </div>
        {mov.motivo && (
          <div style={{ marginTop: '.5rem', fontSize: '.84rem' }}>
            <span className="muted">Concepto / motivo:</span> {mov.motivo}
          </div>
        )}
      </div>

      {/* Orden pagada (si el movimiento es un pago de compra) */}
      {mov.ref_orden_id && (
        <div className="card" style={{ marginBottom: '.75rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}>Orden pagada</div>
          {cargandoOrden && <div className="muted" style={{ fontSize: '.84rem' }}>Cargando la orden…</div>}
          {!cargandoOrden && !orden && <div className="muted" style={{ fontSize: '.84rem' }}>No se pudo cargar la orden vinculada.</div>}
          {!cargandoOrden && orden && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.35rem .9rem', fontSize: '.84rem' }}>
                <div><span className="muted">OP:</span> <strong className="mono">{orden.codigo}</strong></div>
                <div><span className="muted">N°ODC:</span> <strong className="mono">{orden.oc_codigo ?? '—'}</strong></div>
                <div><span className="muted">Total OC:</span> <strong className="mono">{monto(orden.total, orden.moneda ?? 'USD')}</strong></div>
                {orden.recibido_total != null && <div><span className="muted">Recibido:</span> <strong className="mono">{monto(Number(orden.recibido_total), orden.moneda ?? 'USD')}</strong></div>}
                <div><span className="muted">Solicitante:</span> <strong>{orden.solicitante || orden.solicitante_email}</strong></div>
                {orden.condiciones_pago && <div><span className="muted">Condición:</span> <strong>{labelCondicionPago(orden.condiciones_pago)}</strong></div>}
                {orden.pagada_en && <div><span className="muted">Pagada:</span> <strong>{dateTime(orden.pagada_en)}</strong></div>}
              </div>

              {/* Requerimiento: el porqué / finalidad de la compra */}
              {(orden.motivo || orden.finalidad || orden.notas) && (
                <div style={{ marginTop: '.5rem', fontSize: '.84rem' }}>
                  <span className="muted">Requerimiento:</span>{' '}
                  {[orden.motivo, orden.finalidad, orden.notas].filter(Boolean).join(' · ')}
                </div>
              )}

              {/* Qué se compró: renglones de la orden */}
              {orden.items?.some((it) => it.comprar !== false) && (
                <div style={{ marginTop: '.6rem' }}>
                  <div className="muted" style={{ fontSize: '.78rem', marginBottom: '.25rem' }}>Qué se compró</div>
                  <div className="table-wrap">
                    <table className="table" style={{ fontSize: '.82rem' }}>
                      <thead><tr><th>Producto</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Precio</th><th style={{ textAlign: 'right' }}>Subtotal</th></tr></thead>
                      <tbody>
                        {orden.items.filter((it) => it.comprar !== false).map((it, i) => (
                          <tr key={`${it.sku}-${i}`}>
                            <td>{it.nombre}{it.finalidad ? <span className="muted"> · {it.finalidad}</span> : ''}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{(Number(it.cantidad) || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 })}{it.unidad ? ` ${it.unidad}` : ''}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{monto(Number(it.precio) || 0, orden.moneda ?? 'USD')}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{monto((Number(it.cantidad) || 0) * (Number(it.precio) || 0), orden.moneda ?? 'USD')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Seriales de billetes entregados */}
              <div style={{ marginTop: '.6rem' }}>
                <div className="muted" style={{ fontSize: '.78rem', marginBottom: '.25rem' }}>Seriales de los billetes entregados</div>
                {seriales.length ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
                    {seriales.map((s, i) => (
                      <span key={s} className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', background: 'var(--bg-1)' }}>
                        <span className="muted">{i + 1}.</span><span className="mono">{s}</span>
                      </span>
                    ))}
                    <span className="muted" style={{ alignSelf: 'center', fontSize: '.8rem' }}>{seriales.length} billete(s)</span>
                  </div>
                ) : <span className="muted" style={{ fontSize: '.84rem' }}>No se registraron seriales en este pago.</span>}
              </div>

              {/* Comprobante de pago (si se subió) */}
              <div style={{ marginTop: '.6rem' }}>
                <div className="muted" style={{ fontSize: '.78rem', marginBottom: '.25rem' }}>Comprobante de pago</div>
                {orden.factura_path ? (
                  <button className="btn btn-sm btn-ghost" disabled={abriendo} onClick={() => verComprobante(orden.factura_path!)}>
                    {abriendo ? 'Abriendo…' : `📎 Ver comprobante${orden.factura_nombre ? ` · ${orden.factura_nombre}` : ''}`}
                  </button>
                ) : <span className="muted" style={{ fontSize: '.84rem' }}>No se subió comprobante (pago en efectivo, opcional).</span>}
              </div>
            </>
          )}
        </div>
      )}

      {/* Nómina pagada (si el movimiento es un pago de nómina) */}
      {mov.ref_nomina_renglon_id && (
        <div className="card" style={{ marginBottom: '.75rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}>Nómina pagada</div>
          {cargandoReng && <div className="muted" style={{ fontSize: '.84rem' }}>Cargando el renglón…</div>}
          {!cargandoReng && !renglon && <div className="muted" style={{ fontSize: '.84rem' }}>No se pudo cargar el renglón vinculado.</div>}
          {!cargandoReng && renglon && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '.35rem .9rem', fontSize: '.84rem' }}>
                <div><span className="muted">Trabajador:</span> <strong>{renglon.nombre}</strong></div>
                <div><span className="muted">Nómina:</span> <strong className="mono">{renglon.periodo?.codigo ?? '—'}</strong></div>
                <div><span className="muted">Motivo:</span> <strong>{labelMotivoNomina(renglon.periodo?.tipo)}</strong></div>
                <div><span className="muted">Departamento:</span> {renglon.departamento || '—'}</div>
                <div><span className="muted">Días:</span> <strong>{renglon.dias_trabajados}</strong></div>
                <div><span className="muted">Bruto:</span> <strong className="mono">{monto(renglon.salario_bruto, 'USD')}</strong></div>
                <div><span className="muted">Deducciones:</span> <strong className="mono">{monto(round2((Number(renglon.deduc_anticipos) || 0) + (Number(renglon.deduc_prestamos) || 0)), 'USD')}</strong></div>
                <div><span className="muted">Neto:</span> <strong className="mono" style={{ color: 'var(--success)' }}>{monto(renglon.neto_usd, 'USD')}</strong></div>
                {renglon.tasa_pago != null && renglon.tasa_pago > 0 && <div><span className="muted">Tasa aplicada:</span> <strong className="mono">{monto(renglon.tasa_pago, 'Bs')} / $</strong></div>}
              </div>

              <div style={{ marginTop: '.6rem' }}>
                <div className="muted" style={{ fontSize: '.78rem', marginBottom: '.25rem' }}>Seriales de los billetes entregados</div>
                {serialesNomina.length ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
                    {serialesNomina.map((s, i) => (
                      <span key={s} className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', background: 'var(--bg-1)' }}>
                        <span className="muted">{i + 1}.</span><span className="mono">{s}</span>
                      </span>
                    ))}
                    <span className="muted" style={{ alignSelf: 'center', fontSize: '.8rem' }}>{serialesNomina.length} billete(s)</span>
                  </div>
                ) : <span className="muted" style={{ fontSize: '.84rem' }}>No se registraron seriales en este pago.</span>}
              </div>

              <div style={{ marginTop: '.6rem' }}>
                <div className="muted" style={{ fontSize: '.78rem', marginBottom: '.25rem' }}>Comprobante de pago</div>
                {renglon.comprobante_path ? (
                  <button className="btn btn-sm btn-ghost" disabled={abriendo} onClick={() => verComprobanteNomina(renglon.comprobante_path!)}>
                    {abriendo ? 'Abriendo…' : `📎 Ver comprobante${renglon.comprobante_nombre ? ` · ${renglon.comprobante_nombre}` : ''}`}
                  </button>
                ) : <span className="muted" style={{ fontSize: '.84rem' }}>No se subió comprobante (opcional).</span>}
              </div>
            </>
          )}
        </div>
      )}

      {/* Compra directa pagada: qué se compró + requerimiento */}
      {mov.categoria === 'compra_directa' && (
        <div className="card" style={{ marginBottom: '.75rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}>Compra directa</div>
          {cargandoCd && <div className="muted" style={{ fontSize: '.84rem' }}>Cargando la compra…</div>}
          {!cargandoCd && !compraDir && <div className="muted" style={{ fontSize: '.84rem' }}>No se pudo cargar la compra vinculada.</div>}
          {!cargandoCd && compraDir && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.35rem .9rem', fontSize: '.84rem' }}>
                <div><span className="muted">Compra:</span> <strong className="mono">{compraDir.codigo ?? '—'}</strong></div>
                {compraDir.proveedor_nombre && <div><span className="muted">Proveedor:</span> <strong>{compraDir.proveedor_nombre}</strong></div>}
                <div><span className="muted">Total:</span> <strong className="mono">{monto(Number(compraDir.gasto) || 0, compraDir.moneda)}</strong></div>
                <div><span className="muted">Almacén destino:</span> <strong>{compraDir.almacen || '—'}</strong></div>
                {compraDir.recibida_por && <div><span className="muted">Recibida por:</span> <strong>{compraDir.recibida_por}</strong></div>}
                {(compraDir.gasto_categoria || compraDir.gasto_subcategoria) && (
                  <div><span className="muted">Gasto:</span> <strong>{[compraDir.gasto_categoria, compraDir.gasto_subcategoria].filter(Boolean).join(' · ')}</strong></div>
                )}
              </div>

              {compraDir.nota && (
                <div style={{ marginTop: '.5rem', fontSize: '.84rem' }}>
                  <span className="muted">Requerimiento / nota:</span> {compraDir.nota}
                </div>
              )}

              <div style={{ marginTop: '.6rem' }}>
                <div className="muted" style={{ fontSize: '.78rem', marginBottom: '.25rem' }}>Qué se compró</div>
                <div className="table-wrap">
                  <table className="table" style={{ fontSize: '.82rem' }}>
                    <thead><tr><th>Material</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Gasto</th></tr></thead>
                    <tbody>
                      {!compraDir.items.length && <tr><td colSpan={3} className="muted" style={{ textAlign: 'center' }}>Sin renglones cargados.</td></tr>}
                      {compraDir.items.map((it, i) => (
                        <tr key={`${it.producto_sku ?? it.producto_nombre}-${i}`}>
                          <td>{it.producto_nombre}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{(Number(it.cantidad) || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 })}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{monto(Number(it.gasto) || 0, compraDir.moneda)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {correoOpen && (
        <DetalleCorreoModal mov={mov} orden={orden} defaultEmail={defaultEmail} onClose={() => setCorreoOpen(false)} />
      )}
      {confirmDel && (
        <ConfirmDialog
          title="Eliminar movimiento"
          message={`¿Eliminar este ${egreso ? 'egreso' : 'ingreso'} de ${monto(mov.monto, mov.moneda)}? Se revierte el saldo de la caja y se recalcula el Libro Mayor.${vinculado ? ' OJO: está vinculado a otro módulo (compra/nómina/traslado), que NO se revertirá automáticamente.' : ''}`}
          confirmText={guardando ? 'Eliminando…' : 'Eliminar'}
          danger
          onConfirm={eliminar}
          onCancel={() => setConfirmDel(false)}
        />
      )}
    </Modal>
  );
}

/** Envío por correo del detalle de un movimiento (mismo patrón que el reporte). */
function DetalleCorreoModal({ mov, orden, defaultEmail, onClose }: {
  mov: MovimientoCaja; orden: Orden | null; defaultEmail: string; onClose: () => void;
}) {
  const [incluirPropio, setIncluirPropio] = useState(true);
  const [extra, setExtra] = useState('');
  const [enviando, setEnviando] = useState(false);
  const propio = defaultEmail.trim().toLowerCase();
  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  async function handleEnviar() {
    const lista: string[] = [];
    if (incluirPropio && propio) lista.push(propio);
    const extraClean = extra.trim().toLowerCase();
    if (extraClean) {
      if (!emailRx.test(extraClean)) { toast('El correo adicional no es válido', 'error'); return; }
      lista.push(extraClean);
    }
    setEnviando(true);
    try {
      const { enviarMovimientoDetallePorCorreo } = await import('./enviarReporte');
      const r = await enviarMovimientoDetallePorCorreo(mov, orden, lista);
      notify(`Detalle enviado a ${r.destinatarios.join(', ')}`, 'success', { link: '#/app/tesoreria' });
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo enviar', 'error'); }
    finally { setEnviando(false); }
  }

  return (
    <Modal title="Enviar detalle por correo" size="md" onClose={() => !enviando && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={enviando}>Cancelar</button>
        <button className="btn btn-primary" onClick={handleEnviar} disabled={enviando}>{enviando ? 'Enviando…' : '📧 Enviar'}</button>
      </>
    }>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.88rem' }}>
        Se enviará el <strong>PDF del detalle</strong>{orden ? ' (con la orden pagada, seriales y comprobante)' : ''} a los destinatarios seleccionados.
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.7rem .85rem', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: incluirPropio ? 'rgba(255,138,0,0.06)' : 'transparent', cursor: propio ? 'pointer' : 'not-allowed', marginBottom: '.6rem' }}>
        <input type="checkbox" checked={incluirPropio} disabled={!propio} onChange={(e) => setIncluirPropio(e.target.checked)} />
        <div>
          <div style={{ fontWeight: 600 }}>Tu correo</div>
          <div className="mono" style={{ fontSize: '.82rem' }}>{propio || '—'}</div>
        </div>
      </label>
      <div className="form-row" style={{ marginTop: '.4rem' }}>
        <label>Correo adicional (opcional)</label>
        <input className="input" type="email" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="otro@correo.com" maxLength={120} />
        <small className="muted">Si no marcás ninguno, se envía a los admin/jefe.</small>
      </div>
    </Modal>
  );
}

/* ───────────── Detalle de caja (multimoneda: cuentas + divisas) ───────────── */

function CajaDetalleModal({ caja, canWrite, actor, actorName, onClose, onChanged }: {
  caja: Caja; canWrite: boolean; actor: string; actorName: string | null; onClose: () => void; onChanged: () => void | Promise<void>;
}) {
  const [saldos, setSaldos] = useState<CajaSaldo[]>([]);
  const [movs, setMovs] = useState<MovimientoCaja[]>([]);
  const [loading, setLoading] = useState(true);
  const [lotesDe, setLotesDe] = useState<{ moneda: string; cuenta: CuentaCaja } | null>(null);
  const [lotes, setLotes] = useState<CajaLote[]>([]);
  const [monedas, setMonedas] = useState<string[]>([...MONEDAS_CAJA]);
  const [nuevaMonedaOpen, setNuevaMonedaOpen] = useState(false);
  const [nuevaMoneda, setNuevaMoneda] = useState('');

  // Form de ingreso. Arranca en la moneda propia de la caja (USDT→USDT con tasa
  // Binance, Bs→Bs), pero se puede ingresar cualquier moneda (igual que Multimoneda).
  const [moneda, setMoneda] = useState<string>(caja.moneda || 'Bs');
  const [cuenta, setCuenta] = useState<CuentaCaja>(caja.moneda === 'Bs' ? 'juridica' : 'general');
  const [montoStr, setMontoStr] = useState('');
  const [tasaStr, setTasaStr] = useState('');
  const [origen, setOrigen] = useState('');
  // El origen del ingreso manual identifica de quién entra el dinero: cliente o proveedor.
  const [origenTipo, setOrigenTipo] = useState<'cliente' | 'proveedor' | ''>('');
  // Contrapartes guardadas (para buscar/reutilizar nombres en el campo origen).
  const [contrapartes, setContrapartes] = useState<Contraparte[]>([]);
  const reloadContrapartes = useCallback(() => {
    listContrapartes().then(setContrapartes).catch(() => setContrapartes([]));
  }, []);
  useEffect(() => { reloadContrapartes(); }, [reloadContrapartes]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mercado, setMercado] = useState<TasasMercado | null>(null);
  const [correoOpen, setCorreoOpen] = useState(false);

  // Sugerencia de tasa del día para la moneda elegida (Bs por 1 unidad).
  const tasaSugerida = moneda === 'Bs' || !mercado ? null : tasaCruzada(moneda as MonedaCaja, 'Bs', mercado);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m] = await Promise.all([saldosDeCaja(caja.id), listLibroMayor({ cajaId: caja.id })]);
      setSaldos(s); setMovs(m);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar la caja', 'error'); }
    finally { setLoading(false); }
  }, [caja.id]);
  useEffect(() => { void reload(); setLotesDe(null); }, [reload]);
  useEffect(() => { listMonedas().then(setMonedas).catch(() => setMonedas([...MONEDAS_CAJA])); }, []);
  useEffect(() => { getTasasMercado().then(setMercado).catch(() => setMercado(null)); }, []);

  // Al elegir una divisa con tasa de mercado (COP/USD/USDT), precarga la tasa del día (editable).
  useEffect(() => {
    if (tasaSugerida != null && tasaSugerida > 0) setTasaStr(String(tasaSugerida));
    else if (moneda === 'Bs') setTasaStr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moneda, mercado]);

  // La cuenta jurídica/personal solo aplica a Bs.
  useEffect(() => { setCuenta(moneda === 'Bs' ? 'juridica' : 'general'); }, [moneda]);

  async function agregarMoneda() {
    const code = nuevaMoneda.trim().toUpperCase();
    if (!code) { setNuevaMonedaOpen(false); return; }
    try {
      await addMoneda(code, actor);
      const lista = await listMonedas();
      setMonedas(lista); setMoneda(code);
      setNuevaMoneda(''); setNuevaMonedaOpen(false);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo agregar la moneda', 'error'); }
  }

  async function verLotes(s: CajaSaldo) {
    setLotesDe({ moneda: s.moneda, cuenta: s.cuenta });
    try { setLotes(await listLotes({ cajaId: caja.id, moneda: s.moneda, cuenta: s.cuenta })); }
    catch { setLotes([]); }
  }

  // Crea una billetera/cuenta vacía (saldo 0) para que aparezca por separado en los
  // saldos antes de ingresar dinero. No registra lote ni cuenta por cobrar.
  async function crearBilleteraEn0() {
    const c = ((cuenta as string).trim() || 'general') as CuentaCaja;
    const ya = saldos.some((s) => s.moneda === moneda && s.cuenta === c);
    if (ya) { toast(`La ${moneda === 'Bs' ? 'cuenta' : 'billetera'} "${labelCuentaCaja(c)}" en ${moneda} ya existe.`, 'warning'); return; }
    setSaving(true); setError(null);
    try {
      await ajustarSaldoDivisa({ cajaId: caja.id, cuenta: c, moneda, saldo: 0, tasaProm: null });
      notify(`${moneda === 'Bs' ? 'Cuenta' : 'Billetera'} ${moneda} · ${labelCuentaCaja(c)} creada en 0`, 'success', { link: '#/app/tesoreria' });
      await reload(); await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo crear la billetera.'); }
    finally { setSaving(false); }
  }

  async function ingresar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if ((Number(montoStr) || 0) <= 0) { setError('El monto debe ser mayor que 0.'); return; }
    if (moneda !== 'Bs' && (Number(tasaStr) || 0) <= 0) { setError('Indicá la tasa de compra (Bs por unidad).'); return; }
    // La contraparte es OPCIONAL: si elegís un tipo (cliente/proveedor) hay que poner el nombre.
    if (origenTipo && !origen.trim()) {
      setError(origenTipo === 'proveedor' ? 'Indicá la razón social del proveedor o elegí "Directo a caja".' : 'Indicá el nombre del cliente o elegí "Directo a caja".');
      return;
    }
    setSaving(true);
    try {
      // Con contraparte → se vuelve cuenta por pagar; sin contraparte → solo movimiento de caja.
      const tieneContraparte = !!origenTipo && !!origen.trim();
      const origenStr = tieneContraparte
        ? `${origenTipo === 'proveedor' ? 'Proveedor' : 'Cliente'}: ${origen.trim()}`
        : 'Ingreso directo a caja';
      const montoNum = Number(montoStr) || 0;
      await ingresarDivisa({
        cajaId: caja.id, cuenta, moneda, monto: montoNum,
        tasaBs: moneda === 'Bs' ? 1 : Number(tasaStr) || 0,
        origen: origenStr, actor, actorName,
      });
      // Solo si se indicó cliente/proveedor el ingreso se vuelve cuenta por pagar: si ya
      // existe una abierta del mismo (contraparte + moneda), SUMA (incremental); si no, la crea.
      if (tieneContraparte) {
        await registrarIngresoCxP({
          tipo: origenTipo as 'cliente' | 'proveedor', contraparte: origen.trim(), monto: montoNum, moneda, cuenta,
          cajaId: caja.id, nota: `Ingreso ${moneda} en ${caja.nombre}`, actor, actorName,
        });
        // Si el cliente/proveedor es nuevo, se guarda en el directorio para próximos pagos.
        const yaGuardado = contrapartes.some(
          (c) => c.tipo === origenTipo && c.nombre.trim().toUpperCase() === origen.trim().toUpperCase(),
        );
        if (!yaGuardado) {
          try { await crearContraparte({ tipo: origenTipo as 'cliente' | 'proveedor', nombre: origen.trim() }); reloadContrapartes(); }
          catch { /* duplicado u otra causa: no bloquea el ingreso */ }
        }
      }
      const etiqueta = moneda === 'Bs' ? `Bs · ${cuenta}` : moneda;
      notify(
        `Ingreso ${etiqueta} · ${monto(montoNum, moneda)} · ${tieneContraparte ? `${origenStr} · suma a la cuenta por pagar` : 'movimiento de caja'}`,
        'success', { link: '#/app/tesoreria' },
      );
      setMontoStr(''); setTasaStr(''); setOrigen(''); setOrigenTipo('');
      await reload(); await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo ingresar.'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={`Caja · ${caja.nombre}`} size="xl" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      {/* Saldos por cuenta/moneda */}
      <div className="card" style={{ marginBottom: '.6rem' }}>
        <div className="card-title" style={{ marginBottom: '.4rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.4rem' }}>
          <span>Saldos por cuenta / moneda</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
            <button className="btn btn-sm btn-ghost" disabled={!movs.length} onClick={async () => {
              try { const { descargarReportePdf } = await import('./reportePdf'); await descargarReportePdf(movs, { titulo: 'REPORTE DE CAJA', subtitulo: caja.nombre }); } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
            }}>↓ PDF</button>
            <button className="btn btn-sm btn-ghost" disabled={!movs.length} onClick={() => setCorreoOpen(true)}>✉ Correo</button>
          </span>
        </div>
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.84rem' }}>
            <thead><tr><th>Cuenta</th><th>Moneda</th><th style={{ textAlign: 'right' }}>Saldo</th><th></th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
              {!loading && !saldos.length && <tr><td colSpan={4}><EmptyState message="Sin saldos · ingresá dinero abajo" /></td></tr>}
              {!loading && saldos.map((s) => (
                <tr key={s.id}>
                  <td>{labelCuentaCaja(s.cuenta)}</td>
                  <td><span className="badge">{s.moneda}</span></td>
                  <td className="mono" style={{ textAlign: 'right' }}>{monto(s.saldo, s.moneda)}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-ghost" onClick={() => verLotes(s)}>Trazabilidad</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Comparativo de tasas: Binance (USDT/VES) vs BCV + margen de ahorro */}
      {(() => {
        const bin = mercado?.usdtVes ?? null;
        const bcv = mercado?.bcvUsd ?? null;
        const margen = bin && bcv && bin > 0 ? ((bin - bcv) / bin) * 100 : null;
        return (
          <div className="card" style={{ marginBottom: '.6rem' }}>
            <div className="card-title" style={{ marginBottom: '.4rem' }}><span>Tasas de referencia (Bs por USD)</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.6rem' }}>
              <div>
                <div className="muted" style={{ fontSize: '.68rem' }}>BINANCE (USDT/VES)</div>
                <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{bin != null ? monto(bin, 'Bs') : '—'}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '.68rem' }}>BCV</div>
                <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{bcv != null ? monto(bcv, 'Bs') : '—'}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '.68rem' }}>MARGEN DE AHORRO (vs Binance)</div>
                <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: margen != null && margen > 0 ? 'var(--success)' : 'var(--muted)' }}>
                  {margen != null ? `${margen.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %` : '—'}
                </div>
              </div>
            </div>
            <div className="muted" style={{ fontSize: '.7rem', marginTop: '.4rem' }}>
              El margen es cuánto se ahorra pagando a tasa BCV respecto a la de Binance: (Binance − BCV) ÷ Binance.
            </div>
          </div>
        );
      })()}

      {lotesDe && (
        <div className="card" style={{ marginBottom: '.6rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>Trazabilidad · {lotesDe.moneda}{lotesDe.cuenta !== 'general' ? ` · ${lotesDe.cuenta}` : ''} (lotes de ingreso)</span>
            <button className="btn btn-sm btn-ghost" onClick={() => setLotesDe(null)}>✕</button>
          </div>
          <div className="table-wrap" style={{ maxHeight: 200, overflowY: 'auto' }}>
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead><tr><th>Fecha</th><th style={{ textAlign: 'right' }}>Monto</th><th style={{ textAlign: 'right' }}>Tasa (Bs)</th><th>Origen</th><th>Registró</th></tr></thead>
              <tbody>
                {!lotes.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>Sin lotes</td></tr>}
                {lotes.map((l) => (
                  <tr key={l.id}>
                    <td>{dateTime(l.created_at)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{monto(l.monto, lotesDe.moneda)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{l.tasa_bs != null ? Number(l.tasa_bs).toLocaleString('es-VE', { maximumFractionDigits: 4 }) : '—'}</td>
                    <td>{l.origen || '—'}</td>
                    <td className="muted">{l.actor_name || l.actor || '—'}</td>
                  </tr>
                ))}
              </tbody>
              {lotes.length > 0 && (() => {
                const tot = lotes.reduce((a, l) => a + (Number(l.monto) || 0), 0);
                const prom = tot > 0 ? lotes.reduce((a, l) => a + (Number(l.monto) || 0) * (Number(l.tasa_bs) || 0), 0) / tot : 0;
                return (
                  <tfoot>
                    <tr>
                      <td style={{ fontWeight: 700 }}>Total</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{monto(tot, lotesDe.moneda)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: '#16c784' }} title="Promedio ponderado por monto de los lotes">{prom.toLocaleString('es-VE', { maximumFractionDigits: 4 })}</td>
                      <td colSpan={2} className="muted" style={{ fontSize: '.72rem' }}>Promedio ponderado de las tasas de ingreso</td>
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>
        </div>
      )}

      {correoOpen && <EnviarReporteModal movs={movs} meta={{ titulo: 'REPORTE DE CAJA', subtitulo: caja.nombre }} defaultEmail={actor} onClose={() => setCorreoOpen(false)} />}

      {/* Ingresar dinero (cuenta jurídica/personal en Bs, o divisa con tasa) */}
      {canWrite && (
        <form onSubmit={ingresar} className="card" style={{ marginBottom: '.6rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}>Ingresar dinero (suma al saldo y recalcula el promedio)</div>
          {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.5rem' }}><strong>Error:</strong> {error}</div>}
          <div className="form-grid">
            <div className="form-row">
              <label>Moneda</label>
              {nuevaMonedaOpen ? (
                <div style={{ display: 'flex', gap: '.3rem' }}>
                  <input className="input mono" value={nuevaMoneda} autoFocus placeholder="Ej. EUR, PEN…"
                    onChange={(e) => setNuevaMoneda(e.target.value.toUpperCase())}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void agregarMoneda(); } if (e.key === 'Escape') setNuevaMonedaOpen(false); }} />
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => void agregarMoneda()}>✓</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNuevaMonedaOpen(false)}>✕</button>
                </div>
              ) : (
                <select className="select" value={moneda}
                  onChange={(e) => { if (e.target.value === '__nueva__') setNuevaMonedaOpen(true); else setMoneda(e.target.value); }}>
                  {monedas.map((m) => <option key={m} value={m}>{m}</option>)}
                  <option value="__nueva__">+ Nueva moneda…</option>
                </select>
              )}
            </div>
            {moneda === 'Bs' ? (
              <div className="form-row">
                <label>Cuenta</label>
                <select className="select" value={cuenta} onChange={(e) => setCuenta(e.target.value as CuentaCaja)}>
                  <option value="juridica">Jurídica</option>
                  <option value="personal">Personal</option>
                </select>
              </div>
            ) : (
              <div className="form-row">
                <label>Billetera / cuenta</label>
                <input className="input" list={`wallets-${moneda}`} value={cuenta === 'general' ? '' : cuenta}
                  onChange={(e) => setCuenta((e.target.value.trim() || 'general') as CuentaCaja)}
                  placeholder="general (o nombrala: usdt1, usdt2…)" />
                <datalist id={`wallets-${moneda}`}>
                  {Array.from(new Set(saldos.filter((s) => s.moneda === moneda && s.cuenta !== 'general').map((s) => s.cuenta))).map((c) => <option key={c} value={c} />)}
                </datalist>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.4rem', marginTop: '.3rem', flexWrap: 'wrap' }}>
                  <small className="muted" style={{ flex: 1 }}>Vacío = "general". Nombrá billeteras separadas (usdt1, usdt2…) y se muestran por separado.</small>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={saving} onClick={() => void crearBilleteraEn0()} title="Crea la billetera/cuenta con saldo 0">
                    ＋ Crear en 0
                  </button>
                </div>
              </div>
            )}
            <div className="form-row">
              <label>Monto ({moneda})</label>
              <input className="input mono" type="number" min={0} step="any" value={montoStr} onChange={(e) => setMontoStr(dosDecimales(e.target.value))} placeholder="0,00" required />
            </div>
            {moneda !== 'Bs' && (
              <div className="form-row">
                <label>Tasa de compra (Bs por 1 {moneda})</label>
                <input className="input mono" type="number" min={0} step="any" value={tasaStr} onChange={(e) => setTasaStr(e.target.value)} required />
                {tasaSugerida != null && tasaSugerida > 0 && (
                  <small className="muted" style={{ display: 'flex', alignItems: 'center', gap: '.35rem', marginTop: '.2rem' }}>
                    Tasa del día: <strong className="mono">{tasaSugerida.toLocaleString('es-VE', { maximumFractionDigits: 4 })}</strong>
                    <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 .4rem' }}
                      onClick={() => setTasaStr(String(tasaSugerida))}>Usar</button>
                  </small>
                )}
              </div>
            )}
            <div className="form-row">
              <label>Origen del dinero <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
              <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.4rem', flexWrap: 'wrap' }}>
                {([
                  { val: '' as const, icon: '💵', txt: 'Directo a caja' },
                  { val: 'cliente' as const, icon: '👤', txt: 'Cliente' },
                  { val: 'proveedor' as const, icon: '🏭', txt: 'Proveedor' },
                ]).map((o) => {
                  const sel = origenTipo === o.val;
                  return (
                    <label key={o.val || 'directo'} style={{
                      display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer',
                      padding: '.4rem .7rem', borderRadius: 'var(--r-md)',
                      border: `1px solid ${sel ? 'var(--primary)' : 'var(--border)'}`,
                      background: sel ? 'rgba(255,138,0,0.10)' : 'transparent', flex: 1, justifyContent: 'center',
                    }}>
                      <input type="radio" name="origen-tipo" checked={sel} onChange={() => { setOrigenTipo(o.val); setOrigen(''); }} />
                      <span style={{ fontWeight: 600 }}>{o.icon} {o.txt}</span>
                    </label>
                  );
                })}
              </div>
              {!origenTipo && (
                <small className="muted">Sin cliente/proveedor: el dinero solo <strong>suma a la caja</strong> (no genera cuenta por pagar).</small>
              )}
              {origenTipo && (() => {
                const guardados = contrapartes.filter((c) => c.tipo === origenTipo);
                const existe = guardados.some((c) => c.nombre.trim().toUpperCase() === origen.trim().toUpperCase());
                return (
                <>
                  <input
                    className="input"
                    list="origen-contrapartes"
                    value={origen}
                    onChange={(e) => setOrigen(e.target.value)}
                    placeholder={origenTipo === 'proveedor' ? 'Buscar o agregar razón social del proveedor…' : 'Buscar o agregar nombre del cliente…'}
                    autoFocus
                  />
                  <datalist id="origen-contrapartes">
                    {guardados.map((c) => <option key={c.id} value={c.nombre} />)}
                  </datalist>
                  <small className="muted">
                    Buscá en los {guardados.length} {origenTipo === 'proveedor' ? 'proveedor(es)' : 'cliente(s)'} guardados o escribí uno nuevo.{' '}
                    {origen.trim() && !existe
                      ? <strong style={{ color: 'var(--primary-3, #ff8a00)' }}>Nuevo → se guardará para próximos pagos.</strong>
                      : 'Se gestionan en “👥 Clientes / Proveedores”.'}
                  </small>
                </>
                );
              })()}
            </div>
          </div>
          {moneda !== 'Bs' && (Number(montoStr) || 0) > 0 && (Number(tasaStr) || 0) > 0 && (() => {
            const saldoActual = saldos.find((s) => s.moneda === moneda && s.cuenta === cuenta);
            const sa = Number(saldoActual?.saldo) || 0;
            const tp = Number(saldoActual?.tasa_prom) || 0;
            const mn = Number(montoStr) || 0;
            const tn = Number(tasaStr) || 0;
            const nuevoSaldo = sa + mn;
            const nuevoProm = nuevoSaldo > 0 ? (sa * tp + mn * tn) / nuevoSaldo : tn;
            const f4 = (n: number) => n.toLocaleString('es-VE', { maximumFractionDigits: 4 });
            return (
              <div className="card" style={{ marginTop: '.5rem', padding: '.55rem .7rem', background: 'var(--bg-1)' }}>
                <div style={{ fontSize: '.83rem' }}>
                  Entran <strong className="mono">{monto(mn, moneda)}</strong> a tasa <strong className="mono">{f4(tn)}</strong> Bs.
                  {sa > 0 ? (
                    <> Ya tenías <strong className="mono">{monto(sa, moneda)}</strong> a prom. <strong className="mono">{f4(tp)}</strong> → quedan{' '}
                      <strong className="mono">{monto(nuevoSaldo, moneda)}</strong> a <strong>promedio ponderado</strong>{' '}
                      <strong className="mono" style={{ color: '#16c784', fontWeight: 800 }}>{f4(nuevoProm)}</strong> Bs.</>
                  ) : (
                    <> Es el primer lote → promedio <strong className="mono" style={{ color: '#16c784', fontWeight: 800 }}>{f4(tn)}</strong> Bs.</>
                  )}
                </div>
              </div>
            );
          })()}
          <div style={{ textAlign: 'right', marginTop: '.5rem' }}>
            <button type="submit" className="btn btn-success" disabled={saving}>{saving ? 'Ingresando…' : '+ Ingresar'}</button>
          </div>
          <small className="muted">El Bs se maneja en dos cuentas: <strong>jurídica</strong> y <strong>personal</strong>. Las divisas guardan su tasa de compra; cada ingreso es un <strong>lote</strong> con su tasa, y el saldo muestra el <strong>promedio ponderado</strong> (ver Trazabilidad).</small>
        </form>
      )}

      {/* Movimientos (libro de la caja) */}
      <div className="card">
        <div className="card-title" style={{ marginBottom: '.5rem' }}>Movimientos de esta caja</div>
        <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead><tr><th>Fecha</th><th>Movimiento</th><th>Concepto</th><th style={{ textAlign: 'right' }}>Monto</th><th style={{ textAlign: 'right' }}>Saldo</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
              {!loading && !movs.length && <tr><td colSpan={5}><EmptyState message="Sin movimientos en esta caja" /></td></tr>}
              {!loading && movs.map((m) => {
                const egreso = m.tipo === 'salida' || m.tipo === 'traslado_salida'
                  || (m.tipo === 'ajuste' && Number(m.saldo_despues) < Number(m.saldo_antes));
                const concepto = [CAT_LABEL[m.categoria ?? ''], m.beneficiario, m.motivo, m.destino].filter(Boolean).join(' · ') || '—';
                return (
                  <tr key={m.id}>
                    <td>{dateTime(m.at)}</td>
                    <td>{TIPO_MOV_LABEL[m.tipo] ?? m.tipo}</td>
                    <td>{concepto}</td>
                    <td className="mono" style={{ textAlign: 'right', color: egreso ? 'var(--danger)' : 'var(--success)' }}>{egreso ? '−' : '+'}{monto(m.monto, m.moneda)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{monto(m.saldo_despues, m.moneda)}</td>
                  </tr>
                );
              })}
            </tbody>
            {!loading && movs.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>Total neto · {movs.length} mov.</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>
                    {totalesMontoPorMoneda(movs).map(([mon, tot]) => (
                      <div key={mon} style={{ whiteSpace: 'nowrap', color: tot < 0 ? 'var(--danger)' : 'var(--success)' }}>
                        {tot < 0 ? '−' : '+'}{monto(Math.abs(tot), mon)}
                      </div>
                    ))}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </Modal>
  );
}

function DispCard({ titulo, valor, nota, destacado }: { titulo: string; valor: string; nota?: string; destacado?: boolean }) {
  return (
    <div className="card" style={destacado ? { borderColor: 'var(--brand, #ff8a00)' } : undefined}>
      <div className="muted" style={{ fontSize: '.74rem' }}>{titulo}</div>
      <strong className="mono" style={{ fontSize: '1.25rem' }}>{valor}</strong>
      {nota && <div className="muted" style={{ fontSize: '.68rem', marginTop: '.2rem' }}>{nota}</div>}
    </div>
  );
}

/* ───────────── Directorio de clientes / proveedores ───────────── */
const VACIA = { tipo: 'proveedor' as TipoContraparte, nombre: '', rif: '', telefono: '', email: '', nota: '' };
function ContrapartesModal({ onClose }: { onClose: () => void }) {
  const [lista, setLista] = useState<Contraparte[]>([]);
  const [filtro, setFiltro] = useState<'todos' | TipoContraparte>('todos');
  const [form, setForm] = useState({ ...VACIA });
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    try { setLista(await listContrapartes()); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar', 'error'); }
  }, []);
  useEffect(() => { void recargar(); }, [recargar]);

  function nuevo() { setEditId(null); setForm({ ...VACIA }); setError(null); }
  function editar(c: Contraparte) {
    setEditId(c.id);
    setForm({ tipo: c.tipo, nombre: c.nombre, rif: c.rif ?? '', telefono: c.telefono ?? '', email: c.email ?? '', nota: c.nota ?? '' });
    setError(null);
  }

  async function guardar() {
    if (!form.nombre.trim()) { setError(form.tipo === 'proveedor' ? 'Indicá la razón social.' : 'Indicá el nombre del cliente.'); return; }
    setBusy(true); setError(null);
    try {
      if (editId) await actualizarContraparte(editId, form);
      else await crearContraparte(form);
      toast(editId ? 'Actualizado' : 'Registrado', 'success');
      nuevo();
      await recargar();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); }
    finally { setBusy(false); }
  }

  async function borrar(c: Contraparte) {
    if (!window.confirm(`¿Eliminar a "${c.nombre}"?`)) return;
    try { await eliminarContraparte(c.id); if (editId === c.id) nuevo(); await recargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  const visibles = lista.filter((c) => filtro === 'todos' || c.tipo === filtro);

  return (
    <Modal title="Clientes / Proveedores" size="lg" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      {/* Alta / edición */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-title"><span>{editId ? 'Editar' : 'Nuevo'} registro</span></div>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', margin: '0 0 .6rem' }}><strong>Error:</strong> {error}</div>}
        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.5rem' }}>
          {(['cliente', 'proveedor'] as const).map((t) => {
            const sel = form.tipo === t;
            return (
              <label key={t} style={{
                display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', flex: 1, justifyContent: 'center',
                padding: '.4rem .7rem', borderRadius: 'var(--r-md)',
                border: `1px solid ${sel ? 'var(--primary)' : 'var(--border)'}`,
                background: sel ? 'rgba(255,138,0,0.10)' : 'transparent',
              }}>
                <input type="radio" name="cp-tipo" checked={sel} onChange={() => setForm((f) => ({ ...f, tipo: t }))} />
                <span style={{ fontWeight: 600 }}>{t === 'cliente' ? '👤 Cliente' : '🏭 Proveedor'}</span>
              </label>
            );
          })}
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>{form.tipo === 'proveedor' ? 'Razón social' : 'Nombre del cliente'}</label>
            <input className="input" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
          </div>
          <div className="form-row">
            <label>RIF / C.I. (opcional)</label>
            <input className="input" value={form.rif} onChange={(e) => setForm((f) => ({ ...f, rif: e.target.value }))} />
          </div>
          <div className="form-row">
            <label>Teléfono (opcional)</label>
            <input className="input" value={form.telefono} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} />
          </div>
          <div className="form-row">
            <label>Correo (opcional)</label>
            <input className="input" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>
        </div>
        <div className="form-row">
          <label>Nota (opcional)</label>
          <input className="input" value={form.nota} onChange={(e) => setForm((f) => ({ ...f, nota: e.target.value }))} />
        </div>
        <div className="actions" style={{ marginTop: '.5rem' }}>
          <button className="btn btn-primary btn-sm" onClick={guardar} disabled={busy}>{busy ? 'Guardando…' : (editId ? 'Guardar cambios' : '+ Registrar')}</button>
          {editId && <button className="btn btn-ghost btn-sm" onClick={nuevo} disabled={busy}>Cancelar edición</button>}
        </div>
      </div>

      {/* Listado */}
      <div className="filterbar" style={{ justifyContent: 'flex-start', gap: '.4rem', marginBottom: '.5rem' }}>
        {(['todos', 'cliente', 'proveedor'] as const).map((t) => (
          <button key={t} className={`btn btn-sm ${filtro === t ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFiltro(t)}>
            {t === 'todos' ? 'Todos' : t === 'cliente' ? 'Clientes' : 'Proveedores'}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Categoría</th><th>Nombre / Razón social</th><th>RIF / C.I.</th><th>Contacto</th><th></th></tr></thead>
          <tbody>
            {!visibles.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>Sin registros.</td></tr>}
            {visibles.map((c) => (
              <tr key={c.id}>
                <td><span className="badge">{c.tipo === 'cliente' ? '👤 Cliente' : '🏭 Proveedor'}</span></td>
                <td>{c.nombre}</td>
                <td className="mono">{c.rif || '—'}</td>
                <td className="muted" style={{ fontSize: '.82rem' }}>{[c.telefono, c.email].filter(Boolean).join(' · ') || '—'}</td>
                <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => editar(c)}>✎</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => borrar(c)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/* ───────────── Modales ───────────── */

function GastoModal({ cajas, actor, actorName, onClose, onSaved }: {
  cajas: Caja[]; actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [cajaId, setCajaId] = useState(cajas[0]?.id ?? '');
  const [concepto, setConcepto] = useState('');
  const [montoStr, setMontoStr] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const caja = cajas.find((c) => c.id === cajaId) ?? null;

  // Categorías → subcategorías de gasto (obligatorias, buscables).
  const [catRows, setCatRows] = useState<CategoriaGasto[]>([]);
  const [catId, setCatId] = useState('');
  const [subId, setSubId] = useState('');
  const cargarCats = useCallback(() => { listCategoriasGasto(true).then(setCatRows).catch(() => setCatRows([])); }, []);
  useEffect(() => { cargarCats(); }, [cargarCats]);
  useRealtime(['categorias_gasto'], cargarCats);
  const categorias = soloCategorias(catRows);
  const subcategorias = catId ? subcategoriasDe(catRows, catId) : [];
  useEffect(() => { setSubId(''); }, [catId]); // al cambiar categoría, resetea subcategoría

  // Saldos reales de la caja (multimoneda: cada cuenta/moneda con su saldo).
  const [saldosCaja, setSaldosCaja] = useState<CajaSaldo[]>([]);
  const [saldoSelId, setSaldoSelId] = useState('');
  useEffect(() => {
    if (!cajaId) { setSaldosCaja([]); setSaldoSelId(''); return; }
    saldosDeCaja(cajaId).then((rows) => {
      const conSaldo = rows.filter((r) => Number(r.saldo) > 0);
      setSaldosCaja(conSaldo);
      setSaldoSelId(conSaldo[0]?.id ?? '');
    }).catch(() => { setSaldosCaja([]); setSaldoSelId(''); });
  }, [cajaId]);

  const esMulti = saldosCaja.length > 0;
  const selSaldo = saldosCaja.find((s) => s.id === saldoSelId) ?? null;
  const monedaPago = esMulti ? (selSaldo?.moneda ?? caja?.moneda ?? 'Bs') : (caja?.moneda ?? 'Bs');
  const cuentaPago = esMulti ? (selSaldo?.cuenta ?? 'general') : null;
  const disponible = esMulti ? (Number(selSaldo?.saldo) || 0) : (Number(caja?.saldo) || 0);

  const catNombre = categorias.find((c) => c.id === catId)?.nombre ?? '';
  const subNombre = subcategorias.find((s) => s.id === subId)?.nombre ?? '';

  // Correlativo numérico (solo RECEPCION / EXPORTACION): la primera vez el usuario
  // ingresa el número inicial; de ahí en más se sugiere automático (max+1).
  const llevaCorrelativo = categoriaLlevaCorrelativo(catNombre);
  const [correlativoStr, setCorrelativoStr] = useState('');
  const [correlativoAuto, setCorrelativoAuto] = useState(false); // true = ya hay previos (autoincrementa)
  useEffect(() => {
    if (!llevaCorrelativo) { setCorrelativoStr(''); setCorrelativoAuto(false); return; }
    let vivo = true;
    proximoCorrelativoGasto(catNombre).then((next) => {
      if (!vivo) return;
      if (next == null) { setCorrelativoStr(''); setCorrelativoAuto(false); }      // primera vez
      else { setCorrelativoStr(String(next)); setCorrelativoAuto(true); }          // autoincremento
    }).catch(() => { if (vivo) { setCorrelativoStr(''); setCorrelativoAuto(false); } });
    return () => { vivo = false; };
  }, [llevaCorrelativo, catNombre]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!cajaId) { setError('Elegí la caja.'); return; }
    if (esMulti && !selSaldo) { setError('Elegí de qué saldo (moneda) se paga.'); return; }
    if (!catId) { setError('Elegí la categoría del gasto.'); return; }
    if (!subId) { setError('Elegí la subcategoría del gasto.'); return; }
    let correlativo: number | null = null;
    if (llevaCorrelativo) {
      correlativo = Math.trunc(Number(correlativoStr));
      if (!correlativo || correlativo <= 0) { setError(`Indicá el número de ${catNombre}.`); return; }
    }
    const m = Number(montoStr) || 0;
    if (m > disponible + 0.01) { setError(`Saldo insuficiente. Disponible: ${monto(disponible, monedaPago)}.`); return; }
    setSaving(true);
    try {
      await registrarGasto({ cajaId, monto: m, concepto, cuenta: cuentaPago, moneda: monedaPago, gastoCategoria: catNombre, gastoSubcategoria: subNombre, gastoCorrelativo: correlativo, actor, actorName });
      notify(`Gasto registrado: ${monto(m, monedaPago)}`, 'success', { link: '#/app/tesoreria' });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo registrar.'); setSaving(false); }
  }

  return (
    <Modal title="Registrar gasto" size="md" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="teso-gasto" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Registrar gasto'}</button></>
    }>
      <form id="teso-gasto" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-grid">
          <div className="form-row">
            <label>Caja</label>
            <select className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
              {!cajas.length && <option value="">— sin cajas —</option>}
              {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          {esMulti && (
            <div className="form-row">
              <label>Saldo (moneda / cuenta)</label>
              <select className="select" value={saldoSelId} onChange={(e) => setSaldoSelId(e.target.value)}>
                {saldosCaja.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.moneda}{s.cuenta !== 'general' ? ` · ${labelCuentaCaja(s.cuenta)}` : ''} · {monto(Number(s.saldo), s.moneda)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-row">
            <label>Monto ({monedaPago})</label>
            <input className="input mono" type="number" min={0} step="any" value={montoStr} onChange={(e) => setMontoStr(dosDecimales(e.target.value))} required />
            <small className="muted">Disponible: <strong className="mono">{monto(disponible, monedaPago)}</strong></small>
          </div>
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Categoría de gasto <span style={{ color: 'var(--danger)' }}>*</span></label>
            <SearchSelect
              value={catId}
              onChange={setCatId}
              options={categorias.map((c) => ({ value: c.id, label: c.nombre }))}
              placeholder="Buscar categoría…"
              emptyText="Sin categorías. Cargalas en 'Categorías de gasto'."
            />
          </div>
          <div className="form-row">
            <label>Subcategoría <span style={{ color: 'var(--danger)' }}>*</span></label>
            <SearchSelect
              value={subId}
              onChange={setSubId}
              options={subcategorias.map((s) => ({ value: s.id, label: s.nombre }))}
              placeholder={catId ? 'Buscar subcategoría…' : 'Elegí primero la categoría'}
              emptyText={catId ? 'Esta categoría no tiene subcategorías.' : 'Elegí una categoría'}
              disabled={!catId}
            />
          </div>
        </div>
        {llevaCorrelativo && (
          <div className="form-row">
            <label>N° de {catNombre} <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input
              className="input mono"
              type="number"
              min={1}
              step={1}
              value={correlativoStr}
              onChange={(e) => setCorrelativoStr(e.target.value)}
              placeholder={correlativoAuto ? '' : 'Ingresá el número inicial'}
              required
            />
            <small className="muted">
              {correlativoAuto
                ? <>Correlativo automático (siguiente disponible). Podés ajustarlo si hace falta.</>
                : <>Primera vez para <strong>{catNombre}</strong>: ingresá el número inicial; de ahí en más se autoincrementa.</>}
            </small>
          </div>
        )}
        <div className="form-row">
          <label>Concepto</label>
          <input className="input" value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="A qué corresponde el gasto" required />
          <small className="muted">El gasto queda etiquetado por la <strong>categoría → subcategoría</strong> y la moneda elegida; aparece en el registro y en GASTOS / MOVIMIENTOS.</small>
        </div>
      </form>
    </Modal>
  );
}

/* ───────────── Vista GASTOS / MOVIMIENTOS (desglose por categoría → subcategoría) ───────────── */
function GastosView({ libro, onVerMov }: { libro: MovimientoCaja[]; onVerMov: (m: MovimientoCaja) => void }) {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [buscar, setBuscar] = useState('');
  const [openCat, setOpenCat] = useState('');
  const [openSub, setOpenSub] = useState('');
  const [verDetalle, setVerDetalle] = useState(false);

  const gastos = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return libro.filter((m) => (m.categoria ?? '') === 'gasto').filter((m) => {
      const f = (m.at ?? '').slice(0, 10);
      if (desde && f < desde) return false;
      if (hasta && f > hasta) return false;
      if (q) {
        const hay = [m.gasto_categoria, m.gasto_subcategoria, m.motivo, String(m.monto), m.moneda].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [libro, desde, hasta, buscar]);

  const grupos = useMemo(() => {
    type Sub = { nombre: string; totales: Record<string, number>; count: number; movs: MovimientoCaja[] };
    type Cat = { nombre: string; totales: Record<string, number>; count: number; subs: Map<string, Sub> };
    const map = new Map<string, Cat>();
    for (const m of gastos) {
      const cat = m.gasto_categoria || '(Sin categoría)';
      const sub = m.gasto_subcategoria || '(Sin subcategoría)';
      if (!map.has(cat)) map.set(cat, { nombre: cat, totales: {}, count: 0, subs: new Map() });
      const g = map.get(cat)!;
      g.totales[m.moneda] = round2((g.totales[m.moneda] || 0) + Number(m.monto));
      g.count++;
      if (!g.subs.has(sub)) g.subs.set(sub, { nombre: sub, totales: {}, count: 0, movs: [] });
      const s = g.subs.get(sub)!;
      s.totales[m.moneda] = round2((s.totales[m.moneda] || 0) + Number(m.monto));
      s.count++;
      s.movs.push(m);
    }
    return Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [gastos]);

  const fmt = (t: Record<string, number>) => Object.entries(t).map(([mon, val]) => monto(val, mon)).join(' · ') || '—';

  // Total general de gastos del período (suma por moneda) — alimenta la barra de resumen.
  const totalesGeneral = useMemo(() => {
    const t: Record<string, number> = {};
    for (const m of gastos) t[m.moneda] = round2((t[m.moneda] || 0) + Number(m.monto));
    return t;
  }, [gastos]);

  // Monedas presentes (orden fijo: Bs, USDT, USD, resto) y filas planas para el PDF.
  const monedas = useMemo(() => {
    const orden = ['Bs', 'USDT', 'USD'];
    const set = Array.from(new Set(gastos.map((m) => m.moneda)));
    return set.sort((a, b) => {
      const ia = orden.indexOf(a), ib = orden.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'es');
    });
  }, [gastos]);
  const reporteRows = useMemo(() => grupos.flatMap((g) =>
    Array.from(g.subs.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      .map((s) => ({ categoria: g.nombre, subcategoria: s.nombre, count: s.count, totales: s.totales }))
  ), [grupos]);

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
        <span>Gastos por categoría · subcategoría</span>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="🔍 Buscar categoría/subcategoría/concepto…" style={{ width: 260 }} />
          <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
            Desde <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={{ width: 'auto' }} />
          </label>
          <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
            Hasta <input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={{ width: 'auto' }} />
          </label>
          {(desde || hasta) && <button className="btn btn-sm btn-ghost" onClick={() => { setDesde(''); setHasta(''); }}>✕ Fechas</button>}
        </div>
      </div>

      {/* Barra de resumen (estilo Combustible): total de gastos del período · clic = detalle */}
      {grupos.length > 0 && (
        <button type="button" onClick={() => setVerDetalle(true)} title="Ver el detalle de todos los gastos del período"
          className="card" style={{ width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: '.5rem',
            borderColor: 'var(--primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
          <div>
            <span className="muted" style={{ fontSize: '.8rem', textTransform: 'uppercase', letterSpacing: '.03em' }}>
              Total de gastos{(desde || hasta) ? ' · período' : ''}
            </span>
            <div className="muted" style={{ fontSize: '.78rem', marginTop: '.15rem' }}>
              {gastos.length} movimiento(s) · {grupos.length} categoría(s) · clic para ver el detalle
            </div>
          </div>
          <strong className="mono" style={{ fontSize: '1.25rem', color: 'var(--primary-3)' }}>{fmt(totalesGeneral)}</strong>
        </button>
      )}

      {!grupos.length ? (
        <EmptyState message="Sin gastos en el período. Registrá un gasto con su categoría/subcategoría." icon="💸" />
      ) : (
        <div style={{ display: 'grid', gap: '.3rem' }}>
          {grupos.map((g) => {
            const abierta = openCat === g.nombre;
            return (
              <div key={g.nombre} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <button type="button" onClick={() => { setOpenCat(abierta ? '' : g.nombre); setOpenSub(''); }}
                  style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--text,#fff)', cursor: 'pointer',
                    padding: '.55rem .7rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem' }}>
                  <span style={{ fontWeight: 600 }}>{abierta ? '▾' : '▸'} {g.nombre} <span className="muted" style={{ fontWeight: 400, fontSize: '.78rem' }}>· {g.count} mov.</span></span>
                  <span className="mono" style={{ fontSize: '.84rem' }}>{fmt(g.totales)}</span>
                </button>
                {abierta && (
                  <div style={{ padding: '0 .5rem .5rem 1rem', display: 'grid', gap: '.2rem' }}>
                    {Array.from(g.subs.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map((s) => {
                      const subAbierta = openSub === g.nombre + '|' + s.nombre;
                      return (
                        <div key={s.nombre} className="card" style={{ padding: 0, borderColor: 'var(--border)' }}>
                          <button type="button" onClick={() => setOpenSub(subAbierta ? '' : g.nombre + '|' + s.nombre)}
                            style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--text,#fff)', cursor: 'pointer',
                              padding: '.4rem .6rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', fontSize: '.84rem' }}>
                            <span>{subAbierta ? '▾' : '▸'} {s.nombre} <span className="muted" style={{ fontSize: '.74rem' }}>· {s.count}</span></span>
                            <span className="mono" style={{ fontSize: '.8rem' }}>{fmt(s.totales)}</span>
                          </button>
                          {subAbierta && (
                            <div className="table-wrap" style={{ padding: '0 .4rem .4rem' }}>
                              <table className="table" style={{ fontSize: '.8rem' }}>
                                <thead><tr><th>Fecha</th><th>Concepto</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead>
                                <tbody>
                                  {s.movs.slice().sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')).map((m) => (
                                    <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => onVerMov(m)}>
                                      <td>{dateTime(m.at)}</td>
                                      <td>
                                        {m.gasto_correlativo != null && (
                                          <span className="badge" style={{ marginRight: '.4rem' }}>N° {m.gasto_correlativo}</span>
                                        )}
                                        {m.motivo || '—'}
                                      </td>
                                      <td className="mono" style={{ textAlign: 'right' }}>{monto(Number(m.monto), m.moneda)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {verDetalle && (
        <GastosDetalleModal
          gastos={gastos} reporteRows={reporteRows} monedas={monedas} totales={totalesGeneral}
          desde={desde} hasta={hasta} onVerMov={onVerMov} onClose={() => setVerDetalle(false)}
        />
      )}
    </div>
  );
}

/* ───────────── Detalle de gastos (barra de resumen → tabla + PDF en vista previa) ───────────── */
function GastosDetalleModal({ gastos, reporteRows, monedas, totales, desde, hasta, onVerMov, onClose }: {
  gastos: MovimientoCaja[];
  reporteRows: { categoria: string; subcategoria: string; count: number; totales: Record<string, number> }[];
  monedas: string[];
  totales: Record<string, number>;
  desde: string; hasta: string;
  onVerMov: (m: MovimientoCaja) => void;
  onClose: () => void;
}) {
  const [generando, setGenerando] = useState(false);
  const filas = useMemo(() => gastos.slice().sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')), [gastos]);
  const fmtT = (t: Record<string, number>) => Object.entries(t).map(([mon, val]) => monto(val, mon)).join(' · ') || '—';

  async function descargarPdf() {
    setGenerando(true);
    try {
      const { descargarReporteGastosPdf } = await import('./gastosReportePdf');
      await descargarReporteGastosPdf(reporteRows, monedas, { desde: desde || undefined, hasta: hasta || undefined });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
    finally { setGenerando(false); }
  }

  return (
    <Modal title="Detalle de gastos" size="lg" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={descargarPdf} disabled={generando} style={{ marginRight: 'auto' }}>
          {generando ? 'Generando…' : '↓ PDF (vista previa)'}
        </button>
        <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
      </>
    }>
      <div className="card" style={{ borderColor: 'var(--primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem', marginBottom: '.6rem' }}>
        <span className="muted" style={{ fontSize: '.8rem', textTransform: 'uppercase' }}>
          Total{(desde || hasta) ? ' del período' : ''} · {gastos.length} movimiento(s)
        </span>
        <strong className="mono" style={{ fontSize: '1.15rem', color: 'var(--primary-3)' }}>{fmtT(totales)}</strong>
      </div>
      {!filas.length ? (
        <EmptyState message="Sin gastos en el período." icon="💸" />
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead><tr><th>Fecha</th><th>Categoría</th><th>Subcategoría</th><th>Concepto</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead>
            <tbody>
              {filas.map((m) => (
                <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => onVerMov(m)} title="Ver / editar el movimiento">
                  <td>{dateTime(m.at)}</td>
                  <td>{m.gasto_categoria || '(Sin categoría)'}</td>
                  <td>{m.gasto_subcategoria || '(Sin subcategoría)'}</td>
                  <td>
                    {m.gasto_correlativo != null && <span className="badge" style={{ marginRight: '.4rem' }}>N° {m.gasto_correlativo}</span>}
                    {m.motivo || '—'}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{monto(Number(m.monto), m.moneda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/* ───────────── Administrador de categorías → subcategorías de gasto ───────────── */
function CategoriasGastoModal({ actor, onClose }: { actor: string; onClose: () => void }) {
  const [rows, setRows] = useState<CategoriaGasto[]>([]);
  const [loading, setLoading] = useState(true);
  const [selCat, setSelCat] = useState('');
  const [nuevaCat, setNuevaCat] = useState('');
  const [nuevaSub, setNuevaSub] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pegarOpen, setPegarOpen] = useState(false);
  const [pegado, setPegado] = useState('');
  const [buscarCat, setBuscarCat] = useState('');
  const [buscarSub, setBuscarSub] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    try { setRows(await listCategoriasGasto(false)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['categorias_gasto'], () => { void cargar(); });

  const cats = soloCategorias(rows);
  const subs = selCat ? subcategoriasDe(rows, selCat) : [];
  const catSel = cats.find((c) => c.id === selCat) ?? null;
  const qCat = normalizarBusqueda(buscarCat);
  const qSub = normalizarBusqueda(buscarSub);
  const catsFiltradas = qCat ? cats.filter((c) => normalizarBusqueda(c.nombre).includes(qCat)) : cats;
  const subsFiltradas = qSub ? subs.filter((s) => normalizarBusqueda(s.nombre).includes(qSub)) : subs;

  async function addCat() {
    const n = nuevaCat.trim(); if (!n) return;
    setBusy(true); setError(null);
    try { const c = await ensureCategoriaGasto(n, null, actor); setNuevaCat(''); await cargar(); setSelCat(c.id); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear'); } finally { setBusy(false); }
  }
  async function addSub() {
    const n = nuevaSub.trim(); if (!n || !selCat) return;
    setBusy(true); setError(null);
    try { await ensureCategoriaGasto(n, selCat, actor); setNuevaSub(''); await cargar(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear'); } finally { setBusy(false); }
  }
  async function importarPegado() {
    const lineas = pegado.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lineas.length < 2) { setError('Pegá la categoría en la 1ª línea y sus subcategorías debajo.'); return; }
    setBusy(true); setError(null);
    try {
      const cat = await ensureCategoriaGasto(lineas[0], null, actor);
      for (const sub of lineas.slice(1)) { await ensureCategoriaGasto(sub, cat.id, actor); }
      setPegado(''); setPegarOpen(false); await cargar(); setSelCat(cat.id);
      notify(`Cargada categoría "${cat.nombre}" con ${lineas.length - 1} subcategorías`, 'success');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo importar'); } finally { setBusy(false); }
  }
  async function renombrar(c: CategoriaGasto) {
    const nuevo = window.prompt('Nuevo nombre:', c.nombre)?.trim();
    if (!nuevo || nuevo === c.nombre) return;
    setBusy(true);
    try { await renombrarCategoriaGasto(c.id, nuevo); await cargar(); } finally { setBusy(false); }
  }
  async function toggleActivo(c: CategoriaGasto) {
    setBusy(true);
    try { await setActivoCategoriaGasto(c.id, !c.activo); await cargar(); } finally { setBusy(false); }
  }
  async function borrar(c: CategoriaGasto, esCat: boolean) {
    if (!window.confirm(`¿Borrar "${c.nombre}"${esCat ? ' y todas sus subcategorías' : ''}? (los gastos ya registrados conservan su etiqueta)`)) return;
    setBusy(true);
    try { await eliminarCategoriaGasto(c.id); if (esCat && selCat === c.id) setSelCat(''); await cargar(); } finally { setBusy(false); }
  }

  return (
    <Modal title="🗂️ Categorías de gasto" size="lg" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.84rem' }}>
        Categorías y subcategorías que el <strong>registro de gasto</strong> exige. Tip: usá <strong>📋 Pegado masivo</strong> para cargar una columna del sheet (categoría + sus subcategorías) de una vez.
      </p>

      <div style={{ marginBottom: '.6rem' }}>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPegarOpen((v) => !v)}>
          {pegarOpen ? '× Cerrar pegado' : '📋 Pegado masivo'}
        </button>
        {pegarOpen && (
          <div className="card" style={{ padding: '.6rem', marginTop: '.4rem', display: 'grid', gap: '.4rem' }}>
            <small className="muted">1ª línea = <strong>categoría</strong>; cada línea siguiente = <strong>subcategoría</strong>. Pegá tal cual la columna del sheet.</small>
            <textarea className="textarea" rows={6} value={pegado} onChange={(e) => setPegado(e.target.value)}
              placeholder={'VEHICULOS\nVEHICULO (1) CAMION...\nVEHICULO (4) MACHITO...'} />
            <div><button className="btn btn-sm btn-primary" onClick={importarPegado} disabled={busy}>{busy ? 'Cargando…' : 'Importar'}</button></div>
          </div>
        )}
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.5rem' }}><strong>Error:</strong> {error}</div>}

      <div className="m-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.8rem' }}>
        {/* Categorías */}
        <div>
          <strong style={{ fontSize: '.84rem' }}>Categorías ({cats.length})</strong>
          <div style={{ display: 'flex', gap: '.3rem', margin: '.4rem 0' }}>
            <input className="input" style={{ flex: 1 }} value={nuevaCat} onChange={(e) => setNuevaCat(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addCat(); } }} placeholder="Nueva categoría…" />
            <button className="btn btn-sm btn-ghost" onClick={addCat} disabled={busy}>+</button>
          </div>
          <input className="input no-upper" type="search" value={buscarCat} onChange={(e) => setBuscarCat(e.target.value)}
            placeholder="🔍 Buscar categoría…" style={{ marginBottom: '.3rem' }} />
          <div style={{ maxHeight: 280, overflowY: 'auto', display: 'grid', gap: '.2rem' }}>
            {loading && <span className="muted">Cargando…</span>}
            {!loading && !catsFiltradas.length && <span className="muted" style={{ fontSize: '.8rem' }}>Sin coincidencias.</span>}
            {catsFiltradas.map((c) => (
              <div key={c.id} className="card" style={{ padding: '.3rem .5rem', display: 'flex', alignItems: 'center', gap: '.4rem',
                borderColor: c.id === selCat ? 'var(--primary)' : 'var(--border)', opacity: c.activo ? 1 : 0.5, cursor: 'pointer' }}
                onClick={() => setSelCat(c.id)}>
                <span style={{ flex: 1, fontSize: '.82rem', fontWeight: c.id === selCat ? 700 : 400 }}>{c.nombre}</span>
                <span className="muted" style={{ fontSize: '.68rem' }}>{subcategoriasDe(rows, c.id).length}</span>
                <button className="btn btn-icon btn-ghost" title="Renombrar" onClick={(e) => { e.stopPropagation(); void renombrar(c); }}>✎</button>
                <button className="btn btn-icon btn-ghost" title={c.activo ? 'Desactivar' : 'Activar'} onClick={(e) => { e.stopPropagation(); void toggleActivo(c); }}>{c.activo ? '🚫' : '✔️'}</button>
                <button className="btn btn-icon btn-ghost" title="Borrar" onClick={(e) => { e.stopPropagation(); void borrar(c, true); }}>🗑</button>
              </div>
            ))}
          </div>
        </div>
        {/* Subcategorías */}
        <div>
          <strong style={{ fontSize: '.84rem' }}>Subcategorías {catSel ? `de "${catSel.nombre}" (${subs.length})` : ''}</strong>
          {!selCat ? <p className="hint muted" style={{ fontSize: '.8rem' }}>Elegí una categoría a la izquierda.</p> : (
            <>
              <div style={{ display: 'flex', gap: '.3rem', margin: '.4rem 0' }}>
                <input className="input" style={{ flex: 1 }} value={nuevaSub} onChange={(e) => setNuevaSub(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addSub(); } }} placeholder="Nueva subcategoría…" />
                <button className="btn btn-sm btn-ghost" onClick={addSub} disabled={busy}>+</button>
              </div>
              <input className="input no-upper" type="search" value={buscarSub} onChange={(e) => setBuscarSub(e.target.value)}
                placeholder="🔍 Buscar subcategoría…" style={{ marginBottom: '.3rem' }} />
              <div style={{ maxHeight: 280, overflowY: 'auto', display: 'grid', gap: '.2rem' }}>
                {!!subs.length && !subsFiltradas.length && <span className="muted" style={{ fontSize: '.8rem' }}>Sin coincidencias.</span>}
                {subsFiltradas.map((s) => (
                  <div key={s.id} className="card" style={{ padding: '.3rem .5rem', display: 'flex', alignItems: 'center', gap: '.4rem', opacity: s.activo ? 1 : 0.5 }}>
                    <span style={{ flex: 1, fontSize: '.82rem' }}>{s.nombre}</span>
                    <button className="btn btn-icon btn-ghost" title="Renombrar" onClick={() => void renombrar(s)}>✎</button>
                    <button className="btn btn-icon btn-ghost" title={s.activo ? 'Desactivar' : 'Activar'} onClick={() => void toggleActivo(s)}>{s.activo ? '🚫' : '✔️'}</button>
                    <button className="btn btn-icon btn-ghost" title="Borrar" onClick={() => void borrar(s, false)}>🗑</button>
                  </div>
                ))}
                {!subs.length && <span className="muted" style={{ fontSize: '.8rem' }}>Sin subcategorías. Agregá arriba o usá pegado masivo.</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ───────────── Cierre de mes (caja): reporte + archivado reversible ───────────── */
function RecMonedas({ titulo, rec, color }: { titulo: string; rec: Record<string, number>; color?: string }) {
  const ent = Object.entries(rec).filter(([, v]) => Math.abs(Number(v) || 0) > 0.0001).sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <div className="card" style={{ padding: '.5rem .7rem' }}>
      <div style={{ fontWeight: 700, fontSize: '.82rem', marginBottom: '.3rem' }}>{titulo}</div>
      {!ent.length ? <span className="muted" style={{ fontSize: '.8rem' }}>—</span> : (
        <div style={{ display: 'grid', gap: '.15rem' }}>
          {ent.map(([mon, v]) => (
            <div key={mon} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem' }}>
              <span className="muted">{mon}</span>
              <span className="mono" style={{ fontWeight: 600, color: color ?? (v < 0 ? 'var(--danger,#c53030)' : undefined) }}>{monto(v, mon)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CierreReporteView({ rep }: { rep: ReporteCierre }) {
  return (
    <div style={{ display: 'grid', gap: '.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.5rem' }}>
        <RecMonedas titulo="Ingresos (entradas)" rec={rep.ingresos} color="var(--success,#16c784)" />
        <RecMonedas titulo="Gastos (egresos)" rec={rep.gastos} color="var(--danger,#c53030)" />
        <RecMonedas titulo="Resultado del mes" rec={rep.resultado} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.5rem' }}>
        <RecMonedas titulo="Cuentas por cobrar (abiertas)" rec={rep.cxc} />
        <RecMonedas titulo="Cuentas por pagar (abiertas)" rec={rep.cxp} />
      </div>
      <div className="card" style={{ padding: '.5rem .7rem' }}>
        <div style={{ fontWeight: 700, fontSize: '.82rem', marginBottom: '.3rem' }}>Saldos disponibles (por caja / moneda)</div>
        {!rep.saldos.length ? <span className="muted" style={{ fontSize: '.8rem' }}>Sin saldos.</span> : (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.82rem' }}>
              <tbody>
                {rep.saldos.map((s, i) => (
                  <tr key={i}>
                    <td>{s.caja}{s.cuenta && s.cuenta !== 'general' ? <span className="muted"> · {s.cuenta}</span> : null}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 600, color: s.saldo < 0 ? 'var(--danger,#c53030)' : undefined }}>{monto(s.saldo, s.moneda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CierreMesModal({ actor, actorName, onClose, onChanged }: {
  actor: string; actorName: string | null; onClose: () => void; onChanged: () => void;
}) {
  const hoy = new Date();
  const periodoDefault = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const [periodo, setPeriodo] = useState(periodoDefault);
  const [rep, setRep] = useState<ReporteCierre | null>(null);
  const [cargando, setCargando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [cierres, setCierres] = useState<Cierre[]>([]);
  const [verHist, setVerHist] = useState<Cierre | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargarCierres = useCallback(() => { listCierres().then(setCierres).catch(() => setCierres([])); }, []);
  useEffect(() => { cargarCierres(); }, [cargarCierres]);
  useRealtime(['cierres_caja'], cargarCierres);

  const yaCerrado = cierres.find((c) => c.periodo === periodo && c.estado === 'cerrado') ?? null;

  const calcular = useCallback(() => {
    setCargando(true); setError(null); setConfirmar(false);
    computeReporteCierre(periodo)
      .then(setRep)
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo calcular el reporte.'))
      .finally(() => setCargando(false));
  }, [periodo]);
  useEffect(() => { calcular(); }, [calcular]);

  async function cerrar() {
    if (!rep) return;
    setCerrando(true); setError(null);
    try {
      await crearCierre({ periodo, snapshot: rep, actor, actorName });
      notify(`Mes ${periodoLargo(periodo)} cerrado · ${rep.movimientos} movimiento(s) archivados`, 'success', { link: '#/app/tesoreria' });
      setConfirmar(false);
      cargarCierres();
      onChanged();
      calcular();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cerrar el mes.'); }
    finally { setCerrando(false); }
  }

  async function reabrir(c: Cierre) {
    try {
      await reabrirCierre(c.id, actor);
      notify(`Mes ${periodoLargo(c.periodo)} reabierto · movimientos de vuelta a la vista actual`, 'success', { link: '#/app/tesoreria' });
      cargarCierres(); onChanged(); calcular();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo reabrir.', 'error'); }
  }

  const repVer = verHist?.snapshot ?? rep;

  return (
    <Modal title="📅 Cierre de mes" size="lg" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={cerrando}>Cerrar</button>
        {repVer && (
          <>
            <button className="btn btn-ghost" onClick={() => import('./cierreReporte').then(({ descargarCierrePdf }) => descargarCierrePdf(repVer)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo el PDF', 'error'))}>📄 PDF</button>
            <button className="btn btn-ghost" onClick={() => import('./cierreReporte').then(({ descargarCierreExcel }) => descargarCierreExcel(repVer)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo el Excel', 'error'))}>📊 Excel</button>
          </>
        )}
        {!verHist && !yaCerrado && rep && !confirmar && (
          <button className="btn btn-primary" onClick={() => setConfirmar(true)} disabled={cargando || cerrando}>📅 Cerrar mes (archivar)</button>
        )}
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}

      {verHist ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem' }}>
            <strong>Cierre archivado · {periodoLargo(verHist.periodo)}</strong>
            <button className="btn btn-sm btn-ghost" onClick={() => setVerHist(null)}>← Volver</button>
          </div>
          {repVer && <CierreReporteView rep={repVer} />}
        </>
      ) : (
        <>
          <div className="form-row" style={{ maxWidth: 240 }}>
            <label>Mes a cerrar</label>
            <input className="input no-upper" type="month" value={periodo} max={periodoDefault} onChange={(e) => setPeriodo(e.target.value)} />
          </div>

          {yaCerrado && (
            <div className="card" style={{ borderColor: 'var(--success)', margin: '.6rem 0', padding: '.55rem .7rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
              <span>✅ <strong>{periodoLargo(periodo)}</strong> ya está cerrado ({yaCerrado.movimientos} mov. archivados). Para modificarlo, reabrilo.</span>
              <button className="btn btn-sm btn-ghost" onClick={() => reabrir(yaCerrado)}>↩ Reabrir mes</button>
            </div>
          )}

          {cargando ? <p className="hint muted">Calculando…</p> : rep && (
            <div style={{ marginTop: '.5rem' }}>
              <p className="hint muted" style={{ margin: '0 0 .4rem', fontSize: '.8rem' }}>
                Período {rep.desde} a {rep.hasta} · {rep.movimientos} movimiento(s) {yaCerrado ? '(archivados)' : 'abiertos'}.
              </p>
              <CierreReporteView rep={rep} />
            </div>
          )}

          {confirmar && !yaCerrado && (
            <div className="card" style={{ borderColor: 'var(--warning,#f5a623)', marginTop: '.6rem', padding: '.6rem .7rem' }}>
              <strong>¿Cerrar {periodoLargo(periodo)}?</strong>
              <p className="hint muted" style={{ margin: '.3rem 0 .5rem', fontSize: '.83rem' }}>
                Se guarda el reporte y los {rep?.movimientos ?? 0} movimiento(s) del mes se <strong>archivan</strong> (salen de la vista actual; el mes nuevo arranca limpio). No se borra nada, no toca inventario ni saldos, y es <strong>reversible</strong> (podés reabrirlo).
              </p>
              <div style={{ display: 'flex', gap: '.4rem' }}>
                <button className="btn btn-sm btn-ghost" onClick={() => setConfirmar(false)} disabled={cerrando}>Cancelar</button>
                <button className="btn btn-sm btn-primary" onClick={cerrar} disabled={cerrando}>{cerrando ? 'Cerrando…' : 'Sí, cerrar mes'}</button>
              </div>
            </div>
          )}

          {cierres.length > 0 && (
            <div style={{ marginTop: '.8rem' }}>
              <div style={{ fontWeight: 700, fontSize: '.85rem', marginBottom: '.3rem' }}>Cierres anteriores</div>
              <div className="table-wrap">
                <table className="table" style={{ fontSize: '.82rem' }}>
                  <thead><tr><th>Mes</th><th>Estado</th><th style={{ textAlign: 'right' }}>Mov.</th><th></th></tr></thead>
                  <tbody>
                    {cierres.map((c) => (
                      <tr key={c.id}>
                        <td><strong>{periodoLargo(c.periodo)}</strong> <span className="muted">· {dateTime(c.created_at)}</span></td>
                        <td>{c.estado === 'cerrado' ? '✅ Cerrado' : '↩ Reabierto'}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{c.movimientos}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-sm btn-ghost" onClick={() => setVerHist(c)}>Ver</button>
                          {c.estado === 'cerrado' && <button className="btn btn-sm btn-ghost" onClick={() => reabrir(c)}>Reabrir</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function TrasladoModal({ cajas, actor, actorName, onClose, onSaved }: {
  cajas: Caja[]; actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [origenId, setOrigenId] = useState(cajas[0]?.id ?? '');
  const [destinoId, setDestinoId] = useState('');
  // Destino: un Centro de costo (con cuenta por cobrar) o, en modo interno, OTRA
  // caja de Tesorería (ej. Bs jurídica → Bs personal): solo mueve dinero, sin CxC.
  const [tipoDestino, setTipoDestino] = useState<'centro' | 'caja'>('centro');
  const [centros, setCentros] = useState<Caja[]>([]);
  const [saldos, setSaldos] = useState<CajaSaldo[]>([]);
  // Saldos de TODAS las cajas (para mostrar el saldo real en el desplegable "Desde";
  // `cajas.saldo` no se mantiene en las cajas multimoneda y siempre es 0).
  const [todosSaldos, setTodosSaldos] = useState<CajaSaldo[]>([]);
  const saldoHomeDe = (c: Caja) =>
    todosSaldos.filter((s) => s.caja_id === c.id && s.moneda === c.moneda).reduce((a, s) => a + (Number(s.saldo) || 0), 0);
  const [montos, setMontos] = useState<Record<string, string>>({}); // key = saldo.id
  const [motivo, setMotivo] = useState('');
  const [loadingSaldos, setLoadingSaldos] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Traslado interno (caja↔caja / cuenta↔cuenta, misma moneda): un solo movimiento.
  const [intSaldoId, setIntSaldoId] = useState('');                 // saldo origen (cuenta+moneda)
  const [intMonto, setIntMonto] = useState('');
  const [intDestCuenta, setIntDestCuenta] = useState<CuentaCaja>('general');

  const origen = cajas.find((c) => c.id === origenId) ?? null;
  const destino = (tipoDestino === 'centro' ? centros : cajas).find((c) => c.id === destinoId) ?? null;

  useEffect(() => { listCentrosAcopio().then(setCentros).catch(() => setCentros([])); }, []);
  useEffect(() => { listSaldos().then(setTodosSaldos).catch(() => setTodosSaldos([])); }, []);
  // Motivo por defecto (editable):
  //  · Centro EXTERNO (otro sistema): la ruta "CAJA ORIGEN / CAJA DESTINO".
  //  · Centro INTERNO: "CAJA MULTIMONEDAS MGG / CAJA <CENTRO>" — es el texto que se
  //    muestra como descripción de la entrada en ese centro de acopio.
  useEffect(() => {
    if (!destino) return;
    if (tipoDestino === 'caja') setMotivo(`Traslado interno · ${origen?.nombre ?? ''} → ${destino.nombre}`);
    else if (destino.externo) { if (origen) setMotivo(`${origen.nombre} / ${destino.nombre}`); }
    else setMotivo(`CAJA MULTIMONEDAS MGG / CAJA ${centroAcopioShort(destino.nombre)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origenId, destinoId, tipoDestino]);
  useEffect(() => {
    if (!origenId) { setSaldos([]); return; }
    setLoadingSaldos(true);
    saldosDeCaja(origenId)
      .then((s) => setSaldos(s.filter((x) => (Number(x.saldo) || 0) > 0)))
      .catch(() => setSaldos([]))
      .finally(() => setLoadingSaldos(false));
    setMontos({});
  }, [origenId]);

  const cuentaLabel = (c: string) => c === 'general' ? '' : c === 'juridica' ? ' · Jurídica' : c === 'personal' ? ' · Personal' : ` · ${c}`;

  // Billeteras/cuentas VINCULADAS a la caja destino (las que ya existen) + "general".
  // Se muestran al elegir la caja destino, así se ve a qué billetera entra el dinero
  // (ej. "entra a Multimoneda · billetera usdt2"). La moneda la hereda del saldo origen.
  const cuentasDestino = useMemo(() => {
    const set = new Set<string>(['general']);
    todosSaldos
      .filter((s) => s.caja_id === destinoId)
      .forEach((s) => set.add(s.cuenta));
    return Array.from(set);
  }, [todosSaldos, destinoId]);
  // Si la cuenta destino elegida ya no es válida para la caja, volver a "general".
  useEffect(() => {
    if (!cuentasDestino.includes(intDestCuenta)) setIntDestCuenta((cuentasDestino[0] ?? 'general') as CuentaCaja);
  }, [cuentasDestino, intDestCuenta]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!origenId || !destinoId) { setError(tipoDestino === 'caja' ? 'Elegí la caja origen y la caja destino.' : 'Elegí la caja origen y el centro de acopio.'); return; }
    if (!motivo.trim()) { setError('El motivo es obligatorio.'); return; }

    // ── Traslado INTERNO (entre tus cajas/cuentas, misma moneda): un solo movimiento,
    //    en vivo, sin cuenta por cobrar ni reflejo en acopio. Ej.: Bs jurídica → Bs personal.
    if (tipoDestino === 'caja') {
      const s = saldos.find((x) => x.id === intSaldoId);
      if (!s) { setError('Elegí qué saldo (moneda y cuenta) trasladar.'); return; }
      const m = round2(Number(intMonto) || 0);
      if (m <= 0) { setError('Indicá el monto a trasladar.'); return; }
      if (m > (Number(s.saldo) || 0)) { setError(`Saldo insuficiente: disponible ${monto(s.saldo, s.moneda)}.`); return; }
      if (origenId === destinoId && s.cuenta === intDestCuenta) { setError('El origen y el destino son el mismo saldo: elegí otra caja o cuenta.'); return; }
      setSaving(true);
      try {
        await convertirDivisa({
          origenCajaId: origenId, origenCuenta: s.cuenta, monedaDe: s.moneda,
          destinoCajaId: destinoId, destinoCuenta: intDestCuenta, monedaA: s.moneda,
          montoDe: m, tasa: 1, motivo: motivo.trim(), actor, actorName,
        });
        notify(`Traslado interno · ${monto(m, s.moneda)} → ${destino?.nombre ?? 'caja'}`, 'success', { link: '#/app/tesoreria' });
        onSaved();
      } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo trasladar.'); setSaving(false); }
      return;
    }

    const legs = saldos
      .map((s) => ({ cuenta: s.cuenta, moneda: s.moneda, monto: Number(montos[s.id]) || 0 }))
      .filter((l) => l.monto > 0);
    if (!legs.length) { setError('Indicá al menos un monto a trasladar.'); return; }
    setSaving(true);
    try {
      await trasladoEntreCajasMulti({
        origenId, destinoId, legs, motivo: motivo.trim(),
        origenNombre: origen?.nombre, destinoNombre: destino?.nombre, actor, actorName,
      });
      // El traspaso a un centro de costo se vuelve una CUENTA POR COBRAR incremental
      // (el centro debe rendir lo entregado, en dinero o en producto al cambio). Para los
      // centros INTERNOS la crea la ENTRADA «USD ENTREGADOS» del acopio
      // (entradaTesoreriaACentroAcopio); para los EXTERNOS la creamos acá (en USD).
      if (destino?.externo && destino.empresa_codigo) {
        const transferLegs: TransferLeg[] = saldos
          .map((s) => ({ cuenta: s.cuenta, moneda: s.moneda, monto: Number(montos[s.id]) || 0, tasa_bs: s.tasa_prom ?? null }))
          .filter((l) => l.monto > 0);
        await crearTransferenciaSaliente({
          empresaDestino: destino.empresa_codigo, cajaId: destinoId, cajaNombre: destino.nombre,
          legs: transferLegs, motivo: motivo.trim(), actor, actorName,
        });
        // Cuenta por cobrar del centro externo (incremental, en USD equivalente).
        let tasaUsdX = 0;
        if (legs.some((l) => l.moneda === 'Bs')) { try { tasaUsdX = (await getTasaHoy()).usd ?? 0; } catch { /* sin tasa */ } }
        const montoUsdX = legs.reduce((a, l) => a + (l.moneda === 'Bs' ? (tasaUsdX > 0 ? l.monto / tasaUsdX : 0) : l.monto), 0);
        try { await registrarCobrarPorTraspaso({ centro: destino.nombre, monto: montoUsdX, moneda: 'USD', nota: motivo.trim(), actor, actorName }); } catch { /* no bloquea el traslado */ }
        notify(`Traslado a ${destino.nombre} registrado y enviado al otro sistema`, 'success', { link: '#/app/tesoreria' });
      } else {
        // Centro de acopio INTERNO: además de la salida en Tesorería, se refleja como
        // ENTRADA (USD ENTREGADOS) en ese centro de acopio. Esa entrada genera la
        // cuenta por cobrar incremental (la crea entradaTesoreriaACentroAcopio).
        let tasaUsd = 0;
        if (legs.some((l) => l.moneda === 'Bs')) { try { tasaUsd = (await getTasaHoy()).usd ?? 0; } catch { /* sin tasa */ } }
        const montoUsd = legs.reduce((a, l) => a + (l.moneda === 'Bs' ? (tasaUsd > 0 ? l.monto / tasaUsd : 0) : l.monto), 0);
        await entradaTesoreriaACentroAcopio({
          centroNombre: centroAcopioShort(destino?.nombre ?? ''),
          montoUsd, descripcion: motivo.trim(), actor, actorName,
        });
        notify(`Traslado a ${destino?.nombre ?? 'centro de acopio'} registrado · entró ${monto(montoUsd, 'USD')} al acopio`, 'success', { link: '#/app/tesoreria' });
      }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo trasladar.'); setSaving(false); }
  }

  return (
    <Modal title="Traspaso de dinero" size="md" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="teso-tras" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Trasladar'}</button></>
    }>
      <form id="teso-tras" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-grid">
          <div className="form-row">
            <label>Desde</label>
            <select className="select" value={origenId} onChange={(e) => { setOrigenId(e.target.value); setDestinoId(destinoId); }}>
              {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {monto(saldoHomeDe(c), c.moneda)}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label>Hacia</label>
            <div style={{ display: 'flex', gap: '.3rem', marginBottom: '.35rem' }}>
              <button type="button" className={tipoDestino === 'centro' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'}
                onClick={() => { setTipoDestino('centro'); setDestinoId(''); }}>🏗 Centro de costo</button>
              <button type="button" className={tipoDestino === 'caja' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'}
                onClick={() => { setTipoDestino('caja'); setDestinoId(''); }}>🏦 Otra caja (interno)</button>
            </div>
            {tipoDestino === 'centro' ? (
              <select className="select" value={destinoId} onChange={(e) => setDestinoId(e.target.value)} required>
                <option value="">— elegir centro —</option>
                {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.externo ? ' · sistema externo' : ''}</option>)}
              </select>
            ) : (
              <select className="select" value={destinoId} onChange={(e) => setDestinoId(e.target.value)} required>
                <option value="">— elegir caja —</option>
                {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {monto(saldoHomeDe(c), c.moneda)}{c.id === origenId ? ' (misma · cambia la cuenta)' : ''}</option>)}
              </select>
            )}
            {tipoDestino === 'caja' && destinoId && (
              <div style={{ marginTop: '.4rem' }}>
                <label style={{ fontSize: '.72rem' }}>Billetera / cuenta destino</label>
                <select className="select" value={intDestCuenta} onChange={(e) => setIntDestCuenta(e.target.value as CuentaCaja)}>
                  {cuentasDestino.map((c) => <option key={c} value={c}>{labelCuentaCaja(c)}</option>)}
                </select>
                <small className="muted">Entra a <strong>{destino?.nombre ?? 'la caja'}</strong> · billetera/cuenta <strong>{labelCuentaCaja(intDestCuenta)}</strong>.</small>
              </div>
            )}
            {tipoDestino === 'centro' && destino?.externo && (
              <small className="muted">🔗 Centro de acopio en otro sistema: el traslado se replica automáticamente y queda “por confirmar” del otro lado.</small>
            )}
            {tipoDestino === 'caja' && (
              <small className="muted">↔ Solo mueve dinero entre tus cajas (ej. Bs jurídica → Bs personal). No genera cuenta por cobrar.</small>
            )}
          </div>
        </div>

        {/* Montos a trasladar de la caja origen */}
        <div className="card" style={{ margin: '.4rem 0', padding: '.5rem .7rem' }}>
          {loadingSaldos ? <div className="muted" style={{ fontSize: '.85rem' }}>Cargando saldos…</div>
            : !saldos.length ? <div className="muted" style={{ fontSize: '.85rem' }}>Esta caja no tiene saldos.</div>
            : tipoDestino === 'caja' ? (
              /* Movimiento único: un saldo (moneda + cuenta) → caja/cuenta destino (misma moneda) */
              <>
                <div className="muted" style={{ fontSize: '.74rem', marginBottom: '.35rem' }}>
                  Movés un saldo (moneda + cuenta) → entra a <strong>{destino?.nombre ?? 'la caja'}</strong> · billetera/cuenta <strong>{labelCuentaCaja(intDestCuenta)}</strong>. La moneda no cambia.
                </div>
                <div className="form-grid">
                  <div className="form-row">
                    <label>Saldo a trasladar</label>
                    <select className="select" value={intSaldoId} onChange={(e) => setIntSaldoId(e.target.value)}>
                      <option value="">— elegir —</option>
                      {saldos.map((s) => <option key={s.id} value={s.id}>{s.moneda}{cuentaLabel(s.cuenta)} · disp. {monto(s.saldo, s.moneda)}</option>)}
                    </select>
                  </div>
                  <div className="form-row">
                    <label>Monto</label>
                    <input className="input mono" type="number" min={0} step="any" placeholder="0,00" value={intMonto} onChange={(e) => setIntMonto(dosDecimales(e.target.value))} />
                  </div>
                </div>
              </>
            ) : (
              /* Centro de costo: cuánto sacar de cada moneda (multi-leg) */
              <>
                <div className="muted" style={{ fontSize: '.74rem', marginBottom: '.35rem' }}>¿Cuánto trasladar de cada moneda registrada en la caja?</div>
                <div style={{ display: 'grid', gap: '.4rem' }}>
                  {saldos.map((s) => (
                    <div key={s.id} style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                      <span style={{ flex: '1 1 auto', fontSize: '.85rem' }}>
                        <span className="badge">{s.moneda}</span>{cuentaLabel(s.cuenta)} <span className="muted">· disp. {monto(s.saldo, s.moneda)}</span>
                      </span>
                      <input className="input mono" type="number" min={0} max={Number(s.saldo) || 0} step="any" placeholder="0,00"
                        value={montos[s.id] ?? ''} onChange={(e) => setMontos((m) => ({ ...m, [s.id]: dosDecimales(e.target.value) }))}
                        style={{ width: 140 }} />
                    </div>
                  ))}
                </div>
              </>
            )}
        </div>

        <div className="form-row"><label>Motivo *</label><input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Obligatorio" required /></div>
      </form>
    </Modal>
  );
}

/* ───────────── Transferencias inter-sistema (centros de acopio externos) ───────────── */

const ESTADO_TRANSFER: Record<string, { label: string; color: string }> = {
  enviada: { label: 'En tránsito · esperando confirmación', color: 'var(--warning)' },
  por_confirmar: { label: 'Por confirmar', color: 'var(--warning)' },
  recibida: { label: 'Recibida ✓', color: 'var(--success)' },
  rechazada: { label: 'Rechazada', color: 'var(--danger)' },
  error: { label: 'Pendiente de entrega ⟳', color: 'var(--danger)' },
};

/**
 * Libro Mayor (resumen contable) debajo de las cajas: por cada MONEDA muestra el
 * Debe (entradas), el Haber (salidas), el Saldo en cajas, y los totales de Cuentas
 * por Pagar y por Cobrar pendientes. Cierra con una fila de Totales.
 */
/** ¿El movimiento resta de la caja? (salida, traslado enviado, o ajuste a la baja). */
function esEgresoMov(m: MovimientoCaja): boolean {
  return m.tipo === 'salida' || m.tipo === 'traslado_salida' || (m.tipo === 'ajuste' && Number(m.saldo_despues) < Number(m.saldo_antes));
}

/** Total NETO de la columna Monto por moneda (ingresos − egresos) de una lista de
 *  movimientos de caja. Devuelve pares [moneda, total] ordenados por moneda. */
function totalesMontoPorMoneda(movs: MovimientoCaja[]): [string, number][] {
  const acc = new Map<string, number>();
  for (const m of movs) {
    const signo = esEgresoMov(m) ? -1 : 1;
    acc.set(m.moneda, (acc.get(m.moneda) || 0) + signo * (Number(m.monto) || 0));
  }
  return [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
}

function LibroMayorPanel({ movs, saldos, cxp, cxc, monedas, onVerMov }: {
  movs: MovimientoCaja[]; saldos: CajaSaldo[]; cxp: CuentaPorPagar[]; cxc: CuentaPorCobrar[];
  monedas: string[]; onVerMov: (m: MovimientoCaja) => void;
}) {
  // Filtros PROPIOS del libro mayor (no afectan al registro). Debe/Haber filtran por
  // rango de fechas; Saldo / Cuentas por pagar / por cobrar son saldos vigentes (a hoy).
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [fMon, setFMon] = useState('');
  const [verMon, setVerMon] = useState<string | null>(null);

  const dentroFecha = (m: MovimientoCaja) => {
    const at = (m.at || '').slice(0, 10);
    if (desde && at < desde) return false;
    if (hasta && at > hasta) return false;
    return true;
  };
  const movsFecha = useMemo(() => movs.filter(dentroFecha), [movs, desde, hasta]);

  const filas = useMemo(() => {
    const acc = new Map<string, { debe: number; haber: number; saldo: number; porPagar: number; porCobrar: number }>();
    const get = (mon: string) => { let r = acc.get(mon); if (!r) { r = { debe: 0, haber: 0, saldo: 0, porPagar: 0, porCobrar: 0 }; acc.set(mon, r); } return r; };
    for (const m of movsFecha) { const r = get(m.moneda); const v = Math.abs(Number(m.monto) || 0); if (esEgresoMov(m)) r.haber += v; else r.debe += v; }
    for (const s of saldos) get(s.moneda).saldo += Number(s.saldo) || 0;
    for (const c of cxp) get(c.moneda).porPagar += round2(Number(c.monto) - (Number(c.abonado) || 0));
    for (const c of cxc) get(c.moneda).porCobrar += round2(Number(c.monto) - (Number(c.abonado) || 0));
    return Array.from(acc.entries())
      .map(([moneda, v]) => ({ moneda, ...v }))
      .filter((f) => f.debe || f.haber || f.saldo || f.porPagar || f.porCobrar)
      .filter((f) => !fMon || f.moneda === fMon)
      .sort((a, b) => a.moneda.localeCompare(b.moneda));
  }, [movsFecha, saldos, cxp, cxc, fMon]);

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem', marginBottom: '.5rem' }}>
        <span>📒 Libro Mayor (por moneda)</span>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
            Desde <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={{ width: 'auto' }} />
          </label>
          <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
            Hasta <input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={{ width: 'auto' }} />
          </label>
          {(desde || hasta) && <button className="btn btn-sm btn-ghost" onClick={() => { setDesde(''); setHasta(''); }}>✕ Fechas</button>}
          <select className="select" value={fMon} onChange={(e) => setFMon(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Todas las monedas</option>
            {monedas.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>
      {!filas.length ? (
        <EmptyState message="Sin movimientos en el rango seleccionado." />
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.84rem' }}>
            <thead>
              <tr>
                <th>Moneda</th>
                <th style={{ textAlign: 'right' }}>Debe (entradas)</th>
                <th style={{ textAlign: 'right' }}>Haber (salidas)</th>
                <th style={{ textAlign: 'right' }}>Saldo en cajas</th>
                <th style={{ textAlign: 'right' }}>Cuentas por pagar</th>
                <th style={{ textAlign: 'right' }}>Cuentas por cobrar</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.moneda}>
                  <td>
                    <button className="btn btn-sm btn-ghost" onClick={() => setVerMon(f.moneda)}
                      title={`Ver los movimientos en ${f.moneda}`} style={{ fontWeight: 700, padding: '.1rem .35rem' }}>
                      {f.moneda} 🔍
                    </button>
                  </td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--success)' }}>{monto(f.debe, f.moneda)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--danger)' }}>{monto(f.haber, f.moneda)}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{monto(f.saldo, f.moneda)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: f.porPagar > 0 ? 'var(--danger)' : undefined }}>{monto(f.porPagar, f.moneda)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: f.porCobrar > 0 ? 'var(--primary-3)' : undefined }}>{monto(f.porCobrar, f.moneda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint muted" style={{ fontSize: '.74rem', marginTop: '.4rem', marginBottom: 0 }}>
        Debe = entradas · Haber = salidas (filtran por el rango de fechas) · Saldo, Cuentas por pagar y por cobrar son saldos vigentes (a hoy).
        Tocá una moneda (🔍) para ver el detalle de sus movimientos.
      </p>

      {verMon && (
        <LibroMayorMonedaModal
          moneda={verMon}
          movs={movsFecha.filter((m) => m.moneda === verMon)}
          rango={desde || hasta ? `${desde || '…'} → ${hasta || '…'}` : 'Todo el período activo'}
          onVerMov={(m) => { setVerMon(null); onVerMov(m); }}
          onClose={() => setVerMon(null)}
        />
      )}
    </div>
  );
}

/** Detalle del Libro Mayor para UNA moneda: lista sus movimientos (Debe/Haber por
 *  línea) con el pago de nómina/compra como renglón; cada fila abre el detalle completo. */
function LibroMayorMonedaModal({ moneda, movs, rango, onVerMov, onClose }: {
  moneda: string; movs: MovimientoCaja[]; rango: string;
  onVerMov: (m: MovimientoCaja) => void; onClose: () => void;
}) {
  const ordenados = useMemo(() => [...movs].sort((a, b) => (b.at || '').localeCompare(a.at || '')), [movs]);
  const debe = ordenados.filter((m) => !esEgresoMov(m)).reduce((a, m) => a + Math.abs(Number(m.monto) || 0), 0);
  const haber = ordenados.filter((m) => esEgresoMov(m)).reduce((a, m) => a + Math.abs(Number(m.monto) || 0), 0);

  return (
    <Modal title={`📒 Libro Mayor · ${moneda}`} size="lg" onClose={onClose}>
      <p className="hint muted" style={{ fontSize: '.78rem', marginTop: 0 }}>
        {rango} · {ordenados.length} movimiento(s). Tocá una fila para ver todos los detalles (motivo, beneficiario, autorización, fecha y hora).
      </p>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '.6rem', alignItems: 'center' }}>
        <div className="mono" style={{ color: 'var(--success)' }}>Debe: {monto(debe, moneda)}</div>
        <div className="mono" style={{ color: 'var(--danger)' }}>Haber: {monto(haber, moneda)}</div>
        <div className="mono" style={{ fontWeight: 700 }}>Neto: {monto(debe - haber, moneda)}</div>
        <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} disabled={!ordenados.length}
          onClick={() => import('./libroMayorPdf').then(({ descargarLibroMayorMonedaPdf }) => descargarLibroMayorMonedaPdf(moneda, ordenados, rango)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'))}>
          ↓ PDF
        </button>
      </div>
      {!ordenados.length ? (
        <EmptyState message="Sin movimientos para esta moneda en el rango." />
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead>
              <tr>
                <th>Fecha</th><th>Caja</th><th>Concepto</th><th>Beneficiario / motivo</th>
                <th style={{ textAlign: 'right' }}>Debe</th>
                <th style={{ textAlign: 'right' }}>Haber</th>
                <th style={{ textAlign: 'right' }}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {ordenados.map((m) => {
                const egreso = esEgresoMov(m);
                const v = Math.abs(Number(m.monto) || 0);
                const concepto = CAT_LABEL[m.categoria ?? ''] ?? m.categoria ?? (TIPO_MOV_LABEL[m.tipo] ?? m.tipo);
                return (
                  <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => onVerMov(m)} title="Ver todos los detalles">
                    <td style={{ whiteSpace: 'nowrap' }}>{dateTime(m.at)}</td>
                    <td>{m.caja?.nombre ?? '—'}</td>
                    <td>{concepto}</td>
                    <td>{m.beneficiario || m.motivo || m.destino || '—'}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--success)' }}>{egreso ? '' : monto(v, moneda)}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--danger)' }}>{egreso ? monto(v, moneda) : ''}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{monto(Number(m.saldo_despues) || 0, moneda)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={4} style={{ textAlign: 'right' }}>Totales ({ordenados.length} mov.)</td>
                <td className="mono" style={{ textAlign: 'right', color: 'var(--success)' }}>{monto(debe, moneda)}</td>
                <td className="mono" style={{ textAlign: 'right', color: 'var(--danger)' }}>{monto(haber, moneda)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>Neto {monto(debe - haber, moneda)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Modal>
  );
}

function TransferenciasInterPanel({ transfers, cajas, canWrite, actor, actorName, onChanged }: {
  transfers: TransferenciaInter[]; cajas: Caja[]; canWrite: boolean; actor: string; actorName: string | null; onChanged: () => void | Promise<void>;
}) {
  const [sel, setSel] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const entrantes = transfers.filter((t) => t.direccion === 'entrante' && t.estado === 'por_confirmar');
  const salientes = transfers.filter((t) => t.direccion === 'saliente');
  const salientesVivas = salientes.filter((t) => t.estado !== 'recibida');
  const salientesRecibidas = salientes.filter((t) => t.estado === 'recibida');
  const recibidas = salientesRecibidas.length;
  // Nombre real del destino (caja externa) en vez de "el otro sistema".
  const destinosRecibidos = Array.from(
    new Set(salientesRecibidas.map((t) => t.caja_nombre || t.empresa_destino)),
  ).join(' · ');
  if (!entrantes.length && !salientes.length) return null;

  async function confirmar(t: TransferenciaInter) {
    const cajaId = t.caja_id || sel[t.id];
    if (!cajaId) { toast('Elegí la caja que recibe el dinero.', 'error'); return; }
    setBusy(t.id);
    try {
      await confirmarTransferenciaEntrante({ row: t, cajaId, actor, actorName });
      toast(`Transferencia de ${t.empresa_origen} acreditada`, 'success');
      await onChanged();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo confirmar', 'error'); }
    finally { setBusy(null); }
  }

  async function reintentar(t: TransferenciaInter) {
    setBusy(t.id);
    try {
      await reintentarTransferencia(t);
      toast('Reintento enviado al otro sistema', 'success');
      await onChanged();
    } catch (e) { toast(e instanceof Error ? e.message : 'Sigue sin poder entregarse', 'error'); }
    finally { setBusy(null); }
  }

  return (
    <div className="card" style={{ marginBottom: '1rem', borderColor: entrantes.length ? 'var(--brand, #ff8a00)' : undefined }}>
      <div className="card-title" style={{ marginBottom: '.5rem' }}>
        🔗 Transferencias inter-sistema (centros de acopio externos)
      </div>

      {/* ENTRANTES por confirmar */}
      {entrantes.length > 0 && (
        <div style={{ marginBottom: salientesVivas.length ? '.8rem' : 0 }}>
          <div className="muted" style={{ fontSize: '.78rem', marginBottom: '.35rem' }}>Entrantes por confirmar · acreditá a la caja que recibe</div>
          <div style={{ display: 'grid', gap: '.45rem' }}>
            {entrantes.map((t) => (
              <div key={t.id} className="card" style={{ margin: 0, padding: '.55rem .7rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.5rem' }}>
                <div style={{ flex: '1 1 240px', fontSize: '.85rem' }}>
                  <strong>De {t.empresa_origen}</strong> · <span className="mono">{t.resumen}</span>
                  {t.motivo ? <span className="muted"> · {t.motivo}</span> : null}
                  <div className="muted" style={{ fontSize: '.72rem' }}>{dateTime(t.created_at)}</div>
                </div>
                {!t.caja_id && (
                  <select className="select" value={sel[t.id] ?? ''} onChange={(e) => setSel((m) => ({ ...m, [t.id]: e.target.value }))} style={{ maxWidth: 200 }}>
                    <option value="">— caja que recibe —</option>
                    {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                )}
                {canWrite && (
                  <button className="btn btn-sm btn-primary" disabled={busy === t.id} onClick={() => confirmar(t)}>
                    {busy === t.id ? 'Confirmando…' : '✓ Confirmar recepción'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SALIENTES en tránsito / con error */}
      {salientesVivas.length > 0 && (
        <div>
          <div className="muted" style={{ fontSize: '.78rem', marginBottom: '.35rem' }}>Salientes (enviadas a otro sistema)</div>
          <div style={{ display: 'grid', gap: '.4rem' }}>
            {salientesVivas.map((t) => {
              const est = ESTADO_TRANSFER[t.estado] ?? { label: t.estado, color: 'var(--muted)' };
              return (
                <div key={t.id} className="card" style={{ margin: 0, padding: '.5rem .7rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.5rem' }}>
                  <div style={{ flex: '1 1 240px', fontSize: '.84rem' }}>
                    <strong>→ {t.empresa_destino}</strong> · <span className="mono">{t.resumen}</span>
                    <div style={{ fontSize: '.72rem', color: est.color }}>{est.label}{t.mensaje_error ? ` · ${t.mensaje_error}` : ''}</div>
                  </div>
                  {canWrite && t.estado === 'error' && (
                    <button className="btn btn-sm btn-ghost" disabled={busy === t.id} onClick={() => reintentar(t)}>
                      {busy === t.id ? 'Reintentando…' : '⟳ Reintentar'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {recibidas > 0 && (
        <div className="muted" style={{ fontSize: '.72rem', marginTop: '.5rem' }}>
          {recibidas === 1 ? 'Confirmado' : `${recibidas} confirmadas`} por {destinosRecibidos}.
        </div>
      )}
    </div>
  );
}

/* ───────── Enviar reporte por correo (mismo patrón que las OC) ───────── */
function EnviarReporteModal({ movs, meta, defaultEmail, onClose }: {
  movs: MovimientoCaja[]; meta: ReporteMeta; defaultEmail: string; onClose: () => void;
}) {
  const [incluirPropio, setIncluirPropio] = useState(true);
  const [extra, setExtra] = useState('');
  const [enviando, setEnviando] = useState(false);
  const propio = defaultEmail.trim().toLowerCase();
  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  async function handleEnviar() {
    const lista: string[] = [];
    if (incluirPropio && propio) lista.push(propio);
    const extraClean = extra.trim().toLowerCase();
    if (extraClean) {
      if (!emailRx.test(extraClean)) { toast('El correo adicional no es válido', 'error'); return; }
      lista.push(extraClean);
    }
    setEnviando(true);
    try {
      const { enviarReportePorCorreo } = await import('./enviarReporte');
      const r = await enviarReportePorCorreo(movs, meta, lista);
      notify(`Reporte enviado a ${r.destinatarios.join(', ')}`, 'success', { link: '#/app/tesoreria' });
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo enviar', 'error'); }
    finally { setEnviando(false); }
  }

  return (
    <Modal title={`Enviar reporte · ${meta.titulo}`} size="md" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={enviando}>Cancelar</button>
        <button className="btn btn-primary" onClick={handleEnviar} disabled={enviando}>{enviando ? 'Enviando…' : '📧 Enviar'}</button>
      </>
    }>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.88rem' }}>
        Se enviará el PDF del reporte ({meta.subtitulo || 'todos los movimientos'}) a los destinatarios seleccionados.
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.7rem .85rem', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: incluirPropio ? 'rgba(255,138,0,0.06)' : 'transparent', cursor: propio ? 'pointer' : 'not-allowed', marginBottom: '.6rem' }}>
        <input type="checkbox" checked={incluirPropio} disabled={!propio} onChange={(e) => setIncluirPropio(e.target.checked)} />
        <div>
          <div style={{ fontWeight: 600 }}>Tu correo</div>
          <div className="mono" style={{ fontSize: '.82rem' }}>{propio || '—'}</div>
        </div>
      </label>
      <div className="form-row" style={{ marginTop: '.4rem' }}>
        <label>Correo adicional (opcional)</label>
        <input className="input" type="email" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="otro@correo.com" maxLength={120} />
        <small className="muted">Si no marcás ninguno, se envía a los admin/jefe.</small>
      </div>
    </Modal>
  );
}

/* ───────── Pagar nómina: cola de renglones cargados por RRHH ───────── */
function NominaPorPagarModal({ cajas, actor, actorName, onClose, onPaid }: {
  cajas: Caja[]; actor: string; actorName: string | null; onClose: () => void; onPaid: () => void;
}) {
  const [rows, setRows] = useState<NominaRenglon[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagar, setPagar] = useState<NominaRenglon | null>(null);

  const recargar = useCallback(async () => {
    setLoading(true);
    try { setRows(await listRenglonesPorPagar()); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar la nómina', 'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void recargar(); }, [recargar]);
  useRealtime(['nomina_renglones'], () => { void recargar(); });

  const total = useMemo(() => round2(rows.reduce((a, r) => a + (Number(r.neto_usd) || 0), 0)), [rows]);

  return (
    <Modal title="Pagar nómina" size="xl" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <div className="muted" style={{ marginBottom: '.6rem', fontSize: '.86rem' }}>
        Renglones cargados desde <strong>RRHH</strong>. Tesorería paga uno a uno (efectivo USD con seriales, o Bs a tasa BCV) y adjunta el comprobante (opcional).
        {rows.length > 0 && <> · {rows.length} pendiente(s) · Total <strong className="mono">{monto(total, 'USD')}</strong></>}
      </div>
      <div className="table-wrap" style={{ maxHeight: 440, overflowY: 'auto' }}>
        <table className="table" style={{ fontSize: '.84rem' }}>
          <thead><tr><th>Trabajador</th><th>Nómina</th><th>Motivo</th><th>Departamento</th><th style={{ textAlign: 'right' }}>Días</th><th style={{ textAlign: 'right' }}>Neto USD</th><th style={{ textAlign: 'center' }}>Acción</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !rows.length && <tr><td colSpan={7}><EmptyState message="No hay nómina pendiente por pagar" icon="✅" /></td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id}>
                <td>{r.nombre}</td>
                <td className="mono muted">{r.periodo?.codigo ?? '—'}</td>
                <td><span className="badge" style={{ background: r.periodo?.tipo === 'vacaciones' ? 'var(--danger, #e5484d)' : r.periodo?.tipo === 'liquidacion' ? 'var(--warning, #ffae00)' : 'var(--primary-2, #2b6cb0)', color: '#fff' }}>{labelMotivoNomina(r.periodo?.tipo)}</span></td>
                <td className="muted">{r.departamento || '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.dias_trabajados}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{monto(r.neto_usd, 'USD')}</td>
                <td style={{ textAlign: 'center' }}><button className="btn btn-sm btn-primary" onClick={() => setPagar(r)}>💸 Pagar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagar && (
        <PagarRenglonModal renglon={pagar} cajas={cajas} actor={actor} actorName={actorName}
          onClose={() => setPagar(null)}
          onPaid={async () => { setPagar(null); await recargar(); onPaid(); }} />
      )}
    </Modal>
  );
}

/* ───────── Pagar un renglón de nómina (mismo motor que el pago de OC) ───────── */
function PagarRenglonModal({ renglon, cajas, actor, actorName, onClose, onPaid }: {
  renglon: NominaRenglon; cajas: Caja[]; actor: string; actorName: string | null; onClose: () => void; onPaid: () => void;
}) {
  const neto = round2(Number(renglon.neto_usd) || 0);
  const [cajaId, setCajaId] = useState(cajas[0]?.id ?? '');
  const caja = cajas.find((c) => c.id === cajaId) ?? null;
  // Saldos reales de la caja (caja multimoneda: cada cuenta/moneda con su saldo).
  const [saldosCaja, setSaldosCaja] = useState<CajaSaldo[]>([]);
  const [saldoSelId, setSaldoSelId] = useState('');
  const [tasa, setTasa] = useState(0);
  const [tasaFecha, setTasaFecha] = useState<string | null>(null);
  const [montoStr, setMontoStr] = useState(String(neto));
  const [factura, setFactura] = useState<File | null>(null);
  const [seriales, setSeriales] = useState<string[]>([]);
  const [serialInput, setSerialInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTasaHoy().then((t) => { if (t.usd != null) setTasa(t.usd); setTasaFecha(t.fecha); }).catch(() => {});
  }, []);

  // Carga los saldos de la caja elegida. Prefiere USD como saldo por defecto.
  useEffect(() => {
    if (!cajaId) { setSaldosCaja([]); setSaldoSelId(''); return; }
    saldosDeCaja(cajaId).then((rows) => {
      const conSaldo = rows.filter((r) => Number(r.saldo) > 0);
      setSaldosCaja(conSaldo);
      const pref = conSaldo.find((r) => r.moneda === 'USD') ?? conSaldo[0];
      setSaldoSelId(pref?.id ?? '');
    }).catch(() => { setSaldosCaja([]); setSaldoSelId(''); });
  }, [cajaId]);

  // Si la caja maneja saldos multimoneda, se paga desde el saldo elegido;
  // si no (caja legada), desde el saldo simple de la caja.
  const esMulti = saldosCaja.length > 0;
  const selSaldo = saldosCaja.find((s) => s.id === saldoSelId) ?? null;
  const moneda = esMulti ? (selSaldo?.moneda ?? 'USD') : (caja?.moneda ?? 'USD');
  const cuentaPago = esMulti ? (selSaldo?.cuenta ?? 'general') : null;
  const disponible = esMulti ? (Number(selSaldo?.saldo) || 0) : (Number(caja?.saldo) || 0);

  // Autocompleta el monto según la moneda elegida (USD/USDT directo, Bs a tasa BCV).
  useEffect(() => {
    if (moneda === 'Bs') setMontoStr(tasa > 0 ? String(aBs(neto, tasa)) : '');
    else setMontoStr(String(neto));
  }, [moneda, tasa, neto]);

  const pagaUsdEfectivo = moneda === 'USD';
  function agregarSerial() {
    const v = serialInput.trim();
    if (!v) return;
    if (!seriales.includes(v)) setSeriales((xs) => [...xs, v]);
    setSerialInput('');
  }
  function quitarSerial(s: string) { setSeriales((xs) => xs.filter((x) => x !== s)); }

  const deducTotal = round2((Number(renglon.deduc_anticipos) || 0) + (Number(renglon.deduc_prestamos) || 0));

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!cajaId) { setError('Elegí la caja con la que se paga.'); return; }
    if (esMulti && !selSaldo) { setError('Elegí de qué saldo (moneda) de la caja se paga.'); return; }
    const m = round2(Number(montoStr) || 0);
    if (m <= 0) { setError('Indicá el monto a pagar.'); return; }
    if (m > disponible + 0.01) { setError(`Saldo insuficiente. Disponible: ${monto(disponible, moneda)}.`); return; }
    setSaving(true);
    try {
      await pagarRenglon({
        renglon, cajaId, monto: m,
        cuenta: cuentaPago, moneda,
        tasa: moneda === 'Bs' ? tasa : null,
        seriales: pagaUsdEfectivo ? seriales : null,
        comprobante: factura,
        actorEmail: actor, actorName,
      });
      notify(`Nómina pagada · ${renglon.nombre} · ${monto(m, moneda)}`, 'success', { link: '#/app/tesoreria' });
      onPaid();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo pagar.'); setSaving(false); }
  }

  return (
    <Modal title={`Pagar nómina · ${renglon.nombre}`} size="lg" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" form="pagar-nomina" className="btn btn-primary" disabled={saving}>{saving ? 'Pagando…' : `PAGAR · ${monto(Number(montoStr) || 0, moneda)}`}</button>
      </>
    }>
      <form id="pagar-nomina" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        <div className="card" style={{ marginBottom: '.75rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}>Detalle del renglón</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.3rem .9rem', fontSize: '.84rem' }}>
            <div><span className="muted">Nómina:</span> <strong className="mono">{renglon.periodo?.codigo ?? '—'}</strong></div>
            <div><span className="muted">Departamento:</span> {renglon.departamento || '—'}</div>
            <div><span className="muted">Días:</span> <strong>{renglon.dias_trabajados}</strong></div>
            <div><span className="muted">Bruto:</span> <strong className="mono">{monto(renglon.salario_bruto, 'USD')}</strong></div>
            <div><span className="muted">Deducciones:</span> <strong className="mono">{monto(deducTotal, 'USD')}</strong></div>
            <div><span className="muted">Neto a pagar:</span> <strong className="mono" style={{ color: 'var(--success)' }}>{monto(neto, 'USD')}</strong></div>
          </div>
        </div>

        {/* Conversión USD ⇄ Bs (tasa BCV editable). */}
        <div className="card" style={{ marginBottom: '.75rem', borderColor: 'var(--brand, #ff8a00)' }}>
          <div className="card-title" style={{ marginBottom: '.5rem' }}>Conversión</div>
          <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div><div className="muted" style={{ fontSize: '.72rem' }}>Neto en USD</div><strong className="mono" style={{ fontSize: '1.1rem' }}>{monto(neto, 'USD')}</strong></div>
            <div className="muted" style={{ fontSize: '1.2rem' }}>⇄</div>
            <div><div className="muted" style={{ fontSize: '.72rem' }}>Equivale en Bs</div><strong className="mono" style={{ fontSize: '1.1rem' }}>{tasa > 0 ? monto(aBs(neto, tasa), 'Bs') : '—'}</strong></div>
            <div className="form-row" style={{ marginLeft: 'auto', minWidth: 150 }}>
              <label style={{ fontSize: '.72rem' }}>Tasa BCV (Bs/$){tasaFecha ? ` · ${fmtDate(tasaFecha)}` : ''}</label>
              <input className="input mono" type="number" min={0} step="any" value={tasa || ''} onChange={(e) => setTasa(Number(e.target.value) || 0)} placeholder="0,00" />
            </div>
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Caja (de dónde sale el dinero)</label>
            <select className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)} required>
              {!cajas.length && <option value="">— sin cajas —</option>}
              {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          {esMulti && (
            <div className="form-row">
              <label>Saldo de la caja (moneda / cuenta)</label>
              <select className="select" value={saldoSelId} onChange={(e) => setSaldoSelId(e.target.value)} required>
                {saldosCaja.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.moneda}{s.cuenta !== 'general' ? ` · ${labelCuentaCaja(s.cuenta)}` : ''} · {monto(Number(s.saldo), s.moneda)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-row">
            <label>Monto a pagar ({moneda})</label>
            <input className="input mono" type="number" min={0} step="any" value={montoStr} onChange={(e) => setMontoStr(dosDecimales(e.target.value))} required />
            <small className="muted">Disponible: <strong className="mono">{monto(disponible, moneda)}</strong></small>
            {moneda === 'Bs' && <small className="muted">Se autocompletó con la tasa BCV; podés ajustarlo.</small>}
            {pagaUsdEfectivo && redondearArriba5(Number(montoStr) || 0) > (Number(montoStr) || 0) && (
              <small className="muted" style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                💵 El monto tiene decimales. En efectivo se sugiere <strong className="mono">{monto(redondearArriba5(Number(montoStr) || 0), 'USD')}</strong> (redondeado al múltiplo de $5).
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMontoStr(String(redondearArriba5(Number(montoStr) || 0)))}>Redondear a {monto(redondearArriba5(Number(montoStr) || 0), 'USD')}</button>
              </small>
            )}
          </div>
        </div>

        {/* Seriales de billetes (solo al pagar USD físico). */}
        {pagaUsdEfectivo && (
          <div className="card" style={{ margin: '.75rem 0', borderColor: 'var(--brand, #ff8a00)' }}>
            <div className="card-title" style={{ marginBottom: '.4rem' }}>Seriales de los billetes entregados <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></div>
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-row" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
                <label style={{ fontSize: '.72rem' }}>Serial del billete</label>
                <input className="input mono" value={serialInput} onChange={(e) => setSerialInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarSerial(); } }} placeholder="Ej.: AB 1234567 C" />
              </div>
              <button type="button" className="btn btn-ghost" onClick={agregarSerial}>+ Agregar</button>
            </div>
            {seriales.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', marginTop: '.5rem' }}>
                {seriales.map((s, i) => (
                  <span key={s} className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', background: 'var(--bg-1)' }}>
                    <span className="muted">{i + 1}.</span><span className="mono">{s}</span>
                    <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 .25rem', lineHeight: 1 }} title="Quitar" onClick={() => quitarSerial(s)}>✕</button>
                  </span>
                ))}
                <span className="muted" style={{ alignSelf: 'center', fontSize: '.8rem' }}>{seriales.length} billete(s)</span>
              </div>
            )}
          </div>
        )}

        <div className="form-row">
          <label>Comprobante de pago (PDF o imagen) <span className="muted">(opcional)</span></label>
          <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setFactura(e.target.files?.[0] ?? null)} />
          {factura && <small className="muted">{factura.name}</small>}
        </div>
      </form>
    </Modal>
  );
}


/** Carga la tasa del día y abre el modal de historial. */
function TasasGate({ onClose }: { onClose: () => void }) {
  const [tasa, setTasa] = useState<Awaited<ReturnType<typeof getTasaHoy>> | null>(null);
  useEffect(() => { getTasaHoy().then(setTasa).catch(() => setTasa({ usd: null, eur: null, fecha: null })); }, []);
  return <HistorialTasasModal tasaHoy={tasa} onClose={onClose} />;
}

/* ───────────── Conversor multimoneda (tasa personalizada) ───────────── */

const MONEDAS_CONV: MonedaCaja[] = ['Bs', 'USD', 'USDT', 'COP'];

/** Valor de 1 unidad de la moneda expresado en USD, con las tasas de mercado.
 *  Bs usa la tasa Binance (USDT/VES) como referencia del dólar; COP usa COP/USD.
 *  USD y USDT se toman en paridad (~1). */
function valorEnUsd(m: MonedaCaja, t: TasasMercado): number | null {
  switch (m) {
    case 'USD': return 1;
    case 'USDT': return 1;
    case 'Bs': return t.usdtVes && t.usdtVes > 0 ? 1 / t.usdtVes : null;
    case 'COP': return t.copUsd && t.copUsd > 0 ? 1 / t.copUsd : null;
  }
}

/** Tasa cruzada sugerida: cuántas unidades de `a` por 1 de `de`. */
function tasaCruzada(de: MonedaCaja, a: MonedaCaja, t: TasasMercado): number | null {
  const vd = valorEnUsd(de, t), va = valorEnUsd(a, t);
  if (vd == null || va == null || va === 0) return null;
  return round2(vd / va);
}

const labelCuenta = (c: CuentaCaja) => c === 'general' ? 'General' : c === 'juridica' ? 'Jurídica' : c === 'personal' ? 'Personal' : String(c);

function ConversorModal({ cajas, saldos, actor, actorName, onClose, onSaved }: {
  cajas: Caja[]; saldos: CajaSaldo[]; actor: string; actorName?: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [de, setDe] = useState<MonedaCaja>('USD');
  const [a, setA] = useState<MonedaCaja>('Bs');
  const [origenSaldoId, setOrigenSaldoId] = useState('');     // saldo existente del que sale el dinero
  const [destinoCajaId, setDestinoCajaId] = useState('');
  const [destinoCuenta, setDestinoCuenta] = useState<CuentaCaja>('general');
  const [montoStr, setMontoStr] = useState('');
  const [tasaStr, setTasaStr] = useState('');
  const [comisionStr, setComisionStr] = useState('');   // % de comisión/descuento sobre el convertido
  const [netoOverride, setNetoOverride] = useState<number | null>(null); // neto redondeado escrito a mano
  const [redondearOpen, setRedondearOpen] = useState(false);            // modal «Ingrese monto redondeado»
  const [mercado, setMercado] = useState<TasasMercado | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Con quién se hace el intercambio (cliente o proveedor), igual que en CxC/CxP.
  const [cpTipo, setCpTipo] = useState<'cliente' | 'proveedor' | ''>('');
  const [cpNombre, setCpNombre] = useState('');
  const [contrapartes, setContrapartes] = useState<Contraparte[]>([]);

  useEffect(() => { getTasasMercado().then(setMercado).catch(() => setMercado(null)); }, []);
  useEffect(() => { listContrapartes().then(setContrapartes).catch(() => setContrapartes([])); }, []);

  // Saldos disponibles en la moneda DE (de cualquier caja/cuenta, con saldo > 0).
  const saldosOrigen = useMemo(
    () => saldos.filter((s) => s.moneda === de && (Number(s.saldo) || 0) > 0),
    [saldos, de],
  );
  const nombreCaja = useCallback((id: string) => cajas.find((c) => c.id === id)?.nombre ?? '—', [cajas]);

  // Al cambiar la moneda DE, elige el primer saldo disponible.
  useEffect(() => {
    setOrigenSaldoId((prev) => saldosOrigen.some((s) => s.id === prev) ? prev : (saldosOrigen[0]?.id ?? ''));
  }, [saldosOrigen]);

  // Cuentas/billeteras existentes en la caja destino (las que ya tienen saldo) + «General».
  // Si la caja no tiene billeteras, queda solo «General» (y entra directo ahí).
  const cuentasDestino = useMemo(() => {
    const set = new Set<string>(['general']);
    saldos.filter((s) => s.caja_id === destinoCajaId).forEach((s) => set.add(s.cuenta));
    return Array.from(set);
  }, [saldos, destinoCajaId]);
  // Si la cuenta elegida ya no es válida para la caja, volver a «General».
  useEffect(() => {
    if (!cuentasDestino.includes(destinoCuenta)) setDestinoCuenta((cuentasDestino[0] ?? 'general') as CuentaCaja);
  }, [cuentasDestino, destinoCuenta]);

  // Sugerencia de tasa al cambiar las monedas o cargar el mercado (editable).
  useEffect(() => {
    if (!mercado || de === a) { if (de === a) setTasaStr('1'); return; }
    const sug = tasaCruzada(de, a, mercado);
    if (sug != null) setTasaStr(String(sug));
  }, [de, a, mercado]);

  const origenSaldo = saldosOrigen.find((s) => s.id === origenSaldoId) ?? null;
  const disponible = Number(origenSaldo?.saldo) || 0;
  const montoNum = Number(montoStr) || 0;
  // Tasa con toda la precisión escrita: la conversión real (convertirDivisa) usa este
  // mismo valor, así la vista previa coincide al céntimo con lo que se acredita.
  const tasaNum = Number(tasaStr) || 0;
  const comisionPctInput = Math.max(0, Math.min(100, Number(comisionStr) || 0));
  const bruto = round2(montoNum * tasaNum);
  // Neto redondeado a mano: tiene prioridad mientras sea válido (≤ bruto). Si no, manda el %.
  const netoManual = netoOverride != null && netoOverride > 0 && netoOverride <= bruto ? round2(netoOverride) : null;
  const resultado = netoManual != null ? netoManual : round2(bruto - round2(bruto * comisionPctInput / 100)); // neto que recibe el destino
  const comisionMonto = round2(bruto - resultado);
  const comisionPct = bruto > 0 ? round2(comisionMonto / bruto * 100) : 0;
  const excede = montoNum > disponible + 0.001;
  const puede = !!origenSaldo && !!destinoCajaId && de !== a && montoNum > 0 && tasaNum > 0 && !excede && !saving;

  function swap() { setDe(a); setA(de); }
  function usarMercado() {
    if (!mercado) return;
    const sug = de === a ? 1 : tasaCruzada(de, a, mercado);
    if (sug != null) setTasaStr(String(sug));
  }
  // «Redondear»: el usuario escribe a mano el neto redondeado que debe recibir el destino.
  // Ese monto queda fijo (la comisión se calcula sola como bruto − neto). Limpia el % manual.
  function aplicarRedondeo(montoRedondeado: number) {
    setNetoOverride(montoRedondeado > 0 ? round2(montoRedondeado) : null);
    setComisionStr('');
    setRedondearOpen(false);
  }
  function limpiarComision() { setNetoOverride(null); setComisionStr(''); }

  async function convertir() {
    if (!origenSaldo) { setErr('Elegí de qué saldo sale el dinero.'); return; }
    if (!destinoCajaId) { setErr('Elegí la caja destino.'); return; }
    if (de === a) { setErr('Las monedas de origen y destino deben ser distintas.'); return; }
    if (excede) { setErr(`No hay saldo suficiente. Disponible: ${monto(disponible, de)}.`); return; }
    setErr(null); setSaving(true);
    try {
      // Con quién se hizo el intercambio (cliente/proveedor): queda en el motivo y se
      // guarda en el directorio para reutilizarlo (igual que en CxC/CxP).
      const quien = cpTipo && cpNombre.trim()
        ? `${cpTipo === 'proveedor' ? 'Proveedor' : 'Cliente'}: ${cpNombre.trim()}`
        : null;
      const partes = [
        `Conversión ${monto(montoNum, de)} → ${monto(resultado, a)}`,
        comisionPct > 0 ? `comisión ${comisionPct}% = ${monto(comisionMonto, a)} (bruto ${monto(bruto, a)})` : null,
        quien,
      ].filter(Boolean);
      const motivo = (comisionPct > 0 || quien) ? partes.join(' · ') : undefined;
      await convertirDivisa({
        origenCajaId: origenSaldo.caja_id, origenCuenta: origenSaldo.cuenta, monedaDe: de,
        destinoCajaId, destinoCuenta, monedaA: a,
        montoDe: montoNum, tasa: tasaNum, comisionPct, montoANeto: netoManual, motivo,
        actor, actorName,
      });
      if (cpTipo && cpNombre.trim()) {
        const ya = contrapartes.some((c) => c.tipo === cpTipo && c.nombre.trim().toUpperCase() === cpNombre.trim().toUpperCase());
        if (!ya) { try { await crearContraparte({ tipo: cpTipo, nombre: cpNombre.trim() }); } catch { /* duplicado u otro: no bloquea */ } }
      }
      toast(`Convertido: ${monto(montoNum, de)} → ${monto(resultado, a)}${quien ? ` · ${quien}` : ''}`, 'success');
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo convertir.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Conversor multimoneda" size="md" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={convertir} disabled={!puede}>
          {saving ? 'Convirtiendo…' : '💱 Convertir'}
        </button>
      </>
    }>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Convierte un <strong>saldo existente</strong> de una moneda a otra: descuenta de la caja
        origen y acredita el equivalente en la caja destino. La tasa sugerida toma el dólar
        de <strong>Binance (USDT/VES)</strong> y la TRM del COP (la <strong>BCV</strong> queda en la barra superior); es editable y se redondea a 2 decimales.
      </p>

      <div className="form-grid">
        <div className="form-row">
          <label>De (moneda)</label>
          <select className="select" value={de} onChange={(e) => setDe(e.target.value as MonedaCaja)}>
            {MONEDAS_CONV.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="form-row" style={{ alignSelf: 'end' }}>
          <button type="button" className="btn btn-ghost" onClick={swap} title="Invertir">⇄ Invertir</button>
        </div>
        <div className="form-row">
          <label>A (moneda)</label>
          <select className="select" value={a} onChange={(e) => setA(e.target.value as MonedaCaja)}>
            {MONEDAS_CONV.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* Origen: de qué saldo sale el dinero (caja + cuenta + moneda DE). */}
      <div className="form-row">
        <label>Sale de (saldo en {de})</label>
        {saldosOrigen.length === 0 ? (
          <div className="muted" style={{ fontSize: '.82rem', padding: '.4rem 0' }}>
            No hay ninguna caja con saldo en {de}.
          </div>
        ) : (
          <select className="select" value={origenSaldoId} onChange={(e) => setOrigenSaldoId(e.target.value)}>
            {saldosOrigen.map((s) => (
              <option key={s.id} value={s.id}>
                {nombreCaja(s.caja_id)}{s.cuenta !== 'general' ? ` · ${labelCuenta(s.cuenta)}` : ''} — {monto(s.saldo, s.moneda)}
              </option>
            ))}
          </select>
        )}
        {origenSaldo && <div className="muted" style={{ fontSize: '.74rem', marginTop: '.2rem' }}>Disponible: <strong className="mono">{monto(disponible, de)}</strong></div>}
      </div>

      {/* Destino: a qué caja entra el convertido (caja + cuenta), moneda A. */}
      <div className="form-grid">
        <div className="form-row">
          <label>Entra en (caja destino)</label>
          <select className="select" value={destinoCajaId} onChange={(e) => setDestinoCajaId(e.target.value)}>
            <option value="">— Elegí caja —</option>
            {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label>Cuenta / billetera destino</label>
          <select className="select" value={destinoCuenta} onChange={(e) => setDestinoCuenta(e.target.value as CuentaCaja)} disabled={!destinoCajaId}>
            {cuentasDestino.map((c) => <option key={c} value={c}>{labelCuentaCaja(c)}</option>)}
          </select>
          {destinoCajaId && (
            <small className="muted">
              {cuentasDestino.length > 1
                ? <>Entra a <strong>{nombreCaja(destinoCajaId)}</strong> · billetera <strong>{labelCuentaCaja(destinoCuenta)}</strong>.</>
                : <>Esta caja no tiene billeteras: entra directo a <strong>General</strong>.</>}
            </small>
          )}
        </div>
      </div>

      {/* Con quién se hace el intercambio: cliente o proveedor (como en CxC/CxP). */}
      <div className="form-row">
        <label>¿Con quién? (cliente o proveedor)</label>
        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.4rem' }}>
          {(['cliente', 'proveedor'] as const).map((t) => {
            const sel = cpTipo === t;
            return (
              <label key={t} style={{
                display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer',
                padding: '.4rem .7rem', borderRadius: 'var(--r-md)',
                border: `1px solid ${sel ? 'var(--primary)' : 'var(--border)'}`,
                background: sel ? 'rgba(255,138,0,0.10)' : 'transparent', flex: 1, justifyContent: 'center',
              }}>
                <input type="radio" name="conv-cp-tipo" checked={sel} onChange={() => { setCpTipo(t); setCpNombre(''); }} />
                <span style={{ fontWeight: 600 }}>{t === 'cliente' ? '👤 Cliente' : '🏭 Proveedor'}</span>
              </label>
            );
          })}
          {cpTipo && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setCpTipo(''); setCpNombre(''); }} title="Quitar">✕</button>}
        </div>
        {cpTipo && (() => {
          const guardados = contrapartes.filter((c) => c.tipo === cpTipo);
          const existe = guardados.some((c) => c.nombre.trim().toUpperCase() === cpNombre.trim().toUpperCase());
          return (
            <>
              <input className="input" list="conv-contrapartes" value={cpNombre} onChange={(e) => setCpNombre(e.target.value)}
                placeholder={cpTipo === 'proveedor' ? 'Buscar o agregar razón social del proveedor…' : 'Buscar o agregar nombre del cliente…'} autoFocus />
              <datalist id="conv-contrapartes">
                {guardados.map((c) => <option key={c.id} value={c.nombre} />)}
              </datalist>
              <small className="muted">
                Buscá en los {guardados.length} {cpTipo === 'proveedor' ? 'proveedor(es)' : 'cliente(s)'} guardados o escribí uno nuevo.{' '}
                {cpNombre.trim() && !existe
                  ? <strong style={{ color: 'var(--primary-3, #ff8a00)' }}>Nuevo → se guardará para próximas operaciones.</strong>
                  : 'Queda registrado en el motivo del movimiento.'}
              </small>
            </>
          );
        })()}
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>Monto en {de}</label>
          <input className="input mono" type="number" min={0} step="any" value={montoStr}
            onChange={(e) => setMontoStr(dosDecimales(e.target.value))} placeholder="0,00" autoFocus
            style={excede ? { borderColor: 'var(--danger)' } : undefined} />
          {origenSaldo && (
            <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: '.3rem' }}
              onClick={() => setMontoStr(String(disponible))}>Usar todo ({monto(disponible, de)})</button>
          )}
        </div>
        <div className="form-row">
          <label>Tasa · 1 {de} = ? {a}</label>
          <input className="input mono" type="number" min={0} step="any" value={tasaStr}
            onChange={(e) => setTasaStr(e.target.value)} placeholder={mercado ? '0,00' : 'cargando…'} />
          <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: '.3rem' }} onClick={usarMercado}>↺ Tasa de mercado</button>
        </div>
        <div className="form-row">
          <label>Comisión / descuento (%)</label>
          <input className="input mono" type="number" min={0} max={100} step="any"
            value={netoManual != null ? '' : comisionStr}
            onChange={(e) => { setNetoOverride(null); setComisionStr(e.target.value); }}
            placeholder={netoManual != null ? `≈ ${comisionPct}% (redondeado)` : '0'} />
          <div style={{ display: 'flex', gap: '.4rem', marginTop: '.3rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRedondearOpen(true)} disabled={bruto <= 0}
              title="Escribí a mano el monto redondeado que debe recibir el destino (ej. 60)">⊕ Redondear</button>
            {(comisionStr || netoManual != null) && <button type="button" className="btn btn-sm btn-ghost" onClick={limpiarComision}>✕ Sin comisión</button>}
          </div>
          <small className="muted">
            {netoManual != null
              ? <>El destino recibe el monto redondeado <strong>{monto(netoManual, a)}</strong> (comisión {monto(comisionMonto, a)}).</>
              : <>Opcional. Se le descuenta al convertido; el destino recibe el neto. «Redondear» te deja escribir el monto redondeado a recibir.</>}
          </small>
        </div>
      </div>

      <div className="card" style={{ marginTop: '.5rem', textAlign: 'center', borderColor: 'var(--brand, #ff8a00)' }}>
        <div className="muted" style={{ fontSize: '.74rem' }}>{comisionMonto > 0 ? (netoManual != null ? 'Recibe (redondeado) en ' : 'Recibe (neto) en ') : 'Equivalente en '}{a}</div>
        <strong className="mono" style={{ fontSize: '1.6rem', color: 'var(--text, #fff)' }}>{monto(resultado, a)}</strong>
        {tasaNum > 0 && montoNum > 0 && (
          <div className="muted" style={{ fontSize: '.72rem', marginTop: '.25rem' }}>
            {monto(montoNum, de)} × {tasaNum.toLocaleString('es-VE')} = {monto(bruto, a)}
            {comisionMonto > 0 && <> · − comisión {comisionPct}% ({monto(comisionMonto, a)}) = <strong>{monto(resultado, a)}</strong></>}
          </div>
        )}
      </div>

      {redondearOpen && (
        <RedondearNetoModal
          moneda={a}
          bruto={bruto}
          sugerido={Math.round(resultado / 10) * 10}
          onAceptar={aplicarRedondeo}
          onClose={() => setRedondearOpen(false)}
        />
      )}

      {excede && <div className="muted" style={{ color: 'var(--danger)', fontSize: '.8rem', marginTop: '.4rem' }}>El monto supera el saldo disponible.</div>}
      {err && <div className="muted" style={{ color: 'var(--danger)', fontSize: '.82rem', marginTop: '.4rem' }}>{err}</div>}
    </Modal>
  );
}

/** Modal chico: el usuario escribe el monto redondeado que debe recibir el destino. */
function RedondearNetoModal({ moneda, bruto, sugerido, onAceptar, onClose }: {
  moneda: string; bruto: number; sugerido: number; onAceptar: (m: number) => void; onClose: () => void;
}) {
  const [valStr, setValStr] = useState(sugerido > 0 && sugerido <= bruto ? String(sugerido) : '');
  const val = Number(valStr) || 0;
  const excede = val > bruto + 0.001;
  const puede = val > 0 && !excede;
  return (
    <Modal title="Monto redondeado" size="sm" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!puede} onClick={() => onAceptar(val)}>Aplicar</button>
      </>
    }>
      <div className="form-row">
        <label>Ingrese el monto redondeado que recibe el destino ({moneda})</label>
        <input className="input mono" type="number" min={0} step="any" autoFocus value={valStr}
          onChange={(e) => setValStr(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && puede) onAceptar(val); }}
          placeholder={sugerido > 0 ? String(sugerido) : '0'} />
        <small className="muted">
          Convertido (bruto): <strong>{monto(bruto, moneda)}</strong>.
          {val > 0 && !excede && <> La comisión será <strong>{monto(round2(bruto - val), moneda)}</strong>.</>}
        </small>
        {excede && <small className="muted" style={{ color: 'var(--danger)' }}>No puede superar el convertido ({monto(bruto, moneda)}).</small>}
      </div>
    </Modal>
  );
}

/* ───────────── Calculadora (cinta de operaciones · export PDF) ───────────── */

/** Evalúa una expresión aritmética simple (+ − × ÷, decimales, paréntesis) sin usar eval. */
function evalExpr(input: string): number {
  const s = input.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '.');
  const tokens: string[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ') { i++; continue; }
    if ('+-*/()'.includes(ch)) {
      // Menos unario: al inicio o tras un operador / '(' → se trata como 0 - n.
      if (ch === '-' && (tokens.length === 0 || '+-*/('.includes(tokens[tokens.length - 1]))) tokens.push('0');
      tokens.push(ch); i++; continue;
    }
    if (/[0-9.]/.test(ch)) {
      let num = ch; i++;
      while (i < s.length && /[0-9.]/.test(s[i])) { num += s[i]; i++; }
      tokens.push(num); continue;
    }
    throw new Error('Operación inválida.');
  }
  // Shunting-yard → RPN.
  const out: string[] = []; const ops: string[] = [];
  const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  for (const t of tokens) {
    if (/^[0-9.]+$/.test(t)) out.push(t);
    else if (t === '(') ops.push(t);
    else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()!);
      if (!ops.length) throw new Error('Paréntesis desbalanceados.');
      ops.pop();
    } else {
      while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[t]) out.push(ops.pop()!);
      ops.push(t);
    }
  }
  while (ops.length) { const o = ops.pop()!; if (o === '(') throw new Error('Paréntesis desbalanceados.'); out.push(o); }
  // Evaluar RPN.
  const st: number[] = [];
  for (const t of out) {
    if (/^[0-9.]+$/.test(t)) { const n = Number(t); if (!isFinite(n)) throw new Error('Número inválido.'); st.push(n); }
    else {
      const b = st.pop(); const a = st.pop();
      if (a === undefined || b === undefined) throw new Error('Operación incompleta.');
      let r: number;
      switch (t) {
        case '+': r = a + b; break;
        case '-': r = a - b; break;
        case '*': r = a * b; break;
        case '/': if (b === 0) throw new Error('División entre 0.'); r = a / b; break;
        default: throw new Error('Operador inválido.');
      }
      st.push(r);
    }
  }
  if (st.length !== 1 || !isFinite(st[0])) throw new Error('Operación inválida.');
  return Math.round(st[0] * 1e6) / 1e6;
}

const CALC_FMT = (n: number) => n.toLocaleString('es-VE', { maximumFractionDigits: 6 });

function CalculadoraModal({ actor, onClose }: { actor: string; onClose: () => void }) {
  const [expr, setExpr] = useState('');
  const [result, setResult] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ expr: string; result: number }[]>([]);
  const [exporting, setExporting] = useState(false);
  // Conversor rápido USD → Bs (BCV / Binance + margen de ahorro). Carga sus tasas.
  const [usdConv, setUsdConv] = useState('');
  const [mercadoCalc, setMercadoCalc] = useState<TasasMercado | null>(null);
  useEffect(() => { getTasasMercado().then(setMercadoCalc).catch(() => setMercadoCalc(null)); }, []);
  const bcv = mercadoCalc?.bcvUsd ?? null;
  const binance = mercadoCalc?.usdtVes ?? null;
  const fmtBs = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const press = useCallback((val: string) => {
    setError(null);
    if (val === 'C') { setExpr(''); setResult('0'); return; }
    if (val === '⌫') { setExpr((e) => e.slice(0, -1)); return; }
    if (val === '=') {
      setExpr((e) => {
        const cur = e.trim();
        if (!cur) return e;
        try {
          const r = evalExpr(cur);
          setResult(CALC_FMT(r));
          setHistory((h) => [{ expr: cur, result: r }, ...h].slice(0, 200));
          return String(r);
        } catch (err) { setError(err instanceof Error ? err.message : 'Error'); return e; }
      });
      return;
    }
    setExpr((e) => e + val);
  }, []);

  // Resultado en vivo mientras se escribe (sin presionar =).
  const preview = useMemo(() => {
    const cur = expr.trim();
    if (!cur) return null;
    try { return CALC_FMT(evalExpr(cur)); } catch { return null; }
  }, [expr]);

  // Soporte de teclado.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const k = ev.key;
      if (/[0-9]/.test(k)) press(k);
      else if (k === '.' || k === ',') press('.');
      else if (k === '+') press('+');
      else if (k === '-') press('-');
      else if (k === '*') press('×');
      else if (k === '/') press('÷');
      else if (k === '(' || k === ')') press(k);
      else if (k === 'Enter' || k === '=') { ev.preventDefault(); press('='); }
      else if (k === 'Backspace') press('⌫');
      else if (k === 'Escape') { press('C'); }
      else return;
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  async function exportarPdf() {
    if (!history.length) { setError('No hay operaciones para exportar.'); return; }
    setExporting(true);
    try {
      const [{ jsPDF }, autoTableMod, logoMod] = await Promise.all([
        import('jspdf'), import('jspdf-autotable'), import('@/shared/lib/pdfLogo'),
      ]);
      const autoTable = autoTableMod.default;
      const logo = await logoMod.loadLogoDataUrl().catch(() => null);
      const doc = new jsPDF({ unit: 'pt', format: 'letter' });
      const PAGE_W = doc.internal.pageSize.getWidth();
      const MARGIN = 42.52; let y = MARGIN;
      const LOGO = 60; const TX = logo ? MARGIN + LOGO + 14 : MARGIN;
      if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, LOGO, LOGO); } catch { /* logo opcional */ } }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
      doc.text('CALCULADORA · OPERACIONES', TX, y + 18);
      doc.setFontSize(10); doc.setFont('helvetica', 'normal');
      doc.text(`Generado: ${dateTime(new Date().toISOString())}`, TX, y + 36);
      y += Math.max(LOGO, 42) + 8;
      doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5); doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 14;
      doc.setFontSize(9);
      doc.text('Mineral Group Guayana C.A. · Sistema de Gestión de Inventarios', MARGIN, y);
      doc.text(actor, PAGE_W - MARGIN, y, { align: 'right' });
      // Más viejas arriba (orden cronológico).
      const filas = history.slice().reverse().map((h, idx) => [String(idx + 1), h.expr, CALC_FMT(h.result)]);
      autoTable(doc, {
        startY: y + 8,
        head: [['#', 'Operación', 'Resultado']],
        body: filas,
        margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        styles: { fontSize: 9, cellPadding: 5, overflow: 'linebreak' },
        headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 30, halign: 'right' }, 1: { cellWidth: 'auto', font: 'courier' }, 2: { cellWidth: 140, halign: 'right', fontStyle: 'bold' } },
      });
      doc.save('calculadora-operaciones.pdf');
      toast('PDF de operaciones descargado.', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo exportar.');
    } finally { setExporting(false); }
  }

  const KEYS: { label: string; val: string; kind: 'num' | 'op' | 'act' | 'eq' }[] = [
    { label: 'C', val: 'C', kind: 'act' }, { label: '⌫', val: '⌫', kind: 'act' }, { label: '(', val: '(', kind: 'op' }, { label: ')', val: ')', kind: 'op' },
    { label: '7', val: '7', kind: 'num' }, { label: '8', val: '8', kind: 'num' }, { label: '9', val: '9', kind: 'num' }, { label: '÷', val: '÷', kind: 'op' },
    { label: '4', val: '4', kind: 'num' }, { label: '5', val: '5', kind: 'num' }, { label: '6', val: '6', kind: 'num' }, { label: '×', val: '×', kind: 'op' },
    { label: '1', val: '1', kind: 'num' }, { label: '2', val: '2', kind: 'num' }, { label: '3', val: '3', kind: 'num' }, { label: '−', val: '-', kind: 'op' },
    { label: '0', val: '0', kind: 'num' }, { label: '.', val: '.', kind: 'num' }, { label: '=', val: '=', kind: 'eq' }, { label: '+', val: '+', kind: 'op' },
  ];

  return (
    <Modal title="Calculadora" size="md" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        <button className="btn btn-primary" onClick={exportarPdf} disabled={exporting || !history.length}>
          {exporting ? 'Generando…' : '🧾 Exportar PDF'}
        </button>
      </>
    }>
      {/* Visor: expresión + resultado en vivo. */}
      <div className="card" style={{ padding: '.6rem .8rem', marginTop: 0, textAlign: 'right', minHeight: 60 }}>
        <div className="mono" style={{ fontSize: '.95rem', color: 'var(--muted)', minHeight: '1.2rem', wordBreak: 'break-all' }}>{expr || ' '}</div>
        <strong className="mono" style={{ fontSize: '1.7rem', color: 'var(--text, #fff)', display: 'block', wordBreak: 'break-all' }}>
          {expr && preview != null ? preview : result}
        </strong>
      </div>
      {error && <div className="muted" style={{ color: 'var(--danger)', fontSize: '.82rem', margin: '.35rem 0' }}>{error}</div>}

      {/* Teclado. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.4rem', marginTop: '.6rem' }}>
        {KEYS.map((k) => (
          <button key={k.label} type="button"
            className={k.kind === 'eq' ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => press(k.val)}
            style={{
              padding: '.7rem 0', fontSize: '1.05rem', fontWeight: 700,
              ...(k.kind === 'op' ? { color: 'var(--brand, #ff8a00)' } : {}),
              ...(k.kind === 'act' ? { color: 'var(--danger)' } : {}),
            }}>
            {k.label}
          </button>
        ))}
      </div>

      {/* Conversor rápido USD → Bs (BCV / Binance + margen de ahorro). */}
      <div className="card" style={{ padding: '.6rem .8rem', marginTop: '.7rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '.84rem' }}>💵 USD → Bs</strong>
          <span className="muted" style={{ fontSize: '.78rem' }}>Monto $</span>
          <input className="input mono" type="number" min={0} step="any" style={{ width: 120 }}
            value={usdConv} onChange={(e) => setUsdConv(e.target.value)} placeholder="9.50" />
        </div>
        {(() => {
          const usd = Number(usdConv) || 0;
          const enBcv = bcv != null ? usd * bcv : null;
          const enBin = binance != null ? usd * binance : null;
          const margen = bcv != null && binance != null && binance > 0 ? ((binance - bcv) / binance) * 100 : null;
          const ahorroBs = enBcv != null && enBin != null ? enBin - enBcv : null;
          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '.5rem', marginTop: '.5rem' }}>
              <div>
                <div className="muted" style={{ fontSize: '.66rem' }}>A BCV {bcv != null ? `(${fmtBs(bcv)})` : ''}</div>
                <div className="mono" style={{ fontWeight: 700 }}>{enBcv != null ? `Bs ${fmtBs(enBcv)}` : '—'}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '.66rem' }}>A BINANCE {binance != null ? `(${fmtBs(binance)})` : ''}</div>
                <div className="mono" style={{ fontWeight: 700 }}>{enBin != null ? `Bs ${fmtBs(enBin)}` : '—'}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '.66rem' }}>MARGEN DE AHORRO</div>
                <div className="mono" style={{ fontWeight: 700, color: margen != null && margen > 0 ? 'var(--success)' : 'var(--muted)' }}>
                  {margen != null ? `${fmtBs(margen)} %` : '—'}
                  {ahorroBs != null && ahorroBs > 0 && <span className="muted" style={{ fontSize: '.7rem', fontWeight: 400 }}> · ahorro Bs {fmtBs(ahorroBs)}</span>}
                </div>
              </div>
            </div>
          );
        })()}
        {(bcv == null || binance == null) && <div className="muted" style={{ fontSize: '.7rem', marginTop: '.3rem' }}>Si una tasa no aparece, actualizala desde Tesorería (↻).</div>}
        <div className="muted" style={{ fontSize: '.68rem', marginTop: '.35rem' }}>Margen = cuánto ahorrás pagando a BCV vs Binance: (Binance − BCV) ÷ Binance.</div>
      </div>

      {/* Cinta de operaciones (resultado junto a la operación). */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '.8rem' }}>
        <strong style={{ fontSize: '.84rem' }}>Operaciones ({history.length})</strong>
        {history.length > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setHistory([])}>Limpiar</button>}
      </div>
      <div className="table-wrap" style={{ maxHeight: 180, overflowY: 'auto', marginTop: '.3rem' }}>
        <table className="table" style={{ fontSize: '.82rem' }}>
          <tbody>
            {!history.length && <tr><td className="muted" style={{ textAlign: 'center' }}>Sin operaciones aún.</td></tr>}
            {history.map((h, idx) => (
              <tr key={idx} style={{ cursor: 'pointer' }} onClick={() => setExpr(String(h.result))} title="Usar este resultado">
                <td className="mono" style={{ color: 'var(--muted)' }}>{h.expr}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text, #fff)' }}>= {CALC_FMT(h.result)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/* ───────────── Resumen de movimientos (gráfico + drill-down, en vivo) ───────────── */

type CatResumen = 'ingreso' | 'egreso' | 'gasto';

function ResumenMovimientosModal({ monedas, defaultMoneda, defaultDesde, defaultHasta, cajas = [], canWrite, actor = '', onClose, onChanged }: {
  monedas: string[]; defaultMoneda: string; defaultDesde: string; defaultHasta: string;
  cajas?: Caja[]; canWrite?: boolean; actor?: string; onClose: () => void; onChanged?: () => void | Promise<void>;
}) {
  const [moneda, setMoneda] = useState(defaultMoneda || 'USD');
  // Detalle editable de un movimiento (clic en una fila).
  const [detalleMov, setDetalleMov] = useState<MovimientoCaja | null>(null);
  const [desde, setDesde] = useState(defaultDesde);
  const [hasta, setHasta] = useState(defaultHasta);
  const [allRows, setAllRows] = useState<MovimientoCaja[]>([]);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<CatResumen | null>(null);
  // Subnivel del drill de Gastos: categoría elegida (para ver sus movimientos).
  const [gastoCat, setGastoCat] = useState<string | null>(null);
  const autoMonedaRef = useRef(false);

  // Carga TODAS las monedas (sin filtrar) para no quedar en 0 si la actividad está en
  // otra moneda y para detectar el mejor default. El filtro por moneda es en cliente.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listLibroMayor({ desde: desde || undefined, hasta: hasta || undefined, limite: 10000 });
      setAllRows(data);
    } catch { setAllRows([]); } finally { setLoading(false); }
  }, [desde, hasta]);

  useEffect(() => { void load(); }, [load]);
  // Anclado a los movimientos: si entra/cambia un movimiento, el resumen se actualiza solo.
  useRealtime(['movimientos_caja'], () => { void load(); });

  // Monedas presentes (con cantidad de movimientos) para elegir un buen default.
  const monedasConDatos = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allRows) m.set(r.moneda, (m.get(r.moneda) || 0) + 1);
    return m;
  }, [allRows]);
  // Si la moneda elegida no tiene movimientos pero otra sí, saltamos a la de mayor actividad (una vez).
  useEffect(() => {
    if (autoMonedaRef.current || !allRows.length) return;
    autoMonedaRef.current = true;
    if (!monedasConDatos.get(moneda)) {
      const top = Array.from(monedasConDatos.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (top) setMoneda(top);
    }
  }, [allRows, monedasConDatos, moneda]);

  const rows = useMemo(() => allRows.filter((m) => m.moneda === moneda), [allRows, moneda]);

  const esIngreso = (m: MovimientoCaja) => m.tipo === 'ingreso' || m.tipo === 'entrada' || m.tipo === 'traslado_entrada';
  const esEgreso = (m: MovimientoCaja) => m.tipo === 'salida' || m.tipo === 'traslado_salida';
  const esGasto = (m: MovimientoCaja) => esEgreso(m) && (m.categoria ?? '') === 'gasto';

  const grupos = useMemo(() => {
    const ing = rows.filter(esIngreso);
    const egr = rows.filter(esEgreso);
    const gas = rows.filter(esGasto);
    const suma = (arr: MovimientoCaja[]) => round2(arr.reduce((a, m) => a + (Number(m.monto) || 0), 0));
    return {
      ingreso: { label: 'Ingresos', movs: ing, total: suma(ing), color: '#10b981' },
      egreso: { label: 'Egresos', movs: egr, total: suma(egr), color: '#ef4444' },
      gasto: { label: 'Gastos', movs: gas, total: suma(gas), color: '#ff8a00' },
    } as Record<CatResumen, { label: string; movs: MovimientoCaja[]; total: number; color: string }>;
  }, [rows]);

  // Desglose de GASTOS por categoría (gasto_categoria), de mayor a menor.
  const gruposGasto = useMemo(() => {
    const m = new Map<string, { cat: string; movs: MovimientoCaja[]; total: number }>();
    for (const g of grupos.gasto.movs) {
      const cat = (g.gasto_categoria && g.gasto_categoria.trim()) || 'Sin categoría';
      let r = m.get(cat); if (!r) { r = { cat, movs: [], total: 0 }; m.set(cat, r); }
      r.movs.push(g); r.total = round2(r.total + (Number(g.monto) || 0));
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [grupos]);

  const neto = round2(grupos.ingreso.total - grupos.egreso.total);
  const orden: CatResumen[] = ['ingreso', 'egreso', 'gasto'];
  const maxTotal = Math.max(1, grupos.ingreso.total, grupos.egreso.total, grupos.gasto.total);
  const elegirDrill = (k: CatResumen) => { setGastoCat(null); setDrill(drill === k ? null : k); };
  const drillMovs = drill ? grupos[drill].movs : [];
  const catMovs = gastoCat ? (gruposGasto.find((x) => x.cat === gastoCat)?.movs ?? []) : [];

  return (
    <Modal title="Resumen de movimientos" size="lg" onClose={onClose} footer={
      <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
    }>
      {/* Filtros: moneda + rango de fechas. */}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.6rem' }}>
        <select className="select" value={moneda} onChange={(e) => setMoneda(e.target.value)} style={{ width: 'auto' }}>
          {monedas.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
          Desde <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={{ width: 'auto' }} />
        </label>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
          Hasta <input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={{ width: 'auto' }} />
        </label>
        {(desde || hasta) && <button className="btn btn-sm btn-ghost" onClick={() => { setDesde(''); setHasta(''); }}>✕ Fechas</button>}
        <span className="muted" style={{ fontSize: '.75rem', marginLeft: 'auto' }}>● en vivo</span>
      </div>

      {/* Tarjetas resumen. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '.5rem', marginBottom: '.8rem' }}>
        {orden.map((k) => (
          <button key={k} className="card" onClick={() => elegirDrill(k)}
            style={{ padding: '.55rem .7rem', textAlign: 'left', cursor: 'pointer', border: `1px solid ${drill === k ? grupos[k].color : 'var(--border)'}` }}
            title={`Ver movimientos de ${grupos[k].label.toLowerCase()}`}>
            <div className="muted" style={{ fontSize: '.72rem', display: 'flex', alignItems: 'center', gap: '.3rem' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: grupos[k].color, display: 'inline-block' }} />{grupos[k].label}
              {k === 'gasto' && <span style={{ fontSize: '.62rem' }}>(en egresos)</span>}
            </div>
            <strong className="mono" style={{ fontSize: '1.05rem', color: 'var(--text, #fff)', display: 'block' }}>{monto(grupos[k].total, moneda)}</strong>
            <span className="muted" style={{ fontSize: '.7rem' }}>{grupos[k].movs.length} mov.</span>
          </button>
        ))}
        <div className="card" style={{ padding: '.55rem .7rem', border: '1px solid var(--border)' }}>
          <div className="muted" style={{ fontSize: '.72rem' }}>Neto (ing. − egr.)</div>
          <strong className="mono" style={{ fontSize: '1.05rem', color: neto >= 0 ? 'var(--success)' : 'var(--danger)', display: 'block' }}>{monto(neto, moneda)}</strong>
        </div>
      </div>

      {/* Gráfico de barras clickeable. */}
      {loading ? (
        <div className="muted" style={{ textAlign: 'center', padding: '1.5rem' }}>Cargando…</div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', gap: '1rem', height: 200, padding: '0 .5rem', borderBottom: '1px solid var(--border)', marginBottom: '.7rem' }}>
          {orden.map((k) => {
            const g = grupos[k];
            const h = Math.max(4, (g.total / maxTotal) * 160);
            const activo = drill === k;
            return (
              <button key={k} type="button" onClick={() => elegirDrill(k)}
                title={`${g.label}: ${monto(g.total, moneda)} · clic para ver movimientos`}
                style={{ flex: 1, maxWidth: 130, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                <span className="mono" style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--text, #fff)', marginBottom: 4 }}>{monto(g.total, moneda)}</span>
                <div style={{ width: '70%', height: h, background: g.color, borderRadius: '6px 6px 0 0', opacity: activo || !drill ? 1 : 0.45, transition: 'height .3s, opacity .2s', outline: activo ? `2px solid ${g.color}` : 'none', outlineOffset: 2 }} />
                <span style={{ fontSize: '.8rem', marginTop: 6, fontWeight: activo ? 700 : 400, color: 'var(--text, #fff)' }}>{g.label}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="muted" style={{ fontSize: '.72rem', textAlign: 'center', marginBottom: '.5rem' }}>
        Tocá una barra o tarjeta para ver el detalle de esos movimientos.
      </div>

      {/* Drill-down: categoría elegida (Gastos por categoría → movimientos). */}
      {drill && (
        <div className="card" style={{ marginTop: '.3rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
            <strong style={{ fontSize: '.88rem' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: grupos[drill].color, display: 'inline-block', marginRight: '.35rem' }} />
              {drill === 'gasto'
                ? `Gastos por categoría · ${gruposGasto.length} categoría(s) · ${monto(grupos.gasto.total, moneda)}`
                : `Movimientos de ${grupos[drill].label.toLowerCase()} · ${drillMovs.length} · ${monto(grupos[drill].total, moneda)}`}
            </strong>
            <button className="btn btn-sm btn-ghost" onClick={() => { setDrill(null); setGastoCat(null); }}>✕ Cerrar detalle</button>
          </div>

          {drill === 'gasto' ? (
            gastoCat ? (
              /* Movimientos de la categoría de gasto elegida */
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
                  <span style={{ fontSize: '.84rem' }}><strong>{gastoCat}</strong> · {catMovs.length} mov · {monto(gruposGasto.find((x) => x.cat === gastoCat)?.total ?? 0, moneda)}</span>
                  <button className="btn btn-sm btn-ghost" onClick={() => setGastoCat(null)}>← Volver a categorías</button>
                </div>
                <div className="table-wrap" style={{ maxHeight: 240, overflowY: 'auto' }}>
                  <table className="table" style={{ fontSize: '.82rem' }}>
                    <thead><tr><th>Fecha</th><th>Caja</th><th>Subcategoría / motivo</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead>
                    <tbody>
                      {catMovs.map((m) => {
                        const concepto = [m.gasto_subcategoria, m.beneficiario, m.motivo].filter(Boolean).join(' · ') || '—';
                        return (
                          <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => setDetalleMov(m)} title="Ver / editar el movimiento">
                            <td>{dateTime(m.at)}</td>
                            <td>{m.caja?.nombre ?? '—'}</td>
                            <td>{concepto}</td>
                            <td className="mono" style={{ textAlign: 'right', color: 'var(--danger)' }}>−{monto(m.monto, m.moneda)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              /* Lista de categorías de gasto (clic → sus movimientos) */
              !gruposGasto.length ? <EmptyState message="Sin gastos en el periodo." /> : (
                <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
                  <table className="table" style={{ fontSize: '.84rem' }}>
                    <thead><tr><th>Categoría</th><th style={{ textAlign: 'right' }}>Movs</th><th style={{ textAlign: 'right' }}>Total</th><th></th></tr></thead>
                    <tbody>
                      {gruposGasto.map((g) => (
                        <tr key={g.cat} style={{ cursor: 'pointer' }} onClick={() => setGastoCat(g.cat)} title="Ver los movimientos de esta categoría">
                          <td><strong>{g.cat}</strong></td>
                          <td className="mono" style={{ textAlign: 'right' }}>{g.movs.length}</td>
                          <td className="mono" style={{ textAlign: 'right', color: 'var(--danger)' }}>{monto(g.total, moneda)}</td>
                          <td style={{ textAlign: 'right' }}>🔍</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )
          ) : (
            /* Lista plana para Ingresos / Egresos */
            <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
              <table className="table" style={{ fontSize: '.82rem' }}>
                <thead><tr><th>Fecha</th><th>Caja</th><th>Concepto</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead>
                <tbody>
                  {!drillMovs.length && <tr><td colSpan={4}><EmptyState message="Sin movimientos en esta categoría para el periodo." /></td></tr>}
                  {drillMovs.map((m) => {
                    const egreso = esEgreso(m);
                    const concepto = [CAT_LABEL[m.categoria ?? ''], m.beneficiario, m.motivo].filter(Boolean).join(' · ') || '—';
                    return (
                      <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => setDetalleMov(m)} title="Ver / editar el movimiento">
                        <td>{dateTime(m.at)}</td>
                        <td>{m.caja?.nombre ?? '—'}</td>
                        <td>{concepto}</td>
                        <td className="mono" style={{ textAlign: 'right', color: egreso ? 'var(--danger)' : 'var(--success)' }}>{egreso ? '−' : '+'}{monto(m.monto, m.moneda)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {detalleMov && (
        <MovimientoDetalleModal
          mov={detalleMov}
          cajas={cajas}
          defaultEmail={actor}
          canWrite={canWrite}
          onChanged={async () => { setDetalleMov(null); await load(); await onChanged?.(); }}
          onClose={() => setDetalleMov(null)}
        />
      )}
    </Modal>
  );
}

/* ───────────── Retenciones listas (vista desde Tesorería) ───────────── */

/**
 * Vista de Tesorería de las retenciones YA LISTAS (finalizadas en el módulo de
 * Retenciones): muestra el detalle, los comprobantes (descargables), a qué OC
 * pertenece y si la retención ya fue pagada (la marca la pone Tesorería al pagar
 * la OC). Es solo lectura: la carga de comprobantes vive en el módulo Retenciones.
 */
function RetencionesTesoreriaModal({ items, onClose }: { items: RetencionItem[]; onClose: () => void }) {
  // Esta vista de Tesorería es sólo para OC (la retención de compra directa no tiene
  // pago aparte en Tesorería): se filtran las filas que traen orden.
  const ocItems = useMemo(
    () => items.filter((it): it is RetencionItem & { orden: NonNullable<RetencionItem['orden']> } => !!it.orden),
    [items],
  );
  // Sin auto-selección: el detalle aparece al tocar "Ver" (toggle). Con un solo
  // ítem se abre directo; con varios, cada "Ver" abre el suyo.
  const [selId, setSelId] = useState<string>(ocItems.length === 1 ? (ocItems[0]?.orden.id ?? '') : '');
  const toggle = (id: string) => setSelId((prev) => prev === id ? '' : id);
  const sel = ocItems.find((it) => it.orden.id === selId) ?? null;
  const o = sel?.orden ?? null;
  const comprobantes = useMemo(() => (o ? comprobantesDeOrden(o) : []), [o]);

  async function descargar(path: string) {
    try { window.open(await urlRetencion(path), '_blank', 'noopener'); }
    catch { toast('No se pudo abrir el comprobante', 'error'); }
  }

  return (
    <Modal title="Retenciones listas" size="lg" onClose={onClose} footer={
      <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
    }>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Retenciones <strong>finalizadas</strong> (comprobantes cargados desde el módulo de Retenciones). Acá ves el
        detalle, el comprobante y la OC a la que pertenecen, y si <strong>ya fueron pagadas</strong>.
      </p>

      {!ocItems.length ? (
        <EmptyState icon="🧾" message="No hay retenciones listas." />
      ) : (
        <>
          {/* Lista de retenciones listas. */}
          <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto', marginBottom: '.7rem' }}>
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead><tr><th>N°OC</th><th>Proveedor</th><th style={{ textAlign: 'right' }}>Total</th><th>Tesorería</th><th></th></tr></thead>
              <tbody>
                {ocItems.map(({ orden, proveedorNombre }) => (
                  <tr key={orden.id} style={{ background: orden.id === selId ? 'var(--bg-1)' : undefined, cursor: 'pointer' }} onClick={() => toggle(orden.id)}>
                    <td className="mono">{orden.oc_codigo ?? orden.codigo}</td>
                    <td>{proveedorNombre}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{monto(orden.total, orden.moneda ?? 'USD')}</td>
                    <td>{orden.retencion_pagada
                      ? <span className="badge" style={{ color: 'var(--success)' }}>✓ Pagada</span>
                      : <span className="muted">Por pagar</span>}</td>
                    <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); toggle(orden.id); }}>{orden.id === selId ? 'Ocultar' : 'Ver'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Detalle de la retención seleccionada. */}
          {o && sel && (
            <div className="card" style={{ margin: 0 }}>
              <div className="card-title" style={{ marginBottom: '.4rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.4rem' }}>
                <span>OC {o.oc_codigo ?? o.codigo} · {sel.proveedorNombre}</span>
                {o.retencion_pagada
                  ? <span className="badge" style={{ color: 'var(--success)' }}>✓ Pagada{o.retencion_pagada_en ? ` · ${dateTime(o.retencion_pagada_en)}` : ''}</span>
                  : <span className="badge" style={{ color: 'var(--warning)' }}>Por pagar</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '.4rem .9rem', fontSize: '.85rem' }}>
                <div><span className="muted">OP:</span> <strong className="mono">{o.codigo}</strong></div>
                <div><span className="muted">Condición:</span> {labelCondicionPago(o.condiciones_pago)}</div>
                <div><span className="muted">Retención:</span> {labelRetencionModo(o.retencion_modo)}</div>
                <div><span className="muted">Total:</span> <strong className="mono">{monto(o.total, o.moneda ?? 'USD')}</strong></div>
                <div><span className="muted">Finalizada:</span> {o.retencion_finalizada_en ? dateTime(o.retencion_finalizada_en) : '—'}</div>
              </div>

              {/* Items de la OC. */}
              <div className="table-wrap" style={{ marginTop: '.5rem' }}>
                <table className="table" style={{ fontSize: '.8rem' }}>
                  <thead><tr><th>Material</th><th style={{ textAlign: 'right' }}>Cant.</th><th style={{ textAlign: 'right' }}>Precio</th></tr></thead>
                  <tbody>
                    {(o.items ?? []).map((it, i) => (
                      <tr key={i}><td>{it.nombre}{it.sku ? <span className="muted"> · {it.sku}</span> : null}</td><td className="mono" style={{ textAlign: 'right' }}>{Number(it.cantidad).toLocaleString('es-VE')}</td><td className="mono" style={{ textAlign: 'right' }}>{monto(it.precio, o.moneda ?? 'USD')}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Comprobantes (descargables). */}
              <div style={{ marginTop: '.6rem' }}>
                <strong style={{ fontSize: '.82rem' }}>Comprobantes</strong>
                {comprobantes.length === 0 ? (
                  <div className="muted" style={{ fontSize: '.82rem', marginTop: '.2rem' }}>Sin comprobantes cargados.</div>
                ) : (
                  <div style={{ display: 'grid', gap: '.35rem', marginTop: '.3rem' }}>
                    {comprobantes.map((c) => (
                      <div key={c.tipo} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', fontSize: '.84rem' }}>
                        <span><span className="badge">{c.label}</span> <span className="muted">{c.nombre}</span></span>
                        <button className="btn btn-sm btn-ghost" onClick={() => descargar(c.path)}>📎 Descargar</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/* ───────────── Cajas multimoneda (saldos + lotes + promedio) ───────────── */

const MONEDAS_CAJA: MonedaCaja[] = ['Bs', 'USD', 'USDT', 'COP'];


/* ───────────── Tasas Binance (3 tasas del P2P, en barras) ───────────── */

function GraficoTasasModal({ onClose }: { onClose: () => void }) {
  const [tasas, setTasas] = useState<Binance3 | null>(null);
  const [loading, setLoading] = useState(true);
  const [refrescando, setRefrescando] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setTasas(await getBinance3()); }
    catch { setTasas(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function actualizarAhora() {
    setRefrescando(true);
    try {
      setTasas(await refrescarBinanceP2P());
      notify('Tasas Binance actualizadas', 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo actualizar (¿Edge Function desplegada?)', 'error'); }
    finally { setRefrescando(false); }
  }

  const fmtTasa = (v: number | null | undefined) => v != null ? Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const bars: ChartPoint[] = tasas ? [
    { label: 'Compra', value: Number(tasas.buy) || 0, tooltip: `Compra: ${fmtTasa(tasas.buy)} Bs` },
    { label: 'Promedio', value: Number(tasas.promedio) || 0, tooltip: `Promedio: ${fmtTasa(tasas.promedio)} Bs` },
    { label: 'Venta', value: Number(tasas.sell) || 0, tooltip: `Venta: ${fmtTasa(tasas.sell)} Bs` },
  ] : [];

  return (
    <Modal title="Tasas Binance" size="xl" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.7rem' }}>
        <strong>USDT / VES · P2P Binance</strong>
        <button className="btn btn-sm btn-primary" onClick={actualizarAhora} disabled={refrescando}>{refrescando ? 'Actualizando…' : '↻ Actualizar ahora'}</button>
        <span className="muted" style={{ fontSize: '.78rem' }}>3 tasas de referencia del mercado P2P (Bs por 1 USDT).</span>
      </div>

      {/* Tarjetas de las 3 tasas */}
      <div className="m-tiles" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '.6rem', marginBottom: '.8rem' }}>
        {[
          { t: 'Compra', v: tasas?.buy, c: '#22c55e', n: 'Lo que cobran al venderte USDT' },
          { t: 'Promedio', v: tasas?.promedio, c: '#f3ba2f', n: 'Punto medio (referencia)' },
          { t: 'Venta', v: tasas?.sell, c: '#ef4444', n: 'Lo que pagan por tu USDT' },
        ].map((x) => (
          <div key={x.t} className="card" style={{ borderColor: x.c, textAlign: 'center' }}>
            <div className="muted" style={{ fontSize: '.74rem' }}>{x.t}</div>
            <strong className="mono" style={{ fontSize: '1.4rem', color: x.c }}>{fmtTasa(x.v)}</strong>
            <div className="muted" style={{ fontSize: '.66rem', marginTop: '.15rem' }}>{x.n}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="muted" style={{ padding: '1rem' }}>Cargando…</div>
      ) : (
        <BarChart data={bars} color="#f3ba2f" height={240}
          yFormatter={(v) => v.toLocaleString('es-VE', { maximumFractionDigits: 0 })}
          emptyMessage="Aún no hay tasas capturadas. Usá ↻ Actualizar ahora." />
      )}
      {tasas?.at && <div className="muted" style={{ fontSize: '.72rem', marginTop: '.4rem', textAlign: 'right' }}>Última captura: {dateTime(tasas.at)}</div>}
    </Modal>
  );
}

/* ───────────── Órdenes pendientes por pagar (OC confirmadas) ───────────── */

function OrdenesPorPagarModal({ cajas, actor, actorName, userId, directos, onClose, onPaid }: {
  cajas: Caja[]; actor: string; actorName: string | null; userId: string; directos: DirectoFila[]; onClose: () => void; onPaid: () => void;
}) {
  const [rows, setRows] = useState<OrdenPorPagar[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<OrdenPorPagar | null>(null);
  // Directo (compra/servicio directo POR PAGAR) seleccionado para pagar.
  const [pagarDir, setPagarDir] = useState<DirectoFila | null>(null);
  // Selección para pago en lote (mismo proveedor + mismo método/moneda).
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [lote, setLote] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setRows(await listOrdenesPorPagar()); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar', 'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  // Badge 💬 de mensajes no leídos por OC (chat con Compras), en realtime.
  const [noLeidos, setNoLeidos] = useState<Map<string, number>>(new Map());
  const cargarNoLeidos = useCallback(() => {
    if (!userId) return;
    noLeidosPorOrden(userId).then(setNoLeidos).catch(() => { /* sin badge si falla */ });
  }, [userId]);
  useEffect(() => { cargarNoLeidos(); }, [cargarNoLeidos]);
  useRealtime(['oc_mensajes'], cargarNoLeidos);

  // Bloqueo del lote: una vez marcada la primera OC, solo se suman las del MISMO
  // proveedor. Se permiten también las que aún no tienen método de pago (Tesorería
  // paga directo del mismo proveedor, aunque el método no esté indicado).
  const primera = rows.find((r) => marcadas.has(r.orden.id)) ?? null;
  const lockProv = primera?.orden.proveedor_id ?? null;
  const compatible = useCallback((r: OrdenPorPagar) =>
    !!r.orden.proveedor_id && (!primera || r.orden.proveedor_id === lockProv),
  [primera, lockProv]);

  function toggle(r: OrdenPorPagar) {
    setMarcadas((prev) => {
      const next = new Set(prev);
      if (next.has(r.orden.id)) next.delete(r.orden.id);
      else if (compatible(r)) next.add(r.orden.id);
      return next;
    });
  }
  const seleccionadas = rows.filter((r) => marcadas.has(r.orden.id));
  const totalSel = round2(seleccionadas.reduce((a, r) => a + (Number(r.montoAPagar) || 0), 0));

  return (
    <Modal title="Órdenes pendientes por pagar" size="xl" onClose={onClose} footer={
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
    }>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Órdenes de compra aprobadas por el Gerente. Marcá varias del <strong>mismo proveedor</strong> para pagarlas juntas
        (un egreso por OC). Se pueden incluir las que están <strong>⏳ Esperando método de pago</strong>: Tesorería las paga
        directo eligiendo la caja, aunque el analista todavía no haya indicado el método.
      </p>

      <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.6rem' }}>
        <button className="btn btn-sm btn-ghost" disabled={!rows.length}
          onClick={() => import('./ordenesPorPagarPdf').then(({ descargarResumenPorPagarPdf }) => descargarResumenPorPagarPdf(rows)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'))}>
          ↓ Resumen PDF
        </button>
      </div>

      {seleccionadas.length >= 2 && (
        <div className="card" style={{ margin: '0 0 .6rem', padding: '.55rem .8rem', display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap', borderColor: 'var(--brand, #ff8a00)' }}>
          <strong>{seleccionadas.length} OC</strong> de <strong>{primera?.proveedorNombre}</strong> · total <strong className="mono">{monto(totalSel, 'USD')}</strong>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '.4rem' }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setMarcadas(new Set())}>Limpiar</button>
            <button className="btn btn-sm btn-primary" onClick={() => setLote(true)}>💳 Pagar {seleccionadas.length} seleccionadas</button>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead><tr>
            <th style={{ width: 28 }}></th>
            <th>N°ODC</th><th>OP</th><th>Proveedor</th><th>Condición</th>
            <th style={{ textAlign: 'right' }}>A pagar $</th><th>OC creada</th><th>Confirmada</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !rows.length && !directos.length && <tr><td colSpan={9}><EmptyState message="No hay órdenes confirmadas por pagar" icon="✅" /></td></tr>}
            {!loading && rows.map((r) => {
              const marcada = marcadas.has(r.orden.id);
              const habilitada = compatible(r) || marcada;
              return (
              <tr key={r.orden.id} className="row-selectable" style={{ cursor: 'pointer', opacity: !habilitada ? 0.5 : 1 }} onClick={() => setSel(r)}>
                <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                  {r.orden.proveedor_id && (
                    <input type="checkbox" checked={marcada} disabled={!habilitada}
                      title={!habilitada ? 'Solo se agrupan OC del mismo proveedor' : 'Seleccionar para pago en lote'}
                      onChange={() => toggle(r)} />
                  )}
                </td>
                <td className="mono">
                  {r.orden.clase === 'servicio'
                    ? <span className="badge" style={{ background: '#7c5cff', color: '#fff', fontSize: '.66rem', fontWeight: 700 }} title="Solicitud de servicio (no es OC)">🔧 SERVICIO</span>
                    : (r.orden.oc_codigo ?? '—')}
                  {(noLeidos.get(r.orden.id) ?? 0) > 0 && (
                    <span className="badge" style={{ marginLeft: '.35rem', background: 'var(--brand, #ff8a00)', color: '#fff', fontSize: '.66rem' }}
                      title="Mensajes sin leer en el chat de la OC">💬 {noLeidos.get(r.orden.id)}</span>
                  )}
                </td>
                <td className="mono">{r.orden.codigo}</td>
                <td>{r.proveedorNombre}</td>
                <td style={{ fontSize: '.78rem' }}>
                  {labelCondicionPago(r.orden.condiciones_pago)}
                  {r.esperandoMetodo && <div><span className="badge warning" style={{ fontSize: '.66rem', marginTop: '.2rem' }}>⏳ Esperando método de pago</span></div>}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {monto(r.montoAPagar, r.orden.moneda ?? 'USD')}
                  {r.esContraEntrega && r.montoAPagar < Number(r.orden.total) && (
                    <div className="muted" style={{ fontSize: '.68rem' }}>de {monto(r.orden.total, r.orden.moneda ?? 'USD')}</div>
                  )}
                </td>
                <td className="muted">{r.orden.oc_creada_en ? fmtDate(r.orden.oc_creada_en) : '—'}</td>
                <td className="muted">{r.orden.oc_aprobada_en ? fmtDate(r.orden.oc_aprobada_en) : '—'}</td>
                <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); setSel(r); }}>{r.esperandoMetodo ? 'Ver' : 'Ver / Pagar'}</button></td>
              </tr>
              );
            })}
            {/* Compras / servicios directos POR PAGAR: el analista los montó con factura.
                Van en esta MISMA lista con una etiqueta DIRECTO; no entran al pago en lote. */}
            {!loading && directos.map((f) => (
              <tr key={`dir-${f.kind}-${f.id}`}>
                <td></td>
                <td className="mono">
                  {f.codigo}
                  <span className="badge" style={{ marginLeft: '.35rem', background: '#0ea5a4', color: '#fff', fontSize: '.66rem', fontWeight: 700 }}
                    title={f.kind === 'compra' ? 'Compra directa' : 'Servicio directo'}>
                    {f.kind === 'compra' ? '🛒' : '🔧'} DIRECTO
                  </span>
                </td>
                <td>{f.titulo}{f.detalle ? <span className="muted"> · {f.detalle}</span> : null}</td>
                <td className="muted" style={{ fontSize: '.78rem' }}>{f.generoPor}</td>
                <td style={{ fontSize: '.78rem' }}>{f.categoria || '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{monto(f.total, f.moneda)}</td>
                <td className="muted">—</td>
                <td className="muted">—</td>
                <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-primary" onClick={() => setPagarDir(f)}>Ver / Pagar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sel && (
        <PagarOrdenModal
          row={sel} cajas={cajas} actor={actor} actorName={actorName} userId={userId}
          onClose={() => setSel(null)}
          onPaid={async () => { setSel(null); await reload(); onPaid(); }}
        />
      )}

      {lote && (
        <PagarLoteModal
          rows={seleccionadas} cajas={cajas} actor={actor} actorName={actorName}
          onClose={() => setLote(false)}
          onPaid={async () => { setLote(false); setMarcadas(new Set()); await reload(); onPaid(); }}
        />
      )}

      {pagarDir && (
        <PagarDirectoModal
          fila={pagarDir} cajas={cajas} actor={actor} actorName={actorName}
          onClose={() => setPagarDir(null)}
          onPaid={() => { setPagarDir(null); onPaid(); }}
        />
      )}
    </Modal>
  );
}

/* ───────────── Pago en LOTE de varias OC del mismo proveedor ───────────── */
function PagarLoteModal({ rows, cajas, actor, actorName, onClose, onPaid }: {
  rows: OrdenPorPagar[]; cajas: Caja[]; actor: string; actorName: string | null; onClose: () => void; onPaid: () => void;
}) {
  const proveedor = rows[0]?.proveedorNombre ?? '';
  const [cajaId, setCajaId] = useState(cajas[0]?.id ?? '');
  const [saldos, setSaldos] = useState<CajaSaldo[]>([]);
  const [cuentaSel, setCuentaSel] = useState<string>(''); // id de la fila de caja_saldos (billetera)
  const [tasa, setTasa] = useState(0);
  const [mercado, setMercado] = useState<TasasMercado | null>(null);
  const [factura, setFactura] = useState<File | null>(null);
  // Anclaje opcional a un gasto (una categoría → subcategoría para todo el lote).
  const [catRows, setCatRows] = useState<CategoriaGasto[]>([]);
  const [gCatId, setGCatId] = useState('');
  const [gSubId, setGSubId] = useState('');
  const [saving, setSaving] = useState(false);
  const [progreso, setProgreso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Detalle expandible por OC (click en la fila del lote).
  const [abierta, setAbierta] = useState<Set<string>>(new Set());
  const toggleDetalle = (id: string) => setAbierta((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // Finalidad de la OC: encabezado o, si está vacío, la unión de finalidades por ítem.
  const finalidadDe = (o: OrdenPorPagar['orden']): string => {
    const cab = (o.finalidad ?? '').trim();
    if (cab) return cab;
    const porItem = Array.from(new Set((o.items ?? []).map((it) => (it.finalidad ?? '').trim()).filter(Boolean)));
    return porItem.length ? porItem.join(' · ') : '—';
  };

  useEffect(() => {
    if (!cajaId) { setSaldos([]); return; }
    saldosDeCaja(cajaId).then((r) => { const f = r.filter((x) => Number(x.saldo) > 0); setSaldos(f); setCuentaSel(f[0]?.id ?? ''); }).catch(() => setSaldos([]));
  }, [cajaId]);
  useEffect(() => { getTasaHoy().then((t) => { if (t.usd != null) setTasa(t.usd); }).catch(() => { /* sin tasa */ }); }, []);
  useEffect(() => { getTasasMercado().then(setMercado).catch(() => setMercado(null)); }, []);
  useEffect(() => { listCategoriasGasto(true).then(setCatRows).catch(() => setCatRows([])); }, []);
  useEffect(() => { setGSubId(''); }, [gCatId]);
  const gCategorias = soloCategorias(catRows);
  const gSubcats = gCatId ? subcategoriasDe(catRows, gCatId) : [];
  const gCatNombre = gCategorias.find((c) => c.id === gCatId)?.nombre ?? null;
  const gSubNombre = gSubcats.find((s) => s.id === gSubId)?.nombre ?? null;

  const wallet = saldos.find((s) => s.id === cuentaSel) ?? null;
  const monedaW = wallet?.moneda ?? 'USD';
  const usdToWallet = useCallback((usd: number): number => {
    if (!usd || usd <= 0) return 0;
    if (monedaW === 'USD' || monedaW === 'USDT') return round2(usd);
    if (monedaW === 'Bs') return tasa > 0 ? round2(usd * tasa) : 0;
    if (monedaW === 'COP') return mercado?.copUsd ? round2(usd * mercado.copUsd) : 0;
    return round2(usd);
  }, [monedaW, tasa, mercado]);

  const totalUsd = round2(rows.reduce((a, r) => a + (Number(r.montoAPagar) || 0), 0));
  const totalWallet = round2(rows.reduce((a, r) => a + usdToWallet(Number(r.montoAPagar) || 0), 0));
  const saldoW = Number(wallet?.saldo) || 0;
  const fondos = totalWallet <= saldoW + 0.01;
  const faltaTasa = monedaW === 'Bs' && !(tasa > 0);
  // Solo se exige comprobante si alguna OC tiene método indicado que lo requiera.
  // Las que están "esperando método" (sin método) se pagan directo, sin comprobante.
  const requiereComprobante = rows.some((r) => (r.orden.metodo_pago?.length ?? 0) > 0 && !pagoSinComprobante(r.orden.metodo_pago));
  const cuentaLabel = (c: string) => c === 'general' ? 'General' : c === 'juridica' ? 'Jurídica' : c === 'personal' ? 'Personal' : c;

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!cajaId || !wallet) { setError('Elegí la caja y la billetera.'); return; }
    if (faltaTasa) { setError('No hay tasa BCV para convertir a Bs.'); return; }
    if (!fondos) { setError(`Saldo insuficiente en ${monedaW}${wallet.cuenta !== 'general' ? ` (${cuentaLabel(wallet.cuenta)})` : ''}. Necesitás ${monto(totalWallet, monedaW)} y hay ${monto(saldoW, monedaW)}.`); return; }
    if (requiereComprobante && !factura) { setError('Adjuntá el comprobante (se aplica a todas las OC del lote).'); return; }
    setSaving(true);
    let ok = 0;
    try {
      for (const r of rows) {
        const o = r.orden;
        const montoW = usdToWallet(Number(r.montoAPagar) || 0);
        setProgreso(`Pagando ${o.oc_codigo ?? o.codigo} (${monto(montoW, monedaW)})…`);
        await pagarOrdenCompraMulti({
          orden: o, cajaId,
          legs: [{ cuenta: wallet.cuenta as CuentaCaja, moneda: monedaW, monto: montoW, montoUsd: Number(r.montoAPagar) || 0 }],
          factura: requiereComprobante ? factura : null,
          motivoPago: `Pago en lote · ${rows.length} OC a ${proveedor}`,
          gastoCategoria: gCatNombre, gastoSubcategoria: gSubNombre,
          actorEmail: actor, actorName,
        });
        ok += 1;
      }
      notify(`${ok} OC pagadas a ${proveedor} · ${monto(totalWallet, monedaW)}`, 'success', { link: '#/app/tesoreria' });
      onPaid();
    } catch (err) {
      setError(`${err instanceof Error ? err.message : 'Error al pagar'} · se pagaron ${ok} de ${rows.length}.`);
      setSaving(false);
      if (ok > 0) onPaid();
    }
  }

  return (
    <Modal title={`Pagar ${rows.length} OC · ${proveedor}`} size="lg" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" form="pagar-lote" className="btn btn-primary" disabled={saving || !fondos || faltaTasa}>
          {saving ? (progreso ?? 'Pagando…') : !fondos ? 'Saldo insuficiente' : `PAGAR ${rows.length} · ${monto(totalWallet, monedaW)}`}
        </button>
      </>
    }>
      <form id="pagar-lote" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        <div className="card" style={{ marginBottom: '.75rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}>OC del lote · {proveedor}</div>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.8rem' }}>
              <thead><tr><th style={{ width: 24 }}></th><th>N°ODC</th><th>SP</th><th style={{ textAlign: 'right' }}>A pagar $</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const o = r.orden;
                  const open = abierta.has(o.id);
                  return (
                    <Fragment key={o.id}>
                      <tr onClick={() => toggleDetalle(o.id)} style={{ cursor: 'pointer' }} title="Ver detalle de la OC">
                        <td className="mono" style={{ color: 'var(--brand, #ff8a00)', fontWeight: 700, textAlign: 'center' }}>{open ? '▾' : '▸'}</td>
                        <td className="mono">{o.oc_codigo ?? '—'}</td>
                        <td className="mono">{o.codigo}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{monto(r.montoAPagar, 'USD')}</td>
                      </tr>
                      {open && (
                        <tr>
                          <td></td>
                          <td colSpan={3} style={{ background: 'var(--bg-1, rgba(0,0,0,.02))', padding: '.5rem .65rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '.25rem .9rem', fontSize: '.78rem', marginBottom: '.5rem' }}>
                              <div><span className="muted">Proveedor:</span> {r.proveedorNombre}</div>
                              <div><span className="muted">Unidad solicitante:</span> {o.solicitante || '—'}</div>
                              <div><span className="muted">Solicitante:</span> {o.ci_solicitante || o.solicitante_email || '—'}</div>
                              <div style={{ gridColumn: '1 / -1' }}><span className="muted">Finalidad:</span> {finalidadDe(o)}</div>
                              {o.notas && <div style={{ gridColumn: '1 / -1' }}><span className="muted">Notas:</span> {o.notas}</div>}
                            </div>
                            <table className="table" style={{ fontSize: '.76rem' }}>
                              <thead><tr><th>SKU</th><th>Producto</th><th style={{ textAlign: 'right' }}>Cant.</th><th style={{ textAlign: 'right' }}>Precio</th><th style={{ textAlign: 'right' }}>Subtotal</th></tr></thead>
                              <tbody>
                                {(o.items ?? []).map((it, i) => (
                                  <tr key={`${it.sku}-${i}`}>
                                    <td className="mono">{it.sku}</td><td>{it.nombre}</td>
                                    <td className="mono" style={{ textAlign: 'right' }}>{it.cantidad}</td>
                                    <td className="mono" style={{ textAlign: 'right' }}>{monto(it.precio, o.moneda ?? 'USD')}</td>
                                    <td className="mono" style={{ textAlign: 'right' }}>{monto(it.cantidad * it.precio, o.moneda ?? 'USD')}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot><tr><td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>Total OC</td><td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{monto(o.total, o.moneda ?? 'USD')}</td></tr></tfoot>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot><tr><td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>Total</td><td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{monto(totalUsd, 'USD')}</td></tr></tfoot>
            </table>
          </div>
          <small className="muted">Tocá una OC para ver su detalle. Se genera <strong>un egreso por cada OC</strong> (cada una queda casada con su pago en el Libro Mayor).</small>
        </div>

        <div className="form-row">
          <label>Caja</label>
          <select className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)} required style={{ maxWidth: 320 }}>
            {!cajas.length && <option value="">— sin cajas —</option>}
            {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label>Billetera (de dónde sale el dinero)</label>
          <select className="select" value={cuentaSel} onChange={(e) => setCuentaSel(e.target.value)} required style={{ maxWidth: 360 }}>
            {!saldos.length && <option value="">— sin saldo —</option>}
            {saldos.map((s) => <option key={s.id} value={s.id}>{cuentaLabel(s.cuenta)} · {monto(Number(s.saldo), s.moneda)}</option>)}
          </select>
          {wallet && (
            <small className="muted">
              Total a pagar: <strong className="mono">{monto(totalWallet, monedaW)}</strong>
              {monedaW !== 'USD' && monedaW !== 'USDT' && <> (= {monto(totalUsd, 'USD')}{tasa > 0 && monedaW === 'Bs' ? ` · BCV ${tasa}` : ''})</>}
              {' · '}saldo {monto(saldoW, monedaW)}
              {!fondos && <span style={{ color: 'var(--danger)' }}> · insuficiente</span>}
            </small>
          )}
        </div>

        {requiereComprobante && (
          <div className="form-row">
            <label>Comprobante (se aplica a todas las OC del lote)</label>
            <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setFactura(e.target.files?.[0] ?? null)} />
          </div>
        )}

        {/* Anclaje opcional a un gasto: una categoría → subcategoría para todo el lote. */}
        <div className="card" style={{ marginTop: '.25rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}>Anclar a un gasto <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></div>
          <div className="form-grid">
            <div className="form-row">
              <label>Categoría de gasto</label>
              <SearchSelect value={gCatId} onChange={setGCatId}
                options={gCategorias.map((c) => ({ value: c.id, label: c.nombre }))}
                placeholder="Buscar categoría…" emptyText="Sin categorías." />
            </div>
            <div className="form-row">
              <label>Subcategoría</label>
              <SearchSelect value={gSubId} onChange={setGSubId}
                options={gSubcats.map((s) => ({ value: s.id, label: s.nombre }))}
                placeholder={gCatId ? 'Buscar subcategoría…' : 'Elegí primero la categoría'}
                emptyText={gCatId ? 'Sin subcategorías.' : 'Elegí primero la categoría.'} />
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ───────────── Cuentas por pagar (créditos) · abonos multipago ───────────── */
function CuentasCreditoModal({ cajas, actor, actorName, onClose, onChanged }: {
  cajas: Caja[]; actor: string; actorName: string | null; onClose: () => void; onChanged: () => void | Promise<void>;
}) {
  const [vista, setVista] = useState<'oc' | 'manual'>('oc');
  const [ordenes, setOrdenes] = useState<OrdenPorPagar[]>([]);
  const [selId, setSelId] = useState<string>('');
  const [abonos, setAbonos] = useState<AbonoCredito[]>([]);
  const [cajaId, setCajaId] = useState(cajas[0]?.id ?? '');
  const [saldosCaja, setSaldosCaja] = useState<CajaSaldo[]>([]);
  const [legMontos, setLegMontos] = useState<Record<string, string>>({});
  const [nota, setNota] = useState('');
  // Comisión bancaria: egreso EXTRA de la caja (no reduce la deuda). Se descuenta de un saldo concreto.
  const [comisionMonto, setComisionMonto] = useState('');
  const [comisionSaldoId, setComisionSaldoId] = useState('');
  const [factura, setFactura] = useState<File | null>(null);
  const [tasa, setTasa] = useState(0);
  const [mercado, setMercado] = useState<TasasMercado | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Datos del proveedor de la OC (identidad + datos de pago) para saber dónde/cómo pagarle.
  const [provData, setProvData] = useState<{ proveedor: Proveedor | null; datosPago: Record<string, DatosPago> }>({ proveedor: null, datosPago: {} });
  const [editPago, setEditPago] = useState(false);
  const [metodoEdit, setMetodoEdit] = useState<string>('pago_movil');
  const [datosEdit, setDatosEdit] = useState<DatosPago>({});
  const [savingPago, setSavingPago] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const all = await listOrdenesEnCredito();
      // Solo las que aún tienen saldo por pagar (las saldadas se gestionan en Compras).
      const os = all.filter((x) => (Number(x.orden.total) - (Number(x.orden.abonado_total) || 0)) > 0.01);
      setOrdenes(os);
      setSelId((p) => (p && os.some((x) => x.orden.id === p)) ? p : (os[0]?.orden.id ?? ''));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => {
    getTasaHoy().then((t) => { if (t.usd != null) setTasa(t.usd); }).catch(() => { /* manual */ });
    getTasasMercado().then(setMercado).catch(() => setMercado(null));
  }, []);
  useEffect(() => {
    if (!cajaId) { setSaldosCaja([]); return; }
    saldosDeCaja(cajaId).then((rows) => setSaldosCaja(rows.filter((r) => Number(r.saldo) > 0))).catch(() => setSaldosCaja([]));
    setLegMontos({});
    setComisionMonto(''); setComisionSaldoId('');
  }, [cajaId]);
  useEffect(() => {
    if (!selId) { setAbonos([]); return; }
    listAbonos(selId).then(setAbonos).catch(() => setAbonos([]));
  }, [selId]);
  // Trae los datos del proveedor de la OC seleccionada (se sincroniza al cambiar de cuenta).
  const provId = ordenes.find((x) => x.orden.id === selId)?.orden.proveedor_id ?? '';
  useEffect(() => {
    setEditPago(false);
    if (!provId) { setProvData({ proveedor: null, datosPago: {} }); return; }
    let cancel = false;
    getProveedorConDatosPago(provId)
      .then((r) => { if (!cancel) setProvData(r); })
      .catch(() => { if (!cancel) setProvData({ proveedor: null, datosPago: {} }); });
    return () => { cancel = true; };
  }, [provId]);

  async function guardarDatosProv() {
    if (!provId) return;
    const err = validarDatosPago(metodoEdit, datosEdit);
    if (err) { setError(err); return; }
    setSavingPago(true); setError(null);
    try {
      await guardarDatosPagoProveedor(provId, metodoEdit, datosEdit, actor);
      const r = await getProveedorConDatosPago(provId);
      setProvData(r);
      setEditPago(false); setDatosEdit({});
      toast('Datos de pago guardados en el proveedor', 'success');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron guardar los datos de pago'); }
    finally { setSavingPago(false); }
  }

  const sel = ordenes.find((x) => x.orden.id === selId) ?? null;
  const o = sel?.orden ?? null;
  const total = Number(o?.total) || 0;
  const abonado = o ? (Number(o.abonado_total) || abonos.reduce((a, b) => a + Number(b.monto), 0)) : 0;
  const saldo = Math.round((total - abonado) * 100) / 100;

  function legUsd(m: string, n: number): number {
    if (!n || n <= 0) return 0;
    if (m === 'USD' || m === 'USDT') return round2(n);
    if (m === 'Bs') return tasa > 0 ? round2(n / tasa) : 0;
    if (m === 'COP') return mercado?.copUsd ? round2(n / mercado.copUsd) : 0;
    return round2(n);
  }
  const sumUsd = round2(saldosCaja.reduce((a, s) => a + legUsd(s.moneda, Number(legMontos[s.id]) || 0), 0));

  async function handleAbonar() {
    setError(null);
    if (!o) return;
    const legs: AbonoLeg[] = saldosCaja
      .map((s) => ({ cajaId, cuenta: s.cuenta as CuentaCaja, moneda: s.moneda, monto: Number(legMontos[s.id]) || 0, montoUsd: legUsd(s.moneda, Number(legMontos[s.id]) || 0) }))
      .filter((l) => l.monto > 0);
    if (!legs.length) { setError('Indicá cuánto abonar en al menos una moneda.'); return; }
    if (sumUsd > saldo + 0.01) { setError(`El abono (${monto(sumUsd, 'USD')}) supera el saldo pendiente (${monto(saldo, 'USD')}).`); return; }
    // Comisión bancaria (opcional): egreso extra de un saldo concreto de la caja.
    const comMontoNum = Number(comisionMonto) || 0;
    let comision: { cajaId: string; cuenta: CuentaCaja; moneda: string; monto: number } | null = null;
    if (comMontoNum > 0) {
      const sc = saldosCaja.find((s) => s.id === comisionSaldoId) ?? saldosCaja[0];
      if (!sc) { setError('No hay un saldo para descontar la comisión bancaria.'); return; }
      comision = { cajaId, cuenta: sc.cuenta as CuentaCaja, moneda: sc.moneda, monto: comMontoNum };
    }
    setSaving(true);
    try {
      const r = await registrarAbonoMulti({ orden: o, legs, nota: nota.trim() || null, factura, comision, actorEmail: actor, actorName });
      const saldadoNow = r.orden.estado !== 'cuenta_abierta';
      notify(saldadoNow
        ? `Crédito saldado · ${o.oc_codigo ?? o.codigo} · pasa a recepción/finalización`
        : `Abono ${monto(sumUsd, 'USD')} · ${o.oc_codigo ?? o.codigo}`, 'success');
      setLegMontos({}); setNota(''); setFactura(null); setComisionMonto(''); setComisionSaldoId('');
      await onChanged();
      await cargar();
      if (!saldadoNow) await listAbonos(o.id).then(setAbonos);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo registrar el abono'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title="Cuentas por pagar (créditos)" size="xl" onClose={() => !saving && onClose()}
      footer={<button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cerrar</button>}>
      <div className="view-toggle" role="tablist" style={{ marginBottom: '.8rem' }}>
        <button className={vista === 'oc' ? 'active' : ''} onClick={() => setVista('oc')}>🧾 Compras a crédito</button>
        <button className={vista === 'manual' ? 'active' : ''} onClick={() => setVista('manual')}>👥 Cliente / Proveedor</button>
      </div>

      {vista === 'manual' && <CuentasPorPagarManualPanel cajas={cajas} actor={actor} actorName={actorName} onChanged={onChanged} />}

      {vista === 'oc' && (<>
      <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.6rem' }}>
        <button className="btn btn-sm btn-ghost" disabled={!ordenes.length}
          onClick={() => import('./cuentasCreditoPdf').then(({ descargarResumenCreditosPdf }) => descargarResumenCreditosPdf(ordenes)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'))}>
          ↓ Resumen PDF
        </button>
      </div>
      {loading && <p className="hint muted">Cargando…</p>}
      {!loading && !ordenes.length && <p className="hint muted" style={{ textAlign: 'center' }}>No hay compras a crédito con cuenta abierta. 🎉</p>}
      {!loading && ordenes.length > 0 && (
        <>
          <div className="form-row" style={{ marginBottom: '.6rem' }}>
            <label>Cuenta a crédito ({ordenes.length})</label>
            <select className="select" value={selId} onChange={(e) => setSelId(e.target.value)}>
              {ordenes.map((x) => (
                <option key={x.orden.id} value={x.orden.id}>
                  {x.orden.oc_codigo ?? x.orden.codigo} · {x.proveedorNombre} · saldo {monto(round2(Number(x.orden.total) - (Number(x.orden.abonado_total) || 0)), x.orden.moneda ?? 'USD')}
                </option>
              ))}
            </select>
          </div>

          {o && (
            <>
              <div className="m-tiles" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '.6rem', marginBottom: '.75rem' }}>
                <div className="card" style={{ margin: 0, padding: '.6rem .85rem' }}>
                  <div className="muted" style={{ fontSize: '.7rem' }}>TOTAL</div>
                  <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{monto(total, 'USD')}</div>
                </div>
                <div className="card" style={{ margin: 0, padding: '.6rem .85rem' }}>
                  <div className="muted" style={{ fontSize: '.7rem' }}>ABONADO</div>
                  <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary-3)' }}>{monto(abonado, 'USD')}</div>
                </div>
                <div className="card" style={{ margin: 0, padding: '.6rem .85rem' }}>
                  <div className="muted" style={{ fontSize: '.7rem' }}>SALDO</div>
                  <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: saldo > 0 ? 'var(--warning)' : 'var(--success)' }}>{monto(saldo, 'USD')}</div>
                </div>
              </div>
              {o.recibida_en && <div className="badge warning" style={{ marginBottom: '.6rem' }}>📦 Mercancía ya recibida · crédito pendiente</div>}

              {/* Datos del proveedor: identidad + datos de pago (dónde/cómo pagarle). */}
              <div className="card" style={{ marginBottom: '.75rem' }}>
                <div className="card-title" style={{ marginBottom: '.4rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>🏭 Datos del proveedor</span>
                  {provId && !editPago && (
                    <button className="btn btn-sm btn-ghost" onClick={() => { setEditPago(true); setDatosEdit(provData.datosPago[metodoEdit] ?? {}); }}>✎ Cargar / editar datos de pago</button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.3rem .9rem', fontSize: '.84rem' }}>
                  <div><span className="muted">Proveedor:</span> <strong>{provData.proveedor?.razon_social ?? sel?.proveedorNombre ?? '—'}</strong></div>
                  {provData.proveedor?.rif && <div><span className="muted">RIF:</span> {provData.proveedor.rif}</div>}
                  {provData.proveedor?.contacto && <div><span className="muted">Contacto:</span> {provData.proveedor.contacto}</div>}
                  {provData.proveedor?.telefono && <div><span className="muted">Teléfono:</span> {provData.proveedor.telefono}</div>}
                  {provData.proveedor?.email && <div><span className="muted">Email:</span> {provData.proveedor.email}</div>}
                  {provData.proveedor?.direccion && <div style={{ gridColumn: '1 / -1' }}><span className="muted">Dirección:</span> {provData.proveedor.direccion}</div>}
                </div>
                {/* Datos de pago guardados por método */}
                {Object.keys(provData.datosPago).length > 0 ? (
                  <div style={{ marginTop: '.5rem', display: 'grid', gap: '.25rem' }}>
                    {Object.entries(provData.datosPago).map(([m, d]) => (
                      <div key={m} style={{ fontSize: '.82rem' }}>
                        <span className="badge">{labelMetodoPago(m)}</span> <span className="muted">{resumenDatosPago(m, d)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  !editPago && <div className="muted" style={{ marginTop: '.5rem', fontSize: '.8rem' }}>Sin datos de pago guardados para este proveedor. Cargalos para que queden en su ficha y se reutilicen.</div>
                )}
                {/* Editor: guarda los datos en la ficha del proveedor (proveedor_datos_pago). */}
                {editPago && (
                  <div className="card" style={{ marginTop: '.6rem', padding: '.6rem .75rem', background: 'var(--bg-2, rgba(255,255,255,.02))' }}>
                    <div className="form-row" style={{ marginBottom: '.4rem' }}>
                      <label>Método de pago</label>
                      <select className="select" value={metodoEdit} onChange={(e) => { setMetodoEdit(e.target.value); setDatosEdit(provData.datosPago[e.target.value] ?? {}); }}>
                        {METODOS_CON_DATOS.map((m) => <option key={m} value={m}>{labelMetodoPago(m)}</option>)}
                      </select>
                    </div>
                    <DatosPagoFields metodo={metodoEdit} value={datosEdit} onChange={setDatosEdit} />
                    <div style={{ display: 'flex', gap: '.4rem', justifyContent: 'flex-end', marginTop: '.5rem' }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => { setEditPago(false); setDatosEdit({}); }} disabled={savingPago}>Cancelar</button>
                      <button className="btn btn-sm btn-primary" onClick={() => void guardarDatosProv()} disabled={savingPago}>{savingPago ? 'Guardando…' : 'Guardar en el proveedor'}</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Conversión del saldo a Bs con tasa personalizable (por defecto BCV). */}
              <div className="card" style={{ marginBottom: '.75rem', borderColor: 'var(--brand, #ff8a00)' }}>
                <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div>
                    <div className="muted" style={{ fontSize: '.72rem' }}>Saldo en USD</div>
                    <strong className="mono" style={{ fontSize: '1.1rem' }}>{monto(saldo, 'USD')}</strong>
                  </div>
                  <div style={{ fontSize: '1.1rem' }} className="muted">⇄</div>
                  <div>
                    <div className="muted" style={{ fontSize: '.72rem' }}>Equivale en Bs</div>
                    <strong className="mono" style={{ fontSize: '1.1rem' }}>{tasa > 0 ? monto(aBs(saldo, tasa), 'Bs') : '—'}</strong>
                  </div>
                  <div className="form-row" style={{ marginLeft: 'auto', minWidth: 160 }}>
                    <label style={{ fontSize: '.72rem' }}>Tasa (Bs por $) · editable, por defecto BCV</label>
                    <input className="input mono" type="number" min={0} step="any" value={tasa || ''}
                      onChange={(e) => setTasa(Number(e.target.value) || 0)} placeholder="0,00" />
                  </div>
                </div>
              </div>

              {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

              <div className="card" style={{ padding: '.75rem', marginBottom: '.75rem' }}>
                <div className="card-title" style={{ marginBottom: '.5rem' }}>Registrar abono (multipago)</div>
                <div className="form-row" style={{ marginBottom: '.5rem' }}>
                  <label>Caja (de dónde sale el dinero)</label>
                  <select className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
                    {!cajas.length && <option value="">— sin cajas —</option>}
                    {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
                <div className="table-wrap">
                  <table className="table" style={{ fontSize: '.84rem' }}>
                    <thead><tr><th>Moneda</th><th style={{ textAlign: 'right' }}>Disponible</th><th style={{ textAlign: 'right' }}>A abonar (en su moneda)</th><th style={{ textAlign: 'right' }}>Equiv. USD</th></tr></thead>
                    <tbody>
                      {!saldosCaja.length && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>Esta caja no tiene saldos.</td></tr>}
                      {saldosCaja.map((s) => {
                        const n = Number(legMontos[s.id]) || 0;
                        const excede = n > Number(s.saldo);
                        const etq = s.cuenta === 'general' ? '' : s.cuenta === 'juridica' ? ' · Jurídica' : ' · Personal';
                        return (
                          <tr key={s.id}>
                            <td><span className="badge">{s.moneda}</span>{etq}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{monto(Number(s.saldo), s.moneda)}</td>
                            <td style={{ textAlign: 'right' }}>
                              <input className="input mono" type="number" min={0} max={Number(s.saldo)} step="any"
                                value={legMontos[s.id] ?? ''} placeholder="0,00"
                                onChange={(e) => setLegMontos((m) => ({ ...m, [s.id]: dosDecimales(e.target.value) }))}
                                style={{ width: 130, textAlign: 'right', borderColor: excede ? 'var(--danger)' : undefined }} />
                            </td>
                            <td className="mono" style={{ textAlign: 'right' }}>{n > 0 ? monto(legUsd(s.moneda, n), 'USD') : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr><td colSpan={3} style={{ textAlign: 'right', fontWeight: 600 }}>Abono (USD)</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: sumUsd > saldo + 0.01 ? 'var(--danger)' : 'var(--success)' }}>{monto(sumUsd, 'USD')}</td></tr>
                    </tfoot>
                  </table>
                </div>
                <div className="form-grid" style={{ marginTop: '.5rem' }}>
                  <div className="form-row">
                    <label>Comprobante (PDF o imagen) (opcional)</label>
                    <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setFactura(e.target.files?.[0] ?? null)} />
                    {factura && <small className="muted">{factura.name}</small>}
                  </div>
                  <div className="form-row">
                    <label>Nota (opcional)</label>
                    <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Referencia del abono…" />
                  </div>
                </div>
                {/* Comisión bancaria: egreso EXTRA de la caja (no reduce la deuda de la OC). */}
                <div className="form-grid" style={{ marginTop: '.25rem' }}>
                  <div className="form-row">
                    <label>Comisión bancaria (opcional)</label>
                    <input className="input mono" type="number" min={0} step="any" value={comisionMonto}
                      onChange={(e) => setComisionMonto(dosDecimales(e.target.value))} placeholder="0,00" />
                    <small className="muted">Se descuenta de la caja como gasto extra; NO abona la deuda.</small>
                  </div>
                  {(Number(comisionMonto) || 0) > 0 && (
                    <div className="form-row">
                      <label>Descontar comisión de</label>
                      <select className="select" value={comisionSaldoId || saldosCaja[0]?.id || ''} onChange={(e) => setComisionSaldoId(e.target.value)}>
                        {!saldosCaja.length && <option value="">— sin saldos —</option>}
                        {saldosCaja.map((s) => {
                          const etq = s.cuenta === 'general' ? '' : s.cuenta === 'juridica' ? ' · Jurídica' : ' · Personal';
                          return <option key={s.id} value={s.id}>{s.moneda}{etq} · disp. {monto(Number(s.saldo), s.moneda)}</option>;
                        })}
                      </select>
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', marginTop: '.5rem' }}>
                  <button className="btn btn-success" disabled={saving || sumUsd <= 0} onClick={() => void handleAbonar()}>{saving ? 'Registrando…' : `💵 Registrar abono · ${monto(sumUsd, 'USD')}`}</button>
                </div>
              </div>

              <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
                <table className="table" style={{ fontSize: '.82rem' }}>
                  <thead><tr><th>Fecha</th><th style={{ textAlign: 'right' }}>Abono (USD)</th><th style={{ textAlign: 'right' }}>Comisión bancaria</th><th>Nota</th></tr></thead>
                  <tbody>
                    {!abonos.length && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>Sin abonos todavía.</td></tr>}
                    {abonos.map((ab) => (
                      <tr key={ab.id}>
                        <td>{dateTime(ab.at)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{monto(Number(ab.monto), 'USD')}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{Number(ab.comision_monto) > 0 ? monto(Number(ab.comision_monto), ab.comision_moneda || 'Bs') : '—'}</td>
                        <td className="muted">{ab.nota || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
      <ComprasDirectasCreditoPanel cajas={cajas} actor={actor} actorName={actorName} onChanged={onChanged} />
      </>)}
    </Modal>
  );
}

/* ───────── Compras directas a crédito (respaldadas por una cuenta por pagar) ─────────
   Una compra directa puesta a crédito genera una cuenta por pagar (Tesorería). Este
   panel la muestra dentro de "Compras a crédito" y permite saldarla con abonos
   (egreso real de caja), reutilizando el mismo motor que las cuentas por pagar. */
function ComprasDirectasCreditoPanel({ cajas, actor, actorName, onChanged }: {
  cajas: Caja[]; actor: string; actorName: string | null; onChanged: () => void | Promise<void>;
}) {
  const [lista, setLista] = useState<Array<CuentaPorPagar & { _codigo: string | null }>>([]);
  const [selId, setSelId] = useState('');
  const [abonos, setAbonos] = useState<AbonoCxP[]>([]);
  const [cajaId, setCajaId] = useState(cajas[0]?.id ?? '');
  const [cuentaCaja, setCuentaCaja] = useState<string>('');
  const [montoStr, setMontoStr] = useState('');
  const [nota, setNota] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cajaSaldosSel, setCajaSaldosSel] = useState<CajaSaldo[]>([]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [creds, cuentas] = await Promise.all([listComprasDirectasCredito(), listCuentasPorPagar(true)]);
      const codigoPorCxp = new Map(creds.map((c) => [c.cxpId, c.codigo]));
      const rows = cuentas
        .filter((c) => codigoPorCxp.has(c.id))
        .map((c) => ({ ...c, _codigo: codigoPorCxp.get(c.id) ?? null }));
      setLista(rows);
      setSelId((p) => (p && rows.some((r) => r.id === p)) ? p : (rows[0]?.id ?? ''));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => {
    if (!selId) { setAbonos([]); return; }
    listAbonosCuenta(selId).then(setAbonos).catch(() => setAbonos([]));
  }, [selId]);

  const sel = lista.find((c) => c.id === selId) ?? null;
  useEffect(() => {
    if (!cajaId || !sel) { setCuentaCaja(''); setCajaSaldosSel([]); return; }
    saldosDeCaja(cajaId)
      .then((rows) => {
        setCajaSaldosSel(rows);
        const mismos = rows.filter((r) => r.moneda === sel.moneda && Number(r.saldo) > 0);
        setCuentaCaja((prev) => (prev && mismos.some((r) => r.cuenta === prev)) ? prev : (mismos[0]?.cuenta ?? ''));
      })
      .catch(() => { setCajaSaldosSel([]); setCuentaCaja(''); });
  }, [cajaId, sel]);
  const cuentasMoneda = sel ? cajaSaldosSel.filter((r) => r.moneda === sel.moneda && Number(r.saldo) > 0) : [];
  const saldo = sel ? round2(Number(sel.monto) - (Number(sel.abonado) || 0)) : 0;

  async function abonar() {
    setError(null);
    if (!sel) return;
    const m = Number(montoStr) || 0;
    if (m <= 0) { setError('Indicá el monto a abonar.'); return; }
    if (!cajaId) { setError('Elegí la caja del egreso.'); return; }
    if (!cuentaCaja) { setError(`La caja no tiene saldo en ${sel.moneda}.`); return; }
    setSaving(true);
    try {
      const r = await registrarAbonoCuenta({ cuenta: sel, cajaId, cuentaCaja: cuentaCaja as CuentaCaja, monto: m, nota: nota.trim() || null, actor, actorName });
      notify(r.cuenta.estado === 'saldada'
        ? `Crédito de compra directa saldado · ${sel.contraparte}`
        : `Abono ${monto(m, sel.moneda)} · ${sel._codigo ?? sel.contraparte}`, 'success', { link: '#/app/tesoreria' });
      setMontoStr(''); setNota('');
      await cargar(); await onChanged();
      if (r.cuenta.estado !== 'saldada') await listAbonosCuenta(sel.id).then(setAbonos);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo registrar el abono'); }
    finally { setSaving(false); }
  }

  if (loading) return <p className="hint muted">Cargando compras directas a crédito…</p>;
  if (!lista.length) return null; // sin compras directas a crédito: no ocupa espacio

  return (
    <div className="card" style={{ marginTop: '1rem', borderColor: 'var(--brand, #ff8a00)' }}>
      <div className="card-title"><span>🧾 Compras directas a crédito ({lista.length})</span></div>
      <p className="hint muted" style={{ marginTop: 0 }}>Compras directas puestas a crédito. Se saldan con abonos (egreso real de caja), igual que una cuenta por pagar.</p>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.5rem' }}><strong>Error:</strong> {error}</div>}
      <SelectorBuscable
        label="Compra directa a crédito"
        items={lista}
        value={selId}
        onChange={setSelId}
        optionLabel={(c) => `${c._codigo ?? 'CD'} · ${c.contraparte} · saldo ${monto(round2(Number(c.monto) - (Number(c.abonado) || 0)), c.moneda)}`}
      />
      {sel && (<>
        <div className="m-tiles" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '.6rem', margin: '.6rem 0' }}>
          <div className="card" style={{ margin: 0, padding: '.6rem .85rem' }}><div className="muted" style={{ fontSize: '.7rem' }}>TOTAL</div><div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{monto(Number(sel.monto), sel.moneda)}</div></div>
          <div className="card" style={{ margin: 0, padding: '.6rem .85rem' }}><div className="muted" style={{ fontSize: '.7rem' }}>ABONADO</div><div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary-3)' }}>{monto(Number(sel.abonado) || 0, sel.moneda)}</div></div>
          <div className="card" style={{ margin: 0, padding: '.6rem .85rem' }}><div className="muted" style={{ fontSize: '.7rem' }}>SALDO</div><div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: saldo > 0 ? 'var(--warning)' : 'var(--success)' }}>{monto(saldo, sel.moneda)}</div></div>
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Caja (de dónde sale el dinero)</label>
            <select className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
              {!cajas.length && <option value="">— sin cajas —</option>}
              {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label>Cuenta / saldo en {sel.moneda}</label>
            <select className="select" value={cuentaCaja} onChange={(e) => setCuentaCaja(e.target.value)}>
              {!cuentasMoneda.length && <option value="">— sin saldo en {sel.moneda} —</option>}
              {cuentasMoneda.map((r) => {
                const etq = r.cuenta === 'general' ? 'General' : r.cuenta === 'juridica' ? 'Jurídica' : 'Personal';
                return <option key={r.cuenta} value={r.cuenta}>{etq} · disp. {monto(Number(r.saldo), r.moneda)}</option>;
              })}
            </select>
          </div>
          <div className="form-row">
            <label>Monto a abonar ({sel.moneda})</label>
            <input className="input mono" type="number" min={0} step="any" value={montoStr} onChange={(e) => setMontoStr(dosDecimales(e.target.value))} placeholder="0,00" />
          </div>
          <div className="form-row">
            <label>Nota (opcional)</label>
            <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Referencia del abono…" />
          </div>
        </div>
        <div style={{ textAlign: 'right', marginTop: '.5rem' }}>
          <button className="btn btn-success" disabled={saving || (Number(montoStr) || 0) <= 0} onClick={() => void abonar()}>{saving ? 'Registrando…' : '💵 Registrar abono'}</button>
        </div>
        <div className="table-wrap" style={{ maxHeight: 180, overflowY: 'auto', marginTop: '.6rem' }}>
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead><tr><th>Fecha</th><th style={{ textAlign: 'right' }}>Abono</th><th>Nota</th></tr></thead>
            <tbody>
              {!abonos.length && <tr><td colSpan={3} className="muted" style={{ textAlign: 'center' }}>Sin abonos todavía.</td></tr>}
              {abonos.map((ab) => (<tr key={ab.id}><td>{dateTime(ab.at)}</td><td className="mono" style={{ textAlign: 'right' }}>{monto(Number(ab.monto), ab.moneda || sel.moneda)}</td><td className="muted">{ab.nota || '—'}</td></tr>))}
            </tbody>
          </table>
        </div>
      </>)}
    </div>
  );
}

/* ───────────── Panel: cuentas por pagar manuales (cliente/proveedor) ───────────── */
function CuentasPorPagarManualPanel({ cajas, actor, actorName, onChanged }: {
  cajas: Caja[]; actor: string; actorName: string | null; onChanged: () => void | Promise<void>;
}) {
  const [lista, setLista] = useState<CuentaPorPagar[]>([]);
  const [selId, setSelId] = useState<string>('');
  const [abonos, setAbonos] = useState<AbonoCxP[]>([]);
  const [ingresos, setIngresos] = useState<IngresoCxP[]>([]);
  const [cajaId, setCajaId] = useState(cajas[0]?.id ?? '');
  const [cuentaCaja, setCuentaCaja] = useState<string>('');
  const [montoStr, setMontoStr] = useState('');
  const [nota, setNota] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correoCuentaOpen, setCorreoCuentaOpen] = useState(false);
  // Form de NUEVA cuenta por pagar (cliente/proveedor que aún no existe).
  const [nvTipo, setNvTipo] = useState<'cliente' | 'proveedor'>('proveedor');
  const [nvNombre, setNvNombre] = useState('');
  const [nvMonto, setNvMonto] = useState('');
  const [nvMoneda, setNvMoneda] = useState('USD');
  const [creando, setCreando] = useState(false);
  // Directorio para autocompletar: contrapartes (Tesorería) + proveedores (Compras).
  const [contrapartes, setContrapartes] = useState<Contraparte[]>([]);
  const [provCatalogo, setProvCatalogo] = useState<string[]>([]);
  useEffect(() => {
    listContrapartes().then(setContrapartes).catch(() => setContrapartes([]));
    listProveedoresCatalogo().then((ps) => setProvCatalogo(ps.map((p) => p.razon_social))).catch(() => setProvCatalogo([]));
  }, []);
  // Sugerencias según el tipo elegido (clientes o proveedores), sin duplicar.
  const sugerencias = useMemo(() => {
    const set = new Set<string>();
    contrapartes.filter((c) => c.tipo === nvTipo).forEach((c) => set.add(c.nombre));
    if (nvTipo === 'proveedor') provCatalogo.forEach((n) => n && set.add(n));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [contrapartes, provCatalogo, nvTipo]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const cs = await listCuentasPorPagar(true);
      setLista(cs);
      setSelId((p) => (p && cs.some((c) => c.id === p)) ? p : (cs[0]?.id ?? ''));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => {
    if (!selId) { setAbonos([]); setIngresos([]); return; }
    listAbonosCuenta(selId).then(setAbonos).catch(() => setAbonos([]));
    listIngresosCxP(selId).then(setIngresos).catch(() => setIngresos([]));
  }, [selId]);

  const sel = lista.find((c) => c.id === selId) ?? null;
  // Saldos completos de la caja elegida (para mostrar dónde hay dinero disponible).
  const [cajaSaldosSel, setCajaSaldosSel] = useState<CajaSaldo[]>([]);
  useEffect(() => {
    if (!cajaId || !sel) { setCuentaCaja(''); setCajaSaldosSel([]); return; }
    saldosDeCaja(cajaId)
      .then((rows) => {
        setCajaSaldosSel(rows);
        // El egreso sale en la MISMA moneda de la cuenta por pagar.
        const mismos = rows.filter((r) => r.moneda === sel.moneda && Number(r.saldo) > 0);
        setCuentaCaja((prev) => (prev && mismos.some((r) => r.cuenta === prev)) ? prev : (mismos[0]?.cuenta ?? ''));
      })
      .catch(() => { setCajaSaldosSel([]); setCuentaCaja(''); });
  }, [cajaId, sel]);
  // Cuentas de esta caja que tienen saldo en la moneda de la cuenta por pagar.
  const cuentasMoneda = sel ? cajaSaldosSel.filter((r) => r.moneda === sel.moneda && Number(r.saldo) > 0) : [];
  // Todo lo disponible en la caja (cualquier moneda) para ver dónde hay dinero.
  const dispCaja = cajaSaldosSel.filter((r) => Number(r.saldo) > 0);
  const saldoCuentaSel = cuentasMoneda.find((r) => r.cuenta === cuentaCaja) ?? null;

  const saldo = sel ? round2(Number(sel.monto) - (Number(sel.abonado) || 0)) : 0;

  async function abonar() {
    setError(null);
    if (!sel) return;
    const m = Number(montoStr) || 0;
    if (m <= 0) { setError('Indicá el monto a abonar.'); return; }
    if (!cajaId) { setError('Elegí la caja del egreso.'); return; }
    if (!cuentaCaja) { setError(`La caja no tiene saldo en ${sel.moneda}.`); return; }
    setSaving(true);
    try {
      const r = await registrarAbonoCuenta({
        cuenta: sel, cajaId, cuentaCaja: cuentaCaja as CuentaCaja, monto: m,
        nota: nota.trim() || null, actor, actorName,
      });
      notify(r.cuenta.estado === 'saldada'
        ? `Cuenta por pagar saldada · ${sel.contraparte}`
        : `Abono ${monto(m, sel.moneda)} · ${sel.contraparte}`, 'success', { link: '#/app/tesoreria' });
      setMontoStr(''); setNota('');
      await cargar(); await onChanged();
      if (r.cuenta.estado !== 'saldada') await listAbonosCuenta(sel.id).then(setAbonos);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo registrar el abono'); }
    finally { setSaving(false); }
  }

  async function crearCuenta() {
    setError(null);
    const nombre = nvNombre.trim();
    const m = Number(nvMonto) || 0;
    if (!nombre) { setError('Indicá el cliente o proveedor.'); return; }
    if (m <= 0) { setError('Indicá el monto de la cuenta por pagar.'); return; }
    setCreando(true);
    try {
      const c = await registrarIngresoCxP({ tipo: nvTipo, contraparte: nombre, monto: m, moneda: nvMoneda, actor, actorName });
      notify(`Cuenta por pagar creada · ${nombre}`, 'success', { link: '#/app/tesoreria' });
      setNvNombre(''); setNvMonto('');
      await cargar(); await onChanged();
      setSelId(c.id);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear la cuenta'); }
    finally { setCreando(false); }
  }

  if (loading) return <p className="hint muted">Cargando…</p>;

  return (
    <>
      {/* Crear una cuenta por pagar nueva (cliente/proveedor que aún no existe). */}
      <div className="card" style={{ marginBottom: '.75rem' }}>
        <div className="card-title"><span>+ Nueva cuenta por pagar</span></div>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.5rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-grid">
          <div className="form-row">
            <label>Tipo</label>
            <select className="select" value={nvTipo} onChange={(e) => setNvTipo(e.target.value as 'cliente' | 'proveedor')}>
              <option value="proveedor">🏭 Proveedor</option>
              <option value="cliente">👤 Cliente</option>
            </select>
          </div>
          <div className="form-row">
            <label>Cliente / Proveedor</label>
            <input className="input" list="cxp-contrapartes-list" value={nvNombre}
              onChange={(e) => setNvNombre(e.target.value)}
              placeholder={`${nvTipo === 'proveedor' ? 'Proveedor' : 'Cliente'} guardado o nuevo`} />
            <datalist id="cxp-contrapartes-list">
              {sugerencias.map((n) => <option key={n} value={n} />)}
            </datalist>
            {sugerencias.length > 0 && (
              <small className="muted">{sugerencias.length} {nvTipo === 'proveedor' ? 'proveedor(es)' : 'cliente(s)'} guardado(s) · escribí para buscar o cargá uno nuevo</small>
            )}
          </div>
          <div className="form-row">
            <label>Monto</label>
            <input className="input mono" type="number" min={0} step="0.01" value={nvMonto} onChange={(e) => setNvMonto(e.target.value)} placeholder="0.00" />
          </div>
          <div className="form-row">
            <label>Moneda</label>
            <select className="select" value={nvMoneda} onChange={(e) => setNvMoneda(e.target.value)}>
              {['USD', 'USDT', 'Bs', 'COP'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: '.5rem' }} disabled={creando} onClick={crearCuenta}>
          {creando ? 'Creando…' : '+ Crear cuenta por pagar'}
        </button>
      </div>

      {!lista.length ? (
        <p className="hint muted" style={{ textAlign: 'center' }}>No hay cuentas por pagar abiertas. Creá una arriba. 🎉</p>
      ) : (
      <SelectorBuscable
        label="Cuenta por pagar"
        items={lista}
        value={selId}
        onChange={setSelId}
        optionLabel={(c) => `${c.tipo === 'proveedor' ? '🏭' : '👤'} ${c.contraparte} · saldo ${monto(round2(Number(c.monto) - (Number(c.abonado) || 0)), c.moneda)}`}
      />
      )}

      {sel && (
        <>
          <div className="m-tiles" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '.6rem', marginBottom: '.75rem' }}>
            <div className="card" style={{ margin: 0, padding: '.6rem .85rem' }}>
              <div className="muted" style={{ fontSize: '.7rem' }}>TOTAL</div>
              <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{monto(Number(sel.monto), sel.moneda)}</div>
            </div>
            <div className="card" style={{ margin: 0, padding: '.6rem .85rem' }}>
              <div className="muted" style={{ fontSize: '.7rem' }}>ABONADO</div>
              <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary-3)' }}>{monto(Number(sel.abonado) || 0, sel.moneda)}</div>
            </div>
            <div className="card" style={{ margin: 0, padding: '.6rem .85rem' }}>
              <div className="muted" style={{ fontSize: '.7rem' }}>SALDO</div>
              <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: saldo > 0 ? 'var(--warning)' : 'var(--success)' }}>{monto(saldo, sel.moneda)}</div>
            </div>
          </div>
          <div className="badge" style={{ marginBottom: '.6rem' }}>{sel.tipo === 'proveedor' ? '🏭 Proveedor' : '👤 Cliente'}{sel.nota ? ` · ${sel.nota}` : ''}</div>

          {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}

          <div className="card" style={{ marginBottom: '.75rem' }}>
            <div className="card-title"><span>Registrar abono (egreso de caja · {sel.moneda})</span></div>
            <div className="form-grid">
              <div className="form-row">
                <label>Caja (egreso)</label>
                <select className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
                  {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
                {/* De qué cuenta/moneda sale el dinero (el abono es en la moneda de la cuenta por pagar). */}
                {cuentasMoneda.length > 1 ? (
                  <select className="select" style={{ marginTop: '.35rem' }} value={cuentaCaja} onChange={(e) => setCuentaCaja(e.target.value)}>
                    {cuentasMoneda.map((r) => (
                      <option key={r.cuenta} value={r.cuenta}>
                        Sale de {r.cuenta === 'general' ? 'general' : r.cuenta === 'juridica' ? 'Jurídica' : r.cuenta === 'personal' ? 'Personal' : r.cuenta} · {monto(Number(r.saldo), r.moneda)} disp.
                      </option>
                    ))}
                  </select>
                ) : saldoCuentaSel ? (
                  <small className="muted">Sale en <strong>{sel.moneda}</strong> de la cuenta <strong>{cuentaCaja === 'general' ? 'general' : cuentaCaja === 'juridica' ? 'Jurídica' : cuentaCaja === 'personal' ? 'Personal' : cuentaCaja}</strong> · disponible <strong className="mono">{monto(Number(saldoCuentaSel.saldo), sel.moneda)}</strong></small>
                ) : (
                  <small style={{ color: 'var(--danger)' }}>⚠ Esta caja no tiene saldo en {sel.moneda}. Elegí otra caja.</small>
                )}
              </div>
              <div className="form-row">
                <label>Monto a abonar ({sel.moneda})</label>
                <input className="input mono" type="number" min={0} step="any" value={montoStr} onChange={(e) => setMontoStr(e.target.value)} />
                <small className="muted">Saldo pendiente: <strong className="mono">{monto(saldo, sel.moneda)}</strong></small>
              </div>
            </div>

            {/* Dónde hay dinero disponible en la caja elegida (todas las monedas). */}
            <div className="card" style={{ margin: '.25rem 0 .1rem', padding: '.5rem .7rem', background: 'rgba(255,255,255,.02)' }}>
              <div className="muted" style={{ fontSize: '.7rem', marginBottom: '.3rem' }}>DINERO DISPONIBLE EN ESTA CAJA</div>
              {!dispCaja.length ? (
                <small className="muted">Sin saldo en ninguna moneda.</small>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
                  {dispCaja.map((r) => {
                    const esLaQueSale = r.moneda === sel.moneda && r.cuenta === cuentaCaja;
                    return (
                      <span key={`${r.cuenta}-${r.moneda}`} className="mono" style={{
                        padding: '.15rem .55rem', borderRadius: '999px', fontSize: '.8rem',
                        border: `1px solid ${esLaQueSale ? 'var(--primary, #ff8a00)' : 'var(--border)'}`,
                        background: esLaQueSale ? 'rgba(255,138,0,.12)' : 'transparent',
                        fontWeight: esLaQueSale ? 700 : 500,
                      }}>
                        {monto(Number(r.saldo), r.moneda)} {r.moneda}{r.cuenta === 'general' ? '' : r.cuenta === 'juridica' ? ' · Jurídica' : ' · Personal'}{esLaQueSale ? ' ←' : ''}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="form-row">
              <label>Nota (opcional)</label>
              <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Referencia del abono…" />
            </div>
            <button className="btn btn-primary btn-sm" onClick={abonar} disabled={saving || saldo <= 0}>{saving ? 'Registrando…' : 'Registrar abono'}</button>
          </div>

          {/* Ingresos del cliente/proveedor (cada entrada de dinero con su fecha, acumulado). */}
          <strong style={{ fontSize: '.84rem' }}>Ingresos de {sel.contraparte} (fechas)</strong>
          <div className="table-wrap" style={{ marginBottom: '.6rem' }}>
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead><tr><th>#</th><th>Fecha</th><th style={{ textAlign: 'right' }}>Ingreso</th><th style={{ textAlign: 'right' }}>Acumulado (debe)</th><th>Nota</th></tr></thead>
              <tbody>
                {!ingresos.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>Sin ingresos registrados.</td></tr>}
                {(() => { let acc = 0; return ingresos.map((ing, i) => { acc = round2(acc + Number(ing.monto)); return (
                  <tr key={ing.id}>
                    <td className="mono">{i + 1}</td>
                    <td>{dateTime(ing.at)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{monto(Number(ing.monto), ing.moneda)}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{monto(acc, ing.moneda)}</td>
                    <td className="muted">{ing.nota || '—'}</td>
                  </tr>
                ); }); })()}
              </tbody>
              {ingresos.length > 0 && (
                <tfoot><tr style={{ fontWeight: 700 }}>
                  <td colSpan={2} style={{ textAlign: 'right' }}>Total prestado</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{monto(Number(sel.monto), sel.moneda)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: saldo > 0 ? 'var(--danger)' : 'var(--success)' }}>se debe {monto(saldo, sel.moneda)}</td>
                  <td></td>
                </tr></tfoot>
              )}
            </table>
          </div>

          {/* Reportes de la cuenta por pagar: PDF y correo (mismo formato que los demás reportes). */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.4rem', marginBottom: '.4rem' }}>
            <strong style={{ fontSize: '.84rem' }}>Historial de abonos</strong>
            <div style={{ display: 'flex', gap: '.4rem' }}>
              <button
                className="btn btn-sm btn-ghost"
                title="Descargar el reporte de esta cuenta por pagar en PDF"
                onClick={async () => {
                  try { const { descargarCuentaPorPagarPdf } = await import('./cuentaPorPagarPdf'); await descargarCuentaPorPagarPdf(sel, abonos, ingresos); }
                  catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
                }}
              >↓ PDF</button>
              <button
                className="btn btn-sm btn-ghost"
                title="Enviar el reporte por correo"
                onClick={() => setCorreoCuentaOpen(true)}
              >📧 Correo</button>
            </div>
          </div>

          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead><tr><th>Fecha</th><th style={{ textAlign: 'right' }}>Abono</th><th style={{ textAlign: 'right' }}>Saldo restante</th><th>Nota</th></tr></thead>
              <tbody>
                {!abonos.length && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>Sin abonos.</td></tr>}
                {abonos.map((ab) => (
                  <tr key={ab.id}>
                    <td>{dateTime(ab.at)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{monto(Number(ab.monto), ab.moneda)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{ab.saldo_restante != null ? monto(Number(ab.saldo_restante), ab.moneda) : '—'}</td>
                    <td className="muted">{ab.nota || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {correoCuentaOpen && (
            <EnviarCuentaPorPagarModal cuenta={sel} abonos={abonos} ingresos={ingresos} defaultEmail={actor} onClose={() => setCorreoCuentaOpen(false)} />
          )}
        </>
      )}
    </>
  );
}

/* ───────── Enviar por correo el reporte de una cuenta por pagar ───────── */
function EnviarCuentaPorPagarModal({ cuenta, abonos, ingresos, defaultEmail, onClose }: {
  cuenta: CuentaPorPagar; abonos: AbonoCxP[]; ingresos: IngresoCxP[]; defaultEmail: string; onClose: () => void;
}) {
  const [incluirPropio, setIncluirPropio] = useState(true);
  const [extra, setExtra] = useState('');
  const [enviando, setEnviando] = useState(false);
  const propio = defaultEmail.trim().toLowerCase();
  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  async function handleEnviar() {
    const lista: string[] = [];
    if (incluirPropio && propio) lista.push(propio);
    const extraClean = extra.trim().toLowerCase();
    if (extraClean) {
      if (!emailRx.test(extraClean)) { toast('El correo adicional no es válido', 'error'); return; }
      lista.push(extraClean);
    }
    setEnviando(true);
    try {
      const { enviarCuentaPorPagarPorCorreo } = await import('./enviarReporte');
      const r = await enviarCuentaPorPagarPorCorreo(cuenta, abonos, lista, ingresos);
      notify(`Reporte enviado a ${r.destinatarios.join(', ')}`, 'success', { link: '#/app/tesoreria' });
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo enviar', 'error'); }
    finally { setEnviando(false); }
  }

  return (
    <Modal title={`Enviar cuenta por pagar · ${cuenta.contraparte}`} size="md" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={enviando}>Cancelar</button>
        <button className="btn btn-primary" onClick={handleEnviar} disabled={enviando}>{enviando ? 'Enviando…' : '📧 Enviar'}</button>
      </>
    }>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.88rem' }}>
        Se enviará el PDF de la cuenta por pagar de <strong>{cuenta.contraparte}</strong> (con su historial de abonos) a los destinatarios seleccionados.
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.7rem .85rem', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: incluirPropio ? 'rgba(255,138,0,0.06)' : 'transparent', cursor: propio ? 'pointer' : 'not-allowed', marginBottom: '.6rem' }}>
        <input type="checkbox" checked={incluirPropio} disabled={!propio} onChange={(e) => setIncluirPropio(e.target.checked)} />
        <div>
          <div style={{ fontWeight: 600 }}>Tu correo</div>
          <div className="mono" style={{ fontSize: '.82rem' }}>{propio || '—'}</div>
        </div>
      </label>
      <div className="form-row" style={{ marginTop: '.4rem' }}>
        <label>Correo adicional (opcional)</label>
        <input className="input" type="email" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="otro@correo.com" maxLength={120} />
        <small className="muted">Si no marcás ninguno, se envía a los admin/jefe.</small>
      </div>
    </Modal>
  );
}

/* ───────────── Cuentas por cobrar (cliente/proveedor nos debe) ───────────── */
/** Selector con buscador: filtra la lista por texto (nombre, tipo o monto) y deja
 *  elegir del desplegable. La selección actual se conserva aunque no coincida con el
 *  filtro (no cambia sola al teclear). Usado en CxC y CxP. */
function SelectorBuscable<T extends { id: string }>({ label, items, value, onChange, optionLabel }: {
  label: string; items: T[]; value: string; onChange: (id: string) => void; optionLabel: (it: T) => string;
}) {
  const [q, setQ] = useState('');
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    const palabras = t.split(/\s+/).filter(Boolean);
    return items.filter((it) => { const s = optionLabel(it).toLowerCase(); return palabras.every((p) => s.includes(p)); });
  }, [items, q, optionLabel]);
  // La opción seleccionada siempre presente, aunque el filtro no la incluya.
  const opciones = useMemo(() => {
    const arr = [...filtrados];
    if (value && !arr.some((it) => it.id === value)) {
      const cur = items.find((it) => it.id === value);
      if (cur) arr.unshift(cur);
    }
    return arr;
  }, [filtrados, items, value]);
  return (
    <div className="form-row" style={{ marginBottom: '.6rem' }}>
      <label>{label} ({items.length})</label>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔎 Buscar por nombre, tipo o monto…" />
      <select className="select" style={{ marginTop: '.35rem' }} value={value} onChange={(e) => onChange(e.target.value)}>
        {opciones.map((it) => <option key={it.id} value={it.id}>{optionLabel(it)}</option>)}
      </select>
      {q.trim() && <small className="muted">{filtrados.length} de {items.length} coinciden</small>}
    </div>
  );
}

function CuentasPorCobrarModal({ cajas, actor, actorName, onClose, onChanged }: {
  cajas: Caja[]; actor: string; actorName: string | null; onClose: () => void; onChanged: () => void | Promise<void>;
}) {
  const [lista, setLista] = useState<CuentaPorCobrar[]>([]);
  const [selId, setSelId] = useState<string>('');
  const [abonos, setAbonos] = useState<AbonoCxC[]>([]);
  const [cajaId, setCajaId] = useState(cajas[0]?.id ?? '');
  const [cuentaCaja, setCuentaCaja] = useState<string>('');
  const [montoStr, setMontoStr] = useState('');
  const [nota, setNota] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Forma de cobro: 💵 dinero (entra a caja) o 📦 producto al cambio (entra a inventario).
  const [modoCobro, setModoCobro] = useState<'dinero' | 'producto'>('dinero');
  const [productos, setProductos] = useState<Producto[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [prodNuevo, setProdNuevo] = useState(false);
  const [prodId, setProdId] = useState('');
  const [prodNombre, setProdNombre] = useState('');
  const [prodUnidad, setProdUnidad] = useState('KG');
  const [prodAlmacen, setProdAlmacen] = useState('');
  const [prodCantidad, setProdCantidad] = useState('');
  const [prodValor, setProdValor] = useState('');
  useEffect(() => {
    listProductos().then(setProductos).catch(() => setProductos([]));
    listAlmacenes().then((a) => { setAlmacenes(a); setProdAlmacen((p) => p || a[0]?.nombre || ''); }).catch(() => setAlmacenes([]));
  }, []);
  // Almacén destino agrupado por sede con subalmacenes anidados (como en recepción de compras).
  const gruposAlmacen = useMemo(() => agruparAlmacenesPorSede(almacenes), [almacenes]);

  // Alta manual de una cuenta por cobrar.
  const [nuevaOpen, setNuevaOpen] = useState(false);
  const [nuevoTipo, setNuevoTipo] = useState<TipoContraparte>('cliente');
  const [nuevoContraparte, setNuevoContraparte] = useState('');
  const [nuevoMonto, setNuevoMonto] = useState('');
  const [nuevoMoneda, setNuevoMoneda] = useState('USD');
  const [nuevoDetalle, setNuevoDetalle] = useState('');
  const [creandoNueva, setCreandoNueva] = useState(false);
  const [contrapartes, setContrapartes] = useState<Contraparte[]>([]);
  const [monedas, setMonedas] = useState<string[]>([...MONEDAS_BASE]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const cs = await listCuentasPorCobrar(true);
      setLista(cs);
      setSelId((p) => (p && cs.some((c) => c.id === p)) ? p : (cs[0]?.id ?? ''));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => {
    listContrapartes().then(setContrapartes).catch(() => setContrapartes([]));
    listMonedas().then(setMonedas).catch(() => { /* base */ });
  }, []);
  // Multiusuario: refleja altas/cobros de otros al instante.
  useRealtime(['cuentas_por_cobrar', 'cuentas_por_cobrar_abonos', 'tesoreria_contrapartes'], () => { void cargar(); });
  useEffect(() => {
    if (!selId) { setAbonos([]); return; }
    listAbonosCobrar(selId).then(setAbonos).catch(() => setAbonos([]));
  }, [selId]);

  async function crearNueva() {
    setError(null);
    const nombre = nuevoContraparte.trim();
    const m = Number(nuevoMonto) || 0;
    if (!nombre) { setError('Indicá el cliente o proveedor.'); return; }
    if (m <= 0) { setError('Indicá cuánto falta por cobrar.'); return; }
    setCreandoNueva(true);
    try {
      // Si la contraparte no existe en el directorio, la damos de alta.
      const existe = contrapartes.some((c) => c.tipo === nuevoTipo && c.nombre.trim().toLowerCase() === nombre.toLowerCase());
      if (!existe) {
        try { await crearContraparte({ tipo: nuevoTipo, nombre }); } catch { /* si choca por duplicado, seguimos */ }
      }
      await crearCuentaPorCobrar({
        tipo: nuevoTipo, contraparte: nombre, monto: m, moneda: nuevoMoneda,
        nota: nuevoDetalle.trim() || null, actor, actorName,
      });
      notify(`Cuenta por cobrar creada · ${nombre} debe ${monto(m, nuevoMoneda)}`, 'success', { link: '#/app/tesoreria' });
      setNuevoContraparte(''); setNuevoMonto(''); setNuevoDetalle(''); setNuevaOpen(false);
      await cargar(); await onChanged();
      void listContrapartes().then(setContrapartes).catch(() => {});
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear la cuenta por cobrar'); }
    finally { setCreandoNueva(false); }
  }

  const sel = lista.find((c) => c.id === selId) ?? null;
  const saldo = sel ? round2(Number(sel.monto) - (Number(sel.abonado) || 0)) : 0;

  // Por defecto mostramos solo los centros de costo / aliados (convención «CENTRO ACOPIO …»,
  // igual que la vista de Aliados); los nombres sueltos/legados quedan ocultos salvo que se pida "ver todas".
  const [soloCentros, setSoloCentros] = useState(true);
  const esCentroOAliado = (c: CuentaPorCobrar) => c.contraparte.trim().toUpperCase().startsWith('CENTRO ACOPIO');
  const listaVisible = useMemo(() => (soloCentros ? lista.filter(esCentroOAliado) : lista), [lista, soloCentros]);
  const ocultas = lista.length - listaVisible.length;
  // Mantener la selección dentro de lo visible.
  useEffect(() => {
    if (listaVisible.length && !listaVisible.some((c) => c.id === selId)) setSelId(listaVisible[0].id);
  }, [listaVisible, selId]);

  // Cuentas de la caja elegida con saldo en la moneda (para saber dónde entra el dinero).
  const [cajaSaldosSel, setCajaSaldosSel] = useState<CajaSaldo[]>([]);
  useEffect(() => {
    if (!cajaId || !sel) { setCuentaCaja(''); setCajaSaldosSel([]); return; }
    saldosDeCaja(cajaId)
      .then((rows) => {
        setCajaSaldosSel(rows);
        const mismos = rows.filter((r) => r.moneda === sel.moneda);
        setCuentaCaja((prev) => (prev && mismos.some((r) => r.cuenta === prev)) ? prev : (mismos[0]?.cuenta ?? 'general'));
      })
      .catch(() => { setCajaSaldosSel([]); setCuentaCaja('general'); });
  }, [cajaId, sel]);
  const cuentasMoneda = sel ? cajaSaldosSel.filter((r) => r.moneda === sel.moneda) : [];

  async function cobrar() {
    setError(null);
    if (!sel) return;
    const m = Number(montoStr) || 0;
    if (m <= 0) { setError('Indicá el monto cobrado.'); return; }
    if (!cajaId) { setError('Elegí la caja donde entra el dinero.'); return; }
    setSaving(true);
    try {
      const r = await registrarAbonoCobrar({
        cuenta: sel, cajaId, cuentaCaja: (cuentaCaja || 'general') as CuentaCaja, monto: m,
        nota: nota.trim() || null, actor, actorName,
      });
      notify(r.cuenta.estado === 'saldada'
        ? `Cuenta por cobrar saldada · ${sel.contraparte}`
        : `Cobro ${monto(m, sel.moneda)} · ${sel.contraparte}`, 'success', { link: '#/app/tesoreria' });
      setMontoStr(''); setNota('');
      await cargar(); await onChanged();
      if (r.cuenta.estado !== 'saldada') await listAbonosCobrar(sel.id).then(setAbonos);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo registrar el cobro'); }
    finally { setSaving(false); }
  }

  // Cobro EN PRODUCTO (intercambio dinero↔producto): el producto entra al inventario y su valor salda la deuda.
  async function cobrarProducto() {
    setError(null);
    if (!sel) return;
    const cant = Number(prodCantidad) || 0;
    const valor = Number(prodValor) || 0;
    if (cant <= 0) { setError('Indicá la cantidad de producto recibida.'); return; }
    if (valor <= 0) { setError('Indicá el valor del producto al cambio.'); return; }
    if (!prodAlmacen) { setError('Elegí el almacén donde entra el producto.'); return; }
    if (!prodNuevo && !prodId) { setError('Elegí el producto recibido.'); return; }
    if (prodNuevo && !prodNombre.trim()) { setError('Indicá el nombre del producto nuevo.'); return; }
    setSaving(true);
    try {
      const r = await registrarAbonoCobrarProducto({
        cuenta: sel,
        productoId: prodNuevo ? null : prodId,
        productoNuevo: prodNuevo ? { nombre: prodNombre.trim(), unidad: prodUnidad } : null,
        almacen: prodAlmacen, cantidad: cant, valor,
        nota: nota.trim() || null, actor, actorName,
      });
      notify(r.cuenta.estado === 'saldada'
        ? `Cuenta por cobrar saldada con producto · ${sel.contraparte}`
        : `Abono en producto ${monto(valor, sel.moneda)} · ${sel.contraparte}`, 'success', { link: '#/app/tesoreria' });
      setProdCantidad(''); setProdValor(''); setProdNombre(''); setNota('');
      await cargar(); await onChanged();
      if (r.cuenta.estado !== 'saldada') await listAbonosCobrar(sel.id).then(setAbonos);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo registrar el abono en producto'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title="📥 Cuentas por cobrar" size="lg" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.84rem' }}>
        Deudas hacia la empresa (clientes, proveedores y <strong>centros de costo</strong>; cada <strong>traspaso de dinero</strong> a un centro genera una cuenta por cobrar <strong>incremental</strong>). Se saldan con <strong>abonos en dinero</strong> (entran a la caja) o <strong>en producto al cambio</strong> (entra al inventario y su valor abona la deuda).
      </p>

      <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.6rem' }}>
        <button className="btn btn-sm btn-ghost" disabled={!lista.length}
          onClick={() => import('./cuentasPorCobrarPdf').then(({ descargarResumenPorCobrarPdf }) => descargarResumenPorCobrarPdf(lista)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'))}>
          ↓ Resumen PDF
        </button>
      </div>

      {/* Alta manual de una cuenta por cobrar */}
      <div className="card" style={{ padding: '.6rem .7rem', marginBottom: '.7rem' }}>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNuevaOpen((v) => !v)}>
          {nuevaOpen ? '× Cerrar' : '+ Nueva cuenta por cobrar'}
        </button>
        {nuevaOpen && (
          <div style={{ display: 'grid', gap: '.5rem', marginTop: '.6rem' }}>
            <div className="form-grid">
              <div className="form-row">
                <label>Tipo</label>
                <select className="select" value={nuevoTipo} onChange={(e) => setNuevoTipo(e.target.value as TipoContraparte)}>
                  <option value="cliente">Cliente</option>
                  <option value="proveedor">Proveedor</option>
                </select>
              </div>
              <div className="form-row">
                <label>{nuevoTipo === 'proveedor' ? 'Proveedor' : 'Cliente'}</label>
                <input className="input" list="cxc-contrapartes" value={nuevoContraparte}
                  onChange={(e) => setNuevoContraparte(e.target.value)}
                  placeholder="Nombre… (si no existe, se agrega)" />
                <datalist id="cxc-contrapartes">
                  {contrapartes.filter((c) => c.tipo === nuevoTipo).map((c) => <option key={c.id} value={c.nombre} />)}
                </datalist>
                <small className="muted">Si no está en la lista, se da de alta automáticamente.</small>
              </div>
            </div>
            <div className="form-grid">
              <div className="form-row">
                <label>Monto por cobrar</label>
                <input className="input mono" type="number" min={0} step="any" value={nuevoMonto} onChange={(e) => setNuevoMonto(e.target.value)} placeholder="0.00" />
              </div>
              <div className="form-row">
                <label>Moneda</label>
                <select className="select" value={nuevoMoneda} onChange={(e) => setNuevoMoneda(e.target.value)}>
                  {monedas.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <label>Detalle</label>
              <input className="input" value={nuevoDetalle} onChange={(e) => setNuevoDetalle(e.target.value)} placeholder="¿Por qué nos debe? (opcional)" />
            </div>
            <div>
              <button className="btn btn-primary btn-sm" onClick={crearNueva} disabled={creandoNueva}>
                {creandoNueva ? 'Creando…' : 'Crear cuenta por cobrar'}
              </button>
            </div>
            {error && !lista.length && <div className="card" style={{ borderColor: 'var(--danger)' }}><strong>Error:</strong> {error}</div>}
          </div>
        )}
      </div>

      {loading ? <EmptyState message="Cargando…" icon="◔" /> : !lista.length ? (
        <EmptyState message="Sin cuentas por cobrar abiertas. Creá una arriba." icon="📥" />
      ) : (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer', fontSize: '.82rem', marginBottom: '.4rem' }}>
            <input type="checkbox" checked={soloCentros} onChange={(e) => setSoloCentros(e.target.checked)} />
            Solo centros de costo / aliados{soloCentros && ocultas > 0 ? ` · ${ocultas} otra(s) oculta(s)` : ''}
          </label>
          {!listaVisible.length ? (
            <EmptyState message="No hay centros de costo / aliados. Desmarcá la casilla para ver todas las cuentas." icon="🤝" />
          ) : (
          <SelectorBuscable
            label="Cuenta por cobrar"
            items={listaVisible}
            value={selId}
            onChange={setSelId}
            optionLabel={(c) => `${labelTipoCxC(c.tipo)}: ${c.contraparte} · debe ${monto(round2(Number(c.monto) - (Number(c.abonado) || 0)), c.moneda)}`}
          />
          )}

          {sel && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '.6rem', margin: '.5rem 0' }}>
                <div className="card"><div className="muted" style={{ fontSize: '.7rem' }}>TOTAL</div><strong className="mono">{monto(Number(sel.monto), sel.moneda)}</strong></div>
                <div className="card"><div className="muted" style={{ fontSize: '.7rem' }}>COBRADO</div><strong className="mono" style={{ color: 'var(--success, #16c784)' }}>{monto(Number(sel.abonado), sel.moneda)}</strong></div>
                <div className="card" style={{ borderColor: 'var(--primary)' }}><div className="muted" style={{ fontSize: '.7rem' }}>NOS DEBEN</div><strong className="mono" style={{ color: saldo > 0 ? 'var(--danger)' : 'var(--success)' }}>{monto(saldo, sel.moneda)}</strong></div>
              </div>
              {sel.nota && <p className="hint muted" style={{ fontSize: '.78rem', marginTop: 0 }}>Nota: {sel.nota}</p>}

              {/* Forma de cobro: dinero (entra a caja) o producto al cambio (entra a inventario). */}
              <div className="view-toggle" role="tablist" aria-label="Forma de cobro" style={{ marginBottom: '.6rem' }}>
                <button type="button" className={modoCobro === 'dinero' ? 'active' : ''} onClick={() => { setModoCobro('dinero'); setError(null); }}>💵 En dinero</button>
                <button type="button" className={modoCobro === 'producto' ? 'active' : ''} onClick={() => { setModoCobro('producto'); setError(null); }}>📦 En producto (al cambio)</button>
              </div>

              {modoCobro === 'dinero' ? (
                <>
                  <div className="form-grid">
                    <div className="form-row">
                      <label>Caja donde entra el dinero</label>
                      <select className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
                        {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                      {cuentasMoneda.length > 1 && (
                        <select className="select" style={{ marginTop: '.35rem' }} value={cuentaCaja} onChange={(e) => setCuentaCaja(e.target.value)}>
                          {cuentasMoneda.map((r) => (
                            <option key={r.cuenta} value={r.cuenta}>Entra en {r.cuenta === 'general' ? 'general' : r.cuenta === 'juridica' ? 'Jurídica' : r.cuenta === 'personal' ? 'Personal' : r.cuenta} · {monto(Number(r.saldo), r.moneda)}</option>
                          ))}
                        </select>
                      )}
                      <small className="muted">Entra en <strong>{sel.moneda}</strong> a la caja elegida.</small>
                    </div>
                    <div className="form-row">
                      <label>Monto cobrado ({sel.moneda})</label>
                      <input className="input mono" type="number" min={0} step="any" value={montoStr} onChange={(e) => setMontoStr(e.target.value)} />
                      <small className="muted">Saldo por cobrar: <strong className="mono">{monto(saldo, sel.moneda)}</strong></small>
                    </div>
                  </div>
                  <div className="form-row">
                    <label>Nota (opcional)</label>
                    <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Referencia del cobro…" />
                  </div>
                  {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.5rem' }}><strong>Error:</strong> {error}</div>}
                  <button className="btn btn-primary btn-sm" onClick={cobrar} disabled={saving || saldo <= 0}>{saving ? 'Registrando…' : 'Registrar cobro (entra a caja)'}</button>
                </>
              ) : (
                <>
                  <p className="hint muted" style={{ fontSize: '.78rem', marginTop: 0 }}>
                    La contraparte salda entregando producto: <strong>entra al inventario</strong> y su <strong>valor al cambio</strong> ({sel.moneda}) abona la deuda. No entra dinero a caja.
                  </p>
                  <div className="form-row">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={prodNuevo} onChange={(e) => setProdNuevo(e.target.checked)} />
                      <span>Producto no registrado (lo creo ahora)</span>
                    </label>
                  </div>
                  {prodNuevo ? (
                    <div className="form-grid">
                      <div className="form-row">
                        <label>Nombre del producto</label>
                        <input className="input" value={prodNombre} onChange={(e) => setProdNombre(e.target.value.toUpperCase())} placeholder="Ej.: CASITERITA" />
                      </div>
                      <div className="form-row">
                        <label>Unidad</label>
                        <input className="input" value={prodUnidad} onChange={(e) => setProdUnidad(e.target.value.toUpperCase())} placeholder="KG / TON / G" />
                      </div>
                    </div>
                  ) : (
                    <div className="form-row">
                      <label>Producto recibido</label>
                      <SearchSelect
                        value={prodId} onChange={setProdId}
                        options={productos.map((p) => ({ value: p.id, label: `${p.nombre} (${p.sku})` }))}
                        placeholder="Buscar producto…" emptyText="Ningún producto coincide"
                      />
                    </div>
                  )}
                  <div className="form-grid">
                    <div className="form-row">
                      <label>Almacén destino</label>
                      <select className="select" value={prodAlmacen} onChange={(e) => setProdAlmacen(e.target.value)}>
                        {gruposAlmacen.map(([sede, items]) => (
                          <optgroup key={sede} label={sede}>
                            {items.map(({ a, nivel }) => (
                              <option key={a.id} value={a.nombre}>
                                {nivel > 0 ? `${'  '.repeat(nivel)}↳ ` : ''}{nombreCortoAlmacen(a, almacenes)}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                    <div className="form-row">
                      <label>Cantidad recibida</label>
                      <input className="input mono" type="number" min={0} step="any" value={prodCantidad} onChange={(e) => setProdCantidad(e.target.value)} placeholder="Ej.: 500" />
                    </div>
                  </div>
                  <div className="form-row">
                    <label>Valor del producto al cambio ({sel.moneda})</label>
                    <input className="input mono" type="number" min={0} step="any" value={prodValor} onChange={(e) => setProdValor(e.target.value)} placeholder={`Ej.: ${round2(saldo)}`} />
                    <small className="muted">
                      Saldo por cobrar: <strong className="mono">{monto(saldo, sel.moneda)}</strong>
                      {Number(prodCantidad) > 0 && Number(prodValor) > 0 && <> · costo unit.: <strong className="mono">{monto(round2(Number(prodValor) / Number(prodCantidad)), sel.moneda)}</strong></>}
                    </small>
                  </div>
                  <div className="form-row">
                    <label>Nota (opcional)</label>
                    <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Referencia del intercambio…" />
                  </div>
                  {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.5rem' }}><strong>Error:</strong> {error}</div>}
                  <button className="btn btn-primary btn-sm" onClick={cobrarProducto} disabled={saving || saldo <= 0}>{saving ? 'Registrando…' : 'Registrar abono en producto (entra a inventario)'}</button>
                </>
              )}

              <strong style={{ fontSize: '.84rem', display: 'block', marginTop: '.8rem' }}>Historial de cobros</strong>
              <div className="table-wrap">
                <table className="table" style={{ fontSize: '.82rem' }}>
                  <thead><tr><th>Fecha</th><th style={{ textAlign: 'right' }}>Cobro</th><th style={{ textAlign: 'right' }}>Saldo restante</th><th>Nota</th></tr></thead>
                  <tbody>
                    {!abonos.length && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>Sin cobros.</td></tr>}
                    {abonos.map((ab) => (
                      <tr key={ab.id}>
                        <td>{dateTime(ab.at)}{ab.tipo_abono === 'producto' && <span className="badge" style={{ marginLeft: '.3rem' }}>📦 Producto</span>}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{monto(Number(ab.monto), ab.moneda)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{ab.saldo_restante != null ? monto(Number(ab.saldo_restante), ab.moneda) : '—'}</td>
                        <td className="muted">
                          {ab.tipo_abono === 'producto'
                            ? `${num(Number(ab.cantidad) || 0)} ${ab.unidad ?? ''} ${ab.producto_nombre ?? ''}${ab.nota ? ` · ${ab.nota}` : ''}`.trim()
                            : (ab.nota || '—')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

function PagarOrdenModal({ row, cajas, actor, actorName, userId, onClose, onPaid }: {
  row: OrdenPorPagar; cajas: Caja[]; actor: string; actorName: string | null; userId: string; onClose: () => void; onPaid: () => void;
}) {
  const o = row.orden;
  // Contra entrega: se paga SOLO lo recibido (montoAPagar = recibido_total).
  const baseGeneral = Number(row.montoAPagar ?? o.total) || 0;
  const pagoParcial = row.esContraEntrega && o.recibido_total != null && Number(o.recibido_total) < Number(o.total);
  // Precio en DIVISA EFECTIVO (con su descuento %): se puede pagar ESE monto en
  // lugar del BCV general. `efectivoSnap` viene de la oferta elegida; el % es
  // editable acá (por si el proveedor da otro descuento al pagar en efectivo).
  const efectivoSnap = Number(o.oferta_precio_efectivo) || 0;
  const ahorroSnap = !pagoParcial ? descuentoEfectivo(baseGeneral, efectivoSnap) : null;
  const [cajaId, setCajaId] = useState(cajas[0]?.id ?? '');
  const [usarEfectivo, setUsarEfectivo] = useState(false);
  const [pctEfStr, setPctEfStr] = useState(ahorroSnap ? String(ahorroSnap.pct) : '');
  const pctEf = Number(pctEfStr) || 0;
  const efectivoCalc = round2(pctEf > 0 ? baseGeneral * (1 - pctEf / 100) : (efectivoSnap > 0 ? efectivoSnap : baseGeneral));
  // El "precio en divisa efectivo" (descuento vs BCV) solo aplica a órdenes en USD/BCV,
  // no a servicios cotizados nativamente en Bs.
  const puedeEfectivo = !pagoParcial && baseGeneral > 0 && (o.moneda ?? 'USD') !== 'Bs';
  // Monto base a pagar: el efectivo (si está activado y es menor) o el general.
  const baseUsd = (usarEfectivo && efectivoCalc > 0 && efectivoCalc < baseGeneral) ? efectivoCalc : baseGeneral;
  const [montoStr, setMontoStr] = useState(String(baseGeneral));
  const [factura, setFactura] = useState<File | null>(null);
  const [motivoPago, setMotivoPago] = useState('');
  // Imagen / QR de pago cargado al indicar el método (ej. QR de Binance): Tesorería lo escanea.
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!o.pago_qr_path) { setQrUrl(null); return; }
    urlAdjuntoOc(o.pago_qr_path).then(setQrUrl).catch(() => setQrUrl(null));
  }, [o.pago_qr_path]);
  // Seriales de billetes entregados (solo cuando se paga con USD físico).
  const [seriales, setSeriales] = useState<string[]>([]);
  const [serialInput, setSerialInput] = useState('');
  // Anclaje OPCIONAL a una categoría → subcategoría de gasto (clasifica el egreso).
  const [catRows, setCatRows] = useState<CategoriaGasto[]>([]);
  const [gCatId, setGCatId] = useState('');
  const [gSubId, setGSubId] = useState('');
  useEffect(() => { listCategoriasGasto(true).then(setCatRows).catch(() => setCatRows([])); }, []);
  useEffect(() => { setGSubId(''); }, [gCatId]);
  const gCategorias = soloCategorias(catRows);
  const gSubcats = gCatId ? subcategoriasDe(catRows, gCatId) : [];
  const gCatNombre = gCategorias.find((c) => c.id === gCatId)?.nombre ?? null;
  const gSubNombre = gSubcats.find((s) => s.id === gSubId)?.nombre ?? null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Comisión bancaria (opcional): egreso extra de la caja, NO suma a la factura.
  const [comisionMonto, setComisionMonto] = useState('');
  const [comisionSaldoId, setComisionSaldoId] = useState('');
  const caja = cajas.find((c) => c.id === cajaId) ?? null;
  const moneda = caja?.moneda ?? 'USD';

  // Finalidad de la OC: la del encabezado o, si falta, la unión de las finalidades por ítem.
  const resumenFinalidad = useMemo(() => {
    const cab = (o.finalidad ?? '').trim();
    if (cab) return cab;
    const porItem = Array.from(new Set((o.items ?? []).map((it) => (it.finalidad ?? '').trim()).filter(Boolean)));
    return porItem.join(' · ');
  }, [o.finalidad, o.items]);

  // Saldos multimoneda de la caja elegida (para el multipago por cuenta).
  const [saldosCaja, setSaldosCaja] = useState<CajaSaldo[]>([]);
  const [legMontos, setLegMontos] = useState<Record<string, string>>({});
  const [mercado, setMercado] = useState<TasasMercado | null>(null);
  // Patas EXTRA desde OTRAS cajas (multipago entre cajas): cada una referencia un
  // saldo de otra caja + su monto. Cubre el caso de que una sola caja no alcance.
  const [todosSaldos, setTodosSaldos] = useState<CajaSaldo[]>([]);
  const [extraLegs, setExtraLegs] = useState<Array<{ id: number; saldoId: string; monto: string }>>([]);
  const extraSeq = useRef(1);
  useEffect(() => {
    if (!cajaId) { setSaldosCaja([]); return; }
    saldosDeCaja(cajaId).then((rows) => setSaldosCaja(rows.filter((r) => Number(r.saldo) > 0))).catch(() => setSaldosCaja([]));
    setLegMontos({});
    setExtraLegs([]);
  }, [cajaId]);
  useEffect(() => { listSaldos().then((rows) => setTodosSaldos(rows.filter((r) => Number(r.saldo) > 0))).catch(() => setTodosSaldos([])); }, []);
  useEffect(() => { getTasasMercado().then(setMercado).catch(() => setMercado(null)); }, []);
  // Cuentas de OTRAS cajas disponibles para sumar como pata extra.
  const saldosOtrasCajas = todosSaldos.filter((s) => s.caja_id !== cajaId);
  // Si la caja maneja saldos por cuenta/moneda (caja_saldos), se paga eligiendo
  // de qué cuentas sale el dinero — aunque tenga una sola moneda con saldo.
  const esMultimoneda = saldosCaja.length >= 1;
  // Si el método de pago es en efectivo (divisas/Bs), no se exige comprobante.
  const comprobanteOpcional = pagoSinComprobante(o.metodo_pago);

  // La orden puede estar en USD (BCV) o NATIVAMENTE en Bs (servicios en Bs).
  // El motor de cobertura del multipago trabaja en USD como denominador común;
  // si la orden es en Bs, su total se convierte a su equivalente en USD con la
  // tasa BCV del día. Se autocompleta el monto según la moneda de la caja.
  const esOrdenBs = (o.moneda ?? 'USD') === 'Bs';
  const monedaOrden = o.moneda ?? 'USD';
  const [tasa, setTasa] = useState<number>(0);
  const [tasaFecha, setTasaFecha] = useState<string | null>(null);
  const [tasaLista, setTasaLista] = useState(false);
  useEffect(() => {
    getTasaHoy()
      .then((t) => { if (t.usd != null) setTasa(t.usd); setTasaFecha(t.fecha); })
      .catch(() => { /* sin tasa: el usuario la ingresa manualmente */ })
      .finally(() => setTasaLista(true));
  }, []);
  // Total a cubrir expresado en USD (denominador común). Para órdenes en Bs es el
  // total en Bs dividido por la tasa; para las de USD, el propio total.
  const totalUsd = esOrdenBs ? (tasa > 0 ? round2(baseUsd / tasa) : 0) : baseUsd;
  // Muestra en la MONEDA DE LA ORDEN (Bs para servicios en Bs) un monto dado en USD.
  const enMonedaOrden = (usd: number) => esOrdenBs ? (tasa > 0 ? round2(usd * tasa) : 0) : round2(usd);

  // Autocompletar el monto cuando cambia la moneda de la caja o la tasa.
  useEffect(() => {
    if (moneda === 'USD') setMontoStr(String(totalUsd));
    else if (tasa > 0) setMontoStr(String(aBs(totalUsd, tasa)));
  }, [moneda, tasa, totalUsd]);

  const montoNum = Number(montoStr) || 0;
  const totalBs = tasa > 0 ? aBs(totalUsd, tasa) : 0;
  // Equivalente del monto tecleado en la otra moneda.
  const equivOtra = moneda === 'Bs'
    ? (tasa > 0 ? aExtranjero(montoNum, tasa) : 0)   // Bs → $
    : (tasa > 0 ? aBs(montoNum, tasa) : 0);          // $ → Bs

  // Multipago: equivalente en USD de un monto en su propia moneda (tasa del día).
  function legUsd(monedaLeg: string, n: number): number {
    if (!n || n <= 0) return 0;
    if (monedaLeg === 'USD' || monedaLeg === 'USDT') return round2(n);
    if (monedaLeg === 'Bs') return tasa > 0 ? round2(n / tasa) : 0;
    if (monedaLeg === 'COP') return mercado?.copUsd ? round2(n / mercado.copUsd) : 0;
    return round2(n); // moneda desconocida: se asume paridad con el dólar
  }
  // Inverso de legUsd: cuánto representa, en la moneda de la cuenta, un monto en USD.
  function montoDesdeUsd(monedaLeg: string, usd: number): number {
    if (!usd || usd <= 0) return 0;
    if (monedaLeg === 'USD' || monedaLeg === 'USDT') return round2(usd);
    if (monedaLeg === 'Bs') return tasa > 0 ? round2(usd * tasa) : 0;
    if (monedaLeg === 'COP') return mercado?.copUsd ? round2(usd * mercado.copUsd) : 0;
    return round2(usd);
  }
  const sumUsdCaja = round2(saldosCaja.reduce((a, s) => a + legUsd(s.moneda, Number(legMontos[s.id]) || 0), 0));
  // Patas extra (otras cajas): su equivalente en USD se suma al cubierto total.
  const extraSaldoDe = (saldoId: string) => todosSaldos.find((s) => s.id === saldoId) ?? null;
  const sumUsdExtra = round2(extraLegs.reduce((a, l) => {
    const s = extraSaldoDe(l.saldoId);
    return a + (s ? legUsd(s.moneda, Number(l.monto) || 0) : 0);
  }, 0));
  const sumUsdMulti = round2(sumUsdCaja + sumUsdExtra);
  const cubreTotalMulti = sumUsdMulti >= totalUsd - 0.01;
  // No se puede pagar más que el total de la OC (ni en multipago ni en pago simple).
  const excedeTotalMulti = sumUsdMulti > totalUsd + 0.01;
  const montoUsdSimple = moneda === 'Bs' ? (tasa > 0 ? round2(montoNum / tasa) : 0) : round2(montoNum);
  const excedeTotalSimple = !esMultimoneda && montoUsdSimple > totalUsd + 0.01;
  const excedeTotal = esMultimoneda ? excedeTotalMulti : excedeTotalSimple;

  // Prellenado del multipago. Reglas (para que un pago no se parta sin necesidad):
  //  1) Si UNA sola cuenta alcanza para todo el total → se paga solo de esa (un movimiento).
  //     Se prefiere una cuenta en la MONEDA de la orden y, entre las que alcanzan, la de menor
  //     saldo (deja intactas las cuentas grandes).
  //  2) Si ninguna sola alcanza → se reparte. Para órdenes en Bs el reparto es EXACTO en Bs
  //     (sin el round-trip Bs→$→Bs que dejaba centavos sin pagar), vaciando cada cuenta.
  //  3) Órdenes en $ → reparto en USD (como antes).
  const saldosKey = saldosCaja.map((s) => s.id).join('|');
  useEffect(() => {
    if (!saldosCaja.length || totalUsd <= 0) return;
    if (saldosCaja.some((s) => s.moneda === 'Bs') && !(tasa > 0)) return;
    if (saldosCaja.some((s) => s.moneda === 'COP') && !mercado?.copUsd) return;
    const next: Record<string, string> = {};

    // 1) ¿Alguna cuenta sola cubre todo? → un solo movimiento.
    const cubren = saldosCaja
      .filter((s) => legUsd(s.moneda, Number(s.saldo)) >= totalUsd - 0.01)
      .sort((a, b) => {
        const am = a.moneda === monedaOrden ? 0 : 1, bm = b.moneda === monedaOrden ? 0 : 1;
        if (am !== bm) return am - bm;                                   // primero la moneda de la orden
        return legUsd(a.moneda, Number(a.saldo)) - legUsd(b.moneda, Number(b.saldo)); // luego menor saldo
      });
    if (cubren.length) {
      const s = cubren[0];
      const monto = (esOrdenBs && s.moneda === 'Bs') ? round2(baseUsd) : montoDesdeUsd(s.moneda, totalUsd);
      next[s.id] = dosDecimales(String(monto));
      setLegMontos(next);
      return;
    }

    // 2) Ninguna sola alcanza. Orden en Bs → reparto EXACTO en Bs, vaciando cuentas.
    if (esOrdenBs) {
      let restanteBs = round2(baseUsd);
      const bsSaldos = saldosCaja.filter((s) => s.moneda === 'Bs').sort((a, b) => Number(b.saldo) - Number(a.saldo));
      const otras = saldosCaja.filter((s) => s.moneda !== 'Bs').sort((a, b) => legUsd(b.moneda, Number(b.saldo)) - legUsd(a.moneda, Number(a.saldo)));
      for (const s of bsSaldos) {
        if (restanteBs <= 0.001) break;
        const usa = Math.min(restanteBs, round2(Number(s.saldo)));
        next[s.id] = dosDecimales(String(round2(usa)));
        restanteBs = round2(restanteBs - usa);
      }
      let restanteUsd = tasa > 0 ? round2(restanteBs / tasa) : 0;
      for (const s of otras) {
        if (restanteUsd <= 0.01) break;
        const usaUsd = Math.min(restanteUsd, legUsd(s.moneda, Number(s.saldo)));
        next[s.id] = dosDecimales(String(montoDesdeUsd(s.moneda, usaUsd)));
        restanteUsd = round2(restanteUsd - usaUsd);
      }
      setLegMontos(next);
      return;
    }

    // 3) Orden en $ → reparto en USD (de mayor a menor saldo).
    let restante = totalUsd;
    const ordenadas = [...saldosCaja].sort((a, b) => legUsd(b.moneda, Number(b.saldo)) - legUsd(a.moneda, Number(a.saldo)));
    for (const s of ordenadas) {
      if (restante <= 0.01) break;
      const usaUsd = Math.min(restante, legUsd(s.moneda, Number(s.saldo)));
      next[s.id] = dosDecimales(String(montoDesdeUsd(s.moneda, usaUsd)));
      restante = round2(restante - usaUsd);
    }
    setLegMontos(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saldosKey, tasa, mercado, totalUsd]);

  // ¿El pago entrega USD físico (efectivo)? Solo entonces se piden los seriales de
  // los billetes. Simple: caja en USD. Multimoneda: pata USD con monto cargado.
  const pagaUsdEfectivo = esMultimoneda
    ? saldosCaja.some((s) => s.moneda === 'USD' && (Number(legMontos[s.id]) || 0) > 0)
    : moneda === 'USD' && montoNum > 0;

  function agregarSerial() {
    const v = serialInput.trim();
    if (!v) return;
    if (seriales.includes(v)) { setSerialInput(''); return; }
    setSeriales((xs) => [...xs, v]);
    setSerialInput('');
  }
  function quitarSerial(s: string) {
    setSeriales((xs) => xs.filter((x) => x !== s));
  }

  // Archivos cargados durante la OC: cotizaciones (PDF) de las ofertas.
  const [adjuntos, setAdjuntos] = useState<OfertaProveedor[]>([]);
  const [descargando, setDescargando] = useState<string | null>(null);
  useEffect(() => {
    listOfertasByOrden(o.id)
      .then((rows) => setAdjuntos(rows.filter((r) => r.pdf_path)))
      .catch(() => setAdjuntos([]));
  }, [o.id]);

  async function descargarAdjunto(path: string, id: string) {
    setDescargando(id);
    try {
      const url = await getPdfOfertaSignedUrl(path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch { toast('No se pudo abrir el archivo', 'error'); }
    finally { setDescargando(null); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!cajaId) { setError('Elegí la caja con la que se paga.'); return; }
    if (!comprobanteOpcional && !factura) { setError('Adjuntá el comprobante (PDF o imagen).'); return; }
    if (factura && factura.type && factura.type !== 'application/pdf' && !factura.type.startsWith('image/')) {
      setError('El comprobante debe ser un PDF o una imagen.'); return;
    }
    // Comisión bancaria (opcional): sale del saldo elegido de la MISMA caja.
    const comMontoNum = round2(Number(comisionMonto) || 0);
    let comision: { cajaId: string; cuenta: CuentaCaja; moneda: string; monto: number } | null = null;
    if (comMontoNum > 0 && saldosCaja.length) {
      const sc = saldosCaja.find((s) => s.id === comisionSaldoId) ?? saldosCaja[0];
      comision = { cajaId, cuenta: sc.cuenta as CuentaCaja, moneda: sc.moneda, monto: comMontoNum };
    }
    setSaving(true);
    try {
      if (esMultimoneda) {
        const legsCaja = saldosCaja
          .map((s) => ({ cajaId, cuenta: s.cuenta as CuentaCaja, moneda: s.moneda, monto: Number(legMontos[s.id]) || 0, montoUsd: legUsd(s.moneda, Number(legMontos[s.id]) || 0) }))
          .filter((l) => l.monto > 0);
        // Patas extra desde otras cajas (cada una sale de SU propia caja).
        const legsExtra = extraLegs
          .map((l) => { const s = extraSaldoDe(l.saldoId); return s ? { cajaId: s.caja_id, cuenta: s.cuenta as CuentaCaja, moneda: s.moneda, monto: Number(l.monto) || 0, montoUsd: legUsd(s.moneda, Number(l.monto) || 0) } : null; })
          .filter((l): l is NonNullable<typeof l> => !!l && l.monto > 0);
        const legs = [...legsCaja, ...legsExtra];
        if (!legs.length) { setError('Indicá cuánto pagar en al menos una moneda.'); setSaving(false); return; }
        if (excedeTotalMulti) { setError(`No podés pagar más que el total de la OC. Cargado ${monto(enMonedaOrden(sumUsdMulti), monedaOrden)}, total ${monto(enMonedaOrden(totalUsd), monedaOrden)} (te pasaste por ${monto(enMonedaOrden(round2(sumUsdMulti - totalUsd)), monedaOrden)}).`); setSaving(false); return; }
        if (!cubreTotalMulti) { setError(`Lo cargado (${monto(enMonedaOrden(sumUsdMulti), monedaOrden)}) no cubre el total (${monto(enMonedaOrden(totalUsd), monedaOrden)}).`); setSaving(false); return; }
        await pagarOrdenCompraMulti({ orden: o, cajaId, legs, factura, motivoPago: motivoPago || null, seriales: pagaUsdEfectivo ? seriales : null, gastoCategoria: gCatNombre, gastoSubcategoria: gSubNombre, comision, actorEmail: actor, actorName });
        notify(`OC ${o.oc_codigo ?? o.codigo} pagada · multipago ${monto(enMonedaOrden(sumUsdMulti), monedaOrden)}`, 'success', { link: '#/app/tesoreria' });
        onPaid();
        return;
      }
      if (excedeTotalSimple) { setError(`No podés pagar más que el total de la OC (${monto(enMonedaOrden(totalUsd), monedaOrden)}). El monto ingresado equivale a ${monto(enMonedaOrden(montoUsdSimple), monedaOrden)}.`); setSaving(false); return; }
      await pagarOrdenCompra({
        orden: o, cajaId, monto: Number(montoStr) || 0,
        factura, motivoPago: motivoPago || null, seriales: pagaUsdEfectivo ? seriales : null,
        gastoCategoria: gCatNombre, gastoSubcategoria: gSubNombre, comision, actorEmail: actor, actorName,
      });
      notify(`OC ${o.oc_codigo ?? o.codigo} pagada · ${monto(Number(montoStr) || 0, moneda)}`, 'success', { link: '#/app/tesoreria' });
      onPaid();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo pagar.'); setSaving(false); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={() => import('@/modules/pedidos/ordenCompraPdf').then(({ descargarOrdenCompraPdf }) => descargarOrdenCompraPdf(o.id)).catch(() => toast('No se pudo generar el PDF', 'error'))}>↓ OC PDF</button>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>{row.esperandoMetodo ? 'Cerrar' : 'Cancelar'}</button>
      {!row.esperandoMetodo && (
        <button type="submit" form="pagar-oc" className="btn btn-primary" disabled={saving || excedeTotal}>{saving ? 'Pagando…' : excedeTotal ? 'Excede el total de la OC' : `PAGAR ORDEN · ${esMultimoneda ? monto(enMonedaOrden(sumUsdMulti), monedaOrden) : monto(Number(montoStr) || 0, moneda)}`}</button>
      )}
    </>
  );

  return (
    <Modal title={o.clase === 'servicio' ? `Pagar SERVICIO ${o.codigo}` : `Pagar OC ${o.oc_codigo ?? o.codigo}`} size="lg" onClose={() => !saving && onClose()} footer={footer}>
      <form id="pagar-oc" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        {row.esperandoMetodo && (
          <div className="card" style={{ marginBottom: '.75rem', borderLeft: '3px solid var(--warning)', background: 'var(--bg-1)' }}>
            <div style={{ fontSize: '.86rem' }}>
              ⏳ <strong>Esperando método de pago.</strong> Esta OC ya fue aprobada por el Gerente y muestra el monto a pagar
              (<strong className="mono">{monto(row.montoAPagar, 'USD')}</strong>), pero el <strong>analista de compras</strong> debe
              indicar el método de pago. Cuando lo haga, se habilita el pago acá automáticamente.
            </div>
          </div>
        )}

        {/* Trazabilidad: de la OP a la confirmación, con fechas */}
        <div className="card" style={{ marginBottom: '.75rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}>Detalle de la orden</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.35rem .9rem', fontSize: '.84rem' }}>
            <div><span className="muted">{o.clase === 'servicio' ? 'Solicitud:' : 'OP:'}</span> <strong className="mono">{o.codigo}</strong></div>
            <div><span className="muted">{o.clase === 'servicio' ? 'Tipo:' : 'N°ODC:'}</span>{' '}
              {o.clase === 'servicio'
                ? <span className="badge" style={{ background: '#7c5cff', color: '#fff', fontWeight: 700 }}>🔧 SERVICIO</span>
                : <strong className="mono">{o.oc_codigo ?? '—'}</strong>}
            </div>
            <div><span className="muted">Proveedor:</span> {row.proveedorNombre}</div>
            <div><span className="muted">Unidad solicitante:</span> {o.solicitante || '—'}</div>
            <div><span className="muted">Solicitante:</span> {o.solicitante_persona || o.ci_solicitante || o.solicitante_email || '—'}</div>
            <div><span className="muted">Creada (OP):</span> {dateTime(o.created_at)}</div>
            <div><span className="muted">Aprobada (OP):</span> {o.aprobada_en ? dateTime(o.aprobada_en) : '—'}</div>
            <div><span className="muted">OC creada:</span> {o.oc_creada_en ? dateTime(o.oc_creada_en) : '—'}</div>
            <div><span className="muted">OC confirmada:</span> {o.oc_aprobada_en ? dateTime(o.oc_aprobada_en) : '—'}</div>
            <div><span className="muted">Condición de pago:</span>{' '}
              <span className="badge" style={{ background: 'var(--primary-2)', color: '#fff', fontWeight: 600 }}>
                {o.condiciones_pago ? labelCondicionPago(o.condiciones_pago) : 'Contado / anticipado'}
              </span>
            </div>
            {resumenFinalidad && <div style={{ gridColumn: '1 / -1' }}><span className="muted">Finalidad:</span> {resumenFinalidad}</div>}
            {o.notas && <div style={{ gridColumn: '1 / -1' }}><span className="muted">Notas:</span> {o.notas}</div>}
            {o.motivo && o.motivo !== o.notas && <div style={{ gridColumn: '1 / -1' }}><span className="muted">Motivo:</span> {o.motivo}</div>}
          </div>
        </div>

        {/* Observación del analista al elegir la oferta (por qué la eligió) + adjuntos. */}
        {(o.oferta_motivo || (o.oferta_motivo_adjuntos && o.oferta_motivo_adjuntos.length > 0)) && (
          <div className="card" style={{ marginBottom: '.75rem', borderLeft: '3px solid var(--primary)' }}>
            <div className="card-title" style={{ marginBottom: '.4rem' }}>📝 Por qué se eligió esta oferta</div>
            {o.oferta_motivo && <div style={{ fontSize: '.86rem', whiteSpace: 'pre-wrap' }}>{o.oferta_motivo}</div>}
            {o.oferta_motivo_adjuntos && o.oferta_motivo_adjuntos.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem', marginTop: '.4rem' }}>
                {o.oferta_motivo_adjuntos.map((a, i) => (
                  <button key={a.path ?? i} type="button" className="btn btn-sm btn-ghost" style={{ padding: '.1rem .4rem' }}
                    onClick={() => getPdfOfertaSignedUrl(a.path).then((u) => window.open(u, '_blank', 'noopener')).catch(() => toast('No se pudo abrir el adjunto', 'error'))}
                    title={a.filename}>📎 {a.filename ?? `Adjunto ${i + 1}`}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {!row.esperandoMetodo && (<>
        {pagoParcial && (
          <div className="card" style={{ marginBottom: '.75rem', borderLeft: '3px solid var(--warning)', background: 'var(--bg-1)' }}>
            <div style={{ fontSize: '.84rem' }}>
              <strong>Pago por monto recibido (recepción parcial).</strong> De {monto(o.total, o.moneda ?? 'USD')} pedidos
              se recibieron {monto(Number(o.recibido_total), 'USD')}; se paga solo lo recibido.
              {o.nota_recepcion && <div className="muted" style={{ marginTop: '.2rem' }}>Nota: {o.nota_recepcion}</div>}
            </div>
          </div>
        )}

        {/* Precio en divisa efectivo: pagar el monto con descuento en vez del BCV general. */}
        {puedeEfectivo && (
          <div className="card" style={{ marginBottom: '.75rem', borderLeft: '3px solid var(--success)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontSize: '.88rem', fontWeight: 600 }}>
              <input type="checkbox" checked={usarEfectivo} onChange={(e) => setUsarEfectivo(e.target.checked)} />
              💵 Pagar al precio en divisa efectivo (con descuento)
            </label>
            <div className="muted" style={{ fontSize: '.78rem', marginTop: '.25rem' }}>
              Precio general (BCV): <strong className="mono">{monto(baseGeneral, 'USD')}</strong>
              {ahorroSnap && <> · el proveedor ofreció <strong className="mono" style={{ color: 'var(--success)' }}>{monto(efectivoSnap, 'USD')}</strong> en efectivo (−{ahorroSnap.pct.toFixed(2)}%)</>}
            </div>
            {usarEfectivo && (
              <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '.4rem' }}>
                <div className="form-row" style={{ margin: 0 }}>
                  <label style={{ fontSize: '.78rem' }}>Descuento %</label>
                  <input className="input mono" type="number" min={0} max={99} step="any" value={pctEfStr} onChange={(e) => setPctEfStr(e.target.value)} style={{ width: 120 }} placeholder="0" />
                </div>
                <div style={{ fontSize: '.85rem', paddingBottom: '.4rem' }}>
                  Precio efectivo a pagar: <strong className="mono" style={{ color: 'var(--success)' }}>{monto(efectivoCalc, 'USD')}</strong>
                  {efectivoCalc < baseGeneral && <span className="muted"> · ahorro {monto(round2(baseGeneral - efectivoCalc), 'USD')}</span>}
                </div>
              </div>
            )}
            {usarEfectivo && efectivoCalc >= baseGeneral && (
              <div style={{ fontSize: '.76rem', marginTop: '.3rem', color: 'var(--warning)' }}>Ingresá un % de descuento mayor a 0 (el precio efectivo debe ser menor al general).</div>
            )}
          </div>
        )}

        {/* Método de pago indicado en Compras (multipago) */}
        {o.metodo_pago && o.metodo_pago.length > 0 && (
          <div className="card" style={{ marginBottom: '.75rem' }}>
            <div className="card-title" style={{ marginBottom: '.4rem' }}>Método de pago indicado{comprobanteOpcional ? ' · efectivo (sin comprobante)' : ''}</div>
            {o.metodo_pago.map((m, i) => (
              <div key={i} style={{ padding: '.15rem 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem' }}>
                  <span>{labelMetodoPago(m.metodo)}</span>
                  <strong className="mono">{m.monto > 0 ? monto(m.monto, m.moneda) : m.moneda}</strong>
                </div>
                {m.datos && Object.keys(m.datos).length > 0 && (
                  <div className="muted" style={{ fontSize: '.74rem', paddingLeft: '.3rem' }}>↳ {resumenDatosPago(m.metodo, m.datos)}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Imagen / QR de pago cargado al indicar el método (ej. QR de Binance): escanear y pagar. */}
        {o.pago_qr_path && (
          <div className="card" style={{ marginBottom: '.75rem', borderColor: 'var(--brand, #ff8a00)' }}>
            <div className="card-title" style={{ marginBottom: '.4rem' }}>📷 QR / imagen de pago <span className="muted" style={{ fontWeight: 400, fontSize: '.78rem' }}>· escaneá y pagá</span></div>
            {qrUrl ? (
              <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <a href={qrUrl} target="_blank" rel="noopener noreferrer" title="Abrir en grande para escanear">
                  <img src={qrUrl} alt="QR de pago" style={{ width: 180, height: 180, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--border)', background: '#fff' }} />
                </a>
                <div style={{ fontSize: '.8rem' }}>
                  <div className="muted">{o.pago_qr_nombre ?? 'QR de pago'}</div>
                  <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: '.4rem' }} onClick={() => window.open(qrUrl, '_blank', 'noopener')}>🔍 Ver en grande</button>
                </div>
              </div>
            ) : (
              <div className="muted" style={{ fontSize: '.8rem' }}>Cargando imagen…</div>
            )}
          </div>
        )}

        {/* Soporte / Retención: tipo y comprobantes (descarga) — reflejo del módulo Retenciones */}
        {o.comprobante_tipo && (
          <div className="card" style={{ marginBottom: '.75rem' }}>
            <div className="card-title" style={{ marginBottom: '.4rem' }}>Soporte / Retención</div>
            <div style={{ fontSize: '.85rem' }}>
              Soporte: <strong>{o.comprobante_tipo === 'factura' ? 'Factura' : 'Nota de entrega'}</strong>
              {o.comprobante_tipo === 'factura' && <> · Retención: <strong>{labelRetencionModo(o.retencion_modo)}</strong>{o.retencion_pagada ? <span className="badge" style={{ marginLeft: '.4rem', color: 'var(--success)' }}>✓ pagada</span> : null}</>}
            </div>
            {comprobantesDeOrden(o).length > 0 ? (
              <div style={{ display: 'grid', gap: '.3rem', marginTop: '.4rem' }}>
                {comprobantesDeOrden(o).map((c) => (
                  <div key={c.tipo} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', fontSize: '.82rem' }}>
                    <span><span className="badge">{c.label}</span> <span className="muted">{c.nombre}</span></span>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => urlRetencion(c.path).then((u) => window.open(u, '_blank', 'noopener')).catch(() => toast('No se pudo abrir el comprobante', 'error'))}>📎 Descargar</button>
                  </div>
                ))}
              </div>
            ) : o.comprobante_tipo === 'factura' ? (
              <div className="muted" style={{ fontSize: '.78rem', marginTop: '.3rem' }}>Retención aún no cargada en el módulo Retenciones.</div>
            ) : null}
          </div>
        )}

        <div className="table-wrap" style={{ marginBottom: '.75rem' }}>
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead><tr><th>SKU</th><th>Producto</th><th style={{ textAlign: 'right' }}>Cant.</th><th style={{ textAlign: 'right' }}>Precio</th><th style={{ textAlign: 'right' }}>Subtotal</th></tr></thead>
            <tbody>
              {(o.items ?? []).map((it, i) => (
                <tr key={`${it.sku}-${i}`}>
                  <td className="mono">{it.sku}</td><td>{it.nombre}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{it.cantidad}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{monto(it.precio, o.moneda ?? 'USD')}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{monto(it.cantidad * it.precio, o.moneda ?? 'USD')}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4} style={{ textAlign: 'right' }}><strong>TOTAL</strong></td><td className="mono" style={{ textAlign: 'right' }}><strong>{monto(o.total, o.moneda ?? 'USD')}</strong></td></tr></tfoot>
          </table>
        </div>

        {/* Conversión $ ⇄ Bs con la tasa BCV del día (editable). */}
        <div className="card" style={{ marginBottom: '.75rem', borderColor: 'var(--brand, #ff8a00)' }}>
          <div className="card-title" style={{ marginBottom: '.5rem' }}>Conversión del total</div>
          <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <div className="muted" style={{ fontSize: '.72rem' }}>Total en USD</div>
              <strong className="mono" style={{ fontSize: '1.15rem' }}>{monto(totalUsd, 'USD')}</strong>
            </div>
            <div style={{ fontSize: '1.2rem' }} className="muted">⇄</div>
            <div>
              <div className="muted" style={{ fontSize: '.72rem' }}>Equivale en Bs</div>
              <strong className="mono" style={{ fontSize: '1.15rem' }}>{tasa > 0 ? monto(totalBs, 'Bs') : '—'}</strong>
            </div>
            <div className="form-row" style={{ marginLeft: 'auto', minWidth: 160 }}>
              <label style={{ fontSize: '.72rem' }}>Tasa BCV (Bs por $){tasaFecha ? ` · ${fmtDate(tasaFecha)}` : ''}</label>
              <input className="input mono" type="number" min={0} step="any" value={tasa || ''}
                onChange={(e) => setTasa(Number(e.target.value) || 0)} placeholder={tasaLista ? '0,00' : 'cargando…'} />
            </div>
          </div>
        </div>

        {/* Archivos cargados durante la OC (cotizaciones de los proveedores). */}
        {adjuntos.length > 0 && (
          <div className="card" style={{ marginBottom: '.75rem' }}>
            <div className="card-title" style={{ marginBottom: '.4rem' }}>Archivos de la OC (cotizaciones)</div>
            {adjuntos.map((of) => (
              <div key={of.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', padding: '.25rem 0' }}>
                <span style={{ fontSize: '.84rem' }}>
                  {of.estado === 'aceptada' ? '✅ ' : '📄 '}
                  {of.pdf_filename ?? 'Cotización.pdf'}
                  <span className="muted"> · {monto(of.precio_total, 'USD')}{of.estado === 'aceptada' ? ' · elegida' : ''}</span>
                </span>
                <button type="button" className="btn btn-sm btn-ghost" disabled={descargando === of.id}
                  onClick={() => descargarAdjunto(of.pdf_path!, of.id)}>
                  {descargando === of.id ? 'Abriendo…' : '↓ Descargar'}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="form-grid">
          <div className="form-row">
            <label>Caja (de dónde sale el dinero)</label>
            <select className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)} required>
              {!cajas.length && <option value="">— sin cajas —</option>}
              {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <small className="muted">Se descuenta de esta caja y queda registrado en el registro de movimientos (pago de compra).{esMultimoneda ? ' Abajo elegís de qué cuentas (con saldo) sale el dinero.' : ''}</small>
          </div>
          {!esMultimoneda && (
            <div className="form-row">
              <label>Monto a pagar ({moneda})</label>
              <input className="input mono" type="number" min={0} step="any" value={montoStr} onChange={(e) => setMontoStr(dosDecimales(e.target.value))} required={!esMultimoneda}
                style={{ borderColor: excedeTotalSimple ? 'var(--danger)' : undefined }} />
              {excedeTotalSimple && (
                <small style={{ color: 'var(--danger)' }}>⚠ No podés pagar más que el total de la OC ({monto(totalUsd, 'USD')}{moneda === 'Bs' && tasa > 0 ? ` ≈ ${monto(aBs(totalUsd, tasa), 'Bs')}` : ''}).</small>
              )}
              {tasa > 0 && montoNum > 0 && (
                <small className="muted">
                  Equivale a <strong className="mono">{monto(equivOtra, moneda === 'Bs' ? 'USD' : 'Bs')}</strong>
                  {moneda === 'Bs'
                    ? ` · ${monto(montoNum, 'Bs')} ÷ ${tasa.toLocaleString('es-VE')}`
                    : ` · ${monto(montoNum, 'USD')} × ${tasa.toLocaleString('es-VE')}`}
                </small>
              )}
              {moneda === 'Bs' && <small className="muted">Se autocompletó con la tasa BCV; podés ajustarlo.</small>}
            </div>
          )}
        </div>

        {/* Multipago por cuenta: repartí el total entre las monedas de la caja Multimoneda. */}
        {esMultimoneda && (
          <div className="card" style={{ marginBottom: '.75rem', borderColor: 'var(--brand, #ff8a00)' }}>
            <div className="card-title" style={{ marginBottom: '.4rem' }}>Multipago por cuenta · ¿cuánto sale de cada moneda?</div>
            <div className="table-wrap">
              <table className="table" style={{ fontSize: '.84rem' }}>
                <thead><tr><th>Moneda</th><th style={{ textAlign: 'right' }}>Disponible</th><th style={{ textAlign: 'right' }}>A pagar (en su moneda)</th><th style={{ textAlign: 'right' }}>Equiv. USD</th></tr></thead>
                <tbody>
                  {saldosCaja.map((s) => {
                    const n = Number(legMontos[s.id]) || 0;
                    const excede = n > Number(s.saldo);
                    const etiquetaCuenta = s.cuenta === 'general' ? '' : s.cuenta === 'juridica' ? ' · Jurídica' : ' · Personal';
                    return (
                      <tr key={s.id}>
                        <td><span className="badge">{s.moneda}</span>{etiquetaCuenta}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{monto(Number(s.saldo), s.moneda)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <input className="input mono" type="number" min={0} max={Number(s.saldo)} step="any"
                            value={legMontos[s.id] ?? ''} placeholder="0,00"
                            onChange={(e) => setLegMontos((m) => ({ ...m, [s.id]: dosDecimales(e.target.value) }))}
                            style={{ width: 130, textAlign: 'right', borderColor: excede ? 'var(--danger)' : undefined }} />
                        </td>
                        <td className="mono" style={{ textAlign: 'right' }}>{n > 0 ? monto(legUsd(s.moneda, n), 'USD') : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'right', fontWeight: 600 }}>Cubierto / Total</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: excedeTotalMulti ? 'var(--danger)' : cubreTotalMulti ? 'var(--success)' : 'var(--warning)' }}>
                      {monto(enMonedaOrden(sumUsdMulti), monedaOrden)} / {monto(enMonedaOrden(totalUsd), monedaOrden)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <small className="muted" style={{ display: 'block', marginTop: '.3rem' }}>
              {excedeTotalMulti
                ? <span style={{ color: 'var(--danger)' }}>⚠ Te pasaste por <strong>{monto(enMonedaOrden(round2(sumUsdMulti - totalUsd)), monedaOrden)}</strong>. No podés pagar más que el total de la OC ({monto(enMonedaOrden(totalUsd), monedaOrden)}).</span>
                : cubreTotalMulti
                ? <>✓ Cubre exactamente el total. Cada moneda se descuenta de su saldo real con la tasa del día.</>
                : <>Faltan <strong>{monto(enMonedaOrden(round2(totalUsd - sumUsdMulti)), monedaOrden)}</strong>. Bs↔$ usa la tasa BCV de arriba.</>}
            </small>

            {/* Patas EXTRA desde otras cajas: cuando la caja elegida no alcanza, se
                completa con cuentas de otras cajas (cada una sale de su propia caja). */}
            {extraLegs.length > 0 && (
              <div className="table-wrap" style={{ marginTop: '.5rem' }}>
                <table className="table" style={{ fontSize: '.84rem' }}>
                  <thead><tr><th>Otra caja · cuenta</th><th style={{ textAlign: 'right' }}>Disponible</th><th style={{ textAlign: 'right' }}>A pagar</th><th style={{ textAlign: 'right' }}>Equiv. USD</th><th></th></tr></thead>
                  <tbody>
                    {extraLegs.map((l) => {
                      const s = extraSaldoDe(l.saldoId);
                      const n = Number(l.monto) || 0;
                      const excede = !!s && n > Number(s.saldo);
                      const cuentaLbl = (c: string) => c === 'general' ? '' : c === 'juridica' ? ' · Jurídica' : c === 'personal' ? ' · Personal' : ` · ${c}`;
                      return (
                        <tr key={l.id}>
                          <td>
                            <select className="select" style={{ minWidth: 200 }} value={l.saldoId}
                              onChange={(e) => setExtraLegs((xs) => xs.map((x) => x.id === l.id ? { ...x, saldoId: e.target.value } : x))}>
                              <option value="">— elegí caja y cuenta —</option>
                              {saldosOtrasCajas.map((o) => (
                                <option key={o.id} value={o.id}>{o.caja?.nombre ?? 'Caja'} · {o.moneda}{cuentaLbl(o.cuenta)} · {monto(Number(o.saldo), o.moneda)}</option>
                              ))}
                            </select>
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>{s ? monto(Number(s.saldo), s.moneda) : '—'}</td>
                          <td style={{ textAlign: 'right' }}>
                            <input className="input mono" type="number" min={0} max={s ? Number(s.saldo) : undefined} step="any"
                              value={l.monto} placeholder="0,00" disabled={!s}
                              onChange={(e) => setExtraLegs((xs) => xs.map((x) => x.id === l.id ? { ...x, monto: dosDecimales(e.target.value) } : x))}
                              style={{ width: 130, textAlign: 'right', borderColor: excede ? 'var(--danger)' : undefined }} />
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>{s && n > 0 ? monto(legUsd(s.moneda, n), 'USD') : '—'}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExtraLegs((xs) => xs.filter((x) => x.id !== l.id))}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {saldosOtrasCajas.length > 0 && (
              <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: '.4rem' }}
                onClick={() => setExtraLegs((xs) => [...xs, { id: extraSeq.current++, saldoId: '', monto: '' }])}>
                ＋ Añadir cuenta de otra caja
              </button>
            )}
          </div>
        )}
        {/* Seriales de los billetes entregados (solo al pagar con USD físico). */}
        {pagaUsdEfectivo && (
          <div className="card" style={{ marginBottom: '.75rem', borderColor: 'var(--brand, #ff8a00)' }}>
            <div className="card-title" style={{ marginBottom: '.4rem' }}>
              Seriales de los billetes entregados <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span>
            </div>
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-row" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
                <label style={{ fontSize: '.72rem' }}>Serial del billete</label>
                <input className="input mono" value={serialInput}
                  onChange={(e) => setSerialInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarSerial(); } }}
                  placeholder="Ej.: AB 1234567 C" />
              </div>
              <button type="button" className="btn btn-ghost" onClick={agregarSerial}>+ Agregar</button>
            </div>
            {seriales.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', marginTop: '.5rem' }}>
                {seriales.map((s, i) => (
                  <span key={s} className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', background: 'var(--bg-1)' }}>
                    <span className="muted">{i + 1}.</span><span className="mono">{s}</span>
                    <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 .25rem', lineHeight: 1 }}
                      title="Quitar" onClick={() => quitarSerial(s)}>✕</button>
                  </span>
                ))}
                <span className="muted" style={{ alignSelf: 'center', fontSize: '.8rem' }}>{seriales.length} billete(s)</span>
              </div>
            ) : (
              <small className="muted" style={{ display: 'block', marginTop: '.4rem' }}>
                Agregá un serial por billete. Quedan registrados con el pago.
              </small>
            )}
          </div>
        )}

        <div className="form-grid">
          <div className="form-row">
            <label>Comprobante (PDF o imagen) {comprobanteOpcional ? '(opcional)' : '*'}</label>
            <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setFactura(e.target.files?.[0] ?? null)} required={!comprobanteOpcional} />
            {factura && <small className="muted">{factura.name}</small>}
            {comprobanteOpcional && <small className="muted">Pago en efectivo: el comprobante no es obligatorio.</small>}
          </div>
          <div className="form-row">
            <label>Motivo del pago</label>
            <input className="input" value={motivoPago} onChange={(e) => setMotivoPago(e.target.value)} placeholder="Nota del pago (opcional)" />
            <small className="muted">Se suma al motivo de la OP en el registro de movimientos.</small>
          </div>
        </div>

        {/* Comisión bancaria (opcional): egreso extra de la caja, NO suma a la factura. */}
        {saldosCaja.length > 0 && (
          <div className="form-row">
            <label>Comisión bancaria <span className="muted" style={{ fontWeight: 400 }}>(opcional · se descuenta de la caja, no suma a la factura)</span></label>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input mono" type="number" min={0} step="any" value={comisionMonto} placeholder="0,00"
                onChange={(e) => setComisionMonto(dosDecimales(e.target.value))} style={{ maxWidth: 140, textAlign: 'right' }} />
              {(Number(comisionMonto) || 0) > 0 && (
                <select className="select" style={{ maxWidth: 260 }} value={comisionSaldoId || saldosCaja[0]?.id || ''} onChange={(e) => setComisionSaldoId(e.target.value)}>
                  {saldosCaja.map((s) => <option key={s.id} value={s.id}>{s.moneda}{s.cuenta ? ` · ${s.cuenta}` : ''} · disp. {monto(Number(s.saldo), s.moneda)}</option>)}
                </select>
              )}
            </div>
            {(Number(comisionMonto) || 0) > 0 && (
              <small className="muted">Se registra como un egreso aparte (Comisión bancaria) en el Libro Mayor. El pago de la factura no cambia.</small>
            )}
          </div>
        )}

        {/* Anclaje opcional a un gasto: categoría → subcategoría (buscables). */}
        <div className="card" style={{ marginTop: '.25rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}>Anclar a un gasto <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></div>
          <div className="form-grid">
            <div className="form-row">
              <label>Categoría de gasto</label>
              <SearchSelect
                value={gCatId}
                onChange={setGCatId}
                options={gCategorias.map((c) => ({ value: c.id, label: c.nombre }))}
                placeholder="Buscar categoría…"
                emptyText="Sin categorías. Cargalas en 'Categorías de gasto'."
              />
            </div>
            <div className="form-row">
              <label>Subcategoría</label>
              <SearchSelect
                value={gSubId}
                onChange={setGSubId}
                options={gSubcats.map((s) => ({ value: s.id, label: s.nombre }))}
                placeholder={gCatId ? 'Buscar subcategoría…' : 'Elegí primero la categoría'}
                emptyText={gCatId ? 'Esta categoría no tiene subcategorías.' : 'Elegí primero la categoría.'}
              />
            </div>
          </div>
          <small className="muted">Clasifica el egreso como gasto (categoría/subcategoría); queda visible y filtrable en el registro de movimientos.</small>
        </div>
        </>)}
      </form>

      {/* Chat por OC: mismo hilo que ve el analista de compras en Pedidos. Tesorería lo
          usa para coordinar el método de pago antes de pagar. */}
      <ChatOC
        ordenId={o.id}
        ordenCodigo={o.oc_codigo ?? o.codigo}
        userId={userId}
        autorEmail={actor}
        autorNombre={actorName ?? actor}
      />
    </Modal>
  );
}
