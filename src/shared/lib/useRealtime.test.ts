import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = () => void;
interface FakeChannel { topic: string; handlers: Handler[]; status?: (s: string) => void; removed: boolean }
const creados: FakeChannel[] = [];
const fake = {
  channel(topic: string) {
    const ch: FakeChannel = { topic, handlers: [], removed: false };
    creados.push(ch);
    const api = {
      on(_t: string, _f: unknown, h: Handler) { ch.handlers.push(h); return api; },
      subscribe(cb: (s: string) => void) { ch.status = cb; return api; },
      __ch: ch,
    };
    return api;
  },
  removeChannel(api: { __ch: FakeChannel }) { api.__ch.removed = true; return Promise.resolve('ok'); },
};
vi.mock('./supabase', () => ({ isSupabaseConfigured: true, getSupabase: () => fake }));
vi.mock('./queryCache', () => ({ bustCache: () => undefined }));

const { escucharTabla, canalesRealtimeAbiertos } = await import('./useRealtime');

describe('useRealtime · canales compartidos', () => {
  beforeEach(() => { vi.useFakeTimers(); creados.length = 0; });
  afterEach(() => { vi.runAllTimers(); vi.useRealTimers(); });

  it('dos pantallas en la misma tabla comparten UN canal y ambas reciben el evento', () => {
    const a = vi.fn(); const b = vi.fn();
    const sa = escucharTabla('ordenes', a);
    const sb = escucharTabla('ordenes', b);
    expect(creados.length).toBe(1);
    creados[0].handlers[0]();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    sa(); sb();
  });

  it('el canal se cierra 30 s después de que nadie lo escucha, y se reutiliza si vuelven antes', () => {
    const s1 = escucharTabla('productos', vi.fn());
    s1();
    vi.advanceTimersByTime(10_000);
    const s2 = escucharTabla('productos', vi.fn());   // volvió al módulo antes de 30 s
    expect(creados.length).toBe(1);
    expect(creados[0].removed).toBe(false);
    s2();
    vi.advanceTimersByTime(30_000);
    expect(creados[0].removed).toBe(true);
    expect(canalesRealtimeAbiertos()).not.toContain('productos');
    escucharTabla('productos', vi.fn())();
    expect(creados.length).toBe(2);                    // canal nuevo tras cerrarse
  });

  it('al reconectar (segundo SUBSCRIBED) avisa a las pantallas para ponerse al día', () => {
    const a = vi.fn();
    const s = escucharTabla('existencias', a);
    creados[0].status!('SUBSCRIBED');
    expect(a).not.toHaveBeenCalled();
    creados[0].status!('CHANNEL_ERROR');
    creados[0].status!('SUBSCRIBED');
    expect(a).toHaveBeenCalledTimes(1);
    s();
  });
});
