/* ============================================================
   MGG · RRHH · Las dos nóminas

   RRHH lleva DOS nóminas que no se mezclan: la de MGG y la de GoMetal. Son
   empresas distintas, con su propio personal, sus propios anticipos y sus
   propias vacaciones. Tesorería paga las dos, pero sabiendo cuál es cuál.

   LA EMPRESA LA DEFINE LA PERSONA, NO LA PANTALLA
   Un trabajador pertenece a una empresa, y todo lo que se le carga —su
   anticipo, su vacación, su renglón de nómina— hereda esa empresa. Así no
   puede pasar que el anticipo de alguien de GoMetal aparezca descontado en
   una nómina de MGG: la base lo copia sola desde la ficha.

   El interruptor de arriba solo elige QUÉ ESTÁS MIRANDO. No cambia a qué
   empresa pertenece nadie.
   ============================================================ */

export type Empresa = 'MGG' | 'GOMETAL';

export const EMPRESA_POR_DEFECTO: Empresa = 'MGG';

export interface DefinicionEmpresa {
  key: Empresa;
  /** Cómo se escribe en pantalla. */
  label: string;
  /** Nombre largo, para los PDF y los encabezados. */
  razonSocial: string;
  icono: string;
  /** Color de la marca, para que las dos nóminas no se confundan de un vistazo. */
  color: string;
  /** Va adelante del código de nómina: NOM-2026-0001 / GM-NOM-2026-0001. */
  prefijo: string;
}

export const EMPRESAS: DefinicionEmpresa[] = [
  { key: 'MGG', label: 'MGG', razonSocial: 'Mineral Group Guayana C.A.', icono: '⛏', color: '#ff8a00', prefijo: '' },
  { key: 'GOMETAL', label: 'GoMetal', razonSocial: 'GoMetal', icono: '🔩', color: '#3b82f6', prefijo: 'GM-' },
];

export function definicionEmpresa(e: Empresa | string | null | undefined): DefinicionEmpresa {
  return EMPRESAS.find((x) => x.key === e) ?? EMPRESAS[0];
}

export function labelEmpresa(e: Empresa | string | null | undefined): string {
  return definicionEmpresa(e).label;
}

export function colorEmpresa(e: Empresa | string | null | undefined): string {
  return definicionEmpresa(e).color;
}

/** ¿Es una de las dos? Lo que venga de la base puede ser cualquier texto. */
export function esEmpresa(v: unknown): v is Empresa {
  return EMPRESAS.some((x) => x.key === v);
}

/**
 * Normaliza lo que llegue. Una fila vieja sin empresa es de MGG: la nómina de
 * GoMetal nació después, así que todo lo anterior era de MGG.
 */
export function normalizarEmpresa(v: unknown): Empresa {
  if (esEmpresa(v)) return v;
  const s = String(v ?? '').trim().toUpperCase().replace(/[\s_-]/g, '');
  if (s === 'GOMETAL' || s === 'GM') return 'GOMETAL';
  return EMPRESA_POR_DEFECTO;
}

/** La otra. El interruptor tiene exactamente dos lados. */
export function otraEmpresa(e: Empresa): Empresa {
  return e === 'MGG' ? 'GOMETAL' : 'MGG';
}

/**
 * El código de una nómina. Cada empresa numera la suya desde 1: la nómina 3
 * de GoMetal no tiene por qué saber cuántas lleva MGG.
 */
export function codigoNomina(empresa: Empresa, anio: number, consecutivo: number): string {
  const n = Math.max(1, Math.trunc(Number(consecutivo) || 1));
  return `${definicionEmpresa(empresa).prefijo}NOM-${anio}-${String(n).padStart(4, '0')}`;
}

/** De qué empresa es un código de nómina, mirándolo. */
export function empresaDeCodigo(codigo: string | null | undefined): Empresa {
  return /^GM-/i.test(String(codigo ?? '')) ? 'GOMETAL' : 'MGG';
}

export interface ConEmpresa { empresa?: Empresa | string | null }

/** Filtra por empresa tratando lo que no la tenga cargada como de MGG. */
export function soloDe<T extends ConEmpresa>(filas: T[], empresa: Empresa): T[] {
  return filas.filter((f) => normalizarEmpresa(f.empresa) === empresa);
}

/** Cuántos hay de cada lado, para poder mostrarlo en el interruptor. */
export function contarPorEmpresa<T extends ConEmpresa>(filas: T[]): Record<Empresa, number> {
  const out: Record<Empresa, number> = { MGG: 0, GOMETAL: 0 };
  for (const f of filas) out[normalizarEmpresa(f.empresa)] += 1;
  return out;
}

/**
 * El texto del encabezado según qué se esté mirando. Que la pantalla diga en
 * todo momento de qué nómina se está hablando evita el error caro: cargarle
 * un aumento a la persona equivocada porque el interruptor estaba del otro lado.
 */
export function tituloRrhh(empresa: Empresa): string {
  const d = definicionEmpresa(empresa);
  return `${d.icono} RRHH · Nómina ${d.label}`;
}
