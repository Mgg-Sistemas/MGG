import { describe, expect, it } from 'vitest';
import { mensajeErrorFuncion, mensajePorEstado, traducirErrorAuth } from './funcionesError';

describe('traducirErrorAuth', () => {
  it('clave filtrada / débil', () => {
    expect(traducirErrorAuth('Password is known to be weak and easy to guess, please choose a different one.'))
      .toMatch(/listas de claves filtradas/);
  });
  it('correo repetido y clave corta', () => {
    expect(traducirErrorAuth('A user with this email address has already been registered')).toBe('Ya existe un usuario con ese correo.');
    expect(traducirErrorAuth('Password should be at least 6 characters.')).toBe('La clave es muy corta: debe tener al menos 6 caracteres.');
  });
  it('lo desconocido queda igual', () => {
    expect(traducirErrorAuth('Rol "x" no existe en el catalogo')).toBe('Rol "x" no existe en el catalogo');
  });
});

describe('mensajeErrorFuncion', () => {
  const errorCon = (body: string, status: number) => ({
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(body, { status }),
  });

  it('lee el { error } del cuerpo y lo traduce', async () => {
    const e = errorCon(JSON.stringify({ error: 'Password is known to be weak and easy to guess' }), 400);
    expect(await mensajeErrorFuncion(e)).toMatch(/filtradas/);
  });
  it('acepta { message }', async () => {
    expect(await mensajeErrorFuncion(errorCon(JSON.stringify({ message: 'Solo admin puede crear usuarios' }), 403)))
      .toBe('Solo admin puede crear usuarios');
  });
  it('sin cuerpo usa el código', async () => {
    expect(await mensajeErrorFuncion(errorCon('', 500))).toBe(mensajePorEstado(500));
    expect(await mensajeErrorFuncion(errorCon('', 401))).toMatch(/sesión venció/);
  });
  it('error de red (sin respuesta)', async () => {
    expect(await mensajeErrorFuncion({ message: 'Failed to send a request to the Edge Function' })).toMatch(/No se pudo conectar/);
  });
});
