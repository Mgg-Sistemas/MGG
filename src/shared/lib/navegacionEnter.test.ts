import { describe, it, expect } from 'vitest';
import { decidirEnter, esCampoNavegable, type CampoEnfocable, type ContextoEnter } from './navegacionEnter';

const campo = (tag: string, tipo = '', extra: Partial<CampoEnfocable> = {}): CampoEnfocable =>
  ({ tag, tipo, deshabilitado: false, soloLectura: false, tabIndex: 0, visible: true, omitido: false, ...extra });

const texto = () => campo('INPUT', 'text');
const numero = () => campo('INPUT', 'number');
const fecha = () => campo('INPUT', 'date');
const casilla = () => campo('INPUT', 'checkbox');
const lista = () => campo('SELECT');
const area = () => campo('TEXTAREA');

const ctx = (p: Partial<ContextoEnter> = {}): ContextoEnter => ({
  tecla: 'Enter', ctrl: false, meta: false, shift: false, alt: false,
  yaConsumido: false, repetida: false, componiendo: false,
  campos: [], indiceOrigen: 0, enviando: false, atajoCtrlEnter: true, ...p,
});

describe('esCampoNavegable', () => {
  it('acepta input de texto, select, textarea y casilla', () => {
    expect(esCampoNavegable(texto())).toBe(true);
    expect(esCampoNavegable(lista())).toBe(true);
    expect(esCampoNavegable(area())).toBe(true);
    expect(esCampoNavegable(casilla())).toBe(true);
    expect(esCampoNavegable(fecha())).toBe(true);
  });

  it('salta los deshabilitados (el almacén antes de elegir la sede)', () => {
    expect(esCampoNavegable(campo('SELECT', '', { deshabilitado: true }))).toBe(false);
  });

  it('salta readOnly y tabIndex negativo ("Saldo resultante")', () => {
    expect(esCampoNavegable(campo('INPUT', 'text', { soloLectura: true }))).toBe(false);
    expect(esCampoNavegable(campo('INPUT', 'text', { tabIndex: -1 }))).toBe(false);
  });

  it('salta los ocultos (rama condicional que no está en pantalla)', () => {
    expect(esCampoNavegable(campo('INPUT', 'text', { visible: false }))).toBe(false);
  });

  it('salta las altas inline marcadas con data-enter-omitir', () => {
    expect(esCampoNavegable(campo('INPUT', 'text', { omitido: true }))).toBe(false);
  });

  it('nunca aterriza en un input que en realidad es un botón', () => {
    for (const t of ['submit', 'reset', 'button', 'image', 'file', 'hidden']) {
      expect(esCampoNavegable(campo('INPUT', t))).toBe(false);
    }
  });

  it('no considera campo a un elemento que no es input/select/textarea', () => {
    expect(esCampoNavegable(campo('BUTTON'))).toBe(false);
  });
});

describe('decidirEnter · Tab y otras teclas', () => {
  it('Tab se ignora siempre: nunca avanza ni envía', () => {
    const d = decidirEnter(ctx({ tecla: 'Tab', campos: [texto(), texto()], indiceOrigen: 0 }));
    expect(d).toEqual({ accion: 'ignorar', destino: -1, motivo: 'no-es-enter' });
  });

  it('Tab en el último campo tampoco envía', () => {
    const d = decidirEnter(ctx({ tecla: 'Tab', campos: [texto()], indiceOrigen: 0 }));
    expect(d.accion).toBe('ignorar');
  });

  it('Escape, ArrowDown y una letra se ignoran', () => {
    for (const tecla of ['Escape', 'ArrowDown', 'a']) {
      expect(decidirEnter(ctx({ tecla, campos: [texto()], indiceOrigen: 0 })).accion).toBe('ignorar');
    }
  });
});

describe('decidirEnter · avanzar', () => {
  it('Enter en el primer campo avanza al segundo', () => {
    const d = decidirEnter(ctx({ campos: [texto(), texto()], indiceOrigen: 0 }));
    expect(d).toEqual({ accion: 'avanzar', destino: 1, motivo: 'avanza' });
  });

  it('Enter en un select avanza (antes enviaba el formulario)', () => {
    const d = decidirEnter(ctx({ campos: [lista(), texto()], indiceOrigen: 0 }));
    expect(d.accion).toBe('avanzar');
  });

  it('Enter en una casilla avanza (Espacio la sigue marcando)', () => {
    const d = decidirEnter(ctx({ campos: [casilla(), texto()], indiceOrigen: 0 }));
    expect(d.accion).toBe('avanzar');
  });

  it('Enter en un campo numérico avanza', () => {
    const d = decidirEnter(ctx({ campos: [numero(), fecha()], indiceOrigen: 0 }));
    expect(d.accion).toBe('avanzar');
  });

  it('salta deshabilitados, invisibles, readOnly y tabIndex -1', () => {
    const campos = [
      texto(),
      campo('SELECT', '', { deshabilitado: true }),
      campo('INPUT', 'text', { visible: false }),
      campo('INPUT', 'text', { soloLectura: true }),
      campo('INPUT', 'text', { tabIndex: -1 }),
      fecha(),
    ];
    expect(decidirEnter(ctx({ campos, indiceOrigen: 0 })).destino).toBe(5);
  });

  it('salta los campos de alta inline y cae en el siguiente real', () => {
    const campos = [lista(), campo('INPUT', 'text', { omitido: true }), lista()];
    expect(decidirEnter(ctx({ campos, indiceOrigen: 0 })).destino).toBe(2);
  });

  it('el destino es el índice del array SIN filtrar', () => {
    const campos = [texto(), campo('INPUT', 'text', { deshabilitado: true }), texto()];
    expect(decidirEnter(ctx({ campos, indiceOrigen: 0 })).destino).toBe(2);
  });

  it('avanza aunque haya un guardado en curso', () => {
    const d = decidirEnter(ctx({ campos: [texto(), texto()], indiceOrigen: 0, enviando: true }));
    expect(d.accion).toBe('avanzar');
  });
});

describe('decidirEnter · enviar', () => {
  it('Enter en el último campo envía', () => {
    const d = decidirEnter(ctx({ campos: [texto(), fecha()], indiceOrigen: 1 }));
    expect(d).toEqual({ accion: 'enviar', destino: -1, motivo: 'ultimo-campo' });
  });

  it('Enter en el único campo del formulario envía', () => {
    expect(decidirEnter(ctx({ campos: [texto()], indiceOrigen: 0 })).accion).toBe('enviar');
  });

  it('envía aunque los campos que siguen estén todos excluidos', () => {
    const campos = [fecha(), campo('INPUT', 'submit')];
    expect(decidirEnter(ctx({ campos, indiceOrigen: 0 })).accion).toBe('enviar');
  });

  it('NO envía si hay un guardado en curso (evita solicitudes duplicadas)', () => {
    const d = decidirEnter(ctx({ campos: [fecha()], indiceOrigen: 0, enviando: true }));
    expect(d).toEqual({ accion: 'bloquear', destino: -1, motivo: 'guardando' });
  });

  it('si el último campo es un textarea, Enter escribe un salto y no envía', () => {
    const d = decidirEnter(ctx({ campos: [texto(), area()], indiceOrigen: 1 }));
    expect(d).toEqual({ accion: 'ignorar', destino: -1, motivo: 'textarea' });
  });

  it('Ctrl+Enter envía desde cualquier campo, incluido el textarea', () => {
    const d = decidirEnter(ctx({ ctrl: true, campos: [area(), texto()], indiceOrigen: 0 }));
    expect(d).toEqual({ accion: 'enviar', destino: -1, motivo: 'atajo-ctrl' });
  });

  it('⌘+Enter también envía', () => {
    expect(decidirEnter(ctx({ meta: true, campos: [texto(), texto()], indiceOrigen: 0 })).accion).toBe('enviar');
  });

  it('Ctrl+Enter no envía con el atajo desactivado', () => {
    const d = decidirEnter(ctx({ ctrl: true, atajoCtrlEnter: false, campos: [texto(), texto()], indiceOrigen: 0 }));
    expect(d).toEqual({ accion: 'ignorar', destino: -1, motivo: 'con-ctrl' });
  });

  it('Ctrl+Enter no envía mientras se guarda', () => {
    const d = decidirEnter(ctx({ ctrl: true, enviando: true, campos: [texto()], indiceOrigen: 0 }));
    expect(d.accion).toBe('bloquear');
  });
});

describe('decidirEnter · casos borde', () => {
  it('un Enter ya consumido por el SearchSelect no hace nada', () => {
    const d = decidirEnter(ctx({ yaConsumido: true, campos: [texto(), texto()], indiceOrigen: 0 }));
    expect(d).toEqual({ accion: 'ignorar', destino: -1, motivo: 'ya-consumido' });
  });

  it('un Enter ya consumido por un alta inline (+ Añadir chofer) no hace nada', () => {
    const campos = [campo('INPUT', 'text', { omitido: true }), texto()];
    expect(decidirEnter(ctx({ yaConsumido: true, campos, indiceOrigen: 0 })).motivo).toBe('ya-consumido');
  });

  it('un SearchSelect sin resultados no consume el Enter: avanza en vez de enviar', () => {
    // open && filtered vacío && !allowCreate → SearchSelect no hace preventDefault
    const d = decidirEnter(ctx({ yaConsumido: false, campos: [texto(), numero()], indiceOrigen: 0 }));
    expect(d.accion).toBe('avanzar');
  });

  it('un Enter durante composición IME se ignora (tildes y ñ)', () => {
    const d = decidirEnter(ctx({ componiendo: true, campos: [texto(), texto()], indiceOrigen: 0 }));
    expect(d).toEqual({ accion: 'ignorar', destino: -1, motivo: 'ime' });
  });

  it('Enter mantenido (auto-repetición) se bloquea', () => {
    const d = decidirEnter(ctx({ repetida: true, campos: [fecha()], indiceOrigen: 0 }));
    expect(d).toEqual({ accion: 'bloquear', destino: -1, motivo: 'repetida' });
  });

  it('Enter desde un botón se ignora: el navegador lo activa', () => {
    const d = decidirEnter(ctx({ campos: [texto(), fecha()], indiceOrigen: -1 }));
    expect(d).toEqual({ accion: 'ignorar', destino: -1, motivo: 'no-es-campo' });
  });

  it('Enter desde un input submit se ignora', () => {
    const d = decidirEnter(ctx({ campos: [campo('INPUT', 'submit'), texto()], indiceOrigen: 0 }));
    expect(d.motivo).toBe('no-es-campo');
  });

  it('Enter desde un campo de alta inline se ignora: ahí Enter significa "añadir"', () => {
    const campos = [campo('INPUT', 'text', { omitido: true }), texto()];
    expect(decidirEnter(ctx({ campos, indiceOrigen: 0 })).motivo).toBe('no-es-campo');
  });

  it('Shift+Enter se ignora', () => {
    const d = decidirEnter(ctx({ shift: true, campos: [texto(), texto()], indiceOrigen: 0 }));
    expect(d.motivo).toBe('con-shift');
  });

  it('Alt+Enter se ignora', () => {
    const d = decidirEnter(ctx({ alt: true, campos: [texto(), texto()], indiceOrigen: 0 }));
    expect(d.motivo).toBe('con-alt');
  });

  it('un contenedor sin campos no hace nada', () => {
    expect(decidirEnter(ctx({ campos: [], indiceOrigen: -1 })).motivo).toBe('sin-campos');
  });
});

describe('decidirEnter · el formulario de salida de material', () => {
  // Orden real de SalidaMaterialForm sin cliente: unidad, alta inline de unidad, sede,
  // producto, cantidad, precio, chofer, vehículo, consumo interno, motivo, fecha.
  const formulario: CampoEnfocable[] = [
    casilla(),                                   // 0 · 🧾 Cliente
    lista(),                                     // 1 · Unidad solicitante
    campo('INPUT', 'text', { omitido: true }),   // 2 · ¿No está? Escribí una nueva…
    lista(),                                     // 3 · Sede destino
    texto(),                                     // 4 · SearchSelect Producto
    numero(),                                    // 5 · Cantidad
    numero(),                                    // 6 · Precio unit.
    texto(),                                     // 7 · SearchSelect Chofer
    texto(),                                     // 8 · SearchSelect Vehículo
    casilla(),                                   // 9 · Consumo interno
    texto(),                                     // 10 · Motivo
    fecha(),                                     // 11 · Fecha de entrega
  ];

  it('desde la Unidad solicitante salta el alta inline y cae en Sede destino', () => {
    expect(decidirEnter(ctx({ campos: formulario, indiceOrigen: 1 })).destino).toBe(3);
  });

  it('desde Precio pasa al chofer, no envía', () => {
    const d = decidirEnter(ctx({ campos: formulario, indiceOrigen: 6 }));
    expect(d).toEqual({ accion: 'avanzar', destino: 7, motivo: 'avanza' });
  });

  it('desde la Fecha de entrega (último campo) envía', () => {
    expect(decidirEnter(ctx({ campos: formulario, indiceOrigen: 11 })).accion).toBe('enviar');
  });

  it('Tab desde la Fecha de entrega no envía', () => {
    expect(decidirEnter(ctx({ tecla: 'Tab', campos: formulario, indiceOrigen: 11 })).accion).toBe('ignorar');
  });
});
