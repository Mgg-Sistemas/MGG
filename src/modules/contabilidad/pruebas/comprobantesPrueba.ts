/* ============================================================
   MGG · Contabilidad · Comprobantes CHICOS para las pruebas de la lógica

   Datos FICTICIOS con montos limpios: centros de costo, terceros
   («PROVEEDOR EJEMPLO UNO», sin RIF), una tasa del dólar inventada que
   sube 0,50 Bs por día desde 50,00 el 01/01/2026, y un año de asientos
   que recorre los casos del tramo 2: apertura, compra, pago, venta,
   cobro, nómina, gasto en Bs, depreciación, un comprobante reversado
   (con su motivo) y uno descuadrado a propósito.

   Cada asiento se arma con la misma lógica que usa la pantalla
   (montosDeRenglon, statusDe, siguienteNumero, codigoComprobante).
   ============================================================ */

import {
  codigoComprobante, descripcionReverso, montosDeRenglon, periodoDeFecha, renglonesDeReverso, siguienteNumero, statusDe,
  tasaVigente, totalesDe, type Lado,
} from '../logica/comprobantes';
import type {
  ContAuxiliar, ContCentroCosto, ContComprobante, ContComprobanteLinea, ContCuenta, ContPeriodo, ContTasa,
  ContTipoComprobante, Moneda, TipoAuxiliar, TipoNumeracion,
} from '../tipos';

export function centrosDeEjemplo(): ContCentroCosto[] {
  const filas: Array<[string, string, ContCentroCosto['tipo']]> = [
    ['CC-01', 'SEDE ADMINISTRATIVA', 'sede'],
    ['CC-02', 'PLANTA DE FUNDICIÓN', 'sede'],
    ['CC-03', 'CENTRO DE ACOPIO NORTE', 'centro_acopio'],
    ['CC-04', 'CENTRO DE ACOPIO SUR', 'centro_acopio'],
    ['CC-05', 'FLOTA Y MAQUINARIA', 'area'],
    ['CC-06', 'COMEDOR', 'area'],
  ];
  return filas.map(([codigo, nombre, tipo]) => ({ id: `cc-${codigo}`, codigo, nombre, padre_id: null, tipo, origen_clave: null, activo: true }));
}

export function auxiliaresDeEjemplo(): ContAuxiliar[] {
  const filas: Array<[TipoAuxiliar, string, string]> = [
    ['proveedor', 'PRV-001', 'PROVEEDOR EJEMPLO UNO'],
    ['proveedor', 'PRV-002', 'PROVEEDOR EJEMPLO DOS'],
    ['proveedor', 'PRV-003', 'PROVEEDOR EJEMPLO TRES'],
    ['cliente', 'CLI-001', 'CLIENTE DEL EXTERIOR EJEMPLO'],
    ['cliente', 'CLI-002', 'CLIENTE NACIONAL EJEMPLO'],
    ['empleado', 'EMP-001', 'TRABAJADOR 001'],
    ['empleado', 'EMP-002', 'TRABAJADOR 002'],
    ['banco', 'BCO-001', 'BANCO EJEMPLO UNO'],
    ['banco', 'BCO-002', 'BANCO EJEMPLO DOS'],
    ['centro_acopio', 'ACO-001', 'ACOPIO NORTE'],
    ['centro_acopio', 'ACO-002', 'ACOPIO SUR'],
  ];
  return filas.map(([tipo, codigo, nombre]) => ({
    id: `aux-${codigo}`, tipo, codigo, nombre, rif: null, origen_tabla: null, origen_id: null, activo: true,
  }));
}

/** Tasa ficticia: USD = 50,00 + 0,50 por día desde el 01/01/2026; USDT = USD × 1,04. */
export function tasasDeEjemplo(): ContTasa[] {
  const tasas: ContTasa[] = [];
  for (let d = 0; d < 365; d++) {
    const fecha = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
    const usd = 50 + d * 0.5;
    tasas.push({ id: `tasa-${fecha}-USD`, fecha, moneda: 'USD', tasa_ves: usd, fuente: 'bcv' });
    tasas.push({ id: `tasa-${fecha}-USDT`, fecha, moneda: 'USDT', tasa_ves: Math.round(usd * 1.04 * 100) / 100, fuente: 'binance_p2p' });
  }
  return tasas;
}

interface RenglonEjemplo {
  cuenta: string;
  lado: Lado;
  monto: number;
  moneda?: Moneda;
  centro?: string;
  aux?: string;
  descripcion?: string;
  referencia?: string;
}

interface AsientoEjemplo {
  tipo: string;
  fecha: string;
  concepto: string;
  renglones: RenglonEjemplo[];
  origen_ref?: string;
  /** Si se reversa: el motivo. El reverso se graba en la misma fecha. */
  reversado?: string;
}

const ASIENTOS: AsientoEjemplo[] = [
  { tipo: '93', fecha: '2026-01-01', concepto: 'ASIENTO DE APERTURA DEL EJERCICIO', renglones: [
    { cuenta: '1.1.01.01.002', lado: 'debe', monto: 5000, moneda: 'USD' },
    { cuenta: '1.1.01.03.001', lado: 'debe', monto: 15000, moneda: 'USD' },
    { cuenta: '1.2.01.01.003', lado: 'debe', monto: 30000, moneda: 'USD', centro: 'CC-05' },
    { cuenta: '3.1.01.01.001', lado: 'haber', monto: 50000, moneda: 'USD' },
  ] },
  { tipo: '04', fecha: '2026-02-05', concepto: 'COMPRA DE REPUESTOS PARA MAQUINARIA', origen_ref: 'OC-EJEMPLO-0001', renglones: [
    { cuenta: '1.1.03.02.001', lado: 'debe', monto: 1000, moneda: 'USD', centro: 'CC-05', referencia: 'FACT-0101' },
    { cuenta: '1.1.04.01.001', lado: 'debe', monto: 160, moneda: 'USD', referencia: 'FACT-0101' },
    { cuenta: '2.1.01.01.001', lado: 'haber', monto: 1160, moneda: 'USD', aux: 'PRV-001', referencia: 'FACT-0101' },
  ] },
  { tipo: '01', fecha: '2026-02-10', concepto: 'PAGO A PROVEEDOR EJEMPLO UNO', origen_ref: 'OC-EJEMPLO-0001', renglones: [
    { cuenta: '2.1.01.01.001', lado: 'debe', monto: 1160, moneda: 'USD', aux: 'PRV-001' },
    { cuenta: '1.1.01.01.002', lado: 'haber', monto: 1160, moneda: 'USD' },
  ] },
  { tipo: '05', fecha: '2026-03-15', concepto: 'VENTA DE CASITERITA AL EXTERIOR', origen_ref: 'VTA-EJEMPLO-0001', renglones: [
    { cuenta: '1.1.02.01.002', lado: 'debe', monto: 8000, moneda: 'USD', aux: 'CLI-001' },
    { cuenta: '4.1.01.01.001', lado: 'haber', monto: 8000, moneda: 'USD', aux: 'CLI-001' },
  ] },
  { tipo: '02', fecha: '2026-03-25', concepto: 'COBRO DE LA VENTA VTA-EJEMPLO-0001', renglones: [
    { cuenta: '1.1.01.03.001', lado: 'debe', monto: 8000, moneda: 'USD', referencia: 'TRF-0045' },
    { cuenta: '1.1.02.01.002', lado: 'haber', monto: 8000, moneda: 'USD', aux: 'CLI-001', referencia: 'TRF-0045' },
  ] },
  { tipo: '07', fecha: '2026-04-15', concepto: 'NÓMINA DE LA PRIMERA QUINCENA DE ABRIL', renglones: [
    { cuenta: '6.1.01.01.001', lado: 'debe', monto: 1800, moneda: 'USD', centro: 'CC-01' },
    { cuenta: '6.1.01.01.001', lado: 'debe', monto: 1200, moneda: 'USD', centro: 'CC-02' },
    { cuenta: '2.1.02.01.001', lado: 'haber', monto: 1500, moneda: 'USD', aux: 'EMP-001' },
    { cuenta: '2.1.02.01.001', lado: 'haber', monto: 1500, moneda: 'USD', aux: 'EMP-002' },
  ] },
  { tipo: '01', fecha: '2026-05-12', concepto: 'COMPRA DE COMBUSTIBLE EN BOLÍVARES', renglones: [
    { cuenta: '6.1.02.01.001', lado: 'debe', monto: 23100, moneda: 'VES', centro: 'CC-05' },
    { cuenta: '1.1.01.01.001', lado: 'haber', monto: 23100, moneda: 'VES' },
  ] },
  { tipo: '09', fecha: '2026-06-30', concepto: 'DEPRECIACIÓN DEL SEMESTRE', renglones: [
    { cuenta: '6.1.02.01.004', lado: 'debe', monto: 1500, moneda: 'USD', centro: 'CC-05' },
    { cuenta: '1.2.01.02.002', lado: 'haber', monto: 1500, moneda: 'USD' },
  ] },
  { tipo: '01', fecha: '2026-07-10', concepto: 'COMISIÓN BANCARIA', reversado: 'Se registró dos veces: el banco cobró una sola comisión', renglones: [
    { cuenta: '6.2.01.01.001', lado: 'debe', monto: 25, moneda: 'USD' },
    { cuenta: '1.1.01.02.001', lado: 'haber', monto: 25, moneda: 'USD', aux: 'BCO-001' },
  ] },
  // Descuadrado a propósito: falta la contrapartida de 50 $. Se ve en la lista y NO entra en los saldos.
  { tipo: '09', fecha: '2026-10-15', concepto: 'PROVISIÓN DE SERVICIOS DEL MES', renglones: [
    { cuenta: '6.1.02.01.003', lado: 'debe', monto: 350, moneda: 'USD', centro: 'CC-01' },
    { cuenta: '2.1.01.01.001', lado: 'haber', monto: 300, moneda: 'USD', aux: 'PRV-002' },
  ] },
];

const CREADO_POR = 'simulacion';

/** Arma los comprobantes de ejemplo sobre el plan, los períodos, las tasas y los parámetros dados. */
export function comprobantesDeEjemplo(ctx: {
  cuentas: ContCuenta[]; periodos: ContPeriodo[]; tipos: ContTipoComprobante[]; tasas: ContTasa[];
  tipoNumeracion: TipoNumeracion; tolerancia: number;
}): { comprobantes: ContComprobante[]; lineas: ContComprobanteLinea[] } {
  const comprobantes: ContComprobante[] = [];
  const lineas: ContComprobanteLinea[] = [];
  const cuentaId = (codigo: string) => {
    const c = ctx.cuentas.find((x) => x.codigo === codigo);
    if (!c) throw new Error(`Datos de ejemplo: falta la cuenta ${codigo}.`);
    return c.id;
  };

  const grabar = (a: AsientoEjemplo, id: string, extra: Partial<ContComprobante> = {}, lineasDe?: ContComprobanteLinea[]) => {
    const tipo = ctx.tipos.find((t) => t.codigo === a.tipo)!;
    const periodo = periodoDeFecha(a.fecha, ctx.periodos)!;
    const tasaUsd = tasaVigente(ctx.tasas, 'USD', a.fecha)!;
    const propias = lineasDe ?? a.renglones.map((r, i): ContComprobanteLinea => {
      const moneda = r.moneda ?? 'VES';
      const tasa = tasaVigente(ctx.tasas, moneda, a.fecha)!;
      return {
        id: `${id}-l${i + 1}`, comprobante_id: id, renglon: i + 1, cuenta_id: cuentaId(r.cuenta),
        centro_costo_id: r.centro ? `cc-${r.centro}` : null, auxiliar_id: r.aux ? `aux-${r.aux}` : null,
        descripcion: r.descripcion ?? null, referencia: r.referencia ?? null, fecha_referencia: null,
        moneda, monto_moneda: r.monto, tasa,
        ...montosDeRenglon({ moneda, monto_moneda: r.monto, lado: r.lado, tasa }, tasaUsd),
      };
    });
    const t = totalesDe(propias);
    const estado = statusDe(t, ctx.tolerancia);
    const numero = siguienteNumero(comprobantes, { tipo_id: tipo.id, periodo_id: periodo.id }, ctx.tipoNumeracion, ctx.periodos);
    const momento = `${a.fecha}T12:00:00.000Z`;
    const comp: ContComprobante = {
      id, ejercicio_id: periodo.ejercicio_id, tipo_id: tipo.id, periodo_id: periodo.id, numero,
      codigo: codigoComprobante(ctx.tipoNumeracion, tipo, periodo, numero),
      fecha: a.fecha, concepto: a.concepto, estado, origen: 'manual', origen_modulo: null, origen_tabla: null,
      origen_id: null, origen_ref: a.origen_ref ?? null, numero_lote: null, modificado: false, regla_id: null,
      moneda_documento: 'USD', tasa: tasaUsd,
      total_debe_ves: t.debe_ves, total_haber_ves: t.haber_ves, total_debe_usd: t.debe_usd, total_haber_usd: t.haber_usd,
      reverso_de_id: null, historial: [{ at: momento, evento: 'grabado', actor: CREADO_POR, origen: extra.origen ?? 'manual' }],
      created_at: momento, created_by: CREADO_POR, updated_at: null, updated_by: null,
      ...extra,
    };
    comprobantes.push(comp);
    lineas.push(...propias);
    return { comp, propias };
  };

  ASIENTOS.forEach((a, i) => {
    const id = `cbte-${String(i + 1).padStart(3, '0')}`;
    const { comp, propias } = grabar(a, id);
    if (a.reversado) {
      const idReverso = `${id}-rev`;
      const { comp: rev } = grabar(
        { ...a, concepto: descripcionReverso(comp.codigo, a.reversado), reversado: undefined },
        idReverso,
        { origen: 'reverso', reverso_de_id: id, created_at: `${a.fecha}T15:00:00.000Z` },
        renglonesDeReverso(propias, idReverso),
      );
      comp.historial.push({ at: rev.created_at, evento: 'reversado', actor: CREADO_POR, reverso: rev.codigo });
    }
  });
  return { comprobantes, lineas };
}
