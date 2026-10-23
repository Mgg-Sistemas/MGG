import { describe, expect, it } from 'vitest';
import { rutaFichaProveedor, textoRifInvalido } from './mensajeRif';

// Datos inventados.
describe('RIF inválido: cuál y dónde corregirlo (D43)', () => {
  it('practicada: nombra al proveedor y su RIF, y manda a su ficha', () => {
    const t = textoRifInvalido({ direccion: 'practicada', rif: ' J-12345678-0 ', nombre: 'Proveedor de prueba' });
    expect(t.error).toBe('El RIF del proveedor «Proveedor de prueba» es «J-12345678-0» y no es válido. Corrígelo en su ficha (Proveedores) y vuelve a intentarlo.');
    expect(t.hint).toContain('«J-12345678-0»');
    expect(t.hint).toContain('ficha del proveedor');
  });

  it('practicada sin nombre: igual dice el RIF', () => {
    expect(textoRifInvalido({ direccion: 'practicada', rif: 'X-1', nombre: null }).error).toMatch(/^El RIF del proveedor es «X-1» y no es válido/);
  });

  it('recibida: el RIF escrito y qué revisar', () => {
    const t = textoRifInvalido({ direccion: 'recibida', rif: 'J-1', nombre: 'Cliente' });
    expect(t.error).toBe('El RIF «J-1» no es válido: revisa la letra, los números y el dígito verificador.');
    expect(t.hint).toContain('«J-1»');
  });

  it('la ficha del proveedor se abre con ?detalle=', () => {
    expect(rutaFichaProveedor('prov 1')).toBe('/app/proveedores?detalle=prov%201');
  });
});
