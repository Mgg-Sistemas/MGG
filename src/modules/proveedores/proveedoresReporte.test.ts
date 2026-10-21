import { describe, expect, it } from 'vitest';
import type { Proveedor } from '@/shared/lib/types';
import { filasProveedores, resumenProveedores, textoFiltros } from './proveedoresReporte';

const base: Proveedor = {
  id: '1', rif: 'J-12345678-9', razon_social: 'FERRETERIA EL MINERO C.A.', contacto: 'Ana Pérez', telefono: '0414-1234567',
  email: 'ventas@minero.com', direccion: 'Av. Guayana, Puerto Ordaz', actividad_economica: '4752', numero_administracion: '0412-7654321',
  actividad_economica_texto: 'Venta de herramientas', categorias: ['EPP', 'Herramientas'], origen: 'nacional', estado: 'activo', created_at: '2026-01-01',
};

describe('filasProveedores', () => {
  it('arma la fila completa con las categorías unidas y teléfonos', () => {
    const [f] = filasProveedores([base]);
    expect(f.rif).toBe('J-12345678-9');
    expect(f.categorias).toBe('EPP, Herramientas');
    expect(f.telefonoAdmin).toBe('0412-7654321');
    expect(f.origen).toBe('Nacional');
    expect(f.estado).toBe('Activo');
  });
  it('lo que falta queda vacío (no «null» ni «undefined»)', () => {
    const [f] = filasProveedores([{ ...base, contacto: null, telefono: undefined, email: null, direccion: null, numero_administracion: null, categorias: [], origen: 'internacional', estado: 'inactivo' }]);
    expect(f.contacto).toBe('');
    expect(f.telefono).toBe('');
    expect(f.email).toBe('');
    expect(f.categorias).toBe('');
    expect(f.origen).toBe('Internacional');
    expect(f.estado).toBe('Inactivo');
  });
  it('respeta el orden recibido', () => {
    const filas = filasProveedores([{ ...base, razon_social: 'B' }, { ...base, razon_social: 'A' }]);
    expect(filas.map((x) => x.razonSocial)).toEqual(['B', 'A']);
  });
});

describe('textoFiltros', () => {
  it('sin filtros lo dice', () => {
    expect(textoFiltros({})).toBe('Sin filtros (todos los proveedores)');
    expect(textoFiltros({ texto: '  ', estado: '', categoria: '' })).toBe('Sin filtros (todos los proveedores)');
  });
  it('lista cada filtro aplicado', () => {
    expect(textoFiltros({ texto: 'minero', estado: 'activo', categoria: 'EPP' })).toBe('Estado: Activos · Categoría: EPP · Búsqueda: «minero»');
    expect(textoFiltros({ estado: 'inactivo' })).toBe('Estado: Inactivos');
  });
});

describe('resumenProveedores', () => {
  it('cuenta activos e inactivos', () => {
    const filas = filasProveedores([base, { ...base, estado: 'inactivo' }, base]);
    expect(resumenProveedores(filas)).toBe('3 proveedor(es) · 2 activo(s) · 1 inactivo(s)');
  });
});
