/* ============================================================
   Golden Touch · Libro fiscal · Errores de la base, en texto de pantalla

   Las funciones de la base (V2, V3, VF, R1) rechazan con un prefijo estable
   RET_* en el mensaje. Aquí se traduce cada código a un texto neutro; si el
   código no está en la lista, se muestra el mensaje de la base tal cual
   (BD ya lo redacta para la pantalla). Pieza pura, sin base de datos.
   ============================================================ */
import { sinRotulo } from './rotulos';

const TEXTOS: Record<string, string> = {
  RET_FACTURA_SIN_LINEAS: 'La factura necesita al menos una línea de impuesto.',
  RET_FACTURA_ROL: 'Falta indicar quién retuvo (la empresa o el cliente).',
  RET_FACTURA_DOC: 'Falta el documento de origen (OC, compra o servicio) de la factura.',
  RET_FACTURA_DECLARADA: 'La factura tiene líneas ya declaradas: solo se puede cambiar la nota.',
  RET_DOCUMENTO_TIPO: 'El documento debe ser una factura, una nota de débito o una nota de crédito.',
  RET_DOCUMENTO_AFECTADO: 'Una nota de débito o de crédito lleva el N° de la factura que ajusta.',
  RET_LINEA_TIPO: 'Una línea tiene un impuesto que no se reconoce.',
  RET_MONTO_NEGATIVO: 'El monto retenido no puede ser negativo.',
  RET_CERO_SIN_MOTIVO: 'Una retención en 0 se registra solo con su motivo.',
  RET_NUMERO_FALTA: 'Esta serie se numera a mano: escribe el número del comprobante antes de registrar.',
  RET_NUMERO_USADO: 'Ese número de comprobante ya se dio en la serie: no se vuelve a dar, aunque se haya anulado o cambiado.',
  RET_NUMERO_FORMATO: 'El número del comprobante no tiene el formato de su serie: el de IVA lleva 14 dígitos (AAAAMM y 8 de la serie); el de ISLR, ISAE y estadal, 10 dígitos.',
  RET_NUMERO_NO_ES_EL_ULTIMO: 'Solo se puede cambiar el número de la última retención de su serie.',
  RET_NUMERO_NO_EDITABLE: 'El número no se puede cambiar: la retención está declarada o anulada.',
  RET_NUMERO_NO_SE_QUITA: 'El número de un comprobante emitido no se puede quitar.',
  RET_SERIE_NO_NUMERA: 'Ese impuesto no lleva número propio en su serie.',
  RET_SERIE_LLENA: 'La serie de ese impuesto llegó a su último número: revisa la serie en Parámetros.',
  RET_PERIODO_INVALIDO: 'El período de la retención no es válido.',
  RET_PERIODO_DECLARADO: 'El período ya está declarado: no se puede registrar ni mover una retención en él. Reábrelo primero.',
  RET_PERIODO_YA_DECLARADO: 'Ese período ya estaba declarado.',
  RET_PERIODO_NO_DECLARADO: 'Ese período no está declarado: no hay nada que reabrir.',
  RET_PERIODO_NO_EXISTE: 'Ese período no existe. Genera los períodos del año primero.',
  RET_ANIO_INVALIDO: 'El año tiene que estar entre 2020 y 2100.',
  RET_PERIODO_DECLARA_DECLARADO: 'No se puede cambiar quién declara un período ya declarado.',
  RET_PERIODO_SOLO_POR_FUNCION: 'El estado del período solo se cambia con «Declarar» o «Reabrir».',
  RET_MOTIVO_OBLIGATORIO: 'Indica el motivo del cambio.',
  RET_SIN_PERMISO: 'No tienes permiso para esta operación en Retenciones.',
  RET_PERFIL_DESDE: 'La versión nueva del perfil fiscal tiene que empezar después de la vigente.',
  RET_VERSION_DESDE: 'La versión nueva del impuesto tiene que empezar después de la vigente. Para corregir la vigente, usa «Corregir».',
  RET_SERIE_INICIAL: 'El primer número de la serie tiene que ser mayor que el último del otro sistema.',
  RET_SERIE_EN_USO: 'La serie de ese impuesto ya dio números: no cambia de formato.',
  RET_PARAMETRO_DESDE: 'El valor nuevo tiene que empezar después del vigente. Para corregir el vigente, usa «Corregir».',
  RET_PARAMETRO_AMBITO: 'Ese valor no va con ese impuesto: revisa si es general o de un impuesto.',
  RET_PARAMETRO_TIPO: 'El valor no es del tipo que lleva esa clave (número, texto o sí/no).',
  RET_TARIFA_DESDE: 'La versión nueva de la tarifa tiene que empezar después de la vigente.',
  RET_TARIFA_CERRADA: 'La versión está publicada: sus tramos no cambian. Haz una versión nueva.',
  RET_REGLA_NO_EDITABLE: 'La regla ya no está en prueba: para cambiarla, haz una versión nueva.',
  RET_REGLA_ESTADO: 'Ese cambio de estado no corresponde a la regla.',
  RET_REGLA_NO_EXISTE: 'Esa regla no existe.',
  RET_FOTO_NO_CAMBIA: 'La retención ya guarda la regla y la foto con que se calculó: no cambian.',
  RET_DECISION_MOTIVO: '«No aplica» lleva un motivo de ese impuesto.',
  RET_DECISION_DETALLE: 'Ese motivo pide un texto que lo explique.',
  RET_CLASIFICACION_DESDE: 'El valor nuevo del código tiene que empezar después del vigente. Para corregir el vigente, usa «Corregir».',
  RET_ORIGEN_UNO: 'El archivo o el enlace va en exactamente una orden, compra directa o servicio directo.',
  RET_ADJUNTO_REGISTRADO: 'Este archivo ya está registrado como factura en Retenciones: no se cambia ni se borra mientras su documento fiscal exista.',
  RET_ADJUNTO_CAMPO: 'De un archivo solo se cambian el nombre, el tipo y si es factura.',
  RET_ADJUNTO_NO_FACTURA: 'Ese archivo no está marcado como factura (es un pago, una solicitud u otro papel). Márcalo como factura en Compras si lo es.',
  RET_ADJUNTO_SIN_ORIGEN: 'Una factura fuera del sistema no lleva archivo de Compras: el archivo es de una orden, compra o servicio.',
  RET_ORIGEN_CON_DOCUMENTO: 'No se puede eliminar: tiene una factura registrada en Retenciones. Primero hay que borrar ese documento fiscal (solo si no tiene retenciones).',
  RET_ADJUNTO_ORIGEN: 'Ese archivo de factura es de otra orden, compra o servicio.',
  RET_DOCUMENTO_NO_LIBRE: 'Esta factura tiene retenciones (aunque estén anuladas), decisiones o notas que la afectan: no se borra.',
  RET_LICENCIA_TIPO: 'Ese tipo de licencia no está en el catálogo o está inactivo (Parámetros → Tipos de licencia).',
  RET_FORMATO_FORMA: 'El formato no tiene la forma esperada: textos y rótulos van como objeto ({…}) y columnas como lista ([…]).',
  RET_FORMATO_DESDE: 'La versión nueva del formato tiene que empezar después de la vigente.',
  RET_ENLACE_PRINCIPAL: 'Es la orden principal de la factura: se corrige en la factura, o se borra la factura si no tiene retenciones.',
  RET_ENLACE_CON_ARCHIVO: 'Este enlace dice de qué archivo salió la factura: primero hay que quitar el archivo del enlace.',
  RET_DOCUMENTO_NO_EXISTE: 'Esa factura no está registrada (o no tienes permiso para verla).',
};

/**
 * Las reglas de forma y rango de la base (CHECK, por nombre de restricción): R9 y P03.
 * Un 23514 trae el nombre entre comillas; con él se dice qué dato no cumple.
 */
const RESTRICCIONES: Record<string, string> = {
  retencion_documentos_forma: 'El número y el control de la factura van de 1 a 30 caracteres, sin espacios al borde ni saltos de línea, y la fecha entre 2000 y 2100.',
  retenciones_forma: 'El número de factura, el de control, el de comprobante y el código del concepto van de 1 a 30 caracteres, sin espacios al borde ni saltos de línea.',
  retenciones_montos_no_negativos: 'Los montos de la retención (base, monto, sustraendo, IVA, exento, total) no pueden ser negativos.',
  retenciones_porcentajes: 'El porcentaje retenido y la alícuota del IVA van de 0 a 100.',
  retenciones_tasa_positiva: 'La tasa de cambio tiene que ser mayor que 0.',
  retenciones_valor_ut_positivo: 'El valor de la UT tiene que ser mayor que 0 (revisa la UT vigente en Parámetros → Valores).',
  retenciones_quincena: 'La quincena es 1 o 2.',
  retenciones_periodo_forma: 'El período va como AAAAMM (por ejemplo, 202610).',
  retenciones_fechas: 'La fecha de la retención y la de la factura van entre 2000 y 2100.',
  retenciones_moneda: 'La moneda es Bs o USD.',
  retencion_documentos_montos: 'Los montos de la factura no pueden ser negativos.',
  retencion_documentos_porcentajes: 'La alícuota del IVA de la factura va de 0 a 100.',
  retencion_documentos_tasa_positiva: 'La tasa de cambio de la factura tiene que ser mayor que 0.',
  retencion_documentos_moneda: 'La moneda de la factura es Bs o USD.',
  retencion_entes_rif_forma: 'El RIF del ente no es válido: letra V, E, J, P o G y 9 números (los guiones no cuentan).',
  retencion_ente_impuestos_desde_rango: 'La fecha «desde» va entre 2000 y 2100.',
  retencion_ente_logos_desde_rango: 'La fecha «desde» del logo va entre 2000 y 2100.',
  retencion_agente_imagenes_desde_rango: 'La fecha «desde» de la firma, el sello o el logo va entre 2000 y 2100.',
  retencion_contraparte_perfiles_licencia_vence_rango: 'El vencimiento de la licencia va entre 2000 y 2100.',
  retencion_clasificacion_codigos_forma: 'El código de la clasificación va en mayúsculas, de 1 a 30 caracteres, sin espacios al borde ni saltos de línea.',
  retencion_contraparte_actividades_ordenanza_forma: 'El código de ordenanza va en mayúsculas, de 1 a 30 caracteres, sin espacios al borde ni saltos de línea.',
};

/**
 * Los únicos de la base (23505), por nombre de índice o restricción: qué ya existe.
 * Los «…_key» son los únicos sin nombre propio (Postgres los nombra tabla_columnas_key).
 */
const UNICOS: Record<string, string> = {
  retenciones_comprobante_propio_uk: 'Ese número de comprobante ya se dio en la serie: no se vuelve a dar, aunque se haya anulado o cambiado.',
  retencion_documentos_unica_practicada: 'Esa factura ya está registrada (mismo número, control y tipo de documento del mismo emisor).',
  retencion_documentos_unica_recibida: 'Esa factura ya está registrada (mismo número, control y tipo de documento).',
  retencion_documento_origenes_unico: 'Esa factura ya cubre esa orden, compra o servicio.',
  retencion_entes_unico: 'Ya hay un ente de ese tipo con ese nombre (sin distinguir mayúsculas).',
  retencion_ente_impuestos_ente_id_impuesto_clave_key: 'Ese ente ya tiene ese impuesto.',
  retencion_ente_logos_ente_id_desde_key: 'Ese ente ya tiene un logo con esa fecha «desde».',
  retencion_agente_imagenes_clase_desde_key: 'Ya hay una imagen de ese tipo (firma, sello o logo) con esa fecha «desde».',
  retencion_agente_condiciones_desde: 'Ya hay un cambio del régimen con esa fecha «desde».',
  retencion_contraparte_perfiles_desde: 'Ese proveedor ya tiene una versión del perfil con esa fecha «desde».',
  retencion_contraparte_perfiles_abierto: 'Ese proveedor ya tiene un perfil vigente: haz una versión nueva o corrige la vigente.',
  retencion_contraparte_actividades_unica: 'Esa actividad ya está en el perfil del proveedor.',
  retencion_proveedor_actividades_unica: 'Esa actividad ya está en el perfil del proveedor.',
  retencion_contraparte_actividades_principal: 'El proveedor ya tiene una actividad principal: quítale la marca a la otra primero.',
  retencion_proveedor_actividades_principal: 'El proveedor ya tiene una actividad principal: quítale la marca a la otra primero.',
  retencion_impuestos_pkey: 'Ya hay un impuesto con esa clave.',
  retencion_impuesto_versiones_desde: 'Ese impuesto ya tiene una versión con esa fecha «desde».',
  retencion_impuesto_versiones_abierta: 'Ese impuesto ya tiene una versión vigente: haz una versión nueva o corrige la vigente.',
  retencion_parametro_claves_pkey: 'Ya hay un valor con esa clave.',
  retencion_parametros_desde: 'Ese valor ya tiene una versión con esa fecha «desde».',
  retencion_parametros_abierto: 'Ese valor ya tiene una versión vigente: haz una versión nueva o corrige la vigente.',
  retencion_licencia_tipos_nombre: 'Ya hay un tipo de licencia con ese nombre (sin distinguir mayúsculas).',
  retencion_motivos_no_aplica_texto: 'Ya hay un motivo con ese texto en ese impuesto.',
  retencion_supuestos_codigo_unico_sin_mayusculas: 'Ya hay un supuesto con ese código en ese impuesto (sin distinguir mayúsculas).',
  retencion_supuestos_impuesto_clave_codigo_key: 'Ya hay un supuesto con ese código en ese impuesto.',
  retencion_formatos_desde: 'Ese formato ya tiene una versión con esa fecha «desde».',
  retencion_formatos_abierto: 'Ese formato ya tiene una versión vigente: haz una versión nueva o corrige la vigente.',
  retencion_clasificaciones_pkey: 'Ya hay una clasificación con esa clave.',
  retencion_clasificacion_codigos_clasificacion_id_codigo_key: 'Ese código ya existe en la clasificación.',
  retencion_clasificacion_valores_desde: 'Ese código ya tiene un valor con esa fecha «desde».',
  retencion_clasificacion_valores_abierto: 'Ese código ya tiene un valor vigente: haz uno nuevo o corrige el vigente.',
  retencion_tarifas_pkey: 'Ya hay una tarifa con esa clave.',
  retencion_tarifa_versiones_desde: 'Esa tarifa ya tiene una versión con esa fecha «desde».',
  retencion_tarifa_versiones_abierta: 'Esa tarifa ya tiene una versión vigente: haz una versión nueva.',
  retencion_tarifa_tramos_version_id_desde_monto_key: 'Ya hay un tramo que empieza en ese monto.',
  retencion_reglas_impuesto_clave_nombre_version_key: 'Ya hay una regla con ese nombre y versión en el impuesto.',
  retencion_regla_pasos_regla_id_paso_key: 'Esa regla ya tiene ese paso.',
  retencion_decisiones_documento_id_impuesto_clave_key: 'Esa factura ya tiene una decisión para ese impuesto.',
  retencion_periodos_tipo_periodo_tramo_key: 'Ese período ya existe.',
  retencion_isae_actividades_municipio_codigo_key: 'Ese código ya existe en ese municipio.',
};

/** Cómo se dice cada columna en pantalla (para «Falta …»). */
const COLUMNAS: Record<string, string> = {
  motivo: 'el motivo', desde: 'la fecha «desde»', hasta: 'la fecha «hasta»', nombre: 'el nombre', clave: 'la clave',
  impuesto_clave: 'el impuesto', tipo: 'el tipo', documento: 'el documento', codigo: 'el código', texto: 'el texto',
  pct: 'el %', porcentaje: 'el %', sustraendo: 'el sustraendo', desde_monto: '«Más de»', hasta_monto: '«Hasta»',
  valor: 'el valor', unidad: 'la unidad', ambito: 'el ámbito', rif: 'el RIF', fecha: 'la fecha', base: 'la base',
  monto: 'el monto', moneda: 'la moneda', proveedor_id: 'el proveedor', ente_id: 'el ente', clase: 'el tipo de imagen',
  path: 'el archivo', operacion: 'la operación', pieza: 'la pieza', paso: 'el paso', estado: 'el estado', orden: 'el orden',
  prioridad: 'la prioridad', version: 'la versión', minimo_unidad: 'la unidad del mínimo', sujeto: 'el sujeto',
  serie_formato: 'el formato de la serie', serie_modo: 'quién numera la serie', serie_inicial: 'el primer número de la serie',
  serie_ultimo_otro_sistema: 'el último número del otro sistema', numera: 'si numera', numera_operacion: 'si numera la operación',
  agrupa: 'cómo se agrupa', exporta: 'si se exporta', activo: 'si está activo', admite_practicada: 'si admite practicadas',
  admite_sufrida: 'si admite recibidas', periodicidad: 'la periodicidad', vence_dia: 'el día de vencimiento',
  vence_si_inhabil: 'qué pasa si vence en día inhábil', plazo_entrega_dias: 'el plazo de entrega', plazo_dias_habiles: 'si el plazo cuenta días hábiles',
  convive: 'si convive con el otro sistema', otro_sistema_nombre: 'el nombre del otro sistema', otro_sistema_en_totales: 'si el otro sistema entra en los totales',
  base_legal: 'la base legal', fuente: 'la fuente', nota: 'la nota', descripcion: 'la descripción', requiere_texto: 'si pide un detalle',
};

/** Una columna en palabras («serie_inicial» nunca sale cruda): la de este diccionario o la de rotulos.ts. */
export const nombreColumna = (col: string): string => COLUMNAS[col] ?? sinRotulo(col).toLowerCase();

const nombreEntreComillas = (mensaje: string, tras: RegExp) => mensaje.match(tras)?.[1] ?? null;

/** El texto de un único (23505) nombrado en el mensaje, o null. */
export function textoUnico(mensaje: string | null | undefined): string | null {
  const n = nombreEntreComillas(String(mensaje ?? ''), /constraint "([a-z0-9_]+)"/i);
  if (!n) return null;
  if (UNICOS[n]) return UNICOS[n];
  return /_pkey$/.test(n) ? 'Ya existe uno con esa clave.' : null;
}

/** El texto de una restricción de forma o rango nombrada en el mensaje, o null. */
export function textoRestriccion(mensaje: string | null | undefined): string | null {
  const m = String(mensaje ?? '').match(/constraint "([a-z0-9_]+)"/i) ?? String(mensaje ?? '').match(/"([a-z0-9_]+)"\s*$/i);
  return m && RESTRICCIONES[m[1]] ? RESTRICCIONES[m[1]] : null;
}

/** Textos propios de una pantalla para los rechazos genéricos de Postgres. */
export interface TextosError {
  /** 23505: ya existe (nombre, fecha de versión, actividad repetida…). */
  unico?: string;
  /** 23514: no cumple una regla de la tabla. */
  regla?: string;
}

/** El código RET_* que trae un mensaje de la base, o null. */
export function codigoRet(mensaje: string | null | undefined): string | null {
  const m = String(mensaje ?? '').match(/\bRET_[A-Z_]+\b/);
  return m ? m[0] : null;
}

/** Un error de Supabase/PostgREST → un Error con texto de pantalla. */
export function errorRetencion(
  e: { code?: string; message?: string } | null | undefined,
  porDefecto = 'No se pudo completar la operación.',
  textos: TextosError = {},
): Error {
  const code = e?.code ?? '';
  const ret = codigoRet(e?.message);
  if (ret === 'RET_PERFIL_DESDE') {
    const fecha = String(e?.message ?? '').match(/\d{2}\/\d{2}\/\d{4}/)?.[0];
    return new Error(fecha ? `La versión nueva del perfil fiscal tiene que empezar después del ${fecha}, que es cuando empezó la vigente.` : TEXTOS.RET_PERFIL_DESDE);
  }
  if (ret === 'RET_VERSION_DESDE') {
    const fecha = String(e?.message ?? '').match(/\d{2}\/\d{2}\/\d{4}/)?.[0];
    if (fecha) return new Error(`La versión nueva tiene que empezar después del ${fecha}, que es cuando empezó la vigente. Para corregir la vigente, usa «Corregir».`);
  }
  if (ret === 'RET_FORMATO_DESDE') {
    const fecha = String(e?.message ?? '').match(/\d{2}\/\d{2}\/\d{4}/)?.[0];
    if (fecha) return new Error(`La versión nueva del formato tiene que empezar después del ${fecha}, que es cuando empezó la vigente. Para corregir la vigente, edítala.`);
  }
  if (ret === 'RET_PARAMETRO_DESDE') {
    const fecha = String(e?.message ?? '').match(/\d{2}\/\d{2}\/\d{4}/)?.[0];
    if (fecha) return new Error(`El valor nuevo tiene que empezar después del ${fecha}, que es cuando empezó el vigente. Para corregir el vigente, usa «Corregir».`);
  }
  if (ret === 'RET_CLASIFICACION_DESDE') {
    const fecha = String(e?.message ?? '').match(/\d{2}\/\d{2}\/\d{4}/)?.[0];
    if (fecha) return new Error(`El valor nuevo del código tiene que empezar después del ${fecha}, que es cuando empezó el vigente. Para corregir el vigente, usa «Corregir».`);
  }
  // Estos traen en el mensaje el detalle que hace falta (qué tramo, qué condición, qué paso, qué fecha).
  if (ret && ['RET_TARIFA_TRAMOS', 'RET_REGLA_CONDICION', 'RET_REGLA_PASO', 'RET_REGLA_ESTADO', 'RET_TARIFA_DESDE'].includes(ret)) {
    const detalle = String(e?.message ?? '').replace(/^.*?RET_[A-Z_]+:\s*/, '').trim();
    const lead: Record<string, string> = {
      RET_TARIFA_TRAMOS: 'No se puede publicar', RET_REGLA_CONDICION: 'La condición no es válida', RET_REGLA_PASO: 'El paso no es válido',
      RET_REGLA_ESTADO: 'No corresponde', RET_TARIFA_DESDE: 'Fecha de la versión',
    };
    if (detalle) return new Error(`${lead[ret]}: ${detalle.replace(/^no se puede publicar:\s*/i, '')}`);
  }
  if (ret === 'RET_SERIE_INICIAL') {
    const ultimo = String(e?.message ?? '').match(/\((\d+)\)/)?.[1];
    if (ultimo) return new Error(`El primer número de la serie tiene que ser mayor que ${ultimo}, el último del otro sistema.`);
  }
  if (ret && TEXTOS[ret]) return new Error(TEXTOS[ret]);
  const mensaje = String(e?.message ?? '');
  // Un RET_* que no está en la lista: la base lo redacta para la pantalla; se quita el código.
  if (ret) return new Error(sinCodigo(mensaje) || porDefecto);
  if (code === '42501') return new Error(TEXTOS.RET_SIN_PERMISO);
  // D41, Lote 3: cada rechazo de Postgres por su nombre, en español; nada en inglés.
  if (code === '23514') {
    const restriccion = textoRestriccion(mensaje);
    if (restriccion) return new Error(restriccion);
    // El régimen de la empresa (trigger retencion_agente_valido) ya viene redactado.
    if (/^La empresa no puede/.test(mensaje)) return new Error(mensaje);
    if (textos.regla) return new Error(textos.regla);
    const n = nombreEntreComillas(mensaje, /constraint "([a-z0-9_]+)"/i);
    return new Error(`Un dato no cumple una regla de la base${n ? ` (${n})` : ''}: revisa lo que escribiste.`);
  }
  if (code === '23505') {
    const unico = textoUnico(mensaje);
    if (unico) return new Error(unico);
    if (textos.unico) return new Error(textos.unico);
    return new Error('Ya existe un registro igual: revisa que no esté repetido.');
  }
  if (code === '23502') {
    const col = nombreEntreComillas(mensaje, /column "([a-z0-9_]+)"/i);
    return new Error(`Falta ${col ? COLUMNAS[col] ?? `«${col.replace(/_/g, ' ')}»` : 'un dato obligatorio'}.`);
  }
  if (code === '23503') {
    if (/update or delete on table/i.test(mensaje)) return new Error('No se puede borrar: otros datos lo usan.');
    if (/impuesto_clave/i.test(mensaje)) return new Error('Ese impuesto no existe en la base (revisa «Impuestos y reglas»).');
    return new Error('Un dato elegido ya no existe (se borró o no está en el catálogo): vuelve a elegirlo.');
  }
  if (code === '22P02') return new Error('Un dato tiene un formato inválido (número, fecha o identificador): revisa lo que escribiste.');
  if (code === '22007' || code === '22008') return new Error('Una fecha no es válida.');
  if (code === '22003') return new Error('Un número es demasiado grande para la base.');
  if (code === '22001') return new Error('Un texto es demasiado largo para la base.');
  if (e instanceof Error) return e;
  return new Error(e?.message || porDefecto);
}

/** El mensaje de la base sin el prefijo RET_*: «RET_X: algo» → «Algo». */
function sinCodigo(mensaje: string): string {
  const t = mensaje.replace(/^.*?\bRET_[A-Z_]+:?\s*/, '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

const conMayuscula = (t: string) => t[0].toUpperCase() + t.slice(1);

/** Un error de Storage (logos, firma, sello, archivos) en español. */
export function errorStorage(e: { message?: string; statusCode?: string | number } | null | undefined, que = 'el archivo'): Error {
  const m = String(e?.message ?? '');
  const status = String(e?.statusCode ?? '');
  if (/row-level security|unauthorized|not allowed/i.test(m) || status === '403') {
    return new Error(`No se pudo subir ${que}: sin permiso, o el archivo ya está registrado en Retenciones y no se puede reemplazar.`);
  }
  if (/payload too large|too large|maximum allowed size/i.test(m) || status === '413') return new Error(`${conMayuscula(que)} es demasiado grande.`);
  if (/mime|content type|invalid file type/i.test(m)) return new Error(`${conMayuscula(que)} no es de un tipo permitido (PDF o imagen).`);
  if (/exist|duplicate/i.test(m)) return new Error(`Ya hay ${que} con ese nombre: vuelve a intentarlo.`);
  return new Error(`No se pudo subir ${que}. Vuelve a intentarlo.`);
}
