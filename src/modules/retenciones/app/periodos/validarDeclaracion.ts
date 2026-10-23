/* ============================================================
   MGG · Retenciones v8 · Validar «Marcar período como declarado»

   Las reglas de retencion_periodo_declarar (paquete 07) y las de la tabla
   retencion_periodos, en la pantalla, para avisar antes de guardar:
   · la fecha, obligatoria, después del cierre del período y no futura;
   · el monto enterado, obligatorio y ≥ 0 (0 si no hubo operaciones);
   · planilla ≤ 20, N° ≤ 30 y observación ≤ 300 (largos de la pantalla;
     la base no los limita: pedido a BD).
   ============================================================ */

import type { Declaracion, PasoInicial, PeriodoRetencion } from '../datos/periodos';

/**
 * Comprueba si una fecha y tipo de impuesto caen en un período fiscal ya declarado/cerrado.
 * Devuelve el período si está cerrado, o null si está abierto o no existe.
 */
export function periodoCerradoPara(
  tipoImpuesto: string,
  fechaIso: string,
  periodos: readonly PeriodoRetencion[] | null | undefined,
): PeriodoRetencion | null {
  const d = fechaIso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !periodos || !periodos.length) return null;
  const encontrado = periodos.find(
    (p) => p.tipo === tipoImpuesto && p.desde <= d && d <= p.hasta && (p.estado === 'declarado' || !!p.declaradoEn)
  );
  return encontrado ?? null;
}

export interface EntradaDeclaracion { fecha: string; planilla: string; numero: string; monto: string; observacion: string }

/** «1.234,56» o «1234.56» → número; null si no es un número. */
export function leerMonto(s: string): number | null {
  const t = s.trim().replace(/\s/g, '');
  if (!t) return null;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^-?\d+(\.\d+)?$/.test(normal)) return null;
  return Number(normal);
}

export function validarDeclaracion(d: EntradaDeclaracion, hasta: string, hoy: string): { errores: Partial<Record<keyof EntradaDeclaracion, string>>; declaracion: Declaracion | null } {
  const errores: Partial<Record<keyof EntradaDeclaracion, string>> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) errores.fecha = 'Fecha de la declaración requerida.';
  else if (d.fecha <= hasta) errores.fecha = `El período cierra el ${hasta.split('-').reverse().join('/')}: la declaración va después.`;
  else if (d.fecha > hoy) errores.fecha = 'La fecha no puede ser futura.';
  const monto = leerMonto(d.monto);
  if (monto == null) errores.monto = 'Monto enterado requerido (0 si no hubo operaciones).';
  else if (monto < 0) errores.monto = 'El monto no puede ser negativo.';
  if (d.planilla.trim().length > 20) errores.planilla = 'Hasta 20 caracteres.';
  if (d.numero.trim().length > 30) errores.numero = 'Hasta 30 caracteres.';
  if (d.observacion.trim().length > 300) errores.observacion = 'Hasta 300 caracteres.';
  const ok = !Object.keys(errores).length && monto != null;
  return {
    errores,
    declaracion: ok ? { fecha: d.fecha, monto, planilla: d.planilla.trim(), numero: d.numero.trim(), observacion: d.observacion.trim() } : null,
  };
}

/* ───────── El paso inicial (retencion_paso_inicial) ───────── */

export interface EntradaPasoInicial { inicio: string; nombre: string; ultimo: string; anteriores: boolean }

/** Las reglas de retencion_paso_inicial: inicio obligatorio, desde 2020 y no posterior a hoy; el último N°, solo dígitos. */
export function validarPasoInicial(d: EntradaPasoInicial, hoy: string): { errores: Partial<Record<keyof EntradaPasoInicial, string>>; paso: PasoInicial | null } {
  const errores: Partial<Record<keyof EntradaPasoInicial, string>> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.inicio)) errores.inicio = 'Inicio del período en curso requerido.';
  else if (d.inicio < '2020-01-01') errores.inicio = 'La fecha no puede ser anterior a 2020.';
  else if (d.inicio > hoy) errores.inicio = 'El período en curso no puede empezar después de hoy.';
  const u = d.ultimo.trim();
  if (u && !/^\d{1,14}$/.test(u)) errores.ultimo = 'Solo dígitos (hasta 14).';
  if (d.nombre.trim().length > 60) errores.nombre = 'Hasta 60 caracteres.';
  return {
    errores,
    paso: Object.keys(errores).length ? null : { inicio: d.inicio, ultimoNumero: u ? Number(u) : null, anterioresOtroSistema: d.anteriores, nombreOtroSistema: d.nombre.trim() },
  };
}
