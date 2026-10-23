import { describe, expect, it } from 'vitest';
import type { RetencionPracticada } from '../datos/puerta';
import { filasTxtDe, nombrePeriodoTxt, periodosTxt, sinTasaTxt, vistaPreviaTxt } from './txtDelLibro';

// Datos inventados.
const r = (over: Partial<RetencionPracticada> = {}) => ({
  id: 'r1', tipo: 'iva', direccion: 'practicada', estado: 'registrada', anulada: false, periodo: '202610', quincena: 1,
  facturaFecha: '2026-10-05', createdAt: '2026-10-06T10:00:00Z', contraparteRif: 'J-00000001-0', facturaNumero: '000123', facturaControl: '00-000123',
  baseImponible: 1000, impuesto: 160, montoRetenido: 120, numeroComprobante: '20261000000011', moneda: 'Bs', ...over,
}) as RetencionPracticada;

describe('el TXT del IVA desde el libro (maqueta v7-4 R2-11; logica/txtIva.ts)', () => {
  it('los períodos de IVA practicada, el más reciente primero, con su nombre de la maqueta', () => {
    const xs = [r(), r({ id: 'r2', quincena: 2 }), r({ id: 'r3', periodo: '202609', quincena: null }), r({ id: 'r4', tipo: 'islr', periodo: '202611' }), r({ id: 'r5', direccion: 'recibida', periodo: '202612' })];
    expect(periodosTxt(xs).map((p) => p.clave)).toEqual(['202610-2', '202610-1', '202609']);
    expect(nombrePeriodoTxt({ periodo: '202610', quincena: 1 })).toBe('1.ª quincena de octubre de 2026');
    expect(nombrePeriodoTxt({ periodo: '202609', quincena: null })).toBe('Septiembre de 2026');
  });
  it('las filas del período: con las anuladas marcadas (el TXT las deja fuera) y en bolívares', () => {
    const xs = [r(), r({ id: 'r2', quincena: 2 }), r({ id: 'r3', anulada: true }), r({ id: 'r4', moneda: 'USD', tasa: 40, baseImponible: 25, impuesto: 4, montoRetenido: 3 })];
    const f = filasTxtDe(xs, { periodo: '202610', quincena: 1 });
    expect(f).toHaveLength(3);
    expect(f[0]).toEqual({
      fecha: '2026-10-05', rifProveedor: 'J-00000001-0', factura: '000123', control: '00-000123', total: 1160, base: 1000, impuesto: 160,
      retenido: 120, exento: 0, comprobante: '20261000000011', tipoDoc: 'FC', facturaAfectada: null, anulada: false,
    });
    expect(f[1].anulada).toBe(true);
    expect(f[2]).toMatchObject({ base: 1000, impuesto: 160, retenido: 120, total: 1160 });
  });
  it('las de $ sin tasa no se pasan a Bs: se cuentan para avisar', () => {
    expect(sinTasaTxt([r(), r({ id: 'r2', moneda: 'USD', tasa: null }), r({ id: 'r3', moneda: 'USD', tasa: null, anulada: true })], { periodo: '202610', quincena: 1 })).toBe(1);
  });
  it('la vista previa: el tabulador a la vista (⇥), una línea por renglón', () => {
    expect(vistaPreviaTxt([['a', 'b'], ['c', 'd']], true)).toBe('a⇥b⇥\nc⇥d⇥');
    expect(vistaPreviaTxt([['a', 'b']], false)).toBe('a⇥b');
  });
});
