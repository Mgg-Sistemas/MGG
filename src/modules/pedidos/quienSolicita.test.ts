import { describe, it, expect } from 'vitest';
import { quienSolicita, quienCargo, quienSolicitaConRespaldo, analistaDeOrden } from './quienSolicita';

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

describe('analistaDeOrden', () => {
  const personasMock = new Map([
    ['nsalazar@mineralgroupguayana.com', 'NAZARET SALAZAR'],
    ['jleiva@mineralgroupguayana.com', 'JAVIER LEIVA'],
  ]);
  const resolverMock = (email?: string | null) => (email ? personasMock.get(email.toLowerCase()) ?? null : null);

  it('en productos devuelve el analista que cargó la solicitud (no quien solicita)', () => {
    // Caso real SP-2026-0255: Alexander Morey pide, Nazaret Salazar cargó en Compras
    const ordenSp = {
      clase: 'producto',
      codigo: 'SP-2026-0255',
      ci_solicitante: 'ALEXANDER MOREY',
      solicitante_persona: 'NAZARET SALAZAR',
      solicitante: 'MANTENIMIENTO GENERAL',
      solicitante_email: 'nsalazar@mineralgroupguayana.com',
      oc_creada_por: 'nsalazar@mineralgroupguayana.com',
    };
    const analista = analistaDeOrden(ordenSp, resolverMock);
    expect(analista).toBe('NAZARET SALAZAR');
    expect(analista).not.toBe('ALEXANDER MOREY');
    expect(analista).not.toBe('MANTENIMIENTO GENERAL');
  });

  it('en productos antiguos sin solicitante_persona resuelve por el correo de Compras', () => {
    const ordenVieja = {
      clase: 'producto',
      codigo: 'SP-2026-0050',
      ci_solicitante: 'ENDER MEJIAS',
      solicitante_persona: null,
      solicitante_email: 'jleiva@mineralgroupguayana.com',
    };
    expect(analistaDeOrden(ordenVieja, resolverMock)).toBe('JAVIER LEIVA');
  });

  it('en servicios no confunde al solicitante ni la cédula con el analista', () => {
    // En servicios, solicitante_persona es quien pide y ci_solicitante es la cédula
    const servicio = {
      clase: 'servicio',
      codigo: 'SV-2026-0018',
      ci_solicitante: '26359267',
      solicitante_persona: 'LEYDIS RENGEL',
      solicitante: 'COCINA',
      solicitante_email: 'nsalazar@mineralgroupguayana.com',
      oc_creada_por: 'nsalazar@mineralgroupguayana.com',
    };
    const analista = analistaDeOrden(servicio, resolverMock);
    expect(analista).toBe('NAZARET SALAZAR');
    expect(analista).not.toBe('LEYDIS RENGEL');
    expect(analista).not.toBe('26359267');
  });

  it('prioriza oc_creada_por sobre solicitante_email si difieren', () => {
    const orden = {
      clase: 'producto',
      codigo: 'SP-2026-0100',
      ci_solicitante: 'PEDRO PEREZ',
      solicitante_persona: null,
      solicitante_email: 'otro@mgg.com',
      oc_creada_por: 'jleiva@mineralgroupguayana.com',
    };
    expect(analistaDeOrden(orden, resolverMock)).toBe('JAVIER LEIVA');
  });

  it('si no hay datos suficientes devuelve el fallback seguro', () => {
    expect(analistaDeOrden(null)).toBe('Analista de Compras');
    expect(analistaDeOrden({ clase: 'producto', ci_solicitante: 'ENDER MEJIAS' })).toBe('Analista de Compras');
  });
});
