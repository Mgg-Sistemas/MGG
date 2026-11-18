import { describe, it, expect } from 'vitest';
import {
  analistaDeOrden,
  nombreSedeAlmacen,
  armarFilasRecepcionesPendientes,
  filtrarRecepcionesPendientes,
  calcularTotalesRecepciones,
  textoReporteRecepcionesWhatsapp,
  type FilaRecepcionPendiente,
} from './reporteRecepcionesPendientes';
import type { Orden, Almacen } from '@/shared/lib/types';
import type { CompraDirecta } from '@/modules/pedidos/compras.repository';

describe('reporteRecepcionesPendientes', () => {
  const almacenesMock: Almacen[] = [
    { id: 'alm-1', nombre: 'Almacén Principal Matanzas', sede: 'MATANZAS' } as Almacen,
    { id: 'alm-2', nombre: 'Subalmacén Mina', sede: 'MINA' } as Almacen,
  ];

  describe('analistaDeOrden', () => {
    it('resuelve analistas conocidos por su correo', () => {
      expect(analistaDeOrden({ oc_creada_por: 'javier.leiva@mineralgroupguayana.com' })).toBe('JAVIER LEIVA');
      expect(analistaDeOrden({ oc_emitida_por: 'kelvin.pena@mineralgroupguayana.com' })).toBe('KELVIN PENA');
    });

    it('deriva nombre amigable si el correo no está en el catálogo', () => {
      expect(analistaDeOrden({ solicitante_email: 'roberto.gomez@mineralgroupguayana.com' })).toBe('ROBERTO GOMEZ');
    });

    it('devuelve solicitante si no tiene @ y no hay correo', () => {
      expect(analistaDeOrden({ solicitante: 'Carlos Mecánico' })).toBe('Carlos Mecánico');
    });
  });

  describe('nombreSedeAlmacen', () => {
    it('devuelve la sede del almacén correspondiente', () => {
      expect(nombreSedeAlmacen('Almacén Principal Matanzas', almacenesMock)).toBe('MATANZAS');
      expect(nombreSedeAlmacen('alm-2', almacenesMock)).toBe('MINA');
      expect(nombreSedeAlmacen(null, almacenesMock)).toBe('Sin asignar');
    });
  });

  describe('armarFilasRecepcionesPendientes', () => {
    it('normaliza órdenes y compras directas con analista y fechas de montaje y pago', () => {
      const mockOrdenes: Orden[] = [
        {
          id: 'ord-1',
          oc_codigo: 'OC-2026-0254',
          created_at: '2026-11-10T14:30:00Z',
          pagada_en: '2026-11-12T10:00:00Z',
          pagada_por: 'tesoreria@mgg.com',
          oc_creada_por: 'javier.leiva@mineralgroupguayana.com',
          almacen_destino: 'Almacén Principal Matanzas',
          estado: 'pagada',
          total: 76.56,
          moneda: 'USD',
          items: [{ sku: 'SKU-1', nombre: 'Filtro de Aceite', cantidad: 1, precio: 76.56 }],
        } as unknown as Orden,
      ];

      const mockCompras: CompraDirecta[] = [
        {
          id: 'cd-1',
          codigo: 'CD-2026-0010',
          created_at: '2026-11-14T09:00:00Z',
          pagada_at: '2026-11-14T11:00:00Z',
          pagada_por: 'Nazaret Salazar',
          actor: 'nazaret.salazar@mineralgroupguayana.com',
          almacen: 'alm-2',
          gasto: 150,
          moneda: 'USD',
          producto_nombre: 'Electrodos 7018',
          items: [{ producto_nombre: 'Electrodos 7018', cantidad: 5, unidad: 'kg' }],
        } as unknown as CompraDirecta,
      ];

      const filas = armarFilasRecepcionesPendientes(mockOrdenes, mockCompras, almacenesMock);

      expect(filas).toHaveLength(2);

      const filaOc = filas[0];
      expect(filaOc.tipo).toBe('oc');
      expect(filaOc.codigo).toBe('OC-2026-0254');
      expect(filaOc.analista).toBe('JAVIER LEIVA');
      expect(filaOc.almacenSugerido).toBe('MATANZAS');
      expect(filaOc.fechaMontadaTxt).toBeDefined();
      expect(filaOc.fechaPagoTxt).toBeDefined();
      expect(filaOc.monto).toBe(76.56);

      const filaCd = filas[1];
      expect(filaCd.tipo).toBe('directo');
      expect(filaCd.codigo).toBe('CD-2026-0010');
      expect(filaCd.analista).toBe('NAZARET SALAZAR');
      expect(filaCd.almacenSugerido).toBe('MINA');
      expect(filaCd.unidades).toBe(5);
    });
  });

  describe('filtrarRecepcionesPendientes & calcularTotalesRecepciones', () => {
    const filasBase: FilaRecepcionPendiente[] = [
      {
        id: '1',
        tipo: 'oc',
        tipoEtiqueta: 'Orden de Compra',
        codigo: 'OC-2026-0254',
        fechaMontada: '2026-11-10T14:30:00Z',
        fechaMontadaTxt: '10 nov. 2026',
        fechaPago: '2026-11-12T10:00:00Z',
        fechaPagoTxt: '12 nov. 2026',
        pagadaPor: 'Tesoreria',
        analista: 'Javier Leiva',
        proveedor: 'AutoRepuestos CA',
        almacenSugerido: 'MATANZAS',
        itemsCount: 1,
        unidades: 2,
        monto: 100,
        moneda: 'USD',
        estado: 'pagada',
        itemsDetalle: [{ nombre: 'Filtro', cantidad: 2 }],
      },
      {
        id: '2',
        tipo: 'directo',
        tipoEtiqueta: 'Compra Directa',
        codigo: 'CD-2026-0005',
        fechaMontada: '2026-11-15T09:00:00Z',
        fechaMontadaTxt: '15 nov. 2026',
        fechaPago: '2026-11-15T11:00:00Z',
        fechaPagoTxt: '15 nov. 2026',
        pagadaPor: 'Tesoreria',
        analista: 'Kelvin Peña',
        proveedor: 'Ferretería Mina',
        almacenSugerido: 'MINA',
        itemsCount: 2,
        unidades: 10,
        monto: 2500,
        moneda: 'VES',
        estado: 'pagada',
        itemsDetalle: [{ nombre: 'Tornillos', cantidad: 10 }],
      },
    ];

    it('filtra por texto (código o analista)', () => {
      const r1 = filtrarRecepcionesPendientes(filasBase, { texto: 'Javier' });
      expect(r1).toHaveLength(1);
      expect(r1[0].codigo).toBe('OC-2026-0254');

      const r2 = filtrarRecepcionesPendientes(filasBase, { texto: 'CD-2026' });
      expect(r2).toHaveLength(1);
      expect(r2[0].codigo).toBe('CD-2026-0005');
    });

    it('filtra por tipo (oc o directo)', () => {
      expect(filtrarRecepcionesPendientes(filasBase, { tipo: 'oc' })).toHaveLength(1);
      expect(filtrarRecepcionesPendientes(filasBase, { tipo: 'directo' })).toHaveLength(1);
    });

    it('filtra por sede', () => {
      const r = filtrarRecepcionesPendientes(filasBase, { sede: 'MINA' });
      expect(r).toHaveLength(1);
      expect(r[0].codigo).toBe('CD-2026-0005');
    });

    it('calcula totales correctamente', () => {
      const totales = calcularTotalesRecepciones(filasBase);
      expect(totales.totalRegistros).toBe(2);
      expect(totales.totalOc).toBe(1);
      expect(totales.totalDirectos).toBe(1);
      expect(totales.totalUnidades).toBe(12);
      expect(totales.totalUsd).toBe(100);
      expect(totales.totalBs).toBe(2500);
      expect(totales.sedes).toEqual(['MATANZAS', 'MINA']);
      expect(totales.analistas).toEqual(['Javier Leiva', 'Kelvin Peña']);
    });
  });

  describe('textoReporteRecepcionesWhatsapp', () => {
    it('genera un mensaje de WhatsApp formateado con analista, montada y pago', () => {
      const filas: FilaRecepcionPendiente[] = [
        {
          id: '1',
          tipo: 'oc',
          tipoEtiqueta: 'Orden de Compra',
          codigo: 'OC-2026-0254',
          fechaMontada: '2026-11-10T14:30:00Z',
          fechaMontadaTxt: '10 nov. 2026',
          fechaPago: '2026-11-12T10:00:00Z',
          fechaPagoTxt: '12 nov. 2026',
          pagadaPor: 'Tesoreria',
          analista: 'Javier Leiva',
          proveedor: 'AutoRepuestos CA',
          almacenSugerido: 'MATANZAS',
          itemsCount: 1,
          unidades: 2,
          monto: 76.56,
          moneda: 'USD',
          estado: 'pagada',
          itemsDetalle: [{ nombre: 'Filtro', cantidad: 2 }],
        },
      ];

      const mensaje = textoReporteRecepcionesWhatsapp(filas, {}, 'Almacén');
      expect(mensaje).toContain('REPORTE DE PENDIENTES POR RECEPCIONAR');
      expect(mensaje).toContain('OC-2026-0254');
      expect(mensaje).toContain('Javier Leiva');
      expect(mensaje).toContain('*Montada:* 10 nov. 2026');
      expect(mensaje).toContain('*Pagó Tesorería:* 12 nov. 2026');
      expect(mensaje).toContain('MATANZAS');
    });
  });
});
