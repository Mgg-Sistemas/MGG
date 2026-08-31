import type { Almacen } from '@/shared/lib/types';

// Restricción de almacén por usuario (se casa por correo electrónico). Cubre dos flujos:
//  - SALIDAS: de qué sede(s) puede sacar material.
//  - RECEPCIÓN de compras: a qué sede recibe y en qué almacén por defecto.
// Vive en el front (como el resto del control de acceso por módulo). Si el correo NO
// está en el mapa, el usuario no tiene ninguna restricción.

export interface RestriccionUsuario {
  /** Sedes permitidas para sacar material Y a las que recibe compras. */
  sedes: string[];
  /** Almacén destino por defecto al recepcionar compras (dentro de su sede). */
  almacenRecepcion?: string;
}

/** La recepción/compra SOLO entra a Matanza o Los Pinos. Los centros de acopio
 *  (La Esperanza, etc.) NO reciben compras: su mercancía entra por Traslados. */
export const SEDES_RECEPCION = ['CENTRO DE FUNDICION - MATANZAS', 'LOS PINOS'];

/** Recepción/compra: ÚNICOS dos destinos, el almacén principal de cada sede. Se
 *  muestra un solo desplegable con dos opciones (LOS PINOS / MATANZA), sin
 *  subalmacenes. Matanza recibe en su almacén "General". */
export const DESTINOS_RECEPCION: { label: string; almacen: string; sede: string }[] = [
  { label: 'LOS PINOS', almacen: 'Los Pinos', sede: 'LOS PINOS' },
  { label: 'MATANZA', almacen: 'General', sede: 'CENTRO DE FUNDICION - MATANZAS' },
];

/** Opciones de destino visibles para este usuario: si está limitado por correo, solo
 *  su sede; si no, las dos (Los Pinos y Matanza). */
export function opcionesRecepcion(sedesPermitidas?: string[] | null): typeof DESTINOS_RECEPCION {
  const permit = sedesPermitidas ?? SEDES_RECEPCION;
  return DESTINOS_RECEPCION.filter((d) => permit.includes(d.sede));
}

/** correo (en minúsculas) → restricción. */
export const RESTRICCION_POR_USUARIO: Record<string, RestriccionUsuario> = {
  // ISNER → Los Pinos
  'almacen.pzo.lospinos@gmail.com': { sedes: ['LOS PINOS'], almacenRecepcion: 'Los Pinos' },
  // KELVIN → Matanzas (recibe al general de Matanzas)
  'almacenmatanzas2026@gmail.com': { sedes: ['CENTRO DE FUNDICION - MATANZAS'], almacenRecepcion: 'General' },
};

function restriccionDe(email: string | null | undefined): RestriccionUsuario | null {
  return RESTRICCION_POR_USUARIO[(email ?? '').toLowerCase().trim()] ?? null;
}

/** Sedes a las que el usuario puede sacar (salidas). `null` = sin restricción (todas). */
export function sedesPermitidasSalida(email: string | null | undefined): string[] | null {
  return restriccionDe(email)?.sedes ?? null;
}

/** ¿Puede este usuario sacar de un almacén con esta sede? */
export function almacenPermitidoSalida(
  sedeDelAlmacen: string | null | undefined,
  sedesPermitidas: string[] | null,
): boolean {
  if (!sedesPermitidas) return true;   // usuario sin restricción
  if (!sedeDelAlmacen) return false;   // almacén sin sede conocida → no se permite bajo restricción
  return sedesPermitidas.includes(sedeDelAlmacen);
}

/**
 * Para la RECEPCIÓN de compras: sede(s) a la(s) que este usuario recibe y el
 * almacén destino por defecto (dentro de su sede). `null` = usuario sin restricción
 * (elige libremente). Si el almacén configurado no existe, cae al primer almacén
 * raíz no-casiterita de la sede.
 */
export function destinoRecepcionPorUsuario(
  email: string | null | undefined,
  almacenes: Almacen[],
): { sedes: string[]; almacen: string | null } | null {
  const r = restriccionDe(email);
  if (!r) return null;
  const existe = (n?: string) => !!n && almacenes.some((a) => a.nombre === n && a.estado === 'activo');
  let almacen: string | null = existe(r.almacenRecepcion) ? r.almacenRecepcion! : null;
  if (!almacen) {
    const s = r.sedes[0];
    const p = almacenes.find((a) => a.estado === 'activo' && !a.parent_id
      && !/casiterita/i.test(a.nombre) && (a.sede?.trim() || '') === s);
    almacen = p?.nombre ?? null;
  }
  return { sedes: r.sedes, almacen };
}
