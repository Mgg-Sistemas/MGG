import { describe, it, expect } from 'vitest';
import {
  CONCEPTOS_DEDUCCION, DIAS_QUINCENA, PORCION_SUELDO, aBs, aUsd, calcularRecibo,
  lineasConMonto, repartirQuincena, repartirSueldo, sueldoDiario,
} from './sueldoQuincena';

/* Los números de referencia salen de la planilla real de la 1ª quincena de
   septiembre 2026 (Leydis Rengel, tasa 842,20). Si esto cambia, cambió la
   forma de pagar, no un detalle de código. */

describe('el sueldo se parte en 20% sueldo y 80% bono', () => {
  it('reparte como la planilla', () => {
    const r = repartirSueldo(1500);
    expect(r.sueldoMes).toBe(300);
    expect(r.bonoMes).toBe(1200);
    expect(r.sueldoQuincena).toBe(150);
    expect(r.bonoQuincena).toBe(600);
    expect(r.totalQuincena).toBe(750);
  });

  it('las dos partes SIEMPRE suman el total, aunque no den redondo', () => {
    // 333,33 × 20% = 66,666 → si se redondeara cada parte por su cuenta
    // quedarían centavos sueltos que no cuadran en el recibo.
    for (const m of [333.33, 0.01, 1234.56, 999.99, 7, 85.55]) {
      const r = repartirSueldo(m);
      expect(r.sueldoMes + r.bonoMes).toBeCloseTo(r.mensual, 2);
    }
  });

  it('el 20% es la porción por defecto', () => {
    expect(PORCION_SUELDO).toBe(0.2);
    expect(repartirSueldo(1000).sueldoMes).toBe(200);
  });

  it('se puede usar otra porción sin tocar el código', () => {
    const r = repartirSueldo(1000, 0.5);
    expect(r.sueldoMes).toBe(500);
    expect(r.bonoMes).toBe(500);
  });

  it('un sueldo en cero o negativo no rompe ni da negativos', () => {
    expect(repartirSueldo(0).totalQuincena).toBe(0);
    expect(repartirSueldo(-100).mensual).toBe(0);
  });
});

describe('el reparto de lo devengado en la quincena', () => {
  it('parte el bruto de la quincena en sueldo y bono', () => {
    const r = repartirQuincena(750);
    expect(r.sueldo).toBe(150);
    expect(r.bono).toBe(600);
  });

  it('las dos partes suman el bruto exacto, siempre', () => {
    for (const b of [750, 333.33, 0.07, 1234.56, 99.99]) {
      const r = repartirQuincena(b);
      expect(r.sueldo + r.bono).toBeCloseTo(r.bruto, 2);
    }
  });
});

describe('el sueldo diario', () => {
  it('sale de la quincena dividida en 15, como el recibo', () => {
    expect(DIAS_QUINCENA).toBe(15);
    expect(sueldoDiario(150)).toBe(10);
  });

  it('da lo mismo que mensual entre 30', () => {
    const r = repartirSueldo(1500);
    expect(sueldoDiario(r.sueldoQuincena)).toBeCloseTo(r.sueldoMes / 30, 2);
  });

  it('sin días no divide por cero', () => {
    expect(sueldoDiario(150, 0)).toBe(0);
  });
});

describe('bolívares', () => {
  it('convierte a la tasa de la quincena', () => {
    expect(aBs(150, 842.2)).toBe(126330);
  });

  it('vuelve a dólares al mismo cambio', () => {
    expect(aUsd(126330, 842.2)).toBe(150);
  });

  it('sin tasa no inventa un monto', () => {
    expect(aBs(150, 0)).toBe(0);
    expect(aUsd(126330, 0)).toBe(0);
  });
});

describe('el recibo completo', () => {
  /* Leydis, 1ª quincena de septiembre: cobra $750 en la quincena (la mitad de
     sus $1.500 al mes), repartidos en 11 días trabajados + 4 de descanso. */
  const LEYDIS = { brutoQuincena: 750, diasTrabajados: 11, diasDescanso: 4, tasa: 842.2 };

  it('los días trabajados y los de descanso se pagan al mismo diario', () => {
    const r = calcularRecibo(LEYDIS);
    expect(r.diario).toBe(10);
    const trab = r.lineas.find((l) => l.concepto === 'Días trabajados');
    const desc = r.lineas.find((l) => l.concepto === 'Días de descanso');
    expect(trab?.usd).toBe(110);
    expect(desc?.usd).toBe(40);
  });

  it('los días juntos dan la parte «sueldo» completa, sin centavos sueltos', () => {
    for (const dias of [[11, 4], [15, 0], [7, 3], [1, 0], [9, 6]]) {
      const r = calcularRecibo({ ...LEYDIS, diasTrabajados: dias[0], diasDescanso: dias[1] });
      const porDias = r.lineas.filter((l) => l.concepto.startsWith('Días')).reduce((a, l) => a + l.usd, 0);
      expect(porDias).toBeCloseTo(r.reparto.sueldo, 2);
    }
  });

  it('el bono NO va en la tabla: sale aparte, en divisas', () => {
    // La tabla es lo que se paga EN BOLÍVARES (el 20 %). El bono se entrega en
    // dólares y tiene su propio bloque; meterlo acá diría que se pagaron en
    // bolívares $750 que nunca se pagaron en bolívares.
    const r = calcularRecibo(LEYDIS);
    expect(r.lineas.some((l) => l.concepto === 'Bono')).toBe(false);
    expect(r.totalDevengadoUsd).toBe(150);   // solo el 20 %
    expect(r.netoUsd).toBe(150);
    expect(r.bonoUsd).toBe(600);             // el 80 %, en divisas
  });

  it('el TOTAL RECIBIDO es la tabla más el bono: todo lo que cobra', () => {
    const r = calcularRecibo(LEYDIS);
    expect(r.totalRecibidoUsd).toBe(750);
    expect(r.totalRecibidoUsd).toBe(r.netoUsd + r.bonoUsd);
  });

  it('el caso del formato: $200 la quincena → $40 en Bs y $160 de bono', () => {
    const r = calcularRecibo({ brutoQuincena: 200, diasTrabajados: 11, diasDescanso: 4, tasa: 853.5 });
    expect(r.netoUsd).toBe(40);
    expect(r.bonoUsd).toBe(160);
    expect(r.totalRecibidoUsd).toBe(200);
    expect(r.netoBs).toBe(34140);                                   // 40 × 853,50
    expect(r.lineas[0].usd).toBeCloseTo(29.33, 2);                  // 11 días
    expect(r.lineas[1].usd).toBeCloseTo(10.67, 2);                  // 4 días
  });

  it('EL RECIBO SIEMPRE SUMA LO QUE SE PAGA, con cualquier reparto de días', () => {
    // Es la razón de armarlo desde el bruto y no desde el sueldo mensual: un
    // recibo que no cuadra con el monto entregado es un problema, no un detalle.
    for (const bruto of [750, 333.33, 0.05, 1234.56, 87.77]) {
      for (const dias of [[11, 4], [15, 0], [3, 1]]) {
        const r = calcularRecibo({ ...LEYDIS, brutoQuincena: bruto, diasTrabajados: dias[0], diasDescanso: dias[1] });
        // La tabla más el bono tienen que dar el bruto: no se pierde un centavo
        // entre las dos monedas, sea cual sea el reparto de días.
        expect(r.totalRecibidoUsd).toBeCloseTo(bruto, 2);
      }
    }
  });

  it('el neto en bolívares es el 20 %, que es lo que se paga en bolívares', () => {
    const r = calcularRecibo(LEYDIS);
    expect(r.netoBs).toBe(126330);          // 150 × 842,20
    expect(r.tasa).toBe(842.2);
  });

  it('el sueldo en bolívares coincide con el de la planilla', () => {
    const r = calcularRecibo(LEYDIS);
    expect(r.reparto.sueldo).toBe(150);
    expect(aBs(r.reparto.sueldo, r.tasa)).toBe(126330);
  });

  it('las deducciones restan de la parte en bolívares', () => {
    const r = calcularRecibo({ ...LEYDIS, deducciones: { anticipos: 50, faov: 10 } });
    expect(r.totalDeduccionUsd).toBe(60);
    expect(r.netoUsd).toBe(90);             // 150 − 60
    expect(r.netoBs).toBe(75798);           // 90 × 842,20
    expect(r.totalRecibidoUsd).toBe(690);   // 90 + 600 de bono
  });

  it('bonos y viáticos extra suman al devengado de la tabla', () => {
    const r = calcularRecibo({ ...LEYDIS, bonosExtra: 25, viaticos: 15 });
    expect(r.totalDevengadoUsd).toBe(190);  // 150 + 25 + 15
    expect(r.totalRecibidoUsd).toBe(790);   // + 600 de bono
  });

  it('devengado menos deducción es el neto, siempre', () => {
    const r = calcularRecibo({ ...LEYDIS, bonosExtra: 33.33, deducciones: { prestamos: 11.11 } });
    expect(r.netoUsd).toBeCloseTo(r.totalDevengadoUsd - r.totalDeduccionUsd, 2);
  });

  it('trae los siete conceptos de deducción del recibo', () => {
    const r = calcularRecibo(LEYDIS);
    const deducciones = r.lineas.filter((l) => l.tipo === 'deduccion').map((l) => l.concepto);
    expect(deducciones).toHaveLength(CONCEPTOS_DEDUCCION.length);
    expect(deducciones).toContain('Seguro Social Obligatorio');
    expect(deducciones).toContain('Reg. Prest. de Vivienda y Hábitat');
  });

  it('una quincena sin días de descanso sigue cuadrando', () => {
    const r = calcularRecibo({ ...LEYDIS, diasTrabajados: 15, diasDescanso: 0 });
    expect(r.totalDevengadoUsd).toBe(150);
    expect(r.totalRecibidoUsd).toBe(750);
  });

  it('los renglones con monto son los dos de días (el bono ya no está)', () => {
    const r = calcularRecibo(LEYDIS);
    const vistos = lineasConMonto(r.lineas).map((l) => l.concepto);
    expect(vistos).toEqual(['Días trabajados', 'Días de descanso']);
  });
});
