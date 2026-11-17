/* ============================================================
   Golden Touch · Administración (Gastos fijos) · repositorio
   Formas de persistencia (Empresa, GastoFijo) + CRUD. Los tipos de VALOR
   (Periodicidad, Moneda) son de administracionCalculo.ts (fuente única).
   Multi-empresa: la lista de empresas es PROPIA del módulo (admin_empresas),
   separada de RRHH; el gasto enlaza su empresa por `empresa_clave` (text).
   El acceso va detrás de una interfaz `AdminRepo`: la impl Supabase para la
   app, y una impl demo en memoria (demo/) para local sin base (D27).
   camelCase en el dominio; mapeo snake_case en el límite del repo.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { listCategoriasGasto, soloCategorias } from '@/modules/tesoreria/categoriasGasto.repository';
import { listProveedoresActivos } from '@/modules/pedidos/pedidos.repository';
import { crearServicioDirecto, enviarServicioAPagar, urlAdjuntoServicio, eliminarServicioDirecto, type ServicioDirecto } from '@/modules/pedidos/serviciosDirectos.repository';
import type { Moneda, Periodicidad } from './administracionCalculo';
import { generarPendientes as calcularPendientes, notaPendiente } from './administracionGenerar';
import { FAOV_TIERS, factoresValidos, type TierFaov } from './administracionParafiscal';
import { esErrorTablaAusente } from './adminErrores';
import { disponibleParaEnviar, notaAgrupacion, motivoNoReversable } from './administracionHonorarios';

export type EstadoGastoFijo = 'activo' | 'suspendido';

/** Empresa propia de Administración (tabla `admin_empresas`). */
export interface Empresa {
  id: string;
  /** Código corto estable y único ('GT', 'MTO'…): el enlace del gasto. */
  clave: string;
  /** Razón social. */
  nombre: string;
  rif: string | null;
  moneda: Moneda | null;
  logoPath: string | null;
  activa: boolean;
  orden: number;
}
export type EmpresaInput = Omit<Empresa, 'id'>;

/** Centro de acopio de una empresa (tabla `admin_centros_acopio`). */
export interface CentroAcopio {
  id: string;
  empresaClave: string;
  nombre: string;
  orden: number;
  activo: boolean;
  /** Quien responde por el centro. Alimenta la matriz de responsables del reporte. */
  responsablePrincipal?: string | null;
  /** Etiqueta de fase operativa (FASES_OPERATIVAS); convive con la cobertura N de M. */
  fasePredeterminada?: string | null;
  descripcion?: string | null;
}
export type CentroAcopioInput = Omit<CentroAcopio, 'id'>;

/** Profesional de Administración (abogada, contador…). Lista PROPIA; NO son proveedores. */
export interface Profesional {
  id: string;
  nombre: string;
  profesion: string | null;
  contacto: string | null;
  activo: boolean;
}
export type ProfesionalInput = Omit<Profesional, 'id'>;

/** Carpeta de documentos (tabla `admin_carpetas`); anidable por `parentId`. */
export interface Carpeta {
  id: string;
  empresaClave: string | null;
  nombre: string;
  parentId: string | null;
  orden: number;
}
export type CarpetaInput = Omit<Carpeta, 'id'>;

/** Estado de una gestión. `abierta`/`anulada` se persisten; `parcial`/`saldada` se
 *  DERIVAN de los envíos pagados (ver administracionHonorarios.estadoGestion). */
export type EstadoGestion = 'abierta' | 'parcial' | 'saldada' | 'anulada';
/** Gestión / honorario (tabla `admin_gestiones`): renglón de nombre libre con costo,
 *  colgado de un profesional. El estado de cuenta por profesional se arma sobre esto. */
export interface Gestion {
  id: string;
  empresaClave: string;
  profesionalId: string | null;
  categoriaId: string | null;
  centroAcopioId: string | null;
  documentoId: string | null;
  concepto: string;
  costoTotal: number;
  moneda: Moneda;
  tasaRef: number | null;
  fecha: string;
  fechaPactada: string | null;
  estado: EstadoGestion;
  notaAcuerdo: string | null;
  /** Fase 3 (aditivos): prioridad del analista y aviso configurable. */
  prioridad?: Prioridad | null;
  avisoDias?: number | null;
}
export type GestionInput = Omit<Gestion, 'id'>;

/** Estado de un envío a Tesorería. `enviado` = cuenta por pagar creada (reversible);
 *  `pagado` = Tesorería lo pagó (se refleja); `reversado` = se deshizo antes de pagar. */
export type EstadoEnvio = 'enviado' | 'pagado' | 'reversado';
/** Envío atómico de (parte de) una gestión a Tesorería (tabla `admin_envios_tesoreria`).
 *  Una gestión : N envíos. Cada envío = un servicio directo en Tesorería. */
export interface EnvioTesoreria {
  id: string;
  gestionId: string;
  empresaClave: string;
  monto: number;
  moneda: Moneda;
  fechaEnvio: string;
  estado: EstadoEnvio;
  servicioDirectoId: string | null;
  enviadoPor: string | null;
  pagadoEn: string | null;
}
/** Datos para enviar (parte de) una gestión a Tesorería como cuenta por pagar. */
export interface CrearEnvioInput {
  gestion: Gestion;
  monto: number;
  /** Nombre del profesional, para la nota de agrupación que ve Tesorería. */
  profesionalNombre: string;
  /** Quién envía; si se omite, el repo lo resuelve del usuario autenticado. */
  actor?: string;
  actorName?: string | null;
}

/** Plantilla recurrente de gasto fijo (tabla `admin_gastos_fijos`). */
export interface GastoFijo {
  id: string;
  empresaClave: string;
  concepto: string;
  proveedorId: string | null;
  proveedorNombre: string | null;
  categoriaGastoId: string | null;
  monto: number;
  moneda: Moneda;
  tasaRef: number | null;
  periodicidad: Periodicidad;
  /** Día del período en que vence (1–31); null = día 1. */
  diaVencimiento: number | null;
  /** Ancla para calcular los períodos ('AAAA-MM-DD'). */
  vigenteDesde: string;
  estado: EstadoGastoFijo;
  centroAcopioId?: string | null;
  responsable?: string | null;
  createdAt?: string | null;
}
export type GastoFijoInput = Omit<GastoFijo, 'id' | 'createdAt'>;

export type EstadoPago = 'pendiente' | 'pagado' | 'anulado';
export type OrigenMovimiento = 'generado' | 'importado' | 'manual';
/** Prioridad que fija el analista para ordenar su lista de trabajo. */
export type Prioridad = 'alta' | 'media' | 'baja';

/** Responsabilidad N:N (tabla `admin_responsabilidades`): un usuario responde de un objetivo. */
export type ObjetivoResp = 'carpeta' | 'documento' | 'gasto' | 'gestion';
export interface Responsabilidad {
  id: string;
  empresaClave: string;
  usuarioEmail: string;
  objetivoTipo: ObjetivoResp;
  objetivoId: string;
}
export type ResponsabilidadInput = Omit<Responsabilidad, 'id'>;

/** Aviso interno del módulo (tabla `admin_avisos`): bandeja persistida. */
export type TipoAviso = 'por_vencer' | 'vencido' | 'incumplido' | 'acuerdo' | 'nota';
export interface Aviso {
  id: string;
  empresaClave: string;
  tipo: TipoAviso;
  origen: 'documento' | 'gasto' | 'gestion';
  origenId: string;
  responsableEmail: string | null;
  fecha: string | null;
  texto: string;
  leido: boolean;
}
export type AvisoInput = Omit<Aviso, 'id' | 'leido'>;

/** Documento requerido de un centro (tabla `admin_centro_requeridos`): el checklist
 *  editable contra el que se mide la cobertura (fase) del centro. */
export interface CentroRequerido {
  id: string;
  empresaClave: string;
  centroId: string;
  tipoDocumento: TipoDocumento;
}
export type CentroRequeridoInput = Omit<CentroRequerido, 'id'>;

/** Un egreso por período: el pendiente generado, el movimiento importado o el
 *  alta manual (tabla `admin_gasto_fijo_movimientos`). Sobre esto va el reporte. */
export interface Movimiento {
  id: string;
  empresaClave: string;
  /** Plantilla que lo originó; null para filas sueltas del histórico. */
  gastoFijoId: string | null;
  concepto: string;
  proveedorNombre: string | null;
  categoriaGastoId: string | null;
  /** Token de período (2026-11, 2026-T4…). */
  periodo: string;
  /** Vencimiento / fecha efectiva ('AAAA-MM-DD'). */
  fecha: string;
  monto: number;
  moneda: Moneda;
  tasaRef: number | null;
  estadoPago: EstadoPago;
  origen: OrigenMovimiento;
  /** El pendiente materializado en Tesorería (Opción A); null si aún no. */
  servicioDirectoId: string | null;
  /** Fase 3 (aditivos): prioridad del analista y aviso configurable. */
  prioridad?: Prioridad | null;
  avisoDias?: number | null;
  createdAt?: string | null;
}
export type MovimientoInput = Omit<Movimiento, 'id' | 'createdAt'>;

/** Opción {id, nombre} para los selectores (categorías, proveedores). */
export interface OpcionRef { id: string; nombre: string; }

/** Categoría contable de gasto PROPIA del módulo (tabla `admin_categorias`).
 *  Un plan de cuentas curado para gastos fijos, separado del catálogo compartido
 *  `categorias_gasto`. Se gestiona desde la pestaña Configuración. */
export interface AdminCategoria { id: string; nombre: string; orden: number; activa: boolean; }

/** Status de vigencia y vencimiento (Documentos y Gastos). */
export type StatusVencimiento = 'vigente' | 'por_vencer' | 'vencido' | 'vencido_en_tramite' | 'no_vence';

export const STATUS_VENCIMIENTO_LABEL: Record<StatusVencimiento, string> = {
  vigente: 'Vigente',
  por_vencer: 'Por vencer',
  vencido: 'Vencido',
  vencido_en_tramite: 'Vencido en trámite',
  no_vence: 'No vence',
};

export const STATUS_VENCIMIENTO_COLOR: Record<StatusVencimiento, { color: string; bg: string; border: string }> = {
  vigente: { color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', border: '#10b981' },
  por_vencer: { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', border: '#f59e0b' },
  vencido: { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', border: '#ef4444' },
  vencido_en_tramite: { color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)', border: '#a855f7' },
  no_vence: { color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)', border: '#94a3b8' },
};

/** Carpetas organizativas de archivos de Administración y Permisología Minera. */
export type CarpetaDocumento =
  | 'permisos_mineros'
  | 'laboral_parafiscal'
  | 'legal_constitutivo'
  | 'socios_representantes'
  | 'tributario_fiscal'
  | 'contratos_servicios'
  | 'otros';

export interface InfoCarpetaDoc {
  id: string;
  esPersonalizada?: boolean;
  icon: string;
  label: string;
  descripcion: string;
  centroAcopioId?: string | null;
  responsable?: string | null;
}

export const CARPETAS_DOCUMENTOS: InfoCarpetaDoc[] = [
  { id: 'permisos_mineros', icon: '⛏️', label: 'Permisos Mineros y Ambientales', descripcion: 'Rupdae, Ragda, Minería, MinEc y providencias', centroAcopioId: null, responsable: null },
  { id: 'laboral_parafiscal', icon: '⚖️', label: 'Laboral y Parafiscales', descripcion: 'Mintras, Inces, IVSS, FAOV y solvencias laborales', centroAcopioId: null, responsable: null },
  { id: 'legal_constitutivo', icon: '📜', label: 'Legal y Estatutario', descripcion: 'Carta / Acta Constitutiva, Asambleas y RIF', centroAcopioId: null, responsable: null },
  { id: 'socios_representantes', icon: '👥', label: 'Socios y Representantes', descripcion: 'Cédulas, RIFs y fichas de N socios', centroAcopioId: null, responsable: null },
  { id: 'tributario_fiscal', icon: '🏛️', label: 'Tributario y Municipal', descripcion: 'Patentes de Industria y Comercio, SENIAT y solvencias', centroAcopioId: null, responsable: null },
  { id: 'contratos_servicios', icon: '📑', label: 'Contratos y Acuerdos', descripcion: 'Convenios, arrendamientos y acuerdos operativos', centroAcopioId: null, responsable: null },
  { id: 'otros', icon: '📁', label: 'Otros Archivos', descripcion: 'Documentación general y respaldos', centroAcopioId: null, responsable: null },
];

export const ETIQUETA_CARPETA: Record<string, string> = {
  permisos_mineros: 'Permisos Mineros y Ambientales',
  laboral_parafiscal: 'Laboral y Parafiscales',
  legal_constitutivo: 'Legal y Estatutario',
  socios_representantes: 'Socios y Representantes',
  tributario_fiscal: 'Tributario y Municipal',
  contratos_servicios: 'Contratos y Acuerdos',
  otros: 'Otros Archivos',
};

/** Tipo de papel legal, permiso minero o solvencia. */
export type TipoDocumento =
  | 'rupdae'
  | 'ragda'
  | 'mintras'
  | 'inces'
  | 'ivss'
  | 'faov'
  | 'acta_constitutiva'
  | 'acta_modificacion'
  | 'rif'
  | 'cedula'
  | 'cedula_socio'
  | 'rif_socio'
  | 'patente_municipal'
  | 'solvencia_municipal'
  | 'permiso_ambiental'
  | 'permiso_minero'
  | 'otro';

export const TIPO_DOCUMENTO_LABEL: Record<TipoDocumento, string> = {
  rupdae: 'RUPDAE (Actividades Económicas)',
  ragda: 'RAGDA (Degradación Ambiental)',
  mintras: 'MINTRAS (Ministerio del Trabajo)',
  inces: 'INCES (Solvencia / Certificado)',
  ivss: 'IVSS (Seguro Social)',
  faov: 'FAOV / BANAVIH (Vivienda)',
  acta_constitutiva: 'Acta / Carta Constitutiva',
  acta_modificacion: 'Acta de Asamblea / Modificación',
  rif: 'RIF Jurídico',
  cedula: 'Cédula del Representante',
  cedula_socio: 'Cédula de Identidad (Socio)',
  rif_socio: 'RIF Personal (Socio)',
  patente_municipal: 'Patente de Industria y Comercio',
  solvencia_municipal: 'Solvencia Municipal',
  permiso_ambiental: 'Permiso Ambiental / MINEC',
  permiso_minero: 'Permiso / Concesión Minera',
  otro: 'Otro Documento',
};

/** Registro individual de historial ligero de cambios / auditoría por documento. */
export interface HistorialCambioDoc {
  id: string;
  fecha: string;
  actor: string;
  accion: 'creacion' | 'modificacion' | 'cambio_status' | 'renovacion' | 'archivo_reemplazado';
  detalle: string;
}

/** Documento (PDF/imagen) adjunto a una empresa (tabla `admin_empresa_documentos`
 *  + Storage bucket `admin-documentos`). Incluye vigencia, carpeta, metadatos mineros y auditoría. */
export interface DocumentoEmpresa {
  id: string;
  empresaClave: string;
  carpeta: string;
  centroAcopioId?: string | null;
  responsable?: string | null;
  tipo: TipoDocumento;
  nombre: string;
  /** Ruta en el bucket; con ella se pide la URL firmada. */
  path: string;
  contentType: string | null;
  tamano: number | null;
  fechaEmision: string | null;
  fechaVencimiento: string | null;
  statusVencimiento: StatusVencimiento;
  socioNombre: string | null;
  entidadEmisora: string | null;
  numeroRegistro: string | null;
  notaTramite: string | null;
  historial: HistorialCambioDoc[];
  createdAt: string | null;
  updatedAt: string | null;
  /** Fase 3 (aditivos): costo de gestión + su moneda, enlace a la gestión que lo
   *  tramitó, aviso configurable (días), subcarpeta, badge y prioridad. */
  costoGestion?: number | null;
  monedaCosto?: Moneda | null;
  gestionId?: string | null;
  avisoDias?: number | null;
  subcarpetaId?: string | null;
  badgeTexto?: string | null;
  prioridad?: Prioridad | null;
}

export interface DocumentoEmpresaInput {
  empresaClave: string;
  carpeta?: string;
  centroAcopioId?: string | null;
  responsable?: string | null;
  tipo: TipoDocumento;
  nombre: string;
  fechaEmision?: string | null;
  fechaVencimiento?: string | null;
  statusVencimiento?: StatusVencimiento;
  socioNombre?: string | null;
  entidadEmisora?: string | null;
  numeroRegistro?: string | null;
  notaTramite?: string | null;
  costoGestion?: number | null;
  monedaCosto?: Moneda | null;
  gestionId?: string | null;
  avisoDias?: number | null;
  subcarpetaId?: string | null;
  badgeTexto?: string | null;
  prioridad?: Prioridad | null;
}

export function diasRestantes(fechaVencimiento: string | null | undefined, hoyRef?: string): number | null {
  if (!fechaVencimiento) return null;
  const hoyStr = hoyRef || new Date().toISOString().slice(0, 10);
  const [y1, m1, d1] = fechaVencimiento.split('-').map(Number);
  const [y2, m2, d2] = hoyStr.split('-').map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return null;
  const f1 = Date.UTC(y1, m1 - 1, d1);
  const f2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((f1 - f2) / (1000 * 60 * 60 * 24));
}

export function calcularStatusVencimiento(
  fechaVencimiento: string | null | undefined,
  statusManual?: StatusVencimiento,
  diasUmbralAlerta = 30,
  hoyRef?: string,
): StatusVencimiento {
  if (statusManual === 'vencido_en_tramite') return 'vencido_en_tramite';
  if (statusManual === 'no_vence' || !fechaVencimiento) return 'no_vence';
  const dias = diasRestantes(fechaVencimiento, hoyRef);
  if (dias === null) return 'no_vence';
  if (dias < 0) return 'vencido';
  if (dias <= diasUmbralAlerta) return 'por_vencer';
  return 'vigente';
}

/** Limpia y normaliza el nombre de un archivo para sugerir un título limpio en el sistema. */
export function limpiarNombreArchivo(nombreArchivo: string): string {
  let limpio = nombreArchivo
    // Quitar extensión final
    .replace(/\.[a-zA-Z0-9]+$/i, '')
    // Quitar patrones repetidos tipo ".A NUEVO FORMATO.A NUEVO FORMATO" o "_firmado"
    .replace(/(\.A NUEVO FORMATO)+/gi, '')
    .replace(/_firmado/gi, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  limpio = limpio.replace(/\s+/g, ' ');
  return limpio || nombreArchivo;
}

/** Infiere automáticamente carpeta y tipo de documento a partir del nombre del archivo. */
export function inferirCarpetaYTipo(nombreArchivo: string): { carpeta: CarpetaDocumento; tipo: TipoDocumento } {
  const s = nombreArchivo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/rupdae/i.test(s)) return { carpeta: 'permisos_mineros', tipo: 'rupdae' };
  if (/ra[cg]da/i.test(s)) return { carpeta: 'permisos_mineros', tipo: 'ragda' };
  if (/miner|concesion|minec|ambient|senafim|rum/i.test(s)) return { carpeta: 'permisos_mineros', tipo: 'permiso_minero' };
  if (/mintra/i.test(s)) return { carpeta: 'laboral_parafiscal', tipo: 'mintras' };
  if (/inces/i.test(s)) return { carpeta: 'laboral_parafiscal', tipo: 'inces' };
  if (/ivss|seguro/i.test(s)) return { carpeta: 'laboral_parafiscal', tipo: 'ivss' };
  if (/faov|banavih|habitat/i.test(s)) return { carpeta: 'laboral_parafiscal', tipo: 'faov' };
  if (/carta.*const|acta.*const/i.test(s)) return { carpeta: 'legal_constitutivo', tipo: 'acta_constitutiva' };
  if (/asamble|modific/i.test(s)) return { carpeta: 'legal_constitutivo', tipo: 'acta_modificacion' };
  if (/rif.*socio|rif.*personal/i.test(s)) return { carpeta: 'socios_representantes', tipo: 'rif_socio' };
  if (/rif/i.test(s)) return { carpeta: 'legal_constitutivo', tipo: 'rif' };
  if (/socio|accionista|cedula/i.test(s)) return { carpeta: 'socios_representantes', tipo: 'cedula_socio' };
  if (/patente|alcald|municip|actividad.*econom/i.test(s)) return { carpeta: 'tributario_fiscal', tipo: 'patente_municipal' };
  if (/bombero/i.test(s)) return { carpeta: 'tributario_fiscal', tipo: 'solvencia_municipal' };
  if (/contrat|arrendam|propuesta/i.test(s)) return { carpeta: 'contratos_servicios', tipo: 'otro' };
  return { carpeta: 'otros', tipo: 'otro' };
}

/** Puerto de datos del módulo. La página lo recibe inyectado: Supabase en la
 *  app; una impl en memoria en la página de prueba (DEV). */
export interface AdminRepo {
  listEmpresas(): Promise<Empresa[]>;
  crearEmpresa(e: EmpresaInput): Promise<Empresa>;
  editarEmpresa(id: string, cambios: Partial<EmpresaInput>): Promise<void>;
  /** Cuántos gastos fijos cuelgan de una empresa (para decidir borrar vs desactivar). */
  contarGastosDeEmpresa(clave: string): Promise<number>;
  desactivarEmpresa(id: string): Promise<void>;
  borrarEmpresa(id: string): Promise<void>;
  // Centros de acopio
  listCentros(empresaClave?: string): Promise<CentroAcopio[]>;
  crearCentro(c: CentroAcopioInput): Promise<CentroAcopio>;
  editarCentro(id: string, cambios: Partial<CentroAcopioInput>): Promise<void>;
  setActivoCentro(id: string, activo: boolean): Promise<void>;
  eliminarCentro(id: string): Promise<void>;
  // Profesionales (abogada, contador…)
  listProfesionales(): Promise<Profesional[]>;
  crearProfesional(p: ProfesionalInput): Promise<Profesional>;
  editarProfesional(id: string, cambios: Partial<ProfesionalInput>): Promise<void>;
  setActivoProfesional(id: string, activo: boolean): Promise<void>;
  // Carpetas de documentos (anidables)
  listCarpetas(empresaClave?: string): Promise<Carpeta[]>;
  crearCarpeta(c: CarpetaInput): Promise<Carpeta>;
  editarCarpeta(id: string, cambios: Partial<CarpetaInput>): Promise<void>;
  borrarCarpeta(id: string): Promise<void>;
  // Gestiones (honorarios)
  listGestiones(empresaClave?: string, profesionalId?: string): Promise<Gestion[]>;
  crearGestion(g: GestionInput): Promise<Gestion>;
  editarGestion(id: string, cambios: Partial<GestionInput>): Promise<void>;
  anularGestion(id: string): Promise<void>;
  borrarGestion(id: string): Promise<void>;
  // Envíos a Tesorería (puente atómico, reversible mientras no pagado)
  listEnvios(gestionId?: string): Promise<EnvioTesoreria[]>;
  crearEnvio(input: CrearEnvioInput): Promise<EnvioTesoreria>;
  reversarEnvio(id: string): Promise<void>;
  /** Relee los servicios directos de los envíos 'enviado' y marca 'pagado' los que Tesorería pagó. */
  refrescarEnvios(gestionId?: string): Promise<void>;
  /** URL firmada del comprobante único del servicio directo del envío (o null). */
  urlAdjuntoEnvio(envio: EnvioTesoreria): Promise<string | null>;
  // Responsabilidades (N:N)
  listResponsabilidades(empresaClave?: string): Promise<Responsabilidad[]>;
  asignarResponsabilidad(input: ResponsabilidadInput): Promise<Responsabilidad>;
  quitarResponsabilidad(id: string): Promise<void>;
  // Avisos internos
  listAvisos(empresaClave?: string): Promise<Aviso[]>;
  crearAviso(a: AvisoInput): Promise<Aviso>;
  marcarAvisoLeido(id: string, leido: boolean): Promise<void>;
  borrarAviso(id: string): Promise<void>;
  // Requeridos por centro (checklist de fase)
  listCentroRequeridos(empresaClave?: string): Promise<CentroRequerido[]>;
  agregarCentroRequerido(input: CentroRequeridoInput): Promise<CentroRequerido>;
  quitarCentroRequerido(id: string): Promise<void>;
  /**
   * Factores de la multa FAOV vigentes. Son de ley, pero la ley cambia: se
   * guardan en `config` para no tener que tocar codigo y desplegar (12/11/2026).
   * Si no se han ajustado nunca, devuelve los de la Gaceta 6.805.
   */
  leerFactoresFaov(): Promise<TierFaov[]>;
  guardarFactoresFaov(tiers: TierFaov[], actor?: string): Promise<void>;
  listGastosFijos(empresaClave?: string): Promise<GastoFijo[]>;
  crearGastoFijo(g: GastoFijoInput): Promise<GastoFijo>;
  editarGastoFijo(id: string, cambios: Partial<GastoFijoInput>): Promise<void>;
  setEstadoGastoFijo(id: string, estado: EstadoGastoFijo): Promise<void>;
  /** Categorías activas del módulo, para los selectores (id, nombre). */
  listCategorias(): Promise<OpcionRef[]>;
  /** Todas las categorías del módulo (incluye inactivas), para gestionarlas en Configuración. */
  listAdminCategorias(): Promise<AdminCategoria[]>;
  crearAdminCategoria(nombre: string): Promise<AdminCategoria>;
  renombrarAdminCategoria(id: string, nombre: string): Promise<void>;
  setActivaAdminCategoria(id: string, activa: boolean): Promise<void>;
  listProveedores(): Promise<OpcionRef[]>;
  listMovimientos(empresaClave?: string): Promise<Movimiento[]>;
  crearMovimiento(m: MovimientoInput): Promise<Movimiento>;
  editarMovimiento(id: string, cambios: Partial<MovimientoInput>): Promise<void>;
  /** Anula un movimiento (estado_pago = 'anulado'); queda fuera de los totales del reporte. */
  anularMovimiento(id: string): Promise<void>;
  /** Elimina un movimiento definitivamente de la base de datos (ideal para registros de prueba). */
  borrarMovimiento(id: string): Promise<void>;
  /** Genera los pendientes que faltan hasta `hasta` (default hoy), idempotente. Devuelve cuántos creó. */
  /**
   * Genera los pendientes del periodo y los manda a Tesoreria.
   *
   * Devuelve cuantos LLEGARON de verdad: antes el envio se hacia en silencio y,
   * si fallaba, la pantalla seguia diciendo «van a Tesoreria» aunque no hubiera
   * ido ninguno (12/11/2026). Los que no llegaron quedan creados y se envian
   * uno a uno con `enviarMovimientoATesoreria`.
   */
  generarPendientes(empresaClave?: string, hasta?: Date): Promise<{ creados: number; enTesoreria: number }>;
  /**
   * Manda un pendiente a Tesoreria como servicio directo «por pagar».
   *
   * Administracion NO paga (regla de la lider, 12/11/2026): solo envia, y despues
   * mira el estado y el comprobante. Antes habia un boton «Pagar» que marcaba el
   * movimiento como pagado SIN tocar Tesoreria: dos verdades sobre el mismo dinero.
   *
   * A diferencia del puente automatico, este LANZA el error si falla, para que la
   * pantalla pueda decirlo en vez de dar por enviado algo que no salio.
   */
  enviarMovimientoATesoreria(mov: Movimiento, actor?: string): Promise<void>;
  /** Trae de Tesoreria el estado de los pendientes ya enviados (si ya se pagaron). */
  refrescarMovimientos(empresaClave?: string): Promise<void>;
  /** URL firmada del comprobante que cargo Tesoreria al pagar (o null). */
  urlComprobanteMovimiento(mov: Movimiento): Promise<string | null>;
  /** Cuantos movimientos genero una plantilla de gasto fijo. */
  contarMovimientosDeGasto(gastoFijoId: string): Promise<number>;
  /** Borra la plantilla. Falla si ya genero movimientos: dejarlos huerfanos seria peor. */
  borrarGastoFijo(id: string): Promise<void>;
  /** Papeles legales y permisos (RIF, actas, Rupdae, Mintras…), más recientes primero. */
  listDocumentos(empresaClave?: string): Promise<DocumentoEmpresa[]>;
  /** Sube un PDF/imagen al bucket y lo registra con metadatos y auditoría inicial. */
  subirDocumento(empresaClave: string, tipo: TipoDocumento, file: File, meta?: Partial<DocumentoEmpresaInput>, actor?: string): Promise<DocumentoEmpresa>;
  /** Actualiza metadatos de un documento y registra un cambio en su historial ligero de auditoría. */
  editarDocumento(id: string, cambios: Partial<DocumentoEmpresaInput>, actor?: string, detalle?: string): Promise<DocumentoEmpresa>;
  /** Renueva un documento: opcionalmente sube nuevo soporte, actualiza fechas y registra el evento en auditoría. */
  renovarDocumento(id: string, file: File | null, meta: Partial<DocumentoEmpresaInput>, actor?: string, nota?: string): Promise<DocumentoEmpresa>;
  /** URL firmada (10 min) para previsualizar/descargar. */
  urlDocumento(path: string): Promise<string>;
  /** Borra el registro y luego el archivo del bucket. */
  borrarDocumento(doc: DocumentoEmpresa): Promise<void>;
}

/* ───────── Mapeo snake_case (fila de base) ↔ camelCase (dominio) ───────── */

interface RowEmpresa {
  id: string; clave: string; nombre: string; rif: string | null; moneda: string | null;
  logo_path: string | null; activa: boolean | null; orden: number | null;
}
interface RowGasto {
  id: string; empresa_clave: string; concepto: string; proveedor_id: string | null; proveedor_nombre: string | null;
  categoria_gasto_id: string | null; monto: number | string; moneda: string; tasa_ref: number | string | null;
  periodicidad: string; dia_vencimiento: number | null; vigente_desde: string; estado: string;
  centro_acopio_id?: string | null; responsable?: string | null; created_at?: string | null;
}
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function aEmpresa(r: RowEmpresa): Empresa {
  return {
    id: r.id, clave: r.clave, nombre: r.nombre, rif: r.rif ?? null,
    moneda: (r.moneda as Moneda) ?? null, logoPath: r.logo_path ?? null,
    activa: r.activa !== false, orden: r.orden ?? 0,
  };
}
function deEmpresa(e: Partial<EmpresaInput>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (e.clave !== undefined) o.clave = e.clave;
  if (e.nombre !== undefined) o.nombre = e.nombre;
  if (e.rif !== undefined) o.rif = e.rif;
  if (e.moneda !== undefined) o.moneda = e.moneda;
  if (e.logoPath !== undefined) o.logo_path = e.logoPath;
  if (e.activa !== undefined) o.activa = e.activa;
  if (e.orden !== undefined) o.orden = e.orden;
  return o;
}
function aGasto(r: RowGasto): GastoFijo {
  return {
    id: r.id, empresaClave: r.empresa_clave, concepto: r.concepto,
    proveedorId: r.proveedor_id ?? null, proveedorNombre: r.proveedor_nombre ?? null,
    categoriaGastoId: r.categoria_gasto_id ?? null, monto: num(r.monto), moneda: r.moneda as Moneda,
    tasaRef: r.tasa_ref == null ? null : num(r.tasa_ref), periodicidad: r.periodicidad as Periodicidad,
    diaVencimiento: r.dia_vencimiento ?? null, vigenteDesde: (r.vigente_desde ?? '').slice(0, 10),
    estado: (r.estado as EstadoGastoFijo) ?? 'activo',
    centroAcopioId: r.centro_acopio_id ?? null,
    responsable: r.responsable ?? null,
    createdAt: r.created_at ?? null,
  };
}
function deGasto(g: Partial<GastoFijoInput>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (g.empresaClave !== undefined) o.empresa_clave = g.empresaClave;
  if (g.concepto !== undefined) o.concepto = g.concepto;
  if (g.proveedorId !== undefined) o.proveedor_id = g.proveedorId;
  if (g.proveedorNombre !== undefined) o.proveedor_nombre = g.proveedorNombre;
  if (g.categoriaGastoId !== undefined) o.categoria_gasto_id = g.categoriaGastoId;
  if (g.monto !== undefined) o.monto = g.monto;
  if (g.moneda !== undefined) o.moneda = g.moneda;
  if (g.tasaRef !== undefined) o.tasa_ref = g.tasaRef;
  if (g.periodicidad !== undefined) o.periodicidad = g.periodicidad;
  if (g.diaVencimiento !== undefined) o.dia_vencimiento = g.diaVencimiento;
  if (g.vigenteDesde !== undefined) o.vigente_desde = g.vigenteDesde;
  if (g.estado !== undefined) o.estado = g.estado;
  if (g.centroAcopioId !== undefined) o.centro_acopio_id = g.centroAcopioId;
  if (g.responsable !== undefined) o.responsable = g.responsable;
  return o;
}

interface RowMov {
  id: string; empresa_clave: string; gasto_fijo_id: string | null; concepto: string; proveedor_nombre: string | null;
  categoria_gasto_id: string | null; periodo: string; fecha: string; monto: number | string; moneda: string;
  tasa_ref: number | string | null; estado_pago: string; origen: string; servicio_directo_id: string | null; created_at?: string | null;
  prioridad?: string | null; aviso_dias?: number | null;
}
function aMov(r: RowMov): Movimiento {
  return {
    id: r.id, empresaClave: r.empresa_clave, gastoFijoId: r.gasto_fijo_id ?? null, concepto: r.concepto,
    proveedorNombre: r.proveedor_nombre ?? null, categoriaGastoId: r.categoria_gasto_id ?? null,
    periodo: r.periodo, fecha: (r.fecha ?? '').slice(0, 10), monto: num(r.monto), moneda: r.moneda as Moneda,
    tasaRef: r.tasa_ref == null ? null : num(r.tasa_ref), estadoPago: (r.estado_pago as EstadoPago) ?? 'pendiente',
    origen: (r.origen as OrigenMovimiento) ?? 'manual', servicioDirectoId: r.servicio_directo_id ?? null,
    prioridad: (r.prioridad as Prioridad) ?? null, avisoDias: r.aviso_dias ?? null, createdAt: r.created_at ?? null,
  };
}
function deMov(m: Partial<MovimientoInput>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (m.empresaClave !== undefined) o.empresa_clave = m.empresaClave;
  if (m.gastoFijoId !== undefined) o.gasto_fijo_id = m.gastoFijoId;
  if (m.concepto !== undefined) o.concepto = m.concepto;
  if (m.proveedorNombre !== undefined) o.proveedor_nombre = m.proveedorNombre;
  if (m.categoriaGastoId !== undefined) o.categoria_gasto_id = m.categoriaGastoId;
  if (m.periodo !== undefined) o.periodo = m.periodo;
  if (m.fecha !== undefined) o.fecha = m.fecha;
  if (m.monto !== undefined) o.monto = m.monto;
  if (m.moneda !== undefined) o.moneda = m.moneda;
  if (m.tasaRef !== undefined) o.tasa_ref = m.tasaRef;
  if (m.estadoPago !== undefined) o.estado_pago = m.estadoPago;
  if (m.origen !== undefined) o.origen = m.origen;
  if (m.servicioDirectoId !== undefined) o.servicio_directo_id = m.servicioDirectoId;
  if (m.prioridad !== undefined) o.prioridad = m.prioridad;
  if (m.avisoDias !== undefined) o.aviso_dias = m.avisoDias;
  return o;
}

interface RowCentro { id: string; empresa_clave: string; nombre: string; orden: number | null; activo: boolean | null; responsable_principal?: string | null; fase_predeterminada?: string | null; descripcion?: string | null }
function aCentro(r: RowCentro): CentroAcopio {
  return {
    id: r.id, empresaClave: r.empresa_clave, nombre: r.nombre, orden: r.orden ?? 0, activo: r.activo !== false,
    responsablePrincipal: r.responsable_principal ?? null,
    fasePredeterminada: r.fase_predeterminada ?? null,
    descripcion: r.descripcion ?? null,
  };
}
function deCentro(c: Partial<CentroAcopioInput>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (c.empresaClave !== undefined) o.empresa_clave = c.empresaClave;
  if (c.nombre !== undefined) o.nombre = c.nombre;
  if (c.orden !== undefined) o.orden = c.orden;
  if (c.activo !== undefined) o.activo = c.activo;
  if (c.responsablePrincipal !== undefined) o.responsable_principal = c.responsablePrincipal;
  if (c.fasePredeterminada !== undefined) o.fase_predeterminada = c.fasePredeterminada;
  if (c.descripcion !== undefined) o.descripcion = c.descripcion;
  return o;
}
interface RowProfesional { id: string; nombre: string; profesion: string | null; contacto: string | null; activo: boolean | null }
function aProfesional(r: RowProfesional): Profesional {
  return { id: r.id, nombre: r.nombre, profesion: r.profesion ?? null, contacto: r.contacto ?? null, activo: r.activo !== false };
}
function deProfesional(p: Partial<ProfesionalInput>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (p.nombre !== undefined) o.nombre = p.nombre;
  if (p.profesion !== undefined) o.profesion = p.profesion;
  if (p.contacto !== undefined) o.contacto = p.contacto;
  if (p.activo !== undefined) o.activo = p.activo;
  return o;
}
interface RowCarpeta { id: string; empresa_clave: string | null; nombre: string; parent_id: string | null; orden: number | null }
function aCarpeta(r: RowCarpeta): Carpeta {
  return { id: r.id, empresaClave: r.empresa_clave ?? null, nombre: r.nombre, parentId: r.parent_id ?? null, orden: r.orden ?? 0 };
}
function deCarpeta(c: Partial<CarpetaInput>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (c.empresaClave !== undefined) o.empresa_clave = c.empresaClave;
  if (c.nombre !== undefined) o.nombre = c.nombre;
  if (c.parentId !== undefined) o.parent_id = c.parentId;
  if (c.orden !== undefined) o.orden = c.orden;
  return o;
}
interface RowGestion {
  id: string; empresa_clave: string; profesional_id: string | null; categoria_id: string | null;
  centro_acopio_id: string | null; documento_id: string | null; concepto: string;
  costo_total: number | string | null; moneda: string | null; tasa_ref: number | string | null;
  fecha: string; fecha_pactada: string | null; estado: string | null; nota_acuerdo: string | null;
  prioridad?: string | null; aviso_dias?: number | null;
}
function aGestion(r: RowGestion): Gestion {
  return {
    id: r.id, empresaClave: r.empresa_clave, profesionalId: r.profesional_id ?? null,
    categoriaId: r.categoria_id ?? null, centroAcopioId: r.centro_acopio_id ?? null,
    documentoId: r.documento_id ?? null, concepto: r.concepto,
    costoTotal: r.costo_total == null ? 0 : num(r.costo_total),
    moneda: r.moneda === 'Bs' ? 'Bs' : 'USD',
    tasaRef: r.tasa_ref == null ? null : num(r.tasa_ref),
    fecha: r.fecha ? r.fecha.slice(0, 10) : r.fecha,
    fechaPactada: r.fecha_pactada ? r.fecha_pactada.slice(0, 10) : null,
    estado: (r.estado as EstadoGestion) || 'abierta',
    notaAcuerdo: r.nota_acuerdo ?? null,
    prioridad: (r.prioridad as Prioridad) ?? null,
    avisoDias: r.aviso_dias ?? null,
  };
}
function deGestion(g: Partial<GestionInput>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (g.empresaClave !== undefined) o.empresa_clave = g.empresaClave;
  if (g.profesionalId !== undefined) o.profesional_id = g.profesionalId;
  if (g.categoriaId !== undefined) o.categoria_id = g.categoriaId;
  if (g.centroAcopioId !== undefined) o.centro_acopio_id = g.centroAcopioId;
  if (g.documentoId !== undefined) o.documento_id = g.documentoId;
  if (g.concepto !== undefined) o.concepto = g.concepto;
  if (g.costoTotal !== undefined) o.costo_total = g.costoTotal;
  if (g.moneda !== undefined) o.moneda = g.moneda;
  if (g.tasaRef !== undefined) o.tasa_ref = g.tasaRef;
  if (g.fecha !== undefined) o.fecha = g.fecha;
  if (g.fechaPactada !== undefined) o.fecha_pactada = g.fechaPactada;
  if (g.estado !== undefined) o.estado = g.estado;
  if (g.notaAcuerdo !== undefined) o.nota_acuerdo = g.notaAcuerdo;
  if (g.prioridad !== undefined) o.prioridad = g.prioridad;
  if (g.avisoDias !== undefined) o.aviso_dias = g.avisoDias;
  return o;
}
interface RowEnvio {
  id: string; gestion_id: string; empresa_clave: string; monto: number | string | null;
  moneda: string | null; fecha_envio: string; estado: string | null;
  servicio_directo_id: string | null; enviado_por: string | null; pagado_en: string | null;
}
function aEnvio(r: RowEnvio): EnvioTesoreria {
  return {
    id: r.id, gestionId: r.gestion_id, empresaClave: r.empresa_clave,
    monto: r.monto == null ? 0 : num(r.monto), moneda: r.moneda === 'Bs' ? 'Bs' : 'USD',
    fechaEnvio: r.fecha_envio, estado: (r.estado as EnvioTesoreria['estado']) || 'enviado',
    servicioDirectoId: r.servicio_directo_id ?? null, enviadoPor: r.enviado_por ?? null,
    pagadoEn: r.pagado_en ?? null,
  };
}
interface RowResp { id: string; empresa_clave: string; usuario_email: string; objetivo_tipo: string; objetivo_id: string }
function aResp(r: RowResp): Responsabilidad {
  return { id: r.id, empresaClave: r.empresa_clave, usuarioEmail: r.usuario_email, objetivoTipo: r.objetivo_tipo as ObjetivoResp, objetivoId: r.objetivo_id };
}
function deResp(x: ResponsabilidadInput): Record<string, unknown> {
  return { empresa_clave: x.empresaClave, usuario_email: x.usuarioEmail, objetivo_tipo: x.objetivoTipo, objetivo_id: x.objetivoId };
}
interface RowAviso { id: string; empresa_clave: string; tipo: string; origen: string; origen_id: string; responsable_email: string | null; fecha: string | null; texto: string; leido: boolean | null }
function aAviso(r: RowAviso): Aviso {
  return {
    id: r.id, empresaClave: r.empresa_clave, tipo: r.tipo as TipoAviso, origen: r.origen as Aviso['origen'],
    origenId: r.origen_id, responsableEmail: r.responsable_email ?? null,
    fecha: r.fecha ? r.fecha.slice(0, 10) : null, texto: r.texto, leido: r.leido === true,
  };
}
function deAviso(a: AvisoInput): Record<string, unknown> {
  return {
    empresa_clave: a.empresaClave, tipo: a.tipo, origen: a.origen, origen_id: a.origenId,
    responsable_email: a.responsableEmail, fecha: a.fecha, texto: a.texto,
  };
}
const T_CEN = 'admin_centros_acopio';
const T_PROF = 'admin_profesionales';
const T_CARP = 'admin_carpetas';
const T_GES = 'admin_gestiones';
const T_ENV = 'admin_envios_tesoreria';
interface RowCReq { id: string; empresa_clave: string; centro_id: string; tipo_documento: string }
function aCReq(r: RowCReq): CentroRequerido {
  return { id: r.id, empresaClave: r.empresa_clave, centroId: r.centro_id, tipoDocumento: r.tipo_documento as TipoDocumento };
}
function deCReq(x: CentroRequeridoInput): Record<string, unknown> {
  return { empresa_clave: x.empresaClave, centro_id: x.centroId, tipo_documento: x.tipoDocumento };
}
const T_RESP = 'admin_responsabilidades';
const T_AVISO = 'admin_avisos';
const T_CREQ = 'admin_centro_requeridos';
const T_EMP = 'admin_empresas';
/**
 * ¿El guardado se cayó porque a la base le falta una columna?
 *
 * Importa distinguirlo porque ANTES se reintentaba EN SILENCIO con media fila
 * (12/11/2026). Al subir un documento se perdían carpeta, vencimiento, estado,
 * responsable y socio; al editarlo, todo salvo el nombre y el tipo. La pantalla
 * decía «guardado» y la configuración no estaba en ninguna parte.
 */
function esColumnaQueFalta(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'PGRST204' || /column.*does not exist/i.test(error.message ?? '');
}

/** El aviso, en palabras de quien lo va a leer y diciendo qué hacer. */
function errorColumnaQueFalta(error: { message?: string } | null, que: string): Error {
  const col = /column\s+"?([a-zA-Z_.]+)"?/.exec(error?.message ?? '')?.[1];
  return new Error(
    `No se guardó ${que} porque a la base le falta la columna «${col ?? 'desconocida'}». ` +
    'No se guardó nada a medias. Avisa a quien administre la base: hay un archivo .sql pendiente de aplicar.',
  );
}

const T_GF = 'admin_gastos_fijos';
/** Donde viven los factores FAOV ajustables (tabla `config`, llave/valor). */
const CLAVE_FAOV = 'admin.parafiscales.faov';
const T_MOV = 'admin_gasto_fijo_movimientos';
const T_DOC = 'admin_empresa_documentos';
const T_CAT = 'admin_categorias';
const BUCKET_DOCS = 'admin-documentos';

interface RowDoc {
  id: string;
  empresa_clave: string;
  tipo: string;
  nombre: string;
  path: string;
  content_type: string | null;
  tamano: number | string | null;
  carpeta?: string | null;
  centro_acopio_id?: string | null;
  responsable?: string | null;
  fecha_vencimiento?: string | null;
  fecha_emision?: string | null;
  status_vencimiento?: string | null;
  socio_nombre?: string | null;
  entidad_emisora?: string | null;
  numero_registro?: string | null;
  nota_tramite?: string | null;
  historial?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
  costo_gestion?: number | string | null;
  moneda_costo?: string | null;
  gestion_id?: string | null;
  aviso_dias?: number | null;
  subcarpeta_id?: string | null;
  badge_texto?: string | null;
  prioridad?: string | null;
}

function aDoc(r: RowDoc): DocumentoEmpresa {
  const fVenc = r.fecha_vencimiento ? r.fecha_vencimiento.slice(0, 10) : null;
  const statusRaw = (r.status_vencimiento as StatusVencimiento) || undefined;
  const status = calcularStatusVencimiento(fVenc, statusRaw);

  let hist: HistorialCambioDoc[] = [];
  if (Array.isArray(r.historial)) {
    hist = r.historial as HistorialCambioDoc[];
  } else if (typeof r.historial === 'string') {
    try { hist = JSON.parse(r.historial); } catch { hist = []; }
  }

  return {
    id: r.id,
    empresaClave: r.empresa_clave,
    carpeta: r.carpeta || 'otros',
    centroAcopioId: r.centro_acopio_id ?? null,
    responsable: r.responsable ?? null,
    tipo: (r.tipo as TipoDocumento) || 'otro',
    nombre: r.nombre,
    path: r.path,
    contentType: r.content_type ?? null,
    tamano: r.tamano == null ? null : num(r.tamano),
    fechaEmision: r.fecha_emision ? r.fecha_emision.slice(0, 10) : null,
    fechaVencimiento: fVenc,
    statusVencimiento: status,
    socioNombre: r.socio_nombre ?? null,
    entidadEmisora: r.entidad_emisora ?? null,
    numeroRegistro: r.numero_registro ?? null,
    notaTramite: r.nota_tramite ?? null,
    historial: hist,
    createdAt: r.created_at ?? null,
    updatedAt: r.updated_at ?? null,
    costoGestion: r.costo_gestion == null ? null : num(r.costo_gestion),
    monedaCosto: r.moneda_costo === 'Bs' ? 'Bs' : r.moneda_costo === 'USD' ? 'USD' : null,
    gestionId: r.gestion_id ?? null,
    avisoDias: r.aviso_dias ?? null,
    subcarpetaId: r.subcarpeta_id ?? null,
    badgeTexto: r.badge_texto ?? null,
    prioridad: (r.prioridad as Prioridad) ?? null,
  };
}
interface RowCat { id: string; nombre: string; orden: number | string | null; activa: boolean | null; }
function aCategoria(r: RowCat): AdminCategoria {
  return { id: r.id, nombre: r.nombre, orden: r.orden == null ? 0 : num(r.orden), activa: r.activa !== false };
}
/** Ruta única del archivo en el bucket: <empresa>/<stamp>-<nombre saneado>. */
function rutaDoc(empresaClave: string, nombre: string): string {
  const stamp = `${Math.floor(performance.now()).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const safe = nombre.replace(/[^\w.-]+/g, '_').slice(-80);
  return `${empresaClave}/${stamp}-${safe}`;
}

/** Resuelve el nombre o email real del usuario autenticado para la bitácora de auditoría */
async function obtenerActorActual(actorPropuesto?: string): Promise<string> {
  if (actorPropuesto && actorPropuesto.trim() && actorPropuesto.trim().toLowerCase() !== 'usuario') {
    return actorPropuesto.trim();
  }
  try {
    const { data } = await supabase.auth.getUser();
    if (data?.user) {
      const meta = data.user.user_metadata as Record<string, unknown> | undefined;
      const nombreCompleto = [meta?.nombre, meta?.apellido].filter(Boolean).join(' ') || (meta?.full_name as string) || (meta?.name as string);
      if (nombreCompleto && nombreCompleto.trim()) return nombreCompleto.trim();
      if (data.user.email) return data.user.email;
    }
  } catch { /* ignore */ }
  return actorPropuesto?.trim() || 'Administrador';
}

/** Impl contra Supabase (la app real). Las tablas las crea BD (SQL en borrador). */
export function crearRepoSupabase(): AdminRepo {
  return {
    async listEmpresas() {
      const { data, error } = await supabase.from(T_EMP).select('*').order('orden').order('clave');
      if (error) throw error;
      return (data ?? []).map((r) => aEmpresa(r as RowEmpresa));
    },
    async crearEmpresa(e) {
      const { data, error } = await supabase.from(T_EMP).insert(deEmpresa(e)).select('*').single();
      if (error) throw error;
      return aEmpresa(data as RowEmpresa);
    },
    async editarEmpresa(id, cambios) {
      const { error } = await supabase.from(T_EMP).update(deEmpresa(cambios)).eq('id', id);
      if (error) throw error;
    },
    async contarGastosDeEmpresa(clave) {
      const { count, error } = await supabase.from(T_GF).select('id', { count: 'exact', head: true }).eq('empresa_clave', clave);
      if (error) throw error;
      return count ?? 0;
    },
    async desactivarEmpresa(id) {
      const { error } = await supabase.from(T_EMP).update({ activa: false }).eq('id', id);
      if (error) throw error;
    },
    async borrarEmpresa(id) {
      const { error } = await supabase.from(T_EMP).delete().eq('id', id);
      if (error) throw error;
    },
    async listCentros(empresaClave) {
      let q = supabase.from(T_CEN).select('*').order('orden').order('nombre');
      if (empresaClave) q = q.eq('empresa_clave', empresaClave);
      const { data, error } = await q;
      if (error) {
        if (esErrorTablaAusente(error)) return [];
        throw error;
      }
      return (data ?? []).map((r) => aCentro(r as RowCentro));
    },
    async crearCentro(c) {
      const { data, error } = await supabase.from(T_CEN).insert(deCentro(c)).select('*').single();
      if (error) throw error;
      return aCentro(data as RowCentro);
    },
    async editarCentro(id, cambios) {
      const { error } = await supabase.from(T_CEN).update(deCentro(cambios)).eq('id', id);
      if (error) throw error;
    },
    async setActivoCentro(id, activo) {
      const { error } = await supabase.from(T_CEN).update({ activo }).eq('id', id);
      if (error) throw error;
    },
    async eliminarCentro(id) {
      const { error } = await supabase.from(T_CEN).delete().eq('id', id);
      if (error) throw error;
    },
    async listProfesionales() {
      const { data, error } = await supabase.from(T_PROF).select('*').order('nombre');
      if (error) {
        if (esErrorTablaAusente(error)) return [];
        throw error;
      }
      return (data ?? []).map((r) => aProfesional(r as RowProfesional));
    },
    async crearProfesional(p) {
      const { data, error } = await supabase.from(T_PROF).insert(deProfesional(p)).select('*').single();
      if (error) throw error;
      return aProfesional(data as RowProfesional);
    },
    async editarProfesional(id, cambios) {
      const { error } = await supabase.from(T_PROF).update(deProfesional(cambios)).eq('id', id);
      if (error) throw error;
    },
    async setActivoProfesional(id, activo) {
      const { error } = await supabase.from(T_PROF).update({ activo }).eq('id', id);
      if (error) throw error;
    },
    async listCarpetas(empresaClave) {
      let q = supabase.from(T_CARP).select('*').order('orden').order('nombre');
      if (empresaClave) q = q.eq('empresa_clave', empresaClave);
      const { data, error } = await q;
      if (error) {
        if (esErrorTablaAusente(error)) return [];
        throw error;
      }
      return (data ?? []).map((r) => aCarpeta(r as RowCarpeta));
    },
    async crearCarpeta(c) {
      const { data, error } = await supabase.from(T_CARP).insert(deCarpeta(c)).select('*').single();
      if (error) throw error;
      return aCarpeta(data as RowCarpeta);
    },
    async editarCarpeta(id, cambios) {
      const { error } = await supabase.from(T_CARP).update(deCarpeta(cambios)).eq('id', id);
      if (error) throw error;
    },
    async borrarCarpeta(id) {
      const { error } = await supabase.from(T_CARP).delete().eq('id', id);
      if (error) throw error;
    },
    async listGestiones(empresaClave, profesionalId) {
      let q = supabase.from(T_GES).select('*').order('fecha', { ascending: false });
      if (empresaClave) q = q.eq('empresa_clave', empresaClave);
      if (profesionalId) q = q.eq('profesional_id', profesionalId);
      const { data, error } = await q;
      if (error) {
        if (esErrorTablaAusente(error)) return [];
        throw error;
      }
      return (data ?? []).map((r) => aGestion(r as RowGestion));
    },
    async crearGestion(g) {
      const { data, error } = await supabase.from(T_GES).insert(deGestion(g)).select('*').single();
      if (error) throw error;
      return aGestion(data as RowGestion);
    },
    async editarGestion(id, cambios) {
      const { error } = await supabase.from(T_GES).update(deGestion(cambios)).eq('id', id);
      if (error) throw error;
    },
    async anularGestion(id) {
      const { error } = await supabase.from(T_GES).update({ estado: 'anulada' }).eq('id', id);
      if (error) throw error;
    },
    async borrarGestion(id) {
      const { data: envios, error: errEnv } = await supabase.from(T_ENV).select('id, estado').eq('gestion_id', id);
      if (errEnv && !esErrorTablaAusente(errEnv)) throw errEnv;
      const hayPagados = (envios ?? []).some((e) => e.estado === 'pagado');
      if (hayPagados) {
        throw new Error('No se puede eliminar la gestión porque ya tiene pagos registrados en Tesorería. Puedes anularla en su lugar.');
      }
      try {
        await supabase.from(T_AVISO).delete().eq('origen', 'gestion').eq('origen_id', id);
      } catch { /* ignorar */ }
      const { error } = await supabase.from(T_GES).delete().eq('id', id);
      if (error) throw error;
    },
    async listEnvios(gestionId) {
      let q = supabase.from(T_ENV).select('*').order('fecha_envio', { ascending: false });
      if (gestionId) q = q.eq('gestion_id', gestionId);
      const { data, error } = await q;
      if (error) {
        if (esErrorTablaAusente(error)) return [];
        throw error;
      }
      return (data ?? []).map((r) => aEnvio(r as RowEnvio));
    },
    async crearEnvio(input) {
      const { gestion } = input;
      const monto = Math.round((Number(input.monto) || 0) * 100) / 100;
      if (monto <= 0) throw new Error('Indica el monto a enviar a Tesorería.');
      const { data: prev, error: ePrev } = await supabase.from(T_ENV).select('*').eq('gestion_id', gestion.id);
      if (ePrev && !esErrorTablaAusente(ePrev)) throw ePrev;
      const enviosActuales = (prev ?? []).map((r) => aEnvio(r as RowEnvio));
      // Tope = lo DISPONIBLE (costo − pagado − enviado-pendiente), no solo el saldo:
      // así no se compromete dos veces el mismo honorario.
      const disponible = disponibleParaEnviar(gestion, enviosActuales);
      if (monto > disponible + 0.01) throw new Error(`El envío (${monto}) supera lo disponible para enviar de la gestión (${disponible}); ya hay envíos comprometidos.`);
      const actor = input.actor ?? (await supabase.auth.getUser()).data.user?.email ?? 'sistema';
      // 1) Crea el servicio directo y lo deja "Por pagar" (flujo estándar de Tesorería).
      const nota = notaAgrupacion(input.profesionalNombre, gestion.concepto, gestion.empresaClave);
      const sd = await crearServicioDirecto({
        lineas: [{ descripcion: nota, cantidad: 1 }],
        moneda: gestion.moneda, actor, actorName: input.actorName ?? null,
      });
      await enviarServicioAPagar({
        servicio: sd, items: [{ descripcion: nota, cantidad: 1, gasto: monto }],
        moneda: gestion.moneda, actor, actorName: input.actorName ?? null,
      });
      // 2) Registra el envío enlazado al servicio directo. Si este insert falla, el
      //    servicio directo quedaría HUÉRFANO en Tesorería (cuenta por pagar que admin
      //    no ve). Puente no atómico: compensamos borrando el SD (está 'por_pagar',
      //    pasa las guardas) antes de propagar el error.
      const { data, error } = await supabase.from(T_ENV).insert({
        gestion_id: gestion.id, empresa_clave: gestion.empresaClave, monto, moneda: gestion.moneda,
        estado: 'enviado', servicio_directo_id: sd.id, enviado_por: actor,
      }).select('*').single();
      if (error) {
        try { await eliminarServicioDirecto(sd); } catch { /* best-effort: si no se pudo, queda la deuda conocida */ }
        throw error;
      }
      return aEnvio(data as RowEnvio);
    },
    async reversarEnvio(id) {
      const { data, error } = await supabase.from(T_ENV).select('*').eq('id', id).single();
      if (error) throw error;
      const envio = aEnvio(data as RowEnvio);
      // Estado AUTORITATIVO: relee el servicio directo (el estado del envío puede estar
      // viejo si Tesorería ya pagó y aún no se refrescó).
      type SdLite = { id: string; estado?: string | null; pagada_at?: string | null };
      let servicio: SdLite | null = null;
      if (envio.servicioDirectoId) {
        const { data: sd } = await supabase.from('servicios_directos')
          .select('id,estado,pagada_at').eq('id', envio.servicioDirectoId).maybeSingle();
        servicio = (sd as SdLite | null) ?? null;
      }
      const servicioPagado = !!servicio && (servicio.estado === 'finalizada' || !!servicio.pagada_at);
      const motivo = motivoNoReversable(envio, servicioPagado);
      if (motivo) {
        // Si en realidad ya estaba pagado, reconcilia el envío para que deje de verse como 'enviado'.
        if (servicioPagado && envio.estado !== 'pagado') {
          await supabase.from(T_ENV).update({ estado: 'pagado', pagado_en: servicio?.pagada_at ?? new Date().toISOString() }).eq('id', id);
        }
        throw new Error(motivo);
      }
      // No pagado: borra el servicio directo vía eliminarServicioDirecto (aplica la guarda
      // de factura registrada y mapea el error de borrado), no con un delete crudo. Nota:
      // la guarda de "pagado" de esa función usa el estado que acabamos de leer (líneas
      // arriba); queda una ventana TOCTOU mínima (sin await que ceda a Tesorería) que este
      // módulo no cierra —es el mismo patrón del resto del flujo de servicios directos.
      if (servicio) {
        await eliminarServicioDirecto(servicio as unknown as ServicioDirecto);
      }
      const { error: eUpd } = await supabase.from(T_ENV).update({ estado: 'reversado' }).eq('id', id);
      if (eUpd) throw eUpd;
    },
    async refrescarEnvios(gestionId) {
      let q = supabase.from(T_ENV).select('*').eq('estado', 'enviado');
      if (gestionId) q = q.eq('gestion_id', gestionId);
      const { data, error } = await q;
      if (error) { if (esErrorTablaAusente(error)) return; throw error; }
      for (const row of (data ?? [])) {
        const envio = aEnvio(row as RowEnvio);
        if (!envio.servicioDirectoId) continue;
        const { data: sd } = await supabase.from('servicios_directos')
          .select('estado,pagada_at').eq('id', envio.servicioDirectoId).maybeSingle();
        const s = sd as { estado?: string; pagada_at?: string | null } | null;
        if (s && (s.estado === 'finalizada' || s.pagada_at)) {
          await supabase.from(T_ENV).update({ estado: 'pagado', pagado_en: s.pagada_at ?? new Date().toISOString() }).eq('id', envio.id);
        }
      }
    },
    async urlAdjuntoEnvio(envio) {
      if (!envio.servicioDirectoId) return null;
      const { data, error } = await supabase.from('servicios_directos')
        .select('adjunto_path').eq('id', envio.servicioDirectoId).maybeSingle();
      if (error) return null;
      const path = (data as { adjunto_path?: string | null } | null)?.adjunto_path ?? null;
      return path ? urlAdjuntoServicio(path) : null;
    },
    async listResponsabilidades(empresaClave) {
      let q = supabase.from(T_RESP).select('*');
      if (empresaClave) q = q.eq('empresa_clave', empresaClave);
      const { data, error } = await q;
      if (error) {
        if (esErrorTablaAusente(error)) return [];
        throw error;
      }
      return (data ?? []).map((r) => aResp(r as RowResp));
    },
    async asignarResponsabilidad(input) {
      // Idempotente contra el único (usuario_email, objetivo_tipo, objetivo_id).
      const { data, error } = await supabase.from(T_RESP)
        .upsert(deResp(input), { onConflict: 'usuario_email,objetivo_tipo,objetivo_id' })
        .select('*').single();
      if (error) throw error;
      return aResp(data as RowResp);
    },
    async quitarResponsabilidad(id) {
      const { error } = await supabase.from(T_RESP).delete().eq('id', id);
      if (error) throw error;
    },
    async listAvisos(empresaClave) {
      let q = supabase.from(T_AVISO).select('*').order('created_at', { ascending: false });
      if (empresaClave) q = q.eq('empresa_clave', empresaClave);
      const { data, error } = await q;
      if (error) {
        if (esErrorTablaAusente(error)) return [];
        throw error;
      }
      return (data ?? []).map((r) => aAviso(r as RowAviso));
    },
    async crearAviso(a) {
      const { data, error } = await supabase.from(T_AVISO).insert(deAviso(a)).select('*').single();
      if (error) throw error;
      return aAviso(data as RowAviso);
    },
    async marcarAvisoLeido(id, leido) {
      const { error } = await supabase.from(T_AVISO).update({ leido }).eq('id', id);
      if (error) throw error;
    },
    async borrarAviso(id) {
      const { error } = await supabase.from(T_AVISO).delete().eq('id', id);
      if (error) throw error;
    },
    async listCentroRequeridos(empresaClave) {
      let q = supabase.from(T_CREQ).select('*');
      if (empresaClave) q = q.eq('empresa_clave', empresaClave);
      const { data, error } = await q;
      if (error) {
        if (esErrorTablaAusente(error)) return [];
        throw error;
      }
      return (data ?? []).map((r) => aCReq(r as RowCReq));
    },
    async agregarCentroRequerido(input) {
      const { data, error } = await supabase.from(T_CREQ)
        .upsert(deCReq(input), { onConflict: 'centro_id,tipo_documento' })
        .select('*').single();
      if (error) throw error;
      return aCReq(data as RowCReq);
    },
    async quitarCentroRequerido(id) {
      const { error } = await supabase.from(T_CREQ).delete().eq('id', id);
      if (error) throw error;
    },
    async leerFactoresFaov() {
      const { data, error } = await supabase.from('config').select('value').eq('key', CLAVE_FAOV).maybeSingle();
      if (error) return FAOV_TIERS;
      const v = (data as { value?: unknown } | null)?.value;
      return factoresValidos(v) ? v : FAOV_TIERS;
    },
    async guardarFactoresFaov(tiers, actor) {
      if (!factoresValidos(tiers)) throw new Error('Los factores no sirven: hacen falta los tres tramos y todos mayores que cero.');
      const quien = actor || (await supabase.auth.getUser()).data.user?.email || 'sistema';
      const { error } = await supabase.from('config').upsert(
        { key: CLAVE_FAOV, value: tiers, updated_by: quien, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      );
      if (error) throw error;
    },
    async listGastosFijos(empresaClave) {
      let q = supabase.from(T_GF).select('*').order('concepto');
      if (empresaClave) q = q.eq('empresa_clave', empresaClave);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => aGasto(r as RowGasto));
    },
    async crearGastoFijo(g) {
      const payload = deGasto(g);
      const { data, error } = await supabase.from(T_GF).insert(payload).select('*').single();
      if (esColumnaQueFalta(error)) throw errorColumnaQueFalta(error, 'el gasto fijo');
      if (error) throw error;
      return aGasto(data as RowGasto);
    },
    async editarGastoFijo(id, cambios) {
      const payload = deGasto(cambios);
      const { error } = await supabase.from(T_GF).update(payload).eq('id', id);
      if (esColumnaQueFalta(error)) throw errorColumnaQueFalta(error, 'el gasto fijo');
      if (error) throw error;
    },
    async setEstadoGastoFijo(id, estado) {
      const { error } = await supabase.from(T_GF).update({ estado }).eq('id', id);
      if (error) throw error;
    },
    async listCategorias() {
      // Lista PROPIA del módulo. Si la base aún no tiene admin_categorias (04 sin aplicar),
      // cae al catálogo compartido pero solo categorías padre, para no romper mientras tanto.
      const { data, error } = await supabase.from(T_CAT).select('id,nombre').eq('activa', true).order('orden').order('nombre');
      if (!error) return (data ?? []).map((r) => ({ id: String((r as { id: string }).id), nombre: String((r as { nombre: string }).nombre) }));
      if (esErrorTablaAusente(error)) {
        const rows = await listCategoriasGasto(true);
        return soloCategorias(rows).map((c) => ({ id: c.id, nombre: c.nombre }));
      }
      throw error;
    },
    async listAdminCategorias() {
      const { data, error } = await supabase.from(T_CAT).select('*').order('orden').order('nombre');
      if (error) {
        if (esErrorTablaAusente(error)) return [];
        throw error;
      }
      return (data ?? []).map((r) => aCategoria(r as RowCat));
    },
    async crearAdminCategoria(nombre) {
      const n = nombre.trim();
      if (!n) throw new Error('El nombre de la categoría es obligatorio.');
      const { data, error } = await supabase.from(T_CAT).insert({ nombre: n }).select('*').single();
      if (error) throw error;
      return aCategoria(data as RowCat);
    },
    async renombrarAdminCategoria(id, nombre) {
      const n = nombre.trim();
      if (!n) throw new Error('El nombre de la categoría es obligatorio.');
      const { error } = await supabase.from(T_CAT).update({ nombre: n }).eq('id', id);
      if (error) throw error;
    },
    async setActivaAdminCategoria(id, activa) {
      const { error } = await supabase.from(T_CAT).update({ activa }).eq('id', id);
      if (error) throw error;
    },
    async listProveedores() {
      const ps = await listProveedoresActivos();
      return ps.map((p) => ({ id: p.id, nombre: p.razon_social }));
    },
    async listMovimientos(empresaClave) {
      let q = supabase.from(T_MOV).select('*').order('fecha', { ascending: false });
      if (empresaClave) q = q.eq('empresa_clave', empresaClave);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => aMov(r as RowMov));
    },
    async crearMovimiento(m) {
      const { data, error } = await supabase.from(T_MOV).insert(deMov(m)).select('*').single();
      if (error) throw error;
      return aMov(data as RowMov);
    },
    async editarMovimiento(id, cambios) {
      const { error } = await supabase.from(T_MOV).update(deMov(cambios)).eq('id', id);
      if (error) throw error;
    },
    async anularMovimiento(id) {
      // 1. Obtener datos del movimiento para desvincular Tesorería si aplica
      const { data: movPre } = await supabase.from(T_MOV).select('*').eq('id', id).maybeSingle();

      const { error } = await supabase.from(T_MOV).update({ estado_pago: 'anulado' }).eq('id', id);
      if (error) throw error;

      // 2. Si tenía servicio directo asociado en Tesorería, eliminarlo para que no siga en pendientes por pagar
      if (movPre?.servicio_directo_id) {
        try {
          await supabase.from('servicios_directos').delete().eq('id', movPre.servicio_directo_id);
        } catch { /* ignorar si ya no existe */ }
      } else if (movPre?.empresa_clave && movPre?.periodo) {
        const notaClave = `Gasto fijo · ${movPre.empresa_clave} · ${movPre.periodo}`;
        try {
          await supabase.from('servicios_directos').delete()
            .eq('empresa_clave', movPre.empresa_clave)
            .eq('estado', 'por_pagar')
            .ilike('nota', `%${notaClave}%`);
        } catch { /* ignorar */ }
      }
    },
    async borrarMovimiento(id) {
      const { data: movPre } = await supabase.from(T_MOV).select('*').eq('id', id).maybeSingle();
      if (movPre?.servicio_directo_id) {
        try {
          await supabase.from('servicios_directos').delete().eq('id', movPre.servicio_directo_id);
        } catch { /* ignorar si ya no existe */ }
      }
      try {
        await supabase.from(T_AVISO).delete().eq('origen', 'gasto').eq('origen_id', id);
      } catch { /* ignorar */ }
      const { error } = await supabase.from(T_MOV).delete().eq('id', id);
      if (error) throw error;
    },
    async generarPendientes(empresaClave, hasta = new Date()) {
      let qg = supabase.from(T_GF).select('*');
      if (empresaClave) qg = qg.eq('empresa_clave', empresaClave);
      const { data: gRows, error: ge } = await qg;
      if (ge) throw ge;
      const gastos = (gRows ?? []).map((r) => aGasto(r as RowGasto));
      let qm = supabase.from(T_MOV).select('gasto_fijo_id, periodo').not('gasto_fijo_id', 'is', null);
      if (empresaClave) qm = qm.eq('empresa_clave', empresaClave);
      const { data: mRows, error: me } = await qm;
      if (me) throw me;
      const existentes = (mRows ?? []).map((r) => ({ gastoFijoId: (r as { gasto_fijo_id: string }).gasto_fijo_id, periodo: (r as { periodo: string }).periodo }));
      const nuevos = calcularPendientes(gastos, existentes, hasta);
      if (!nuevos.length) return { creados: 0, enTesoreria: 0 };
      const filas = nuevos.map((n) => deMov({
        empresaClave: n.empresaClave, gastoFijoId: n.gastoFijoId, concepto: n.concepto, proveedorNombre: null,
        categoriaGastoId: n.categoriaGastoId, periodo: n.periodo, fecha: n.fecha, monto: n.monto, moneda: n.moneda,
        tasaRef: null, estadoPago: 'pendiente', origen: 'generado', servicioDirectoId: null,
      }));
      const { data: insertadas, error } = await supabase.from(T_MOV).insert(filas).select('*');
      if (error) throw error;

      // ── Fase 3 (BORRADOR · requiere sql/administracion/03_servicios_directos_gasto_fijo.sql
      //    aplicado — D27 — y revisión de Principal) ──
      // Materializa cada pendiente como servicio directo «por pagar» en Tesorería, con la
      // marca empresa_clave/gasto_fijo_id, y lo enlaza de vuelta (servicio_directo_id). Así
      // Tesorería lo ve/paga con SU permiso, sin tocar las tablas admin_*. Reusa el flujo
      // estándar del sistema (crearServicioDirecto → enviarServicioAPagar).
      // Pendiente de afinar antes de activar: rendimiento (hoy ~3-4 llamadas por pendiente),
      // reintento de los que fallen la materialización, y que la nota use el nombre de la
      // empresa (no la clave). Mientras la columna no exista, el `update` del marcador es un
      // no-op silencioso y los pendientes quedan igualmente creados.
      let enTesoreria = 0;
      try {
        const { data: auth } = await supabase.auth.getUser();
        const actor = auth.user?.email ?? 'sistema';
        const gastoPorId = new Map(gastos.map((g) => [g.id, g]));
        for (const mov of (insertadas ?? []).map((r) => aMov(r as RowMov))) {
          try {
            const g = mov.gastoFijoId ? gastoPorId.get(mov.gastoFijoId) : undefined;
            const sd = await crearServicioDirecto({
              lineas: [{ descripcion: mov.concepto, cantidad: 1 }],
              proveedorNombre: g?.proveedorNombre ?? mov.proveedorNombre ?? null,
              nota: notaPendiente(mov.empresaClave, mov.periodo),
              moneda: mov.moneda, actor,
            });
            await enviarServicioAPagar({ servicio: sd, items: [{ descripcion: mov.concepto, cantidad: 1, gasto: mov.monto }], moneda: mov.moneda, actor });
            // Marca la empresa en el pendiente de Tesorería (columna aditiva de BD `02`). El
            // enlace a la plantilla va en el movimiento (gasto_fijo_id + servicio_directo_id), no aquí.
            await supabase.from('servicios_directos').update({ empresa_clave: mov.empresaClave }).eq('id', sd.id);
            await supabase.from(T_MOV).update({ servicio_directo_id: sd.id }).eq('id', mov.id);
            enTesoreria += 1;
          } catch { /* queda creado sin llegar a Tesorería; se envía desde la pantalla */ }
        }
      } catch { /* sin sesión: los pendientes quedan creados y se envían uno a uno */ }
      return { creados: nuevos.length, enTesoreria };
    },
    async enviarMovimientoATesoreria(mov, actor) {
      if (mov.servicioDirectoId) throw new Error('Este pendiente ya esta en Tesoreria.');
      if (mov.estadoPago === 'anulado') throw new Error('Un pendiente anulado no se envia.');
      const quien = actor || (await supabase.auth.getUser()).data.user?.email || 'sistema';
      const sd = await crearServicioDirecto({
        lineas: [{ descripcion: mov.concepto, cantidad: 1 }],
        proveedorNombre: mov.proveedorNombre ?? null,
        nota: notaPendiente(mov.empresaClave, mov.periodo),
        moneda: mov.moneda, actor: quien,
      });
      try {
        await enviarServicioAPagar({
          servicio: sd,
          items: [{ descripcion: mov.concepto, cantidad: 1, gasto: mov.monto }],
          moneda: mov.moneda, actor: quien,
        });
        await supabase.from('servicios_directos').update({ empresa_clave: mov.empresaClave }).eq('id', sd.id);
        const { error } = await supabase.from(T_MOV).update({ servicio_directo_id: sd.id }).eq('id', mov.id);
        if (error) throw error;
      } catch (e) {
        // Si el enlace no se pudo completar, no dejamos un servicio suelto en Tesoreria.
        await eliminarServicioDirecto(sd).catch(() => { /* queda para limpieza manual */ });
        throw e;
      }
    },
    async refrescarMovimientos(empresaClave) {
      let q = supabase.from(T_MOV).select('id, servicio_directo_id').eq('estado_pago', 'pendiente').not('servicio_directo_id', 'is', null);
      if (empresaClave) q = q.eq('empresa_clave', empresaClave);
      const { data, error } = await q;
      if (error) return;
      for (const row of (data ?? [])) {
        const r = row as { id: string; servicio_directo_id: string | null };
        if (!r.servicio_directo_id) continue;
        const { data: sd } = await supabase.from('servicios_directos')
          .select('estado,pagada_at').eq('id', r.servicio_directo_id).maybeSingle();
        const x = sd as { estado?: string; pagada_at?: string | null } | null;
        if (x && (x.estado === 'finalizada' || x.pagada_at)) {
          await supabase.from(T_MOV).update({ estado_pago: 'pagado' }).eq('id', r.id);
        }
      }
    },
    async urlComprobanteMovimiento(mov) {
      if (!mov.servicioDirectoId) return null;
      const { data, error } = await supabase.from('servicios_directos')
        .select('adjunto_path').eq('id', mov.servicioDirectoId).maybeSingle();
      if (error) return null;
      const path = (data as { adjunto_path?: string | null } | null)?.adjunto_path ?? null;
      return path ? urlAdjuntoServicio(path) : null;
    },
    async contarMovimientosDeGasto(gastoFijoId) {
      const { count, error } = await supabase.from(T_MOV)
        .select('id', { count: 'exact', head: true }).eq('gasto_fijo_id', gastoFijoId);
      if (error) return 0;
      return count ?? 0;
    },
    async borrarGastoFijo(id) {
      const usados = await this.contarMovimientosDeGasto(id);
      if (usados > 0) {
        throw new Error(`No se puede borrar: esta plantilla ya genero ${usados} movimiento(s). Suspendela para que deje de generar.`);
      }
      const { error } = await supabase.from(T_GF).delete().eq('id', id);
      if (error) throw error;
    },
    async listDocumentos(empresaClave) {
      let q = supabase.from(T_DOC).select('*').order('created_at', { ascending: false });
      if (empresaClave) q = q.eq('empresa_clave', empresaClave);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => aDoc(r as RowDoc));
    },
    async subirDocumento(empresaClave, tipo, file, meta, actor) {
      if (file.type && file.type !== 'application/pdf' && !file.type.startsWith('image/'))
        throw new Error('El documento debe ser un PDF o una imagen.');
      const path = rutaDoc(empresaClave, file.name);
      const { error: upErr } = await supabase.storage.from(BUCKET_DOCS).upload(path, file, { upsert: false, contentType: file.type || 'application/pdf' });
      if (upErr) throw upErr;

      const nowIso = new Date().toISOString();
      const actorFinal = await obtenerActorActual(actor);
      const histItem: HistorialCambioDoc = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fecha: nowIso,
        actor: actorFinal,
        accion: 'creacion',
        detalle: 'Documento subido y registrado en el sistema',
      };

      const status = calcularStatusVencimiento(meta?.fechaVencimiento, meta?.statusVencimiento);

      const filaCompleta: Record<string, unknown> = {
        empresa_clave: empresaClave,
        tipo,
        nombre: meta?.nombre || file.name,
        path,
        content_type: file.type || 'application/pdf',
        tamano: file.size,
        carpeta: meta?.carpeta || 'otros',
        centro_acopio_id: meta?.centroAcopioId || null,
        responsable: meta?.responsable || null,
        fecha_vencimiento: meta?.fechaVencimiento || null,
        fecha_emision: meta?.fechaEmision || null,
        status_vencimiento: status,
        socio_nombre: meta?.socioNombre || null,
        entidad_emisora: meta?.entidadEmisora || null,
        numero_registro: meta?.numeroRegistro || null,
        nota_tramite: meta?.notaTramite || null,
        costo_gestion: meta?.costoGestion ?? null,
        moneda_costo: meta?.monedaCosto ?? null,
        gestion_id: meta?.gestionId ?? null,
        aviso_dias: meta?.avisoDias ?? null,
        subcarpeta_id: meta?.subcarpetaId ?? null,
        badge_texto: meta?.badgeTexto ?? null,
        prioridad: meta?.prioridad ?? null,
        historial: [histItem],
        updated_at: nowIso,
      };

      let insertRes = await supabase.from(T_DOC).insert(filaCompleta).select('*').single();

      // Si la BD aún conserva el CHECK constraint legacy ('rif', 'acta_constitutiva', 'acta_modificacion', 'cedula', 'otro')
      // reintentamos automáticamente con tipo: 'otro' para que el usuario pueda cargar cualquier documento sin interrupciones
      // y luego clasificarlo o editarlo libremente («luego se les asignará lo demás»).
      if (insertRes.error && insertRes.error.message?.includes('admin_empresa_documentos_tipo_check')) {
        const filaFallback = { ...filaCompleta, tipo: 'otro' };
        insertRes = await supabase.from(T_DOC).insert(filaFallback).select('*').single();
      }

      const { data, error } = insertRes;

      // Antes, si faltaba una columna, se reintentaba con una fila mínima y el
      // documento quedaba SIN carpeta, SIN vencimiento y SIN responsable, pero
      // la pantalla decía «subido». Ahora se avisa y no se sube nada a medias.
      if (esColumnaQueFalta(error)) {
        await supabase.storage.from(BUCKET_DOCS).remove([path]).catch(() => { /* se limpia después */ });
        throw errorColumnaQueFalta(error, `«${meta?.nombre || file.name}»`);
      }

      if (error || !data) {
        await supabase.storage.from(BUCKET_DOCS).remove([path]).catch(() => { /* queda suelto; se limpia después */ });
        throw new Error(error?.message ?? `No se guardó «${file.name}»: sin permiso.`);
      }
      return aDoc(data as RowDoc);
    },
    async editarDocumento(id, cambios, actor, detalle) {
      const { data: actualRow, error: errGet } = await supabase.from(T_DOC).select('*').eq('id', id).single();
      if (errGet || !actualRow) throw new Error('No se encontró el documento a editar.');

      const doc = aDoc(actualRow as RowDoc);
      const nowIso = new Date().toISOString();
      const actorFinal = await obtenerActorActual(actor);
      const histItem: HistorialCambioDoc = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fecha: nowIso,
        actor: actorFinal,
        accion: cambios.statusVencimiento ? 'cambio_status' : cambios.fechaVencimiento ? 'renovacion' : 'modificacion',
        detalle: detalle || 'Metadatos del documento actualizados',
      };

      const nuevoHist = [...doc.historial, histItem];
      const nuevoStatus = calcularStatusVencimiento(
        cambios.fechaVencimiento !== undefined ? cambios.fechaVencimiento : doc.fechaVencimiento,
        cambios.statusVencimiento !== undefined ? cambios.statusVencimiento : doc.statusVencimiento,
      );

      const payloadCompleto: Record<string, unknown> = {
        updated_at: nowIso,
        historial: nuevoHist,
      };
      if (cambios.nombre !== undefined) payloadCompleto.nombre = cambios.nombre;
      if (cambios.tipo !== undefined) payloadCompleto.tipo = cambios.tipo;
      if (cambios.carpeta !== undefined) payloadCompleto.carpeta = cambios.carpeta;
      if (cambios.centroAcopioId !== undefined) payloadCompleto.centro_acopio_id = cambios.centroAcopioId;
      if (cambios.responsable !== undefined) payloadCompleto.responsable = cambios.responsable;
      if (cambios.fechaVencimiento !== undefined) payloadCompleto.fecha_vencimiento = cambios.fechaVencimiento;
      if (cambios.fechaEmision !== undefined) payloadCompleto.fecha_emision = cambios.fechaEmision;
      if (cambios.statusVencimiento !== undefined || cambios.fechaVencimiento !== undefined) payloadCompleto.status_vencimiento = nuevoStatus;
      if (cambios.socioNombre !== undefined) payloadCompleto.socio_nombre = cambios.socioNombre;
      if (cambios.entidadEmisora !== undefined) payloadCompleto.entidad_emisora = cambios.entidadEmisora;
      if (cambios.numeroRegistro !== undefined) payloadCompleto.numero_registro = cambios.numeroRegistro;
      if (cambios.notaTramite !== undefined) payloadCompleto.nota_tramite = cambios.notaTramite;
      if (cambios.costoGestion !== undefined) payloadCompleto.costo_gestion = cambios.costoGestion;
      if (cambios.monedaCosto !== undefined) payloadCompleto.moneda_costo = cambios.monedaCosto;
      if (cambios.gestionId !== undefined) payloadCompleto.gestion_id = cambios.gestionId;
      if (cambios.avisoDias !== undefined) payloadCompleto.aviso_dias = cambios.avisoDias;
      if (cambios.subcarpetaId !== undefined) payloadCompleto.subcarpeta_id = cambios.subcarpetaId;
      if (cambios.badgeTexto !== undefined) payloadCompleto.badge_texto = cambios.badgeTexto;
      if (cambios.prioridad !== undefined) payloadCompleto.prioridad = cambios.prioridad;

      let updateRes = await supabase.from(T_DOC).update(payloadCompleto).eq('id', id).select('*').single();

      // Si la BD aún tiene el check constraint legacy y rechaza el tipo seleccionado, degradamos a 'otro'
      if (updateRes.error && updateRes.error.message?.includes('admin_empresa_documentos_tipo_check')) {
        const payloadFallback = { ...payloadCompleto, tipo: 'otro' };
        updateRes = await supabase.from(T_DOC).update(payloadFallback).eq('id', id).select('*').single();
      }

      const { data, error } = updateRes;

      // Antes se reintentaba guardando SOLO el nombre y el tipo: por eso no se
      // podía arreglar a mano un documento al que le faltaba el vencimiento.
      if (esColumnaQueFalta(error)) throw errorColumnaQueFalta(error, 'el documento');

      if (error || !data) throw error || new Error('No se pudo actualizar el documento.');
      return aDoc(data as RowDoc);
    },
    async renovarDocumento(id, file, meta, actor, nota) {
      const { data: actualRow, error: errGet } = await supabase.from(T_DOC).select('*').eq('id', id).single();
      if (errGet || !actualRow) throw new Error('No se encontró el documento a renovar.');
      const doc = aDoc(actualRow as RowDoc);

      let nuevoPath = doc.path;
      let nuevoTamano = doc.tamano;
      let detalleHist = nota ? `Renovación registrada. ${nota}` : 'Documento renovado con nueva vigencia';

      if (file) {
        if (file.type && file.type !== 'application/pdf' && !file.type.startsWith('image/'))
          throw new Error('El documento debe ser un PDF o una imagen.');
        nuevoPath = rutaDoc(doc.empresaClave, file.name);
        nuevoTamano = file.size;
        const { error: upErr } = await supabase.storage.from(BUCKET_DOCS).upload(nuevoPath, file, { upsert: true, contentType: file.type || 'application/pdf' });
        if (upErr) throw upErr;
        detalleHist = `Renovado con nuevo archivo "${file.name}" (${(file.size / 1024).toFixed(0)} KB). ${nota || ''}`.trim();
      }

      const nowIso = new Date().toISOString();
      const actorFinal = await obtenerActorActual(actor);
      const histItem: HistorialCambioDoc = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fecha: nowIso,
        actor: actorFinal,
        accion: 'renovacion',
        detalle: detalleHist,
      };

      const nuevoHist = [...doc.historial, histItem];
      const nuevoStatus = calcularStatusVencimiento(
        meta.fechaVencimiento !== undefined ? meta.fechaVencimiento : doc.fechaVencimiento,
        meta.statusVencimiento !== undefined ? meta.statusVencimiento : doc.statusVencimiento,
      );

      const payload: Record<string, unknown> = {
        path: nuevoPath,
        tamano: nuevoTamano,
        updated_at: nowIso,
        historial: nuevoHist,
        status_vencimiento: nuevoStatus,
      };

      if (meta.nombre !== undefined) payload.nombre = meta.nombre;
      if (meta.fechaVencimiento !== undefined) payload.fecha_vencimiento = meta.fechaVencimiento;
      if (meta.fechaEmision !== undefined) payload.fecha_emision = meta.fechaEmision;
      if (meta.numeroRegistro !== undefined) payload.numero_registro = meta.numeroRegistro;
      if (meta.costoGestion !== undefined) payload.costo_gestion = meta.costoGestion;
      if (meta.monedaCosto !== undefined) payload.moneda_costo = meta.monedaCosto;
      if (meta.notaTramite !== undefined) payload.nota_tramite = meta.notaTramite;

      const { data, error } = await supabase.from(T_DOC).update(payload).eq('id', id).select('*').single();
      if (error || !data) throw error || new Error('No se pudo guardar la renovación del documento.');
      return aDoc(data as RowDoc);
    },
    async urlDocumento(path) {
      const { data, error } = await supabase.storage.from(BUCKET_DOCS).createSignedUrl(path, 60 * 10);
      if (error) throw error;
      return data.signedUrl;
    },
    async borrarDocumento(doc) {
      const { data, error } = await supabase.from(T_DOC).delete().eq('id', doc.id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('No se eliminó el documento: sin permiso, o ya no existe.');
      try {
        await supabase.from(T_AVISO).delete().eq('origen', 'documento').eq('origen_id', doc.id);
      } catch { /* ignorar */ }
      await supabase.storage.from(BUCKET_DOCS).remove([doc.path]).catch(() => { /* el registro ya no está; el archivo suelto se limpia después */ });
    },
  };
}
