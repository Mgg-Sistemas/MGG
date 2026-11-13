/* ============================================================
   MGG · Conciliación (12-11-2026) · SOLO LECTURA

   Tarjetas (clickeables) → detalle → la OC se abre en Compras.
   Tabla: ítem, código OC, proveedor, monto ($ y Bs a la tasa con que
   se pagó), referencia de pago (Tesorería), retención (Retenciones),
   factura (delivery / almacén / Compras al finalizar, con vista previa) y status (Compras).
   La referencia de pago se coloca con el lápiz (✎) y, si Tesorería no dejó el
   comprobante de pago, se carga ahí mismo (12-11-2026).
   Reporte dinámico con vista previa en PDF y mensaje de WhatsApp.
   DRIVE (12-11-2026): se carga un Excel/CSV (código OC, referencia, monto Bs),
   validado como en Inventario, y cada OC queda CUADRA / NO CUADRA. Los chips
   «pagos · cuadra · no cuadra · sin cotejar» filtran la tabla (varios a la vez).
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { FacturasOrdenModal } from '@/modules/pedidos/FacturasOrdenModal';
import { comprobantePagoTesoreria, urlAdjuntoOc } from '@/modules/pedidos/pedidos.repository';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useSession } from '@/modules/auth/authStore';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import type { Orden } from '@/shared/lib/types';
import {
  cargarConciliacion, errorComprobantePago, facturasComprasPorResolver, filaConReferencia, guardarReferenciaConciliacion,
  type DatosConciliacion,
} from './conciliacion.repository';
import {
  COLUMNAS_CONCILIACION, bsTxt, desgloseTipos, diaCaracas, filtrar, hayFiltrosActivos, tarjetas, textoReferenciaPago, textoRetencion, textoWhatsappConciliacion, usdTxt,
  valorFiltroDrive, type ColumnaConciliacion, type FilaConciliacion, type FiltroDrive, type FiltroMonedaPago, type FiltrosConciliacion, type GrupoEstado,
} from './conciliacion';
import { vistaPreviaConciliacionPdf } from './conciliacionPdf';
import { vistaPreviaConciliacionExcel } from './conciliacionExcel';
import { analizarTablaDrive, descargarPlantillaDrive, errorArchivoDrive, leerTablaArchivo, pagadoBsTesoreria, type AnalisisDrive } from './conciliacionDrive';
import { CargarDriveModal } from './CargarDriveModal';
import { ConciliacionEntradasTab } from './ConciliacionEntradasTab';
import { armarFilaEntrada, ordenLlevaRetencion, type FilaEntradaRetencion } from './conciliacionEntradas';

type Tarjeta = 'total' | 'pagado' | 'retencion';

const GRUPOS: { value: GrupoEstado; label: string }[] = [
  { value: 'por_aprobar', label: 'Por aprobar' },
  { value: 'esperando_pago', label: 'Esperando pago' },
  { value: 'credito', label: 'Crédito · por pagar' },
  { value: 'pagada', label: 'Pagada' },
  { value: 'recibida', label: 'Recibida' },
  { value: 'finalizada', label: 'Finalizada' },
];

const fechaCorta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-VE', { timeZone: 'America/Caracas' }) : '—');
const TAMANOS_PAGINA = [10, 25, 50, 100];

/** Números de página a mostrar: primera, última y vecinas de la actual (null = «…»). */
function paginasVisibles(actual: number, total: number): Array<number | null> {
  const set = new Set([1, total, actual - 1, actual, actual + 1].filter((n) => n >= 1 && n <= total));
  const nums = [...set].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  nums.forEach((n, i) => { if (i > 0 && n - nums[i - 1] > 1) out.push(null); out.push(n); });
  return out;
}

const fechaDia = (d?: string) => (d ? d.split('-').reverse().join('/') : '…');

/** Rangos rápidos para el reporte (días de Venezuela). */
function rangoRapido(r: 'hoy' | '7d' | 'mes' | 'mes_ant'): { desde: string; hasta: string } {
  const hoy = diaCaracas(new Date());
  const [y, m] = hoy.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (r === 'hoy') return { desde: hoy, hasta: hoy };
  if (r === '7d') { const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 6); return { desde: d.toISOString().slice(0, 10), hasta: hoy }; }
  if (r === 'mes') return { desde: `${y}-${pad(m)}-01`, hasta: hoy };
  const ya = m === 1 ? y - 1 : y, ma = m === 1 ? 12 : m - 1;
  const fin = new Date(Date.UTC(ya, ma, 0)).getUTCDate();
  return { desde: `${ya}-${pad(ma)}-01`, hasta: `${ya}-${pad(ma)}-${pad(fin)}` };
}

/* Opciones de los filtros de casillas. */
const OPC_TIPO: { value: 'oc' | 'servicio'; label: string }[] = [{ value: 'oc', label: 'OC' }, { value: 'servicio', label: 'Servicios' }];
const OPC_PAGO: { value: 'pagadas' | 'sin_pagar'; label: string }[] = [{ value: 'pagadas', label: 'Pagadas' }, { value: 'sin_pagar', label: 'Sin pagar' }];
const OPC_MONEDA_PAGO: { value: FiltroMonedaPago; label: string }[] = [
  { value: 'bs', label: 'En Bs (sí cruza)' },
  { value: 'usd', label: 'En USD (no cruza)' },
  { value: 'mixto', label: 'Mixto (Bs + $)' },
  { value: 'sin_pagar', label: 'Sin pagar' },
];
const OPC_RET: { value: 'si' | 'no'; label: string }[] = [{ value: 'si', label: 'Con retención' }, { value: 'no', label: 'Sin retención' }];
const OPC_REF: { value: 'con' | 'sin'; label: string }[] = [{ value: 'con', label: 'Con referencia' }, { value: 'sin', label: 'Sin referencia' }];
const OPC_DRIVE: { value: FiltroDrive; label: string }[] = [
  { value: 'cuadra', label: 'Cuadra' },
  { value: 'no_cuadra', label: 'No cuadra' },
  { value: 'sin', label: 'Sin cotejar (Bs)' },
  { value: 'no_aplica', label: 'No aplica (USD)' },
];

/** Las etiquetas marcadas de un filtro de casillas («A o B»). */
function etiquetas<T extends string>(marcadas: T[] | undefined, opciones: { value: T; label: string }[]): string {
  return opciones.filter((o) => marcadas?.includes(o.value)).map((o) => o.label).join(' o ');
}

/** Lista desplegable con casillas: se marcan varias opciones; ninguna = todas. */
function FiltroChecks<T extends string>({ titulo, todas, opciones, marcadas, onChange }: {
  titulo: string; todas: string; opciones: { value: T; label: string }[]; marcadas: T[] | undefined; onChange: (v: T[]) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAbierto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc); };
  }, [abierto]);
  const sel = marcadas ?? [];
  const resumen = !sel.length || sel.length === opciones.length ? todas
    : sel.length === 1 ? opciones.find((o) => o.value === sel[0])?.label ?? todas : `${titulo}: ${sel.length}`;
  const toggle = (v: T) => onChange(sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="select" aria-haspopup="true" aria-expanded={abierto} title={titulo}
        onClick={() => setAbierto((a) => !a)}
        style={{ width: 'auto', textAlign: 'left', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: sel.length && sel.length < opciones.length ? 700 : undefined }}>
        {resumen} ▾
      </button>
      {abierto && (
        <div className="card" role="group" aria-label={titulo}
          style={{ position: 'absolute', zIndex: 30, top: 'calc(100% + 4px)', left: 0, minWidth: 200, margin: 0, padding: '.45rem .55rem', background: 'var(--bg-1)', boxShadow: '0 8px 24px rgba(0,0,0,.25)' }}>
          <div className="muted" style={{ fontSize: '.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '.25rem' }}>{titulo}</div>
          {opciones.map((o) => (
            <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: '.45rem', padding: '.22rem .1rem', cursor: 'pointer', fontSize: '.85rem' }}>
              <input type="checkbox" checked={sel.includes(o.value)} onChange={() => toggle(o.value)} /> {o.label}
            </label>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.4rem', marginTop: '.3rem', borderTop: '1px solid var(--border)', paddingTop: '.3rem' }}>
            <button type="button" className="btn btn-xs btn-ghost" onClick={() => onChange(opciones.map((o) => o.value))}>Todas</button>
            <button type="button" className="btn btn-xs btn-ghost" onClick={() => onChange([])} disabled={!sel.length}>Limpiar</button>
          </div>
        </div>
      )}
    </div>
  );
}

const TONOS = {
  gris: { fg: 'var(--text-muted)', bg: 'rgba(148,163,184,.14)', bd: 'rgba(148,163,184,.55)' },
  verde: { fg: 'var(--success, #29c081)', bg: 'rgba(41,192,129,.14)', bd: 'rgba(41,192,129,.7)' },
  rojo: { fg: 'var(--danger, #ef4f5e)', bg: 'rgba(239,79,94,.14)', bd: 'rgba(239,79,94,.7)' },
  amarillo: { fg: 'var(--warning, #f5b400)', bg: 'rgba(245,180,0,.16)', bd: 'rgba(245,180,0,.75)' },
} as const;

/** Chip del Drive (como «119 cuadra»): al tocarlo filtra la tabla; se marcan varios. */
function ChipDrive({ tono, activo, onClick, title, children }: {
  tono: keyof typeof TONOS; activo: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  const t = TONOS[tono];
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={activo}
      style={{
        font: 'inherit', fontSize: '.84rem', fontWeight: 700, padding: '.32rem .85rem', borderRadius: 999, cursor: 'pointer',
        color: t.fg, background: t.bg, border: `1.5px solid ${activo ? t.bd : 'transparent'}`,
        boxShadow: activo ? `0 0 0 2px ${t.bg}` : 'none', whiteSpace: 'nowrap',
      }}>
      {activo ? '✓ ' : ''}{children}
    </button>
  );
}

/** Resumen legible de los filtros activos (para el PDF y el WhatsApp). */
function textoFiltros(f: FiltrosConciliacion): string {
  const p: string[] = [];
  const parte = (txt: string, marcadas: unknown[] | undefined, total: number) => { if (marcadas?.length && marcadas.length < total && txt) p.push(txt); };
  parte(etiquetas(f.tipo, OPC_TIPO), f.tipo, OPC_TIPO.length);
  parte(f.grupo?.length ? `Status: ${etiquetas(f.grupo, GRUPOS)}` : '', f.grupo, GRUPOS.length);
  parte(etiquetas(f.pago, OPC_PAGO), f.pago, OPC_PAGO.length);
  parte(etiquetas(f.monedaPago, OPC_MONEDA_PAGO), f.monedaPago, OPC_MONEDA_PAGO.length);
  parte(etiquetas(f.retencion, OPC_RET), f.retencion, OPC_RET.length);
  parte(etiquetas(f.referencia, OPC_REF), f.referencia, OPC_REF.length);
  parte(f.drive?.length ? `DRIVE/BANCO: ${etiquetas(f.drive, OPC_DRIVE)}` : '', f.drive, OPC_DRIVE.length);
  if (f.desde || f.hasta) p.push(`${f.fechaBase === 'pago' ? 'Pagadas' : 'OC'} del ${fechaDia(f.desde)} al ${fechaDia(f.hasta)}`);
  if (f.texto?.trim()) p.push(`Búsqueda: «${f.texto.trim()}»`);
  return p.join(' · ');
}

/** Abre el comprobante de pago: el conocido o, si no, el que Tesorería dejó en la carpeta de la OC. */
async function verComprobantePago(f: FilaConciliacion, o: Orden | undefined) {
  try {
    let ref: { path: string; nombre: string } | null = f.comprobantePago;
    if (!ref && o) ref = await comprobantePagoTesoreria(o);
    if (!ref) { toast('Esta OC no tiene comprobante de pago. Cárgalo con el lápiz ✎.', 'info'); return; }
    await previewFileUrl(await urlAdjuntoOc(ref.path), ref.nombre, 'Comprobante de pago');
  } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir el comprobante', 'error'); }
}

export function ConciliacionPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const puedeEditar = can('conciliacion', 'escritura');
  const [tabActiva, setTabActiva] = useState<'salidas' | 'entradas'>('salidas');
  const [editRef, setEditRef] = useState<FilaConciliacion | null>(null);
  const [datos, setDatos] = useState<DatosConciliacion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<FiltrosConciliacion>({});
  const [tarjeta, setTarjeta] = useState<Tarjeta | null>(null);
  const [verFacturas, setVerFacturas] = useState<Orden | null>(null);
  const [reporte, setReporte] = useState(false);
  const [porPagina, setPorPagina] = useState(10);
  const [drive, setDrive] = useState<AnalisisDrive | null>(null);
  const [leyendoDrive, setLeyendoDrive] = useState(false);
  const driveInput = useRef<HTMLInputElement>(null);

  async function elegirDrive(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (driveInput.current) driveInput.current.value = '';
    if (!file || !datos) return;
    const err = errorArchivoDrive(file);
    if (err) { toast(err, 'error'); return; }
    setLeyendoDrive(true);
    try {
      const tabla = await leerTablaArchivo(file);
      setDrive(analizarTablaDrive(tabla, file.name, datos.filas.map((f) => ({
        id: f.id,
        codigo: f.codigo,
        sp: f.sp,
        drive: f.drive,
        yaConciliada: f.drive?.estado === 'CUADRA',
        montoBs: f.montoBs,
        referencias: [f.referencia.bs, f.referencia.binance, f.referencia.manual].filter(Boolean) as string[],
        refsTesoreria: [f.referencia.bs, f.referencia.binance].filter(Boolean) as string[],
        pagadoBs: pagadoBsTesoreria(datos.ordenes.get(f.id)?.historial),
        historial: datos.ordenes.get(f.id)?.historial,
        pagado: f.pagado,
        seCruza: f.seCruza,
        monedaPago: f.monedaPago,
      }))));
    } catch (er) { toast(er instanceof Error ? er.message : 'No se pudo leer el archivo', 'error'); }
    finally { setLeyendoDrive(false); }
  }

  const alGuardarDrive = (os: Orden[]) => {
    setDatos((d) => {
      if (!d) return d;
      const ordenes = new Map(d.ordenes);
      for (const o of os) ordenes.set(o.id, o);
      const porId = new Map(os.map((o) => [o.id, o]));
      return { ...d, ordenes, filas: d.filas.map((f) => { const o = porId.get(f.id); return o ? filaConReferencia(f, o) : f; }) };
    });
  };
  const [pagina, setPagina] = useState(1);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try { setDatos(await cargarConciliacion()); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar la conciliación.'); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  // OC viejas: la factura que cargó Compras al finalizar se distingue del comprobante de
  // Tesorería por la hora de subida (storage). Se resuelve después de mostrar la tabla.
  useEffect(() => {
    if (!datos?.porResolver.length) return;
    const base = datos;
    let vivo = true;
    facturasComprasPorResolver(base).then((ids) => {
      if (!vivo) return;
      setDatos((d) => (d && d.ordenes === base.ordenes
        ? { ...d, porResolver: [], filas: d.filas.map((f) => (ids.has(f.id) ? { ...f, facturas: f.facturas + 1 } : f)) }
        : d));
    }).catch(() => { /* sin storage: quedan las que se saben por el historial */ });
    return () => { vivo = false; };
  }, [datos]);

  const alGuardarReferencia = (o: Orden) => {
    setDatos((d) => {
      if (!d) return d;
      const ordenes = new Map(d.ordenes); ordenes.set(o.id, o);
      return { ...d, ordenes, filas: d.filas.map((f) => (f.id === o.id ? filaConReferencia(f, o) : f)) };
    });
    setEditRef(null);
  };

  const filas = useMemo(() => filtrar(datos?.filas ?? [], filtros), [datos, filtros]);

  const filasEntradas: FilaEntradaRetencion[] = useMemo(() => {
    if (!datos) return [];
    let item = 1;
    const out: FilaEntradaRetencion[] = [];
    for (const f of datos.filas) {
      const o = datos.ordenes.get(f.id);
      if (!o) continue;
      if (f.retencion.lleva || ordenLlevaRetencion(o)) {
        out.push(armarFilaEntrada(o, f.proveedor, f.tasa, item++, [], f.facturas));
      }
    }
    return out;
  }, [datos]);
  // Chips del DRIVE: cuentan las órdenes PAGADAS con los demás filtros (sin el de pago ni el de drive).
  const chips = useMemo(() => {
    const pagadas = filtrar(datos?.filas ?? [], { ...filtros, drive: [], pago: [] }).filter((f) => f.pagado);
    const n = (v: FiltroDrive) => pagadas.filter((f) => valorFiltroDrive(f) === v).length;
    return { pagos: pagadas.length, cuadra: n('cuadra'), no_cuadra: n('no_cuadra'), sin: n('sin'), no_aplica: n('no_aplica') };
  }, [datos, filtros]);
  const t = useMemo(() => tarjetas(filas), [filas]);
  // El reporte trae su propio rango de fechas: parte de los demás filtros de la pantalla.
  const baseReporte = useMemo(() => filtrar(datos?.filas ?? [], { ...filtros, desde: '', hasta: '' }), [datos, filtros]);
  useEffect(() => { setPagina(1); }, [filtros, porPagina]);
  const totalPaginas = Math.max(1, Math.ceil(filas.length / porPagina));
  const paginaActual = Math.min(pagina, totalPaginas);
  const desde = (paginaActual - 1) * porPagina;
  const filasPagina = filas.slice(desde, desde + porPagina);

  const setF = (patch: Partial<FiltrosConciliacion>) => setFiltros((f) => ({ ...f, ...patch }));
  /** Chip «pagos»: solo las pagadas (quita lo del drive). Chips del drive: se marcan varios. */
  const soloPagos = !!filtros.pago?.length && filtros.pago.length === 1 && filtros.pago[0] === 'pagadas';
  const tocarChipPagos = () => setFiltros((f) => (soloPagos && !f.drive?.length ? { ...f, pago: [] } : { ...f, pago: ['pagadas'], drive: [] }));
  const tocarChipDrive = (v: FiltroDrive) => setFiltros((f) => {
    const sel = f.drive ?? [];
    const drive = sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v];
    return { ...f, drive, pago: drive.length ? ['pagadas'] : f.pago };
  });
  const hayFiltros = hayFiltrosActivos(filtros);
  const abrirOc = (id: string) => navigate(`/app/pedidos?detalle=${encodeURIComponent(id)}`);

  const detalle: FilaConciliacion[] = useMemo(() => {
    if (!tarjeta) return [];
    const ids = new Set(tarjeta === 'total' ? t.totalOc.ids : tarjeta === 'pagado' ? t.pagado.ids : t.conRetencion.ids);
    return filas.filter((f) => ids.has(f.id));
  }, [tarjeta, t, filas]);

  const card = (k: Tarjeta, icono: string, titulo: string, valor: string, sub: string, color: string) => (
    <button type="button" onClick={() => setTarjeta(tarjeta === k ? null : k)} className="card"
      style={{ textAlign: 'left', cursor: 'pointer', margin: 0, padding: '.85rem 1rem', borderTop: `3px solid ${color}`, outline: tarjeta === k ? `2px solid ${color}` : 'none', font: 'inherit', color: 'inherit' }}
      title="Ver el detalle">
      <div className="muted" style={{ fontSize: '.72rem', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>{icono} {titulo}</div>
      <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '.25rem' }}>{valor}</div>
      <div className="muted" style={{ fontSize: '.78rem', marginTop: '.2rem' }}>{sub}</div>
      <div style={{ fontSize: '.72rem', marginTop: '.4rem', color }}>{tarjeta === k ? '▾ ocultar detalle' : '▸ ver detalle'}</div>
    </button>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>🧮 Conciliación</h1>
          <p className="hint muted" style={{ margin: '.25rem 0 0' }}>
            Cada OC y orden de servicio con su pago (Tesorería), su retención (Retenciones), su factura (delivery / almacén / Compras) y su status (Compras).
            {puedeEditar && ' La referencia de pago y su comprobante se colocan con el lápiz ✎.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={() => void cargar()} disabled={cargando}>{cargando ? 'Cargando…' : '↻ Actualizar'}</button>
          {puedeEditar && (
            <>
              <button className="btn btn-ghost" onClick={() => void descargarPlantillaDrive().catch(() => toast('No se pudo generar la plantilla', 'error'))}
                title="Plantilla del archivo: Código OC, Referencia y Monto Bs">⬇ Plantilla Drive/Banco</button>
              <button className="btn btn-ghost" onClick={() => driveInput.current?.click()} disabled={!datos || leyendoDrive}
                title="Cargar el archivo del Drive (Excel o CSV) y cruzarlo por código de OC, referencia y monto en Bs">
                {leyendoDrive ? 'Leyendo…' : '📥 Cargar Drive/Banco'}
              </button>
              <input ref={driveInput} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => void elegirDrive(e)} />
            </>
          )}
          <button className="btn btn-primary" onClick={() => setReporte(true)} disabled={!datos}>📊 Reporte dinámico</button>
        </div>
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '1rem' }}><strong>Error:</strong> {error}</div>}
      {datos && !datos.conLibroFiscal && (
        <div className="card" style={{ borderLeft: '3px solid var(--warning)', marginBottom: '1rem', fontSize: '.84rem' }}>
          No tienes acceso al libro fiscal de Retenciones: el tipo de retención se ve, pero no su N° de comprobante.
        </div>
      )}

      {/* Selector de pestañas con los estilos estándar del sistema */}
      <div className="view-switch" role="tablist" aria-label="Secciones de conciliación" style={{ margin: '0 0 1.25rem 0', width: 'max-content' }}>
        <button
          type="button"
          role="tab"
          aria-selected={tabActiva === 'salidas'}
          className={`view-switch-tab${tabActiva === 'salidas' ? ' active' : ''}`}
          onClick={() => setTabActiva('salidas')}
        >
          🔄 Salidas · Compras y Servicios ({datos?.filas.length ?? 0})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tabActiva === 'entradas'}
          className={`view-switch-tab${tabActiva === 'entradas' ? ' active' : ''}`}
          onClick={() => setTabActiva('entradas')}
        >
          🏛️ Entradas · Reintegros de Retención ({filasEntradas.length})
        </button>
      </div>

      {tabActiva === 'salidas' ? (
        <>
          {/* Tarjetas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        {card('total', '🧾', 'Total de órdenes', `${t.totalOc.cantidad}`, `${desgloseTipos(t)} · ${usdTxt(t.totalOc.usd)} · ${bsTxt(t.totalOc.bs)}`, 'var(--primary, #ff8a00)')}
        {card('pagado', '💵', 'Total pagado', usdTxt(t.pagado.usd), `${bsTxt(t.pagado.bs)} · ${t.pagado.cantidad} órdenes (Bs a la tasa con que se pagó)`, 'var(--success, #29c081)')}
        {card('retencion', '🏛', 'Con retención', `${t.conRetencion.cantidad}`, `${usdTxt(t.conRetencion.usd)} en esas órdenes`, 'var(--info, #4aa8ff)')}
      </div>

      {/* Detalle de la tarjeta */}
      {tarjeta && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
            <span>{tarjeta === 'total' ? '🧾 Todas las órdenes' : tarjeta === 'pagado' ? '💵 Órdenes pagadas' : '🏛 Órdenes con retención'} · {detalle.length}</span>
            <span className="muted" style={{ fontWeight: 400, fontSize: '.8rem' }}>Toca una orden para abrirla en Compras</span>
          </div>
          <div style={{ display: 'grid', gap: '.4rem', maxHeight: 360, overflowY: 'auto' }}>
            {detalle.map((f) => (
              <button key={f.id} type="button" onClick={() => abrirOc(f.id)} className="card"
                style={{ margin: 0, padding: '.55rem .75rem', display: 'grid', gridTemplateColumns: 'minmax(120px,auto) 1fr auto', gap: '.25rem .9rem', alignItems: 'center', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                <strong className="mono">{f.tipo === 'servicio' && '🔧 '}{f.codigo}</strong>
                <span style={{ fontSize: '.84rem' }}>
                  {f.proveedor}
                  <span className="muted" style={{ display: 'block', fontSize: '.74rem' }}>
                    {tarjeta === 'pagado' ? `Pagada ${fechaCorta(f.pagadaEn)} · ref. ${textoReferenciaPago(f.referencia) || '—'}`
                      : tarjeta === 'retencion' ? `Retención: ${textoRetencion(f.retencion)}`
                        : `${f.tipo === 'servicio' ? 'Servicio' : 'OC'} ${fechaCorta(f.fechaOc)}`}
                  </span>
                </span>
                <span style={{ textAlign: 'right' }}>
                  <span className="mono" style={{ fontWeight: 700 }}>{usdTxt(tarjeta === 'pagado' ? f.pagadoUsd : f.montoUsd)}</span>
                  <span style={{ display: 'block' }}><span className={`badge ${f.estado.className}`} style={{ fontSize: '.66rem' }}>{f.estado.label}</span></span>
                </span>
              </button>
            ))}
            {!detalle.length && <div className="muted" style={{ padding: '.75rem' }}>No hay órdenes en esta tarjeta con los filtros actuales.</div>}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" style={{ flex: '1 1 220px' }} placeholder="🔎 Código OC / SV, proveedor, referencia, N° de retención…" value={filtros.texto ?? ''} onChange={(e) => setF({ texto: e.target.value })} />
        <FiltroChecks titulo="Tipo" todas="OC y servicios" opciones={OPC_TIPO} marcadas={filtros.tipo} onChange={(v) => setF({ tipo: v })} />
        <FiltroChecks titulo="Status" todas="Todos los status" opciones={GRUPOS} marcadas={filtros.grupo} onChange={(v) => setF({ grupo: v })} />
        <FiltroChecks titulo="Pago" todas="Pagadas y sin pagar" opciones={OPC_PAGO} marcadas={filtros.pago} onChange={(v) => setF({ pago: v })} />
        <FiltroChecks titulo="Moneda" todas="Moneda: todas" opciones={OPC_MONEDA_PAGO} marcadas={filtros.monedaPago} onChange={(v) => setF({ monedaPago: v })} />
        <FiltroChecks titulo="Retención" todas="Con y sin retención" opciones={OPC_RET} marcadas={filtros.retencion} onChange={(v) => setF({ retencion: v })} />
        <FiltroChecks titulo="Referencia" todas="Con y sin referencia" opciones={OPC_REF} marcadas={filtros.referencia} onChange={(v) => setF({ referencia: v })} />
        <FiltroChecks titulo="DRIVE/BANCO" todas="DRIVE/BANCO: todos" opciones={OPC_DRIVE} marcadas={filtros.drive} onChange={(v) => setF({ drive: v })} />
        <label className="muted" style={{ fontSize: '.78rem', display: 'flex', alignItems: 'center', gap: '.3rem' }}>Desde <input className="input" type="date" value={filtros.desde ?? ''} onChange={(e) => setF({ desde: e.target.value })} /></label>
        <label className="muted" style={{ fontSize: '.78rem', display: 'flex', alignItems: 'center', gap: '.3rem' }}>Hasta <input className="input" type="date" value={filtros.hasta ?? ''} onChange={(e) => setF({ hasta: e.target.value })} /></label>
        {hayFiltros && <button className="btn btn-sm btn-ghost" onClick={() => setFiltros({})}>✕ Limpiar</button>}
      </div>

      {/* Tabla */}
      <div className="card">
        <div className="card-title">Órdenes de compra · {filas.length}{datos && filas.length !== datos.filas.length ? ` de ${datos.filas.length}` : ''}</div>
        {datos && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.45rem', marginBottom: '.75rem' }} role="group" aria-label="Filtrar por DRIVE/BANCO">
            <ChipDrive tono="gris" activo={soloPagos && !filtros.drive?.length} onClick={tocarChipPagos}
              title="Solo las órdenes pagadas">{chips.pagos} pagos</ChipDrive>
            <ChipDrive tono="verde" activo={!!filtros.drive?.includes('cuadra')} onClick={() => tocarChipDrive('cuadra')}
              title="Pagadas en Bs cuyo Drive CUADRA (referencia y monto en Bs coinciden)">{chips.cuadra} cuadra</ChipDrive>
            <ChipDrive tono="rojo" activo={!!filtros.drive?.includes('no_cuadra')} onClick={() => tocarChipDrive('no_cuadra')}
              title="Pagadas en Bs cuyo Drive NO CUADRA">{chips.no_cuadra} no cuadra</ChipDrive>
            <ChipDrive tono="amarillo" activo={!!filtros.drive?.includes('sin')} onClick={() => tocarChipDrive('sin')}
              title="Pagadas en Bs que todavía no están en ningún archivo del Drive">{chips.sin} sin cotejar</ChipDrive>
            <ChipDrive tono="gris" activo={!!filtros.drive?.includes('no_aplica')} onClick={() => tocarChipDrive('no_aplica')}
              title="Pagadas en divisas/USD (no cruzan con el Drive en Bs)">{chips.no_aplica} en USD (no cruzan)</ChipDrive>
          </div>
        )}
        {cargando && !datos ? <div className="muted" style={{ padding: '1rem' }}>Cargando…</div> : (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'center' }}>Ítem</th><th>Código</th><th>Proveedor</th>
                  <th style={{ textAlign: 'right' }}>Monto de la OC</th>
                  <th style={{ textAlign: 'center' }}>Moneda pago</th>
                  <th style={{ textAlign: 'center' }}>¿Se cruza?</th>
                  <th>Referencia de pago</th><th>Retención</th><th>Factura</th><th>Status</th><th>DRIVE/BANCO</th>
                </tr>
              </thead>
              <tbody>
                {filasPagina.map((f) => (
                  <tr key={f.id}>
                    <td className="mono muted" style={{ textAlign: 'center' }}>{f.item}</td>
                    <td>
                      <button type="button" className="btn btn-sm btn-ghost mono" style={{ padding: '.1rem .35rem', fontWeight: 700 }} onClick={() => abrirOc(f.id)} title={f.tipo === 'servicio' ? 'Abrir la orden de servicio en Compras' : 'Abrir la OC en Compras'}>{f.codigo}</button>
                      <div className="muted mono" style={{ fontSize: '.7rem' }}>
                        {f.tipo === 'servicio'
                          ? <><span className="badge warning" style={{ fontSize: '.62rem', fontFamily: 'inherit' }}>🔧 Servicio</span>{f.sp !== f.codigo ? ` ${f.sp}` : ''}</>
                          : f.sp} · {fechaCorta(f.fechaOc)}
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'normal', minWidth: 160 }}>{f.proveedor}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="mono" style={{ fontWeight: 700 }}>{usdTxt(f.montoUsd)}</div>
                      <div className="mono muted" style={{ fontSize: '.74rem' }} title={f.tasa ? `Tasa ${f.tasa}${f.tasaEsDeHoy ? ' (de hoy: la OC no se ha pagado)' : ' (BCV del día en que se pagó)'}` : 'Sin tasa registrada'}>
                        {f.montoBs != null ? bsTxt(f.montoBs) : 'Bs —'}{f.tasaEsDeHoy && f.montoBs != null ? ' · hoy' : ''}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {f.monedaPago === 'Bs' && (
                        <span className="badge info" style={{ fontSize: '.72rem', fontWeight: 700 }} title="Pagada en Bolívares">
                          Bs
                        </span>
                      )}
                      {f.monedaPago === 'USD' && (
                        <span className="badge" style={{ fontSize: '.72rem', fontWeight: 700, background: 'rgba(148,163,184,.14)', color: 'var(--text-muted)' }} title="Pagada en Divisas / USD ($)">
                          $ USD
                        </span>
                      )}
                      {f.monedaPago === 'Mixto' && (
                        <span className="badge warning" style={{ fontSize: '.72rem', fontWeight: 700 }} title="Pago mixto (Bs y Divisas)">
                          Mixto
                        </span>
                      )}
                      {f.monedaPago === 'Sin pagar' && (
                        <span className="muted" style={{ fontSize: '.75rem' }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {f.seCruza ? (
                        <span className="badge success" style={{ fontSize: '.72rem', fontWeight: 700 }} title="Pagada en Bs: sí se cruza contra el Drive/Banco">
                          ✓ Sí
                        </span>
                      ) : f.monedaPago === 'Sin pagar' ? (
                        <span className="muted" style={{ fontSize: '.75rem' }}>—</span>
                      ) : (
                        <span className="badge" style={{ fontSize: '.72rem', fontWeight: 600, background: 'rgba(148,163,184,.14)', color: 'var(--text-muted)' }} title="Pagada en USD / divisas: no se cruza contra cuenta en Bs">
                          ✕ No
                        </span>
                      )}
                    </td>
                    <td className="mono">
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.3rem' }}>
                        <div style={{ flex: 1 }}>
                          {f.referencia.bs && <div>Bs …{f.referencia.bs}</div>}
                          {f.referencia.binance && <div>Binance …{f.referencia.binance}</div>}
                          {f.referencia.manual && <div title="Colocada en Conciliación">Ref. {f.referencia.manual}</div>}
                          {!f.referencia.bs && !f.referencia.binance && !f.referencia.manual && <span className="muted">{f.pagado ? 'sin referencia' : '—'}</span>}
                          {(f.pagado || f.comprobantePago) && (
                            <button type="button" className="btn btn-xs btn-ghost" style={{ padding: '0 .3rem', fontFamily: 'inherit', display: 'block' }}
                              onClick={() => void verComprobantePago(f, datos?.ordenes.get(f.id))}
                              title={f.comprobantePago ? `${f.comprobantePago.fuente === 'tesoreria' ? 'Comprobante de Tesorería' : 'Comprobante cargado en Conciliación'} · ${f.comprobantePago.nombre}` : 'Buscar el comprobante que dejó Tesorería'}>
                              📎 Comprobante
                            </button>
                          )}
                        </div>
                        {puedeEditar && (
                          <button type="button" className="btn btn-xs btn-ghost" style={{ padding: '0 .3rem' }} onClick={() => setEditRef(f)}
                            title="Agregar o editar la referencia y el comprobante de pago" aria-label={`Editar la referencia de pago de ${f.codigo}`}>✎</button>
                        )}
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'normal', minWidth: 130 }}>
                      {f.retencion.lleva ? (
                        <>
                          <div>{f.retencion.tipos.map((x) => <span key={x} className="badge info" style={{ fontSize: '.66rem', marginRight: '.2rem' }}>{x}</span>)}{!f.retencion.tipos.length && <span className="badge info" style={{ fontSize: '.66rem' }}>Sí</span>}</div>
                          <div className="mono muted" style={{ fontSize: '.72rem' }}>{f.retencion.codigos.length ? `N° ${f.retencion.codigos.join(', ')}` : f.retencion.hecha ? 'hecha' : 'pendiente'}</div>
                        </>
                      ) : <span className="muted">No</span>}
                    </td>
                    <td>
                      {f.facturas > 0
                        ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => { const o = datos?.ordenes.get(f.id); if (o) setVerFacturas(o); }}>🧾 Ver ({f.facturas})</button>
                        : <span className="muted" style={{ fontSize: '.78rem' }}>Sin factura</span>}
                    </td>
                    <td><span className={`badge ${f.estado.className}`}>{f.estado.label}</span></td>
                    <td style={{ whiteSpace: 'normal', minWidth: 110 }}>
                      {f.drive ? (
                        <>
                          <span className={`badge ${f.drive.estado === 'CUADRA' ? 'success' : 'danger'}`} title={f.drive.motivo}>{f.drive.estado}</span>
                          {f.drive.estado === 'NO CUADRA' && <div className="muted" style={{ fontSize: '.7rem', maxWidth: 200 }}>{f.drive.motivo}</div>}
                          <div className="muted mono" style={{ fontSize: '.66rem' }} title={`Archivo: ${f.drive.datos.archivo}`}>
                            {bsTxt(f.drive.datos.montoBs)} · ref. {f.drive.datos.referencias.join(', ')}
                          </div>
                        </>
                      ) : f.pagado && !f.seCruza ? (
                        <span className="badge" style={{ fontSize: '.7rem', background: 'rgba(148,163,184,.12)', color: 'var(--text-muted)' }} title="Pagada en USD: no cruza contra el banco en Bs">
                          No aplica (USD)
                        </span>
                      ) : (
                        <span className="muted" style={{ fontSize: '.78rem' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!filas.length && <tr><td colSpan={11} className="muted" style={{ textAlign: 'center', padding: '1.5rem' }}>No hay órdenes con esos filtros.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {filas.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '.6rem', marginTop: '.75rem' }}>
            <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.82rem' }}>
              Mostrar
              <select className="select" style={{ width: 'auto' }} value={porPagina} onChange={(e) => setPorPagina(Number(e.target.value))}>
                {TAMANOS_PAGINA.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              por página
            </label>
            <span className="muted" style={{ fontSize: '.82rem' }}>{desde + 1}–{desde + filasPagina.length} de {filas.length} OC</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}>
              <button type="button" className="btn btn-sm btn-ghost" disabled={paginaActual <= 1} onClick={() => setPagina(1)} title="Primera página">«</button>
              <button type="button" className="btn btn-sm btn-ghost" disabled={paginaActual <= 1} onClick={() => setPagina(paginaActual - 1)}>‹ Anterior</button>
              {paginasVisibles(paginaActual, totalPaginas).map((n, i) => n === null
                ? <span key={`s${i}`} className="muted" style={{ padding: '0 .2rem' }}>…</span>
                : <button key={n} type="button" className={`btn btn-sm ${n === paginaActual ? 'btn-primary' : 'btn-ghost'}`} style={{ minWidth: 32 }} onClick={() => setPagina(n)}>{n}</button>)}
              <button type="button" className="btn btn-sm btn-ghost" disabled={paginaActual >= totalPaginas} onClick={() => setPagina(paginaActual + 1)}>Siguiente ›</button>
              <button type="button" className="btn btn-sm btn-ghost" disabled={paginaActual >= totalPaginas} onClick={() => setPagina(totalPaginas)} title="Última página">»</button>
            </div>
          </div>
        )}
      </div>
      </>
      ) : (
        <ConciliacionEntradasTab
          filas={filasEntradas}
          puedeEditar={puedeEditar}
          onActualizarOrden={alGuardarReferencia}
          onVerOc={abrirOc}
        />
      )}

      {verFacturas && <FacturasOrdenModal orden={verFacturas} onClose={() => setVerFacturas(null)} />}
      {editRef && datos?.ordenes.get(editRef.id) && (
        <ReferenciaPagoModal fila={editRef} orden={datos.ordenes.get(editRef.id) as Orden} onClose={() => setEditRef(null)} onSaved={alGuardarReferencia} />
      )}
      {drive && datos && (
        <CargarDriveModal analisis={drive} filas={datos.filas} ordenes={datos.ordenes} onClose={() => setDrive(null)} onGuardado={alGuardarDrive} />
      )}
      {reporte && <ReporteConciliacionModal base={baseReporte} filtros={filtros} onClose={() => setReporte(false)} />}
    </div>
  );
}

/* ───────── ✎ Referencia y comprobante de pago ───────── */
function ReferenciaPagoModal({ fila, orden, onClose, onSaved }: {
  fila: FilaConciliacion; orden: Orden; onClose: () => void; onSaved: (o: Orden) => void;
}) {
  const { user } = useSession();
  const [referencia, setReferencia] = useState(fila.referencia.manual ?? '');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [deTesoreria, setDeTesoreria] = useState<{ path: string; nombre: string } | null | undefined>(
    fila.comprobantePago?.fuente === 'tesoreria' ? fila.comprobantePago : undefined,
  );
  const deConciliacion = fila.comprobantePago?.fuente === 'conciliacion' ? fila.comprobantePago : null;
  const refTesoreria = textoReferenciaPago({ bs: fila.referencia.bs, binance: fila.referencia.binance });

  useEffect(() => {
    if (deTesoreria !== undefined) return;
    let vivo = true;
    comprobantePagoTesoreria(orden).then((r) => { if (vivo) setDeTesoreria(r); }).catch(() => { if (vivo) setDeTesoreria(null); });
    return () => { vivo = false; };
  }, [orden, deTesoreria]);

  const ver = async (ref: { path: string; nombre: string }, titulo: string) => {
    try { await previewFileUrl(await urlAdjuntoOc(ref.path), ref.nombre, titulo); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir el comprobante', 'error'); }
  };

  const elegir = (f: File | null) => {
    setError(null);
    if (f) { const e = errorComprobantePago(f); if (e) { setError(e); setArchivo(null); return; } }
    setArchivo(f);
  };

  const sinCambios = referencia.trim() === (fila.referencia.manual ?? '') && !archivo;

  async function guardar() {
    setGuardando(true); setError(null);
    try {
      const o = await guardarReferenciaConciliacion(orden.id, { referencia, archivo }, user?.email ?? 'conciliacion');
      toast('Referencia de pago guardada', 'success');
      onSaved(o);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); setGuardando(false); }
  }

  return (
    <Modal title={`✎ Referencia de pago · ${fila.codigo}`} size="md" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
      <button className="btn btn-primary" onClick={() => void guardar()} disabled={guardando || sinCambios}>{guardando ? 'Guardando…' : 'Guardar'}</button>
    </>}>
      <p className="hint muted" style={{ marginTop: 0 }}>{fila.proveedor} · {usdTxt(fila.montoUsd)}</p>
      <div className="field" style={{ marginBottom: '.8rem' }}>
        <label>Referencia que cargó Tesorería</label>
        <div className="mono">{refTesoreria || <span className="muted">Tesorería no cargó referencia</span>}</div>
      </div>
      <div className="field" style={{ marginBottom: '.9rem' }}>
        <label htmlFor="ref-conc">Referencia de pago</label>
        <input id="ref-conc" className="input mono" value={referencia} maxLength={80} autoFocus
          placeholder="N° de referencia, transferencia, Binance…" onChange={(e) => setReferencia(e.target.value)} />
        <small className="muted">Queda en el historial de la OC; lo de Tesorería no se modifica. Déjala vacía para quitarla.</small>
      </div>
      <div className="field">
        <label>Comprobante de pago</label>
        {deTesoreria === undefined && <div className="muted" style={{ fontSize: '.82rem' }}>Buscando el comprobante de Tesorería…</div>}
        {deTesoreria && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.4rem' }}>
            <span>💳 De Tesorería: <strong>{deTesoreria.nombre}</strong></span>
            <button type="button" className="btn btn-xs btn-ghost" onClick={() => void ver(deTesoreria, 'Comprobante de pago (Tesorería)')}>👁 Ver</button>
          </div>
        )}
        {deTesoreria === null && <div className="muted" style={{ fontSize: '.82rem', marginBottom: '.4rem' }}>Tesorería no dejó comprobante de pago.</div>}
        {deConciliacion && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.4rem' }}>
            <span>📎 Cargado en Conciliación: <strong>{deConciliacion.nombre}</strong></span>
            <button type="button" className="btn btn-xs btn-ghost" onClick={() => void ver(deConciliacion, 'Comprobante de pago')}>👁 Ver</button>
          </div>
        )}
        <input type="file" accept="application/pdf,image/*" onChange={(e) => elegir(e.target.files?.[0] ?? null)} />
        <small className="muted" style={{ display: 'block' }}>
          {deTesoreria ? 'Ya está el de Tesorería: carga otro solo si hace falta. ' : ''}PDF o imagen, hasta 10 MB{deConciliacion ? ' (reemplaza el cargado en Conciliación)' : ''}.
        </small>
      </div>
      {error && <div className="aviso danger sm" style={{ marginTop: '.6rem' }}>{error}</div>}
    </Modal>
  );
}

/* ───────── Reporte dinámico: columnas, vista previa PDF y WhatsApp ───────── */
function ReporteConciliacionModal({ base, filtros, onClose }: { base: FilaConciliacion[]; filtros: FiltrosConciliacion; onClose: () => void }) {
  const [desde, setDesde] = useState(filtros.desde ?? '');
  const [hasta, setHasta] = useState(filtros.hasta ?? '');
  const [fechaBase, setFechaBase] = useState<'oc' | 'pago'>(filtros.fechaBase ?? 'oc');
  const filas = useMemo(() => filtrar(base, { desde, hasta, fechaBase }), [base, desde, hasta, fechaBase]);
  const filtroTexto = textoFiltros({ ...filtros, desde, hasta, fechaBase });
  const rangoInvalido = !!(desde && hasta && desde > hasta);
  const aplicarRango = (r: Parameters<typeof rangoRapido>[0]) => { const x = rangoRapido(r); setDesde(x.desde); setHasta(x.hasta); };
  const [cols, setCols] = useState<ColumnaConciliacion[]>(COLUMNAS_CONCILIACION.filter((c) => c.porDefecto).map((c) => c.clave));
  const [conTarjetas, setConTarjetas] = useState(true);
  const [orientacion, setOrientacion] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [generando, setGenerando] = useState<null | 'pdf' | 'excel'>(null);
  const toggle = (c: ColumnaConciliacion) => setCols((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c]));
  const fecha = new Date().toLocaleDateString('es-VE', { timeZone: 'America/Caracas' });
  const texto = useMemo(() => textoWhatsappConciliacion(filas, { columnas: cols, filtroTexto, fecha }), [filas, cols, filtroTexto, fecha]);

  async function vistaPrevia(tipo: 'pdf' | 'excel') {
    setGenerando(tipo);
    try {
      if (tipo === 'pdf') await vistaPreviaConciliacionPdf(filas, { columnas: cols, filtroTexto, conTarjetas, orientacion });
      else await vistaPreviaConciliacionExcel(filas, { columnas: cols, filtroTexto, conTarjetas });
    } catch (e) { toast(e instanceof Error ? e.message : `No se pudo generar el ${tipo === 'pdf' ? 'PDF' : 'Excel'}`, 'error'); }
    finally { setGenerando(null); }
  }
  const sinGenerar = !!generando || !cols.length || !filas.length || rangoInvalido;

  return (
    <Modal title="📊 Reporte dinámico · Conciliación" size="lg" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        <button className="btn btn-ghost" onClick={() => void vistaPrevia('excel')} disabled={sinGenerar}>{generando === 'excel' ? 'Generando…' : '📗 Vista previa Excel'}</button>
        <button className="btn btn-primary" onClick={() => void vistaPrevia('pdf')} disabled={sinGenerar}>{generando === 'pdf' ? 'Generando…' : '👁 Vista previa PDF'}</button>
      </>}>
      <div className="card" style={{ margin: '0 0 .75rem' }}>
        <div className="card-title" style={{ marginBottom: '.45rem' }}>📅 Rango de fechas</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem .8rem', alignItems: 'flex-end' }}>
          <label className="muted" style={{ fontSize: '.8rem', display: 'grid', gap: '.2rem' }}>
            Según
            <select className="select" style={{ width: 'auto' }} value={fechaBase} onChange={(e) => setFechaBase(e.target.value as 'oc' | 'pago')}>
              <option value="oc">Fecha de la OC</option><option value="pago">Fecha de pago</option>
            </select>
          </label>
          <label className="muted" style={{ fontSize: '.8rem', display: 'grid', gap: '.2rem' }}>
            Desde<input type="date" className="input" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label className="muted" style={{ fontSize: '.8rem', display: 'grid', gap: '.2rem' }}>
            Hasta<input type="date" className="input" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => aplicarRango('hoy')}>Hoy</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => aplicarRango('7d')}>Últimos 7 días</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => aplicarRango('mes')}>Este mes</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => aplicarRango('mes_ant')}>Mes pasado</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setDesde(''); setHasta(''); }} disabled={!desde && !hasta}>Todas</button>
          </div>
        </div>
        {rangoInvalido && <p className="hint" style={{ color: 'var(--danger, #dc2626)', margin: '.45rem 0 0' }}>La fecha «desde» es posterior a «hasta».</p>}
        <p className="hint muted" style={{ margin: '.5rem 0 0' }}>
          Sale con <strong>{filas.length} OC</strong>{filtroTexto ? <> ({filtroTexto})</> : ' (sin filtros)'}.
          {fechaBase === 'pago' && (desde || hasta) ? ' Por fecha de pago solo entran las OC ya pagadas.' : ''}
        </p>
      </div>
      <div className="card" style={{ margin: '0 0 .75rem' }}>
        <div className="card-title" style={{ marginBottom: '.45rem' }}>Columnas</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem .9rem' }}>
          {COLUMNAS_CONCILIACION.map((c) => (
            <label key={c.clave} style={{ display: 'flex', alignItems: 'center', gap: '.35rem', cursor: 'pointer', fontSize: '.86rem' }}>
              <input type="checkbox" checked={cols.includes(c.clave)} onChange={() => toggle(c.clave)} /> {c.label}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '.6rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.86rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={conTarjetas} onChange={(e) => setConTarjetas(e.target.checked)} /> Tarjetas de resumen en el PDF
          </label>
          <label className="muted" style={{ fontSize: '.84rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
            Hoja
            <select className="select" style={{ width: 'auto' }} value={orientacion} onChange={(e) => setOrientacion(e.target.value as typeof orientacion)}>
              <option value="auto">Automática</option><option value="portrait">Vertical</option><option value="landscape">Horizontal</option>
            </select>
          </label>
        </div>
      </div>
      <div className="card" style={{ margin: 0 }}>
        <div className="card-title" style={{ marginBottom: '.45rem' }}>💬 Mensaje de WhatsApp</div>
        <textarea className="input mono" readOnly value={texto} style={{ width: '100%', minHeight: 220, fontSize: '.78rem', whiteSpace: 'pre' }} />
        <div style={{ marginTop: '.5rem' }}><CompartirWhatsapp texto={texto} /></div>
      </div>
    </Modal>
  );
}
