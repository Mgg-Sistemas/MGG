import { describe, it, expect } from 'vitest';
import { errorTelefono, errorTelefonoContraBanco, errorCuenta, errorCiRif, soloDigitos, normalizarTelefono } from './datosPagoValidacion';

describe('teléfono', () => {
  it('acepta los celulares de los cinco operadores', () => {
    for (const t of ['04149692172', '04249692172', '04129692172', '04169692172', '04269692172', '04227163231']) {
      expect(errorTelefono(t)).toBeNull();
    }
  });

  it('acepta un fijo', () => {
    expect(errorTelefono('02862345678')).toBeNull();
  });

  it('rechaza el código del banco guardado como teléfono', () => {
    // El caso real: MODELO PARTS tenía «01340869618». Son 11 dígitos numéricos,
    // así que ningún filtro de largo lo agarraba: lo delata el prefijo 0134.
    expect(errorTelefono('01340869618')).toMatch(/no es un operador/);
  });

  it('rechaza un número incompleto', () => {
    // FILTROS NEKUIMA tenía «564543».
    expect(errorTelefono('564543')).toMatch(/11 dígitos y tiene 6/);
  });

  it('acepta el número escrito con el 58 adelante', () => {
    // En internacional el país reemplaza al cero, así que el número lleva un
    // dígito MÁS que el local: 58 + los 10 de «424 969 21 72».
    expect(errorTelefono('584249692172')).toBeNull();
    expect(errorTelefono('+58 424-969.21.72')).toBeNull();
    expect(errorTelefono('582862345678')).toBeNull();   // un fijo
  });

  it('con el 58 adelante también avisa si el número está incompleto', () => {
    // ING. CESAR GOMEZ tenía «58424924275»: le falta un dígito para ser el
    // internacional (van 12) y le sobra para ser el local (van 11).
    expect(errorTelefono('58424924275')).toMatch(/reemplaza al cero/);
  });

  it('el 58 adelante no sirve para colar un prefijo inventado', () => {
    expect(errorTelefono('581340869618')).toMatch(/no es un operador/);
  });

  it('rechaza un número de cuenta pegado en el teléfono', () => {
    expect(errorTelefono('01050000000000000000')).toMatch(/11 dígitos y tiene 20/);
  });

  it('no le molestan los guiones ni los puntos al escribir', () => {
    expect(errorTelefono('0424-969.21.72')).toBeNull();
  });

  it('pide el dato si viene vacío', () => {
    expect(errorTelefono('')).toBe('Indicá el teléfono');
    expect(errorTelefono(null)).toBe('Indicá el teléfono');
  });
});

describe('teléfono contra el banco elegido', () => {
  it('avisa cuando el teléfono arranca con el código del banco', () => {
    expect(errorTelefonoContraBanco('01340869618', '0134')).toMatch(/código del banco/);
  });

  it('no molesta cuando el número es normal', () => {
    expect(errorTelefonoContraBanco('04249692172', '0134')).toBeNull();
    expect(errorTelefonoContraBanco('04149692172', '0102')).toBeNull();
  });

  it('sin banco o sin teléfono no opina', () => {
    expect(errorTelefonoContraBanco('04249692172', '')).toBeNull();
    expect(errorTelefonoContraBanco('', '0134')).toBeNull();
  });
});

describe('número de cuenta', () => {
  it('acepta los 20 dígitos', () => {
    expect(errorCuenta('01340123012301230123')).toBeNull();
  });

  it('rechaza uno corto y uno largo', () => {
    expect(errorCuenta('0134012301')).toMatch(/20 dígitos y tiene 10/);
    expect(errorCuenta('013401230123012301234')).toMatch(/tiene 21/);
  });

  it('rechaza un teléfono pegado en la cuenta', () => {
    expect(errorCuenta('04249692172')).toMatch(/20 dígitos y tiene 11/);
  });
});

describe('CI / RIF', () => {
  it('acepta las formas normales', () => {
    for (const c of ['V-12345678', 'J-30646306-2', 'E12345678', 'P1131881', '26830892']) {
      expect(errorCiRif(c)).toBeNull();
    }
  });

  it('rechaza el nombre del banco pegado al RIF', () => {
    // El caso real de MODELO PARTS: «J-30646306-2 BANESCO».
    expect(errorCiRif('J-30646306-2 BANESCO')).toMatch(/texto de más/);
  });

  it('rechaza uno incompleto', () => {
    expect(errorCiRif('123')).toMatch(/3 dígitos/);
  });

  it('pide el dato si viene vacío', () => {
    expect(errorCiRif('  ')).toBe('Indicá el CI o RIF');
  });
});

describe('soloDigitos', () => {
  it('deja pasar únicamente los números', () => {
    expect(soloDigitos('0424-969.21.72')).toBe('04249692172');
    expect(soloDigitos(null)).toBe('');
  });
});

describe('normalizarTelefono · una sola forma en la base', () => {
  it('el internacional queda en local', () => {
    expect(normalizarTelefono('584249692172')).toBe('04249692172');
    expect(normalizarTelefono('+58 424 969 21 72')).toBe('04249692172');
  });

  it('el local se queda como está', () => {
    expect(normalizarTelefono('04249692172')).toBe('04249692172');
  });

  it('no le corta el 58 a un número que no lo trae como país', () => {
    // «58424924275» tiene 11 dígitos: es un local mal escrito, no un
    // internacional. Se deja tal cual para que la validación lo rechace.
    expect(normalizarTelefono('58424924275')).toBe('58424924275');
  });

  it('las dos formas del MISMO número terminan iguales', () => {
    expect(normalizarTelefono('584249692172')).toBe(normalizarTelefono('04249692172'));
  });
});
