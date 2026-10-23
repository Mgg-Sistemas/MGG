/* ============================================================
   MGG · Combustible · lo que Control de Maquinaria le pide a Combustible

   Las pantallas de Flota y Servicio (traídas de Golden Touch, 13-10) leen el
   catálogo de equipos y ubicaciones, el consumo por equipo y el horómetro
   vigente con estos nombres. Acá se enrutan al repositorio de Combustible
   de MGG (combustible.repository.ts): una sola fuente de datos.
   ============================================================ */
import { consumoCombustiblePorEquipo, listCatalogo, listVehiculos, ultimoHorometroEquipo, ultimoKilometrajeEquipo, type ConsumoCombustibleItem } from './combustible.repository';

export { ultimoHorometroEquipo, ultimoKilometrajeEquipo };

/** Un valor del catálogo de Combustible, como lo espera Maquinaria: equipos y ubicaciones. */
export interface CatalogoCombustibleValor {
  tipo: 'equipo' | 'ubicacion';
  valor: string;
  activo: boolean;
}

/** Equipos (combustible_vehiculos) y ubicaciones (combustible_ubicaciones) de Combustible. */
export async function listCatalogos(): Promise<CatalogoCombustibleValor[]> {
  const [vehiculos, ubicaciones] = await Promise.all([
    listVehiculos().catch(() => []),
    listCatalogo('combustible_ubicaciones').catch(() => []),
  ]);
  return [
    ...vehiculos.map((v) => ({ tipo: 'equipo' as const, valor: v.nombre, activo: v.estado === 'activo' })),
    ...ubicaciones.map((u) => ({ tipo: 'ubicacion' as const, valor: u.nombre, activo: u.estado === 'activo' })),
  ];
}

/** Gasoil consumido (movimientos de tipo consumo) por equipo en el rango: nombre, litros y valor en $. */
export function consumoPorEquipo(desde: Date, hasta: Date): Promise<ConsumoCombustibleItem[]> {
  return consumoCombustiblePorEquipo(desde, hasta);
}
