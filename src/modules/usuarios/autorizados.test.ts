import { afterEach, describe, expect, it } from 'vitest';
import { autorizadoPara, resumenAutorizacion, setAutorizados, type UsuarioAutorizado } from './autorizados';

const fila = (email: string, oc: boolean, sal: boolean): UsuarioAutorizado => ({
  email, aprobar_oc: oc, aprobar_salidas: sal, firma: null, firma_w: null, firma_h: null,
});

describe('Usuarios autorizados · quién aprueba OC y salidas', () => {
  afterEach(() => setAutorizados(null));

  it('con la lista cargada, solo aprueba OC quien tiene la opción', () => {
    setAutorizados([fila('ana@mgg.com', true, false), fila('luis@mgg.com', false, true)]);
    expect(autorizadoPara('ANA@mgg.com ', 'oc')).toBe(true);
    expect(autorizadoPara('luis@mgg.com', 'oc')).toBe(false);
    expect(autorizadoPara('otra@mgg.com', 'oc')).toBe(false);
  });

  it('salidas: solo autorizados con «Aprobar órdenes de salida»', () => {
    setAutorizados([fila('ana@mgg.com', true, false), fila('luis@mgg.com', false, true), fila('eva@mgg.com', true, true)]);
    expect(autorizadoPara('luis@mgg.com', 'salidas')).toBe(true);
    expect(autorizadoPara('ana@mgg.com', 'salidas')).toBe(false);
    expect(autorizadoPara('eva@mgg.com', 'salidas')).toBe(true);
  });

  it('sin lista cargada devuelve null', () => {
    expect(autorizadoPara('ana@mgg.com', 'oc')).toBeNull();
    expect(autorizadoPara('ana@mgg.com', 'salidas')).toBeNull();
  });

  it('resumen de opciones', () => {
    expect(resumenAutorizacion({ aprobar_oc: true, aprobar_salidas: true })).toBe('Aprueba compras y salidas');
    expect(resumenAutorizacion({ aprobar_oc: true, aprobar_salidas: false })).toBe('Aprueba órdenes de compra');
    expect(resumenAutorizacion({ aprobar_oc: false, aprobar_salidas: true })).toBe('Aprueba órdenes de salida');
    expect(resumenAutorizacion({ aprobar_oc: false, aprobar_salidas: false })).toBe('Sin autorizaciones');
  });
});
