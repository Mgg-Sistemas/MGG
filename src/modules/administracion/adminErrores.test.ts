import { describe, it, expect } from 'vitest';
import { conTopeSubida, esErrorTablaAusente, mensajeErrorSubidaAdmin } from './adminErrores';

describe('esErrorTablaAusente', () => {
  it('reconoce «relation ... does not exist»', () => {
    expect(esErrorTablaAusente({ message: 'relation "admin_profesionales" does not exist' })).toBe(true);
  });

  it('reconoce el mensaje de schema cache de PostgREST', () => {
    expect(esErrorTablaAusente({ message: "Could not find the table 'public.admin_carpetas' in the schema cache" })).toBe(true);
  });

  it('NO confunde un error normal (permiso) con tabla ausente', () => {
    expect(esErrorTablaAusente({ message: 'permission denied for table admin_centros_acopio' })).toBe(false);
  });

  it('es seguro ante null/undefined o error sin message', () => {
    expect(esErrorTablaAusente(null)).toBe(false);
    expect(esErrorTablaAusente(undefined)).toBe(false);
    expect(esErrorTablaAusente({ code: 'XX000' })).toBe(false);
  });
});

describe('mensajeErrorSubidaAdmin', () => {
  it('traduce el «Failed to fetch» del navegador en una instrucción clara', () => {
    const e = new TypeError('Failed to fetch');
    expect(mensajeErrorSubidaAdmin(e, 'rupdae.pdf')).toBe(
      'Se cortó la conexión mientras subía «rupdae.pdf». Revisá la señal y volvé a intentar.',
    );
    expect(mensajeErrorSubidaAdmin({ message: 'network error' })).toContain('Revisá la señal');
  });

  it('respeta el mensaje del tope de tiempo, ya escrito para el usuario', () => {
    const msg = '«acta.pdf» tardó más de 90 s en subir. Revisá la señal y volvé a intentar.';
    expect(mensajeErrorSubidaAdmin(new Error(msg), 'acta.pdf')).toBe(msg);
  });

  it('traduce duplicado, permiso, tamaño y bucket ausente', () => {
    expect(mensajeErrorSubidaAdmin({ code: '23505', message: 'duplicate key' }, 'rif.pdf')).toBe(
      'Ya existe un archivo con el nombre «rif.pdf».',
    );
    expect(mensajeErrorSubidaAdmin({ code: '42501', message: 'permission denied' })).toContain('no tiene permiso');
    expect(mensajeErrorSubidaAdmin({ message: 'payload too large' }, 'acta.pdf')).toContain('demasiado grande');
    expect(mensajeErrorSubidaAdmin({ message: 'Bucket not found' })).toContain('bucket');
  });

  it('conserva el motivo de un error normal y es seguro ante null/undefined', () => {
    expect(mensajeErrorSubidaAdmin({ message: 'forma inválida' }, 'x.pdf')).toContain('forma inválida');
    expect(mensajeErrorSubidaAdmin(null)).toContain('No se pudo subir');
    expect(mensajeErrorSubidaAdmin(undefined, 'x.pdf')).toContain('x.pdf');
  });
});

describe('conTopeSubida', () => {
  it('devuelve el resultado cuando la subida termina a tiempo', async () => {
    await expect(conTopeSubida(Promise.resolve('ok'), 'x.pdf')).resolves.toBe('ok');
  });

  it('propaga el error original sin envolverlo', async () => {
    await expect(conTopeSubida(Promise.reject(new Error('Failed to fetch')), 'x.pdf'))
      .rejects.toThrow('Failed to fetch');
  });
});
