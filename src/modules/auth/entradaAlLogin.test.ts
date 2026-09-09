import { describe, it, expect } from 'vitest';
import { decidirEntradaAlLogin, ESPERA_MAXIMA_MS } from './entradaAlLogin';

describe('decidirEntradaAlLogin', () => {
  it('con sesión abierta entra a la app: NO se cierra la sesión', () => {
    expect(decidirEntradaAlLogin({ user: { id: 'u-1' } })).toBe('entrar');
  });

  it('sin sesión pide credenciales', () => {
    expect(decidirEntradaAlLogin(null)).toBe('pedir-credenciales');
    expect(decidirEntradaAlLogin(undefined)).toBe('pedir-credenciales');
  });

  it('una sesión sin usuario no cuenta como sesión', () => {
    expect(decidirEntradaAlLogin({ user: null })).toBe('pedir-credenciales');
    expect(decidirEntradaAlLogin({})).toBe('pedir-credenciales');
    expect(decidirEntradaAlLogin({ user: { id: null } })).toBe('pedir-credenciales');
    expect(decidirEntradaAlLogin({ user: { id: '' } })).toBe('pedir-credenciales');
  });

  it('la regresión que corrige: recargar el login con sesión viva nunca la cierra', () => {
    // El storage es compartido entre pestañas. Si esta decisión volviera a ser
    // «cerrar», recargar el login en una pestaña mataría la sesión de la otra.
    const sesionDeLaOtraPestania = { user: { id: 'u-1' } };
    expect(decidirEntradaAlLogin(sesionDeLaOtraPestania)).not.toBe('pedir-credenciales');
    expect(decidirEntradaAlLogin(sesionDeLaOtraPestania)).toBe('entrar');
  });

  it('la espera máxima es corta: el formulario nunca queda colgado', () => {
    expect(ESPERA_MAXIMA_MS).toBeGreaterThan(0);
    expect(ESPERA_MAXIMA_MS).toBeLessThanOrEqual(3000);
  });
});
