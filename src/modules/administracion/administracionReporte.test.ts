import { describe, expect, it } from 'vitest';
import { armarReporteAdmin } from './administracionReporte';
import type { Empresa, Movimiento, OpcionRef } from './admin.repository';

const empresas: Empresa[] = [
  { id: '1', clave: 'GT', nombre: 'Golden Touch 1127, C.A.', rif: null, moneda: 'USD', logoPath: null, activa: true, orden: 1 },
  { id: '2', clave: 'DEMO1', nombre: 'Demo Norte', rif: null, moneda: 'Bs', logoPath: null, activa: true, orden: 2 },
];
const categorias: OpcionRef[] = [{ id: 'cat-serv', nombre: 'Servicios' }, { id: 'cat-alq', nombre: 'Alquiler' }];
const mov = (p: Partial<Movimiento>): Movimiento => ({
  id: `m${Math.random()}`, empresaClave: 'GT', gastoFijoId: null, concepto: 'Agua', proveedorNombre: null,
  categoriaGastoId: 'cat-serv', periodo: '2026-10', fecha: '2026-10-05', monto: 100, moneda: 'USD', tasaRef: null,
  estadoPago: 'pagado', origen: 'importado', servicioDirectoId: null, ...p,
});

describe('armarReporteAdmin', () => {
  const movs = [
    mov({ empresaClave: 'GT', categoriaGastoId: 'cat-serv', moneda: 'Bs', monto: 1800, proveedorNombre: 'Hidro' }),
    mov({ empresaClave: 'GT', categoriaGastoId: 'cat-alq', moneda: 'USD', monto: 800, proveedorNombre: null }),
    mov({ empresaClave: 'DEMO1', categoriaGastoId: 'cat-serv', moneda: 'USD', monto: 95, proveedorNombre: 'Hidro' }),
  ];

  it('resuelve empresa/categoría/proveedor y totaliza', () => {
    const d = armarReporteAdmin(movs, empresas, categorias, { empresaNombre: null, alcanceLabel: 'Octubre 2026', tasa: 40, agruparPor: 'categoria' });
    expect(d.total.n).toBe(3);
    expect(d.total.usd).toBe(895);
    expect(d.total.bs).toBe(1800);
    expect(d.filas[0].empresa).toBe('Golden Touch 1127, C.A.');
    expect(d.filas[0].categoria).toBe('Servicios');
    expect(d.filas[0].proveedor).toBe('Hidro');
    expect(d.meta.alcanceLabel).toBe('Octubre 2026');
  });

  it('agrupa por la dimensión elegida', () => {
    expect(armarReporteAdmin(movs, empresas, categorias, { empresaNombre: null, alcanceLabel: 'x', tasa: 40, agruparPor: 'categoria' }).grupos.map((g) => g.clave).sort()).toEqual(['Alquiler', 'Servicios']);
    expect(armarReporteAdmin(movs, empresas, categorias, { empresaNombre: null, alcanceLabel: 'x', tasa: 40, agruparPor: 'empresa' }).grupos.map((g) => g.clave).sort()).toEqual(['Demo Norte', 'Golden Touch 1127, C.A.']);
    expect(armarReporteAdmin(movs, empresas, categorias, { empresaNombre: null, alcanceLabel: 'x', tasa: 40, agruparPor: 'moneda' }).grupos.map((g) => g.clave).sort()).toEqual(['Bs', 'USD']);
    const porProv = armarReporteAdmin(movs, empresas, categorias, { empresaNombre: null, alcanceLabel: 'x', tasa: 40, agruparPor: 'proveedor' });
    expect(porProv.agruparPor).toBe('proveedor');
    expect(porProv.grupos.map((g) => g.clave).sort()).toEqual(['Hidro', 'Sin proveedor']);
  });

  it('la categoría faltante cae en «Sin categoría»', () => {
    const d = armarReporteAdmin([mov({ categoriaGastoId: null })], empresas, categorias, { empresaNombre: 'Golden Touch 1127, C.A.', alcanceLabel: 'Todo el histórico', tasa: 40, agruparPor: 'categoria' });
    expect(d.filas[0].categoria).toBe('Sin categoría');
    expect(d.grupos[0].clave).toBe('Sin categoría');
  });
});
