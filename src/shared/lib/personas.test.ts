import { describe, it, expect } from 'vitest';
import { nombreASellar, personaDe } from './personas';

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
