/* ============================================================
   MGG · RRHH · Carga Masiva - Nómina (Moneda Nacional)
   
   Motor puro para generar el formato bancario de apertura/actualización
   masiva de cuentas nómina en moneda nacional («1-FORMATO CARGA MASIVA-
   MONEDA NACIONAL», Banco del Tesoro 0163, 44 columnas A..AR) con sus
   tablas oficiales de códigos, correlativos y rellenos con ceros/espacios.
   ============================================================ */

import type { Personal } from '@/shared/lib/types';
import { leerCuentas } from './datosBancarios';
import type { DefinicionEmpresa } from './empresa';
import { gradoMasAlto } from './fichaPersonal';
import type { FamiliarPersonal } from './personal.repository';

/* ───────────── Catálogos Oficiales del Formato Bancario ───────────── */

export const CODIGO_BANCO_DEFAULT = '0163';
export const CODIGO_INDUSTRIA_CONSTANTE = '0902'; // CUENTAS NOMINAS O PERSONAL

export const TIPOS_DOCUMENTO_BANCO = [
  { codigo: 'V', etiqueta: 'Venezolano (V)' },
  { codigo: 'E', etiqueta: 'Extranjero (E)' },
  { codigo: 'P', etiqueta: 'Pasaporte (P)' },
] as const;

export const ESTADOS_CIVILES_BANCO = [
  { codigo: '1', etiqueta: 'SOLTERO(a)' },
  { codigo: '2', etiqueta: 'CASADO(a)' },
  { codigo: '3', etiqueta: 'DIVORCIADO(a)' },
  { codigo: '4', etiqueta: 'VIUDO(a)' },
  { codigo: '5', etiqueta: 'CONCUBINO(a)' },
] as const;

export const REGIONES_BANCO = [
  { codigo: '01', etiqueta: 'REGION CAPITAL' },
  { codigo: '02', etiqueta: 'REGION CENTRAL' },
  { codigo: '03', etiqueta: 'REGION LOS LLANOS' },
  { codigo: '04', etiqueta: 'REGION CENTRO OCCIDENTAL' },
  { codigo: '05', etiqueta: 'REGION ZULIANA' },
  { codigo: '06', etiqueta: 'REGION LOS ANDES' },
  { codigo: '07', etiqueta: 'REGION NOR-ORIENTAL' },
  { codigo: '08', etiqueta: 'REGION INSULAR' },
  { codigo: '09', etiqueta: 'REGION GUAYANA' },
] as const;

export const NIVELES_EDUCACION_BANCO = [
  { codigo: '01', etiqueta: 'PRIMARIA' },
  { codigo: '02', etiqueta: 'BACHILLERATO' },
  { codigo: '03', etiqueta: 'TECNICO MEDIO' },
  { codigo: '04', etiqueta: 'TECNICO SUPERIOR' },
  { codigo: '05', etiqueta: 'UNIVERSITARIO' },
  { codigo: '06', etiqueta: 'POST GRADO' },
  { codigo: '07', etiqueta: 'DOCTORADO' },
] as const;

export const TIPOS_CONTRATO_BANCO = [
  { codigo: '1', etiqueta: '1 · FIJO' },
  { codigo: '2', etiqueta: '2 · INDEFINIDO' },
] as const;

export const TIPOS_NOMINA_BANCO = [
  { codigo: 'W', etiqueta: 'W · SEMANAL' },
  { codigo: 'B', etiqueta: 'B · QUINCENAL' },
  { codigo: 'M', etiqueta: 'M · MENSUAL' },
  { codigo: 'S', etiqueta: 'S · SEMESTRAL' },
  { codigo: 'Y', etiqueta: 'Y · ANUAL' },
] as const;

export const TIPOS_CUENTA_BANCO = [
  { codigo: 'CCVI', etiqueta: 'CCVI · CUENTA CORRIENTE VIRTUAL' },
  { codigo: 'VI01', etiqueta: 'VI01 · CUENTA NOMINA' },
] as const;

export const TIPOS_SOLICITUD_BANCO = [
  { codigo: 'I', etiqueta: 'I · INGRESO NUEVO' },
  { codigo: 'M', etiqueta: 'M · CAMBIOS' },
  { codigo: 'D', etiqueta: 'D · DESINCORPORAR' },
] as const;

export const OFICINAS_BANCARIAS = [
  { codigo: '0405', etiqueta: '0405 · PUERTO ORDAZ' },
  { codigo: '0410', etiqueta: '0410 · SANTA ELENA DE UAIREN' },
  { codigo: '0402', etiqueta: '0402 · MATURIN' },
  { codigo: '0408', etiqueta: '0408 · MATURIN CONTRIBUYENTES ESPECIALES' },
  { codigo: '0404', etiqueta: '0404 · LECHERIAS' },
  { codigo: '0403', etiqueta: '0403 · CUMANA' },
  { codigo: '0401', etiqueta: '0401 · PORLAMAR' },
  { codigo: '0406', etiqueta: '0406 · EL YAQUE' },
  { codigo: '0407', etiqueta: '0407 · GUAMACHE' },
  { codigo: '0234', etiqueta: '0234 · LOS PROCERES' },
  { codigo: '0202', etiqueta: '0202 · CCCT' },
  { codigo: '0203', etiqueta: '0203 · CHACAITO' },
  { codigo: '0204', etiqueta: '0204 · SANTA TERESA' },
  { codigo: '0205', etiqueta: '0205 · MACARACUAY' },
  { codigo: '0206', etiqueta: '0206 · LA CASTELLANA' },
  { codigo: '0208', etiqueta: '0208 · CHARALLAVE NORTE' },
  { codigo: '0209', etiqueta: '0209 · CHARALLAVE SUR' },
  { codigo: '0210', etiqueta: '0210 · CUA' },
  { codigo: '0211', etiqueta: '0211 · LA RINCONADA' },
  { codigo: '0212', etiqueta: '0212 · TAQUILLA FRANCISCO SOLANO' },
  { codigo: '0213', etiqueta: '0213 · SANTA PAULA' },
  { codigo: '0214', etiqueta: '0214 · PARAISO PLAZA' },
  { codigo: '0215', etiqueta: '0215 · VICTORIA PLAZA' },
  { codigo: '0216', etiqueta: '0216 · MINEP' },
  { codigo: '0217', etiqueta: '0217 · SAN DIEGO' },
  { codigo: '0218', etiqueta: '0218 · VALLE DE LA PASCUA' },
  { codigo: '0219', etiqueta: '0219 · CATIA LA MAR' },
  { codigo: '0220', etiqueta: '0220 · PROPATRIA' },
  { codigo: '0221', etiqueta: '0221 · LA CALIFORNIA' },
  { codigo: '0222', etiqueta: '0222 · COCHE ARAGUA' },
  { codigo: '0223', etiqueta: '0223 · GUACARA' },
  { codigo: '0224', etiqueta: '0224 · METRO VALENCIA' },
  { codigo: '0225', etiqueta: '0225 · COTIZA' },
  { codigo: '0226', etiqueta: '0226 · MARACAY CENTRO' },
  { codigo: '0227', etiqueta: '0227 · EL TAMBOR' },
  { codigo: '0228', etiqueta: '0228 · SAN FERNANDO' },
  { codigo: '0229', etiqueta: '0229 · VTV' },
  { codigo: '0230', etiqueta: '0230 · VICEPRESIDENCIA' },
  { codigo: '0231', etiqueta: '0231 · COMANDANCIA GENERAL' },
  { codigo: '0232', etiqueta: '0232 · KPMG' },
  { codigo: '0235', etiqueta: '0235 · IND' },
  { codigo: '0237', etiqueta: '0237 · KPMG ESPECIALES' },
  { codigo: '0238', etiqueta: '0238 · ACADEMIA MILITAR' },
  { codigo: '0239', etiqueta: '0239 · ACARIGUA' },
  { codigo: '0241', etiqueta: '0241 · TAQUILLA CHUAO' },
  { codigo: '0242', etiqueta: '0242 · GUATIRE CENTER' },
  { codigo: '0244', etiqueta: '0244 · TAQUILLA URDANETA' },
  { codigo: '0245', etiqueta: '0245 · TINAQUILLO' },
  { codigo: '0247', etiqueta: '0247 · TAQUILLA MARACAY' },
  { codigo: '0002', etiqueta: '0002 · MARACAIBO' },
  { codigo: '0301', etiqueta: '0301 · BARQUISIMETO' },
  { codigo: '0303', etiqueta: '0303 · MARACAIBO KIRINET' },
  { codigo: '0304', etiqueta: '0304 · BARRIO OBRERO' },
  { codigo: '0305', etiqueta: '0305 · MERIDA' },
  { codigo: '0306', etiqueta: '0306 · CORO' },
  { codigo: '0307', etiqueta: '0307 · CRP' },
  { codigo: '0308', etiqueta: '0308 · VALERA' },
  { codigo: '0309', etiqueta: '0309 · BARINAS' },
  { codigo: '0310', etiqueta: '0310 · PUNTO FIJO' },
  { codigo: '0311', etiqueta: '0311 · SAN CRISTOBAL ESPECIALES' },
  { codigo: '0312', etiqueta: '0312 · PARAGUACHON' },
  { codigo: '0601', etiqueta: '0601 · PUERTO LA GUAIRA' },
  { codigo: '0602', etiqueta: '0602 · TAQ. AEROPUERTO' },
  { codigo: '0605', etiqueta: '0605 · PLAZA MORELOS' },
  { codigo: '0606', etiqueta: '0606 · GAMMA' },
  { codigo: '0913', etiqueta: '0913 · EL ROSAL' },
] as const;

/* ───────────── Parámetros Configurables de Exportación ───────────── */

export interface ParametrosCargaMasivaNomina {
  /** Código de 4 dígitos del banco (constante 0163 en el modelo). */
  codigoBanco?: string;
  /** Número inicial del correlativo de cliente (por defecto 1 -> 0000001). */
  correlativoInicio?: number;
  /** Proporción del sueldo mensual expresada en Bs (por defecto 0.2 = 20% nómina Bs; admite 0.8 o 1). */
  porcentajeSueldoBs?: number;
  /** 1 = FIJO, 2 = INDEFINIDO (por defecto '2'). */
  tipoContrato?: '1' | '2';
  /** W = SEMANAL, B = QUINCENAL, M = MENSUAL, S = SEMESTRAL, Y = ANUAL (por defecto 'B'). */
  tipoNomina?: 'W' | 'B' | 'M' | 'S' | 'Y';
  /** CCVI = CUENTA CORRIENTE VIRTUAL, VI01 = CUENTA NOMINA (por defecto 'CCVI'). */
  tipoCuenta?: 'CCVI' | 'VI01';
  /** Código de 4 dígitos de la oficina bancaria principal (por defecto '0405' Puerto Ordaz). */
  oficinaPrincipal?: string;
  /** Código de 4 dígitos de la oficina bancaria secundaria (por defecto '0405' Puerto Ordaz). */
  oficinaSecundaria?: string;
  /** I = INGRESO NUEVO, M = CAMBIOS, D = DESINCORPORAR (por defecto 'I'). */
  tipoSolicitud?: 'I' | 'M' | 'D';
  /** Valores geográficos por defecto para fichas sin localidad explícita (Guayana / Puerto Ordaz). */
  regionDefault?: string;
  estadoDefault?: string;
  ciudadDefault?: string;
  municipioDefault?: string;
  parroquiaDefault?: string;
  zonaPostalDefault?: string;
}

export const PARAMETROS_CARGA_MASIVA_DEFAULT: Required<ParametrosCargaMasivaNomina> = {
  codigoBanco: CODIGO_BANCO_DEFAULT,
  correlativoInicio: 1,
  porcentajeSueldoBs: 0.2,
  tipoContrato: '2',
  tipoNomina: 'B',
  tipoCuenta: 'CCVI',
  oficinaPrincipal: '0405',
  oficinaSecundaria: '0405',
  tipoSolicitud: 'I',
  regionDefault: '09',
  estadoDefault: '07',
  ciudadDefault: '0701',
  municipioDefault: '0701',
  parroquiaDefault: '070106',
  zonaPostalDefault: '0000008050',
};

/* ───────────── Definición Exacta de las 44 Columnas (A..AR) ───────────── */

export interface DefinicionColumnaCargaMasiva {
  numero: number;
  letraExcel: string;
  clave: keyof CamposCargaMasivaFila;
  /** Encabezado idéntico a la fila 1 de la hoja MODELO del banco. */
  cabeceraModelo: string;
  /** Etiqueta clara para UI / checks / PDF. */
  etiqueta: string;
  /** Ancho exacto `wch` de la hoja MODELO (usado en Excel y en el TXT de ancho fijo). */
  anchoModelo: number;
  alineacion: 'left' | 'right' | 'center';
}

export interface CamposCargaMasivaFila {
  cm_01_banco: string;
  cm_02_correlativo: string;
  cm_03_tipo_doc: string;
  cm_04_cedula: string;
  cm_05_primer_apellido: string;
  cm_06_segundo_apellido: string;
  cm_07_primer_nombre: string;
  cm_08_segundo_nombre: string;
  cm_09_fecha_nacimiento: string;
  cm_10_pais_nacimiento: string;
  cm_11_nacionalidad: string;
  cm_12_sexo: string;
  cm_13_estado_civil: string;
  cm_14_dependientes: string;
  cm_15_calle_avenida: string;
  cm_16_casa_edificio: string;
  cm_17_piso_nivel: string;
  cm_18_apto_local: string;
  cm_19_referencia: string;
  cm_20_region: string;
  cm_21_estado: string;
  cm_22_ciudad: string;
  cm_23_municipio: string;
  cm_24_parroquia: string;
  cm_25_zona_postal: string;
  cm_26_tlf_local: string;
  cm_27_tlf_celular: string;
  cm_28_condicion_inmueble: string;
  cm_29_tipo_vivienda: string;
  cm_30_correo: string;
  cm_31_tiempo_residencia: string;
  cm_32_nivel_educacion: string;
  cm_33_profesion: string;
  cm_34_codigo_industria: string;
  cm_35_fuente_ingreso: string;
  cm_36_tipo_contrato: string;
  cm_37_tipo_nomina: string;
  cm_38_tipo_cuenta: string;
  cm_39_sueldo_basico: string;
  cm_40_fecha_ingreso: string;
  cm_41_tipo_cargo: string;
  cm_42_oficina_principal: string;
  cm_43_oficina_secundaria: string;
  cm_44_constante_solicitud: string;
}

export const COLUMNAS_CARGA_MASIVA_NOMINA: DefinicionColumnaCargaMasiva[] = [
  { numero: 1, letraExcel: 'A', clave: 'cm_01_banco', cabeceraModelo: 'NUMERO BANCO (NO MODIFICAR)', etiqueta: '01 · N° Banco', anchoModelo: 4, alineacion: 'center' },
  { numero: 2, letraExcel: 'B', clave: 'cm_02_correlativo', cabeceraModelo: 'CORRELATIVO CLIENTE', etiqueta: '02 · Correlativo Cliente', anchoModelo: 7, alineacion: 'center' },
  { numero: 3, letraExcel: 'C', clave: 'cm_03_tipo_doc', cabeceraModelo: 'NACIONALIDAD', etiqueta: '03 · Tipo Doc. (V/E/P)', anchoModelo: 1, alineacion: 'center' },
  { numero: 4, letraExcel: 'D', clave: 'cm_04_cedula', cabeceraModelo: 'NUEMRO DE CEDULA (COMPLETAR CON CEROS A LA IZQ)', etiqueta: '04 · N° Cédula (15 díg.)', anchoModelo: 15, alineacion: 'center' },
  { numero: 5, letraExcel: 'E', clave: 'cm_05_primer_apellido', cabeceraModelo: 'PRIMER APELLIDO', etiqueta: '05 · Primer Apellido', anchoModelo: 30, alineacion: 'left' },
  { numero: 6, letraExcel: 'F', clave: 'cm_06_segundo_apellido', cabeceraModelo: 'SEGUNDO APELLIDO', etiqueta: '06 · Segundo Apellido', anchoModelo: 30, alineacion: 'left' },
  { numero: 7, letraExcel: 'G', clave: 'cm_07_primer_nombre', cabeceraModelo: 'PRIMER NOMBRE', etiqueta: '07 · Primer Nombre', anchoModelo: 20, alineacion: 'left' },
  { numero: 8, letraExcel: 'H', clave: 'cm_08_segundo_nombre', cabeceraModelo: 'SEGUNDO NOMBRE', etiqueta: '08 · Segundo Nombre', anchoModelo: 20, alineacion: 'left' },
  { numero: 9, letraExcel: 'I', clave: 'cm_09_fecha_nacimiento', cabeceraModelo: 'FECHA DE NACIMIENTO', etiqueta: '09 · Fecha Nacimiento (DDMMAAAA)', anchoModelo: 8, alineacion: 'center' },
  { numero: 10, letraExcel: 'J', clave: 'cm_10_pais_nacimiento', cabeceraModelo: 'PAIS DE NACIMIENTO', etiqueta: '10 · País Nacimiento', anchoModelo: 20, alineacion: 'center' },
  { numero: 11, letraExcel: 'K', clave: 'cm_11_nacionalidad', cabeceraModelo: 'NACIONALIDAD', etiqueta: '11 · Nacionalidad (ISO)', anchoModelo: 20, alineacion: 'center' },
  { numero: 12, letraExcel: 'L', clave: 'cm_12_sexo', cabeceraModelo: 'SEXO', etiqueta: '12 · Sexo (M/F)', anchoModelo: 1, alineacion: 'center' },
  { numero: 13, letraExcel: 'M', clave: 'cm_13_estado_civil', cabeceraModelo: 'ESTADO CIVIL', etiqueta: '13 · Cód. Edo. Civil', anchoModelo: 1, alineacion: 'center' },
  { numero: 14, letraExcel: 'N', clave: 'cm_14_dependientes', cabeceraModelo: 'DEPENDIENTES', etiqueta: '14 · Dependientes', anchoModelo: 2, alineacion: 'center' },
  { numero: 15, letraExcel: 'O', clave: 'cm_15_calle_avenida', cabeceraModelo: 'CALLE / AVENIDA', etiqueta: '15 · Calle / Avenida', anchoModelo: 35, alineacion: 'left' },
  { numero: 16, letraExcel: 'P', clave: 'cm_16_casa_edificio', cabeceraModelo: 'CASA / EDIFICIO', etiqueta: '16 · Casa / Edificio', anchoModelo: 15, alineacion: 'left' },
  { numero: 17, letraExcel: 'Q', clave: 'cm_17_piso_nivel', cabeceraModelo: 'PISO / NIVEL', etiqueta: '17 · Piso / Nivel', anchoModelo: 5, alineacion: 'center' },
  { numero: 18, letraExcel: 'R', clave: 'cm_18_apto_local', cabeceraModelo: 'APTO / OFIC / LOCAL / DEPTO', etiqueta: '18 · Apto / Local / N°', anchoModelo: 15, alineacion: 'left' },
  { numero: 19, letraExcel: 'S', clave: 'cm_19_referencia', cabeceraModelo: 'REFERENCIA', etiqueta: '19 · Referencia', anchoModelo: 30, alineacion: 'left' },
  { numero: 20, letraExcel: 'T', clave: 'cm_20_region', cabeceraModelo: 'REGION', etiqueta: '20 · Cód. Región', anchoModelo: 4, alineacion: 'center' },
  { numero: 21, letraExcel: 'U', clave: 'cm_21_estado', cabeceraModelo: 'ESTADO', etiqueta: '21 · Cód. Estado', anchoModelo: 4, alineacion: 'center' },
  { numero: 22, letraExcel: 'V', clave: 'cm_22_ciudad', cabeceraModelo: 'CIUDAD', etiqueta: '22 · Cód. Ciudad', anchoModelo: 4, alineacion: 'center' },
  { numero: 23, letraExcel: 'W', clave: 'cm_23_municipio', cabeceraModelo: 'MUNICIPIO', etiqueta: '23 · Cód. Municipio', anchoModelo: 4, alineacion: 'center' },
  { numero: 24, letraExcel: 'X', clave: 'cm_24_parroquia', cabeceraModelo: 'PARROQUIA', etiqueta: '24 · Cód. Parroquia', anchoModelo: 6, alineacion: 'center' },
  { numero: 25, letraExcel: 'Y', clave: 'cm_25_zona_postal', cabeceraModelo: 'ZONA POSTAL', etiqueta: '25 · Zona Postal (10 díg.)', anchoModelo: 10, alineacion: 'center' },
  { numero: 26, letraExcel: 'Z', clave: 'cm_26_tlf_local', cabeceraModelo: 'TELEFONO LOCAL', etiqueta: '26 · Teléfono Local (11 díg.)', anchoModelo: 11, alineacion: 'center' },
  { numero: 27, letraExcel: 'AA', clave: 'cm_27_tlf_celular', cabeceraModelo: 'TELEFONO DE CELULAR', etiqueta: '27 · Teléfono Celular (11 díg.)', anchoModelo: 11, alineacion: 'center' },
  { numero: 28, letraExcel: 'AB', clave: 'cm_28_condicion_inmueble', cabeceraModelo: 'CONDICION DEL INMUEBLE', etiqueta: '28 · Cond. Inmueble', anchoModelo: 1, alineacion: 'center' },
  { numero: 29, letraExcel: 'AC', clave: 'cm_29_tipo_vivienda', cabeceraModelo: 'TIPODE VIVIENDA', etiqueta: '29 · Tipo Vivienda', anchoModelo: 1, alineacion: 'center' },
  { numero: 30, letraExcel: 'AD', clave: 'cm_30_correo', cabeceraModelo: 'CORREO ELECTRONICO', etiqueta: '30 · Correo Electrónico', anchoModelo: 40, alineacion: 'left' },
  { numero: 31, letraExcel: 'AE', clave: 'cm_31_tiempo_residencia', cabeceraModelo: 'TIEMPO DE RESIDENCIA', etiqueta: '31 · Tiempo Residencia', anchoModelo: 2, alineacion: 'center' },
  { numero: 32, letraExcel: 'AF', clave: 'cm_32_nivel_educacion', cabeceraModelo: 'NIVEL DE EDUCACION', etiqueta: '32 · Cód. Educación', anchoModelo: 4, alineacion: 'center' },
  { numero: 33, letraExcel: 'AG', clave: 'cm_33_profesion', cabeceraModelo: 'PROFESION', etiqueta: '33 · Cód. Profesión', anchoModelo: 4, alineacion: 'center' },
  { numero: 34, letraExcel: 'AH', clave: 'cm_34_codigo_industria', cabeceraModelo: 'CÓDIGO DE LA INDUSTRIA (UNA CONSTANTE)', etiqueta: '34 · Cód. Industria (0902)', anchoModelo: 4, alineacion: 'center' },
  { numero: 35, letraExcel: 'AI', clave: 'cm_35_fuente_ingreso', cabeceraModelo: 'FUENTE DE INGRESO', etiqueta: '35 · Fuente Ingreso', anchoModelo: 1, alineacion: 'center' },
  { numero: 36, letraExcel: 'AJ', clave: 'cm_36_tipo_contrato', cabeceraModelo: 'TIPO DE CONTRATO', etiqueta: '36 · Tipo Contrato', anchoModelo: 1, alineacion: 'center' },
  { numero: 37, letraExcel: 'AK', clave: 'cm_37_tipo_nomina', cabeceraModelo: 'TIPO DE NOMINA', etiqueta: '37 · Tipo Nómina', anchoModelo: 1, alineacion: 'center' },
  { numero: 38, letraExcel: 'AL', clave: 'cm_38_tipo_cuenta', cabeceraModelo: 'TIPO DE CUENTE (NOMINA O PERSONAL)', etiqueta: '38 · Tipo Cuenta', anchoModelo: 4, alineacion: 'center' },
  { numero: 39, letraExcel: 'AM', clave: 'cm_39_sueldo_basico', cabeceraModelo: 'SUELDO BASICO (COMPLETAR CON CEROS A LA IZQUIERDA)', etiqueta: '39 · Sueldo Básico Bs (15 díg.)', anchoModelo: 15, alineacion: 'right' },
  { numero: 40, letraExcel: 'AN', clave: 'cm_40_fecha_ingreso', cabeceraModelo: 'FECHA DE INGRESO', etiqueta: '40 · Fecha Ingreso (DDMMAAAA)', anchoModelo: 8, alineacion: 'center' },
  { numero: 41, letraExcel: 'AO', clave: 'cm_41_tipo_cargo', cabeceraModelo: 'TIPO DE CARGO', etiqueta: '41 · Cód. Cargo', anchoModelo: 3, alineacion: 'center' },
  { numero: 42, letraExcel: 'AP', clave: 'cm_42_oficina_principal', cabeceraModelo: 'CÓDIGO DE LA OFICINA BANCARIA', etiqueta: '42 · Oficina Principal', anchoModelo: 4, alineacion: 'center' },
  { numero: 43, letraExcel: 'AQ', clave: 'cm_43_oficina_secundaria', cabeceraModelo: 'CÓDIGO DE LA OFICINA BANCARIA', etiqueta: '43 · Oficina Secundaria', anchoModelo: 4, alineacion: 'center' },
  { numero: 44, letraExcel: 'AR', clave: 'cm_44_constante_solicitud', cabeceraModelo: 'CONSTANTE (SE MANTIENE IGUAL)', etiqueta: '44 · Solicitud (I/M/D)', anchoModelo: 1, alineacion: 'center' },
];

export const CLAVES_COLUMNAS_CARGA_MASIVA: string[] = COLUMNAS_CARGA_MASIVA_NOMINA.map((c) => c.clave);

/* ───────────── Normalizadores y Mapeadores de Códigos ───────────── */

/** Normaliza texto para carga bancaria: mayúsculas ASCII sin tildes ni caracteres de control. */
export function limpiarTextoBancario(valor: string | null | undefined, maxLen?: number): string {
  const limpio = String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/gi, 'N')
    .toUpperCase()
    .replace(/[^A-Z0-9 .,#/@_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return maxLen && maxLen > 0 ? limpio.slice(0, maxLen).trim() : limpio;
}

const PARTICULAS_COMPUESTAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'SAN', 'SANTA', 'MC', 'MAC', 'VON', 'VAN']);

/** Agrupa partículas como «DE LA CRUZ» en un solo bloque nominal. */
function agruparPartesNominales(texto: string): string[] {
  const palabras = limpiarTextoBancario(texto)
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  const grupos: string[] = [];
  let prefijo = '';
  for (const p of palabras) {
    if (PARTICULAS_COMPUESTAS.has(p)) {
      prefijo = prefijo ? `${prefijo} ${p}` : p;
    } else if (prefijo) {
      grupos.push(`${prefijo} ${p}`);
      prefijo = '';
    } else {
      grupos.push(p);
    }
  }
  if (prefijo) {
    if (grupos.length > 0) grupos[grupos.length - 1] += ` ${prefijo}`;
    else grupos.push(prefijo);
  }
  return grupos;
}

/** Separa nombres y apellidos respetando los topes del modelo (20 chars nombres, 30 chars apellidos). */
export function separarNombresApellidos(
  nombreRaw?: string | null,
  apellidoRaw?: string | null,
): {
  primerApellido: string;
  segundoApellido: string;
  primerNombre: string;
  segundoNombre: string;
} {
  const nombres = agruparPartesNominales(nombreRaw ?? '');
  const apellidos = agruparPartesNominales(apellidoRaw ?? '');

  if (apellidos.length > 0) {
    return {
      primerApellido: (apellidos[0] ?? '').slice(0, 30),
      segundoApellido: apellidos.slice(1).join(' ').slice(0, 30),
      primerNombre: (nombres[0] ?? '').slice(0, 20),
      segundoNombre: nombres.slice(1).join(' ').slice(0, 20),
    };
  }

  // Si la ficha tenía nombre y apellido juntos en `nombre`
  if (nombres.length >= 4) {
    return {
      primerNombre: nombres[0].slice(0, 20),
      segundoNombre: nombres[1].slice(0, 20),
      primerApellido: nombres[2].slice(0, 30),
      segundoApellido: nombres.slice(3).join(' ').slice(0, 30),
    };
  }
  if (nombres.length === 3) {
    return {
      primerNombre: nombres[0].slice(0, 20),
      segundoNombre: nombres[1].slice(0, 20),
      primerApellido: nombres[2].slice(0, 30),
      segundoApellido: '',
    };
  }
  if (nombres.length === 2) {
    return {
      primerNombre: nombres[0].slice(0, 20),
      segundoNombre: '',
      primerApellido: nombres[1].slice(0, 30),
      segundoApellido: '',
    };
  }
  return {
    primerNombre: (nombres[0] ?? '').slice(0, 20),
    segundoNombre: '',
    primerApellido: '',
    segundoApellido: '',
  };
}

/** Extrae letra de documento (V/E/P) y número de cédula rellenado a 15 dígitos con ceros a la izquierda. */
export function normalizarDocumentoBancario(
  cedula?: string | null,
  nacionalidad?: string | null,
  rif?: string | null,
  datosPago?: unknown,
): { tipoDoc: 'V' | 'E' | 'P'; cedula15: string } {
  let fuente = String(cedula ?? '').trim();
  if (!fuente && datosPago) {
    const cuenta = leerCuentas(datosPago).find((c) => c.cedula?.trim());
    if (cuenta?.cedula) fuente = cuenta.cedula.trim();
  }
  let esRif = false;
  if (!fuente && rif) {
    fuente = String(rif).trim();
    esRif = true;
  }

  const limpio = fuente.toUpperCase().replace(/[\s.]/g, '');
  let tipoDoc: 'V' | 'E' | 'P' = 'V';
  if (/^[VEP]/.test(limpio)) {
    tipoDoc = limpio[0] as 'V' | 'E' | 'P';
  } else {
    const nac = limpiarTextoBancario(nacionalidad);
    if (nac === 'E' || nac.startsWith('EXTRANJ')) tipoDoc = 'E';
    else if (nac === 'P' || nac.startsWith('PASAP')) tipoDoc = 'P';
    else if (nac && !nac.startsWith('VENEZ') && nac !== 'VE' && nac !== 'V') tipoDoc = 'E';
  }

  let digitos = limpio.replace(/\D/g, '');
  if (esRif && digitos.length >= 9) {
    // En un RIF personal V-12345678-9, el último dígito es el verificador
    digitos = digitos.slice(0, -1);
  }
  const cedula15 = digitos.slice(0, 15).padStart(15, '0');
  return { tipoDoc, cedula15 };
}

/** Convierte una fecha ISO (`YYYY-MM-DD`) o `DD/MM/YYYY` a `DDMMYYYY` (8 caracteres). */
export function formatearFechaBancaria(fecha?: string | null): string {
  const s = String(fecha ?? '').trim();
  if (!s) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[3]}${iso[2]}${iso[1]}`;
  const ve = /^(\d{2})[/-](\d{2})[/-](\d{4})/.exec(s);
  if (ve) return `${ve[1]}${ve[2]}${ve[3]}`;
  return '';
}

/** Resuelve el código ISO de 2 letras de las hojas PAIS y NACIONALIDAD del banco. */
export function resolverCodigoPaisBancario(nacionalidad?: string | null, tipoDoc: 'V' | 'E' | 'P' = 'V'): string {
  const n = limpiarTextoBancario(nacionalidad);
  if (!n || n === 'V' || n === 'VE' || n.startsWith('VENEZ')) return 'VE';
  if (n.startsWith('COLOM') || n === 'CO') return 'CO';
  if (n.startsWith('BRAS') || n === 'BR') return 'BR';
  if (n.startsWith('GUYAN') || n === 'GY') return 'GY';
  if (n.startsWith('PERU') || n === 'PE') return 'PE';
  if (n.startsWith('ECUA') || n === 'EC') return 'EC';
  if (n.startsWith('CHIL') || n === 'CL') return 'CL';
  if (n.startsWith('CUBA') || n === 'CU') return 'CU';
  if (n.startsWith('ARGEN') || n === 'AR') return 'AR';
  if (n.startsWith('BOLIV') || n === 'BO') return 'BO';
  if (n.startsWith('URUG') || n === 'UY') return 'UY';
  if (n.startsWith('PARAG') || n === 'PY') return 'PY';
  if (n.startsWith('MEXIC') || n === 'MX') return 'MX';
  if (n.startsWith('DOMINIC') || n === 'DO') return 'DO';
  if (n.startsWith('TRINID') || n === 'TT') return 'TT';
  if (n.startsWith('ESPAN') || n === 'ES') return 'ES';
  if (n.startsWith('PORTUG') || n === 'PT') return 'PT';
  if (n.startsWith('ITALI') || n === 'IT') return 'IT';
  if (n.startsWith('CHIN') || n === 'CN') return 'CN';
  if (n.startsWith('ESTADOS UNIDOS') || n.startsWith('ESTADOUNID') || n === 'US' || n === 'USA' || n === 'EEUU') return 'US';
  if (/^[A-Z]{2}$/.test(n) && n !== 'EX') return n;
  return tipoDoc === 'V' ? 'VE' : 'CO';
}

export function resolverSexoBancario(genero?: string | null): 'M' | 'F' {
  const g = limpiarTextoBancario(genero);
  if (g === 'F' || g.startsWith('FEM') || g.startsWith('MUJ')) return 'F';
  return 'M';
}

/** Mapea el estado civil a los códigos 1..5 de la hoja EDO CIVIL. */
export function resolverEstadoCivilBancario(estadoCivil?: string | null): string {
  const e = limpiarTextoBancario(estadoCivil);
  if (e.startsWith('CASAD') || e === '2') return '2';
  if (e.startsWith('DIVOR') || e === '3') return '3';
  if (e.startsWith('VIUD') || e === '4') return '4';
  if (e.startsWith('CONCUB') || e.startsWith('UNION') || e === '5') return '5';
  return '1'; // SOLTERO(a)
}

/** Mapea el grado de instrucción a los códigos 01..07 de la hoja NIVEL DE EDUCACION. */
export function resolverNivelEducacionBancario(grado?: string | null): string {
  const g = limpiarTextoBancario(grado);
  if (!g) return '02';
  if (g === 'PRIMARIA' || g === 'NINGUNO' || g.startsWith('SIN ESTUD')) return '01';
  if (g.startsWith('BACHILL')) return '02';
  if (g.includes('TECNICO MEDIO') || g === 'TECNICO_MEDIO') return '03';
  if (g === 'TSU' || g.includes('TECNICO SUPERIOR') || g.includes('UNIVERSITARIO CORTO')) return '04';
  if (g.startsWith('UNIVERSIT') || g.startsWith('LICENCIAD') || g.startsWith('INGENIER')) return '05';
  if (g.startsWith('POST') || g.startsWith('MAESTR') || g.startsWith('ESPECIALIZ')) return '06';
  if (g.startsWith('DOCTOR')) return '07';
  return '02';
}

/** Resuelve el código de 4 letras de la hoja PROFESION a partir del título obtenido, cargo y grado. */
export function resolverProfesionBancaria(
  tituloObtenido?: string | null,
  cargo?: string | null,
  grado?: string | null,
): string {
  const t = limpiarTextoBancario(tituloObtenido);
  const c = limpiarTextoBancario(cargo);
  const g = limpiarTextoBancario(grado);
  const mix = `${t} ${c}`.trim();
  const esTsu = g === 'TSU' || t.includes('TSU') || t.includes('TECNICO SUPERIOR');

  if (mix.includes('ABOGAD') || mix.includes('DERECHO')) return 'ABOG';
  if (mix.includes('CONTAD') || mix.includes('CONTABLE')) return esTsu ? 'TACF' : 'LCPU';
  if (mix.includes('RECURSOS HUMANOS') || mix.includes('RRHH') || mix.includes('RELACIONES INDUSTRIALES')) {
    return esTsu ? 'TRIN' : t.includes('RELACIONES') ? 'LRIN' : 'LARH';
  }
  if (mix.includes('ADMINISTRAC') || mix.includes('ADMINISTRAD')) return esTsu ? 'TADE' : 'LADM';
  if (mix.includes('GEOLOG')) return esTsu ? 'TSUG' : 'GEOL';
  if (mix.includes('QUIMIC') || mix.includes('LABORATOR')) return esTsu ? 'TQUI' : 'INQU';
  if (mix.includes('SISTEMA') || mix.includes('INFORMATIC') || mix.includes('COMPUTAC') || mix.includes('PROGRAMAD')) {
    return esTsu ? 'TINF' : t.includes('ING') ? 'INSI' : 'LINF';
  }
  if (mix.includes('ELECTRIC')) return esTsu ? 'TMEL' : t.includes('ING') ? 'INEL' : 'ELEC';
  if (mix.includes('ELECTRONIC')) return t.includes('ING') ? 'INET' : 'ELEC';
  if (mix.includes('MANTENIMIENTO INDUSTRIAL')) return 'TMIN';
  if (mix.includes('MECANIC') || mix.includes('ELECTROMECANIC')) {
    if (t.includes('ING')) return 'INME';
    if (esTsu) return 'TMEC';
    return 'MECA';
  }
  if (mix.includes('INDUSTRIAL') && t.includes('ING')) return 'INID';
  if (mix.includes('CIVIL') && (t.includes('ING') || esTsu)) return esTsu ? 'TSUO' : 'INCI';
  if (mix.includes('AMBIENTAL') && t.includes('ING')) return 'INGA';
  if (mix.includes('MATERIALES') && t.includes('ING')) return 'INGM';
  if (mix.includes('INGENIER')) return 'INGE';
  if (mix.includes('ARQUITECT')) return 'ARQU';
  if (mix.includes('ECONOM')) return 'ECON';
  if (mix.includes('PSICOLOG')) return 'LPSI';
  if (mix.includes('ENFERMER') || mix.includes('PARAMEDIC')) return 'ENFE';
  if (mix.includes('MEDIC')) return 'MEDI';
  if (mix.includes('TOPOGRAF')) return 'TOPO';

  // Oficios / puestos operativos
  if (c.includes('CHOFER') || c.includes('CONDUCTOR') || c.includes('GANDOLER')) return 'CHOF';
  if (c.includes('MOTORIZAD') || c.includes('MENSAJER') || c.includes('DELIVERY')) return 'MENS';
  if (c.includes('COCINER') || c.includes('CHEF') || c.includes('COCINA')) return 'CHEF';
  if (c.includes('VIGILANT') || c.includes('SEGURIDAD') || c.includes('ESCOLTA') || c.includes('GUARDIA')) return 'VIGI';
  if (c.includes('SOLDADOR') || c.includes('HERRER') || c.includes('LATONER')) return 'HERR';
  if (c.includes('CONSERJ') || c.includes('ASEO') || c.includes('LIMPIEZA') || c.includes('CAMARER')) return 'CONS';
  if (c.includes('JARDINER')) return 'JARD';
  if (c.includes('SECRETAR')) return 'SECR';
  if (c.includes('RECEPCION')) return 'RECE';
  if (c.includes('CAJER')) return 'CAJE';
  if (c.includes('COMPRAD') || c.includes('COMPRAS')) return 'COMP';
  if (c.includes('VENDED') || c.includes('VENTAS')) return 'VEND';
  if (c.includes('COORDINAD')) return 'COOR';
  if (c.includes('SUPERVIS') || c.includes('CAPATAZ') || c.includes('JEFE')) return 'SUPE';
  if (c.includes('ANALIST')) return 'ANAL';
  if (c.includes('ASISTENT') || c.includes('AUXILIAR')) return 'ASIS';
  if (c.includes('MANTENIMIENTO') || c.includes('OPERADOR') || c.includes('MAQUINIST') || c.includes('PLANTA') || c.includes('FUNDIC') || c.includes('MOLIN')) return 'SERV';
  if (g === 'NINGUNO') return 'SINE';
  return 'OBRE';
}

/** Resuelve el código de 3 dígitos de la hoja TIPO DE CARGO. */
export function resolverTipoCargoBancario(cargo?: string | null): string {
  const c = limpiarTextoBancario(cargo);
  if (!c) return '011';
  if (c.includes('VICEPRESIDENT')) return '029';
  if (c.includes('PRESIDENT')) return '001';
  if (c.includes('DIRECTOR')) return '002';
  if (c.includes('GERENTE GENERAL')) return '075';
  if (c.includes('SUBGERENTE') || c.includes('SUB GERENTE')) return '004';
  if (c.includes('GERENTE')) return '003';
  if (c.includes('JEFE')) return '015';
  if (c.includes('COORDINAD')) return '006';
  if (c.includes('SUPERVIS') || c.includes('CAPATAZ')) return '005';
  if (c.includes('ENCARGAD')) return '009';
  if (c.includes('ADMINISTRAD')) return '041';
  if (c.includes('AUDITOR') || c.includes('CONTADOR')) return '027';
  if (c.includes('ASESOR') || c.includes('CONSULTOR')) return '026';
  if (c.includes('ABOGAD')) return '032';
  if (c.includes('GEOLOG')) return '068';
  if (c.includes('QUIMIC') || c.includes('FISIC') || c.includes('LABORATOR') || c.includes('FUNDID')) return '067';
  if (c.includes('ARQUITECT')) return '035';
  if (c.includes('INGENIER')) return '031';
  if (c.includes('MEDIC') || c.includes('ENFERMER')) return '033';
  if (c.includes('ECONOMIST')) return '037';
  if (c.includes('PROGRAMAD') || c.includes('SISTEMAS') || c.includes('TI ')) return '028';
  if (c.includes('ESPECIALIST')) return '012';
  if (c.includes('COMPRAD')) return '074';
  if (c.includes('ANALIST')) return '007';
  if (c.includes('ASISTENT')) return '013';
  if (c.includes('AUXILIAR') || c.includes('AYUDANT')) return '020';
  if (c.includes('SECRETAR')) return '008';
  if (c.includes('RECEPCION')) return '024';
  if (c.includes('ALMACEN') || c.includes('OFICINIST') || c.includes('DESPACHAD')) return '030';
  if (c.includes('CAJER')) return '018';
  if (c.includes('TECNIC') || c.includes('MECANIC') || c.includes('ELECTRICIST') || c.includes('SOLDAD') || c.includes('HERRER') || c.includes('TORNER')) return '016';
  if (c.includes('OPERADOR') || c.includes('MAQUINIST') || c.includes('OPERARIO') || c.includes('MOLINER')) return '017';
  if (c.includes('CHOFER') || c.includes('CONDUCTOR') || c.includes('MOTORIZAD') || c.includes('GANDOLER')) return '021';
  if (c.includes('CHEF') || c.includes('COCINER') || c.includes('COCINA')) return '046';
  if (c.includes('MESONER')) return '047';
  if (c.includes('VIGILANT') || c.includes('SEGURIDAD') || c.includes('ESCOLTA') || c.includes('PORTERO')) return '023';
  if (c.includes('CONSERJ') || c.includes('ASEO') || c.includes('LIMPIEZA') || c.includes('MANTENIMIENTO')) return '022';
  if (c.includes('VENDED')) return '010';
  if (c.includes('ADJUNTO')) return '077';
  if (c.includes('OBRER') || c.includes('MINER')) return '011';
  return '078'; // OTROS
}

/** Desglosa la dirección libre y resuelve los códigos geográficos de Bolívar / Venezuela según hojas anexas. */
export function desglosarDireccionBancaria(
  direccion?: string | null,
  defaults: Pick<
    Required<ParametrosCargaMasivaNomina>,
    'regionDefault' | 'estadoDefault' | 'ciudadDefault' | 'municipioDefault' | 'parroquiaDefault' | 'zonaPostalDefault'
  > = PARAMETROS_CARGA_MASIVA_DEFAULT,
): {
  calleAvenida: string;
  casaEdificio: string;
  pisoNivel: string;
  aptoLocal: string;
  referencia: string;
  condicionInmueble: '1' | '2' | '3';
  tipoVivienda: '1' | '2' | '3';
  region: string;
  estado: string;
  ciudad: string;
  municipio: string;
  parroquia: string;
  zonaPostal: string;
} {
  const raw = limpiarTextoBancario(direccion);

  // Detección de códigos geográficos según las hojas REGION, ESTADO, MUNICIPIO, PARROQUIA y CODIGO POSTAL
  let region = defaults.regionDefault;
  let estado = defaults.estadoDefault;
  let ciudad = defaults.ciudadDefault;
  let municipio = defaults.municipioDefault;
  let parroquia = defaults.parroquiaDefault;
  let zonaPostal = defaults.zonaPostalDefault;

  if (raw.includes('EL CALLAO')) {
    region = '09'; estado = '07'; ciudad = '0702'; municipio = '0705'; parroquia = '070501'; zonaPostal = '0000008056';
  } else if (raw.includes('GUASIPATI') || raw.includes('ROSCIO') || raw.includes('EL MIAMO')) {
    region = '09'; estado = '07'; ciudad = '0701'; municipio = '0710'; parroquia = '071001'; zonaPostal = '0000008050';
  } else if (raw.includes('EL DORADO')) {
    region = '09'; estado = '07'; ciudad = '0702'; municipio = '0711'; parroquia = '071102'; zonaPostal = '0000008050';
  } else if (raw.includes('TUMEREMO') || raw.includes('SIFONTES')) {
    region = '09'; estado = '07'; ciudad = '0702'; municipio = '0711'; parroquia = '071101'; zonaPostal = '0000008057';
  } else if (raw.includes('UPATA') || raw.includes('EL PALMAR')) {
    region = '09'; estado = '07'; ciudad = '0702'; municipio = '0708'; parroquia = '070801'; zonaPostal = raw.includes('EL PALMAR') ? '0000008054' : '0000008052';
  } else if (raw.includes('CIUDAD PIAR')) {
    region = '09'; estado = '07'; ciudad = '0703'; municipio = '0709'; parroquia = '070901'; zonaPostal = '0000008003';
  } else if (raw.includes('SANTA ELENA') || raw.includes('UAIREN') || raw.includes('GRAN SABANA')) {
    region = '09'; estado = '07'; ciudad = '0702'; municipio = '0706'; parroquia = '070601'; zonaPostal = '0000008011';
  } else if (raw.includes('CAICARA')) {
    region = '09'; estado = '07'; ciudad = '0703'; municipio = '0704'; parroquia = '070401'; zonaPostal = '0000008007';
  } else if (raw.includes('CIUDAD BOLIVAR') || raw.includes('AGUA SALADA') || raw.includes('LA SABANITA') || raw.includes('MARHUANTA')) {
    region = '09'; estado = '07'; ciudad = '0703'; municipio = '0703'; zonaPostal = '0000008001';
    if (raw.includes('AGUA SALADA')) parroquia = '070201';
    else if (raw.includes('LA SABANITA')) parroquia = '070204';
    else if (raw.includes('MARHUANTA')) parroquia = '070205';
    else if (raw.includes('VISTA HERMOSA')) parroquia = '070206';
    else parroquia = '070202';
  } else if (
    raw.includes('SAN FELIX') ||
    raw.includes('CHIRICA') ||
    raw.includes('DALLA COSTA') ||
    raw.includes('ONCE DE ABRIL') ||
    raw.includes('11 DE ABRIL') ||
    raw.includes('VISTA AL SOL') ||
    raw.includes('GUAIPARO') ||
    raw.includes('MANOA')
  ) {
    region = '09'; estado = '07'; ciudad = '0702'; municipio = '0702'; zonaPostal = '0000008051';
    if (raw.includes('CHIRICA')) parroquia = '070102';
    else if (raw.includes('DALLA COSTA') || raw.includes('GUAIPARO')) parroquia = '070103';
    else if (raw.includes('ONCE DE ABRIL') || raw.includes('11 DE ABRIL')) parroquia = '070104';
    else if (raw.includes('VISTA AL SOL')) parroquia = '070108';
    else parroquia = '070105';
  } else if (raw.includes('CARACAS') || raw.includes('DISTRITO CAPITAL')) {
    region = '01'; estado = '01'; ciudad = '0101'; municipio = '0101'; parroquia = '010105'; zonaPostal = '0000001010';
  } else if (raw) {
    // Parroquias de Puerto Ordaz / Caroní
    if (raw.includes('CACHAMAY') || raw.includes('CASTILLITO') || raw.includes('VILLA AFRICANA')) parroquia = '070101';
    else if (raw.includes('UNIVERSIDAD') || raw.includes('ALTA VISTA') || raw.includes('LOS OLIVOS') || raw.includes('LOS MANGOS') || raw.includes('VILLA ASIA')) parroquia = '070107';
    else if (raw.includes('POZO VERDE')) parroquia = '070109';
    else if (raw.includes('YOCOIMA')) parroquia = '070110';
    else if (raw.includes('UNARE') || raw.includes('CORE 8') || raw.includes('RIO CAURA') || raw.includes('VENTUARI')) parroquia = '070106';
  }

  const esApto = /\b(EDIF|EDIFICIO|APTO|APARTAMENTO|RESIDENCIA|RES|TORRE|BLOQUE)\b/.test(raw);
  const esQuinta = /\bQUINTA\b/.test(raw);
  const tipoVivienda: '1' | '2' | '3' = esApto ? '3' : esQuinta ? '2' : '1';
  const condicionInmueble: '1' | '2' | '3' = raw.includes('ALQUIL') ? '2' : '1';

  const mPiso = /\b(?:PISO|NIVEL)\s*([A-Z0-9]{1,5})\b/.exec(raw);
  const pisoNivel = mPiso ? mPiso[1].slice(0, 5) : 'PB';

  const mApto = /\b(?:APTO|CASA|LOCAL|OFIC|NRO|NO|#)\s*[-.]?\s*([A-Z0-9-]{1,12})\b/.exec(raw);
  const aptoLocal = mApto ? mApto[1].slice(0, 15) : 'S/N';

  const mEdif = /\b(EDIFICIO|EDIF|TORRE|RESIDENCIAS|RES|BLOQUE|MANZANA|MZ)\s*([A-Z0-9 ]{0,10})/.exec(raw);
  const casaEdificio = mEdif
    ? `${mEdif[1]} ${mEdif[2]}`.replace(/\s+/g, ' ').trim().slice(0, 15)
    : esApto
    ? 'EDIFICIO'
    : 'CASA';

  const calleAvenida = (raw || 'PUERTO ORDAZ').slice(0, 35).trim() || 'PUERTO ORDAZ';
  const referencia = raw.length > 35 ? raw.slice(35, 65).trim() : '';

  return {
    calleAvenida,
    casaEdificio,
    pisoNivel,
    aptoLocal,
    referencia,
    condicionInmueble,
    tipoVivienda,
    region: region.padStart(2, '0').slice(-2),
    estado: estado.padStart(2, '0').slice(-2),
    ciudad: ciudad.padStart(4, '0').slice(-4),
    municipio: municipio.padStart(4, '0').slice(-4),
    parroquia: parroquia.padStart(6, '0').slice(-6),
    zonaPostal: zonaPostal.replace(/\D/g, '').padStart(10, '0').slice(-10),
  };
}

function aOnceDigitosVe(raw?: string | null): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('58') && d.length === 12) d = '0' + d.slice(2);
  else if (d.length === 10 && /^[24]/.test(d)) d = '0' + d;
  if (d.length > 11) d = d.slice(-11);
  return d.padStart(11, '0');
}

/** Normaliza teléfonos local y celular a 11 dígitos con cero a la izquierda (`04141234567`). */
export function normalizarTelefonosBancarios(
  telefono?: string | null,
  datosPago?: unknown,
  tlfEmergencia?: string | null,
): { tlfLocal: string; tlfCelular: string } {
  const candidatos: string[] = [];
  if (telefono) candidatos.push(...String(telefono).split(/[|/;,]+/));
  if (datosPago) {
    for (const c of leerCuentas(datosPago)) {
      if (c.telefono) candidatos.push(c.telefono);
    }
  }
  const emergencia = aOnceDigitosVe(tlfEmergencia);

  const normalizados = candidatos.map(aOnceDigitosVe).filter((x) => x.length === 11 && x !== '00000000000');
  const movil = normalizados.find((x) => /^04(12|14|24|16|26)/.test(x)) ?? normalizados[0] ?? '';
  const fijo =
    normalizados.find((x) => /^02\d{9}$/.test(x)) ??
    (/^02\d{9}$/.test(emergencia) ? emergencia : '') ??
    '';

  const tlfCelular = movil || emergencia || '00000000000';
  const tlfLocal = fijo || tlfCelular || '00000000000';
  return { tlfLocal, tlfCelular };
}

/** Convierte un monto en Bs a entero en céntimos de 15 dígitos con ceros a la izquierda (`000000001484650`). */
export function formatearSueldoBancario15(montoBs: number): string {
  const centimos = Math.max(0, Math.round((Number(montoBs) || 0) * 100));
  return String(centimos).slice(0, 15).padStart(15, '0');
}

/** Construye los 44 campos bancarios para una ficha de personal. */
export function construirCamposCargaMasivaPersona(
  p: Personal,
  opts: {
    correlativo: number;
    tasaBcv: number;
    familiares?: FamiliarPersonal[];
    empresa?: DefinicionEmpresa;
    params?: ParametrosCargaMasivaNomina;
  },
): CamposCargaMasivaFila & { sueldoBsAplicado: number } {
  const cfg: Required<ParametrosCargaMasivaNomina> = {
    ...PARAMETROS_CARGA_MASIVA_DEFAULT,
    ...(opts.params ?? {}),
  };

  const banco4 = String(cfg.codigoBanco || CODIGO_BANCO_DEFAULT).replace(/\D/g, '').padStart(4, '0').slice(-4);
  const correlativo7 = String(Math.max(1, Math.trunc(opts.correlativo))).padStart(7, '0').slice(-7);
  const { tipoDoc, cedula15 } = normalizarDocumentoBancario(p.cedula, p.nacionalidad, p.rif, p.datos_pago);
  const { primerApellido, segundoApellido, primerNombre, segundoNombre } = separarNombresApellidos(p.nombre, p.apellido);

  const fechaNac8 = formatearFechaBancaria(p.fecha_nacimiento);
  const paisIso = resolverCodigoPaisBancario(p.nacionalidad, tipoDoc);
  const sexo = resolverSexoBancario(p.genero);
  const edoCivil = resolverEstadoCivilBancario(p.estado_civil);

  const cantDep = Math.min(99, Math.max(0, (opts.familiares ?? []).length));
  const dependientes2 = String(cantDep).padStart(2, '0');

  const dir = desglosarDireccionBancaria(p.direccion, cfg);
  const { tlfLocal, tlfCelular } = normalizarTelefonosBancarios(p.telefono, p.datos_pago, p.contacto_emergencia_tlf);

  const correo = limpiarTextoBancario(p.correo, 40);
  const grado = p.grado_instruccion?.trim() || gradoMasAlto(p.grados_instruccion) || undefined;
  const nivelEdu = resolverNivelEducacionBancario(grado);
  const profesion = resolverProfesionBancaria(p.titulo_obtenido, p.cargo, grado);

  const sueldoBaseUsd = Number(p.sueldo_base) || 0;
  const pct = Number(cfg.porcentajeSueldoBs) > 0 ? Number(cfg.porcentajeSueldoBs) : 0.2;
  const sueldoBsAplicado = Math.round(sueldoBaseUsd * (Number(opts.tasaBcv) || 1) * pct * 100) / 100;
  const sueldo15 = formatearSueldoBancario15(sueldoBsAplicado);

  const fechaIng8 = formatearFechaBancaria(p.fecha_ingreso);
  const tipoCargo3 = resolverTipoCargoBancario(p.cargo);
  const ofiPrin = String(cfg.oficinaPrincipal || '0405').replace(/\D/g, '').padStart(4, '0').slice(-4);
  const ofiSec = String(cfg.oficinaSecundaria || ofiPrin).replace(/\D/g, '').padStart(4, '0').slice(-4);

  return {
    sueldoBsAplicado,
    cm_01_banco: banco4,
    cm_02_correlativo: correlativo7,
    cm_03_tipo_doc: tipoDoc,
    cm_04_cedula: cedula15,
    cm_05_primer_apellido: primerApellido,
    cm_06_segundo_apellido: segundoApellido,
    cm_07_primer_nombre: primerNombre,
    cm_08_segundo_nombre: segundoNombre,
    cm_09_fecha_nacimiento: fechaNac8,
    cm_10_pais_nacimiento: paisIso,
    cm_11_nacionalidad: paisIso,
    cm_12_sexo: sexo,
    cm_13_estado_civil: edoCivil,
    cm_14_dependientes: dependientes2,
    cm_15_calle_avenida: dir.calleAvenida,
    cm_16_casa_edificio: dir.casaEdificio,
    cm_17_piso_nivel: dir.pisoNivel,
    cm_18_apto_local: dir.aptoLocal,
    cm_19_referencia: dir.referencia,
    cm_20_region: dir.region,
    cm_21_estado: dir.estado,
    cm_22_ciudad: dir.ciudad,
    cm_23_municipio: dir.municipio,
    cm_24_parroquia: dir.parroquia,
    cm_25_zona_postal: dir.zonaPostal,
    cm_26_tlf_local: tlfLocal,
    cm_27_tlf_celular: tlfCelular,
    cm_28_condicion_inmueble: dir.condicionInmueble,
    cm_29_tipo_vivienda: dir.tipoVivienda,
    cm_30_correo: correo,
    cm_31_tiempo_residencia: '01',
    cm_32_nivel_educacion: nivelEdu,
    cm_33_profesion: profesion,
    cm_34_codigo_industria: CODIGO_INDUSTRIA_CONSTANTE,
    cm_35_fuente_ingreso: '1',
    cm_36_tipo_contrato: cfg.tipoContrato,
    cm_37_tipo_nomina: cfg.tipoNomina,
    cm_38_tipo_cuenta: cfg.tipoCuenta,
    cm_39_sueldo_basico: sueldo15,
    cm_40_fecha_ingreso: fechaIng8,
    cm_41_tipo_cargo: tipoCargo3,
    cm_42_oficina_principal: ofiPrin,
    cm_43_oficina_secundaria: ofiSec,
    cm_44_constante_solicitud: cfg.tipoSolicitud,
  };
}

/** Formatea una celda de Carga Masiva al ancho fijo exacto `wch` de la macro `ExportText` del banco. */
export function formatearCampoAnchoFijo(valor: string, ancho: number): string {
  const limpio = String(valor ?? '').replace(/[\r\n\t]/g, ' ');
  if (limpio.length >= ancho) return limpio.slice(0, ancho);
  return limpio.padEnd(ancho, ' ');
}

