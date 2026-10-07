/* ============================================================
   MGG · Asignaciones · Vehículos (07-10-2026)

   Asignar un vehículo a una persona es AUTORIZARLA a transitar en él. Los
   datos del vehículo viven en un catálogo (placa, marca, modelo, año, color,
   seriales) que se agrega, edita y borra; la asignación solo lo apunta.
   Acá, la lógica sin base ni pantalla.
   ============================================================ */

export interface VehiculoBase {
  placa: string;
  tipo?: string | null;
  marca?: string | null;
  modelo?: string | null;
  anio?: number | null;
  color?: string | null;
  serial_carroceria?: string | null;
  serial_motor?: string | null;
}

export const TIPOS_VEHICULO: { key: string; label: string; icon: string }[] = [
  { key: 'carro', label: 'Carro', icon: '🚗' },
  { key: 'camioneta', label: 'Camioneta', icon: '🛻' },
  { key: 'moto', label: 'Moto', icon: '🏍' },
  { key: 'camion', label: 'Camión', icon: '🚚' },
  { key: 'bus', label: 'Autobús / van', icon: '🚐' },
  { key: 'maquinaria', label: 'Maquinaria', icon: '🚜' },
  { key: 'otro', label: 'Otro', icon: '🚘' },
];

export function iconoVehiculo(tipo: string | null | undefined): string {
  return TIPOS_VEHICULO.find((t) => t.key === tipo)?.icon ?? '🚗';
}

export function labelTipoVehiculo(tipo: string | null | undefined): string {
  return TIPOS_VEHICULO.find((t) => t.key === tipo)?.label ?? 'Vehículo';
}

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Placa como se guarda: mayúsculas, sin espacios ni guiones. */
export function normalizarPlaca(p: string | null | undefined): string {
  return limpio(p).toUpperCase().replace(/[\s-]+/g, '');
}

/** «TOYOTA HILUX 2019 · BLANCO · PLACA AB123CD»: cómo se nombra el vehículo en la asignación. */
export function textoVehiculo(v: VehiculoBase): string {
  const partes = [limpio(v.marca), limpio(v.modelo), v.anio ? String(v.anio) : ''].filter(Boolean).join(' ').toUpperCase();
  const color = limpio(v.color).toUpperCase();
  return [partes || labelTipoVehiculo(v.tipo).toUpperCase(), color, `PLACA ${normalizarPlaca(v.placa)}`].filter(Boolean).join(' · ');
}

/** Motivo por el que el vehículo no se puede guardar, o null si está bien. */
export function errorVehiculo(v: VehiculoBase): string | null {
  if (!normalizarPlaca(v.placa)) return 'Indicá la placa del vehículo.';
  if (!limpio(v.marca) && !limpio(v.modelo)) return 'Indicá al menos la marca o el modelo.';
  if (v.anio != null && (!Number.isInteger(v.anio) || v.anio < 1950 || v.anio > 2100)) return 'El año no es válido.';
  return null;
}

/** Busca en el catálogo por placa, marca, modelo, color o serial. */
export function filtrarVehiculos<T extends VehiculoBase>(lista: T[], q: string): T[] {
  const t = limpio(q).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!t) return lista;
  const palabras = t.split(' ');
  return lista.filter((v) => {
    const txt = `${v.placa} ${normalizarPlaca(v.placa)} ${v.marca ?? ''} ${v.modelo ?? ''} ${v.anio ?? ''} ${v.color ?? ''} ${v.serial_carroceria ?? ''} ${v.serial_motor ?? ''} ${labelTipoVehiculo(v.tipo)}`
      .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return palabras.every((p) => txt.includes(p));
  });
}
