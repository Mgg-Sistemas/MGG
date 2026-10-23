/* ============================================================
   MGG · RRHH · Las empresas de la nómina (14-10-2026)

   Como en Golden Touch (Nómina GT / Nómina MTO) pero sin tope: la administradora
   crea las empresas que necesite en RRHH → ⚙ Empresas. Cada una es una nómina
   aparte: su personal, sus anticipos, sus períodos, sus recibos, sus descansos.
   La columna `empresa` de la base guarda el CÓDIGO (MGG, MTO…).

   Las definiciones viven en la tabla `rrhh_empresas`; acá se guardan en un
   registro en memoria (`registrarEmpresas`) para que los PDF y las pantallas
   pregunten por la razón social sin ir a la base cada vez. MGG siempre existe.
   ============================================================ */
import { normalizarRif } from '@/shared/lib/rif';

/** El código de la empresa (lo que guarda la columna `empresa`). */
export type Empresa = string;

export const EMPRESA_POR_DEFECTO: Empresa = 'MGG';

/** Moneda en que una empresa paga y emite sus recibos (23-10-2026, traído de Golden Touch). */
export type MonedaPagoEmpresa = 'USD' | 'BRL';

/** Lo que viene de la base → una moneda válida (cualquier otra cosa es dólares). */
export const monedaPagoValida = (v: unknown): MonedaPagoEmpresa => (v === 'BRL' ? 'BRL' : 'USD');

export const ETIQUETA_MONEDA_PAGO: Record<MonedaPagoEmpresa, string> = {
  USD: 'Dólares ($)',
  BRL: 'Real brasileño (R$)',
};

export interface DefinicionEmpresa {
  key: Empresa;
  /** Cómo se escribe en pantalla (corto): «MGG», «MTO». */
  label: string;
  /** Nombre largo, para los PDF y los encabezados. */
  razonSocial: string;
  rif: string | null;
  icono: string;
  color: string;
  orden: number;
  activa: boolean;
  /** USD: los recibos salen como siempre. BRL: el recibo de bonificación sale en $ y en Real brasileño. */
  monedaPago: MonedaPagoEmpresa;
}

export const MGG: DefinicionEmpresa = {
  key: 'MGG',
  label: 'MGG',
  razonSocial: 'Mineral Group Guayana C.A.',
  rif: 'J-50221930-7',
  icono: '⛏',
  color: '#ff8a00',
  orden: 0,
  activa: true,
  monedaPago: 'USD',
};

let registro = new Map<string, DefinicionEmpresa>([[MGG.key, MGG]]);

/** Carga (o recarga) el registro con lo que vino de la base. MGG nunca falta. */
export function registrarEmpresas(lista: DefinicionEmpresa[]): void {
  const m = new Map<string, DefinicionEmpresa>();
  for (const e of lista) m.set(e.key, e);
  if (!m.has(MGG.key)) m.set(MGG.key, MGG);
  registro = m;
}

/** Las empresas del registro, en el orden en que se muestran. */
export function empresasRegistradas(soloActivas = true): DefinicionEmpresa[] {
  return ordenarEmpresas([...registro.values()]).filter((e) => !soloActivas || e.activa);
}

export function ordenarEmpresas(lista: DefinicionEmpresa[]): DefinicionEmpresa[] {
  return [...lista].sort((a, b) => (a.orden - b.orden) || a.label.localeCompare(b.label));
}

/** El código en limpio: mayúsculas, solo letras y números, hasta 10. */
export function normalizarCodigoEmpresa(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

/** Normaliza lo que llegue de la base: una fila vieja sin empresa cae en MGG. */
export function normalizarEmpresa(v?: unknown): Empresa {
  return normalizarCodigoEmpresa(v) || EMPRESA_POR_DEFECTO;
}

/**
 * La definición de una empresa. Si el código no está en el registro (la lista
 * aún no cargó, o una fila apunta a una empresa que ya no existe) devuelve
 * una definición mínima con el código como nombre: nunca rompe una pantalla.
 */
export function definicionEmpresa(e?: Empresa | string | null): DefinicionEmpresa {
  const key = normalizarEmpresa(e);
  return registro.get(key) ?? { key, label: key, razonSocial: key, rif: null, icono: '🏢', color: '#ff8a00', orden: 99, activa: true, monedaPago: 'USD' };
}

/** ¿Esta empresa paga en Real brasileño? (sus recibos de bonificación llevan R$ y la nómina trae la tasa). */
export function pagaEnReal(e?: Empresa | string | null): boolean {
  return definicionEmpresa(e).monedaPago === 'BRL';
}

export interface ConEmpresa { empresa?: Empresa | string | null }

/* ───────── Alta y edición ───────── */

export interface DatosEmpresa {
  codigo: string;
  nombre: string;
  razonSocial: string;
  rif: string;
  icono: string;
  color: string;
  monedaPago: MonedaPagoEmpresa;
}

export const DATOS_EMPRESA_VACIOS: DatosEmpresa = { codigo: '', nombre: '', razonSocial: '', rif: '', icono: '🏢', color: '#ff8a00', monedaPago: 'USD' };

/** Qué está mal en el formulario, o null si se puede guardar. */
export function validarEmpresa(d: DatosEmpresa, existentes: DefinicionEmpresa[], editando: string | null = null): string | null {
  const codigo = normalizarCodigoEmpresa(d.codigo);
  if (codigo.length < 2) return 'El código lleva entre 2 y 10 letras o números (ej.: MTO).';
  if (!editando && existentes.some((e) => e.key === codigo)) return `Ya existe una empresa con el código ${codigo}.`;
  if (d.nombre.trim().length < 2) return 'Indica el nombre corto (lo que se ve en el switch).';
  if (d.razonSocial.trim().length < 3) return 'Indica la razón social (va en los PDF y los recibos).';
  if (d.rif.trim() && !normalizarRif(d.rif)) return 'El RIF no se entiende: escribilo como J-12345678-9.';
  if (!/^#[0-9a-fA-F]{6}$/.test(d.color.trim())) return 'El color tiene que ser un color de pantalla (ej.: #ff8a00).';
  return null;
}

/** Lo que se manda a la base, ya normalizado. */
export function datosEmpresaLimpios(d: DatosEmpresa): DatosEmpresa {
  return {
    codigo: normalizarCodigoEmpresa(d.codigo),
    nombre: d.nombre.trim(),
    razonSocial: d.razonSocial.trim(),
    rif: d.rif.trim() ? normalizarRif(d.rif) : '',
    icono: d.icono.trim() || '🏢',
    color: d.color.trim().toLowerCase(),
    monedaPago: monedaPagoValida(d.monedaPago),
  };
}

export function datosDeEmpresa(e: DefinicionEmpresa): DatosEmpresa {
  return { codigo: e.key, nombre: e.label, razonSocial: e.razonSocial, rif: e.rif ?? '', icono: e.icono, color: e.color, monedaPago: e.monedaPago };
}

/* ───────── El switch del encabezado ───────── */

/** Hasta dos nóminas se muestran como pastillas (como en GT); de tres en adelante, lista plegable buscable. */
export function modoSelectorEmpresas(cuantasActivas: number): 'pastillas' | 'lista' {
  return cuantasActivas <= 2 ? 'pastillas' : 'lista';
}

/** La última nómina elegida se recuerda en este navegador. */
export const CLAVE_EMPRESA_ELEGIDA = 'mgg.rrhh.empresa';

export function empresaGuardada(leer: () => string | null = () => { try { return localStorage.getItem(CLAVE_EMPRESA_ELEGIDA); } catch { return null; } }): Empresa {
  return normalizarEmpresa(leer());
}

export function guardarEmpresaElegida(e: Empresa): void {
  try { localStorage.setItem(CLAVE_EMPRESA_ELEGIDA, e); } catch { /* modo privado */ }
}

/** La nómina que queda abierta: la guardada si sigue activa; si no, la primera. */
export function empresaVigente(elegida: Empresa, activas: DefinicionEmpresa[]): Empresa {
  if (!activas.length) return elegida || EMPRESA_POR_DEFECTO;
  return activas.some((e) => e.key === elegida) ? elegida : activas[0].key;
}

/* ───────── Transferir a una persona ───────── */

/** Las nóminas a las que se puede pasar alguien: las activas distintas de la suya. */
export function destinosDeTransferencia(empresaActual: Empresa | string | null | undefined, activas: DefinicionEmpresa[]): DefinicionEmpresa[] {
  const actual = normalizarEmpresa(empresaActual);
  return activas.filter((e) => e.activa && e.key !== actual);
}

/** ¿Se puede deshabilitar? No si es MGG ni si todavía tiene gente activa. */
export function errorDeshabilitarEmpresa(e: DefinicionEmpresa, personalActivo: number): string | null {
  if (e.key === EMPRESA_POR_DEFECTO) return 'MGG es la empresa principal: no se deshabilita.';
  if (personalActivo > 0) return `Todavía tiene ${personalActivo} persona(s) activa(s): transfiérelas a otra nómina o dales de baja antes.`;
  return null;
}
