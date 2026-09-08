import { describe, it, expect } from 'vitest';
import { quienSolicita, quienCargo, quienSolicitaConRespaldo } from './quienSolicita';

/** SP-2026-0133, tal como está en la base. */
const productoReal = {
  clase: 'producto', codigo: 'SP-2026-0133',
  ci_solicitante: 'ENDER MEJIAS',        // quien pide
  solicitante_persona: 'NAZARET SALAZAR', // quien la cargó
  solicitante: 'FUNDICION',
};

/** SV-2026-0018, tal como está en la base: acá los campos van al revés. */
const servicioReal = {
  clase: 'servicio', codigo: 'SV-2026-0018',
  ci_solicitante: '26359267',              // una cédula, no un nombre
  solicitante_persona: 'LEYDIS RENGEL',    // quien pide
  solicitante: 'COCINA',
};

describe('quienSolicita', () => {
  it('en una orden de PRODUCTO es quien se escribió en el formulario', () => {
    expect(quienSolicita(productoReal)).toBe('ENDER MEJIAS');
  });

  it('en un SERVICIO es la persona, no la cédula', () => {
    // Invertir la prioridad sin mirar la clase mostraba «26359267» como nombre.
    expect(quienSolicita(servicioReal)).toBe('LEYDIS RENGEL');
  });

  it('reconoce un servicio viejo por su código, sin columna clase', () => {
    expect(quienSolicita({ clase: null, codigo: 'SV-2026-0009', ci_solicitante: '27975734', solicitante_persona: 'JOSE GUEVARA' }))
      .toBe('JOSE GUEVARA');
  });

  it('si el producto no tiene nombre escrito, cae al de quien la cargó', () => {
    expect(quienSolicita({ clase: 'producto', codigo: 'SP-1', ci_solicitante: null, solicitante_persona: 'NAZARET SALAZAR' }))
      .toBe('NAZARET SALAZAR');
  });

  it('sin ninguno de los dos devuelve null, no una cadena rara', () => {
    expect(quienSolicita({ clase: 'producto', codigo: 'SP-1', ci_solicitante: '  ', solicitante_persona: null })).toBeNull();
    expect(quienSolicita(null)).toBeNull();
  });
});

describe('quienCargo', () => {
  it('aparece cuando es alguien distinto de quien pide', () => {
    expect(quienCargo(productoReal)).toBe('NAZARET SALAZAR');
  });

  it('no aparece cuando es la misma persona: repetir el nombre no aporta', () => {
    expect(quienCargo({ clase: 'producto', codigo: 'SP-1', ci_solicitante: 'NAZARET SALAZAR', solicitante_persona: 'NAZARET SALAZAR' })).toBeNull();
    expect(quienCargo({ clase: 'producto', codigo: 'SP-1', ci_solicitante: 'nazaret salazar', solicitante_persona: 'NAZARET SALAZAR' })).toBeNull();
  });

  it('en un servicio, quien pide y quien carga son el mismo campo: no se repite', () => {
    expect(quienCargo(servicioReal)).toBeNull();
  });
});

describe('quienSolicitaConRespaldo', () => {
  it('usa la unidad y después el correo antes de rendirse', () => {
    const sinNombre = { clase: 'producto', codigo: 'SP-1', ci_solicitante: null, solicitante_persona: null };
    expect(quienSolicitaConRespaldo({ ...sinNombre, solicitante: 'FUNDICION' })).toBe('FUNDICION');
    expect(quienSolicitaConRespaldo({ ...sinNombre, solicitante: null, solicitante_email: 'x@mgg.com' })).toBe('x@mgg.com');
    expect(quienSolicitaConRespaldo({ ...sinNombre, solicitante: null }, 'Jose Liendro')).toBe('Jose Liendro');
    expect(quienSolicitaConRespaldo({ ...sinNombre, solicitante: null })).toBe('—');
  });

  it('el nombre de quien pide le gana a todos los respaldos', () => {
    expect(quienSolicitaConRespaldo(productoReal, 'Jose Liendro')).toBe('ENDER MEJIAS');
  });
});
