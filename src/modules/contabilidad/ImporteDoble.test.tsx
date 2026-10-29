/* La regla de diseño del módulo: una columna por importe, la otra moneda debajo y tenue. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ImporteDoble, par } from './ImporteDoble';

describe('ImporteDoble', () => {
  it('la principal en la moneda elegida y la equivalente debajo, con su símbolo', () => {
    expect(renderToStaticMarkup(<ImporteDoble moneda="VES" {...par('VES', 4000, 10)} />))
      .toBe('<span class="mono">4.000,00</span><span class="cont-equiv mono">$ 10,00</span>');
    expect(renderToStaticMarkup(<ImporteDoble moneda="USD" {...par('USD', 4000, 10)} conSimbolo />))
      .toBe('<span class="mono">$ 10,00</span><span class="cont-equiv mono">Bs 4.000,00</span>');
  });

  it('un saldo acreedor va entre paréntesis en las dos', () => {
    expect(renderToStaticMarkup(<ImporteDoble moneda="USD" valor={-5} eq={-2000} saldo />))
      .toBe('<span class="mono">(5,00)</span><span class="cont-equiv mono">Bs (2.000,00)</span>');
  });

  it('vacía si las dos son cero (Debe o Haber de un asiento); sin equivalente, solo la principal', () => {
    expect(renderToStaticMarkup(<ImporteDoble moneda="VES" valor={0} eq={0} vacioSiCero />)).toBe('');
    expect(renderToStaticMarkup(<ImporteDoble moneda="VES" valor={0} eq={0.4} vacioSiCero />)).toContain('$ 0,40');
    expect(renderToStaticMarkup(<ImporteDoble moneda="VES" valor={7} />)).toBe('<span class="mono">7,00</span>');
  });
});
