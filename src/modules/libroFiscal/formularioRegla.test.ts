import { describe, expect, it } from 'vitest';
import { condicionDeForm, formCondicionVacio, formDePaso, valoresDeForm } from './formularioRegla';
import { fraseCondicion, frasePaso } from './rotulos';

describe('condición de una regla, sin JSON', () => {
  it('una opción de la lista', () => {
    const r = condicionDeForm({ ...formCondicionVacio('direccion'), elegidos: ['practicada'] });
    expect(r).toEqual({ condicion: { pieza: 'direccion', operador: 'es', valor: 'practicada' } });
  });

  it('varias opciones («es uno de»)', () => {
    const r = condicionDeForm({ ...formCondicionVacio('condicion_agente'), operador: 'en', elegidos: ['agente_retencion', 'contribuyente_especial'] });
    expect('condicion' in r && fraseCondicion(r.condicion)).toBe('La empresa es agente de retención o contribuyente especial');
  });

  it('sin elegir, dice qué falta en palabras', () => {
    expect(condicionDeForm(formCondicionVacio('tipo_documento'))).toEqual({ error: 'Elige una opción.' });
  });

  it('clasificación con códigos en mayúsculas; monto mínimo leído en formato venezolano', () => {
    expect(condicionDeForm({ ...formCondicionVacio('clasificacion'), clasificacion: 'isae_caroni', codigos: '1.01, b2' }))
      .toEqual({ condicion: { pieza: 'clasificacion', operador: 'es', valor: { clasificacion: 'isae_caroni', codigos: ['1.01', 'B2'] } } });
    expect(condicionDeForm({ ...formCondicionVacio('monto_minimo'), monto: '1.000', unidad: 'Bs', sobre: 'pago' }))
      .toEqual({ condicion: { pieza: 'monto_minimo', operador: 'es', valor: { monto: 1000, unidad: 'Bs', sobre: 'pago' } } });
    expect(condicionDeForm({ ...formCondicionVacio('monto_minimo'), monto: '12a' })).toEqual({ error: expect.stringMatching(/No se entiende/) });
  });
});

describe('paso de una regla, sin JSON', () => {
  it('base: montos que suman y restan, y una porción', () => {
    const f = { ...formDePaso('componer_base'), componentes: [{ campo: 'iva' as const, signo: '+' as const }], porcionDe: 'pct' as const, porcion: '90' };
    const r = valoresDeForm(1, 'componer_base', f);
    expect(r).toEqual({ valores: { componentes: [{ campo: 'iva', signo: '+' }], porcion: 90 } });
    expect('valores' in r && frasePaso({ paso: 1, operacion: 'componer_base', valores: r.valores })).toBe('Base: el IVA de la factura × 90 %');
  });

  it('cuánto se retiene: de Parámetros con supuesto, o un % fijo de 0 a 100', () => {
    const f = { ...formDePaso('retener_pct'), pctDe: 'parametro' as const, parametro: 'pct_retencion', supuestos: 'pct_retencion_art5' };
    expect(valoresDeForm(6, 'retener_pct', f)).toEqual({ valores: { parametro: 'pct_retencion', supuestos: 'pct_retencion_art5' } });
    expect(valoresDeForm(6, 'retener_pct', { ...f, pctDe: 'fijo', pct: '150' })).toEqual({ error: 'El porcentaje va de 0 a 100.' });
    expect(valoresDeForm(6, 'retener_pct', { ...f, parametro: '' })).toEqual({ error: expect.stringMatching(/Elige el valor de Parámetros/) });
  });

  it('mínimo del concepto o un monto; sustraendo por factor; topes; redondeo', () => {
    expect(valoresDeForm(3, 'comparar_minimo', { ...formDePaso('comparar_minimo'), desdeConcepto: true })).toEqual({ valores: { desde: 'clasificacion' } });
    expect(valoresDeForm(3, 'comparar_minimo', { ...formDePaso('comparar_minimo'), monto: '10', unidad: 'UT' })).toEqual({ valores: { monto: 10, unidad: 'UT' } });
    expect(valoresDeForm(5, 'restar_sustraendo', { ...formDePaso('restar_sustraendo'), sustraendoPor: 'factor', factor: '83,3334' })).toEqual({ valores: { factor: 83.3334 } });
    expect(valoresDeForm(7, 'topes', { ...formDePaso('topes'), minimo: '', maximo: 'impuesto_causado' })).toEqual({ valores: { maximo: 'impuesto_causado' } });
    expect(valoresDeForm(8, 'redondear', { ...formDePaso('redondear'), decimales: '2' })).toEqual({ valores: { decimales: 2 } });
  });

  it('lo guardado vuelve al formulario con coma decimal', () => {
    const f = formDePaso('restar_sustraendo', { factor: 83.3334 });
    expect(f.sustraendoPor).toBe('factor');
    expect(f.factor).toBe('83,3334');
  });
});
