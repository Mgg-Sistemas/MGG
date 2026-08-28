import { describe, it, expect } from 'vitest';
import {
  ajustesPmpPorAlmacen, almacenesDelKardex, contarSinAlmacen, desglosePorSede, entradasSalidas, etiquetaAlmacen,
  filtrarKardex, FILTRO_SIN_ALMACEN, nombreSedeCorto, sedeDeAlmacen, stockEn,
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
