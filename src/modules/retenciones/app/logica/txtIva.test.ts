import { describe, expect, it } from 'vitest';
import { COLUMNAS_TXT, faltanDatosTxt, lineasTxtIva, nombreTxt, periodoTxt, puedeGenerarTxt, textoTxt, type FilaTxt } from './txtIva';

// Datos ficticios
const fila = (over: Partial<FilaTxt> = {}): FilaTxt => ({
  fecha: '2026-10-05', rifProveedor: 'J-00000000-0', factura: '000123', control: '00-000123', total: 1160, base: 1000, impuesto: 160,
  retenido: 120, exento: 0, comprobante: '20261000000001', tipoDoc: 'FC', facturaAfectada: null, anulada: false, ...over,
});
const p = { periodo: '202610' };

describe('el período del campo 2', () => {
  it('por defecto, el mes del período declarado (el instructivo)', () => {
    expect(periodoTxt('202610', false)).toBe('202610');
  });
  it('con el interruptor «como el otro sistema», el mes siguiente', () => {
    expect(periodoTxt('202610', true)).toBe('202611');
    expect(periodoTxt('202612', true)).toBe('202701');
  });
});

describe('las líneas del TXT del IVA', () => {
  it('una factura: las 16 columnas en el orden del instructivo', () => {
    const [l] = lineasTxtIva(p, 'J-11111111-1', [fila()], { periodoComoOtroSistema: false });
    expect(l).toHaveLength(COLUMNAS_TXT.length);
    expect(l).toEqual(['J111111111', '202610', '2026-10-05', 'C', '01', 'J000000000', '000123', '00-000123', '1160.00', '1000.00', '120.00', '0', '20261000000001', '0.00', '16.00', '0']);
  });

  it('una nota de crédito: tipo 03 y la factura afectada en el campo 12', () => {
    const [l] = lineasTxtIva(p, 'J-11111111-1', [fila({ tipoDoc: 'NC', factura: 'NC-000045', facturaAfectada: '000123', total: -232, base: -200, impuesto: -32, retenido: -24 })], { periodoComoOtroSistema: false });
    expect(l[4]).toBe('03');
    expect(l[11]).toBe('000123');
    expect(l[10]).toBe('-24.00');
  });

  it('las anuladas no van', () => {
    expect(lineasTxtIva(p, 'J-11111111-1', [fila({ anulada: true }), fila({ comprobante: '20261000000002' })], { periodoComoOtroSistema: false }).map((l) => l[12])).toEqual(['20261000000002']);
  });

  it('un período sin operaciones: una línea con el RIF, el período y 14 ceros', () => {
    expect(lineasTxtIva(p, 'J-11111111-1', [], { periodoComoOtroSistema: false })).toEqual([['J111111111', '202610', ...Array(14).fill('0')]]);
  });

  it('sin número de factura ni de control, va «0»', () => {
    const [l] = lineasTxtIva(p, 'J-11111111-1', [fila({ factura: '', control: '' })], { periodoComoOtroSistema: false });
    expect([l[6], l[7]]).toEqual(['0', '0']);
  });
});

describe('el archivo', () => {
  it('separa con tabulador, con uno al final de cada línea y CRLF (valores por defecto)', () => {
    expect(textoTxt([['a', 'b'], ['c', 'd']])).toBe('a\tb\t\r\nc\td\t\r\n');
  });

  it('el tabulador final y el fin de línea se pueden cambiar', () => {
    expect(textoTxt([['a', 'b']], { tabuladorFinal: false, finDeLinea: '\n' })).toBe('a\tb\n');
  });

  it('el nombre sigue el patrón del archivo del otro sistema, sin espacios ni tildes', () => {
    expect(nombreTxt('Empresa de Ejemplo, C.A.', '202610')).toBe('EMPRESADEEJEMPLO,C.A.DECLARACIONINFORMATIVACOMPRAS202610.TXT');
    expect(nombreTxt('Compañía Técnica', '202610')).toBe('COMPANIATECNICADECLARACIONINFORMATIVACOMPRAS202610.TXT');
  });
});

describe('quién genera el TXT', () => {
  it('lo genera solo el sistema que declara el período', () => {
    expect(puedeGenerarTxt('mgg')).toEqual({ ok: true });
    expect(puedeGenerarTxt('otro_sistema')).toEqual({ ok: false, motivo: 'Este período lo declara el otro sistema: el TXT se genera allá.' });
  });

  it('lo gestionado en otro sistema necesita su N° de comprobante y su monto para entrar', () => {
    expect(faltanDatosTxt({ comprobante: '', retenido: null })).toEqual(['N° de comprobante', 'monto retenido']);
    expect(faltanDatosTxt({ comprobante: '20261000000001', retenido: 0 })).toEqual([]);
  });
});
