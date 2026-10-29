/* ============================================================
   MGG · Contabilidad · Estado simulado a partir de los datos del Carril BD

   Lee simulacion/datos/bd.json (convertido desde los informes de BD con
   _herramientas/contabilidad/convertir-datos-bd.mjs) y arma el estado de
   la maqueta:
   · catálogos, reglas, mapeos y tasas, con ids estables;
   · los comprobantes, en el orden en que los graba el generador:
     apertura → un comprobante por hecho (con el MOTOR de reglas) → los
     manuales (depreciación, error y reverso, descuadrado, revaluación);
   · la numeración Mes-Consecutivo sale de ese orden.
   El JSON entra con import() dinámico (593 kB, 58 kB con gzip), nunca en
   el import estático: así no engorda el arranque de la app.

   Datos FICTICIOS («Minera Ejemplo, C.A.»): sin RIF, nombres ni montos
   reales de MGG.
   ============================================================ */

import { codigoComprobante, siguienteNumero } from '../logica/comprobantes';
import type { EstructuraEF } from '../logica/estados';
import { MONEDAS_GALAC, MONEDAS_LOCALES_GALAC, PAISES_GALAC, TIPOS_COMPROBANTE_GALAC } from '../logica/catalogosGalac';
import { esTipoDelSistema, normalizarMonedaLocal } from '../logica/catalogos';
import { contabilizarHecho, type HechoContable } from '../logica/motorReglas';
import type {
  ClaseCuenta, ContAuxiliar, ContCentroCosto, ContCierre, ContComprobante, ContComprobanteLinea, ContCuenta, ContEjercicio, ContEsquemaEf, ContIntegracion,
  ContMapeo, ContMoneda, ContParametros, ContPeriodo, ContRegla, ContReglaLinea, ContTasa, ContTipoComprobante,
  EstadoComprobante, EstadoSimulacion, EventoComprobante, Moneda, Naturaleza, OrigenComprobante, TipoAuxiliar, TipoMapeo,
} from '../tipos';

/**
 * Sube cuando cambia la forma de los datos: un estado guardado con otra versión se descarta.
 * 4 = datos de BD v0.4. 5 = con cont_integraciones (datos v1.5: documentos de octubre por contabilizar).
 * 6 = con cont_esquemas_ef (modelo v0.7, C44).
 * 7 = con las listas de fábrica de Galac: monedas, países y monedas locales (E-14, Fase 1).
 */
export const VERSION_DATOS_BD = 8;

type Texto = string;
type ParMonedas = { ves: Texto; usd: Texto };
/** Un estado financiero esperado por BD: renglones (BG-xx, ER-xx, «TOTAL …») y totales o subtotales. */
type EsperadoEstado = { renglones: Record<string, ParMonedas>; totales?: Record<string, ParMonedas>; subtotales?: Record<string, ParMonedas> };
/** La forma de bd.json (la del Carril BD, con los montos como texto decimal). */
export interface DatosBd {
  meta: {
    version: string;
    oraculo: { comprobantes: number; huella: string };
    /** Los 33 comprobantes esperados de los documentos de octubre por contabilizar (v1.5). */
    oraculo_octubre: { comprobantes: number; huella: string };
    fuente: { datos_sha256: string; esperados_sha256: string; octubre_sha256: string };
  };
  parametros: Record<string, Texto | number | boolean | null>;
  monedas: Array<{ codigo: Moneda; nombre: string; simbolo: string; decimales: number }>;
  ejercicio: { nombre: string; fecha_inicio: string; fecha_fin: string; estado: 'abierto' | 'pre_cierre' | 'cerrado' };
  periodos: Array<{ codigo: string; numero: number; estado: 'abierto' | 'cerrado' }>;
  /** v1.7: los 20 tipos de 2 dígitos (los 15 de Galac más 07 a 11), con «sistema» (90-98). */
  tipos_comprobante: Array<{ codigo: string; nombre: string; origen: 'manual' | 'automatico' | 'ambos'; activo: boolean; sistema?: boolean }>;
  cuentas: Array<{
    codigo: string; nombre: string; nivel: number; padre: string | null; clase: ClaseCuenta; naturaleza: Naturaleza;
    es_movimiento: boolean; exige_centro_costo: boolean; exige_auxiliar: boolean; tipo_auxiliar: TipoAuxiliar | null;
    moneda: Moneda | null; es_monetaria: boolean; rubro: string | null; activa: boolean;
  }>;
  centros_costo: Array<{ codigo: string; nombre: string; padre: string | null; tipo: ContCentroCosto['tipo']; activo: boolean }>;
  auxiliares: Array<{ tipo: TipoAuxiliar; codigo: string; nombre: string; rif: string | null; activo: boolean }>;
  mapeos: Array<{ tipo: TipoMapeo; clave: string; cuenta: string; centro: string | null }>;
  reglas: Array<Omit<ContRegla, 'id' | 'tipo_comprobante_id' | 'vigente_hasta'> & {
    tipo_comprobante: string; vigente_hasta?: string | null;
    lineas: Array<Omit<ContReglaLinea, 'id' | 'regla_id' | 'cuenta_id' | 'centro_costo_id'> & { cuenta: string | null; centro?: string | null }>;
  }>;
  tasas: Array<{ fecha: string; moneda: Moneda; tasa_ves: Texto; fuente: ContTasa['fuente'] }>;
  /** La estructura de los estados financieros (v1.4, §6): dato, no código. */
  estructura_ef: EstructuraEF;
  hechos: HechoContable[];
  /** Documentos de octubre sin comprobante (v1.5, §7), sin la respuesta (comprobante_esperado). */
  por_contabilizar: Array<HechoContable & { estado_integracion: 'pendiente' }>;
  manuales: ComprobanteBd[];
  control: {
    comprobantes_por_mes_y_tipo: Record<string, Record<string, number>>;
    totales_por_mes: Record<string, Record<string, Texto>>;
    balance_por_mes: Record<string, Record<string, { saldo_ves: Texto; saldo_usd: Texto }>>;
    hechos_por_mes_y_evento: Record<string, Record<string, number>>;
    /** La corrección exacta del descuadrado 09-000487 (v1.6, C45): con ella se cierra septiembre. */
    correccion_09_000487: {
      comprobante: string; asiento: number; cuenta: string; auxiliar: string;
      haber_ves_antes: Texto; haber_ves_despues: Texto; haber_usd_antes: Texto; haber_usd_despues: Texto; monto_moneda_despues: Texto;
    };
    /** El diferencial esperado por mes; septiembre viene con aplicada = false (se cierra en la maqueta). */
    revaluaciones: Record<string, {
      fecha: string; aplicada: boolean;
      cuentas: Array<{ cuenta: string; centro: string | null; auxiliar: string | null; saldo_moneda: Texto; tasa_cierre: Texto; saldo_ves_antes: Texto; ajuste_ves: Texto }>;
    }>;
    /** Los estados esperados por corte: 202607, 202608, 202609, 202609_con_diferencial (v1.4) y 202609_corregido_y_cerrado (v1.6). */
    estados_financieros: Record<string, {
      fecha_corte: string;
      balance_general: EsperadoEstado;
      estado_resultados: { mes: EsperadoEstado; acumulado_desde_01_07: EsperadoEstado };
    }>;
    por_contabilizar: {
      documentos: number; comprobantes_esperados: number;
      totales: { total_debe_ves: Texto; total_haber_ves: Texto; total_debe_usd: Texto; total_haber_usd: Texto };
    };
  };
}

/** Un comprobante como lo escribe el Carril BD (códigos en vez de ids, montos como texto). */
export interface ComprobanteBd {
  codigo: string; tipo: string; periodo: string; fecha: string; concepto: string; estado: EstadoComprobante;
  origen: OrigenComprobante; tasa: Texto; reverso_de?: string;
  numero_lote: string | null; modificado: boolean; historial: EventoComprobante[];
  lineas: Array<{
    cuenta: string; fecha_referencia: string | null; referencia: string | null; centro: string | null; auxiliar: string | null;
    descripcion: string | null; moneda: Moneda; monto_moneda: Texto; tasa: Texto;
    debe_ves: Texto; haber_ves: Texto; debe_usd: Texto; haber_usd: Texto;
  }>;
}

export const idCuenta = (codigo: string) => `cta-${codigo}`;
export const idCentro = (codigo: string) => `cc-${codigo}`;
export const idAuxiliar = (codigo: string) => `aux-${codigo}`;
export const idTipo = (codigo: string) => `tc-${codigo}`;
export const idPeriodo = (codigo: string) => `per-${codigo}`;
const idRegla = (codigo: string, version: number) => `reg-${codigo}-v${version}`;

const n = (t: Texto | number | null | undefined): number => Number(t ?? 0);
const CREADO = 'simulacion';

/** Carga bd.json con import() dinámico. */
export async function cargarDatosBd(): Promise<DatosBd> {
  const m = await import('./datos/bd.json');
  return (m.default ?? m) as unknown as DatosBd;
}

/**
 * Los documentos de los otros módulos, como los ve Contabilidad: los hechos de julio a
 * septiembre (ya contabilizados) y los de octubre por contabilizar. En la base real son
 * filas de las tablas de cada módulo; aquí salen de bd.json.
 */
export async function cargarDocumentos(): Promise<HechoContable[]> {
  const d = await cargarDatosBd();
  return [...d.hechos, ...d.por_contabilizar.map(({ estado_integracion: _pendiente, ...doc }) => doc)];
}

/** El estado de la maqueta a partir de los datos de BD. */
export async function estadoDesdeBd(datos?: DatosBd): Promise<EstadoSimulacion> {
  return armarEstado(datos ?? (await cargarDatosBd()));
}

export function armarEstado(d: DatosBd): EstadoSimulacion {
  const ejercicio: ContEjercicio = {
    id: `ej-${d.ejercicio.nombre}`, nombre: d.ejercicio.nombre, fecha_inicio: d.ejercicio.fecha_inicio, fecha_fin: d.ejercicio.fecha_fin,
    estado: d.ejercicio.estado, cerrado_en: null, cerrado_por: null, comprobante_cierre_id: null,
  };
  const anio = Number(d.ejercicio.nombre);
  const periodos: ContPeriodo[] = d.periodos.map((p) => {
    const mes = p.numero === 13 ? 12 : p.numero;
    const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    const mm = String(mes).padStart(2, '0');
    return {
      id: idPeriodo(p.codigo), ejercicio_id: ejercicio.id, numero: p.numero, codigo: p.codigo,
      fecha_inicio: p.numero === 13 ? `${anio}-12-31` : `${anio}-${mm}-01`, fecha_fin: `${anio}-${mm}-${ultimo}`,
      estado: p.estado, cerrado_en: null, cerrado_por: null, reabierto_en: null, reabierto_por: null, reabierto_motivo: null,
    };
  });
  // «sistema» es columna generada: se calcula del código, no se copia (v1.7 la trae y coincide).
  const tipos: ContTipoComprobante[] = d.tipos_comprobante.map((t) => ({ id: idTipo(t.codigo), codigo: t.codigo, nombre: t.nombre, origen: t.origen, activo: t.activo, sistema: esTipoDelSistema(t.codigo) }));
  const cuentas: ContCuenta[] = d.cuentas.map((c) => ({
    id: idCuenta(c.codigo), codigo: c.codigo, nombre: c.nombre, nivel: c.nivel, padre_id: c.padre ? idCuenta(c.padre) : null,
    clase: c.clase, naturaleza: c.naturaleza, es_movimiento: c.es_movimiento, exige_centro_costo: c.exige_centro_costo,
    exige_auxiliar: c.exige_auxiliar, tipo_auxiliar: c.tipo_auxiliar, moneda: c.moneda, es_monetaria: c.es_monetaria,
    rubro: c.rubro, activa: c.activa, notas: null, created_at: `${anio}-01-01T08:00:00.000Z`, created_by: CREADO,
  }));
  const centros: ContCentroCosto[] = d.centros_costo.map((c) => ({
    id: idCentro(c.codigo), codigo: c.codigo, nombre: c.nombre, padre_id: c.padre ? idCentro(c.padre) : null, tipo: c.tipo, origen_clave: null, activo: c.activo,
  }));
  const auxiliares: ContAuxiliar[] = d.auxiliares.map((a) => ({
    id: idAuxiliar(a.codigo), tipo: a.tipo, codigo: a.codigo, nombre: a.nombre, rif: a.rif, origen_tabla: null, origen_id: null, activo: a.activo,
  }));
  const monedas: ContMoneda[] = d.monedas.map((m) => ({ ...m, activa: true }));
  const tasas: ContTasa[] = d.tasas.map((t) => ({ id: `tasa-${t.fecha}-${t.moneda}-${t.fuente}`, fecha: t.fecha, moneda: t.moneda, tasa_ves: n(t.tasa_ves), fuente: t.fuente }));
  const mapeos: ContMapeo[] = d.mapeos.map((m) => ({
    id: `map-${m.tipo}-${m.clave}`, tipo: m.tipo, clave: m.clave, cuenta_id: idCuenta(m.cuenta), centro_costo_id: m.centro ? idCentro(m.centro) : null,
  }));
  const reglas: ContRegla[] = [];
  const lineasRegla: ContReglaLinea[] = [];
  for (const r of d.reglas) {
    const id = idRegla(r.codigo, r.version);
    reglas.push({
      id, codigo: r.codigo, nombre: r.nombre, origen_modulo: r.origen_modulo, pestana: r.pestana, evento: r.evento,
      tipo_comprobante_id: idTipo(r.tipo_comprobante), condicion: r.condicion, como_contabilizar: r.como_contabilizar,
      tipo_contabilizacion: r.tipo_contabilizacion, editar_al_generar: r.editar_al_generar, version: r.version,
      vigente_desde: r.vigente_desde, vigente_hasta: r.vigente_hasta ?? null, activa: r.activa,
    });
    r.lineas.forEach((l, i) => lineasRegla.push({
      id: `${id}-l${l.renglon ?? i + 1}`, regla_id: id, renglon: l.renglon ?? i + 1, lado: l.lado, cuenta_fuente: l.cuenta_fuente,
      cuenta_id: l.cuenta ? idCuenta(l.cuenta) : null, mapeo_tipo: l.mapeo_tipo, mapeo_campo: l.mapeo_campo, importe: l.importe,
      centro_fuente: l.centro_fuente, centro_costo_id: l.centro ? idCentro(l.centro) : null, auxiliar_fuente: l.auxiliar_fuente,
      descripcion: l.descripcion,
    }));
  }
  const p = d.parametros;
  const parametros: ContParametros = {
    id: true, mascara_codigo: String(p.mascara_codigo), niveles: Number(p.niveles), moneda_funcional: p.moneda_funcional as Moneda,
    moneda_referencia: p.moneda_referencia as Moneda, fuente_tasa: p.fuente_tasa as ContParametros['fuente_tasa'],
    tolerancia_cuadre: n(p.tolerancia_cuadre as Texto), tipo_numeracion: p.tipo_numeracion as ContParametros['tipo_numeracion'],
    permite_descuadrados: Boolean(p.permite_descuadrados), permite_fecha_futura: Boolean(p.permite_fecha_futura),
    empresa_nombre: (p.empresa_nombre as string) ?? null,
    centro_costo_defecto_id: p.centro_costo_defecto ? idCentro(String(p.centro_costo_defecto)) : null,
    // Los de hoy; llegan de BD con los datos v1.7 (E-15).
    // Los 4 tipos de los procesos vienen de los datos (v1.7: 09, 10, 11 y 93).
    tipo_comprobante_defecto_id: idTipo(String(p.tipo_comprobante_defecto)), tipo_diferencial_id: idTipo(String(p.tipo_diferencial)),
    tipo_cierre_id: idTipo(String(p.tipo_cierre)), tipo_apertura_id: idTipo(String(p.tipo_apertura)),
    cuenta_resultado_ejercicio_id: p.cuenta_resultado_ejercicio ? idCuenta(String(p.cuenta_resultado_ejercicio)) : null,
    cuenta_utilidades_retenidas_id: p.cuenta_utilidades_retenidas ? idCuenta(String(p.cuenta_utilidades_retenidas)) : null,
    cuenta_dif_cambio_ganancia_id: p.cuenta_dif_cambio_ganancia ? idCuenta(String(p.cuenta_dif_cambio_ganancia)) : null,
    cuenta_dif_cambio_perdida_id: p.cuenta_dif_cambio_perdida ? idCuenta(String(p.cuenta_dif_cambio_perdida)) : null,
  };

  const { comprobantes, lineas } = emitirTodo(d, { parametros, periodos, tipos, reglas, lineasRegla, mapeos, cuentas, tasas, ejercicio });

  return {
    version: VERSION_DATOS_BD, cont_parametros: parametros, cont_ejercicios: [ejercicio], cont_periodos: periodos,
    cont_cuentas: cuentas, cont_centros_costo: centros,
    cont_auxiliares: auxiliares, cont_tasas: tasas, cont_comprobantes: comprobantes, cont_comprobante_lineas: lineas,
    cont_reglas: reglas, cont_regla_lineas: lineasRegla, cont_mapeos: mapeos,
    cont_cierres: cierresDeMesesCerrados(d, periodos, comprobantes, parametros),
    cont_integraciones: integracionesDe(d, comprobantes),
    cont_esquemas_ef: esquemasDe(d),
    ...listasDeGalac(monedas, tipos),
  };
}

/**
 * Las listas de fábrica de Galac (BD, contabilidad-catalogos-galac.json): las monedas se SUMAN a las
 * de BD sin tocarlas (VES sigue siendo la funcional, decisión del 29/10 05:00); los tipos de
 * comprobante de 2 dígitos se suman a los de letras, que siguen hasta los datos v1.7 (E-15); países
 * y monedas locales, tal cual.
 */
function listasDeGalac(deBd: ContMoneda[], tiposBd: ContTipoComprobante[]): Pick<EstadoSimulacion, 'cont_monedas' | 'cont_tipos_comprobante' | 'cont_paises' | 'cont_monedas_locales'> {
  const ya = new Set(deBd.map((m) => m.codigo));
  const tiposYa = new Set(tiposBd.map((t) => t.codigo));
  return {
    cont_monedas: [
      ...deBd,
      ...MONEDAS_GALAC.filter((m) => !ya.has(m.codigo)).map((m) => ({ codigo: m.codigo, nombre: m.nombre, simbolo: m.simbolo, decimales: 2, activa: true })),
    ],
    cont_tipos_comprobante: [
      ...tiposBd,
      ...TIPOS_COMPROBANTE_GALAC.filter((t) => !tiposYa.has(t.codigo))
        .map((t) => ({ id: idTipo(t.codigo), codigo: t.codigo, nombre: t.nombre, origen: t.sistema ? 'automatico' as const : 'ambos' as const, activo: true, sistema: t.sistema })),
    ],
    cont_paises: PAISES_GALAC.map((x) => ({ codigo: x.codigo, nombre: x.nombre, activo: true })),
    cont_monedas_locales: MONEDAS_LOCALES_GALAC.map((x) => ({ ...normalizarMonedaLocal(x), activo: true })),
  };
}

/**
 * cont_esquemas_ef de la simulación: un esquema por defecto por tipo, con la definición de
 * estructura_ef tal cual. BD no los siembra (B7: dependen del plan real); la maqueta los arma
 * de los datos para que la pantalla lea la estructura de la tabla, como lo hará en la base.
 */
function esquemasDe(d: DatosBd): ContEsquemaEf[] {
  return (['balance_general', 'estado_resultados'] as const).map((tipo) => ({
    id: `esq-${tipo}`, codigo: tipo, tipo, nombre: d.estructura_ef[tipo].titulo,
    definicion: d.estructura_ef[tipo] as unknown as Record<string, unknown>, por_defecto: true, activo: true,
    created_at: `${d.ejercicio.fecha_inicio}T08:00:00-04:00`, created_by: CREADO, updated_at: null, updated_by: null,
  }));
}

/**
 * cont_integraciones de la simulación: un hecho de julio a septiembre ya «contabilizado» con su
 * comprobante, y un documento de octubre «pendiente» (la bandeja Por contabilizar).
 */
function integracionesDe(d: DatosBd, comprobantes: ContComprobante[]): ContIntegracion[] {
  const porHecho = new Map(comprobantes.filter((c) => c.origen_tabla === 'hechos_simulados').map((c) => [c.origen_id, c.id]));
  const fila = (h: HechoContable, estado: ContIntegracion['estado']): ContIntegracion => ({
    id: `int-${h.id}`, origen_modulo: h.origen_modulo, origen_tabla: 'hechos_simulados', origen_id: h.id, evento: h.evento, fecha: h.fecha,
    estado, comprobante_id: estado === 'contabilizado' ? porHecho.get(h.id) ?? null : null, error: null,
    created_at: `${h.fecha}T18:00:00-04:00`, created_by: CREADO, updated_at: null, updated_by: null,
  });
  return [...d.hechos.map((h) => fila(h, 'contabilizado')), ...d.por_contabilizar.map((h) => fila(h, 'pendiente'))];
}

/**
 * Los meses que BD entrega cerrados (01 a 08) llevan su fila de cierre: el
 * diferencial cambiario del mes (el de revaluación, en julio y agosto, con el tipo del diferencial de Parámetros) y
 * la foto de saldos del control. Así «Abrir Mes» puede reversar ese
 * diferencial, como en un cierre hecho en la maqueta.
 */
function cierresDeMesesCerrados(d: DatosBd, periodos: ContPeriodo[], comprobantes: ContComprobante[], parametros: ContParametros): ContCierre[] {
  const aj = parametros.tipo_diferencial_id;
  return periodos.filter((p) => p.estado === 'cerrado' && p.numero <= 12).map((p) => {
    const rev = comprobantes.find((c) => c.periodo_id === p.id && c.tipo_id === aj && c.origen === 'automatico' && c.origen_modulo === 'contabilidad');
    const foto = d.control.balance_por_mes[p.codigo] ?? {};
    return {
      id: `cierre-${p.codigo}`, tipo: 'mes' as const, tipo_cierre: null, periodo_id: p.id, ejercicio_id: null, estado: 'vigente' as const,
      comprobante_id: rev?.id ?? null,
      saldos: Object.fromEntries(Object.entries(foto).map(([k, v]) => [k, { saldo_ves: n(v.saldo_ves), saldo_usd: n(v.saldo_usd) }])),
      hecho_en: `${p.fecha_fin}T18:00:00-04:00`, hecho_por: CREADO, reabierto_en: null, reabierto_por: null, reabierto_motivo: null,
    };
  });
}

interface Contexto {
  parametros: ContParametros; periodos: ContPeriodo[]; tipos: ContTipoComprobante[]; reglas: ContRegla[];
  lineasRegla: ContReglaLinea[]; mapeos: ContMapeo[]; cuentas: ContCuenta[]; tasas: ContTasa[]; ejercicio: ContEjercicio;
}

/** Graba en el orden del generador y numera según Parámetros (Mes-Consecutivo en los datos de BD). */
function emitirTodo(d: DatosBd, ctx: Contexto): { comprobantes: ContComprobante[]; lineas: ContComprobanteLinea[] } {
  const comprobantes: ContComprobante[] = [];
  const lineas: ContComprobanteLinea[] = [];
  const porCodigo = new Map<string, ContComprobante>();
  const centros = new Set(d.centros_costo.map((c) => c.codigo));
  const auxiliares = new Set(d.auxiliares.map((a) => a.codigo));
  const catalogo = {
    reglas: ctx.reglas, lineasRegla: ctx.lineasRegla, mapeos: ctx.mapeos, cuentas: ctx.cuentas, tasas: ctx.tasas,
    centroId: (c: string) => (centros.has(c) ? idCentro(c) : null),
    auxiliarId: (c: string) => (auxiliares.has(c) ? idAuxiliar(c) : null),
    centroDefectoId: ctx.parametros.centro_costo_defecto_id,
  };

  type Cabecera = Omit<ContComprobante, 'id' | 'numero' | 'codigo' | 'ejercicio_id' | 'periodo_id' | 'created_at' | 'created_by' | 'updated_at' | 'updated_by'>;
  const grabar = (cab: Cabecera, propias: Array<Omit<ContComprobanteLinea, 'id' | 'comprobante_id' | 'renglon'>>) => {
    const periodo = ctx.periodos.find((x) => x.numero !== 13 && x.fecha_inicio <= cab.fecha && cab.fecha <= x.fecha_fin)!;
    const tipo = ctx.tipos.find((t) => t.id === cab.tipo_id)!;
    const numero = siguienteNumero(comprobantes, { tipo_id: tipo.id, periodo_id: periodo.id }, ctx.parametros.tipo_numeracion, ctx.periodos);
    const codigo = codigoComprobante(ctx.parametros.tipo_numeracion, tipo, periodo, numero);
    const id = `cbte-${periodo.codigo}-${String(numero).padStart(6, '0')}`;
    const comp: ContComprobante = {
      ...cab, id, ejercicio_id: ctx.ejercicio.id, periodo_id: periodo.id, numero, codigo,
      created_at: cab.historial[0]?.at ?? `${cab.fecha}T18:00:00-04:00`, created_by: CREADO, updated_at: null, updated_by: null,
    };
    comprobantes.push(comp);
    porCodigo.set(codigo, comp);
    propias.forEach((l, i) => lineas.push({ ...l, id: `${id}-l${i + 1}`, comprobante_id: id, renglon: i + 1 }));
    return comp;
  };

  const totales = (ls: Array<{ debe_ves: number; haber_ves: number; debe_usd: number; haber_usd: number }>) => {
    const s = (k: 'debe_ves' | 'haber_ves' | 'debe_usd' | 'haber_usd') => Math.round(ls.reduce((a, l) => a + Math.round(l[k] * 100), 0)) / 100;
    return { total_debe_ves: s('debe_ves'), total_haber_ves: s('haber_ves'), total_debe_usd: s('debe_usd'), total_haber_usd: s('haber_usd') };
  };

  const grabarManual = (m: ComprobanteBd) => {
    const propias = m.lineas.map((l) => ({
      cuenta_id: idCuenta(l.cuenta), fecha_referencia: l.fecha_referencia, referencia: l.referencia,
      centro_costo_id: l.centro ? idCentro(l.centro) : null, auxiliar_id: l.auxiliar ? idAuxiliar(l.auxiliar) : null,
      descripcion: l.descripcion, moneda: l.moneda, monto_moneda: n(l.monto_moneda), tasa: n(l.tasa),
      debe_ves: n(l.debe_ves), haber_ves: n(l.haber_ves), debe_usd: n(l.debe_usd), haber_usd: n(l.haber_usd),
    }));
    // El historial viene como lo dejó el generador: el «reversado» ya está en el original.
    const reverso = m.reverso_de ? porCodigo.get(m.reverso_de) : undefined;
    grabar({
      tipo_id: idTipo(m.tipo), fecha: m.fecha, concepto: m.concepto, estado: m.estado, origen: m.origen,
      origen_modulo: m.origen === 'automatico' ? 'contabilidad' : null, origen_tabla: null, origen_id: null, origen_ref: null,
      numero_lote: m.numero_lote ?? null, modificado: Boolean(m.modificado), historial: m.historial ?? [],
      regla_id: null, moneda_documento: 'VES', tasa: n(m.tasa), ...totales(propias), reverso_de_id: reverso?.id ?? null,
    }, propias);
  };

  const [apertura, ...resto] = d.manuales;
  grabarManual(apertura);
  for (const h of d.hechos) {
    const g = contabilizarHecho(h, catalogo);
    grabar({
      tipo_id: g.regla.tipo_comprobante_id, fecha: g.fecha, concepto: g.concepto, estado: g.estado, origen: 'automatico',
      origen_modulo: h.origen_modulo, origen_tabla: 'hechos_simulados', origen_id: h.id, origen_ref: h.origen_ref ?? null,
      numero_lote: g.numero_lote, modificado: false,
      historial: [{ at: `${g.fecha}T18:00:00-04:00`, evento: 'grabado', actor: CREADO, origen: 'automatico' }],
      regla_id: g.regla.id, moneda_documento: h.moneda, tasa: g.tasa, ...totales(g.lineas), reverso_de_id: null,
    }, g.lineas.map((l) => ({ ...l, fecha_referencia: null })));
  }
  for (const m of resto) grabarManual(m);
  return { comprobantes, lineas };
}
