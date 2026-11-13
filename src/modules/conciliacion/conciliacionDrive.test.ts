import { describe, expect, it } from 'vitest';
import {
  analizarTablaDrive, convertirCajaATablaEstandar, cruzarDrive, driveDe, esCajaMultimoneda, EVENTO_DRIVE,
  extraerMonto, extraerOdc, extraerReferencia, extraerTipoRetencion, leerMontoBs, leerTablaArchivo,
  mismaReferencia, normalizarCodigoOc, pagadoBsTesoreria, parsearCajaMultimoneda, serialExcelAFechaIso,
  ubicarColumnas, ubicarColumnasCaja,
} from './conciliacionDrive';
import { armarFila, filtrar } from './conciliacion';
import type { Orden } from '@/shared/lib/types';
import * as fs from 'fs';
import * as path from 'path';

describe('normalizarCodigoOc', () => {
  it('acepta variantes del código estándar y ODC directo', () => {
    expect(normalizarCodigoOc('oc-2026-251')).toBe('OC-2026-0251');
    expect(normalizarCodigoOc(' OC 2026 0251 ')).toBe('OC-2026-0251');
    expect(normalizarCodigoOc('SP-2026-0238-2')).toBe('SP-2026-0238-2');
    expect(normalizarCodigoOc('ODC 183')).toBe('OC-2026-0183');
    expect(normalizarCodigoOc('ODC-236')).toBe('OC-2026-0236');
    expect(normalizarCodigoOc('ODC 0039')).toBe('OC-2026-0039');
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

describe('serialExcelAFechaIso', () => {
  it('convierte números seriales de Excel a fecha YYYY-MM-DD', () => {
    expect(serialExcelAFechaIso(46326)).toBe('2026-10-31');
    expect(serialExcelAFechaIso(46327)).toBe('2026-11-01');
    expect(serialExcelAFechaIso(46328)).toBe('2026-11-02');
    expect(serialExcelAFechaIso(46336)).toBe('2026-11-10');
  });
  it('respeta fechas en texto ISO o formato latino', () => {
    expect(serialExcelAFechaIso('2026-11-02')).toBe('2026-11-02');
    expect(serialExcelAFechaIso('02/11/2026')).toBe('2026-11-02');
    expect(serialExcelAFechaIso('10-11-2026')).toBe('2026-11-10');
    expect(serialExcelAFechaIso(null)).toBe('');
    expect(serialExcelAFechaIso('')).toBe('');
  });
});

describe('extraerOdc', () => {
  it('extrae ODC individual y normaliza a OC-2026-XXXX', () => {
    expect(extraerOdc('PAGO ODC183 GT RODAMIENTOS')).toEqual(['OC-2026-0183']);
    expect(extraerOdc('PAGO ODC 236 MERCADO MGG')).toEqual(['OC-2026-0236']);
    expect(extraerOdc('ODC 0039 AMORTIGUADOR MACHITO')).toEqual(['OC-2026-0039']);
  });
  it('extrae múltiples ODCs en una sola descripción', () => {
    expect(extraerOdc('PAGO ODC 189 Y 191 GT PARA MATERIALES')).toEqual(['OC-2026-0189', 'OC-2026-0191']);
    expect(extraerOdc('reintegro de ODC 236 MGG Y ODC 181 GT por retenciones')).toEqual(['OC-2026-0236', 'OC-2026-0181']);
    expect(extraerOdc('ODC 101, 102 Y 103 REPUESTOS')).toEqual(['OC-2026-0101', 'OC-2026-0102', 'OC-2026-0103']);
  });
  it('no coincide con palabras como OCTUBRE', () => {
    expect(extraerOdc('ENTRADA DE CIERRE CAJA MES OCTUBRE  2026')).toEqual([]);
    expect(extraerOdc('PAGO SIN ODC HASTA QUE SE ACTIVE EL SISTEMA')).toEqual([]);
  });
});

describe('extraerReferencia, extraerMonto y extraerTipoRetencion', () => {
  it('extrae referencia bancaria o número de factura', () => {
    expect(extraerReferencia('REF 35137250\nMONTO 198.127,26')).toBe('35137250');
    expect(extraerReferencia('REF  68973570')).toBe('68973570');
    expect(extraerReferencia('REF: 01709810')).toBe('01709810');
    expect(extraerReferencia('reintegro ODC 201 por retenciones asociadas a factura #00322')).toBe('00322');
    expect(extraerReferencia('sin referencia en el texto')).toBe('');
  });
  it('extrae monto de columna o de descripción', () => {
    expect(extraerMonto(198127.26, 'texto')).toBe(198127.26);
    expect(extraerMonto(null, 'REF 351641\n MONTO 1.034.972,96 BSS- TESORO')).toBe(1034972.96);
    expect(extraerMonto(null, 'MONTO 289.750,00')).toBe(289750);
  });
  it('extrae tipo de retención para reintegros', () => {
    expect(extraerTipoRetencion('reintegro ODC 201 por retenciones ISAE-ISLR-IVA asociadas')).toBe('ISAE-ISLR-IVA');
    expect(extraerTipoRetencion('reintegro de ODC 236 MGG por retenciones ISAE- IVA')).toBe('ISAE-IVA');
    expect(extraerTipoRetencion('ENTRADA DE REINTEGRO POR DESCUENTO APLICADO')).toBe('DESCUENTO');
    expect(extraerTipoRetencion('PAGO DE MERCADO')).toBeUndefined();
  });
});

describe('ubicarColumnas', () => {
  it('encuentra el encabezado estándar aunque haya títulos arriba', () => {
    const t = [['ESTADO DE CUENTA'], [], ['Fecha', 'N° OC', 'Nro. Referencia', 'Monto (Bs)']];
    expect(ubicarColumnas(t)).toEqual({ fila: 2, col: { codigo: 1, referencia: 2, monto: 3 } });
  });
  it('null si falta una columna', () => {
    expect(ubicarColumnas([['OC', 'Monto']])).toBeNull();
  });
});

const ordenes = [
  { id: 'a', codigo: 'OC-2026-0251', sp: 'SP-1' },
  { id: 'b', codigo: 'OC-2026-0250', sp: 'SP-2' },
  { id: 'c', codigo: 'OC-2026-0236', sp: 'SP-3' },
  { id: 'd', codigo: 'OC-2026-0201', sp: 'SP-4' },
];

describe('analizarTablaDrive (validación como Inventario - 100% retrocompatible)', () => {
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
  it('Duplicados: la OC repetida en el mismo archivo se junta', () => {
    const a = analizarTablaDrive([['OC', 'Referencia', 'Monto Bs'], ['OC-2026-0251', '1111', 100], ['OC-2026-0251', '2222', 50.5], [null, null, null]], 'x.csv', ordenes);
    expect(a.estado).toBe('Duplicados');
    expect(a.total).toBe(2);
    expect(a.porOrden.get('a')).toMatchObject({ referencias: ['1111', '2222'], montoBs: 150.5 });
  });
  it('sin encabezados reconocibles avisa', () => {
    expect(() => analizarTablaDrive([['a', 'b']], 'x.csv', ordenes)).toThrow(/columnas/);
  });
});

describe('Control de duplicados y prevención de doble cruce (ya conciliadas)', () => {
  it('si una OC ya está conciliada en el sistema (CUADRA), no suma doble ni da error', () => {
    const ordenesConConciliada = [
      { id: 'a', codigo: 'OC-2026-0251', yaConciliada: true },
      { id: 'b', codigo: 'OC-2026-0250', yaConciliada: false },
    ];
    // Se sube un archivo semanal que aún contiene la OC ya conciliada y una OC nueva
    const tabla = [
      ['Código OC', 'Referencia', 'Monto Bs'],
      ['OC-2026-0251', '68973570', 281103.06],
      ['OC-2026-0250', '68974400', 90833.91],
    ];
    const a = analizarTablaDrive(tabla, 'semanal.xlsx', ordenesConConciliada);
    expect(a.estado).toBe('Validado');
    expect(a.yaConciliadas).toBe(1);
    expect(a.validas).toBe(1);
    // La OC ya conciliada NO se añade a porOrden para no reescribir ni duplicar montos
    expect(a.porOrden.has('a')).toBe(false);
    expect(a.porOrden.has('b')).toBe(true);
    expect(a.filas[0]).toMatchObject({ codigo: 'OC-2026-0251', estado: 'ya_conciliada', yaConciliada: true });
    expect(a.filas[1]).toMatchObject({ codigo: 'OC-2026-0250', estado: 'valido', yaConciliada: false });
  });

  it('si una OC ya conciliada aparece varias veces en el archivo, se marca ya_conciliada sin duplicar monto', () => {
    const ordenesConConciliada = [
      { id: 'a', codigo: 'OC-2026-0251', yaConciliada: true },
    ];
    const tabla = [
      ['Código OC', 'Referencia', 'Monto Bs'],
      ['OC-2026-0251', '68973570', 281103.06],
      ['OC-2026-0251', '68973570', 281103.06],
    ];
    const a = analizarTablaDrive(tabla, 'acumulado.xlsx', ordenesConConciliada);
    expect(a.estado).toBe('Validado');
    expect(a.yaConciliadas).toBe(2);
    expect(a.duplicadas).toBe(0);
    expect(a.porOrden.size).toBe(0);
  });
});

describe('Parser de Caja Multimoneda (MGG vs GT, Salidas y Reintegros)', () => {
  const encabezadoCaja = [
    'fecha', 'Año-Mes', 'Movimiento', 'Moneda', 'Monto', null, 'Conversion \na $USD',
    'Nombre @ Descripción', 'Desde (Proviene)', 'Hacia (Destino)', 'Clasificación', 'Sub-clasificación',
  ];

  it('detecta encabezados de Caja Multimoneda', () => {
    expect(esCajaMultimoneda([encabezadoCaja])).toBe(true);
    expect(ubicarColumnasCaja([encabezadoCaja])).toMatchObject({ descripcion: 7, monto: 4, movimiento: 2 });
  });

  it('extrae salidas de órdenes MGG y descarta las de GT', () => {
    const tabla = [
      encabezadoCaja,
      // Fila 36 real: GT rodamiento (debe descartarse para MGG)
      [46328, '2026-11', 'SALIDA (ENTREGO)', 'BDT JURIDICO GT', 198127.26, null, null, 'PAGO ODC183 GT RODAMIENTOS PARA REPARAR LÍNEA DE PRODUCCIÓN\nREF 35137250\nMONTO 198.127,26', 'CAJAS PRINCIPAL', 'GOLDEN TOUCH PERAMANAL', 'Golden Touch', 'Gasto- Centro de Costo'],
      // Fila 42 real: MGG Mercado (debe extraerse)
      [46328, '2026-11', 'SALIDA (ENTREGO)', 'BDT JURIDICO GT', 2752983.23, null, null, 'PAGO ODC 236 MERCADO MGG\n REF 35165268\n MONTO 2.752.983,23 BSS -TESORO', 'CAJAS PRINCIPAL', 'GOLDEN TOUCH PERAMANAL', 'Alimentacion', 'Mercado Los Pinos'],
      // Fila 193 real: MGG Cocina Los Pinos (debe extraerse)
      [46336, '2026-11', 'SALIDA (ENTREGO)', 'BDT JURIDICO GT', 281103.06, null, null, 'PAGO ODC 251 PESCADOS PARA LA COCINA LOS PINOS\nREF  68973570\nMONTO 281.103,06 BSS BDV JURIDICO', 'CAJAS PRINCIPAL', 'MINERAL GROUP GUAYANA', 'Alimentacion', 'Mercado Los Pinos'],
    ];

    const parsed = parsearCajaMultimoneda(tabla, { ordenesMgg: ordenes, soloMgg: true });
    // Solo deben entrar ODC 236 y ODC 251 (ambas de MGG). ODC 183 de GT fue ignorada.
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      codigo: 'OC-2026-0236',
      referencia: '35165268',
      montoBs: 2752983.23,
      tipo: 'salida',
      fecha: '2026-11-02',
    });
    expect(parsed[1]).toMatchObject({
      codigo: 'OC-2026-0251',
      referencia: '68973570',
      montoBs: 281103.06,
      tipo: 'salida',
      fecha: '2026-11-10',
    });
  });

  it('extrae reintegros y entradas de retención de MGG con su fecha y retención', () => {
    const tabla = [
      encabezadoCaja,
      // Fila 165 real: reintegro ODC 201 por retenciones ISAE-ISLR-IVA
      [46336, '2026-11', 'ENTRADA (RECIBO)', 'BDV PERSONAL PALMA', 91833.41, null, null, 'reintegro ODC 201 por retenciones ISAE-ISLR-IVA asociadas a factura #00322 de AMLV CREATIVO, C.A por elaboración de chemises para personal.', 'CAJAS PRINCIPAL', 'MINERAL GROUP GUAYANA', 'Monedas', 'Monedas'],
      // Fila 170 real: reintegro GT en hierro san felix (debe descartarse)
      [46336, '2026-11', 'ENTRADA (RECIBO)', 'BDT JURIDICO GT', 48538.83, null, null, 'ENTRADA DE REINTEGRO POR DESCUENTO APLICADO A LA COMPRA DE LA ODC 189 Y 191 GT EN HIERRO SAN FELIX', 'CAJAS PRINCIPAL', 'GOLDEN TOUCH PERAMANAL', 'Monedas', 'Monedas'],
    ];

    const parsed = parsearCajaMultimoneda(tabla, { ordenesMgg: ordenes, soloMgg: true });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      codigo: 'OC-2026-0201',
      referencia: '00322',
      montoBs: 91833.41,
      tipo: 'reintegro',
      tipoRetencion: 'ISAE-ISLR-IVA',
      fecha: '2026-11-10',
    });
  });

  it('maneja fila con múltiples ODCs dividiendo el monto equitativamente entre las ODC de MGG', () => {
    const tabla = [
      encabezadoCaja,
      // Fila 149 real: reintegro de ODC 236 MGG Y ODC 181 GT por retenciones
      [46335, '2026-11', 'ENTRADA (RECIBO)', 'BDT JURIDICO GT', 197225.38, null, null, 'reintegro de ODC 236 MGG Y ODC 181 GT por retenciones ISAE- IVA asociadas a facturas # 00003010- #00003011 de SUPER HOME, C.A por compra de comida al personal.', 'CAJAS PRINCIPAL', 'MINERAL GROUP GUAYANA', 'Monedas', 'Monedas'],
    ];

    const parsed = parsearCajaMultimoneda(tabla, { ordenesMgg: ordenes, soloMgg: true });
    // Solo toma ODC 236 (MGG) y la parte proporcional
    expect(parsed).toHaveLength(1);
    expect(parsed[0].codigo).toBe('OC-2026-0236');
    expect(parsed[0].montoBs).toBe(Math.round((197225.38 / 2) * 100) / 100);
    expect(parsed[0].tipo).toBe('reintegro');
    expect(parsed[0].tipoRetencion).toBe('ISAE-IVA');
  });

  it('analizarTablaDrive procesa directamente una tabla cruda de Caja Multimoneda', () => {
    const tabla = [
      encabezadoCaja,
      [46328, '2026-11', 'SALIDA (ENTREGO)', 'BDT JURIDICO GT', 2752983.23, null, null, 'PAGO ODC 236 MERCADO MGG\n REF 35165268\n MONTO 2.752.983,23 BSS -TESORO', 'CAJAS PRINCIPAL', 'GOLDEN TOUCH PERAMANAL', 'Alimentacion', 'Mercado Los Pinos'],
      [46336, '2026-11', 'ENTRADA (RECIBO)', 'BDV PERSONAL PALMA', 91833.41, null, null, 'reintegro ODC 201 por retenciones ISAE-ISLR-IVA asociadas a factura #00322 de AMLV CREATIVO, C.A', 'CAJAS PRINCIPAL', 'MINERAL GROUP GUAYANA', 'Monedas', 'Monedas'],
    ];

    const a = analizarTablaDrive(tabla, 'caja.xlsx', ordenes);
    expect(a.estado).toBe('Validado');
    expect(a.validas).toBe(2);
    expect(a.porOrden.get('c')).toMatchObject({ referencias: ['35165268'], montoBs: 2752983.23 });
    expect(a.porOrdenEntradas?.get('d')).toMatchObject({ referencias: ['00322'], montoBs: 91833.41 });
  });

  it('convertirCajaATablaEstandar genera la estructura tabular normalizada', () => {
    const tabla = [
      encabezadoCaja,
      [46328, '2026-11', 'SALIDA (ENTREGO)', 'BDT JURIDICO GT', 2752983.23, null, null, 'PAGO ODC 236 MERCADO MGG\n REF 35165268\n MONTO 2.752.983,23 BSS -TESORO', 'CAJAS PRINCIPAL', 'GOLDEN TOUCH PERAMANAL', 'Alimentacion', 'Mercado Los Pinos'],
    ];
    const std = convertirCajaATablaEstandar(tabla, ordenes);
    expect(std[0]).toEqual(['Código OC', 'Referencia', 'Monto Bs', 'Fecha', 'Tipo', 'Tipo Retención', 'Descripción', 'Fila Original']);
    expect(std[1][0]).toBe('OC-2026-0236');
    expect(std[1][1]).toBe('35165268');
    expect(std[1][2]).toBe(2752983.23);
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

describe('leerTablaArchivo e integración con el archivo real de Caja Multimoneda', () => {
  it('CSV con punto y coma, decimales con coma y ceros a la izquierda', async () => {
    const csv = '\uFEFFCódigo OC;Referencia;Monto Bs\nOC-2026-0251;000123456196;281.103,06\nOC-2026-0250;6885;1.500\n';
    const t = await leerTablaArchivo(new File([csv], 'drive.csv', { type: 'text/csv' }));
    const a = analizarTablaDrive(t, 'drive.csv', ordenes);
    expect(a.estado).toBe('Validado');
    expect(a.porOrden.get('a')).toMatchObject({ referencias: ['000123456196'], montoBs: 281103.06 });
    expect(a.porOrden.get('b')?.montoBs).toBe(1500);
  });

  it('procesa el archivo Excel real de Caja Multimoneda descartando BASE DE DATOS y seleccionando la pestaña correcta', async () => {
    const filePath = path.resolve('docs/Copia de CAJA PRINCIPAL MULTIMONEDAS MGG - 11  NOVIEMBRE 2026.xlsx');
    if (!fs.existsSync(filePath)) return;

    const buffer = fs.readFileSync(filePath);
    const file = new File([buffer], 'Copia de CAJA PRINCIPAL MULTIMONEDAS MGG.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const tabla = await leerTablaArchivo(file);
    // Debe haber leído todas las pestañas relevantes y devuelto filas combinadas
    expect(tabla.length).toBeGreaterThan(50);
    expect(tabla[0]).toEqual(['Código OC', 'Referencia', 'Monto Bs', 'Fecha', 'Tipo', 'Tipo Retención', 'Descripción', 'Fila Original']);

    // Órdenes reales de MGG presentes en el archivo: solo las pagadas en Bs se cruzan
    const ordenesReales = [
      { id: '1', codigo: 'OC-2026-0236', pagado: true, seCruza: true },
      { id: '2', codigo: 'OC-2026-0251', pagado: true, seCruza: true },
      { id: '3', codigo: 'OC-2026-0250', pagado: true, seCruza: true },
      { id: '4', codigo: 'OC-2026-0201', pagado: true, seCruza: true },
      { id: '5', codigo: 'OC-2026-0249', pagado: true, seCruza: true },
      // Orden sin pagar en sistema: NO se cruza (omitida)
      { id: '6', codigo: 'OC-2026-0220', pagado: false, seCruza: false },
      // Orden pagada en USD: NO se cruza (omitida)
      { id: '7', codigo: 'OC-2026-0217', pagado: true, seCruza: false },
    ];

    const analisis = analizarTablaDrive(tabla, file.name, ordenesReales);
    // Las órdenes pagadas en Bs de MGG se cruzan limpiamente
    expect(analisis.porOrden.has('1')).toBe(true); // ODC 236
    expect(analisis.porOrden.has('2')).toBe(true); // ODC 251
    expect(analisis.porOrden.has('3')).toBe(true); // ODC 250
    expect(analisis.porOrdenEntradas?.has('4')).toBe(true); // ODC 201 reintegro
    expect(analisis.porOrden.has('5')).toBe(true); // ODC 249

    // Las órdenes no pagadas o pagadas en USD se omiten sin causar error
    expect(analisis.porOrden.has('6')).toBe(false);
    expect(analisis.porOrden.has('7')).toBe(false);
    expect(analisis.estado).not.toBe('Error');
    expect(analisis.omitidas).toBeGreaterThan(0);
  });
});
