/* ============================================================
   MGG · Control de Maquinaria · Exportar datos (tipo RRHH)
   Permite al usuario marcar con casillas QUÉ datos quiere que
   salgan, a QUIÉNES y si se agrupan por EMPRESA / PROPIETARIO.
   Se descarga en Excel, PDF para imprimir o se envía por correo.
   ============================================================ */
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';
import { ESTADOS_EQUIPO, estadoEfectivo, fmtNum } from './flota';
import type { InfoEquipo } from './MaquinariaPage';

export type GrupoCampoMaquinaria = 'identidad' | 'datos' | 'mantenimiento' | 'combustible';

export interface CampoExportMaquinaria {
  key: string;
  label: string;
  grupo: GrupoCampoMaquinaria;
  ancho: number;
  valor: (e: MaquinariaEquipo, info?: InfoEquipo) => string | number;
}

export const GRUPOS_CAMPO_MAQUINARIA: { key: GrupoCampoMaquinaria; label: string }[] = [
  { key: 'identidad', label: 'Identificación' },
  { key: 'datos', label: 'Ficha y Características' },
  { key: 'mantenimiento', label: 'Horas y Mantenimiento' },
  { key: 'combustible', label: 'Combustible y Consumo' },
];

const t = (v: unknown): string => (v == null ? '—' : String(v).trim() || '—');

export const CAMPOS_EXPORT_MAQUINARIA: CampoExportMaquinaria[] = [
  // Identificación
  { key: 'equipo', label: 'Equipo / Código', grupo: 'identidad', ancho: 22, valor: (e) => t(e.equipo) },
  { key: 'tipo', label: 'Tipo / Clase', grupo: 'identidad', ancho: 18, valor: (e) => t(e.tipo) },
  { key: 'propietario', label: 'Empresa / Propietario', grupo: 'identidad', ancho: 24, valor: (e) => t(e.propietario) },
  { key: 'responsable', label: 'Encargado responsable', grupo: 'identidad', ancho: 22, valor: (e) => t(e.responsable) },
  {
    key: 'status',
    label: 'Estado operativo',
    grupo: 'identidad',
    ancho: 16,
    valor: (e) => ESTADOS_EQUIPO[estadoEfectivo(e)]?.label ?? t(e.status),
  },

  // Ficha y Características
  { key: 'marca', label: 'Marca', grupo: 'datos', ancho: 16, valor: (e) => t(e.marca) },
  { key: 'modelo', label: 'Modelo', grupo: 'datos', ancho: 16, valor: (e) => t(e.modelo) },
  { key: 'anio', label: 'Año', grupo: 'datos', ancho: 10, valor: (e) => (e.anio ? String(e.anio) : '—') },
  { key: 'placa', label: 'Placa', grupo: 'datos', ancho: 14, valor: (e) => t(e.placa) },
  { key: 'serial', label: 'Serial Chasis', grupo: 'datos', ancho: 20, valor: (e) => t(e.serial) },
  { key: 'motor_serial', label: 'Serial Motor', grupo: 'datos', ancho: 20, valor: (e) => t(e.motor_serial) },
  { key: 'color', label: 'Color', grupo: 'datos', ancho: 12, valor: (e) => t(e.color) },
  { key: 'ubicacion', label: 'Ubicación actual', grupo: 'datos', ancho: 22, valor: (e) => t(e.ubicacion) },

  // Horas y Mantenimiento
  {
    key: 'horometro',
    label: 'Horómetro actual',
    grupo: 'mantenimiento',
    ancho: 16,
    valor: (_, i) => (i?.horometro != null ? `${fmtNum(i.horometro)} h` : '—'),
  },
  {
    key: 'horas_restantes',
    label: 'Horas para servicio',
    grupo: 'mantenimiento',
    ancho: 18,
    valor: (_, i) => {
      if (!i?.avisoH) return '—';
      return i.avisoH.restante <= 0
        ? `Vencido (${fmtNum(Math.abs(i.avisoH.restante))} h)`
        : `Faltan ${fmtNum(i.avisoH.restante)} h`;
    },
  },
  {
    key: 'mantenimiento_cada_hrs',
    label: 'Intervalo horas',
    grupo: 'mantenimiento',
    ancho: 14,
    valor: (e) => (e.mantenimiento_cada_hrs != null ? `${fmtNum(e.mantenimiento_cada_hrs)} h` : '—'),
  },
  {
    key: 'proximo_servicio_hrs',
    label: 'Próximo servicio (h)',
    grupo: 'mantenimiento',
    ancho: 16,
    valor: (_, i) => (i?.avisoH?.proximo != null ? `${fmtNum(i.avisoH.proximo)} h` : '—'),
  },
  {
    key: 'kilometraje',
    label: 'Kilometraje actual',
    grupo: 'mantenimiento',
    ancho: 16,
    valor: (_, i) => (i?.km != null ? `${fmtNum(i.km)} km` : '—'),
  },
  {
    key: 'km_restantes',
    label: 'Km para servicio',
    grupo: 'mantenimiento',
    ancho: 16,
    valor: (_, i) => {
      if (!i?.avisoK) return '—';
      return i.avisoK.restante <= 0
        ? `Vencido (${fmtNum(Math.abs(i.avisoK.restante))} km)`
        : `Faltan ${fmtNum(i.avisoK.restante)} km`;
    },
  },
  {
    key: 'estado_servicio',
    label: 'Alerta servicio',
    grupo: 'mantenimiento',
    ancho: 16,
    valor: (_, i) => {
      if (!i?.aviso) return 'Sin datos';
      if (i.aviso.nivel === 'vencido') return '⛔ Vencido';
      if (i.aviso.nivel === 'proximo') return '⚠️ Próximo';
      return '✅ Al día';
    },
  },

  // Combustible
  { key: 'combustible', label: 'Tipo combustible', grupo: 'combustible', ancho: 16, valor: (e) => t(e.combustible) },
  {
    key: 'litros_consume',
    label: 'Consumo (L/h)',
    grupo: 'combustible',
    ancho: 14,
    valor: (e) => (e.litros_consume != null ? `${fmtNum(e.litros_consume)} L` : '—'),
  },
];

export const CAMPOS_POR_DEFECTO_MAQUINARIA = [
  'equipo',
  'tipo',
  'propietario',
  'responsable',
  'status',
  'marca',
  'modelo',
  'placa',
  'ubicacion',
  'horometro',
  'horas_restantes',
  'estado_servicio',
];

export function camposElegidosMaquinaria(keys: string[]): CampoExportMaquinaria[] {
  const set = new Set(keys);
  return CAMPOS_EXPORT_MAQUINARIA.filter((c) => set.has(c.key));
}

export interface GrupoEmpresaExport {
  empresa: string;
  equipos: MaquinariaEquipo[];
  filas: (string | number)[][];
}

export function tablaExportMaquinaria(
  equipos: MaquinariaEquipo[],
  keys: string[],
  infoMap?: Map<string, InfoEquipo>,
  agruparPorEmpresa = false,
): {
  head: string[];
  filas: (string | number)[][];
  grupos: GrupoEmpresaExport[];
} {
  const cols = camposElegidosMaquinaria(keys);
  const head = ['N°', ...cols.map((c) => c.label)];

  const mapearFila = (e: MaquinariaEquipo, idx: number) => {
    const inf = infoMap?.get(e.id);
    return [idx + 1, ...cols.map((c) => c.valor(e, inf))];
  };

  const filas = equipos.map((e, idx) => mapearFila(e, idx));

  // Agrupación por Empresa / Propietario
  const grupos: GrupoEmpresaExport[] = [];
  if (agruparPorEmpresa) {
    const map = new Map<string, MaquinariaEquipo[]>();
    for (const e of equipos) {
      const emp = (e.propietario ?? '').trim() || 'SIN EMPRESA ASIGNADA';
      if (!map.has(emp)) map.set(emp, []);
      map.get(emp)!.push(e);
    }

    // Ordenar alfabéticamente las empresas
    const empresasOrdenadas = Array.from(map.keys()).sort((a, b) => a.localeCompare(b, 'es'));
    for (const emp of empresasOrdenadas) {
      const eqs = map.get(emp)!;
      grupos.push({
        empresa: emp,
        equipos: eqs,
        filas: eqs.map((e, idx) => mapearFila(e, idx)),
      });
    }
  }

  return { head, filas, grupos };
}
