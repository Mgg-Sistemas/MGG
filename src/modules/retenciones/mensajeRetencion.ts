/* ============================================================
   Golden Touch · Retenciones · Mensaje de WhatsApp de una retención

   Texto limpio (estilo mensajeFacturaExterna) para compartir en WhatsApp al
   terminar de registrar la(s) retención(es) de una factura. Cubre 1 o N
   retenciones sobre la MISMA factura en un solo mensaje: las aplicadas (con su
   monto) y las que quedaron sin aplicar, el total y lo retenido, y el estado de
   pago de Tesorería (pagada/pendiente y, si está pagada, con qué monto).
   ============================================================ */
import type { TipoImpuesto } from '@/modules/libroFiscal/retencionesCalculo';
import type { RetencionPracticada } from '@/modules/libroFiscal/retencionesFiscal.repository';
import { rotuloCortoImpuesto, textoPago } from './estadoRetencion';

const montoVe = (n: number) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fechaCorta(f: string | null | undefined): string {
  const d = String(f ?? '').slice(0, 10);
  if (d.length !== 10) return '—';
  const [y, m, dia] = d.split('-');
  return `${dia}/${m}/${y}`;
}

export interface RetencionAplicada {
  tipo: TipoImpuesto;
  montoRetenido: number;
  montoBs: number | null;
  moneda: string;
}

export interface DatosMensajeRetencion {
  /** Razón social del agente de retención (la empresa). */
  empresaAgente: string;
  proveedorNombre: string;
  proveedorRif?: string | null;
  /** N° de la OC / CS / documento de origen. */
  ocNumero?: string | null;
  facturaNumero?: string | null;
  facturaControl?: string | null;
  facturaFecha?: string | null;
  moneda: string;
  /** Total de la factura, en su moneda. */
  montoTotal?: number | null;
  aplicadas: RetencionAplicada[];
  /** Impuestos que se debían pero no se retuvieron en esta factura. */
  noAplicadas?: TipoImpuesto[];
  pagada?: boolean;
  montoPagado?: number | null;
  monedaPago?: string | null;
}

/** El símbolo de una moneda ('Bs' o '$'). */
const sig = (m: string) => (m === 'Bs' ? 'Bs' : '$');

export function mensajeRetencion(d: DatosMensajeRetencion): string {
  const lineas: string[] = [];
  lineas.push('🧾 *RETENCIÓN REGISTRADA*');
  lineas.push(`🏢 *Agente:* ${d.empresaAgente || 'Empresa'}`);
  lineas.push(`👤 *Proveedor:* ${d.proveedorNombre || '—'}`);
  if (d.proveedorRif) lineas.push(`🆔 *RIF:* ${d.proveedorRif}`);
  if (d.ocNumero) lineas.push(`📄 *N° de OC:* ${d.ocNumero}`);
  if (d.facturaNumero) lineas.push(`🧾 *N° Factura:* ${d.facturaNumero}`);
  if (d.facturaControl) lineas.push(`🔢 *N° Control:* ${d.facturaControl}`);
  if (d.facturaFecha) lineas.push(`📅 *Fecha factura:* ${fechaCorta(d.facturaFecha)}`);
  if (d.montoTotal != null) lineas.push(`💰 *Monto total:* ${sig(d.moneda)} ${montoVe(d.montoTotal)}`);

  // Lo retenido se informa en bolívares (es como se declara); si no hay Bs, en su moneda.
  const totalBs = d.aplicadas.reduce((s, a) => s + (a.montoBs ?? 0), 0);
  if (totalBs > 0) {
    lineas.push(`✂️ *Retenido (total):* Bs ${montoVe(totalBs)}`);
  }

  if (d.aplicadas.length) {
    lineas.push('✅ *Retenciones aplicadas:*');
    for (const a of d.aplicadas) {
      const enBs = a.montoBs != null && a.montoBs > 0;
      const monto = enBs ? `Bs ${montoVe(a.montoBs as number)}` : `${sig(a.moneda)} ${montoVe(a.montoRetenido)}`;
      lineas.push(`   • ${rotuloCortoImpuesto(a.tipo)}: ${monto}`);
    }
  }
  const noAplic = (d.noAplicadas ?? []).filter((t) => !d.aplicadas.some((a) => a.tipo === t));
  if (noAplic.length) {
    lineas.push(`🚫 *No aplicadas:* ${noAplic.map(rotuloCortoImpuesto).join(', ')}`);
  }

  lineas.push(`💵 *Tesorería:* ${textoPago({ pagada: !!d.pagada, montoPagado: d.montoPagado, monedaPago: d.monedaPago })}`);
  return lineas.join('\n');
}

/**
 * Arma los datos del mensaje a partir de las líneas registradas de una factura
 * (1 o N retenciones de la MISMA factura) y lo que define quién llama: el agente,
 * los impuestos aplicables (para saber cuáles quedaron sin aplicar) y el pago.
 */
export function datosMensajeDeRetenciones(
  lineas: RetencionPracticada[],
  extra: {
    empresaAgente: string;
    aplicables?: readonly TipoImpuesto[];
    pagada?: boolean;
    montoPagado?: number | null;
    monedaPago?: string | null;
  },
): DatosMensajeRetencion {
  const primera = lineas[0];
  const aplicadas: RetencionAplicada[] = lineas.map((l) => ({
    tipo: l.tipo, montoRetenido: l.montoRetenido, montoBs: l.montoBs, moneda: l.moneda,
  }));
  const tiposAplicados = new Set(aplicadas.map((a) => a.tipo));
  const noAplicadas = (extra.aplicables ?? []).filter((t) => !tiposAplicados.has(t));
  return {
    empresaAgente: extra.empresaAgente,
    proveedorNombre: primera?.contraparteNombre ?? '—',
    proveedorRif: primera?.contraparteRif ?? null,
    ocNumero: primera?.docCodigo ?? null,
    facturaNumero: primera?.facturaNumero ?? null,
    facturaControl: primera?.facturaControl ?? null,
    facturaFecha: primera?.facturaFecha ?? null,
    moneda: primera?.moneda ?? 'Bs',
    montoTotal: primera?.facturaTotal ?? null,
    aplicadas,
    noAplicadas,
    pagada: extra.pagada,
    montoPagado: extra.montoPagado ?? null,
    monedaPago: extra.monedaPago ?? null,
  };
}
