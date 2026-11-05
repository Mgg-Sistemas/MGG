import { describe, it, expect } from 'vitest';
import {
  normalizarStockMatanzas,
  normalizarMovimientoMatanzas,
  normalizarCasiteritaMatanzas,
  filtrarFilasMatanzas,
  agruparFilasMatanzas,
  calcularResumenMatanzas,
  obtenerMetricasFichaMatanzas,
  formatearCeldaMatanzas,
  calcularClasificacionAbc,
  calcularEstadoStock,
} from './reporteInventarioMatanzasDinamico';
import type { Producto, Existencia, Movimiento } from '@/shared/lib/types';
import type { CasiteritaDetalle } from './casiteritaDetalle.repository';

describe('reporteInventarioMatanzasDinamico', () => {
  const mockProducto: Producto = {
    id: 'prod-1',
    sku: 'REP-001',
    nombre: 'Rodamiento 6205',
    categoria: 'REPUESTOS',
    unidad: 'UND',
    stock: 10,
    stock_min: 5,
    precio: 25.5,
    almacen: 'Taller Matanzas',
    estado: 'activo',
    created_at: '2026-01-01T00:00:00Z',
  };

  const mockExistencia: Existencia = {
    producto_id: 'prod-1',
    almacen: 'Taller Matanzas',
    stock: 8,
    costo_promedio: 26.0,
    updated_at: '2026-02-01T00:00:00Z',
  };

  describe('Cálculos de estado y ABC', () => {
    it('clasifica ABC de acuerdo con la política MGG (A >= 120%, B >= 100%, C < 100%)', () => {
      expect(calcularClasificacionAbc(12, 10)).toBe('A');
      expect(calcularClasificacionAbc(10, 10)).toBe('B');
      expect(calcularClasificacionAbc(7, 10)).toBe('C');
      expect(calcularClasificacionAbc(5, 0)).toBe('C');
    });

    it('determina el estado de stock correctamente', () => {
      expect(calcularEstadoStock(0, 5, 20)).toBe('Sin Stock');
      expect(calcularEstadoStock(10, 5, 0)).toBe('Sin Costo ($0)');
      expect(calcularEstadoStock(4, 5, 20)).toBe('Bajo Mínimo');
      expect(calcularEstadoStock(10, 5, 20)).toBe('Normal');
    });
  });

  describe('Normalización de datos', () => {
    it('normaliza existencias de stock de Matanzas calculando valuación USD y Bs con tasa BCV', () => {
      const fila = normalizarStockMatanzas(mockProducto, mockExistencia, 'Taller Matanzas', 40.0);
      expect(fila.sku).toBe('REP-001');
      expect(fila.almacen).toBe('Taller Matanzas');
      expect(fila.stock).toBe(8);
      expect(fila.costo_usd).toBe(26.0);
      expect(fila.valor_usd).toBe(208.0); // 8 * 26.0
      expect(fila.costo_bs).toBe(1040.0); // 26.0 * 40
      expect(fila.valor_bs).toBe(8320.0); // 208 * 40
      expect(fila.clasificacion_abc).toBe('A'); // 8 / 5 = 160% >= 120%
      expect(fila.estado_stock).toBe('Normal');
    });

    it('normaliza movimientos de kárdex de Matanzas', () => {
      const mockMov: Movimiento = {
        id: 'mov-1',
        producto_id: 'prod-1',
        tipo: 'salida',
        delta: -3,
        stock_antes: 10,
        stock_despues: 7,
        actor: 'user-1',
        actor_name: 'Juan Pérez',
        almacen: 'Taller Matanzas',
        destino: 'Horno 1',
        detalle: 'Mantenimiento preventivo',
        ref_tipo: 'salida_solicitud',
        ref_codigo: 'SOL-099',
        precio_unitario: 26.0,
        at: '2026-03-01T10:30:00Z',
        created_at: '2026-03-01T10:30:00Z',
      };

      const prodMap = new Map<string, Producto>([['prod-1', mockProducto]]);
      const fila = normalizarMovimientoMatanzas(mockMov, prodMap, 40.0);

      expect(fila.id).toBe('mov_mov-1');
      expect(fila.tipo).toBe('SALIDA');
      expect(fila.cantidad).toBe(3);
      expect(fila.costo_unitario).toBe(26.0);
      expect(fila.costo_total).toBe(78.0);
      expect(fila.actor).toBe('Juan Pérez');
      expect(fila.destino).toBe('Horno 1');
      expect(fila.motivo).toBe('Mantenimiento preventivo');
    });

    it('normaliza lotes de casiterita SnO₂ en patio', () => {
      const mockCas: CasiteritaDetalle = {
        id: 'cas-1',
        grupo_id: 'g-1',
        cierre_id: 'c-1',
        procedencia: 'La Esperanza',
        precinto: 'PREC-987',
        n_analisis: 'AN-55',
        categoria: 'bigbag',
        cant: 1,
        peso_neto_kgs: 1000,
        peso_casiterita_kgs: 980,
        prom_sn: 70.0, // 70% estaño
        peso_puro_sn: 686, // 980 * 0.70
        tasa: 22.5,
        almacen: 'ALMACEN CASITERITA',
        nota: 'Lote de prueba',
        actor: 'u-1',
        actor_name: 'Carlos Inspector',
        stock_kg: 980,
        created_at: '2026-03-05T08:00:00Z',
        updated_at: null,
      };

      const fila = normalizarCasiteritaMatanzas(mockCas, 40.0);
      expect(fila.precinto_lote).toBe('PREC-987');
      expect(fila.procedencia).toBe('LA ESPERANZA');
      expect(fila.peso_seco).toBe(980);
      expect(fila.peso_puro_sn).toBe(686);
      expect(fila.ley_sn_pct).toBe(70.0);
      expect(fila.valor_usd).toBe(22050.0); // 980 * 22.5
    });
  });

  describe('Filtros Dinámicos por checks ("Sin Discusión")', () => {
    const fila1 = normalizarStockMatanzas(mockProducto, mockExistencia, 'Taller Matanzas', 40.0);
    const fila2 = normalizarStockMatanzas(
      { ...mockProducto, id: 'prod-2', sku: 'INS-001', categoria: 'INSUMOS', almacen: 'Insumos Matanzas' },
      null,
      'Insumos Matanzas',
      40.0,
    );
    const fila3 = normalizarStockMatanzas(
      { ...mockProducto, id: 'prod-3', sku: 'MIN-001', categoria: 'MINERAL', almacen: 'Casiterita Matanzas' },
      null,
      'Casiterita Matanzas',
      40.0,
    );

    it('excluye filas cuyos subalmacenes no están marcados en los checks', () => {
      const res = filtrarFilasMatanzas([fila1, fila2, fila3], {
        subalmacenes: ['Taller Matanzas'],
        categorias: [],
      });
      expect(res).toHaveLength(1);
      expect(res[0].almacen).toBe('Taller Matanzas');
    });

    it('retorna vacío si la lista de subalmacenes está desmarcada por completo', () => {
      const res = filtrarFilasMatanzas([fila1, fila2, fila3], {
        subalmacenes: [],
        categorias: [],
      });
      expect(res).toHaveLength(0);
    });

    it('filtra por categorías marcadas en checks', () => {
      const res = filtrarFilasMatanzas([fila1, fila2, fila3], {
        subalmacenes: ['Taller Matanzas', 'Insumos Matanzas', 'Casiterita Matanzas'],
        categorias: ['INSUMOS'],
      });
      expect(res).toHaveLength(1);
      expect(res[0].categoria).toBe('INSUMOS');
    });

    it('busca texto libre en SKU, descripción, o subalmacén', () => {
      const res = filtrarFilasMatanzas([fila1, fila2, fila3], {
        subalmacenes: ['Taller Matanzas', 'Insumos Matanzas', 'Casiterita Matanzas'],
        categorias: [],
        texto: 'ins-001',
      });
      expect(res).toHaveLength(1);
      expect(res[0].sku).toBe('INS-001');
    });
  });

  describe('Agrupaciones', () => {
    const fila1 = normalizarStockMatanzas(mockProducto, mockExistencia, 'Taller Matanzas', 40.0);
    const fila2 = normalizarStockMatanzas(
      { ...mockProducto, id: 'prod-2', sku: 'INS-001', categoria: 'INSUMOS', almacen: 'Taller Matanzas' },
      null,
      'Taller Matanzas',
      40.0,
    );
    const fila3 = normalizarStockMatanzas(
      { ...mockProducto, id: 'prod-3', sku: 'MIN-001', categoria: 'MINERAL', almacen: 'Casiterita Matanzas' },
      null,
      'Casiterita Matanzas',
      40.0,
    );

    it('agrupa por subalmacén calculando subtotales por grupo', () => {
      const grupos = agruparFilasMatanzas([fila1, fila2, fila3], 'subalmacen');
      expect(grupos.length).toBe(2);
      const taller = grupos.find((g) => g.claveGrupo === 'Taller Matanzas');
      expect(taller).toBeDefined();
      expect(taller?.totalFilas).toBe(2);
    });
  });

  describe('Tarjetas KPI Dinámicas ("Sin Discusión")', () => {
    const fila1 = normalizarStockMatanzas(mockProducto, mockExistencia, 'Taller Matanzas', 40.0);
    const resumen = calcularResumenMatanzas([fila1], 40.0);

    it('muestra las tarjetas financieras activas si las columnas de valor están marcadas', () => {
      const metricas = obtenerMetricasFichaMatanzas(
        resumen,
        'stock',
        ['stock', 'costo_usd', 'valor_usd', 'minimo', 'estado_stock'],
        ['Taller Matanzas'],
      );
      const cardValor = metricas.find((m) => m.clave === 'valor_total');
      expect(cardValor).toBeDefined();
      expect(cardValor?.valor).toContain('$ 208,00');
      expect(cardValor?.sub).toContain('Equiv. Bs 8.320,00');
    });

    it('reemplaza el valor financiero por "—" y nota sutil si las columnas de valor NO están marcadas', () => {
      const metricas = obtenerMetricasFichaMatanzas(
        resumen,
        'stock',
        ['stock', 'sku', 'nombre'], // Sin costo ni valor
        ['Taller Matanzas'],
      );
      const cardValor = metricas.find((m) => m.clave === 'valor_total');
      expect(cardValor).toBeDefined();
      expect(cardValor?.valor).toBe('—');
      expect(cardValor?.sub).toBe('(No marcado en checks de columnas)');
      expect(cardValor?.colorCss).toBe('var(--muted)');
    });

    it('reemplaza alertas de stock por "—" si las columnas de mínimo no están marcadas', () => {
      const metricas = obtenerMetricasFichaMatanzas(
        resumen,
        'stock',
        ['stock', 'sku', 'nombre'],
        ['Taller Matanzas'],
      );
      const cardAlerta = metricas.find((m) => m.clave === 'criticos_alerta');
      expect(cardAlerta?.valor).toBe('—');
      expect(cardAlerta?.sub).toBe('(No marcado en checks de columnas)');
    });

    it('indica sutilmente que no hay subalmacenes marcados si la lista está vacía', () => {
      const metricas = obtenerMetricasFichaMatanzas(
        resumen,
        'stock',
        ['stock', 'valor_usd'],
        [], // Vacío
      );
      expect(metricas[0].sub).toBe('(Ningún subalmacén seleccionado)');
      expect(metricas[1].sub).toBe('(Marcá al menos un subalmacén en los checks)');
    });
  });

  describe('Formateo de celdas sutil', () => {
    it('muestra "— (sin registrar)" en campos de auditoría vacíos', () => {
      expect(formatearCeldaMatanzas('', 'texto', 'motivo')).toBe('— (sin registrar)');
      expect(formatearCeldaMatanzas(null, 'texto', 'actor')).toBe('— (sin registrar)');
      expect(formatearCeldaMatanzas(undefined, 'texto', 'ref_codigo')).toBe('— (sin registrar)');
    });

    it('muestra "—" en otros campos vacíos', () => {
      expect(formatearCeldaMatanzas('', 'texto', 'ubicacion')).toBe('—');
      expect(formatearCeldaMatanzas(null, 'numero', 'minimo')).toBe('—');
    });

    it('formatea monedas y pesos con es-VE correctamente', () => {
      expect(formatearCeldaMatanzas(1250.5, 'moneda', 'valor_usd')).toBe('$ 1.250,50');
      expect(formatearCeldaMatanzas(50000.25, 'moneda_bs', 'valor_bs')).toBe('Bs 50.000,25');
      expect(formatearCeldaMatanzas(980.5, 'peso_kg', 'peso_seco')).toBe('980,50 kg');
    });
  });
});

