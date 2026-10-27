import { describe, expect, it } from 'vitest';
import { avisoFueraDelCiclo, fueraDelCiclo, type VentanaMercado } from './fechaComida';

/* El mercado #2 de Los Pinos, el que destapó el doble descuento. */
const mercado: VentanaMercado = { numero: 2, fecha_inicio: '2026-09-15' };
const HOY = '2026-10-27';

describe('fueraDelCiclo', () => {
  it('una fecha dentro del ciclo no avisa nada', () => {
    expect(fueraDelCiclo('2026-09-15', mercado, HOY)).toBeNull();
    expect(fueraDelCiclo('2026-09-21', mercado, HOY)).toBeNull();
    expect(fueraDelCiclo('2026-10-27', mercado, HOY)).toBeNull();
  });

  it('las comidas del 11 al 14/09 quedan «antes» (el caso real)', () => {
    for (const f of ['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14']) {
      expect(fueraDelCiclo(f, mercado, HOY)).toBe('antes');
    }
  });

  it('un mercado que ya pasó su antigua fecha planificada sigue tomando las comidas de hoy (27-10)', () => {
    // Los Pinos #3: arrancó el 29-09, «vencía» el 19-10 y siguió abierto. Las comidas
    // del 20 al 27 son suyas: no hay plazo, el ciclo termina cuando se cierra.
    const pinos3: VentanaMercado = { numero: 3, fecha_inicio: '2026-09-29' };
    for (const f of ['2026-10-20', '2026-10-24', '2026-10-27']) {
      expect(fueraDelCiclo(f, pinos3, HOY)).toBeNull();
    }
  });

  it('solo una fecha que todavía no llegó queda «despues»', () => {
    expect(fueraDelCiclo('2026-10-28', mercado, HOY)).toBe('despues');
  });

  it('sin mercado abierto o sin fecha no hay con qué comparar', () => {
    expect(fueraDelCiclo('2026-09-11', null, HOY)).toBeNull();
    expect(fueraDelCiclo('', mercado, HOY)).toBeNull();
  });

  it('acepta una fecha con hora pegada', () => {
    expect(fueraDelCiclo('2026-09-11T16:00:00Z', mercado, HOY)).toBe('antes');
  });

  it('sin `hoy` explícito usa la fecha de Venezuela', () => {
    expect(fueraDelCiclo('2099-01-01', mercado)).toBe('despues');
  });
});

describe('avisoFueraDelCiclo', () => {
  it('el aviso de «antes» nombra el mercado, la fecha y el doble descuento', () => {
    const t = avisoFueraDelCiclo('antes', mercado);
    expect(t).toContain('mercado #2');
    expect(t).toContain('15/09/2026');
    expect(t).toContain('dos veces');
  });

  it('el aviso de «despues» dice que la fecha no llegó y que el mercado sigue abierto', () => {
    const t = avisoFueraDelCiclo('despues', mercado);
    expect(t).toContain('todavía no llegó');
    expect(t).toContain('mercado #2');
  });

  it('sin caso no hay texto', () => {
    expect(avisoFueraDelCiclo(null, mercado)).toBe('');
    expect(avisoFueraDelCiclo('antes', null)).toBe('');
  });
});
