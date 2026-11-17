import { describe, it, expect } from 'vitest';
import { esErrorTablaAusente } from './adminErrores';

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
