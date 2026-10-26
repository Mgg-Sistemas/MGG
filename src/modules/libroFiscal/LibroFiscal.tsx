/* ============================================================
   Golden Touch · Libro fiscal · La pantalla

   El libro contesta una sola pregunta: ¿cuánto impuesto está adelantado y
   cuánto se debe? Y para eso hay que separar las dos direcciones, porque el
   mismo monto significa cosas opuestas:

   · NOS LA PRACTICARON → anticipo a favor. Se descuenta en la declaración.
   · LA PRACTICAMOS     → dinero ajeno que hay que enterar al fisco.
   · IGTF               → ni una ni otra: se paga y no se recupera. Es costo.

   Los totales van en BOLÍVARES, que es como se declara; el detalle por moneda
   queda debajo de cada número.

   Tres piezas:
   · LibroFiscalView          — el libro con sus cuatro números y sus filtros.
   · RegistrarRetencionModal  — carga una retención, en cualquiera de las dos
                                direcciones (calculando, o copiando el
                                comprobante que entregó el cliente).
   · ConfiguracionFiscalModal — los parámetros del agente y el catálogo.

   La cuenta no se hace aquí: viene de `retencionesCalculo.ts`.
   ============================================================ */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { diaVE, getTasaUsdDeFecha } from '@/modules/tesoreria/tasas.repository';
import { r1Disponible, r2Disponible } from './disponibilidad';
import { ParametrosImpuestos } from './ParametrosImpuestos';
import { ParametrosValores } from './ParametrosValores';
import { configDeFecha, r3Disponible } from './parametros.repository';
import { ParametrosMotivos } from './ParametrosMotivos';
import { ParametrosSupuestos } from './ParametrosSupuestos';
import {
  motivosVigentes, r6Disponible, supuestoAplicado, supuestosVigentes,
  type MotivoNoAplica, type Supuesto,
} from './motivosSupuestos.repository';
import { ParametrosEntes } from './ParametrosEntes';
import { ParametrosFirmaSello } from './ParametrosFirmaSello';
import { ParametrosPerfiles } from './ParametrosPerfiles';
import { ParametrosRegimen } from './ParametrosRegimen';
import { completarRif, formatearRif, rifValido } from '@/shared/lib/rif';
import { rutaFichaProveedor, textoRifInvalido } from './mensajeRif';
import { EMPRESA_RIF } from '@/shared/lib/empresa';
import { razonSocialAgente } from './comprobanteRetencionPdf';
import { SupuestosIvaAcordeon } from './SupuestosIvaAcordeon';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import {
  CONFIG_RETENCION_DEFECTO, DIRECCIONES, ESTADOS_RETENCION, SUJETOS, TIPOS_IMPUESTO,
  calcularIgtf, calcularRetencionIslr, calcularRetencionIva, calcularRetencionLocal, enBolivares, fechaTasaBcv,
  formatoComprobante, formatoSerie,
  labelDireccion, labelImpuesto, labelSujeto, limiteEntregaComprobante,
  motivoNoPuedePracticar, periodoDe, puedePracticar, quincenaDe, resumenLibro, significadoRetencion, totalesPorMoneda,
  type CalculoRetencion, type ConceptoRetencion, type ConfigRetencion, type DireccionRetencion,
  type EstadoRetencion, type MotivosIvaCien, type SujetoRetenido, type TipoImpuesto,
} from './retencionesCalculo';
import {
  activarConcepto, adjuntarComprobante, anularRetencion, getAlicuotasLocales, getConfigRetencion, guardarConcepto,
  guardarConfigRetencion, guardarTiposLicencia, listConceptos, listRetenciones, listTiposLicencia, registrarRetencion, sujetoAGt, tipoAGt,
  urlComprobante,
  PORCENTAJES_IVA,
  consultarCorrelativoEstimado,
  type AlicuotasLocales, type CorrelativoEstimado, type DocKind, type NuevaRetencion, type RetencionPracticada, type TipoLicencia,
} from './retencionesFiscal.repository';
import { etiquetaDocumentoRespaldo, faltaEnLaCarga, leerMonto, numeroATexto, validarDocumentoRespaldo } from './validarCarga';
import { montoEscrito, municipioDeLinea } from './lineasRegistro';
import { CampoMonto } from './CampoMonto';
import { formatoParaImprimir, r8Disponible } from './formatos.repository';
import { ParametrosFormatos } from './ParametrosFormatos';
import { faltaEnPctConcepto, faltaEnValoresSinR3, rifEmpresaParaGuardar } from './parametrosEmpresa';
import { aplicarFiltros, buscaEn, paginar, type FiltroLista } from './listas';
import { Paginador } from './ListaControles';
import './libroFiscal.css';
import './libroFiscalV8.css';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { list as listProveedores } from '@/modules/proveedores/proveedores.repository';
import type { Proveedor } from '@/shared/lib/types';
import { useDescartar } from './confirmarDescartar';
import { p03Disponible, v2rDisponible } from './disponibilidad';
import { RegistrarFacturaRetencion, type SemillaFactura } from './RegistrarFacturaRetencion';
import { FacturasPorRegistrar } from './FacturasPorRegistrar';
import { semillaDeFacturaOrigen } from './documentosOrigen.repository';
import { nombrePeriodo, periodoEstaCerrado, type PeriodoFiscal } from './periodosRetencion.repository';
import { CubrirOtrasOrdenes } from './CubrirOtrasOrdenes';
import { r7Disponible } from './reglas.repository';
import { calcularConReglaVigente, columnasDeRegla, type CalculoConRegla } from './reglaRegistro';
import { sugerirSujetoPorRif } from './residenciaSujeto';
import { esCeroSinMotivo, validarMotivoCero } from './motivoCero';
import { RANGOS_RAPIDOS, rangoActivo, rangoRapido } from '@/shared/lib/rangosFecha';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { rotuloImpuesto, rotuloSerie, rotuloSujeto } from './rotulos';
import { listNoAplica, r10Disponible, retenerDespues, type FacturaResumen, type NoAplicaRegistrado } from './facturasResumen.repository';
import { BuscadorFactura } from './BuscadorFactura';
import { FacturasRegistradas } from './FacturasRegistradas';
import { filasNoAplica, lineaRetenerDespues, precargaDeFactura } from './registroSuelto';
import { dateTime } from '@/shared/lib/format';

function monto(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'Bs' ? `Bs ${v}` : `$ ${v}`;
}
function fechaCorta(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
}
/** Para calcular mientras se escribe. Lo ilegible lo señala `montosIlegibles` antes de registrar. */
const nDec = (v: string) => leerMonto(v) ?? 0;
/** Hoy en Venezuela (no en UTC: después de las 20:00 ya sería mañana). */
const hoyIso = hoyVenezuela;
const primeroDelMes = () => `${hoyVenezuela().slice(0, 7)}-01`;
/** Practicada sin OC, CS ni compra directa: se registró a mano, sin documento del sistema. */
const fueraDelSistema = (r: Pick<RetencionPracticada, 'docKind' | 'direccion'>) => r.direccion === 'practicada' && r.docKind === 'manual';

/** Lo retenido en Bs: lo guardado, o el monto si ya está en Bs. Las notas de crédito restan. */
const enBs = (r: RetencionPracticada) => {
  const m = r.montoBs ?? (r.moneda === 'Bs' ? r.montoRetenido : 0);
  return r.tipoDocumento === 'nota_credito' ? -Math.abs(m) : m;
};

/* ═══════════════════════ Libro fiscal ═══════════════════════ */

/** Qué documento puede adjuntarse a una retención practicada. */
const TIPOS_RESPALDO = ['Factura del proveedor', 'Comprobante de retención firmado', 'Nota de entrega', 'Otro documento'];

function rutaDocumento(kind: DocKind, id: string | null): string | null {
  if (!id) return null;
  if (kind === 'oc') return `/app/pedidos?detalle=${encodeURIComponent(id)}`;
  if (kind === 'compra_directa') return `/app/pedidos?detalle=${encodeURIComponent(id)}`;
  if (kind === 'servicio_directo') return `/app/pedidos?detalle=${encodeURIComponent(id)}`;
  return null;
}

type VistaLibro = 'lista' | 'factura' | 'impuesto' | 'sin';

export function LibroFiscalView({ canWrite = true, actor, actorName, vistaInicial = 'factura' }: {
  canWrite?: boolean; actor: string; actorName: string | null; vistaInicial?: VistaLibro;
}) {
  const { can } = usePermissions();
  const canVerPedidos = can('pedidos', 'lectura');

  // Desde el 07/10/2026 la empresa retiene IVA: el libro abre en lo que
  // practicó (lo que hay que enterar), que es el trabajo del día a día.
  const [direccion, setDireccion] = useState<'' | DireccionRetencion>('practicada');
  const [tipo, setTipo] = useState<'' | TipoImpuesto>('');
  const [estado, setEstado] = useState<'' | EstadoRetencion | 'anulada'>('');
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(hoyIso());
  const [texto, setTexto] = useState('');

  const [filas, setFilas] = useState<RetencionPracticada[]>([]);
  const [config, setConfig] = useState<ConfigRetencion>(CONFIG_RETENCION_DEFECTO);
  const [loading, setLoading] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [anular, setAnular] = useState<RetencionPracticada | null>(null);
  const [motivo, setMotivo] = useState('');
  const [registrar, setRegistrar] = useState<SemillaRetencion | null>(null);
  // Con V2R o fallback nativo: una factura con varias líneas de impuesto en un solo registro.
  const [conFacturaVarias, setConFacturaVarias] = useState(true);
  useEffect(() => { v2rDisponible().then((v) => { if (v) setConFacturaVarias(true); }).catch(() => {}); }, []);
  const [facturaVarias, setFacturaVarias] = useState(false);
  // P03: una factura registrada puede cubrir varias órdenes del mismo proveedor.
  const [conP03, setConP03] = useState(true);
  useEffect(() => { p03Disponible().then((v) => { if (v) setConP03(true); }).catch(() => {}); }, []);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  // R10: «Facturas registradas», retener después sobre una de ellas y los «no aplica» en «Sin retención».
  const [conR10, setConR10] = useState(true);
  useEffect(() => { r10Disponible().then((v) => { if (v) setConR10(true); }).catch(() => {}); }, []);
  const [verFacturas, setVerFacturas] = useState(false);
  const [verFacturasCompras, setVerFacturasCompras] = useState(false);
  const [semillaCompra, setSemillaCompra] = useState<SemillaFactura | undefined>(undefined);
  const [retenerSobre, setRetenerSobre] = useState<FacturaResumen | null>(null);
  const [modalArc, setModalArc] = useState<{ anio: number; proveedorRif: string } | null>(null);

  const proveedoresConIslr = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const r of filas) {
      if (r.tipo === 'islr' && r.direccion === 'practicada' && !r.anulada && r.contraparteRif) {
        mapa.set(r.contraparteRif, r.contraparteNombre || r.contraparteRif);
      }
    }
    return [...mapa.entries()].map(([rif, nombre]) => ({ rif, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [filas]);

  const [dispDigital, setDispDigital] = useState<{ tieneLogo: boolean; tieneFirma: boolean; tieneSello: boolean; tieneAlguno: boolean }>({
    tieneLogo: true, tieneFirma: false, tieneSello: true, tieneAlguno: true,
  });
  const [imprimirLogo, setImprimirLogo] = useState<boolean>(() => {
    try { return localStorage.getItem('retenciones:imprimirConLogo') !== 'false'; } catch { return true; }
  });
  const [imprimirFirma, setImprimirFirma] = useState<boolean>(() => {
    try { return localStorage.getItem('retenciones:imprimirConFirma') !== 'false'; } catch { return true; }
  });
  const [imprimirSello, setImprimirSello] = useState<boolean>(() => {
    try { return localStorage.getItem('retenciones:imprimirConSello') !== 'false'; } catch { return true; }
  });
  const [imprimirOriginalYCopia, setImprimirOriginalYCopia] = useState<boolean>(() => {
    try { return localStorage.getItem('retenciones:imprimirOriginalYCopia') !== 'false'; } catch { return true; }
  });

  useEffect(() => {
    let vivo = true;
    import('./comprobanteRetencionPdf').then(({ consultarElementosDigitales }) => {
      consultarElementosDigitales().then((res) => {
        if (vivo) setDispDigital(res);
      }).catch(() => {
        if (vivo) setDispDigital({ tieneLogo: false, tieneFirma: false, tieneSello: false, tieneAlguno: false });
      });
    });
    return () => { vivo = false; };
  }, []);

  const reload = useCallback(async () => {
    const [rs, cfg] = await Promise.all([
      listRetenciones({ desde: desde || undefined, hasta: hasta || undefined, incluirAnuladas: true }),
      getConfigRetencion().catch(() => CONFIG_RETENCION_DEFECTO),
    ]);
    setFilas(rs); setConfig(cfg); setErrorCarga(null);
    if (cfg.imprimirOriginalYCopia !== undefined) {
      setImprimirOriginalYCopia(cfg.imprimirOriginalYCopia !== false);
    }
  }, [desde, hasta]);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    // Una lectura fallida no es «no hay nada»: se dice.
    reload()
      .catch((e) => { if (!cancel) setErrorCarga(e instanceof Error ? e.message : 'No se pudo leer el libro.'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reload]);

  // La búsqueda, los filtros y el orden se aplican en pantalla: así cada opción
  // dice cuántas retenciones quedan con los demás filtros puestos.
  const [vista, setVista] = useState<VistaLibro>(vistaInicial);
  const [filtroOrigen, setFiltroOrigen] = useState<'' | 'con_orden' | 'fuera_sistema'>('');
  const [orden] = useState<'reciente' | 'antiguo' | 'contraparte'>('reciente');
  const [pag, setPag] = useState(1);
  const [tam, setTam] = useState(25);
  useEffect(() => { setPag(1); }, [texto, direccion, tipo, estado, filtroOrigen, orden, desde, hasta, vista]);

  const filtros = useMemo<FiltroLista<RetencionPracticada>[]>(() => [
    { campo: 'direccion', etiqueta: 'Quién retuvo', valor: direccion, opciones: DIRECCIONES.map((d): [string, string] => [d.key, d.label]), pasa: (r, v) => r.direccion === v },
    { campo: 'tipo', etiqueta: 'Impuesto', valor: tipo, opciones: TIPOS_IMPUESTO.map((t): [string, string] => [t.key, t.corto]), pasa: (r, v) => r.tipo === v },
    {
      campo: 'estado', etiqueta: 'Estado', valor: estado,
      opciones: [...ESTADOS_RETENCION.map((e): [string, string] => [e.key, e.label]), ['anulada', 'Anuladas']],
      pasa: (r, v) => (v === 'anulada' ? r.anulada : !r.anulada && r.estado === v),
    },
    ...(filtroOrigen ? [{
      campo: 'origen', etiqueta: 'Origen', valor: filtroOrigen,
      opciones: [['con_orden', 'Con OC / CS'], ['fuera_sistema', 'Fuera del sistema']] as [string, string][],
      pasa: (r: RetencionPracticada, v: string) => (v === 'fuera_sistema' ? fueraDelSistema(r) : !fueraDelSistema(r)),
    }] : []),
  ], [direccion, tipo, estado, filtroOrigen]);

  const base = useMemo(() => filas.filter((r) => buscaEn(texto, r.contraparteNombre, r.contraparteRif, r.numeroComprobante,
    r.facturaNumero, r.docCodigo, r.conceptoNombre)), [filas, texto]);

  const visibles = useMemo(() => {
    const fecha = (r: RetencionPracticada) => r.facturaFecha ?? r.createdAt.slice(0, 10);
    const xs = aplicarFiltros(base, filtros);
    const reciente = (a: RetencionPracticada, b: RetencionPracticada) => fecha(b).localeCompare(fecha(a)) || b.createdAt.localeCompare(a.createdAt);
    xs.sort(orden === 'antiguo' ? (a, b) => -reciente(a, b)
      : orden === 'contraparte' ? (a, b) => (a.contraparteNombre ?? '').localeCompare(b.contraparteNombre ?? '') || reciente(a, b)
        : reciente);
    return xs;
  }, [base, filtros, orden]);
  const pagina = useMemo(() => paginar(visibles, pag, tam), [visibles, pag, tam]);

  const resumen = useMemo(() => resumenLibro(visibles.map((r) => ({
    tipo: r.tipo, direccion: r.direccion, estado: r.estado, monto: r.montoRetenido, anulada: r.anulada, tipoDocumento: r.tipoDocumento,
  }))), [visibles]);

  const totales = useMemo(() => totalesPorMoneda(visibles.map((r) => ({
    tipo: r.tipo, direccion: r.direccion, estado: r.estado, monto: r.montoRetenido, anulada: r.anulada, moneda: r.moneda, tipoDocumento: r.tipoDocumento,
  }))), [visibles]);

  const quitarFiltros = () => { setDireccion(''); setTipo(''); setEstado(''); setFiltroOrigen(''); setTexto(''); };

  // «Sin retención»: lo registrado en 0 con su motivo, agrupado por factura.
  const sinRetencion = useMemo(() => {
    const m = new Map<string, { key: string; nombre: string | null; rif: string | null; num: string; fecha: string | null; filas: RetencionPracticada[] }>();
    for (const r of visibles) {
      if (r.anulada || r.montoRetenido !== 0) continue;
      const key = `${r.contraparteRif ?? r.contraparteNombre ?? ''}|${r.facturaNumero ?? r.id}`;
      const g = m.get(key) ?? { key, nombre: r.contraparteNombre, rif: r.contraparteRif, num: r.facturaNumero ?? r.docCodigo ?? '—', fecha: r.facturaFecha, filas: [] };
      g.filas.push(r);
      m.set(key, g);
    }
    return [...m.values()];
  }, [visibles]);

  // R10: las decisiones «no aplica» del mismo rango. Si la lectura falla, se avisa sin romper la vista.
  const [noAplica, setNoAplica] = useState<NoAplicaRegistrado[]>([]);
  const [errorNoAplica, setErrorNoAplica] = useState<string | null>(null);
  useEffect(() => {
    if (!conR10 || vista !== 'sin') return;
    let vigente = true;
    listNoAplica({ desde: desde || undefined, hasta: hasta || undefined })
      .then((xs) => { if (vigente) { setNoAplica(xs); setErrorNoAplica(null); } })
      .catch((e) => { if (vigente) { setNoAplica([]); setErrorNoAplica(e instanceof Error ? e.message : 'No se pudieron leer las decisiones de «no aplica».'); } });
    return () => { vigente = false; };
  }, [conR10, vista, desde, hasta]);
  const noAplicaVisibles = useMemo(
    () => (conR10 ? filasNoAplica(noAplica, { texto, tipo, direccion, estado }) : []),
    [conR10, noAplica, texto, tipo, direccion, estado],
  );

  // ── Agrupado por proveedor → factura → casillas (v8) ──
  type FacturaAgrupada = {
    key: string; num: string; doc: string | null; docKind: DocKind; docId: string | null;
    documentoId: string | null; proveedorId: string | null;
    fecha: string | null; moneda: string; total: number;
    tipoDocumento?: string | null;
    facturaAfectadaNro?: string | null;
    retenciones: Map<TipoImpuesto, RetencionPracticada>;
  };
  type ProveedorAgrupado = {
    rif: string | null; nombre: string | null; facturas: FacturaAgrupada[];
    pendientes: number; registradas: number;
  };

  const impuestosTarjeta = useMemo(() => {
    const activos = TIPOS_IMPUESTO.filter((t) => t.key !== 'igtf');
    return activos;
  }, []);

  const conteosPorImpuesto = useMemo(() => {
    const m: Record<string, { pendientes: number; registradas: number; declaradas: number; anuladas: number }> = {};
    for (const t of impuestosTarjeta) m[t.key] = { pendientes: 0, registradas: 0, declaradas: 0, anuladas: 0 };
    for (const r of visibles) {
      if (r.tipo === 'igtf') continue;
      const c = m[r.tipo];
      if (!c) continue;
      if (r.anulada) c.anuladas++;
      else if (r.estado === 'declarada') c.declaradas++;
      else if (r.estado === 'registrada') c.registradas++;
      else c.pendientes++;
    }
    return m;
  }, [visibles, impuestosTarjeta]);

  const proveedores = useMemo<ProveedorAgrupado[]>(() => {
    const provMap = new Map<string, Map<string, FacturaAgrupada>>();
    const provInfo = new Map<string, { nombre: string | null; rif: string | null }>();
    for (const r of visibles) {
      const pk = r.contraparteRif ?? r.contraparteNombre ?? 'sin-proveedor';
      if (!provMap.has(pk)) { provMap.set(pk, new Map()); provInfo.set(pk, { nombre: r.contraparteNombre, rif: r.contraparteRif }); }
      const fMap = provMap.get(pk)!;
      const fk = r.facturaNumero ?? r.docCodigo ?? r.id;
      if (!fMap.has(fk)) fMap.set(fk, {
        key: fk, num: r.facturaNumero ?? '—',
        doc: r.docCodigo, docKind: r.docKind, docId: r.docId,
        documentoId: null, proveedorId: r.contraparteId,
        fecha: r.facturaFecha ?? r.createdAt.slice(0, 10),
        moneda: r.moneda, total: r.baseImponible,
        tipoDocumento: r.tipoDocumento,
        facturaAfectadaNro: r.facturaAfectadaNro,
        retenciones: new Map(),
      });
      const fa = fMap.get(fk)!;
      const actual = fa.retenciones.get(r.tipo);
      // Priorizar la vigente: si ya hay una no-anulada, no dejar que una anulada la tape.
      if (!actual || (actual.anulada && !r.anulada)) {
        fa.retenciones.set(r.tipo, r);
      }
      if (!fa.documentoId && r.documentoId) fa.documentoId = r.documentoId;
      if (!fa.tipoDocumento && r.tipoDocumento) fa.tipoDocumento = r.tipoDocumento;
      if (!fa.facturaAfectadaNro && r.facturaAfectadaNro) fa.facturaAfectadaNro = r.facturaAfectadaNro;
    }
    const result: ProveedorAgrupado[] = [];
    for (const [pk, fMap] of provMap) {
      const info = provInfo.get(pk)!;
      const facturas = [...fMap.values()];
      let pendientes = 0, registradas = 0;
      for (const f of facturas) for (const r of f.retenciones.values()) {
        if (r.anulada) continue;
        if (r.estado === 'registrada' || r.estado === 'declarada') registradas++;
        else pendientes++;
      }
      result.push({ ...info, facturas, pendientes, registradas });
    }
    return result;
  }, [visibles]);

  async function verComprobante(r: RetencionPracticada) {
    try {
      const { verComprobanteRetencionPdf } = await import('./comprobanteRetencionPdf');
      const formato = await formatoParaImprimir(tipoAGt(r.tipo), diaVE(r.createdAt) || null, hoyIso());
      await verComprobanteRetencionPdf(r, config, formato, {
        incluirLogo: imprimirLogo,
        incluirFirma: imprimirFirma,
        incluirSello: imprimirSello,
        imprimirOriginalYCopia,
      });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el comprobante', 'error'); }
  }

  async function verComprobantesFactura(f: { num: string; retenciones: Map<any, RetencionPracticada> }) {
    const retenciones = [...f.retenciones.values()].filter((r) => !r.anulada && r.numeroComprobante);
    if (!retenciones.length) {
      toast('No hay comprobantes emitidos para esta factura', 'error');
      return;
    }
    try {
      const { verTodosComprobantesFacturaPdf } = await import('./comprobanteRetencionPdf');
      await verTodosComprobantesFacturaPdf(f.num, retenciones, config, {
        incluirLogo: imprimirLogo,
        incluirFirma: imprimirFirma,
        incluirSello: imprimirSello,
        imprimirOriginalYCopia,
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron generar los comprobantes', 'error');
    }
  }

  async function verAdjuntoRespaldo(r: RetencionPracticada) {
    if (!r.comprobantePath) return;
    try {
      const url = await urlComprobante(r.comprobantePath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir el documento de respaldo adjunto', 'error'); }
  }

  async function verLibroPdf() {
    try {
      const { verLibroFiscalPdf } = await import('./libroFiscalPdf');
      await verLibroFiscalPdf(visibles, config, { desde, hasta, direccion: direccion || null, resumen, totales });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el libro', 'error'); }
  }

  // La relación para el SENIAT es por impuesto y de lo que la empresa practicó.
  const relacionables = visibles.filter((r) => r.direccion === 'practicada' && !r.anulada);
  async function verRelacion() {
    if (!tipo) { toast('Seleccionar un impuesto para generar la relación.', 'error'); return; }
    if (!relacionables.length) { toast('No hay retenciones practicadas en el rango para la relación.', 'error'); return; }
    try {
      const { verRelacionPdf } = await import('./relacionesPdf');
      await verRelacionPdf(relacionables, config, { desde, hasta, tipo });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar la relación', 'error'); }
  }

  async function exportarSeniatIva() {
    if (!relacionables.length) { toast('No hay retenciones de IVA practicadas.', 'error'); return; }
    try {
      const { armarTxtIva } = await import('@/modules/retenciones/txtSeniatIva');
      const periodoRef = (relacionables[0]?.periodo || hasta || hoyVenezuela()).replace(/\D/g, '').slice(0, 6);
      const res = armarTxtIva({
        rifAgente: config.rif || EMPRESA_RIF,
        razonSocial: razonSocialAgente(config),
        periodo: periodoRef,
        campo2: 'operaciones',
        filas: relacionables,
      });
      if (res.faltan.length) {
        toast(`Faltan datos fiscales: ${res.faltan[0]}`, 'error');
        return;
      }
      const blob = new Blob([res.contenido], { type: 'text/plain;charset=us-ascii' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = res.nombre;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Archivo TXT generado: ${res.nombre}`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al exportar TXT', 'error');
    }
  }

  async function exportarSeniatIslr() {
    if (!relacionables.length) { toast('No hay retenciones de ISLR practicadas.', 'error'); return; }
    try {
      const { armarXmlIslr } = await import('@/modules/retenciones/xmlSeniatIslr');
      const periodoRef = (relacionables[0]?.periodo || hasta || hoyVenezuela()).replace(/\D/g, '').slice(0, 6);
      const res = armarXmlIslr({
        rifAgente: config.rif || EMPRESA_RIF,
        razonSocial: razonSocialAgente(config),
        periodo: periodoRef,
        filas: relacionables,
      });
      if (res.faltan.length) {
        toast(`Faltan datos fiscales: ${res.faltan[0]}`, 'error');
        return;
      }
      const blob = new Blob([res.contenido], { type: 'application/xml;charset=iso-8859-1' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = res.nombre;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Archivo XML generado: ${res.nombre}`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al exportar XML', 'error');
    }
  }

  const estadoCasilla = (r: RetencionPracticada) => r.anulada ? 'anulada' : r.estado === 'declarada' ? 'declarada' : r.estado === 'registrada' ? 'ok' : 'falta';
  const signoEstado: Record<string, string> = { ok: '✓', declarada: '◉', falta: '⏳', anulada: '⊘', nc: '—', pd: '?' };
  const textoEstado: Record<string, string> = { ok: 'Registrada', declarada: 'Declarada', falta: 'Pendiente', anulada: 'Anulada', nc: 'No aplica', pd: 'Por definir' };

  return (
    <div>
      {/* ── Búsqueda v8 ── */}
      <section className="lfv8-buscar" role="search">
        <label htmlFor="lfv8-q">Búsqueda: factura, proveedor, RIF, OC o comprobante</label>
        <span className="lfv8-lupa" aria-hidden="true">⌕</span>
        <input id="lfv8-q" type="text" value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder="Ej.: 000123, Alfa, J-00000002, OC-0045, 202609…" autoComplete="off" />
      </section>

      {/* ── Tarjetas de impuesto (totales v8) ── */}
      <section className="lfv8-totales" style={{ '--n': impuestosTarjeta.length } as React.CSSProperties}
        aria-label="Totales por impuesto">
        {impuestosTarjeta.map((t) => {
          const c = conteosPorImpuesto[t.key] ?? { pendientes: 0, registradas: 0, declaradas: 0, anuladas: 0 };
          const montoImp = visibles.filter((r) => r.tipo === t.key && !r.anulada).reduce((a, r) => a + enBs(r), 0);
          return (
            <div key={t.key} className="lfv8-total-imp">
              <h2>{t.corto} <span>Retenido: {monto(montoImp, 'Bs')}</span></h2>
              <div className="lfv8-botones">
                <button type="button" className={`lfv8-cuenta falta${tipo === t.key && estado === 'registrada' ? '' : ''}`}
                  aria-pressed={tipo === t.key && estado === ''} disabled={!c.pendientes}
                  onClick={() => { setTipo(tipo === t.key && estado === '' ? '' : t.key as TipoImpuesto); setEstado(''); }}>
                  <strong>{c.pendientes}</strong> {c.pendientes === 1 ? 'pendiente' : 'pendientes'}
                </button>
                <button type="button" className="lfv8-cuenta"
                  aria-pressed={tipo === t.key && estado === 'registrada'} disabled={!c.registradas}
                  onClick={() => { setTipo(t.key as TipoImpuesto); setEstado(estado === 'registrada' && tipo === t.key ? '' : 'registrada'); }}>
                  <strong>{c.registradas}</strong> {c.registradas === 1 ? 'registrada' : 'registradas'}
                </button>
                <button type="button" className="lfv8-cuenta"
                  aria-pressed={tipo === t.key && estado === 'declarada'} disabled={!c.declaradas}
                  onClick={() => { setTipo(t.key as TipoImpuesto); setEstado(estado === 'declarada' && tipo === t.key ? '' : 'declarada'); }}>
                  <strong>{c.declaradas}</strong> {c.declaradas === 1 ? 'declarada' : 'declaradas'}
                </button>
              </div>
            </div>
          );
        })}
      </section>
      <p className="lfv8-nota">El IGTF no se incluye en las tarjetas: es una percepción por pago en divisas, no una retención por factura.</p>

      {/* ── Filtros v8 (chips) ── */}
      <div className="lfv8-filtros">
        <div className="lfv8-filtros-cuerpo">
          <div className="lfv8-campo">
            <span>Fecha</span>
            <div className="lfv8-chips" role="group" aria-label="Fecha">
              {RANGOS_RAPIDOS.map((r) => (
                <button key={r.valor} type="button" className="lfv8-chip"
                  aria-pressed={rangoActivo(desde, hasta) === r.valor}
                  onClick={() => { const x = rangoRapido(r.valor); setDesde(x.desde); setHasta(x.hasta); }}>
                  {r.label}
                </button>
              ))}
            </div>
            <div className="lfv8-rango">
              <input className="lfv8-fecha" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Desde" />
              <span className="muted">a</span>
              <input className="lfv8-fecha" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label="Hasta" />
            </div>
          </div>

          <div className="lfv8-campo">
            <span>Impuesto</span>
            <div className="lfv8-chips" role="group" aria-label="Impuesto">
              <button type="button" className="lfv8-chip" aria-pressed={tipo === ''} onClick={() => setTipo('')}>Todos</button>
              {TIPOS_IMPUESTO.map((t) => (
                <button key={t.key} type="button" className="lfv8-chip"
                  aria-pressed={tipo === t.key} onClick={() => setTipo(tipo === t.key ? '' : t.key as TipoImpuesto)}>
                  {t.corto}
                </button>
              ))}
            </div>
          </div>

          <div className="lfv8-campo">
            <span>Dirección</span>
            <div className="lfv8-chips" role="group" aria-label="Dirección">
              {[['', 'Todas'], ...DIRECCIONES.map((d): [string, string] => [d.key, d.label])].map(([v, t]) => (
                <button key={v} type="button" className="lfv8-chip"
                  aria-pressed={direccion === v} onClick={() => setDireccion(v as '' | DireccionRetencion)}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="lfv8-campo">
            <span>Estado</span>
            <select className="lfv8-select" value={estado}
              onChange={(e) => setEstado(e.target.value as '' | EstadoRetencion | 'anulada')}>
              <option value="">Todos</option>
              {ESTADOS_RETENCION.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
              <option value="anulada">Anuladas</option>
            </select>
          </div>

          <div className="lfv8-campo">
            <span>Origen</span>
            <select className="lfv8-select" value={filtroOrigen}
              onChange={(e) => setFiltroOrigen(e.target.value as '' | 'con_orden' | 'fuera_sistema')}>
              <option value="">Todos</option>
              <option value="con_orden">Con OC o CS</option>
              <option value="fuera_sistema">Fuera del sistema</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Barra vista + acciones ── */}
      <div className="lfv8-barra-vista">
        <div className="lfv8-view-switch" role="group" aria-label="Agrupar por">
          <button type="button" aria-pressed={vista === 'lista'} onClick={() => setVista('lista')}>Una fila por retención</button>
          <button type="button" aria-pressed={vista === 'factura'} onClick={() => setVista('factura')}>Por factura</button>
          <button type="button" aria-pressed={vista === 'impuesto'} onClick={() => setVista('impuesto')}>Por impuesto</button>
          <button type="button" aria-pressed={vista === 'sin'} onClick={() => setVista('sin')}>Sin retención</button>
        </div>
        <div className="lfv8-activos" aria-live="polite">
          {tipo && (
            <span className="lfv8-activo">
              Impuesto: {TIPOS_IMPUESTO.find((t) => t.key === tipo)?.corto ?? rotuloImpuesto(tipo)}
              <button type="button" onClick={() => setTipo('')} aria-label="Quitar filtro de impuesto">✕</button>
            </span>
          )}
          {direccion && (
            <span className="lfv8-activo">
              {DIRECCIONES.find((d) => d.key === direccion)?.label ?? direccion}
              <button type="button" onClick={() => setDireccion('')} aria-label="Quitar filtro de dirección">✕</button>
            </span>
          )}
          {estado && (
            <span className="lfv8-activo">
              {estado === 'anulada' ? 'Anuladas' : ESTADOS_RETENCION.find((e) => e.key === estado)?.label ?? estado}
              <button type="button" onClick={() => setEstado('')} aria-label="Quitar filtro de estado">✕</button>
            </span>
          )}
          {filtroOrigen && (
            <span className="lfv8-activo">
              Origen: {filtroOrigen === 'fuera_sistema' ? 'Fuera del sistema' : 'Con OC o CS'}
              <button type="button" onClick={() => setFiltroOrigen('')} aria-label="Quitar filtro de origen">✕</button>
            </span>
          )}
        </div>
      </div>
      <div className="lfv8-acciones-libro">
        {dispDigital.tieneAlguno && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.45rem', padding: '.2rem .5rem', background: 'var(--surface-sunken)', borderRadius: '6px', border: '1px solid var(--border)' }}>
            <span className="muted" style={{ fontSize: '.76rem', fontWeight: 600 }}>Imprimir:</span>
            {dispDigital.tieneLogo && (
              <label className="lfv8-check-firma" title="Incluir logo de la empresa">
                <input
                  type="checkbox"
                  checked={imprimirLogo}
                  onChange={(e) => {
                    setImprimirLogo(e.target.checked);
                    try { localStorage.setItem('retenciones:imprimirConLogo', String(e.target.checked)); } catch {}
                  }}
                />
                <span>Logo</span>
              </label>
            )}
            {dispDigital.tieneFirma && (
              <label className="lfv8-check-firma" title="Incluir firma digital cargada en Parámetros">
                <input
                  type="checkbox"
                  checked={imprimirFirma}
                  onChange={(e) => {
                    setImprimirFirma(e.target.checked);
                    try { localStorage.setItem('retenciones:imprimirConFirma', String(e.target.checked)); } catch {}
                  }}
                />
                <span>Firma</span>
              </label>
            )}
            {dispDigital.tieneSello && (
              <label className="lfv8-check-firma" title="Incluir sello digital cargado en Parámetros">
                <input
                  type="checkbox"
                  checked={imprimirSello}
                  onChange={(e) => {
                    setImprimirSello(e.target.checked);
                    try { localStorage.setItem('retenciones:imprimirConSello', String(e.target.checked)); } catch {}
                  }}
                />
                <span>Sello</span>
              </label>
            )}
          </div>
        )}
        <button className="btn btn-ghost" onClick={() => void verLibroPdf()} disabled={!visibles.length}>↓ PDF del libro</button>
        <button className="btn btn-ghost" onClick={() => void verRelacion()} disabled={!tipo || !relacionables.length}
          title={!tipo ? 'Seleccionar un impuesto para generar la relación' : 'Relación por proveedor para el SENIAT'}>↓ Relación</button>
        {tipo === 'iva' && (
          <button className="btn btn-ghost" onClick={() => void exportarSeniatIva()} disabled={!relacionables.length}
            title="Exportar archivo TXT para declaración informativa de retenciones de IVA ante el SENIAT">↓ TXT SENIAT</button>
        )}
        {tipo === 'islr' && (
          <button className="btn btn-ghost" onClick={() => void exportarSeniatIslr()} disabled={!relacionables.length}
            title="Exportar archivo XML para declaración informativa de retenciones de ISLR ante el SENIAT">↓ XML SENIAT</button>
        )}
        {tipo === 'islr' && (
          <button className="btn btn-ghost" onClick={() => setModalArc({ anio: new Date().getFullYear(), proveedorRif: '' })} disabled={!filas.length}
            title="Generar Comprobante Anual de Retenciones de ISLR (Forma ARC - Art. 24 Decreto 1.808)">↓ Comprobante ARC</button>
        )}
        {conP03 && canWrite && (
          <button className="btn btn-ghost" onClick={() => setVerFacturasCompras(true)}
            title="Facturas y archivos de compras pendientes de registrar en Retenciones">
            🧾 Facturas de Compras pendientes
          </button>
        )}
        {conR10 && <button className="btn btn-ghost" onClick={() => setVerFacturas(true)}>Facturas registradas</button>}
        {canWrite && conFacturaVarias && (
          <button className="btn btn-primary" onClick={() => setFacturaVarias(true)}
            title="Registrar una factura y practicar simultáneamente todas sus retenciones (IVA, ISLR, etc.)">
            + Registrar factura con retenciones
          </button>
        )}
        {canWrite && (
          <button className="btn btn-ghost" onClick={() => setRegistrar({})}
            title="Cargar una retención suelta individual o practicada por un cliente">
            + Retención individual
          </button>
        )}
      </div>

      {/* ── Vista ── */}
      {loading && <EmptyState icon="◔" message="Cargando el libro…" />}
      {!loading && errorCarga && <EmptyState icon="⚠" message={`No se pudo leer el libro: ${errorCarga}`} />}
      {!loading && !errorCarga && !visibles.length && vista !== 'sin' && (
        <div className="lfv8-vacio">
          <p>{filas.length ? 'Ninguna retención coincide con la búsqueda o los filtros.' : 'Sin retenciones en ese rango de fechas.'}</p>
          <button className="btn" onClick={quitarFiltros}>Quitar filtros</button>
        </div>
      )}

      {/* ── Vista por factura (agrupada por proveedor) ── */}
      {!loading && !errorCarga && visibles.length > 0 && vista === 'factura' && (
        <>
          <p className="lfv8-contador">{visibles.length} retención(es) en {proveedores.length} proveedor(es).</p>
          {proveedores.map((prov) => {
            const pk = prov.rif ?? prov.nombre ?? 'sin';
            const MAX_VISIBLE = 5;
            const abierto = expandidos.has(pk) || prov.facturas.length <= MAX_VISIBLE;
            const facturasVis = abierto ? prov.facturas : prov.facturas.slice(0, MAX_VISIBLE);
            return (
              <section key={pk} className="lfv8-proveedor">
                <header>
                  <h3>{prov.nombre ?? 'Sin proveedor'}<span className="lfv8-rif">{prov.rif ?? ''}</span></h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {prov.rif && prov.facturas.some((f) => f.retenciones.has('islr')) && (
                      <button className="btn btn-ghost" style={{ fontSize: '0.72rem', padding: '2px 8px', height: 'auto', lineHeight: '1.2' }}
                        onClick={() => setModalArc({ anio: Number(desde.slice(0, 4)) || new Date().getFullYear(), proveedorRif: prov.rif! })}
                        title="Generar Comprobante ARC Anual de ISLR para este proveedor (Art. 24 Decreto 1.808)">
                        ARC ISLR
                      </button>
                    )}
                    <span className="lfv8-resumen">
                      {prov.facturas.length} factura(s)
                      {prov.pendientes > 0 && <> · <b>{prov.pendientes} pendiente(s)</b></>}
                      {!prov.pendientes && ' · sin pendientes'}
                      {(() => {
                        const totProv = prov.facturas.reduce((acc, f) => acc + [...f.retenciones.values()].reduce((a, r) => a + (!r.anulada ? enBs(r) : 0), 0), 0);
                        return totProv !== 0 ? <> · <strong style={{ color: 'var(--text)' }}>Total retenido: {monto(totProv, 'Bs')}</strong></> : null;
                      })()}
                    </span>
                  </div>
                </header>
                {facturasVis.map((f) => {
                  const nCasillas = impuestosTarjeta.length;
                  const totalRet = [...f.retenciones.values()].reduce((a, r) => a + (!r.anulada ? enBs(r) : 0), 0);
                  return (
                    <Fragment key={f.key}>
                    <article className="lfv8-factura" aria-label={`Factura ${f.num}`}>
                      <div>
                        <div className="lfv8-num">
                          {f.tipoDocumento === 'nota_credito'
                            ? `Nota de crédito ${f.num}`
                            : f.tipoDocumento === 'nota_debito'
                              ? `Nota de débito ${f.num}`
                              : `Factura ${f.num}`}
                          {f.facturaAfectadaNro && (
                            <span className="lfv8-afectada" style={{ fontSize: '0.78rem', marginLeft: '6px', fontWeight: 'normal', color: 'var(--muted, #666)' }}>
                              (Afecta Fact. {f.facturaAfectadaNro})
                            </span>
                          )}
                        </div>
                        <div className="lfv8-meta">
                          {f.fecha ? fechaCorta(f.fecha) : '—'}
                          {f.doc && <> · {(() => {
                            const ruta = canVerPedidos ? rutaDocumento(f.docKind, f.docId) : null;
                            return ruta
                              ? <a href={`#${ruta}`} className="lfv8-doc">{f.doc}</a>
                              : <span className="lfv8-doc">{f.doc}</span>;
                          })()}</>}
                          {' · '}{monto(f.total, f.moneda)}
                        </div>
                      </div>
                      <div className="lfv8-tira" style={{ '--n': nCasillas } as React.CSSProperties}
                        role="group" aria-label={`Retenciones de la factura ${f.num}`}>
                        {impuestosTarjeta.map((t) => {
                          const r = f.retenciones.get(t.key as TipoImpuesto);
                          const aplica = puedePracticar(t.key as TipoImpuesto, config);
                          if (!r) {
                            if (!aplica) {
                              return (
                                <div key={t.key} className="lfv8-casilla nc" style={{ opacity: 0.45 }} title={`La empresa no practica retenciones de ${t.corto} según su configuración fiscal`}>
                                  <span className="lfv8-imp">{t.corto}</span>
                                  <span className="lfv8-est muted">— No aplica</span>
                                </div>
                              );
                            }
                            return (
                              <div key={t.key} className="lfv8-casilla falta">
                                <span className="lfv8-imp">{t.corto}</span>
                                <span className="lfv8-est" style={{ color: 'var(--warning)' }}>— Falta cargar</span>
                                {canWrite && (
                                  <span className="lfv8-acciones" style={{ marginTop: '4px' }}>
                                    <button type="button" className="lfv8-mini registrar"
                                      onClick={() => {
                                        const rExistente = [...f.retenciones.values()][0];
                                        setRegistrar({
                                          direccion: 'practicada',
                                          tipoInicial: t.key as TipoImpuesto,
                                          contraparteId: f.proveedorId ?? rExistente?.contraparteId,
                                          contraparteNombre: prov.nombre ?? rExistente?.contraparteNombre,
                                          contraparteRif: prov.rif ?? rExistente?.contraparteRif,
                                          total: f.total,
                                          baseImponible: rExistente?.baseImponible ?? f.total,
                                          moneda: f.moneda,
                                          docId: f.docId,
                                          docKind: f.docKind,
                                          codigo: f.doc,
                                          facturaNumero: f.num !== '—' ? f.num : null,
                                          facturaControl: rExistente?.facturaControl ?? null,
                                          facturaFecha: f.fecha ?? null,
                                        });
                                      }}
                                      title={`Cargar retención de ${t.corto} para la Factura ${f.num}`}>
                                      + Retener
                                    </button>
                                  </span>
                                )}
                              </div>
                            );
                          }
                          const est = estadoCasilla(r);
                          return (
                            <div key={t.key} className={`lfv8-casilla ${est}`}>
                              <span className="lfv8-imp">{t.corto}</span>
                              <span className="lfv8-est">{signoEstado[est]} {textoEstado[est]}</span>
                              {(est === 'ok' || est === 'declarada') && <span className="lfv8-monto">{monto(r.montoRetenido, r.moneda)}</span>}
                              {est === 'anulada' && <span className="lfv8-monto">{monto(r.montoRetenido, r.moneda)}</span>}
                              <span className="lfv8-por"><b>{r.porcentaje}%</b></span>
                              {r.numeroComprobante && <span className="lfv8-comp" title="Comprobante">N° {r.numeroComprobante}</span>}
                              <span className="lfv8-acciones">
                                {canWrite && !r.anulada && est === 'falta' && (
                                  <button type="button" className="lfv8-mini registrar"
                                    onClick={() => setRegistrar({ direccion: r.direccion, contraparteId: r.contraparteId, contraparteNombre: r.contraparteNombre, contraparteRif: r.contraparteRif })}>
                                    Registrar
                                  </button>
                                )}
                                <button type="button" className="lfv8-mini" onClick={() => void verComprobante(r)} title="Comprobante generado">📄</button>
                                {r.comprobantePath && (
                                  <button type="button" className="lfv8-mini" onClick={() => void verAdjuntoRespaldo(r)} title={`Ver documento de respaldo adjunto (${r.comprobanteNombre || 'Archivo'})`}>📎</button>
                                )}
                                {canWrite && !r.anulada && (
                                  <button type="button" className="lfv8-mini" onClick={() => { setAnular(r); setMotivo(''); }} title="Anular">⊘</button>
                                )}
                                {canWrite && r.anulada && (
                                  <button
                                    type="button"
                                    className="lfv8-mini registrar"
                                    onClick={() => {
                                      setRegistrar({
                                        direccion: r.direccion,
                                        tipoInicial: r.tipo,
                                        contraparteId: r.contraparteId ?? f.proveedorId,
                                        contraparteNombre: r.contraparteNombre ?? prov.nombre,
                                        contraparteRif: r.contraparteRif ?? prov.rif,
                                        facturaNumero: r.facturaNumero ?? (f.num !== '—' ? f.num : null),
                                        facturaControl: r.facturaControl,
                                        facturaFecha: r.facturaFecha ?? f.fecha,
                                        baseImponible: r.baseImponible || f.total,
                                        iva: r.impuesto,
                                        total: f.total,
                                        moneda: r.moneda,
                                        docId: r.docId ?? f.docId,
                                        docKind: r.docKind ?? f.docKind,
                                        codigo: r.docCodigo ?? f.doc,
                                        porcentaje: r.porcentaje,
                                        sustituyeAComprobante: r.numeroComprobante,
                                      });
                                    }}
                                    title={`Reemitir nueva retención de ${t.corto} para esta factura (sustituye a la anulada N° ${r.numeroComprobante || '—'})`}
                                  >
                                    + Reemitir
                                  </button>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="lfv8-tot">
                        <small>Total retenido</small>
                        <span>{totalRet ? monto(totalRet, 'Bs') : '—'}</span>
                        {(() => {
                          const conComp = [...f.retenciones.values()].filter((r) => !r.anulada && r.numeroComprobante);
                          if (!conComp.length) return null;
                          return (
                            <div>
                              <button
                                type="button"
                                className="lfv8-btn-imprimir-todos"
                                onClick={() => void verComprobantesFactura(f)}
                                title={`Imprimir en 1 solo PDF los ${conComp.length} comprobante(s) de esta factura`}
                              >
                                🖨️ {conComp.length > 1 ? `Imprimir todos (${conComp.length})` : 'Imprimir comprobante'}
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    </article>
                    {conP03 && f.documentoId && (
                      <details style={{ margin: '-.2rem 0 .5rem', fontSize: '.84rem' }}>
                        <summary className="muted" style={{ cursor: 'pointer' }}>Órdenes que cubre la factura {f.num}</summary>
                        <CubrirOtrasOrdenes documentoId={f.documentoId} proveedorId={f.proveedorId}
                          principal={f.docId && f.docKind !== 'manual' ? { tipo: f.docKind, id: f.docId } : null}
                          puedeEditar={canWrite} />
                      </details>
                    )}
                    </Fragment>
                  );
                })}
                {prov.facturas.length > MAX_VISIBLE && (
                  <button type="button" className="lfv8-ver-restantes"
                    aria-expanded={abierto}
                    onClick={() => setExpandidos((prev) => {
                      const next = new Set(prev);
                      if (abierto) next.delete(pk); else next.add(pk);
                      return next;
                    })}>
                    {abierto
                      ? `Mostrar menos (las primeras ${MAX_VISIBLE})`
                      : `Ver las ${prov.facturas.length - MAX_VISIBLE} facturas restantes de este proveedor`}
                  </button>
                )}
              </section>
            );
          })}
          {!loading && !errorCarga && (
            <Paginador pagina={pagina} tam={tam} unidad="retención(es)" onPagina={setPag} onTam={(t) => { setTam(t); setPag(1); }} />
          )}
        </>
      )}

      {/* ── Vista por impuesto (columnas) ── */}
      {!loading && !errorCarga && visibles.length > 0 && vista === 'impuesto' && (
        <div className="lfv8-columnas" style={{ '--n': impuestosTarjeta.length } as React.CSSProperties}>
          {impuestosTarjeta.map((t) => {
            const del = visibles.filter((r) => r.tipo === t.key);
            const pendientes = del.filter((r) => !r.anulada && r.estado !== 'registrada' && r.estado !== 'declarada');
            const registradas = del.filter((r) => !r.anulada && (r.estado === 'registrada' || r.estado === 'declarada'));
            return (
              <section key={t.key} className="lfv8-columna">
                <header>
                  <h3>{t.corto}</h3>
                  <span className="lfv8-contador">{pendientes.length} pendientes · {registradas.length} registradas</span>
                </header>
                <h4>Pendientes ({pendientes.length})</h4>
                {pendientes.map((r) => {
                  const docLabel = r.facturaNumero ?? r.docCodigo ?? '—';
                  const docRuta = canVerPedidos ? rutaDocumento(r.docKind, r.docId) : null;
                  return (
                  <div key={r.id} className="lfv8-item">
                    <span className="lfv8-quien">
                      {r.contraparteNombre ?? '—'}
                      <small>Factura {docRuta ? <a href={`#${docRuta}`} className="lfv8-doc">{docLabel}</a> : docLabel} · {r.facturaFecha ? fechaCorta(r.facturaFecha) : '—'}{fueraDelSistema(r) && ' · Fuera del sistema'}</small>
                    </span>
                    <span className="lfv8-cuanto">
                      <span className={`lfv8-pill falta`}>Pendiente</span>
                    </span>
                  </div>
                  );
                })}
                {!pendientes.length && <div className="lfv8-item"><span className="lfv8-quien muted">Sin pendientes.</span><span /></div>}
                <h4>Registradas ({registradas.length})</h4>
                {registradas.map((r) => {
                  const docLabel = r.facturaNumero ?? r.docCodigo ?? '—';
                  const docRuta = canVerPedidos ? rutaDocumento(r.docKind, r.docId) : null;
                  return (
                  <div key={r.id} className="lfv8-item">
                    <span className="lfv8-quien">
                      {r.contraparteNombre ?? '—'}
                      <small>Factura {docRuta ? <a href={`#${docRuta}`} className="lfv8-doc">{docLabel}</a> : docLabel} · {r.facturaFecha ? fechaCorta(r.facturaFecha) : '—'}{fueraDelSistema(r) && ' · Fuera del sistema'}</small>
                    </span>
                    <span className="lfv8-cuanto">
                      <span className={`lfv8-pill ${r.estado === 'declarada' ? 'declarada' : 'ok'}`}>{r.estado === 'declarada' ? 'Declarada' : 'Registrada'}</span>
                      <br /><span className="lfv8-monto">{monto(r.montoRetenido, r.moneda)}</span>
                    </span>
                  </div>
                  );
                })}
                {!registradas.length && <div className="lfv8-item"><span className="lfv8-quien muted">Sin registros en el período.</span><span /></div>}
              </section>
            );
          })}
        </div>
      )}

      {/* ── Una fila por retención (el libro) ── */}
      {!loading && !errorCarga && visibles.length > 0 && vista === 'lista' && (
        <>
          <div className="lfv8-sis" style={{ '--cols': '.8fr 1.1fr .6fr 1.6fr 1fr 1fr 1fr .8fr' } as React.CSSProperties}>
            <div className="lfv8-sis-cab">
              <span>Fecha</span><span>Comprobante</span><span>Impuesto</span><span>Contraparte</span>
              <span>Factura</span><span style={{ textAlign: 'right' }}>Retenido</span><span style={{ textAlign: 'right' }}>En Bs</span><span>Estado</span>
            </div>
            {pagina.filas.map((r) => (
              <div key={r.id} className="lfv8-sis-fila" style={r.anulada ? { opacity: .6 } : undefined}>
                <span data-l="Fecha">{r.facturaFecha ? fechaCorta(r.facturaFecha) : '—'}</span>
                <span data-l="Comprobante" className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}>
                  {r.numeroComprobante ?? '—'}
                  {r.numeroComprobante && (
                    <button type="button" className="lfv8-mini" onClick={() => void verComprobante(r)} title="Ver comprobante generado">📄</button>
                  )}
                  {r.comprobantePath && (
                    <button type="button" className="lfv8-mini" onClick={() => void verAdjuntoRespaldo(r)} title={`Ver respaldo adjunto (${r.comprobanteNombre || 'Archivo'})`}>📎</button>
                  )}
                </span>
                <span data-l="Impuesto">{TIPOS_IMPUESTO.find((t) => t.key === r.tipo)?.corto ?? rotuloImpuesto(r.tipo)}<small>{r.direccion === 'recibida' ? 'Recibida' : 'Practicada'}</small></span>
                <span data-l="Contraparte">{r.contraparteNombre ?? '—'}<small className="mono">{r.contraparteRif ?? ''}{fueraDelSistema(r) ? ' · Fuera del sistema' : ''}</small></span>
                <span data-l="Factura" className="mono">{r.facturaNumero ?? r.docCodigo ?? '—'}</span>
                <span data-l="Retenido" className="n">{monto(r.montoRetenido, r.moneda)}</span>
                <span data-l="En Bs" className="n">{enBs(r) ? monto(enBs(r), 'Bs') : '—'}</span>
                <span data-l="Estado">
                  <span className={`lfv8-pill ${r.anulada ? 'falta' : r.estado === 'declarada' ? 'declarada' : 'ok'}`}>
                    {r.anulada ? 'Anulada' : r.estado === 'declarada' ? 'Declarada' : 'Registrada'}
                  </span>
                  {canWrite && r.anulada && (
                    <button
                      type="button"
                      className="lfv8-mini registrar"
                      style={{ marginLeft: '.35rem', verticalAlign: 'middle', padding: '0 .4rem', fontSize: '.7rem' }}
                      onClick={() => {
                        setRegistrar({
                          direccion: r.direccion,
                          tipoInicial: r.tipo,
                          contraparteId: r.contraparteId,
                          contraparteNombre: r.contraparteNombre,
                          contraparteRif: r.contraparteRif,
                          facturaNumero: r.facturaNumero,
                          facturaControl: r.facturaControl,
                          facturaFecha: r.facturaFecha,
                          baseImponible: r.baseImponible,
                          iva: r.impuesto,
                          moneda: r.moneda,
                          docId: r.docId,
                          docKind: r.docKind,
                          codigo: r.docCodigo,
                          porcentaje: r.porcentaje,
                          sustituyeAComprobante: r.numeroComprobante,
                        });
                      }}
                      title={`Reemitir nueva retención de ${rotuloImpuesto(r.tipo)} para esta factura`}
                    >
                      + Reemitir
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
          {visibles.length > tam && (
            <Paginador pagina={pagina} tam={tam} unidad="retención(es)" onPagina={setPag} onTam={(t) => { setTam(t); setPag(1); }} />
          )}
        </>
      )}

      {/* ── Vista sin retención: lo registrado en 0 con su motivo y (R10) las decisiones «no aplica» ── */}
      {!loading && !errorCarga && vista === 'sin' && (<>
        {errorNoAplica && (
          <p className="muted" role="status" style={{ fontSize: '.8rem', color: 'var(--warning)', margin: '0 0 .5rem' }}>
            Se muestran solo las retenciones en 0 %; las decisiones de «no aplica» no se pudieron leer: {errorNoAplica}
          </p>
        )}
        {sinRetencion.length === 0 && noAplicaVisibles.length === 0 ? (
          <div className="lfv8-vacio">
            <p>Ninguna factura sin retención en este rango.</p>
            <p className="muted" style={{ fontSize: '.82rem', marginTop: '.3rem' }}>
              Aparecen aquí las retenciones registradas en 0 % con su motivo (por ejemplo, el pago no llega al mínimo del ISLR)
              {conR10 ? ' y los impuestos marcados «No aplica» en una factura.' : '.'}
            </p>
          </div>
        ) : (<>
          {sinRetencion.length > 0 && (
            <div className="lfv8-sis" style={{ '--cols': '1.6fr 1fr .8fr 2.6fr' } as React.CSSProperties}>
              <div className="lfv8-sis-cab">
                <span>Contraparte</span><span>Factura</span><span>Fecha</span><span>Retención en 0 % · motivo</span>
              </div>
              {sinRetencion.map((g) => (
                <div key={g.key} className="lfv8-sis-fila">
                  <span data-l="Contraparte">{g.nombre ?? '—'}<small className="mono">{g.rif ?? ''}</small></span>
                  <span data-l="Factura" className="mono">{g.num}</span>
                  <span data-l="Fecha">{g.fecha ? fechaCorta(g.fecha) : '—'}</span>
                  <span data-l="Motivo">
                    {g.filas.map((r) => (
                      <span key={r.id} style={{ display: 'block' }}>
                        <span className="lfv8-pill ok">{rotuloImpuesto(r.tipo)}</span>{' '}
                        <small className="muted">Retención en 0 %:</small>{' '}
                        {r.observacion ?? 'Sin motivo anotado'}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
          {noAplicaVisibles.length > 0 && (
            <>
              <h4 style={{ margin: '1rem 0 .4rem' }}>
                <span className="lfv8-pill falta">No aplica</span>{' '}
                Impuestos que se decidió no retener ({noAplicaVisibles.length})
              </h4>
              <div className="lfv8-sis" style={{ '--cols': '.9fr 1fr 1.5fr 2fr 1.2fr' } as React.CSSProperties}>
                <div className="lfv8-sis-cab">
                  <span>Impuesto</span><span>Factura</span><span>Proveedor</span><span>Motivo · detalle</span><span>Quién · cuándo</span>
                </div>
                {noAplicaVisibles.map((d) => (
                  <div key={d.id} className="lfv8-sis-fila">
                    <span data-l="Impuesto"><span className="lfv8-pill falta">No aplica</span> {d.impuesto}</span>
                    <span data-l="Factura"><span className="mono">{d.facturaNro}</span><small>{d.facturaFecha ? fechaCorta(d.facturaFecha) : 'Sin fecha'}</small></span>
                    <span data-l="Proveedor">{d.proveedor}<small className="mono">{d.rif ?? ''}</small></span>
                    <span data-l="Motivo">{d.motivo}{d.detalle && <small>{d.detalle}</small>}</span>
                    <span data-l="Quién">{d.quien}<small>{dateTime(d.cuando)}</small></span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>)}
      </>)}

      {anular && (
        <Modal title={`Anular la retención ${anular.numeroComprobante ?? ''}`} compact onClose={() => setAnular(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setAnular(null)}>Cancelar</button>
              <button className="btn btn-danger" disabled={!motivo.trim()}
                onClick={async () => {
                  try {
                    await anularRetencion(anular.id, motivo);
                    toast('Retención anulada', 'success');
                    setAnular(null);
                    await reload();
                  } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo anular', 'error'); }
                }}>Anular</button>
            </>
          }>
          <p style={{ marginTop: 0 }}>
            Se anula <strong>{monto(anular.montoRetenido, anular.moneda)}</strong> de {labelImpuesto(anular.tipo)} de {anular.contraparteNombre ?? '—'}.
            El comprobante queda en el libro marcado como anulado, con su número.
          </p>
          <div className="form-row" style={{ margin: 0 }}>
            <label>¿Por qué se anula?</label>
            <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: la factura fue sustituida por el proveedor" />
          </div>
        </Modal>
      )}

      {modalArc && (
        <Modal title="Comprobante Anual ARC de ISLR (Art. 24 Decreto 1.808)" compact onClose={() => setModalArc(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setModalArc(null)}>Cancelar</button>
              <button className="btn btn-primary" disabled={!modalArc.proveedorRif.trim()}
                onClick={async () => {
                  try {
                    const { verComprobanteArcPdf } = await import('./comprobanteArcPdf');
                    await verComprobanteArcPdf(modalArc.anio, modalArc.proveedorRif, filas, config, {
                      incluirLogo: imprimirLogo && dispDigital.tieneLogo,
                      incluirFirma: imprimirFirma && dispDigital.tieneFirma,
                      incluirSello: imprimirSello && dispDigital.tieneSello,
                    });
                    setModalArc(null);
                  } catch (e) {
                    toast(e instanceof Error ? e.message : 'No se pudo generar el comprobante ARC', 'error');
                  }
                }}>
                Generar Comprobante ARC
              </button>
            </>
          }>
          <p style={{ marginTop: 0, fontSize: '0.85rem' }}>
            Genera la relación anual acumulada de retenciones practicadas de ISLR para el contribuyente, desglosada de enero a diciembre según lo dispuesto en el <strong>Artículo 24 del Decreto N° 1.808</strong>.
          </p>
          <div className="form-row" style={{ marginBottom: '12px' }}>
            <label>Ejercicio Fiscal (Año)</label>
            <input className="input" type="number" min={2020} max={2035} value={modalArc.anio}
              onChange={(e) => setModalArc({ ...modalArc, anio: Number(e.target.value) || new Date().getFullYear() })} />
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            <label>Proveedor (Sujeto Retenido)</label>
            <select className="lfv8-select" value={modalArc.proveedorRif}
              onChange={(e) => setModalArc({ ...modalArc, proveedorRif: e.target.value })}>
              <option value="">-- Seleccionar proveedor con retenciones de ISLR --</option>
              {proveedoresConIslr.map((p) => (
                <option key={p.rif} value={p.rif}>
                  {p.nombre ? `${p.nombre} (${p.rif})` : p.rif}
                </option>
              ))}
            </select>
          </div>
        </Modal>
      )}

      {registrar && (
        <RegistrarRetencionModal semilla={registrar} actor={actor} actorName={actorName}
          onClose={() => setRegistrar(null)}
          onHecho={async () => { setRegistrar(null); await reload().catch(() => { /* se reintenta al filtrar */ }); }} />
      )}
      {facturaVarias && (
        <RegistrarFacturaRetencion actor={actor} actorName={actorName}
          semilla={retenerSobre ? { documento: retenerSobre } : semillaCompra}
          onClose={() => { setFacturaVarias(false); setRetenerSobre(null); setSemillaCompra(undefined); }}
          onHecho={async () => { setFacturaVarias(false); setRetenerSobre(null); setSemillaCompra(undefined); await reload().catch(() => { /* se reintenta al filtrar */ }); }} />
      )}
      {verFacturas && (
        <FacturasRegistradas puedeRetener={canWrite}
          onRetener={(f) => { setVerFacturas(false); setRetenerSobre(f); setFacturaVarias(true); }}
          onClose={() => setVerFacturas(false)} />
      )}
      {verFacturasCompras && (
        <Modal title="Facturas de Compras sin registrar en Retenciones" size="xl" onClose={() => setVerFacturasCompras(false)}>
          <FacturasPorRegistrar
            puedeRegistrar={canWrite}
            onRegistrar={(f) => {
              setVerFacturasCompras(false);
              setSemillaCompra(semillaDeFacturaOrigen(f));
              setFacturaVarias(true);
            }}
          />
        </Modal>
      )}
    </div>
  );
}


/* ═══════════════ Registrar / practicar una retención ═══════════════ */

/** Datos con los que se abre el modal. Vacío = carga manual desde el libro. */
export interface SemillaRetencion {
  direccion?: DireccionRetencion;
  tipoInicial?: TipoImpuesto;
  docKind?: DocKind;
  docId?: string | null;
  codigo?: string | null;
  contraparteId?: string | null;
  contraparteNombre?: string | null;
  contraparteRif?: string | null;
  moneda?: string;
  total?: number;
  iva?: number;
  baseImponible?: number;
  ivaIncluido?: boolean;
  porcentaje?: number | null;
  facturaNumero?: string | null;
  facturaControl?: string | null;
  facturaFecha?: string | null;
  sustituyeAComprobante?: string | null;
}

export function RegistrarRetencionModal({ semilla, actor, actorName, onClose, onHecho, proveedorIdsPendientes }: {
  semilla: SemillaRetencion;
  actor: string;
  actorName: string | null;
  onClose: () => void;
  onHecho: () => void;
  proveedorIdsPendientes?: Set<string>;
}) {
  const [configBase, setConfig] = useState<ConfigRetencion>(CONFIG_RETENCION_DEFECTO);
  // Con R3, la UT y los % salen de los valores vigentes a la fecha de la factura; sin R3, del JSON.
  const [config, setConfigFecha] = useState<ConfigRetencion>(CONFIG_RETENCION_DEFECTO);
  const [avisoFecha, setAvisoFecha] = useState<string | null>(null);
  // Con V2R la serie de cada impuesto tiene su formato; sin V2R, todas AAAAMM + 8 (la base de hoy).
  const [conV2R, setConV2R] = useState(false);
  useEffect(() => { v2rDisponible().then(setConV2R).catch(() => setConV2R(false)); }, []);
  // Con R7, una practicada se calcula con la regla vigente a la fecha de la factura; sin R7 o sin regla que aplique, como hoy.
  const [conR7, setConR7] = useState(false);
  useEffect(() => { r7Disponible().then(setConR7).catch(() => setConR7(false)); }, []);
  const [reglaCalc, setReglaCalc] = useState<CalculoConRegla | null>(null);
  const [avisoRegla, setAvisoRegla] = useState<string | null>(null);
  const [conceptos, setConceptos] = useState<ConceptoRetencion[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);

  const [direccion, setDireccion] = useState<DireccionRetencion>(semilla.direccion ?? 'practicada');
  const verProveedores = usePermissions().can('proveedores');
  const [tipo, setTipo] = useState<TipoImpuesto>(semilla.tipoInicial ?? 'iva');
  const [sujeto, setSujeto] = useState<SujetoRetenido>('pj_domiciliada');
  const [conceptoId, setConceptoId] = useState('');
  const [motivos, setMotivos] = useState<MotivosIvaCien>({});
  // R6: supuestos del % y motivos de «No aplica» vigentes a la fecha de la factura (null/[] sin R6).
  const [supuestosIva, setSupuestosIva] = useState<Supuesto[] | null>(null);
  const [motivosNa, setMotivosNa] = useState<MotivoNoAplica[]>([]);
  const [motivoNaId, setMotivoNaId] = useState('');
  const [motivoNaDetalle, setMotivoNaDetalle] = useState('');

  const [proveedorId, setProveedorId] = useState(semilla.contraparteId ?? '');
  const [contraparte, setContraparte] = useState(semilla.contraparteNombre ?? '');
  const [rif, setRif] = useState(semilla.contraparteRif ?? '');
  const [moneda, setMoneda] = useState(semilla.moneda ?? 'Bs');
  const [tasaStr, setTasaStr] = useState('');
  const [numero, setNumero] = useState('');
  const [facturaNumero, setFacturaNumero] = useState(semilla.facturaNumero ?? '');
  const [facturaControl, setFacturaControl] = useState(semilla.facturaControl ?? '');
  const [facturaFecha, setFacturaFecha] = useState(semilla.facturaFecha ?? '');
  const [fechaRetencion, setFechaRetencion] = useState(hoyIso());
  const [tasaBcv, setTasaBcv] = useState<{ tasa: number | null; nota: string } | null>(null);
  const [baseStr, setBaseStr] = useState(numeroATexto(semilla.baseImponible ?? semilla.total ?? 0));
  const [ivaStr, setIvaStr] = useState(numeroATexto(semilla.iva ?? 0));
  const [pctStr, setPctStr] = useState(semilla.porcentaje != null ? numeroATexto(semilla.porcentaje) : '');
  const [montoStr, setMontoStr] = useState('');
  const [observacion, setObservacion] = useState(
    semilla.sustituyeAComprobante ? `Sustituye a la retención anulada N° ${semilla.sustituyeAComprobante}` : ''
  );
  const [archivo, setArchivo] = useState<File | null>(null);
  // Qué documento se adjunta: en una recibida, el comprobante que entregó el agente; en una practicada, el respaldo.
  const [tipoArchivo, setTipoArchivo] = useState('');
  const [otroDetalle, setOtroDetalle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avisoSinDocDescartado, setAvisoSinDocDescartado] = useState(() => {
    try { return localStorage.getItem('gt_aviso_sin_doc_descartado') === 'true'; } catch { return false; }
  });
  const descartarAvisoSinDoc = () => {
    setAvisoSinDocDescartado(true);
    try { localStorage.setItem('gt_aviso_sin_doc_descartado', 'true'); } catch {}
  };
  const { marcarSucio, pedirCierre, dialogo } = useDescartar(onClose, saving);
  // R10: el N° de factura busca entre las facturas ya registradas; al elegir una, se retiene sobre ella.
  const [conR10, setConR10] = useState(false);
  useEffect(() => { r10Disponible().then(setConR10).catch(() => setConR10(false)); }, []);
  const [elegida, setElegida] = useState<FacturaResumen | null>(null);
  const precarga = useMemo(() => (elegida ? precargaDeFactura(elegida) : null), [elegida]);
  // La tasa que trae la factura registrada manda sobre la BCV del día.
  const tasaDeFactura = elegida?.tasa != null && elegida.tasa > 0 ? elegida.tasa : null;
  const [periodoCerrado, setPeriodoCerrado] = useState<PeriodoFiscal | null>(null);

  useEffect(() => {
    let vivo = true;
    const f = facturaFecha || fechaRetencion;
    if (/^\d{4}-\d{2}-\d{2}$/.test(f)) {
      periodoEstaCerrado(tipoAGt(tipo), f)
        .then((p) => { if (vivo) setPeriodoCerrado(p); })
        .catch(() => { if (vivo) setPeriodoCerrado(null); });
    } else {
      setPeriodoCerrado(null);
    }
    return () => { vivo = false; };
  }, [facturaFecha, fechaRetencion, tipo]);

  // Consulta reactiva del correlativo estimado según el impuesto y el período
  const [correlativoEstimado, setCorrelativoEstimado] = useState<CorrelativoEstimado | null>(null);
  useEffect(() => {
    if (direccion !== 'practicada' || tipo === 'igtf') {
      setCorrelativoEstimado(null);
      return;
    }
    const periodo = periodoDe(facturaFecha || fechaRetencion || hoyIso());
    let activo = true;

    consultarCorrelativoEstimado(tipo, periodo)
      .then((c) => {
        if (activo) setCorrelativoEstimado(c);
      })
      .catch(() => {
        if (activo) {
          setCorrelativoEstimado({
            numero: 1,
            comprobante: formatoComprobante(periodo, 1, tipo),
            formato: formatoSerie(tipo),
            explicacion: `Correlativo sugerido para ${rotuloImpuesto(tipo)}.`,
          });
        }
      });

    return () => {
      activo = false;
    };
  }, [direccion, tipo, facturaFecha, fechaRetencion]);

  useEffect(() => {
    void Promise.all([getConfigRetencion(), listConceptos(true), listProveedores()])
      .then(([c, cs, ps]) => {
        setConfig(c); setConceptos(cs);
        const activos = ps.filter((p) => p.estado === 'activo');
        setProveedores(activos);
        if (semilla.contraparteId) {
          const p = activos.find((x) => x.id === semilla.contraparteId);
          if (p) {
            setContraparte(p.razon_social);
            setRif(p.rif ?? '');
            const sug = sugerirSujetoPorRif(p.rif ?? '');
            if (sug) setSujeto(sug.sujeto);
          }
        }
      })
      .catch((e) => setError(e instanceof Error ? `No se pudo leer la configuración: ${e.message}` : 'No se pudo leer la configuración.'));
  }, []);

  // La tasa es la BCV de la fecha de la factura (sábado y domingo: la del lunes), no la del día en que se registra.
  // En Bs también se lee: sirve para informar el equivalente en $, no se guarda.
  useEffect(() => {
    const f = fechaTasaBcv(facturaFecha);
    if (!f) { setTasaBcv({ tasa: null, nota: 'Se llena sola con la tasa BCV del día de la factura: indica primero la «Fecha de la factura».' }); return; }
    let vigente = true;
    const cuando = f === facturaFecha ? fechaCorta(f) : `${fechaCorta(f)}, el lunes siguiente`;
    getTasaUsdDeFecha(f)
      .then((t) => {
        if (!vigente) return;
        setTasaBcv(t != null
          ? { tasa: t, nota: `Tasa BCV del ${cuando} (fecha de la factura), tomada del sistema.` }
          : { tasa: null, nota: `No hay tasa BCV registrada del ${cuando}${moneda === 'Bs' ? '' : ': escríbela (Bs por cada $)'}.` });
        // Con coma decimal: «179,437» no se confunde con miles.
        if (moneda !== 'Bs') setTasaStr(tasaDeFactura != null ? numeroATexto(tasaDeFactura) : t != null ? numeroATexto(t) : '');
      })
      .catch(() => { if (vigente) setTasaBcv({ tasa: null, nota: 'No se pudo leer la tasa BCV.' }); });
    return () => { vigente = false; };
  }, [facturaFecha, moneda, tasaDeFactura]);

  useEffect(() => {
    let vigente = true;
    setAvisoFecha(null);
    if (!facturaFecha) { setConfigFecha(configBase); return; }
    configDeFecha(configBase, facturaFecha, [tipo])
      .then((c) => { if (vigente) setConfigFecha(c); })
      .catch((e) => { if (vigente) { setConfigFecha(configBase); setAvisoFecha(e instanceof Error ? e.message : 'No se pudieron leer los valores de esa fecha.'); } });
    return () => { vigente = false; };
  }, [configBase, facturaFecha, tipo]);

  useEffect(() => {
    let vigente = true;
    if (!facturaFecha) { setSupuestosIva(null); setMotivosNa([]); return; }
    supuestosVigentes('IVA', facturaFecha).then((s) => { if (vigente) setSupuestosIva(s); }).catch(() => { if (vigente) setSupuestosIva(null); });
    r6Disponible()
      .then((hay) => (hay ? motivosVigentes(tipoAGt(tipo), facturaFecha) : []))
      .then((m) => { if (vigente) setMotivosNa(m); })
      .catch(() => { if (vigente) setMotivosNa([]); });
    return () => { vigente = false; };
  }, [facturaFecha, tipo]);

  const supuesto = useMemo(
    () => (supuestosIva ? supuestoAplicado(motivos as Record<string, boolean | undefined>, supuestosIva) : undefined),
    [supuestosIva, motivos],
  );
  const motivoNa = motivosNa.find((m) => m.id === motivoNaId) ?? null;
  function elegirMotivoNa(id: string, detalle: string) {
    setMotivoNaId(id); setMotivoNaDetalle(detalle);
    const m = motivosNa.find((x) => x.id === id);
    setObservacion(m ? (detalle.trim() ? `${m.texto}: ${detalle.trim()}` : m.texto) : '');
  }

  const opcionesProveedor = useMemo(() => {
    const lista = proveedorIdsPendientes
      ? proveedores.filter((p) => proveedorIdsPendientes.has(p.id))
      : proveedores;
    return lista.map((p) => ({ value: p.id, label: `${p.razon_social}${p.rif ? ` · ${p.rif}` : ''}` }));
  }, [proveedores, proveedorIdsPendientes]);

  /** Elegir una factura ya registrada: sus datos quedan fijos y solo se ofrecen sus impuestos pendientes. */
  function elegirFactura(f: FacturaResumen) {
    const p = precargaDeFactura(f);
    setElegida(f);
    setDireccion(p.direccion);
    setProveedorId(p.proveedorId);
    setContraparte(p.contraparte);
    setRif(p.rif);
    const sug = sugerirSujetoPorRif(p.rif);
    if (sug) setSujeto(sug.sujeto);
    setFacturaNumero(p.facturaNumero);
    setFacturaControl(p.facturaControl);
    setFacturaFecha(p.facturaFecha);
    setMoneda(p.moneda);
    if (p.tasaStr) setTasaStr(p.tasaStr);
    if (p.tipo) setTipo(p.tipo);
    marcarSucio();
  }

  function elegirProveedor(id: string) {
    setProveedorId(id);
    const p = proveedores.find((x) => x.id === id);
    if (p) {
      setContraparte(p.razon_social);
      setRif(p.rif ?? '');
      const sug = sugerirSujetoPorRif(p.rif ?? '');
      if (sug) setSujeto(sug.sujeto);
    }
  }

  const conceptosDelTipo = useMemo(() => conceptos.filter((c) =>
    c.tipo === tipo && (c.sujeto === sujeto || c.sujeto === 'todos')), [conceptos, tipo, sujeto]);
  useEffect(() => { setConceptoId(conceptosDelTipo[0]?.id ?? ''); }, [conceptosDelTipo]);
  const concepto = conceptosDelTipo.find((c) => c.id === conceptoId) ?? null;

  // Cuando la practica la empresa, el sistema calcula. Cuando se la
  // practicaron, el número ya está en el comprobante: se copia, no se inventa.
  const calculoHoy: CalculoRetencion = useMemo(() => {
    const base = nDec(baseStr);
    if (tipo === 'iva') return calcularRetencionIva({ baseImponible: base, ivaFactura: nDec(ivaStr), motivos, supuesto }, config);
    if (tipo === 'islr') return calcularRetencionIslr({ montoPago: base, concepto, moneda, tasa: nDec(tasaStr) }, config);
    if (tipo === 'igtf') return calcularIgtf({ montoPago: base, enDivisas: true }, config);
    return calcularRetencionLocal({ montoPago: base, concepto }, tipo);
  }, [tipo, baseStr, ivaStr, motivos, supuesto, concepto, config, moneda, tasaStr]);

  const esManual = direccion === 'recibida';

  useEffect(() => {
    setAvisoRegla(null);
    if (!conR7 || esManual || !facturaFecha) { setReglaCalc(null); return; }
    let vigente = true;
    const t = setTimeout(() => {
      const base = nDec(baseStr);
      calcularConReglaVigente(tipoAGt(tipo), {
        fecha: facturaFecha, direccion: 'practicada',
        sujeto: tipo === 'iva' || tipo === 'igtf' ? null : sujetoAGt(sujeto),
        moneda, tasa: moneda === 'Bs' ? null : (nDec(tasaStr) || null),
        pago: base, baseImponible: base, iva: nDec(ivaStr),
        supuesto: !!supuesto, codigo: concepto?.codigo ?? null,
      })
        .then((c) => { if (vigente) setReglaCalc(c); })
        .catch((e) => {
          if (!vigente) return;
          setReglaCalc(null);
          setAvisoRegla(e instanceof Error ? `No se pudo leer la regla vigente: ${e.message}` : 'No se pudo leer la regla vigente.');
        });
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
  }, [conR7, esManual, facturaFecha, tipo, sujeto, moneda, tasaStr, baseStr, ivaStr, supuesto, concepto]);

  // La regla manda sobre el cálculo de hoy solo cuando hay una vigente que aplica.
  const calculo: CalculoRetencion = useMemo(() => {
    if (!reglaCalc) return calculoHoy;
    const r = reglaCalc.resultado;
    const cual = `regla «${reglaCalc.regla.nombre}» (versión ${reglaCalc.regla.version})`;
    return {
      ...calculoHoy,
      baseImponible: r.base, impuesto: r.impuesto, porcentaje: r.pct ?? 0,
      sustraendo: r.sustraendo, montoRetenido: r.monto,
      explicacion: r.aplica ? `Calculado con la ${cual}, vigente al ${fechaCorta(facturaFecha)}.` : `No se retiene según la ${cual}: ${r.motivo ?? 'sin motivo'}.`,
    };
  }, [calculoHoy, reglaCalc, facturaFecha]);
  const bloqueo = direccion === 'practicada' ? motivoNoPuedePracticar(tipo, config) : null;
  const pctFinal = esManual ? nDec(pctStr) : calculo.porcentaje;
  const montoFinal = esManual
    // Vacío = el calculado; «0» escrito = 0 (y pide el motivo del 0 %). Lo ilegible lo frena «montosIlegibles».
    ? (montoEscrito(montoStr, Math.round(nDec(baseStr) * nDec(pctStr)) / 100) ?? 0)
    : calculo.montoRetenido;
  const tasa = nDec(tasaStr);
  const montoBs = enBolivares(montoFinal, moneda, tasa);
  // Un 0% se registra solo con su motivo (D19 · v8 §4.10). El motivo es la observación.
  const esCero = montoFinal === 0;
  const ceroSinMotivo = esCeroSinMotivo(pctFinal, montoFinal, observacion);
  // Una practicada sin OC, CS ni compra directa queda «fuera del sistema»: se dice y se anota de dónde viene.
  // Con una factura ya registrada elegida (R10), su origen ya quedó anotado al registrarla.
  const sinDocumento = direccion === 'practicada' && !semilla.docId && !elegida;
  // A muchos RIF de proveedores les falta el dígito verificador (V-12345678): se calcula y se registra completo.
  const rifCompleto = rif.trim() ? completarRif(rif) : null;
  const rifCompletado = rifCompleto && !rifValido(rif) ? formatearRif(rifCompleto) : null;
  const rifMal = rif.trim() !== '' && !rifCompleto;
  // D43: el mensaje dice cuál RIF y dónde se corrige (practicada: en la ficha del proveedor).
  const textoRif = rifMal ? textoRifInvalido({ direccion, rif, nombre: contraparte }) : null;
  const equivalenteUsd = moneda === 'Bs' && tasaBcv?.tasa ? montoFinal / tasaBcv.tasa : null;
  const montosIlegibles = ([
    ['Base imponible', baseStr, true],
    ['IVA de la factura', ivaStr, tipo === 'iva'],
    ['Tasa', tasaStr, moneda !== 'Bs'],
    ['% retenido', pctStr, esManual],
    ['Monto retenido', montoStr, esManual],
  ] as Array<[string, string, boolean]>).filter(([, v, aplica]) => aplica && leerMonto(v) == null).map(([n]) => n);

  async function emitir() {
    setError(null);
    if (bloqueo) { setError(bloqueo); return; }
    if (periodoCerrado) {
      setError(`El período fiscal (${nombrePeriodo(periodoCerrado)}) ya fue declarado ante el SENIAT. No se pueden registrar retenciones en períodos cerrados sin reapertura previa.`);
      return;
    }
    if (avisoFecha) { setError(avisoFecha); return; }
    if (avisoRegla) { setError(avisoRegla); return; }
    if (motivoNa?.requiereTexto && !motivoNaDetalle.trim()) { setError(`El motivo «${motivoNa.texto}» pide un detalle.`); return; }
    if (montosIlegibles.length) { setError(`No se entiende: ${montosIlegibles.join(', ')}. Escribe 1.234,56 o 1234,56.`); return; }
    if (montoFinal < 0) { setError('El monto no puede ser negativo.'); return; }
    if (ceroSinMotivo) { setError(validarMotivoCero(pctFinal, montoFinal, observacion, tipo).mensaje ?? 'Escribe el motivo del 0 %.'); return; }
    if (esManual && !contraparte.trim()) { setError('Indica quién te practicó la retención.'); return; }
    if (!esManual && !proveedorId) { setError('Elige el proveedor al que le practicas la retención.'); return; }
    if (textoRif) { setError(textoRif.error); return; }
    if (sinDocumento && !observacion.trim()) { setError('Sin documento del sistema: indica en la observación de dónde viene esta retención.'); return; }
    if (moneda !== 'Bs' && !(tasa > 0)) { setError('Indica la tasa de cambio para convertir la retención a bolívares.'); return; }
    const falta = faltaEnLaCarga({ tipo, facturaNumero, facturaFecha }); if (falta) { setError(falta); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaRetencion)) { setError('Indica la fecha de la retención (emisión del comprobante).'); return; }
    if (!esManual) {
      const errorDoc = validarDocumentoRespaldo(tipoArchivo, otroDetalle, !!archivo);
      if (errorDoc) { setError(errorDoc); return; }
    }
    if (precarga && !precarga.impuestos.includes(tipo)) { setError(`La factura ${precarga.facturaNumero || 'elegida'} ya no tiene ${rotuloImpuesto(tipo)} por retener.`); return; }
    setSaving(true);
    try {
      const periodo = periodoDe(facturaFecha);
      const nueva: NuevaRetencion = {
        tipo, direccion,
        docKind: semilla.docKind ?? 'manual',
        docId: semilla.docId ?? null, docCodigo: semilla.codigo ?? null,
        contraparteId: proveedorId || semilla.contraparteId || null,
        contraparteRif: rifCompleto ? formatearRif(rifCompleto) : (rif.trim() || null),
        contraparteNombre: contraparte.trim() || null,
        contraparteSujeto: tipo === 'iva' || tipo === 'igtf' ? null : sujeto,
        facturaNumero: facturaNumero.trim() || null,
        facturaControl: facturaControl.trim() || null,
        facturaFecha: facturaFecha || null,
        fechaRetencion,
        periodo, quincena: tipo === 'iva' ? quincenaDe(facturaFecha) : null,
        numeroComprobante: esManual ? (numero.trim() || null) : null,
        conceptoId: esManual ? null : (concepto?.id ?? null),
        conceptoNombre: esManual ? null : (concepto?.nombre ?? null),
        municipio: municipioDeLinea(tipo, config),
        moneda, tasa: moneda === 'Bs' ? null : tasa,
        baseImponible: esManual ? nDec(baseStr) : calculo.baseImponible,
        alicuota: esManual ? 0 : calculo.alicuota,
        impuesto: esManual ? nDec(ivaStr) : calculo.impuesto,
        porcentaje: pctFinal,
        sustraendo: esManual ? 0 : calculo.sustraendo,
        montoRetenido: montoFinal,
        // El supuesto del % queda escrito en la retención: es la foto de por qué se retuvo así.
        observacion: [
          supuesto && tipo === 'iva' ? `Retención al ${supuesto.pct} %: ${supuesto.texto}` : null,
          tipoArchivo === 'Otro documento' && otroDetalle.trim() ? `Doc. respaldo: ${otroDetalle.trim()}` : null,
          observacion.trim() || null,
        ].filter(Boolean).join(' · ') || null,
        actor, actorName,
        regla: !esManual && reglaCalc ? columnasDeRegla(reglaCalc) : null,
      };
      let r: RetencionPracticada;
      if (elegida) {
        // R10: retener después sobre la factura ya registrada, con una sola línea.
        const res = await retenerDespues(elegida, [lineaRetenerDespues(nueva)], { actorName, valorUt: config.valorUt });
        const linea = res.lineas.find((l) => l.tipo === tipo) ?? res.lineas[0];
        if (!linea) throw new Error('La base no devolvió la retención registrada.');
        r = linea;
      } else {
        r = await registrarRetencion(nueva, config);
      }
      const tipoArchivoFinal = esManual
        ? 'Comprobante de retención recibido'
        : etiquetaDocumentoRespaldo(tipoArchivo, otroDetalle);
      if (archivo) await adjuntarComprobante(r.id, archivo, tipoArchivoFinal).catch(() => toast('La retención quedó registrada, pero el adjunto no subió: se puede adjuntar después', 'error'));
      notify(
        `${labelDireccion(direccion)} · ${labelImpuesto(tipo)} · ${monto(r.montoRetenido, r.moneda)}${r.numeroComprobante ? ` · ${r.numeroComprobante}` : ''}`,
        'success', { link: '#/app/retenciones' },
      );
      onHecho();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la retención.');
      setSaving(false);
    }
  }

  return (
    <>
    <Modal title={semilla.sustituyeAComprobante ? `Reemitir retención · sustituye a N° ${semilla.sustituyeAComprobante}` : 'Registrar retención'} size="lg" onClose={pedirCierre}
      footer={
        <>
          {/* El botón no se apaga en silencio: al pulsarlo se dice qué falta, aquí al lado y arriba. */}
          {error && <small style={{ color: 'var(--danger)', marginRight: 'auto', maxWidth: '60%' }}>No se registró: {error}</small>}
          <button type="button" className="btn btn-ghost" onClick={pedirCierre} disabled={saving}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void emitir()} disabled={saving}>
            {saving ? 'Guardando…' : (esCero ? 'Registrar en 0 con motivo' : `Registrar · ${moneda !== 'Bs' && montoBs > 0 ? monto(montoBs, 'Bs') : monto(montoFinal, moneda)}`)}
          </button>
        </>
      }>
      <div onChange={marcarSucio}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
      {semilla.sustituyeAComprobante && (
        <div className="card" style={{ borderColor: 'var(--primary)', background: 'rgba(255, 170, 0, 0.08)', marginBottom: '.75rem', padding: '.6rem .8rem', fontSize: '.84rem' }}>
          <strong style={{ color: 'var(--primary)' }}>↺ Reemitiendo retención:</strong> Se precargaron los datos de la retención anulada <b>N° {semilla.sustituyeAComprobante}</b>. Ajusta los datos que requieran corrección y registra el nuevo comprobante oficial.
        </div>
      )}

      {/* La dirección primero: cambia el significado de todo lo demás */}
      <div className="form-row">
        <label>¿Quién retuvo?</label>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          {DIRECCIONES.map((d) => (
            <label key={d.key} className="card" style={{
              margin: 0, padding: '.45rem .8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '.4rem',
              borderColor: direccion === d.key ? 'var(--primary)' : 'var(--border)',
            }}>
              <input type="radio" checked={direccion === d.key} disabled={!!elegida} onChange={() => setDireccion(d.key)} />
              <span style={{ fontWeight: 600 }}>{d.label}</span>
            </label>
          ))}
        </div>
        <small className="hint muted">{significadoRetencion(tipo, direccion)}</small>
      </div>

      {avisoFecha && (
        <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: '.5rem' }}>
          <small>{avisoFecha}</small>
        </div>
      )}

      {bloqueo && (
        <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: '.5rem' }}>
          <small>{bloqueo}</small>
        </div>
      )}

      {sinDocumento && !avisoSinDocDescartado && (
        <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: '.5rem', position: 'relative', paddingRight: '2rem' }}>
          <button
            type="button"
            onClick={descartarAvisoSinDoc}
            style={{
              position: 'absolute',
              top: '6px',
              right: '8px',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted, #888)',
              fontSize: '1.1rem',
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: '4px',
              lineHeight: 1,
            }}
            title="Descartar este aviso"
            aria-label="Cerrar aviso"
          >
            ✕
          </button>
          <strong>Sin documento del sistema.</strong>{' '}
          <small>
            Esta retención no proviene de una Orden de Compra (OC), un Contrato de Servicio (CS) ni una compra directa (por ejemplo, una factura de otra sede). Se registra de igual forma:
            escribe abajo los datos de la factura (<b>N° de factura</b>, <b>N° de control</b>, <b>fecha</b> y <b>base imponible</b>),
            adjunta su documento en <b>«Documento de respaldo»</b> seleccionando «Factura del proveedor», y anota en la <b>observación</b> su procedencia u origen.
            Quedará en el libro fiscal registrada como «Fuera del sistema». Si la compra sí se encuentra en el sistema, regístrala desde «Por realizar».
          </small>
        </div>
      )}

      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
        <div className="form-row" style={{ flex: '2 1 240px' }}>
          <label>{direccion === 'recibida' ? 'Agente de retención' : 'Sujeto retenido'}</label>
          {elegida ? (
            <input className="input" value={contraparte} readOnly title="Es el de la factura elegida: «Cambiar» la suelta." />
          ) : direccion === 'practicada' ? (
            <SearchSelect
              value={proveedorId}
              onChange={elegirProveedor}
              options={opcionesProveedor}
              placeholder="Buscar proveedor por nombre o RIF…"
              disabled={!!semilla.contraparteId}
            />
          ) : (
            <input className="input" value={contraparte} onChange={(e) => setContraparte(e.target.value)} placeholder="Razón social" />
          )}
        </div>
        <div className="form-row" style={{ flex: '1 1 140px' }}>
          <label>RIF</label>
          {direccion === 'practicada' || elegida ? (
            <input className="input mono" value={rif} readOnly placeholder="Se toma del proveedor elegido" />
          ) : (
            <input className="input mono" value={rif} onChange={(e) => setRif(e.target.value.toUpperCase())} placeholder="J-XXXXXXXX-X" />
          )}
          {textoRif && (
            <small className="hint" style={{ color: 'var(--warning)' }}>
              {textoRif.hint}
              {direccion === 'practicada' && proveedorId && verProveedores && <> <a href={`#${rutaFichaProveedor(proveedorId)}`}>Abrir la ficha</a></>}
            </small>
          )}
          {rifCompletado && (
            <small className="hint muted">
              Le faltaba el dígito verificador: se registra como <b className="mono">{rifCompletado}</b> (calculado).
              {direccion === 'practicada' && <> Conviene completarlo también en la ficha del proveedor.{proveedorId && verProveedores && <> <a href={`#${rutaFichaProveedor(proveedorId)}`}>Abrir la ficha</a></>}</>}
            </small>
          )}
        </div>
      </div>

      <div className="form-row">
        <label>Impuesto</label>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          {/* Con una factura ya registrada elegida, solo sus impuestos pendientes. */}
          {TIPOS_IMPUESTO.filter((t) => !precarga || precarga.impuestos.includes(t.key)).map((t) => {
            const noPuede = direccion === 'practicada' && !puedePracticar(t.key, config);
            return (
              <label key={t.key} className="card" title={noPuede ? motivoNoPuedePracticar(t.key, config) ?? '' : undefined} style={{
                margin: 0, padding: '.4rem .7rem', cursor: noPuede ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '.4rem',
                borderColor: tipo === t.key ? 'var(--primary)' : 'var(--border)', opacity: noPuede ? 0.5 : 1,
              }}>
                <input type="radio" checked={tipo === t.key} onChange={() => setTipo(t.key)} />
                <span style={{ fontWeight: 600 }}>{rotuloImpuesto(t.key)}</span>
              </label>
            );
          })}
        </div>
      </div>

      {direccion === 'practicada' && tipo !== 'iva' && tipo !== 'igtf' && (
        <>
          {tipo === 'islr' && (
            <div className="form-row">
              <label>¿A quién se le retiene?</label>
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <select className="select" style={{ flex: '1 1 240px' }} value={sujeto} onChange={(e) => setSujeto(e.target.value as SujetoRetenido)}>
                  {SUJETOS.filter((s) => s.key !== 'todos').map((s) => <option key={s.key} value={s.key}>{rotuloSujeto(s.key)}</option>)}
                </select>
                {(() => { const sug = sugerirSujetoPorRif(rif); return sug ? (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSujeto(sug.sujeto)}
                    title={`Según el RIF: ${rotuloSujeto(sug.sujeto)}`}>Sugerir por el RIF</button>
                ) : null; })()}
              </div>
              <small className="hint muted">El porcentaje del ISLR cambia según el sujeto: no es lo mismo una persona natural que una empresa. La letra del RIF sugiere el sujeto; verifícalo antes de registrar.</small>
            </div>
          )}
          <div className="form-row">
            <label>{tipo === 'islr' ? 'Concepto del ISLR: qué se le paga al proveedor' : 'Actividad económica del proveedor (ordenanza)'}</label>
            <select className="select" value={conceptoId} onChange={(e) => setConceptoId(e.target.value)}>
              {!conceptosDelTipo.length && <option value="">— sin conceptos activos para este caso —</option>}
              {conceptosDelTipo.map((c) => (
                <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} · ` : ''}{c.nombre} — {c.porcentaje}%</option>
              ))}
            </select>
            <small className="hint muted">
              {tipo === 'islr'
                ? 'Por ejemplo: honorarios, servicios, fletes, arrendamiento. Define el % que se retiene.'
                : 'La actividad por la que el proveedor factura. Define la alícuota que se retiene.'}
              {concepto?.fundamento ? ` ${concepto.fundamento}` : ''}
            </small>
          </div>
        </>
      )}

      {direccion === 'practicada' && tipo === 'iva' && (
        <SupuestosIvaAcordeon
          motivos={motivos as Record<string, boolean | undefined>}
          supuestosIva={supuestosIva}
          pctGeneral={config.pctIvaGeneral}
          pctActual={supuesto?.pct ?? calculo.porcentaje}
          onChange={(codigo, valor) => setMotivos((prev) => ({ ...prev, [codigo]: valor } as MotivosIvaCien))}
        />
      )}

      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
        <div className="form-row" style={{ flex: '1 1 140px' }}>
          <label>N° de factura</label>
          {conR10 && (direccion === 'practicada' || elegida) ? (
            <BuscadorFactura valor={facturaNumero} onTexto={setFacturaNumero} proveedorId={proveedorId || null}
              onElegir={elegirFactura} elegida={elegida} onSoltar={() => setElegida(null)} />
          ) : (
            <input className="input mono" value={facturaNumero} onChange={(e) => setFacturaNumero(e.target.value)} placeholder="Número fiscal (no el código de la OC)" />
          )}
          {elegida && <small className="hint muted">Factura ya registrada: retienes sobre ella y sus datos quedan como están. «Cambiar» la suelta.</small>}
        </div>
        <div className="form-row" style={{ flex: '1 1 130px' }}>
          <label>N° de control</label>
          <input className="input mono" value={facturaControl} readOnly={!!elegida} onChange={(e) => setFacturaControl(e.target.value)} />
        </div>
        <div className="form-row" style={{ flex: '1 1 150px' }}>
          <label>Fecha de la factura</label>
          <input className="input" type="date" value={facturaFecha} readOnly={!!elegida} onChange={(e) => setFacturaFecha(e.target.value)} />
          <small className="hint muted">Define el período{tipo === 'iva' ? ' y la quincena' : ''} y la tasa.</small>
        </div>
        <div className="form-row" style={{ flex: '1 1 150px' }}>
          <label>Fecha de la retención</label>
          <input className="input" type="date" value={fechaRetencion} onChange={(e) => setFechaRetencion(e.target.value)} />
          <small className="hint muted">Emisión del comprobante. No cambia el período.</small>
        </div>
      </div>

      {periodoCerrado && (
        <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', margin: '.3rem 0', padding: '.5rem .8rem', width: '100%' }}>
          <strong>🔒 Período Fiscal Cerrado ({nombrePeriodo(periodoCerrado)})</strong>
          <p style={{ margin: '.2rem 0 0', fontSize: '.8rem' }}>
            Este período ya fue declarado y enterado ante el SENIAT el {periodoCerrado.declaradoEn?.slice(0, 10)}.
            Para registrar retenciones en este lapso, el administrador debe reabrir el período con justificación en la pestaña de Períodos, o registrar la operación en el período corriente.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
        <div className="form-row" style={{ flex: '0 1 110px' }}>
          <label>Moneda de la factura</label>
          <select className="select" value={moneda} disabled={!!elegida} onChange={(e) => setMoneda(e.target.value)}>
            <option value="Bs">Bs</option>
            <option value="USD">$</option>
          </select>
        </div>
        {moneda !== 'Bs' && (
          <div className="form-row" style={{ flex: '0 1 150px' }}>
            <label>Tasa BCV (Bs por $)</label>
            {/* Se toma sola del sistema; solo se escribe si no hay tasa registrada de ese día. */}
            <input className="input mono" value={tasaStr} onChange={(e) => setTasaStr(e.target.value)} inputMode="decimal"
              readOnly={tasaDeFactura != null || !facturaFecha || tasaBcv?.tasa != null} placeholder={facturaFecha ? 'Bs por cada $' : 'Automática'} />
            <small className="hint muted">{tasaDeFactura != null ? 'La tasa con que se registró la factura.' : tasaBcv?.nota ?? 'Para el equivalente en Bs, que es como se declara.'}</small>
          </div>
        )}
        {esManual ? (
          <div className="form-row" style={{ flex: '1 1 170px' }}>
            <label>N° del comprobante</label>
            <input className="input mono" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Según el comprobante recibido" />
            <small className="hint muted">El número que le dio el agente de retención. Escríbelo tal como figura en el comprobante.</small>
          </div>
        ) : tipo !== 'igtf' ? (
          <div className="form-row" style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>N° comprobante (correlativo)</span>
              <span className="badge" style={{ fontSize: '.68rem', padding: '1px 5px', background: 'var(--brand, #ff8a00)', color: '#000', fontWeight: 700 }}>
                AUTOMÁTICO
              </span>
            </label>
            <div
              className="input mono"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'var(--surface-sunken)',
                fontWeight: 700,
                color: 'var(--brand, #ff8a00)',
                letterSpacing: '.02em',
              }}
              title={correlativoEstimado?.explicacion || 'Correlativo asignado según el impuesto'}
            >
              <span>{correlativoEstimado?.comprobante || 'Asignando…'}</span>
              <small className="muted" style={{ fontWeight: 400, fontSize: '.75rem' }}>
                {correlativoEstimado ? `#${correlativoEstimado.numero}` : ''}
              </small>
            </div>
            <small className="hint muted">
              {correlativoEstimado?.explicacion || `Correlativo asignado para ${rotuloImpuesto(tipo)}.`}
            </small>
          </div>
        ) : null}
        <div className="form-row" style={{ flex: '1 1 150px' }}>
          <label>Base imponible</label>
          <input className="input mono" value={baseStr} onChange={(e) => setBaseStr(e.target.value)} inputMode="decimal" />
          {tipo !== 'iva' && <small className="hint muted">El monto de la factura sin IVA, sobre el que se calcula la retención.</small>}
        </div>
        {tipo === 'iva' && (
          <div className="form-row" style={{ flex: '1 1 130px' }}>
            <label>Monto del IVA de la factura</label>
            <input className="input mono" value={ivaStr} onChange={(e) => setIvaStr(e.target.value)} inputMode="decimal" />
            {(() => {
              // El monto en dinero, no el %: se sugiere el 16 % de la base (alícuota general) para comparar.
              const sugerido = Math.round(nDec(baseStr) * 16) / 100;
              if (!(sugerido > 0)) return <small className="hint muted">En dinero, no el %.</small>;
              const pareceElPct = nDec(ivaStr) > 0 && nDec(ivaStr) <= 100 && Math.abs(nDec(ivaStr) - sugerido) > 1;
              return (
                <small className="hint" style={{ color: pareceElPct ? 'var(--warning)' : undefined }}>
                  {pareceElPct ? '¿Escribiste el %? Va el monto. ' : 'En dinero, no el %. '}
                  16 % de la base = <b className="mono">{monto(sugerido, moneda)}</b>{' '}
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setIvaStr(numeroATexto(sugerido))}>Usar</button>
                </small>
              );
            })()}
          </div>
        )}
        {esManual && (
          <>
            <div className="form-row" style={{ flex: '0 1 110px' }}>
              <label>% retenido</label>
              <input className="input mono" value={pctStr} onChange={(e) => setPctStr(e.target.value)} inputMode="decimal" />
            </div>
            <div className="form-row" style={{ flex: '1 1 150px' }}>
              <label>Monto retenido</label>
              <input className="input mono" value={montoStr} onChange={(e) => setMontoStr(e.target.value)} inputMode="decimal"
                placeholder={String(Math.round(nDec(baseStr) * nDec(pctStr)) / 100)} />
              <small className="hint muted">Vacío: se toma base × %.</small>
            </div>
          </>
        )}
      </div>

      <div className="form-row">
        {esManual ? (
          <>
            <label>Comprobante de retención recibido (PDF o imagen, si lo tienes)</label>
            <small className="hint muted">El comprobante que entregó quien practicó la retención.</small>
          </>
        ) : (
          <>
            <label>Documento de respaldo (PDF o imagen, si lo tienes)</label>
            <select
              className="select"
              value={tipoArchivo}
              onChange={(e) => {
                const val = e.target.value;
                setTipoArchivo(val);
                if (val !== 'Otro documento') setOtroDetalle('');
              }}
              style={{ marginBottom: '.3rem' }}
            >
              <option value="">— ¿Qué documento es? —</option>
              {TIPOS_RESPALDO.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {tipoArchivo === 'Otro documento' && (
              <div style={{ margin: '.3rem 0 .5rem', padding: '.5rem .6rem', background: 'rgba(255, 170, 0, 0.08)', border: '1px solid var(--primary)', borderRadius: '6px' }}>
                <label style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--primary)', display: 'block', marginBottom: '.25rem' }}>
                  Describe qué documento es (obligatorio para auditoría)
                </label>
                <input
                  className="input"
                  type="text"
                  value={otroDetalle}
                  onChange={(e) => setOtroDetalle(e.target.value)}
                  placeholder="Ej.: Contrato de comodato, Recibo de caja chica, Finiquito..."
                  autoFocus
                />
                <small className="hint muted" style={{ display: 'block', marginTop: '.2rem' }}>
                  Describe claramente el documento para que conste en auditorías y en el expediente fiscal.
                </small>
              </div>
            )}
            <small className="hint muted">El comprobante de retención lo genera el sistema al registrar. Aquí se adjunta la factura u otro respaldo.</small>
          </>
        )}
        <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
        {archivo && <small className="muted">{archivo.name}</small>}
      </div>

      {esCero ? (
        <div className="lfv8-motivo-0">
          <label htmlFor="lf-motivo-0">Motivo del 0 %: ¿por qué no se retiene? (obligatorio)</label>
          {motivosNa.length > 0 && (
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.4rem' }}>
              <select className="select" style={{ flex: '1 1 240px' }} value={motivoNaId} onChange={(e) => elegirMotivoNa(e.target.value, '')}>
                <option value="">Elegir un motivo de la lista…</option>
                {motivosNa.map((m) => <option key={m.id} value={m.id}>{m.texto}</option>)}
              </select>
              {motivoNa?.requiereTexto && (
                <input className="input" style={{ flex: '1 1 240px' }} placeholder="Detalle (obligatorio para este motivo)"
                  value={motivoNaDetalle} onChange={(e) => elegirMotivoNa(motivoNaId, e.target.value)} />
              )}
            </div>
          )}
          <textarea id="lf-motivo-0" className="input" value={observacion} onChange={(e) => { setMotivoNaId(''); setObservacion(e.target.value); }}
            placeholder={motivosNa.length ? 'O escríbelo aquí' : 'Ej.: el pago no supera el mínimo exento del ISLR'} />
          {ceroSinMotivo && <small className="hint" style={{ color: 'var(--warning)' }}>{validarMotivoCero(pctFinal, montoFinal, observacion, tipo).mensaje}</small>}
        </div>
      ) : (
        <div className="form-row">
          <label>{sinDocumento ? 'Observación: ¿de dónde viene? (obligatoria)' : 'Observación'}</label>
          <input className="input" value={observacion} onChange={(e) => setObservacion(e.target.value)}
            placeholder={sinDocumento ? 'Ej.: compra pagada por caja chica, factura fuera del sistema' : undefined} />
        </div>
      )}

      {/* El resultado, con la cuenta a la vista */}
      <div className="card" style={{ borderColor: montoFinal > 0 ? 'var(--primary)' : 'var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <div>
            <div className="muted" style={{ fontSize: '.72rem' }}>
              {direccion === 'recibida' ? 'Retención recibida' : 'Monto a retener'}{moneda !== 'Bs' ? ' · en Bs, que es lo que se declara y se entera al SENIAT' : ''}
            </div>
            {/* Ante el fisco la retención va en bolívares: con factura en $, el monto principal es el convertido. */}
            <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--primary)' }}>
              {moneda === 'Bs' ? monto(montoFinal, moneda) : (montoBs > 0 ? monto(montoBs, 'Bs') : 'Falta la tasa')}
            </div>
            {moneda !== 'Bs' && (
              <div className="muted mono" style={{ fontSize: '.78rem' }}>
                = {monto(montoFinal, moneda)} en la moneda de la factura{tasa > 0 ? ` × ${tasaStr} Bs/$` : ''}
              </div>
            )}
            {moneda === 'Bs' && (
              <div className="muted mono" style={{ fontSize: '.78rem' }}>
                {equivalenteUsd != null
                  ? `≈ ${monto(equivalenteUsd, 'USD')} · ${tasaBcv?.nota ?? ''} Solo informativo.`
                  : (tasaBcv?.nota ?? 'Sin tasa BCV: sin equivalente en $.')}
              </div>
            )}
          </div>
          <div className="muted mono" style={{ fontSize: '.78rem', textAlign: 'right' }}>
            {(() => {
              // Con factura en $, cada cifra lleva al lado su equivalente en Bs.
              const enBs = (v: number) => (moneda !== 'Bs' && tasa > 0 ? ` · ${monto(enBolivares(v, moneda, tasa), 'Bs')}` : '');
              const base = esManual ? nDec(baseStr) : calculo.baseImponible;
              return (<>
                <div>Base {monto(base, moneda)}{enBs(base)}</div>
                {!esManual && calculo.impuesto > 0 && <div>Impuesto {monto(calculo.impuesto, moneda)}{enBs(calculo.impuesto)}</div>}
              </>);
            })()}
            <div>Retención {pctFinal}%</div>
            {!esManual && calculo.sustraendo > 0 && <div>Sustraendo −{monto(calculo.sustraendo, moneda)}</div>}
          </div>
        </div>
        <p className="muted" style={{ margin: '.4rem 0 0', fontSize: '.8rem' }}>
          {esManual ? significadoRetencion(tipo, direccion) : calculo.explicacion}
        </p>
        {montosIlegibles.length > 0 && (
          <p style={{ margin: '.3rem 0 0', fontSize: '.8rem', color: 'var(--warning)' }}>
            No se entiende {montosIlegibles.join(', ')}: el cálculo no los toma. Escribe 1.234,56 o 1234,56.
          </p>
        )}
      </div>
      <div className="hint muted" style={{ fontSize: '.74rem' }}>
        {direccion === 'practicada' && tipo !== 'igtf'
          ? `Al registrar, la base le asigna el número de comprobante: ${rotuloSerie(!conV2R || tipo === 'iva' ? 'AAAAMM8' : 'N10').toLowerCase()}. El número no se reusa.${facturaFecha ? ` Entregar el comprobante hasta el ${fechaCorta(limiteEntregaComprobante(facturaFecha))}.` : ''}`
          : 'Queda en el libro fiscal del período, con su comprobante imprimible.'}
      </div>
      </div>
    </Modal>
    {dialogo}
    </>
  );
}

/* ═══════════════════ Parámetros fiscales ═══════════════════ */

type SeccionPa = 'motivos' | 'entes' | 'perfiles' | 'licencias' | 'empresa' | 'firma' | 'vencimientos'
  | 'impuestos' | 'valores' | 'supuestos' | 'numeracion' | 'regimen' | 'formatos' | 'interruptores';
interface DefSeccionPa { key: SeccionPa; capa: 'ajustes' | 'avanzados'; titulo: string; linea: string; que: string; ingresa: string; efecto: string; noCambia: string; }

const AJUSTES_PA: DefSeccionPa[] = [
  { key: 'motivos', capa: 'ajustes', titulo: 'Motivos de «No aplica»', linea: 'Las razones para marcar que una factura no lleva retención.',
    que: 'Las razones que se eligen al marcar que una factura no lleva retención.', ingresa: 'El texto del motivo y el impuesto en que se ofrece (o todos).',
    efecto: 'Se ofrecen al registrar una retención en 0 %, según el impuesto y la fecha de la factura.', noCambia: 'Lo ya registrado conserva el texto de su motivo, aunque el motivo se edite o se desactive.' },
  { key: 'entes', capa: 'ajustes', titulo: 'Entes y logos', linea: 'Quién recibe cada retención y el logo de su comprobante.',
    que: 'Los organismos que reciben cada retención y su logo en el comprobante.', ingresa: 'El nombre del ente, su logo y qué impuestos lo usan.',
    efecto: 'El comprobante de cada impuesto lleva el logo de su ente.', noCambia: 'Los comprobantes emitidos conservan el logo de su emisión.' },
  { key: 'perfiles', capa: 'ajustes', titulo: 'Perfiles fiscales de proveedores', linea: 'Tipo de contribuyente, persona, actividades y licencia de cada proveedor.',
    que: 'Los datos fiscales de cada proveedor que deciden qué se le retiene.', ingresa: 'Tipo de contribuyente, tipo de persona, residencia, actividades económicas y licencia.',
    efecto: 'Con estos datos se propone si cada retención aplica en las facturas pendientes.', noCambia: 'Las retenciones registradas y sus comprobantes conservan los datos con que se emitieron.' },
  { key: 'licencias', capa: 'ajustes', titulo: 'Tipos de licencia', linea: 'Los tipos de licencia de actividad económica que se eligen en el perfil.',
    que: 'Los tipos de licencia de actividad económica que se eligen en el perfil fiscal de cada proveedor.', ingresa: 'El nombre del tipo.',
    efecto: 'Son las opciones del tipo de licencia en el perfil fiscal de cada proveedor.', noCambia: 'Un perfil que ya tiene un tipo lo conserva, aunque el tipo se desactive.' },
  { key: 'empresa', capa: 'ajustes', titulo: 'Datos de la empresa', linea: 'Los datos del agente de retención que van en cada comprobante.',
    que: 'Los datos de la empresa que se imprimen en cada comprobante como agente de retención.', ingresa: 'Razón social, RIF, dirección fiscal, municipio, alícuota ISAE y timbre estadal.',
    efecto: 'Los comprobantes nuevos llevan estos datos.', noCambia: 'Los emitidos conservan los datos de su emisión. El régimen fiscal está en Ajustes avanzados.' },
  { key: 'firma', capa: 'ajustes', titulo: 'Firma y sello', linea: 'La firma, el sello y el logo de la empresa en los comprobantes.',
    que: 'Las imágenes de la empresa que van en cada comprobante: logo, firma (con su firmante) y sello.', ingresa: 'Una imagen PNG o JPG de hasta 1 MB, vigente desde una fecha.',
    efecto: 'Los comprobantes nuevos llevan la versión vigente a su fecha de emisión. Sin imagen, el recuadro queda en blanco para firmar a mano.', noCambia: 'Los comprobantes emitidos conservan la versión con que salieron.' },
  { key: 'vencimientos', capa: 'ajustes', titulo: 'Avisos de vencimiento', linea: 'Cuándo avisar de licencias, declaraciones y actividades que vencen.',
    que: 'Los avisos de lo que vence: licencias, declaraciones y actividades con fecha «hasta».', ingresa: 'Con cuántos días de anticipación se avisa y si los avisos están encendidos.',
    efecto: 'Cambia la lista de vencimientos de la cabecera y los avisos del registro.', noCambia: 'Ninguna fecha ni ningún monto: solo cuándo se avisa.' },
];
const AVANZADOS_PA: DefSeccionPa[] = [
  { key: 'impuestos', capa: 'avanzados', titulo: 'Impuestos y reglas', linea: 'Conceptos del ISLR: porcentaje por sujeto y si están activos.',
    que: 'El catálogo de conceptos del ISLR (Decreto 1.808).', ingresa: 'El porcentaje de cada concepto por sujeto y si está activo.',
    efecto: 'Cambia cuánto se retiene de ISLR en los registros nuevos.', noCambia: 'Lo ya registrado conserva su porcentaje y su monto.' },
  { key: 'valores', capa: 'avanzados', titulo: 'Valores', linea: 'Unidad Tributaria y porcentaje del IGTF.',
    que: 'Los valores que usan los cálculos: la Unidad Tributaria y el porcentaje del IGTF.', ingresa: 'El valor vigente. Todavía no guarda historial: el nuevo reemplaza al anterior.',
    efecto: 'Los registros nuevos se calculan con el valor guardado.', noCambia: 'Lo ya registrado conserva su monto.' },
  { key: 'supuestos', capa: 'avanzados', titulo: 'Supuestos del %', linea: 'Los casos que cambian el porcentaje retenido (el 100 % del IVA).',
    que: 'Los supuestos que llevan la retención a otro porcentaje, por impuesto y con vigencia.', ingresa: 'El texto del supuesto, el % que impone, desde cuándo rige y su fuente.',
    efecto: 'Al registrar, se ofrecen los supuestos vigentes a la fecha de la factura.', noCambia: 'Lo ya registrado conserva el texto del supuesto con que se retuvo.' },
  { key: 'numeracion', capa: 'avanzados', titulo: 'Períodos y numeración', linea: 'Periodicidad, series de comprobantes y paso inicial de cada impuesto.',
    que: 'Cómo se agrupan las retenciones para declarar y cómo se numeran los comprobantes.', ingresa: 'Periodicidad, quién numera la serie, período en curso y último número del otro sistema.',
    efecto: 'Cambia los períodos por declarar y el número que se propone al registrar.', noCambia: 'Nunca se cambia dentro de un período declarado. Un número usado no se repite.' },
  { key: 'regimen', capa: 'avanzados', titulo: 'Régimen fiscal de la empresa', linea: 'Agente de retención de IVA, contribuyente especial y % de retención del IVA.',
    que: 'Las condiciones de la empresa ante el SENIAT.', ingresa: 'Si es agente de retención de IVA, si es contribuyente especial y los porcentajes de retención del IVA (75 y 100).',
    efecto: '«Agente de retención de IVA» decide si se propone la retención de IVA. «Contribuyente especial» habilita el IGTF.', noCambia: 'Lo ya registrado. Todavía no guarda la fecha ni el historial del cambio.' },
  { key: 'formatos', capa: 'avanzados', titulo: 'Formatos de impresión', linea: 'Textos, rótulos y columnas del comprobante de cada impuesto, por fecha.',
    que: 'Cómo se imprime el comprobante de cada impuesto: encabezado, nota legal, pie, rótulos, columnas y orientación.', ingresa: 'Una versión con su fecha «desde» y su motivo; o la vuelta al diseño de fábrica.',
    efecto: 'El comprobante usa la versión vigente a su fecha de emisión.', noCambia: 'Los datos de las retenciones: solo cambia cómo se imprimen.' },
  { key: 'interruptores', capa: 'avanzados', titulo: 'Interruptores de reglas', linea: 'Reglas del módulo que se encienden o se apagan sin programar.',
    que: 'Reglas del módulo que se encienden o se apagan sin programar.', ingresa: 'El valor de cada interruptor. Cada cambio pide confirmación.',
    efecto: 'Se aplica al momento en las propuestas y en el registro.', noCambia: 'Las retenciones registradas.' },
];
/** Solo se muestran las secciones que guardan en la base; las demás vuelven cuando exista su tabla (R1, R2, R3, R6). */
const CONECTADAS_PA = new Set<SeccionPa>(['empresa', 'licencias', 'impuestos', 'valores', 'regimen']);
/** Las de R1 y R6 aparecen solas cuando sus tablas existen en la base. */
const CONECTADAS_R1 = new Set<SeccionPa>(['entes', 'firma', 'perfiles']);
const CONECTADAS_R6 = new Set<SeccionPa>(['motivos', 'supuestos']);
/** R8: los formatos de impresión, cuando su tabla existe. */
const CONECTADAS_R8 = new Set<SeccionPa>(['formatos']);
const TODAS_PA: Record<SeccionPa, DefSeccionPa> = Object.fromEntries([...AJUSTES_PA, ...AVANZADOS_PA].map((s) => [s.key, s])) as Record<SeccionPa, DefSeccionPa>;
const DEF_VALORES_R3: DefSeccionPa = {
  key: 'valores', capa: 'avanzados', titulo: 'Valores con vigencia', linea: 'UT, % de IVA, alícuotas de IGTF, ISAE y estadal, cada uno con su fecha «desde».',
  que: 'Los valores que usan los cálculos: Unidad Tributaria, % de retención del IVA (general y art. 5) y alícuotas.',
  ingresa: 'Un valor nuevo con su fecha «desde», su fuente y el motivo. El anterior se conserva.',
  efecto: 'Cada retención se calcula con el valor vigente a la fecha de su factura.',
  noCambia: 'Lo ya registrado: cada retención guarda la UT con que se calculó.',
};
const AVISO_AVANZADOS ='Estos cambios afectan cálculos, números o fechas de declaración. Lo ya emitido no cambia.';

export function ConfiguracionFiscalModal({ puedeEditar, onClose }: { puedeEditar: boolean; onClose: () => void }) {
  const [cfg, setCfg] = useState<ConfigRetencion>(CONFIG_RETENCION_DEFECTO);
  const [locales, setLocales] = useState<AlicuotasLocales>({ municipal: 0, estadal: 0 });
  const [conceptos, setConceptos] = useState<ConceptoRetencion[]>([]);
  const [capa, setCapa] = useState<'inicio' | 'avanzados'>('inicio');
  const [seccion, setSeccion] = useState<SeccionPa | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // D41: los montos de Parámetros sin R3 que no se entienden (o quedan vacíos) frenan el guardado.
  const [ilegiblesPa, setIlegiblesPa] = useState<Record<string, boolean>>({});
  const marcarPa = (campo: string, n: number | null, aplicar: (n: number) => void) => {
    setIlegiblesPa((m) => ({ ...m, [campo]: n == null }));
    if (n != null) aplicar(n);
  };
  const [r1, setR1] = useState(false);
  const [r2, setR2] = useState(false);
  const [r3, setR3] = useState(false);
  const [r6, setR6] = useState(false);
  const [r8, setR8] = useState(false);
  useEffect(() => {
    void r8Disponible().then(setR8).catch(() => setR8(false));
    void r1Disponible().then(setR1).catch(() => setR1(false));
    void r2Disponible().then(setR2).catch(() => setR2(false));
    void r3Disponible().then(setR3).catch(() => setR3(false));
    void r6Disponible().then(setR6).catch(() => setR6(false));
  }, []);
  const visible = (s: DefSeccionPa) => CONECTADAS_PA.has(s.key) || (r1 && CONECTADAS_R1.has(s.key)) || (r6 && CONECTADAS_R6.has(s.key)) || (r8 && CONECTADAS_R8.has(s.key));
  const AJUSTES_VIS = AJUSTES_PA.filter(visible);
  const AVANZADOS_VIS = AVANZADOS_PA.filter(visible);

  const { marcarSucio, pedirCierre, dialogo } = useDescartar(onClose, saving);

  const recargar = useCallback(async () => {
    const [c, l, cs] = await Promise.all([getConfigRetencion(), getAlicuotasLocales(), listConceptos(false)]);
    setCfg(c); setLocales(l); setConceptos(cs);
  }, []);
  useEffect(() => {
    void recargar().catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron leer los parámetros.'));
  }, [recargar]);

  const set = <K extends keyof ConfigRetencion>(k: K, v: ConfigRetencion[K]) => setCfg((p) => ({ ...p, [k]: v }));
  const soloLectura = !puedeEditar;

  async function guardar() {
    const malos = Object.entries(ilegiblesPa).filter(([, mal]) => mal).map(([campo]) => campo);
    if (malos.length) { setError(`No se entiende ${malos.join(', ')}: escribe 1.234,56 o 1234,56.`); return; }
    // D41, Lote 2: el RIF de la empresa se valida como cualquier RIF; los valores sin R3, con su rango.
    const rifEmpresa = rifEmpresaParaGuardar(cfg.rif);
    if (rifEmpresa.error) { setError(rifEmpresa.error); return; }
    if (!r3) {
      const falta = faltaEnValoresSinR3({ valorUt: cfg.valorUt, pctIgtf: cfg.pctIgtf, municipal: locales.municipal, estadal: locales.estadal });
      if (falta) { setError(falta); return; }
    }
    setSaving(true); setError(null);
    try {
      await guardarConfigRetencion({ ...cfg, rif: rifEmpresa.rif || cfg.rif }, locales, { conservarRegimen: r1, conservarParametros: r3 });
      try { localStorage.setItem('retenciones:imprimirOriginalYCopia', String(cfg.imprimirOriginalYCopia !== false)); } catch {}
      toast('Parámetros fiscales guardados', 'success');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
      setSaving(false);
    }
  }

  function volver() {
    if (seccion) { setCapa(TODAS_PA[seccion].capa === 'avanzados' ? 'avanzados' : 'inicio'); setSeccion(null); }
    else if (capa === 'avanzados') { setCapa('inicio'); }
  }

  function resumen(k: SeccionPa): string {
    switch (k) {
      case 'empresa': return cfg.rif ? `RIF ${cfg.rif} · ${cfg.imprimirOriginalYCopia !== false ? 'Original y Copia' : 'Solo Original'}` : 'Sin configurar';
      case 'regimen': return `Agente IVA: ${cfg.esAgenteRetencionIva ? 'sí' : 'no'} · Especial: ${cfg.esContribuyenteEspecial ? 'sí' : 'no'}`;
      case 'valores': return `UT Bs ${cfg.valorUt} · IGTF ${cfg.pctIgtf} %`;
      case 'impuestos': return r2 ? 'Ficha de cada impuesto y conceptos del ISLR' : `${conceptos.length} conceptos`;
      default: return '';
    }
  }

  const capaActual = seccion ? TODAS_PA[seccion].capa : capa;
  const tituloModal = capaActual === 'avanzados' ? '⚙ Parámetros · Ajustes avanzados' : '⚙ Parámetros de retenciones';
  // Con R1 y R3, Régimen y Valores guardan desde sus propias pantallas (con fecha), no con el botón general.
  const seccionGuardable = seccion === 'empresa' || (seccion === 'regimen' && !(r1 && r3)) || (seccion === 'valores' && !r3);

  return (
    <>
    <Modal title={tituloModal} size="xl" onClose={pedirCierre}
      footer={
        <>
          <span className="hint muted" style={{ fontSize: '.78rem', marginRight: 'auto' }}>
            {capaActual === 'avanzados' ? 'Edición: administración, o escritura en Retenciones (las dos capas).' : 'Edición: administración, o escritura en Retenciones.'}
          </span>
          <button type="button" className="btn btn-ghost" onClick={pedirCierre} disabled={saving}>Cerrar</button>
          {seccionGuardable && puedeEditar && (
            <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
          )}
        </>
      }>
      <div onChange={marcarSucio}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

      {/* ── Pantalla de inicio: grilla de tarjetas ── */}
      {!seccion && capa === 'inicio' && (
        <>
          <h4 className="lfv8-pa-capa-t">Ajustes</h4>
          <p className="lfv8-pa-capa-d">Mantenimiento de todos los días. No cambian cuánto se retiene, cómo se numera ni cuándo se declara.</p>
          <div className="lfv8-pa-grid">
            {AJUSTES_VIS.map((s) => (
              <button key={s.key} type="button" className="lfv8-pa-btn" onClick={() => setSeccion(s.key)}>
                <span className="lfv8-pa-t">{s.titulo}</span>
                <span className="lfv8-pa-d">{s.linea}</span>
                <span className="lfv8-pa-r">{resumen(s.key)}</span>
              </button>
            ))}
          </div>
          <button type="button" className="lfv8-pa-avanzados" onClick={() => setCapa('avanzados')}>
            <span className="lfv8-pa-t">Ajustes avanzados</span>
            <span className="lfv8-pa-d">{AVANZADOS_VIS.map((s) => s.titulo).join(', ')}.</span>
            <span className="lfv8-pa-r">Cambian cálculos, números o fechas de declaración · {AVANZADOS_VIS.length} secciones</span>
          </button>
        </>
      )}

      {/* ── Capa avanzados: grilla de tarjetas ── */}
      {!seccion && capa === 'avanzados' && (
        <>
          <button type="button" className="lfv8-pa-volver" onClick={volver}>← Parámetros</button>
          <div className="lfv8-pa-aviso"><strong>Ajustes avanzados.</strong> {AVISO_AVANZADOS}</div>
          <div className="lfv8-pa-grid">
            {AVANZADOS_VIS.map((s) => (
              <button key={s.key} type="button" className="lfv8-pa-btn" onClick={() => setSeccion(s.key)}>
                <span className="lfv8-pa-t">{s.titulo}</span>
                <span className="lfv8-pa-d">{s.linea}</span>
                <span className="lfv8-pa-r">{resumen(s.key)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── Detalle de sección ── */}
      {seccion && (() => {
        const def = seccion === 'valores' && r3 ? DEF_VALORES_R3 : TODAS_PA[seccion];
        return (
        <>
          <button type="button" className="lfv8-pa-volver" onClick={volver}>
            {def.capa === 'avanzados' ? '← Ajustes avanzados' : '← Parámetros'}
          </button>
          {def.capa === 'avanzados' && <div className="lfv8-pa-aviso" style={{ marginTop: '.4rem' }}>{AVISO_AVANZADOS}</div>}
          <h4 className="lfv8-pa-sec-t">{def.titulo}</h4>
          <dl className="lfv8-pa-que">
            <dt>Qué es</dt><dd>{def.que}</dd>
            <dt>Qué se ingresa</dt><dd>{def.ingresa}</dd>
            <dt>Qué efecto tiene</dt><dd>{def.efecto}</dd>
            <dt>Qué no cambia</dt><dd>{def.noCambia}</dd>
          </dl>
          {soloLectura && (
            <div className="hint muted" style={{ marginBottom: '.6rem', fontSize: '.82rem' }}>
              Para cambiar los parámetros fiscales hace falta permiso de escritura en Retenciones.
            </div>
          )}

          {/* ── Empresa ── */}
          {seccion === 'empresa' && (
            <fieldset disabled={soloLectura} style={{ border: 0, padding: 0, margin: 0 }}>
              <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
                <div className="form-row" style={{ flex: '1 1 220px' }}>
                  <label>Razón social</label>
                  <input className="input" value={cfg.razonSocial ?? ''} onChange={(e) => set('razonSocial', e.target.value)} />
                </div>
                <div className="form-row" style={{ flex: '1 1 150px' }}>
                  <label>RIF</label>
                  <input className="input mono" value={cfg.rif ?? ''} onChange={(e) => set('rif', e.target.value)} placeholder="J-XXXXXXXX-X" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
                <div className="form-row" style={{ flex: '1 1 260px' }}>
                  <label>Dirección fiscal</label>
                  <input className="input" value={cfg.direccionFiscal ?? ''} onChange={(e) => set('direccionFiscal', e.target.value)} />
                </div>
                <div className="form-row" style={{ flex: '1 1 200px' }}>
                  <label>Correo electrónico institucional</label>
                  <input
                    type="email"
                    className="input"
                    value={cfg.email ?? ''}
                    onChange={(e) => set('email', e.target.value)}
                    placeholder="info@goldentouch1127.com"
                  />
                  <small className="hint muted">Se imprime en los comprobantes fiscales de retención.</small>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
                <div className="form-row" style={{ flex: '1 1 180px' }}>
                  <label>Municipio</label>
                  <input className="input" value={cfg.municipio ?? ''} onChange={(e) => set('municipio', e.target.value)} />
                  <small className="hint muted">Define qué ordenanza de ISAE aplica.</small>
                </div>
                <div className="form-row" style={{ flex: '1 1 180px' }}>
                  <label>N° Licencia Municipal / RIM</label>
                  <input className="input" value={cfg.licenciaMunicipal ?? ''} onChange={(e) => set('licenciaMunicipal', e.target.value)} placeholder="Ej. 123456 / RIM-001" />
                  <small className="hint muted">Requerido en comprobantes de retención ISAE.</small>
                </div>
                {!r3 && (<>
                <div className="form-row" style={{ flex: '1 1 140px' }}>
                  <label>Alícuota municipal (ISAE, %)</label>
                  <CampoMonto valor={locales.municipal} decimales={2} onValor={(n) => marcarPa('la alícuota municipal', n, (v) => setLocales((l) => ({ ...l, municipal: v })))} />
                </div>
                <div className="form-row" style={{ flex: '1 1 140px' }}>
                  <label>Alícuota estadal (timbre fiscal, %)</label>
                  <CampoMonto valor={locales.estadal} decimales={2} onValor={(n) => marcarPa('el timbre estadal', n, (v) => setLocales((l) => ({ ...l, estadal: v })))} />
                </div>
                </>)}
              </div>

              {/* D52: Emisión opcional de Original y Copia configurable en Parámetros */}
              <div className="card" style={{ marginTop: '.8rem', background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                <strong style={{ display: 'block', marginBottom: '.35rem', fontSize: '.88rem' }}>📄 Emisión de Comprobantes de Retención</strong>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.6rem', cursor: 'pointer', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={cfg.imprimirOriginalYCopia !== false}
                    onChange={(e) => set('imprimirOriginalYCopia', e.target.checked)}
                  />
                  <span>Imprimir Original y Copia (Página 1: Sujeto Retenido · Página 2: Agente de Retención)</span>
                </label>
                <p className="muted" style={{ margin: '.35rem 0 0', fontSize: '.8rem', lineHeight: 1.4 }}>
                  Cumplimiento de Providencias SENIAT (SNAT/2025/000054 IVA y Art. 24 D. 1808 ISLR). Si se desactiva, el comprobante se emitirá en una sola página (Solo Original).
                </p>
              </div>

              {r3 && <p className="hint muted" style={{ fontSize: '.82rem' }}>Las alícuotas del ISAE y del timbre estadal están en Ajustes avanzados › Valores con vigencia.</p>}
              <p className="hint muted" style={{ fontSize: '.82rem' }}>El régimen fiscal (agente de retención de IVA, contribuyente especial) está en Ajustes avanzados › Régimen fiscal de la empresa.</p>
            </fieldset>
          )}

          {/* ── Régimen fiscal ── */}
          {seccion === 'regimen' && (
            <fieldset disabled={soloLectura} style={{ border: 0, padding: 0, margin: 0 }}>
              {/* Con R1, las dos condiciones llevan fecha e historial y las escribe su propia pantalla. */}
              {r1 && <ParametrosRegimen puedeEditar={puedeEditar} />}
              <div className="card" style={{ background: 'var(--bg-2)' }}>
                {!r1 && (<>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontWeight: 600 }}>
                  <input type="checkbox" checked={cfg.esAgenteRetencionIva} onChange={(e) => set('esAgenteRetencionIva', e.target.checked)} />
                  La empresa está designada agente de retención de IVA
                </label>
                <p className="muted" style={{ margin: '.3rem 0 .6rem', fontSize: '.82rem' }}>
                  Hoy está en <strong>{cfg.esAgenteRetencionIva ? 'sí' : 'no'}</strong>. Con la casilla marcada se calcula y se registra la retención de IVA que la empresa practica.
                </p>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontWeight: 600 }}>
                  <input type="checkbox" checked={cfg.esContribuyenteEspecial} onChange={(e) => set('esContribuyenteEspecial', e.target.checked)} />
                  La empresa es contribuyente especial
                </label>
                <p className="muted" style={{ margin: '.3rem 0 .5rem', fontSize: '.82rem' }}>
                  Hoy está en <strong>{cfg.esContribuyenteEspecial ? 'sí' : 'no'}</strong>. El contribuyente especial también retiene IVA y, además, percibe el IGTF.
                </p>
                </>)}
                {r3 && <p className="muted" style={{ margin: 0, fontSize: '.82rem' }}>Los porcentajes de retención del IVA (general y art. 5) están en Ajustes avanzados › Valores con vigencia.</p>}
                {!r3 && (<>
                {r1 && <p className="muted" style={{ margin: '0 0 .5rem', fontSize: '.82rem' }}>Porcentajes de retención del IVA (se guardan con el botón Guardar):</p>}
                <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
                  <div className="form-row" style={{ flex: '1 1 140px', margin: 0 }}>
                    <label>% general</label>
                    <select className="select" value={cfg.pctIvaGeneral} onChange={(e) => set('pctIvaGeneral', Number(e.target.value))}>
                      {PORCENTAJES_IVA.map((p) => <option key={p} value={p}>{p}%</option>)}
                    </select>
                  </div>
                  <div className="form-row" style={{ flex: '1 1 200px', margin: 0 }}>
                    <label>% en los supuestos del art. 5</label>
                    <select className="select" value={cfg.pctIvaEspecial} onChange={(e) => set('pctIvaEspecial', Number(e.target.value))}>
                      {PORCENTAJES_IVA.map((p) => <option key={p} value={p}>{p}%</option>)}
                    </select>
                  </div>
                </div>
                <small className="hint muted">La retención de IVA solo admite 75 % y 100 %.</small>
                </>)}
              </div>
            </fieldset>
          )}

          {/* ── Valores con vigencia ── */}
          {seccion === 'valores' && r3 && <ParametrosValores puedeEditar={puedeEditar} />}
          {seccion === 'valores' && !r3 && (
            <fieldset disabled={soloLectura} style={{ border: 0, padding: 0, margin: 0 }}>
              <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
                <div className="form-row" style={{ flex: '1 1 180px' }}>
                  <label>Valor de la Unidad Tributaria (Bs)</label>
                  <CampoMonto valor={cfg.valorUt} decimales={2} onValor={(n) => marcarPa('el valor de la UT', n, (v) => set('valorUt', v))} />
                  <small className="hint muted">Define el <strong>sustraendo</strong> y el mínimo del ISLR de personas naturales. Sin esto, el sustraendo queda en cero.</small>
                </div>
                <div className="form-row" style={{ flex: '1 1 140px' }}>
                  <label>% de IGTF</label>
                  <CampoMonto valor={cfg.pctIgtf} decimales={2} onValor={(n) => marcarPa('el % de IGTF', n, (v) => set('pctIgtf', v))} />
                  <small className="hint muted">3% vigente; la ley admite entre 2% y 8%.</small>
                </div>
              </div>
            </fieldset>
          )}

          {/* ── Impuestos y reglas (catálogo de conceptos) ── */}
          {seccion === 'impuestos' && (() => {
            const catalogo = <CatalogoConceptos conceptos={conceptos} puedeEditar={puedeEditar} onCambio={() => void recargar().catch(() => { /* se reintenta */ })} />;
            return r2 ? <ParametrosImpuestos puedeEditar={puedeEditar} conceptosIslr={catalogo} /> : catalogo;
          })()}

          {/* ── Motivos de «No aplica» ── */}
          {r6 && seccion === 'motivos' && <ParametrosMotivos puedeEditar={puedeEditar} />}
          {r6 && seccion === 'supuestos' && <ParametrosSupuestos puedeEditar={puedeEditar} />}

          {/* ── R8: formatos de impresión ── */}
          {r8 && seccion === 'formatos' && <ParametrosFormatos puedeEditar={puedeEditar} />}

          {/* ── R1: entes y logos, firma y sello, perfiles fiscales ── */}
          {r1 && seccion === 'entes' && <ParametrosEntes puedeEditar={puedeEditar} />}
          {r1 && seccion === 'firma' && <ParametrosFirmaSello puedeEditar={puedeEditar} />}
          {r1 && seccion === 'perfiles' && <ParametrosPerfiles puedeEditar={puedeEditar} onIrALicencias={() => setSeccion('licencias')} />}

          {/* ── Tipos de licencia ── */}
          {seccion === 'licencias' && <SeccionLicencias puedeEditar={puedeEditar} />}

          {/* ── Avisos de vencimiento ── */}
          {seccion === 'vencimientos' && <SeccionVencimientos puedeEditar={puedeEditar} />}

          {/* ── Períodos y numeración ── */}
          {seccion === 'numeracion' && <SeccionNumeracion puedeEditar={puedeEditar} />}

          {/* ── Interruptores de reglas ── */}
          {seccion === 'interruptores' && <SeccionInterruptores puedeEditar={puedeEditar} />}
        </>
        );
      })()}

      </div>
    </Modal>
    {dialogo}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Secciones de Parámetros — formularios de cada tarjeta
   ═══════════════════════════════════════════════════════════════ */

function SeccionLicencias({ puedeEditar }: { puedeEditar: boolean }) {
  const [tipos, setTipos] = useState<TipoLicencia[] | null>(null);
  const [nuevo, setNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTiposLicencia().then(setTipos).catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron leer los tipos de licencia.'));
  }, []);

  // Cada cambio se guarda en la base; la lista en pantalla solo cambia si guardó.
  async function guardar(lista: TipoLicencia[], aviso: string) {
    setGuardando(true); setError(null);
    try {
      await guardarTiposLicencia(lista);
      setTipos(lista);
      toast(aviso, 'success');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
      return false;
    } finally { setGuardando(false); }
  }

  async function agregar() {
    const nombre = nuevo.trim();
    if (!nombre || !tipos) return;
    if (await guardar([...tipos, { id: crypto.randomUUID(), nombre, activo: true }], 'Tipo de licencia agregado')) setNuevo('');
  }

  if (!tipos && !error) return <p className="muted">Cargando…</p>;

  return (
    <fieldset disabled={!puedeEditar || guardando} style={{ border: 0, padding: 0, margin: 0 }}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.5rem' }}><small>{error}</small></div>}
      {tipos && tipos.length === 0 && <p className="muted" style={{ fontSize: '.84rem' }}>Todavía no hay tipos de licencia. Agrega el primero.</p>}
      <div style={{ display: 'grid', gap: '.35rem' }}>
        {(tipos ?? []).map((t) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.4rem .6rem', borderRadius: 'var(--r-md)', background: 'var(--bg-1)', opacity: t.activo ? 1 : .5 }}>
            <span style={{ flex: 1, fontSize: '.86rem' }}>{t.nombre}{!t.activo && <small className="muted"> · desactivado</small>}</span>
            {puedeEditar && (
              <button type="button" className="btn btn-sm btn-ghost"
                onClick={() => void guardar((tipos ?? []).map((x) => x.id === t.id ? { ...x, activo: !x.activo } : x), t.activo ? 'Tipo desactivado' : 'Tipo activado')}>
                {t.activo ? 'Desactivar' : 'Activar'}
              </button>
            )}
          </div>
        ))}
      </div>
      {puedeEditar && tipos && (
        <div style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem' }}>
          <input className="input" style={{ flex: 1 }} placeholder="Nuevo tipo de licencia (p. ej.: Permanente, Provisional)" value={nuevo}
            onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void agregar(); }} />
          <button type="button" className="btn" onClick={() => void agregar()} disabled={!nuevo.trim()}>Agregar</button>
        </div>
      )}
      <p className="hint muted" style={{ fontSize: '.78rem', marginTop: '.5rem' }}>Ningún tipo se borra: se desactiva y deja de ofrecerse.</p>
    </fieldset>
  );
}

function SeccionVencimientos({ puedeEditar }: { puedeEditar: boolean }) {
  const [cfg, setCfg] = useState({
    avisosActivos: true,
    diasLicencia: 30,
    diasDeclaracion: 5,
    diasActividad: 15,
  });

  return (
    <fieldset disabled={!puedeEditar} style={{ border: 0, padding: 0, margin: 0 }}>
      <div className="card" style={{ background: 'var(--bg-2)', margin: '0 0 .6rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontWeight: 600 }}>
          <input type="checkbox" checked={cfg.avisosActivos} onChange={(e) => setCfg((p) => ({ ...p, avisosActivos: e.target.checked }))} />
          Avisos de vencimiento activos
        </label>
        <p className="muted" style={{ margin: '.2rem 0 0', fontSize: '.82rem' }}>
          Al desactivar, no se muestra la lista de vencimientos en la cabecera ni los avisos al registrar.
        </p>
      </div>
      <div style={{ display: 'flex', gap: '.8rem', flexWrap: 'wrap' }}>
        <div className="form-row" style={{ flex: '1 1 180px' }}>
          <label>Días antes del vencimiento de licencia</label>
          <input className="input mono" type="number" min={0} value={cfg.diasLicencia}
            onChange={(e) => setCfg((p) => ({ ...p, diasLicencia: Number(e.target.value) }))} />
        </div>
        <div className="form-row" style={{ flex: '1 1 180px' }}>
          <label>Días antes del vencimiento de declaración</label>
          <input className="input mono" type="number" min={0} value={cfg.diasDeclaracion}
            onChange={(e) => setCfg((p) => ({ ...p, diasDeclaracion: Number(e.target.value) }))} />
        </div>
        <div className="form-row" style={{ flex: '1 1 180px' }}>
          <label>Días antes del vencimiento de actividad</label>
          <input className="input mono" type="number" min={0} value={cfg.diasActividad}
            onChange={(e) => setCfg((p) => ({ ...p, diasActividad: Number(e.target.value) }))} />
        </div>
      </div>
    </fieldset>
  );
}

function SeccionNumeracion({ puedeEditar }: { puedeEditar: boolean }) {
  const [periodos, setPeriodos] = useState([
    { imp: 'IVA', freq: 'quincenal' as 'quincenal' | 'mensual', inicio: '', cierre: '', ultimoNumero: '', serie: '' },
    { imp: 'ISLR', freq: 'mensual' as 'quincenal' | 'mensual', inicio: '', cierre: '', ultimoNumero: '', serie: '' },
    { imp: 'ISAE', freq: 'mensual' as 'quincenal' | 'mensual', inicio: '', cierre: '', ultimoNumero: '', serie: '' },
  ]);

  function setP(i: number, k: string, v: string) {
    setPeriodos((prev) => prev.map((p, j) => j === i ? { ...p, [k]: v } : p));
  }

  return (
    <fieldset disabled={!puedeEditar} style={{ border: 0, padding: 0, margin: 0 }}>
      <div style={{ display: 'grid', gap: '1rem' }}>
        {periodos.map((p, i) => (
          <div key={p.imp} className="card" style={{ margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '.5rem' }}>
              <strong>{p.imp}</strong>
              <select className="select" style={{ width: 'auto' }} value={p.freq}
                onChange={(e) => setP(i, 'freq', e.target.value)}>
                <option value="quincenal">Quincenal</option>
                <option value="mensual">Mensual</option>
              </select>
            </div>
            <p className="muted" style={{ fontSize: '.82rem', margin: '0 0 .5rem' }}>
              {p.freq === 'quincenal' ? 'Cada mes se divide en dos quincenas (1–15 y 16–fin).' : 'Un período por mes calendario.'}
            </p>
            <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
              <div className="form-row" style={{ flex: '1 1 140px', margin: 0 }}>
                <label>Inicio del período en curso</label>
                <input className="input" type="date" value={p.inicio} onChange={(e) => setP(i, 'inicio', e.target.value)} />
              </div>
              <div className="form-row" style={{ flex: '1 1 140px', margin: 0 }}>
                <label>Cierre</label>
                <input className="input" type="date" value={p.cierre} onChange={(e) => setP(i, 'cierre', e.target.value)} />
              </div>
              <div className="form-row" style={{ flex: '1 1 180px', margin: 0 }}>
                <label>Último N° de comprobante emitido</label>
                <input className="input mono" value={p.ultimoNumero} onChange={(e) => setP(i, 'ultimoNumero', e.target.value)} placeholder="Ej.: 00000244" />
              </div>
              <div className="form-row" style={{ flex: '1 1 120px', margin: 0 }}>
                <label>Serie</label>
                <input className="input mono" value={p.serie} onChange={(e) => setP(i, 'serie', e.target.value)} placeholder="Ej.: 2026" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="hint muted" style={{ fontSize: '.78rem', marginTop: '.6rem' }}>Un período no cruza de un mes a otro. El número se propone al registrar y avanza consecutivamente.</p>
    </fieldset>
  );
}

function SeccionInterruptores({ puedeEditar }: { puedeEditar: boolean }) {
  const [reglas, setReglas] = useState([
    { id: 'auto_iva', label: 'Proponer IVA automáticamente en cada factura', desc: 'Si el proveedor tiene perfil fiscal, se propone la retención de IVA al crear la factura.', activo: true },
    { id: 'auto_islr', label: 'Proponer ISLR según concepto y actividad', desc: 'Se busca el concepto por el tipo de servicio/producto y se propone el porcentaje.', activo: true },
    { id: 'auto_isae', label: 'Proponer ISAE en servicios', desc: 'Todo servicio genera retención de ISAE según la actividad económica del proveedor.', activo: true },
    { id: 'bloquear_sin_perfil', label: 'Bloquear registro sin perfil fiscal', desc: 'No permite registrar una retención si el proveedor no tiene perfil fiscal configurado.', activo: false },
    { id: 'validar_numero', label: 'Validar número de comprobante consecutivo', desc: 'Rechaza un número que no sea el siguiente al último emitido en la serie.', activo: true },
    { id: 'exigir_factura', label: 'Exigir N° de factura al registrar', desc: 'No permite registrar sin el número de la factura del proveedor.', activo: false },
  ]);

  return (
    <fieldset disabled={!puedeEditar} style={{ border: 0, padding: 0, margin: 0 }}>
      <div style={{ display: 'grid', gap: '.5rem' }}>
        {reglas.map((r) => (
          <div key={r.id} className="card" style={{ margin: 0, display: 'flex', gap: '.7rem', alignItems: 'flex-start', padding: '.65rem .8rem' }}>
            <input type="checkbox" checked={r.activo} style={{ marginTop: '.15rem' }}
              onChange={() => setReglas((prev) => prev.map((x) => x.id === r.id ? { ...x, activo: !x.activo } : x))} />
            <div>
              <div style={{ fontWeight: 600, fontSize: '.9rem' }}>{r.label}</div>
              <div className="muted" style={{ fontSize: '.8rem' }}>{r.desc}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="hint muted" style={{ fontSize: '.78rem', marginTop: '.6rem' }}>Cada cambio se aplica al momento. Las retenciones ya registradas no se recalculan.</p>
    </fieldset>
  );
}

function CatalogoConceptos({ conceptos, puedeEditar, onCambio }: {
  conceptos: ConceptoRetencion[]; puedeEditar: boolean; onCambio: () => void;
}) {
  const [edit, setEdit] = useState<ConceptoRetencion | null>(null);
  const [pct, setPct] = useState('');
  const [busca, setBusca] = useState('');
  const visiblesCat = conceptos.filter((c) => buscaEn(busca, c.codigo, c.nombre, labelSujeto(c.sujeto),
    TIPOS_IMPUESTO.find((t) => t.key === c.tipo)?.corto));

  async function guardarPct(c: ConceptoRetencion) {
    // D41: un % vacío o ilegible no se guarda como 0 %.
    const porcentaje = pct.trim() ? leerMonto(pct) : null;
    if (porcentaje == null) { toast('No se entiende el porcentaje: escribe, por ejemplo, 3 o 1,5.', 'error'); return; }
    const fueraDeRango = faltaEnPctConcepto(porcentaje);
    if (fueraDeRango) { toast(fueraDeRango, 'error'); return; }
    try {
      await guardarConcepto({ ...c, porcentaje });
      toast(`«${c.nombre}» quedó en ${numeroATexto(porcentaje)} % para ${labelSujeto(c.sujeto).toLowerCase()}`, 'success');
      setEdit(null);
      onCambio();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
  }

  async function activar(c: ConceptoRetencion) {
    const hermanos = conceptos.filter((x) => x.tipo === 'islr' && x.codigo === c.codigo).length;
    if (c.activo && hermanos > 1
      && !window.confirm(`El código ${c.codigo} se desactiva entero: deja de ofrecerse para sus ${hermanos} sujetos. ¿Continuar?`)) return;
    try { await activarConcepto(c.id, !c.activo); onCambio(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cambiar', 'error'); }
  }

  return (
    <>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.82rem' }}>
        Los conceptos de <strong>ISLR</strong> vienen del <strong>Decreto 1.808</strong>, un porcentaje por sujeto. El
        <strong> ISAE</strong> y el <strong>timbre estadal</strong> salen de la ordenanza del municipio y de la ley del estado:
        su alícuota se cambia en «Datos de la empresa».
      </p>
      <div className="lf-campo-q" style={{ marginBottom: '.5rem', maxWidth: 360 }}>
        <input type="search" className="input" value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar en el catálogo: código, concepto o sujeto" aria-label="Buscar en el catálogo" />
        {busca && <button type="button" className="lf-limpiar" aria-label="Limpiar la búsqueda" onClick={() => setBusca('')}>×</button>}
      </div>
      <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead>
            <tr><th>Tipo</th><th>Concepto</th><th>Sujeto</th><th style={{ textAlign: 'right' }}>%</th><th>Nota</th><th></th></tr>
          </thead>
          <tbody>
            {!visiblesCat.length && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '.6rem' }}>Ningún concepto coincide con la búsqueda</td></tr>
            )}
            {visiblesCat.map((c) => (
              <tr key={c.id} style={{ opacity: c.activo ? 1 : 0.5 }}>
                <td><span className="badge">{TIPOS_IMPUESTO.find((t) => t.key === c.tipo)?.corto ?? rotuloImpuesto(c.tipo)}</span></td>
                <td>{c.codigo ? <span className="muted mono">{c.codigo} · </span> : null}{c.nombre}
                  {c.aplicaSustraendo && <div className="muted" style={{ fontSize: '.7rem' }}>con sustraendo · mínimo {c.baseMinimaUt} UT</div>}
                  {c.basePct !== 100 && <div className="muted" style={{ fontSize: '.7rem' }}>base: {c.basePct}% del pago</div>}
                </td>
                <td className="muted" style={{ fontSize: '.76rem' }}>{labelSujeto(c.sujeto)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                  {edit?.id === c.id ? (
                    <input className="input mono" style={{ width: 80 }} value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" autoFocus />
                  ) : `${c.porcentaje}%`}
                </td>
                <td className="muted" style={{ fontSize: '.72rem' }}>{c.fundamento ?? '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {puedeEditar && c.tipo === 'islr' && (edit?.id === c.id ? (
                    <>
                      <button className="btn btn-sm btn-primary" onClick={() => void guardarPct(c)}>✓</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEdit(null)}>✕</button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-sm btn-ghost" onClick={() => { setEdit(c); setPct(numeroATexto(c.porcentaje)); }} title="Cambiar el porcentaje">✎</button>
                      <button className="btn btn-sm btn-ghost" title={c.activo ? 'Desactivar el código' : 'Activar el código'}
                        onClick={() => void activar(c)}>{c.activo ? '🚫' : '✓'}</button>
                    </>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
