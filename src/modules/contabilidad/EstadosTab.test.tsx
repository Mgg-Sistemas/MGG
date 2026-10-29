/* Pruebas de componente sin navegador (render de servidor): la tabla de un estado financiero con la
   regla de una columna por importe y la equivalente debajo. Los números los prueban
   logica/estados.test.ts y, contra BD, simulacion/estadosBd.test.ts. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BalanceGeneralVista, TablaEstado } from './EstadosTab';
import { balanceGeneral, estadoConEquivalente } from './logica/estados';
import { estadoDePrueba } from './pruebas/datosPrueba';
import { ESTRUCTURA_PRUEBA } from './pruebas/estructuraPrueba';

const e = estadoDePrueba();
const f = { comprobantes: e.cont_comprobantes, lineas: e.cont_comprobante_lineas, cuentas: e.cont_cuentas };
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const filtro = { cortes: [{ etiqueta: 'Al 31/12/2026', hasta: '2026-12-31' }], ejercicios: e.cont_ejercicios, detallar: true };
const bg = estadoConEquivalente(
  balanceGeneral(f, ESTRUCTURA_PRUEBA, { ...filtro, moneda: 'USD' }),
  balanceGeneral(f, ESTRUCTURA_PRUEBA, { ...filtro, moneda: 'VES' }),
);

describe('Balance General en pantalla', () => {
  it('secciones, grupos, renglones, cuentas detalladas y los totales finales', () => {
    const t = texto(renderToStaticMarkup(<TablaEstado estado={bg} conCodigo moneda="USD" />));
    expect(t).toMatch(/Concepto Al 31\/12\/2026 ACTIVO ACTIVO CORRIENTE Efectivo/);
    expect(t).toMatch(/Resultado del ejercicio 3\.300,00 Bs /);
    expect(t).toMatch(/TOTAL PASIVO Y PATRIMONIO/);
    expect(t).toContain('1.1.01.01.002 · CAJA PRINCIPAL USD');
  });

  it('una sola columna por importe: la cifra en la moneda elegida y la equivalente debajo, tenue', () => {
    const html = renderToStaticMarkup(<TablaEstado estado={bg} conCodigo={false} moneda="USD" />);
    expect(html.match(/<th[ >]/g)).toHaveLength(2); // Concepto + una columna de importe
    expect(html).toContain('<span class="mono">3.300,00</span><span class="cont-equiv mono">Bs ');
    expect(html).not.toContain('1.1.01.01.002 · ');
  });

  it('el formulario trae fecha de corte, moneda y nivel de detalle', () => {
    const t = texto(renderToStaticMarkup(<BalanceGeneralVista parametros={e.cont_parametros} />));
    for (const campo of ['Fecha de Corte', 'Moneda', 'Nivel de Detalle', 'Renglones y cuentas', 'Incluir Código de Cuenta']) expect(t).toContain(campo);
  });
});
