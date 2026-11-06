/* ============================================================
   MGG · RRHH · Cumpleañeros del día (lógica pura)
   Detecta qué trabajadores activos están de cumpleaños hoy
   según el horario de Venezuela (America/Caracas).
   ============================================================ */
import type { Personal } from '@/shared/lib/types';
import { hoyVE } from './minutaModelo';

export interface Cumpleanero {
  id: string;
  nombre: string;
  apellido: string;
  nombreCompleto: string;
  cargo: string | null;
  departamento: string | null;
  empresa: string | null;
  foto_url: string | null;
  fecha_nacimiento: string;
  edad: number | null;
}

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** ¿El año es bisiesto? */
export function esBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

/**
 * ¿El trabajador está de cumpleaños hoy?
 * Compara mes y día en horario de Venezuela.
 * Si nació el 29 de febrero y el año actual no es bisiesto, se celebra el 28 de febrero.
 */
export function esCumpleanosHoy(fechaNacimiento: unknown, hoy: string = hoyVE()): boolean {
  const nac = String(fechaNacimiento ?? '').slice(0, 10);
  const h = String(hoy ?? '').slice(0, 10);

  if (!FECHA_REGEX.test(nac) || !FECHA_REGEX.test(h)) return false;
  // No puede ser fecha futura
  if (nac > h) return false;

  const mesDiaNac = nac.slice(5); // MM-DD
  const mesDiaHoy = h.slice(5); // MM-DD

  if (mesDiaNac === mesDiaHoy) return true;

  // 29 de febrero en año no bisiesto se celebra el 28 de febrero
  const anioHoy = Number(h.slice(0, 4));
  if (mesDiaNac === '02-29' && mesDiaHoy === '02-28' && !esBisiesto(anioHoy)) {
    return true;
  }

  return false;
}

/**
 * Edad que cumple el trabajador hoy (o null si la fecha no es válida o futura).
 */
export function edadCumplida(fechaNacimiento: unknown, hoy: string = hoyVE()): number | null {
  const nac = String(fechaNacimiento ?? '').slice(0, 10);
  const h = String(hoy ?? '').slice(0, 10);

  if (!FECHA_REGEX.test(nac) || !FECHA_REGEX.test(h)) return null;
  const anioNac = Number(nac.slice(0, 4));
  const anioHoy = Number(h.slice(0, 4));
  const edad = anioHoy - anioNac;

  return edad > 0 && edad < 125 ? edad : null;
}

/**
 * Filtra y devuelve los cumpleañeros del día entre el personal activo.
 * Si se especifica `empresaFiltro` distinta de 'TODAS', filtra por esa empresa.
 */
export function obtenerCumpleaneros(
  personal: Personal[],
  hoy: string = hoyVE(),
  empresaFiltro?: string,
): Cumpleanero[] {
  const activos = (personal ?? []).filter((p) => p && p.activo !== false);

  const filtradosPorEmpresa = empresaFiltro && empresaFiltro !== 'TODAS'
    ? activos.filter((p) => (p.empresa ?? 'MGG').toUpperCase() === empresaFiltro.toUpperCase())
    : activos;

  const hoyDia = String(hoy ?? '').slice(0, 10);

  const cumpleaneros: Cumpleanero[] = [];

  for (const p of filtradosPorEmpresa) {
    if (!p.fecha_nacimiento) continue;
    if (esCumpleanosHoy(p.fecha_nacimiento, hoyDia)) {
      const nombreCompleto = `${p.nombre ?? ''} ${p.apellido ?? ''}`.trim() || p.nombre || 'Trabajador';
      cumpleaneros.push({
        id: p.id,
        nombre: p.nombre,
        apellido: p.apellido,
        nombreCompleto,
        cargo: p.cargo?.trim() || null,
        departamento: p.departamento?.trim() || null,
        empresa: p.empresa || null,
        foto_url: p.foto_url || null,
        fecha_nacimiento: p.fecha_nacimiento,
        edad: edadCumplida(p.fecha_nacimiento, hoyDia),
      });
    }
  }

  cumpleaneros.sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, 'es'));

  return cumpleaneros;
}

