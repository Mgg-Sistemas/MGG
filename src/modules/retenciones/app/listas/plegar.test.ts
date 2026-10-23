import { afterEach, describe, expect, it } from 'vitest';
import {
  abiertoInicial, abiertoPorVencidos, olvidarPlegados, plegadoRecordado, recordarPlegado, resumenAtencion,
  suscribirPlegado, textoPlegar,
} from './plegar';
import { decidirCierre, dentroDe, esCierre } from './dialogo';

describe('plegar (R3-15): «Ver todo (N)» ↔ «Mostrar menos»', () => {
  it('el mismo botón cambia de texto', () => {
    expect(textoPlegar(false, 7)).toBe('Ver todo (7)');
    expect(textoPlegar(true, 7)).toBe('Mostrar menos');
  });

  it('acepta otro texto plegado (las facturas restantes de un proveedor)', () => {
    const restantes = (n: number) => `Ver las ${n} facturas restantes de este proveedor`;
    expect(textoPlegar(false, 12, restantes)).toBe('Ver las 12 facturas restantes de este proveedor');
    expect(textoPlegar(true, 12, restantes)).toBe('Mostrar menos');
  });

  it('por defecto, desplegado si hay vencidos y plegado si no; lo recordado manda', () => {
    expect(abiertoPorVencidos(2)).toBe(true);
    expect(abiertoPorVencidos(0)).toBe(false);
    expect(abiertoInicial(undefined, true)).toBe(true);
    expect(abiertoInicial(null, false)).toBe(false);
    expect(abiertoInicial(false, true)).toBe(false);
    expect(abiertoInicial(true, false)).toBe(true);
  });

  it('«Requiere atención» muestra su conteo también plegado', () => {
    expect(resumenAtencion({ vencidos: 2 })).toBe('· 2 vencido(s)');
    expect(resumenAtencion({ vencidos: 0 })).toBe('· nada vencido');
    expect(resumenAtencion({ vencidos: 1, porVencer: 3, sinPaso: 1 })).toBe('· 1 vencido(s) · 3 por vencer · 1 sin paso inicial');
  });
});

describe('plegar: se recuerda mientras dure la página', () => {
  afterEach(() => olvidarPlegados());

  it('sin tocar, no hay nada recordado; al tocar, queda y avisa a quien escucha', () => {
    let avisos = 0;
    const dejar = suscribirPlegado(() => { avisos++; });
    expect(plegadoRecordado('curso')).toBeUndefined();
    recordarPlegado('curso', true);
    expect(plegadoRecordado('curso')).toBe(true);
    recordarPlegado('curso', false);
    expect(plegadoRecordado('curso')).toBe(false);
    expect(avisos).toBe(2);
    dejar();
    recordarPlegado('curso', true);
    expect(avisos).toBe(2);
  });

  it('cada clave por separado', () => {
    recordarPlegado('curso', true);
    expect(plegadoRecordado('atencion')).toBeUndefined();
  });
});

describe('diálogos (R3-8): cuándo se pregunta «¿Descartarlos?»', () => {
  it('Cancelar, Cerrar, Escape y el clic fuera son cierres; Guardar no', () => {
    expect(esCierre('cancelar')).toBe(true);
    expect(esCierre('cerrar')).toBe(true);
    expect(esCierre('')).toBe(true);
    expect(esCierre(undefined)).toBe(true);
    expect(esCierre('guardar')).toBe(false);
  });

  it('con cambios pregunta; sin cambios cierra; lo que no es cierre lo decide la pantalla', () => {
    expect(decidirCierre('cancelar', true)).toBe('preguntar');
    expect(decidirCierre('cancelar', false)).toBe('cerrar');
    expect(decidirCierre('', true)).toBe('preguntar');
    expect(decidirCierre('guardar', true)).toBe('enviar');
    expect(decidirCierre('cerrar', true, false)).toBe('cerrar');
  });

  it('el clic fuera del rectángulo del diálogo es el fondo', () => {
    const r = { left: 100, right: 500, top: 50, bottom: 400 };
    expect(dentroDe(300, 200, r)).toBe(true);
    expect(dentroDe(100, 50, r)).toBe(true);
    expect(dentroDe(99, 200, r)).toBe(false);
    expect(dentroDe(300, 401, r)).toBe(false);
  });
});
