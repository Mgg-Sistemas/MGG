/* ============================================================
   MGG · Delivery · Identificadores y Diferenciadores de Flota
   Permite distinguir a cada repartidor con un código único (M-01, M-02... o C-01...),
   color distintivo permanente e ícono, evitando solapamientos y nombres incompletos.
   El despachador/controlador puede asignar un alias o unidad personalizada.
   ============================================================ */
import type { CanalDelivery } from './delivery';

export interface DiferenciadorRepartidor {
  id: string;
  codigo: string;       // ej. 'M-01' o 'C-01'
  alias: string | null; // ej. 'Unidad 1', 'Móvil 3' o null
  color: string;        // Color único de alta visibilidad
  icono: string;        // '🛵' o '🚚'
  nombreVisible: string;// Nombre corto o alias prioritario
}

const STORAGE_KEY = 'mgg_delivery_repartidores_aliases_v1';

export const PALETA_FLOTA = [
  '#2563eb', // Azul eléctrico
  '#db2777', // Magenta vibrante
  '#059669', // Verde esmeralda
  '#7c3aed', // Púrpura profundo
  '#d97706', // Ámbar dorado
  '#0891b2', // Cian brillante
  '#dc2626', // Rojo carmesí
  '#4d7c0f', // Lima oscura
  '#ea580c', // Naranja fuego
  '#4f46e5', // Índigo
];

/** Lee el diccionario de alias guardados por el controlador */
export function leerAliasesGuardados(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Guarda o actualiza el alias de un repartidor */
export function guardarAliasRepartidor(id: string, alias: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const map = leerAliasesGuardados();
    const limpio = alias?.trim();
    if (limpio) {
      map[id] = limpio;
    } else {
      delete map[id];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Silencioso si falla el storage
  }
}

/** Hash simple y determinista para asignar índice de color/código estable */
function hashCadena(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Obtiene el diferenciador completo para un repartidor.
 * Prioriza el alias guardado por el controlador; si no existe, asigna código M-01, M-02...
 */
export function obtenerDiferenciador(
  id: string,
  nombre: string | null | undefined,
  canal: CanalDelivery = 'delivery',
  indiceSugerido?: number
): DiferenciadorRepartidor {
  const clave = id || nombre || 'anonimo';
  const aliases = leerAliasesGuardados();
  const alias = aliases[id] || aliases[clave] || null;

  const prefijo = canal === 'carga_pesada' ? 'C' : 'M';
  const idx = indiceSugerido != null && indiceSugerido >= 0
    ? indiceSugerido
    : hashCadena(clave) % PALETA_FLOTA.length;

  const num = (idx % 99) + 1;
  const codigo = `${prefijo}-${String(num).padStart(2, '0')}`;
  const color = PALETA_FLOTA[idx % PALETA_FLOTA.length];
  const icono = canal === 'carga_pesada' ? '🚚' : '🛵';

  // Si hay alias personalizado, se usa como nombre visible; sino, se formatea el nombre
  let nombreVisible = alias;
  if (!nombreVisible) {
    const n = (nombre || '').trim();
    if (n.includes('@')) {
      nombreVisible = n.split('@')[0];
    } else if (n) {
      const partes = n.split(/\s+/);
      nombreVisible = partes.length > 1 ? `${partes[0]} ${partes[1][0]}.` : partes[0];
    } else {
      nombreVisible = codigo;
    }
  }

  return {
    id: clave,
    codigo,
    alias,
    color,
    icono,
    nombreVisible,
  };
}
