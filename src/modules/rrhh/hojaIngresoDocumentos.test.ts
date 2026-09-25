import { describe, it, expect } from 'vitest';
import { DOCUMENTOS_A_CONSIGNAR, documentosOpcionales, totalDocumentos } from './hojaIngresoDocumentos';

describe('la lista de papeles a consignar', () => {
  it('trae los cinco grupos, en el orden en que se revisan', () => {
    expect(DOCUMENTOS_A_CONSIGNAR.map((g) => g.titulo)).toEqual([
      'Personales', 'Académicos', 'De salud', 'Matrimonio y carga familiar', 'Laborales',
    ]);
  });

  it('ningún grupo queda vacío', () => {
    for (const g of DOCUMENTOS_A_CONSIGNAR) expect(g.items.length).toBeGreaterThan(0);
  });

  it('no hay dos renglones iguales: una casilla repetida se tilda dos veces', () => {
    const todos = DOCUMENTOS_A_CONSIGNAR.flatMap((g) => g.items);
    expect(new Set(todos).size).toBe(todos.length);
  });

  it('cuenta cuántos papeles pide en total', () => {
    expect(totalDocumentos()).toBe(DOCUMENTOS_A_CONSIGNAR.flatMap((g) => g.items).length);
    expect(totalDocumentos([{ titulo: 'X', items: ['a', 'b'] }])).toBe(2);
  });

  it('lo que no le toca a todo el mundo dice «(si aplica)»', () => {
    // Sin esa marca, una carpeta queda incompleta para siempre porque la
    // persona no es casada o no maneja.
    const opcionales = documentosOpcionales();
    expect(opcionales.length).toBeGreaterThan(0);
    expect(opcionales.some((t) => /matrimonio/i.test(t))).toBe(true);
    expect(opcionales.some((t) => /licencia de conducir/i.test(t))).toBe(true);
  });

  it('pide el respaldo de lo que se declara en la primera página', () => {
    const todos = DOCUMENTOS_A_CONSIGNAR.flatMap((g) => g.items).join(' | ');
    expect(todos).toMatch(/grado de instrucción/i);   // lo declarado en datos personales
    expect(todos).toMatch(/enfermedad declarada/i);   // lo declarado en condiciones de salud
    expect(todos).toMatch(/alergia/i);
    expect(todos).toMatch(/contacto de emergencia/i);
    expect(todos).toMatch(/RIF/);
  });

  it('no pide datos bancarios: la cuenta se carga cuando ya está dada de alta', () => {
    const todos = DOCUMENTOS_A_CONSIGNAR.flatMap((g) => g.items).join(' | ');
    expect(todos).not.toMatch(/banc|cuenta nómina|nro\. de cuenta/i);
  });
});
