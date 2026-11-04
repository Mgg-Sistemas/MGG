/* ============================================================
   Golden Touch · RRHH · Datos bancarios del trabajador (03/11/2026)

   Formas de pago de cada persona, guardadas en `personal.datos_pago` (jsonb que
   ya existía y estaba vacío) como { cuentas: CuentaPago[] }:
     · Bs   → Pago móvil (banco, teléfono, cédula) · Transferencia (banco, cuenta
              de 20 dígitos, tipo, titular, cédula/RIF del titular).
     · USDT → Binance (usuario, correo o Binance ID) · TRC20 (dirección TRON).
   Las validaciones son suaves: avisan, y la pantalla no deja guardar si fallan.
   ============================================================ */
import { labelBanco } from '@/shared/lib/bancos';

export type TipoCuentaPago = 'pago_movil' | 'transferencia' | 'binance' | 'trc20';

export interface CuentaPago {
  id: string;
  tipo: TipoCuentaPago;
  /** Código SUDEBAN del banco (pago móvil / transferencia). */
  banco?: string | null;
  telefono?: string | null;
  cedula?: string | null;
  cuenta?: string | null;
  tipo_cuenta?: 'corriente' | 'ahorro' | null;
  titular?: string | null;
  /** Binance: usuario, correo o Binance ID. */
  usuario?: string | null;
  /** TRC20: dirección de billetera en la red TRON. */
  direccion?: string | null;
  principal?: boolean;
}

export const TIPOS_CUENTA: { tipo: TipoCuentaPago; label: string; moneda: 'Bs' | 'USDT'; icono: string }[] = [
  { tipo: 'pago_movil', label: 'Pago móvil', moneda: 'Bs', icono: '📱' },
  { tipo: 'transferencia', label: 'Transferencia', moneda: 'Bs', icono: '🏦' },
  { tipo: 'binance', label: 'Binance', moneda: 'USDT', icono: '🟡' },
  { tipo: 'trc20', label: 'TRC20 (red TRON)', moneda: 'USDT', icono: '🔗' },
];

export const infoTipo = (t: TipoCuentaPago) => TIPOS_CUENTA.find((x) => x.tipo === t) ?? TIPOS_CUENTA[0];

const soloDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/** Teléfono venezolano de pago móvil: 04xx + 7 dígitos (acepta guiones, espacios o +58). */
export function telefonoValido(t: string | null | undefined): boolean {
  let d = soloDigitos(t);
  if (d.startsWith('58') && d.length === 12) d = `0${d.slice(2)}`;
  return /^04(12|14|16|24|26|22)\d{7}$/.test(d);
}

/** Número de cuenta: 20 dígitos y los 4 primeros = código del banco (si se indicó). */
export function cuentaValida(cuenta: string | null | undefined, banco?: string | null): boolean {
  const d = soloDigitos(cuenta);
  if (d.length !== 20) return false;
  return !banco || d.startsWith(banco);
}

/** Dirección TRON (TRC20): empieza por T y tiene 34 caracteres base58. */
export function direccionTronValida(dir: string | null | undefined): boolean {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test((dir ?? '').trim());
}

/** Cédula o RIF: V/E/J/G/P + dígitos (el prefijo es opcional en cédulas). */
export function cedulaValida(c: string | null | undefined): boolean {
  return /^([VEJGP]-?)?\d{6,10}(-?\d)?$/i.test((c ?? '').replace(/[.\s]/g, ''));
}

/** Qué le falta o tiene mal una cuenta; `null` si está bien. */
export function errorCuenta(c: CuentaPago): string | null {
  switch (c.tipo) {
    case 'pago_movil':
      if (!c.banco) return 'Elige el banco del pago móvil.';
      if (!telefonoValido(c.telefono)) return 'El teléfono debe ser 04xx-xxxxxxx.';
      if (!cedulaValida(c.cedula)) return 'Indica la cédula del pago móvil (ej. V-12345678).';
      return null;
    case 'transferencia':
      if (!c.banco) return 'Elige el banco de la cuenta.';
      if (!cuentaValida(c.cuenta, c.banco)) return 'La cuenta debe tener 20 dígitos y empezar por el código del banco.';
      if (!c.titular?.trim()) return 'Indica el titular de la cuenta.';
      if (!cedulaValida(c.cedula)) return 'Indica la cédula o RIF del titular.';
      return null;
    case 'binance':
      return c.usuario?.trim() ? null : 'Indica el usuario, correo o Binance ID.';
    case 'trc20':
      return direccionTronValida(c.direccion) ? null : 'La dirección TRC20 empieza por T y tiene 34 caracteres.';
    default:
      return 'Tipo de cuenta desconocido.';
  }
}

/** Lee `personal.datos_pago` sin fallar con datos viejos o vacíos. */
export function leerCuentas(datosPago: unknown): CuentaPago[] {
  const lista = (datosPago as { cuentas?: unknown } | null)?.cuentas;
  if (!Array.isArray(lista)) return [];
  return lista.filter((x): x is CuentaPago => !!x && typeof x === 'object' && typeof (x as CuentaPago).tipo === 'string');
}

/** Renglones «etiqueta: valor» de una cuenta (para la ficha y para copiar). */
export function datosDeCuenta(c: CuentaPago): { etiqueta: string; valor: string }[] {
  const out: { etiqueta: string; valor: string }[] = [];
  const add = (etiqueta: string, valor?: string | null) => { if (valor?.trim()) out.push({ etiqueta, valor: valor.trim() }); };
  if (c.banco) add('Banco', labelBanco(c.banco));
  add('Teléfono', c.telefono);
  add('Cuenta', c.cuenta ? soloDigitos(c.cuenta) : null);
  add('Tipo de cuenta', c.tipo_cuenta === 'ahorro' ? 'Ahorro' : c.tipo_cuenta === 'corriente' ? 'Corriente' : null);
  add('Titular', c.titular);
  add(c.tipo === 'transferencia' ? 'Cédula/RIF del titular' : 'Cédula', c.cedula);
  add('Usuario / Binance ID', c.usuario);
  add('Dirección TRC20', c.direccion);
  return out;
}

/** Todo el bloque en texto, para pegarlo en un chat o en el banco. */
export function textoCuenta(c: CuentaPago): string {
  const i = infoTipo(c.tipo);
  return [`${i.label} (${i.moneda})`, ...datosDeCuenta(c).map((d) => `${d.etiqueta}: ${d.valor}`)].join('\n');
}
