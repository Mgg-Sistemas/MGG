/* ============================================================
   MGG · Retenciones · Impresión · «🖨 Ejemplo de impresión» (solo en local)

   Abre las mismas hojas y la misma VistaImpresion que con datos reales, con
   datos inventados (ejemplos.ts) y la marca «EJEMPLO»: los comprobantes de
   IVA, ISLR e ISAE y una relación de IVA de 30 líneas (para ver los cortes).
   Fuera de import.meta.env.DEV no se muestra: nada de esto llega a
   producción ni a la base.
   ============================================================ */

import { useState } from 'react';
import { comprobanteDeEjemplo, relacionDeEjemplo } from './ejemplos';
import { FORMATO_COMPROBANTE, FORMATO_FABRICA } from './formatos';
import { PaginaComprobante } from './HojasComprobante';
import { HojaRelacion, hojasDeRelacion } from './HojaRelacion';
import { nombreImagenComprobante, nombreImagenRelacion } from './imagen';
import { PreviaRelacion } from './PreviaRelacion';
import type { Impuesto } from './tipos';
import { VistaImpresion } from './VistaComprobante';
import './rv8-vista-comprobante.css';

type Ejemplo = Impuesto | 'relacion';
const OPCIONES: { id: Ejemplo; texto: string }[] = [
  { id: 'iva', texto: 'Comprobante de IVA' }, { id: 'islr', texto: 'Comprobante de ISLR' },
  { id: 'isae', texto: 'Comprobante de ISAE' }, { id: 'relacion', texto: 'Relación de IVA (30 líneas)' },
];

export function EjemploImpresion() {
  const [abierto, setAbierto] = useState(false);
  const [ejemplo, setEjemplo] = useState<Ejemplo | null>(null);
  if (!import.meta.env.DEV) return null;
  const relacion = relacionDeEjemplo();
  return (
    <div className="rv8-ejemplo-imp">
      <button type="button" className="btn btn-ghost" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>
        🖨 Ejemplo de impresión <small>· solo en local · datos inventados</small>
      </button>
      {abierto && (
        <span className="rv8-ejemplo-opciones">
          {OPCIONES.map((o) => <button key={o.id} type="button" className="btn btn-ghost" onClick={() => setEjemplo(o.id)}>{o.texto}</button>)}
        </span>
      )}
      {ejemplo && ejemplo !== 'relacion' && (
        <VistaImpresion titulo={`EJEMPLO · Comprobante de ${ejemplo === 'isae' ? 'ISAE' : ejemplo.toUpperCase()}`} marco ejemplo onCerrar={() => setEjemplo(null)}
          hoja={(o) => <PaginaComprobante datos={comprobanteDeEjemplo(ejemplo)} formato={FORMATO_FABRICA[FORMATO_COMPROBANTE[ejemplo]]} orientacion={o} />}
          imagen={{
            nombre: `ejemplo-${nombreImagenComprobante(ejemplo, comprobanteDeEjemplo(ejemplo).numero)}`,
            capturas: (o) => [<PaginaComprobante key="c" datos={comprobanteDeEjemplo(ejemplo)} formato={FORMATO_FABRICA[FORMATO_COMPROBANTE[ejemplo]]} orientacion={o} />],
          }} />
      )}
      {ejemplo === 'relacion' && (
        <VistaImpresion titulo="EJEMPLO · Relación de retenciones de IVA" marco={false} ejemplo onCerrar={() => setEjemplo(null)}
          hoja={(o) => <HojaRelacion datos={relacion} orientacion={o} />} previa={(o) => <PreviaRelacion datos={relacion} orientacion={o} />}
          imagen={{ nombre: `ejemplo-${nombreImagenRelacion('iva', relacion.desde)}`, capturas: (o) => hojasDeRelacion(relacion, o) }} />
      )}
    </div>
  );
}
