/* ============================================================
   Golden Touch · Administración · Motor del Reporte Moldeable de Documentos
   (04/11/2026)

   Motor de datos PURO, DETERMINISTA y SÍNCRONO para el reporte dinámico de
   Documentos, Permisología Minera, Vencimientos y Cumplimiento Legal:
     - 3 Pilares: Documentos (Mintras, Rupdae, Ragda, Inces, IVSS, Socios, etc.),
       Status (Vigente, Por Vencer, Vencido, Vencido en Trámite, No Vence) y
       Caducidades con advertencias (15 días, 1 mes, 3 meses, 1 año).
     - Carpetas organizativas con badges dinámicos.
     - Agrupación multidimensional: Por Carpeta, Por Estatus, Por Horizonte de
       Vencimiento, Por Empresa, Por Socio / Titular, Por Tipo y Detallado.
     - Métricas ejecutivas y tarjetas interactivas (inclusión/exclusión puntual).
     - Sin dependencias de Supabase ni red.
   ============================================================ */

import type {
  CarpetaDocumento,
  DocumentoEmpresa,
  Empresa,
  StatusVencimiento,
  TipoDocumento,
} from './admin.repository';
import {
  CARPETAS_DOCUMENTOS,
  ETIQUETA_CARPETA,
  STATUS_VENCIMIENTO_LABEL,
  TIPO_DOCUMENTO_LABEL,
  diasRestantes,
} from './admin.repository';

/* ───────────── Modos de Agrupación ───────────── */

export type ModoAgrupacionDoc =
  | 'carpeta'
  | 'status'
  | 'horizonte'
  | 'empresa'
  | 'socio'
  | 'tipo'
  | 'detallado';

export const MODOS_AGRUPACION_DOC: { id: ModoAgrupacionDoc; icon: string; label: string }[] = [
  { id: 'carpeta', icon: '📁', label: 'Por Carpeta' },
  { id: 'status', icon: '🚦', label: 'Por Status de Vencimiento' },
  { id: 'horizonte', icon: '⏳', label: 'Por Horizonte de Caducidad' },
  { id: 'empresa', icon: '🏢', label: 'Por Empresa' },
  { id: 'socio', icon: '👥', label: 'Por Socio / Representante' },
  { id: 'tipo', icon: '🏷️', label: 'Por Tipo de Trámite' },
  { id: 'detallado', icon: '📋', label: 'Detallado (Ficha a Ficha)' },
];

export const ETIQUETA_MODO_DOC: Record<ModoAgrupacionDoc, string> = {
  carpeta: 'Carpeta',
  status: 'Status de Vencimiento',
  horizonte: 'Horizonte de Caducidad',
  empresa: 'Empresa',
  socio: 'Socio / Representante',
  tipo: 'Tipo de Documento',
  detallado: 'Detallado',
};

/* ───────────── Presets de Caducidad ───────────── */

export type PresetCaducidadDoc =
  | 'todos'
  | 'criticos' // vencidos o por vencer <= 30d
  | 'proximos_15d'
  | 'proximos_30d'
  | 'proximos_90d'
  | 'vencidos'
  | 'en_tramite'
  | 'vigentes'
  | 'personalizado';

export const PRESETS_CADUCIDAD_DOC: { id: PresetCaducidadDoc; label: string; desc: string }[] = [
  { id: 'todos', label: 'Todos los Documentos', desc: 'Inventario legal y operativo completo' },
  { id: 'criticos', label: '🚨 Críticos y Vencidos', desc: 'Vencidos o que vencen en los próximos 30 días' },
  { id: 'proximos_15d', label: '⚡ Próximos 15 días', desc: 'Atención inmediata requerida' },
  { id: 'proximos_30d', label: '📅 Próximos 30 días', desc: 'Planificación del mes en curso' },
  { id: 'proximos_90d', label: '📆 Próximo Trimestre (90d)', desc: 'Caducidades a mediano plazo' },
  { id: 'vencidos', label: '🔴 Caducados', desc: 'Documentos con fecha anterior a hoy sin trámite' },
  { id: 'en_tramite', label: '🟣 Vencidos en Trámite', desc: 'Con constancia o radicado de renovación' },
  { id: 'vigentes', label: '🟢 Al Día / Vigentes', desc: 'Documentos sin riesgo administrativo' },
  { id: 'personalizado', label: '🎯 Personalizado', desc: 'Rango manual de fechas' },
];

/* ───────────── Columnas Seleccionables ───────────── */

export interface CampoColumnaDoc {
  clave: string;
  etiqueta: string;
  anchoSugerido?: number;
  alineacion?: 'left' | 'center' | 'right';
}

export const CAMPOS_REPORTE_DOC: CampoColumnaDoc[] = [
  { clave: 'empresa', etiqueta: 'Empresa', anchoSugerido: 90 },
  { clave: 'carpeta', etiqueta: 'Carpeta', anchoSugerido: 110 },
  { clave: 'nombre', etiqueta: 'Documento / Trámite', anchoSugerido: 160 },
  { clave: 'tipo', etiqueta: 'Tipo Legal', anchoSugerido: 95 },
  { clave: 'socio', etiqueta: 'Socio / Titular', anchoSugerido: 110 },
  { clave: 'entidad', etiqueta: 'Entidad Emisora', anchoSugerido: 90 },
  { clave: 'nro_registro', etiqueta: 'N° Radicado / Reg.', anchoSugerido: 95 },
  { clave: 'fecha_emision', etiqueta: 'F. Emisión', anchoSugerido: 80, alineacion: 'center' },
  { clave: 'fecha_vencimiento', etiqueta: 'F. Vence', anchoSugerido: 80, alineacion: 'center' },
  { clave: 'dias_restantes', etiqueta: 'Días Rest.', anchoSugerido: 80, alineacion: 'center' },
  { clave: 'status', etiqueta: 'Estado Legal', anchoSugerido: 100, alineacion: 'center' },
  { clave: 'nota_tramite', etiqueta: 'Observación / Trámite', anchoSugerido: 130 },
];

export const CAMPOS_DEFECTO_DOC: string[] = [
  'carpeta',
  'nombre',
  'socio',
  'fecha_vencimiento',
  'dias_restantes',
  'status',
  'nota_tramite',
];

/* ───────────── Estructuras de Datos Procesadas ───────────── */

export interface FilaReporteDoc {
  id: string;
  empresaClave: string;
  empresaNombre: string;
  carpeta: CarpetaDocumento;
  carpetaNombre: string;
  tipo: TipoDocumento;
  tipoNombre: string;
  nombre: string;
  archivoUrl: string | null;
  tamanoBytes: number | null;
  fechaEmision: string | null;
  fechaVencimiento: string | null;
  statusVencimiento: StatusVencimiento;
  diasRestantes: number | null;
  socioNombre: string | null;
  entidadEmisora: string | null;
  numeroRegistro: string | null;
  notaTramite: string | null;
  horizonteLabel: string;
  historialConteo: number;
}

export interface GrupoReporteDoc {
  claveGrupo: string;
  tituloGrupo: string;
  icono: string;
  totalDocs: number;
  vigentes: number;
  porVencer: number;
  vencidos: number;
  vencidosEnTramite: number;
  noVence: number;
  cumplimientoPct: number;
  documentos: FilaReporteDoc[];
  colorStatusDominante: string;
}

export interface ResumenReporteDoc {
  totalDocs: number;
  vigentes: number;
  porVencer: number;
  vencidos: number;
  vencidosEnTramite: number;
  noVence: number;
  criticos: number; // vencidos + porVencer
  cumplimientoPct: number; // (vigentes + noVence) / totalDocs * 100
  totalGrupos: number;
  conteoConSocio: number;
  conteoEnTramite: number;
}

export interface MetricasFichaDoc {
  id: string;
  titulo: string;
  subtitulo: string;
  badgeTexto: string;
  badgeColor: string;
  badgeBg: string;
  totalDocs: number;
  vigentes: number;
  porVencer: number;
  vencidos: number;
  vencidosEnTramite: number;
  noVence: number;
  cumplimientoPct: number;
  alertaCritica: boolean;
  detalleDocumentos: FilaReporteDoc[];
}

/* ───────────── Helpers de Clasificación ───────────── */

export function clasificarHorizonteCaducidad(dias: number | null, status: StatusVencimiento): string {
  if (status === 'no_vence' || dias === null) return 'No Vence / Permanente';
  if (status === 'vencido_en_tramite') return 'Vencido en Trámite';
  if (dias < 0) return 'Vencido';
  if (dias <= 15) return 'Próximos 15 días';
  if (dias <= 30) return 'Próximos 30 días';
  if (dias <= 90) return 'Próximos 90 días (3 meses)';
  if (dias <= 365) return 'Próximo Año';
  return 'Mayor a 1 año';
}

export function normalizarDocumentosAdmin(
  docs: DocumentoEmpresa[],
  empresas: Empresa[],
): FilaReporteDoc[] {
  const empMap = new Map(empresas.map((e) => [e.clave, e.nombre]));

  return docs.map((d) => {
    const dr = d.fechaVencimiento ? diasRestantes(d.fechaVencimiento) : null;
    const hz = clasificarHorizonteCaducidad(dr, d.statusVencimiento);
    const cNom = ETIQUETA_CARPETA[d.carpeta] || d.carpeta;
    const tNom = TIPO_DOCUMENTO_LABEL[d.tipo] || d.tipo;
    const eNom = empMap.get(d.empresaClave) || d.empresaClave;

    return {
      id: d.id,
      empresaClave: d.empresaClave,
      empresaNombre: eNom,
      carpeta: (d.carpeta || 'otros') as CarpetaDocumento,
      carpetaNombre: cNom,
      tipo: d.tipo,
      tipoNombre: tNom,
      nombre: d.nombre,
      archivoUrl: d.path,
      tamanoBytes: d.tamano,
      fechaEmision: d.fechaEmision,
      fechaVencimiento: d.fechaVencimiento,
      statusVencimiento: d.statusVencimiento,
      diasRestantes: dr,
      socioNombre: d.socioNombre,
      entidadEmisora: d.entidadEmisora,
      numeroRegistro: d.numeroRegistro,
      notaTramite: d.notaTramite,
      horizonteLabel: hz,
      historialConteo: Array.isArray(d.historial) ? d.historial.length : 0,
    };
  });
}

export function filtrarDocumentosAdmin(
  filas: FilaReporteDoc[],
  filtros: {
    carpetasSeleccionadas?: string[];
    statusSeleccionados?: StatusVencimiento[];
    empresasSeleccionadas?: string[];
    presetCaducidad?: PresetCaducidadDoc;
    desdeVenc?: string;
    hastaVenc?: string;
    busquedaTexto?: string;
    soloConSocio?: boolean;
  },
): FilaReporteDoc[] {
  const {
    carpetasSeleccionadas,
    statusSeleccionados,
    empresasSeleccionadas,
    presetCaducidad = 'todos',
    desdeVenc,
    hastaVenc,
    busquedaTexto,
    soloConSocio,
  } = filtros;

  const q = busquedaTexto?.trim().toLowerCase() || '';

  return filas.filter((f) => {
    // 1. Carpeta
    if (carpetasSeleccionadas && carpetasSeleccionadas.length > 0) {
      if (!carpetasSeleccionadas.includes(f.carpeta)) return false;
    }

    // 2. Status
    if (statusSeleccionados && statusSeleccionados.length > 0) {
      if (!statusSeleccionados.includes(f.statusVencimiento)) return false;
    }

    // 3. Empresa
    if (empresasSeleccionadas && empresasSeleccionadas.length > 0) {
      if (!empresasSeleccionadas.includes(f.empresaClave)) return false;
    }

    // 4. Solo con Socio
    if (soloConSocio && !f.socioNombre?.trim()) return false;

    // 5. Presets de caducidad
    if (presetCaducidad === 'criticos') {
      const dr = f.diasRestantes;
      const esCritico =
        f.statusVencimiento === 'vencido' ||
        f.statusVencimiento === 'vencido_en_tramite' ||
        (f.statusVencimiento === 'por_vencer' && dr !== null && dr <= 30);
      if (!esCritico) return false;
    } else if (presetCaducidad === 'proximos_15d') {
      if (f.diasRestantes === null || f.diasRestantes < 0 || f.diasRestantes > 15) return false;
    } else if (presetCaducidad === 'proximos_30d') {
      if (f.diasRestantes === null || f.diasRestantes < 0 || f.diasRestantes > 30) return false;
    } else if (presetCaducidad === 'proximos_90d') {
      if (f.diasRestantes === null || f.diasRestantes < 0 || f.diasRestantes > 90) return false;
    } else if (presetCaducidad === 'vencidos') {
      if (f.statusVencimiento !== 'vencido') return false;
    } else if (presetCaducidad === 'en_tramite') {
      if (f.statusVencimiento !== 'vencido_en_tramite') return false;
    } else if (presetCaducidad === 'vigentes') {
      if (f.statusVencimiento !== 'vigente' && f.statusVencimiento !== 'no_vence') return false;
    } else if (presetCaducidad === 'personalizado') {
      if (desdeVenc && (!f.fechaVencimiento || f.fechaVencimiento < desdeVenc)) return false;
      if (hastaVenc && (!f.fechaVencimiento || f.fechaVencimiento > hastaVenc)) return false;
    }

    // 6. Texto de búsqueda libre
    if (q) {
      const haystack = [
        f.nombre,
        f.carpetaNombre,
        f.tipoNombre,
        f.socioNombre || '',
        f.entidadEmisora || '',
        f.numeroRegistro || '',
        f.notaTramite || '',
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });
}

export function calcularResumenDocs(filas: FilaReporteDoc[], totalGrupos = 1): ResumenReporteDoc {
  let vigentes = 0;
  let porVencer = 0;
  let vencidos = 0;
  let vencidosEnTramite = 0;
  let noVence = 0;
  let conSocio = 0;
  let enTramite = 0;

  for (const f of filas) {
    switch (f.statusVencimiento) {
      case 'vigente':
        vigentes++;
        break;
      case 'por_vencer':
        porVencer++;
        break;
      case 'vencido':
        vencidos++;
        break;
      case 'vencido_en_tramite':
        vencidosEnTramite++;
        break;
      case 'no_vence':
        noVence++;
        break;
    }
    if (f.socioNombre && f.socioNombre.trim()) conSocio++;
    if (f.statusVencimiento === 'vencido_en_tramite' || f.notaTramite?.trim()) enTramite++;
  }

  const total = filas.length;
  const cumplimientoPct = total > 0 ? Math.round(((vigentes + noVence) / total) * 100) : 100;
  const criticos = vencidos + porVencer;

  return {
    totalDocs: total,
    vigentes,
    porVencer,
    vencidos,
    vencidosEnTramite,
    noVence,
    criticos,
    cumplimientoPct,
    totalGrupos,
    conteoConSocio: conSocio,
    conteoEnTramite: enTramite,
  };
}

export function agruparDocumentosAdmin(
  filas: FilaReporteDoc[],
  modo: ModoAgrupacionDoc,
): GrupoReporteDoc[] {
  const mapa = new Map<string, { titulo: string; icono: string; docs: FilaReporteDoc[] }>();

  for (const f of filas) {
    let clave = '';
    let titulo = '';
    let icono = '📁';

    switch (modo) {
      case 'carpeta':
        clave = f.carpeta;
        titulo = f.carpetaNombre;
        icono = CARPETAS_DOCUMENTOS.find((c) => c.id === f.carpeta)?.icon || '📁';
        break;
      case 'status':
        clave = f.statusVencimiento;
        titulo = STATUS_VENCIMIENTO_LABEL[f.statusVencimiento] || f.statusVencimiento;
        icono =
          f.statusVencimiento === 'vigente'
            ? '🟢'
            : f.statusVencimiento === 'por_vencer'
            ? '🟡'
            : f.statusVencimiento === 'vencido'
            ? '🔴'
            : f.statusVencimiento === 'vencido_en_tramite'
            ? '🟣'
            : '⚪';
        break;
      case 'horizonte':
        clave = f.horizonteLabel;
        titulo = f.horizonteLabel;
        icono = f.horizonteLabel.includes('Vencido')
          ? '🔴'
          : f.horizonteLabel.includes('15')
          ? '⚡'
          : f.horizonteLabel.includes('30')
          ? '⏳'
          : '📅';
        break;
      case 'empresa':
        clave = f.empresaClave;
        titulo = f.empresaNombre;
        icono = '🏢';
        break;
      case 'socio':
        clave = f.socioNombre?.trim() || 'sin_socio';
        titulo = f.socioNombre?.trim() || 'Empresa General (Sin Socio Asignado)';
        icono = '👤';
        break;
      case 'tipo':
        clave = f.tipo;
        titulo = f.tipoNombre;
        icono = '🏷️';
        break;
      case 'detallado':
      default:
        clave = f.id;
        titulo = f.nombre;
        icono = '📄';
        break;
    }

    if (!mapa.has(clave)) {
      mapa.set(clave, { titulo, icono, docs: [] });
    }
    mapa.get(clave)!.docs.push(f);
  }

  const grupos: GrupoReporteDoc[] = [];

  mapa.forEach((val, clave) => {
    const r = calcularResumenDocs(val.docs, 1);

    // Color dominante
    let colorDominante = '#10b981';
    if (r.vencidos > 0) colorDominante = '#ef4444';
    else if (r.vencidosEnTramite > 0) colorDominante = '#a855f7';
    else if (r.porVencer > 0) colorDominante = '#f59e0b';
    else if (r.vigentes > 0 || r.noVence > 0) colorDominante = '#10b981';

    grupos.push({
      claveGrupo: clave,
      tituloGrupo: val.titulo,
      icono: val.icono,
      totalDocs: r.totalDocs,
      vigentes: r.vigentes,
      porVencer: r.porVencer,
      vencidos: r.vencidos,
      vencidosEnTramite: r.vencidosEnTramite,
      noVence: r.noVence,
      cumplimientoPct: r.cumplimientoPct,
      documentos: val.docs,
      colorStatusDominante: colorDominante,
    });
  });

  // Ordenar grupos: los que tienen vencidos primero si no es detallado
  if (modo !== 'detallado') {
    grupos.sort((a, b) => {
      if (b.vencidos !== a.vencidos) return b.vencidos - a.vencidos;
      if (b.porVencer !== a.porVencer) return b.porVencer - a.porVencer;
      return a.tituloGrupo.localeCompare(b.tituloGrupo);
    });
  }

  return grupos;
}

export function obtenerMetricasFichaDoc(g: GrupoReporteDoc): MetricasFichaDoc {
  let badgeTexto = '100% Cumplimiento';
  let badgeColor = '#10b981';
  let badgeBg = 'rgba(16, 185, 129, 0.15)';
  let alertaCritica = false;

  if (g.vencidos > 0) {
    badgeTexto = `${g.vencidos} ${g.vencidos === 1 ? 'Vencido' : 'Vencidos'}`;
    badgeColor = '#ef4444';
    badgeBg = 'rgba(239, 68, 68, 0.15)';
    alertaCritica = true;
  } else if (g.vencidosEnTramite > 0) {
    badgeTexto = `${g.vencidosEnTramite} En Trámite`;
    badgeColor = '#a855f7';
    badgeBg = 'rgba(168, 85, 247, 0.15)';
  } else if (g.porVencer > 0) {
    badgeTexto = `${g.porVencer} Por Vencer`;
    badgeColor = '#f59e0b';
    badgeBg = 'rgba(245, 158, 11, 0.15)';
  }

  const sub = `${g.totalDocs} ${g.totalDocs === 1 ? 'documento' : 'documentos'} · ${g.vigentes} vigentes · ${g.cumplimientoPct}% al día`;

  return {
    id: g.claveGrupo,
    titulo: g.tituloGrupo,
    subtitulo: sub,
    badgeTexto,
    badgeColor,
    badgeBg,
    totalDocs: g.totalDocs,
    vigentes: g.vigentes,
    porVencer: g.porVencer,
    vencidos: g.vencidos,
    vencidosEnTramite: g.vencidosEnTramite,
    noVence: g.noVence,
    cumplimientoPct: g.cumplimientoPct,
    alertaCritica,
    detalleDocumentos: g.documentos,
  };
}

const fCorta = (iso: string) => {
  const [a, m, d] = iso.split('-');
  return d && m && a ? `${d}/${m}/${a}` : iso;
};

export function obtenerTituloRangoDoc(preset: PresetCaducidadDoc, desde?: string, hasta?: string): string {
  const hoyStr = new Intl.DateTimeFormat('es-VE', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date());

  switch (preset) {
    case 'criticos':
      return `Reporte de Documentos Críticos y Vencidos al ${hoyStr}`;
    case 'proximos_15d':
      return `Reporte de Caducidades Próximas (15 días) al ${hoyStr}`;
    case 'proximos_30d':
      return `Reporte de Caducidades del Mes (30 días) al ${hoyStr}`;
    case 'proximos_90d':
      return `Reporte Trimestral de Vencimientos al ${hoyStr}`;
    case 'vencidos':
      return `Reporte de Documentos Vencidos al ${hoyStr}`;
    case 'en_tramite':
      return `Reporte de Documentos en Trámite de Renovación al ${hoyStr}`;
    case 'vigentes':
      return `Reporte de Cumplimiento Legal y Permisos Vigentes al ${hoyStr}`;
    case 'personalizado':
      if (desde && hasta) return `Reporte de Permisología del ${fCorta(desde)} al ${fCorta(hasta)}`;
      if (desde) return `Reporte de Permisología a partir del ${fCorta(desde)}`;
      if (hasta) return `Reporte de Permisología hasta el ${fCorta(hasta)}`;
      return `Reporte de Documentos al ${hoyStr}`;
    case 'todos':
    default:
      return `Reporte Integral de Documentos y Permisos al ${hoyStr}`;
  }
}
