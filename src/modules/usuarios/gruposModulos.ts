/* ============================================================
   MGG · Roles y permisos › Agrupación de módulos
   Los módulos de la matriz se leen agrupados por el PROCESO
   que atienden, no en una lista plana.

   Solo cambia cómo se presenta la matriz. Los permisos, sus
   claves y su semántica son exactamente los de siempre.
   ============================================================ */
import { MODULES, type ModuleKey, type RolePermisos } from './permisos.repository';

export interface GrupoModulos {
  key: string;
  label: string;
  /** Qué proceso atiende: se muestra bajo el título del grupo. */
  resumen: string;
  modulos: ModuleKey[];
}

/* El orden es el del proceso real: primero lo que produce la empresa,
   al final el andamiaje del sistema. */
export const GRUPOS_MODULOS: GrupoModulos[] = [
  {
    key: 'mineral',
    label: 'Cadena del mineral',
    resumen: 'Producir, almacenar y despachar el material.',
    modulos: [
      'acopio',
      'acopio_reporte',
      'acopio_gmt',
      'acopio_peramanal',
      'acopio_esmeralda',
      'acopio_pijiguaos',
      'recepciones',
      'produccion',
      'refinacion',
      'inventario',
      'deposito',
      'salidas',
      'cocina',
    ],
  },
  {
    key: 'abastecimiento',
    label: 'Abastecimiento',
    resumen: 'Pedir, comprar y traer lo que hace falta.',
    modulos: ['solicitud_pedido', 'pedidos', 'proveedores', 'delivery', 'carga_pesada'],
  },
  {
    key: 'activos',
    label: 'Activos de operación',
    resumen: 'Sostener los equipos que trabajan.',
    modulos: ['maquinaria', 'combustible'],
  },
  {
    key: 'dinero',
    label: 'Dinero',
    resumen: 'Cobrar, pagar y responder ante el fisco.',
    modulos: ['tesoreria', 'administracion', 'ventas', 'retenciones', 'conciliacion', 'contabilidad'],
  },
  {
    key: 'personas',
    label: 'Personas',
    resumen: 'Quién trabaja y qué se le asigna.',
    modulos: ['rrhh', 'choferes', 'asignaciones'],
  },
  {
    key: 'sistema',
    label: 'Sistema',
    resumen: 'El andamiaje: tableros, documentos, control y configuración.',
    modulos: ['dashboard', 'documentacion', 'auditoria', 'respaldo', 'usuarios', 'ajustes'],
  },
];

const EN_GRUPOS = new Set<string>(GRUPOS_MODULOS.flatMap((g) => g.modulos));

/* Red de seguridad: si mañana se agrega un módulo a MODULES y nadie lo
   coloca arriba, NO desaparece de la matriz — cae en «Otros módulos».
   Sin esto, un permiso nuevo quedaría invisible y sin poder asignarse. */
export function gruposConTodos(): GrupoModulos[] {
  const sueltos = MODULES.filter((m) => !EN_GRUPOS.has(m.key)).map((m) => m.key);
  if (!sueltos.length) return GRUPOS_MODULOS;
  return [
    ...GRUPOS_MODULOS,
    { key: 'otros', label: 'Otros módulos', resumen: 'Aún sin agrupar.', modulos: sueltos },
  ];
}

/** Etiqueta y ayuda de un módulo, tal como las define la matriz. */
export const INFO_MODULO = new Map(MODULES.map((m) => [m.key, m]));

/** Un módulo «se ve» si el rol tiene lectura o full sobre él. */
export const tieneAcceso = (p?: { lectura?: boolean; full?: boolean }) => !!(p?.lectura || p?.full);

export interface AlcanceRol {
  /** Módulos que el rol puede ver, de `total`. */
  conAcceso: number;
  total: number;
  escritura: number;
  full: number;
}

/** Resumen del alcance de un rol, para leerlo sin abrir la matriz. */
export function alcanceDeRol(permisos: RolePermisos | undefined): AlcanceRol {
  return MODULES.reduce<AlcanceRol>(
    (acc, m) => {
      const p = permisos?.[m.key];
      if (tieneAcceso(p)) acc.conAcceso += 1;
      if (p?.escritura) acc.escritura += 1;
      if (p?.full) acc.full += 1;
      return acc;
    },
    { conAcceso: 0, total: MODULES.length, escritura: 0, full: 0 },
  );
}

/** Cuántos módulos de un grupo ve el rol: el resumen del encabezado plegado. */
export function alcanceDeGrupo(permisos: RolePermisos | undefined, modulos: ModuleKey[]): number {
  return modulos.filter((k) => tieneAcceso(permisos?.[k])).length;
}
