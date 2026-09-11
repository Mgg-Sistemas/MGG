import { describe, it, expect } from 'vitest';
import { urlConBust, PARAM_RECARGA } from './recargaDura';

describe('la recarga que salta la caché', () => {
  it('le agrega la marca de tiempo a una dirección limpia', () => {
    expect(urlConBust('https://sistema.mineralgroupguayana.com/', 1757600000000))
      .toBe('https://sistema.mineralgroupguayana.com/?_v=1757600000000');
  });

  it('no encadena marcas: reemplaza la anterior', () => {
    const una = urlConBust('https://s.com/inventario', 111);
    const dos = urlConBust(una, 222);
    expect(dos).toBe('https://s.com/inventario?_v=222');
    expect(dos.match(new RegExp(PARAM_RECARGA, 'g'))).toHaveLength(1);
  });

  it('conserva lo que ya traía la consulta', () => {
    const r = urlConBust('https://s.com/pedidos?tab=oc&q=gomor', 9);
    expect(r).toContain('tab=oc');
    expect(r).toContain('q=gomor');
    expect(r).toContain(`${PARAM_RECARGA}=9`);
  });

  it('conserva el fragmento, que es a dónde va el usuario', () => {
    expect(urlConBust('https://s.com/manual#recepciones', 5))
      .toBe('https://s.com/manual?_v=5#recepciones');
  });

  it('cada llamada devuelve una dirección distinta', () => {
    expect(urlConBust('https://s.com/', 1)).not.toBe(urlConBust('https://s.com/', 2));
  });
});
