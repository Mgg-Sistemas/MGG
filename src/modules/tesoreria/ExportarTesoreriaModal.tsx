/* ============================================================
   MGG · Tesorería · «Descargar Reporte de Tesorería» (03-11-2026)
   Traído de Golden Touch (ExportarTesoreriaModal.tsx, 02-11-2026) a pedido
   de la administradora: el mismo reporte de allá, con los estilos de MGG
   (card, chip, btn, input, table… del tema; sin los temas de GT).
   - Ámbito: Movimientos de caja · Pendientes por pagar · Cuentas a crédito.
   - Rango de fechas con atajos; dimensión principal (agrupar por);
     valuación con tasa BCV del día o histórica, interruptores de $ y Bs.
   - Filtros por categorías, proveedores, tipos, cajas, monedas y estados.
   - Columnas por casillas; Fichas o Tabla; orientación; orden; resumen.
   - Vista previa en vivo y salidas CSV / Excel / WhatsApp / PDF, SOLO al
     tocar el botón (nada se descarga ni se manda solo).
   Los datos se leen de Supabase por páginas (reporteTesoreria.repository) y
   se recargan en vivo (realtime). Las preferencias de pantalla quedan en el
   navegador (comodidad de cada usuario, no son datos).
   Reemplaza los viejos «↓ Resumen PDF» de Tesorería (03-11-2026).
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { mensajeError } from '@/shared/lib/errores';
import { useRealtime } from '@/shared/lib/useRealtime';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import type { MovimientoCaja } from '@/shared/lib/types';
import { listOrdenesPorPagar, listOrdenesEnCredito, type OrdenPorPagar } from '@/modules/pedidos/pedidos.repository';
import { cargarDirectosPorPagar, type DirectoFila } from '@/modules/pedidos/DirectosPorPagarModal';
import { getTasaHoy, hoyVE } from './tasas.repository';
import type { CuentaPorPagar } from './cuentasPorPagar.repository';
import type { CuentaPorCobrar } from './cuentasPorCobrar.repository';
import {
  listMovimientosReporte, tasasUsdDelRango,
  listCuentasPorPagarAbiertasReporte, listCuentasPorCobrarAbiertasReporte,
} from './reporteTesoreria.repository';
import {
  CAMPOS_REPORTE_TESORERIA,
  CAMPOS_POR_DEFECTO_POR_MODO,
  ETIQUETA_FLUJO,
  PRESETS_RANGO_TESORERIA,
  rangoPresetTesoreria,
  normalizarMovimientosTesoreria,
  normalizarPendientesPorPagar,
  normalizarCreditosCartera,
  filtrarFilasTesoreria,
  procesarFilasReporteTesoreria,
  obtenerMetricasFichaTesoreria,
  type ContextoTasas,
  type AmbitoTesoreria,
  type ModoAgrupacionTesoreria,
  type BaseTasaTesoreria,
  type TipoFlujoTesoreria,
  type FilaReporteTesoreria,
  type OrdenReporteTesoreria,
} from './reporteTesoreriaMoldeable';
import {
  columnasVisiblesTesoreria,
  textoCeldaTesoreria,
  descargarTesoreriaCsv,
  descargarTesoreriaExcel,
  descargarTesoreriaPdf,
  type MetadatosExportacionTesoreria,
} from './exportarTesoreria';
import { textoWhatsappTesoreria } from './whatsappTesoreria';

const CLAVE_PREFS = 'mgg.tesoreria.reporte.v1';

const AMBITOS: { id: AmbitoTesoreria; icon: string; label: string }[] = [
  { id: 'movimientos', icon: '📒', label: 'Movimientos de caja' },
  { id: 'por_pagar', icon: '📄', label: 'Pendientes por pagar' },
  { id: 'creditos_cartera', icon: '🤝', label: 'Cuentas a crédito' },
];

const MODOS: { id: ModoAgrupacionTesoreria; icon: string; label: string }[] = [
  { id: 'caja', icon: '🏦', label: 'Por Caja' },
  { id: 'moneda', icon: '💱', label: 'Por Moneda' },
  { id: 'tipo_movimiento', icon: '🔀', label: 'Por Tipo' },
  { id: 'categoria_gasto', icon: '🔖', label: 'Por Categoría' },
  { id: 'contraparte', icon: '👤', label: 'Por Proveedor' },
  { id: 'origen_documento', icon: '📑', label: 'Por Documento' },
  { id: 'dia', icon: '📆', label: 'Por Día' },
  { id: 'mes', icon: '📅', label: 'Por Mes' },
  { id: 'detallado', icon: '📋', label: 'Detallado' },
];

const TIPOS_FLUJO: TipoFlujoTesoreria[] = ['egreso', 'ingreso', 'traslado'];

type SeccionFiltro = 'categorias' | 'contrapartes' | 'tipos' | 'cajas' | 'monedas' | 'estados';

/** Tablas que mueven cada ámbito (recarga en vivo). */
const TABLAS_REALTIME: Record<AmbitoTesoreria, string[]> = {
  movimientos: ['movimientos_caja'],
  por_pagar: ['ordenes', 'compras_directas', 'servicios_directos'],
  creditos_cartera: ['ordenes', 'cuentas_por_pagar', 'cuentas_por_cobrar'],
};

interface Prefs {
  ambito: AmbitoTesoreria;
  agrupacion: ModoAgrupacionTesoreria;
  campos: string[];
  baseTasa: BaseTasaTesoreria;
  mostrarUsd: boolean;
  mostrarBs: boolean;
  incluirResumen: boolean;
  kpisSimplificados: boolean;
}

function leerPrefs(): Prefs {
  const def: Prefs = {
    ambito: 'movimientos', agrupacion: 'categoria_gasto', campos: CAMPOS_POR_DEFECTO_POR_MODO.categoria_gasto,
    baseTasa: 'bcv_dia', mostrarUsd: true, mostrarBs: true, incluirResumen: true, kpisSimplificados: false,
  };
  try {
    const p = JSON.parse(localStorage.getItem(CLAVE_PREFS) ?? 'null') as Partial<Prefs> | null;
    if (!p || typeof p !== 'object') return def;
    const claves = new Set(CAMPOS_REPORTE_TESORERIA.map((c) => c.clave));
    return {
      ambito: AMBITOS.some((a) => a.id === p.ambito) ? (p.ambito as AmbitoTesoreria) : def.ambito,
      agrupacion: MODOS.some((m) => m.id === p.agrupacion) ? (p.agrupacion as ModoAgrupacionTesoreria) : def.agrupacion,
      campos: Array.isArray(p.campos) && p.campos.length ? p.campos.filter((c) => claves.has(c)) : def.campos,
      baseTasa: p.baseTasa === 'historica' ? 'historica' : 'bcv_dia',
      mostrarUsd: typeof p.mostrarUsd === 'boolean' ? p.mostrarUsd : true,
      mostrarBs: typeof p.mostrarBs === 'boolean' ? p.mostrarBs : true,
      incluirResumen: typeof p.incluirResumen === 'boolean' ? p.incluirResumen : true,
      kpisSimplificados: p.kpisSimplificados === true,
    };
  } catch {
    return def;
  }
}

function guardarPrefs(p: Prefs): void {
  try { localStorage.setItem(CLAVE_PREFS, JSON.stringify(p)); } catch { /* no crítico */ }
}

const fmt2 = (v: number) => v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUsd = (v: number) => `$ ${fmt2(v)}`;
const fmtBs = (v: number) => `Bs ${fmt2(v)}`;
const fmtFechaCorta = (f: string) => { const [y, m, d] = (f || '').split('-'); return y && m && d ? `${d}/${m}` : f; };

/** Color de acento por tipo de flujo (variables del tema de MGG). */
const ACENTO_FLUJO: Record<TipoFlujoTesoreria, string> = {
  egreso: 'var(--primary)',
  ingreso: 'var(--success)',
  traslado: 'var(--info)',
};

interface Props {
  ambitoInicial?: AmbitoTesoreria;
  rangoInicial?: { desde: string; hasta: string };
  onClose: () => void;
}

export function ExportarTesoreriaModal({ ambitoInicial, rangoInicial, onClose }: Props) {
  const prefs = useMemo(() => leerPrefs(), []);
  const hoy = hoyVE();

  const [desde, setDesde] = useState<string>(() => rangoInicial?.desde || rangoPresetTesoreria('mes', hoy).desde);
  const [hasta, setHasta] = useState<string>(() => rangoInicial?.hasta || hoy);
  const [ambito, setAmbito] = useState<AmbitoTesoreria>(ambitoInicial ?? prefs.ambito);
  const [agrupacion, setAgrupacion] = useState<ModoAgrupacionTesoreria>(prefs.agrupacion);
  const [baseTasa, setBaseTasa] = useState<BaseTasaTesoreria>(prefs.baseTasa);
  const [mostrarUsd, setMostrarUsd] = useState<boolean>(prefs.mostrarUsd);
  const [mostrarBs, setMostrarBs] = useState<boolean>(prefs.mostrarBs);
  const [marcados, setMarcados] = useState<string[]>(prefs.campos);
  const [incluirResumen, setIncluirResumen] = useState<boolean>(prefs.incluirResumen);
  const [kpisSimplificados, setKpisSimplificados] = useState<boolean>(prefs.kpisSimplificados);
  const [incluirCerrados, setIncluirCerrados] = useState(true);
  const [verWhatsapp, setVerWhatsapp] = useState(false);
  const [orientacion, setOrientacion] = useState<'landscape' | 'portrait'>('landscape');
  const [formatoPresentacion, setFormatoPresentacion] = useState<'fichas' | 'tabla'>('fichas');
  const [ordenarPor, setOrdenarPor] = useState<OrdenReporteTesoreria>('usd');

  // Filtros (vacío = todos)
  const [cajasSel, setCajasSel] = useState<string[]>([]);
  const [monedasSel, setMonedasSel] = useState<string[]>([]);
  const [tiposSel, setTiposSel] = useState<TipoFlujoTesoreria[]>([]);
  const [categoriasSel, setCategoriasSel] = useState<string[]>([]);
  const [contrapartesSel, setContrapartesSel] = useState<string[]>([]);
  const [estadosSel, setEstadosSel] = useState<string[]>([]);
  const [seccionFiltro, setSeccionFiltro] = useState<SeccionFiltro>('categorias');

  // Datos crudos + contexto de tasas
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState<'pdf' | 'xlsx' | 'csv' | null>(null);
  const [movs, setMovs] = useState<MovimientoCaja[]>([]);
  const [ordenesPP, setOrdenesPP] = useState<OrdenPorPagar[]>([]);
  const [directosPP, setDirectosPP] = useState<DirectoFila[]>([]);
  const [creditosOc, setCreditosOc] = useState<OrdenPorPagar[]>([]);
  const [cxp, setCxp] = useState<CuentaPorPagar[]>([]);
  const [cxc, setCxc] = useState<CuentaPorCobrar[]>([]);
  const [generadoEn, setGeneradoEn] = useState<string>(() => new Date().toISOString());
  const [ctx, setCtx] = useState<ContextoTasas>({ tasaBcvHoy: 0, tasaFecha: null });
  const [recarga, setRecarga] = useState(0);
  // Qué combinación ya está cargada: la recarga en vivo de la misma no vuelve a mostrar «Cargando…».
  const ultimaCarga = useRef('');

  const claveCarga = `${ambito}|${desde}|${hasta}|${incluirCerrados}`;

  // Carga por ámbito + tasas (la recarga en vivo no vuelve a mostrar «Cargando…»).
  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      if (ultimaCarga.current !== claveCarga) setCargando(true);
      try {
        const tasaHoy = await getTasaHoy().catch(() => ({ usd: null, eur: null, fecha: null }));
        const tasaBcvHoy = Number(tasaHoy?.usd) || 0;
        const tasaFecha = tasaHoy?.fecha ?? null;

        if (ambito === 'movimientos') {
          const [lista, tasasPorFecha] = await Promise.all([
            listMovimientosReporte({ desde, hasta, incluirCerrados }),
            tasasUsdDelRango(desde, hasta).catch(() => undefined),
          ]);
          if (!cancelado) { setMovs(lista); setCtx({ tasaBcvHoy, tasaFecha, tasasPorFecha }); }
        } else if (ambito === 'por_pagar') {
          const [o, d] = await Promise.all([listOrdenesPorPagar(), cargarDirectosPorPagar()]);
          if (!cancelado) { setOrdenesPP(o); setDirectosPP(d); setGeneradoEn(new Date().toISOString()); setCtx({ tasaBcvHoy, tasaFecha }); }
        } else {
          const [oc, p, c] = await Promise.all([
            listOrdenesEnCredito(),
            listCuentasPorPagarAbiertasReporte(),
            listCuentasPorCobrarAbiertasReporte(),
          ]);
          if (!cancelado) { setCreditosOc(oc); setCxp(p); setCxc(c); setCtx({ tasaBcvHoy, tasaFecha }); }
        }
        if (!cancelado) ultimaCarga.current = claveCarga;
      } catch (e) {
        if (!cancelado) toast(mensajeError(e, 'No se pudieron cargar los datos de Tesorería'), 'error');
      } finally {
        if (!cancelado) setCargando(false);
      }
    }
    void cargar();
    return () => { cancelado = true; };
  }, [ambito, desde, hasta, incluirCerrados, claveCarga, recarga]);

  // Realtime: cualquier cambio en las tablas del ámbito recarga el reporte en silencio.
  const recargarEnVivo = useCallback(() => setRecarga((n) => n + 1), []);
  useRealtime(TABLAS_REALTIME[ambito], recargarEnVivo);

  // La tasa histórica solo aplica a los movimientos (como en GT); el resto va a la BCV del día.
  const baseEfectiva: BaseTasaTesoreria = ambito === 'movimientos' ? baseTasa : 'bcv_dia';

  // Normalización a filas de detalle según el ámbito
  const filasDetalle = useMemo<FilaReporteTesoreria[]>(() => {
    if (ambito === 'movimientos') return normalizarMovimientosTesoreria(movs, ctx, baseEfectiva);
    if (ambito === 'por_pagar') return normalizarPendientesPorPagar({ ordenes: ordenesPP, directos: directosPP, tasa: ctx.tasaBcvHoy, generadoEn });
    return normalizarCreditosCartera(creditosOc, cxp, cxc, ctx, baseEfectiva);
  }, [ambito, movs, ordenesPP, directosPP, generadoEn, creditosOc, cxp, cxc, ctx, baseEfectiva]);

  // Catálogos presentes (para los filtros)
  const catalogos = useMemo(() => {
    const cajas = new Map<string, number>();
    const monedas = new Map<string, number>();
    const tipos = new Set<TipoFlujoTesoreria>();
    const categorias = new Map<string, number>();
    const contrapartes = new Map<string, number>();
    const estados = new Map<string, number>();
    const sumar = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);
    for (const f of filasDetalle) {
      if (f.caja_origen && f.caja_origen !== '—') sumar(cajas, f.caja_origen);
      sumar(monedas, f.moneda_original);
      tipos.add(f.tipo_movimiento);
      sumar(categorias, f.categoria);
      if (f.contraparte && f.contraparte !== '—') sumar(contrapartes, f.contraparte);
      if (f.estado) sumar(estados, f.estado);
    }
    const aLista = (m: Map<string, number>) => Array.from(m.entries()).map(([nombre, count]) => ({ nombre, count })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    return {
      cajas: aLista(cajas),
      monedas: aLista(monedas),
      tipos: TIPOS_FLUJO.filter((t) => tipos.has(t)),
      categorias: aLista(categorias),
      contrapartes: aLista(contrapartes),
      estados: aLista(estados),
    };
  }, [filasDetalle]);

  const filtradas = useMemo(() => filtrarFilasTesoreria(filasDetalle, {
    cajasSel, monedasSel, tiposSel, categoriasSel, contrapartesSel, estadosSel,
  }), [filasDetalle, cajasSel, monedasSel, tiposSel, categoriasSel, contrapartesSel, estadosSel]);

  const { filas, resumen } = useMemo(() => procesarFilasReporteTesoreria(filtradas, agrupacion, { ordenarPor }), [filtradas, agrupacion, ordenarPor]);

  // Columnas visibles (respetan los interruptores de moneda)
  const columnasVisibles = useMemo(() => columnasVisiblesTesoreria(marcados, { mostrarUsd, mostrarBs }), [marcados, mostrarUsd, mostrarBs]);

  const cambiarAgrupacion = (modo: ModoAgrupacionTesoreria) => { setAgrupacion(modo); setMarcados(CAMPOS_POR_DEFECTO_POR_MODO[modo]); };
  const alternarColumna = (clave: string) => setMarcados((prev) => (prev.includes(clave) ? prev.filter((c) => c !== clave) : [...prev, clave]));

  // Interruptores maestros: no se pueden apagar los dos a la vez.
  const alternarUsd = (v: boolean) => {
    if (!v && !mostrarBs) { toast('Debe quedar al menos una moneda visible ($ o Bs).', 'warning'); return; }
    setMostrarUsd(v); if (!v && ordenarPor === 'usd') setOrdenarPor('bs');
  };
  const alternarBs = (v: boolean) => {
    if (!v && !mostrarUsd) { toast('Debe quedar al menos una moneda visible ($ o Bs).', 'warning'); return; }
    setMostrarBs(v); if (!v && ordenarPor === 'bs') setOrdenarPor('usd');
  };

  const cambiarAmbito = (a: AmbitoTesoreria) => {
    if (a === ambito) return;
    setAmbito(a);
    // Los filtros del ámbito anterior no aplican al nuevo.
    setCajasSel([]); setMonedasSel([]); setTiposSel([]); setCategoriasSel([]); setContrapartesSel([]); setEstadosSel([]);
  };

  const hayFiltros = cajasSel.length + monedasSel.length + tiposSel.length + categoriasSel.length + contrapartesSel.length + estadosSel.length > 0;
  const limpiarFiltros = () => { setCajasSel([]); setMonedasSel([]); setTiposSel([]); setCategoriasSel([]); setContrapartesSel([]); setEstadosSel([]); };

  const subtituloFiltros = useMemo(() => {
    const partes: string[] = [];
    if (cajasSel.length) partes.push(cajasSel.length === 1 ? cajasSel[0] : `${cajasSel.length} cajas`);
    if (monedasSel.length) partes.push(monedasSel.join('/'));
    if (tiposSel.length) partes.push(tiposSel.map((t) => ETIQUETA_FLUJO[t]).join('/'));
    if (categoriasSel.length) partes.push(categoriasSel.length === 1 ? categoriasSel[0] : `${categoriasSel.length} categorías`);
    if (contrapartesSel.length) partes.push(contrapartesSel.length === 1 ? contrapartesSel[0] : `${contrapartesSel.length} proveedores`);
    if (estadosSel.length) partes.push(estadosSel.join('/'));
    return partes.length ? `Filtros: ${partes.join(' · ')}` : undefined;
  }, [cajasSel, monedasSel, tiposSel, categoriasSel, contrapartesSel, estadosSel]);

  const descargar = async (formato: 'pdf' | 'xlsx' | 'csv') => {
    if (columnasVisibles.length === 0) { toast('Marca al menos una columna visible para exportar.', 'warning'); return; }
    if (filas.length === 0) { toast('No hay datos con los filtros y el período seleccionados.', 'warning'); return; }
    setOcupado(formato);
    guardarPrefs({ ambito, agrupacion, campos: marcados, baseTasa, mostrarUsd, mostrarBs, incluirResumen, kpisSimplificados });
    const meta: MetadatosExportacionTesoreria = {
      desde, hasta, ambito, agrupacion, baseTasa: baseEfectiva, mostrarUsd, mostrarBs, subtituloFiltros,
      incluirResumen, orientacion, formatoPresentacion, ordenarPor, kpisSimplificados,
    };
    try {
      if (formato === 'pdf') await descargarTesoreriaPdf(filas, resumen, marcados, meta);
      else if (formato === 'xlsx') await descargarTesoreriaExcel(filas, resumen, marcados, meta);
      else descargarTesoreriaCsv(filas, marcados, meta);
    } catch (e) {
      toast(mensajeError(e, 'No se pudo generar la exportación'), 'error');
    } finally {
      setOcupado(null);
    }
  };

  // Aviso de WhatsApp: ítems en su moneda + total consolidado (respeta período, filtros y monedas).
  const textoWsp = useMemo(
    () => textoWhatsappTesoreria(filtradas, { ambito, desde, hasta, mostrarUsd, mostrarBs }),
    [filtradas, ambito, desde, hasta, mostrarUsd, mostrarBs],
  );

  const montoPrincipal = (f: FilaReporteTesoreria) => (mostrarUsd ? fmtUsd(f.monto_usd) : fmtBs(f.monto_bs));
  const tituloSeccion = { marginBottom: '.5rem' } as const;
  const seccion = { padding: '.75rem .9rem' } as const;
  const sinExportar = !!ocupado || cargando || filas.length === 0 || columnasVisibles.length === 0;

  const renderPills = <T extends string>(
    items: { nombre: T; etiqueta: string; count?: number }[],
    lista: T[],
    setLista: Dispatch<SetStateAction<T[]>>,
    vacio: string,
  ) => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem', flexWrap: 'wrap', gap: '.3rem' }}>
        <span className="muted" style={{ fontSize: '.76rem' }}>{lista.length === 0 ? 'Todos incluidos' : `${lista.length} seleccionado(s)`}</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLista([])}>Todos</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', maxHeight: 150, overflowY: 'auto', padding: '.2rem 0' }}>
        {!items.length && <span className="muted" style={{ fontSize: '.76rem' }}>{vacio}</span>}
        {items.map((it) => {
          const activo = lista.length === 0 || lista.includes(it.nombre);
          return (
            <button key={it.nombre} type="button" className={`chip${activo ? ' chip-active' : ''}`}
              onClick={() => setLista((prev) => (prev.includes(it.nombre) ? prev.filter((x) => x !== it.nombre) : [...prev, it.nombre]))}>
              <input type="checkbox" checked={activo} readOnly tabIndex={-1} style={{ pointerEvents: 'none', margin: 0, accentColor: 'var(--primary)' }} />
              <span>{it.etiqueta}</span>
              {it.count != null && <span className="muted" style={{ fontSize: '.72rem' }}>({it.count})</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
  const conEtiqueta = (xs: { nombre: string; count: number }[]) => xs.map((x) => ({ ...x, etiqueta: x.nombre }));

  const kpi = (label: string, valor: string, color: string) => (
    <div className="card" style={{ padding: '.55rem .7rem' }}>
      <div className="muted" style={{ fontSize: '.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <strong className="mono" style={{ fontSize: '1.05rem', color, display: 'block' }}>{valor}</strong>
    </div>
  );

  const pastilla = (activo: boolean, onClick: () => void, texto: string, key?: string) => (
    <button key={key} type="button" className={`btn btn-sm ${activo ? 'btn-primary' : 'btn-ghost'}`} onClick={onClick}>{texto}</button>
  );

  return (
    <Modal
      title="📄 Descargar Reporte de Tesorería"
      size="lg"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '.5rem', flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: '.8rem' }}>{cargando ? 'Cargando datos…' : `${filas.length} fila(s) a exportar`}</span>
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={!!ocupado}>Cerrar</button>
            <button className="btn btn-ghost" onClick={() => void descargar('csv')} disabled={sinExportar}>{ocupado === 'csv' ? 'Generando…' : '📝 CSV'}</button>
            <button className="btn btn-ghost" onClick={() => void descargar('xlsx')} disabled={sinExportar}>{ocupado === 'xlsx' ? 'Generando…' : '📊 Excel'}</button>
            <button className="btn btn-ghost" onClick={() => setVerWhatsapp(true)} disabled={!!ocupado || cargando || filas.length === 0}>💬 WhatsApp</button>
            <button className="btn btn-primary" onClick={() => void descargar('pdf')} disabled={sinExportar}>{ocupado === 'pdf' ? 'Generando…' : '📄 PDF'}</button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
        {/* WhatsApp: el aviso del ámbito actual, con compartir/copiar (solo con el botón) */}
        {verWhatsapp && (
          <div className="card" style={{ ...seccion, borderColor: 'var(--success)' }}>
            <div className="card-title" style={tituloSeccion}>
              <span>💬 Enviar por WhatsApp · {AMBITOS.find((a) => a.id === ambito)?.label ?? 'Reporte'}</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setVerWhatsapp(false)}>← Volver al reporte</button>
            </div>
            <p className="hint muted" style={{ fontSize: '.78rem', marginTop: 0 }}>
              Aviso directo: cada ítem con su monto y el total consolidado. Respeta el período, los filtros y las monedas activas.
            </p>
            <CompartirWhatsapp texto={textoWsp} />
          </div>
        )}

        {/* Ámbito */}
        <div className="card" style={seccion}>
          <div className="card-title" style={tituloSeccion}>🧭 Ámbito del reporte</div>
          <div className="view-toggle" role="tablist">
            {AMBITOS.map((a) => (
              <button key={a.id} type="button" role="tab" aria-selected={ambito === a.id} className={ambito === a.id ? 'active' : ''} onClick={() => cambiarAmbito(a.id)}>
                {a.icon} {a.label}
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: '.76rem', marginTop: '.45rem' }}>
            {ambito === 'movimientos' && 'Ingresos, egresos y traslados del libro de caja en el rango elegido.'}
            {ambito === 'por_pagar' && 'Órdenes de compra, servicios y compras/servicios directos que esperan pago (no dependen del rango de fechas).'}
            {ambito === 'creditos_cartera' && 'Cuentas a crédito abiertas: compras a crédito y cuentas por pagar (lo que se debe) y cuentas por cobrar (lo que nos deben).'}
          </div>
        </div>

        {/* Fechas */}
        <div className="card" style={seccion}>
          <div className="card-title" style={tituloSeccion}>
            <span>📅 Rango de fechas</span>
            <span style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', textTransform: 'none', letterSpacing: 0 }}>
              {PRESETS_RANGO_TESORERIA.map((p) => {
                const r = rangoPresetTesoreria(p.id, hoy);
                return pastilla(desde === r.desde && hasta === r.hasta, () => { setDesde(r.desde); setHasta(r.hasta); }, p.label, p.id);
              })}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
            <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
              Desde <input className="input" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} style={{ width: 'auto' }} />
            </label>
            <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
              Hasta <input className="input" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} style={{ width: 'auto' }} />
            </label>
            {ambito === 'movimientos' && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.8rem', cursor: 'pointer' }} title="Los meses cerrados quedan archivados en el libro; aquí se pueden incluir en el reporte.">
                <input type="checkbox" checked={incluirCerrados} onChange={(e) => setIncluirCerrados(e.target.checked)} />
                <span>Incluir meses cerrados</span>
              </label>
            )}
          </div>
        </div>

        {/* Dimensión + valuación */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '.75rem' }}>
          <div className="card" style={seccion}>
            <div className="card-title" style={tituloSeccion}>🎯 Dimensión principal (agrupar por)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
              {MODOS.map((m) => pastilla(agrupacion === m.id, () => cambiarAgrupacion(m.id), `${m.icon} ${m.label}`, m.id))}
            </div>
          </div>
          <div className="card" style={seccion}>
            <div className="card-title" style={tituloSeccion}>💱 Valuación y monedas</div>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', cursor: 'pointer', fontSize: '.82rem', fontWeight: 600, color: mostrarUsd ? 'var(--success)' : 'var(--text-muted)' }}>
                <input type="checkbox" checked={mostrarUsd} onChange={(e) => alternarUsd(e.target.checked)} /><span>Mostrar $ USD</span>
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', cursor: 'pointer', fontSize: '.82rem', fontWeight: 600, color: mostrarBs ? 'var(--primary)' : 'var(--text-muted)' }}>
                <input type="checkbox" checked={mostrarBs} onChange={(e) => alternarBs(e.target.checked)} /><span>Mostrar Bs</span>
              </label>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem', fontSize: '.82rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer' }}>
                <input type="radio" name="baseTasaTesoreria" checked={baseEfectiva === 'bcv_dia'} onChange={() => setBaseTasa('bcv_dia')} />
                <span><strong>Tasa BCV del día</strong> (última oficial)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: ambito === 'movimientos' ? 'pointer' : 'not-allowed', opacity: ambito === 'movimientos' ? 1 : 0.5 }}>
                <input type="radio" name="baseTasaTesoreria" checked={baseEfectiva === 'historica'} disabled={ambito !== 'movimientos'} onChange={() => setBaseTasa('historica')} />
                <span><strong>Tasa histórica</strong> de cada movimiento</span>
              </label>
            </div>
            <div className="muted" style={{ fontSize: '.74rem', marginTop: '.35rem' }}>
              Tasa BCV aplicada: {resumen.tasaBcvReferencia > 0 ? `${fmtBs(resumen.tasaBcvReferencia)}/$` : '—'}
              {ctx.tasaFecha ? ` · del día ${ctx.tasaFecha.split('-').reverse().join('/')}` : ''}
            </div>
          </div>
        </div>

        {/* Filtros */}
        <div className="card" style={seccion}>
          <div className="card-title" style={tituloSeccion}>
            <span>🔍 Filtros</span>
            {hayFiltros && <button type="button" className="btn btn-sm btn-ghost" onClick={limpiarFiltros}>↺ Restablecer filtros</button>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', marginBottom: '.6rem' }}>
            {([
              ['categorias', '🔖 Categorías', categoriasSel.length],
              ['contrapartes', '👤 Proveedores', contrapartesSel.length],
              ['tipos', '🔀 Tipos', tiposSel.length],
              ['cajas', '🏦 Cajas', cajasSel.length],
              ['monedas', '💱 Monedas', monedasSel.length],
              ['estados', '📂 Estados', estadosSel.length],
            ] as const).map(([id, label, n]) => (
              <button key={id} type="button" className={`chip${seccionFiltro === id ? ' chip-active' : ''}`} onClick={() => setSeccionFiltro(id)}>
                {label}
                {n > 0 && <span className="badge primary" style={{ padding: '0 .4rem' }}>{n}</span>}
              </button>
            ))}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '.5rem' }}>
            {seccionFiltro === 'categorias' && renderPills(conEtiqueta(catalogos.categorias), categoriasSel, setCategoriasSel, 'Sin categorías en el período.')}
            {seccionFiltro === 'contrapartes' && renderPills(conEtiqueta(catalogos.contrapartes), contrapartesSel, setContrapartesSel, 'Sin proveedores/beneficiarios.')}
            {seccionFiltro === 'cajas' && renderPills(conEtiqueta(catalogos.cajas), cajasSel, setCajasSel, 'Sin cajas en este ámbito.')}
            {seccionFiltro === 'monedas' && renderPills(conEtiqueta(catalogos.monedas), monedasSel, setMonedasSel, 'Sin monedas.')}
            {seccionFiltro === 'estados' && renderPills(conEtiqueta(catalogos.estados), estadosSel, setEstadosSel, 'Sin estados en este ámbito.')}
            {seccionFiltro === 'tipos' && renderPills(catalogos.tipos.map((t) => ({ nombre: t, etiqueta: ETIQUETA_FLUJO[t] })), tiposSel, setTiposSel, 'Sin tipos.')}
          </div>
        </div>

        {/* Columnas */}
        <div className="card" style={seccion}>
          <div className="card-title" style={tituloSeccion}>
            <span>🧩 Columnas a mostrar ({marcados.length} seleccionadas)</span>
            <span style={{ display: 'flex', gap: '.3rem', textTransform: 'none', letterSpacing: 0 }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMarcados(CAMPOS_POR_DEFECTO_POR_MODO[agrupacion])}>Principales</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMarcados(CAMPOS_REPORTE_TESORERIA.map((c) => c.clave))}>Todas</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMarcados([])}>Ninguna</button>
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '.35rem .5rem', maxHeight: 170, overflowY: 'auto' }}>
            {CAMPOS_REPORTE_TESORERIA.map((col) => {
              const marcado = marcados.includes(col.clave);
              const ocultoPorMoneda = (col.clave === 'monto_usd' && !mostrarUsd) || (col.clave === 'monto_bs' && !mostrarBs);
              return (
                <label key={col.clave} title={ocultoPorMoneda ? 'Oculta por el interruptor de moneda' : col.descripcion}
                  style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.8rem', cursor: 'pointer', color: marcado ? 'var(--text)' : 'var(--text-muted)', opacity: ocultoPorMoneda ? 0.45 : 1 }}>
                  <input type="checkbox" checked={marcado} onChange={() => alternarColumna(col.clave)} />
                  <span>{col.etiqueta}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Presentación / orden / orientación / resumen */}
        <div className="card" style={{ ...seccion, display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem', borderBottom: '1px solid var(--border)', paddingBottom: '.55rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
              <span className="muted" style={{ fontSize: '.8rem', fontWeight: 600 }}>🎨 Presentación:</span>
              <div className="view-toggle" role="tablist">
                <button type="button" className={formatoPresentacion === 'fichas' ? 'active' : ''} onClick={() => setFormatoPresentacion('fichas')}>📂 Fichas ejecutivas</button>
                <button type="button" className={formatoPresentacion === 'tabla' ? 'active' : ''} onClick={() => setFormatoPresentacion('tabla')}>📊 Tabla</button>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap' }}>
              <span className="muted" style={{ fontSize: '.8rem', fontWeight: 600 }}>🎯 Ordenar por:</span>
              {mostrarUsd && pastilla(ordenarPor === 'usd', () => setOrdenarPor('usd'), '💵 Monto ($)', 'usd')}
              {mostrarBs && pastilla(ordenarPor === 'bs', () => setOrdenarPor('bs'), '🧾 Monto (Bs)', 'bs')}
              {pastilla(ordenarPor === 'fecha', () => setOrdenarPor('fecha'), '📆 Fecha', 'fecha')}
              {pastilla(ordenarPor === 'contraparte', () => setOrdenarPor('contraparte'), '👤 Proveedor', 'contraparte')}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
              <span className="muted" style={{ fontSize: '.8rem', fontWeight: 600 }}>📐 Orientación del PDF:</span>
              <div className="view-toggle" role="tablist">
                <button type="button" className={orientacion === 'landscape' ? 'active' : ''} onClick={() => setOrientacion('landscape')}>Horizontal</button>
                <button type="button" className={orientacion === 'portrait' ? 'active' : ''} onClick={() => setOrientacion('portrait')}>Vertical</button>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', fontSize: '.82rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={kpisSimplificados} onChange={(e) => setKpisSimplificados(e.target.checked)} />
                <span><strong>KPIs en vista simple</strong> (Total $ / Total Bs)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={incluirResumen} onChange={(e) => setIncluirResumen(e.target.checked)} />
                <span><strong>Incluir resumen (KPIs)</strong> en la cabecera</span>
              </label>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '.5rem' }}>
          {kpi('Filas en reporte', String(filas.length), 'var(--warning)')}
          {kpisSimplificados ? (
            <>
              {mostrarUsd && kpi('Total $', fmtUsd(resumen.totalEgresosUsd + resumen.totalIngresosUsd), 'var(--success)')}
              {mostrarBs && kpi('Total Bs', fmtBs(resumen.totalEgresosBs + resumen.totalIngresosBs), 'var(--primary)')}
            </>
          ) : (
            <>
              {mostrarUsd && kpi('Egresos ($)', fmtUsd(resumen.totalEgresosUsd), 'var(--primary)')}
              {mostrarUsd && kpi('Ingresos ($)', fmtUsd(resumen.totalIngresosUsd), 'var(--success)')}
              {mostrarBs && kpi('Egresos (Bs)', fmtBs(resumen.totalEgresosBs), 'var(--primary)')}
              {kpi('Saldo neto', mostrarUsd ? fmtUsd(resumen.saldoNetoUsd) : fmtBs(resumen.saldoNetoBs), (mostrarUsd ? resumen.saldoNetoUsd : resumen.saldoNetoBs) >= 0 ? 'var(--success)' : 'var(--danger)')}
            </>
          )}
        </div>

        {/* Vista previa */}
        <div className="card" style={seccion}>
          <div className="card-title" style={tituloSeccion}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
              🔎 Vista previa <span className="badge">{filas.length} {filas.length === 1 ? 'fila' : 'filas'}</span>
            </span>
            <span className="muted" style={{ fontSize: '.74rem', textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>{formatoPresentacion === 'fichas' ? 'Fichas ejecutivas' : 'Tabla'}</span>
          </div>

          {cargando ? (
            <div className="muted" style={{ textAlign: 'center', padding: '1.2rem', fontSize: '.85rem' }}>Cargando datos de Tesorería…</div>
          ) : filas.length === 0 ? (
            <div className="muted" style={{ textAlign: 'center', padding: '1.2rem', fontSize: '.85rem' }}>No hay datos para el ámbito, el período o los filtros seleccionados.</div>
          ) : formatoPresentacion === 'fichas' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '.55rem', maxHeight: 300, overflowY: 'auto', paddingRight: '.2rem' }}>
              {filas.map((f) => {
                const acento = ACENTO_FLUJO[f.tipo_movimiento];
                const metricas = obtenerMetricasFichaTesoreria(f, marcados, { mostrarUsd, mostrarBs });
                const titulo = f.contraparte && f.contraparte !== '—' ? f.contraparte : (f.categoria || f.concepto || 'Sin clasificar');
                const sub = [f.categoria !== titulo ? f.categoria : null, f.caja_origen && f.caja_origen !== '—' ? f.caja_origen : null, f.fecha ? fmtFechaCorta(f.fecha) : null].filter(Boolean).join(' · ');
                return (
                  <div key={f.id} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderLeft: `4px solid ${acento}`, borderRadius: 'var(--r-sm)', padding: '.55rem .7rem', display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '.5rem' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: '.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={titulo}>{titulo}</div>
                        <div className="muted" style={{ fontSize: '.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sub}>{sub}</div>
                      </div>
                      <div style={{ flexShrink: 0, textAlign: 'right', background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm)', padding: '.2rem .5rem', lineHeight: 1.2 }}>
                        <div className="mono" style={{ fontSize: '.8rem', fontWeight: 700, color: acento }}>{f.pct_del_total != null ? `${f.pct_del_total.toFixed(1)}%` : montoPrincipal(f)}</div>
                        <div className="muted" style={{ fontSize: '.62rem' }}>{ETIQUETA_FLUJO[f.tipo_movimiento]}</div>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${metricas.length}, 1fr)`, gap: '.25rem', background: 'var(--bg-1)', padding: '.35rem', borderRadius: 'var(--r-sm)' }}>
                      {metricas.map((m) => (
                        <div key={m.clave} style={{ minWidth: 0 }}>
                          <div className="muted" style={{ fontSize: '.6rem', fontWeight: 600 }}>{m.etiqueta}</div>
                          <div className="mono" style={{ fontSize: '.8rem', fontWeight: 700, color: m.colorCss, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.sub ? `${m.valor} · ${m.sub}` : m.valor}>{m.valor}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : columnasVisibles.length === 0 ? (
            <div className="muted" style={{ textAlign: 'center', padding: '1.2rem', fontSize: '.85rem' }}>Marca al menos una columna para ver la tabla.</div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 300, overflow: 'auto' }}>
              <table className="table" style={{ fontSize: '.8rem' }}>
                <thead>
                  <tr>{columnasVisibles.map((c) => <th key={c.clave} style={{ textAlign: c.alineacion, whiteSpace: 'nowrap' }}>{c.etiqueta}</th>)}</tr>
                </thead>
                <tbody>
                  {filas.map((f, idx) => (
                    <tr key={f.id || idx}>
                      {columnasVisibles.map((c) => (
                        <td key={c.clave} className={c.formato && c.formato !== 'texto' ? 'mono' : undefined}
                          style={{ textAlign: c.alineacion, whiteSpace: 'nowrap', color: c.clave === 'monto_usd' ? 'var(--success)' : c.clave === 'monto_bs' ? 'var(--primary)' : undefined }}>
                          {textoCeldaTesoreria(f, c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
