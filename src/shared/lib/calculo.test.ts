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

  it('los grupos de miles tienen que ser de tres, o no son miles', () => {
    // «1.000.00» no es un número bien escrito; darlo por cien mil sería inventar.
    // Cae a la regla del último separador: 1000,00.
    expect(calc('1.000.00')!.valor.bs).toBeCloseTo(1000, 6);
  });

  it('un resultado se puede volver a leer sin que cambie de tamaño', () => {
    // El «=» devuelve el resultado al renglón. Si se escribiera con punto,
    // releerlo lo multiplicaría por mil: 1234,567 -> «1234.567» -> 1.234.567.
    const uno = calc('1.234,567')!.valor.bs;
    expect(calc('1234,567')!.valor.bs).toBeCloseTo(uno, 6);
  });

  it('un cero delante nunca es un separador de miles', () => {
    // Nadie escribe «0.125» queriendo decir ciento veinticinco.
    expect(calc('0.125')!.valor.bs).toBeCloseTo(0.125, 6);
  });

  it('con coma sola manda la convención local: la coma es el decimal', () => {
    expect(calc('1,234')!.valor.bs).toBeCloseTo(1.234, 6);
  });
});

describe('los signos que escribe el teclado en pantalla', () => {
  // El teclado muestra «×» y «÷» porque se leen mejor, y los mete tal cual en la
  // expresión. El motor viejo los normalizaba antes de parsear; al portarlo se
  // perdió esa línea y multiplicar quedó IMPOSIBLE desde la interfaz. Ningún
  // test lo vio porque todos usaban ASCII: acá se prueban los glifos de verdad.
  it('× y ÷ valen lo mismo que * y /', () => {
    expect(calc('2 × 3')!.valor.bs).toBe(6);
    expect(calc('6 ÷ 2')!.valor.bs).toBe(3);
    expect(calc('100 $ × 1,16')!.valor.bs).toBeCloseTo(116 * 807.39, 3);
    expect(calc('1.000 $ ÷ 800 $')!.valor.bs).toBeCloseTo(1.25, 6);
  });

  it('el menos tipográfico y los guiones largos también', () => {
    expect(calc('10 − 3')!.valor.bs).toBe(7);
    expect(calc('10 – 3')!.valor.bs).toBe(7);
  });

  it('el resultado es el mismo se escriba como se escriba', () => {
    expect(calc('300 $ × 1,16')!.valor.bs).toBeCloseTo(calc('300 $ * 1,16')!.valor.bs, 6);
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

describe('el porcentaje, pensado para el IVA', () => {
  it('sumar un porcentaje lo toma sobre lo de la izquierda', () => {
    // Es la forma natural de pedir el IVA. Sin este caso especial, «+ 16 %»
    // sumaría 0,16 y daría un número absurdo sin avisar.
    const r = calc('1.000 $ + 16%')!;
    expect(r.valor.dim).toBe(1);
    expect(r.valor.bs).toBeCloseTo(1160 * 807.39, 3);
  });

  it('restar un porcentaje también', () => {
    expect(calc('1.000 $ - 10%')!.valor.bs).toBeCloseTo(900 * 807.39, 3);
  });

  it('multiplicar por un porcentaje da la parte', () => {
    // Cuánto es el IVA solo, sin la base.
    expect(calc('1.000 $ * 16%')!.valor.bs).toBeCloseTo(160 * 807.39, 3);
  });

  it('dividir entre un porcentaje despeja la base', () => {
    // Un monto con IVA incluido: 1.160 ÷ 116 % = 1.000.
    expect(calc('1.160 $ / 116%')!.valor.bs).toBeCloseTo(1000 * 807.39, 3);
  });

  it('un porcentaje suelto es una fracción, no dinero', () => {
    const r = calc('16%')!;
    expect(r.valor.dim).toBe(0);
    expect(r.valor.bs).toBeCloseTo(0.16, 8);
  });

  it('funciona sobre números sin moneda', () => {
    expect(calc('200 + 25%')!.valor.bs).toBeCloseTo(250, 8);
  });

  it('un porcentaje con moneda no tiene sentido y se rechaza', () => {
    expect(() => calc('1.000 + 5 $%')).toThrow(ErrorDeCuenta);
  });

  it('dice sobre qué se aplicó el porcentaje', () => {
    // «16 % de qué» es la ambigüedad; verlo escrito es lo que evita adivinar.
    expect(calc('1.000 $ + 16%')!.comoSeLeyo).toContain('% de');
  });

  it('el porcentaje se puede aplicar a un paréntesis', () => {
    expect(calc('1.000 $ + (10 + 6)%')!.valor.bs).toBeCloseTo(1160 * 807.39, 3);
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

  it('la lectura NO agrupa los miles, porque agrupando no despejaría nada', () => {
    // «1.075» leído como mil setenta y cinco, reescrito con agrupación, volvería
    // a ser «1.075»: idéntico a lo tecleado y por lo tanto inútil para revisar.
    expect(calc('1.075')!.comoSeLeyo).toBe('1075');
    expect(calc('1,075')!.comoSeLeyo).toBe('1,075');
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
