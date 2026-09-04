import { describe, it, expect } from 'vitest';
import { calcular, ErrorDeCuenta } from './calculo';

/* Tasas reales de producción del 04/09/2026 (tabla `tasa_cambio`). */
const EN_BS = new Map<string, number>([
  ['VES', 1],
  ['USD', 807.39],
  ['EUR', 938.45],
  ['USDT', 965.78],
  ['COP', 807.39 / 3141.36],
]);

const ALIAS = new Map<string, string>([
  ['BS', 'VES'], ['VES', 'VES'], ['BOLIVAR', 'VES'], ['BOLIVARES', 'VES'],
  ['$', 'USD'], ['USD', 'USD'], ['DOLAR', 'USD'], ['DOLARES', 'USD'],
  ['€', 'EUR'], ['EUR', 'EUR'], ['EURO', 'EUR'], ['EUROS', 'EUR'],
  ['USDT', 'USDT'], ['TETHER', 'USDT'],
  ['COP', 'COP'], ['PESO', 'COP'], ['PESOS', 'COP'],
]);

const NOMBRE = (c: string) => c;
const SIMBOLO = (c: string) => ({ VES: 'Bs', USD: '$', EUR: '€', USDT: 'USDT', COP: 'COP' }[c] ?? c);

const calc = (texto: string) => calcular(texto, ALIAS, EN_BS, NOMBRE, SIMBOLO);

describe('el separador de miles — la razón de todo esto', () => {
  // El motor anterior (`evalExpr` de TesoreriaPage) hacía replace(/,/g,'.') sobre
  // toda la expresión y leía con parseFloat. En Venezuela el separador de miles
  // ES el punto, así que «2.000» se convertía en 2 y NO fallaba: devolvía el
  // número equivocado con total confianza. En una calculadora de tesorería.
  it('lee los miles con punto y el decimal con coma', () => {
    expect(calc('2.000')!.valor.bs).toBe(2000);
    expect(calc('1.234,56')!.valor.bs).toBeCloseTo(1234.56, 6);
    expect(calc('1.234.567,89')!.valor.bs).toBeCloseTo(1234567.89, 6);
  });

  it('lee también la convención inglesa: manda el ÚLTIMO separador', () => {
    // 1.234,56 y 1,234.56 son el mismo número escrito por dos personas distintas.
    expect(calc('1,234.56')!.valor.bs).toBeCloseTo(1234.56, 6);
  });

  it('un solo separador con dos decimales es decimal, no miles', () => {
    expect(calc('15,50')!.valor.bs).toBeCloseTo(15.5, 6);
    expect(calc('15.50')!.valor.bs).toBeCloseTo(15.5, 6);
    expect(calc('807.39')!.valor.bs).toBeCloseTo(807.39, 6);
  });

  it('un cero delante nunca es un separador de miles', () => {
    // Nadie escribe «0.125» queriendo decir ciento veinticinco.
    expect(calc('0.125')!.valor.bs).toBeCloseTo(0.125, 6);
  });

  it('con coma sola manda la convención local: la coma es el decimal', () => {
    expect(calc('1,234')!.valor.bs).toBeCloseTo(1.234, 6);
  });
});

describe('las monedas tienen dimensión', () => {
  it('dinero × número sigue siendo dinero — el caso del IVA', () => {
    const r = calc('300 $ * 1,16')!;
    expect(r.valor.dim).toBe(1);
    expect(r.valor.bs).toBeCloseTo(300 * 1.16 * 807.39, 4);
  });

  it('dinero ÷ dinero da un número suelto — una proporción', () => {
    const r = calc('1.000 $ / 800 $')!;
    expect(r.valor.dim).toBe(0);
    expect(r.valor.bs).toBeCloseTo(1.25, 6);
  });

  it('dinero ÷ número sigue siendo dinero — repartir', () => {
    const r = calc('(300 $ + 200 $) / 2')!;
    expect(r.valor.dim).toBe(1);
    expect(r.valor.bs).toBeCloseTo(250 * 807.39, 4);
  });

  it('dinero × dinero NO EXISTE y se rechaza', () => {
    // «USDT·euros» no es ninguna magnitud. El motor anterior devolvía un número.
    expect(() => calc('98,09 usdt * 2 €')).toThrow(ErrorDeCuenta);
  });
});

describe('monedas mezcladas en una misma cuenta', () => {
  it('suma dólares y euros pasando por bolívares', () => {
    const r = calc('300 $ + 50 €')!;
    expect(r.valor.dim).toBe(1);
    expect(r.valor.bs).toBeCloseTo(300 * 807.39 + 50 * 938.45, 4);
  });

  it('un número suelto sumado a dinero toma la moneda del otro lado', () => {
    const r = calc('100 $ + 50')!;
    expect(r.valor.bs).toBeCloseTo(150 * 807.39, 4);
  });

  it('el margen entre BCV y el paralelo se calcula solo', () => {
    // 1 USDT vale más bolívares que 1 USD: ese cociente es el margen real.
    const r = calc('1 usdt / 1 $')!;
    expect(r.valor.dim).toBe(0);
    expect(r.valor.bs).toBeCloseTo(965.78 / 807.39, 6);
  });
});

describe('se enseña cómo se leyó la cuenta', () => {
  it('devuelve la expresión reescrita como la entendió', () => {
    // Existe porque la versión anterior leyó (1+98.09usdt*2eur)/2usd como cuatro
    // sumas y devolvió un número. Ver la cuenta reescrita es la única forma de
    // enterarse de que se entendió otra cosa.
    const r = calc('300 $ * 1,16')!;
    expect(r.comoSeLeyo).toContain('300');
    expect(r.comoSeLeyo).toContain('1,16');
  });

  it('los paréntesis de fuera no ensucian la lectura', () => {
    expect(calc('300 $ + 200 $')!.comoSeLeyo).not.toMatch(/^\(.*\)$/);
  });
});

describe('la moneda mal tecleada se sugiere, no solo se rechaza', () => {
  it('propone la parecida cuando sobra un dedo', () => {
    // Un aviso que solo dice que algo está mal deja a quien lo lee igual de atascado.
    let mensaje = '';
    try { calc('100 bsb'); } catch (e) { mensaje = (e as Error).message; }
    expect(mensaje.toLowerCase()).toContain('bs');
  });

  it('una moneda que no existe ni se parece a nada, falla limpio', () => {
    expect(() => calc('100 zzzz')).toThrow(ErrorDeCuenta);
  });
});

describe('bordes', () => {
  it('el texto vacío no es un error, es nada', () => {
    expect(calc('')).toBeNull();
    expect(calc('   ')).toBeNull();
  });

  it('una cuenta que no da número lanza en vez de devolver Infinity', () => {
    expect(() => calc('1 / 0')).toThrow(ErrorDeCuenta);
  });

  it('los paréntesis desbalanceados se rechazan', () => {
    expect(() => calc('(300 $ + 200')).toThrow(ErrorDeCuenta);
  });
});
