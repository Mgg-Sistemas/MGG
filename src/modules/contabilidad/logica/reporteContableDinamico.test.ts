import { describe, expect, it } from 'vitest';
import {
  AMBITOS_REPORTE_CONTABLE,
  calcularRangoPreset,
  CAMPOS_REPORTE_ASIENTOS,
  CAMPOS_REPORTE_BALANCES,
  CAMPOS_REPORTE_CUENTAS,
  CAMPOS_REPORTE_PERIODOS,
  generarReporteContableDinamico,
  obtenerCamposPorAmbito,
  obtenerColumnasDefectoPorAmbito,
  type ConfiguracionFiltroContable,
  type FuenteReporteContable,
} from './reporteContableDinamico';
import type { ContComprobante, ContComprobanteLinea, ContCuenta } from '../tipos';

describe('Contabilidad · Motor de Reporte Dinámico Multidimensional', () => {
  const cuentasMock: ContCuenta[] = [
    {
      id: 'cta-padre-1', empresa_clave: 'GT', codigo: '1', nombre: 'ACTIVO',
      nivel: 1, padre_id: null, clase: 'activo', naturaleza: 'deudora', es_movimiento: false,
      exige_centro_costo: false, exige_auxiliar: false, tipo_auxiliar: null, moneda: 'VES',
      es_monetaria: true, rubro: 'caja_bancos', activa: true, notas: null, created_at: '2026-01-01T00:00:00Z', created_by: null,
    },
    {
      id: 'cta-padre-2', empresa_clave: 'GT', codigo: '2', nombre: 'PASIVO',
      nivel: 1, padre_id: null, clase: 'pasivo', naturaleza: 'acreedora', es_movimiento: false,
      exige_centro_costo: false, exige_auxiliar: false, tipo_auxiliar: null, moneda: 'VES',
      es_monetaria: true, rubro: 'cuentas_por_pagar', activa: true, notas: null, created_at: '2026-01-01T00:00:00Z', created_by: null,
    },
    {
      id: 'cta-1', empresa_clave: 'GT', codigo: '1.1.01.01.001', nombre: 'CAJA CHICA',
      nivel: 5, padre_id: 'cta-padre-1', clase: 'activo', naturaleza: 'deudora', es_movimiento: true,
      exige_centro_costo: false, exige_auxiliar: false, tipo_auxiliar: null, moneda: 'VES',
      es_monetaria: true, rubro: 'caja_bancos', activa: true, notas: null, created_at: '2026-01-01T00:00:00Z', created_by: null,
    },
    {
      id: 'cta-2', empresa_clave: 'GT', codigo: '2.1.01.01.001', nombre: 'CUENTAS POR PAGAR PROVEEDORES',
      nivel: 5, padre_id: 'cta-padre-2', clase: 'pasivo', naturaleza: 'acreedora', es_movimiento: true,
      exige_centro_costo: false, exige_auxiliar: true, tipo_auxiliar: 'proveedor', moneda: 'VES',
      es_monetaria: true, rubro: 'cuentas_por_pagar', activa: true, notas: null, created_at: '2026-01-01T00:00:00Z', created_by: null,
    },
  ];

  const comprobantesMock: ContComprobante[] = [
    {
      id: 'cbte-1', empresa_clave: 'GT', ejercicio_id: 'ej-2026', tipo_id: 'tipo-01', periodo_id: 'per-2026-10',
      numero: 1, codigo: '10-000001', fecha: '2026-10-15', concepto: 'Pago factura proveedor A',
      moneda_documento: 'USD', tasa: 40, origen_ref: 'FAC-001', origen: 'automatico', origen_modulo: 'compras',
      origen_tabla: null, origen_id: null, numero_lote: null, modificado: false, regla_id: null,
      total_debe_ves: 4000, total_haber_ves: 4000, total_debe_usd: 100, total_haber_usd: 100,
      reverso_de_id: null, estado: 'contabilizado', created_by: 'sistema', updated_by: null,
      created_at: '2026-10-15T10:00:00Z', updated_at: null, historial: [],
    },
    {
      id: 'cbte-2', empresa_clave: 'GT', ejercicio_id: 'ej-2026', tipo_id: 'tipo-09', periodo_id: 'per-2026-10',
      numero: 2, codigo: '10-000002', fecha: '2026-10-20', concepto: 'Ajuste de caja',
      moneda_documento: 'VES', tasa: 40, origen_ref: null, origen: 'manual', origen_modulo: null,
      origen_tabla: null, origen_id: null, numero_lote: null, modificado: false, regla_id: null,
      total_debe_ves: 0, total_haber_ves: 0, total_debe_usd: 0, total_haber_usd: 0,
      reverso_de_id: null, estado: 'contabilizado', created_by: 'usuario', updated_by: null,
      created_at: '2026-10-20T10:00:00Z', updated_at: null, historial: [],
    },
  ];

  const lineasMock: ContComprobanteLinea[] = [
    {
      id: 'lin-1', comprobante_id: 'cbte-1', renglon: 1, cuenta_id: 'cta-2',
      centro_costo_id: null, auxiliar_id: 'aux-1', descripcion: 'Cargo pasivo', referencia: 'FAC-001',
      moneda: 'USD', monto_moneda: 100, tasa: 40, debe_ves: 4000, haber_ves: 0,
      debe_usd: 100, haber_usd: 0, fecha_referencia: null,
    },
    {
      id: 'lin-2', comprobante_id: 'cbte-1', renglon: 2, cuenta_id: 'cta-1',
      centro_costo_id: null, auxiliar_id: null, descripcion: 'Salida de caja', referencia: null,
      moneda: 'USD', monto_moneda: 100, tasa: 40, debe_ves: 0, haber_ves: 4000,
      debe_usd: 0, haber_usd: 100, fecha_referencia: null,
    },
  ];

  const fuente: FuenteReporteContable = {
    comprobantes: comprobantesMock,
    lineas: lineasMock,
    cuentas: cuentasMock,
    centros: [{ id: 'cen-1', empresa_clave: 'GT', codigo: 'OP-01', nombre: 'Planta Mina', padre_id: null, tipo: 'area', origen_clave: null, activo: true }],
    auxiliares: [{ id: 'aux-1', empresa_clave: 'GT', tipo: 'proveedor', codigo: 'PRV-01', nombre: 'Ferretería Industrial', rif: 'J-12345678-9', origen_tabla: null, origen_id: null, activo: true }],
    tipos: [{ id: 'tipo-01', codigo: '01', nombre: 'Cheques', origen: 'ambos', activo: true, sistema: false }],
    periodos: [{ id: 'per-2026-10', empresa_clave: 'GT', ejercicio_id: 'ej-2026', numero: 10, codigo: '202610', fecha_inicio: '2026-10-01', fecha_fin: '2026-10-31', estado: 'abierto', cerrado_en: null, cerrado_por: null, reabierto_en: null, reabierto_por: null, reabierto_motivo: null }],
    ejercicios: [{ id: 'ej-2026', empresa_clave: 'GT', nombre: '2026', fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31', estado: 'abierto', cerrado_en: null, cerrado_por: null, comprobante_cierre_id: null }],
    cierres: [],
  };

  it('los 4 ámbitos cuentan con catálogos de columnas completos', () => {
    expect(AMBITOS_REPORTE_CONTABLE.length).toBe(4);
    expect(CAMPOS_REPORTE_ASIENTOS.length).toBeGreaterThan(10);
    expect(CAMPOS_REPORTE_CUENTAS.length).toBeGreaterThan(8);
    expect(CAMPOS_REPORTE_BALANCES.length).toBeGreaterThan(8);
    expect(CAMPOS_REPORTE_PERIODOS.length).toBeGreaterThan(8);

    expect(obtenerCamposPorAmbito('cuentas')).toBe(CAMPOS_REPORTE_CUENTAS);
    expect(obtenerColumnasDefectoPorAmbito('periodos').length).toBeGreaterThan(5);
  });

  it('ámbito asientos: calcula totales con partida doble cuadrada y bimoneda', () => {
    const config: ConfiguracionFiltroContable = {
      ambito: 'asientos',
      empresaClave: 'GT',
      desde: '2026-10-01',
      hasta: '2026-10-31',
      agrupacion: 'comprobante',
      columnasVisibles: ['fecha', 'comprobante', 'cuenta_codigo', 'debe_ves', 'haber_ves'],
      monedaVista: 'todas',
    };

    const reporte = generarReporteContableDinamico(fuente, config);

    expect(reporte.filas.length).toBe(2);
    expect(reporte.resumen.totalComprobantes).toBe(1);
    expect(reporte.resumen.totalDebeVes).toBe(4000);
    expect(reporte.resumen.totalHaberVes).toBe(4000);
    expect(reporte.resumen.totalDebeUsd).toBe(100);
    expect(reporte.resumen.totalHaberUsd).toBe(100);
    expect(reporte.resumen.cuadra).toBe(true);
  });

  it('ámbito cuentas: genera el catálogo estructural del plan de cuentas', () => {
    const config: ConfiguracionFiltroContable = {
      ambito: 'cuentas',
      empresaClave: 'GT',
      desde: '2026-01-01',
      hasta: '2026-12-31',
      agrupacion: 'cuenta',
      columnasVisibles: ['cuenta_codigo', 'cuenta_nombre', 'nivel', 'clase'],
    };

    const reporte = generarReporteContableDinamico(fuente, config);

    expect(reporte.filas.length).toBe(4);
    expect(reporte.resumen.totalCuentas).toBe(4);
    expect(reporte.resumen.cuentasActivas).toBe(4);
    expect(reporte.resumen.cuentasMovimiento).toBe(2);
    expect(reporte.filas[0].cuenta_codigo).toBe('1');
    expect(reporte.filas[0].clase).toBe('Activo');
  });

  it('ámbito balances: calcula balance de saldos con totales por nivel', () => {
    const config: ConfiguracionFiltroContable = {
      ambito: 'balances',
      empresaClave: 'GT',
      desde: '2026-10-01',
      hasta: '2026-10-31',
      agrupacion: 'cuenta',
      nivelBalance: 5,
      columnasVisibles: ['cuenta_codigo', 'cuenta_nombre', 'debe_ves', 'haber_ves', 'saldo_final_ves'],
    };

    const reporte = generarReporteContableDinamico(fuente, config);

    expect(reporte.filas.length).toBeGreaterThan(0);
    expect(reporte.resumen.totalDebeVes).toBe(4000);
    expect(reporte.resumen.totalHaberVes).toBe(4000);
    expect(reporte.resumen.cuadra).toBe(true);
  });

  it('ámbito periodos: genera auditoría de meses del ejercicio fiscal', () => {
    const config: ConfiguracionFiltroContable = {
      ambito: 'periodos',
      empresaClave: 'GT',
      desde: '2026-01-01',
      hasta: '2026-12-31',
      agrupacion: 'comprobante',
      columnasVisibles: ['ejercicio', 'periodo_numero', 'periodo_nombre', 'periodo_estado'],
    };

    const reporte = generarReporteContableDinamico(fuente, config);

    expect(reporte.filas.length).toBe(1);
    expect(reporte.filas[0].periodo_numero).toBe(10);
    expect(reporte.filas[0].periodo_estado).toBe('Abierto');
    expect(reporte.filas[0].comprobantes_count).toBe(2);
  });

  it('ignora comprobantes de otra empresa (aislamiento estricto)', () => {
    const config: ConfiguracionFiltroContable = {
      ambito: 'asientos',
      empresaClave: 'GL',
      desde: '2026-10-01',
      hasta: '2026-10-31',
      agrupacion: 'comprobante',
      columnasVisibles: ['fecha', 'comprobante'],
      monedaVista: 'todas',
    };

    const reporte = generarReporteContableDinamico(fuente, config);
    expect(reporte.filas.length).toBe(0);
    expect(reporte.resumen.totalComprobantes).toBe(0);
  });

  it('calcula los rangos de presets de período', () => {
    const p1 = calcularRangoPreset('este_ano');
    expect(p1.desde).toMatch(/^\d{4}-01-01$/);
    const p2 = calcularRangoPreset('mes_actual');
    expect(p2.desde).toMatch(/^\d{4}-\d{2}-01$/);
  });
});
