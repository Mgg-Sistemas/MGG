/* ============================================================
   MGG · RRHH · Motor del Reporte Dinámico (04-11-2026)

   Motor de datos PURO y SÍNCRONO para el reporte flexible de RRHH,
   siguiendo el estándar de Tesorería (reporteTesoreriaMoldeable.ts).
   Unifica tres vertientes en una sola estructura analítica:
     · personal           → directorio, datos laborales, ficha, pago, hijos y carga familiar
     · historico_salarial → auditoría de aumentos y cambios de sueldo (personal_sueldos)
     · historico_cargos   → evolución salarial por puesto y tabulador (tabulador_cargos_historial)

   REGLA DE ORO: aquí NO se lee de Supabase. Recibe datos en memoria ya leídos
   por reporteRrhh.repository.ts (o la vista principal) más mapas de empresas y
   tasas. Todo el cálculo es determinista y testeable con pruebas unitarias.
   ============================================================ */

import type { Personal } from '@/shared/lib/types';
import type { DefinicionEmpresa } from './empresa';
import type { CambioSueldoRegistro, FamiliarPersonal } from './personal.repository';
import type { HistorialTabulador } from './tabulador';
import { edadEn } from './fichaPersonal';

/** Redondeo a 2 decimales para operaciones de moneda y porcentajes. */
export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/* ───────────── Tipos de configuración ───────────── */

/** Vertiente operativa que se está reportando. */
export type AmbitoRrhh = 'personal' | 'historico_salarial' | 'historico_cargos';

export const AMBITOS_RRHH: { id: AmbitoRrhh; icon: string; label: string; descripcion: string }[] = [
  { id: 'personal', icon: '👥', label: 'Directorio y Personal', descripcion: 'Ficha del personal, datos laborales, estado, contacto, pagos y carga familiar.' },
  { id: 'historico_salarial', icon: '📜', label: 'Histórico Salarial', descripcion: 'Auditoría de aumentos, ajustes de sueldo, motivos y aprobadores.' },
  { id: 'historico_cargos', icon: '💬', label: 'Histórico de Cargos', descripcion: 'Evolución del tabulador salarial por cargo y fechas de vigencia.' },
];

/** Dimensión de agrupación principal de las filas. */
export type ModoAgrupacionRrhh =
  | 'empresa'
  | 'departamento'
  | 'cargo'
  | 'estado'
  | 'genero'
  | 'carga_familiar'
  | 'rango_sueldo'
  | 'mes'
  | 'detallado';

export const MODOS_AGRUPACION_RRHH: { id: ModoAgrupacionRrhh; icon: string; label: string }[] = [
  { id: 'empresa', icon: '🏢', label: 'Por Empresa' },
  { id: 'departamento', icon: '📁', label: 'Por Departamento' },
  { id: 'cargo', icon: '💼', label: 'Por Cargo' },
  { id: 'estado', icon: '🟢', label: 'Por Estado' },
  { id: 'genero', icon: '🚻', label: 'Por Género' },
  { id: 'carga_familiar', icon: '👶', label: 'Por Hijos / Carga Familiar' },
  { id: 'rango_sueldo', icon: '💵', label: 'Por Rango Salarial' },
  { id: 'mes', icon: '📅', label: 'Por Mes' },
  { id: 'detallado', icon: '📋', label: 'Detallado' },
];

/** Presets de fechas para los reportes con dimensión temporal. */
export type PresetRangoRrhh = 'hoy' | 'mes' | 'mes_anterior' | 'ult30' | 'ult90' | 'anio' | 'todos';

export const PRESETS_RANGO_RRHH: { id: PresetRangoRrhh; label: string }[] = [
  { id: 'todos', label: 'Histórico Completo' },
  { id: 'mes', label: 'Este mes' },
  { id: 'mes_anterior', label: 'Mes anterior' },
  { id: 'ult30', label: 'Últimos 30d' },
  { id: 'ult90', label: 'Últimos 90d' },
  { id: 'anio', label: 'Este año' },
];

/* ───────────── Catálogo de Columnas ───────────── */

export interface CampoColumnaRrhh {
  clave: string;
  etiqueta: string;
  descripcion?: string;
  anchoExcel: number;
  alineacion: 'left' | 'right' | 'center';
  formato?: 'texto' | 'numero' | 'moneda' | 'moneda_bs' | 'porcentaje' | 'fecha';
  ambitos: AmbitoRrhh[];
}

export const CAMPOS_REPORTE_RRHH: CampoColumnaRrhh[] = [
  // Generales / Identificación
  { clave: 'empresa', etiqueta: 'Empresa / Nómina', anchoExcel: 18, alineacion: 'left', formato: 'texto', ambitos: ['personal', 'historico_salarial', 'historico_cargos'] },
  { clave: 'ficha', etiqueta: 'N° Ficha', anchoExcel: 10, alineacion: 'center', formato: 'texto', ambitos: ['personal', 'historico_salarial'] },
  { clave: 'nombre_completo', etiqueta: 'Nombre y Apellido', anchoExcel: 26, alineacion: 'left', formato: 'texto', ambitos: ['personal', 'historico_salarial'] },
  { clave: 'cedula', etiqueta: 'Cédula de Identidad', anchoExcel: 14, alineacion: 'center', formato: 'texto', ambitos: ['personal', 'historico_salarial'] },
  { clave: 'rif', etiqueta: 'RIF', anchoExcel: 14, alineacion: 'center', formato: 'texto', ambitos: ['personal', 'historico_salarial'] },
  { clave: 'cargo', etiqueta: 'Cargo / Puesto', anchoExcel: 22, alineacion: 'left', formato: 'texto', ambitos: ['personal', 'historico_salarial', 'historico_cargos'] },
  { clave: 'departamento', etiqueta: 'Departamento', anchoExcel: 20, alineacion: 'left', formato: 'texto', ambitos: ['personal', 'historico_salarial'] },
  { clave: 'estado', etiqueta: 'Estado', anchoExcel: 12, alineacion: 'center', formato: 'texto', ambitos: ['personal'] },
  { clave: 'nacionalidad', etiqueta: 'Nacionalidad', anchoExcel: 16, alineacion: 'center', formato: 'texto', ambitos: ['personal'] },
  { clave: 'genero', etiqueta: 'Género', anchoExcel: 12, alineacion: 'center', formato: 'texto', ambitos: ['personal'] },
  { clave: 'estado_civil', etiqueta: 'Estado Civil', anchoExcel: 14, alineacion: 'center', formato: 'texto', ambitos: ['personal'] },
  { clave: 'fecha_nacimiento', etiqueta: 'Fecha de Nacimiento', anchoExcel: 16, alineacion: 'center', formato: 'fecha', ambitos: ['personal'] },
  { clave: 'grupo_sanguineo', etiqueta: 'Grupo Sanguíneo', anchoExcel: 14, alineacion: 'center', formato: 'texto', ambitos: ['personal'] },
  { clave: 'fecha_ingreso', etiqueta: 'Fecha Ingreso', anchoExcel: 13, alineacion: 'center', formato: 'fecha', ambitos: ['personal'] },
  { clave: 'antiguedad', etiqueta: 'Antigüedad', anchoExcel: 14, alineacion: 'left', formato: 'texto', ambitos: ['personal'] },
  { clave: 'carnet_vence', etiqueta: 'Vence Carnet', anchoExcel: 14, alineacion: 'center', formato: 'fecha', ambitos: ['personal'] },

  // Educación / Instrucción
  { clave: 'grado_instruccion', etiqueta: 'Grado de Instrucción', anchoExcel: 18, alineacion: 'left', formato: 'texto', ambitos: ['personal'] },
  { clave: 'titulo_obtenido', etiqueta: 'Título Obtenido', anchoExcel: 22, alineacion: 'left', formato: 'texto', ambitos: ['personal'] },

  // Contacto & Ubicación
  { clave: 'telefono', etiqueta: 'Teléfono', anchoExcel: 16, alineacion: 'center', formato: 'texto', ambitos: ['personal'] },
  { clave: 'correo', etiqueta: 'Correo Electrónico', anchoExcel: 24, alineacion: 'left', formato: 'texto', ambitos: ['personal'] },
  { clave: 'direccion', etiqueta: 'Dirección', anchoExcel: 28, alineacion: 'left', formato: 'texto', ambitos: ['personal'] },

  // Contacto de Emergencia
  { clave: 'contacto_emergencia', etiqueta: 'Contacto de Emergencia', anchoExcel: 22, alineacion: 'left', formato: 'texto', ambitos: ['personal'] },
  { clave: 'contacto_emergencia_parentesco', etiqueta: 'Parentesco Emergencia', anchoExcel: 18, alineacion: 'center', formato: 'texto', ambitos: ['personal'] },
  { clave: 'contacto_emergencia_tlf', etiqueta: 'Teléfono Emergencia', anchoExcel: 18, alineacion: 'center', formato: 'texto', ambitos: ['personal'] },

  // Salud
  { clave: 'alergias', etiqueta: 'Alergias', anchoExcel: 20, alineacion: 'left', formato: 'texto', ambitos: ['personal'] },
  { clave: 'enfermedades', etiqueta: 'Condición Médica / Enfermedad', anchoExcel: 24, alineacion: 'left', formato: 'texto', ambitos: ['personal'] },

  // Experiencia Previa
  { clave: 'trabajo_anterior', etiqueta: 'Trabajo Anterior', anchoExcel: 28, alineacion: 'left', formato: 'texto', ambitos: ['personal'] },

  // Carga Familiar / Hijos
  { clave: 'tiene_hijos', etiqueta: '¿Tiene Hijos?', anchoExcel: 13, alineacion: 'center', formato: 'texto', ambitos: ['personal'] },
  { clave: 'cantidad_hijos', etiqueta: 'N° Hijos', anchoExcel: 12, alineacion: 'center', formato: 'numero', ambitos: ['personal'] },
  { clave: 'hijos_menores', etiqueta: 'Hijos Menores (<18)', anchoExcel: 16, alineacion: 'center', formato: 'numero', ambitos: ['personal'] },
  { clave: 'carga_familiar', etiqueta: 'Carga Familiar Total', anchoExcel: 16, alineacion: 'center', formato: 'numero', ambitos: ['personal'] },

  { clave: 'datos_pago', etiqueta: 'Método / Datos de Pago', anchoExcel: 28, alineacion: 'left', formato: 'texto', ambitos: ['personal'] },

  // Económicos / Sueldos
  { clave: 'sueldo_base', etiqueta: 'Sueldo Base ($)', anchoExcel: 16, alineacion: 'right', formato: 'moneda', ambitos: ['personal'] },
  { clave: 'sueldo_bs', etiqueta: 'Sueldo Equiv. (Bs)', anchoExcel: 18, alineacion: 'right', formato: 'moneda_bs', ambitos: ['personal'] },
  { clave: 'total_personas', etiqueta: 'Colaboradores', anchoExcel: 14, alineacion: 'center', formato: 'numero', ambitos: ['personal', 'historico_cargos'] },
  { clave: 'masa_salarial', etiqueta: 'Masa Salarial ($)', anchoExcel: 18, alineacion: 'right', formato: 'moneda', ambitos: ['personal', 'historico_cargos'] },
  { clave: 'sueldo_promedio', etiqueta: 'Sueldo Promedio ($)', anchoExcel: 18, alineacion: 'right', formato: 'moneda', ambitos: ['personal', 'historico_cargos'] },
  { clave: 'pct_total', etiqueta: '% de la Nómina', anchoExcel: 13, alineacion: 'right', formato: 'porcentaje', ambitos: ['personal'] },

  // Histórico Salarial
  { clave: 'fecha_vigencia', etiqueta: 'Vigente Desde', anchoExcel: 14, alineacion: 'center', formato: 'fecha', ambitos: ['historico_salarial', 'historico_cargos'] },
  { clave: 'sueldo_anterior', etiqueta: 'Sueldo Anterior ($)', anchoExcel: 17, alineacion: 'right', formato: 'moneda', ambitos: ['historico_salarial', 'historico_cargos'] },
  { clave: 'sueldo_nuevo', etiqueta: 'Sueldo Nuevo ($)', anchoExcel: 17, alineacion: 'right', formato: 'moneda', ambitos: ['historico_salarial', 'historico_cargos'] },
  { clave: 'variacion_usd', etiqueta: 'Aumento / Variación ($)', anchoExcel: 18, alineacion: 'right', formato: 'moneda', ambitos: ['historico_salarial', 'historico_cargos'] },
  { clave: 'variacion_pct', etiqueta: 'Variación (%)', anchoExcel: 14, alineacion: 'right', formato: 'porcentaje', ambitos: ['historico_salarial', 'historico_cargos'] },
  { clave: 'motivo', etiqueta: 'Motivo del Cambio', anchoExcel: 30, alineacion: 'left', formato: 'texto', ambitos: ['historico_salarial', 'historico_cargos'] },
  { clave: 'tipo_cambio', etiqueta: 'Tipo de Movimiento', anchoExcel: 18, alineacion: 'center', formato: 'texto', ambitos: ['historico_salarial'] },
  { clave: 'autor', etiqueta: 'Autorizado Por', anchoExcel: 20, alineacion: 'left', formato: 'texto', ambitos: ['historico_salarial', 'historico_cargos'] },
];

export const CAMPOS_DEFAULT_RRHH: Record<AmbitoRrhh, Record<ModoAgrupacionRrhh, string[]>> = {
  personal: {
    empresa: ['empresa', 'total_personas', 'masa_salarial', 'sueldo_promedio', 'pct_total'],
    departamento: ['departamento', 'empresa', 'total_personas', 'masa_salarial', 'sueldo_promedio', 'pct_total'],
    cargo: ['cargo', 'departamento', 'total_personas', 'sueldo_promedio', 'masa_salarial'],
    estado: ['estado', 'total_personas', 'masa_salarial', 'pct_total'],
    genero: ['genero', 'total_personas', 'masa_salarial', 'pct_total'],
    carga_familiar: ['tiene_hijos', 'total_personas', 'cantidad_hijos', 'hijos_menores', 'masa_salarial', 'pct_total'],
    rango_sueldo: ['sueldo_base', 'total_personas', 'masa_salarial', 'pct_total'],
    mes: ['fecha_ingreso', 'total_personas', 'masa_salarial'],
    detallado: ['ficha', 'nombre_completo', 'cedula', 'cargo', 'departamento', 'empresa', 'tiene_hijos', 'cantidad_hijos', 'sueldo_base', 'estado'],
  },
  historico_salarial: {
    empresa: ['empresa', 'total_personas', 'variacion_usd', 'variacion_pct'],
    departamento: ['departamento', 'total_personas', 'variacion_usd'],
    cargo: ['cargo', 'total_personas', 'sueldo_nuevo', 'variacion_usd'],
    estado: ['empresa', 'total_personas', 'variacion_usd'],
    genero: ['genero', 'total_personas', 'variacion_usd'],
    carga_familiar: ['empresa', 'total_personas', 'variacion_usd'],
    rango_sueldo: ['sueldo_nuevo', 'total_personas', 'variacion_usd'],
    mes: ['fecha_vigencia', 'total_personas', 'variacion_usd'],
    detallado: ['fecha_vigencia', 'nombre_completo', 'cedula', 'cargo', 'sueldo_anterior', 'sueldo_nuevo', 'variacion_usd', 'variacion_pct', 'motivo', 'autor'],
  },
  historico_cargos: {
    empresa: ['empresa', 'cargo', 'sueldo_nuevo', 'total_personas'],
    departamento: ['cargo', 'sueldo_nuevo', 'total_personas'],
    cargo: ['cargo', 'sueldo_anterior', 'sueldo_nuevo', 'variacion_usd', 'fecha_vigencia', 'total_personas'],
    estado: ['cargo', 'sueldo_nuevo', 'total_personas'],
    genero: ['cargo', 'total_personas'],
    carga_familiar: ['cargo', 'total_personas'],
    rango_sueldo: ['cargo', 'sueldo_nuevo', 'total_personas'],
    mes: ['fecha_vigencia', 'cargo', 'sueldo_nuevo'],
    detallado: ['fecha_vigencia', 'cargo', 'sueldo_anterior', 'sueldo_nuevo', 'variacion_usd', 'motivo', 'autor', 'total_personas'],
  },
};

/* ───────────── Estructura de Fila Normalizada ───────────── */

export interface FilaReporteRrhh {
  id: string;
  ambito: AmbitoRrhh;
  empresaKey: string;
  empresaNombre: string;
  ficha?: string;
  nombreCompleto: string;
  cedula?: string;
  rif?: string;
  nacionalidad?: string;
  cargo: string;
  departamento: string;
  estado: 'activo' | 'inactivo';
  genero?: string;
  estadoCivil?: string;
  fechaNacimiento?: string;
  grupoSanguineo?: string;
  fechaIngreso?: string;
  antiguedadAnios?: number;
  antiguedadTexto?: string;
  carnetVence?: string;

  // Educación / Instrucción
  gradoInstruccion?: string;
  tituloObtenido?: string;

  // Contacto & Ubicación
  telefono?: string;
  correo?: string;
  direccion?: string;

  // Contacto de Emergencia
  contactoEmergencia?: string;
  contactoEmergenciaParentesco?: string;
  contactoEmergenciaTlf?: string;

  // Salud
  alergias?: string;
  enfermedades?: string;

  // Experiencia Previa
  trabajoAnterior?: string;

  // Carga familiar / hijos
  tieneHijos: boolean;
  cantidadHijos: number;
  hijosMenores: number;
  cargaFamiliar: number;

  datosPago?: string;

  // Montos
  sueldoBase: number;
  sueldoBs: number;
  tasaBcvAplicada: number;

  // Histórico
  fechaVigencia?: string;
  sueldoAnterior?: number;
  sueldoNuevo?: number;
  variacionUsd?: number;
  variacionPct?: number;
  motivo?: string;
  tipoCambio?: string;
  autor?: string;
  personasEnCargo?: number;
  costoCargoUsd?: number;

  // Agrupación y métricas de grupo
  esGrupo?: boolean;
  grupoClave?: string;
  grupoNombre?: string;
  totalPersonas?: number;
  personasActivas?: number;
  personasInactivas?: number;
  masaSalarialUsd?: number;
  masaSalarialBs?: number;
  sueldoPromedioUsd?: number;
  sueldoMinUsd?: number;
  sueldoMaxUsd?: number;
  pctTotal?: number;
}

/* ───────────── Filtros ───────────── */

export interface FiltrosRrhh {
  empresasSel?: string[];
  departamentosSel?: string[];
  cargosSel?: string[];
  estadosSel?: ('activo' | 'inactivo')[];
  generosSel?: string[];
  filtroHijos?: 'todos' | 'con_hijos' | 'sin_hijos';
  texto?: string;
  desde?: string; // YYYY-MM-DD
  hasta?: string; // YYYY-MM-DD
  sueldoMin?: number;
  sueldoMax?: number;
}

/* ───────────── KPIs / Resumen Ejecutivo ───────────── */

export interface ResumenReporteRrhh {
  totalRegistros: number;
  totalPersonas: number;
  activos: number;
  inactivos: number;
  hombres: number;
  mujeres: number;
  sinGenero: number;

  // Estadísticas familiares
  conHijos: number;
  sinHijos: number;
  totalHijos: number;
  totalHijosMenores: number;
  conCargaFamiliar: number;

  masaSalarialUsd: number;
  masaSalarialBs: number;
  sueldoPromedioUsd: number;
  sueldoMinUsd: number;
  sueldoMaxUsd: number;
  tasaBcvReferencia: number;
  totalEmpresas: number;
  empresasNombres: string[];
  topDepartamentos: { nombre: string; personas: number; masaUsd: number; porcentaje: number }[];
  topCargos: { nombre: string; personas: number; masaUsd: number; porcentaje: number }[];
  // Específicos para ámbito histórico
  totalCambiosSueldo: number;
  promedioAumentoPct: number;
  incrementoTotalUsd: number;
}

export interface MetricaFichaRrhh {
  clave: string;
  etiqueta: string;
  valor: string;
  sub?: string;
  colorCss: string;
  colorRgb: [number, number, number];
}

/* ───────────── Utilidades de Fecha y Formato ───────────── */

export const fmtNum2 = (v: number): string =>
  (Number(v) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtMonedaUsd = (v: number): string => `$ ${fmtNum2(v)}`;
export const fmtMonedaBs = (v: number): string => `Bs ${fmtNum2(v)}`;
export const fmtPct = (v: number): string => `${(Number(v) || 0) >= 0 ? '+' : ''}${fmtNum2(v)}%`;

/** Calcula años y meses de antigüedad desde la fecha de ingreso. */
export function calcularAntiguedad(fechaIngresoIso?: string | null): { anios: number; texto: string } {
  if (!fechaIngresoIso || !/^\d{4}-\d{2}-\d{2}/.test(fechaIngresoIso)) {
    return { anios: 0, texto: '-' };
  }
  const [y, m, d] = fechaIngresoIso.slice(0, 10).split('-').map(Number);
  const ingreso = new Date(y, m - 1, d);
  const hoy = new Date();
  if (Number.isNaN(ingreso.getTime()) || ingreso > hoy) return { anios: 0, texto: '0a' };

  let anios = hoy.getFullYear() - ingreso.getFullYear();
  let meses = hoy.getMonth() - ingreso.getMonth();
  if (meses < 0 || (meses === 0 && hoy.getDate() < ingreso.getDate())) {
    anios--;
    meses += 12;
  }
  if (hoy.getDate() < ingreso.getDate()) meses = Math.max(0, meses - 1);

  if (anios === 0) return { anios: 0, texto: `${meses}m` };
  if (meses === 0) return { anios, texto: `${anios}a` };
  return { anios, texto: `${anios}a ${meses}m` };
}

/** Segmento o rango salarial al que pertenece un monto. */
export function rangoSalarialDe(monto: number): string {
  const m = Number(monto) || 0;
  if (m <= 0) return 'Sin sueldo cargado';
  if (m < 200) return 'Menor a $ 200';
  if (m <= 400) return '$ 200 a $ 400';
  if (m <= 700) return '$ 400 a $ 700';
  if (m <= 1000) return '$ 700 a $ 1,000';
  return 'Mayor a $ 1,000';
}

/** Normaliza la empresa de una fila; si no tiene, usa la predeterminada. */
export function resolverEmpresa(
  codigo?: string | null,
  mapaEmpresas?: Map<string, DefinicionEmpresa>,
): { key: string; nombre: string } {
  const key = (codigo || 'MGG').trim() || 'MGG';
  const def = mapaEmpresas?.get(key);
  return {
    key,
    nombre: def?.razonSocial || def?.label || key,
  };
}

/* ───────────── Normalizadores Puros ───────────── */

/** Normaliza la lista de personal a filas de reporte, enriqueciendo con su carga familiar real. */
export function normalizarPersonalRrhh(
  personal: Personal[],
  mapaEmpresas: Map<string, DefinicionEmpresa>,
  tasaBcv: number,
  mapaFamilia?: Map<string, FamiliarPersonal[]>,
): FilaReporteRrhh[] {
  return personal.map((p) => {
    const emp = resolverEmpresa(p.empresa, mapaEmpresas);
    const sBase = Number(p.sueldo_base) || 0;
    const ant = calcularAntiguedad(p.fecha_ingreso);
    const nombre = `${p.nombre || ''} ${p.apellido || ''}`.trim() || 'Sin nombre';

    const familiares = mapaFamilia?.get(p.id) ?? [];
    const hijos = familiares.filter((f) => f.parentesco === 'hijo');
    const cantidadHijos = hijos.length;
    const hijosMenores = hijos.filter((h) => {
      const edad = edadEn(h.fechaNacimiento);
      return edad != null && edad < 18;
    }).length;
    const tieneHijos = cantidadHijos > 0;
    const totalCarga = familiares.length;

    // Alergias
    let alergias: string | undefined;
    if (p.tiene_alergias === true) {
      alergias = p.alergias_detalle?.trim() ? `Sí (${p.alergias_detalle.trim()})` : 'Sí';
    } else if (p.tiene_alergias === false) {
      alergias = 'No';
    }

    // Enfermedades
    let enfermedades: string | undefined;
    if (p.tiene_enfermedad === true) {
      enfermedades = p.enfermedad_detalle?.trim() ? `Sí (${p.enfermedad_detalle.trim()})` : 'Sí';
    } else if (p.tiene_enfermedad === false) {
      enfermedades = 'No';
    }

    // Trabajo anterior
    const partesTrabajo = [p.trabajo_anterior_empresa?.trim(), p.trabajo_anterior_cargo?.trim()].filter(Boolean);
    const trabajoAnterior = partesTrabajo.length > 0
      ? partesTrabajo.join(' - ') + (p.trabajo_anterior_duracion?.trim() ? ` (${p.trabajo_anterior_duracion.trim()})` : '')
      : undefined;

    return {
      id: p.id,
      ambito: 'personal',
      empresaKey: emp.key,
      empresaNombre: emp.nombre,
      ficha: p.numero_ficha ? String(p.numero_ficha).padStart(3, '0') : undefined,
      nombreCompleto: nombre,
      cedula: p.cedula?.trim() || undefined,
      rif: p.rif?.trim() || undefined,
      nacionalidad: p.nacionalidad?.trim() || undefined,
      cargo: p.cargo?.trim() || 'Sin cargo',
      departamento: p.departamento?.trim() || 'General',
      estado: p.activo ? 'activo' : 'inactivo',
      genero: p.genero?.trim() || 'sin_cargar',
      estadoCivil: p.estado_civil?.trim() || undefined,
      fechaNacimiento: p.fecha_nacimiento ? p.fecha_nacimiento.slice(0, 10) : undefined,
      grupoSanguineo: p.grupo_sanguineo?.trim() || undefined,
      fechaIngreso: p.fecha_ingreso ? p.fecha_ingreso.slice(0, 10) : undefined,
      antiguedadAnios: ant.anios,
      antiguedadTexto: ant.texto,
      carnetVence: p.carnet_vence ? p.carnet_vence.slice(0, 10) : undefined,

      gradoInstruccion: p.grado_instruccion?.trim() || undefined,
      tituloObtenido: p.titulo_obtenido?.trim() || undefined,

      telefono: p.telefono?.trim() || undefined,
      correo: p.correo?.trim() || undefined,
      direccion: p.direccion?.trim() || undefined,

      contactoEmergencia: p.contacto_emergencia?.trim() || undefined,
      contactoEmergenciaParentesco: p.contacto_emergencia_parentesco?.trim() || undefined,
      contactoEmergenciaTlf: p.contacto_emergencia_tlf?.trim() || undefined,

      alergias,
      enfermedades,
      trabajoAnterior,

      // Carga familiar & Hijos
      tieneHijos,
      cantidadHijos,
      hijosMenores,
      cargaFamiliar: totalCarga,

      datosPago: p.datos_pago ? JSON.stringify(p.datos_pago) : undefined,
      sueldoBase: sBase,
      sueldoBs: round2(sBase * tasaBcv),
      tasaBcvAplicada: tasaBcv,
    };
  });
}

/** Normaliza los cambios de sueldo a filas de reporte. */
export function normalizarHistoricoSalarialRrhh(
  cambios: CambioSueldoRegistro[],
  personal: Personal[],
  mapaEmpresas: Map<string, DefinicionEmpresa>,
  tasaBcv: number,
  mapaFamilia?: Map<string, FamiliarPersonal[]>,
): FilaReporteRrhh[] {
  const mapaPersonal = new Map(personal.map((p) => [p.id, p]));

  return cambios.map((c) => {
    const p = mapaPersonal.get(c.personalId);
    const emp = resolverEmpresa(p?.empresa, mapaEmpresas);
    const nombre = p ? `${p.nombre || ''} ${p.apellido || ''}`.trim() : '(ficha eliminada)';
    const sAnt = Number(c.sueldoAnterior) || 0;
    const sNue = Number(c.sueldoNuevo) || 0;
    const delta = round2(sNue - sAnt);
    const deltaPct = sAnt > 0 ? round2((delta / sAnt) * 100) : 0;

    const familiares = p ? (mapaFamilia?.get(p.id) ?? []) : [];
    const hijos = familiares.filter((f) => f.parentesco === 'hijo');
    const cantidadHijos = hijos.length;
    const hijosMenores = hijos.filter((h) => {
      const edad = edadEn(h.fechaNacimiento);
      return edad != null && edad < 18;
    }).length;

    return {
      id: c.id,
      ambito: 'historico_salarial',
      empresaKey: emp.key,
      empresaNombre: emp.nombre,
      ficha: p?.numero_ficha ? String(p.numero_ficha).padStart(3, '0') : undefined,
      nombreCompleto: nombre,
      cedula: p?.cedula?.trim() || undefined,
      rif: p?.rif?.trim() || undefined,
      cargo: p?.cargo?.trim() || 'Sin cargo',
      departamento: p?.departamento?.trim() || 'General',
      estado: p?.activo ? 'activo' : 'inactivo',
      fechaVigencia: c.vigenteDesde ? c.vigenteDesde.slice(0, 10) : c.createdAt.slice(0, 10),
      tieneHijos: cantidadHijos > 0,
      cantidadHijos,
      hijosMenores,
      cargaFamiliar: familiares.length,
      sueldoBase: sNue,
      sueldoBs: round2(sNue * tasaBcv),
      tasaBcvAplicada: tasaBcv,
      sueldoAnterior: sAnt,
      sueldoNuevo: sNue,
      variacionUsd: delta,
      variacionPct: deltaPct,
      motivo: c.motivo?.trim() || 'Sin motivo',
      tipoCambio: c.tipo || 'cambio',
      autor: c.actorName || c.actor || 'sistema',
    };
  });
}

/** Normaliza los cambios del tabulador de cargos a filas de reporte. */
export function normalizarHistoricoCargosRrhh(
  historial: HistorialTabulador[],
  personal: Personal[],
  tasaBcv: number,
): FilaReporteRrhh[] {
  const personasPorCargo = new Map<string, number>();
  for (const p of personal) {
    if (!p.activo) continue;
    const c = (p.cargo || '').trim().toUpperCase();
    if (c) personasPorCargo.set(c, (personasPorCargo.get(c) || 0) + 1);
  }

  return historial.map((h) => {
    const sAnt = Number(h.sueldoAnterior) || 0;
    const sNue = Number(h.sueldoNuevo) || 0;
    const delta = round2(sNue - sAnt);
    const deltaPct = sAnt > 0 ? round2((delta / sAnt) * 100) : 0;
    const ocupantes = personasPorCargo.get(h.cargo.trim().toUpperCase()) || 0;

    return {
      id: h.id,
      ambito: 'historico_cargos',
      empresaKey: 'TODAS',
      empresaNombre: 'Tabulador General',
      nombreCompleto: h.cargo,
      cargo: h.cargo,
      departamento: 'Tabulador',
      estado: 'activo',
      tieneHijos: false,
      cantidadHijos: 0,
      hijosMenores: 0,
      cargaFamiliar: 0,
      fechaVigencia: h.vigenteDesde ? h.vigenteDesde.slice(0, 10) : h.createdAt.slice(0, 10),
      sueldoBase: sNue,
      sueldoBs: round2(sNue * tasaBcv),
      tasaBcvAplicada: tasaBcv,
      sueldoAnterior: sAnt,
      sueldoNuevo: sNue,
      variacionUsd: delta,
      variacionPct: deltaPct,
      motivo: h.motivo || 'Actualización de tabulador',
      tipoCambio: h.accion || 'tabulador',
      autor: h.cambiadoPorNombre || h.cambiadoPor || 'sistema',
      personasEnCargo: ocupantes,
      costoCargoUsd: round2(sNue * ocupantes),
      totalPersonas: ocupantes,
      masaSalarialUsd: round2(sNue * ocupantes),
    };
  });
}

/* ───────────── Filtrado Puro ───────────── */

/** Aplica todos los filtros seleccionados a las filas. */
export function filtrarFilasRrhh(filas: FilaReporteRrhh[], f: FiltrosRrhh): FilaReporteRrhh[] {
  const txt = (f.texto || '').trim().toLowerCase();
  const tieneEmpresas = Array.isArray(f.empresasSel) && f.empresasSel.length > 0;
  const tieneDeptos = Array.isArray(f.departamentosSel) && f.departamentosSel.length > 0;
  const tieneCargos = Array.isArray(f.cargosSel) && f.cargosSel.length > 0;
  const tieneEstados = Array.isArray(f.estadosSel) && f.estadosSel.length > 0;
  const tieneGeneros = Array.isArray(f.generosSel) && f.generosSel.length > 0;

  return filas.filter((r) => {
    // Multi-Empresa check
    if (tieneEmpresas && r.empresaKey !== 'TODAS' && !f.empresasSel!.includes(r.empresaKey)) return false;

    // Filtros de categoría / área
    if (tieneDeptos && !f.departamentosSel!.includes(r.departamento)) return false;
    if (tieneCargos && !f.cargosSel!.includes(r.cargo)) return false;
    if (tieneEstados && !f.estadosSel!.includes(r.estado)) return false;
    if (tieneGeneros && r.genero && !f.generosSel!.includes(r.genero)) return false;

    // Filtro específico de Hijos / Carga Familiar
    if (f.filtroHijos === 'con_hijos' && !r.tieneHijos) return false;
    if (f.filtroHijos === 'sin_hijos' && r.tieneHijos) return false;

    // Rango Salarial
    if (f.sueldoMin != null && r.sueldoBase < f.sueldoMin) return false;
    if (f.sueldoMax != null && r.sueldoBase > f.sueldoMax) return false;

    // Fechas (para históricos o fecha de ingreso)
    const fechaFila = r.fechaVigencia || r.fechaIngreso;
    if (fechaFila) {
      if (f.desde && fechaFila < f.desde) return false;
      if (f.hasta && fechaFila > f.hasta) return false;
    }

    // Búsqueda de texto libre
    if (txt) {
      const match =
        r.nombreCompleto.toLowerCase().includes(txt) ||
        (r.cedula && r.cedula.toLowerCase().includes(txt)) ||
        (r.rif && r.rif.toLowerCase().includes(txt)) ||
        (r.ficha && r.ficha.toLowerCase().includes(txt)) ||
        (r.correo && r.correo.toLowerCase().includes(txt)) ||
        r.cargo.toLowerCase().includes(txt) ||
        r.departamento.toLowerCase().includes(txt) ||
        r.empresaNombre.toLowerCase().includes(txt) ||
        (r.motivo && r.motivo.toLowerCase().includes(txt)) ||
        (r.autor && r.autor.toLowerCase().includes(txt));
      if (!match) return false;
    }

    return true;
  });
}

/* ───────────── Agrupación y Totales Puros ───────────── */

/**
 * Agrupa las filas según la dimensión elegida (modo) o devuelve detallado.
 * Calcula métricas acumuladas: masa salarial, promedio, mínimos, máximos y %.
 */
export function procesarFilasReporteRrhh(
  filasFiltradas: FilaReporteRrhh[],
  modo: ModoAgrupacionRrhh,
  tasaBcv: number,
): FilaReporteRrhh[] {
  if (modo === 'detallado') {
    return [...filasFiltradas].sort((a, b) => {
      const c = (a.departamento || '').localeCompare(b.departamento || '', 'es');
      return c !== 0 ? c : a.nombreCompleto.localeCompare(b.nombreCompleto, 'es');
    });
  }

  const mapa = new Map<string, FilaReporteRrhh[]>();

  for (const f of filasFiltradas) {
    let clave = '';
    switch (modo) {
      case 'empresa':
        clave = f.empresaNombre || f.empresaKey || 'Otras';
        break;
      case 'departamento':
        clave = f.departamento || 'Sin departamento';
        break;
      case 'cargo':
        clave = f.cargo || 'Sin cargo';
        break;
      case 'estado':
        clave = f.estado === 'activo' ? 'Personal Activo' : 'Personal Inactivo / Baja';
        break;
      case 'genero':
        clave =
          f.genero === 'masculino' ? 'Masculino (Hombres)' : f.genero === 'femenino' ? 'Femenino (Mujeres)' : 'Sin género cargado';
        break;
      case 'carga_familiar':
        clave = f.tieneHijos
          ? `Con Hijos (${f.cantidadHijos} ${f.cantidadHijos === 1 ? 'hijo' : 'hijos'})`
          : 'Sin Hijos registrados';
        break;
      case 'rango_sueldo':
        clave = rangoSalarialDe(f.sueldoBase);
        break;
      case 'mes':
        clave = (f.fechaVigencia || f.fechaIngreso || '').slice(0, 7) || 'Sin fecha';
        break;
      default:
        clave = 'General';
    }

    const arr = mapa.get(clave) || [];
    arr.push(f);
    mapa.set(clave, arr);
  }

  const granTotalMasaUsd = filasFiltradas.reduce((acc, x) => acc + (x.sueldoBase || 0), 0) || 1;

  const grupos: FilaReporteRrhh[] = [];

  for (const [clave, items] of mapa.entries()) {
    const total = items.length;
    const activos = items.filter((x) => x.estado === 'activo').length;
    const inactivos = total - activos;
    const masaUsd = items.reduce((acc, x) => acc + (x.sueldoBase || 0), 0);
    const masaBs = round2(masaUsd * tasaBcv);
    const promedioUsd = total > 0 ? round2(masaUsd / total) : 0;
    const sueldos = items.map((x) => x.sueldoBase).filter((s) => s > 0);
    const minUsd = sueldos.length ? Math.min(...sueldos) : 0;
    const maxUsd = sueldos.length ? Math.max(...sueldos) : 0;
    const pct = round2((masaUsd / granTotalMasaUsd) * 100);

    const totalHijosGrupo = items.reduce((acc, x) => acc + (x.cantidadHijos || 0), 0);
    const totalMenoresGrupo = items.reduce((acc, x) => acc + (x.hijosMenores || 0), 0);
    const totalCargaGrupo = items.reduce((acc, x) => acc + (x.cargaFamiliar || 0), 0);
    const variacionTotalUsd = items.reduce((acc, x) => acc + (x.variacionUsd || 0), 0);
    const muestra = items[0];

    grupos.push({
      id: `grupo-${clave}`,
      ambito: muestra.ambito,
      empresaKey: muestra.empresaKey,
      empresaNombre: modo === 'empresa' ? clave : muestra.empresaNombre,
      nombreCompleto: clave,
      cargo: modo === 'cargo' ? clave : `${total} colaboradores`,
      departamento: modo === 'departamento' ? clave : muestra.departamento,
      estado: 'activo',
      tieneHijos: totalHijosGrupo > 0,
      cantidadHijos: totalHijosGrupo,
      hijosMenores: totalMenoresGrupo,
      cargaFamiliar: totalCargaGrupo,
      sueldoBase: promedioUsd,
      sueldoBs: round2(promedioUsd * tasaBcv),
      tasaBcvAplicada: tasaBcv,
      esGrupo: true,
      grupoClave: clave,
      grupoNombre: clave,
      totalPersonas: total,
      personasActivas: activos,
      personasInactivas: inactivos,
      masaSalarialUsd: masaUsd,
      masaSalarialBs: masaBs,
      sueldoPromedioUsd: promedioUsd,
      sueldoMinUsd: minUsd,
      sueldoMaxUsd: maxUsd,
      pctTotal: pct,
      variacionUsd: variacionTotalUsd,
    });
  }

  return grupos.sort((a, b) => (b.totalPersonas || 0) - (a.totalPersonas || 0));
}

/* ───────────── Cálculo de Resumen / KPIs ───────────── */

export function calcularResumenRrhh(
  filas: FilaReporteRrhh[],
  tasaBcv: number,
  empresasTotales: DefinicionEmpresa[],
): ResumenReporteRrhh {
  const totalRegistros = filas.length;
  let activos = 0;
  let hombres = 0;
  let mujeres = 0;
  let sinGenero = 0;

  let conHijos = 0;
  let sinHijos = 0;
  let totalHijos = 0;
  let totalHijosMenores = 0;
  let conCarga = 0;

  let masaUsd = 0;
  let totalCambios = 0;
  let incrementoUsd = 0;
  let sumaPctAumento = 0;

  const sueldosValidos: number[] = [];
  const deptosMap = new Map<string, { personas: number; masa: number }>();
  const cargosMap = new Map<string, { personas: number; masa: number }>();
  const empresasEncontradas = new Set<string>();

  for (const f of filas) {
    if (f.estado === 'activo') activos++;
    if (f.genero === 'masculino') hombres++;
    else if (f.genero === 'femenino') mujeres++;
    else sinGenero++;

    if (f.tieneHijos) {
      conHijos++;
      totalHijos += f.cantidadHijos || 0;
      totalHijosMenores += f.hijosMenores || 0;
    } else {
      sinHijos++;
    }

    if ((f.cargaFamiliar || 0) > 0) conCarga++;

    if (f.sueldoBase > 0) {
      masaUsd += f.sueldoBase;
      sueldosValidos.push(f.sueldoBase);
    }

    if (f.empresaNombre) empresasEncontradas.add(f.empresaNombre);

    const dNom = f.departamento || 'General';
    const dActual = deptosMap.get(dNom) || { personas: 0, masa: 0 };
    dActual.personas++;
    dActual.masa += f.sueldoBase || 0;
    deptosMap.set(dNom, dActual);

    const cNom = f.cargo || 'Sin cargo';
    const cActual = cargosMap.get(cNom) || { personas: 0, masa: 0 };
    cActual.personas++;
    cActual.masa += f.sueldoBase || 0;
    cargosMap.set(cNom, cActual);

    if (f.variacionUsd != null) {
      totalCambios++;
      incrementoUsd += f.variacionUsd;
      if (f.variacionPct != null) sumaPctAumento += f.variacionPct;
    }
  }

  const inactivos = totalRegistros - activos;
  const promedioUsd = sueldosValidos.length ? round2(masaUsd / sueldosValidos.length) : 0;
  const minUsd = sueldosValidos.length ? Math.min(...sueldosValidos) : 0;
  const maxUsd = sueldosValidos.length ? Math.max(...sueldosValidos) : 0;
  const promedioAumento = totalCambios > 0 ? round2(sumaPctAumento / totalCambios) : 0;

  const masaTotal = masaUsd || 1;

  const topDepartamentos = Array.from(deptosMap.entries())
    .map(([nombre, v]) => ({
      nombre,
      personas: v.personas,
      masaUsd: round2(v.masa),
      porcentaje: round2((v.masa / masaTotal) * 100),
    }))
    .sort((a, b) => b.masaUsd - a.masaUsd)
    .slice(0, 5);

  const topCargos = Array.from(cargosMap.entries())
    .map(([nombre, v]) => ({
      nombre,
      personas: v.personas,
      masaUsd: round2(v.masa),
      porcentaje: round2((v.masa / masaTotal) * 100),
    }))
    .sort((a, b) => b.masaUsd - a.masaUsd)
    .slice(0, 5);

  return {
    totalRegistros,
    totalPersonas: totalRegistros,
    activos,
    inactivos,
    hombres,
    mujeres,
    sinGenero,
    conHijos,
    sinHijos,
    totalHijos,
    totalHijosMenores,
    conCargaFamiliar: conCarga,
    masaSalarialUsd: round2(masaUsd),
    masaSalarialBs: round2(masaUsd * tasaBcv),
    sueldoPromedioUsd: promedioUsd,
    sueldoMinUsd: minUsd,
    sueldoMaxUsd: maxUsd,
    tasaBcvReferencia: tasaBcv,
    totalEmpresas: empresasEncontradas.size || empresasTotales.length,
    empresasNombres: Array.from(empresasEncontradas),
    topDepartamentos,
    topCargos,
    totalCambiosSueldo: totalCambios,
    promedioAumentoPct: promedioAumento,
    incrementoTotalUsd: round2(incrementoUsd),
  };
}

/* ───────────── Ficha Ejecutiva (Tarjetas de Cabecera) ───────────── */

export function obtenerMetricasFichaRrhh(
  resumen: ResumenReporteRrhh,
  ambito: AmbitoRrhh,
  columnasSel?: readonly string[] | null,
): MetricaFichaRrhh[] {
  const tieneCol = (clave: string) => !columnasSel || columnasSel.includes(clave);

  if (ambito === 'historico_salarial') {
    const tieneSueldos = tieneCol('sueldo_nuevo') || tieneCol('variacion_usd') || tieneCol('sueldo_anterior');
    return [
      {
        clave: 'cambios',
        etiqueta: 'TOTAL CAMBIOS',
        valor: String(resumen.totalCambiosSueldo),
        sub: `${resumen.totalPersonas} personas afectadas`,
        colorCss: 'var(--primary)',
        colorRgb: [255, 138, 0],
      },
      {
        clave: 'aumento_neto',
        etiqueta: 'INCREMENTO TOTAL ($)',
        valor: tieneSueldos ? fmtMonedaUsd(resumen.incrementoTotalUsd) : '—',
        sub: tieneSueldos
          ? `Equiv. Bs ${fmtNum2(resumen.incrementoTotalUsd * resumen.tasaBcvReferencia)}`
          : '(No marcado en checks de columnas)',
        colorCss: tieneSueldos ? 'var(--success)' : 'var(--muted)',
        colorRgb: tieneSueldos ? [46, 204, 113] : [140, 150, 160],
      },
      {
        clave: 'promedio_pct',
        etiqueta: 'VARIACIÓN PROMEDIO',
        valor: tieneSueldos ? fmtPct(resumen.promedioAumentoPct) : '—',
        sub: tieneSueldos ? 'Porcentaje medio de ajuste' : '(No marcado en checks de columnas)',
        colorCss: tieneSueldos ? 'var(--info)' : 'var(--muted)',
        colorRgb: tieneSueldos ? [52, 152, 219] : [140, 150, 160],
      },
      {
        clave: 'masa_actual',
        etiqueta: 'MASA SALARIAL ACTUAL',
        valor: tieneSueldos ? fmtMonedaUsd(resumen.masaSalarialUsd) : '—',
        sub: tieneSueldos ? `Promedio: ${fmtMonedaUsd(resumen.sueldoPromedioUsd)}/pers.` : '(No marcado en checks de columnas)',
        colorCss: tieneSueldos ? 'var(--warning)' : 'var(--muted)',
        colorRgb: tieneSueldos ? [243, 156, 18] : [140, 150, 160],
      },
    ];
  }

  if (ambito === 'historico_cargos') {
    const tieneCargos = tieneCol('cargo') || tieneCol('sueldo_base') || tieneCol('costo_cargo');
    return [
      {
        clave: 'cargos_registrados',
        etiqueta: 'TOTAL CARGOS / REGISTROS',
        valor: String(resumen.totalRegistros),
        sub: `${resumen.topCargos.length} cargos destacados`,
        colorCss: 'var(--primary)',
        colorRgb: [255, 138, 0],
      },
      {
        clave: 'masa_cargos',
        etiqueta: 'COSTO TOTAL CARGOS',
        valor: tieneCargos ? fmtMonedaUsd(resumen.masaSalarialUsd) : '—',
        sub: tieneCargos ? `Bs ${fmtNum2(resumen.masaSalarialBs)}` : '(No marcado en checks de columnas)',
        colorCss: tieneCargos ? 'var(--success)' : 'var(--muted)',
        colorRgb: tieneCargos ? [46, 204, 113] : [140, 150, 160],
      },
      {
        clave: 'sueldo_promedio_cargo',
        etiqueta: 'SUELDO MEDIO DE CARGO',
        valor: tieneCargos ? fmtMonedaUsd(resumen.sueldoPromedioUsd) : '—',
        sub: tieneCargos ? `Rango: ${fmtMonedaUsd(resumen.sueldoMinUsd)} - ${fmtMonedaUsd(resumen.sueldoMaxUsd)}` : '(No marcado en checks de columnas)',
        colorCss: tieneCargos ? 'var(--info)' : 'var(--muted)',
        colorRgb: tieneCargos ? [52, 152, 219] : [140, 150, 160],
      },
    ];
  }

  // Ámbito Personal (General)
  const tieneSueldo = tieneCol('sueldo_base') || tieneCol('sueldo_bs') || tieneCol('masa_salarial');
  const tieneHijos = tieneCol('tiene_hijos') || tieneCol('cantidad_hijos') || tieneCol('hijos_menores') || tieneCol('carga_familiar');

  const card1: MetricaFichaRrhh = {
    clave: 'personal_total',
    etiqueta: 'COLABORADORES',
    valor: String(resumen.totalPersonas),
    sub: `${resumen.activos} activos · ${resumen.inactivos} inactivos`,
    colorCss: 'var(--primary)',
    colorRgb: [255, 138, 0],
  };

  const card2: MetricaFichaRrhh = tieneSueldo
    ? {
        clave: 'masa_salarial',
        etiqueta: 'MASA SALARIAL MENSUAL',
        valor: fmtMonedaUsd(resumen.masaSalarialUsd),
        sub: `Bs ${fmtNum2(resumen.masaSalarialBs)} (BCV)`,
        colorCss: 'var(--success)',
        colorRgb: [46, 204, 113],
      }
    : {
        clave: 'masa_salarial',
        etiqueta: 'MASA SALARIAL MENSUAL',
        valor: '—',
        sub: '(No marcado en checks de columnas)',
        colorCss: 'var(--muted)',
        colorRgb: [140, 150, 160],
      };

  const card3: MetricaFichaRrhh = tieneSueldo
    ? {
        clave: 'sueldo_promedio',
        etiqueta: 'SUELDO PROMEDIO',
        valor: fmtMonedaUsd(resumen.sueldoPromedioUsd),
        sub: `Mín: ${fmtMonedaUsd(resumen.sueldoMinUsd)} · Máx: ${fmtMonedaUsd(resumen.sueldoMaxUsd)}`,
        colorCss: 'var(--info)',
        colorRgb: [52, 152, 219],
      }
    : tieneCol('genero')
    ? {
        clave: 'genero_distribucion',
        etiqueta: 'DISTRIBUCIÓN DE GÉNERO',
        valor: `${resumen.hombres}M · ${resumen.mujeres}F`,
        sub: `${resumen.sinGenero} sin género cargado`,
        colorCss: 'var(--info)',
        colorRgb: [52, 152, 219],
      }
    : {
        clave: 'sueldo_promedio',
        etiqueta: 'SUELDO PROMEDIO',
        valor: '—',
        sub: '(No marcado en checks de columnas)',
        colorCss: 'var(--muted)',
        colorRgb: [140, 150, 160],
      };

  const card4: MetricaFichaRrhh = tieneHijos
    ? {
        clave: 'hijos_familia',
        etiqueta: 'HIJOS Y FAMILIA',
        valor: `${resumen.conHijos} con hijos (${resumen.totalHijos} niños)`,
        sub: `${resumen.totalHijosMenores} menores de 18 · ${resumen.sinHijos} sin hijos`,
        colorCss: 'var(--warning)',
        colorRgb: [243, 156, 18],
      }
    : tieneCol('departamento')
    ? {
        clave: 'departamentos',
        etiqueta: 'DEPARTAMENTOS',
        valor: `${resumen.topDepartamentos.length} áreas`,
        sub: `Principal: ${resumen.topDepartamentos[0]?.nombre || '—'} (${resumen.topDepartamentos[0]?.personas || 0})`,
        colorCss: 'var(--warning)',
        colorRgb: [243, 156, 18],
      }
    : {
        clave: 'hijos_familia',
        etiqueta: 'HIJOS Y FAMILIA',
        valor: '—',
        sub: '(No marcado en checks de columnas)',
        colorCss: 'var(--muted)',
        colorRgb: [140, 150, 160],
      };

  return [card1, card2, card3, card4];
}
