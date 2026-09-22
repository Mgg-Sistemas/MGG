/* ============================================================
   MGG · RRHH · El cambio de sueldo

   La cuenta y las reglas del cambio, sin base de datos y sin pantalla, para
   poder probarlas renglón por renglón.

   DOS REGLAS QUE NO SE NEGOCIAN
   · Si el sueldo cambia, hay que decir POR QUÉ. Un aumento y una corrección
     de un error de tipeo se ven igual en la ficha, y no son lo mismo: sin el
     motivo, el historial no sirve para respaldar una nómina vieja.
   · Si el sueldo NO cambia, no se pide motivo ni se escribe historial.
     Corregir un teléfono no es un cambio de sueldo.

   El sueldo se compara REDONDEADO A CENTAVOS: 500 y 500,004 son el mismo
   sueldo, y un historial lleno de renglones de cero centavos es ruido.
   ============================================================ */

/** Etiqueta opcional para agrupar los cambios. El motivo en palabras es aparte. */
export type TipoCambioSueldo = 'aumento' | 'ajuste' | 'ascenso' | 'correccion' | 'rebaja' | 'inicial';

export const TIPOS_CAMBIO_SUELDO: { key: TipoCambioSueldo; label: string; ayuda: string }[] = [
  { key: 'aumento', label: 'Aumento', ayuda: 'Se le sube el sueldo por desempeño o acuerdo.' },
  { key: 'ajuste', label: 'Ajuste', ayuda: 'Actualización por costo de vida o revisión general.' },
  { key: 'ascenso', label: 'Ascenso / cambio de cargo', ayuda: 'El sueldo cambia porque cambió el cargo.' },
  { key: 'correccion', label: 'Corrección de un error', ayuda: 'El sueldo estaba mal cargado: esto no es un aumento.' },
  { key: 'rebaja', label: 'Rebaja', ayuda: 'Baja acordada del sueldo.' },
];

export function labelTipoCambio(t: TipoCambioSueldo | string | null | undefined): string {
  if (t === 'inicial') return 'Carga inicial';
  return TIPOS_CAMBIO_SUELDO.find((x) => x.key === t)?.label ?? '—';
}

const n0 = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** A centavos: es la unidad real del sueldo. */
export const aCentavos = (v: unknown) => Math.round(n0(v) * 100) / 100;

/** ¿Cambió el sueldo? Se compara a nivel de centavo, no de coma flotante. */
export function huboCambioSueldo(anterior: unknown, nuevo: unknown): boolean {
  return aCentavos(anterior) !== aCentavos(nuevo);
}

export type DireccionCambio = 'aumento' | 'rebaja' | 'igual';

export interface VariacionSueldo {
  anterior: number;
  nuevo: number;
  /** Diferencia en USD. Negativa si baja. */
  monto: number;
  /** Variación porcentual. `null` cuando no había sueldo antes: no se divide entre cero. */
  pct: number | null;
  direccion: DireccionCambio;
}

/**
 * De cuánto a cuánto, en plata y en porcentaje.
 *
 * Cuando el sueldo anterior era cero NO hay porcentaje: pasar de 0 a 500 no es
 * «un aumento infinito», es la primera vez que se le carga un sueldo.
 */
export function variacionSueldo(anterior: unknown, nuevo: unknown): VariacionSueldo {
  const a = aCentavos(anterior);
  const b = aCentavos(nuevo);
  const monto = aCentavos(b - a);
  return {
    anterior: a,
    nuevo: b,
    monto,
    pct: a > 0 ? Math.round(((b - a) / a) * 1000) / 10 : null,
    direccion: monto > 0 ? 'aumento' : monto < 0 ? 'rebaja' : 'igual',
  };
}

/** La variación en una línea, para mostrarla al lado del campo. */
export function textoVariacion(v: VariacionSueldo): string {
  if (v.direccion === 'igual') return 'El sueldo no cambia.';
  if (v.anterior === 0) return `Primer sueldo cargado para esta persona: ${v.nuevo.toLocaleString('es-VE')}.`;
  const verbo = v.direccion === 'aumento' ? 'Sube' : 'Baja';
  const signo = v.pct == null ? '' : ` (${v.pct > 0 ? '+' : ''}${v.pct}%)`;
  return `${verbo} ${Math.abs(v.monto).toLocaleString('es-VE')}${signo}: de ${v.anterior.toLocaleString('es-VE')} a ${v.nuevo.toLocaleString('es-VE')}.`;
}

export interface CambioSueldoInput {
  anterior: unknown;
  nuevo: unknown;
  motivo?: string | null;
  vigenteDesde?: string | null;
}

/**
 * Qué falta para poder guardar. Devuelve el reclamo en palabras, o `null` si
 * está todo. No lanza: el formulario quiere mostrarlo, no explotar.
 */
export function validarCambioSueldo(input: CambioSueldoInput): string | null {
  if (!huboCambioSueldo(input.anterior, input.nuevo)) return null;
  if (aCentavos(input.nuevo) < 0) return 'El sueldo no puede ser negativo.';
  const motivo = String(input.motivo ?? '').trim();
  if (!motivo) return 'El sueldo cambió: escribí por qué. Queda en el historial de la persona.';
  if (motivo.length < 4) return 'El motivo es muy corto: explicá el cambio en una frase.';
  if (input.vigenteDesde && !/^\d{4}-\d{2}-\d{2}$/.test(input.vigenteDesde)) {
    return 'La fecha desde la que rige el nuevo sueldo no es válida.';
  }
  return null;
}

/** ¿Se puede guardar el formulario? Atajo legible de `validarCambioSueldo`. */
export function cambioSueldoValido(input: CambioSueldoInput): boolean {
  return validarCambioSueldo(input) === null;
}

/**
 * El tipo que se sugiere solo, mirando hacia dónde se mueve el sueldo. Es una
 * sugerencia: quien carga puede decir que en realidad fue una corrección.
 */
export function tipoSugerido(anterior: unknown, nuevo: unknown): TipoCambioSueldo {
  const v = variacionSueldo(anterior, nuevo);
  if (v.anterior === 0) return 'inicial';
  return v.direccion === 'rebaja' ? 'rebaja' : 'aumento';
}

export interface RenglonHistorial {
  sueldoAnterior: number;
  sueldoNuevo: number;
  vigenteDesde: string;
}

/**
 * El sueldo que regía en una fecha dada, según el historial. Sirve para
 * explicar una nómina vieja: «en abril ganaba esto, y por eso se le pagó esto».
 *
 * Toma el último renglón cuya vigencia ya había empezado. Si en esa fecha
 * todavía no regía ninguno, devuelve `null`: no se inventa un sueldo.
 */
export function sueldoVigenteEn(historial: RenglonHistorial[], fecha: string): number | null {
  const f = String(fecha ?? '').slice(0, 10);
  if (!f) return null;
  const aplicables = historial
    .filter((r) => String(r.vigenteDesde ?? '').slice(0, 10) <= f)
    .sort((a, b) => String(a.vigenteDesde).localeCompare(String(b.vigenteDesde)));
  const ultimo = aplicables[aplicables.length - 1];
  return ultimo ? aCentavos(ultimo.sueldoNuevo) : null;
}
