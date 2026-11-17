/* ============================================================
   Golden Touch · Compras · Diálogo del Reporte Moldeable
   (10/11/2026)

   Modal interactivo moldeable (patrón de ExportInventarioModal / ExportarTesoreria):
   - Ámbito: Compras (una fila = una compra) · Ítems (una fila = un ítem de orden).
   - Dimensión principal (departamento, proveedor, estado, tipo, categoría,
     producto, mes, día, detallado).
   - Formato: Resumen · Detallado · Híbrido.
   - Rango de fechas con atajos (ancla: fecha de la compra).
   - Filtros por departamento, proveedor, estado, tipo de compra y categoría.
   - Columnas por casillas; interruptores $ / Bs; orden del ranking; vista previa.
   - Exporta a PDF/Excel/CSV y arma el aviso de WhatsApp (con emojis).
   Las preferencias se guardan en localStorage (por usuario del navegador).

   Une las TRES fuentes (órdenes, compras directas, servicios directos). El
   ranking por departamento NO incluye las compras directas (se agrupan por
   categoría de gasto), pero el total del rango SÍ las incluye.
   ============================================================ */

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { mensajeError } from '@/shared/lib/errores';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import {
  CAMPOS_REPORTE_COMPRAS,
  CAMPOS_POR_DEFECTO_POR_MODO,
  CAMPOS_DETALLE_POR_AMBITO,
  ETIQUETA_TIPO_COMPRA,
  filtrarFilasCompras,
  resumenCompras,
  procesarFilasCompras,
  type AmbitoCompras,
  type ModoAgrupacionCompras,
  type TipoCompra,
  type ClaseEstadoCompra,
  type OrdenReporteCompras,
  type FiltrosCompras,
  type FilaReporteCompras,
  type ResumenReporteCompras,
} from './comprasMoldeable';
import {
  descargarComprasCsv,
  descargarComprasExcel,
  descargarComprasPdf,
  type MetadatosExportacionCompras,
} from './exportarComprasMoldeable';
import { textoWhatsappCompras } from './whatsappCompras';
import { cargarDatosReporteCompras, type DatosReporteCompras } from './datosReporteCompras';

const CLAVE_CAMPOS = 'compras.reporte.campos.v1';
const CLAVE_AMBITO = 'compras.reporte.ambito.v1';
const CLAVE_AGRUPACION = 'compras.reporte.agrupacion.v1';
const CLAVE_FORMATO = 'compras.reporte.formato.v1';

type Formato = 'resumen' | 'detallado' | 'hibrido';

const AMBITOS: { id: AmbitoCompras; icon: string; label: string }[] = [
  { id: 'ordenes', icon: '🧾', label: 'Órdenes de Compra' },
  { id: 'items', icon: '📦', label: 'Ítems' },
];

const MODOS: { id: ModoAgrupacionCompras; icon: string; label: string; ambito?: AmbitoCompras }[] = [
  { id: 'departamento', icon: '🏢', label: 'Por Departamento' },
  { id: 'proveedor', icon: '🚚', label: 'Por Proveedor' },
  { id: 'estado', icon: '🗂️', label: 'Por Estado' },
  { id: 'tipo', icon: '🔀', label: 'Por Tipo' },
  { id: 'categoria', icon: '🏷️', label: 'Por Categoría', ambito: 'items' },
  { id: 'producto', icon: '📦', label: 'Por Ítem', ambito: 'items' },
  { id: 'mes', icon: '📅', label: 'Por Mes' },
  { id: 'dia', icon: '📆', label: 'Por Día' },
  { id: 'detallado', icon: '📋', label: 'Detallado' },
];

const FORMATOS: { id: Formato; icon: string; label: string; hint: string }[] = [
  { id: 'resumen', icon: '📊', label: 'Resumen', hint: 'Solo la página de resumen y analítica.' },
  { id: 'detallado', icon: '📋', label: 'Detallado', hint: 'El listado completo con totales.' },
  { id: 'hibrido', icon: '🧩', label: 'Consolidado', hint: 'Resumen ejecutivo + compras pendientes.' },
];

const TIPOS: { id: TipoCompra; label: string }[] = [
  { id: 'orden', label: 'Órdenes' },
  { id: 'directa', label: 'Compras directas' },
  { id: 'servicio', label: 'Servicios' },
];
const ESTADOS: { id: ClaseEstadoCompra; label: string }[] = [
  { id: 'finalizada', label: 'Finalizadas' },
  { id: 'pendiente', label: 'Pendientes' },
];

function hoyVE(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function primerDiaMesActual(): string { return `${hoyVE().slice(0, 7)}-01`; }
function primerDiaMesAnterior(): string { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7) + '-01'; }
function ultimoDiaMesAnterior(): string { const d = new Date(); d.setDate(0); return d.toISOString().slice(0, 10); }
function diasAtras(n: number): string { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
function primerDiaAnioActual(): string { return `${new Date().getFullYear()}-01-01`; }

function leerPrefs() {
  let ambito: AmbitoCompras = 'ordenes';
  try { const a = localStorage.getItem(CLAVE_AMBITO) as AmbitoCompras; if (a && AMBITOS.some((x) => x.id === a)) ambito = a; } catch { /* default */ }
  let agrupacion: ModoAgrupacionCompras = 'departamento';
  try { const a = localStorage.getItem(CLAVE_AGRUPACION) as ModoAgrupacionCompras; if (a && MODOS.some((x) => x.id === a)) agrupacion = a; } catch { /* default */ }
  let formato: Formato = 'hibrido';
  try { const f = localStorage.getItem(CLAVE_FORMATO) as Formato; if (f && FORMATOS.some((x) => x.id === f)) formato = f; } catch { /* default */ }
  let campos = CAMPOS_POR_DEFECTO_POR_MODO[agrupacion];
  try { const c = JSON.parse(localStorage.getItem(CLAVE_CAMPOS) ?? 'null'); if (Array.isArray(c) && c.length) campos = c; } catch { /* default */ }
  return { ambito, agrupacion, formato, campos };
}

const fmtUsd = (v: number) => `$ ${v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtBs = (v: number) => `Bs ${v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (v: number) => v.toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

interface Props { onClose: () => void }

export function ExportarComprasModal({ onClose }: Props) {
  const prefs = useMemo(() => leerPrefs(), []);

  const [desde, setDesde] = useState<string>(primerDiaMesActual());
  const [hasta, setHasta] = useState<string>(hoyVE());
  const [ambito, setAmbito] = useState<AmbitoCompras>(prefs.ambito);
  const [agrupacion, setAgrupacion] = useState<ModoAgrupacionCompras>(prefs.agrupacion);
  const [formato, setFormato] = useState<Formato>(prefs.formato);
  const [marcados, setMarcados] = useState<string[]>(prefs.campos);
  const [mostrarUsd, setMostrarUsd] = useState(true);
  const [mostrarBs, setMostrarBs] = useState(true);
  const [ordenarPor, setOrdenarPor] = useState<OrdenReporteCompras>('monto');
  const [ordenRanking, setOrdenRanking] = useState<'desc' | 'asc'>('desc');
  const [orientacion, setOrientacion] = useState<'landscape' | 'portrait'>('landscape');
  const [verWhatsapp, setVerWhatsapp] = useState(false);

  // Filtros (vacío = todos)
  const [departamentosSel, setDepartamentosSel] = useState<string[]>([]);
  const [proveedoresSel, setProveedoresSel] = useState<string[]>([]);
  const [categoriasSel, setCategoriasSel] = useState<string[]>([]);
  const [estadosSel, setEstadosSel] = useState<ClaseEstadoCompra[]>([]);
  const [tiposSel, setTiposSel] = useState<TipoCompra[]>([]);
  const [seccionFiltro, setSeccionFiltro] = useState<'departamentos' | 'proveedores' | 'categorias' | 'estados' | 'tipos'>('departamentos');

  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState<'pdf' | 'xlsx' | 'csv' | null>(null);
  const [datos, setDatos] = useState<DatosReporteCompras | null>(null);

  // Carga de datos (une las tres fuentes) por rango
  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      setCargando(true);
      try {
        const d = await cargarDatosReporteCompras(desde, hasta);
        if (!cancelado) setDatos(d);
      } catch (e) {
        if (!cancelado) toast(mensajeError(e, 'No se pudieron cargar las compras'), 'error');
      } finally {
        if (!cancelado) setCargando(false);
      }
    }
    void cargar();
    return () => { cancelado = true; };
  }, [desde, hasta]);

  const filasOrdenes = datos?.filasOrdenes ?? [];
  const filasItems = datos?.filasItems ?? [];
  const tasaBcv = datos?.tasaBcv ?? 0;

  // Filtros comunes (sin categoría; la categoría solo aplica a ítems)
  const filtrosBase: FiltrosCompras = useMemo(() => ({
    departamentosSel: departamentosSel.length ? departamentosSel : undefined,
    proveedoresSel: proveedoresSel.length ? proveedoresSel : undefined,
    estadosSel: estadosSel.length ? estadosSel : undefined,
    tiposSel: tiposSel.length ? tiposSel : undefined,
  }), [departamentosSel, proveedoresSel, estadosSel, tiposSel]);

  // Resumen (siempre agrega las tres fuentes y ambos niveles)
  const resumen: ResumenReporteCompras = useMemo(() => {
    const ordFilt = filtrarFilasCompras(filasOrdenes, filtrosBase);
    const itFilt = filtrarFilasCompras(filasItems, { ...filtrosBase, categoriasSel: categoriasSel.length ? categoriasSel : undefined });
    const cot = departamentosSel.length ? (datos?.cotizaciones ?? []).filter((c) => departamentosSel.includes(c.departamento)) : (datos?.cotizaciones ?? []);
    return resumenCompras(ordFilt, itFilt, cot, tasaBcv);
  }, [filasOrdenes, filasItems, filtrosBase, categoriasSel, departamentosSel, datos, tasaBcv]);

  // Resumen mostrado (ranking asc/desc)
  const resumenMostrado: ResumenReporteCompras = useMemo(() => {
    if (ordenRanking === 'desc') return resumen;
    return {
      ...resumen,
      rankingDeptoGasto: [...resumen.rankingDeptoGasto].reverse(),
      rankingDeptoCotizaciones: [...resumen.rankingDeptoCotizaciones].reverse(),
    };
  }, [resumen, ordenRanking]);

  // Listado según el ámbito
  const filasDetalle = ambito === 'ordenes' ? filasOrdenes : filasItems;
  const filtradas = useMemo(() => filtrarFilasCompras(filasDetalle, {
    ...filtrosBase,
    categoriasSel: ambito === 'items' && categoriasSel.length ? categoriasSel : undefined,
  }), [filasDetalle, filtrosBase, categoriasSel, ambito]);

  const { filas } = useMemo(() => procesarFilasCompras(filtradas, agrupacion, { ordenarPor, ambito }), [filtradas, agrupacion, ordenarPor, ambito]);

  // Catálogos presentes (para los filtros)
  const catalogos = useMemo(() => {
    const cuenta = (vals: string[]) => {
      const m = new Map<string, number>();
      for (const v of vals) if (v) m.set(v, (m.get(v) || 0) + 1);
      return Array.from(m.entries()).map(([nombre, count]) => ({ nombre, count })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    };
    return {
      departamentos: cuenta(filasOrdenes.map((f) => f.departamento)),
      proveedores: cuenta(filasOrdenes.map((f) => f.proveedor).filter((p) => p !== '—')),
      categorias: cuenta(filasItems.map((f) => f.categoria)),
    };
  }, [filasOrdenes, filasItems]);

  const columnasAmbito = useMemo(() => CAMPOS_REPORTE_COMPRAS.filter((c) => !c.ambito || c.ambito === 'ambos' || c.ambito === ambito), [ambito]);
  const marcadosVisibles = useMemo(() => marcados.filter((c) => columnasAmbito.some((col) => col.clave === c)), [marcados, columnasAmbito]);
  const modosDisponibles = MODOS.filter((m) => !m.ambito || m.ambito === ambito);

  const cambiarAmbito = (nuevo: AmbitoCompras) => {
    setAmbito(nuevo);
    const modo = MODOS.find((m) => m.id === agrupacion);
    if (modo?.ambito && modo.ambito !== nuevo) {
      const base: ModoAgrupacionCompras = 'departamento';
      setAgrupacion(base);
      setMarcados(CAMPOS_POR_DEFECTO_POR_MODO[base]);
    }
  };
  const cambiarAgrupacion = (modo: ModoAgrupacionCompras) => {
    setAgrupacion(modo);
    setMarcados(modo === 'detallado' ? CAMPOS_DETALLE_POR_AMBITO[ambito] : CAMPOS_POR_DEFECTO_POR_MODO[modo]);
  };
  const alternarColumna = (clave: string) => setMarcados((prev) => (prev.includes(clave) ? prev.filter((c) => c !== clave) : [...prev, clave]));
  const toggleFiltro = <T extends string>(setLista: React.Dispatch<React.SetStateAction<T[]>>, item: T) =>
    setLista((prev) => (prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]));
  const filtroActivo = (lista: string[], item: string) => lista.length === 0 || lista.includes(item);

  const hayFiltros = departamentosSel.length || proveedoresSel.length || categoriasSel.length || estadosSel.length || tiposSel.length;
  const limpiarFiltros = () => { setDepartamentosSel([]); setProveedoresSel([]); setCategoriasSel([]); setEstadosSel([]); setTiposSel([]); };

  const subtituloFiltros = useMemo(() => {
    const partes: string[] = [];
    if (departamentosSel.length) partes.push(departamentosSel.length === 1 ? departamentosSel[0] : `${departamentosSel.length} departamentos`);
    if (proveedoresSel.length) partes.push(proveedoresSel.length === 1 ? proveedoresSel[0] : `${proveedoresSel.length} proveedores`);
    if (categoriasSel.length) partes.push(categoriasSel.length === 1 ? categoriasSel[0] : `${categoriasSel.length} categorías`);
    if (estadosSel.length) partes.push(estadosSel.map((e) => ESTADOS.find((x) => x.id === e)?.label ?? e).join('/'));
    if (tiposSel.length) partes.push(tiposSel.map((t) => ETIQUETA_TIPO_COMPRA[t]).join('/'));
    return partes.length ? `Filtros: ${partes.join(' · ')}` : undefined;
  }, [departamentosSel, proveedoresSel, categoriasSel, estadosSel, tiposSel]);

  const dinero = (usd: number, bs: number) => (mostrarUsd && mostrarBs ? `${fmtUsd(usd)} · ${fmtBs(bs)}` : mostrarUsd ? fmtUsd(usd) : fmtBs(bs));

  const metaDe = (): MetadatosExportacionCompras => ({
    desde, hasta, ambito, agrupacion, formato,
    subtituloFiltros, mostrarUsd, mostrarBs, tasaBcv, orientacion,
  });

  const descargar = async (fmt: 'pdf' | 'xlsx' | 'csv') => {
    if (!mostrarUsd && !mostrarBs) { toast('Deja encendida al menos una moneda ($ o Bs).', 'warning'); return; }
    if (formato !== 'resumen' && marcadosVisibles.length === 0) { toast('Marca al menos una columna para el listado.', 'warning'); return; }
    if (resumen.totalCompras === 0) { toast('No hay compras con los filtros y el período seleccionados.', 'warning'); return; }
    setOcupado(fmt);
    try { localStorage.setItem(CLAVE_CAMPOS, JSON.stringify(marcados)); localStorage.setItem(CLAVE_AMBITO, ambito); localStorage.setItem(CLAVE_AGRUPACION, agrupacion); localStorage.setItem(CLAVE_FORMATO, formato); } catch { /* no crítico */ }
    const meta = metaDe();
    try {
      if (fmt === 'pdf') await descargarComprasPdf(filtradas, resumenMostrado, marcados, meta);
      else if (fmt === 'xlsx') await descargarComprasExcel(filas, resumenMostrado, marcados, meta);
      else descargarComprasCsv(filas, marcados, meta);
    } catch (e) {
      toast(mensajeError(e, 'No se pudo generar la exportación'), 'error');
    } finally {
      setOcupado(null);
    }
  };

  const textoWsp = useMemo(() => textoWhatsappCompras(resumenMostrado, { desde, hasta, mostrarUsd, mostrarBs, tasaBcv }), [resumenMostrado, desde, hasta, mostrarUsd, mostrarBs, tasaBcv]);

  const surf2 = { background: 'var(--surface-2, #182230)', border: '1px solid var(--border)', borderRadius: '8px', padding: '.65rem .8rem' } as const;
  const tituloSec = { fontSize: '.84rem', fontWeight: 600, color: 'var(--text, #f1f5f9)' } as const;

  const renderPills = (
    items: { nombre: string; count: number }[],
    lista: string[],
    setLista: React.Dispatch<React.SetStateAction<string[]>>,
    vacio: string,
  ) => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem', flexWrap: 'wrap', gap: '.3rem' }}>
        <span className="muted" style={{ fontSize: '.76rem' }}>{lista.length === 0 ? 'Todos incluidos' : `${lista.length} seleccionado(s)`}</span>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setLista([])}>Todos</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', maxHeight: '150px', overflowY: 'auto', padding: '.2rem 0' }}>
        {!items.length && <span className="muted" style={{ fontSize: '.76rem' }}>{vacio}</span>}
        {items.map((it) => {
          const activo = filtroActivo(lista, it.nombre);
          return (
            <button key={it.nombre} type="button" onClick={() => toggleFiltro(setLista, it.nombre)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', padding: '.25rem .65rem', borderRadius: '999px', fontSize: '.78rem', border: '1px solid', borderColor: activo ? 'var(--primary, #f97316)' : 'var(--border, #334155)', background: activo ? 'rgba(249, 115, 22, 0.15)' : 'var(--surface-1, #0f172a)', color: activo ? 'var(--text, #f1f5f9)' : 'var(--text-muted, #94a3b8)', cursor: 'pointer' }}>
              <input type="checkbox" checked={activo} readOnly style={{ pointerEvents: 'none', margin: 0, accentColor: 'var(--primary, #f97316)' }} />
              <span>{it.nombre}</span>
              <span className="muted" style={{ fontSize: '.7rem', opacity: 0.85 }}>({it.count})</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderChips = <T extends string>(opts: { id: T; label: string }[], lista: T[], setLista: React.Dispatch<React.SetStateAction<T[]>>) => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
        <span className="muted" style={{ fontSize: '.76rem' }}>{lista.length === 0 ? 'Todos incluidos' : `${lista.length} seleccionado(s)`}</span>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setLista([])}>Todos</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem' }}>
        {opts.map((o) => {
          const activo = filtroActivo(lista, o.id);
          return (
            <button key={o.id} type="button" onClick={() => toggleFiltro(setLista, o.id)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', padding: '.25rem .65rem', borderRadius: '999px', fontSize: '.78rem', border: '1px solid', borderColor: activo ? 'var(--primary, #f97316)' : 'var(--border, #334155)', background: activo ? 'rgba(249, 115, 22, 0.15)' : 'var(--surface-1, #0f172a)', color: activo ? 'var(--text, #f1f5f9)' : 'var(--text-muted, #94a3b8)', cursor: 'pointer' }}>
              <input type="checkbox" checked={activo} readOnly style={{ pointerEvents: 'none', margin: 0, accentColor: 'var(--primary, #f97316)' }} />
              <span>{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const incluyeDetalle = formato !== 'resumen';

  return (
    <Modal
      title="📄 Reporte de Compras"
      size="lg"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '.5rem', flexWrap: 'wrap' }}>
          <div className="muted" style={{ fontSize: '.8rem' }}>{cargando ? 'Cargando datos...' : `${resumen.totalCompras} compra(s) · ${filas.length} fila(s) en el listado`}</div>
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={!!ocupado}>Cerrar</button>
            <button className="btn btn-ghost" onClick={() => void descargar('csv')} disabled={!!ocupado || cargando || resumen.totalCompras === 0}>{ocupado === 'csv' ? 'Generando...' : '📝 CSV'}</button>
            <button className="btn btn-ghost" onClick={() => void descargar('xlsx')} disabled={!!ocupado || cargando || resumen.totalCompras === 0}>{ocupado === 'xlsx' ? 'Generando...' : '📊 Excel'}</button>
            <button className="btn btn-ghost" onClick={() => setVerWhatsapp(true)} disabled={!!ocupado || cargando || resumen.totalCompras === 0}>💬 WhatsApp</button>
            <button className="btn btn-primary" onClick={() => void descargar('pdf')} disabled={!!ocupado || cargando || resumen.totalCompras === 0}>{ocupado === 'pdf' ? 'Generando...' : '📄 PDF'}</button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem' }}>
        {verWhatsapp && (
          <div style={{ ...surf2, borderColor: 'var(--primary, #25D366)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.5rem', flexWrap: 'wrap', gap: '.4rem' }}>
              <span style={tituloSec}>💬 Enviar por WhatsApp</span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setVerWhatsapp(false)}>← Volver al reporte</button>
            </div>
            <p className="muted" style={{ fontSize: '.76rem', marginTop: 0, marginBottom: '.5rem' }}>
              Resumen puntual: totales del rango, por estado, el departamento que más gastó y el ítem más comprado. Respeta el período, los filtros y las monedas.
            </p>
            <CompartirWhatsapp texto={textoWsp} />
          </div>
        )}

        {/* Ámbito */}
        <div style={surf2}>
          <div style={{ ...tituloSec, marginBottom: '.4rem' }}>🧭 Ámbito del reporte</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
            {AMBITOS.map((a) => (
              <button key={a.id} type="button" className={`btn btn-xs ${ambito === a.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => cambiarAmbito(a.id)} style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}>
                <span>{a.icon}</span><span>{a.label}</span>
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: '.73rem', marginTop: '.4rem', fontStyle: 'italic' }}>
            {ambito === 'ordenes' ? 'Una fila por compra (órdenes, compras directas y servicios).' : 'Una fila por ítem de orden (para categorías de inventario e ítem más comprado).'}
          </div>
        </div>

        {/* Fechas */}
        <div style={surf2}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.4rem', marginBottom: '.5rem' }}>
            <span style={tituloSec}>📅 Rango de Fechas</span>
            <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setDesde(hoyVE()); setHasta(hoyVE()); }}>Hoy</button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setDesde(primerDiaMesActual()); setHasta(hoyVE()); }}>Este mes</button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setDesde(primerDiaMesAnterior()); setHasta(ultimoDiaMesAnterior()); }}>Mes anterior</button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setDesde(diasAtras(30)); setHasta(hoyVE()); }}>Últimos 30d</button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setDesde(primerDiaAnioActual()); setHasta(hoyVE()); }}>Este año</button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '.8rem', display: 'flex', alignItems: 'center', gap: '.3rem' }}><span>Desde:</span><input type="date" className="form-control form-control-sm" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
            <label style={{ fontSize: '.8rem', display: 'flex', alignItems: 'center', gap: '.3rem' }}><span>Hasta:</span><input type="date" className="form-control form-control-sm" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
            {tasaBcv > 0 && <span className="muted" style={{ fontSize: '.76rem', marginLeft: 'auto' }}>Tasa BCV: Bs {fmtNum(tasaBcv)} / $</span>}
          </div>
        </div>

        {/* Formato */}
        <div style={surf2}>
          <div style={{ ...tituloSec, marginBottom: '.4rem' }}>🧩 Formato</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
            {FORMATOS.map((f) => (
              <button key={f.id} type="button" className={`btn btn-xs ${formato === f.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFormato(f.id)} title={f.hint} style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}>
                <span>{f.icon}</span><span>{f.label}</span>
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: '.73rem', marginTop: '.4rem', fontStyle: 'italic' }}>{FORMATOS.find((f) => f.id === formato)?.hint}</div>
        </div>

        {/* Dimensión */}
        {incluyeDetalle && (
          <div style={surf2}>
            <div style={{ ...tituloSec, marginBottom: '.4rem' }}>🎯 Dimensión del listado (Agrupar por)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
              {modosDisponibles.map((m) => (
                <button key={m.id} type="button" className={`btn btn-xs ${agrupacion === m.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => cambiarAgrupacion(m.id)} style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}>
                  <span>{m.icon}</span><span>{m.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Filtros */}
        <div style={surf2}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.4rem', marginBottom: '.5rem' }}>
            <span style={tituloSec}>🔍 Filtros</span>
            {!!hayFiltros && <button type="button" className="btn btn-ghost btn-xs" onClick={limpiarFiltros} style={{ color: 'var(--primary, #f97316)' }}>↺ Restablecer filtros</button>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', marginBottom: '.6rem' }}>
            {([
              ['departamentos', '🏢 Departamentos', departamentosSel],
              ['proveedores', '🚚 Proveedores', proveedoresSel],
              ...(ambito === 'items' ? [['categorias', '🏷️ Categorías', categoriasSel] as const] : []),
              ['estados', '🗂️ Estados', estadosSel],
              ['tipos', '🔀 Tipos', tiposSel],
            ] as const).map(([id, label, sel]) => (
              <button key={id} type="button" className={`btn btn-xs ${seccionFiltro === id ? 'btn-primary' : 'btn-ghost'}`} style={{ borderRadius: '999px', padding: '.25rem .65rem' }} onClick={() => setSeccionFiltro(id)}>
                {label}
                {sel.length > 0 && <span className="badge" style={{ marginLeft: '.35rem', background: 'var(--primary, #f97316)', color: '#000', fontSize: '.68rem', padding: '1px 5px', borderRadius: '999px', fontWeight: 700 }}>{sel.length}</span>}
              </button>
            ))}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '.5rem' }}>
            {seccionFiltro === 'departamentos' && renderPills(catalogos.departamentos, departamentosSel, setDepartamentosSel, 'Sin departamentos.')}
            {seccionFiltro === 'proveedores' && renderPills(catalogos.proveedores, proveedoresSel, setProveedoresSel, 'Sin proveedores.')}
            {seccionFiltro === 'categorias' && ambito === 'items' && renderPills(catalogos.categorias, categoriasSel, setCategoriasSel, 'Sin categorías.')}
            {seccionFiltro === 'estados' && renderChips(ESTADOS, estadosSel, setEstadosSel)}
            {seccionFiltro === 'tipos' && renderChips(TIPOS, tiposSel, setTiposSel)}
          </div>
        </div>

        {/* Columnas (solo si hay listado) */}
        {incluyeDetalle && (
          <div style={surf2}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.4rem', marginBottom: '.4rem' }}>
              <span style={tituloSec}>☑️ Columnas del listado ({marcadosVisibles.length} seleccionadas)</span>
              <div style={{ display: 'flex', gap: '.3rem' }}>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMarcados(agrupacion === 'detallado' ? CAMPOS_DETALLE_POR_AMBITO[ambito] : CAMPOS_POR_DEFECTO_POR_MODO[agrupacion])}>Principales</button>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMarcados(columnasAmbito.map((c) => c.clave))}>Todas</button>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMarcados([])}>Ninguna</button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '.35rem .5rem', maxHeight: '160px', overflowY: 'auto' }}>
              {columnasAmbito.map((col) => {
                const marcado = marcados.includes(col.clave);
                return (
                  <label key={col.clave} style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.78rem', cursor: 'pointer', color: marcado ? 'var(--text, #f1f5f9)' : 'var(--text-muted, #94a3b8)' }} title={col.descripcion}>
                    <input type="checkbox" checked={marcado} onChange={() => alternarColumna(col.clave)} />
                    <span>{col.etiqueta}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Moneda / orden / orientación */}
        <div style={{ ...surf2, display: 'flex', flexWrap: 'wrap', gap: '.8rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
            <span style={{ ...tituloSec, fontSize: '.82rem' }}>💱 Mostrar:</span>
            <button type="button" className={`btn btn-xs ${mostrarUsd ? 'btn-primary' : 'btn-ghost'}`} style={{ borderRadius: '999px', padding: '.2rem .7rem' }} onClick={() => setMostrarUsd((v) => !v)}>$ Dólares</button>
            <button type="button" className={`btn btn-xs ${mostrarBs ? 'btn-primary' : 'btn-ghost'}`} style={{ borderRadius: '999px', padding: '.2rem .7rem' }} onClick={() => setMostrarBs((v) => !v)}>Bs Bolívares</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
            <span style={{ ...tituloSec, fontSize: '.82rem' }}>📊 Ranking:</span>
            <button type="button" className={`btn btn-xs ${ordenRanking === 'desc' ? 'btn-primary' : 'btn-ghost'}`} style={{ borderRadius: '999px', padding: '.2rem .6rem' }} onClick={() => setOrdenRanking('desc')}>Mayor a menor</button>
            <button type="button" className={`btn btn-xs ${ordenRanking === 'asc' ? 'btn-primary' : 'btn-ghost'}`} style={{ borderRadius: '999px', padding: '.2rem .6rem' }} onClick={() => setOrdenRanking('asc')}>Menor a mayor</button>
          </div>
          {incluyeDetalle && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
              <span style={{ ...tituloSec, fontSize: '.82rem' }}>🎯 Ordenar listado:</span>
              <button type="button" className={`btn btn-xs ${ordenarPor === 'monto' ? 'btn-primary' : 'btn-ghost'}`} style={{ borderRadius: '999px', padding: '.2rem .6rem' }} onClick={() => setOrdenarPor('monto')}>💵 Monto</button>
              <button type="button" className={`btn btn-xs ${ordenarPor === 'nombre' ? 'btn-primary' : 'btn-ghost'}`} style={{ borderRadius: '999px', padding: '.2rem .6rem' }} onClick={() => setOrdenarPor('nombre')}>🔤 Nombre</button>
              <button type="button" className={`btn btn-xs ${ordenarPor === 'fecha' ? 'btn-primary' : 'btn-ghost'}`} style={{ borderRadius: '999px', padding: '.2rem .6rem' }} onClick={() => setOrdenarPor('fecha')}>📆 Fecha</button>
            </div>
          )}
          {incluyeDetalle && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
              <span style={{ ...tituloSec, fontSize: '.82rem' }}>📐 Orientación:</span>
              <button type="button" className={`btn btn-xs ${orientacion === 'landscape' ? 'btn-primary' : 'btn-ghost'}`} style={{ borderRadius: '999px', padding: '.2rem .6rem' }} onClick={() => setOrientacion('landscape')}>Horizontal</button>
              <button type="button" className={`btn btn-xs ${orientacion === 'portrait' ? 'btn-primary' : 'btn-ghost'}`} style={{ borderRadius: '999px', padding: '.2rem .6rem' }} onClick={() => setOrientacion('portrait')}>Vertical</button>
            </div>
          )}
        </div>

        {/* KPIs */}
        <div style={{ background: 'var(--surface-1, #0f172a)', border: '1px solid var(--border)', borderRadius: '8px', padding: '.5rem .8rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.5rem' }}>
          <div><div className="muted" style={{ fontSize: '.68rem', fontWeight: 600 }}>TOTAL DE COMPRAS</div><div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f59e0b' }}>{resumen.totalCompras}</div><div className="muted" style={{ fontSize: '.68rem' }}>{dinero(resumen.totalUsd, resumen.totalBs)}</div></div>
          <div><div className="muted" style={{ fontSize: '.68rem', fontWeight: 600 }}>FINALIZADAS</div><div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#22c55e' }}>{resumen.finalizadasCount}</div><div className="muted" style={{ fontSize: '.68rem' }}>{dinero(resumen.finalizadasUsd, resumen.finalizadasBs)}</div></div>
          <div><div className="muted" style={{ fontSize: '.68rem', fontWeight: 600 }}>PENDIENTES</div><div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#eab308' }}>{resumen.pendientesCount}</div><div className="muted" style={{ fontSize: '.68rem' }}>{dinero(resumen.pendientesUsd, resumen.pendientesBs)}</div></div>
          <div><div className="muted" style={{ fontSize: '.68rem', fontWeight: 600 }}>MÁS GASTÓ</div><div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#38bdf8' }}>{resumenMostrado.deptoQueMasGasto ?? '—'}</div><div className="muted" style={{ fontSize: '.68rem' }}>no incluye compras directas</div></div>
        </div>

        {/* Vista previa del listado */}
        {incluyeDetalle && (
          <div style={surf2}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.5rem', flexWrap: 'wrap', gap: '.4rem' }}>
              <span style={{ ...tituloSec, display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                👁️ Vista previa del listado
                <span className="badge" style={{ fontSize: '.7rem', background: 'rgba(255,255,255,0.08)', color: '#cbd5e1' }}>{filas.length} {filas.length === 1 ? 'fila' : 'filas'}</span>
              </span>
            </div>
            {cargando ? (
              <div style={{ textAlign: 'center', padding: '1.2rem', color: '#94a3b8', fontSize: '.82rem' }}>Cargando compras...</div>
            ) : filas.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1.2rem', color: '#94a3b8', fontSize: '.82rem' }}>No hay compras para el período o los filtros seleccionados.</div>
            ) : (
              <div style={{ maxHeight: '260px', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.76rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-1, #0f172a)', borderBottom: '1px solid var(--border)' }}>
                      {marcadosVisibles.map((cKey) => {
                        const cDef = columnasAmbito.find((c) => c.clave === cKey);
                        return <th key={cKey} style={{ padding: '.4rem .55rem', textAlign: cDef?.alineacion || 'left', color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap' }}>{cDef?.etiqueta || cKey}</th>;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f, idx) => (
                      <tr key={f.id || idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: idx % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                        {marcadosVisibles.map((cKey) => {
                          const cDef = columnasAmbito.find((c) => c.clave === cKey);
                          const txt = celdaTexto(f, cKey);
                          return <td key={cKey} style={{ padding: '.35rem .55rem', textAlign: cDef?.alineacion || 'left', whiteSpace: 'nowrap', color: cKey === 'monto_usd' ? '#22c55e' : '#f1f5f9' }}>{txt}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Vista previa de la analítica */}
        <div style={surf2}>
          <div style={{ ...tituloSec, marginBottom: '.5rem' }}>📊 Analítica (resumen)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '.6rem' }}>
            <div>
              <div className="muted" style={{ fontSize: '.72rem', fontWeight: 600, marginBottom: '.25rem' }}>RANKING POR DEPARTAMENTO (GASTO)</div>
              <div className="muted" style={{ fontSize: '.66rem', fontStyle: 'italic', marginBottom: '.3rem' }}>No incluye las compras directas.</div>
              {resumenMostrado.rankingDeptoGasto.slice(0, 6).map((d) => (
                <div key={d.departamento} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.76rem', padding: '.1rem 0' }}>
                  <span>{d.departamento} <span className="muted">({d.pct.toFixed(1)}%)</span></span>
                  <span style={{ color: '#22c55e' }}>{dinero(d.usd, d.bs)}</span>
                </div>
              ))}
              {!resumenMostrado.rankingDeptoGasto.length && <span className="muted" style={{ fontSize: '.74rem' }}>Sin datos en el rango.</span>}
            </div>
            {resumenMostrado.comprasDirectasPorCategoriaGasto.length > 0 && (
              <div>
                <div className="muted" style={{ fontSize: '.72rem', fontWeight: 600, marginBottom: '.3rem' }}>COMPRAS DIRECTAS POR CATEGORÍA DE GASTO</div>
                {resumenMostrado.comprasDirectasPorCategoriaGasto.slice(0, 6).map((c) => (
                  <div key={c.categoria} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.76rem', padding: '.1rem 0' }}>
                    <span>{c.categoria}</span>
                    <span style={{ color: '#38bdf8' }}>{dinero(c.usd, c.bs)}</span>
                  </div>
                ))}
              </div>
            )}
            {resumenMostrado.topItems.length > 0 && (
              <div>
                <div className="muted" style={{ fontSize: '.72rem', fontWeight: 600, marginBottom: '.3rem' }}>TOP ÍTEMS (POR MONTO)</div>
                {resumenMostrado.topItems.slice(0, 6).map((t) => (
                  <div key={t.nombre} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.76rem', padding: '.1rem 0' }}>
                    <span>{t.nombre}{t.cantidad != null ? ` · ${fmtNum(t.cantidad)} u.` : ''}</span>
                    <span style={{ color: '#22c55e' }}>{fmtUsd(t.usd)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Texto de una celda del listado para la vista previa. */
function celdaTexto(f: FilaReporteCompras, cKey: string): string {
  switch (cKey) {
    case 'monto_usd': return fmtUsd(f.monto_usd);
    case 'monto_bs': return fmtBs(f.monto_bs);
    case 'pagado_usd': return fmtUsd(f.pagado_usd);
    case 'cantidad': return f.cantidad != null ? fmtNum(f.cantidad) : '—';
    case 'pct_total': return f.pct_del_total != null ? `${f.pct_del_total.toFixed(1)}%` : '—';
    case 'tipo_compra': return ETIQUETA_TIPO_COMPRA[f.tipo_compra];
    case 'fecha': return f.fecha || '—';
    default: {
      const raw = (f as unknown as Record<string, unknown>)[cKey];
      return raw != null && raw !== '' ? String(raw) : '—';
    }
  }
}
