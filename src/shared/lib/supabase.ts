import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mensajeErrorFuncion } from './funcionesError';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase no configurado. Copia .env.example a .env.local y define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.'
    );
  }
  if (!client) client = createClient(url, anonKey);
  return client;
}

/**
 * `functions.invoke` con el motivo real del error: supabase-js solo dice «Edge Function
 * returned a non-2xx status code» y el motivo queda en el cuerpo de la respuesta. Se
 * reescribe `error.message` (mismo objeto, así `instanceof` sigue valiendo) para que
 * TODAS las pantallas muestren el motivo en español sin tocar cada llamada.
 */
function functionsDe(c: SupabaseClient): SupabaseClient['functions'] {
  // supabase-js arma un FunctionsClient nuevo en cada acceso: no se guarda en caché.
  const base = c.functions;
  const invoke: SupabaseClient['functions']['invoke'] = async (...args) => {
    const r = await base.invoke(...args);
    if (r.error) {
      try { r.error.message = await mensajeErrorFuncion(r.error); } catch { /* queda el original */ }
    }
    return r;
  };
  return new Proxy(base, {
    get(t, p) {
      if (p === 'invoke') return invoke;
      const v = Reflect.get(t, p);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const c = getSupabase();
    if (prop === 'functions') return functionsDe(c);
    const value = Reflect.get(c, prop);
    return typeof value === 'function' ? value.bind(c) : value;
  },
});
