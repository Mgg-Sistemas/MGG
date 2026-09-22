/* ============================================================
   MGG · RRHH · La empresa de la nómina

   Hubo un tiempo en que RRHH llevaba DOS nóminas —MGG y GoMetal— con un
   interruptor arriba para pasar de una a la otra. Se quitó: TODO es MGG.

   El archivo queda porque la columna `empresa` sigue viva en la base y en
   cada ficha, y hay que poder leerla y normalizarla. Lo que se fue es el
   segundo lado: ya no hay "la otra empresa", ni conteo por lado, ni
   interruptor que se pueda dejar mal puesto. Si algún día vuelve una segunda
   nómina, este es el archivo donde entra.
   ============================================================ */

export type Empresa = 'MGG';

export const EMPRESA_POR_DEFECTO: Empresa = 'MGG';

export interface DefinicionEmpresa {
  key: Empresa;
  /** Cómo se escribe en pantalla. */
  label: string;
  /** Nombre largo, para los PDF y los encabezados. */
  razonSocial: string;
  icono: string;
  color: string;
}

export const MGG: DefinicionEmpresa = {
  key: 'MGG',
  label: 'MGG',
  razonSocial: 'Mineral Group Guayana C.A.',
  icono: '⛏',
  color: '#ff8a00',
};

/** Hay una sola. El parámetro se acepta para no tocar quien ya la llamaba. */
export function definicionEmpresa(_e?: Empresa | string | null): DefinicionEmpresa {
  return MGG;
}

/**
 * Normaliza lo que llegue de la base. Una fila vieja sin empresa, una que diga
 * "GOMETAL" de cuando existían las dos, o cualquier texto: todo es MGG.
 */
export function normalizarEmpresa(_v?: unknown): Empresa {
  return EMPRESA_POR_DEFECTO;
}

export interface ConEmpresa { empresa?: Empresa | string | null }
