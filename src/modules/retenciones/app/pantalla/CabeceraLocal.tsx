/* ============================================================
   MGG · Retenciones v8 · Lo de la cabecera que espera a la base

   Solo en local (import.meta.env.DEV), deshabilitado y marcado: la fila de
   botones de la cabecera de la maqueta v8 (Vencimientos, En otro sistema,
   «… conviven con otro sistema» y Pendientes de impresión y entrega; v7
   l. 5474, v8 l. 8262, v8-11-convivencia.js l. 138) y la tira «Período en
   curso» (`pintarTarjetasPeriodo`, R3-4, l. 7657). Sin la base de
   Retenciones (paquete 2.1) no hay vencimientos, períodos ni convivencia:
   en producción no se muestran.
   ============================================================ */

import { nombreImpuesto } from './pendientesPorDocumento';

const MARCA = 'Requiere la base de Retenciones (paquete 2.1)';

const lista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}` : xs[0] ?? '');

export function CabeceraLocal({ impuestos }: { impuestos: string[] }) {
  const nombres = impuestos.map(nombreImpuesto);
  return (
    <>
      <button type="button" className="btn btn-ghost rv8-chip-impresion" disabled title={MARCA}>Vencimientos <span className="rv8-badge-alerta">—</span></button>
      <button type="button" className="btn btn-ghost rv8-chip-impresion" disabled title={MARCA}>En otro sistema <span className="rv8-badge-alerta">—</span></button>
      {nombres.length > 0 && (
        <button type="button" className="btn btn-ghost rv8-v8-convive" disabled title={MARCA}>
          {lista(nombres)} {nombres.length > 1 ? 'conviven' : 'convive'} con otro sistema
        </button>
      )}
      <button type="button" className="btn btn-ghost rv8-chip-impresion" disabled title={MARCA}>Pendientes de impresión y entrega <span className="rv8-badge-alerta">—</span></button>
      <span className="rv8-huella">{MARCA.toLowerCase()}</span>
    </>
  );
}

export function PeriodoEnCurso({ impuestos }: { impuestos: string[] }) {
  return (
    <section className="rv8-periodos-curso" aria-label="Período en curso por impuesto">
      <div className="rv8-v8-curso">
        <button type="button" className="rv8-v8-curso-venc" disabled aria-label="Sin períodos vencidos: ver Períodos"><b>Sin</b><span>vencidos</span></button>
        <span className="rv8-v8-curso-t" id="rv8-curso-t">Período en curso</span>
        <ul className="rv8-v8-curso-lista" aria-labelledby="rv8-curso-t">
          {impuestos.map((k) => (
            <li key={k} className="rv8-v8-curso-chip rv8-pendiente"><b>{nombreImpuesto(k)}</b><span>falta el período en curso</span></li>
          ))}
        </ul>
        <button type="button" className="rv8-v8-curso-todos" disabled aria-label={`Ver los ${impuestos.length} impuestos en Períodos`}>Ver todo ({impuestos.length})</button>
      </div>
      <span className="rv8-huella">{MARCA.toLowerCase()}</span>
    </section>
  );
}
