import { describe, it, expect } from 'vitest';
import type { MovimientoCaja } from '@/shared/lib/types';
import type { DatosPendientesPorPagar } from './pendientesPorPagar';
import type { CuentaPorPagar } from './cuentasPorPagar.repository';
import type { CuentaPorCobrar } from './cuentasPorCobrar.repository';
import {
  convertirMonto,
  normalizarMovimientosTesoreria,
  normalizarPendientesPorPagar,
  normalizarCreditosCartera,
  filtrarFilasTesoreria,
  procesarFilasReporteTesoreria,
  resumenTesoreria,
  obtenerMetricasFichaTesoreria,
  resolverCabeceraTarjetaTesoreria,
  esColumnaAplicableModoTesoreria,
  ETIQUETA_MODO_TESORERIA,
  type ContextoTasas,
  type FilaReporteTesoreria,
} from './reporteTesoreriaMoldeable';

const CTX: ContextoTasas = { tasaBcvHoy: 40, tasaFecha: '2026-11-01' };

/** Movimiento de caja mínimo para fixtures (campos opcionales por `extra`). */
function mkMov(extra: Partial<MovimientoCaja>): MovimientoCaja {
  return {
    id: 'm1',
    caja_id: 'c1',
    tipo: 'salida',
    monto: 0,
    moneda: 'USD',
    saldo_antes: 0,
    saldo_despues: 0,
    actor: 'tester',
    at: '2026-11-01T10:00:00Z',
    ...extra,
  } as MovimientoCaja;
}

describe('convertirMonto', () => {
  it('USD → usd nominal y bs = usd × tasa', () => {
    expect(convertirMonto(100, 'USD', 40)).toEqual({ usd: 100, bs: 4000, tasa: 40 });
  });
  it('Bs → bs nominal y usd = bs ÷ tasa', () => {
    expect(convertirMonto(4000, 'Bs', 40)).toEqual({ usd: 100, bs: 4000, tasa: 40 });
  });
  it('USDT se valora 1:1 con el dólar', () => {
    expect(convertirMonto(50, 'USDT', 40)).toEqual({ usd: 50, bs: 2000, tasa: 40 });
  });
  it('COP con tasa por unidad convierte vía Bs', () => {
    expect(convertirMonto(1000, 'COP', 40, 0.2)).toEqual({ usd: 5, bs: 200, tasa: 40 });
  });
  it('COP sin tasa por unidad queda sin equivalencia', () => {
    expect(convertirMonto(1000, 'COP', 40)).toEqual({ usd: 0, bs: 0, tasa: 40 });
  });
  it('tasa 0 no divide (usd queda en 0)', () => {
    expect(convertirMonto(4000, 'Bs', 0)).toEqual({ usd: 0, bs: 4000, tasa: 0 });
  });
});

describe('normalizarMovimientosTesoreria', () => {
  it('mapea tipos del libro al flujo de tesorería', () => {
    const movs = [
      mkMov({ id: 'a', tipo: 'ingreso', monto: 100, moneda: 'USD' }),
      mkMov({ id: 'b', tipo: 'salida', monto: 2000, moneda: 'Bs' }),
      mkMov({ id: 'c', tipo: 'traslado_salida', monto: 10, moneda: 'USD' }),
      mkMov({ id: 'd', tipo: 'ajuste', monto: 5, moneda: 'USD', saldo_antes: 0, saldo_despues: 5 }),
    ];
    const filas = normalizarMovimientosTesoreria(movs, CTX);
    expect(filas.map((f) => f.tipo_movimiento)).toEqual(['ingreso', 'egreso', 'traslado', 'ingreso']);
  });

  it('convierte montos según la moneda y guarda la tasa aplicada', () => {
    const [ing, egr] = normalizarMovimientosTesoreria(
      [
        mkMov({ id: 'a', tipo: 'ingreso', monto: 100, moneda: 'USD' }),
        mkMov({ id: 'b', tipo: 'salida', monto: 2000, moneda: 'Bs' }),
      ],
      CTX,
    );
    expect([ing.monto_usd, ing.monto_bs]).toEqual([100, 4000]);
    expect([egr.monto_usd, egr.monto_bs]).toEqual([50, 2000]);
    expect(egr.tasa_bcv_aplicada).toBe(40);
  });

  it('usa la tasa histórica por fecha cuando la base lo pide', () => {
    const ctx: ContextoTasas = { tasaBcvHoy: 40, tasaFecha: '2026-11-02', tasasPorFecha: new Map([['2026-11-01', 36]]) };
    const [f] = normalizarMovimientosTesoreria(
      [mkMov({ id: 'a', tipo: 'salida', monto: 36, moneda: 'USD' })],
      ctx,
      'historica',
    );
    expect(f.monto_bs).toBe(1296); // 36 × 36
    expect(f.tasa_bcv_aplicada).toBe(36);
  });

  it('deriva la categoría: subcategoría de gasto > categoría base', () => {
    const [f] = normalizarMovimientosTesoreria(
      [mkMov({ id: 'a', tipo: 'salida', monto: 10, moneda: 'USD', gasto_categoria: 'Fletes', categoria: 'gasto' })],
      CTX,
    );
    expect(f.categoria).toBe('Fletes');
  });

  it('el ajuste lleva categoría propia «Ajuste»', () => {
    const [f] = normalizarMovimientosTesoreria(
      [mkMov({ id: 'a', tipo: 'ajuste', monto: 5, moneda: 'USD', saldo_antes: 10, saldo_despues: 5 })],
      CTX,
    );
    expect(f.categoria).toBe('Ajuste');
    expect(f.tipo_movimiento).toBe('egreso'); // bajó el saldo
  });
});

describe('normalizarPendientesPorPagar', () => {
  const datos: DatosPendientesPorPagar = {
    segmentos: [
      {
        clave: 'oc',
        titulo: 'ÓRDENES DE COMPRA (OC)',
        subUsd: 100,
        subBs: 4000,
        filas: [
          {
            codigo: 'OC-2026-0181', proveedor: 'Repuestos CA', estado: 'Lista para pagar',
            listaParaPagar: true,
            pagos: [{ metodo: 'transferencia', texto: 'Transferencia — BDV 0102', registrado: false }],
            usd: 100, bs: 4000,
          },
        ],
      },
    ],
    credito: null,
    tasa: 40,
    tasaFecha: '2026-11-01',
    totUsd: 100,
    totBs: 4000,
    totCant: 1,
    preparacion: { porMetodoMoneda: [], totalesPorMoneda: [], sinMetodo: { usd: 0, bs: 0, nOrdenes: 0 } },
    generadoEn: '2026-11-01T12:00:00Z',
  };

  it('aplana los segmentos a filas de egreso con su método de pago', () => {
    const filas = normalizarPendientesPorPagar(datos);
    expect(filas).toHaveLength(1);
    const f = filas[0];
    expect(f.ambito).toBe('por_pagar');
    expect(f.tipo_movimiento).toBe('egreso');
    expect(f.codigo).toBe('OC-2026-0181');
    expect(f.contraparte).toBe('Repuestos CA');
    expect([f.monto_usd, f.monto_bs]).toEqual([100, 4000]);
    expect(f.metodo_pago).toContain('Transferencia');
    expect(f.origen_documento).toBe('Orden de compra');
  });
});

describe('normalizarCreditosCartera', () => {
  const cxp: CuentaPorPagar[] = [
    { id: 'p1', tipo: 'proveedor', contraparte: 'Proveedor A', monto: 100, abonado: 40, moneda: 'USD', estado: 'abierta', created_at: '2026-11-01T00:00:00Z' },
    { id: 'p2', tipo: 'proveedor', contraparte: 'Proveedor B', monto: 50, abonado: 50, moneda: 'USD', estado: 'saldada', created_at: '2026-11-01T00:00:00Z' },
  ];
  const cxc: CuentaPorCobrar[] = [
    { id: 'c1', tipo: 'cliente', contraparte: 'Cliente X', monto: 200, abonado: 20, moneda: 'USD', estado: 'abierta', created_at: '2026-11-01T00:00:00Z' },
  ];

  it('CxP abiertas son egreso con saldo monto − abonado; las saldadas se ignoran', () => {
    const filas = normalizarCreditosCartera(cxp, [], CTX);
    expect(filas).toHaveLength(1);
    expect(filas[0].tipo_movimiento).toBe('egreso');
    expect(filas[0].monto_original).toBe(60); // 100 − 40
    expect(filas[0].monto_usd).toBe(60);
  });

  it('CxC abiertas son ingreso con saldo monto − cobrado', () => {
    const filas = normalizarCreditosCartera([], cxc, CTX);
    expect(filas).toHaveLength(1);
    expect(filas[0].tipo_movimiento).toBe('ingreso');
    expect(filas[0].monto_original).toBe(180); // 200 − 20
  });
});

describe('filtrarFilasTesoreria', () => {
  const filas = normalizarMovimientosTesoreria(
    [
      mkMov({ id: 'a', tipo: 'salida', monto: 10, moneda: 'USD', caja: { nombre: 'BDV', moneda: 'USD' } }),
      mkMov({ id: 'b', tipo: 'ingreso', monto: 20, moneda: 'Bs', caja: { nombre: 'Banesco', moneda: 'Bs' } }),
    ],
    CTX,
  );

  it('filtra por caja', () => {
    expect(filtrarFilasTesoreria(filas, { cajasSel: ['BDV'] }).map((f) => f.id)).toEqual(['a']);
  });
  it('filtra por moneda', () => {
    expect(filtrarFilasTesoreria(filas, { monedasSel: ['Bs'] }).map((f) => f.id)).toEqual(['b']);
  });
  it('filtra por tipo de movimiento', () => {
    expect(filtrarFilasTesoreria(filas, { tiposSel: ['ingreso'] }).map((f) => f.id)).toEqual(['b']);
  });
  it('sin filtros devuelve todo', () => {
    expect(filtrarFilasTesoreria(filas, {})).toHaveLength(2);
  });
});

describe('resumenTesoreria', () => {
  const filas = normalizarMovimientosTesoreria(
    [
      mkMov({ id: 'a', tipo: 'ingreso', monto: 100, moneda: 'USD' }),
      mkMov({ id: 'b', tipo: 'salida', monto: 30, moneda: 'USD', gasto_categoria: 'Fletes', beneficiario: 'Transporte A' }),
      mkMov({ id: 'c', tipo: 'salida', monto: 20, moneda: 'USD', gasto_categoria: 'Alimentación', beneficiario: 'Comedor B' }),
      mkMov({ id: 'd', tipo: 'traslado_salida', monto: 999, moneda: 'USD' }),
    ],
    CTX,
  );

  it('suma egresos e ingresos y calcula el saldo neto, sin contar traslados', () => {
    const r = resumenTesoreria(filas, 40);
    expect(r.totalIngresosUsd).toBe(100);
    expect(r.totalEgresosUsd).toBe(50);
    expect(r.saldoNetoUsd).toBe(50);
    expect(r.totalOperaciones).toBe(4);
  });

  it('top categorías y proveedores salen solo de egresos y ordenados', () => {
    const r = resumenTesoreria(filas, 40);
    expect(r.topCategorias[0]).toMatchObject({ nombre: 'Fletes', montoUsd: 30, porcentaje: 60 });
    expect(r.topProveedores[0].nombre).toBe('Transporte A');
    expect(r.topCategorias.find((t) => t.nombre === 'Ingreso')).toBeUndefined();
  });
});

describe('procesarFilasReporteTesoreria', () => {
  const detalle = normalizarMovimientosTesoreria(
    [
      mkMov({ id: 'a', tipo: 'salida', monto: 30, moneda: 'USD', gasto_categoria: 'Fletes' }),
      mkMov({ id: 'b', tipo: 'salida', monto: 10, moneda: 'USD', gasto_categoria: 'Fletes' }),
      mkMov({ id: 'c', tipo: 'salida', monto: 60, moneda: 'USD', gasto_categoria: 'Nómina' }),
    ],
    CTX,
  );

  it('detallado conserva una fila por registro con su % del total', () => {
    const { filas } = procesarFilasReporteTesoreria(detalle, 'detallado');
    expect(filas).toHaveLength(3);
    const c = filas.find((f) => f.id === 'c')!;
    expect(c.pct_del_total).toBe(60); // 60 de 100
    expect(c.total_operaciones).toBe(1);
  });

  it('agrupa por categoría sumando montos y operaciones', () => {
    const { filas } = procesarFilasReporteTesoreria(detalle, 'categoria_gasto');
    expect(filas).toHaveLength(2);
    const fletes = filas.find((f) => f.categoria === 'Fletes')!;
    expect(fletes.monto_usd).toBe(40);
    expect(fletes.total_operaciones).toBe(2);
    expect(fletes.pct_del_total).toBe(40);
  });

  it('ordena los grupos por USD descendente por defecto', () => {
    const { filas } = procesarFilasReporteTesoreria(detalle, 'categoria_gasto');
    expect(filas[0].categoria).toBe('Nómina'); // 60 > 40
  });

  it('el resumen siempre sale del detalle, no de los grupos', () => {
    const { resumen } = procesarFilasReporteTesoreria(detalle, 'categoria_gasto');
    expect(resumen.totalEgresosUsd).toBe(100);
    expect(resumen.totalOperaciones).toBe(3);
  });

  it('el % del total es relativo al propio tipo de flujo (egresos no diluidos por ingresos)', () => {
    const detalleMix = normalizarMovimientosTesoreria(
      [
        mkMov({ id: 'a', tipo: 'salida', monto: 30, moneda: 'USD', gasto_categoria: 'Fletes' }),
        mkMov({ id: 'b', tipo: 'salida', monto: 10, moneda: 'USD', gasto_categoria: 'Nómina' }),
        mkMov({ id: 'c', tipo: 'ingreso', monto: 100, moneda: 'USD' }),
      ],
      CTX,
    );
    const { filas } = procesarFilasReporteTesoreria(detalleMix, 'categoria_gasto');
    // Egresos: Fletes 30 y Nómina 10 sobre total egresos 40 → 75% y 25%.
    expect(filas.find((f) => f.categoria === 'Fletes')!.pct_del_total).toBe(75);
    expect(filas.find((f) => f.categoria === 'Nómina')!.pct_del_total).toBe(25);
    // El ingreso se mide sobre el total de ingresos (100), no sobre el gran total.
    expect(filas.find((f) => f.categoria === 'Ingreso')!.pct_del_total).toBe(100);
  });
});

describe('obtenerMetricasFichaTesoreria', () => {
  const fila: FilaReporteTesoreria = {
    id: 'g', ambito: 'movimientos', fecha: '2026-11-01', moneda_original: 'USD',
    monto_original: 100, tipo_movimiento: 'egreso', categoria: 'Fletes', contraparte: 'Proveedor',
    concepto: '', origen_documento: 'Movimiento de caja',
    tasa_bcv_aplicada: 40, monto_usd: 100, monto_bs: 4000,
    total_operaciones: 3, pct_del_total: 25,
  };
  const cols = ['monto_usd', 'monto_bs', 'pct_total'];

  it('con ambos toggles muestra USD y Bs, y nunca más de 4 recuadros', () => {
    const m = obtenerMetricasFichaTesoreria(fila, cols, { mostrarUsd: true, mostrarBs: true });
    expect(m.length).toBeLessThanOrEqual(4);
    expect(m.some((x) => x.clave === 'monto_usd')).toBe(true);
    expect(m.some((x) => x.clave === 'monto_bs')).toBe(true);
  });

  it('al desmarcar el toggle de USD, no aparece el recuadro de dólares', () => {
    const m = obtenerMetricasFichaTesoreria(fila, cols, { mostrarUsd: false, mostrarBs: true });
    expect(m.some((x) => x.clave === 'monto_usd')).toBe(false);
    expect(m.some((x) => x.clave === 'monto_bs')).toBe(true);
  });

  it('siempre devuelve al menos un recuadro de respaldo si no se marcaron columnas', () => {
    const m = obtenerMetricasFichaTesoreria(fila, [], { mostrarUsd: false, mostrarBs: false });
    expect(m.length).toBeGreaterThanOrEqual(1);
  });

  it('respeta estrictamente la selección cuando solo se marca Estado: devuelve únicamente 1 métrica', () => {
    const filaConEstado: FilaReporteTesoreria = {
      ...fila,
      estado: 'Esperando método',
      metodo_pago: 'Transferencia — FERRE-MAX C.A.',
      datos_pago_resumen: 'Transferencia — FERRE-MAX C.A.',
    };
    const m = obtenerMetricasFichaTesoreria(filaConEstado, ['estado'], { mostrarUsd: true, mostrarBs: true });
    expect(m).toHaveLength(1);
    expect(m[0].clave).toBe('estado');
    expect(m[0].etiqueta).toBe('ESTADO');
    expect(m[0].valor).toBe('Esperando método');
    expect(m[0].sub).toBeUndefined();
  });

  it('respeta selección de solo Monto USD: no inyecta operaciones ni método/estado', () => {
    const m = obtenerMetricasFichaTesoreria(fila, ['monto_usd'], { mostrarUsd: true, mostrarBs: true });
    expect(m).toHaveLength(1);
    expect(m[0].clave).toBe('monto_usd');
    expect(m[0].etiqueta).toBe('MONTO ($ USD)');
  });

  it('respeta selección de solo Método de Pago sin Estado', () => {
    const filaConPago: FilaReporteTesoreria = {
      ...fila,
      estado: 'Esperando método',
      metodo_pago: 'Transferencia — FERRE-MAX C.A.',
      datos_pago_resumen: 'Transferencia — FERRE-MAX C.A.',
    };
    const m = obtenerMetricasFichaTesoreria(filaConPago, ['metodo_pago'], { mostrarUsd: true, mostrarBs: true });
    expect(m).toHaveLength(1);
    expect(m[0].clave).toBe('metodo_pago');
    expect(m[0].etiqueta).toBe('MÉTODO Y DATOS DE PAGO');
    expect(m[0].valor).toBe('Transferencia');
    expect(m[0].sub).toBe('FERRE-MAX C.A.');
  });
});

describe('método y datos de pago en el reporte (04/11/2026)', () => {
  it('el pago de una OC trae el método de la orden y el grupo por proveedor lo conserva', () => {
    const pagos = new Map([['oc1', 'Transferencia — Banesco 0134 · J-12345678-9']]);
    const detalle = normalizarMovimientosTesoreria(
      [mkMov({ id: 'm1', tipo: 'salida', monto: 10, moneda: 'USD', saldo_antes: 20, saldo_despues: 10, ref_orden_id: 'oc1', beneficiario: 'CIUDAD ESCOLAR' })],
      CTX, 'bcv_dia', pagos,
    );
    expect(detalle[0].metodo_pago).toBe('Transferencia — Banesco 0134 · J-12345678-9');
    const { filas } = procesarFilasReporteTesoreria(detalle, 'contraparte');
    expect(filas[0].metodo_pago).toBe('Transferencia — Banesco 0134 · J-12345678-9');
    const met = obtenerMetricasFichaTesoreria(filas[0], ['monto_usd', 'metodo_pago'], { mostrarUsd: true, mostrarBs: false }).find((x) => x.clave === 'metodo_pago');
    expect(met?.valor).toBe('Transferencia');
    expect(met?.sub).toBe('Banesco 0134 · J-12345678-9');
  });
});


describe('resolverCabeceraTarjetaTesoreria (claridad y rótulos en tarjetas)', () => {
  const filaGrupoCategoria: FilaReporteTesoreria = {
    id: 'g-cat-1',
    ambito: 'movimientos',
    fecha: '2026-11-05',
    caja_origen: 'Banesco USD',
    moneda_original: 'USD',
    monto_original: 2554.32,
    tipo_movimiento: 'egreso',
    categoria: 'Orden de compra',
    contraparte: '4 proveedores / beneficiarios',
    concepto: 'Orden de compra',
    origen_documento: 'Orden de compra',
    tasa_bcv_aplicada: 894.89,
    monto_usd: 2554.32,
    monto_bs: 2285835.53,
    total_operaciones: 7,
    pct_del_total: 100,
  };

  it('¿Por categoría? Debe mostrar rótulo Categoría y el nombre de la categoría como título, no los proveedores', () => {
    const cab = resolverCabeceraTarjetaTesoreria(filaGrupoCategoria, 'categoria_gasto');
    expect(cab.rotulo).toBe('Categoría');
    expect(cab.titulo).toBe('Orden de compra');
    expect(cab.subtitulo).toContain('4 proveedores / beneficiarios');
    expect(cab.tituloCompleto).toBe('Categoría: Orden de compra');
  });

  it('¿Por caja? Debe rotular Caja / Banco y titular con la caja', () => {
    const cab = resolverCabeceraTarjetaTesoreria(filaGrupoCategoria, 'caja');
    expect(cab.rotulo).toBe('Caja / Banco');
    expect(cab.titulo).toBe('Banesco USD');
    expect(cab.subtitulo).toContain('Cat: Orden de compra');
  });

  it('¿Por tipo? Debe rotular Tipo de Flujo y titular con el tipo', () => {
    const cab = resolverCabeceraTarjetaTesoreria(filaGrupoCategoria, 'tipo_movimiento');
    expect(cab.rotulo).toBe('Tipo de Flujo');
    expect(cab.titulo).toBe('Egreso / Pago');
  });

  it('¿Por moneda? Debe rotular Moneda y detallar la divisa', () => {
    const cab = resolverCabeceraTarjetaTesoreria(filaGrupoCategoria, 'moneda');
    expect(cab.rotulo).toBe('Moneda');
    expect(cab.titulo).toBe('USD · Dólares Americanos');
  });

  it('¿Por documento? Debe rotular Documento y titular con el origen', () => {
    const cab = resolverCabeceraTarjetaTesoreria(filaGrupoCategoria, 'origen_documento');
    expect(cab.rotulo).toBe('Documento');
    expect(cab.titulo).toBe('Orden de compra');
  });

  it('¿Por mes? Debe rotular Mes y formatear a mes legible', () => {
    const cab = resolverCabeceraTarjetaTesoreria(filaGrupoCategoria, 'mes');
    expect(cab.rotulo).toBe('Mes');
    expect(cab.titulo).toBe('Nov 2026');
  });

  it('¿Por día? Debe rotular Día / Fecha y titular con la fecha', () => {
    const cab = resolverCabeceraTarjetaTesoreria(filaGrupoCategoria, 'dia');
    expect(cab.rotulo).toBe('Día / Fecha');
    expect(cab.titulo).toBe('2026-11-05');
  });

  it('¿Por proveedor? Debe rotular Proveedor y titular con la contraparte', () => {
    const filaProv: FilaReporteTesoreria = {
      ...filaGrupoCategoria,
      contraparte: 'Inversiones Los Andes C.A.',
    };
    const cab = resolverCabeceraTarjetaTesoreria(filaProv, 'contraparte');
    expect(cab.rotulo).toBe('Proveedor');
    expect(cab.titulo).toBe('Inversiones Los Andes C.A.');
  });

  it('Detallado: muestra el código del movimiento y contraparte como protagonista', () => {
    const filaDet: FilaReporteTesoreria = {
      ...filaGrupoCategoria,
      codigo: 'OC-2026-0181',
      contraparte: 'Inversiones Los Andes C.A.',
    };
    const cab = resolverCabeceraTarjetaTesoreria(filaDet, 'detallado');
    expect(cab.rotulo).toBe('Op: OC-2026-0181');
    expect(cab.titulo).toBe('Inversiones Los Andes C.A.');
    expect(cab.subtitulo).toContain('Cat: Orden de compra');
  });

  it('Detallado con solo Estado seleccionado: subtítulo queda vacío y no inventa categorías ni fechas', () => {
    const filaDet: FilaReporteTesoreria = {
      ...filaGrupoCategoria,
      codigo: 'OC-2026-0181',
      contraparte: 'Inversiones Los Andes C.A.',
      categoria: 'Orden de compra',
      fecha: '2026-11-05',
    };
    const cab = resolverCabeceraTarjetaTesoreria(filaDet, 'detallado', (d) => d, ['estado']);
    expect(cab.subtitulo).toBe('');
  });

  it('ETIQUETA_MODO_TESORERIA traduce los identificadores internos para el membrete', () => {
    expect(ETIQUETA_MODO_TESORERIA.categoria_gasto).toBe('Categoría de Gasto');
    expect(ETIQUETA_MODO_TESORERIA.tipo_movimiento).toBe('Tipo de Flujo');
    expect(ETIQUETA_MODO_TESORERIA.caja).toBe('Caja / Banco');
    expect(ETIQUETA_MODO_TESORERIA.origen_documento).toBe('Documento / Tipo de Comprobante');
  });

  it('tarjeta ejecutiva siempre rescata el monto financiero consolidado al frente', () => {
    // Caso de la imagen donde solo se marcó operaciones: el monto USD debe estar al inicio
    const met = obtenerMetricasFichaTesoreria(filaGrupoCategoria, [], { mostrarUsd: true, mostrarBs: false });
    expect(met[0].clave).toBe('monto_usd');
    expect(met[0].valor).toBe('$ 2.554,32');
  });

  it('obtenerMetricasFichaTesoreria no trunca a 4 cuando el usuario marca múltiples métricas válidas', () => {
    const met = obtenerMetricasFichaTesoreria(
      filaGrupoCategoria,
      ['monto_usd', 'monto_bs', 'operaciones', 'pct_total', 'tasa_bcv', 'metodo_pago'],
      { mostrarUsd: true, mostrarBs: true },
    );
    // Debe incluir todas las métricas seleccionadas que apliquen a la fila
    const claves = met.map((m) => m.clave);
    expect(claves).toContain('monto_usd');
    expect(claves).toContain('monto_bs');
    expect(claves).toContain('operaciones');
    expect(claves).toContain('pct_total');
    expect(claves).toContain('tasa_bcv');
    expect(claves).toContain('metodo_pago');
    expect(met.length).toBe(6);
  });

  it('esColumnaAplicableModoTesoreria distingue columnas de detalle vs consolidadas', () => {
    // En detallado aplican las columnas de transacción individual
    expect(esColumnaAplicableModoTesoreria('hora', 'detallado')).toBe(true);
    expect(esColumnaAplicableModoTesoreria('codigo', 'detallado')).toBe(true);
    expect(esColumnaAplicableModoTesoreria('saldo_caja', 'detallado')).toBe(true);
    expect(esColumnaAplicableModoTesoreria('concepto', 'detallado')).toBe(true);

    // En agrupaciones consolidadas (categoria_gasto, caja, contraparte, etc.) NO aplican
    expect(esColumnaAplicableModoTesoreria('hora', 'categoria_gasto')).toBe(false);
    expect(esColumnaAplicableModoTesoreria('codigo', 'categoria_gasto')).toBe(false);
    expect(esColumnaAplicableModoTesoreria('saldo_caja', 'categoria_gasto')).toBe(false);
    expect(esColumnaAplicableModoTesoreria('concepto', 'categoria_gasto')).toBe(false);

    // Operaciones y montos sí aplican a grupos
    expect(esColumnaAplicableModoTesoreria('operaciones', 'categoria_gasto')).toBe(true);
    expect(esColumnaAplicableModoTesoreria('monto_usd', 'categoria_gasto')).toBe(true);
    expect(esColumnaAplicableModoTesoreria('monto_bs', 'categoria_gasto')).toBe(true);
    expect(esColumnaAplicableModoTesoreria('pct_total', 'categoria_gasto')).toBe(true);

    // Fecha solo aplica a dia, mes o detallado
    expect(esColumnaAplicableModoTesoreria('fecha', 'dia')).toBe(true);
    expect(esColumnaAplicableModoTesoreria('fecha', 'mes')).toBe(true);
    expect(esColumnaAplicableModoTesoreria('fecha', 'categoria_gasto')).toBe(false);
  });

  it('obtenerMetricasFichaTesoreria representa fielmente todos los 17 checks del catálogo', () => {
    const filaCompleta: FilaReporteTesoreria = {
      id: 'm-all',
      ambito: 'movimientos',
      fecha: '2026-11-05',
      hora: '14:30',
      codigo: 'OC-2026-0203',
      caja_origen: 'Banesco Operativa',
      contraparte: 'FERREMAX C.A.',
      tipo_movimiento: 'egreso',
      categoria: 'Repuestos',
      concepto: 'Filtros y mangueras',
      origen_documento: 'Orden de compra',
      estado: 'Listo para pagar',
      metodo_pago: 'Transferencia — FERRE-MAX C.A. · 0134',
      datos_pago_resumen: 'Transferencia — FERRE-MAX C.A. · 0134',
      moneda_original: 'EUR',
      monto_original: 500,
      tasa_bcv_aplicada: 894.89,
      monto_usd: 550,
      monto_bs: 492189.5,
      total_operaciones: 2,
      pct_del_total: 15.5,
      saldo_caja_momento: 12500,
    };

    const todasLasColumnas = [
      'fecha', 'hora', 'codigo', 'operaciones', 'caja', 'contraparte',
      'tipo_mov', 'categoria', 'concepto', 'estado', 'metodo_pago',
      'monto_usd', 'monto_bs', 'monto_original', 'tasa_bcv', 'pct_total', 'saldo_caja',
    ];

    const met = obtenerMetricasFichaTesoreria(filaCompleta, todasLasColumnas, { mostrarUsd: true, mostrarBs: true });
    const claves = met.map((x) => x.clave);

    for (const col of todasLasColumnas) {
      expect(claves, `Debe incluir la métrica de ${col}`).toContain(col);
    }
    expect(met.length).toBe(17);
  });

  it('representa columnas descriptivas individuales sin forzar Monto USD cuando no está seleccionado', () => {
    const filaDesc: FilaReporteTesoreria = {
      id: 'm-desc',
      ambito: 'movimientos',
      fecha: '2026-11-05',
      codigo: 'OC-2026-0188',
      caja_origen: 'Caja Chica',
      contraparte: 'EURO BOMBAS',
      tipo_movimiento: 'egreso',
      categoria: 'Mantenimiento',
      concepto: 'Reparación bomba',
      origen_documento: 'Orden de compra',
      monto_usd: 425.77,
      monto_bs: 381000,
      moneda_original: 'USD',
      monto_original: 425.77,
      tasa_bcv_aplicada: 894.89,
    };

    // Selección de solo 3 columnas descriptivas
    const met = obtenerMetricasFichaTesoreria(
      filaDesc,
      ['categoria', 'caja', 'fecha'],
      { mostrarUsd: true, mostrarBs: true },
    );
    expect(met).toHaveLength(3);
    const claves = met.map((x) => x.clave);
    expect(claves).toContain('categoria');
    expect(claves).toContain('caja');
    expect(claves).toContain('fecha');
    expect(claves).not.toContain('monto_usd');
  });

  it('cuando se seleccionan Método de Pago y Estado a la vez, genera 2 fichas distintas', () => {
    const filaConAmbos: FilaReporteTesoreria = {
      id: 'm-pago-estado',
      ambito: 'movimientos',
      fecha: '2026-11-05',
      tipo_movimiento: 'egreso',
      categoria: 'Gasto',
      contraparte: 'FERREMAX',
      concepto: 'Pago',
      origen_documento: 'Comprobante',
      moneda_original: 'USD',
      monto_original: 100,
      tasa_bcv_aplicada: 894.89,
      monto_usd: 100,
      monto_bs: 89489,
      estado: 'Esperando método',
      metodo_pago: 'Transferencia — FERRE-MAX C.A.',
      datos_pago_resumen: 'Transferencia — FERRE-MAX C.A.',
    };

    const met = obtenerMetricasFichaTesoreria(
      filaConAmbos,
      ['metodo_pago', 'estado'],
      { mostrarUsd: true, mostrarBs: true },
    );
    expect(met).toHaveLength(2);
    expect(met.find((x) => x.clave === 'metodo_pago')?.valor).toBe('Transferencia');
    expect(met.find((x) => x.clave === 'metodo_pago')?.sub).toBe('FERRE-MAX C.A.');
    expect(met.find((x) => x.clave === 'estado')?.valor).toBe('Esperando método');
  });
});
