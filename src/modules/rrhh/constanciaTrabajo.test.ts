import { describe, expect, it } from 'vitest';
import { cuerpoConstancia } from './constanciaTrabajoPdf';
import type { Personal } from '@/shared/lib/types';

const persona = (over: Partial<Personal> = {}): Personal => ({
  nombre: 'María', apellido: 'Pérez', cedula: '27514395', cargo: 'Analista', departamento: 'Administración',
  fecha_ingreso: '2026-03-20', sueldo_base: 0, ...over,
} as unknown as Personal);

describe('cuerpoConstancia · la cédula con puntos', () => {
  it('27514395 sale como 27.514.395', () => {
    expect(cuerpoConstancia(persona())).toContain('titular de la cédula de identidad N° 27.514.395,');
  });

  it('con letra se conserva y también lleva puntos: V-12874838 → V-12.874.838', () => {
    expect(cuerpoConstancia(persona({ cedula: 'V-12874838' }))).toContain('N° V-12.874.838,');
  });

  it('si ya venía con puntos no se duplican', () => {
    expect(cuerpoConstancia(persona({ cedula: '27.514.395' }))).toContain('N° 27.514.395,');
  });

  it('una cédula corta (menos de 4 cifras) no inventa puntos', () => {
    expect(cuerpoConstancia(persona({ cedula: '801' }))).toContain('N° 801,');
  });

  it('sin cédula la omite sin dejar el «N°» colgado', () => {
    const t = cuerpoConstancia(persona({ cedula: null }));
    expect(t).not.toContain('N°');
    expect(t).toContain('MARÍA PÉREZ, presta sus servicios');
  });
});

describe('cuerpoConstancia · el resto del párrafo no cambia', () => {
  it('lleva la fecha de ingreso, el cargo y el área', () => {
    const t = cuerpoConstancia(persona());
    expect(t).toContain('desde el 20 de marzo de 2026');
    expect(t).toContain('desempeñando el cargo de Analista');
    expect(t).toContain('en el área de Administración');
  });

  it('el sueldo sale solo si se pide y existe', () => {
    expect(cuerpoConstancia(persona({ sueldo_base: 500 }), true)).toContain('devengando un sueldo mensual');
    expect(cuerpoConstancia(persona({ sueldo_base: 500 }), false)).not.toContain('sueldo');
    expect(cuerpoConstancia(persona({ sueldo_base: 0 }), true)).not.toContain('sueldo');
  });

  it('no menciona WhatsApp ni teléfono ni sello', () => {
    const t = cuerpoConstancia(persona({ sueldo_base: 500 }));
    expect(t).not.toMatch(/whatsapp|tel[eé]fono|sello/i);
  });
});

describe('destinatario de la constancia', () => {
  it('el código ya no trae «A quien pueda interesar» por defecto', async () => {
    const { readFileSync } = await import('node:fs');
    const fuente = readFileSync(new URL('./constanciaTrabajoPdf.ts', import.meta.url), 'utf8');
    const codigo = fuente.split('\n').filter((l) => !l.trim().startsWith('//') && !l.includes('//')).join('\n');
    expect(codigo).not.toMatch(/A quien pueda interesar/i);
    expect(fuente).toMatch(/dirigidoA = ''/);
  });
});
