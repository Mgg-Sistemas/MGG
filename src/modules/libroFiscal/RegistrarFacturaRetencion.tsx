/* ============================================================
   Golden Touch · Libro fiscal · Registrar una FACTURA con varias líneas (v8 · VF)

   Una factura (cabecera) y varias líneas de impuesto (IVA, ISLR, ISAE, etc.).
   El cálculo de cada línea es el puro de retencionesCalculo; con R7, una
   practicada se calcula con la regla vigente a la fecha de la factura y la
   línea guarda la regla y la foto (R7F). El registro es atómico vía
   registrarFactura (retencion_factura_registrar). La tasa es la BCV de la
   fecha de la factura; la fecha de la retención es la del comprobante y no
   cambia el período. Se ofrece detrás de v2rDisponible.
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import type { Proveedor } from '@/shared/lib/types';
import { list as listProveedores, update as updateProveedor } from '@/modules/proveedores/proveedores.repository';
import { getTasaUsdDeFecha } from '@/modules/tesoreria/tasas.repository';
import { rifValido } from '@/shared/lib/rif';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { rutaFichaProveedor, textoRifInvalido } from './mensajeRif';
import {
  CONFIG_RETENCION_DEFECTO, DIRECCIONES, SUJETOS, TIPOS_IMPUESTO,
  calcularIgtf, calcularRetencionIslr, calcularRetencionIva, calcularRetencionLocal, conceptoConAlicuotaEmpresa, configDesdeFicha, desglosarIvaDeTotal, enBolivares, fechaTasaBcv,
  formatoComprobante, formatoSerie, labelImpuesto, labelSujeto, motivoCienTexto, motivoNoPuedePracticar, periodoDe, quincenaDe,
  type CalculoRetencion, type ConceptoRetencion, type ConfigRetencion, type DireccionRetencion,
  type FichaFiscalEmpresa, type SujetoRetenido, type TipoImpuesto,
} from './retencionesCalculo';
import {
  adjuntarComprobante, consultarCorrelativoEstimado, getConfigRetencion, listConceptos, sujetoAGt, tipoAGt,
  type CorrelativoEstimado, type DocKind,
} from './retencionesFiscal.repository';
import { configDeFecha } from './parametros.repository';
import { supuestoAplicado, supuestosVigentes, type Supuesto } from './motivosSupuestos.repository';
import { esCeroSinMotivo } from './motivoCero';
import { sugerirSujetoPorRif } from './residenciaSujeto';
import { leerMonto, numeroATexto, validarArchivoFacturaObligatorio } from './validarCarga';
import { montoEscrito, municipioDeLinea, sujetoDeLineas } from './lineasRegistro';
import { SeLeyo } from './SeLeyo';
import { rotuloImpuesto } from './rotulos';
import { BuscadorFactura } from './BuscadorFactura';
import { pendientesComoTipos, r10Disponible, retenerDespues, type FacturaResumen } from './facturasResumen.repository';
import { faltaEnDatosFactura, faltaEnFechaRetencion, faltaEnFechaEntrega, faltaEnBaseImponible, faltaEnTotalFactura, avisoEntregaIvaTardia, avisoRetenidoSuperaBase } from './facturaDocumento';
import { r7Disponible } from './reglas.repository';
import { calcularConReglaVigente, columnasDeRegla, type CalculoConRegla } from './reglaRegistro';
import { useDescartar } from './confirmarDescartar';
import { urlFacturaDeOrigen } from './documentosOrigen.repository';
import { SupuestosIvaAcordeon } from './SupuestosIvaAcordeon';
import { nombrePeriodo, periodoEstaCerrado, type PeriodoFiscal } from './periodosRetencion.repository';
import { previewArchivo } from '@/shared/lib/reportePreview';
import {
  registrarFactura, type FacturaNueva, type LineaFacturaNueva, type TipoDocumento,
} from './retencionFacturas.repository';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { soloImpuestosActivos, admiteDireccion, type ImpuestosActivos, type FichaRetencionVista } from '@/modules/retenciones/impuestosVista';
import { usePuedePracticarEmpresa } from './practicaEmpresa';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { mensajeRetencion, datosMensajeDeRetenciones } from '@/modules/retenciones/mensajeRetencion';
import { montoPagadoDeOrden, type MontoPagado } from '@/modules/retenciones/pagoOrden.repository';
import { supabase } from '@/shared/lib/supabase';
import { listRetencionesPendientes, type RetencionItem } from '@/modules/retenciones/retenciones.repository';
import { listFacturasBuzon, actualizarEstatusFacturaBuzon, type FacturaExternaBuzon } from '@/modules/retenciones/facturasBuzon.repository';

/** Para calcular mientras se escribe. Lo ilegible lo señala `ilegibles` antes de registrar. */
const nDec = (v: string) => leerMonto(v) ?? 0;

/**
 * Los impuestos de una línea: los activos que admiten la dirección de la factura,
 * pero si la línea ya tiene elegido uno que se deshabilitó (o dejó de admitir esa
 * dirección), se sigue mostrando para no perder el valor en pantalla.
 */
function tiposDeLinea(
  impuestosActivos: ImpuestosActivos | null | undefined,
  fichasImpuesto: Map<TipoImpuesto, FichaRetencionVista> | null | undefined,
  direccion: DireccionRetencion,
  tipoActual: TipoImpuesto,
): typeof TIPOS_IMPUESTO {
  const base = soloImpuestosActivos(TIPOS_IMPUESTO, impuestosActivos ?? null)
    .filter((t) => admiteDireccion(fichasImpuesto?.get(t.key), direccion));
  return base.some((t) => t.key === tipoActual) ? base : [...base, ...TIPOS_IMPUESTO.filter((t) => t.key === tipoActual)];
}
/** Hoy en la hora local (AAAA-MM-DD). */
/** Hoy en Venezuela. */
const hoyIso = hoyVenezuela;
const fechaCorta = (iso: string) => { const [a, m, d] = iso.slice(0, 10).split('-'); return a && m && d ? `${d}/${m}/${a}` : iso; };
const money = (n: number, moneda: string) => {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'Bs' ? `Bs ${v}` : `$ ${v}`;
};

/** Con qué datos se abre el registro (desde una OC/compra, o vacío para manual). */
export interface SemillaFactura {
  direccion?: DireccionRetencion;
  tipoDocumento?: TipoDocumento;
  facturaAfectadaNro?: string | null;
  exento?: number | null;
  docKind?: DocKind;
  docId?: string | null;
  contraparteId?: string | null;
  contraparteNombre?: string | null;
  contraparteRif?: string | null;
  moneda?: string;
  facturaNro?: string | null;
  facturaControl?: string | null;
  facturaFecha?: string | null;
  facturaTotal?: number | null;
  /** P03: el archivo de factura de Compras del que sale el registro. */
  adjuntoId?: string | null;
  /** P03: para verlo mientras se registra (bucket y ruta del archivo). */
  adjunto?: { nombre: string; bucket: string; path: string } | null;
  /** IVA de la factura (base de la línea de IVA). */
  iva?: number | null;
  /** Base imponible sugerida (total sin IVA ni IGTF). */
  baseImponible?: number | null;
  /** Impuesto con el que arranca la primera línea (si se entra desde un botón de «Por realizar»). */
  tipoInicial?: TipoImpuesto;
  /** R10: retener después sobre esta factura ya registrada (desde «Facturas registradas»). */
  documento?: FacturaResumen | null;
}

interface LineaUI {
  id: number;
  tipo: TipoImpuesto;
  sujeto: SujetoRetenido;
  conceptoId: string;
  baseStr: string;
  ivaStr: string;
  pctStr: string;
  montoStr: string;
  /** En una recibida: el número del comprobante que entregó el cliente. */
  numeroStr: string;
  /** Los supuestos marcados por código (las 5 casillas fijas, o los de R6). */
  motivos: Record<string, boolean>;
  descripcion: string;
  /** C3: el usuario confirmó el IVA derivado del total (cuando el IVA no está discriminado). Solo UI. */
  ivaDerivadoConfirmado?: boolean;
}

/** Renglón para ensamblar factura estilo Valery Software */
export interface RenglonValery {
  id: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  alicuota: 16 | 8 | 0;
}


let semilla = 0;
const nuevaLinea = (over: Partial<LineaUI> = {}): LineaUI => ({
  id: (semilla += 1), tipo: 'iva', sujeto: 'pj_domiciliada', conceptoId: '',
  baseStr: '0', ivaStr: '0', pctStr: '', montoStr: '', numeroStr: '', motivos: {}, descripcion: '', ...over,
});

// C-c (líder): «¿Quién retuvo?» (Recibida/Practicada) es un control de VENTAS. En el
// flujo de compras —este formulario— la retención es SIEMPRE practicada, así que el
// control se oculta y la dirección queda fija en 'practicada'. Reversible: con
// OFRECER_DIRECCION = true vuelve el toggle. El modelo (DIRECCIONES, 'recibida',
// esManual…) se deja intacto a propósito: «recibida» sigue existiendo para ventas.
const OFRECER_DIRECCION: boolean = false;

export function RegistrarFacturaRetencion({ semilla: s = {}, actor, actorName, onClose, onHecho, proveedorIdsPendientes, impuestosActivos, fichasImpuesto, empresaId = null, empresaFicha = null }: {
  semilla?: SemillaFactura;
  /** En una practicada, solo se ofrecen los proveedores con retenciones por realizar (si se pasa). */
  proveedorIdsPendientes?: Set<string>;
  actor: string;
  actorName: string | null;
  onClose: () => void;
  onHecho: (res: Awaited<ReturnType<typeof registrarFactura>>) => void;
  /** Los impuestos activos de la tabla; uno deshabilitado no se ofrece como línea nueva. */
  impuestosActivos?: ImpuestosActivos | null;
  /** La ficha de cada impuesto: gatea la dirección admitida por línea y da el formato de su serie. */
  fichasImpuesto?: Map<TipoImpuesto, FichaRetencionVista> | null;
  /** Multi-empresa: la empresa receptora que queda marcada en la cabecera. null = single-empresa. */
  empresaId?: string | null;
  /** Multi-empresa: la ficha fiscal de la empresa (régimen y %); null = GT/single (config global). */
  empresaFicha?: FichaFiscalEmpresa | null;
}) {
  const [configBase, setConfigBase] = useState<ConfigRetencion>(CONFIG_RETENCION_DEFECTO);
  // Con R3, los valores (UT, % del IVA) de la fecha de la factura; sin R3, los de Parámetros.
  const [config, setConfig] = useState<ConfigRetencion>(CONFIG_RETENCION_DEFECTO);
  const [avisoFecha, setAvisoFecha] = useState<string | null>(null);
  // R6: los supuestos del IVA vigentes a la fecha de la factura; null = sin R6, las 5 casillas fijas.
  const [supuestosIva, setSupuestosIva] = useState<Supuesto[] | null>(null);
  const [conceptos, setConceptos] = useState<ConceptoRetencion[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Al registrar con éxito: se queda el resultado para ofrecer «Compartir por WhatsApp».
  const [resultado, setResultado] = useState<Awaited<ReturnType<typeof registrarFactura>> | null>(null);
  const [pagoResultado, setPagoResultado] = useState<MontoPagado | null>(null);
  const { marcarSucio, pedirCierre, dialogo } = useDescartar(onClose, saving);
  // R7: el cálculo con la regla vigente de cada línea (por id de línea); sin entrada = el cálculo de hoy.
  const [conR7, setConR7] = useState(false);
  const [reglas, setReglas] = useState<Record<number, CalculoConRegla | null>>({});
  const [avisoRegla, setAvisoRegla] = useState<string | null>(null);
  const [tasaBcv, setTasaBcv] = useState<{ tasa: number | null; nota: string } | null>(null);

  const [direccion, setDireccion] = useState<DireccionRetencion>(OFRECER_DIRECCION ? (s.direccion ?? 'practicada') : 'practicada');
  const verProveedores = usePermissions().can('proveedores');
  const [proveedorId, setProveedorId] = useState(s.contraparteId ?? '');
  const [contraparte, setContraparte] = useState(s.contraparteNombre ?? '');
  const [rif, setRif] = useState(s.contraparteRif ?? '');
  const [moneda, setMoneda] = useState(s.moneda ?? 'Bs');
  const [tasaStr, setTasaStr] = useState('');
  const [tipoDocumento, setTipoDocumento] = useState<TipoDocumento>(s.tipoDocumento ?? 'factura');
  const [facturaAfectadaNro, setFacturaAfectadaNro] = useState(s.facturaAfectadaNro ?? '');
  const [facturaNro, setFacturaNro] = useState(s.facturaNro ?? '');
  const [facturaControl, setFacturaControl] = useState(s.facturaControl ?? '');
  const [facturaFecha, setFacturaFecha] = useState(s.facturaFecha ?? '');
  const [fechaRetencion, setFechaRetencion] = useState(hoyIso());
  const [fechaEntrega, setFechaEntrega] = useState(hoyIso());
  const [facturaTotal, setFacturaTotal] = useState(numeroATexto(s.facturaTotal ?? 0));
  const [ivaFacturaStr, setIvaFacturaStr] = useState(s.iva != null ? numeroATexto(s.iva) : '');
  // D2b: ¿practica esta empresa el impuesto? NO-GT lee la RPC (L6) por empresa y fecha;
  // GT/single sigue con puedePracticar(config). Una sola fuente, también en el registro.
  const puedePracticarEmpresa = usePuedePracticarEmpresa(empresaFicha, empresaId, facturaFecha);
  const [exentoStr, setExentoStr] = useState(s.exento != null ? numeroATexto(s.exento) : '');
  // Dato interno separado de exento: lo pide el requirente, no el Art. 18.8 de la 43.484.
  const [sinDerechoStr, setSinDerechoStr] = useState('');
  const [nota, setNota] = useState('');
  // R10: la factura sola (sin líneas, queda pendiente) y retener después sobre una ya registrada.
  const [conR10, setConR10] = useState(false);
  const [documento, setDocumento] = useState<FacturaResumen | null>(null);
  const [avisoSinDocDescartado, setAvisoSinDocDescartado] = useState(() => {
    try { return localStorage.getItem('gt_aviso_sin_doc_descartado') === 'true'; } catch { return false; }
  });
  const descartarAvisoSinDoc = () => {
    setAvisoSinDocDescartado(true);
    try { localStorage.setItem('gt_aviso_sin_doc_descartado', 'true'); } catch { /* ignorar */ }
  };
  const [periodoCerrado, setPeriodoCerrado] = useState<PeriodoFiscal | null>(null);
  const [archivoFactura, setArchivoFactura] = useState<File | null>(null);
  const [archivoFacturaUrl, setArchivoFacturaUrl] = useState<string | null>(null);
  const [adjuntoExistente, setAdjuntoExistente] = useState<{ nombre: string; bucket: string; path: string } | null>(null);

  const soporteActivo = s.adjunto ?? adjuntoExistente;

  const [modoOrigen, setModoOrigen] = useState<'oc' | 'buzon' | 'manual'>(() => {
    if (empresaFicha) return 'buzon';
    if (s.docKind === 'compra_directa' || s.docKind === 'servicio_directo') return 'manual';
    if (s.docKind === 'oc' || s.docId) return 'oc';
    return 'oc';
  });

  // Empresas ajenas a Golden Touch solo reciben por Buzón Móvil (ajenas al flujo de compras)
  useEffect(() => {
    if (empresaFicha && modoOrigen === 'oc') {
      setModoOrigen('buzon');
    }
  }, [empresaFicha, modoOrigen]);
  const [ordenesPendientes, setOrdenesPendientes] = useState<RetencionItem[]>([]);
  const [ordenSeleccionadaId, setOrdenSeleccionadaId] = useState<string>(s.docKind === 'oc' && s.docId ? s.docId : '');
  const [buzonPendientes, setBuzonPendientes] = useState<FacturaExternaBuzon[]>([]);
  const [buzonSeleccionadaId, setBuzonSeleccionadaId] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Verificación de historial de retenciones del proveedor (para autorizar edición fiscal)
  const [verificandoHistorialProv, setVerificandoHistorialProv] = useState(false);
  const [tieneRetencionesPrevias, setTieneRetencionesPrevias] = useState<boolean | null>(null);
  const [cantRetencionesPrevias, setCantRetencionesPrevias] = useState(0);
  const [editandoProveedor, setEditandoProveedor] = useState(false);
  const [nombreProvEditado, setNombreProvEditado] = useState('');
  const [rifProvEditado, setRifProvEditado] = useState('');
  const [guardandoProveedor, setGuardandoProveedor] = useState(false);

  // Modo de ensamblaje de factura estilo Valery Software
  const [modoCaptura, setModoCaptura] = useState<'rapido' | 'valery'>('rapido');
  const [renglonesValery, setRenglonesValery] = useState<RenglonValery[]>([]);

  useEffect(() => {
    if (!proveedorId) {
      setTieneRetencionesPrevias(null);
      setCantRetencionesPrevias(0);
      setEditandoProveedor(false);
      return;
    }
    let activo = true;
    setVerificandoHistorialProv(true);
    (async () => {
      try {
        const { count, error } = await supabase
          .from('retenciones')
          .select('id', { count: 'exact', head: true })
          .eq('proveedor_id', proveedorId);
        if (!activo) return;
        if (error) {
          console.warn('Error verificando retenciones previas:', error);
          setTieneRetencionesPrevias(true);
          return;
        }
        const c = count ?? 0;
        setCantRetencionesPrevias(c);
        setTieneRetencionesPrevias(c > 0);
      } catch {
        if (activo) setTieneRetencionesPrevias(true);
      } finally {
        if (activo) setVerificandoHistorialProv(false);
      }
    })();
    return () => { activo = false; };
  }, [proveedorId]);

  function iniciarEdicionProveedor() {
    setNombreProvEditado(contraparte);
    setRifProvEditado(rif);
    setEditandoProveedor(true);
  }

  async function guardarEdicionProveedor() {
    if (!proveedorId) return;
    const nom = nombreProvEditado.trim();
    const r = rifProvEditado.trim().toUpperCase();
    if (!nom) {
      toast('La razón social no puede estar vacía.', 'error');
      return;
    }
    if (!rifValido(r)) {
      toast('El RIF ingresado no es válido (ej. J-12345678-9).', 'error');
      return;
    }
    setGuardandoProveedor(true);
    try {
      await updateProveedor(proveedorId, { razon_social: nom, rif: r });
      setProveedores((prev) => prev.map((p) => p.id === proveedorId ? { ...p, razon_social: nom, rif: r } : p));
      setContraparte(nom);
      setRif(r);
      setEditandoProveedor(false);
      toast('Datos del proveedor actualizados con éxito.', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al guardar el proveedor.';
      toast(msg, 'error');
    } finally {
      setGuardandoProveedor(false);
    }
  }

  useEffect(() => {
    let activo = true;
    if (direccion === 'practicada') {
      listRetencionesPendientes()
        .then((items) => {
          if (!activo) return;
          setOrdenesPendientes(items);
          if (s.docKind === 'oc' && s.docId) {
            const item = items.find((x) => x.orden.id === s.docId);
            if (item?.orden.items && item.orden.items.length > 0) {
              setRenglonesValery(item.orden.items.map((it, idx) => ({
                id: `oc-item-${idx}-${Date.now()}`,
                descripcion: it.nombre || it.sku || `Ítem ${idx + 1}`,
                cantidad: Number(it.cantidad) || 1,
                precioUnitario: (item.orden.total_moneda === 'Bs' ? Number(it.precio) : Number(it.precio_usd || it.precio)) || 0,
                alicuota: it.exento ? 0 : 16,
              })));
            }
          }
        })
        .catch(() => {});
      listFacturasBuzon(empresaId ? { estatus: 'recibida', empresaId } : { estatus: 'recibida' })
        .then((items) => {
          if (activo) {
            // Aislamiento estricto multiempresa: no mezclar facturas de una empresa en otra
            const filtradas = empresaId
              ? items.filter((b) => b.empresaId === empresaId || (empresaId === 'empresa-golden-touch' && !b.empresaId))
              : items;
            setBuzonPendientes(filtradas);
          }
        })
        .catch(() => {});
    }
    return () => { activo = false; };
  }, [direccion, empresaId]);

  const ordenesPendientesFiltradas = useMemo(() => {
    if (!proveedorId) return ordenesPendientes;
    return ordenesPendientes.filter((it) => it.orden.proveedor_id === proveedorId);
  }, [ordenesPendientes, proveedorId]);

  function sugerirConceptoParaLinea(cs: ConceptoRetencion[], tipo: TipoImpuesto, sujeto: SujetoRetenido): string {
    const candidatos = cs.filter((c) => c.tipo === tipo && c.activo !== false && (c.sujeto === sujeto || c.sujeto === 'todos'));
    if (!candidatos.length) return '';
    if (tipo === 'islr') {
      const serv2 = candidatos.find((c) => (c.codigo?.includes('054') || c.nombre.toLowerCase().includes('servicio')) && c.porcentaje === 2);
      if (serv2) return serv2.id;
      const pct2 = candidatos.find((c) => c.porcentaje === 2);
      if (pct2) return pct2.id;
    }
    return candidatos[0].id;
  }

  function elegirOrden(id: string) {
    marcarSucio();
    setOrdenSeleccionadaId(id);
    if (!id) return;
    const item = ordenesPendientes.find((x) => x.orden.id === id);
    if (!item) return;
    const o = item.orden;
    let provRif = '';
    if (o.proveedor_id) {
      setProveedorId(o.proveedor_id);
      const prov = proveedores.find((p) => p.id === o.proveedor_id);
      if (prov) {
        setContraparte(prov.razon_social);
        setRif(prov.rif ?? '');
        provRif = prov.rif ?? '';
      } else {
        setContraparte(item.proveedorNombre || '');
      }
    } else {
      setContraparte(item.proveedorNombre || '');
    }
    setMoneda(o.total_moneda === 'Bs' ? 'Bs' : 'USD');
    setFacturaTotal(numeroATexto(o.total ?? 0));
    setIvaFacturaStr(numeroATexto(o.iva_monto ?? 0));
    const baseCalc = Math.max(0, (o.total ?? 0) - (o.iva_monto ?? 0) - (o.igtf_monto ?? 0));
    const tipoSugerido = puedePracticarEmpresa('islr', config) ? 'islr' : 'iva';
    const sujetoSugerido = sugerirSujetoPorRif(provRif)?.sujeto ?? 'pj_domiciliada';
    const conceptoSugerido = sugerirConceptoParaLinea(conceptos, tipoSugerido, sujetoSugerido);

    setLineas([nuevaLinea({
      tipo: tipoSugerido,
      sujeto: sujetoSugerido,
      conceptoId: conceptoSugerido,
      baseStr: numeroATexto(baseCalc),
      ivaStr: numeroATexto(o.iva_monto ?? 0),
    })]);
    if (o.factura_recepcion_path) {
      setAdjuntoExistente({
        nombre: o.factura_recepcion_nombre || `Factura ${o.oc_codigo || o.codigo}`,
        bucket: 'comprobantes',
        path: o.factura_recepcion_path,
      });
    }
    if (o.items && o.items.length > 0) {
      setRenglonesValery(o.items.map((it, idx) => ({
        id: `oc-item-${idx}-${Date.now()}`,
        descripcion: it.nombre || it.sku || `Ítem ${idx + 1}`,
        cantidad: Number(it.cantidad) || 1,
        precioUnitario: (o.total_moneda === 'Bs' ? Number(it.precio) : Number(it.precio_usd || it.precio)) || 0,
        alicuota: it.exento ? 0 : 16,
      })));
    }
  }

  const ordenSeleccionadaObj = useMemo(() => {
    if (!ordenSeleccionadaId) return null;
    return ordenesPendientes.find((x) => x.orden.id === ordenSeleccionadaId)?.orden ?? null;
  }, [ordenesPendientes, ordenSeleccionadaId]);

  function cargarRenglonesDesdeOc() {
    if (!ordenSeleccionadaObj || !ordenSeleccionadaObj.items || !ordenSeleccionadaObj.items.length) {
      toast('La orden de compra seleccionada no contiene renglones detallados.', 'info');
      return;
    }
    const nuevos: RenglonValery[] = ordenSeleccionadaObj.items.map((it, idx) => ({
      id: `oc-item-${idx}-${Date.now()}`,
      descripcion: it.nombre || it.sku || `Ítem ${idx + 1}`,
      cantidad: Number(it.cantidad) || 1,
      precioUnitario: (ordenSeleccionadaObj.total_moneda === 'Bs' ? Number(it.precio) : Number(it.precio_usd || it.precio)) || 0,
      alicuota: it.exento ? 0 : 16,
    }));
    setRenglonesValery(nuevos);
    marcarSucio();
    toast(`Se cargaron ${nuevos.length} renglones de la orden de compra.`, 'success');
  }

  function agregarRenglon() {
    marcarSucio();
    setRenglonesValery((prev) => [
      ...prev,
      {
        id: `renglon-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        descripcion: '',
        cantidad: 1,
        precioUnitario: 0,
        alicuota: 16,
      },
    ]);
  }

  function actualizarRenglon(id: string, patch: Partial<RenglonValery>) {
    marcarSucio();
    setRenglonesValery((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
  }

  function eliminarRenglon(id: string) {
    marcarSucio();
    setRenglonesValery((prev) => prev.filter((r) => r.id !== id));
  }

  const calculoValery = useMemo(() => {
    let base16 = 0;
    let base8 = 0;
    let exento = 0;
    for (const r of renglonesValery) {
      const cant = Number(r.cantidad) || 0;
      const pu = Number(r.precioUnitario) || 0;
      const sub = Math.round(cant * pu * 100) / 100;
      if (r.alicuota === 16) base16 += sub;
      else if (r.alicuota === 8) base8 += sub;
      else exento += sub;
    }
    base16 = Math.round(base16 * 100) / 100;
    base8 = Math.round(base8 * 100) / 100;
    exento = Math.round(exento * 100) / 100;
    const iva16 = Math.round(base16 * 0.16 * 100) / 100;
    const iva8 = Math.round(base8 * 0.08 * 100) / 100;
    const totalIva = Math.round((iva16 + iva8) * 100) / 100;
    const totalFactura = Math.round((base16 + base8 + exento + totalIva) * 100) / 100;
    return { base16, base8, exento, iva16, iva8, totalIva, totalFactura };
  }, [renglonesValery]);

  useEffect(() => {
    if (modoCaptura !== 'valery' || renglonesValery.length === 0) return;
    setFacturaTotal(numeroATexto(calculoValery.totalFactura));
    setIvaFacturaStr(numeroATexto(calculoValery.totalIva));
    setExentoStr(calculoValery.exento > 0 ? numeroATexto(calculoValery.exento) : '');
  }, [modoCaptura, calculoValery]);

  function elegirFacturaBuzon(id: string) {
    marcarSucio();
    setBuzonSeleccionadaId(id);
    if (!id) return;
    const f = buzonPendientes.find((x) => x.id === id);
    if (!f) return;
    setContraparte(f.proveedorNombre || '');
    setRif(f.proveedorRif || '');
    if (f.proveedorRif) {
      const prov = proveedores.find((p) => (p.rif ?? '').trim().toUpperCase() === f.proveedorRif.trim().toUpperCase());
      if (prov) setProveedorId(prov.id);
    }
    if (f.facturaNumero) setFacturaNro(f.facturaNumero);
    if (f.facturaControl) setFacturaControl(f.facturaControl);
    if (f.facturaFecha) setFacturaFecha(f.facturaFecha);
    setMoneda(f.moneda || 'Bs');
    setFacturaTotal(numeroATexto(f.montoTotal ?? 0));
    const { base: bBuzon, iva: iBuzon } = desglosarIvaDeTotal(f.montoTotal ?? 0, 0, aliIvaPct);
    setIvaFacturaStr(numeroATexto(iBuzon));
    const tipoBuzon = puedePracticarEmpresa('islr', config) ? 'islr' : 'iva';
    const sujetoBuzon = sugerirSujetoPorRif(f.proveedorRif ?? '')?.sujeto ?? 'pj_domiciliada';
    const conceptoBuzon = sugerirConceptoParaLinea(conceptos, tipoBuzon, sujetoBuzon);

    setLineas([nuevaLinea({
      tipo: tipoBuzon,
      sujeto: sujetoBuzon,
      conceptoId: conceptoBuzon,
      baseStr: numeroATexto(bBuzon),
      ivaStr: numeroATexto(iBuzon),
    })]);
    if (f.adjuntos?.[0]) {
      const a = f.adjuntos[0];
      setAdjuntoExistente({
        nombre: a.nombre || a.nombreOriginal || 'Soporte Buzón',
        bucket: 'retenciones-facturas-externas',
        path: a.path,
      });
    }
  }

  const onElegirArchivo = (f: File | null) => {
    marcarSucio();
    if (f) {
      const esValido = f.type === 'application/pdf'
        || f.type.startsWith('image/')
        || /\.(pdf|png|jpe?g|webp)$/i.test(f.name);
      if (!esValido) {
        setError('El archivo de la factura debe ser un PDF o una imagen (JPG, PNG, WebP).');
        return;
      }
    }
    setError(null);
    setArchivoFactura(f);
    if (archivoFacturaUrl) {
      try { URL.revokeObjectURL(archivoFacturaUrl); } catch { /* ignorar */ }
    }
    setArchivoFacturaUrl(f ? URL.createObjectURL(f) : null);
  };

  useEffect(() => {
    return () => {
      if (archivoFacturaUrl) {
        try { URL.revokeObjectURL(archivoFacturaUrl); } catch { /* ignorar */ }
      }
    };
  }, [archivoFacturaUrl]);

  const verArchivoLocal = () => {
    if (!archivoFactura || !archivoFacturaUrl) return;
    previewArchivo(archivoFacturaUrl, archivoFactura.name);
  };

  const [lineas, setLineas] = useState<LineaUI[]>(() => {
    const tipoDef = s.tipoInicial ?? (OFRECER_DIRECCION && s.direccion === 'recibida' ? 'iva' : 'islr');
    return [nuevaLinea({
      tipo: tipoDef, baseStr: numeroATexto(s.baseImponible ?? 0), ivaStr: numeroATexto(s.iva ?? 0),
    })];
  });

  useEffect(() => {
    void Promise.all([getConfigRetencion(), listConceptos(true), listProveedores()])
      .then(([c, cs, ps]) => {
        // Multi-empresa: una empresa NO-GT trae su régimen y % de su ficha.
        const base = empresaFicha ? configDesdeFicha(c, empresaFicha) : c;
        setConfigBase(base); setConfig(base); setConceptos(cs);
        const activos = ps.filter((p) => p.estado === 'activo');
        setProveedores(activos);
        const p = s.contraparteId ? activos.find((x) => x.id === s.contraparteId) : null;
        if (p) {
          setContraparte(p.razon_social); setRif(p.rif ?? '');
          const sug = sugerirSujetoPorRif(p.rif ?? '');
          const sujetoVal = sug?.sujeto ?? 'pj_domiciliada';
          setLineas((xs) => xs.map((l) => ({
            ...l,
            sujeto: sug ? sug.sujeto : l.sujeto,
            conceptoId: l.conceptoId || sugerirConceptoParaLinea(cs, l.tipo, sujetoVal),
          })));
        } else {
          setLineas((xs) => xs.map((l) => ({
            ...l,
            conceptoId: l.conceptoId || sugerirConceptoParaLinea(cs, l.tipo, l.sujeto),
          })));
        }
      })
      .catch((e) => setError(e instanceof Error ? `No se pudo leer la configuración: ${e.message}` : 'No se pudo leer la configuración.'));
    r7Disponible().then(setConR7).catch(() => setConR7(false));
  }, [s.contraparteId, empresaFicha]);

  // La tasa es la BCV de la fecha de la factura (sábado y domingo: la del lunes), no la del día en que se registra.
  useEffect(() => {
    const f = fechaTasaBcv(facturaFecha);
    if (!f) { setTasaBcv({ tasa: null, nota: 'Escribe la fecha de la factura: la tasa es la BCV de esa fecha.' }); return; }
    let vivo = true;
    const cuando = f === facturaFecha ? fechaCorta(f) : `${fechaCorta(f)}, el lunes siguiente`;
    getTasaUsdDeFecha(f)
      .then((t) => {
        if (!vivo) return;
        setTasaBcv(t != null
          ? { tasa: t, nota: `Tasa BCV del ${cuando}, por la fecha de la factura.` }
          : { tasa: null, nota: `No hay tasa BCV registrada del ${cuando}${moneda === 'Bs' ? '' : ': escríbela'}.` });
        if (moneda !== 'Bs') setTasaStr(t != null ? numeroATexto(t) : '');
      })
      .catch(() => { if (vivo) setTasaBcv({ tasa: null, nota: 'No se pudo leer la tasa BCV.' }); });
    return () => { vivo = false; };
  }, [facturaFecha, moneda]);

  // Consulta reactiva del correlativo estimado para cada impuesto según el período de la factura
  const [correlativos, setCorrelativos] = useState<Record<string, CorrelativoEstimado>>({});
  useEffect(() => {
    if (direccion !== 'practicada') return;
    const periodo = periodoDe(facturaFecha || hoyIso());
    let activo = true;

    const cargarCorrelativos = async () => {
      // C-a (D1/L1): los impuestos salen del catálogo activo (Parámetros › Impuestos),
      // no de una lista fija. Uno deshabilitado no se consulta ni se muestra. Sin datos
      // (impuestosActivos=null) caen todos: degradación segura, como hoy.
      const tipos: TipoImpuesto[] = soloImpuestosActivos(TIPOS_IMPUESTO, impuestosActivos ?? null).map((t) => t.key);
      const mapa: Record<string, CorrelativoEstimado> = {};
      for (const t of tipos) {
        // El formato del número sale de la ficha del impuesto (R2); sin ficha, del mapeo fijo.
        const fmtFicha = fichasImpuesto?.get(t)?.serieFormato;
        try {
          mapa[t] = await consultarCorrelativoEstimado(t, periodo, fmtFicha, empresaId);
        } catch {
          const fmt = fmtFicha ?? formatoSerie(t);
          mapa[t] = {
            numero: 1,
            comprobante: formatoComprobante(periodo, 1, t, fmt),
            formato: fmt,
            explicacion: 'Correlativo inicial',
          };
        }
      }
      if (activo) setCorrelativos(mapa);
    };

    void cargarCorrelativos();
    return () => { activo = false; };
  }, [direccion, facturaFecha, fichasImpuesto, empresaId, impuestosActivos]);

  const opcionesProveedor = useMemo(() => {
    const lista = proveedorIdsPendientes ? proveedores.filter((p) => proveedorIdsPendientes.has(p.id)) : proveedores;
    return lista.map((p) => ({ value: p.id, label: `${p.razon_social}${p.rif ? ` · ${p.rif}` : ''}` }));
  }, [proveedores, proveedorIdsPendientes]);

  const opcionesOrdenes = useMemo(() => {
    return ordenesPendientesFiltradas.map(({ orden: o, proveedorNombre }) => {
      const ocCod = o.oc_codigo || o.codigo || `OC-${o.id.slice(0, 8)}`;
      const prov = proveedorNombre || 'Proveedor sin nombre';
      const totalTxt = money(o.total, o.total_moneda === 'Bs' ? 'Bs' : 'USD');
      const fechaTxt = fechaCorta(o.created_at || '');
      const tieneAdjunto = Boolean(o.factura_recepcion_path);
      const label = `${ocCod} · ${prov} · ${totalTxt}`;
      const hint = `${fechaTxt}${tieneAdjunto ? ' · 📎 Factura' : ''}`;
      const keywords = [
        ocCod,
        o.codigo || '',
        prov,
        totalTxt,
        String(o.total ?? ''),
        fechaTxt,
        o.factura_recepcion_nombre || '',
        o.notas || '',
      ].filter(Boolean);

      return {
        value: o.id,
        label,
        hint,
        keywords,
      };
    });
  }, [ordenesPendientesFiltradas]);

  const opcionesBuzon = useMemo(() => {
    const candidatas = empresaId
      ? buzonPendientes.filter((b) => b.empresaId === empresaId || (empresaId === 'empresa-golden-touch' && !b.empresaId))
      : buzonPendientes;
    return candidatas.map((b) => {
      const nro = b.facturaNumero ? `Factura ${b.facturaNumero}` : 'Sin N°';
      const prov = b.proveedorNombre || b.proveedorRif || 'Proveedor';
      const totalTxt = money(b.montoTotal, b.moneda);
      const fechaTxt = fechaCorta(b.facturaFecha || b.createdAt || '');
      const label = `${nro} · ${prov} · ${totalTxt}`;
      const hint = `${fechaTxt} (${b.empresaNombre || 'GT'}) 📎`;
      const keywords = [
        nro,
        b.facturaNumero || '',
        b.facturaControl || '',
        prov,
        b.proveedorRif || '',
        totalTxt,
        String(b.montoTotal ?? ''),
        fechaTxt,
        b.empresaNombre || '',
      ].filter(Boolean);

      return {
        value: b.id,
        label,
        hint,
        keywords,
      };
    });
  }, [buzonPendientes, empresaId]);

  /** El proveedor llena razón social y RIF. El sujeto del ISLR no se toca: se sugiere en cada línea. */
  function elegirProveedor(id: string) {
    marcarSucio();
    setProveedorId(id);
    const p = proveedores.find((x) => x.id === id);
    if (p) { setContraparte(p.razon_social); setRif(p.rif ?? ''); }
  }

  function toggleImpuesto(tipo: TipoImpuesto) {
    marcarSucio();
    const existe = lineas.find((l) => l.tipo === tipo);
    if (existe) {
      if (lineas.length === 1) {
        toast(`Para quitar ${labelImpuesto(tipo)}, primero agrega el impuesto que deseas retener (ej. ISLR o ISAE).`, 'info');
        return;
      }
      setLineas((xs) => xs.filter((l) => l.tipo !== tipo));
      return;
    }
    // Gobernanza de Parámetros: comprobar si la empresa practica el impuesto según su régimen
    if (direccion === 'practicada' && !puedePracticarEmpresa(tipo, config)) {
      const motivo = (empresaFicha
        ? `La empresa no practica retención de ${labelImpuesto(tipo)} según su régimen en Parámetros.`
        : motivoNoPuedePracticar(tipo, config)) || 'La empresa no practica retenciones para este impuesto.';
      toast(motivo, 'warning');
      return;
    }
    const sujetoVal = sugerirSujetoPorRif(rif)?.sujeto ?? 'pj_domiciliada';
    const conceptoDef = sugerirConceptoParaLinea(conceptos, tipo, sujetoVal);
    const baseSugerida = (tipo === 'islr' || tipo === 'municipal') && baseNetaGravable > 0
      ? numeroATexto(baseNetaGravable)
      : tipo === 'iva' && ivaFacturaNum > 0
        ? numeroATexto(baseNetaGravable)
        : (lineas[0]?.baseStr || '0');
    setLineas((xs) => [...xs, nuevaLinea({
      tipo,
      sujeto: sujetoVal,
      conceptoId: conceptoDef,
      baseStr: baseSugerida,
      ivaStr: ivaFacturaStr || '0',
    })]);
  }

  const esManual = direccion === 'recibida';
  const tasa = nDec(tasaStr);

  // La alícuota del IVA sale de Parámetros (config.ivaAlicuota); si no hay, 16 por defecto.
  const aliIvaPct = Number(config.ivaAlicuota) > 0 ? Number(config.ivaAlicuota) : 16;
  const divisorIvaTxt = (1 + aliIvaPct / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totalFacturaNum = nDec(facturaTotal);
  const exentoNum = nDec(exentoStr);
  const ivaFacturaNum = nDec(ivaFacturaStr);
  const baseNetaGravable = Math.max(0, Math.round((totalFacturaNum - ivaFacturaNum - exentoNum) * 100) / 100);

  // Gobernanza estricta de Parámetros: en retenciones practicadas, los impuestos no autorizados se purgan
  useEffect(() => {
    if (direccion !== 'practicada') return;
    setLineas((prev) => {
      const validas = prev.filter((l) => puedePracticarEmpresa(l.tipo, config));
      if (validas.length > 0 && validas.length === prev.length) return prev;
      if (validas.length > 0) return validas;
      const primerTipo: TipoImpuesto = puedePracticarEmpresa('islr', config)
        ? 'islr'
        : (puedePracticarEmpresa('municipal', config) ? 'municipal' : (puedePracticarEmpresa('iva', config) ? 'iva' : 'islr'));
      return [nuevaLinea({
        tipo: primerTipo,
        baseStr: numeroATexto(baseNetaGravable),
        ivaStr: ivaFacturaStr,
      })];
    });
  }, [config, puedePracticarEmpresa, direccion, baseNetaGravable, ivaFacturaStr]);

  const tiposLineas = lineas.map((l) => l.tipo).join(',');
  useEffect(() => {
    let vivo = true;
    configDeFecha(configBase, facturaFecha, tiposLineas ? (tiposLineas.split(',') as TipoImpuesto[]) : [])
      .then((c) => { if (vivo) { setConfig(c); setAvisoFecha(null); } })
      .catch((e) => { if (vivo) { setConfig(configBase); setAvisoFecha(e instanceof Error ? e.message : 'No se pudieron leer los valores de esa fecha.'); } });
    return () => { vivo = false; };
  }, [configBase, facturaFecha, tiposLineas]);

  useEffect(() => {
    let vivo = true;
    if (/^\d{4}-\d{2}-\d{2}$/.test(facturaFecha)) {
      supuestosVigentes('IVA', facturaFecha).then((xs) => { if (vivo) setSupuestosIva(xs); }).catch(() => { if (vivo) setSupuestosIva(null); });
    }
    return () => { vivo = false; };
  }, [facturaFecha]);

  useEffect(() => {
    let vivo = true;
    const f = facturaFecha || fechaRetencion;
    if (/^\d{4}-\d{2}-\d{2}$/.test(f)) {
      const tiposUnicos = [...new Set(lineas.filter((l) => l.tipo !== 'igtf').map((l) => tipoAGt(l.tipo)))];
      const aConsultar = tiposUnicos.length ? tiposUnicos : ['iva' as const];
      Promise.all(aConsultar.map((t) => periodoEstaCerrado(t, f)))
        .then((ps) => { if (vivo) setPeriodoCerrado(ps.find((p) => p != null) ?? null); })
        .catch(() => { if (vivo) setPeriodoCerrado(null); });
    } else {
      setPeriodoCerrado(null);
    }
    return () => { vivo = false; };
  }, [facturaFecha, fechaRetencion, lineas]);

  const setLinea = useCallback((id: number, patch: Partial<LineaUI>) => {
    marcarSucio();
    setLineas((xs) => xs.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, [marcarSucio]);

  /** El cálculo puro de hoy de una línea (practicada); en recibida se copian los números a mano. */
  const calculoHoyDe = useCallback((l: LineaUI): CalculoRetencion => {
    const base = nDec(l.baseStr);
    const concepto = conceptos.find((c) => c.id === l.conceptoId) ?? null;
    if (l.tipo === 'iva') {
      const supuesto = supuestosIva ? supuestoAplicado(l.motivos, supuestosIva) : undefined;
      return calcularRetencionIva({ baseImponible: base, ivaFactura: nDec(l.ivaStr), motivos: l.motivos, supuesto }, config);
    }
    // El mínimo en UT y el sustraendo están en Bs: el cálculo necesita la moneda y la tasa.
    if (l.tipo === 'islr') return calcularRetencionIslr({ montoPago: base, concepto, moneda, tasa }, config);
    if (l.tipo === 'igtf') return calcularIgtf({ montoPago: base, enDivisas: true }, config);
    return calcularRetencionLocal({ montoPago: base, concepto: conceptoConAlicuotaEmpresa(concepto, config) }, l.tipo);
  }, [conceptos, config, moneda, tasa, supuestosIva]);

  // R7: con cada cambio de las líneas (o de la fecha, la moneda o la tasa), la regla vigente de cada practicada.
  const firmaReglas = JSON.stringify(lineas.map((l) => [l.id, l.tipo, l.sujeto, l.conceptoId, l.baseStr, l.ivaStr, l.motivos]));
  useEffect(() => {
    setAvisoRegla(null);
    if (!conR7 || direccion !== 'practicada' || !/^\d{4}-\d{2}-\d{2}$/.test(facturaFecha)) { setReglas({}); return; }
    let vivo = true;
    const t = setTimeout(() => {
      void Promise.all(lineas.map(async (l): Promise<[number, CalculoConRegla | null]> => {
        const base = nDec(l.baseStr);
        const supuesto = l.tipo === 'iva' && (supuestosIva ? !!supuestoAplicado(l.motivos, supuestosIva) : Object.values(l.motivos).some(Boolean));
        const c = await calcularConReglaVigente(tipoAGt(l.tipo), {
          fecha: facturaFecha, direccion: 'practicada',
          tipoDocumento,
          sujeto: l.tipo === 'iva' || l.tipo === 'igtf' ? null : sujetoAGt(l.sujeto),
          moneda, tasa: moneda === 'Bs' ? null : (tasa || null),
          pago: base, baseImponible: base, iva: nDec(l.ivaStr),
          exento: exentoStr.trim() ? nDec(exentoStr) : 0,
          subtotal: base,
          total: nDec(facturaTotal),
          supuesto, codigo: conceptos.find((x) => x.id === l.conceptoId)?.codigo ?? null,
        });
        return [l.id, c];
      }))
        .then((pares) => { if (vivo) setReglas(Object.fromEntries(pares)); })
        .catch((e) => {
          if (!vivo) return;
          setReglas({});
          setAvisoRegla(e instanceof Error ? `No se pudo leer la regla vigente: ${e.message}` : 'No se pudo leer la regla vigente.');
        });
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [conR7, direccion, facturaFecha, moneda, tasa, firmaReglas, conceptos, supuestosIva]); // eslint-disable-line react-hooks/exhaustive-deps

  /** La regla manda sobre el cálculo de hoy solo cuando hay una vigente que aplica a la línea. */
  const calculoDe = useCallback((l: LineaUI): CalculoRetencion => {
    const hoy = calculoHoyDe(l);
    const rc = reglas[l.id];
    if (!rc || direccion !== 'practicada') return hoy;
    const r = rc.resultado;
    const cual = `regla «${rc.regla.nombre}» (versión ${rc.regla.version})`;
    return {
      ...hoy,
      baseImponible: r.base, impuesto: r.impuesto,
      impuestoCausado: hoy.tipo === 'iva'
        ? r.impuesto
        : hoy.tipo === 'islr'
          // El motor ya restó el sustraendo en el paso 5: el causado es el bruto.
          ? Math.round((r.impuesto + r.sustraendo) * 100) / 100
          : hoy.impuestoCausado,
      porcentaje: r.pct ?? 0, sustraendo: r.sustraendo, montoRetenido: r.monto,
      explicacion: r.aplica ? `Calculado con la ${cual}, vigente al ${fechaCorta(facturaFecha)}.` : `No se retiene según la ${cual}: ${r.motivo ?? 'sin motivo'}.`,
    };
  }, [calculoHoyDe, reglas, direccion, facturaFecha]);

  const montoDe = useCallback((l: LineaUI): number => (esManual
    // Vacío = el calculado; «0» escrito = 0 (y pide el motivo del 0 %). Lo ilegible lo frena «ilegibles».
    ? (montoEscrito(l.montoStr, Math.round(nDec(l.baseStr) * nDec(l.pctStr)) / 100) ?? 0)
    : calculoDe(l).montoRetenido), [esManual, calculoDe]);
  const pctDe = (l: LineaUI) => (esManual ? nDec(l.pctStr) : calculoDe(l).porcentaje);

  const totalRetenido = useMemo(() => lineas.reduce((a, l) => a + montoDe(l), 0), [lineas, montoDe]);
  const entregaTardia = lineas.some((l) => l.tipo === 'iva') ? avisoEntregaIvaTardia(facturaFecha, fechaRetencion, fechaEntrega) : null;
  // C8: aviso de cordura NO bloqueante en recibida: si alguna línea retiene más que su base o su IVA.
  const avisoRecibida = useMemo(() => {
    if (!esManual) return null;
    for (const l of lineas) {
      const a = avisoRetenidoSuperaBase(montoDe(l), nDec(l.baseStr), l.tipo === 'iva' ? nDec(l.ivaStr) : 0);
      if (a) return a;
    }
    return null;
  }, [esManual, lineas, montoDe]);

  const totalRetenidoBs = enBolivares(totalRetenido, moneda, tasa);

  const conceptosDeLinea = (l: LineaUI) => conceptos.filter((c) => c.tipo === l.tipo && (c.sujeto === l.sujeto || c.sujeto === 'todos'));

  // Una practicada sin OC, CS ni compra directa queda «fuera del sistema»: se dice y se anota de dónde viene.
  const tieneDocVinculado = Boolean(documento || s.docId || (modoOrigen === 'oc' && ordenSeleccionadaId));
  const sinDocumento = direccion === 'practicada' && !tieneDocVinculado;
  const rifMal = rif.trim() !== '' && !rifValido(rif);
  // D43: el mensaje dice cuál RIF y dónde se corrige (practicada: en la ficha del proveedor).
  const textoRif = rifMal ? textoRifInvalido({ direccion, rif, nombre: contraparte }) : null;
  const ilegibles = [
    ...(moneda !== 'Bs' && leerMonto(tasaStr) == null ? ['Tasa'] : []),
    ...(leerMonto(facturaTotal) == null ? ['Total de la factura'] : []),
    ...(ivaFacturaStr.trim() !== '' && leerMonto(ivaFacturaStr) == null ? ['IVA de la factura'] : []),
    ...(exentoStr.trim() !== '' && leerMonto(exentoStr) == null ? ['Monto exento'] : []),
    ...(sinDerechoStr.trim() !== '' && leerMonto(sinDerechoStr) == null ? ['Sin derecho a crédito IVA'] : []),
    ...lineas.flatMap((l) => ([
      [l.tipo === 'iva' ? 'base imponible' : 'monto del pago', l.baseStr, true],
      ['IVA de la factura', l.ivaStr, l.tipo === 'iva'],
      ['% retenido', l.pctStr, esManual],
      ['monto retenido', l.montoStr, esManual],
    ] as Array<[string, string, boolean]>).filter(([, v, aplica]) => aplica && leerMonto(v) == null).map(([n]) => `${labelImpuesto(l.tipo)}: ${n}`)),
  ];

  function validar(): string | null {
    if (direccion === 'practicada' && !proveedorId) return 'Elige el proveedor al que se le retiene.';
    if (direccion === 'recibida' && !contraparte.trim()) return 'Indica quién nos retuvo.';
    if (textoRif) return textoRif.error;
    if (tipoDocumento !== 'factura' && !facturaAfectadaNro.trim()) {
      return 'Las notas de crédito o débito deben indicar el N° de factura afectada (PA 071, Art. 15).';
    }
    // Una factura ya registrada trae sus datos de la base (pueden ser de antes de pedir el control).
    const falta = documento ? null : faltaEnDatosFactura({ nro: facturaNro, control: facturaControl, fecha: facturaFecha }, hoyIso());
    if (falta) return falta;
    if (periodoCerrado) {
      return `El período fiscal (${nombrePeriodo(periodoCerrado)}) ya fue declarado ante el SENIAT. No se pueden registrar retenciones en períodos cerrados sin reapertura previa.`;
    }
    const faltaFechaRet = faltaEnFechaRetencion(fechaRetencion, facturaFecha, hoyIso());
    if (faltaFechaRet) return faltaFechaRet;
    const faltaEntrega = faltaEnFechaEntrega(fechaEntrega, fechaRetencion, hoyIso());
    if (faltaEntrega) return faltaEntrega;
    const faltaTotal = faltaEnTotalFactura(nDec(facturaTotal));
    if (faltaTotal) return faltaTotal;
    if (avisoFecha) return avisoFecha;
    if (avisoRegla) return avisoRegla;
    if (ilegibles.length) return `No se entiende: ${ilegibles.join(', ')}. Escribe 1.234,56 o 1234,56.`;
    if (moneda !== 'Bs' && !(tasa > 0)) return 'Indica la tasa para llevar los montos a bolívares.';
    if (sinDocumento && !nota.trim()) return 'Sin documento del sistema: indica en la nota de la factura de dónde viene.';
    if (!lineas.length) return 'Agrega al menos una línea de impuesto.';
    // Exigencia obligatoria: Sin archivo físico de factura (PDF o imagen) no hay retención
    const tieneSoporte = Boolean(soporteActivo || s.adjuntoId);
    const errorArchivo = validarArchivoFacturaObligatorio(tieneSoporte, archivoFactura);
    if (errorArchivo) return errorArchivo;
    // Regla: No se debe registrar una retención del mismo tipo para 1 Factura
    const tiposEnFormulario = new Set<TipoImpuesto>();
    for (const l of lineas) {
      if (tiposEnFormulario.has(l.tipo)) {
        return `No se puede registrar más de una retención de ${labelImpuesto(l.tipo)} para una misma factura. Cada línea debe corresponder a un impuesto diferente.`;
      }
      tiposEnFormulario.add(l.tipo);
    }
    if (documento) {
      const yaNo = lineas.find((l) => !pendientesComoTipos(documento).includes(l.tipo));
      if (yaNo) return `${labelImpuesto(yaNo.tipo)} ya no está pendiente en esta factura (ya se retuvo o se marcó «no aplica»).`;
    }
    const sujeto = sujetoDeLineas(lineas);
    if (sujeto.error) return sujeto.error;
    // Protección fiscal Decreto 1.808: si hay IVA en la factura, la base de ISLR/ISAE no puede ser igual al total con IVA
    if (ivaFacturaNum > 0 && direccion === 'practicada') {
      for (const l of lineas) {
        if ((l.tipo === 'islr' || l.tipo === 'municipal') && totalFacturaNum > 0 && Math.abs(nDec(l.baseStr) - totalFacturaNum) < 0.01) {
          return `${labelImpuesto(l.tipo)}: La base imponible coincide con el total de la factura (${facturaTotal}). Debe excluir el IVA (${ivaFacturaStr}) quedando en Bs ${numeroATexto(baseNetaGravable)} (Decreto 1.808). Indica el IVA de la factura o ajusta la base gravable.`;
        }
      }
    }
    for (const l of lineas) {
      if (direccion === 'practicada') {
        if (l.tipo === 'iva' && !puedePracticarEmpresa('iva', config)) {
          return 'La empresa no está configurada como Agente de Retención de IVA en Parámetros (Providencia SNAT/2025/000054). Debes remover la retención de IVA para registrar.';
        }
        if (l.tipo === 'municipal' && !puedePracticarEmpresa('municipal', config)) {
          return 'La empresa no está configurada como Agente de Retención Municipal (ISAE) en Parámetros. Debes remover la retención de ISAE para registrar.';
        }
        const m = motivoNoPuedePracticar(l.tipo, config);
        if (m) return `${labelImpuesto(l.tipo)}: ${m}`;
      }
      const monto = montoDe(l);
      if (monto < 0) return `${labelImpuesto(l.tipo)}: el monto no puede ser negativo.`;
      const faltaBase = faltaEnBaseImponible(nDec(l.baseStr));
      if (faltaBase) return `${labelImpuesto(l.tipo)}: ${faltaBase}`;
      if (esCeroSinMotivo(pctDe(l), monto, l.descripcion)) return `${labelImpuesto(l.tipo)}: un 0 % se registra solo con su motivo.`;
      // C3: IVA no discriminado → el IVA se deriva del total y el usuario debe confirmarlo
      // (automático pero visible). No se guarda hasta que confirme el IVA derivado vigente.
      if (l.tipo === 'iva' && l.motivos.ivaNoDiscriminado) {
        const d = desglosarIvaDeTotal(nDec(facturaTotal), nDec(exentoStr), aliIvaPct);
        if (!l.ivaDerivadoConfirmado || Math.abs(nDec(l.ivaStr) - d.iva) > 0.01) {
          return `IVA: el IVA no está discriminado en la factura. Aplica y confirma el IVA derivado del total (Bs ${numeroATexto(d.iva)}) antes de guardar.`;
        }
      }
    }
    if (totalRetenido <= 0 && !lineas.some((l) => l.tipo === 'islr' && l.descripcion.trim())) {
      return 'El monto total a retener es Bs 0,00. Si esta factura no genera retención, no es necesario registrar comprobante.';
    }
    return null;
  }

  /** Elegir una factura ya registrada: se precargan sus datos y se retiene sobre ella lo pendiente. */
  function aplicarDocumento(f: FacturaResumen) {
    marcarSucio();
    setDocumento(f); setDireccion('practicada');
    if (f.documentoId) {
      void Promise.resolve(
        supabase.from('retenciones')
          .select('comprobante_path, comprobante_nombre')
          .eq('documento_id', f.documentoId)
          .not('comprobante_path', 'is', null)
          .limit(1)
      )
        .then(({ data }) => {
          const primero = data?.[0];
          if (primero?.comprobante_path) {
            setAdjuntoExistente({
              nombre: primero.comprobante_nombre || `Factura ${f.facturaNro || ''}`,
              bucket: 'comprobantes',
              path: primero.comprobante_path,
            });
          } else {
            setAdjuntoExistente(null);
          }
        })
        .catch(() => { setAdjuntoExistente(null); });
    } else {
      setAdjuntoExistente(null);
    }
    if (f.tipoDocumento && (f.tipoDocumento === 'factura' || f.tipoDocumento === 'nota_credito' || f.tipoDocumento === 'nota_debito')) {
      setTipoDocumento(f.tipoDocumento as TipoDocumento);
    }
    if (f.facturaAfectadaNro) setFacturaAfectadaNro(f.facturaAfectadaNro);
    if (f.proveedorId) setProveedorId(f.proveedorId);
    setContraparte(f.razonSocial ?? ''); setRif(f.rif ?? '');
    setFacturaNro(f.facturaNro ?? ''); setFacturaControl(f.facturaControl ?? ''); setFacturaFecha(f.facturaFecha ?? '');
    setMoneda(f.moneda || 'Bs'); if (f.tasa) setTasaStr(numeroATexto(f.tasa));
    setFacturaTotal(numeroATexto(f.facturaTotal ?? 0));
    if (f.ivaMonto != null) setIvaFacturaStr(numeroATexto(f.ivaMonto));
    if (f.exento != null) setExentoStr(numeroATexto(f.exento));
    const base = f.facturaTotal != null ? Math.max(0, f.facturaTotal - (f.ivaMonto ?? 0) - (f.exento ?? 0)) : 0;
    const tipos = pendientesComoTipos(f);
    const sujeto = sugerirSujetoPorRif(f.rif ?? '')?.sujeto ?? 'pj_domiciliada';
    setLineas((tipos.length ? tipos : ['iva' as TipoImpuesto]).map((t) => nuevaLinea({
      tipo: t, sujeto, baseStr: numeroATexto(base), ivaStr: numeroATexto(f.ivaMonto ?? 0),
    })));
  }
  function soltarDocumento() { marcarSucio(); setDocumento(null); setAdjuntoExistente(null); }

  useEffect(() => {
    let vivo = true;
    void r10Disponible().then((v) => { if (vivo) setConR10(v); });
    return () => { vivo = false; };
  }, []);
  // Desde «Facturas registradas»: se abre ya sobre esa factura.
  useEffect(() => { if (s.documento) aplicarDocumento(s.documento); }, [s.documento]); // eslint-disable-line react-hooks/exhaustive-deps

  async function emitir() {
    const falla = validar();
    if (falla) { setError(falla); return; }
    setError(null); setSaving(true);
    try {
      const periodo = periodoDe(facturaFecha);
      const exentoNum = exentoStr.trim() ? nDec(exentoStr) : null;
      const finalDocKind = modoOrigen === 'oc' && ordenSeleccionadaId
        ? 'oc'
        : modoOrigen === 'buzon' && buzonSeleccionadaId
          ? 'manual'
          : s.docKind ?? 'manual';

      const finalDocId = modoOrigen === 'oc' && ordenSeleccionadaId
        ? ordenSeleccionadaId
        : modoOrigen === 'manual'
          ? s.docId ?? null
          : null;

      // Si la factura fue ensamblada en Modo Avanzado, se preserva el desglose renglón a renglón
      const renglonesTexto = modoCaptura === 'valery' && renglonesValery.length > 0
        ? [
            '--- Desglose de Renglones de Factura (Modo Avanzado) ---',
            ...renglonesValery.map((r, i) => {
              const cant = Number(r.cantidad) || 0;
              const pu = Number(r.precioUnitario) || 0;
              const sub = Math.round(cant * pu * 100) / 100;
              const aliStr = r.alicuota === 0 ? 'Exento' : `${r.alicuota}%`;
              return `${i + 1}. ${r.descripcion || 'Sin descripción'} | Cant: ${cant} | P.U: Bs ${pu.toLocaleString('es-VE', { minimumFractionDigits: 2 })} | Alícuota: ${aliStr} | Total: Bs ${sub.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
            }),
            `Totales calculados: Base 16%: Bs ${calculoValery.base16.toLocaleString('es-VE', { minimumFractionDigits: 2 })} | Base 8%: Bs ${calculoValery.base8.toLocaleString('es-VE', { minimumFractionDigits: 2 })} | Exento: Bs ${calculoValery.exento.toLocaleString('es-VE', { minimumFractionDigits: 2 })} | IVA: Bs ${calculoValery.totalIva.toLocaleString('es-VE', { minimumFractionDigits: 2 })} | Total: Bs ${calculoValery.totalFactura.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`,
          ].join('\n')
        : null;

      if (modoCaptura === 'valery' && renglonesValery.length > 0 && facturaNro.trim()) {
        try {
          localStorage.setItem(`factura_renglones:${facturaNro.trim()}`, JSON.stringify(renglonesValery));
        } catch {
          // localStorage no crítico
        }
      }

      const notaFinal = [
        nota.trim() || null,
        modoOrigen === 'buzon' && buzonSeleccionadaId ? `Procedente de Buzón Móvil (ID: ${buzonSeleccionadaId})` : null,
        renglonesTexto,
      ].filter(Boolean).join('\n\n') || null;

      const facturaNueva: FacturaNueva = {
        direccion,
        tipoDocumento,
        facturaAfectadaNro: tipoDocumento !== 'factura' ? facturaAfectadaNro.trim() || null : null,
        docKind: finalDocKind, docId: finalDocId, adjuntoId: s.adjuntoId ?? null,
        contraparteId: direccion === 'practicada' ? proveedorId || null : null, contraparteRif: rif.trim() || null, contraparteNombre: contraparte.trim() || null,
        // El sujeto del ISLR es del proveedor: va en la cabecera (antes llegaba null).
        contraparteSujeto: sujetoDeLineas(lineas).sujeto,
        facturaNro: facturaNro.trim() || null, facturaControl: facturaControl.trim() || null,
        facturaFecha, facturaTotal: facturaTotal.trim() ? nDec(facturaTotal) : null,
        exento: exentoNum,
        ivaAlicuota: ivaFacturaStr.trim() && nDec(ivaFacturaStr) > 0 ? aliIvaPct : null,
        ivaMonto: ivaFacturaStr.trim() ? nDec(ivaFacturaStr) : (lineas.find((x) => x.tipo === 'iva') ? nDec(lineas.find((x) => x.tipo === 'iva')!.ivaStr) : null),
        moneda, tasa: moneda === 'Bs' ? null : tasa, periodo,
        nota: notaFinal, valorUt: config.valorUt, empresaId, actor, actorName,
      };
      const lineasNuevas: LineaFacturaNueva[] = lineas.map((l) => {
        const calc = calculoDe(l);
        const monto = montoDe(l);
        return {
          tipo: l.tipo,
          base: esManual ? nDec(l.baseStr) : calc.baseImponible,
          porcentaje: pctDe(l),
          monto,
          sustraendo: esManual ? null : calc.sustraendo,
          ivaAlicuota: l.tipo === 'iva'
            ? (esManual ? null : calc.alicuota)
            : (ivaFacturaStr.trim() && nDec(ivaFacturaStr) > 0 ? aliIvaPct : null),
          ivaMonto: l.tipo === 'iva'
            ? (esManual ? nDec(l.ivaStr) : calc.impuesto)
            : (ivaFacturaStr.trim() && nDec(ivaFacturaStr) > 0 ? nDec(ivaFacturaStr) : null),
          impuestoCausado: l.tipo === 'iva'
            ? (esManual ? nDec(l.ivaStr) : calc.impuestoCausado)
            : (ivaFacturaStr.trim() && nDec(ivaFacturaStr) > 0 ? nDec(ivaFacturaStr) : (nDec(l.ivaStr) > 0 ? nDec(l.ivaStr) : 0)),
          sinDerechoCreditoIva: l.tipo === 'iva' ? (sinDerechoStr.trim() ? nDec(sinDerechoStr) : 0) : null,
          fechaEntrega,
          // El texto del supuesto queda como foto en la retención.
          motivo: l.tipo === 'iva' && !esManual
            ? (supuestosIva ? supuestoAplicado(l.motivos, supuestosIva)?.texto ?? null : motivoCienTexto(l.motivos))
            : null,
          moneda,
          tasa: moneda === 'Bs' ? null : tasa,
          baseBs: enBolivares(esManual ? nDec(l.baseStr) : calc.baseImponible, moneda, tasa) || null,
          montoBs: enBolivares(monto, moneda, tasa) || null,
          conceptoCodigo: l.tipo === 'islr' ? (l.conceptoId.split(':')[0] || null) : null,
          conceptoNombre: conceptos.find((c) => c.id === l.conceptoId)?.nombre ?? null,
          // El ISAE es del municipio de la empresa (antes llegaba null).
          municipio: municipioDeLinea(l.tipo, config),
          descripcion: l.descripcion.trim() || null,
          quincena: l.tipo === 'iva' ? quincenaDe(facturaFecha) : null,
          comprobanteNro: esManual ? (l.numeroStr.trim() || null) : null,
          // La fecha de la línea es la de la retención; el período y la quincena salen de la factura.
          fecha: fechaRetencion,
          regla: !esManual && reglas[l.id] ? columnasDeRegla(reglas[l.id] as CalculoConRegla) : null,
        };
      });
      const etiquetaDoc = tipoDocumento === 'factura' ? `Factura ${facturaNro}` : tipoDocumento === 'nota_credito' ? `Nota de crédito ${facturaNro}` : `Nota de débito ${facturaNro}`;
      const res = documento
        ? await retenerDespues(documento, lineasNuevas, { periodo, actorName, valorUt: config.valorUt })
        : await registrarFactura(facturaNueva, lineasNuevas);
      if (archivoFactura && res.lineas?.length) {
        for (const l of res.lineas) {
          try {
            await adjuntarComprobante(l.id, archivoFactura, 'Factura');
          } catch {
            // Continúa sin frenar la notificación
          }
        }
      }
      notify(`${etiquetaDoc} · ${res.lineas.length} línea(s) retenida(s) · ${money(totalRetenido, moneda)}`, 'success', { link: '#/app/retenciones' });
      if (finalDocKind === 'oc' && finalDocId) {
        void supabase.from('ordenes').update({
          retencion_finalizada: true,
          retencion_finalizada_por: actorName || actor,
          retencion_finalizada_en: new Date().toISOString(),
        }).eq('id', finalDocId);
      }
      if (modoOrigen === 'buzon' && buzonSeleccionadaId) {
        void actualizarEstatusFacturaBuzon(buzonSeleccionadaId, 'retenida').catch(() => {});
      }
      // No se cierra aún: se muestra el éxito con «Compartir por WhatsApp».
      setResultado(res);
      setSaving(false);
      // Si la OC ya está pagada, se lee el monto neto de caja (lectura cruzada a Tesorería, solo lectura).
      const prim = res.lineas[0];
      if (prim?.docKind === 'oc' && prim.docId) {
        void montoPagadoDeOrden(prim.docId).then((p) => setPagoResultado(p)).catch(() => { /* sin monto: queda «✓ Pagada» o «Por pagar» */ });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la factura.');
      setSaving(false);
    }
  }

  if (resultado) {
    const cerrar = () => onHecho(resultado);
    const datos = datosMensajeDeRetenciones(resultado.lineas, {
      empresaAgente: config.razonSocial ?? '',
      // Aplicables = lo retenido ahora + lo que quedaba pendiente de esa factura (para las «no aplicadas»).
      aplicables: [...new Set<TipoImpuesto>([...resultado.lineas.map((l) => l.tipo), ...(documento ? pendientesComoTipos(documento) : [])])],
      pagada: !!pagoResultado,
      montoPagado: pagoResultado?.monto ?? null,
      monedaPago: pagoResultado?.moneda ?? null,
    });
    return (
      <Modal title="✅ Retención registrada" size="lg" onClose={cerrar}
        footer={<button type="button" className="btn btn-primary" onClick={cerrar}>Cerrar</button>}>
        <div className="card" style={{ marginBottom: '.75rem', borderColor: 'var(--primary)' }}>
          <strong>{resultado.lineas.length} retención(es) registrada(s)</strong> de {datos.proveedorNombre}
          {datos.ocNumero ? ` · ${datos.ocNumero}` : ''}.
        </div>
        <p className="muted" style={{ marginBottom: '.5rem' }}>Comparte el resumen por WhatsApp:</p>
        <CompartirWhatsapp texto={mensajeRetencion(datos)} />
      </Modal>
    );
  }

  return (
    <Modal
      title={documento ? '🧾 Retener sobre una factura registrada' : '🧾 Registrar retención por factura'}
      size="xl"
      className="modal-retencion-centrado"
      style={{
        width: 'min(1100px, calc(100vw - 2rem))',
        maxWidth: 'min(1100px, calc(100vw - 2rem))',
        height: 'auto',
        maxHeight: '94vh',
        borderRadius: '14px',
        border: '1px solid var(--border)',
        margin: 'auto',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
      }}
      onClose={pedirCierre}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={pedirCierre} disabled={saving}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void emitir()} disabled={saving || !lineas.length}>
            {saving ? 'Guardando…' : `${documento ? 'Retener' : 'Registrar'} · ${money(totalRetenido, moneda)}`}
          </button>
        </>
      )}>
      {dialogo}
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

      {/* ── Cintillo de Empresa Receptora Responsable ── */}
      {empresaFicha ? (
        <div style={{
          margin: '0 0 .75rem 0',
          padding: '.55rem .85rem',
          background: 'rgba(59, 130, 246, 0.08)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '.5rem',
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <span style={{ fontSize: '1.15rem' }}>🏢</span>
            <span style={{ fontSize: '.84rem', color: 'var(--text-normal)' }}>
              Empresa agente de retención: <strong>{empresaFicha.nombre}</strong> <code style={{ fontSize: '.78rem', padding: '1px 5px' }}>{empresaFicha.rif}</code>
            </span>
          </div>
          <span style={{ fontSize: '.75rem', color: 'var(--primary)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
            📱 Recepción vía Buzón Móvil (ajeno al flujo de compras)
          </span>
        </div>
      ) : (
        <div style={{
          margin: '0 0 .75rem 0',
          padding: '.5rem .85rem',
          background: 'rgba(245, 158, 11, 0.06)',
          border: '1px solid rgba(245, 158, 11, 0.25)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '.5rem',
          flexWrap: 'wrap',
          fontSize: '.83rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <span style={{ fontSize: '1.05rem' }}>🏢</span>
            <span>Empresa agente de retención: <strong>{config.razonSocial || 'Golden Touch 1127, C.A.'}</strong> <code style={{ fontSize: '.78rem', padding: '1px 5px' }}>{config.rif || 'J-50129993-5'}</code></span>
          </div>
          <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>
            🛒 Ciclo Compras / OCs + 📱 Buzón Móvil
          </span>
        </div>
      )}

      {/* ── 1. Origen y Vinculación con OC / Buzón ── */}
      {direccion === 'practicada' && !documento && (
        <div className="card" style={{ marginBottom: '.75rem', background: 'rgba(255, 255, 255, 0.02)', borderColor: 'var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem', flexWrap: 'wrap', gap: '.4rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
              <span style={{ fontSize: '.95rem' }}>📂</span>
              <label style={{ margin: 0, fontWeight: 700, fontSize: '.86rem', color: 'var(--text-normal)' }}>
                1. ¿De dónde proviene esta factura?
              </label>
            </div>
            <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
              {!empresaFicha && (
                <button
                  type="button"
                  className={`btn btn-sm ${modoOrigen === 'oc' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => { marcarSucio(); setModoOrigen('oc'); }}
                >
                  📄 Orden de Compra (OC) {ordenesPendientes.length > 0 && `(${ordenesPendientes.length})`}
                </button>
              )}
              <button
                type="button"
                className={`btn btn-sm ${modoOrigen === 'buzon' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => { marcarSucio(); setModoOrigen('buzon'); }}
              >
                📱 Buzón Móvil {buzonPendientes.length > 0 && `(${buzonPendientes.length})`}
              </button>
              <button
                type="button"
                className={`btn btn-sm ${modoOrigen === 'manual' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => { marcarSucio(); setModoOrigen('manual'); setOrdenSeleccionadaId(''); setBuzonSeleccionadaId(''); }}
              >
                🏷️ Compra sin OC (Gasto directo)
              </button>
            </div>
          </div>

          {modoOrigen === 'oc' && (
            <div style={{ marginTop: '.35rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.25rem' }}>
                <label style={{ fontSize: '.82rem', fontWeight: 600, margin: 0 }}>
                  🔍 Buscar y seleccionar Orden de Compra (OC) pendiente ({ordenesPendientesFiltradas.length}):
                </label>
                {ordenSeleccionadaId && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    style={{ fontSize: '.72rem', padding: '1px 6px', color: 'var(--text-muted)' }}
                    onClick={() => { marcarSucio(); setOrdenSeleccionadaId(''); }}
                  >
                    ✕ Limpiar selección
                  </button>
                )}
              </div>
              <SearchSelect
                value={ordenSeleccionadaId}
                onChange={elegirOrden}
                options={opcionesOrdenes}
                placeholder="Escribe código de OC (ej. OC-2026-0152), proveedor o monto para buscar…"
              />
              {ordenSeleccionadaId ? (
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: '.45rem',
                  padding: '.4rem .65rem',
                  borderRadius: '6px',
                  background: 'rgba(34, 197, 94, 0.08)',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  flexWrap: 'wrap',
                  gap: '.4rem',
                }}>
                  <small style={{ color: 'var(--success, #22c55e)', fontWeight: 600, fontSize: '.82rem' }}>
                    ✓ Vinculada a {ordenesPendientes.find((x) => x.orden.id === ordenSeleccionadaId)?.orden.oc_codigo || 'la OC'} · {contraparte} · {money(totalFacturaNum, moneda)}
                  </small>
                  <small className="muted" style={{ fontSize: '.75rem' }}>
                    Al registrar, la OC se marcará como «Retenida» automáticamente.
                  </small>
                </div>
              ) : (
                <small className="hint muted" style={{ display: 'block', marginTop: '.25rem' }}>
                  💡 Puedes escribir para filtrar por proveedor, N° de OC, fecha o monto. Si hay órdenes con montos iguales, verás su fecha y código para diferenciarlas.
                </small>
              )}
            </div>
          )}

          {modoOrigen === 'buzon' && (
            <div style={{ marginTop: '.35rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.25rem' }}>
                <label style={{ fontSize: '.82rem', fontWeight: 600, margin: 0 }}>
                  🔍 Buscar y seleccionar factura del Buzón Móvil ({buzonPendientes.length}):
                </label>
                {buzonSeleccionadaId && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    style={{ fontSize: '.72rem', padding: '1px 6px', color: 'var(--text-muted)' }}
                    onClick={() => { marcarSucio(); setBuzonSeleccionadaId(''); }}
                  >
                    ✕ Limpiar selección
                  </button>
                )}
              </div>
              <SearchSelect
                value={buzonSeleccionadaId}
                onChange={elegirFacturaBuzon}
                options={opcionesBuzon}
                placeholder="Escribe N° de factura, proveedor o monto del buzón…"
              />
              {buzonSeleccionadaId ? (
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: '.45rem',
                  padding: '.4rem .65rem',
                  borderRadius: '6px',
                  background: 'rgba(34, 197, 94, 0.08)',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  flexWrap: 'wrap',
                  gap: '.4rem',
                }}>
                  <small style={{ color: 'var(--success, #22c55e)', fontWeight: 600, fontSize: '.82rem' }}>
                    ✓ Soporte y datos importados del Buzón Móvil ({contraparte || 'Proveedor'} · {money(totalFacturaNum, moneda)}).
                  </small>
                  <small className="muted" style={{ fontSize: '.75rem' }}>
                    Al emitir, la factura quedará marcada como «Retenida».
                  </small>
                </div>
              ) : (
                <small className="hint muted" style={{ display: 'block', marginTop: '.25rem' }}>
                  💡 Escribe el número de la factura o el nombre del proveedor para encontrar rápidamente las facturas enviadas desde la app móvil.
                </small>
              )}
            </div>
          )}

          {modoOrigen === 'manual' && (
            <small className="hint muted" style={{ display: 'block', marginTop: '.25rem' }}>
              Gasto directo o compra sin orden previa en el sistema. Quedará en el libro registrada como «Fuera del sistema».
            </small>
          )}
        </div>
      )}

      {/* ── 2. Soporte Digital Obligatorio ── */}
      {soporteActivo ? (
        <div className="card" style={{
          marginBottom: '.75rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '.6rem',
          borderColor: 'rgba(34, 197, 94, 0.4)',
          background: 'rgba(34, 197, 94, 0.05)',
          padding: '.8rem 1rem',
          borderRadius: '10px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
            <span style={{ fontSize: '1.4rem' }}>📄</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.88rem', color: 'var(--text-normal)' }}>
                Factura respaldada en el sistema: <span style={{ color: 'var(--primary)' }}>{soporteActivo.nombre}</span>
              </div>
              <small className="muted" style={{ fontSize: '.75rem' }}>
                Enlazada automáticamente al expediente fiscal de la compra.
              </small>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ fontWeight: 600, color: 'var(--primary)' }}
            onClick={() => { urlFacturaDeOrigen(soporteActivo).then((u) => previewArchivo(u, soporteActivo.nombre)).catch((e) => setError(e instanceof Error ? e.message : 'No se pudo abrir el archivo.')); }}
          >
            👁 Ver factura
          </button>
        </div>
      ) : archivoFactura ? (
        <div className="card" style={{
          marginBottom: '.75rem',
          border: '1.5px solid rgba(34, 197, 94, 0.4)',
          borderRadius: '10px',
          padding: '.8rem 1rem',
          background: 'rgba(34, 197, 94, 0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '.6rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem' }}>
            <span style={{ fontSize: '1.5rem' }}>📄</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.88rem', color: 'var(--text-normal)' }}>
                {archivoFactura.name}
              </div>
              <small style={{ color: 'var(--success, #22c55e)', fontSize: '.76rem', fontWeight: 600 }}>
                ✓ Archivo listo ({(archivoFactura.size / 1024).toFixed(1)} KB) · Respaldo digital adjunto
              </small>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={verArchivoLocal}
              title="Abrir visor para cotejar datos de la factura"
              style={{ color: 'var(--primary)', fontWeight: 600 }}
            >
              👁 Ver factura cargada
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => onElegirArchivo(null)}
              title="Quitar archivo seleccionado"
              style={{ color: 'var(--text-muted)' }}
            >
              ✕ Quitar
            </button>
          </div>
        </div>
      ) : (
        <div
          className="card"
          onClick={() => fileInputRef.current?.click()}
          style={{
            marginBottom: '.75rem',
            border: '1.5px dashed rgba(245, 158, 11, 0.45)',
            borderRadius: '10px',
            padding: '1rem 1.2rem',
            background: 'rgba(245, 158, 11, 0.03)',
            cursor: 'pointer',
            textAlign: 'center',
            transition: 'all .2s ease',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            style={{ display: 'none' }}
            onChange={(e) => onElegirArchivo(e.target.files?.[0] ?? null)}
          />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.25rem' }}>
            <span style={{ fontSize: '1.5rem' }}>📎</span>
            <div style={{ fontWeight: 700, fontSize: '.88rem', color: 'var(--text-normal)' }}>
              Factura de respaldo (PDF o imagen) <span style={{ color: 'var(--danger, #ef4444)', fontSize: '.76rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.1)', marginLeft: '.4rem' }}>* Obligatorio SENIAT</span>
            </div>
            <small style={{ color: 'var(--text-muted)', fontSize: '.76rem' }}>
              Haz clic para seleccionar el archivo o arrástralo aquí para adjuntarlo al expediente de retención.
            </small>
          </div>
        </div>
      )}

      {documento && (
        <div className="card" style={{ borderColor: 'var(--primary)', marginBottom: '.75rem' }}>
          <small>
            Retienes sobre la factura N° <strong className="mono">{documento.facturaNro ?? '—'}</strong> ya registrada
            {documento.razonSocial ? ` de ${documento.razonSocial}` : ''}. Por retener: <strong>{documento.pendientes.map(rotuloImpuesto).join(', ') || 'nada'}</strong>
            {Object.keys(documento.retenido).length > 0 && <> · ya retenido: {Object.keys(documento.retenido).map(rotuloImpuesto).join(', ')}</>}.
            Sus datos no se cambian aquí.
          </small>
        </div>
      )}

      {sinDocumento && !documento && !avisoSinDocDescartado && modoOrigen === 'manual' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '.6rem',
          padding: '.55rem .85rem',
          borderRadius: '8px',
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.25)',
          marginBottom: '.85rem',
          fontSize: '.82rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', color: 'var(--text-normal)' }}>
            <span style={{ fontSize: '1.05rem' }}>📄</span>
            <span>
              <strong>Factura directa / sin OC:</strong> Ingresa los datos de la factura fiscal y adjunta el soporte digital. Quedará registrada para el control y emisión de comprobantes.
            </span>
          </div>
          <button
            type="button"
            onClick={descartarAvisoSinDoc}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted, #888)',
              fontSize: '1rem',
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: '4px',
              lineHeight: 1,
            }}
            title="Ocultar aviso"
            aria-label="Cerrar aviso"
          >
            ✕
          </button>
        </div>
      )}

      {OFRECER_DIRECCION && (
      <div className="form-row">
        <label>¿Quién retuvo?</label>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          {DIRECCIONES.map((d) => {
            const ningunImpuesto = !!fichasImpuesto
              && !soloImpuestosActivos(TIPOS_IMPUESTO, impuestosActivos ?? null).some((t) => admiteDireccion(fichasImpuesto.get(t.key), d.key));
            return (
            <label key={d.key} className="card" title={ningunImpuesto ? `Ningún impuesto activo admite «${d.label.toLowerCase()}».` : undefined} style={{
              margin: 0, padding: '.45rem .8rem', cursor: ningunImpuesto ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '.4rem',
              borderColor: direccion === d.key ? 'var(--primary)' : 'var(--border)', opacity: ningunImpuesto ? 0.5 : 1,
            }}>
              <input type="radio" checked={direccion === d.key} disabled={ningunImpuesto} onChange={() => { marcarSucio(); setDireccion(d.key); }} />
              <span style={{ fontWeight: 600 }}>{d.label}</span>
            </label>
            );
          })}
        </div>
      </div>
      )}

      {/* ── 3. Proveedor y Moneda ── */}
      <div className="card" style={{ marginBottom: '.75rem', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem', flexWrap: 'wrap', gap: '.4rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
            <span style={{ fontSize: '.95rem' }}>🏢</span>
            <label style={{ margin: 0, fontWeight: 700, fontSize: '.86rem', color: 'var(--text-normal)' }}>
              {direccion === 'recibida' ? 'Cliente que nos retuvo' : 'Proveedor a retener'}
            </label>
          </div>
          {direccion === 'practicada' && proveedorId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
              {verificandoHistorialProv ? (
                <small style={{ color: 'var(--text-muted)', fontSize: '.74rem' }}>⏳ Verificando historial fiscal...</small>
              ) : tieneRetencionesPrevias === true ? (
                <span style={{
                  fontSize: '.72rem',
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: 'var(--danger, #ef4444)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '.3rem',
                }}>
                  🔒 Con retenciones previas ({cantRetencionesPrevias}) · Datos protegidos (SENIAT)
                </span>
              ) : tieneRetencionesPrevias === false ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: '.72rem',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    background: 'rgba(34, 197, 94, 0.1)',
                    color: 'var(--success, #22c55e)',
                    border: '1px solid rgba(34, 197, 94, 0.25)',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '.3rem',
                  }}>
                    🟢 Sin retenciones previas · Editable
                  </span>
                  {!editandoProveedor && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ fontSize: '.72rem', padding: '1px 7px', color: 'var(--primary)', borderColor: 'var(--primary)' }}
                      onClick={iniciarEdicionProveedor}
                      title="Editar Razón Social o RIF del proveedor en el catálogo"
                    >
                      ✏️ Editar proveedor
                    </button>
                  )}
                  {!documento && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ fontSize: '.72rem', padding: '1px 7px', color: 'var(--text-muted)' }}
                      onClick={() => { setProveedorId(''); setContraparte(''); setRif(''); setEditandoProveedor(false); }}
                      title="Cambiar a otro proveedor"
                    >
                      🔄 Cambiar
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Panel inline de edición de proveedor (si no tiene retenciones previas) */}
        {editandoProveedor && (
          <div style={{
            marginBottom: '.65rem',
            padding: '.65rem .85rem',
            borderRadius: '8px',
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
          }}>
            <div style={{ fontWeight: 700, fontSize: '.82rem', color: 'var(--text-normal)', marginBottom: '.4rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
              <span>✏️</span> Corregir Razón Social y RIF del proveedor
              <small className="muted" style={{ fontWeight: 400, marginLeft: '.3rem' }}>(Este proveedor no tiene comprobantes históricos emitidos)</small>
            </div>
            <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="form-row" style={{ flex: '2 1 200px', margin: 0 }}>
                <label style={{ fontSize: '.76rem' }}>Razón social corregida</label>
                <input
                  className="input"
                  style={{ fontSize: '.85rem', padding: '.4rem .6rem' }}
                  value={nombreProvEditado}
                  onChange={(e) => setNombreProvEditado(e.target.value)}
                  placeholder="Nombre o razón social fiscal"
                />
              </div>
              <div className="form-row" style={{ flex: '1 1 140px', margin: 0 }}>
                <label style={{ fontSize: '.76rem' }}>RIF corregido</label>
                <input
                  className="input mono"
                  style={{ fontSize: '.85rem', padding: '.4rem .6rem' }}
                  value={rifProvEditado}
                  onChange={(e) => setRifProvEditado(e.target.value)}
                  placeholder="J-12345678-9"
                  maxLength={15}
                />
              </div>
              <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={guardarEdicionProveedor}
                  disabled={guardandoProveedor}
                  style={{ fontSize: '.78rem', padding: '.4rem .8rem' }}
                >
                  {guardandoProveedor ? 'Guardando…' : '💾 Guardar'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setEditandoProveedor(false)}
                  style={{ fontSize: '.78rem', padding: '.4rem .6rem' }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          <div className="form-row" style={{ flex: '2 1 240px' }}>
            <label>{direccion === 'recibida' ? 'Quién nos retuvo' : 'A quién le retenemos'}</label>
            {direccion === 'practicada' ? (
              <SearchSelect
                value={proveedorId}
                onChange={elegirProveedor}
                options={opcionesProveedor}
                placeholder="Buscar proveedor por nombre o RIF…"
                disabled={Boolean(documento || (s.contraparteId && tieneRetencionesPrevias === true))}
              />
            ) : (
              <input className="input" value={contraparte} onChange={(e) => { marcarSucio(); setContraparte(e.target.value); }} placeholder="Razón social" />
            )}
          </div>
          <div className="form-row" style={{ flex: '1 1 150px' }}>
            <label>RIF</label>
            <input
              className="input mono"
              value={rif}
              onChange={(e) => { marcarSucio(); setRif(e.target.value); }}
              placeholder="J-XXXXXXXX-X"
              readOnly={direccion === 'practicada' && Boolean(proveedorId) && tieneRetencionesPrevias !== false}
            />
            {textoRif && (
              <small className="hint" style={{ color: 'var(--danger)' }}>
                {textoRif.hint}
                {direccion === 'practicada' && proveedorId && verProveedores && <> <a href={`#${rutaFichaProveedor(proveedorId)}`}>Abrir la ficha</a></>}
              </small>
            )}
          </div>
          <div className="form-row" style={{ flex: '0 1 auto' }}>
            <label style={{ fontSize: '.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
              Moneda *
            </label>
            <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
              <button
                type="button"
                className={`btn btn-sm ${moneda === 'USD' ? 'btn-primary' : 'btn-ghost'}`}
                style={{
                  padding: '5px 12px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '.86rem',
                  border: moneda === 'USD' ? '2px solid var(--primary, #f59e0b)' : '1px solid var(--border)',
                  background: moneda === 'USD' ? 'rgba(245, 158, 11, 0.14)' : 'rgba(255, 255, 255, 0.03)',
                  color: moneda === 'USD' ? 'var(--primary, #f59e0b)' : 'var(--text-normal)',
                  cursor: documento ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                disabled={!!documento}
                onClick={() => { marcarSucio(); setMoneda('USD'); }}
              >
                💵 Dólares ($)
              </button>
              <button
                type="button"
                className={`btn btn-sm ${moneda === 'Bs' ? 'btn-primary' : 'btn-ghost'}`}
                style={{
                  padding: '5px 12px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '.86rem',
                  border: moneda === 'Bs' ? '2px solid var(--primary, #f59e0b)' : '1px solid var(--border)',
                  background: moneda === 'Bs' ? 'rgba(245, 158, 11, 0.14)' : 'rgba(255, 255, 255, 0.03)',
                  color: moneda === 'Bs' ? 'var(--primary, #f59e0b)' : 'var(--text-normal)',
                  cursor: documento ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                disabled={!!documento}
                onClick={() => { marcarSucio(); setMoneda('Bs'); }}
              >
                🇻🇪 Bolívares (Bs)
              </button>
            </div>
          </div>
          {moneda !== 'Bs' && (
            <div className="form-row" style={{ flex: '0 1 140px' }}>
              <label>Tasa (Bs por $)</label>
              <input className="input mono" value={tasaStr} onChange={(e) => { marcarSucio(); setTasaStr(e.target.value); }} inputMode="decimal" />
              <SeLeyo texto={tasaStr} decimales={4} />
            </div>
          )}
          {tasaBcv && <small className="hint muted" style={{ alignSelf: 'center', flex: '1 1 100%' }}>{tasaBcv.nota}</small>}
        </div>
      </div>

      {/* ── 4. Datos del Documento e Importes ── */}
      <div className="card" style={{ marginBottom: '.75rem', background: 'rgba(255, 255, 255, 0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.65rem' }}>
          <span style={{ fontSize: '.95rem' }}>🧾</span>
          <label style={{ margin: 0, fontWeight: 700, fontSize: '.86rem', color: 'var(--text-normal)' }}>
            4. Datos Fiscales del Documento
          </label>
        </div>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
          <div className="form-row" style={{ flex: '1 1 140px' }}>
            <label>Tipo de documento</label>
            <select className="select" value={tipoDocumento} disabled={!!documento}
              onChange={(e) => { marcarSucio(); setTipoDocumento(e.target.value as TipoDocumento); }}>
              <option value="factura">Factura</option>
              <option value="nota_credito">Nota de crédito</option>
              <option value="nota_debito">Nota de débito</option>
            </select>
          </div>
          <div className="form-row" style={{ flex: '1 1 140px' }}>
            <label>{tipoDocumento === 'factura' ? 'N° de factura' : tipoDocumento === 'nota_credito' ? 'N° Nota de crédito' : 'N° Nota de débito'}</label>
            {conR10 && direccion === 'practicada' && tipoDocumento === 'factura' ? (
              <BuscadorFactura valor={facturaNro} onTexto={(t) => { marcarSucio(); setFacturaNro(t); }} proveedorId={proveedorId || null}
                onElegir={aplicarDocumento} elegida={documento} onSoltar={s.documento ? undefined : soltarDocumento} />
            ) : (
              <input className="input mono" value={facturaNro} onChange={(e) => { marcarSucio(); setFacturaNro(e.target.value); }} placeholder="Número fiscal" maxLength={30} />
            )}
          </div>
          {tipoDocumento !== 'factura' && (
            <div className="form-row" style={{ flex: '1 1 150px' }}>
              <label>N° Factura afectada <span style={{ color: 'var(--danger)' }}>*</span></label>
              <input className="input mono" value={facturaAfectadaNro} readOnly={!!documento}
                onChange={(e) => { marcarSucio(); setFacturaAfectadaNro(e.target.value); }} placeholder="Factura que modifica" maxLength={30} />
              <small className="hint muted">Requerido por PA 071, Art. 15.</small>
            </div>
          )}
          <div className="form-row" style={{ flex: '1 1 120px' }}>
            <label>N° de control</label>
            <input className="input mono" value={facturaControl} readOnly={!!documento} onChange={(e) => { marcarSucio(); setFacturaControl(e.target.value); }} maxLength={30} />
          </div>
          <div className="form-row" style={{ flex: '1 1 140px' }}>
            <label>Fecha {tipoDocumento === 'factura' ? 'de la factura' : 'del documento'}</label>
            <input className="input" type="date" value={facturaFecha} max={hoyIso()} readOnly={!!documento} onChange={(e) => { marcarSucio(); setFacturaFecha(e.target.value); }} />
            {avisoFecha
              ? <small className="hint" style={{ color: 'var(--danger)' }}>{avisoFecha}</small>
              : <small className="hint muted">Define período, quincena y tasa.</small>}
          </div>
          <div className="form-row" style={{ flex: '1 1 140px' }}>
            <label>Fecha de la retención</label>
            <input className="input" type="date" value={fechaRetencion} max={hoyIso()} onChange={(e) => { marcarSucio(); setFechaRetencion(e.target.value); }} />
            <small className="hint muted">Emisión del comprobante.</small>
          </div>
          <div className="form-row" style={{ flex: '1 1 140px' }}>
            <label>Fecha recibido (opcional)</label>
            <input className="input" type="date" value={fechaEntrega} min={fechaRetencion} max={hoyIso()} onChange={(e) => { marcarSucio(); setFechaEntrega(e.target.value); }} />
            {entregaTardia && <small className="hint" style={{ color: 'var(--warning)' }}>{entregaTardia}</small>}
          </div>
        </div>

        {periodoCerrado && (
          <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', margin: '.3rem 0', padding: '.5rem .8rem', width: '100%' }}>
            <strong>🔒 Período Fiscal Cerrado ({nombrePeriodo(periodoCerrado)})</strong>
            <p style={{ margin: '.2rem 0 0', fontSize: '.8rem' }}>
              Este período ya fue declarado y enterado ante el SENIAT el {periodoCerrado.declaradoEn?.slice(0, 10)}.
              Para registrar operaciones en este lapso, el administrador debe reabrir el período con justificación en la pestaña de Períodos, o registrar la operación en el período corriente.
            </p>
          </div>
        )}

        {/* Fila de Importes: Selector entre Modo Rápido y Modo Avanzado (Valery) */}
        <div style={{ paddingTop: '.65rem', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '.5rem',
            marginBottom: '.75rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
              <span style={{ fontSize: '1rem' }}>💰</span>
              <strong style={{ fontSize: '.9rem', color: 'var(--text-normal)' }}>
                Importes de la Factura y Desglose Fiscal
              </strong>
            </div>
            <div style={{
              display: 'flex',
              gap: '.3rem',
              background: 'rgba(255, 255, 255, 0.04)',
              padding: '3px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
            }}>
              <button
                type="button"
                className={`btn btn-sm ${modoCaptura === 'rapido' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '.78rem', padding: '3px 12px', borderRadius: '6px' }}
                onClick={() => setModoCaptura('rapido')}
              >
                ⚡ Modo Rápido (Totales directos)
              </button>
              <button
                type="button"
                className={`btn btn-sm ${modoCaptura === 'valery' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '.78rem', padding: '3px 12px', borderRadius: '6px' }}
                onClick={() => {
                  setModoCaptura('valery');
                  if (renglonesValery.length === 0 && ordenSeleccionadaObj?.items && ordenSeleccionadaObj.items.length > 0) {
                    cargarRenglonesDesdeOc();
                  }
                }}
              >
                🛠️ Modo Avanzado (Ensamblar Factura)
              </button>
            </div>
          </div>

          {modoCaptura === 'valery' ? (
            <div style={{
              background: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '8px',
              padding: '.75rem',
              border: '1px solid var(--border)',
              marginBottom: '.6rem',
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '.5rem',
                marginBottom: '.6rem',
              }}>
                <small className="muted" style={{ fontSize: '.78rem' }}>
                  💡 <strong>Ensamblador detallado de factura:</strong> Ingresa o importa renglones. Las bases imponibles, montos exentos y el IVA se calculan automáticamente con exactitud al centavo.
                </small>
                <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                  {ordenSeleccionadaObj?.items && ordenSeleccionadaObj.items.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={cargarRenglonesDesdeOc}
                      style={{ fontSize: '.75rem', color: 'var(--primary)', borderColor: 'var(--primary)' }}
                    >
                      📥 Cargar renglones desde OC ({ordenSeleccionadaObj.items.length})
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={agregarRenglon}
                    style={{ fontSize: '.75rem' }}
                  >
                    + Agregar renglón
                  </button>
                </div>
              </div>

              {/* Tabla de Renglones Valery */}
              <div style={{ overflowX: 'auto', marginBottom: '.6rem' }}>
                <table className="table" style={{ width: '100%', fontSize: '.82rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255, 255, 255, 0.04)', color: 'var(--text-muted)' }}>
                      <th style={{ width: '32px', textAlign: 'center', padding: '6px' }}>#</th>
                      <th style={{ padding: '6px' }}>Descripción / Concepto</th>
                      <th style={{ width: '75px', textAlign: 'right', padding: '6px' }}>Cant.</th>
                      <th style={{ width: '110px', textAlign: 'right', padding: '6px' }}>Precio Unit. ({moneda})</th>
                      <th style={{ width: '130px', padding: '6px' }}>Alícuota IVA</th>
                      <th style={{ width: '110px', textAlign: 'right', padding: '6px' }}>Total Renglón</th>
                      <th style={{ width: '36px', textAlign: 'center', padding: '6px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {renglonesValery.map((r, i) => {
                      const tot = (Number(r.cantidad) || 0) * (Number(r.precioUnitario) || 0);
                      return (
                        <tr key={r.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                          <td style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '4px' }}>{i + 1}</td>
                          <td style={{ padding: '4px' }}>
                            <input
                              className="input"
                              style={{ fontSize: '.8rem', padding: '3px 7px' }}
                              value={r.descripcion}
                              onChange={(e) => actualizarRenglon(r.id, { descripcion: e.target.value })}
                              placeholder="Ej. Tornillos 3/8, Filtro de aceite, Servicio técnico…"
                            />
                          </td>
                          <td style={{ padding: '4px' }}>
                            <input
                              className="input mono"
                              type="number"
                              step="any"
                              min="0"
                              style={{ fontSize: '.8rem', padding: '3px 7px', textAlign: 'right' }}
                              value={r.cantidad}
                              onChange={(e) => actualizarRenglon(r.id, { cantidad: Math.max(0, parseFloat(e.target.value) || 0) })}
                            />
                          </td>
                          <td style={{ padding: '4px' }}>
                            <input
                              className="input mono"
                              type="number"
                              step="any"
                              min="0"
                              style={{ fontSize: '.8rem', padding: '3px 7px', textAlign: 'right' }}
                              value={r.precioUnitario}
                              onChange={(e) => actualizarRenglon(r.id, { precioUnitario: Math.max(0, parseFloat(e.target.value) || 0) })}
                            />
                          </td>
                          <td style={{ padding: '4px' }}>
                            <select
                              className="select"
                              style={{ fontSize: '.78rem', padding: '3px 5px' }}
                              value={r.alicuota}
                              onChange={(e) => actualizarRenglon(r.id, { alicuota: Number(e.target.value) as 16 | 8 | 0 })}
                            >
                              <option value={16}>16% (General)</option>
                              <option value={8}>8% (Reducido)</option>
                              <option value={0}>Exento (0% - No genera IVA)</option>
                            </select>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'monospace', padding: '4px', fontSize: '.82rem' }}>
                            {money(tot, moneda)}
                          </td>
                          <td style={{ textAlign: 'center', padding: '4px' }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              style={{ padding: '2px 5px', color: 'var(--danger, #ef4444)', fontSize: '.85rem' }}
                              onClick={() => eliminarRenglon(r.id)}
                              title="Eliminar renglón"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {renglonesValery.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: '1.2rem', color: 'var(--text-muted)' }}>
                          No hay renglones cargados. Haz clic en <strong>+ Agregar renglón</strong> o pulsa <strong>📥 Cargar renglones desde OC</strong> para ensamblar la factura automáticamente.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Totales Valery Calculados */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: '.5rem',
                padding: '.6rem',
                borderRadius: '6px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border)',
              }}>
                <div>
                  <small className="muted" style={{ fontSize: '.72rem', display: 'block' }}>Base Gravada 16%</small>
                  <strong className="mono" style={{ fontSize: '.85rem' }}>{money(calculoValery.base16, moneda)}</strong>
                </div>
                <div>
                  <small className="muted" style={{ fontSize: '.72rem', display: 'block' }}>IVA 16% Calculado</small>
                  <strong className="mono" style={{ fontSize: '.85rem', color: 'var(--primary)' }}>{money(calculoValery.iva16, moneda)}</strong>
                </div>
                {calculoValery.base8 > 0 && (
                  <div>
                    <small className="muted" style={{ fontSize: '.72rem', display: 'block' }}>Base 8% / IVA 8%</small>
                    <strong className="mono" style={{ fontSize: '.85rem' }}>{money(calculoValery.base8, moneda)} / {money(calculoValery.iva8, moneda)}</strong>
                  </div>
                )}
                <div>
                  <small className="muted" style={{ fontSize: '.72rem', display: 'block' }}>Subtotal Exento</small>
                  <strong className="mono" style={{ fontSize: '.85rem' }}>{money(calculoValery.exento, moneda)}</strong>
                </div>
                <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: '.6rem' }}>
                  <small style={{ fontSize: '.72rem', display: 'block', color: 'var(--success, #22c55e)', fontWeight: 700 }}>Total Factura Ensamblada</small>
                  <strong className="mono" style={{ fontSize: '.98rem', color: 'var(--success, #22c55e)' }}>{money(calculoValery.totalFactura, moneda)}</strong>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
              <div className="form-row" style={{ flex: '2 1 180px' }}>
                <label style={{ fontWeight: 700, color: 'var(--text-normal)' }}>
                  Total de la factura <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  className="input mono"
                  value={facturaTotal}
                  readOnly={!!documento}
                  onChange={(e) => {
                    marcarSucio();
                    setFacturaTotal(e.target.value);
                  }}
                  inputMode="decimal"
                  placeholder="0,00"
                />
                <SeLeyo texto={facturaTotal} />
                <small className="hint muted">Monto total bruto a pagar (con IVA y exento incluidos).</small>
              </div>

              <div className="form-row" style={{ flex: '2 1 200px' }}>
                <label style={{ fontWeight: 600 }}>IVA de la factura ({aliIvaPct}%)</label>
                <input
                  className="input mono"
                  value={ivaFacturaStr}
                  readOnly={!!documento}
                  onChange={(e) => {
                    marcarSucio();
                    setIvaFacturaStr(e.target.value);
                  }}
                  inputMode="decimal"
                  placeholder="0,00"
                />
                <SeLeyo texto={ivaFacturaStr} />
                <small className="hint muted">Monto del IVA impreso en la factura física (o 0 si no aplica).</small>
              </div>

              <div className="form-row" style={{ flex: '1 1 130px' }}>
                <label>Monto exento</label>
                <input className="input mono" value={exentoStr} readOnly={!!documento} onChange={(e) => { marcarSucio(); setExentoStr(e.target.value); }} inputMode="decimal" placeholder="0,00" />
                <SeLeyo texto={exentoStr} />
              </div>

              <div className="form-row" style={{ flex: '1 1 150px' }}>
                <label>Sin derecho a crédito IVA</label>
                <input className="input mono" value={sinDerechoStr} onChange={(e) => { marcarSucio(); setSinDerechoStr(e.target.value); }} inputMode="decimal" placeholder="0,00" />
                <SeLeyo texto={sinDerechoStr} />
                <small className="hint muted">Dato interno; no deducible.</small>
              </div>
            </div>
          )}

          {/* Tarjeta de resumen de base gravable y liquidación */}
          {totalFacturaNum > 0 && (
            <div style={{ marginTop: '.6rem', display: 'grid', gap: '.4rem' }}>
              <div
                style={{
                  padding: '.55rem .75rem',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '.5rem',
                }}
              >
                <div style={{ fontSize: '.84rem' }}>
                  <span className="muted">Total factura: </span>
                  <strong className="mono">{money(totalFacturaNum, moneda)}</strong>
                  <span className="muted"> − IVA: </span>
                  <strong className="mono">{money(ivaFacturaNum, moneda)}</strong>
                  {exentoNum > 0 && (
                    <>
                      <span className="muted"> − Exento: </span>
                      <strong className="mono">{money(exentoNum, moneda)}</strong>
                    </>
                  )}
                  <span style={{ color: 'var(--primary)', fontWeight: 700 }}> = Base gravable sujeta a retención: </span>
                  <strong className="mono" style={{ color: 'var(--primary)', fontSize: '.95rem' }}>{money(baseNetaGravable, moneda)}</strong>
                </div>
                <small className="muted" style={{ fontSize: '.75rem' }}>
                  ⚖️ Decreto 1.808: el ISLR se deduce sobre la <strong>Base Gravable ({money(baseNetaGravable, moneda)})</strong>.
                </small>
              </div>

              {/* Resumen de liquidación al proveedor */}
              {totalRetenido > 0 && (
                <div
                  style={{
                    padding: '.55rem .75rem',
                    borderRadius: '8px',
                    background: 'rgba(34, 197, 94, 0.06)',
                    border: '1px solid rgba(34, 197, 94, 0.25)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '.5rem',
                  }}
                >
                  <div style={{ fontSize: '.84rem' }}>
                    <span className="muted">Total Factura: </span>
                    <strong className="mono">{money(totalFacturaNum, moneda)}</strong>
                    <span className="muted"> − Retención: </span>
                    <strong className="mono" style={{ color: 'var(--danger, #ef4444)' }}>− {money(totalRetenido, moneda)}</strong>
                    <span style={{ color: 'var(--success, #22c55e)', fontWeight: 700 }}> = Neto a pagar al proveedor: </span>
                    <strong className="mono" style={{ color: 'var(--success, #22c55e)', fontSize: '1.02rem' }}>
                      {money(Math.max(0, totalFacturaNum - totalRetenido), moneda)}
                    </strong>
                  </div>
                  <small className="muted" style={{ fontSize: '.75rem' }}>
                    💡 Monto neto exacto que Tesorería transferirá por banco al proveedor.
                  </small>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 5. Impuestos a retener al proveedor ── */}
      <div className="card" style={{ marginTop: '.4rem', background: 'rgba(255, 255, 255, 0.02)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.6rem', flexWrap: 'wrap', gap: '.6rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '.92rem', color: 'var(--text-normal)' }}>
                🛡️ Impuestos a retener al proveedor (Retenciones practicadas)
              </strong>
            </div>
            <small className="hint muted" style={{ display: 'block', marginTop: '.15rem', fontSize: '.76rem' }}>
              Indica qué tributos se le van a deducir al proveedor al momento de liquidar la factura. El IVA facturado ({aliIvaPct}%) ya fue registrado en la cabecera superior.
            </small>
          </div>

          {/* Selector interactivo de retenciones por botón (ISLR, ISAE, IVA) gobernado por Parámetros */}
          <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Tributos a retener:</span>
            {(direccion === 'recibida' || puedePracticarEmpresa('islr', config)) && (
              <button
                type="button"
                className={`btn btn-sm ${lineas.some((l) => l.tipo === 'islr') ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '.76rem', padding: '2px 8px' }}
                title={lineas.some((l) => l.tipo === 'islr') ? 'Retención de ISLR activa (clic para quitar)' : 'Activar retención de ISLR para esta factura'}
                onClick={() => toggleImpuesto('islr')}
              >
                {lineas.some((l) => l.tipo === 'islr') ? '✓ ISLR activo' : '+ Retener ISLR'}
              </button>
            )}
            {(direccion === 'recibida' || puedePracticarEmpresa('municipal', config)) && (
              <button
                type="button"
                className={`btn btn-sm ${lineas.some((l) => l.tipo === 'municipal') ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '.76rem', padding: '2px 8px' }}
                title={lineas.some((l) => l.tipo === 'municipal') ? 'Retención de ISAE activa (clic para quitar)' : 'Activar retención municipal ISAE'}
                onClick={() => toggleImpuesto('municipal')}
              >
                {lineas.some((l) => l.tipo === 'municipal') ? '✓ ISAE activo' : '+ Retener ISAE (Municipal)'}
              </button>
            )}
            {(direccion === 'recibida' || puedePracticarEmpresa('iva', config)) && (
              <button
                type="button"
                className={`btn btn-sm ${lineas.some((l) => l.tipo === 'iva') ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '.76rem', padding: '2px 8px' }}
                title={lineas.some((l) => l.tipo === 'iva') ? 'Retención de IVA activa (clic para quitar)' : 'Activar retención de IVA (Solo agentes retenedores de IVA)'}
                onClick={() => toggleImpuesto('iva')}
              >
                {lineas.some((l) => l.tipo === 'iva') ? '✓ Retener IVA activo' : '+ Retener IVA (Especial)'}
              </button>
            )}
          </div>
        </div>
        {lineas.map((l) => {
          const calc = calculoDe(l);
          const monto = montoDe(l);
          const sugerido = l.tipo === 'islr' ? sugerirSujetoPorRif(rif) : null;
          const noPuede = direccion === 'practicada' && !puedePracticarEmpresa(l.tipo, config);
          const etiquetaTitulo = l.tipo === 'islr'
            ? '🏷️ Retención de Impuesto Sobre la Renta (ISLR · Decreto 1.808)'
            : l.tipo === 'municipal'
              ? '🏛️ Retención Municipal de Actividades Económicas (ISAE)'
              : l.tipo === 'iva'
                ? '🧾 Retención de IVA (Solo contribuyentes especiales agentes de retención)'
                : rotuloImpuesto(l.tipo);

          return (
            <div key={l.id} className="card" style={{ margin: '.35rem 0', background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
              {/* Barra de cabecera de la línea con el correlativo asignado según el impuesto */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '.5rem',
                marginBottom: '.45rem',
                paddingBottom: '.35rem',
                borderBottom: '1px solid var(--border)',
              }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '.86rem', color: 'var(--text)' }}>
                    {etiquetaTitulo}
                  </strong>
                  {direccion === 'practicada' && l.tipo !== 'igtf' && monto > 0 && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '.35rem',
                        fontSize: '.74rem',
                        padding: '.15rem .5rem',
                        borderRadius: '4px',
                        background: 'rgba(255, 138, 0, 0.12)',
                        border: '1px solid rgba(255, 138, 0, 0.3)',
                        color: 'var(--brand, #ff8a00)',
                        fontWeight: 600,
                      }}
                      title={correlativos[l.tipo]?.explicacion || 'Correlativo asignado según el impuesto'}
                    >
                      <span>Correlativo:</span>
                      <strong className="mono" style={{ letterSpacing: '.02em' }}>
                        {correlativos[l.tipo]?.comprobante ?? 'Calculando…'}
                      </strong>
                      <span className="muted" style={{ fontSize: '.68rem', fontWeight: 400 }}>
                        (#{correlativos[l.tipo]?.numero ?? 1})
                      </span>
                    </span>
                  )}
                  {direccion === 'practicada' && l.tipo === 'igtf' && (
                    <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>
                      (Percepción sobre pago · Sin comprobante propio)
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  style={{ color: 'var(--danger)', padding: '2px 6px', fontSize: '.75rem' }}
                  title="Quitar esta retención de la factura"
                  onClick={() => toggleImpuesto(l.tipo)}
                >
                  ✕ Quitar retención
                </button>
              </div>

              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="form-row" style={{ margin: 0, flex: '0 1 130px' }}>
                  <label>Impuesto</label>
                  <select
                    className="select"
                    value={l.tipo}
                    onChange={(e) => {
                      const nuevoTipo = e.target.value as TipoImpuesto;
                      if (lineas.some((otra) => otra.id !== l.id && otra.tipo === nuevoTipo)) {
                        toast(`Esta factura ya tiene una retención de ${labelImpuesto(nuevoTipo)}. Una factura admite una sola retención por impuesto.`, 'warning');
                        return;
                      }
                      const baseActual = nDec(l.baseStr);
                      const baseAjustada = (nuevoTipo === 'islr' || nuevoTipo === 'municipal')
                        && (baseActual === totalFacturaNum || baseActual === 0)
                        && baseNetaGravable > 0
                        ? numeroATexto(baseNetaGravable)
                        : l.baseStr;
                      const sujetoVal = sugerirSujetoPorRif(rif)?.sujeto ?? l.sujeto;
                      const conceptoAjustado = sugerirConceptoParaLinea(conceptos, nuevoTipo, sujetoVal);
                      setLinea(l.id, { tipo: nuevoTipo, baseStr: baseAjustada, conceptoId: conceptoAjustado });
                    }}
                  >
                    {tiposDeLinea(impuestosActivos, fichasImpuesto, direccion, l.tipo).map((t) => {
                      const ocupadoPorOtra = lineas.some((otra) => otra.id !== l.id && otra.tipo === t.key);
                      return (
                        <option key={t.key} value={t.key} disabled={ocupadoPorOtra}>
                          {t.corto}{ocupadoPorOtra ? ' (ya agregado)' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
                {l.tipo === 'islr' && (
                  <div className="form-row" style={{ margin: 0, flex: '1 1 180px' }}>
                    <label>Sujeto pasivo</label>
                    <select className="select" value={l.sujeto} onChange={(e) => {
                      const nuevoSujeto = e.target.value as SujetoRetenido;
                      const cSugerido = sugerirConceptoParaLinea(conceptos, l.tipo, nuevoSujeto);
                      setLinea(l.id, { sujeto: nuevoSujeto, conceptoId: cSugerido || l.conceptoId });
                    }}>
                      {SUJETOS.filter((x) => x.key !== 'todos').map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </select>
                  </div>
                )}
                {l.tipo !== 'iva' && l.tipo !== 'igtf' && (
                  <div className="form-row" style={{ margin: 0, flex: '2 1 200px' }}>
                    <label>Concepto de retención</label>
                    <select className="select" value={l.conceptoId} onChange={(e) => setLinea(l.id, { conceptoId: e.target.value })}>
                      <option value="">— Seleccionar concepto —</option>
                      {conceptosDeLinea(l).map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} · ` : ''}{c.nombre} — {c.porcentaje}%</option>)}
                    </select>
                  </div>
                )}
                <div className="form-row" style={{ margin: 0, flex: '1 1 150px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ margin: 0 }}>
                      {l.tipo === 'islr'
                        ? 'Base gravable ISLR (sin IVA)'
                        : l.tipo === 'municipal'
                          ? 'Base gravable ISAE (sin IVA)'
                          : l.tipo === 'iva'
                            ? 'Base imponible IVA'
                            : 'Monto del pago'}
                    </label>
                  </div>
                  <input className="input mono" value={l.baseStr} onChange={(e) => setLinea(l.id, { baseStr: e.target.value })} inputMode="decimal" />
                  <SeLeyo texto={l.baseStr} />
                  {(l.tipo === 'islr' || l.tipo === 'municipal') && baseNetaGravable > 0 && Math.abs(nDec(l.baseStr) - baseNetaGravable) > 0.01 && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ fontSize: '.7rem', padding: '1px 4px', color: 'var(--primary)', marginTop: '2px', textAlign: 'left' }}
                      onClick={() => setLinea(l.id, { baseStr: numeroATexto(baseNetaGravable) })}
                      title="Usar la base gravable neta de la factura (descontando IVA)"
                    >
                      💡 Usar base sin IVA (Bs {numeroATexto(baseNetaGravable)})
                    </button>
                  )}
                </div>
                {l.tipo === 'iva' && (
                  <div className="form-row" style={{ margin: 0, flex: '1 1 110px' }}>
                    <label>IVA de la factura</label>
                    <input className="input mono" value={l.ivaStr} onChange={(e) => setLinea(l.id, { ivaStr: e.target.value })} inputMode="decimal" />
                    <SeLeyo texto={l.ivaStr} />
                  </div>
                )}
                {esManual && (
                  <>
                    <div className="form-row" style={{ margin: 0, flex: '1 1 140px' }}>
                      <label>N° de comprobante</label>
                      <input className="input mono" value={l.numeroStr} onChange={(e) => setLinea(l.id, { numeroStr: e.target.value })}
                        placeholder="El del cliente" />
                    </div>
                    <div className="form-row" style={{ margin: 0, flex: '0 1 90px' }}>
                      <label>% ret.</label>
                      <input className="input mono" value={l.pctStr} onChange={(e) => setLinea(l.id, { pctStr: e.target.value })} inputMode="decimal" />
                    </div>
                    <div className="form-row" style={{ margin: 0, flex: '1 1 120px' }}>
                      <label>Monto retenido</label>
                      <input className="input mono" value={l.montoStr} onChange={(e) => setLinea(l.id, { montoStr: e.target.value })} inputMode="decimal"
                        placeholder="Vacío = base × %" />
                      <SeLeyo texto={l.montoStr} />
                    </div>
                  </>
                )}
                <div style={{ flex: '1 1 120px', textAlign: 'right' }}>
                  <div className="muted" style={{ fontSize: '.7rem' }}>Retenido ({calc.porcentaje}%)</div>
                  <div className="mono" style={{ fontWeight: 700, color: monto > 0 ? 'var(--primary)' : 'var(--text-muted)' }}>{money(monto, moneda)}</div>
                </div>
              </div>
              {l.tipo === 'islr' && sugerido && sugerido.sujeto !== l.sujeto && (
                <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '.25rem' }}>
                  <small className="hint muted">
                    Según la letra del RIF sería «{labelSujeto(sugerido.sujeto)}». Verifica antes de registrar: el porcentaje cambia con el sujeto.
                  </small>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLinea(l.id, { sujeto: sugerido.sujeto })}>Usar la sugerencia</button>
                </div>
              )}
              {direccion === 'practicada' && l.tipo === 'iva' && (
                <SupuestosIvaAcordeon
                  motivos={l.motivos}
                  supuestosIva={supuestosIva}
                  pctGeneral={config.pctIvaGeneral}
                  pctActual={calc.porcentaje}
                  ivaFactura={nDec(l.ivaStr)}
                  moneda={moneda}
                  onLimpiarMotivos={() => setLinea(l.id, { motivos: {}, ivaDerivadoConfirmado: false })}
                  onChange={(codigo, valor) => setLinea(l.id, codigo === 'ivaNoDiscriminado' && !valor
                    ? { motivos: { ...l.motivos, [codigo]: valor }, ivaDerivadoConfirmado: false }
                    : { motivos: { ...l.motivos, [codigo]: valor } })}
                />
              )}
              {/* C3: IVA no discriminado → se deriva del total y el usuario lo confirma (automático pero visible). */}
              {direccion === 'practicada' && l.tipo === 'iva' && l.motivos.ivaNoDiscriminado && (() => {
                const d = desglosarIvaDeTotal(nDec(facturaTotal), nDec(exentoStr), aliIvaPct);
                const confirmado = !!l.ivaDerivadoConfirmado && Math.abs(nDec(l.ivaStr) - d.iva) <= 0.01;
                return (
                  <div className="aviso info sm" style={{ marginTop: '.35rem', display: 'grid', gap: '.35rem' }}>
                    <div>
                      <strong>IVA no discriminado en la factura.</strong> Se deriva del total (÷{divisorIvaTxt}):
                      {' '}base <strong className="mono">{money(d.base, moneda)}</strong> · IVA <strong className="mono">{money(d.iva, moneda)}</strong>.
                      {nDec(facturaTotal) <= 0 && <span> Escribe primero el total de la factura.</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn-sm btn-primary" disabled={d.iva <= 0}
                        onClick={() => setLinea(l.id, { baseStr: numeroATexto(d.base), ivaStr: numeroATexto(d.iva), ivaDerivadoConfirmado: true })}>
                        Aplicar y confirmar IVA derivado
                      </button>
                      {confirmado
                        ? <small style={{ color: 'var(--success)' }}>✓ Confirmado</small>
                        : <small style={{ color: 'var(--warning)' }}>Confírmalo antes de guardar.</small>}
                    </div>
                  </div>
                );
              })()}
              {noPuede && <small className="hint" style={{ color: 'var(--warning)' }}>{empresaFicha ? `La empresa no practica retención de ${labelImpuesto(l.tipo)} según su régimen (Parámetros → Régimen).` : motivoNoPuedePracticar(l.tipo, config)}</small>}
              {!esManual && <small className="hint muted">{calc.explicacion}</small>}
              {monto === 0 && (
                <div className="form-row" style={{ margin: '.3rem 0 0' }}>
                  <label style={{ color: 'var(--warning)', fontSize: '.76rem' }}>Motivo del 0 % (obligatorio si el monto a retener es 0)</label>
                  <input className="input" value={l.descripcion} onChange={(e) => setLinea(l.id, { descripcion: e.target.value })}
                    placeholder="Ej.: el pago no supera el mínimo exento / actividad exenta" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="form-row">
        <label>Nota de la factura</label>
        <input className="input" value={nota} onChange={(e) => { marcarSucio(); setNota(e.target.value); }}
          placeholder={sinDocumento ? 'De dónde viene esta factura (obligatorio fuera del sistema)' : 'P. ej.: la compra incluye 2 facturas'} />
      </div>
      {moneda !== 'Bs' && tasa > 0 && (
        <small className="hint muted">
          Total retenido en bolívares: Bs {totalRetenidoBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (a {tasa} Bs por $).
        </small>
      )}
      {avisoRecibida && <div className="lfv8-alerta-media" style={{ marginTop: '.5rem' }}><span>⚠️ {avisoRecibida}</span></div>}
    </Modal>
  );
}
