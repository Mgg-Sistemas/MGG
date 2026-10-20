/* ============================================================
   MGG · Retenciones v8 · Las reglas de los campos de ⚙ Parámetros

   Cada campo editable, con su error en palabras del usuario. La pantalla
   lo muestra bajo el campo y no deja guardar mientras haya alguno. La
   tabla campo por campo frente a la base está en
   informes/2026-10-20-validacion-campos-v8.md (§3).
   ============================================================ */

import { parseDecimal } from '@/shared/ui/DecimalInput';
import { revisarRif } from '../registro/validarRif';

export type Errores<K extends string> = Partial<Record<K, string>>;

const texto = (v: string, nombre: string, max: number, obligatorio = true): string | undefined => {
  const t = v.trim();
  if (obligatorio && !t) return `Indique ${nombre}.`;
  if (t.length > max) return `${nombre[0].toUpperCase()}${nombre.slice(1)} no puede pasar de ${max} caracteres.`;
  return undefined;
};

/** Un número escrito en es-VE dentro de un rango; null si está bien. */
function numero(v: string, nombre: string, min: number, max: number, { minExcluido = false } = {}): string | undefined {
  const n = parseDecimal(v);
  if (n == null) return `Indique ${nombre} (solo números; la coma es el decimal).`;
  if (minExcluido ? n <= min : n < min) return `${nombre[0].toUpperCase()}${nombre.slice(1)} debe ser mayor ${minExcluido ? 'que' : 'o igual a'} ${min}.`;
  if (n > max) return `${nombre[0].toUpperCase()}${nombre.slice(1)} no puede pasar de ${max}.`;
  return undefined;
}

export interface FormEmpresa { razonSocial: string; rif: string; direccionFiscal: string; municipio: string; estado: string }

export function validarEmpresa(f: FormEmpresa): Errores<keyof FormEmpresa> {
  const rif = revisarRif(f.rif);
  return {
    razonSocial: texto(f.razonSocial, 'la razón social', 200),
    rif: rif.error ? rif.error.replace('El proveedor no tiene RIF en su ficha: cargarlo en Proveedores antes de registrar.', 'Indique el RIF de la empresa.').replace('del proveedor', 'de la empresa').replace(' Corregirlo en Proveedores.', '') : undefined,
    direccionFiscal: texto(f.direccionFiscal, 'la dirección fiscal', 300),
    municipio: texto(f.municipio, 'el municipio', 100),
    estado: texto(f.estado, 'el estado', 100),
  };
}

export interface FormRegimen { pctIvaGeneral: string; pctIvaEspecial: string; valorUt: string; pctIgtf: string }

export function validarRegimen(f: FormRegimen): Errores<keyof FormRegimen> {
  return {
    pctIvaGeneral: numero(f.pctIvaGeneral, 'el % general del IVA', 0, 100, { minExcluido: true }),
    pctIvaEspecial: numero(f.pctIvaEspecial, 'el % del art. 5', 0, 100, { minExcluido: true }),
    // La UT en 0 deja al ISLR sin mínimo ni sustraendo: no se acepta (auditoría del 16/10).
    valorUt: numero(f.valorUt, 'el valor de la UT', 0, 1_000_000, { minExcluido: true }),
    pctIgtf: numero(f.pctIgtf, 'el % del IGTF', 0, 100),
  };
}

export interface FormConcepto {
  codigo: string; nombre: string; sujeto: string; porcentaje: string; basePct: string;
  baseMinimaUt: string; aplicaSustraendo: boolean; fundamento: string; orden: string;
}

const SUJETOS = ['pn_residente', 'pj_domiciliada', 'pn_no_residente', 'pj_no_domiciliada', 'todos'];

export function validarConcepto(f: FormConcepto): Errores<keyof FormConcepto> {
  const orden = parseDecimal(f.orden);
  return {
    codigo: texto(f.codigo, 'el código', 10, false),
    nombre: texto(f.nombre, 'el nombre del concepto', 200),
    sujeto: SUJETOS.includes(f.sujeto) ? undefined : 'Elija el sujeto.',
    porcentaje: numero(f.porcentaje, 'el %', 0, 100, { minExcluido: true }),
    basePct: numero(f.basePct, 'el % de la base', 0, 100, { minExcluido: true }),
    baseMinimaUt: numero(f.baseMinimaUt, 'el mínimo en UT', 0, 1_000_000),
    fundamento: texto(f.fundamento, 'el fundamento', 300, false),
    orden: orden == null || !Number.isInteger(orden) || orden < 0 ? 'El orden debe ser un número entero, 0 o mayor.' : undefined,
  };
}

export const hayErrores = (e: Record<string, string | undefined>): boolean => Object.values(e).some(Boolean);
