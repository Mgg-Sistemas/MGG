import { describe, expect, it } from 'vitest';
import { avisoFueraDelCiclo, fueraDelCiclo, type VentanaMercado } from './fechaComida';

/* El mercado #2 de Los Pinos, el que destapó el doble descuento. */
const mercado: VentanaMercado = { numero: 2, fecha_inicio: '2026-09-15', fecha_fin: '2026-10-05' };

describe('fueraDelCiclo', () => {
  it('una fecha dentro del ciclo no avisa nada', () => {
    expect(fueraDelCiclo('2026-09-15', mercado)).toBeNull();
    expect(fueraDelCiclo('2026-09-21', mercado)).toBeNull();
    expect(fueraDelCiclo('2026-10-05', mercado)).toBeNull();
  });

  it('las comidas del 11 al 14/09 quedan «antes» (el caso real)', () => {
    for (const f of ['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14']) {
      expect(fueraDelCiclo(f, mercado)).toBe('antes');
    }
  });

  it('una fecha posterior al cierre previsto queda «despues»', () => {
    expect(fueraDelCiclo('2026-10-06', mercado)).toBe('despues');
  });

  it('sin mercado abierto o sin fecha no hay con qué comparar', () => {
    expect(fueraDelCiclo('2026-09-11', null)).toBeNull();
    expect(fueraDelCiclo('', mercado)).toBeNull();
  });

  it('acepta una fecha con hora pegada', () => {
    expect(fueraDelCiclo('2026-09-11T16:00:00Z', mercado)).toBe('antes');
  });
});

describe('avisoFueraDelCiclo', () => {
  it('el aviso de «antes» nombra el mercado, la fecha y el doble descuento', () => {
    const t = avisoFueraDelCiclo('antes', mercado);
    expect(t).toContain('mercado #2');
    expect(t).toContain('15/09/2026');
    expect(t).toContain('dos veces');
  });

  it('el aviso de «despues» nombra el cierre previsto', () => {
    expect(avisoFueraDelCiclo('despues', mercado)).toContain('05/10/2026');
  });

  it('sin caso no hay texto', () => {
    expect(avisoFueraDelCiclo(null, mercado)).toBe('');
    expect(avisoFueraDelCiclo('antes', null)).toBe('');
  });
});
