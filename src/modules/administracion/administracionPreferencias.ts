/* ============================================================
   Golden Touch · Administración · preferencias (este navegador)
   Lo que el usuario elige en la vista y conviene recordar: la EMPRESA del
   selector de cabecera y la PESTAÑA activa. Claves `gt.administracion.v1.*`;
   la página de prueba usa otro prefijo, para no mezclarse con lo real.
   · localStorage puede fallar (modo privado, cuota): se sigue en memoria.
   · Un valor ilegible o de otra forma se descarta.
   ============================================================ */
export const PREFIJO_ADMIN = 'gt.administracion.v1.';
export const PREFIJO_ADMIN_DEMO = 'gt.administracion.demo.v1.';

export type TabAdmin = 'tablero' | 'gastos' | 'movimientos' | 'honorarios' | 'documentos' | 'agenda' | 'responsabilidad' | 'reporte' | 'auditoria' | 'config';
/** 'todas' o la clave de una empresa. */
export const TODAS = 'todas';

export interface Almacen {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
}

function almacenDelNavegador(): Almacen | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

const esTab = (v: unknown): v is TabAdmin =>
  v === 'tablero' || v === 'gastos' || v === 'movimientos' || v === 'honorarios' || v === 'documentos' || v === 'agenda' || v === 'responsabilidad' || v === 'reporte' || v === 'auditoria' || v === 'config';

export function crearPreferenciasAdmin(prefijo = PREFIJO_ADMIN, almacen: Almacen | null = almacenDelNavegador()) {
  const leer = (clave: string): string | null => {
    try { return almacen?.getItem(prefijo + clave) ?? null; } catch { return null; }
  };
  const guardar = (clave: string, valor: string): void => {
    try { almacen?.setItem(prefijo + clave, valor); } catch { /* cuota o modo privado */ }
  };
  return {
    /** La empresa elegida (clave) o 'todas'; por defecto 'todas'. */
    leerEmpresa: (): string => leer('empresa') ?? TODAS,
    guardarEmpresa: (clave: string) => guardar('empresa', clave),
    leerTab: (): TabAdmin => { const v = leer('tab'); return esTab(v) ? v : 'tablero'; },
    guardarTab: (t: TabAdmin) => guardar('tab', t),
  };
}

export type PreferenciasAdmin = ReturnType<typeof crearPreferenciasAdmin>;
