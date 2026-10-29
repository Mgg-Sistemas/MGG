import { describe, expect, it } from 'vitest';
import { moduloDeNotificacion, puedeVerNotificacion } from './notifPermisos';
import type { Notificacion } from '@/shared/lib/types';

describe('notifPermisos · Filtrado de notificaciones por permisos de módulo', () => {
  const notifRetencion: Notificacion = {
    id: 'n-1',
    destino: 'all',
    kind: 'success',
    title: 'Retención registrada · OC 100',
    message: 'Factura F-001 procesada',
    link: '#/app/retenciones',
    dedup_key: null,
    read: false,
    at: new Date().toISOString(),
  };

  const notifStock: Notificacion = {
    id: 'n-2',
    destino: 'admin',
    kind: 'warning',
    title: '⚠ Stock crítico',
    message: 'Tornillo 1/2: stock por debajo del mínimo',
    link: '#/app/inventario',
    dedup_key: 'restock:crit:p-123',
    read: false,
    at: new Date().toISOString(),
  };

  const notifPedido: Notificacion = {
    id: 'n-3',
    destino: 'all',
    kind: 'info',
    title: 'Nueva orden de compra',
    message: 'OC-2026-004 pendiente de aprobación',
    link: '#/app/pedidos',
    dedup_key: 'oc-2026-004',
    read: false,
    at: new Date().toISOString(),
  };

  const notifTesoreria: Notificacion = {
    id: 'n-4',
    destino: 'all',
    kind: 'success',
    title: 'Gasto registrado: $250.00',
    message: 'Pago de flete caja chica',
    link: '#/app/tesoreria',
    dedup_key: null,
    read: false,
    at: new Date().toISOString(),
  };

  describe('moduloDeNotificacion', () => {
    it('deduce módulo por link directo', () => {
      expect(moduloDeNotificacion({ link: '#/app/retenciones' })).toBe('retenciones');
      expect(moduloDeNotificacion({ link: '/app/retenciones/telefono' })).toBe('retenciones');
      expect(moduloDeNotificacion({ link: '#/app/pedidos?id=123' })).toBe('pedidos');
      expect(moduloDeNotificacion({ link: '#/app/inventario' })).toBe('inventario');
      expect(moduloDeNotificacion({ link: '#/app/tesoreria' })).toBe('tesoreria');
      expect(moduloDeNotificacion({ link: '#/app/salidas' })).toBe('salidas');
      expect(moduloDeNotificacion({ link: '#/app/usuarios' })).toBe('usuarios');
    });

    it('deduce módulo por dedup_key cuando link es nulo o #', () => {
      expect(moduloDeNotificacion({ link: '#', dedup_key: 'restock:warn:123' })).toBe('inventario');
      expect(moduloDeNotificacion({ link: null, dedup_key: 'maq-os-piezas-45' })).toBe('maquinaria');
      expect(moduloDeNotificacion({ link: null, dedup_key: 'retencion-fact-9' })).toBe('retenciones');
      expect(moduloDeNotificacion({ link: null, dedup_key: 'oc-555' })).toBe('pedidos');
    });

    it('deduce módulo por palabras clave en título/mensaje', () => {
      expect(moduloDeNotificacion({ link: null, title: 'Comprobante de retención de ISLR emitido' })).toBe('retenciones');
      expect(moduloDeNotificacion({ link: null, title: 'Reabastecimiento requerido en almacén' })).toBe('inventario');
      expect(moduloDeNotificacion({ link: null, title: 'Traslado de material autorizado' })).toBe('salidas');
    });
  });

  describe('puedeVerNotificacion', () => {
    it('usuario con permisos SOLO sobre retenciones recibe únicamente retenciones', () => {
      // Mock de función can que solo autoriza retenciones
      const canSoloRetenciones = (m: string) => m === 'retenciones';

      expect(puedeVerNotificacion(notifRetencion, canSoloRetenciones as any, false)).toBe(true);
      expect(puedeVerNotificacion(notifStock, canSoloRetenciones as any, false)).toBe(false);
      expect(puedeVerNotificacion(notifPedido, canSoloRetenciones as any, false)).toBe(false);
      expect(puedeVerNotificacion(notifTesoreria, canSoloRetenciones as any, false)).toBe(false);
    });

    it('usuario con permisos sobre tesorería recibe tesorería pero no retenciones ni stock', () => {
      const canSoloTesoreria = (m: string) => m === 'tesoreria';

      expect(puedeVerNotificacion(notifTesoreria, canSoloTesoreria as any, false)).toBe(true);
      expect(puedeVerNotificacion(notifRetencion, canSoloTesoreria as any, false)).toBe(false);
      expect(puedeVerNotificacion(notifStock, canSoloTesoreria as any, false)).toBe(false);
    });

    it('administrador recibe todas las notificaciones', () => {
      const canNada = () => false;

      expect(puedeVerNotificacion(notifRetencion, canNada as any, true)).toBe(true);
      expect(puedeVerNotificacion(notifStock, canNada as any, true)).toBe(true);
      expect(puedeVerNotificacion(notifPedido, canNada as any, true)).toBe(true);
      expect(puedeVerNotificacion(notifTesoreria, canNada as any, true)).toBe(true);
    });

    it('notificación con destino al rol o usuario directo es permitida', () => {
      const canNada = () => false;
      const notifPersonal: Notificacion = {
        ...notifStock,
        destino: 'user-777',
      };
      expect(puedeVerNotificacion(notifPersonal, canNada as any, false, 'otro_rol', 'user-777')).toBe(true);
    });
  });
});
