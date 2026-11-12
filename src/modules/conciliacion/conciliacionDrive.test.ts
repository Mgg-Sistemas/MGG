import { describe, expect, it } from 'vitest';
import {
  analizarTablaDrive, cruzarDrive, driveDe, EVENTO_DRIVE, leerMontoBs, mismaReferencia, normalizarCodigoOc, pagadoBsTesoreria, ubicarColumnas,
} from './conciliacionDrive';
import { armarFila, filtrar } from './conciliacion';
import type { Orden } from '@/shared/lib/types';

describe('normalizarCodigoOc', () => {
  it('acepta variantes del código', () => {
    expect(normalizarCodigoOc('oc-2026-251')).toBe('OC-2026-0251');
    expect(normalizarCodigoOc(' OC 2026 0251 ')).toBe('OC-2026-0251');
    expect(normalizarCodigoOc('SP-2026-0238-2')).toBe('SP-2026-0238-2');
    expect(normalizarCodigoOc('')).toBe('');
  });
});

describe('mismaReferencia', () => {
  it('los últimos 4 dígitos de Tesorería contra la referencia completa del banco', () => {
    expect(mismaReferencia('000123456196', '6196')).toBe(true);
    expect(mismaReferencia('Ref. 0001-2345-6196', '6196')).toBe(true);
    expect(mismaReferencia('000123456197', '6196')).toBe(false);
  });
  it('menos de 4 dígitos no alcanza; los ceros a la izquierda no cuentan', () => {
    expect(mismaReferencia('12345196', '196')).toBe(false);
    expect(mismaReferencia('123456', '000123456')).toBe(true);
    expect(mismaReferencia('', '6196')).toBe(false);
  });
});

describe('leerMontoBs', () => {
  it('números de Excel y textos venezolanos', () => {
    expect(leerMontoBs(281103.06)).toBe(281103.06);
    expect(leerMontoBs('Bs 281.103,06')).toBe(281103.06);
    expect(leerMontoBs('281103.06')).toBe(281103.06);
    expect(leerMontoBs('281,103.06')).toBe(281103.06);
    expect(leerMontoBs('1.500')).toBe(1500);
    expect(leerMontoBs('1500,5')).toBe(1500.5);
    expect(Number.isNaN(leerMontoBs('abc'))).toBe(true);
    expect(Number.isNaN(leerMontoBs(''))).toBe(true);
  });
});

describe('ubicarColumnas', () => {
  it('encuentra el encabezado aunque haya títulos arriba', () => {
    const t = [['ESTADO DE CUENTA'], [], ['Fecha', 'N° OC', 'Nro. Referencia', 'Monto (Bs)']];
    expect(ubicarColumnas(t)).toEqual({ fila: 2, col: { codigo: 1, referencia: 2, monto: 3 } });
  });
  it('null si falta una columna', () => {
    expect(ubicarColumnas([['OC', 'Monto']])).toBeNull();
  });
});

const ordenes = [{ id: 'a', codigo: 'OC-2026-0251', sp: 'SP-1' }, { id: 'b', codigo: 'OC-2026-0250', sp: 'SP-2' }];

describe('analizarTablaDrive (validación como Inventario)', () => {
  it('Validado', () => {
    const a = analizarTablaDrive([['Código OC', 'Referencia', 'Monto Bs'], ['OC-2026-0251', '000123456196', 281103.06], ['oc-2026-250', '6885', '90.833,91']], 'x.xlsx', ordenes);
    expect(a.estado).toBe('Validado');
    expect(a.validas).toBe(2);
    expect(a.porOrden.get('b')).toMatchObject({ referencias: ['6885'], montoBs: 90833.91, filas: [3] });
  });
  it('Error: OC inexistente, referencia vacía, monto con letras', () => {
    const a = analizarTablaDrive([['OC', 'Referencia', 'Monto'], ['OC-2026-9999', '1234', 5], ['OC-2026-0251', '', 'diez']], 'x.csv', ordenes);
    expect(a.estado).toBe('Error');
    expect(a.conError).toBe(2);
    expect(a.errorPorColumna).toEqual({ codigo: 1, referencia: 1, monto: 1 });
    expect(a.porOrden.size).toBe(0);
  });
  it('Duplicados: la OC repetida se junta', () => {
    const a = analizarTablaDrive([['OC', 'Referencia', 'Monto Bs'], ['OC-2026-0251', '1111', 100], ['OC-2026-0251', '2222', 50.5], [null, null, null]], 'x.csv', ordenes);
    expect(a.estado).toBe('Duplicados');
    expect(a.total).toBe(2);
    expect(a.porOrden.get('a')).toMatchObject({ referencias: ['1111', '2222'], montoBs: 150.5 });
  });
  it('sin encabezados reconocibles avisa', () => {
    expect(() => analizarTablaDrive([['a', 'b']], 'x.csv', ordenes)).toThrow(/columnas/);
  });
});

describe('cruzarDrive', () => {
  const fila = { referencia: { bs: '6196', binance: null, manual: null }, montoBs: 281000 };
  const datos = { referencias: ['000123456196'], montoBs: 281103.06, archivo: 'x', filas: [2] };
  it('CUADRA con lo pagado en Bs de Tesorería', () => {
    expect(cruzarDrive(fila, datos, 281103.06).estado).toBe('CUADRA');
  });
  it('NO CUADRA por monto o por referencia', () => {
    expect(cruzarDrive(fila, datos, 281000.5)).toMatchObject({ estado: 'NO CUADRA' });
    expect(cruzarDrive(fila, { ...datos, referencias: ['9999'] }, 281103.06).motivo).toMatch(/Referencia distinta/);
    expect(cruzarDrive({ ...fila, referencia: { bs: null, binance: null } }, datos, 281103.06).motivo).toMatch(/no tiene referencia/);
  });
  it('vale la referencia colocada en Conciliación y el monto Bs de la OC', () => {
    expect(cruzarDrive({ referencia: { bs: null, binance: null, manual: '55667788' }, montoBs: 100 }, { ...datos, referencias: ['55667788'], montoBs: 100.03 }, null).estado).toBe('CUADRA');
  });
});

describe('historial y fila', () => {
  const historial = [
    { evento: 'pagada', referencia_bs: '6196', multipago: [{ monto: 281103.06, moneda: 'Bs' }, { monto: 10, moneda: 'USD' }] },
    { evento: EVENTO_DRIVE, referencias: ['000123456196'], monto_bs: 281103.06, archivo: 'nov.xlsx', filas: [2] },
  ];
  it('lee lo pagado en Bs y el último Drive', () => {
    expect(pagadoBsTesoreria(historial)).toBe(281103.06);
    expect(driveDe(historial)).toMatchObject({ archivo: 'nov.xlsx', montoBs: 281103.06 });
    expect(driveDe([])).toBeNull();
  });
  it('la fila trae el DRIVE y se filtra por él', () => {
    const o = { id: 'a', codigo: 'SP-1', oc_codigo: 'OC-2026-0251', estado: 'pagada', total: 310.8, moneda: 'USD', pagada_en: '2026-11-12T18:00:00Z', historial } as unknown as Orden;
    const f = armarFila({ orden: o, proveedor: 'P', tasaPago: 904.45, tasaHoy: null }, 1);
    expect(f.drive?.estado).toBe('CUADRA');
    expect(filtrar([f], { drive: ['cuadra'] })).toHaveLength(1);
    expect(filtrar([f], { drive: ['no_cuadra', 'sin'] })).toHaveLength(0);
  });
});

describe('leerTablaArchivo', () => {
  it('CSV con punto y coma, decimales con coma y ceros a la izquierda', async () => {
    const { leerTablaArchivo } = await import('./conciliacionDrive');
    const csv = '\uFEFFCódigo OC;Referencia;Monto Bs\nOC-2026-0251;000123456196;281.103,06\nOC-2026-0250;6885;1.500\n';
    const t = await leerTablaArchivo(new File([csv], 'drive.csv', { type: 'text/csv' }));
    const a = analizarTablaDrive(t, 'drive.csv', ordenes);
    expect(a.estado).toBe('Validado');
    expect(a.porOrden.get('a')).toMatchObject({ referencias: ['000123456196'], montoBs: 281103.06 });
    expect(a.porOrden.get('b')?.montoBs).toBe(1500);
  });
});
