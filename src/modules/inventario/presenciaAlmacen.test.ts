import { describe, it, expect } from 'vitest';
import { opcionesDePresencia, almacenesFaltantes } from './presenciaAlmacen';

type Alm = { nombre: string; sede: string | null; parent_id: string | null; estado: 'activo' | 'inactivo' };
const alm = (nombre: string, sede: string, estado: 'activo' | 'inactivo' = 'activo'): Alm =>
  ({ nombre, sede, parent_id: null, estado });

const ALMACENES: Alm[] = [
  alm('General', 'CENTRO DE FUNDICION - MATANZAS'),
  alm('COMBUSTIBLE', 'CENTRO DE FUNDICION - MATANZAS'),
  alm('ESTAÑO EN BRUTO', 'CENTRO DE FUNDICION - MATANZAS'),
  alm('Los Pinos', 'LOS PINOS'),
  alm('SNO₂ CASITERITA ALMACEN', 'LOS PINOS'),
  alm('INSUMOS Y CONSUMIBLES', 'LOS PINOS', 'inactivo'),
];

const plano = (grupos: ReturnType<typeof opcionesDePresencia>) =>
  grupos.flatMap(([, os]) => os.map((o) => `${o.nombre}${o.yaEsta ? ' ✓' : ''}`));

describe('dónde puede figurar una ficha', () => {
  it('ofrece el padre de cada sede y sus almacenes de mineral', () => {
    // ESTAÑO EN BRUTO entra por ser de mineral, igual que los de casiterita.
    expect(plano(opcionesDePresencia(ALMACENES, []))).toEqual([
      'General', 'ESTAÑO EN BRUTO', 'Los Pinos', 'SNO₂ CASITERITA ALMACEN',
    ]);
  });

  it('no ofrece los subalmacenes comunes ni los almacenes de baja', () => {
    const nombres = plano(opcionesDePresencia(ALMACENES, []));
    expect(nombres).not.toContain('COMBUSTIBLE');
    expect(nombres).not.toContain('INSUMOS Y CONSUMIBLES');
  });

  it('marca dónde ya figura, para no sembrarlo dos veces', () => {
    // El caso de INS-068: estaba en Los Pinos y hacía falta en Matanza.
    const existencias = [{ almacen: 'Los Pinos' }, { almacen: 'INSUMOS Y CONSUMIBLES' }];
    expect(plano(opcionesDePresencia(ALMACENES, existencias))).toEqual([
      'General', 'ESTAÑO EN BRUTO', 'Los Pinos ✓', 'SNO₂ CASITERITA ALMACEN',
    ]);
  });

  it('la fila en un almacén de baja no habilita nada: sigue faltando el padre', () => {
    // INS-068 arrastraba una existencia en un subalmacén inactivo de Los Pinos;
    // eso no lo hacía figurar en la lista de la sede.
    expect(almacenesFaltantes(ALMACENES, [{ almacen: 'INSUMOS Y CONSUMIBLES' }]))
      .toEqual(['General', 'ESTAÑO EN BRUTO', 'Los Pinos', 'SNO₂ CASITERITA ALMACEN']);
  });

  it('faltantes deja fuera lo que ya tiene', () => {
    expect(almacenesFaltantes(ALMACENES, [{ almacen: 'Los Pinos' }]))
      .toEqual(['General', 'ESTAÑO EN BRUTO', 'SNO₂ CASITERITA ALMACEN']);
  });

  it('una ficha que ya está en todos lados no deja nada para sembrar', () => {
    const todas = [{ almacen: 'General' }, { almacen: 'ESTAÑO EN BRUTO' },
      { almacen: 'Los Pinos' }, { almacen: 'SNO₂ CASITERITA ALMACEN' }];
    expect(almacenesFaltantes(ALMACENES, todas)).toEqual([]);
  });

  it('tolera listas vacías y almacenes en blanco', () => {
    expect(opcionesDePresencia([], [])).toEqual([]);
    expect(almacenesFaltantes(ALMACENES, [{ almacen: '' }])).toHaveLength(4);
  });
});
