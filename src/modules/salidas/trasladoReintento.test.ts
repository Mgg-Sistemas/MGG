import { describe, it, expect } from 'vitest';
import { planReintentoTraslado, type PataDeSolicitud } from './trasladoReintento';
import type { ItemSolicitudSalida } from '@/shared/lib/types';

const DESTINO = 'La Esperanza';
const linea = (producto_id: string, cantidad: number, almacen = 'Los Pinos'): ItemSolicitudSalida =>
  ({ producto_id, producto_nombre: producto_id.toUpperCase(), cantidad, almacen });
const sale = (producto_id: string, cantidad: number, almacen = 'Los Pinos'): PataDeSolicitud =>
  ({ producto_id, almacen, delta: -cantidad });
const entra = (producto_id: string, cantidad: number, almacen = DESTINO): PataDeSolicitud =>
  ({ producto_id, almacen, delta: cantidad });
const ids = (xs: { producto_id: string }[]) => xs.map((x) => x.producto_id);

describe('planReintentoTraslado — reintentar sin mover dos veces', () => {
  it('sin intentos previos, todo está pendiente', () => {
    const plan = planReintentoTraslado([linea('arroz', 24), linea('atun', 48)], [], DESTINO);
    expect(ids(plan.pendientes)).toEqual(['arroz', 'atun']);
    expect(plan.hechas).toEqual([]);
    expect(plan.aMedias).toEqual([]);
  });

  it('lo que ya salió y llegó en la tanda anterior no se vuelve a mover', () => {
    const plan = planReintentoTraslado(
      [linea('arroz', 24), linea('atun', 48), linea('azucar', 10)],
      [sale('arroz', 24), entra('arroz', 24), sale('atun', 48), entra('atun', 48)],
      DESTINO,
    );
    expect(ids(plan.hechas)).toEqual(['arroz', 'atun']);
    expect(ids(plan.pendientes)).toEqual(['azucar']);
    expect(plan.aMedias).toEqual([]);
  });

  it('un traslado compensado (falló la entrada y se devolvió) se vuelve a intentar', () => {
    const plan = planReintentoTraslado(
      [linea('arroz', 24)],
      [sale('arroz', 24), { producto_id: 'arroz', almacen: 'Los Pinos', delta: 24 }],
      DESTINO,
    );
    expect(ids(plan.pendientes)).toEqual(['arroz']);
    expect(plan.hechas).toEqual([]);
    expect(plan.aMedias).toEqual([]);
  });

  it('salió y no llegó ni se devolvió: queda a medias, ni se reintenta ni se da por hecho', () => {
    const plan = planReintentoTraslado([linea('arroz', 24)], [sale('arroz', 24)], DESTINO);
    expect(plan.pendientes).toEqual([]);
    expect(plan.hechas).toEqual([]);
    expect(plan.aMedias).toEqual([{ producto_id: 'arroz', producto_nombre: 'ARROZ', almacen: 'Los Pinos', cantidad: 24 }]);
  });

  it('el mismo víver en dos líneas del mismo almacén: cuenta cada una por separado', () => {
    const plan = planReintentoTraslado([linea('sal', 10), linea('sal', 10)], [sale('sal', 10), entra('sal', 10)], DESTINO);
    expect(plan.hechas).toHaveLength(1);
    expect(plan.pendientes).toHaveLength(1);
  });

  it('el mismo víver desde dos almacenes: solo está hecho el que se movió', () => {
    const plan = planReintentoTraslado(
      [linea('sal', 10, 'Los Pinos'), linea('sal', 5, 'Resguardo')],
      [sale('sal', 10, 'Los Pinos'), entra('sal', 10)],
      DESTINO,
    );
    expect(plan.hechas.map((x) => x.almacen)).toEqual(['Los Pinos']);
    expect(plan.pendientes.map((x) => x.almacen)).toEqual(['Resguardo']);
  });

  it('una línea sin almacén usa el origen de la cabecera', () => {
    const plan = planReintentoTraslado(
      [{ producto_id: 'sal', cantidad: 3 }],
      [sale('sal', 3, 'Los Pinos'), entra('sal', 3)],
      DESTINO,
      'Los Pinos',
    );
    expect(plan.hechas).toHaveLength(1);
  });
});
