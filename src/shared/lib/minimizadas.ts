/* ============================================================
   MGG · Pestañas minimizadas (pedido de la administradora, 20-10-2026).
   Un detalle (p. ej. «Orden SP-2026-0187-1») se puede MINIMIZAR para abrir otro sin
   perderlo; quedan en una barra inferior, hasta MAX_MINIMIZADAS, y SOLO viven dentro
   del módulo donde se minimizaron: al salir del módulo se avisa y se pierden.
   Aquí vive el estado compartido (la página, la barra y el aviso de salida lo leen).
   21-10-2026: ahora TODA ventana (Modal) de cualquier módulo se puede minimizar: se oculta sin
   desmontarse (conserva lo escrito) y su pestaña lleva el «restaurador» que la vuelve a mostrar.
   ============================================================ */
import { useSyncExternalStore } from 'react';

export const MAX_MINIMIZADAS = 3;

export interface Minimizada {
  id: string;
  titulo: string;
}

export interface EstadoMinimizadas {
  /** Nombre del módulo, para el aviso de salida («Pedidos / Compras»). */
  modulo: string;
  /** Ruta base del módulo («/app/pedidos»): lo que cuelga de ahí es «el mismo módulo». */
  ruta: string;
  items: readonly Minimizada[];
  /** Destino al que el usuario quiso ir y está esperando su confirmación (null = ninguno). */
  salida: string | null;
}

/** Cómo se vuelve a abrir una pestaña desde la barra (la ventana viva o la página que la reabre). */
export interface Restaurador {
  restaurar: () => void;
  /** Qué hace la ✕ de la pestaña con una ventana viva (cerrarla). Sin esto la ✕ solo la saca de la barra. */
  descartar?: () => void;
  /** true: se puede restaurar aunque haya otra ventana abierta (la página resuelve el cambio). */
  conVentanaAbierta?: boolean;
}
const restauradores = new Map<string, Restaurador>();

const VACIO: EstadoMinimizadas = { modulo: '', ruta: '', items: [], salida: null };
let estado: EstadoMinimizadas = VACIO;
const oyentes = new Set<() => void>();

function fijar(nuevo: EstadoMinimizadas) {
  estado = nuevo;
  oyentes.forEach((f) => f());
}

export function leerMinimizadas(): EstadoMinimizadas {
  return estado;
}

export function suscribirMinimizadas(f: () => void): () => void {
  oyentes.add(f);
  return () => { oyentes.delete(f); };
}

/** Estado en vivo para componentes React. */
export function useMinimizadas(): EstadoMinimizadas {
  return useSyncExternalStore(suscribirMinimizadas, leerMinimizadas, leerMinimizadas);
}

/** «/app/pedidos?x=1», «#/app/pedidos/ver» → «/app/pedidos». */
function limpiarRuta(destino: string): string {
  return destino.replace(/^#/, '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
}

/** ¿El destino cae dentro del mismo módulo (la ruta base o una subruta suya)? */
export function mismoModulo(rutaModulo: string, destino: string): boolean {
  if (!rutaModulo) return false;
  const base = limpiarRuta(rutaModulo);
  const d = limpiarRuta(destino);
  return d === base || d.startsWith(`${base}/`);
}

/**
 * Minimiza. «ok» también si ya estaba minimizada (solo refresca el título);
 * «lleno» si ya hay MAX_MINIMIZADAS otras.
 */
export function minimizar(modulo: string, ruta: string, item: Minimizada, restaurador?: Restaurador): 'ok' | 'lleno' {
  // Lo minimizado de otro módulo no puede convivir con esto (la barra es de un solo módulo).
  const mismaRuta = estado.ruta === ruta;
  const base = mismaRuta ? estado.items : [];
  if (!mismaRuta) restauradores.clear();
  const i = base.findIndex((x) => x.id === item.id);
  if (i >= 0) {
    const items = base.map((x) => (x.id === item.id ? item : x));
    if (restaurador) restauradores.set(item.id, restaurador);
    fijar({ ...estado, modulo, ruta, items });
    return 'ok';
  }
  if (base.length >= MAX_MINIMIZADAS) return 'lleno';
  if (restaurador) restauradores.set(item.id, restaurador);
  fijar({ modulo, ruta, items: [...base, item], salida: null });
  return 'ok';
}

/** Restaura desde la barra una pestaña que trae su restaurador. false = no tiene (la página la maneja). */
export function restaurarDesdeBarra(id: string): boolean {
  const r = restauradores.get(id);
  if (!r) return false;
  r.restaurar();
  return true;
}

/** ✕ de la pestaña: cierra la ventana viva, o la saca de la barra si es de las que reabre la página. */
export function descartarDesdeBarra(id: string) {
  const r = restauradores.get(id);
  if (r?.descartar) r.descartar();
  else quitarMinimizada(id);
}

/** ¿Se puede restaurar esta pestaña con otra ventana abierta delante? */
export function restauraConVentanaAbierta(id: string): boolean {
  return !!restauradores.get(id)?.conVentanaAbierta;
}

/** Saca una pestaña de la barra (restaurada o cerrada con su ✕). */
export function quitarMinimizada(id: string) {
  restauradores.delete(id);
  if (!estado.items.some((x) => x.id === id)) return;
  const items = estado.items.filter((x) => x.id !== id);
  fijar(items.length ? { ...estado, items } : VACIO);
}

/**
 * Restaura `id` estando otra ventana abierta: la abierta ocupa su lugar en la barra
 * (así nunca se pasa del máximo ni se pierde la que estaba mirando).
 */
export function intercambiarMinimizada(id: string, abierta: Minimizada, restaurador?: Restaurador) {
  if (!estado.items.some((x) => x.id === id)) return;
  restauradores.delete(id);
  if (restaurador) restauradores.set(abierta.id, restaurador);
  const items = estado.items.filter((x) => x.id !== abierta.id).map((x) => (x.id === id ? abierta : x));
  fijar({ ...estado, items });
}

/** Vacía todo (al salir del módulo o cerrar sesión). */
export function vaciarMinimizadas() {
  restauradores.clear();
  if (estado !== VACIO) fijar(VACIO);
}

/**
 * Antes de navegar: true = puede ir; false = hay pestañas minimizadas, el destino queda
 * pendiente y el aviso de salida pregunta (ver AvisoSalidaModulo).
 */
export function intentarSalir(destino: string): boolean {
  if (!estado.items.length || mismoModulo(estado.ruta, destino)) return true;
  fijar({ ...estado, salida: destino });
  return false;
}

/** El usuario confirmó: devuelve el destino, vacía las pestañas y cierra el aviso. */
export function confirmarSalida(): string | null {
  const destino = estado.salida;
  restauradores.clear();
  fijar(VACIO);
  return destino;
}

/** El usuario se quedó en el módulo. */
export function cancelarSalida() {
  if (estado.salida !== null) fijar({ ...estado, salida: null });
}

/* ── Módulo en el que se está (para minimizar cualquier ventana) ── */

const modulos = new Map<string, string>();

/** Cada entrada del menú declara su ruta y nombre: así el aviso de salida dice el módulo exacto. */
export function registrarModulo(ruta: string, nombre: string) {
  modulos.set(limpiarRuta(ruta), nombre);
}

/**
 * El módulo de la pantalla actual (HashRouter: «#/app/pedidos/…»). null fuera de la app
 * (login, pantallas públicas): ahí no hay barra donde dejar las ventanas.
 */
export function moduloActual(hash: string = typeof window === 'undefined' ? '' : window.location.hash): { nombre: string; ruta: string } | null {
  const path = limpiarRuta(hash);
  if (path !== '/app' && !path.startsWith('/app/')) return null;
  let mejor: { nombre: string; ruta: string } | null = null;
  for (const [ruta, nombre] of modulos) {
    if (mismoModulo(ruta, path) && (!mejor || ruta.length > mejor.ruta.length)) mejor = { nombre, ruta };
  }
  if (mejor) return mejor;
  const seg = path.split('/').filter(Boolean)[1];
  if (!seg) return null;
  return { nombre: seg.charAt(0).toUpperCase() + seg.slice(1), ruta: '/app/' + seg };
}

/* ── Ventanas abiertas a la vista (la barra no restaura una encima de otra) ── */

let visibles = 0;
const oyentesVisibles = new Set<() => void>();

/** +1 al mostrarse una ventana, −1 al ocultarse o cerrarse. */
export function ventanaVisible(delta: 1 | -1) {
  visibles = Math.max(0, visibles + delta);
  oyentesVisibles.forEach((f) => f());
}
export function leerVentanasVisibles(): number {
  return visibles;
}
export function useVentanasVisibles(): number {
  return useSyncExternalStore(
    (f) => { oyentesVisibles.add(f); return () => { oyentesVisibles.delete(f); }; },
    leerVentanasVisibles,
    leerVentanasVisibles,
  );
}
