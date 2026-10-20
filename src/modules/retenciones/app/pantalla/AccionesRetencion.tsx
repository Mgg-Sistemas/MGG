/* ============================================================
   MGG · Retenciones v8 · Las acciones de una retención

   Las de la maqueta que funcionan hoy, en el mismo orden:
   · «🖨 Comprobante»: el comprobante de una retención practicada (el PDF
     de hoy, verComprobanteRetencionPdf);
   · «📎 Archivo»: el archivo adjunto de la practicada; en las recibidas,
     «📎 PDF del cliente», o la marca «Sin PDF» (rotulosArchivo.ts);
   · «Adjuntar» si no lo tiene; en las recibidas, «Adjuntar PDF» o
     «Reemplazar PDF» (solo con escritura);
   · «Anular» (solo con escritura, y solo si está registrada).
   Ver no escribe nada; adjuntar y anular llegan como acciones de la raíz.
   ============================================================ */

import { useRef } from 'react';
import { toast } from '@/shared/ui/Toast';
import { usePuerta, type RetencionPracticada } from '../datos/puerta';
import { nombreImpuesto } from './pendientesPorDocumento';
import { estadoDe } from './realizadasYLibro';
import { rotulosArchivo } from './rotulosArchivo';

interface Props {
  r: RetencionPracticada;
  onAnular?: (r: RetencionPracticada) => void;
  onAdjuntar?: (r: RetencionPracticada, archivo: File) => void;
  /** En Realizadas, botones cortos al lado de cada retención. */
  corto?: boolean;
  /** Sin «🖨 Comprobante»: en Realizadas va en la columna de acciones de la factura («🖨 IVA»). */
  sinComprobante?: boolean;
  /** Abre el comprobante (la hoja fiel). Sin ella, el PDF de hoy. */
  onComprobante?: (r: RetencionPracticada) => Promise<void>;
}

export function AccionesRetencion({ r, onAnular, onAdjuntar, corto, sinComprobante, onComprobante }: Props) {
  const puerta = usePuerta();
  const input = useRef<HTMLInputElement>(null);
  const estado = estadoDe(r);
  const nombre = `${nombreImpuesto(r.tipo)} N° ${r.numeroComprobante ?? 'sin número'}`;
  const intentar = (f: () => Promise<void>, error: string) => () => {
    f().catch((e: unknown) => toast(e instanceof Error ? e.message : error, 'error'));
  };

  const recibida = r.direccion === 'recibida';
  const rotulos = rotulosArchivo({ direccion: r.direccion, tieneArchivo: !!r.comprobantePath, anulada: estado === 'anulada' });

  return (
    <>
      {!sinComprobante && r.direccion === 'practicada' && estado !== 'anulada' && (
        <button type="button" className="mini" aria-label={`Comprobante ${nombre}`}
          onClick={intentar(() => (onComprobante ? onComprobante(r) : puerta.verComprobante(r)), 'No se pudo generar el comprobante.')}>
          🖨{corto ? '' : ' Comprobante'}
        </button>
      )}
      {rotulos.ver && (
        <button type="button" className="mini" title={r.comprobanteNombre ?? 'Archivo adjunto'} aria-label={`Archivo de ${nombre}`}
          onClick={intentar(() => puerta.verArchivo(r), 'No se pudo abrir el archivo.')}>
          {corto && !recibida ? '📎' : rotulos.ver}
        </button>
      )}
      {rotulos.sinArchivo && <span className="pill">{rotulos.sinArchivo}</span>}
      {rotulos.adjuntar && onAdjuntar && (
        <>
          <button type="button" className="mini" aria-label={`${rotulos.adjuntar}: ${nombre}`} onClick={() => input.current?.click()}>{rotulos.adjuntar}</button>
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
