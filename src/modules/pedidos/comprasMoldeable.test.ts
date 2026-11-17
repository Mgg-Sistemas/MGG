import { describe, expect, test } from 'vitest';
import type { Orden } from '@/shared/lib/types';
import type { CompraDirecta } from './compras.repository';
import type { ServicioDirecto } from './serviciosDirectos.repository';
import {
  clasificarEstadoOrden,
  clasificarEstadoDirectaServicio,
  montoUsdBs,
  normalizarDepartamento,
  normalizarOrdenes,
  normalizarDirectas,
  normalizarServicios,
  normalizarItemsOrdenes,
  filtrarFilasCompras,
  resumenCompras,
  procesarFilasCompras,
  obtenerMetricasFichaCompras,
  CAMPOS_REPORTE_COMPRAS,
  SIN_DEPARTAMENTO,
  SIN_CATEGORIA_INV,
  type ContextoCompras,
  type FilaReporteCompras,
} from './comprasMoldeable';

/* ───────────── Fábricas de FILAS normalizadas ───────────── */

function filaBase(over: Partial<FilaReporteCompras> = {}): FilaReporteCompras {
  return {
    id: `f-${(seq += 1)}`, ambito: 'ordenes', tipo_compra: 'orden',
    fecha: '2026-11-05', codigo: 'OC-X', departamento: 'Mina', proveedor: '—',
    estado: 'pagada', estado_rotulo: 'Pagada', clase_estado: 'finalizada',
    categoria: '', categoria_gasto: null, nombre_item: '', cantidad: null,
    moneda_original: 'USD', monto_original: over.monto_usd ?? 0,
    monto_usd: 0, monto_bs: 0, pagado_usd: 0, pagado_bs: 0,
    ...over,
  };
}
const filaOrdFix = (over: Partial<FilaReporteCompras> = {}) => filaBase({ ambito: 'ordenes', ...over });
const filaItemFix = (over: Partial<FilaReporteCompras> = {}) =>
  filaBase({ ambito: 'items', categoria: 'Ferretería', nombre_item: 'Ítem', cantidad: 1, ...over });

/* ───────────── Fábricas de fixtures ───────────── */

function ctxFix(over: Partial<ContextoCompras> = {}): ContextoCompras {
  return {
    tasaBcv: 40,
    categoriasPorSku: new Map(),
    nombreProveedor: new Map(),
    ...over,
  };
}

let seq = 0;
function ordenFix(over: Partial<Orden> = {}): Orden {
  seq += 1;
  return {
    id: `ord-${seq}`, codigo: `OC-${seq}`, estado: 'pagada',
    proveedor_id: null, unidad_solicitante: null, items: [],
    total: 0, total_moneda: 'USD', created_at: '2026-11-05T10:00:00Z',
    ...over,
  } as unknown as Orden;
}
function directaFix(over: Partial<CompraDirecta> = {}): CompraDirecta {
  seq += 1;
  return {
    id: `cd-${seq}`, codigo: `CD-${seq}`, estado: 'finalizada',
    gasto: 0, moneda: 'USD', gasto_categoria: null, items: [],
    created_at: '2026-11-05T10:00:00Z',
    ...over,
  } as unknown as CompraDirecta;
}
function servicioFix(over: Partial<ServicioDirecto> = {}): ServicioDirecto {
  seq += 1;
  return {
    id: `sd-${seq}`, codigo: `SD-${seq}`, estado: 'finalizada',
    gasto: 0, moneda: 'USD', unidad_solicitante: null, abonado_total: 0, items: [],
    created_at: '2026-11-05T10:00:00Z',
    ...over,
  } as unknown as ServicioDirecto;
}

describe('comprasMoldeable · fundamentos (T1)', () => {
  test('clasificarEstadoOrden mapea finalizadas, pendientes y excluidas', () => {
    expect(clasificarEstadoOrden('pagada')).toBe('finalizada');
    expect(clasificarEstadoOrden('recibida')).toBe('finalizada');
    expect(clasificarEstadoOrden('por_recibir')).toBe('finalizada');
    expect(clasificarEstadoOrden('oc_emitida')).toBe('pendiente');
    expect(clasificarEstadoOrden('cuenta_abierta')).toBe('pendiente');
    expect(clasificarEstadoOrden('oc_creada')).toBe('pendiente');
    expect(clasificarEstadoOrden('cancelada')).toBe('excluida');
    expect(clasificarEstadoOrden('rechazada')).toBe('excluida');
    expect(clasificarEstadoOrden('pendiente')).toBe('excluida'); // solicitud, no compra
  });

  test('clasificarEstadoDirectaServicio excluye en_proceso', () => {
    expect(clasificarEstadoDirectaServicio('finalizada')).toBe('finalizada');
    expect(clasificarEstadoDirectaServicio('por_pagar')).toBe('pendiente');
    expect(clasificarEstadoDirectaServicio('en_proceso')).toBe('excluida');
  });

  test('montoUsdBs no divide por cero sin tasa', () => {
    expect(montoUsdBs(1200, 'Bs', 0)).toEqual({ usd: 0, bs: 1200 });
    expect(montoUsdBs(100, 'USD', 40)).toEqual({ usd: 100, bs: 4000 });
    expect(montoUsdBs(4000, 'Bs', 40)).toEqual({ usd: 100, bs: 4000 });
    expect(montoUsdBs(100, 'USDT', 40)).toEqual({ usd: 100, bs: 4000 });
    expect(montoUsdBs(100, 'USD', 0)).toEqual({ usd: 100, bs: 0 });
  });

  test('normalizarDepartamento colapsa espacios y nombra el vacío', () => {
    expect(normalizarDepartamento('  Taller   Mecánico ')).toBe('Taller Mecánico');
    expect(normalizarDepartamento('   ')).toBe(SIN_DEPARTAMENTO);
    expect(normalizarDepartamento(null)).toBe(SIN_DEPARTAMENTO);
    expect(normalizarDepartamento(undefined)).toBe(SIN_DEPARTAMENTO);
  });
});

describe('comprasMoldeable · normalización de las 3 fuentes (T2)', () => {
  test('normalizarOrdenes descarta excluidas y convierte moneda', () => {
    const filas = normalizarOrdenes([
      ordenFix({ estado: 'pagada', total: 100, total_moneda: 'USD', unidad_solicitante: 'Mina', pagada_en: '2026-11-02' }),
      ordenFix({ estado: 'cancelada', total: 999, total_moneda: 'USD' }),
    ], ctxFix({ tasaBcv: 40 }));
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      tipo_compra: 'orden', clase_estado: 'finalizada',
      monto_usd: 100, monto_bs: 4000, pagado_usd: 100, departamento: 'Mina',
    });
  });

  test('normalizarOrdenes a crédito usa abonado_total como pagado', () => {
    const filas = normalizarOrdenes([
      ordenFix({ estado: 'cuenta_abierta', total: 200, total_moneda: 'USD', abonado_total: 50 }),
    ], ctxFix({ tasaBcv: 40 }));
    expect(filas[0]).toMatchObject({ clase_estado: 'pendiente', pagado_usd: 50 });
  });

  test('normalizarDirectas pone bucket de depto y categoría de gasto, excluye en_proceso', () => {
    const filas = normalizarDirectas([
      directaFix({ estado: 'finalizada', gasto: 50, moneda: 'USD', gasto_categoria: 'Papelería', pagada_at: '2026-11-03' }),
      directaFix({ estado: 'en_proceso', gasto: null }),
    ], ctxFix({ tasaBcv: 40 }));
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      tipo_compra: 'directa', departamento: SIN_DEPARTAMENTO, categoria_gasto: 'Papelería', pagado_usd: 50,
    });
  });

  test('normalizarServicios usa unidad_solicitante y abonado_total', () => {
    const filas = normalizarServicios([
      servicioFix({ estado: 'por_pagar', gasto: 200, moneda: 'USD', unidad_solicitante: 'Planta', abonado_total: 80 }),
    ], ctxFix({ tasaBcv: 40 }));
    expect(filas[0]).toMatchObject({
      tipo_compra: 'servicio', clase_estado: 'pendiente', departamento: 'Planta', pagado_usd: 80,
    });
  });
});

describe('comprasMoldeable · ámbito ítems (T3)', () => {
  test('normalizarItemsOrdenes explota por ítem y cruza categoría (orden USD usa precio_usd)', () => {
    const ctx = ctxFix({ tasaBcv: 40, categoriasPorSku: new Map([['SKU-1', 'Ferretería']]) });
    const filas = normalizarItemsOrdenes([
      ordenFix({ estado: 'pagada', total_moneda: 'USD', items: [
        // precio es el PRECIO EN Bs a BCV; precio_usd es el USD (types.ts). En orden USD manda precio_usd.
        { sku: 'SKU-1', nombre: 'Tornillo', cantidad: 10, precio: 80, precio_usd: 2 },
        { sku: 'SKU-9', nombre: 'Flete', cantidad: 1, precio: 200, precio_usd: 5 },
      ] } as Partial<Orden>),
    ], ctx);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({
      ambito: 'items', categoria: 'Ferretería', nombre_item: 'Tornillo', cantidad: 10, monto_usd: 20, monto_bs: 800,
    });
    expect(filas[1].categoria).toBe(SIN_CATEGORIA_INV); // sku desconocido
  });

  test('ítem en orden USD con total consistente no se divide erróneamente entre tasa BCV (caso laptop)', () => {
    const ctx = ctxFix({ tasaBcv: 901.62 });
    const ordenLaptop = ordenFix({
      estado: 'pagada',
      total_moneda: 'USD',
      total: 1436.60,
      items: [
        { sku: 'EQUI-008', nombre: 'Laptop Dell AMD Ryzen', cantidad: 1, precio: 1238.45 },
        { sku: 'MEM-001', nombre: 'Memoria 16GB', cantidad: 1, precio: 198.15 },
      ],
    } as Partial<Orden>);
    const filas = normalizarItemsOrdenes([ordenLaptop], ctx);
    expect(filas).toHaveLength(2);
    expect(filas[0].monto_usd).toBe(1238.45);
    expect(filas[1].monto_usd).toBe(198.15);
  });

  test('ítem en orden USD sin precio_usd convierte el precio (Bs) con la tasa', () => {
    const filas = normalizarItemsOrdenes([
      ordenFix({ estado: 'pagada', total_moneda: 'USD', items: [{ sku: 'X', nombre: 'Y', cantidad: 1, precio: 80 }] } as Partial<Orden>),
    ], ctxFix({ tasaBcv: 40 }));
    expect(filas[0]).toMatchObject({ monto_usd: 2, monto_bs: 80 }); // 80 Bs / 40 = $2
  });

  test('ítem en orden en Bs usa el precio (Bs) directo', () => {
    const filas = normalizarItemsOrdenes([
      ordenFix({ estado: 'pagada', total_moneda: 'Bs', items: [{ sku: 'X', nombre: 'Y', cantidad: 1, precio: 4000 }] } as Partial<Orden>),
    ], ctxFix({ tasaBcv: 40 }));
    expect(filas[0]).toMatchObject({ monto_bs: 4000, monto_usd: 100, moneda_original: 'BS' });
  });

  test('normalizarItemsOrdenes descarta órdenes excluidas', () => {
    const filas = normalizarItemsOrdenes([
      ordenFix({ estado: 'cancelada', items: [{ sku: 'SKU-1', nombre: 'X', cantidad: 1, precio: 1 }] } as Partial<Orden>),
    ], ctxFix());
    expect(filas).toHaveLength(0);
  });
});

describe('comprasMoldeable · filtros y resumen (T4)', () => {
  test('filtrarFilasCompras respeta departamento, tipo y estado', () => {
    const filas = [
      filaOrdFix({ departamento: 'Mina', tipo_compra: 'orden', clase_estado: 'finalizada' }),
      filaOrdFix({ departamento: 'Planta', tipo_compra: 'servicio', clase_estado: 'pendiente' }),
    ];
    expect(filtrarFilasCompras(filas, { departamentosSel: ['Mina'] })).toHaveLength(1);
    expect(filtrarFilasCompras(filas, { tiposSel: ['servicio'] })).toHaveLength(1);
    expect(filtrarFilasCompras(filas, { estadosSel: ['pendiente'] })[0].departamento).toBe('Planta');
    expect(filtrarFilasCompras(filas, {})).toHaveLength(2); // vacío = sin filtro
  });

  test('resumenCompras: total incluye las 3 fuentes; ranking excluye directas', () => {
    const ords = [
      filaOrdFix({ tipo_compra: 'orden', departamento: 'Mina', monto_usd: 100, monto_bs: 4000, clase_estado: 'finalizada', pagado_usd: 100 }),
      filaOrdFix({ tipo_compra: 'servicio', departamento: 'Planta', monto_usd: 50, monto_bs: 2000, clase_estado: 'pendiente' }),
      filaOrdFix({ tipo_compra: 'directa', departamento: SIN_DEPARTAMENTO, categoria_gasto: 'Papelería', monto_usd: 30, monto_bs: 1200, clase_estado: 'finalizada', pagado_usd: 30 }),
    ];
    const r = resumenCompras(ords, [], [{ departamento: 'Mina' }, { departamento: 'Mina' }, { departamento: 'Planta' }], 40);
    expect(r.totalCompras).toBe(3);
    expect(r.totalUsd).toBe(180);
    expect(r.rankingDeptoGasto.map((d) => d.departamento)).toEqual(['Mina', 'Planta']); // sin directas
    expect(r.comprasDirectasPorCategoriaGasto).toEqual([{ categoria: 'Papelería', usd: 30, bs: 1200 }]);
    expect(r.rankingDeptoCotizaciones[0]).toEqual({ departamento: 'Mina', cotizaciones: 2 });
    expect(r.finalizadasUsd).toBe(130);
    expect(r.pendientesUsd).toBe(50);
    expect(r.pagadoUsd).toBe(130);
    expect(r.deptoQueMasGasto).toBe('Mina');
  });

  test('resumenCompras con rango vacío no rompe', () => {
    const r = resumenCompras([], [], [], 0);
    expect(r).toMatchObject({ totalCompras: 0, totalUsd: 0, deptoQueMasGasto: null, rankingDeptoGasto: [] });
  });

  test('departamento vacío cae en el bucket nombrado', () => {
    const r = resumenCompras([filaOrdFix({ tipo_compra: 'orden', departamento: SIN_DEPARTAMENTO, monto_usd: 10 })], [], [], 40);
    expect(r.rankingDeptoGasto[0].departamento).toBe(SIN_DEPARTAMENTO);
  });

  test('topCategorias y topItems salen del ámbito ítems', () => {
    const items = [
      filaItemFix({ categoria: 'Ferretería', nombre_item: 'Tornillo', monto_usd: 20, cantidad: 10 }),
      filaItemFix({ categoria: 'Ferretería', nombre_item: 'Tornillo', monto_usd: 10, cantidad: 5 }),
      filaItemFix({ categoria: 'Papelería', nombre_item: 'Resma', monto_usd: 5, cantidad: 1 }),
    ];
    const r = resumenCompras([], items, [], 40);
    expect(r.topCategorias[0]).toMatchObject({ nombre: 'Ferretería', usd: 30 });
    expect(r.topItems[0]).toMatchObject({ nombre: 'Tornillo', usd: 30, cantidad: 15 });
  });
});

describe('comprasMoldeable · agrupación, columnas y ficha (T5)', () => {
  test('procesarFilasCompras agrupa por departamento con subtotales y %', () => {
    const filas = [
      filaOrdFix({ departamento: 'Mina', monto_usd: 80 }),
      filaOrdFix({ departamento: 'Mina', monto_usd: 20 }),
      filaOrdFix({ departamento: 'Planta', monto_usd: 100 }),
    ];
    const { filas: g } = procesarFilasCompras(filas, 'departamento', { ordenarPor: 'monto' });
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ departamento: 'Mina', monto_usd: 100, total_items: 2, pct_del_total: 50 });
  });

  test('procesarFilasCompras detallado no agrupa', () => {
    const filas = [filaOrdFix({ monto_usd: 1 }), filaOrdFix({ monto_usd: 2 })];
    expect(procesarFilasCompras(filas, 'detallado', {}).filas).toHaveLength(2);
  });

  test('procesarFilasCompras por mes muestra la etiqueta del mes, no un día suelto', () => {
    const filas = [
      filaOrdFix({ fecha: '2026-11-05', monto_usd: 10 }),
      filaOrdFix({ fecha: '2026-11-20', monto_usd: 5 }),
    ];
    const { filas: g } = procesarFilasCompras(filas, 'mes', {});
    expect(g).toHaveLength(1);
    expect(g[0].fecha).toBe('Nov 2026');
  });

  test('CAMPOS_REPORTE_COMPRAS trae claves clave y obtenerMetricasFichaCompras nunca queda vacío', () => {
    const claves = CAMPOS_REPORTE_COMPRAS.map((c) => c.clave);
    expect(claves).toEqual(expect.arrayContaining(['departamento', 'monto_usd', 'monto_bs', 'estado_rotulo']));
    const metricas = obtenerMetricasFichaCompras(filaOrdFix({ monto_usd: 10 }), []);
    expect(metricas.length).toBeGreaterThanOrEqual(1);
    expect(metricas.length).toBeLessThanOrEqual(4);
  });
});
