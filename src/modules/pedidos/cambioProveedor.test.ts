import { describe, expect, it } from 'vitest';
import { errorMotivoCambio, extrasCambioProveedor, lineaCambioProveedor, textoProveedor } from './cambioProveedor';

const A = { id: 'a', razon_social: 'DISTRIBUIDORA EL TORETE J&M, C.A', rif: 'J-506575140' };
const B = { id: 'b', razon_social: 'CARNICERIA LA ESPERANZA', rif: null };
const buscar = (id: string) => ({ a: A, b: B }[id as 'a' | 'b'] ?? null);

describe('textoProveedor', () => {
  it('razón social y RIF', () => expect(textoProveedor(A)).toBe('DISTRIBUIDORA EL TORETE J&M, C.A · J-506575140'));
  it('sin RIF, solo el nombre', () => expect(textoProveedor(B)).toBe('CARNICERIA LA ESPERANZA'));
  it('sin nada, raya', () => {
    expect(textoProveedor(null)).toBe('—');
    expect(textoProveedor({ razon_social: '  ' })).toBe('—');
  });
});

describe('errorMotivoCambio', () => {
  it('exige un motivo', () => {
    expect(errorMotivoCambio('')).toMatch(/motivo/i);
    expect(errorMotivoCambio('   ')).toMatch(/motivo/i);
    expect(errorMotivoCambio(null)).toMatch(/motivo/i);
  });
  it('muy corto no sirve', () => expect(errorMotivoCambio('ok')).toMatch(/corto/));
  it('uno normal pasa', () => expect(errorMotivoCambio('Proveedor sin existencia')).toBeNull());
});

describe('extrasCambioProveedor', () => {
  it('guarda ids, nombre y RIF de ese día, motivo y la confirmación que se anula', () => {
    const x = extrasCambioProveedor({
      anterior: A, nuevo: B, motivo: '  Sin existencia  ', confirmadaPor: 'leydis@mgg.com',
      confirmadaEn: '2026-10-16T11:44:00Z', total: 1204.88, moneda: 'USD',
    });
    expect(x).toMatchObject({
      proveedorAnteriorId: 'a', proveedorNuevoId: 'b',
      proveedorAnterior: 'DISTRIBUIDORA EL TORETE J&M, C.A · J-506575140',
      proveedorNuevo: 'CARNICERIA LA ESPERANZA',
      motivo: 'Sin existencia', vuelve_a: 'oc_creada',
      confirmada_por: 'leydis@mgg.com', confirmada_en: '2026-10-16T11:44:00Z', total: 1204.88, moneda: 'USD',
    });
  });
  it('sin motivo ni confirmación no inventa campos', () => {
    const x = extrasCambioProveedor({ anterior: A, nuevo: B });
    expect(x).not.toHaveProperty('motivo');
    expect(x).not.toHaveProperty('confirmada_por');
    expect(x).not.toHaveProperty('total');
  });
});

describe('lineaCambioProveedor', () => {
  it('evento nuevo: usa lo guardado aunque el proveedor cambie de nombre después', () => {
    const h = extrasCambioProveedor({ anterior: A, nuevo: B, motivo: 'Sin existencia' });
    expect(lineaCambioProveedor(h, () => null)).toBe(' · de DISTRIBUIDORA EL TORETE J&M, C.A · J-506575140 → CARNICERIA LA ESPERANZA · Sin existencia');
  });
  it('evento viejo con de / a: busca los nombres por id', () => {
    expect(lineaCambioProveedor({ de: 'a', a: 'b', vuelve_a: 'oc_creada' }, buscar))
      .toBe(' · de DISTRIBUIDORA EL TORETE J&M, C.A · J-506575140 → CARNICERIA LA ESPERANZA');
  });
  it('evento con solo ids (Editar OC): busca los nombres por id', () => {
    expect(lineaCambioProveedor({ proveedorAnteriorId: 'a', proveedorNuevoId: 'b' }, buscar)).toContain('→ CARNICERIA LA ESPERANZA');
  });
  it('sin los dos proveedores no dice nada (p. ej. «Proveedor desistió»)', () => {
    expect(lineaCambioProveedor({ proveedorAnteriorId: 'a' }, buscar)).toBe('');
    expect(lineaCambioProveedor({ proveedorAnteriorId: 'zzz', proveedorNuevoId: 'b' }, buscar)).toBe('');
    expect(lineaCambioProveedor({}, buscar)).toBe('');
  });
});
