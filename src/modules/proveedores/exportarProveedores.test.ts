import { describe, expect, it } from 'vitest';
import type { Proveedor } from '@/shared/lib/types';
import {
  CAMPOS_BASICOS,
  CAMPOS_EXPORT_PROVEEDORES,
  CAMPOS_POR_DEFECTO,
  camposElegidosProveedores,
  tablaExportProveedores,
} from './exportarProveedores';

const base: Proveedor = {
  id: '1',
  rif: 'J-12345678-9',
  razon_social: 'MINERA GUAYANA S.A.',
  contacto: 'Carlos Méndez',
  telefono: '0414-0001122',
  numero_administracion: '0412-3334455',
  email: 'contacto@mineraguayana.com',
  direccion: 'Zona Industrial Matanzas',
  actividad_economica: '0710',
  actividad_economica_texto: 'Extracción de minerales',
  categorias: ['Maquinaria', 'Repuestos'],
  origen: 'nacional',
  estado: 'activo',
  created_at: '2026-01-01',
};

const actividades = [
  { codigo: '0710', descripcion: 'Extracción de minerales de hierro', seccion: 'B' } as never,
];

describe('exportarProveedores · campos y tabla', () => {
  it('camposElegidosProveedores filtra preservando el orden de definición', () => {
    const elegidos = camposElegidosProveedores(['estado', 'rif']);
    expect(elegidos.map((c) => c.key)).toEqual(['rif', 'estado']);
  });

  it('campos por defecto contiene las columnas principales', () => {
    expect(CAMPOS_POR_DEFECTO).toContain('rif');
    expect(CAMPOS_POR_DEFECTO).toContain('razon_social');
    expect(CAMPOS_POR_DEFECTO).toContain('contacto');
    expect(CAMPOS_POR_DEFECTO).toContain('estado');
  });

  it('campos básicos contiene sólo RIF y razón social', () => {
    expect(CAMPOS_BASICOS).toEqual(['rif', 'razon_social']);
  });

  it('tablaExportProveedores genera encabezado con N° y filas numeradas', () => {
    const res = tablaExportProveedores([base], ['rif', 'razon_social', 'telefono'], actividades);
    expect(res.head).toEqual(['N°', 'RIF', 'Razón social', 'Teléfono']);
    expect(res.filas).toEqual([
      ['1', 'J-12345678-9', 'MINERA GUAYANA S.A.', '0414-0001122'],
    ]);
  });

  it('resuelve actividad económica legible con el código CIIU', () => {
    const res = tablaExportProveedores([base], ['actividad_economica', 'actividad_economica_texto'], actividades);
    expect(res.filas[0][1]).toBe('0710 · Extracción de minerales de hierro');
    expect(res.filas[0][2]).toBe('Extracción de minerales');
  });

  it('maneja valores vacíos sin nulls ni undefined', () => {
    const vacio: Proveedor = {
      ...base,
      contacto: null,
      telefono: undefined,
      numero_administracion: null,
      email: null,
      direccion: null,
      actividad_economica: null,
      actividad_economica_texto: null,
      categorias: [],
      origen: 'internacional',
      estado: 'inactivo',
    };
    const res = tablaExportProveedores([vacio], CAMPOS_EXPORT_PROVEEDORES.map((c) => c.key));
    res.filas[0].forEach((celda) => {
      expect(celda).toBeTypeOf('string');
      expect(celda).not.toContain('null');
      expect(celda).not.toContain('undefined');
    });
  });
});
