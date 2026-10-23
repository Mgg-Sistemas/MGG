/* ============================================================
   Golden Touch · Libro fiscal · El registro suelto con R10

   · Retener después desde el registro suelto: si se elige en el N° de
     factura una factura ya registrada, la retención va como UNA línea sobre
     ese documento (retencion_lineas_registrar). La línea lleva los mismos
     valores que hoy guarda registrarRetencion (filaGtDeNueva).
   · Libro › «Sin retención»: las decisiones «no aplica» junto a las
     retenciones en 0 %, con los filtros del Libro.
   Funciones puras: sin base ni pantalla.
   ============================================================ */
import { enBolivares, type DireccionRetencion, type EstadoRetencion, type TipoImpuesto } from './retencionesCalculo';
import { partirIdConcepto, tipoDeGt, type NuevaRetencion } from './retencionesFiscal.repository';
import type { LineaFacturaNueva } from './retencionFacturas.repository';
import type { FacturaResumen, NoAplicaRegistrado } from './facturasResumen.repository';
import { numeroATexto } from './validarCarga';
import { buscaEn } from './listas';
import { rotuloAutor, rotuloImpuesto } from './rotulos';

const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * La línea para retener después, armada con lo mismo que el registro suelto
 * manda a registrarRetencion: impuesto, base, %, monto, sustraendo, IVA,
 * moneda y tasa (con sus equivalentes en Bs), concepto, municipio (solo ISAE),
 * observación, N° del comprobante (solo en una recibida), quincena, la fecha
 * de la retención y la regla (R7) si la hay.
 */
export function lineaRetenerDespues(input: NuevaRetencion): LineaFacturaNueva {
  const tasa = input.moneda === 'Bs' ? null : input.tasa ?? null;
  const base = r2(input.baseImponible);
  const monto = r2(input.montoRetenido);
  const conceptoCodigo = input.conceptoId && !input.conceptoId.endsWith(':todos') ? partirIdConcepto(input.conceptoId).codigo || null : null;
  return {
    tipo: input.tipo,
    base,
    porcentaje: n(input.porcentaje),
    monto,
    sustraendo: input.sustraendo ?? null,
    ivaAlicuota: input.tipo === 'iva' ? input.alicuota ?? null : null,
    ivaMonto: input.tipo === 'iva' ? input.impuesto ?? null : null,
    moneda: input.moneda || 'Bs',
    tasa,
    baseBs: enBolivares(base, input.moneda, tasa ?? 0) || null,
    montoBs: enBolivares(monto, input.moneda, tasa ?? 0) || null,
    conceptoCodigo,
    conceptoNombre: input.conceptoNombre?.trim() || null,
    municipio: input.tipo === 'municipal' ? input.municipio?.trim() || null : null,
    descripcion: input.observacion?.trim() || null,
    // En una practicada el número lo pone la base (o numerarSinV2R); en una recibida, el del comprobante del cliente.
    comprobanteNro: input.direccion === 'recibida' ? input.numeroComprobante?.trim() || null : null,
    quincena: input.quincena ?? null,
    // La fecha de la línea es la de la retención; el período sale de la factura.
    fecha: (input.fechaRetencion || input.facturaFecha || '').slice(0, 10) || null,
    regla: input.regla ?? null,
  };
}

/** Lo que se precarga en el registro suelto al elegir una factura ya registrada. */
export interface PrecargaFactura {
  direccion: DireccionRetencion;
  proveedorId: string;
  contraparte: string;
  rif: string;
  facturaNumero: string;
  facturaControl: string;
  facturaFecha: string;
  moneda: string;
  /** La tasa de la factura, con coma decimal; vacía si la factura no la trae. */
  tasaStr: string;
  /** El primer impuesto pendiente (null si no queda ninguno). */
  tipo: TipoImpuesto | null;
  /** Los impuestos que se ofrecen: solo los pendientes de la factura. */
  impuestos: TipoImpuesto[];
}

export function precargaDeFactura(f: FacturaResumen): PrecargaFactura {
  const impuestos = f.pendientes.map((k) => tipoDeGt(k));
  return {
    direccion: f.direccion,
    proveedorId: f.proveedorId ?? '',
    contraparte: f.razonSocial ?? '',
    rif: f.rif ?? '',
    facturaNumero: f.facturaNro ?? '',
    facturaControl: f.facturaControl ?? '',
    facturaFecha: (f.facturaFecha ?? '').slice(0, 10),
    moneda: f.moneda === '$' ? 'USD' : f.moneda || 'Bs',
    tasaStr: f.tasa != null && f.tasa > 0 ? numeroATexto(f.tasa) : '',
    tipo: impuestos[0] ?? null,
    impuestos,
  };
}

/* ───────── Libro › «Sin retención»: las decisiones «no aplica» ───────── */

export interface FiltroNoAplica {
  texto?: string;
  tipo?: '' | TipoImpuesto;
  direccion?: '' | DireccionRetencion;
  estado?: '' | EstadoRetencion | 'anulada';
}

export interface FilaNoAplica {
  id: string;
  impuesto: string;
  facturaNro: string;
  facturaFecha: string | null;
  proveedor: string;
  rif: string | null;
  motivo: string;
  detalle: string | null;
  quien: string;
  cuando: string;
}

/**
 * Las decisiones «no aplica» que se ven con los filtros del Libro. Son de lo
 * que la empresa practica y no tienen estado de retención: con «Recibida» o
 * con un estado elegido no aparece ninguna.
 */
export function filasNoAplica(xs: NoAplicaRegistrado[], f: FiltroNoAplica = {}): FilaNoAplica[] {
  if (f.direccion === 'recibida' || f.estado) return [];
  return xs
    .filter((d) => !f.tipo || tipoDeGt(d.impuestoClave) === f.tipo)
    .filter((d) => buscaEn(f.texto ?? '', d.razonSocial, d.rif, d.facturaNro, d.motivo, d.detalle))
    .map((d) => ({
      id: d.id,
      impuesto: rotuloImpuesto(d.impuestoClave),
      facturaNro: d.facturaNro ?? 'Sin número',
      facturaFecha: d.facturaFecha ? d.facturaFecha.slice(0, 10) : null,
      proveedor: d.razonSocial ?? 'Sin proveedor',
      rif: d.rif,
      motivo: d.motivo,
      detalle: d.detalle,
      quien: rotuloAutor(d.quien),
      cuando: d.cuando,
    }));
}
