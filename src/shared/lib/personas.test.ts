import { describe, it, expect } from 'vitest';
import { nombreASellar, nombreEnFecha, personaDe, type PersonasMap } from './personas';

describe('nombreEnFecha · el nombre que la persona tenía ese día', () => {
  const historial = [
    { email: 'kelvin@mgg.com', nombre_anterior: 'Kelvin Rojas', nombre_nuevo: 'Kelvin A. Rojas', created_at: '2026-10-01T12:00:00Z' },
    { email: 'kelvin@mgg.com', nombre_anterior: 'Kelvin A. Rojas', nombre_nuevo: 'KELVIN ROJAS P.', created_at: '2026-10-05T12:00:00Z' },
  ];
  it('antes del primer cambio vale el nombre más viejo', () => {
    expect(nombreEnFecha('kelvin@mgg.com', '2026-09-20T10:00:00Z', historial, 'KELVIN ROJAS P.')).toBe('Kelvin Rojas');
  });
  it('entre dos cambios vale el nombre intermedio', () => {
    expect(nombreEnFecha('KELVIN@mgg.com', '2026-10-03T10:00:00Z', historial, 'KELVIN ROJAS P.')).toBe('Kelvin A. Rojas');
  });
  it('después del último cambio vale el actual', () => {
    expect(nombreEnFecha('kelvin@mgg.com', '2026-10-06T10:00:00Z', historial, 'KELVIN ROJAS P.')).toBe('KELVIN ROJAS P.');
  });
  it('sin fecha, sin historial o con otro correo, vale el actual', () => {
    expect(nombreEnFecha('kelvin@mgg.com', null, historial, 'KELVIN ROJAS P.')).toBe('KELVIN ROJAS P.');
    expect(nombreEnFecha('kelvin@mgg.com', '2026-09-20', [], 'KELVIN ROJAS P.')).toBe('KELVIN ROJAS P.');
    expect(nombreEnFecha('otra@mgg.com', '2026-09-20', historial, 'Otra Persona')).toBe('Otra Persona');
  });
  it('personaDe con fecha usa el historial pegado al mapa', () => {
    const map: PersonasMap = Object.assign(new Map([['kelvin@mgg.com', 'KELVIN ROJAS P.']]), { historial });
    expect(personaDe('kelvin@mgg.com', map, null, '2026-09-20T10:00:00Z')).toBe('Kelvin Rojas');
    expect(personaDe('kelvin@mgg.com', map)).toBe('KELVIN ROJAS P.');
  });
});

describe('nombreASellar · qué nombre queda grabado en el documento', () => {
  it('manda lo que escribió el usuario a mano', () => {
    expect(nombreASellar('ENDER MEJIAS', 'Kelvin Rojas')).toBe('ENDER MEJIAS');
  });

  it('si no escribió nada, usa el nombre que la persona tiene hoy en su ficha', () => {
    // Este es el caso de las órdenes de productos: el formulario no tiene el campo.
    expect(nombreASellar(null, 'Kelvin Rojas')).toBe('Kelvin Rojas');
    expect(nombreASellar(undefined, 'Kelvin Rojas')).toBe('Kelvin Rojas');
    expect(nombreASellar('   ', 'Kelvin Rojas')).toBe('Kelvin Rojas');
  });

  it('queda vacío solo si no hay ninguno de los dos', () => {
    expect(nombreASellar(null, null)).toBeNull();
    expect(nombreASellar('  ', '  ')).toBeNull();
  });

  it('recorta los espacios de los bordes', () => {
    expect(nombreASellar('  ENDER MEJIAS  ', null)).toBe('ENDER MEJIAS');
    expect(nombreASellar(null, '  Kelvin Rojas ')).toBe('Kelvin Rojas');
  });

  it('el sello no se recalcula: sobrevive al renombre del usuario', () => {
    // El sello se resuelve UNA vez, al crear, y el documento guarda el texto.
    // La pantalla, en cambio, resuelve el correo en vivo: por eso sin sello
    // una orden vieja cambiaba de nombre sola.
    const sellado = nombreASellar(null, 'Kelvin Rojas');
    const fichasDespuesDelRenombre = new Map([['kelvin@mgg.com', 'KELVIN A. ROJAS']]);
    expect(personaDe('kelvin@mgg.com', fichasDespuesDelRenombre, sellado)).toBe('KELVIN A. ROJAS');
    expect(sellado).toBe('Kelvin Rojas');
  });
});
