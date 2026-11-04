/* ============================================================
   MGG · RRHH · Datos bancarios del trabajador (03-11-2026)

   Pedido de la administradora: en la ficha, un segmento «DATOS BANCARIOS»:
   · En Bs: PAGO MÓVIL (banco, teléfono, cédula) y TRANSFERENCIA (banco,
     número de cuenta, titular, cédula).
   · En USDT: BINANCE (usuario), red TRC20 («TR20») y TRON (direcciones).
   Se guarda en `personal.datos_pago` (jsonb, ya existía sin uso). Todo es
   opcional: se llena lo que el trabajador tenga.
   ============================================================ */
import { labelBanco } from '@/shared/lib/bancos';

export interface PagoMovil { banco: string; telefono: string; cedula: string }
export interface Transferencia { banco: string; cuenta: string; titular: string; cedula: string }
export interface DatosBancarios {
  pago_movil: PagoMovil;
  transferencia: Transferencia;
  binance: string;
  trc20: string;
  tron: string;
}

export const DATOS_BANCARIOS_VACIOS: DatosBancarios = {
  pago_movil: { banco: '', telefono: '', cedula: '' },
  transferencia: { banco: '', cuenta: '', titular: '', cedula: '' },
  binance: '',
  trc20: '',
  tron: '',
};

const txt = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

/** Lee lo guardado (o null) a la forma del formulario, con todo en texto. */
export function leerDatosBancarios(raw: unknown): DatosBancarios {
  const r = obj(raw);
  const pm = obj(r.pago_movil);
  const tr = obj(r.transferencia);
  return {
    pago_movil: { banco: txt(pm.banco), telefono: txt(pm.telefono), cedula: txt(pm.cedula) },
    transferencia: { banco: txt(tr.banco), cuenta: txt(tr.cuenta), titular: txt(tr.titular), cedula: txt(tr.cedula) },
    binance: txt(r.binance),
    trc20: txt(r.trc20),
    tron: txt(r.tron),
  };
}

const soloDigitos = (s: string) => s.replace(/\D+/g, '');

/**
 * Lo que se guarda: limpio, la cuenta solo con dígitos, la cédula en mayúsculas, y
 * null si no hay nada (para no guardar un objeto vacío).
 */
export function normalizarDatosBancarios(d: DatosBancarios | null | undefined): DatosBancarios | null {
  if (!d) return null;
  const x = leerDatosBancarios(d);
  const out: DatosBancarios = {
    pago_movil: { banco: x.pago_movil.banco, telefono: x.pago_movil.telefono, cedula: x.pago_movil.cedula.toUpperCase() },
    transferencia: {
      banco: x.transferencia.banco, cuenta: soloDigitos(x.transferencia.cuenta),
      titular: x.transferencia.titular.toUpperCase(), cedula: x.transferencia.cedula.toUpperCase(),
    },
    binance: x.binance,
    trc20: x.trc20,
    tron: x.tron,
  };
  return tieneDatosBancarios(out) ? out : null;
}

export function tieneDatosBancarios(d: DatosBancarios | null | undefined): boolean {
  if (!d) return false;
  return [d.pago_movil.banco, d.pago_movil.telefono, d.pago_movil.cedula, d.transferencia.banco, d.transferencia.cuenta,
    d.transferencia.titular, d.transferencia.cedula, d.binance, d.trc20, d.tron].some((v) => !!v.trim());
}

/** Avisos que no dejan guardar: una cuenta que no tiene 20 dígitos o un pago móvil a medias. */
export function errorDatosBancarios(d: DatosBancarios | null | undefined): string | null {
  if (!d) return null;
  const cuenta = soloDigitos(d.transferencia.cuenta);
  if (cuenta && cuenta.length !== 20) return 'El número de cuenta debe tener 20 dígitos.';
  const pm = d.pago_movil;
  const algoPm = !!(pm.banco || pm.telefono.trim() || pm.cedula.trim());
  if (algoPm && !(pm.banco && pm.telefono.trim() && pm.cedula.trim())) return 'Pago móvil: indica banco, teléfono y cédula.';
  return null;
}

/** Renglones para la ficha y el PDF: [etiqueta, valor]. Solo lo que tiene datos. */
export function renglonesDatosBancarios(raw: unknown): [string, string][] {
  const d = leerDatosBancarios(raw);
  const out: [string, string][] = [];
  const pm = d.pago_movil;
  if (pm.banco || pm.telefono || pm.cedula) {
    out.push(['Pago móvil (Bs)', [pm.banco ? labelBanco(pm.banco) : '', pm.telefono, pm.cedula].filter(Boolean).join(' · ')]);
  }
  const tr = d.transferencia;
  if (tr.banco || tr.cuenta || tr.titular || tr.cedula) {
    out.push(['Transferencia (Bs)', [tr.banco ? labelBanco(tr.banco) : '', tr.cuenta, tr.titular, tr.cedula].filter(Boolean).join(' · ')]);
  }
  if (d.binance) out.push(['Binance (USDT)', d.binance]);
  if (d.trc20) out.push(['USDT · red TRC20', d.trc20]);
  if (d.tron) out.push(['USDT · TRON', d.tron]);
  return out;
}
