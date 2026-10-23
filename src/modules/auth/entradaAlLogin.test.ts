import { describe, it, expect, vi, afterEach } from 'vitest';
import { decidirEntradaAlLogin, ESPERA_MAXIMA_MS, verificarSesionAlAbrir } from './entradaAlLogin';

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

describe('verificarSesionAlAbrir', () => {
  afterEach(() => { vi.useRealTimers(); });

  const sinSesion = () => Promise.resolve({ data: { session: null } });
  const conSesion = () => Promise.resolve({ data: { session: { user: { id: 'u-1' } } } });
  const esperarPromesas = () => new Promise((r) => setTimeout(r, 0));

  function acciones(leerSesion: () => Promise<{ data: { session: { user?: { id?: string | null } | null } | null } }>) {
    return { leerSesion, entrar: vi.fn(), mostrarFormulario: vi.fn(), limpiarRestos: vi.fn() };
  }

  it('sin sesión: limpia restos y muestra el formulario', async () => {
    const a = acciones(sinSesion);
    verificarSesionAlAbrir(a);
    await esperarPromesas();
    expect(a.limpiarRestos).toHaveBeenCalledTimes(1);
    expect(a.mostrarFormulario).toHaveBeenCalled();
    expect(a.entrar).not.toHaveBeenCalled();
  });

  it('con sesión: entra y no limpia nada', async () => {
    const a = acciones(conSesion);
    verificarSesionAlAbrir(a);
    await esperarPromesas();
    expect(a.entrar).toHaveBeenCalledTimes(1);
    expect(a.limpiarRestos).not.toHaveBeenCalled();
  });

  it('la regresión que corrige: montar, desmontar y volver a montar (modo estricto de React en local) igual muestra el formulario', async () => {
    // En local React monta, desmonta y vuelve a montar cada pantalla. El primer
    // montaje queda anulado al desmontarse; el segundo tiene que verificar de
    // nuevo. Antes un candado lo impedía y el login quedaba en «Verificando tu
    // sesión…» para siempre (solo en el servidor local; en producción no).
    const a = acciones(sinSesion);
    const desmontar = verificarSesionAlAbrir(a);
    desmontar();
    verificarSesionAlAbrir(a);
    await esperarPromesas();
    expect(a.mostrarFormulario).toHaveBeenCalled();
  });

  it('lo que llega después de desmontar no toca la pantalla', async () => {
    const a = acciones(sinSesion);
    const desmontar = verificarSesionAlAbrir(a);
    desmontar();
    await esperarPromesas();
    expect(a.mostrarFormulario).not.toHaveBeenCalled();
    expect(a.entrar).not.toHaveBeenCalled();
  });

  it('si leer la sesión no responde, el formulario aparece al cumplirse la espera máxima', () => {
    vi.useFakeTimers();
    const a = acciones(() => new Promise(() => {}));
    verificarSesionAlAbrir(a);
    expect(a.mostrarFormulario).not.toHaveBeenCalled();
    vi.advanceTimersByTime(ESPERA_MAXIMA_MS);
    expect(a.mostrarFormulario).toHaveBeenCalledTimes(1);
  });

  it('si leer la sesión falla, muestra el formulario', async () => {
    const a = acciones(() => Promise.reject(new Error('sin red')));
    verificarSesionAlAbrir(a);
    await esperarPromesas();
    expect(a.mostrarFormulario).toHaveBeenCalled();
  });
});
