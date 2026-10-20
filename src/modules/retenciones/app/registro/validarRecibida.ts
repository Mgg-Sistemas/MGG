/* ============================================================
   MGG · Retenciones v8 · Las reglas de una retención recibida

   La que nos practica un cliente: los números vienen de SU comprobante y
   se copian, no se calculan. Cada campo con su error en palabras del
   usuario; la pantalla no deja guardar mientras haya alguno. Nada se
   corrige en silencio: si falta el monto retenido, se pide (la pantalla
   ofrece «base × %» como sugerencia, con un botón, nunca por su cuenta).
   La tabla frente a la base, en informes/2026-10-20-validacion-campos-v8.md (§4).
   ============================================================ */

import { parseDecimal } from '@/shared/ui/DecimalInput';
import { revisarRif } from './validarRif';

export type ImpuestoRecibida = 'iva' | 'islr' | 'municipal';

export interface FormRecibida {
  tipo: ImpuestoRecibida;
  cliente: string;
  rif: string;
  numero: string;
  factura: string;
  control: string;
  fecha: string;
  moneda: 'Bs' | 'USD';
  base: string;
  iva: string;
  pct: string;
  monto: string;
  observacion: string;
  archivo: File | null;
}

export type ErroresRecibida = Partial<Record<keyof FormRecibida, string>>;

const hoyIso = () => new Date().toLocaleDateString('en-CA');

export function validarRecibida(f: FormRecibida, hoy = hoyIso()): ErroresRecibida {
  const e: ErroresRecibida = {};
  const rif = revisarRif(f.rif);
  if (!f.cliente.trim()) e.cliente = 'Indique el cliente que practicó la retención.';
  else if (f.cliente.trim().length > 200) e.cliente = 'El nombre del cliente no puede pasar de 200 caracteres.';
  if (rif.error) e.rif = rif.error.replace('El proveedor no tiene RIF en su ficha: cargarlo en Proveedores antes de registrar.', 'Indique el RIF del cliente.').replace('del proveedor', 'del cliente').replace(' Corregirlo en Proveedores.', '');
  const numero = f.numero.trim();
  if (!numero) e.numero = 'Indique el N° del comprobante que entregó el cliente.';
  else if (f.tipo === 'iva' && !/^\d{14}$/.test(numero.replace(/[\s-]/g, ''))) e.numero = 'El comprobante de IVA tiene 14 dígitos (AAAAMM y 8 del correlativo).';
  else if (numero.length > 20) e.numero = 'El N° de comprobante no puede pasar de 20 caracteres.';
  if (!f.factura.trim()) e.factura = 'Indique el N° de la factura de venta.';
  else if (f.factura.trim().length > 20) e.factura = 'El N° de factura no puede pasar de 20 caracteres.';
  if (f.control.trim().length > 20) e.control = 'El N° de control no puede pasar de 20 caracteres.';
  if (!f.fecha) e.fecha = 'Indique la fecha de la factura.';
  else if (f.fecha > hoy) e.fecha = 'La fecha de la factura no puede ser posterior a hoy.';
  const base = parseDecimal(f.base);
  if (base == null || base <= 0) e.base = 'Indique la base imponible (mayor que 0).';
  if (f.tipo === 'iva') {
    const iva = parseDecimal(f.iva);
    if (iva == null || iva < 0) e.iva = 'Indique el IVA de la factura (0 si no tiene).';
  }
  const pct = parseDecimal(f.pct);
  if (pct == null || pct <= 0 || pct > 100) e.pct = 'Indique el % retenido (mayor que 0 y hasta 100).';
  const monto = parseDecimal(f.monto);
  if (monto == null || monto <= 0) e.monto = 'Indique el monto retenido que dice el comprobante.';
  if (f.observacion.trim().length > 300) e.observacion = 'La observación no puede pasar de 300 caracteres.';
  if (f.archivo && f.archivo.type && f.archivo.type !== 'application/pdf' && !f.archivo.type.startsWith('image/')) e.archivo = 'El comprobante debe ser PDF o imagen.';
  return e;
}

/** La sugerencia «base × %» (o «IVA × %» en el IVA), para ofrecerla con un botón. null si no se puede calcular. */
export function sugerenciaMonto(f: Pick<FormRecibida, 'tipo' | 'base' | 'iva' | 'pct'>): number | null {
  const sobre = parseDecimal(f.tipo === 'iva' ? f.iva : f.base);
  const pct = parseDecimal(f.pct);
  if (sobre == null || pct == null || sobre <= 0 || pct <= 0) return null;
  return Math.round(sobre * pct) / 100;
}

/** El aviso cuando el monto escrito no coincide con la cuenta: no bloquea (el comprobante del cliente manda). */
export function avisoMonto(f: Pick<FormRecibida, 'tipo' | 'base' | 'iva' | 'pct' | 'monto'>): string | null {
  const sug = sugerenciaMonto(f);
  const monto = parseDecimal(f.monto);
  if (sug == null || monto == null) return null;
  return Math.abs(sug - monto) > 0.01
    ? `El monto (${monto.toLocaleString('es-VE', { minimumFractionDigits: 2 })}) no coincide con ${f.tipo === 'iva' ? 'IVA' : 'base'} × % (${sug.toLocaleString('es-VE', { minimumFractionDigits: 2 })}). Verificarlo en el comprobante del cliente.`
    : null;
}
