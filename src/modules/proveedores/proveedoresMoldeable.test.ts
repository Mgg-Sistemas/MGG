/* El motor del reporte moldeable de Proveedores: normalización, agrupación,
   KPIs y el cruce con el histórico de compras. Todo SÍNCRONO y sin Supabase. */
import { describe, it, expect } from 'vitest';
import type { Orden, Proveedor } from '@/shared/lib/types';
import type { ActividadEconomica } from './actividadesEconomicas';
import {
  calcularComprasPorProveedor,
  normalizarProveedores,
  resumenProveedores,
  procesarFilasReporteProveedor,
  obtenerMetricasFichaProveedor,
  textoColumnaProveedor,
  numeroColumnaProveedor,
  type ResumenCompras,
} from './proveedoresMoldeable';

/* ───────────── Fixtures ───────────── */

function mkProv(extra: Partial<Proveedor>): Proveedor {
  return {
    id: 'p1',
    rif: 'J-12345678-9',
    razon_social: 'FERREMAX C.A.',
    categorias: ['Herramientas'],
    origen: 'nacional',
    estado: 'activo',
    created_at: '2026-01-01T00:00:00Z',
    ...extra,
  } as Proveedor;
}

function mkOrden(extra: Partial<Orden>): Orden {
  return {
    id: 'o1',
    codigo: 'OC-2026-0001',
    proveedor_id: 'p1',
    solicitante_email: 'a@b.com',
    items: [],
    total: 0,
    estado: 'recibida',
    historial: [],
    ...extra,
  } as Orden;
}

const ACTIVIDADES: ActividadEconomica[] = [
  { codigo: '5110', descripcion: 'Comercio al por mayor', tipo: 'actividad', activa: true },
];

/* ───────────── calcularComprasPorProveedor ───────────── */

describe('calcularComprasPorProveedor', () => {
  it('suma el monto en $ y cuenta las órdenes efectivas', () => {
    const map = new Map<string, Orden[]>([
      ['p1', [
        mkOrden({ id: 'a', total: 100 }),
        mkOrden({ id: 'b', total: 50 }),
      ]],
    ]);
    const res = calcularComprasPorProveedor(map);
    expect(res.get('p1')).toEqual({ ordenes: 2, montoUsd: 150 });
  });

  it('ignora las órdenes que nunca se concretaron (canceladas/rechazadas/etc.)', () => {
    const map = new Map<string, Orden[]>([
      ['p1', [
        mkOrden({ id: 'a', total: 100, estado: 'recibida' }),
        mkOrden({ id: 'b', total: 999, estado: 'cancelada' }),
        mkOrden({ id: 'c', total: 999, estado: 'rechazada' }),
        mkOrden({ id: 'd', total: 999, estado: 'desistida_proveedor' }),
      ]],
    ]);
    expect(res(map, 'p1')).toEqual({ ordenes: 1, montoUsd: 100 });
  });

  it('las órdenes cotizadas en Bs cuentan, pero no suman al monto en $', () => {
    const map = new Map<string, Orden[]>([
      ['p1', [
        mkOrden({ id: 'a', total: 100, total_moneda: 'USD' }),
        mkOrden({ id: 'b', total: 4000, total_moneda: 'Bs' }),
      ]],
    ]);
    expect(res(map, 'p1')).toEqual({ ordenes: 2, montoUsd: 100 });
  });

  it('un proveedor sin órdenes queda en cero', () => {
    const map = new Map<string, Orden[]>([['p1', []]]);
    expect(res(map, 'p1')).toEqual({ ordenes: 0, montoUsd: 0 });
  });

  function res(map: Map<string, Orden[]>, id: string): ResumenCompras {
    return calcularComprasPorProveedor(map).get(id)!;
  }
});

/* ───────────── normalizarProveedores ───────────── */

describe('normalizarProveedores', () => {
  it('ordena por razón social y traduce origen/estado', () => {
    const filas = normalizarProveedores([
      mkProv({ id: 'z', razon_social: 'ZETA', origen: 'internacional', estado: 'inactivo' }),
      mkProv({ id: 'a', razon_social: 'ALFA' }),
    ]);
    expect(filas.map((f) => f.razon_social)).toEqual(['ALFA', 'ZETA']);
    expect(filas[0]).toMatchObject({ origen: 'Nacional', estado: 'Activo' });
    expect(filas[1]).toMatchObject({ origen: 'Internacional', estado: 'Inactivo' });
  });

  it('resuelve la actividad económica con el catálogo (o deja el código si no está)', () => {
    const [conCat, sinCat, vacia] = normalizarProveedores([
      mkProv({ id: '1', razon_social: 'A', actividad_economica: '5110' }),
      mkProv({ id: '2', razon_social: 'B', actividad_economica: '9999' }),
      mkProv({ id: '3', razon_social: 'C', actividad_economica: null }),
    ], { listaActividades: ACTIVIDADES });
    expect(conCat.actividad).toBe('5110 · Comercio al por mayor');
    expect(sinCat.actividad).toBe('9999');
    expect(vacia.actividad).toBe('—');
  });

  it('une las categorías y limpia las vacías; sin categorías queda cadena vacía', () => {
    const [f] = normalizarProveedores([mkProv({ categorias: ['EPP', '', 'Repuestos'] })]);
    expect(f.categorias).toBe('EPP, Repuestos');
    expect(f.categoriasLista).toEqual(['EPP', 'Repuestos']);
    const [g] = normalizarProveedores([mkProv({ id: 'x', categorias: [] })]);
    expect(g.categorias).toBe('');
  });

  it('sin histórico de compras, las columnas de compras quedan en null', () => {
    const [f] = normalizarProveedores([mkProv({})]);
    expect(f.num_ordenes).toBeNull();
    expect(f.monto_comprado).toBeNull();
  });

  it('con histórico de compras, trae órdenes y monto; sin registro, cero', () => {
    const compras = new Map<string, ResumenCompras>([['p1', { ordenes: 3, montoUsd: 500 }]]);
    const [conC, sinC] = normalizarProveedores([
      mkProv({ id: 'p1', razon_social: 'A' }),
      mkProv({ id: 'p2', razon_social: 'B' }),
    ], { comprasPorProveedor: compras });
    expect(conC).toMatchObject({ num_ordenes: 3, monto_comprado: 500 });
    expect(sinC).toMatchObject({ num_ordenes: 0, monto_comprado: 0 });
  });
});

/* ───────────── resumenProveedores ───────────── */

describe('resumenProveedores', () => {
  const filas = normalizarProveedores([
    mkProv({ id: '1', razon_social: 'A', estado: 'activo', origen: 'nacional', categorias: ['EPP'] }),
    mkProv({ id: '2', razon_social: 'B', estado: 'activo', origen: 'internacional', categorias: ['EPP', 'Repuestos'] }),
    mkProv({ id: '3', razon_social: 'C', estado: 'inactivo', origen: 'nacional', categorias: ['Repuestos'] }),
    mkProv({ id: '4', razon_social: 'D', estado: 'activo', origen: 'nacional', categorias: [] }),
  ]);

  it('cuenta activos, inactivos, nacionales e internacionales con sus porcentajes', () => {
    const r = resumenProveedores(filas);
    expect(r.totalProveedores).toBe(4);
    expect(r.activos).toBe(3);
    expect(r.inactivos).toBe(1);
    expect(r.nacionales).toBe(3);
    expect(r.internacionales).toBe(1);
    expect(r.pctActivos).toBe(75);
    expect(r.pctNacionales).toBe(75);
  });

  it('top categorías cuenta proveedores por rubro, ordenado', () => {
    const r = resumenProveedores(filas);
    expect(r.topCategorias[0]).toMatchObject({ nombre: 'EPP', valor: 2 });
    expect(r.topCategorias.find((c) => c.nombre === 'Repuestos')?.valor).toBe(2);
  });

  it('sin histórico, conCompras es falso y no hay top por monto', () => {
    const r = resumenProveedores(filas);
    expect(r.conCompras).toBe(false);
    expect(r.topProveedoresMonto).toEqual([]);
  });

  it('con histórico, suma órdenes y monto, y arma el top por monto', () => {
    const compras = new Map<string, ResumenCompras>([
      ['1', { ordenes: 2, montoUsd: 300 }],
      ['2', { ordenes: 1, montoUsd: 100 }],
    ]);
    const conC = normalizarProveedores(
      [mkProv({ id: '1', razon_social: 'A' }), mkProv({ id: '2', razon_social: 'B' })],
      { comprasPorProveedor: compras },
    );
    const r = resumenProveedores(conC);
    expect(r.conCompras).toBe(true);
    expect(r.totalOrdenes).toBe(3);
    expect(r.totalMontoUsd).toBe(400);
    expect(r.topProveedoresMonto[0]).toMatchObject({ nombre: 'A', valor: 300, porcentaje: 75 });
  });
});

/* ───────────── procesarFilasReporteProveedor ───────────── */

describe('procesarFilasReporteProveedor', () => {
  const detalle = normalizarProveedores([
    mkProv({ id: '1', razon_social: 'A', origen: 'nacional', categorias: ['EPP'] }),
    mkProv({ id: '2', razon_social: 'B', origen: 'nacional', categorias: ['EPP', 'Repuestos'] }),
    mkProv({ id: '3', razon_social: 'C', origen: 'internacional', categorias: ['Repuestos'] }),
  ]);

  it('detallado conserva una fila por proveedor', () => {
    const { filas } = procesarFilasReporteProveedor(detalle, 'detallado');
    expect(filas).toHaveLength(3);
    expect(filas.every((f) => f.total_proveedores === 1)).toBe(true);
  });

  it('agrupa por origen sumando proveedores y % del total', () => {
    const { filas } = procesarFilasReporteProveedor(detalle, 'origen');
    const nac = filas.find((f) => f.origen === 'Nacional')!;
    expect(nac.total_proveedores).toBe(2);
    expect(nac.pct_del_total).toBeCloseTo(66.7, 1);
  });

  it('por categoría, un proveedor con varias categorías aporta a cada una', () => {
    const { filas } = procesarFilasReporteProveedor(detalle, 'categoria');
    const epp = filas.find((f) => f.categorias === 'EPP')!;
    const rep = filas.find((f) => f.categorias === 'Repuestos')!;
    expect(epp.total_proveedores).toBe(2);
    expect(rep.total_proveedores).toBe(2);
  });

  it('ordena los grupos por cantidad descendente por defecto', () => {
    const { filas } = procesarFilasReporteProveedor(detalle, 'origen');
    expect(filas[0].origen).toBe('Nacional'); // 2 > 1
  });

  it('el resumen siempre sale del detalle, no de los grupos', () => {
    const { resumen } = procesarFilasReporteProveedor(detalle, 'categoria');
    expect(resumen.totalProveedores).toBe(3);
  });

  it('agrupa por actividad económica, incluyendo «Sin actividad»', () => {
    const conAct = normalizarProveedores([
      mkProv({ id: '1', razon_social: 'A', actividad_economica: '5110' }),
      mkProv({ id: '2', razon_social: 'B', actividad_economica: null }),
    ], { listaActividades: ACTIVIDADES });
    const { filas } = procesarFilasReporteProveedor(conAct, 'actividad');
    expect(filas.map((f) => f.actividad).sort()).toEqual(['5110 · Comercio al por mayor', '—']);
  });

  it('con histórico, el detallado calcula el % por monto comprado', () => {
    const compras = new Map<string, ResumenCompras>([
      ['1', { ordenes: 1, montoUsd: 75 }],
      ['2', { ordenes: 1, montoUsd: 25 }],
    ]);
    const conC = normalizarProveedores(
      [mkProv({ id: '1', razon_social: 'A' }), mkProv({ id: '2', razon_social: 'B' })],
      { comprasPorProveedor: compras },
    );
    const { filas } = procesarFilasReporteProveedor(conC, 'detallado', { ordenarPor: 'monto' });
    expect(filas[0].razon_social).toBe('A');
    expect(filas[0].pct_del_total).toBe(75);
    expect(filas[1].pct_del_total).toBe(25);
  });
});

/* ───────────── fichas y celdas ───────────── */

describe('obtenerMetricasFichaProveedor', () => {
  it('para un grupo con compras muestra proveedores, monto y %', () => {
    const [f] = procesarFilasReporteProveedor(
      normalizarProveedores(
        [mkProv({ id: '1', razon_social: 'A', origen: 'nacional' }), mkProv({ id: '2', razon_social: 'B', origen: 'nacional' })],
        { comprasPorProveedor: new Map([['1', { ordenes: 1, montoUsd: 50 }], ['2', { ordenes: 1, montoUsd: 50 }]]) },
      ),
      'origen',
    ).filas;
    const m = obtenerMetricasFichaProveedor(f, ['monto_comprado', 'num_ordenes', 'pct_total']);
    expect(m.length).toBeLessThanOrEqual(4);
    expect(m.some((x) => x.clave === 'total_proveedores')).toBe(true);
    expect(m.some((x) => x.clave === 'monto_comprado')).toBe(true);
  });

  it('siempre devuelve al menos un recuadro de respaldo', () => {
    const [f] = normalizarProveedores([mkProv({})]);
    expect(obtenerMetricasFichaProveedor(f, []).length).toBeGreaterThanOrEqual(1);
  });
});

describe('textoColumnaProveedor / numeroColumnaProveedor', () => {
  const [f] = normalizarProveedores(
    [mkProv({ rif: 'J-1', razon_social: 'A', actividad_economica: '5110' })],
    { listaActividades: ACTIVIDADES, comprasPorProveedor: new Map([['p1', { ordenes: 4, montoUsd: 1234.5 }]]) },
  );

  it('texto por columna resuelve cada clave', () => {
    expect(textoColumnaProveedor(f, 'rif')).toBe('J-1');
    expect(textoColumnaProveedor(f, 'actividad')).toBe('5110 · Comercio al por mayor');
    expect(textoColumnaProveedor(f, 'num_ordenes')).toBe('4');
  });

  it('número por columna solo devuelve valor en columnas numéricas', () => {
    expect(numeroColumnaProveedor(f, 'monto_comprado')).toBe(1234.5);
    expect(numeroColumnaProveedor(f, 'num_ordenes')).toBe(4);
    expect(numeroColumnaProveedor(f, 'rif')).toBeNull();
  });
});
