/* ============================================================
   MGG · Retenciones v8 · «Registrar nota de crédito» (diálogo)

   El dlg-nota-credito de la maqueta (v8-12-decisiones-1014.js §4): el N° de la
   nota, el de control, la fecha, el monto total y el IVA, con lo pendiente
   antes de registrar. La nota se guarda con las columnas del paquete 07 de la
   base de Retenciones; hasta que existan, el diálogo solo se ve en local y el
   botón de registrar va desactivado con la marca 2.1.
   ============================================================ */

import { useState } from 'react';
import { money } from '@/shared/lib/format';
import { parseMontoEs } from '@/shared/lib/montoEs';
import { Modal } from '@/shared/ui/Modal';
import type { RetencionPracticada } from '../datos/puerta';
import { MarcaPaquete21 } from '../comun/MarcaPaquete21';
import { NOTA_NC, retencionDeNota, subtituloNota, validarNotaCredito, type DatosNota } from './notaCredito';
import './rv8-nota-credito.css';

const hoy = () => new Date().toLocaleDateString('en-CA');

export function NotaCreditoDialogo({ factura, onCerrar }: { factura: RetencionPracticada; onCerrar: () => void }) {
  const [d, setD] = useState<DatosNota>({ numero: '', control: '', fecha: hoy(), total: '', iva: '' });
  const [intento, setIntento] = useState(false);
  const cambiar = (c: Partial<DatosNota>) => setD((x) => ({ ...x, ...c }));
  const pendiente = validarNotaCredito(d, factura);
  const iva = parseMontoEs(d.iva);
  if (!import.meta.env.DEV) return null;

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
      <span className="rv8-con-marca">
        <button type="button" className="btn btn-primary" disabled>Registrar la nota de crédito</button><MarcaPaquete21 />
      </span>
    </>
  );
  return (
    <Modal title="Registrar nota de crédito" size="md" onClose={onCerrar} footer={footer}>
      <p className="rv8-nc-sub">{subtituloNota(factura)}</p>
      <p className="rv8-nc-nota">{NOTA_NC}</p>
      <div className="rv8-nc-form" onBlur={() => setIntento(true)}>
        <label className="rv8-nc-campo"><span>N° de la nota de crédito</span><input className="texto mono" value={d.numero} onChange={(e) => cambiar({ numero: e.target.value })} /></label>
        <label className="rv8-nc-campo"><span>N° de control</span><input className="texto mono" value={d.control} onChange={(e) => cambiar({ control: e.target.value })} /></label>
        <label className="rv8-nc-campo"><span>Fecha</span><input className="fecha" type="date" value={d.fecha} onChange={(e) => cambiar({ fecha: e.target.value })} /></label>
        <label className="rv8-nc-campo"><span>Monto total de la nota</span><input className="texto" inputMode="decimal" value={d.total} onChange={(e) => cambiar({ total: e.target.value })} /></label>
        <label className="rv8-nc-campo"><span>IVA de la nota</span><input className="texto" inputMode="decimal" value={d.iva} onChange={(e) => cambiar({ iva: e.target.value })} /></label>
      </div>
      {!pendiente && (
        <p className="rv8-nc-nota">
          Retención de IVA de la nota: {money(retencionDeNota(iva, factura.porcentaje), factura.moneda)} ({factura.porcentaje} % de su IVA). Resta en el Libro y en el TXT.
        </p>
      )}
      {intento && pendiente && <p className="rv8-nc-error" role="alert">{pendiente}</p>}
    </Modal>
  );
}
