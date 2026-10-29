import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  getSonidoRetencionesHabilitado,
  setSonidoRetencionesHabilitado,
  playSonidoFacturaLlegada,
  playSonidoFacturaEstatus,
} from './notificacionesRetencion';

// Mock de localStorage en entorno de Node
const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  removeItem: (key: string) => { delete store[key]; },
};

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockLocalStorage,
    writable: true,
  });
}

describe('notificaciones de retención y sonido distintivo', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('el sonido está habilitado por defecto y se puede alternar', () => {
    expect(getSonidoRetencionesHabilitado()).toBe(true);

    setSonidoRetencionesHabilitado(false);
    expect(getSonidoRetencionesHabilitado()).toBe(false);

    setSonidoRetencionesHabilitado(true);
    expect(getSonidoRetencionesHabilitado()).toBe(true);
  });

  it('no arroja error al invocar playSonidoFacturaLlegada o playSonidoFacturaEstatus', () => {
    expect(() => playSonidoFacturaLlegada()).not.toThrow();
    expect(() => playSonidoFacturaEstatus()).not.toThrow();
  });
});
