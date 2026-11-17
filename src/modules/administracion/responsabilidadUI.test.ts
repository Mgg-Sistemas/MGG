import { describe, it, expect } from 'vitest';
import { nombrePorEmail, etiquetaObjetivo } from './administracionResponsabilidad';

describe('nombrePorEmail', () => {
  it('mapea email→nombre y cae al email si no hay nombre', () => {
    const m = nombrePorEmail([{ email: 'ana@gt.com', nombre: 'Ana Pérez' }, { email: 'b@gt.com', nombre: '' }]);
    expect(m.get('ana@gt.com')).toBe('Ana Pérez');
    expect(m.get('b@gt.com')).toBe('b@gt.com');
    expect(m.get('x@gt.com')).toBeUndefined();
  });
});

describe('etiquetaObjetivo (nada de uuid crudo en el front)', () => {
  const nombres = new Map([['d1', 'RUPDAE 2026'], ['g1', 'Redacción de poder']]);
  it('resuelve documento/gestión a su nombre y la carpeta a su slug', () => {
    expect(etiquetaObjetivo('documento', 'd1', nombres)).toBe('Documento: RUPDAE 2026');
    expect(etiquetaObjetivo('gestion', 'g1', nombres)).toBe('Gestión: Redacción de poder');
    expect(etiquetaObjetivo('carpeta', 'legal', nombres)).toBe('Carpeta: legal');
  });
  it('sin nombre resuelto, NO muestra el uuid completo', () => {
    const et = etiquetaObjetivo('documento', '7c1b2a3d-4e5f-6789-abcd-ef0123456789', nombres);
    expect(et).not.toContain('ef0123456789');
    expect(et).toContain('Documento');
  });
});
