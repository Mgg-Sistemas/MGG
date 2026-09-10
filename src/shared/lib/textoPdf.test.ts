import { describe, it, expect } from 'vitest';
import { textoPdf, filaPdf } from './textoPdf';

describe('texto seguro para los PDF', () => {
  it('el caso real: CACO₃ ya no abre el renglón letra por letra', () => {
    expect(textoPdf('CARBONATO DE CALCIO (CACO₃) M200')).toBe('CARBONATO DE CALCIO (CACO3) M200');
  });

  it('otros subíndices de la fundición', () => {
    expect(textoPdf('SnO₂')).toBe('SnO2');
    expect(textoPdf('H₂O')).toBe('H2O');
  });

  it('los acentos y la ñ se escriben tal cual: están en Windows-1252', () => {
    expect(textoPdf('ESTAÑO EN BRUTO · MATANZA')).toBe('ESTAÑO EN BRUTO · MATANZA');
    expect(textoPdf('Almacén de Materias Primas')).toBe('Almacén de Materias Primas');
  });

  it('las comillas y rayas tipográficas pasan, que sí existen', () => {
    expect(textoPdf('«se abrió» — "cerrado"')).toBe('«se abrió» — "cerrado"');
  });

  it('una flecha se escribe con signos', () => {
    expect(textoPdf('Los Pinos → Matanza')).toBe('Los Pinos -> Matanza');
  });

  it('sin reemplazo, queda la letra base en vez de desaparecer', () => {
    expect(textoPdf('Ẅ')).toBe('W');
  });

  it('el espacio duro se vuelve un espacio normal', () => {
    expect(textoPdf('65,5\u00A0kg')).toBe('65,5 kg');
  });

  it('nulo y vacío no rompen nada', () => {
    expect(textoPdf(null)).toBe('');
    expect(textoPdf(undefined)).toBe('');
    expect(textoPdf(0)).toBe('0');
  });

  it('una fila entera de tabla se limpia de una vez', () => {
    expect(filaPdf(['CACO₃', 'General', 65.5])).toEqual(['CACO3', 'General', '65.5']);
  });
});
