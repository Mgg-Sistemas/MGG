import type { CorrelativoEstimado } from './retencionesFiscal.repository';

/** Texto que se ve en el campo de correlativo cuando la retención dio monto 0. */
export function vistaCorrelativoCero(estimado: CorrelativoEstimado | null): { valor: string; titulo: string; hint: string } {
  const estimadoTxt = estimado
    ? `Siguiente estimado: ${estimado.comprobante} (#${estimado.numero})`
    : 'Calculando el siguiente estimado…';
  return {
    valor: `Sin comprobante · retención en 0 · ${estimadoTxt}`,
    titulo: `El monto retenido es 0, así que no se consume la serie. ${estimadoTxt}. El número se asigna al guardar.`,
    hint: 'No consume correlativo porque el monto retenido es 0 (aunque el % sea mayor). El número mostrado es un estimado, no está reservado.',
  };
}
