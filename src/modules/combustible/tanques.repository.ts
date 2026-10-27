/* ============================================================
   MGG · Combustible · lo que Control de Maquinaria le pide a Combustible

   Las pantallas de Flota y Servicio (traídas de Golden Touch, 13-10) leen el
   catálogo de equipos y ubicaciones, el consumo por equipo y el horómetro
   vigente con estos nombres. Acá se enrutan al repositorio de Combustible
   de MGG (combustible.repository.ts): una sola fuente de datos.
   ============================================================ */
import { norm } from '@/shared/lib/texto';
import {
  consumoCombustiblePorEquipo, crearCatalogo, crearVehiculo, listCatalogo, listVehiculos,
  setEstadoCatalogo, setEstadoVehiculo, ultimoHorometroEquipo, ultimoKilometrajeEquipo,
  type ConsumoCombustibleItem,
} from './combustible.repository';

export { ultimoHorometroEquipo, ultimoKilometrajeEquipo };

/** Un valor del catálogo de Combustible, como lo espera Maquinaria: equipos y ubicaciones. */
export interface CatalogoCombustibleValor {
  tipo: 'equipo' | 'ubicacion';
  valor: string;
  activo: boolean;
}

/** Una fila del catálogo con su id (para reactivarla), en la forma que entiende Maquinaria. */
export interface CatalogoCombustibleFila extends CatalogoCombustibleValor {
  id: string;
}

/** Filas de un tipo del catálogo, leídas de la tabla que corresponde en MGG. */
async function filasCatalogo(tipo: 'equipo' | 'ubicacion'): Promise<CatalogoCombustibleFila[]> {
  if (tipo === 'equipo') {
    const vehiculos = await listVehiculos();
    return vehiculos.map((v) => ({ id: v.id, tipo, valor: v.nombre, activo: v.estado === 'activo' }));
  }
  const ubicaciones = await listCatalogo('combustible_ubicaciones');
  return ubicaciones.map((u) => ({ id: u.id, tipo, valor: u.nombre, activo: u.estado === 'activo' }));
}

/**
 * Garantiza que un valor exista en el catálogo (26/10/2026, traído de Golden Touch) y
 * devuelve la fila. Si ya hay uno con el mismo nombre —sin que importen mayúsculas ni
 * acentos— se reutiliza ESE (con su escritura original) y, si estaba dado de baja, se
 * reactiva: alguien lo está vinculando, así que tiene que volver a salir en los
 * desplegables. Si no existe, se crea activo. Lo usa Maquinaria para que una máquina nueva
 * quede vinculada a sí misma en Combustible. En MGG 'equipo' vive en `combustible_vehiculos`
 * y 'ubicacion' en `combustible_ubicaciones`.
 */
export async function asegurarCatalogo(tipo: 'equipo' | 'ubicacion', valor: string): Promise<CatalogoCombustibleFila> {
  const v = valor.trim();
  if (!v) throw new Error('Indica el valor.');
  const buscar = async (): Promise<CatalogoCombustibleFila | undefined> =>
    (await filasCatalogo(tipo)).find((f) => norm(f.valor) === norm(v));

  const existente = await buscar();
  if (existente) {
    if (!existente.activo) {
      if (tipo === 'equipo') await setEstadoVehiculo(existente.id, 'activo');
      else await setEstadoCatalogo('combustible_ubicaciones', existente.id, 'activo');
      return { ...existente, activo: true };
    }
    return existente;
  }
  try {
    if (tipo === 'equipo') {
      const creado = await crearVehiculo({ nombre: v });
      return { id: creado.id, tipo, valor: creado.nombre, activo: creado.estado === 'activo' };
    }
    const creado = await crearCatalogo('combustible_ubicaciones', v);
    return { id: creado.id, tipo, valor: creado.nombre, activo: creado.estado === 'activo' };
  } catch (e) {
    // Dos personas creándolo a la vez: el segundo pierde la carrera (índice único por nombre)
    // y se queda con el que ganó.
    const ganador = await buscar().catch(() => undefined);
    if (ganador) return ganador;
    throw e;
  }
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
