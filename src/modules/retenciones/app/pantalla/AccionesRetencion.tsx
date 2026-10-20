/* ============================================================
   MGG · Retenciones v8 · Las acciones de una retención

   Las de la maqueta que funcionan hoy, en el mismo orden:
   · «🖨 Comprobante»: el comprobante de una retención practicada (el PDF
     de hoy, verComprobanteRetencionPdf);
   · «📎 Archivo»: el archivo adjunto (el comprobante subido, o el PDF del
     cliente en las recibidas);
   · «Adjuntar»: subir el archivo después, si no lo tiene (solo con
     escritura);
   · «Anular» (solo con escritura, y solo si está registrada).
   Ver no escribe nada; adjuntar y anular llegan como acciones de la raíz.
   ============================================================ */

import { useRef } from 'react';
import { toast } from '@/shared/ui/Toast';
import { usePuerta, type RetencionPracticada } from '../datos/puerta';
import { nombreImpuesto } from './pendientesPorDocumento';
import { estadoDe } from './realizadasYLibro';

interface Props {
  r: RetencionPracticada;
  onAnular?: (r: RetencionPracticada) => void;
  onAdjuntar?: (r: RetencionPracticada, archivo: File) => void;
  /** En Realizadas, botones cortos al lado de cada retención. */
  corto?: boolean;
  /** Sin «🖨 Comprobante»: en Realizadas va en la columna de acciones de la factura («🖨 IVA»). */
  sinComprobante?: boolean;
}

export function AccionesRetencion({ r, onAnular, onAdjuntar, corto, sinComprobante }: Props) {
  const puerta = usePuerta();
  const input = useRef<HTMLInputElement>(null);
  const estado = estadoDe(r);
  const nombre = `${nombreImpuesto(r.tipo)} N° ${r.numeroComprobante ?? 'sin número'}`;
  const intentar = (f: () => Promise<void>, error: string) => () => {
    f().catch((e: unknown) => toast(e instanceof Error ? e.message : error, 'error'));
  };

  return (
    <>
      {!sinComprobante && r.direccion === 'practicada' && estado !== 'anulada' && (
        <button type="button" className="mini" aria-label={`Comprobante ${nombre}`}
          onClick={intentar(() => puerta.verComprobante(r), 'No se pudo generar el comprobante.')}>
          🖨{corto ? '' : ' Comprobante'}
        </button>
      )}
      {r.comprobantePath && (
        <button type="button" className="mini" title={r.comprobanteNombre ?? 'Archivo adjunto'} aria-label={`Archivo de ${nombre}`}
          onClick={intentar(() => puerta.verArchivo(r), 'No se pudo abrir el archivo.')}>
          📎{corto ? '' : ' Archivo'}
        </button>
      )}
      {!r.comprobantePath && onAdjuntar && estado !== 'anulada' && (
        <>
          <button type="button" className="mini" aria-label={`Adjuntar el comprobante de ${nombre}`} onClick={() => input.current?.click()}>Adjuntar</button>
          <input ref={input} type="file" accept="application/pdf,image/*" hidden
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onAdjuntar(r, f); }} />
        </>
      )}
      {onAnular && estado === 'registrada' && (
        <button type="button" className="mini" aria-label={`Anular ${nombre}`} onClick={() => onAnular(r)}>Anular</button>
      )}
    </>
  );
}
