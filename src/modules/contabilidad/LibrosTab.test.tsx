/* Pruebas de componente sin navegador (render de servidor): el armazón de los informes.
   Los números los prueban logica/reportes.test.ts y el oráculo de simulacion/datosBd.test.ts. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BalancesTab, EncabezadoInforme, InformesTab } from './LibrosTab';
import { estadoDePrueba } from './pruebas/datosPrueba';

const p = estadoDePrueba().cont_parametros;
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('libros y balances', () => {
  it('el encabezado impreso de Galac: compañía, título, rango y moneda', () => {
    const t = texto(renderToStaticMarkup(<EncabezadoInforme empresa="MINERA EJEMPLO" titulo="Balance de Comprobación" rango="Del 01 jul. 2026 al 31 jul. 2026" moneda="USD" />));
    expect(t).toMatch(/MINERA EJEMPLO Balance de Comprobación Del 01 jul\. 2026 al 31 jul\. 2026 Expresado en Dólares/);
  });

  it('Balances ofrece Balance de Comprobación y Mayor Analítico, con los parámetros de Galac', () => {
    const t = texto(renderToStaticMarkup(<BalancesTab parametros={p} />));
    expect(t).toMatch(/Balance de Comprobación Mayor Analítico/);
    for (const campo of ['Fecha de Inicio', 'Fecha de Corte', 'Nivel de Detalle', 'Incluir Código de Cuenta', 'Cuentas sin Movimiento']) expect(t).toContain(campo);
  });

  it('Informes ofrece el Diario de Comprobantes y dice que solo entran los contabilizados', () => {
    const t = texto(renderToStaticMarkup(<InformesTab parametros={p} />));
    expect(t).toContain('Diario de Comprobantes');
    expect(t).toContain('los descuadrados no entran en el libro');
  });
});
