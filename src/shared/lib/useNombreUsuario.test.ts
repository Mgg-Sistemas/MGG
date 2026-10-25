import { describe, it, expect, vi } from 'vitest';

vi.mock('@/shared/lib/supabase', () => ({ supabase: {} }));
import { resolverNombreUsuario } from './useNombreUsuario';
import type { PersonasMap } from './personas';

const dir = Object.assign(new Map<string, string>([['wendy@mgg.com', 'WENDY LOZADA'], ['rrhh@mgg.com', 'ANA PEREZ']]), {
  historial: [{ email: 'rrhh@mgg.com', nombre_anterior: 'KELVIN RAMOS', nombre_nuevo: 'ANA PEREZ', created_at: '2026-10-10T00:00:00Z' }],
}) as PersonasMap;

describe('resolverNombreUsuario · correo → nombre y apellido', () => {
  it('el nombre sellado manda', () => {
    expect(resolverNombreUsuario(dir, 'Pedro Gil', 'wendy@mgg.com')).toBe('Pedro Gil');
  });
  it('sin nombre, resuelve el correo', () => {
    expect(resolverNombreUsuario(dir, null, 'wendy@mgg.com')).toBe('WENDY LOZADA');
    expect(resolverNombreUsuario(dir, '', 'WENDY@mgg.com')).toBe('WENDY LOZADA');
  });
  it('si el «nombre» sellado es un correo, también lo resuelve', () => {
    expect(resolverNombreUsuario(dir, 'wendy@mgg.com', null)).toBe('WENDY LOZADA');
  });
  it('con fecha, el nombre que tenía ese día', () => {
    expect(resolverNombreUsuario(dir, null, 'rrhh@mgg.com', '2026-10-02T11:34:00Z')).toBe('KELVIN RAMOS');
    expect(resolverNombreUsuario(dir, null, 'rrhh@mgg.com', '2026-10-20T11:34:00Z')).toBe('ANA PEREZ');
  });
  it('correo desconocido o sin directorio: el correo tal cual; nada: vacío', () => {
    expect(resolverNombreUsuario(dir, null, 'otro@x.com')).toBe('otro@x.com');
    expect(resolverNombreUsuario(null, null, 'wendy@mgg.com')).toBe('wendy@mgg.com');
    expect(resolverNombreUsuario(dir, null, null)).toBe('');
  });
});
