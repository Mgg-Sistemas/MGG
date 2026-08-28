import { describe, it, expect } from 'vitest';
import { cambiaNota, cambiaProveedorOc, cambiaTexto, cambianNombres, hayCambiosMateriales } from './edicionOc';

// Caso real SP-2026-0124 (GT) / SP-2026-0116-4 (MGG): editar y guardar sin cambios reabría la OC.
const oc = {
  items: [{ sku: 'GEN-173', nombre: 'ACEITE MOTUL HIDRAULICO 68', marca: 'MOTUL', modelo: 'PAILA 20L', cantidad: 10, precio: 175.51, precio_usd: 175.51, comprar: true }],
  condiciones_pago: 'contado',
  descuento_obtenido: 0,
  proveedor_id: 'prov-maxoil',
  notas: 'SOLICITUD DE PAILA ACEITE',
};
const mismos = () => oc.items.map((i) => ({ ...i }));

describe('hayCambiosMateriales', () => {
  it('guardar sin tocar nada no es un cambio', () => {
    expect(hayCambiosMateriales(oc, { items: mismos(), condiciones_pago: 'contado', descuentoObtenido: 0, proveedorId: 'prov-maxoil', notas: oc.notas })).toBe(false);
  });

  it('cambiar solo la nota o solo el nombre no es un cambio material', () => {
    expect(hayCambiosMateriales(oc, { items: mismos(), notas: 'OTRA NOTA' })).toBe(false);
    const items = mismos(); items[0].nombre = 'ACEITE HIDRAULICO 68 MOTUL (PAILA)';
    expect(hayCambiosMateriales(oc, { items })).toBe(false);
  });

  it('campos que no vienen en la edición se consideran sin tocar', () => {
    expect(hayCambiosMateriales(oc, { items: mismos() })).toBe(false);
  });

  it('cambiar la cantidad o el precio reabre', () => {
    const a = mismos(); a[0].cantidad = 12;
    const b = mismos(); b[0].precio = 170;
    expect(hayCambiosMateriales(oc, { items: a })).toBe(true);
    expect(hayCambiosMateriales(oc, { items: b })).toBe(true);
  });

  it('agregar o quitar un producto reabre', () => {
    expect(hayCambiosMateriales(oc, { items: [...mismos(), { sku: 'GEN-001', cantidad: 1, precio: 5 }] })).toBe(true);
    expect(hayCambiosMateriales(oc, { items: [] })).toBe(true);
  });

  it('intercambiar cantidades entre dos variantes del mismo SKU sí es un cambio', () => {
    const dos = { ...oc, items: [
      { sku: 'A', marca: 'M1', cantidad: 5, precio: 2 },
      { sku: 'A', marca: 'M2', cantidad: 3, precio: 2 },
    ] };
    expect(hayCambiosMateriales(dos, { items: [{ sku: 'A', marca: 'M1', cantidad: 3, precio: 2 }, { sku: 'A', marca: 'M2', cantidad: 5, precio: 2 }] })).toBe(true);
    expect(hayCambiosMateriales(dos, { items: [{ sku: 'A', marca: 'M2', cantidad: 3, precio: 2 }, { sku: 'A', marca: 'M1', cantidad: 5, precio: 2 }] })).toBe(false);
  });

  it('cambiar el proveedor reabre; mandarlo igual, vacío o nulo cuando no hay, no', () => {
    expect(hayCambiosMateriales(oc, { items: mismos(), proveedorId: 'prov-otro' })).toBe(true);
    expect(hayCambiosMateriales(oc, { items: mismos(), proveedorId: 'prov-maxoil' })).toBe(false);
    const sinProv = { ...oc, proveedor_id: null };
    expect(cambiaProveedorOc(sinProv, { items: mismos(), proveedorId: '' })).toBe(false);
    expect(cambiaProveedorOc(sinProv, { items: mismos(), proveedorId: null })).toBe(false);
    expect(cambiaProveedorOc(sinProv, { items: mismos() })).toBe(false);
  });

  it('cambiar la condición de pago o el descuento reabre', () => {
    expect(hayCambiosMateriales(oc, { items: mismos(), condiciones_pago: 'credito' })).toBe(true);
    expect(hayCambiosMateriales(oc, { items: mismos(), descuentoObtenido: 12.5 })).toBe(true);
  });

  it('el orden de los ítems y los decimales de más no cuentan como cambio', () => {
    const dos = { ...oc, items: [{ sku: 'A', cantidad: 1, precio: 2 }, { sku: 'B', cantidad: 3, precio: 4.5 }] };
    expect(hayCambiosMateriales(dos, { items: [{ sku: 'B', cantidad: 3.0, precio: 4.5 }, { sku: 'A', cantidad: 1, precio: 2.000 }] })).toBe(false);
  });

  it('un ítem marcado «no comprar» no cuenta', () => {
    expect(hayCambiosMateriales(oc, { items: [...mismos(), { sku: 'X', cantidad: 9, precio: 9, comprar: false }] })).toBe(false);
  });
});

describe('cambiaNota / cambianNombres / cambiaTexto', () => {
  it('detecta la nota nueva y tolera espacios', () => {
    expect(cambiaNota(oc, { items: mismos(), notas: ' SOLICITUD DE PAILA ACEITE ' })).toBe(false);
    expect(cambiaNota(oc, { items: mismos(), notas: 'nueva' })).toBe(true);
    expect(cambiaNota(oc, { items: mismos() })).toBe(false);
  });

  it('un nombre corregido se detecta como texto (se guarda, no reabre)', () => {
    const items = mismos(); items[0].nombre = 'ACEITE HIDRAULICO 68 MOTUL (PAILA)';
    expect(cambianNombres(oc, { items })).toBe(true);
    expect(cambiaTexto(oc, { items })).toBe(true);
    expect(cambiaTexto(oc, { items: mismos() })).toBe(false);
  });
});
