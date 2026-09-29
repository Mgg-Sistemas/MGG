import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  EMOJI_MOVIMIENTO, TITULO_MOVIMIENTO, mensajeMovimiento, enlaceWhatsapp, fechaHoraTexto,
  compartirMovimiento, puedeCompartir,
  type MovimientoParaMensaje,
} from './mensajeMovimiento';

/** Un surtido completo al que cada prueba le cambia lo suyo. */
function mov(over: Partial<MovimientoParaMensaje> = {}): MovimientoParaMensaje {
  return {
    tipo: 'consumo',
    litros: 120,
    // 14:30 UTC = 10:30 AM en Venezuela.
    fecha: '2026-09-28T14:30:00Z',
    equipo: 'CAMION 350',
    autorizado_por: 'LEYDIS RENGEL',
    destino: 'MINA LOS PINOS',
    ...over,
  };
}

describe('el emoji dice de un vistazo qué pasó', () => {
  it('lo que sale va con flecha hacia abajo', () => {
    expect(EMOJI_MOVIMIENTO.consumo).toBe('🔽');
  });

  it('lo que entra va con flecha hacia arriba', () => {
    expect(EMOJI_MOVIMIENTO.ingreso).toBe('🔼');
  });

  it('cada tipo tiene su emoji y su título, sin quedar ninguno afuera', () => {
    for (const t of ['consumo', 'ingreso', 'retorno', 'merma', 'traslado'] as const) {
      expect(EMOJI_MOVIMIENTO[t]).toBeTruthy();
      expect(TITULO_MOVIMIENTO[t]).toBeTruthy();
    }
  });
});

describe('el mensaje del movimiento', () => {
  it('abre con el emoji y el título en negrita', () => {
    expect(mensajeMovimiento(mov())).toMatch(/^🔽 \*SURTIDO\*/);
  });

  it('trae litros, equipo, autorizado, destino y fecha con hora', () => {
    const t = mensajeMovimiento(mov(), { tanque: 'TANQUE 1' });
    expect(t).toContain('Litros: *120 L*');
    expect(t).toContain('Equipo: CAMION 350');
    expect(t).toContain('Autorizado por: LEYDIS RENGEL');
    expect(t).toContain('Destino: MINA LOS PINOS');
    expect(t).toContain('Tanque: TANQUE 1');
    expect(t).toContain('28/09/2026');
  });

  it('la hora sale en la de Venezuela, no en la del teléfono', () => {
    // 14:30 UTC son las 10:30 AM acá: si el mensaje mostrara la hora local de
    // cada quien, dos personas leerían horas distintas del mismo surtido.
    expect(mensajeMovimiento(mov())).toContain('10:30');
  });

  it('los miles se separan como se leen acá', () => {
    expect(mensajeMovimiento(mov({ litros: 1250.5 }))).toContain('1.250,5 L');
  });

  it('no escribe los renglones que no tienen dato', () => {
    const t = mensajeMovimiento(mov({ equipo: null, destino: '  ', autorizado_por: '' }));
    expect(t).not.toContain('Equipo');
    expect(t).not.toContain('Destino');
    expect(t).not.toContain('Autorizado');
    // Pero los litros y la fecha van siempre: son el movimiento.
    expect(t).toContain('Litros');
    expect(t).toContain('Fecha');
  });

  it('el traslado dice de qué tanque sale y a cuál entra', () => {
    const t = mensajeMovimiento(mov({ tipo: 'traslado' }), { tanque: 'TANQUE 1', tanqueDestino: 'TANQUE 2' });
    expect(t).toMatch(/^🔁 \*TRASLADO ENTRE TANQUES\*/);
    expect(t).toContain('Sale de: TANQUE 1');
    expect(t).toContain('Entra a: TANQUE 2');
    // En un traslado no hay un solo «Tanque»: hay dos, y se nombran distinto.
    expect(t).not.toContain('📦 Tanque:');
  });

  it('la merma se anuncia como merma y lleva su motivo', () => {
    const t = mensajeMovimiento(mov({ tipo: 'merma', observacion: 'Derrame en la manguera' }));
    expect(t).toContain('🔻 *MERMA*');
    expect(t).toContain('Observación: Derrame en la manguera');
  });

  it('el contador va cuando hay alguna de las dos lecturas', () => {
    expect(mensajeMovimiento(mov({ contador_global_ini: 1000, contador_global_fin: 1120 })))
      .toContain('Contador: 1000 → 1120');
    expect(mensajeMovimiento(mov({ contador_global_ini: null, contador_global_fin: 1120 })))
      .toContain('Contador: — → 1120');
    expect(mensajeMovimiento(mov())).not.toContain('Contador');
  });

  it('cierra firmando, para que se sepa de dónde salió', () => {
    expect(mensajeMovimiento(mov())).toContain('MGG · Mineral Group Guayana');
  });

  it('una fecha ilegible no rompe el mensaje', () => {
    expect(fechaHoraTexto(null)).toBe('—');
    expect(fechaHoraTexto('cualquier cosa')).toBe('—');
    expect(mensajeMovimiento(mov({ fecha: null }))).toContain('Fecha: —');
  });
});

describe('el enlace de WhatsApp', () => {
  it('lleva el mensaje codificado', () => {
    const url = enlaceWhatsapp('🔽 SURTIDO 120 L');
    expect(url.startsWith('https://api.whatsapp.com/send?text=')).toBe(true);
    expect(decodeURIComponent(url.split('text=')[1])).toBe('🔽 SURTIDO 120 L');
  });

  it('va SIN número: el destinatario se elige al mandarlo', () => {
    // El surtido de hoy va al encargado y el de mañana al grupo de la mina.
    expect(enlaceWhatsapp('hola')).not.toMatch(/phone=/);
  });

  it('NUNCA por wa.me: ese acortador se come los emojis al redirigir', () => {
    // Comprobado contra el servidor (29-09-2026): wa.me devuelve un 302 cuyo
    // Location cambia cada carácter UTF-8 de 3 bytes o más por «%EF%BF%BD» (�).
    // Los de 2 bytes —«ó», «·»— pasan, los emojis no. Por eso se va derecho a
    // api.whatsapp.com, que no redirige.
    expect(enlaceWhatsapp(mensajeMovimiento(mov()))).not.toContain('wa.me');
  });

  it('los saltos de línea sobreviven al enlace', () => {
    const texto = mensajeMovimiento(mov());
    expect(decodeURIComponent(enlaceWhatsapp(texto).split('text=')[1])).toBe(texto);
  });
});

describe('los emojis llegan a color a WhatsApp', () => {
  /*
   * Hay caracteres que por norma Unicode son TEXTO y solo se vuelven emoji a
   * color con un U+FE0F invisible detrás (⬇️ ⬆️ ↩️ 🛢️ ⏱️ 🛣️ 🗓️). En el
   * navegador se veían bien, pero WhatsApp normaliza el texto del enlace y se
   * lleva el selector: del otro lado llegaba un glifo monocromo o un cuadrito.
   * Estas pruebas rompen si alguien vuelve a meter uno.
   */
  const SELECTOR = /️/;

  it('ningún emoji de movimiento depende del selector', () => {
    for (const [tipo, emoji] of Object.entries(EMOJI_MOVIMIENTO)) {
      expect(emoji, `${tipo} → ${emoji}`).not.toMatch(SELECTOR);
    }
  });

  it('el mensaje entero va sin selectores', () => {
    for (const tipo of ['consumo', 'ingreso', 'retorno', 'merma', 'traslado'] as const) {
      const texto = mensajeMovimiento(
        { ...mov(), tipo, horometro_final: 1200, kilometraje_final: 48000, contador_global_ini: 10, contador_global_fin: 130 },
        { tanque: 'BIDONES DE GASOLINA', tanqueDestino: 'TANQUE GENERAL', combustible: 'GASOLINA', registradoPor: 'ISNER' },
      );
      expect(texto, tipo).not.toMatch(SELECTOR);
    }
  });

  it('y sobreviven al viaje por el enlace', () => {
    const texto = mensajeMovimiento({ ...mov(), tipo: 'consumo' });
    const ida = decodeURIComponent(enlaceWhatsapp(texto).split('text=')[1]);
    expect(ida).toBe(texto);
    expect(ida).toContain(EMOJI_MOVIMIENTO.consumo);
  });

  it('cada movimiento sigue teniendo su flecha: abajo sale, arriba entra', () => {
    expect(mensajeMovimiento({ ...mov(), tipo: 'consumo' })).toContain('🔽');
    expect(mensajeMovimiento({ ...mov(), tipo: 'ingreso' })).toContain('🔼');
    expect(mensajeMovimiento({ ...mov(), tipo: 'traslado' })).toContain('🔁');
  });
});

describe('compartir por la hoja del sistema', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const conNavigator = (v: unknown) => { vi.stubGlobal('navigator', v); };

  it('sin hoja de compartir avisa que no, para que el enlace navegue solo', async () => {
    conNavigator({});
    expect(puedeCompartir()).toBe(false);
    expect(await compartirMovimiento('hola')).toBe(false);
  });

  it('con hoja, manda el texto tal cual: no pasa por ninguna URL', async () => {
    let recibido: unknown = null;
    conNavigator({ share: async (d: unknown) => { recibido = d; } });
    const texto = mensajeMovimiento({ ...mov(), tipo: 'consumo' });
    expect(puedeCompartir()).toBe(true);
    expect(await compartirMovimiento(texto)).toBe(true);
    expect(recibido).toEqual({ text: texto });
    expect((recibido as { text: string }).text).toContain(EMOJI_MOVIMIENTO.consumo);
  });

  it('cancelar la hoja no es un error, y no abre el enlace detrás', async () => {
    // Abrirlo sería mandar justo lo que la persona acaba de cancelar.
    conNavigator({ share: async () => { throw new Error('AbortError'); } });
    expect(await compartirMovimiento('hola')).toBe(true);
  });
});

describe('ajustes del 29-09', () => {
  it('el combustible lleva el surtidor y los litros el número; ya no hay gota', () => {
    const t = mensajeMovimiento(mov(), { combustible: 'GASOLINA' });
    expect(t).toContain('⛽ Combustible: GASOLINA');
    expect(t).toMatch(/🔢 Litros: \*/);
    expect(t).not.toContain('💧');
  });

  it('el mensaje ya no dice quién lo registró', () => {
    const t = mensajeMovimiento(mov(), { registradoPor: 'ISNER' });
    expect(t).not.toContain('Registró');
    expect(t).not.toContain('ISNER');
  });
});
