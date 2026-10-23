/* ============================================================
   Golden Touch · Retenciones · Rótulos: las palabras de la pantalla

   Regla del usuario (21/10, 11:15): «las palabras del front orientadas al
   usuario». Ninguna pantalla de Retenciones muestra una clave técnica
   (pct_retencion, MUNICIPAL, PJD, AAAAMM8, en_prueba, condicion_agente,
   postgres, «Arranque R7…»). Todas pasan por aquí. Si llega una clave sin
   rótulo: en desarrollo se ve «(sin nombre: clave)» para agregarla al
   diccionario; en producción, la clave en palabras, nunca cruda.
   ============================================================ */
import type { CampoMonto, CondicionRegla, Operador, PasoRegla, Pieza } from './motorReglas';

const EN_DESARROLLO = (() => { try { return Boolean(import.meta.env?.DEV) && import.meta.env?.MODE !== 'test'; } catch { return false; } })();

/** Lo que se muestra cuando una clave no está en el diccionario. */
export function sinRotulo(clave: unknown): string {
  const t = String(clave ?? '').trim();
  if (!t) return '—';
  if (EN_DESARROLLO) return `(sin nombre: ${t})`;
  const palabras = t.replace(/[_-]+/g, ' ').toLowerCase();
  return palabras.charAt(0).toUpperCase() + palabras.slice(1);
}

const de = (dic: Record<string, string>, clave: unknown) => dic[String(clave ?? '')] ?? sinRotulo(clave);

/* ───────── Impuestos ───────── */

const IMPUESTO: Record<string, string> = {
  IVA: 'IVA', ISLR: 'ISLR', MUNICIPAL: 'ISAE (municipal)', ESTADAL: 'Estadal (timbre fiscal)', IGTF: 'IGTF',
  iva: 'IVA', islr: 'ISLR', municipal: 'ISAE (municipal)', regional: 'Estadal (timbre fiscal)', estadal: 'Estadal (timbre fiscal)', igtf: 'IGTF',
};
/** El nombre de un impuesto por su clave (IVA, MUNICIPAL…) o su tipo interno (municipal, regional…). */
export const rotuloImpuesto = (clave: unknown) => (clave == null || clave === '' ? 'Todos los impuestos' : de(IMPUESTO, clave));

/* ───────── Sujetos y contraparte ───────── */

const SUJETO: Record<string, string> = {
  PJD: 'Persona jurídica domiciliada', PJND: 'Persona jurídica no domiciliada', PNR: 'Persona natural residente', PNNR: 'Persona natural no residente',
  pj_domiciliada: 'Persona jurídica domiciliada', pj_no_domiciliada: 'Persona jurídica no domiciliada',
  pn_residente: 'Persona natural residente', pn_no_residente: 'Persona natural no residente', todos: 'Todos los sujetos',
};
export const rotuloSujeto = (s: unknown) => de(SUJETO, s);
/** La sigla con su nombre: «PJD · Persona jurídica domiciliada». */
export const siglaSujeto = (s: unknown) => (SUJETO[String(s)] && /^[A-Z]+$/.test(String(s)) ? `${String(s)} · ${SUJETO[String(s)]}` : rotuloSujeto(s));

/* ───────── Series, unidades, ámbitos, tipos ───────── */

const SERIE: Record<string, string> = { AAAAMM8: 'Año, mes y 8 dígitos (AAAAMM########)', N10: '10 dígitos continuos' };
export const rotuloSerie = (f: unknown) => (f == null || f === '' ? 'Sin número propio' : de(SERIE, f));

const UNIDAD: Record<string, string> = { '%': '%', Bs: 'Bs', UT: 'UT', dias: 'días', MMV: 'MMV (moneda de mayor valor)', USD: '$' };
export const rotuloUnidad = (u: unknown) => (u == null || u === '' ? 'Sin unidad' : de(UNIDAD, u));

const AMBITO: Record<string, string> = { general: 'General (todos los impuestos)', impuesto: 'De un impuesto' };
export const rotuloAmbito = (a: unknown) => de(AMBITO, a);

const TIPO_VALOR: Record<string, string> = { numero: 'Número', texto: 'Texto', si_no: 'Sí / no' };
export const rotuloTipoValor = (t: unknown) => de(TIPO_VALOR, t);

const TIPO_ENTE: Record<string, string> = { nacional: 'Nacional', estadal: 'Estadal', municipal: 'Municipal' };
export const rotuloTipoEnte = (t: unknown) => de(TIPO_ENTE, t);

const CONDICION_AGENTE: Record<string, string> = { agente_retencion: 'Agente de retención', agente_percepcion: 'Agente de percepción', contribuyente_especial: 'Contribuyente especial' };
export const rotuloCondicionAgente = (c: unknown) => de(CONDICION_AGENTE, c);

/* ───────── Parámetros (R3) ───────── */

/** Las claves de valores que siembra la base (R3) y las del JSON de hoy. Las nuevas traen su nombre desde la base. */
const PARAMETRO: Record<string, string> = {
  ut: 'Unidad tributaria', unidad_tributaria: 'Unidad tributaria', alicuota: 'Alícuota', iva_alicuota: 'Alícuota del IVA',
  pct_retencion: '% de retención', iva_retencion: '% de retención del IVA', pct_retencion_art5: '% de retención de los supuestos del art. 5',
  aviso_licencia_dias: 'Aviso de vencimiento de licencia', avisos_activos: 'Avisos activos',
  igtf_alicuota: 'Alícuota del IGTF', municipal_alicuota: 'Alícuota del ISAE', estadal_alicuota: 'Alícuota del timbre estadal',
  factor_sustraendo: 'Factor del sustraendo',
};
/** El nombre de un valor de Parámetros: el que trae la base, o el del diccionario. */
export const rotuloParametro = (clave: unknown, nombreDeLaBase?: string | null) => (nombreDeLaBase?.trim() ? nombreDeLaBase.trim() : de(PARAMETRO, clave));

/* ───────── Estados ───────── */

const ESTADO: Record<string, string> = {
  en_prueba: 'En prueba', vigente: 'Vigente', retirada: 'Retirada', retirado: 'Retirado',
  registrada: 'Registrada', declarada: 'Declarada', anulada: 'Anulada',
  abierto: 'Abierto', declarado: 'Declarado', vencido: 'Vencido', otro_sistema: 'Lo declara el otro sistema',
  practicada: 'La practica la empresa', sufrida: 'Recibida', recibida: 'Recibida',
  no_aplica: 'No aplica', aplica: 'Aplica',
};
export const rotuloEstado = (e: unknown) => de(ESTADO, e);

/* ───────── Historial y autores ───────── */

/** Quién hizo un cambio: la carga inicial de la base se dice «Sistema (carga inicial)». */
export function rotuloAutor(a: string | null | undefined): string {
  const t = String(a ?? '').trim();
  if (!t) return '—';
  if (/^(postgres|supabase_admin|service_role|authenticator|reenlace P03)$/i.test(t)) return 'Sistema (carga inicial)';
  return t;
}

/** Un motivo sembrado por la base (R1…R9, V1…V3, un archivo del código) se dice «Carga inicial del sistema». */
export function rotuloMotivo(m: string | null | undefined): string {
  const t = String(m ?? '').trim();
  if (/^Arranque R7/i.test(t)) return 'Regla inicial: reproduce el cálculo actual. En prueba hasta compararla con el simulador.';
  if (/\b[RV]\d{1,2}\b|\.(ts|tsx|sql)\b|Carga inicial R\d|Valor de arranque/i.test(t)) return 'Carga inicial del sistema';
  return t;
}

/** Qué tabla cambió, en palabras de quien usa la pantalla. */
const TABLA_HISTORIAL: Record<string, string> = {
  retencion_impuestos: 'Datos del impuesto', retencion_impuesto_versiones: 'Cambio de valores vigentes',
  retencion_parametros: 'Cambio de un valor', retencion_parametro_claves: 'Datos de un valor',
  retencion_reglas: 'Regla', retencion_regla_condiciones: 'Condición de una regla', retencion_regla_pasos: 'Paso de una regla',
  retencion_tarifas: 'Tarifa', retencion_tarifa_versiones: 'Versión de una tarifa', retencion_tarifa_tramos: 'Tramo de una tarifa',
  retencion_formatos: 'Formato de impresión', retencion_entes: 'Ente', retencion_ente_logos: 'Logo de un ente',
  retencion_agente_imagenes: 'Firma, sello o logo de la empresa', retencion_agente_condiciones: 'Régimen de la empresa',
  retencion_contraparte_perfiles: 'Perfil fiscal del proveedor', retencion_contraparte_actividades: 'Actividad del proveedor',
  retencion_motivos_no_aplica: 'Motivo de «No aplica»', retencion_supuestos: 'Supuesto del %',
  retencion_clasificaciones: 'Clasificación', retencion_clasificacion_codigos: 'Código de una clasificación', retencion_clasificacion_valores: 'Valor de un código',
  retencion_documentos: 'Factura', adjuntos_directos: 'Archivo de factura',
};
export const rotuloTablaHistorial = (t: unknown) => de(TABLA_HISTORIAL, t);

/* ───────── «Orden» ───────── */

export const ROTULO_ORDEN = 'Posición en la lista';
export const AYUDA_ORDEN = 'Los de número menor aparecen primero (por ejemplo 10, 20, 30).';

/* ───────── Reglas (R7): condiciones, operadores y pasos ───────── */

/** El rótulo de cada pieza en los selectores. */
export const NOMBRE_PIEZA: Record<Pieza, string> = {
  direccion: 'Quién retiene', tipo_documento: 'Tipo de documento', tipo_operacion: 'Tipo de operación', sujeto: 'Tipo de proveedor',
  tipo_contribuyente: 'Tipo de contribuyente del proveedor', condicion_agente: 'Condición de la empresa',
  clasificacion: 'Concepto (clasificación)', monto_minimo: 'Monto mínimo',
};

/** Los operadores, en palabras. */
export const NOMBRE_OPERADOR: Record<Operador, string> = { es: 'es', no_es: 'no es', en: 'es uno de', no_en: 'no es ninguno de' };

/** Cada valor posible de una pieza, con su rótulo (el valor interno no se muestra). */
export const ROTULO_VALOR: Partial<Record<Pieza, Record<string, string>>> = {
  direccion: { practicada: 'La practica la empresa', sufrida: 'Recibida (se la practicaron a la empresa)' },
  tipo_documento: { factura: 'Factura', nota_debito: 'Nota de débito', nota_credito: 'Nota de crédito', pago: 'Pago' },
  tipo_operacion: { bienes: 'Compra de bienes', servicios: 'Servicios', ambos: 'Bienes y servicios' },
  sujeto: { PJD: 'Persona jurídica domiciliada', PJND: 'Persona jurídica no domiciliada', PNR: 'Persona natural residente', PNNR: 'Persona natural no residente' },
  tipo_contribuyente: { ordinario: 'Ordinario', especial: 'Especial', formal: 'Formal', agente_percepcion: 'Agente de percepción' },
  condicion_agente: { ...CONDICION_AGENTE },
};
export const rotuloValorPieza = (p: Pieza, v: unknown) => ROTULO_VALOR[p]?.[String(v)] ?? sinRotulo(v);

/** Los montos de la factura, como se dicen. */
export const NOMBRE_MONTO: Record<CampoMonto, string> = {
  base_imponible: 'la base imponible', exento: 'lo exento', iva: 'el IVA de la factura', igtf: 'el IGTF', subtotal: 'el subtotal', total: 'el total',
  pago: 'el pago', pago_divisas: 'el pago en divisas', descuento: 'el descuento', flete: 'el flete', otros: 'otros cargos',
};

/** Sobre qué se compara un mínimo y el máximo de los topes. */
export const SOBRE_MINIMO: Record<string, string> = { base: 'la base', pago: 'el pago' };
export const TOPE_MAXIMO: Record<string, string> = { impuesto_causado: 'el impuesto causado', base: 'la base' };

const enMinuscula = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const conMayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const QUIEN: Partial<Record<Pieza, string>> = {
  tipo_documento: 'El documento', tipo_operacion: 'La operación', sujeto: 'El proveedor', tipo_contribuyente: 'El proveedor', condicion_agente: 'La empresa',
};

/** Una condición en una frase: «La empresa es agente de retención o contribuyente especial». */
export function fraseCondicion(c: CondicionRegla): string {
  if (c.pieza === 'direccion') {
    const vals = Array.isArray(c.valor) ? c.valor.map(String) : [String(c.valor)];
    const practica = vals.includes('practicada') && !vals.includes('sufrida');
    const recibe = vals.includes('sufrida') && !vals.includes('practicada');
    const niega = c.operador === 'no_es' || c.operador === 'no_en';
    if ((practica && !niega) || (recibe && niega)) return 'La retención la practica la empresa (no la recibe)';
    if ((recibe && !niega) || (practica && niega)) return 'La retención se la practicaron a la empresa (recibida)';
    return 'Vale para las practicadas y las recibidas';
  }
  if (c.pieza === 'clasificacion') {
    const v = (c.valor ?? {}) as { clasificacion?: string; codigos?: string[] };
    const cods = v.codigos?.length ? `, códigos ${v.codigos.join(', ')}` : '';
    return `El concepto ${c.operador === 'no_es' ? 'no es' : 'es'} de la clasificación «${sinRotulo(v.clasificacion)}»${cods}`;
  }
  if (c.pieza === 'monto_minimo') {
    const v = (c.valor ?? {}) as { monto?: number; unidad?: string; sobre?: CampoMonto };
    const sobre = v.sobre ? SOBRE_MINIMO[String(v.sobre)] ?? NOMBRE_MONTO[v.sobre] ?? sinRotulo(v.sobre) : 'el monto';
    return `${conMayuscula(sobre)} ${c.operador === 'no_es' ? 'no llega a' : 'llega a'} ${String(v.monto ?? '')} ${rotuloUnidad(v.unidad)}`.trim();
  }
  const quien = QUIEN[c.pieza] ?? NOMBRE_PIEZA[c.pieza];
  const vals = (Array.isArray(c.valor) ? c.valor : [c.valor]).map((v) => enMinuscula(rotuloValorPieza(c.pieza, v)));
  if (c.operador === 'no_es' || c.operador === 'no_en') return `${quien} no es ${vals.join(' ni ')}`;
  return `${quien} es ${vals.join(' o ')}`;
}

/** Los 8 pasos del cálculo: nombre y qué hace cada uno. */
export const PASO_LEGIBLE: Record<number, { nombre: string; explica: string }> = {
  1: { nombre: 'Base', explica: 'Sobre qué monto de la factura se calcula.' },
  2: { nombre: 'Moneda', explica: 'Lleva los montos a bolívares con la tasa BCV de la fecha de la factura.' },
  3: { nombre: 'Mínimo', explica: 'Si la base no llega al mínimo, no se retiene.' },
  4: { nombre: 'Porcentaje o tarifa', explica: 'El porcentaje (fijo, de Parámetros, del concepto o por tramos) que se aplica a la base.' },
  5: { nombre: 'Sustraendo', explica: 'Lo que se resta al resultado (personas naturales residentes en el ISLR).' },
  6: { nombre: 'Cuánto se retiene', explica: 'Qué parte del impuesto se retiene (por ejemplo, 75 % o 100 % del IVA).' },
  7: { nombre: 'Topes', explica: 'Un mínimo o un máximo para lo retenido.' },
  8: { nombre: 'Redondeo', explica: 'Con cuántos decimales queda el monto.' },
};

/** Cómo se llama cada operación de un paso. */
export const NOMBRE_OPERACION: Record<string, string> = {
  componer_base: 'Sumar y restar montos de la factura', convertir_moneda: 'Convertir a bolívares', comparar_minimo: 'Comparar con un mínimo',
  pct_fijo: 'Porcentaje fijo', pct_parametro: 'Porcentaje de Parámetros', pct_clasificacion: 'Porcentaje del concepto', tramos: 'Tarifa por tramos',
  monto_fijo: 'Monto fijo', restar_sustraendo: 'Restar el sustraendo', retener_pct: 'Retener un porcentaje del impuesto',
  retener_todo: 'Retener todo el impuesto', topes: 'Topes', redondear: 'Redondear',
};
export const rotuloOperacion = (o: unknown) => de(NOMBRE_OPERACION, o);

/** «% de retención» → «el % de retención»; «Alícuota del IVA» → «la alícuota del IVA». */
export function conArticulo(nombre: string): string {
  const t = nombre.trim();
  if (/^(alícuota|unidad|tasa)/i.test(t)) return `la ${enMinuscula(t)}`;
  if (/^(aviso|factor|%|valor)/i.test(t)) return `el ${enMinuscula(t)}`;
  return `el valor «${t}»`;
}

/** El valor vigente de un parámetro, si quien llama lo sabe (para «el % de retención (75 %)»). */
export type ValorVigente = (clave: string) => number | null | undefined;

/** Un paso en una frase: «Base: el IVA de la factura». Un paso que no se usa: «—, no aplica a este impuesto». */
export function frasePaso(p: PasoRegla | null | undefined, valorVigente?: ValorVigente): string {
  if (!p) return '—, no aplica a este impuesto';
  const v = p.valores ?? {};
  const conValor = (clave: unknown) => {
    const n = valorVigente?.(String(clave));
    return `${conArticulo(rotuloParametro(clave))}${n != null ? ` (${n} %)` : ''}`;
  };
  const comps = ((v.componentes as { campo: CampoMonto; signo: string }[] | undefined) ?? [])
    .map((c, i) => `${i === 0 ? (c.signo === '-' ? 'menos ' : '') : c.signo === '-' ? 'menos ' : 'más '}${NOMBRE_MONTO[c.campo] ?? sinRotulo(c.campo)}`).join(' ');
  const detalle: Record<string, string> = {
    componer_base: `${comps || 'la base imponible'}${v.porcion ? ` × ${v.porcion === 'clasificacion' ? 'la porción del concepto' : `${String(v.porcion)} %`}` : ''}`,
    convertir_moneda: 'a bolívares con la tasa BCV de la fecha de la factura',
    comparar_minimo: v.desde === 'clasificacion' ? 'el mínimo del concepto' : `${String(v.monto)} ${rotuloUnidad(v.unidad)}`,
    pct_fijo: `${String(v.pct)} %`, pct_parametro: conValor(v.parametro),
    pct_clasificacion: `el % del concepto de la clasificación «${sinRotulo(v.clasificacion)}»`,
    tramos: `la tarifa por tramos «${sinRotulo(v.tarifa)}»`,
    monto_fijo: `${String(v.monto)} ${rotuloUnidad(v.unidad)}`,
    restar_sustraendo: v.desde === 'clasificacion' ? 'el del concepto' : v.factor != null ? `factor ${String(v.factor)} × UT` : `${String(v.monto)} Bs`,
    retener_pct: v.pct != null
      ? `${String(v.pct)} % del impuesto`
      : `${conValor(v.parametro)}${v.supuestos ? `, o ${valorVigente?.(String(v.supuestos)) ?? 100} % si aplica un supuesto del art. 5` : ''}`,
    retener_todo: 'todo el impuesto',
    topes: [v.minimo != null ? `mínimo ${String(v.minimo)}` : '', v.maximo ? `máximo ${TOPE_MAXIMO[String(v.maximo)] ?? sinRotulo(v.maximo)}` : ''].filter(Boolean).join(' · ') || 'sin topes',
    redondear: `${String(v.decimales)} decimales`,
  };
  return `${PASO_LEGIBLE[p.paso]?.nombre ?? `Paso ${p.paso}`}: ${detalle[p.operacion] ?? rotuloOperacion(p.operacion)}`;
}

/** Los estados de una regla y qué significa cada acción. */
export const ESTADO_REGLA: Record<'en_prueba' | 'vigente' | 'retirada', { nombre: string; ayuda: string }> = {
  en_prueba: { nombre: 'En prueba', ayuda: 'Se puede editar y probar; todavía no calcula retenciones reales.' },
  vigente: { nombre: 'Vigente', ayuda: 'Calcula las retenciones desde su fecha. Para cambiarla, haz una versión nueva.' },
  retirada: { nombre: 'Retirada', ayuda: 'Ya no calcula desde la fecha en que se retiró; queda en el historial.' },
};
export const AYUDA_ACCION = {
  activar: 'Activar: la regla pasa a vigente y calcula las retenciones desde su fecha; la vigente anterior del mismo nombre cierra el día antes.',
  retirar: 'Retirar: la regla deja de calcular desde la fecha que indiques; queda en el historial.',
  nuevaVersion: 'Nueva versión: copia condiciones y pasos en una versión en prueba, desde una fecha, para cambiarla sin tocar la vigente.',
  probar: 'Probar: calcula una operación de ejemplo con esta regla y la compara con el cálculo de hoy. No guarda nada.',
};

/* ───────── «Probar la regla»: la foto del cálculo ───────── */

const DATO_FOTO: Record<string, string> = {
  suma: 'Suma', porcion: 'Porción (%)', base: 'Base', tasa: 'Tasa', baseBs: 'Base en Bs', minimo: 'Mínimo', pct: '%',
  impuesto: 'Impuesto', sustraendoBs: 'Sustraendo en Bs', sustraendo: 'Sustraendo', monto: 'Monto', maximo: 'Máximo',
};
export const rotuloDatoFoto = (k: unknown) => de(DATO_FOTO, k);

/** El detalle de un paso de la foto, sin claves: «+iva -descuento» → «el IVA de la factura menos el descuento». */
export function detalleFoto(operacion: string, detalle: string): string {
  if (operacion !== 'componer_base') return detalle.replace(/impuesto_causado/g, 'el impuesto causado');
  return detalle.replace(/([+-])([a-z_]+)/g, (_m, signo: string, campo: string, i: number) => {
    const nombre = NOMBRE_MONTO[campo as CampoMonto] ?? sinRotulo(campo);
    return `${i === 0 ? (signo === '-' ? 'menos ' : '') : signo === '-' ? 'menos ' : 'más '}${nombre}`;
  }).replace(/^\s+/, '');
}

