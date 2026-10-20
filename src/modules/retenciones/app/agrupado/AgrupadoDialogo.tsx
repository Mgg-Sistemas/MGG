/* ============================================================
   MGG · Retenciones v8 · «Comprobante agrupado» (diálogo)

   El dlg-agrupado de la maqueta (v8, abrirAgrupado; v8-12 §3): la nota, la
   vista del comprobante con una línea por factura y su total, lo que impide
   agrupar y «Emitir comprobante agrupado». Lo abre la barra de selección de
   la Vista agrupada.
   Emitir necesita la base de Retenciones (M1): sin onEmitir, el botón va
   desactivado con la marca 2.1. Sin la capacidad, solo en local.
   ============================================================ */

import { useState } from 'react';
import { money } from '@/shared/lib/format';
import { Modal } from '@/shared/ui/Modal';
import { MarcaPaquete21 } from '../comun/MarcaPaquete21';
import { fechaVe } from '../impresion/numeros';
import { NOTA_AGRUPADO, lineasAgrupado, subtituloAgrupado, validarAgrupado, type ItemAgrupado } from './comprobanteAgrupado';
import './rv8-agrupado.css';

export interface PropsAgrupado {
  items: ItemAgrupado[];
  /** El interruptor «Agrupar comprobantes» (ficha del IVA › Interruptores propios). */
  encendido: boolean;
  /** La base tiene el agrupado (capacidad): se muestra también en producción. */
  disponible?: boolean;
  onEmitir?: () => Promise<void>;
  onCerrar: () => void;
}

export function AgrupadoDialogo(props: PropsAgrupado) {
  if (!import.meta.env.DEV && !props.disponible) return null;
  return <Dialogo {...props} />;
}

function Dialogo({ items, encendido, onEmitir, onCerrar }: PropsAgrupado) {
  const [emitiendo, setEmitiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const impide = validarAgrupado(items, encendido);
  const { lineas, total } = lineasAgrupado(items);
  const x0 = items[0];
  const m = (n: number) => money(n, x0?.moneda);

  const emitir = () => {
    if (!onEmitir) return;
    setEmitiendo(true); setError(null);
    onEmitir().then(onCerrar)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo emitir el comprobante agrupado.'))
      .finally(() => setEmitiendo(false));
  };

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
      {onEmitir
        ? <button type="button" className="btn btn-primary" disabled={!!impide || emitiendo} onClick={emitir}>{emitiendo ? 'Emitiendo…' : 'Emitir comprobante agrupado'}</button>
        : <span className="rv8-con-marca"><button type="button" className="btn btn-primary" disabled>Emitir comprobante agrupado</button><MarcaPaquete21 /></span>}
    </>
  );

  return (
    <Modal title="Comprobante agrupado" size="lg" onClose={onCerrar} footer={footer}>
      <p className="rv8-ag-sub">{subtituloAgrupado(items)}</p>
      <p className="rv8-ag-nota">{NOTA_AGRUPADO}</p>
      {x0 && (
        <div className="rv8-ag-doc">
          <h3>Comprobante de retención de IVA</h3>
          <p>Sujeto retenido: {x0.proveedorNombre} ({x0.rif}) · N° asignado al emitir</p>
          <div className="rv8-ag-scroll">
            <table>
              <thead><tr><th>Factura</th><th>Fecha</th><th className="n">Base imponible</th><th className="n">IVA</th><th className="n">%</th><th className="n">Retenido</th></tr></thead>
              <tbody>
                {lineas.map((l) => (
                  <tr key={l.clave}><td>{l.factura}</td><td>{fechaVe(l.fecha)}</td><td className="n">{m(l.base)}</td><td className="n">{m(l.iva)}</td>
                    <td className="n">{l.pct == null ? 'varios' : String(l.pct).replace('.', ',')}</td><td className="n">{m(l.retenido)}</td></tr>
                ))}
                <tr className="tot"><td colSpan={2}>Total</td><td className="n">{m(total.base)}</td><td className="n">{m(total.iva)}</td><td /><td className="n">{m(total.retenido)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
      {impide && <p className="rv8-ag-error" role="alert">{impide}</p>}
      {error && <p className="rv8-ag-error" role="alert">{error}</p>}
    </Modal>
  );
}
