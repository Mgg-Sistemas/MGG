import { describe, expect, it } from 'vitest';
import type { RetencionPracticada } from '@/modules/libroFiscal/retencionesFiscal.repository';
import { armarTxtIva, filasTxtIva, mesSiguiente } from './txtSeniatIva';

// Datos inventados: ningún proveedor, RIF ni factura real.
const ret = (over: Partial<RetencionPracticada> = {}): RetencionPracticada => ({
  id: 'r-1', tipo: 'iva', direccion: 'practicada', estado: 'registrada', docKind: 'oc', docId: 'oc-1', docCodigo: null,
  contraparteId: 'p-1', contraparteRif: 'j-00000001-0', contraparteNombre: 'Proveedor Uno', contraparteSujeto: null,
  facturaNumero: '000123', facturaControl: '00-000123', facturaFecha: '2026-10-05', periodo: '202610', quincena: 1,
  numeroComprobante: '20261000000002', conceptoId: null, conceptoNombre: null, moneda: 'Bs', tasa: null,
  baseImponible: 1000, alicuota: 16, impuesto: 160, porcentaje: 75, sustraendo: 0, montoRetenido: 120, montoBs: 120,
  comprobantePath: null, comprobanteNombre: null, observacion: null, anulada: false, anuladaMotivo: null,
  declaradaEn: null, declaradaPor: null, actorName: null, createdAt: '2026-10-06T12:00:00Z', updatedAt: null, ...over,
});
const base = { rifAgente: 'J-00000009-9', razonSocial: 'Empresa de Prueba, C.A.', periodo: '202610', campo2: 'operaciones' as const };

describe('TXT del SENIAT · IVA', () => {
  it('sin operaciones: una línea con RIF, período y 14 ceros, con tabulador al final', () => {
    const r = armarTxtIva({ ...base, filas: [] });
    expect(r.contenido).toBe(`J000000099\t202610\t${Array(14).fill('0').join('\t')}\t\r\n`);
    expect(r.contenido.split('\t')).toHaveLength(17);
    expect(r.lineas).toBe(0);
    expect(r.faltan).toEqual([]);
  });

  it('nombre del archivo: razón social sin espacios ni signos + DECLARACIONINFORMATIVACOMPRAS + período', () => {
    expect(armarTxtIva({ ...base, filas: [] }).nombre).toBe('EMPRESADEPRUEBACADECLARACIONINFORMATIVACOMPRAS202610.TXT');
  });

  it('una factura: 16 campos con tabulador, montos con punto y 2 decimales, CRLF', () => {
    const r = armarTxtIva({ ...base, filas: [ret()] });
    expect(r.faltan).toEqual([]);
    expect(r.contenido.endsWith('\r\n')).toBe(true);
    const campos = r.contenido.replace(/\r\n$/, '').split('\t');
    expect(campos).toEqual([
      'J000000099', '202610', '2026-10-05', 'C', '01', 'J000000010', '000123', '00-000123',
      '1160.00', '1000.00', '120.00', '0', '20261000000002', '0.00', '16.00', '0',
    ]);
  });

  it('campo 2 con el mes siguiente; el nombre sigue con el de las operaciones', () => {
    const r = armarTxtIva({ ...base, campo2: 'siguiente', periodo: '202612', filas: [ret({ periodo: '202612' })] });
    expect(r.contenido.split('\t')[1]).toBe('202701');
    expect(r.nombre.endsWith('202612.TXT')).toBe(true);
    expect(mesSiguiente('202609')).toBe('202610');
  });

  it('solo practicadas de IVA del período, sin anuladas, en orden de comprobante', () => {
    const xs = filasTxtIva([
      ret({ id: 'b', numeroComprobante: '20261000000003' }),
      ret({ id: 'a' }),
      ret({ id: 'rec', direccion: 'recibida' }),
      ret({ id: 'islr', tipo: 'islr' }),
      ret({ id: 'anu', anulada: true }),
      ret({ id: 'sep', periodo: '202609' }),
    ], '202610');
    expect(xs.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('en dólares usa la tasa del registro; sin tasa, o sin datos fiscales, lo dice y no se arma bien', () => {
    const usd = armarTxtIva({ ...base, filas: [ret({ moneda: 'USD', tasa: 40, baseImponible: 25, impuesto: 4, montoRetenido: 3, montoBs: null })] });
    expect(usd.contenido.split('\t').slice(8, 11)).toEqual(['1160.00', '1000.00', '120.00']);
    const mal = armarTxtIva({ ...base, rifAgente: '', filas: [ret({ moneda: 'USD', tasa: null, montoBs: null, facturaControl: null, numeroComprobante: '0000000031' })] });
    expect(mal.faltan.join(' | ')).toMatch(/RIF de la empresa/);
    expect(mal.faltan.join(' | ')).toMatch(/sin tasa/);
    expect(mal.faltan.join(' | ')).toMatch(/14 dígitos/);
    expect(mal.faltan.join(' | ')).toMatch(/N° de control/);
  });

  it('texto ASCII: sin acentos ni tabuladores dentro de un campo', () => {
    const r = armarTxtIva({ ...base, filas: [ret({ facturaNumero: 'Nº\t12' })] });
    expect(r.contenido.split('\t')[6]).toBe('N 12');
    expect([...r.contenido].every((c) => c === '\t' || c === '\r' || c === '\n' || (c >= ' ' && c <= '~'))).toBe(true);
  });

  it('soporta nota de crédito con factura afectada y monto exento, y exige factura afectada si falta', () => {
    const r = armarTxtIva({
      ...base,
      filas: [
        ret({
          tipoDocumento: 'nota_credito',
          facturaAfectadaNro: '000099',
          exento: 50,
          facturaTotal: 1210,
        }),
      ],
    });
    expect(r.faltan).toEqual([]);
    const campos = r.contenido.replace(/\r\n$/, '').split('\t');
    expect(campos[4]).toBe('03');
    expect(campos[8]).toBe('1210.00');
    expect(campos[11]).toBe('000099');
    expect(campos[13]).toBe('50.00');

    const sinAfectada = armarTxtIva({
      ...base,
      filas: [ret({ tipoDocumento: 'nota_credito', facturaAfectadaNro: null })],
    });
    expect(sinAfectada.faltan.join(' | ')).toMatch(/factura afectada/);
  });
});
