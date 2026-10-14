/* ============================================================
   MGG · Control de Maquinaria · Ficha de repuestos y consumibles del equipo
   Reglas puras (sin Supabase): sistemas, validación, agrupado, stock,
   «¿toca en este servicio?», buscador «¿para qué equipo sirve?» y
   «qué comprar para el próximo servicio».
   La ficha es POR EQUIPO (decisión de la administradora, 14-10-2026):
   se carga una vez y se copia a los equipos iguales.
   ============================================================ */
import { norm } from '@/shared/lib/texto';

export type SistemaRepuesto =
  | 'motor' | 'hidraulico' | 'transmision' | 'refrigeracion' | 'combustible' | 'aire'
  | 'cabina' | 'cauchos' | 'electrico' | 'correas' | 'frenos' | 'otros';

export interface SistemaMeta {
  id: SistemaRepuesto;
  label: string;
  icon: string;
  /** Tipos sugeridos al cargar (se puede escribir otro). */
  tipos: string[];
}

export const SISTEMAS: SistemaMeta[] = [
  { id: 'motor', label: 'Motor', icon: '🔩', tipos: ['Aceite de motor', 'Filtro de aceite', 'Bujía', 'Inyector', 'Empacadura de tapa'] },
  { id: 'hidraulico', label: 'Hidráulico', icon: '💧', tipos: ['Aceite hidráulico', 'Filtro hidráulico', 'Manguera hidráulica', 'Sello de cilindro'] },
  { id: 'transmision', label: 'Transmisión', icon: '⚙️', tipos: ['Aceite de caja', 'Aceite de diferencial', 'Filtro de transmisión', 'Grasa'] },
  { id: 'refrigeracion', label: 'Refrigeración', icon: '🧊', tipos: ['Refrigerante', 'Termostato', 'Manguera de radiador', 'Tapa de radiador'] },
  { id: 'combustible', label: 'Combustible', icon: '⛽', tipos: ['Filtro de combustible', 'Filtro separador de agua', 'Bomba de combustible'] },
  { id: 'aire', label: 'Aire', icon: '🌬️', tipos: ['Filtro de aire primario', 'Filtro de aire secundario', 'Filtro de cabina'] },
  { id: 'cabina', label: 'Cabina', icon: '🪟', tipos: ['Plumilla', 'Vidrio', 'Espejo', 'Asiento'] },
  { id: 'cauchos', label: 'Cauchos', icon: '🛞', tipos: ['Caucho delantero', 'Caucho trasero', 'Caucho', 'Tripa', 'Ring'] },
  { id: 'electrico', label: 'Eléctrico', icon: '🔋', tipos: ['Batería', 'Alternador', 'Motor de arranque', 'Bombillo', 'Fusible'] },
  { id: 'correas', label: 'Correas', icon: '➰', tipos: ['Correa de alternador', 'Correa de aire', 'Correa de ventilador'] },
  { id: 'frenos', label: 'Frenos', icon: '🛑', tipos: ['Pastillas de freno', 'Bandas de freno', 'Líquido de frenos', 'Disco de freno'] },
  { id: 'otros', label: 'Otros', icon: '📦', tipos: [] },
];

export function sistemaDe(id: string | null | undefined): SistemaMeta {
  return SISTEMAS.find((s) => s.id === id) ?? SISTEMAS[SISTEMAS.length - 1];
}

export interface RepuestoEquipo {
  id: string;
  equipo_id: string;
  sistema: string;
  tipo: string;
  numero_parte: string | null;
  equivalencias: string | null;
  especificacion: string | null;
  cantidad: number;
  unidad: string;
  cada_horas: number | null;
  cada_km: number | null;
  producto_id: string | null;
  nota: string | null;
  orden: number;
  actor: string | null;
  actor_name: string | null;
  created_at: string;
  updated_at: string | null;
}

/** Lo que se escribe en la ventana (sin id ni auditoría). */
export type DatosRepuestoEquipo = Pick<RepuestoEquipo,
  'sistema' | 'tipo' | 'numero_parte' | 'equivalencias' | 'especificacion' | 'cantidad' | 'unidad' | 'cada_horas' | 'cada_km' | 'producto_id' | 'nota'>;

/** Texto del error de validación, o null si está bien. */
export function validarRepuestoEquipo(d: Partial<DatosRepuestoEquipo>): string | null {
  if (!SISTEMAS.some((s) => s.id === d.sistema)) return 'Elige el sistema (motor, hidráulico, cauchos…).';
  if ((d.tipo ?? '').trim().length < 2) return 'Escribe qué es (filtro de aceite, aceite de motor, caucho…).';
  if (!(Number(d.cantidad) > 0)) return 'La cantidad por servicio tiene que ser mayor que cero.';
  if (d.cada_horas != null && !(d.cada_horas > 0)) return '«Cada cuántas horas» tiene que ser mayor que cero (o déjalo vacío).';
  if (d.cada_km != null && !(d.cada_km > 0)) return '«Cada cuántos km» tiene que ser mayor que cero (o déjalo vacío).';
  if (!(d.numero_parte ?? '').trim() && !(d.especificacion ?? '').trim() && !(d.equivalencias ?? '').trim() && !d.producto_id) {
    return 'Indica al menos el número de parte, la especificación, una equivalencia o el producto del inventario: sin eso Compras no sabe qué comprar.';
  }
  return null;
}

/** Nombre con el que se pide o se da de alta la pieza: «FILTRO DE ACEITE 17457469» / «ACEITE DE MOTOR 15W-40». */
export function nombreRepuesto(r: Pick<RepuestoEquipo, 'tipo' | 'numero_parte' | 'especificacion'>): string {
  const extra = (r.numero_parte ?? '').trim() || (r.especificacion ?? '').trim();
  return `${r.tipo.trim()}${extra ? ` ${extra}` : ''}`.toUpperCase().replace(/\s+/g, ' ');
}

/** Detalle en una línea para listas, PDF y Compras («17457469 · Donaldson P553771 · 15W-40»). */
export function detalleRepuesto(r: Pick<RepuestoEquipo, 'numero_parte' | 'equivalencias' | 'especificacion'>): string {
  return [r.numero_parte, r.equivalencias, r.especificacion].map((x) => (x ?? '').trim()).filter(Boolean).join(' · ');
}

/** Cada cuánto toca, en palabras («cada 500 h», «cada 10.000 km», «en todos los servicios»). */
export function textoCada(r: Pick<RepuestoEquipo, 'cada_horas' | 'cada_km'>, fmt: (n: number) => string = (n) => String(n)): string {
  const partes = [r.cada_horas != null ? `cada ${fmt(r.cada_horas)} h` : '', r.cada_km != null ? `cada ${fmt(r.cada_km)} km` : ''].filter(Boolean);
  return partes.length ? partes.join(' / ') : 'en todos los servicios';
}

/** Mismo repuesto ya cargado en la ficha del equipo (mismo tipo y mismo número de parte / especificación). */
export function duplicadoEnFicha(lista: RepuestoEquipo[], d: Pick<DatosRepuestoEquipo, 'tipo' | 'numero_parte' | 'especificacion'>, excluirId?: string | null): boolean {
  const clave = norm(nombreRepuesto({ tipo: d.tipo, numero_parte: d.numero_parte, especificacion: d.especificacion }));
  return lista.some((r) => r.id !== excluirId && norm(nombreRepuesto(r)) === clave);
}

const ORDEN_SISTEMA = new Map(SISTEMAS.map((s, i) => [s.id, i]));

/** Agrupa la ficha por sistema (en el orden de SISTEMAS); dentro, por orden y tipo. */
export function agruparPorSistema(lista: RepuestoEquipo[]): { sistema: SistemaMeta; items: RepuestoEquipo[] }[] {
  const grupos = new Map<string, RepuestoEquipo[]>();
  for (const r of lista) {
    const s = sistemaDe(r.sistema).id;
    if (!grupos.has(s)) grupos.set(s, []);
    grupos.get(s)!.push(r);
  }
  return [...grupos.entries()]
    .sort((a, b) => (ORDEN_SISTEMA.get(a[0] as SistemaRepuesto) ?? 99) - (ORDEN_SISTEMA.get(b[0] as SistemaRepuesto) ?? 99))
    .map(([s, items]) => ({ sistema: sistemaDe(s), items: [...items].sort((a, b) => a.orden - b.orden || a.tipo.localeCompare(b.tipo, 'es')) }));
}

export type EstadoStock = 'hay' | 'no_hay' | 'sin_producto';
export const ESTADOS_STOCK: Record<EstadoStock, { label: string; icon: string }> = {
  hay: { label: 'Hay en inventario', icon: '🟢' },
  no_hay: { label: 'No hay suficiente', icon: '🔴' },
  sin_producto: { label: 'No está en el inventario', icon: '⚪' },
};

/** Stock del producto vinculado frente a la cantidad por servicio. */
export function estadoStock(r: Pick<RepuestoEquipo, 'cantidad' | 'producto_id'>, producto: { stock: number } | null | undefined): { estado: EstadoStock; stock: number | null } {
  if (!r.producto_id || !producto) return { estado: 'sin_producto', stock: null };
  const stock = Math.max(0, Number(producto.stock) || 0);
  return { estado: stock >= r.cantidad ? 'hay' : 'no_hay', stock };
}

/**
 * Lectura NOMINAL del próximo servicio: el múltiplo del intervalo que toca.
 * Con base (último mantenimiento) es base + intervalo, redondeado al múltiplo
 * más cercano (si se hizo a 260 h con intervalo 250, el próximo es el de 500).
 */
export function proximoServicioNominal(frecuencia: number | null | undefined, lectura: number | null | undefined, base: number | null | undefined): number | null {
  if (!frecuencia || frecuencia <= 0) return null;
  if (base != null && base >= 0) return Math.max(frecuencia, Math.round((base + frecuencia) / frecuencia) * frecuencia);
  if (lectura == null || lectura < 0) return null;
  return Math.max(frecuencia, Math.ceil(lectura / frecuencia) * frecuencia);
}

/**
 * ¿Toca en el servicio que viene? Sin «cada cuánto» entra siempre. Con «cada 500 h»
 * entra cuando el próximo servicio nominal es múltiplo de 500 (si no hay lectura, entra).
 */
export function tocaEnServicio(r: Pick<RepuestoEquipo, 'cada_horas' | 'cada_km'>, proximo: { horas: number | null; km: number | null }): boolean {
  const multiplo = (valor: number | null, cada: number | null) => {
    if (cada == null) return null;
    if (valor == null) return true;
    const resto = Math.abs(valor % cada);
    return resto < 1e-6 || Math.abs(resto - cada) < 1e-6;
  };
  const h = multiplo(proximo.horas, r.cada_horas);
  const k = multiplo(proximo.km, r.cada_km);
  if (h == null && k == null) return true;
  return h === true || k === true;
}

/** «¿Para qué equipo sirve?»: todas las palabras en el número original, las equivalencias, la especificación, el tipo o el producto. */
export function buscarCompatibles<T extends RepuestoEquipo>(lista: T[], q: string, productos: Map<string, { nombre: string; sku: string }>): T[] {
  const tokens = norm(q).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return lista.filter((r) => {
    const p = r.producto_id ? productos.get(r.producto_id) : null;
    const texto = norm([r.tipo, r.numero_parte, r.equivalencias, r.especificacion, p?.nombre, p?.sku].filter(Boolean).join(' '));
    return tokens.every((t) => texto.includes(t));
  });
}

export interface EquipoProximo {
  id: string;
  equipo: string;
  /** Próximo servicio nominal (ver proximoServicioNominal). */
  proximoH: number | null;
  proximoK: number | null;
}

export interface NecesidadServicio {
  /** producto_id o el nombre normalizado si no está en el inventario. */
  clave: string;
  nombre: string;
  detalle: string;
  unidad: string;
  producto_id: string | null;
  sku: string | null;
  necesario: number;
  /** null si la pieza no está en el inventario. */
  stock: number | null;
  faltante: number;
  equipos: { equipo_id: string; equipo: string; cantidad: number }[];
}

/**
 * «Qué comprar para el próximo servicio»: suma lo que necesitan los equipos próximos o
 * vencidos según su ficha (solo lo que toca a esas horas / km), le resta el stock y deja
 * el faltante. Se agrupa por producto; las piezas que no están en el inventario, por nombre.
 */
export function faltantesProximoServicio(
  equipos: EquipoProximo[], fichas: RepuestoEquipo[],
  productos: Map<string, { nombre: string; sku: string; stock: number; unidad: string }>,
): NecesidadServicio[] {
  const porEquipo = new Map(equipos.map((e) => [e.id, e]));
  const out = new Map<string, NecesidadServicio>();
  for (const r of fichas) {
    const e = porEquipo.get(r.equipo_id);
    if (!e || !tocaEnServicio(r, { horas: e.proximoH, km: e.proximoK })) continue;
    const p = r.producto_id ? productos.get(r.producto_id) : null;
    const clave = p && r.producto_id ? r.producto_id : `nombre:${norm(nombreRepuesto(r))}`;
    let n = out.get(clave);
    if (!n) {
      n = {
        clave, nombre: p?.nombre ?? nombreRepuesto(r), detalle: detalleRepuesto(r), unidad: p?.unidad || r.unidad || 'und',
        producto_id: p ? r.producto_id : null, sku: p?.sku ?? null, necesario: 0, stock: p ? Math.max(0, Number(p.stock) || 0) : null, faltante: 0, equipos: [],
      };
      out.set(clave, n);
    }
    n.necesario = Math.round((n.necesario + r.cantidad) * 100) / 100;
    const ya = n.equipos.find((x) => x.equipo_id === e.id);
    if (ya) ya.cantidad = Math.round((ya.cantidad + r.cantidad) * 100) / 100;
    else n.equipos.push({ equipo_id: e.id, equipo: e.equipo, cantidad: r.cantidad });
  }
  for (const n of out.values()) n.faltante = n.stock == null ? n.necesario : Math.max(0, Math.round((n.necesario - n.stock) * 100) / 100);
  return [...out.values()].sort((a, b) => b.faltante - a.faltante || a.nombre.localeCompare(b.nombre, 'es'));
}

/** Copia de una ficha para otro equipo (sin id, sin auditoría). */
export function copiaDeRepuesto(r: RepuestoEquipo): DatosRepuestoEquipo {
  return {
    sistema: r.sistema, tipo: r.tipo, numero_parte: r.numero_parte, equivalencias: r.equivalencias, especificacion: r.especificacion,
    cantidad: r.cantidad, unidad: r.unidad, cada_horas: r.cada_horas, cada_km: r.cada_km, producto_id: r.producto_id, nota: r.nota,
  };
}

/** Las fichas de `origen` que todavía no están en `destino` (mismo tipo + número / especificación). */
export function repuestosParaCopiar(origen: RepuestoEquipo[], destino: RepuestoEquipo[]): RepuestoEquipo[] {
  return origen.filter((r) => !duplicadoEnFicha(destino, r));
}
