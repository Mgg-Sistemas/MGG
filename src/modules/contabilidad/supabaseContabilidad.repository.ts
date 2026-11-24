/* ============================================================
   Golden Touch · Contabilidad · Repositorio Supabase (En vivo)

   Conexión directa en tiempo real con las tablas `cont_*` en Supabase.
   Aislamiento estricto multi-empresa (`empresa_clave = 'GT'`, 'MTO'...).
   Reutiliza las funciones de cálculo matemático, validación,
   numeración y reportes de la lógica pura (logica/).
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';
import { hoyISO } from '@/shared/lib/format';
import {
  codigoComprobante, descripcionReverso, erroresDeComprobante, mensajeMesCerrado,
  montosDeRenglon, periodoDeFecha, renglonesDeReverso, siguienteNumero, totalesDe,
  type CabeceraBorrador, type ContextoValidacion, type RenglonBorrador,
} from './logica/comprobantes';
import { type FuenteCierre } from './logica/cierres';
import {
  balanceGeneral, columnasResultados, estadoConEquivalente, estadoResultados,
  type EstadoFinanciero, type EstructuraEF, type VarianteResultados,
} from './logica/estados';
import { codigoPadre, compararCodigos, nivelDe, validarNuevaCuenta } from './logica/planCuentas';
import { generarPlanCuentasGT } from './planCuentasGt';
import {
  auxiliaresConEquivalente, balanceComprobacion, balanceConEquivalente, diarioConEquivalente,
  libroDiario, mayorAnalitico, mayorConEquivalente, movimientosAuxiliares,
  type AuxiliarMayor, type BalanceComprobacion, type CuentaMayor, type FiltroAuxiliares,
  type FiltroBalance, type FiltroMayor, type LibroDiario, type MonedaInforme,
} from './logica/reportes';
import type {
  ContAuxiliar, ContCentroCosto, ContCierre, ContComprobante, ContComprobanteLinea,
  ContCuenta, ContEjercicio, ContIntegracion, ContMapeo, ContParametros, ContPeriodo,
  ContTasa, ContTipoComprobante, CuentaInput, Moneda,
} from './tipos';
import type { ComprobanteCompleto, DocumentoIntegracion, ReglaCompleta } from './contabilidad.repository';
import {
  catalogoDe, contabilizarHecho,
  type CatalogoMotor, type ComprobanteGenerado, type HechoContable,
} from './logica/motorReglas';
import { encolarHechoContable, sincronizarHechosOperativos } from './logica/alimentadorModulos';

export { encolarHechoContable, sincronizarHechosOperativos };

const EMPRESA_DEFECTO = 'GT';
const otraMoneda = (m: MonedaInforme): MonedaInforme => (m === 'VES' ? 'USD' : 'VES');

// ── Mapeos de filas Supabase a Tipos del Dominio ─────────────────────────────

function mapCuenta(r: Record<string, unknown>): ContCuenta {
  return {
    id: String(r.id),
    empresa_clave: String(r.empresa_clave ?? EMPRESA_DEFECTO),
    codigo: String(r.codigo),
    nombre: String(r.nombre),
    nivel: Number(r.nivel),
    padre_id: r.padre_id ? String(r.padre_id) : null,
    clase: r.clase as ContCuenta['clase'],
    naturaleza: r.naturaleza as ContCuenta['naturaleza'],
    es_movimiento: Boolean(r.es_movimiento),
    exige_centro_costo: Boolean(r.exige_centro_costo),
    exige_auxiliar: Boolean(r.exige_auxiliar),
    tipo_auxiliar: (r.tipo_auxiliar as ContCuenta['tipo_auxiliar']) ?? null,
    moneda: (r.moneda as Moneda) ?? null,
    es_monetaria: Boolean(r.es_monetaria),
    rubro: r.rubro ? String(r.rubro) : null,
    activa: Boolean(r.activa),
    notas: r.notas ? String(r.notas) : null,
    created_at: String(r.created_at ?? ''),
    created_by: r.created_by ? String(r.created_by) : null,
  };
}

function mapCentro(r: Record<string, unknown>): ContCentroCosto {
  return {
    id: String(r.id),
    empresa_clave: String(r.empresa_clave ?? EMPRESA_DEFECTO),
    codigo: String(r.codigo),
    nombre: String(r.nombre),
    padre_id: r.padre_id ? String(r.padre_id) : null,
    tipo: (r.tipo as ContCentroCosto['tipo']) ?? 'area',
    origen_clave: r.origen_clave ? String(r.origen_clave) : null,
    activo: Boolean(r.activo),
  };
}

function mapAuxiliar(r: Record<string, unknown>): ContAuxiliar {
  return {
    id: String(r.id),
    empresa_clave: String(r.empresa_clave ?? EMPRESA_DEFECTO),
    tipo: r.tipo as ContAuxiliar['tipo'],
    codigo: String(r.codigo),
    nombre: String(r.nombre),
    rif: r.rif ? String(r.rif) : null,
    origen_tabla: null,
    origen_id: r.origen_id ? String(r.origen_id) : null,
    activo: Boolean(r.activo),
  };
}

function mapTipoComprobante(r: Record<string, unknown>): ContTipoComprobante {
  const cod = String(r.codigo);
  return {
    id: String(r.id),
    codigo: cod,
    nombre: String(r.nombre),
    origen: 'ambos',
    activo: Boolean(r.activo),
    sistema: Boolean(cod.match(/^9[0-8]$/)),
  };
}

function mapComprobante(r: Record<string, unknown>): ContComprobante {
  const estadoSql = String(r.estado);
  const estado: ContComprobante['estado'] = estadoSql === 'cuadrado' || estadoSql === 'contabilizado' ? 'contabilizado' : 'descuadrado';
  let historial: ContComprobante['historial'] = [];
  try {
    if (Array.isArray(r.historial)) historial = r.historial as ContComprobante['historial'];
    else if (typeof r.historial === 'string') historial = JSON.parse(r.historial);
  } catch {
    historial = [];
  }

  return {
    id: String(r.id),
    empresa_clave: String(r.empresa_clave ?? EMPRESA_DEFECTO),
    ejercicio_id: String(r.ejercicio_id ?? ''),
    tipo_id: String(r.tipo_id),
    periodo_id: String(r.periodo_id),
    numero: Number(r.numero),
    codigo: String(r.codigo),
    fecha: String(r.fecha),
    concepto: String(r.concepto),
    estado,
    origen: (r.origen as ContComprobante['origen']) ?? 'manual',
    origen_modulo: r.origen_modulo ? String(r.origen_modulo) : null,
    origen_tabla: r.origen_tabla ? String(r.origen_tabla) : null,
    origen_id: r.origen_documento_id ? String(r.origen_documento_id) : (r.origen_id ? String(r.origen_id) : null),
    origen_ref: r.origen_ref ? String(r.origen_ref) : null,
    numero_lote: r.numero_lote ? String(r.numero_lote) : null,
    modificado: Boolean(r.modificado),
    regla_id: r.regla_id ? String(r.regla_id) : null,
    moneda_documento: (r.moneda as Moneda) ?? 'VES',
    tasa: r.tasa_ves ? Number(r.tasa_ves) : (r.tasa ? Number(r.tasa) : null),
    total_debe_ves: Number(r.total_debe_ves ?? 0),
    total_haber_ves: Number(r.total_haber_ves ?? 0),
    total_debe_usd: Number(r.total_debe_usd ?? 0),
    total_haber_usd: Number(r.total_haber_usd ?? 0),
    reverso_de_id: r.reversado_id ? String(r.reversado_id) : (r.reverso_de_id ? String(r.reverso_de_id) : null),
    historial,
    created_at: String(r.created_at ?? ''),
    created_by: r.created_by ? String(r.created_by) : null,
    updated_at: r.updated_at ? String(r.updated_at) : null,
    updated_by: r.updated_by ? String(r.updated_by) : null,
  };
}

function mapLinea(r: Record<string, unknown>): ContComprobanteLinea {
  return {
    id: String(r.id),
    comprobante_id: String(r.comprobante_id),
    renglon: Number(r.renglon),
    cuenta_id: String(r.cuenta_id),
    centro_costo_id: r.centro_costo_id ? String(r.centro_costo_id) : null,
    auxiliar_id: r.auxiliar_id ? String(r.auxiliar_id) : null,
    descripcion: r.descripcion ? String(r.descripcion) : null,
    referencia: r.documento_referencia ? String(r.documento_referencia) : (r.referencia ? String(r.referencia) : null),
    fecha_referencia: r.fecha_referencia ? String(r.fecha_referencia) : null,
    moneda: (r.moneda as Moneda) ?? 'VES',
    monto_moneda: Number(r.monto_moneda ?? (Number(r.debe_ves ?? 0) > 0 ? r.debe_ves : r.haber_ves)),
    tasa: Number(r.tasa ?? 1),
    debe_ves: Number(r.debe_ves ?? 0),
    haber_ves: Number(r.haber_ves ?? 0),
    debe_usd: Number(r.debe_usd ?? 0),
    haber_usd: Number(r.haber_usd ?? 0),
  };
}

// ── Parámetros y Catálogos Maestros ──────────────────────────────────────────

async function autoAprovisionarEjercicioYPeriodos(empresaClave: string): Promise<void> {
  const ejId = `ej-${empresaClave.toLowerCase()}-2026`;
  try {
    await supabase
      .from('cont_ejercicios')
      .upsert({
        id: ejId,
        empresa_clave: empresaClave,
        nombre: '2026',
        fecha_inicio: '2026-01-01',
        fecha_fin: '2026-12-31',
        estado: 'abierto',
      }, { onConflict: 'empresa_clave,nombre' });

    const meses = [
      { num: 1,  ini: '2026-01-01', fin: '2026-01-31' },
      { num: 2,  ini: '2026-02-01', fin: '2026-02-28' },
      { num: 3,  ini: '2026-03-01', fin: '2026-03-31' },
      { num: 4,  ini: '2026-04-01', fin: '2026-04-30' },
      { num: 5,  ini: '2026-05-01', fin: '2026-05-31' },
      { num: 6,  ini: '2026-06-01', fin: '2026-06-30' },
      { num: 7,  ini: '2026-07-01', fin: '2026-07-31' },
      { num: 8,  ini: '2026-08-01', fin: '2026-08-31' },
      { num: 9,  ini: '2026-09-01', fin: '2026-09-30' },
      { num: 10, ini: '2026-10-01', fin: '2026-10-31' },
      { num: 11, ini: '2026-11-01', fin: '2026-11-30' },
      { num: 12, ini: '2026-12-01', fin: '2026-12-31' },
      { num: 13, ini: '2026-12-31', fin: '2026-12-31' },
    ];

    const periodosRows = meses.map((m) => {
      const sufijo = String(m.num).padStart(2, '0');
      return {
        id: `per-${empresaClave.toLowerCase()}-2026${sufijo}`,
        empresa_clave: empresaClave,
        ejercicio_id: ejId,
        numero: m.num,
        codigo: `2026${sufijo}`,
        fecha_inicio: m.ini,
        fecha_fin: m.fin,
        estado: 'abierto',
      };
    });

    await supabase.from('cont_periodos').upsert(periodosRows, { ignoreDuplicates: true });
  } catch (err) {
    console.warn(`Error al auto-aprovisionar ejercicio y períodos para ${empresaClave}:`, err);
  }
}

async function autoAprovisionarParametros(empresaClave: string): Promise<ContParametros> {
  let nombre = empresaClave;
  let moneda: Moneda = 'VES';
  try {
    const { data: emp } = await supabase
      .from('admin_empresas')
      .select('nombre, moneda')
      .eq('clave', empresaClave)
      .maybeSingle();
    if (emp?.nombre) nombre = String(emp.nombre);
    if (emp?.moneda === 'USD' || emp?.moneda === 'VES') moneda = emp.moneda;
  } catch {
    // Si admin_empresas no responde, continuar con defaults
  }

  const nuevoRow = {
    empresa_clave: empresaClave,
    empresa_nombre: nombre,
    mascara_codigo: '9.9.99.99.999',
    niveles: 5,
    moneda_funcional: moneda,
    moneda_referencia: 'USD',
    fuente_tasa: 'bcv',
    tolerancia_cuadre: 0.01,
    tipo_numeracion: 'mes_consecutivo',
    permite_descuadrados: false,
    permite_fecha_futura: false,
    tipo_comprobante_defecto_id: 'tipo-09',
    tipo_diferencial_id: 'tipo-10',
    tipo_cierre_id: 'tipo-11',
    tipo_apertura_id: 'tipo-93',
  };

  try {
    const { data } = await supabase
      .from('cont_parametros')
      .insert(nuevoRow)
      .select('*')
      .maybeSingle();

    await autoAprovisionarEjercicioYPeriodos(empresaClave);

    if (data) {
      return {
        id: true,
        empresa_clave: data.empresa_clave,
        empresa_nombre: data.empresa_nombre ?? nombre,
        centro_costo_defecto_id: null,
        mascara_codigo: data.mascara_codigo ?? '9.9.99.99.999',
        niveles: Number(data.niveles ?? 5),
        moneda_funcional: (data.moneda_funcional as Moneda) ?? moneda,
        moneda_referencia: (data.moneda_referencia as Moneda) ?? 'USD',
        fuente_tasa: (data.fuente_tasa as ContParametros['fuente_tasa']) ?? 'bcv',
        tolerancia_cuadre: Number(data.tolerancia_cuadre ?? 0.01),
        cuenta_resultado_ejercicio_id: null,
        cuenta_utilidades_retenidas_id: null,
        cuenta_dif_cambio_ganancia_id: null,
        cuenta_dif_cambio_perdida_id: null,
        tipo_numeracion: (data.tipo_numeracion as ContParametros['tipo_numeracion']) ?? 'mes_consecutivo',
        permite_descuadrados: Boolean(data.permite_descuadrados),
        permite_fecha_futura: Boolean(data.permite_fecha_futura),
        tipo_comprobante_defecto_id: data.tipo_comprobante_defecto_id ?? 'tipo-09',
        tipo_diferencial_id: data.tipo_diferencial_id ?? 'tipo-10',
        tipo_cierre_id: data.tipo_cierre_id ?? 'tipo-11',
        tipo_apertura_id: data.tipo_apertura_id ?? 'tipo-93',
      };
    }
  } catch (err) {
    console.warn(`No se pudo auto-insertar cont_parametros para ${empresaClave}:`, err);
  }

  return {
    id: true,
    empresa_clave: empresaClave,
    empresa_nombre: nombre,
    centro_costo_defecto_id: null,
    mascara_codigo: '9.9.99.99.999',
    niveles: 5,
    moneda_funcional: moneda,
    moneda_referencia: 'USD',
    fuente_tasa: 'bcv',
    tolerancia_cuadre: 0.01,
    cuenta_resultado_ejercicio_id: null,
    cuenta_utilidades_retenidas_id: null,
    cuenta_dif_cambio_ganancia_id: null,
    cuenta_dif_cambio_perdida_id: null,
    tipo_numeracion: 'mes_consecutivo',
    permite_descuadrados: false,
    permite_fecha_futura: false,
    tipo_comprobante_defecto_id: 'tipo-09',
    tipo_diferencial_id: 'tipo-10',
    tipo_cierre_id: 'tipo-11',
    tipo_apertura_id: 'tipo-93',
  };
}

export async function aplicarPlanCuentasMaestro(empresaClave = EMPRESA_DEFECTO, actor = 'sistema'): Promise<void> {
  const cuentasDef = generarPlanCuentasGT();
  const cuentas = cuentasDef.map((c) => ({
    id: `cta-${empresaClave.toLowerCase()}-${c.codigo.replace(/\./g, '-')}`,
    empresa_clave: empresaClave,
    codigo: c.codigo,
    nombre: c.nombre,
    nivel: c.nivel,
    padre_id: c.padre_id ? `cta-${empresaClave.toLowerCase()}-${c.padre_id.replace(/^cta-/, '')}` : null,
    clase: c.clase,
    naturaleza: c.naturaleza,
    es_movimiento: c.es_movimiento,
    exige_centro_costo: c.exige_centro_costo,
    exige_auxiliar: c.exige_auxiliar,
    tipo_auxiliar: c.tipo_auxiliar,
    moneda: c.moneda,
    es_monetaria: c.es_monetaria,
    rubro: c.rubro,
    activa: true,
    notas: null,
    created_at: new Date().toISOString(),
    created_by: actor,
  }));

  for (let i = 0; i < cuentas.length; i += 50) {
    const chunk = cuentas.slice(i, i + 50);
    const { error } = await supabase
      .from('cont_cuentas')
      .upsert(chunk, { onConflict: 'empresa_clave,codigo' });
    if (error) throw error;
  }
}

export async function getParametros(empresaClave = EMPRESA_DEFECTO): Promise<ContParametros> {
  const { data, error } = await supabase
    .from('cont_parametros')
    .select('*')
    .eq('empresa_clave', empresaClave)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    return autoAprovisionarParametros(empresaClave);
  }

  return {
    id: true,
    empresa_clave: data.empresa_clave,
    empresa_nombre: data.empresa_nombre ?? null,
    centro_costo_defecto_id: data.centro_costo_defecto_id ?? null,
    mascara_codigo: data.mascara_codigo ?? '9.9.99.99.999',
    niveles: Number(data.niveles ?? 5),
    moneda_funcional: (data.moneda_funcional as Moneda) ?? 'VES',
    moneda_referencia: (data.moneda_referencia as Moneda) ?? 'USD',
    fuente_tasa: (data.fuente_tasa as ContParametros['fuente_tasa']) ?? 'bcv',
    tolerancia_cuadre: Number(data.tolerancia_cuadre ?? 0.01),
    cuenta_resultado_ejercicio_id: data.cuenta_resultado_ejercicio_id ?? null,
    cuenta_utilidades_retenidas_id: data.cuenta_utilidades_retenidas_id ?? null,
    cuenta_dif_cambio_ganancia_id: data.cuenta_dif_cambio_ganancia_id ?? null,
    cuenta_dif_cambio_perdida_id: data.cuenta_dif_cambio_perdida_id ?? null,
    tipo_numeracion: (data.tipo_numeracion as ContParametros['tipo_numeracion']) ?? 'mes_consecutivo',
    permite_descuadrados: Boolean(data.permite_descuadrados),
    permite_fecha_futura: Boolean(data.permite_fecha_futura),
    tipo_comprobante_defecto_id: data.tipo_comprobante_defecto_id ?? null,
    tipo_diferencial_id: data.tipo_diferencial_id ?? null,
    tipo_cierre_id: data.tipo_cierre_id ?? null,
    tipo_apertura_id: data.tipo_apertura_id ?? null,
  };
}

export async function modificarTiposDeParametros(
  campos: Partial<Pick<ContParametros, 'tipo_comprobante_defecto_id' | 'tipo_diferencial_id' | 'tipo_cierre_id' | 'tipo_apertura_id'>>,
  _actor?: string,
  empresaClave = EMPRESA_DEFECTO,
): Promise<ContParametros> {
  const { error } = await supabase
    .from('cont_parametros')
    .update({ ...campos, updated_at: new Date().toISOString() })
    .eq('empresa_clave', empresaClave);
  if (error) throw error;
  return getParametros(empresaClave);
}

export async function listCuentas(empresaClave = EMPRESA_DEFECTO): Promise<ContCuenta[]> {
  const { data, error } = await supabase
    .from('cont_cuentas')
    .select('*')
    .eq('empresa_clave', empresaClave)
    .order('codigo', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapCuenta).sort((a, b) => compararCodigos(a.codigo, b.codigo));
}

export async function crearCuenta(input: CuentaInput, actor: string): Promise<ContCuenta> {
  const empresaClave = input.empresa_clave || EMPRESA_DEFECTO;
  const [cuentas, parametros] = await Promise.all([listCuentas(empresaClave), getParametros(empresaClave)]);
  const errores = validarNuevaCuenta(input, cuentas, parametros.mascara_codigo);
  if (errores.length) throw new Error(errores.join(' '));

  const codigo = input.codigo.trim();
  const padre = codigoPadre(codigo);
  const padreId = padre ? cuentas.find((c) => c.codigo === padre)?.id ?? null : null;
  const id = `cta-${empresaClave.toLowerCase()}-${codigo.replace(/\./g, '-')}`;

  const payload = {
    id,
    empresa_clave: empresaClave,
    codigo,
    nombre: input.nombre.trim().toUpperCase(),
    nivel: nivelDe(codigo),
    padre_id: padreId,
    clase: input.clase,
    naturaleza: input.naturaleza,
    es_movimiento: input.es_movimiento,
    exige_centro_costo: input.es_movimiento && input.exige_centro_costo,
    exige_auxiliar: input.es_movimiento && input.exige_auxiliar,
    tipo_auxiliar: input.es_movimiento && input.exige_auxiliar ? input.tipo_auxiliar : null,
    moneda: input.moneda,
    es_monetaria: input.es_monetaria,
    rubro: null,
    activa: true,
    notas: null,
    created_at: new Date().toISOString(),
    created_by: actor,
  };

  const { data, error } = await supabase.from('cont_cuentas').insert(payload).select('*').single();
  if (error) throw error;
  return mapCuenta(data);
}

export async function cambiarActivaCuenta(id: string, activa: boolean): Promise<void> {
  const { data: cuenta, error: errC } = await supabase.from('cont_cuentas').select('*').eq('id', id).single();
  if (errC || !cuenta) throw new Error('La cuenta ya no existe.');

  if (!activa) {
    const { count } = await supabase.from('cont_cuentas').select('id', { count: 'exact', head: true }).eq('padre_id', id).eq('activa', true);
    if ((count ?? 0) > 0) throw new Error(`La cuenta ${cuenta.codigo} tiene subcuentas activas: se inactivan primero.`);
  }

  const { error } = await supabase.from('cont_cuentas').update({ activa }).eq('id', id);
  if (error) throw error;
}

export async function listCentrosCosto(empresaClave = EMPRESA_DEFECTO): Promise<ContCentroCosto[]> {
  const { data, error } = await supabase
    .from('cont_centros_costo')
    .select('*')
    .eq('empresa_clave', empresaClave)
    .order('codigo', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapCentro);
}

export async function listAuxiliares(empresaClave = EMPRESA_DEFECTO): Promise<ContAuxiliar[]> {
  const { data, error } = await supabase
    .from('cont_auxiliares')
    .select('*')
    .eq('empresa_clave', empresaClave)
    .order('codigo', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapAuxiliar);
}

export async function listTiposComprobante(): Promise<ContTipoComprobante[]> {
  const { data, error } = await supabase
    .from('cont_tipos_comprobante')
    .select('*')
    .order('codigo', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapTipoComprobante);
}

export async function listEjercicios(empresaClave = EMPRESA_DEFECTO): Promise<ContEjercicio[]> {
  const { data, error } = await supabase
    .from('cont_ejercicios')
    .select('*')
    .eq('empresa_clave', empresaClave)
    .order('fecha_inicio', { ascending: false });
  if (error) throw error;
  if (!data || data.length === 0) {
    await autoAprovisionarEjercicioYPeriodos(empresaClave);
    const { data: data2 } = await supabase
      .from('cont_ejercicios')
      .select('*')
      .eq('empresa_clave', empresaClave)
      .order('fecha_inicio', { ascending: false });
    if (data2 && data2.length > 0) return data2 as ContEjercicio[];
    return [{
      id: `ej-${empresaClave.toLowerCase()}-2026`,
      empresa_clave: empresaClave,
      nombre: '2026',
      fecha_inicio: '2026-01-01',
      fecha_fin: '2026-12-31',
      estado: 'abierto',
      cerrado_en: null,
      cerrado_por: null,
      comprobante_cierre_id: null,
    }];
  }
  return data as ContEjercicio[];
}

export async function listPeriodos(empresaClave = EMPRESA_DEFECTO): Promise<ContPeriodo[]> {
  const { data, error } = await supabase
    .from('cont_periodos')
    .select('*')
    .eq('empresa_clave', empresaClave)
    .order('codigo', { ascending: true });
  if (error) throw error;
  if (!data || data.length === 0) {
    await autoAprovisionarEjercicioYPeriodos(empresaClave);
    const { data: data2 } = await supabase
      .from('cont_periodos')
      .select('*')
      .eq('empresa_clave', empresaClave)
      .order('codigo', { ascending: true });
    if (data2 && data2.length > 0) return data2 as ContPeriodo[];
  }
  return (data ?? []) as ContPeriodo[];
}

// ── Comprobantes y Asientos Contables ────────────────────────────────────────

export async function listComprobantes(empresaClave = EMPRESA_DEFECTO): Promise<ContComprobante[]> {
  const { data, error } = await supabase
    .from('cont_comprobantes')
    .select('*')
    .eq('empresa_clave', empresaClave)
    .order('fecha', { ascending: false })
    .order('codigo', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapComprobante);
}

export async function getComprobante(id: string): Promise<ComprobanteCompleto> {
  const { data: compData, error: errC } = await supabase
    .from('cont_comprobantes')
    .select('*')
    .eq('id', id)
    .single();
  if (errC || !compData) throw new Error('El comprobante ya no existe.');
  const comprobante = mapComprobante(compData);

  const { data: lineasData, error: errL } = await supabase
    .from('cont_comprobante_lineas')
    .select('*')
    .eq('comprobante_id', id)
    .order('renglon', { ascending: true });
  if (errL) throw errL;
  const lineas = (lineasData ?? []).map(mapLinea);

  const { data: revData } = await supabase
    .from('cont_comprobantes')
    .select('*')
    .eq('reversado_id', id)
    .maybeSingle();
  const reversadoPor = revData ? mapComprobante(revData) : null;

  return { comprobante, lineas, reversadoPor };
}

export async function grabarComprobante(
  input: { id?: string; cabecera: CabeceraBorrador; renglones: RenglonBorrador[] },
  actor: string,
): Promise<ContComprobante> {
  const empresaClave = input.cabecera.empresa_clave || EMPRESA_DEFECTO;
  const [cuentas, centros, auxiliares, periodos, parametros, tipos, comprobantesExistentes] = await Promise.all([
    listCuentas(empresaClave),
    listCentrosCosto(empresaClave),
    listAuxiliares(empresaClave),
    listPeriodos(empresaClave),
    getParametros(empresaClave),
    listTiposComprobante(),
    listComprobantes(empresaClave),
  ]);

  const ctx: ContextoValidacion = {
    cuentas,
    centros,
    auxiliares,
    periodos,
    parametros,
    hoy: hoyISO(),
  };

  const errores = erroresDeComprobante(input.cabecera, input.renglones, ctx);
  if (errores.length > 0) throw new Error(errores.join(' '));

  const periodo = periodoDeFecha(input.cabecera.fecha, periodos);
  if (!periodo) throw new Error('La fecha no corresponde a ningún período abierto.');
  const tipo = tipos.find((t) => t.id === input.cabecera.tipo_id);
  if (!tipo) throw new Error('Tipo de comprobante inválido.');

  const montosLineas = input.renglones.map((r) => montosDeRenglon(r, input.cabecera.tasa));
  const totales = totalesDe(montosLineas);
  const esCuadrado = totales.debe_ves === totales.haber_ves && totales.debe_usd === totales.haber_usd;

  if (!esCuadrado && !parametros.permite_descuadrados) {
    throw new Error('El comprobante está descuadrado y Parámetros no permite guardar descuadrados.');
  }

  const ahora = new Date().toISOString();
  let id = input.id;
  let numero: number;
  let codigo: string;
  let historial: ContComprobante['historial'] = [];

  if (id) {
    const anterior = comprobantesExistentes.find((c) => c.id === id);
    if (!anterior) throw new Error('El comprobante ya no existe.');
    numero = anterior.numero;
    codigo = anterior.codigo;
    historial = [
      ...anterior.historial,
      { at: ahora, evento: 'modificado', actor, detalles: 'Modificación manual' },
    ];
  } else {
    numero = siguienteNumero(comprobantesExistentes, { tipo_id: tipo.id, periodo_id: periodo.id }, parametros.tipo_numeracion, periodos);
    codigo = codigoComprobante(parametros.tipo_numeracion, tipo, periodo, numero);
    id = `cbte-${empresaClave.toLowerCase()}-${periodo.codigo}-${String(numero).padStart(6, '0')}`;
    historial = [{ at: ahora, evento: 'grabado', actor, origen: 'manual' }];
  }

  const payloadCabecera = {
    id,
    empresa_clave: empresaClave,
    codigo,
    numero,
    fecha: input.cabecera.fecha,
    periodo_id: periodo.id,
    tipo_id: tipo.id,
    concepto: input.cabecera.concepto.trim().toUpperCase(),
    moneda: input.cabecera.moneda_documento,
    tasa_ves: input.cabecera.tasa,
    origen: 'manual',
    origen_documento_id: null,
    estado: esCuadrado ? 'cuadrado' : 'descuadrado',
    total_debe_ves: totales.debe_ves,
    total_haber_ves: totales.haber_ves,
    total_debe_usd: totales.debe_usd,
    total_haber_usd: totales.haber_usd,
    diferencia_ves: Math.abs(totales.debe_ves - totales.haber_ves),
    historial,
    created_at: ahora,
    created_by: actor,
    updated_at: id ? ahora : null,
    updated_by: id ? actor : null,
  };

  const { data: compGuardado, error: errComp } = await supabase
    .from('cont_comprobantes')
    .upsert(payloadCabecera)
    .select('*')
    .single();
  if (errComp) throw errComp;

  if (input.id) {
    await supabase.from('cont_comprobante_lineas').delete().eq('comprobante_id', id);
  }

  const payloadLineas = input.renglones.map((r, i) => {
    const ml = montosLineas[i];
    return {
      id: `${id}-l${i + 1}`,
      comprobante_id: id,
      renglon: i + 1,
      cuenta_id: r.cuenta_id,
      centro_costo_id: r.centro_costo_id || null,
      auxiliar_id: r.auxiliar_id || null,
      descripcion: r.descripcion ? r.descripcion.trim() : null,
      documento_referencia: r.referencia ? r.referencia.trim() : null,
      fecha_referencia: r.fecha_referencia || null,
      moneda: r.moneda,
      monto_moneda: r.monto_moneda,
      tasa: r.tasa,
      debe_ves: ml.debe_ves,
      haber_ves: ml.haber_ves,
      debe_usd: ml.debe_usd,
      haber_usd: ml.haber_usd,
      created_at: ahora,
    };
  });

  const { error: errLineas } = await supabase.from('cont_comprobante_lineas').insert(payloadLineas);
  if (errLineas) throw errLineas;

  return mapComprobante(compGuardado);
}

export async function reversarComprobante(id: string, motivo: string, actor: string): Promise<ContComprobante> {
  const { comprobante, lineas, reversadoPor } = await getComprobante(id);
  if (reversadoPor) throw new Error(`El comprobante ya fue reversado por el N° ${reversadoPor.codigo}.`);
  if (comprobante.estado !== 'contabilizado') throw new Error('Solo se pueden reversar comprobantes contabilizados.');

  const empresaClave = comprobante.empresa_clave || EMPRESA_DEFECTO;
  const [periodos, parametros, tipos, comprobantesExistentes] = await Promise.all([
    listPeriodos(empresaClave),
    getParametros(empresaClave),
    listTiposComprobante(),
    listComprobantes(empresaClave),
  ]);

  const periodo = periodos.find((p) => p.id === comprobante.periodo_id);
  if (!periodo) throw new Error('Período contable no encontrado.');
  if (periodo.estado !== 'abierto') throw new Error(mensajeMesCerrado(periodo.codigo));

  const tipo = tipos.find((t) => t.id === comprobante.tipo_id);
  if (!tipo) throw new Error('Tipo de comprobante no encontrado.');

  const numero = siguienteNumero(comprobantesExistentes, { tipo_id: tipo.id, periodo_id: periodo.id }, parametros.tipo_numeracion, periodos);
  const codigo = codigoComprobante(parametros.tipo_numeracion, tipo, periodo, numero);
  const idReverso = `cbte-${empresaClave.toLowerCase()}-${periodo.codigo}-${String(numero).padStart(6, '0')}`;
  const ahora = new Date().toISOString();

  const payloadReverso = {
    id: idReverso,
    empresa_clave: empresaClave,
    codigo,
    numero,
    fecha: comprobante.fecha,
    periodo_id: periodo.id,
    tipo_id: tipo.id,
    concepto: descripcionReverso(comprobante.codigo, motivo),
    moneda: comprobante.moneda_documento,
    tasa_ves: comprobante.tasa ?? 1,
    origen: 'reverso',
    origen_documento_id: comprobante.id,
    estado: 'cuadrado',
    total_debe_ves: comprobante.total_haber_ves,
    total_haber_ves: comprobante.total_debe_ves,
    total_debe_usd: comprobante.total_haber_usd,
    total_haber_usd: comprobante.total_debe_usd,
    diferencia_ves: 0,
    reversado_id: comprobante.id,
    reversado_motivo: motivo,
    historial: [{ at: ahora, evento: 'grabado', actor, origen: 'reverso' }],
    created_at: ahora,
    created_by: actor,
  };

  const { data: revGuardado, error: errR } = await supabase.from('cont_comprobantes').insert(payloadReverso).select('*').single();
  if (errR) throw errR;

  const lineasReverso = renglonesDeReverso(lineas, idReverso).map((l, i) => ({
    id: `${idReverso}-l${i + 1}`,
    comprobante_id: idReverso,
    renglon: i + 1,
    cuenta_id: l.cuenta_id,
    centro_costo_id: l.centro_costo_id,
    auxiliar_id: l.auxiliar_id,
    descripcion: l.descripcion,
    documento_referencia: l.referencia,
    fecha_referencia: l.fecha_referencia,
    moneda: l.moneda,
    monto_moneda: l.monto_moneda,
    tasa: l.tasa,
    debe_ves: l.debe_ves,
    haber_ves: l.haber_ves,
    debe_usd: l.debe_usd,
    haber_usd: l.haber_usd,
    created_at: ahora,
  }));

  const { error: errLR } = await supabase.from('cont_comprobante_lineas').insert(lineasReverso);
  if (errLR) throw errLR;

  const nuevoHistorial = [...comprobante.historial, { at: ahora, evento: 'reversado', actor, reverso: codigo }];
  await supabase.from('cont_comprobantes').update({ reversado_id: idReverso, historial: nuevoHistorial }).eq('id', comprobante.id);

  return mapComprobante(revGuardado);
}

// ── Informes, Balances y Estados Financieros ─────────────────────────────────

async function fuenteInformesSupabase(empresaClave = EMPRESA_DEFECTO): Promise<FuenteCierre> {
  const [cbtesRes, cuentasRes, centrosRes, auxRes] = await Promise.all([
    supabase.from('cont_comprobantes').select('*').eq('empresa_clave', empresaClave).in('estado', ['cuadrado', 'contabilizado']),
    supabase.from('cont_cuentas').select('*').eq('empresa_clave', empresaClave).order('codigo', { ascending: true }),
    supabase.from('cont_centros_costo').select('*').eq('empresa_clave', empresaClave).order('codigo', { ascending: true }),
    supabase.from('cont_auxiliares').select('*').eq('empresa_clave', empresaClave).order('codigo', { ascending: true }),
  ]);

  const comprobantes = (cbtesRes.data ?? []).map(mapComprobante);
  const ids = comprobantes.map((c) => c.id);
  let lineas: ContComprobanteLinea[] = [];
  if (ids.length > 0) {
    const { data: lineasData } = await supabase
      .from('cont_comprobante_lineas')
      .select('*')
      .in('comprobante_id', ids)
      .order('renglon', { ascending: true });
    lineas = (lineasData ?? []).map(mapLinea);
  }

  return {
    comprobantes,
    lineas,
    cuentas: (cuentasRes.data ?? []).map(mapCuenta),
    centros: (centrosRes.data ?? []).map(mapCentro),
    auxiliares: (auxRes.data ?? []).map(mapAuxiliar),
  };
}

export async function getFuenteReporteDinamico(empresaClave = EMPRESA_DEFECTO) {
  const [f, tipos, periodos, ejercicios, cierres] = await Promise.all([
    fuenteInformesSupabase(empresaClave),
    listTiposComprobante(),
    listPeriodos(empresaClave),
    listEjercicios(empresaClave),
    listCierres(empresaClave),
  ]);
  return {
    ...f,
    tipos,
    periodos,
    ejercicios,
    cierres,
  };
}

export async function getLibroDiario(desde: string, hasta: string, moneda: MonedaInforme, empresaClave = EMPRESA_DEFECTO): Promise<LibroDiario> {
  const f = await fuenteInformesSupabase(empresaClave);
  return diarioConEquivalente(libroDiario(f, desde, hasta, moneda), libroDiario(f, desde, hasta, otraMoneda(moneda)));
}

export async function getMayorAnalitico(filtro: FiltroMayor, empresaClave = EMPRESA_DEFECTO): Promise<CuentaMayor[]> {
  const f = await fuenteInformesSupabase(empresaClave);
  return mayorConEquivalente(mayorAnalitico(f, filtro), mayorAnalitico(f, { ...filtro, moneda: otraMoneda(filtro.moneda) }));
}

export async function getMovimientosAuxiliares(filtro: FiltroAuxiliares, empresaClave = EMPRESA_DEFECTO): Promise<AuxiliarMayor[]> {
  const f = await fuenteInformesSupabase(empresaClave);
  return auxiliaresConEquivalente(movimientosAuxiliares(f, filtro), movimientosAuxiliares(f, { ...filtro, moneda: otraMoneda(filtro.moneda) }));
}

export async function getBalanceComprobacion(filtro: FiltroBalance, empresaClave = EMPRESA_DEFECTO): Promise<BalanceComprobacion> {
  const f = await fuenteInformesSupabase(empresaClave);
  return balanceConEquivalente(balanceComprobacion(f, filtro), balanceComprobacion(f, { ...filtro, moneda: otraMoneda(filtro.moneda) }));
}

export async function getEstadoResultados(
  f: { variante: VarianteResultados; corte: string; moneda: MonedaInforme; detallar?: boolean; incluirCierre?: boolean },
  empresaClave = EMPRESA_DEFECTO,
): Promise<EstadoFinanciero> {
  const [fuente, ejercicios, { data: esquemas }] = await Promise.all([
    fuenteInformesSupabase(empresaClave),
    listEjercicios(empresaClave),
    supabase.from('cont_esquemas_ef').select('*').eq('empresa_clave', empresaClave).eq('tipo', 'estado_resultados').eq('por_defecto', true).maybeSingle(),
  ]);

  const fin = `${f.corte}-28`;
  const ej = ejercicios.find((x) => x.fecha_inicio <= fin && fin <= x.fecha_fin) ?? ejercicios[0];
  if (!ej) throw new Error(`No hay un ejercicio que contenga el período ${f.corte}.`);

  const defEsq = (esquemas?.definicion ?? {}) as EstructuraEF['estado_resultados'];
  const estructura: EstructuraEF = {
    balance_general: {} as unknown as EstructuraEF['balance_general'],
    estado_resultados: defEsq,
  };

  const filtro = { columnas: columnasResultados(f.variante, f.corte, ej), detallar: f.detallar, incluirCierre: f.incluirCierre };
  const fuenteC: FuenteCierre = fuente;

  return estadoConEquivalente(
    estadoResultados(fuenteC, estructura, { ...filtro, moneda: f.moneda }),
    estadoResultados(fuenteC, estructura, { ...filtro, moneda: otraMoneda(f.moneda) }),
  );
}

export async function getBalanceGeneral(
  f: { hasta: string; moneda: MonedaInforme; detallar?: boolean },
  empresaClave = EMPRESA_DEFECTO,
): Promise<EstadoFinanciero> {
  const [fuente, ejercicios, { data: esquemas }] = await Promise.all([
    fuenteInformesSupabase(empresaClave),
    listEjercicios(empresaClave),
    supabase.from('cont_esquemas_ef').select('*').eq('empresa_clave', empresaClave).eq('tipo', 'balance_general').eq('por_defecto', true).maybeSingle(),
  ]);

  const [y, m, d] = f.hasta.split('-');
  const filtro = { cortes: [{ etiqueta: `Al ${d}/${m}/${y}`, hasta: f.hasta }], ejercicios, detallar: f.detallar };
  const defEsq = (esquemas?.definicion ?? {}) as EstructuraEF['balance_general'];
  const estructura: EstructuraEF = {
    balance_general: defEsq,
    estado_resultados: {} as unknown as EstructuraEF['estado_resultados'],
  };
  const fuenteC: FuenteCierre = fuente;

  return estadoConEquivalente(
    balanceGeneral(fuenteC, estructura, { ...filtro, moneda: f.moneda }),
    balanceGeneral(fuenteC, estructura, { ...filtro, moneda: otraMoneda(f.moneda) }),
  );
}

// ── Integraciones y Reglas ───────────────────────────────────────────────────

export async function listReglasContabilizacion(empresaClave = EMPRESA_DEFECTO): Promise<ReglaCompleta[]> {
  const [resReglas, resCuentas] = await Promise.all([
    supabase.from('cont_reglas').select('*').eq('empresa_clave', empresaClave).order('codigo'),
    supabase.from('cont_cuentas').select('id, codigo').eq('empresa_clave', empresaClave),
  ]);

  const reglas = resReglas.data ?? [];
  if (resReglas.error) throw resReglas.error;
  if (reglas.length === 0) return [];

  const mapaCuentasCodigo = new Map((resCuentas.data ?? []).map((c) => [c.codigo, c.id]));
  const reglaIds = reglas.map((r) => r.id);
  const { data: lineas, error: errL } = await supabase
    .from('cont_regla_lineas')
    .select('*')
    .in('regla_id', reglaIds)
    .order('renglon');
  if (errL) throw errL;

  return reglas.map((r) => {
    const rl = (lineas ?? []).filter((l) => l.regla_id === r.id);
    return {
      regla: {
        id: r.id,
        empresa_clave: r.empresa_clave,
        codigo: r.codigo,
        nombre: r.nombre,
        origen_modulo: r.modulo,
        pestana: r.modulo,
        evento: r.evento,
        tipo_comprobante_id: r.tipo_comprobante_id,
        condicion: null,
        como_contabilizar: 'inmediata',
        tipo_contabilizacion: 'cada_documento',
        editar_al_generar: false,
        version: 1,
        vigente_desde: r.created_at,
        vigente_hasta: null,
        activa: Boolean(r.activo),
      },
      lineas: rl.map((l) => {
        const ctaIdReal = l.cuenta_codigo ? (mapaCuentasCodigo.get(l.cuenta_codigo) ?? `cta-${l.cuenta_codigo}`) : null;
        return {
          id: l.id,
          regla_id: l.regla_id,
          renglon: Number(l.renglon),
          lado: l.lado as 'debe' | 'haber',
          cuenta_fuente: l.mapeo_codigo ? 'por_mapeo' : 'fija',
          cuenta_id: ctaIdReal,
          mapeo_tipo: null,
          mapeo_campo: l.mapeo_codigo,
          importe: l.monto_campo,
          centro_fuente: 'ninguno',
          centro_costo_id: null,
          auxiliar_fuente: 'ninguno',
          descripcion: l.descripcion_plantilla,
        };
      }),
    };
  });
}

export async function listMapeos(empresaClave = EMPRESA_DEFECTO): Promise<ContMapeo[]> {
  const { data, error } = await supabase
    .from('cont_mapeos')
    .select('*')
    .eq('empresa_clave', empresaClave)
    .order('codigo');
  if (error) throw error;
  return (data ?? []).map((m) => ({
    id: m.id,
    empresa_clave: m.empresa_clave,
    tipo: (m.codigo.toLowerCase().includes('caja') ? 'caja' : 'categoria_gasto') as ContMapeo['tipo'],
    clave: m.clave_origen,
    cuenta_id: m.cuenta_id,
    centro_costo_id: null,
  }));
}

export async function listTasasContables(): Promise<ContTasa[]> {
  const { data: cambios } = await supabase.from('cont_cambios').select('*').order('fecha', { ascending: false });
  const { data: tasasBd } = await supabase.from('tasa_cambio').select('*').order('fecha', { ascending: false }).limit(200);

  const lista: ContTasa[] = [];
  for (const c of cambios ?? []) {
    lista.push({
      id: c.id,
      fecha: c.fecha,
      moneda: c.moneda as Moneda,
      tasa_ves: Number(c.tasa_ves),
      fuente: 'manual',
    });
  }
  for (const t of tasasBd ?? []) {
    lista.push({
      id: `tasa-sys-${t.fecha}-${t.moneda}`,
      fecha: t.fecha,
      moneda: (t.moneda === 'Bs' ? 'VES' : t.moneda) as Moneda,
      tasa_ves: Number(t.tasa ?? t.tasa_bcv ?? 1),
      fuente: 'bcv',
    });
  }

  if (lista.length === 0) {
    const hoy = hoyISO();
    lista.push({ id: 'tasa-base-usd', fecha: hoy, moneda: 'USD', tasa_ves: 50, fuente: 'manual' });
    lista.push({ id: 'tasa-base-ves', fecha: hoy, moneda: 'VES', tasa_ves: 1, fuente: 'manual' });
  }

  return lista;
}

export async function buildCatalogoMotor(empresaClave = EMPRESA_DEFECTO): Promise<CatalogoMotor> {
  const [reglasCompletas, mapeos, cuentas, centros, auxiliares, parametros, tasas] = await Promise.all([
    listReglasContabilizacion(empresaClave),
    listMapeos(empresaClave),
    listCuentas(empresaClave),
    listCentrosCosto(empresaClave),
    listAuxiliares(empresaClave),
    getParametros(empresaClave),
    listTasasContables(),
  ]);

  const mapaCuentasPorCodigo = new Map(cuentas.map((c) => [c.codigo, c]));
  const reglas = reglasCompletas.map((rc) => rc.regla);
  const lineasRegla = reglasCompletas.flatMap((rc) =>
    rc.lineas.map((l) => {
      const cta = l.cuenta_id ? cuentas.find((c) => c.id === l.cuenta_id) : undefined;
      const ctaPorCod = l.cuenta_id ? mapaCuentasPorCodigo.get(l.cuenta_id.replace(/^cta-/, '')) : undefined;
      return {
        ...l,
        cuenta_id: cta?.id ?? ctaPorCod?.id ?? l.cuenta_id ?? '',
      };
    })
  );

  return catalogoDe({
    cont_reglas: reglas,
    cont_regla_lineas: lineasRegla,
    cont_mapeos: mapeos,
    cont_cuentas: cuentas,
    cont_tasas: tasas,
    cont_centros_costo: centros,
    cont_auxiliares: auxiliares,
    cont_parametros: { centro_costo_defecto_id: parametros.centro_costo_defecto_id ?? null },
  });
}

export async function listIntegraciones(
  filtro: { estados?: ContIntegracion['estado'][]; estado?: string; modulo?: string; busqueda?: string } = {},
  empresaClave = EMPRESA_DEFECTO,
): Promise<DocumentoIntegracion[]> {
  let query = supabase.from('cont_integraciones').select('*').eq('empresa_clave', empresaClave);
  if (filtro.estados && filtro.estados.length > 0) {
    query = query.in('estado', filtro.estados);
  } else if (filtro.estado && filtro.estado !== 'todos') {
    query = query.eq('estado', filtro.estado);
  }
  if (filtro.modulo && filtro.modulo !== 'todos') {
    query = query.eq('modulo', filtro.modulo);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  if (!data || data.length === 0) return [];

  let cat: CatalogoMotor | null = null;
  try {
    cat = await buildCatalogoMotor(empresaClave);
  } catch (err) {
    console.warn('No se pudo construir catalogo del motor para integraciones:', err);
  }

  const reglas = cat?.reglas ?? [];

  return data.map((i) => {
    let doc: HechoContable | null = null;
    if (i.datos_origen && typeof i.datos_origen === 'object') {
      doc = i.datos_origen as HechoContable;
    }

    const regla = reglas.find((r) => r.id === i.regla_id || (r.origen_modulo === i.modulo && r.evento === i.evento)) ?? null;

    let debe: { ves: number; usd: number } | null = null;
    if (doc && cat) {
      try {
        const g = contabilizarHecho(doc, cat);
        const s = (k: 'debe_ves' | 'debe_usd') => g.lineas.reduce((a, l) => a + Math.round(l[k] * 100), 0) / 100;
        debe = { ves: s('debe_ves'), usd: s('debe_usd') };
      } catch {
        debe = null;
      }
    }

    return {
      integracion: {
        id: i.id,
        empresa_clave: i.empresa_clave,
        origen_modulo: i.modulo,
        origen_tabla: i.origen_tabla ?? 'modulo_operativo',
        origen_id: i.documento_id,
        evento: i.evento,
        fecha: i.fecha,
        estado: i.estado as ContIntegracion['estado'],
        comprobante_id: i.comprobante_id,
        error: i.error_detalle,
        created_at: i.created_at,
        created_by: null,
        updated_at: null,
        updated_by: null,
      },
      documento: doc,
      regla,
      comprobante: i.comprobante_id ? { id: i.comprobante_id, codigo: i.documento_codigo ?? i.comprobante_id } : null,
      debe,
    };
  });
}

export async function vistaPreviaIntegracion(
  integracionId: string,
  empresaClave = EMPRESA_DEFECTO,
): Promise<ComprobanteGenerado> {
  const { data: integ, error } = await supabase
    .from('cont_integraciones')
    .select('*')
    .eq('id', integracionId)
    .single();

  if (error || !integ) throw new Error('El documento ya no está en la bandeja de integración.');

  const doc = integ.datos_origen as HechoContable;
  if (!doc) throw new Error(`El registro ${integracionId} no contiene datos de origen.`);

  const cat = await buildCatalogoMotor(empresaClave);
  return contabilizarHecho(doc, cat);
}

export async function contabilizarIntegraciones(
  ids: string[],
  actor: string,
  empresaClave = EMPRESA_DEFECTO,
): Promise<{ comprobantes: ContComprobante[]; errores: Array<{ documento: string; error: string }> }> {
  const { data: elegidas, error } = await supabase
    .from('cont_integraciones')
    .select('*')
    .in('id', ids)
    .eq('empresa_clave', empresaClave);

  if (error) throw error;
  if (!elegidas || elegidas.length === 0) return { comprobantes: [], errores: [] };

  const [cat, periodos, parametros, tipos, comprobantesExistentes] = await Promise.all([
    buildCatalogoMotor(empresaClave),
    listPeriodos(empresaClave),
    getParametros(empresaClave),
    listTiposComprobante(),
    listComprobantes(empresaClave),
  ]);

  const comprobantes: ContComprobante[] = [];
  const errores: Array<{ documento: string; error: string }> = [];
  const ahora = new Date().toISOString();

  let cbtesActuales = [...comprobantesExistentes];

  for (const integ of elegidas) {
    try {
      const doc = integ.datos_origen as HechoContable;
      if (!doc) throw new Error(`El registro ${integ.documento_id} no contiene datos de origen.`);

      const periodo = periodoDeFecha(doc.fecha, periodos);
      if (!periodo) throw new Error(`No hay un mes contable para la fecha ${doc.fecha}.`);
      if (periodo.estado !== 'abierto') throw new Error(mensajeMesCerrado(periodo.codigo));

      const generado = contabilizarHecho(doc, cat);
      const tipo = tipos.find((t) => t.id === generado.regla.tipo_comprobante_id) ?? tipos[0];

      const numero = siguienteNumero(cbtesActuales, { tipo_id: tipo.id, periodo_id: periodo.id }, parametros.tipo_numeracion, periodos);
      const codigo = codigoComprobante(parametros.tipo_numeracion, tipo, periodo, numero);
      const compId = `cbte-${empresaClave.toLowerCase()}-${periodo.codigo}-${String(numero).padStart(6, '0')}`;

      const totalDebeVes = generado.lineas.reduce((a, l) => a + Math.round(l.debe_ves * 100), 0) / 100;
      const totalHaberVes = generado.lineas.reduce((a, l) => a + Math.round(l.haber_ves * 100), 0) / 100;
      const totalDebeUsd = generado.lineas.reduce((a, l) => a + Math.round(l.debe_usd * 100), 0) / 100;
      const totalHaberUsd = generado.lineas.reduce((a, l) => a + Math.round(l.haber_usd * 100), 0) / 100;

      const estado: ContComprobante['estado'] =
        totalDebeVes === totalHaberVes && totalDebeUsd === totalHaberUsd ? 'contabilizado' : 'descuadrado';

      const payloadComp = {
        id: compId,
        empresa_clave: empresaClave,
        codigo,
        numero,
        fecha: generado.fecha,
        periodo_id: periodo.id,
        tipo_id: tipo.id,
        concepto: generado.concepto,
        moneda: doc.moneda,
        tasa_ves: generado.tasa,
        origen: 'automatico',
        origen_documento_id: doc.id,
        estado: estado === 'contabilizado' ? 'cuadrado' : 'descuadrado',
        total_debe_ves: totalDebeVes,
        total_haber_ves: totalHaberVes,
        total_debe_usd: totalDebeUsd,
        total_haber_usd: totalHaberUsd,
        diferencia_ves: Math.abs(totalDebeVes - totalHaberVes),
        created_at: ahora,
        created_by: actor,
      };

      const { error: errComp } = await supabase.from('cont_comprobantes').insert(payloadComp);
      if (errComp) throw errComp;

      const lineasPayload = generado.lineas.map((l, idx) => ({
        id: `${compId}-l${idx + 1}`,
        comprobante_id: compId,
        renglon: idx + 1,
        cuenta_id: l.cuenta_id,
        centro_costo_id: l.centro_costo_id,
        auxiliar_id: l.auxiliar_id,
        descripcion: l.descripcion ?? generado.concepto,
        documento_referencia: l.referencia,
        debe_ves: l.debe_ves,
        haber_ves: l.haber_ves,
        debe_usd: l.debe_usd,
        haber_usd: l.haber_usd,
        created_at: ahora,
      }));

      const { error: errLin } = await supabase.from('cont_comprobante_lineas').insert(lineasPayload);
      if (errLin) throw errLin;

      await supabase
        .from('cont_integraciones')
        .update({
          estado: 'contabilizado',
          comprobante_id: compId,
          error_detalle: null,
          contabilizado_en: ahora,
          contabilizado_por: actor,
        })
        .eq('id', integ.id);

      const nuevoComp: ContComprobante = {
        id: compId,
        empresa_clave: empresaClave,
        ejercicio_id: periodo.ejercicio_id,
        tipo_id: tipo.id,
        periodo_id: periodo.id,
        numero,
        codigo,
        fecha: generado.fecha,
        concepto: generado.concepto,
        estado,
        origen: 'automatico',
        origen_modulo: doc.origen_modulo,
        origen_tabla: 'cont_integraciones',
        origen_id: doc.id,
        origen_ref: doc.origen_ref ?? null,
        numero_lote: generado.numero_lote,
        modificado: false,
        regla_id: generado.regla.id,
        moneda_documento: doc.moneda,
        tasa: generado.tasa,
        total_debe_ves: totalDebeVes,
        total_haber_ves: totalHaberVes,
        total_debe_usd: totalDebeUsd,
        total_haber_usd: totalHaberUsd,
        reverso_de_id: null,
        historial: [{ at: ahora, evento: 'grabado', actor, origen: 'automatico' }],
        created_at: ahora,
        created_by: actor,
        updated_at: null,
        updated_by: null,
      };

      comprobantes.push(nuevoComp);
      cbtesActuales.push(nuevoComp);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Error desconocido al contabilizar.';
      errores.push({ documento: integ.documento_id, error: errorMsg });

      await supabase
        .from('cont_integraciones')
        .update({
          estado: 'error',
          error_detalle: errorMsg,
          updated_at: ahora,
          updated_by: actor,
        })
        .eq('id', integ.id);
    }
  }

  return { comprobantes, errores };
}

export async function listCierres(empresaClave = EMPRESA_DEFECTO): Promise<ContCierre[]> {
  const { data, error } = await supabase
    .from('cont_cierres')
    .select('*')
    .eq('empresa_clave', empresaClave)
    .order('cerrado_en', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id,
    empresa_clave: c.empresa_clave,
    tipo: (c.tipo.startsWith('ejercicio') ? 'ejercicio' : 'mes') as ContCierre['tipo'],
    tipo_cierre: c.tipo === 'ejercicio_pre_cierre' ? 'pre_cierre' : (c.tipo === 'ejercicio_definitivo' ? 'definitivo' : null),
    periodo_id: c.periodo_id,
    ejercicio_id: c.ejercicio_id,
    estado: 'vigente',
    comprobante_id: c.comprobante_id,
    saldos: c.foto_saldos ?? {},
    hecho_en: c.cerrado_en,
    hecho_por: c.cerrado_por ?? 'Usuario',
    reabierto_en: null,
    reabierto_por: null,
    reabierto_motivo: null,
  }));
}
