// Restricción de ORIGEN de salidas por usuario (se casa por correo electrónico).
// Ciertos almaceneros solo pueden sacar material de su(s) sede(s). Si el correo NO
// está en el mapa, no hay restricción (puede sacar de cualquier almacén).
//
// Vive en el front (como el resto del control de acceso por módulo). El filtro se
// aplica sobre los almacenes candidatos del formulario de salida, de modo que el
// usuario no ve ni puede elegir almacenes fuera de su sede, y el reparto automático
// por prioridad tampoco toca esas sedes.

/** correo (en minúsculas) → sedes permitidas para sacar material. */
export const SEDES_SALIDA_POR_USUARIO: Record<string, string[]> = {
  'almacen.pzo.lospinos@gmail.com': ['LOS PINOS'],                      // ISNER → solo Los Pinos
  'almacenmatanzas2026@gmail.com': ['CENTRO DE FUNDICION - MATANZAS'],  // KELVIN → solo Matanzas
};

/** Sedes a las que el usuario puede sacar. `null` = sin restricción (todas). */
export function sedesPermitidasSalida(email: string | null | undefined): string[] | null {
  const key = (email ?? '').toLowerCase().trim();
  return SEDES_SALIDA_POR_USUARIO[key] ?? null;
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
