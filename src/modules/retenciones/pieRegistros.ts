/* ============================================================
   MGG · Retenciones · El pie de la tarjeta «Registros» del libro fiscal (D14 a)

   Decía «Todos con comprobante» siempre que no hubiera anuladas, aunque una
   retención que le practicaron a la empresa no tuviera todavía el PDF que
   entrega el cliente (el soporte de ese crédito fiscal). Ahora cuenta lo que
   falta. Es la misma regla que la marca «Sin PDF» de cada fila: solo las
   recibidas; el comprobante de las practicadas lo emite la empresa.
   ============================================================ */

export interface FilaPie {
  anulada: boolean;
  direccion: string;
  comprobantePath: string | null;
}

export function pieRegistros(filas: FilaPie[]): string {
  if (!filas.length) return 'Sin registros en el período';
  const anulados = filas.filter((f) => f.anulada).length;
  const sinPdf = filas.filter((f) => !f.anulada && f.direccion === 'recibida' && !f.comprobantePath).length;
  const partes: string[] = [];
  if (sinPdf) partes.push(`${sinPdf} sin el PDF del cliente`);
  if (anulados) partes.push(`${anulados} anulada${anulados === 1 ? '' : 's'} aparte`);
  return partes.length ? partes.join(' · ') : 'Todos con comprobante';
}
