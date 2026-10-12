import { describe, it, expect } from 'vitest';
import {
  cantidadEnLetras, cedulaConPuntos, entregaPorDefecto, errorFotosActa, errorNumeroActa, fechaCartaVE,
  listaItemsActa, modoNumeroActa, nombreCorto, numeroActa, parrafoActa, siguienteNumeroActa, textoItemActa,
} from './actas';
import type { Personal } from '@/shared/lib/types';

describe('el número del acta', () => {
  it('va como NNN-AAAA y vacío es «que lo ponga el sistema»', () => {
    expect(errorNumeroActa('')).toBeNull();
    expect(errorNumeroActa('026-2026')).toBeNull();
    expect(errorNumeroActa('1026-2026')).toBeNull();
    expect(errorNumeroActa('26-2026')).toMatch(/026-2026/);
    expect(errorNumeroActa('ASG-026')).toMatch(/026-2026/);
  });
  it('el siguiente del año sigue al mayor de ESE año, no de otro', () => {
    expect(siguienteNumeroActa([], 2026)).toBe('001-2026');
    expect(siguienteNumeroActa(['026-2026', '003-2026', '040-2025'], 2026)).toBe('027-2026');
    expect(siguienteNumeroActa(['026-2026'], 2027)).toBe('001-2027');
    expect(numeroActa(7, 2026)).toBe('007-2026');
  });

  it('manual la primera vez, automático después, y vuelve a manual si se borró una (hueco)', () => {
    expect(modoNumeroActa([], 2026)).toEqual({ modo: 'primera', sugerido: '', libres: [] });
    expect(modoNumeroActa(['040-2025'], 2026).modo).toBe('primera');
    expect(modoNumeroActa(['026-2026'], 2026)).toEqual({ modo: 'auto', sugerido: '027-2026', libres: [] });
    expect(modoNumeroActa(['026-2026', '027-2026', '028-2026'], 2026).sugerido).toBe('029-2026');
    // se borró la 027: queda libre y el campo vuelve a ser manual con ese número propuesto
    expect(modoNumeroActa(['026-2026', '028-2026', '029-2026'], 2026)).toEqual({ modo: 'libre', sugerido: '027-2026', libres: ['027-2026'] });
    // se borró la última (029): no hay hueco, el automático la vuelve a dar
    expect(modoNumeroActa(['026-2026', '027-2026', '028-2026'], 2026).modo).toBe('auto');
    // los números anteriores a la primera cargada (001-025 del Drive) NO cuentan como huecos
    expect(modoNumeroActa(['026-2026', '027-2026'], 2026).libres).toEqual([]);
  });
});

describe('cómo se escribe en la carta', () => {
  it('la cédula lleva puntos', () => {
    expect(cedulaConPuntos('V-12874838')).toBe('V-12.874.838');
    expect(cedulaConPuntos('13981204')).toBe('V-13.981.204');
    expect(cedulaConPuntos('E-801')).toBe('E-801');
    expect(cedulaConPuntos('')).toBe('');
  });
  it('la cantidad va en letras y en número', () => {
    expect(cantidadEnLetras(1)).toBe('un (1)');
    expect(cantidadEnLetras(2)).toBe('dos (2)');
    expect(cantidadEnLetras(21)).toBe('veintiún (21)');
    expect(cantidadEnLetras(35)).toBe('treinta y cinco (35)');
    expect(cantidadEnLetras(1.5)).toBe('1.5');
    expect(cantidadEnLetras(0)).toBe('');
  });
  it('la fecha es la de la carta, sin corrimiento de zona', () => {
    expect(fechaCartaVE('2026-09-24')).toBe('Puerto Ordaz, 24 de septiembre del 2026');
    expect(fechaCartaVE('2026-01-01')).toBe('Puerto Ordaz, 1 de enero del 2026');
  });
  it('un ítem se nombra con su cantidad, en mayúsculas y con su serial', () => {
    expect(textoItemActa({ descripcion: 'Bolso tipo maletín', cantidad: 1 })).toBe('un (1) BOLSO TIPO MALETÍN');
    expect(textoItemActa({ descripcion: 'Laptop Lenovo', cantidad: 1, serial: 'PF2ABC' })).toBe('un (1) LAPTOP LENOVO, serial PF2ABC');
    expect(textoItemActa({ descripcion: 'Guantes', cantidad: 3, unidad: 'par' })).toBe('tres (3) par de GUANTES');
    expect(listaItemsActa([
      { descripcion: 'Casco', cantidad: 1 }, { descripcion: 'Botas', cantidad: 1 }, { descripcion: 'Lentes', cantidad: 2 },
    ])).toBe('un (1) CASCO; un (1) BOTAS y dos (2) LENTES');
  });
  it('el párrafo dice lo mismo que el papel del Drive', () => {
    const p = parrafoActa({
      entregaNombre: 'Lcda Leydis Rengel', entregaCedula: 'V-12874838', entregaCargo: 'Gerente General',
      recibeNombre: 'Zorys Grillet',
      items: [{ descripcion: 'Bolso tipo maletín', cantidad: 1, retornable: true }],
      observaciones: 'para guardar laptop',
    });
    expect(p).toContain('Quien suscribe, LCDA LEYDIS RENGEL, titular de la cédula de identidad N° V-12.874.838, Gerente General de la Empresa Mineral Group Guayana C.A.');
    expect(p).toContain('Le hace entrega a: ZORYS GRILLET un (1) BOLSO TIPO MALETÍN, para guardar laptop.');
    expect(p).toContain('devolución inmediata en caso de cese de la relación laboral.');
  });
  it('a una dotación no se le pide devolución', () => {
    const p = parrafoActa({
      entregaNombre: 'X', entregaCedula: '', entregaCargo: '', recibeNombre: 'Y',
      items: [{ descripcion: 'Uniforme', cantidad: 2, retornable: false }],
    });
    expect(p).not.toContain('devolución');
    expect(p).toContain('uso profesional y cuidado físico.');
  });
  it('con muchos ítems la carta los manda a la tabla', () => {
    const p = parrafoActa({
      entregaNombre: 'X', entregaCedula: '', entregaCargo: '', recibeNombre: 'Y',
      items: [1, 2, 3, 4].map((i) => ({ descripcion: `Cosa ${i}`, cantidad: 1 })),
    });
    expect(p).toContain('los bienes que se detallan a continuación');
  });
});

describe('quién entrega y las fotos', () => {
  const ps = [
    { id: 'a', nombre: 'Ana', activo: true, cargo: 'Analista' },
    { id: 'g', nombre: 'Leydis', activo: true, cargo: 'GERENTE GENERAL' },
    { id: 'x', nombre: 'Viejo', activo: false, cargo: 'Gerente general' },
  ] as unknown as Personal[];
  it('por defecto entrega la Gerente General; si se usó otro, ese', () => {
    expect(entregaPorDefecto(ps)).toBe('g');
    expect(entregaPorDefecto(ps, 'a')).toBe('a');
    expect(entregaPorDefecto(ps, 'x')).toBe('g');
    expect(entregaPorDefecto([ps[0]])).toBe('');
  });
  it('las fotos: imágenes, hasta cuatro, de hasta 10 MB', () => {
    const img = (name: string, size = 1000) => ({ name, type: 'image/jpeg', size });
    expect(errorFotosActa([img('a.jpg')])).toBeNull();
    expect(errorFotosActa([img('a.jpg')], 4)).toMatch(/hasta 4/);
    expect(errorFotosActa([{ name: 'x.pdf', type: 'application/pdf', size: 10 }])).toMatch(/no es una imagen/);
    expect(errorFotosActa([img('grande.jpg', 11 * 1024 * 1024)])).toMatch(/10 MB/);
  });
});

describe('quien suscribe: nombre y apellido nada más', () => {
  it('toma la primera palabra del nombre y la primera del apellido, en mayúsculas', () => {
    expect(nombreCorto({ nombre: 'Leydis Marilin', apellido: 'Rengel Vazquez' })).toBe('LEYDIS RENGEL');
    expect(nombreCorto({ nombre: '  JESUS ', apellido: 'LOZADA' })).toBe('JESUS LOZADA');
    expect(nombreCorto({ nombre: 'Ana', apellido: '' })).toBe('ANA');
    expect(nombreCorto(null)).toBe('');
  });
});
