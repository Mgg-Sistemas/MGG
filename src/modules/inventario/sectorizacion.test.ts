import { describe, it, expect } from 'vitest';
import type { Almacen } from '@/shared/lib/types';
import {
  destinoRecepcionPorUsuario, estaSectorizado, motivoAlmacenAjeno, opcionesRecepcion,
  puedeMoverEnAlmacen, puedeMoverEnSede, sedeDeAlmacen, sedesDeUsuario,
} from './sectorizacion';

// Almacenes reales de producción (nombre + sede es lo único que mira el guard).
const alm = (nombre: string, sede: string | null, parent_id: string | null = null): Almacen => ({
  id: nombre, nombre, sede, parent_id, estado: 'activo',
} as unknown as Almacen);

const ALMACENES: Almacen[] = [
  alm('Los Pinos', 'LOS PINOS'),
  alm('Viveres y Art. Limpieza', 'LOS PINOS', 'Los Pinos'),
  alm('General', 'CENTRO DE FUNDICION - MATANZAS'),
  alm('Taller', 'CENTRO DE FUNDICION - MATANZAS', 'General'),
  alm('CENTRO DE ACOPIO - LA ESPERANZA', 'CENTRO DE ACOPIO - LA ESPERANZA'),
  alm('Legado', null),   // sin sede cargada
];

describe('sedesDeUsuario', () => {
  it('la base manda sobre el mapa por correo', () => {
    expect(sedesDeUsuario({ email: 'almacen.pzo.lospinos@gmail.com', sedes_asignadas: ['CENTRO DE FUNDICION - MATANZAS'] }))
      .toEqual(['CENTRO DE FUNDICION - MATANZAS']);
  });

  it('sin fila en la base, cae al respaldo por correo (no deja suelto al almacenista)', () => {
    expect(sedesDeUsuario({ email: 'ALMACEN.PZO.LOSPINOS@gmail.com' })).toEqual(['LOS PINOS']);
    expect(sedesDeUsuario({ email: 'almacenmatanzas2026@gmail.com', sedes_asignadas: null }))
      .toEqual(['CENTRO DE FUNDICION - MATANZAS']);
  });

  it('la lista VACÍA libera al usuario: el respaldo no la puede pisar', () => {
    // Un admin destilda todas las sedes en Usuarios y guarda. Si el respaldo se
    // impusiera, la restricción de ISNER y KELVIN no se podría levantar nunca.
    expect(sedesDeUsuario({ email: 'almacenmatanzas2026@gmail.com', sedes_asignadas: [] })).toBeNull();
    expect(estaSectorizado({ email: 'almacen.pzo.lospinos@gmail.com', sedes_asignadas: [] })).toBe(false);
  });

  it('quien no está en ningún lado no tiene restricción', () => {
    expect(sedesDeUsuario({ email: 'mineralgroupguayanaca@gmail.com' })).toBeNull();
    expect(sedesDeUsuario(null)).toBeNull();
    expect(estaSectorizado({ email: 'otro@mgg.com' })).toBe(false);
  });

  it('limpia espacios, vacíos y repetidos', () => {
    expect(sedesDeUsuario({ sedes_asignadas: [' LOS PINOS ', '', 'LOS PINOS', null as unknown as string] }))
      .toEqual(['LOS PINOS']);
  });
});

describe('sedeDeAlmacen', () => {
  it('resuelve por nombre, incluido el subalmacén', () => {
    expect(sedeDeAlmacen('Viveres y Art. Limpieza', ALMACENES)).toBe('LOS PINOS');
    expect(sedeDeAlmacen('Taller', ALMACENES)).toBe('CENTRO DE FUNDICION - MATANZAS');
  });

  it('un almacén que no está en la tabla o no tiene sede no se puede ubicar', () => {
    expect(sedeDeAlmacen('NO EXISTE', ALMACENES)).toBeNull();
    expect(sedeDeAlmacen('Legado', ALMACENES)).toBe('Sin sede');
    expect(sedeDeAlmacen('', ALMACENES)).toBeNull();
  });
});

describe('puedeMoverEnAlmacen', () => {
  const SOLO_PINOS = ['LOS PINOS'];

  it('sin restricción se puede mover en cualquier lado', () => {
    expect(puedeMoverEnAlmacen('General', ALMACENES, null)).toBe(true);
    expect(puedeMoverEnAlmacen('NO EXISTE', ALMACENES, null)).toBe(true);
  });

  it('el almacenista mueve en su sede, incluidos los subalmacenes', () => {
    expect(puedeMoverEnAlmacen('Los Pinos', ALMACENES, SOLO_PINOS)).toBe(true);
    expect(puedeMoverEnAlmacen('Viveres y Art. Limpieza', ALMACENES, SOLO_PINOS)).toBe(true);
  });

  it('NO mueve en la sede ajena — el caso que se está corrigiendo', () => {
    expect(puedeMoverEnAlmacen('General', ALMACENES, SOLO_PINOS)).toBe(false);
    expect(puedeMoverEnAlmacen('Taller', ALMACENES, SOLO_PINOS)).toBe(false);
    expect(puedeMoverEnAlmacen('CENTRO DE ACOPIO - LA ESPERANZA', ALMACENES, SOLO_PINOS)).toBe(false);
  });

  it('un almacén de sede desconocida se bloquea bajo restricción (no se adivina)', () => {
    expect(puedeMoverEnAlmacen('Legado', ALMACENES, SOLO_PINOS)).toBe(false);
    expect(puedeMoverEnAlmacen('NO EXISTE', ALMACENES, SOLO_PINOS)).toBe(false);
    expect(puedeMoverEnSede(null, SOLO_PINOS)).toBe(false);
  });

  it('con dos sedes asignadas mueve en las dos', () => {
    const dos = ['LOS PINOS', 'CENTRO DE FUNDICION - MATANZAS'];
    expect(puedeMoverEnAlmacen('Los Pinos', ALMACENES, dos)).toBe(true);
    expect(puedeMoverEnAlmacen('General', ALMACENES, dos)).toBe(true);
    expect(puedeMoverEnAlmacen('CENTRO DE ACOPIO - LA ESPERANZA', ALMACENES, dos)).toBe(false);
  });
});

describe('motivoAlmacenAjeno', () => {
  it('no hay motivo cuando sí puede', () => {
    expect(motivoAlmacenAjeno('Los Pinos', ALMACENES, ['LOS PINOS'])).toBeNull();
    expect(motivoAlmacenAjeno('General', ALMACENES, null)).toBeNull();
  });

  it('dice de qué sede es, qué tiene asignado y por dónde pedirlo', () => {
    const m = motivoAlmacenAjeno('General', ALMACENES, ['LOS PINOS']) ?? '';
    expect(m).toContain('CENTRO DE FUNDICION - MATANZAS');
    expect(m).toContain('LOS PINOS');
    expect(m).toContain('traslado');
  });
});

describe('recepción de compras', () => {
  it('sin restricción se ofrecen los dos destinos', () => {
    expect(opcionesRecepcion().map((d) => d.label)).toEqual(['LOS PINOS', 'MATANZA']);
    expect(opcionesRecepcion(null).map((d) => d.label)).toEqual(['LOS PINOS', 'MATANZA']);
    expect(opcionesRecepcion([]).map((d) => d.label)).toEqual(['LOS PINOS', 'MATANZA']);
  });

  it('el almacenista de Matanzas solo ve MATANZA', () => {
    expect(opcionesRecepcion(['CENTRO DE FUNDICION - MATANZAS']).map((d) => d.almacen)).toEqual(['General']);
  });

  it('un centro de acopio no recibe compras', () => {
    expect(opcionesRecepcion(['CENTRO DE ACOPIO - LA ESPERANZA'])).toEqual([]);
  });

  it('el destino por defecto sale de la base y, si no, del respaldo', () => {
    expect(destinoRecepcionPorUsuario({ sedes_asignadas: ['LOS PINOS'], almacen_recepcion: 'Los Pinos' }, ALMACENES))
      .toEqual({ sedes: ['LOS PINOS'], almacen: 'Los Pinos' });
    expect(destinoRecepcionPorUsuario({ email: 'almacenmatanzas2026@gmail.com' }, ALMACENES))
      .toEqual({ sedes: ['CENTRO DE FUNDICION - MATANZAS'], almacen: 'General' });
  });

  it('si el almacén configurado no existe, cae al principal de la sede', () => {
    expect(destinoRecepcionPorUsuario({ sedes_asignadas: ['LOS PINOS'], almacen_recepcion: 'BORRADO' }, ALMACENES))
      .toEqual({ sedes: ['LOS PINOS'], almacen: 'Los Pinos' });
  });

  it('un usuario sin restricción elige libremente', () => {
    expect(destinoRecepcionPorUsuario({ email: 'admin@mgg.com' }, ALMACENES)).toBeNull();
  });
});
