/* Una estructura de estados financieros chica, con la misma forma que `estructura_ef` de BD
   (renglones por rubro o por cuenta, signo, especial, grupos y subtotales), sobre el plan de
   cuentas de pruebas/datosPrueba.ts. */
import type { EstructuraEF, RenglonEF } from '../logica/estados';

const r = (codigo: string, nombre: string, rubros: string[], signo: 1 | -1, cuentas: string[] = [], especial: RenglonEF['especial'] = null): RenglonEF =>
  ({ codigo, nombre, rubros, cuentas, signo, especial });

export const ESTRUCTURA_PRUEBA: EstructuraEF = {
  balance_general: {
    titulo: 'Balance General',
    secciones: [
      { nombre: 'ACTIVO', grupos: [
        { nombre: 'ACTIVO CORRIENTE', renglones: [
          r('A-01', 'Efectivo', ['efectivo'], 1), r('A-02', 'Cuentas por cobrar', ['cxc_comerciales', 'otras_cxc'], 1),
          r('A-03', 'Inventarios', ['inventarios'], 1), r('A-04', 'Impuestos por recuperar', ['impuestos_por_recuperar'], 1),
        ] },
        { nombre: 'ACTIVO NO CORRIENTE', renglones: [r('A-05', 'Propiedad, planta y equipo', ['ppe'], 1)] },
      ] },
      { nombre: 'PASIVO', grupos: [
        { nombre: 'PASIVO CORRIENTE', renglones: [
          r('P-01', 'Cuentas por pagar', ['cxp_comerciales', 'otras_cxp'], -1),
          r('P-02', 'Impuestos y obligaciones laborales', ['impuestos_por_pagar', 'obligaciones_laborales'], -1),
        ] },
        { nombre: 'PASIVO NO CORRIENTE', renglones: [r('P-03', 'Préstamos', ['prestamos'], -1)] },
      ] },
      { nombre: 'PATRIMONIO', grupos: [{ nombre: 'PATRIMONIO', renglones: [
        r('K-01', 'Capital', ['capital'], -1),
        r('K-02', 'Utilidades acumuladas', [], -1, ['3.2.01.01.001']),
        r('K-03', 'Resultado del ejercicio', [], -1, ['3.2.01.01.002'], 'mas_resultado_del_periodo'),
      ] }] },
    ],
    totales: { 'TOTAL ACTIVO': ['ACTIVO'], 'TOTAL PASIVO': ['PASIVO'], 'TOTAL PATRIMONIO': ['PATRIMONIO'], 'TOTAL PASIVO Y PATRIMONIO': ['PASIVO', 'PATRIMONIO'] },
  },
  estado_resultados: {
    titulo: 'Estado de Resultados',
    secciones: [
      { nombre: 'INGRESOS', signo_total: 1, renglones: [r('R-01', 'Ventas', ['ventas'], -1)] },
      { nombre: 'COSTOS', signo_total: -1, renglones: [r('R-02', 'Costo de ventas', ['costo_ventas'], 1)] },
      { subtotal: 'UTILIDAD BRUTA', de: ['INGRESOS', 'COSTOS'] },
      { nombre: 'EGRESOS', signo_total: -1, renglones: [r('R-03', 'Personal', ['gastos_personal'], 1), r('R-04', 'Generales', ['gastos_generales'], 1)] },
      { subtotal: 'RESULTADO OPERATIVO', de: ['INGRESOS', 'COSTOS', 'EGRESOS'] },
      { nombre: 'OTROS INGRESOS Y EGRESOS', signo_total: 1, renglones: [r('R-05', 'Otros ingresos', ['otros_ingresos'], -1), r('R-06', 'Gastos financieros', ['gastos_financieros'], -1)] },
      { subtotal: 'RESULTADO DEL EJERCICIO', de: ['INGRESOS', 'COSTOS', 'EGRESOS', 'OTROS INGRESOS Y EGRESOS'] },
    ],
  },
};
