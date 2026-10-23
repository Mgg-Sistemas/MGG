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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import type { Proveedor } from '@/shared/lib/types';
import { list as listProveedores } from '@/modules/proveedores/proveedores.repository';
import { getTasaUsdDeFecha } from '@/modules/tesoreria/tasas.repository';
import { rifValido } from '@/shared/lib/rif';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { rutaFichaProveedor, textoRifInvalido } from './mensajeRif';
import {
  CONFIG_RETENCION_DEFECTO, DIRECCIONES, SUJETOS, TIPOS_IMPUESTO,
  calcularIgtf, calcularRetencionIslr, calcularRetencionIva, calcularRetencionLocal, enBolivares, fechaTasaBcv,
  labelImpuesto, labelSujeto, motivoCienTexto, motivoNoPuedePracticar, periodoDe, puedePracticar, quincenaDe,
  type CalculoRetencion, type ConceptoRetencion, type ConfigRetencion, type DireccionRetencion,
  type MotivosIvaCien, type SujetoRetenido, type TipoImpuesto,
} from './retencionesCalculo';
import { getConfigRetencion, listConceptos, sujetoAGt, tipoAGt, type DocKind } from './retencionesFiscal.repository';
import { configDeFecha } from './parametros.repository';
import { supuestoAplicado, supuestosVigentes, type Supuesto } from './motivosSupuestos.repository';
import { esCeroSinMotivo } from './motivoCero';
import { sugerirSujetoPorRif } from './residenciaSujeto';
import { leerMonto, numeroATexto } from './validarCarga';
import { montoEscrito, municipioDeLinea, sujetoDeLineas } from './lineasRegistro';
import { SeLeyo } from './SeLeyo';
import { rotuloImpuesto } from './rotulos';
import { BuscadorFactura } from './BuscadorFactura';
import { pendientesComoTipos, r10Disponible, registrarFacturaSola, retenerDespues, type FacturaResumen } from './facturasResumen.repository';
import { faltaEnDatosFactura } from './facturaDocumento';
import { r7Disponible } from './reglas.repository';
import { calcularConReglaVigente, columnasDeRegla, type CalculoConRegla } from './reglaRegistro';
import { useDescartar } from './confirmarDescartar';
import { urlFacturaDeOrigen } from './documentosOrigen.repository';
import { nombrePeriodo, periodoEstaCerrado, type PeriodoFiscal } from './periodosRetencion.repository';
import { previewArchivo } from '@/shared/lib/reportePreview';
import {
  registrarFactura, type FacturaNueva, type LineaFacturaNueva, type TipoDocumento,
} from './retencionFacturas.repository';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';

/** Para calcular mientras se escribe. Lo ilegible lo señala `ilegibles` antes de registrar. */
const nDec = (v: string) => leerMonto(v) ?? 0;
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
}

/** Los supuestos del art. 5 (Providencia SNAT/2015/0049) que llevan la retención de IVA al 100 %. */
const MOTIVOS_IVA_CIEN: Array<[keyof MotivosIvaCien & string, string]> = [
  ['ivaNoDiscriminado', 'El IVA no está discriminado en la factura'],
  ['facturaNoCumple', 'La factura no cumple los requisitos de facturación'],
  ['proveedorNoInscrito', 'El proveedor está sujeto a retención del 100% según el Portal Fiscal, o no está inscrito en el RIF'],
  ['proveedorNoDomiciliado', 'El proveedor no está domiciliado en el país'],
  ['metalesPreciosos', 'Compra de metales o piedras preciosas'],
];

let semilla = 0;
const nuevaLinea = (over: Partial<LineaUI> = {}): LineaUI => ({
  id: (semilla += 1), tipo: 'iva', sujeto: 'pj_domiciliada', conceptoId: '',
  baseStr: '0', ivaStr: '0', pctStr: '', montoStr: '', numeroStr: '', motivos: {}, descripcion: '', ...over,
});

export function RegistrarFacturaRetencion({ semilla: s = {}, actor, actorName, onClose, onHecho, proveedorIdsPendientes }: {
  semilla?: SemillaFactura;
  /** En una practicada, solo se ofrecen los proveedores con retenciones por realizar (si se pasa). */
  proveedorIdsPendientes?: Set<string>;
  actor: string;
  actorName: string | null;
  onClose: () => void;
  onHecho: (res: Awaited<ReturnType<typeof registrarFactura>>) => void;
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
  const { marcarSucio, pedirCierre, dialogo } = useDescartar(onClose, saving);
  // R7: el cálculo con la regla vigente de cada línea (por id de línea); sin entrada = el cálculo de hoy.
  const [conR7, setConR7] = useState(false);
  const [reglas, setReglas] = useState<Record<number, CalculoConRegla | null>>({});
  const [avisoRegla, setAvisoRegla] = useState<string | null>(null);
  const [tasaBcv, setTasaBcv] = useState<{ tasa: number | null; nota: string } | null>(null);

  const [direccion, setDireccion] = useState<DireccionRetencion>(s.direccion ?? 'practicada');
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
  const [facturaTotal, setFacturaTotal] = useState(numeroATexto(s.facturaTotal ?? 0));
  const [exentoStr, setExentoStr] = useState(s.exento != null ? numeroATexto(s.exento) : '');
  const [nota, setNota] = useState('');
  // R10: la factura sola (sin líneas, queda pendiente) y retener después sobre una ya registrada.
  const [conR10, setConR10] = useState(false);
  const [documento, setDocumento] = useState<FacturaResumen | null>(null);
  const [soloFactura, setSoloFactura] = useState(false);
  const [avisoSinDocDescartado, setAvisoSinDocDescartado] = useState(false);
  const [periodoCerrado, setPeriodoCerrado] = useState<PeriodoFiscal | null>(null);
  const [lineas, setLineas] = useState<LineaUI[]>(() => [nuevaLinea({
    tipo: s.tipoInicial ?? 'iva', baseStr: numeroATexto(s.baseImponible ?? 0), ivaStr: numeroATexto(s.iva ?? 0),
  })]);

  useEffect(() => {
    void Promise.all([getConfigRetencion(), listConceptos(true), listProveedores()])
      .then(([c, cs, ps]) => {
        setConfigBase(c); setConfig(c); setConceptos(cs);
        const activos = ps.filter((p) => p.estado === 'activo');
        setProveedores(activos);
        const p = s.contraparteId ? activos.find((x) => x.id === s.contraparteId) : null;
        if (p) {
          setContraparte(p.razon_social); setRif(p.rif ?? '');
          const sug = sugerirSujetoPorRif(p.rif ?? '');
          if (sug) setLineas((xs) => xs.map((l) => ({ ...l, sujeto: sug.sujeto })));
        }
      })
      .catch((e) => setError(e instanceof Error ? `No se pudo leer la configuración: ${e.message}` : 'No se pudo leer la configuración.'));
    r7Disponible().then(setConR7).catch(() => setConR7(false));
  }, [s.contraparteId]);

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

  const opcionesProveedor = useMemo(() => {
    const lista = proveedorIdsPendientes ? proveedores.filter((p) => proveedorIdsPendientes.has(p.id)) : proveedores;
    return lista.map((p) => ({ value: p.id, label: `${p.razon_social}${p.rif ? ` · ${p.rif}` : ''}` }));
  }, [proveedores, proveedorIdsPendientes]);

  /** El proveedor llena razón social y RIF. El sujeto del ISLR no se toca: se sugiere en cada línea. */
  function elegirProveedor(id: string) {
    marcarSucio();
    setProveedorId(id);
    const p = proveedores.find((x) => x.id === id);
    if (p) { setContraparte(p.razon_social); setRif(p.rif ?? ''); }
  }

  const esManual = direccion === 'recibida';
  const tasa = nDec(tasaStr);

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
      const primerTipo = lineas[0]?.tipo ? tipoAGt(lineas[0].tipo) : 'iva';
      periodoEstaCerrado(primerTipo, f)
        .then((p) => { if (vivo) setPeriodoCerrado(p); })
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
    return calcularRetencionLocal({ montoPago: base, concepto }, l.tipo);
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
          sujeto: l.tipo === 'iva' || l.tipo === 'igtf' ? null : sujetoAGt(l.sujeto),
          moneda, tasa: moneda === 'Bs' ? null : (tasa || null),
          pago: base, baseImponible: base, iva: nDec(l.ivaStr),
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
      baseImponible: r.base, impuesto: r.impuesto, porcentaje: r.pct ?? 0, sustraendo: r.sustraendo, montoRetenido: r.monto,
      explicacion: r.aplica ? `Calculado con la ${cual}, vigente al ${fechaCorta(facturaFecha)}.` : `No se retiene según la ${cual}: ${r.motivo ?? 'sin motivo'}.`,
    };
  }, [calculoHoyDe, reglas, direccion, facturaFecha]);

  const montoDe = useCallback((l: LineaUI): number => (esManual
    // Vacío = el calculado; «0» escrito = 0 (y pide el motivo del 0 %). Lo ilegible lo frena «ilegibles».
    ? (montoEscrito(l.montoStr, Math.round(nDec(l.baseStr) * nDec(l.pctStr)) / 100) ?? 0)
    : calculoDe(l).montoRetenido), [esManual, calculoDe]);
  const pctDe = (l: LineaUI) => (esManual ? nDec(l.pctStr) : calculoDe(l).porcentaje);

  const totalRetenido = useMemo(() => lineas.reduce((a, l) => a + montoDe(l), 0), [lineas, montoDe]);

  const totalRetenidoBs = enBolivares(totalRetenido, moneda, tasa);

  const conceptosDeLinea = (l: LineaUI) => conceptos.filter((c) => c.tipo === l.tipo && (c.sujeto === l.sujeto || c.sujeto === 'todos'));

  // Una practicada sin OC, CS ni compra directa queda «fuera del sistema»: se dice y se anota de dónde viene.
  const sinDocumento = direccion === 'practicada' && !s.docId;
  const rifMal = rif.trim() !== '' && !rifValido(rif);
  // D43: el mensaje dice cuál RIF y dónde se corrige (practicada: en la ficha del proveedor).
  const textoRif = rifMal ? textoRifInvalido({ direccion, rif, nombre: contraparte }) : null;
  const ilegibles = [
    ...(moneda !== 'Bs' && leerMonto(tasaStr) == null ? ['Tasa'] : []),
    ...(leerMonto(facturaTotal) == null ? ['Total de la factura'] : []),
    ...(exentoStr.trim() !== '' && leerMonto(exentoStr) == null ? ['Monto exento'] : []),
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
    if (soloFactura) {
      if (ilegibles.length) return `No se entiende: ${ilegibles.join(', ')}. Escribe 1.234,56 o 1234,56.`;
      if (sinDocumento && !nota.trim()) return 'Sin documento del sistema: indica en la nota de la factura de dónde viene.';
      return null;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaRetencion)) return 'Indica la fecha de la retención (emisión del comprobante).';
    if (fechaRetencion < facturaFecha) return 'La fecha de la retención no puede ser anterior a la de la factura.';
    if (avisoFecha) return avisoFecha;
    if (avisoRegla) return avisoRegla;
    if (ilegibles.length) return `No se entiende: ${ilegibles.join(', ')}. Escribe 1.234,56 o 1234,56.`;
    if (moneda !== 'Bs' && !(tasa > 0)) return 'Indica la tasa para llevar los montos a bolívares.';
    if (sinDocumento && !nota.trim()) return 'Sin documento del sistema: indica en la nota de la factura de dónde viene.';
    if (!lineas.length) return 'Agrega al menos una línea de impuesto.';
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
    for (const l of lineas) {
      if (direccion === 'practicada') {
        const m = motivoNoPuedePracticar(l.tipo, config);
        if (m) return `${labelImpuesto(l.tipo)}: ${m}`;
      }
      const monto = montoDe(l);
      if (monto < 0) return `${labelImpuesto(l.tipo)}: el monto no puede ser negativo.`;
      if (esCeroSinMotivo(pctDe(l), monto, l.descripcion)) return `${labelImpuesto(l.tipo)}: un 0 % se registra solo con su motivo.`;
    }
    return null;
  }

  /** Elegir una factura ya registrada: se precargan sus datos y se retiene sobre ella lo pendiente. */
  function aplicarDocumento(f: FacturaResumen) {
    marcarSucio();
    setDocumento(f); setSoloFactura(false); setDireccion('practicada');
    if (f.tipoDocumento && (f.tipoDocumento === 'factura' || f.tipoDocumento === 'nota_credito' || f.tipoDocumento === 'nota_debito')) {
      setTipoDocumento(f.tipoDocumento as TipoDocumento);
    }
    if (f.facturaAfectadaNro) setFacturaAfectadaNro(f.facturaAfectadaNro);
    if (f.proveedorId) setProveedorId(f.proveedorId);
    setContraparte(f.razonSocial ?? ''); setRif(f.rif ?? '');
    setFacturaNro(f.facturaNro ?? ''); setFacturaControl(f.facturaControl ?? ''); setFacturaFecha(f.facturaFecha ?? '');
    setMoneda(f.moneda || 'Bs'); if (f.tasa) setTasaStr(numeroATexto(f.tasa));
    setFacturaTotal(numeroATexto(f.facturaTotal ?? 0));
    if (f.exento != null) setExentoStr(numeroATexto(f.exento));
    const base = f.facturaTotal != null ? Math.max(0, f.facturaTotal - (f.ivaMonto ?? 0)) : 0;
    const tipos = pendientesComoTipos(f);
    const sujeto = sugerirSujetoPorRif(f.rif ?? '')?.sujeto ?? 'pj_domiciliada';
    setLineas((tipos.length ? tipos : ['iva' as TipoImpuesto]).map((t) => nuevaLinea({
      tipo: t, sujeto, baseStr: numeroATexto(base), ivaStr: numeroATexto(f.ivaMonto ?? 0),
    })));
  }
  function soltarDocumento() { marcarSucio(); setDocumento(null); }

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
      const facturaNueva: FacturaNueva = {
        direccion,
        tipoDocumento,
        facturaAfectadaNro: tipoDocumento !== 'factura' ? facturaAfectadaNro.trim() || null : null,
        docKind: s.docKind ?? 'manual', docId: s.docId ?? null, adjuntoId: s.adjuntoId ?? null,
        contraparteId: direccion === 'practicada' ? proveedorId || null : null, contraparteRif: rif.trim() || null, contraparteNombre: contraparte.trim() || null,
        // El sujeto del ISLR es del proveedor: va en la cabecera (antes llegaba null).
        contraparteSujeto: sujetoDeLineas(lineas).sujeto,
        facturaNro: facturaNro.trim() || null, facturaControl: facturaControl.trim() || null,
        facturaFecha, facturaTotal: facturaTotal.trim() ? nDec(facturaTotal) : null,
        exento: exentoNum,
        moneda, tasa: moneda === 'Bs' ? null : tasa, periodo,
        nota: nota.trim() || null, valorUt: config.valorUt, actor, actorName,
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
          ivaAlicuota: l.tipo === 'iva' ? (esManual ? null : calc.alicuota) : null,
          ivaMonto: l.tipo === 'iva' ? (esManual ? nDec(l.ivaStr) : calc.impuesto) : null,
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
      if (soloFactura) {
        const res = await registrarFacturaSola(facturaNueva);
        notify(`${etiquetaDoc} registrada: queda pendiente por retener`, 'success', { link: '#/app/retenciones' });
        onHecho(res);
        return;
      }
      const res = documento
        ? await retenerDespues(documento, lineasNuevas, { periodo, actorName, valorUt: config.valorUt })
        : await registrarFactura(facturaNueva, lineasNuevas);
      notify(`${etiquetaDoc} · ${res.lineas.length} línea(s) retenida(s) · ${money(totalRetenido, moneda)}`, 'success', { link: '#/app/retenciones' });
      onHecho(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la factura.');
      setSaving(false);
    }
  }

  return (
    <Modal title={documento ? '🧾 Retener sobre una factura registrada' : '🧾 Registrar retención por factura'} size="xl" onClose={pedirCierre}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={pedirCierre} disabled={saving}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void emitir()} disabled={saving || (!soloFactura && !lineas.length)}>
            {saving ? 'Guardando…' : soloFactura ? 'Registrar la factura' : `${documento ? 'Retener' : 'Registrar'} · ${money(totalRetenido, moneda)}`}
          </button>
        </>
      )}>
      {dialogo}
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
      {s.adjunto && (
        <div className="card" style={{ marginBottom: '.75rem', display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <span>📄 Factura cargada por Compras: <strong>{s.adjunto.nombre}</strong></span>
          <button type="button" className="btn btn-sm btn-ghost"
            onClick={() => { const a = s.adjunto; if (a) urlFacturaDeOrigen(a).then((u) => previewArchivo(u, a.nombre)).catch((e) => setError(e instanceof Error ? e.message : 'No se pudo abrir el archivo.')); }}>
            Ver
          </button>
          <small className="muted">Al registrar, el archivo queda enlazado a esta factura.</small>
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
      {sinDocumento && !documento && !avisoSinDocDescartado && (
        <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: '.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem' }}>
          <small style={{ flex: 1 }}>
            Esta factura no proviene de una Orden de Compra (OC), un Control de Servicio (CS) ni una Compra Directa. Quedará en el libro fiscal registrada como «Fuera del sistema», por lo que se recomienda indicar en las notas su procedencia u origen.
          </small>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ padding: '2px 8px', lineHeight: 1, minHeight: 'auto', fontSize: '.85rem' }}
            onClick={() => setAvisoSinDocDescartado(true)}
            title="Descartar aviso"
            aria-label="Descartar aviso"
          >
            ✕
          </button>
        </div>
      )}

      <div className="form-row">
        <label>¿Quién retuvo?</label>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          {DIRECCIONES.map((d) => (
            <label key={d.key} className="card" style={{
              margin: 0, padding: '.45rem .8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '.4rem',
              borderColor: direccion === d.key ? 'var(--primary)' : 'var(--border)',
            }}>
              <input type="radio" checked={direccion === d.key} onChange={() => { marcarSucio(); setDireccion(d.key); }} />
              <span style={{ fontWeight: 600 }}>{d.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
        <div className="form-row" style={{ flex: '2 1 240px' }}>
          <label>{direccion === 'recibida' ? 'Quién nos retuvo' : 'A quién le retenemos'}</label>
          {direccion === 'practicada' ? (
            <SearchSelect value={proveedorId} onChange={elegirProveedor} options={opcionesProveedor}
              placeholder="Buscar proveedor por nombre o RIF…" disabled={!!s.contraparteId || !!documento} />
          ) : (
            <input className="input" value={contraparte} onChange={(e) => { marcarSucio(); setContraparte(e.target.value); }} placeholder="Razón social" />
          )}
        </div>
        <div className="form-row" style={{ flex: '1 1 150px' }}>
          <label>RIF</label>
          <input className="input mono" value={rif} onChange={(e) => { marcarSucio(); setRif(e.target.value); }} placeholder="J-XXXXXXXX-X"
            readOnly={direccion === 'practicada' && !!proveedorId} />
          {textoRif && (
            <small className="hint" style={{ color: 'var(--danger)' }}>
              {textoRif.hint}
              {direccion === 'practicada' && proveedorId && verProveedores && <> <a href={`#${rutaFichaProveedor(proveedorId)}`}>Abrir la ficha</a></>}
            </small>
          )}
        </div>
        <div className="form-row" style={{ flex: '0 1 110px' }}>
          <label>Moneda de la factura</label>
          <select className="select" value={moneda} disabled={!!documento} onChange={(e) => { marcarSucio(); setMoneda(e.target.value); }}>
            <option value="Bs">Bs</option>
            <option value="USD">$</option>
          </select>
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

      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
        <div className="form-row" style={{ flex: '1 1 150px' }}>
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
            <input className="input mono" value={facturaNro} onChange={(e) => { marcarSucio(); setFacturaNro(e.target.value); }} placeholder="Número fiscal (no el código de la OC)" maxLength={30} />
          )}
          {conR10 && direccion === 'practicada' && tipoDocumento === 'factura' && !documento && <small className="hint muted">Si ya está registrada, elígela de la lista para retener sobre ella.</small>}
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
            : <small className="hint muted">Define el período, la quincena y la tasa.</small>}
        </div>
        <div className="form-row" style={{ flex: '1 1 140px' }}>
          <label>Fecha de la retención</label>
          <input className="input" type="date" value={fechaRetencion} onChange={(e) => { marcarSucio(); setFechaRetencion(e.target.value); }} />
          <small className="hint muted">Emisión del comprobante.</small>
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
        <div className="form-row" style={{ flex: '1 1 130px' }}>
          <label>Total {tipoDocumento === 'factura' ? 'factura' : 'documento'}</label>
          <input className="input mono" value={facturaTotal} readOnly={!!documento} onChange={(e) => { marcarSucio(); setFacturaTotal(e.target.value); }} inputMode="decimal" />
          <SeLeyo texto={facturaTotal} />
        </div>
        <div className="form-row" style={{ flex: '1 1 130px' }}>
          <label>Monto exento</label>
          <input className="input mono" value={exentoStr} readOnly={!!documento} onChange={(e) => { marcarSucio(); setExentoStr(e.target.value); }} inputMode="decimal" placeholder="0,00" />
          <SeLeyo texto={exentoStr} />
        </div>
      </div>

      {conR10 && !documento && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.86rem', margin: '.4rem 0' }}>
          <input type="checkbox" checked={soloFactura} onChange={(e) => { marcarSucio(); setSoloFactura(e.target.checked); }} />
          Registrar solo la factura (retener después)
        </label>
      )}
      {soloFactura && (
        <div className="card" style={{ borderColor: 'var(--warning)', marginTop: '.4rem' }}>
          <small>La factura quedará <strong>pendiente por retener</strong>: aparece en «Facturas registradas» y en el buscador del N° de factura para retener después.</small>
        </div>
      )}

      {/* Las líneas de impuesto */}
      {!soloFactura && (
      <div className="card" style={{ marginTop: '.4rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
          <strong style={{ fontSize: '.9rem' }}>Líneas de impuesto</strong>
          {(() => {
            const tiposUsados = new Set(lineas.map((l) => l.tipo));
            const tiposDisponibles = TIPOS_IMPUESTO.filter((t) => !tiposUsados.has(t.key));
            const puedeAgregar = tiposDisponibles.length > 0;
            return (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={!puedeAgregar}
                title={puedeAgregar ? 'Agregar otra línea de impuesto diferente' : 'Una factura no admite dos retenciones del mismo impuesto (ya están todos los tipos agregados)'}
                onClick={() => {
                  if (!puedeAgregar) return;
                  marcarSucio();
                  const proximoTipo = tiposDisponibles[0].key;
                  const baseSugerida = facturaTotal.trim() ? facturaTotal : '0';
                  setLineas((xs) => [...xs, nuevaLinea({
                    tipo: proximoTipo,
                    sujeto: sugerirSujetoPorRif(rif)?.sujeto ?? 'pj_domiciliada',
                    baseStr: baseSugerida,
                  })]);
                }}
              >
                + Agregar línea
              </button>
            );
          })()}
        </div>
        {lineas.map((l) => {
          const calc = calculoDe(l);
          const monto = montoDe(l);
          const sugerido = l.tipo === 'islr' ? sugerirSujetoPorRif(rif) : null;
          const noPuede = direccion === 'practicada' && !puedePracticar(l.tipo, config);
          return (
            <div key={l.id} className="card" style={{ margin: '.3rem 0', background: 'var(--bg-2)' }}>
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="form-row" style={{ margin: 0, flex: '0 1 130px' }}>
                  <label>Impuesto</label>
                  <select
                    className="select"
                    value={l.tipo}
                    onChange={(e) => {
                      const nuevoTipo = e.target.value as TipoImpuesto;
                      if (lineas.some((otra) => otra.id !== l.id && otra.tipo === nuevoTipo)) {
                        toast(`Esta factura ya tiene una línea de ${labelImpuesto(nuevoTipo)}. Una factura admite una sola retención por impuesto.`, 'warning');
                        return;
                      }
                      setLinea(l.id, { tipo: nuevoTipo });
                    }}
                  >
                    {TIPOS_IMPUESTO.map((t) => {
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
                    <label>Sujeto</label>
                    <select className="select" value={l.sujeto} onChange={(e) => setLinea(l.id, { sujeto: e.target.value as SujetoRetenido })}>
                      {SUJETOS.filter((x) => x.key !== 'todos').map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </select>
                  </div>
                )}
                {l.tipo !== 'iva' && l.tipo !== 'igtf' && (
                  <div className="form-row" style={{ margin: 0, flex: '2 1 200px' }}>
                    <label>Concepto</label>
                    <select className="select" value={l.conceptoId} onChange={(e) => setLinea(l.id, { conceptoId: e.target.value })}>
                      <option value="">—</option>
                      {conceptosDeLinea(l).map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} · ` : ''}{c.nombre} — {c.porcentaje}%</option>)}
                    </select>
                  </div>
                )}
                <div className="form-row" style={{ margin: 0, flex: '1 1 120px' }}>
                  <label>{l.tipo === 'iva' ? 'Base imponible' : 'Monto del pago'}</label>
                  <input className="input mono" value={l.baseStr} onChange={(e) => setLinea(l.id, { baseStr: e.target.value })} inputMode="decimal" />
                  <SeLeyo texto={l.baseStr} />
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
                  <div className="muted" style={{ fontSize: '.7rem' }}>Retenido</div>
                  <div className="mono" style={{ fontWeight: 700, color: monto > 0 ? 'var(--primary)' : 'var(--text-muted)' }}>{money(monto, moneda)}</div>
                </div>
                {lineas.length > 1 && (
                  <button type="button" className="btn btn-sm btn-ghost" title="Quitar la línea" onClick={() => { marcarSucio(); setLineas((xs) => xs.filter((x) => x.id !== l.id)); }}>✕</button>
                )}
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
                <div className="form-row" style={{ margin: '.3rem 0 0' }}>
                  <label>{supuestosIva ? '¿Aplica un supuesto con su propio porcentaje? (vigentes a la fecha de la factura)' : '¿Corresponde retener el 100%? (Providencia SNAT/2015/0049, art. 5)'}</label>
                  {(supuestosIva ? supuestosIva.map((x): [string, string] => [x.codigo, `${x.texto}${x.pct !== 100 ? ` (${x.pct} %)` : ''}`]) : MOTIVOS_IVA_CIEN).map(([k, label]) => (
                    <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.84rem', marginTop: '.2rem' }}>
                      <input type="checkbox" checked={!!l.motivos[k]} onChange={(e) => setLinea(l.id, { motivos: { ...l.motivos, [k]: e.target.checked } })} />
                      {label}
                    </label>
                  ))}
                  <small className="hint muted">Sin ninguna marcada se retiene el {config.pctIvaGeneral}%.</small>
                </div>
              )}
              {noPuede && <small className="hint" style={{ color: 'var(--warning)' }}>{motivoNoPuedePracticar(l.tipo, config)}</small>}
              {!esManual && <small className="hint muted">{calc.explicacion}</small>}
              {monto === 0 && (
                <div className="form-row" style={{ margin: '.3rem 0 0' }}>
                  <label style={{ color: 'var(--warning)' }}>Motivo del 0 % (obligatorio)</label>
                  <input className="input" value={l.descripcion} onChange={(e) => setLinea(l.id, { descripcion: e.target.value })}
                    placeholder="Ej.: el pago no supera el mínimo exento" />
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

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
    </Modal>
  );
}
