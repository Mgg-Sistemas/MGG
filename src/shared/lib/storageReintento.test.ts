import { describe, it, expect } from 'vitest';
import {
  ESPERAS_SUBIDA_MS,
  INTENTOS_SUBIDA,
  estadoHttp,
  esErrorTransitorio,
  esFallaDeRed,
  esYaSubido,
  mensajeSubidaFallida,
  subirConReintento,
} from './storageReintento';

/** El error EXACTO que arma storage-js ante un 520 de Cloudflare: el body llega
 *  en HTML, el JSON no se puede leer y queda el texto genérico del proxy. */
function error520(): Error {
  const e = new Error('HTTP 520 error');
  Object.assign(e, { status: 520, statusCode: '520' });
  return e;
}

/** Un error con explicación propia (permisos del bucket): no se toca. */
function errorPolitica(): Error {
  const e = new Error('new row violates row-level security policy for table "maquinaria_fotos"');
  Object.assign(e, { status: 403, statusCode: '403' });
  return e;
}

/** Un error que trae solo el texto, sin `status` (se recupera del mensaje). */
function error520SinEstado(): Error {
  return new Error('HTTP 503 error');
}

/** `subir` que falla n veces con `error` y después sube bien. */
function subirFallasVeces(veces: number, error: Error): { llamado: () => number; subir: () => Promise<void> } {
  let llamadas = 0;
  return {
    llamado: () => llamadas,
    subir: async () => { llamadas++; if (llamadas <= veces) throw error; },
  };
}

/** Espera que no duerme: solo anota cuánto se esperó. */
function esperaQueAnota() {
  const tiempos: number[] = [];
  return { tiempos, espera: async (ms: number) => { tiempos.push(ms); } };
}

describe('estadoHttp', () => {
  it('lee el estado del objeto o, si no lo trae, del texto «HTTP 5xx error»', () => {
    expect(estadoHttp(error520())).toBe(520);
    expect(estadoHttp(error520SinEstado())).toBe(503);
    expect(estadoHttp({ status: 409 })).toBe(409);
  });

  it('sin estado no inventa uno', () => {
    expect(estadoHttp(new Error('algo salió mal'))).toBeNull();
    expect(estadoHttp(null)).toBeNull();
  });
});

describe('esErrorTransitorio', () => {
  it('cuenta el 520 del Storage y los demás 5xx del proxy', () => {
    for (const s of [500, 502, 503, 504, 520, 521, 524]) {
      expect(esErrorTransitorio(new Error(`HTTP ${s} error`))).toBe(true);
    }
  });

  it('cuenta la caída de red a mitad de la subida', () => {
    expect(esErrorTransitorio(new Error('Failed to fetch'))).toBe(true);
    expect(esFallaDeRed(new Error('NetworkError when attempting to fetch resource.'))).toBe(true);
  });

  it('NO reintenta errores que son cosa nuestra (archivo, permisos, política)', () => {
    expect(esErrorTransitorio(errorPolitica())).toBe(false);
    expect(esErrorTransitorio(new Error('File size exceeds the maximum limit'))).toBe(false);
    expect(esErrorTransitorio(new Error('Object not found'))).toBe(false);
  });
});

describe('esYaSubido', () => {
  it('el «ya existe» de un reintento cuenta como subida, no como error', () => {
    expect(esYaSubido(new Error('The resource already exists'))).toBe(true);
    expect(esYaSubido(new Error('Duplicate'))).toBe(true);
    expect(esYaSubido(Object.assign(new Error('x'), { statusCode: '409' }))).toBe(true);
  });

  it('otro error no lo es', () => {
    expect(esYaSubido(error520())).toBe(false);
    expect(esYaSubido(errorPolitica())).toBe(false);
  });
});

describe('mensajeSubidaFallida', () => {
  it('traduce el «HTTP 520 error» a algo que se entiende, con el código y los intentos', () => {
    const m = mensajeSubidaFallida(error520(), 3);
    expect(m).toContain('Supabase no contestó (error 520)');
    expect(m).toContain('se intentó 3 veces');
    expect(m).toContain('Vuelve a intentarlo');
    expect(m).not.toContain('HTTP 520 error'); // el texto sin sentido no se arrastra
  });

  it('traduce igual un error de red', () => {
    expect(mensajeSubidaFallida(new Error('Failed to fetch'), 3)).toContain('Se perdió la conexión');
  });

  it('si el error trae explicación propia devuelve null: se manda tal cual', () => {
    expect(mensajeSubidaFallida(errorPolitica())).toBeNull();
  });
});

describe('subirConReintento', () => {
  it('si sube a la primera no espera nada', async () => {
    let llamadas = 0;
    const { tiempos, espera } = esperaQueAnota();
    await subirConReintento(async () => { llamadas++; }, { espera });
    expect(llamadas).toBe(1);
    expect(tiempos).toEqual([]);
  });

  it('ante un 520 reintenta con pausa y termina subiendo', async () => {
    const { llamado, subir } = subirFallasVeces(2, error520());
    const { tiempos, espera } = esperaQueAnota();
    await subirConReintento(subir, { espera });
    expect(llamado()).toBe(INTENTOS_SUBIDA);
    expect(tiempos).toEqual(ESPERAS_SUBIDA_MS); // 2 pausas para 3 intentos
  });

  it('un error que es cosa nuestra no se reintenta ni se traduce', async () => {
    let llamadas = 0;
    const original = errorPolitica();
    const { espera } = esperaQueAnota();
    const capturado = await subirConReintento(async () => { llamadas++; throw original; }, { espera }).catch((e) => e);
    expect(llamadas).toBe(1);
    expect(capturado).toBe(original); // el MISMO objeto, con su mensaje de Supabase
  });

  it('si se acaban los intentos lanza el mensaje claro del error del servidor', async () => {
    const { subir } = subirFallasVeces(9, error520());
    const { espera } = esperaQueAnota();
    const e = await subirConReintento(subir, { espera }).catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toContain('Supabase no contestó (error 520)');
    expect(e.message).toContain('se intentó 3 veces');
  });

  it('si el primer intento llegó y se perdió la respuesta, el «ya existe» cierra sin error', async () => {
    const dup = Object.assign(new Error('The resource already exists'), { statusCode: '409' });
    const { llamado, subir } = subirFallasVeces(1, dup);
    const { espera } = esperaQueAnota();
    await expect(subirConReintento(subir, { espera })).resolves.toBeUndefined();
    expect(llamado()).toBe(1); // no siguió insistiendo: el archivo ya estaba
  });

  it('respeta los intentos que se le pidan', async () => {
    const { llamado, subir } = subirFallasVeces(9, error520());
    const { espera } = esperaQueAnota();
    await subirConReintento(subir, { intentos: 5, espera }).catch(() => undefined);
    expect(llamado()).toBe(5);
  });
});
