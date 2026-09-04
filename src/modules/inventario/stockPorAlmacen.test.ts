import { describe, it, expect } from 'vitest';
import {
  ajustesPmpPorAlmacen, almacenesDelKardex, contarSinAlmacen, desglosePorSede, entradasSalidas, etiquetaAlmacen,
  filtrarKardex, FILTRO_SIN_ALMACEN, nombreSedeCorto, sedeDeAlmacen, stockEn,
  trasladoDeMovimiento, almacenPrincipalDeSede, agregarExistencias,
} from './stockPorAlmacen';

const almacenes = [
  { nombre: 'Los Pinos', sede: 'LOS PINOS' },
  { nombre: 'INSUMOS Y CONSUMIBLES', sede: 'LOS PINOS' },
  { nombre: 'General', sede: 'CENTRO DE FUNDICION - MATANZAS' },
  { nombre: 'Insumo y Consumibles', sede: 'CENTRO DE FUNDICION - MATANZAS' },
  { nombre: 'La Esperanza', sede: 'CENTRO DE ACOPIO - LA ESPERANZA' },
  { nombre: 'Huérfano', sede: null },
];

// Caso real: el almacenista de Los Pinos ve «Stock 20» en su lista y «Stock actual 35» en el modal.
const existencias = [
  { almacen: 'Los Pinos', stock: 15, costo_promedio: 2 },
  { almacen: 'INSUMOS Y CONSUMIBLES', stock: 5, costo_promedio: 2.5 },
  { almacen: 'General', stock: 15, costo_promedio: 1.8 },
  { almacen: 'Insumo y Consumibles', stock: 0, costo_promedio: 1.8 },   // fila fantasma: no cuenta
];

describe('nombreSedeCorto / etiquetaAlmacen', () => {
  it('acorta y capitaliza los nombres largos de sede', () => {
    expect(nombreSedeCorto('CENTRO DE FUNDICION - MATANZAS')).toBe('Matanzas');
    expect(nombreSedeCorto('LOS PINOS')).toBe('Los Pinos');
    expect(nombreSedeCorto('CENTRO DE ACOPIO - LA ESPERANZA')).toBe('Acopio La Esperanza');
    expect(nombreSedeCorto(null)).toBe('Sin sede');
    expect(nombreSedeCorto('Sin sede')).toBe('Sin sede');
  });
  it('distingue dos almacenes de nombre parecido por su sede', () => {
    expect(etiquetaAlmacen('INSUMOS Y CONSUMIBLES', almacenes)).toBe('Los Pinos › INSUMOS Y CONSUMIBLES');
    expect(etiquetaAlmacen('Insumo y Consumibles', almacenes)).toBe('Matanzas › Insumo y Consumibles');
    expect(etiquetaAlmacen('Huérfano', almacenes)).toBe('Huérfano');
  });
});

describe('desglosePorSede', () => {
  it('agrupa por sede, pone primero la sede desde la que se abrió y suma el total global', () => {
    const d = desglosePorSede(existencias, almacenes, 'LOS PINOS');
    expect(d.total).toBe(35);
    expect(d.sedes.map((s) => s.etiqueta)).toEqual(['Los Pinos', 'Matanzas']);
    expect(d.sedes[0].esOrigen).toBe(true);
    expect(d.sedes[0].stock).toBe(20);
    expect(d.sedes[0].almacenes.map((a) => a.almacen)).toEqual(['Los Pinos', 'INSUMOS Y CONSUMIBLES']);
    expect(d.sedes[1].esOrigen).toBe(false);
    expect(d.sedes[1].almacenes).toHaveLength(1);   // la fila con stock 0 no aparece
  });

  it('sin sede de origen ordena por stock y los almacenes desconocidos caen en «Sin sede»', () => {
    const d = desglosePorSede([...existencias, { almacen: 'Huérfano', stock: 50, costo_promedio: 0 }, { almacen: 'Nadie', stock: 1, costo_promedio: 0 }], almacenes, null);
    expect(d.sedes.map((s) => s.etiqueta)).toEqual(['Sin sede', 'Los Pinos', 'Matanzas']);
    expect(d.sedes[0].stock).toBe(51);
    expect(d.sedes.every((s) => !s.esOrigen)).toBe(true);
  });

  it('compara la sede sin importar mayúsculas ni espacios', () => {
    expect(desglosePorSede(existencias, almacenes, ' los pinos ').sedes[0].esOrigen).toBe(true);
  });
});

describe('stockEn / sedeDeAlmacen', () => {
  it('devuelve el stock del almacén pedido o 0', () => {
    expect(stockEn(existencias, 'General')).toBe(15);
    expect(stockEn(existencias, 'No existe')).toBe(0);
    expect(stockEn(existencias, null)).toBe(0);
    expect(sedeDeAlmacen('Huérfano', almacenes)).toBe('Sin sede');
  });
});

describe('kardex: chips, filtro y entradas/salidas', () => {
  // Incluye dos recepciones de OC sin almacén (así las inserta recibirOrdenParcial).
  const movs = [
    { id: 'a', at: '2026-08-01', delta: 10, almacen: null, costo_promedio: 1, precio_unitario: 1 },
    { id: 'b', at: '2026-08-02', delta: -3, almacen: 'General', costo_promedio: 1, precio_unitario: null },
    { id: 'c', at: '2026-08-03', delta: -2, almacen: 'General', costo_promedio: 1, precio_unitario: null },
    { id: 'd', at: '2026-08-04', delta: 8, almacen: 'General', costo_promedio: 1.5, precio_unitario: 2 },
    { id: 'e', at: '2026-08-05', delta: 4, almacen: 'Los Pinos', costo_promedio: 3, precio_unitario: 3 },
    { id: 'f', at: '2026-08-06', delta: -1, almacen: 'INSUMOS Y CONSUMIBLES', costo_promedio: 2.5, precio_unitario: null },
    { id: 'g', at: '2026-08-07', delta: 6, almacen: '', costo_promedio: 1.2, precio_unitario: 1.1 },
  ];

  it('lista los almacenes con los de la sede de origen primero, sin contar las líneas sin almacén', () => {
    expect(almacenesDelKardex(movs, almacenes, 'LOS PINOS')).toEqual(['INSUMOS Y CONSUMIBLES', 'Los Pinos', 'General']);
    expect(almacenesDelKardex(movs, almacenes, null)).toEqual(['General', 'INSUMOS Y CONSUMIBLES', 'Los Pinos']);
    expect(contarSinAlmacen(movs)).toBe(2);
  });

  it('el filtro por almacén conserva las recepciones sin almacén (no esconde compras) y el chip especial las aísla', () => {
    expect(filtrarKardex(movs, null)).toHaveLength(7);
    expect(filtrarKardex(movs, 'General').map((m) => m.id)).toEqual(['a', 'b', 'c', 'd', 'g']);
    expect(filtrarKardex(movs, FILTRO_SIN_ALMACEN).map((m) => m.id)).toEqual(['a', 'g']);
    expect(filtrarKardex(movs, 'Nada').map((m) => m.id)).toEqual(['a', 'g']);
  });

  it('entradas/salidas de un almacén no incluyen las líneas sin almacén; sin filtro incluyen todo', () => {
    expect(entradasSalidas(movs, 'General')).toEqual({ entradas: 8, salidas: 5 });
    expect(entradasSalidas(movs, null)).toEqual({ entradas: 28, salidas: 6 });
    expect(entradasSalidas(movs, FILTRO_SIN_ALMACEN)).toEqual({ entradas: 16, salidas: 0 });
  });

  it('el ajuste de PMP por recompra se calcula por almacén, no mezclando sedes', () => {
    const { ajustes, costoInicial } = ajustesPmpPorAlmacen(movs);
    expect(costoInicial).toBe(1);
    // 'd' (General): antes = último PMP de General (1), después 1.5
    expect(ajustes.get('d')).toEqual({ antes: 1, despues: 1.5, compra: 2 });
    // 'e' (Los Pinos): primera entrada de ese almacén → sin «antes» (antes se hubiera comparado con General)
    expect(ajustes.get('e')).toEqual({ antes: null, despues: 3, compra: 3 });
    // 'g' (sin almacén): se sigue con la otra línea sin almacén ('a', PMP 1)
    expect(ajustes.get('g')).toEqual({ antes: 1, despues: 1.2, compra: 1.1 });
  });
});

/* ── Reconstrucción del par origen → destino de un traslado ───────────────── */

// Los almacenes REALES de producción que crean ambigüedad. Los nombres son
// configuración del sistema, no datos de nadie.
const ALMACENES_REALES = [
  { nombre: 'Viveres y Art. Limpieza', sede: 'LOS PINOS' },
  { nombre: 'Viveres y Art. Limpieza · La Esperanza', sede: 'CENTRO DE ACOPIO - LA ESPERANZA' },
  { nombre: 'Viveves y Art. Limpieza', sede: 'CENTRO DE ACOPIO - PARGUAZA' },
  { nombre: 'CASITERITA', sede: 'CENTRO DE ACOPIO - LA ESPERANZA' },
  { nombre: 'CASITERITA ALMACEN', sede: 'CENTRO DE ACOPIO - PARGUAZA' },
  { nombre: 'CASITERITA SNO₂', sede: 'CENTRO DE ACOPIO - EL BURRO' },
  { nombre: 'GENERAL', sede: 'CENTRO DE ACOPIO - PARGUAZA' },
  { nombre: 'GENERAL - EL BURRO', sede: 'CENTRO DE ACOPIO - EL BURRO' },
  { nombre: 'General', sede: 'CENTRO DE FUNDICION - MATANZAS' },
  { nombre: 'Los Pinos', sede: 'LOS PINOS' },
  { nombre: 'COMBUSTIBLE', sede: 'CENTRO DE FUNDICION - MATANZAS' },
];

const mov = (almacen: string, detalle: string, tipo = 'transferencia') =>
  ({ almacen, detalle, tipo } as Parameters<typeof trasladoDeMovimiento>[0]);

describe('trasladoDeMovimiento', () => {
  it('los cuatro prefijos históricos, en las dos direcciones', () => {
    // «a X» = esta fila es la SALIDA: mi almacén es el origen.
    expect(trasladoDeMovimiento(mov('Los Pinos', 'Transferencia a COMBUSTIBLE'), ALMACENES_REALES))
      .toMatchObject({ origen: 'Los Pinos', destino: 'COMBUSTIBLE', nota: '', resuelto: true });
    expect(trasladoDeMovimiento(mov('Los Pinos', 'Traslado a COMBUSTIBLE'), ALMACENES_REALES))
      .toMatchObject({ origen: 'Los Pinos', destino: 'COMBUSTIBLE' });
    // «desde X» = esta fila es la ENTRADA: mi almacén es el destino.
    expect(trasladoDeMovimiento(mov('COMBUSTIBLE', 'Transferencia desde Los Pinos'), ALMACENES_REALES))
      .toMatchObject({ origen: 'Los Pinos', destino: 'COMBUSTIBLE' });
    expect(trasladoDeMovimiento(mov('COMBUSTIBLE', 'Traslado desde Los Pinos'), ALMACENES_REALES))
      .toMatchObject({ origen: 'Los Pinos', destino: 'COMBUSTIBLE' });
  });

  it('EL CASO QUE JUSTIFICA TODO: no corta por el primer « · »', () => {
    // 26 movimientos reales con este detalle. Cortar por el primer « · » daría
    // «Viveres y Art. Limpieza», que existe pero es de LOS PINOS, otra sede.
    const t = trasladoDeMovimiento(
      mov('General', 'Traslado a Viveres y Art. Limpieza · La Esperanza · SOLICITUD DE TRASLADO'),
      ALMACENES_REALES,
    );
    expect(t?.destino).toBe('Viveres y Art. Limpieza · La Esperanza');
    expect(t?.destino).not.toBe('Viveres y Art. Limpieza');
    expect(t?.nota).toBe('SOLICITUD DE TRASLADO');
    expect(t?.resuelto).toBe(true);
  });

  it('el nombre exacto le gana al prefijo, y sin nota la nota queda vacía', () => {
    const t = trasladoDeMovimiento(
      mov('General', 'Traslado a Viveres y Art. Limpieza · La Esperanza'),
      ALMACENES_REALES,
    );
    expect(t).toMatchObject({ destino: 'Viveres y Art. Limpieza · La Esperanza', nota: '', resuelto: true });
  });

  it('separa la nota de consolidación sin comérsele el nombre', () => {
    const t = trasladoDeMovimiento(
      mov('ALMACEN CASITERITA', 'Transferencia a GENERAL · Consolidación por cambio de almacén del producto'),
      ALMACENES_REALES,
    );
    expect(t).toMatchObject({
      origen: 'ALMACEN CASITERITA', destino: 'GENERAL',
      nota: 'Consolidación por cambio de almacén del producto', resuelto: true,
    });
  });

  it('no confunde almacenes cuyo nombre es prefijo de otro', () => {
    expect(trasladoDeMovimiento(mov('Los Pinos', 'Traslado a CASITERITA ALMACEN'), ALMACENES_REALES)?.destino)
      .toBe('CASITERITA ALMACEN');
    expect(trasladoDeMovimiento(mov('Los Pinos', 'Traslado a CASITERITA'), ALMACENES_REALES)?.destino)
      .toBe('CASITERITA');
    expect(trasladoDeMovimiento(mov('Los Pinos', 'Traslado a GENERAL - EL BURRO'), ALMACENES_REALES)?.destino)
      .toBe('GENERAL - EL BURRO');
  });

  it('una contraparte desconocida se corta a ciegas pero queda MARCADA', () => {
    const t = trasladoDeMovimiento(mov('General', 'Traslado a ALMACEN BORRADO · motivo x'), ALMACENES_REALES);
    expect(t).toMatchObject({ destino: 'ALMACEN BORRADO', nota: 'motivo x', resuelto: false });
  });

  it('devuelve null cuando no hay nada que afirmar', () => {
    // Todavía no llegó la lista de almacenes: no se inventa un origen.
    expect(trasladoDeMovimiento(mov('General', 'Traslado a COMBUSTIBLE'), [])).toBeNull();
    // No es un traslado.
    expect(trasladoDeMovimiento(mov('General', 'PARA REFINACION #5', 'salida'), ALMACENES_REALES)).toBeNull();
    // Es transferencia pero el detalle no trae prefijo conocido.
    expect(trasladoDeMovimiento(mov('General', 'Consolidacion por cambio de almacen'), ALMACENES_REALES)).toBeNull();
    expect(trasladoDeMovimiento(mov('General', ''), ALMACENES_REALES)).toBeNull();
  });
});

/* ── Almacén principal de cada sede ────────────────────────────────────────
   Los nombres son los REALES de la base: si mañana se renombra un almacén y
   una sede queda apuntando al lugar equivocado, estos tests lo cantan. */
describe('almacenPrincipalDeSede', () => {
  const REALES = [
    { nombre: 'COMBUSTIBLE', sede: 'CENTRO DE FUNDICION - MATANZAS', parent_id: null },
    { nombre: 'DEPOSITO', sede: 'CENTRO DE FUNDICION - MATANZAS', parent_id: null },
    { nombre: 'ESTAÑO EN BRUTO', sede: 'CENTRO DE FUNDICION - MATANZAS', parent_id: null },
    { nombre: 'General', sede: 'CENTRO DE FUNDICION - MATANZAS', parent_id: null },
    { nombre: 'Insumo y Consumibles', sede: 'CENTRO DE FUNDICION - MATANZAS', parent_id: null },
    { nombre: 'Resguardo', sede: 'CENTRO DE FUNDICION - MATANZAS', parent_id: null },
    { nombre: 'INSUMOS Y CONSUMIBLES', sede: 'LOS PINOS', parent_id: 'x' },
    { nombre: 'Los Pinos', sede: 'LOS PINOS', parent_id: null },
    { nombre: 'SNO₂ CASITERITA ALMACEN', sede: 'LOS PINOS', parent_id: null },
    { nombre: 'CASITERITA', sede: 'CENTRO DE ACOPIO - LA ESPERANZA', parent_id: 'y' },
    { nombre: 'La Esperanza', sede: 'CENTRO DE ACOPIO - LA ESPERANZA', parent_id: null },
    { nombre: 'SNO₂ CASITERITA', sede: 'CENTRO DE ACOPIO - LA ESPERANZA', parent_id: null },
    { nombre: 'CASITERITA SNO₂', sede: 'CENTRO DE ACOPIO - EL BURRO', parent_id: null },
    { nombre: 'GENERAL - EL BURRO', sede: 'CENTRO DE ACOPIO - EL BURRO', parent_id: null },
    { nombre: 'CASITERITA ALMACEN', sede: 'CENTRO DE ACOPIO - PARGUAZA', parent_id: 'z' },
    { nombre: 'GENERAL', sede: 'CENTRO DE ACOPIO - PARGUAZA', parent_id: null },
    { nombre: 'ALMACEN CASITERITA', sede: 'CENTRO DE ACOPIO - LOS PIJIGUAOS', parent_id: 'w' },
    { nombre: 'Principal', sede: 'CENTRO DE ACOPIO - LOS PIJIGUAOS', parent_id: null },
  ];

  it('Matanza cae en General y NO en COMBUSTIBLE (el primero alfabetico)', () => {
    expect(almacenPrincipalDeSede('CENTRO DE FUNDICION - MATANZAS', REALES)).toBe('General');
  });

  it('Los Pinos cae en Los Pinos y NO en INSUMOS Y CONSUMIBLES', () => {
    expect(almacenPrincipalDeSede('LOS PINOS', REALES)).toBe('Los Pinos');
  });

  it('La Esperanza cae en La Esperanza y NO en CASITERITA', () => {
    expect(almacenPrincipalDeSede('CENTRO DE ACOPIO - LA ESPERANZA', REALES)).toBe('La Esperanza');
  });

  it('El Burro cae en su GENERAL', () => {
    expect(almacenPrincipalDeSede('CENTRO DE ACOPIO - EL BURRO', REALES)).toBe('GENERAL - EL BURRO');
  });

  it('Parguaza cae en GENERAL', () => {
    expect(almacenPrincipalDeSede('CENTRO DE ACOPIO - PARGUAZA', REALES)).toBe('GENERAL');
  });

  it('Los Pijiguaos cae en Principal', () => {
    expect(almacenPrincipalDeSede('CENTRO DE ACOPIO - LOS PIJIGUAOS', REALES)).toBe('Principal');
  });

  it('ignora mayusculas y espacios al comparar la sede', () => {
    expect(almacenPrincipalDeSede('  los pinos  ', REALES)).toBe('Los Pinos');
  });

  it('una sede sin almacenes devuelve null', () => {
    expect(almacenPrincipalDeSede('CENTRO DE ACOPIO - INEXISTENTE', REALES)).toBeNull();
  });

  it('sin sede devuelve null', () => {
    expect(almacenPrincipalDeSede('', REALES)).toBeNull();
    expect(almacenPrincipalDeSede(null, REALES)).toBeNull();
  });

  it('si la sede SOLO tiene subalmacenes, usa uno igual en vez de dejar sin destino', () => {
    const soloSubs = [{ nombre: 'CASITERITA', sede: 'CENTRO DE ACOPIO - X', parent_id: 'p' }];
    expect(almacenPrincipalDeSede('CENTRO DE ACOPIO - X', soloSubs)).toBe('CASITERITA');
  });

  it('tolera una lista vacia', () => {
    expect(almacenPrincipalDeSede('LOS PINOS', [])).toBeNull();
  });
});

/* ── Costo de un producto agotado ──────────────────────────────────────────
   Un producto en 0 debe seguir MOSTRANDO su costo, pero NO sumar valor.
   El caso real: PEPINO (HOR-022) tiene costo 1,27 guardado en La Esperanza
   con stock 0, y la tabla mostraba «$ 0,00» como si nunca hubiera tenido
   precio, mezclándolo con los productos que de verdad no tienen costo. */
describe('agregarExistencias', () => {
  const todo = () => true;
  const ex = (almacen: string, stock: number, costo: number) => ({
    producto_id: 'p1', almacen, stock, costo_promedio: costo,
  });

  it('promedia ponderado cuando hay stock', () => {
    const r = agregarExistencias([ex('A', 10, 2), ex('B', 10, 4)], todo);
    expect(r.get('p1')).toEqual({ stock: 20, costo: 3 });
  });

  it('PEPINO agotado conserva su costo de 1,27', () => {
    const r = agregarExistencias([ex('La Esperanza', 0, 1.27)], todo);
    expect(r.get('p1')!.costo).toBe(1.27);
    expect(r.get('p1')!.stock).toBe(0);
  });

  it('el valor de un agotado es 0 aunque tenga costo', () => {
    const r = agregarExistencias([ex('La Esperanza', 0, 1.27)], todo)!.get('p1')!;
    expect(r.stock * r.costo).toBe(0);
  });

  it('sin stock en ningun almacen usa el costo mas alto conocido', () => {
    const r = agregarExistencias([ex('A', 0, 1.1), ex('B', 0, 2.4), ex('C', 0, 0)], todo);
    expect(r.get('p1')!.costo).toBe(2.4);
  });

  it('con stock en uno solo, el agotado no arrastra el promedio a 0', () => {
    // Antes: (3*1.27 + 0*1.27) / 3 = 1.27 estaba bien; el problema era el 0 total.
    const r = agregarExistencias([ex('Los Pinos', 3, 1.27), ex('La Esperanza', 0, 1.27)], todo);
    expect(r.get('p1')).toEqual({ stock: 3, costo: 1.27 });
  });

  it('sin costo en ningun lado devuelve 0 (queda para «Sin costo»)', () => {
    const r = agregarExistencias([ex('A', 5, 0)], todo);
    expect(r.get('p1')!.costo).toBe(0);
  });

  it('respeta el filtro de almacenes', () => {
    const r = agregarExistencias([ex('A', 5, 2), ex('B', 7, 3)], (a) => a === 'B');
    expect(r.get('p1')).toEqual({ stock: 7, costo: 3 });
  });

  it('separa productos distintos', () => {
    const r = agregarExistencias([
      { producto_id: 'x', almacen: 'A', stock: 2, costo_promedio: 5 },
      { producto_id: 'y', almacen: 'A', stock: 0, costo_promedio: 9 },
    ], todo);
    expect(r.get('x')).toEqual({ stock: 2, costo: 5 });
    expect(r.get('y')).toEqual({ stock: 0, costo: 9 });
  });

  it('tolera stock y costo nulos', () => {
    const r = agregarExistencias([{ producto_id: 'p1', almacen: 'A', stock: null, costo_promedio: null }], todo);
    expect(r.get('p1')).toEqual({ stock: 0, costo: 0 });
  });

  it('tolera una lista vacia', () => {
    expect(agregarExistencias([], todo).size).toBe(0);
  });
});
