/* ============================================================
   MGG · Retenciones v8 · Anular una retención

   Traslado de `dlg-anular` de la maqueta v8: el motivo es obligatorio, el
   número queda usado y no se repite, y la retención no se borra: queda en
   el libro como anulada, con su motivo. Guarda con la misma
   anularRetencion de la pantalla de hoy (retencionesFiscal.repository.ts),
   a través de la puerta. Una retención declarada no se anula desde aquí:
   la pantalla no ofrece el botón.
   ============================================================ */

import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { money } from '@/shared/lib/format';
import { usePuerta, type RetencionPracticada } from '../datos/puerta';
import { nombreImpuesto } from '../pantalla/pendientesPorDocumento';
import './registro.css';

interface Props {
  retencion: RetencionPracticada;
  onCerrar: () => void;
  onAnulada: () => void;
}

export function AnularDialogo({ retencion: r, onCerrar, onAnulada }: Props) {
  const puerta = usePuerta();
  const [motivo, setMotivo] = useState('');
  const [tocado, setTocado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorMotivo = !motivo.trim() ? 'Motivo de anulación requerido.' : null;

  const anular = async () => {
    setTocado(true);
    if (errorMotivo) return;
    setGuardando(true); setError(null);
    try {
      await puerta.anular(r.id, motivo.trim());
      onAnulada();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo anular la retención.');
    } finally {
      setGuardando(false);
    }
  };

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={guardando}>Cancelar</button>
      <button type="button" className="btn btn-primary" onClick={anular} disabled={guardando}>{guardando ? 'Anulando…' : 'Anular'}</button>
    </>
  );

  return (
    <Modal title="Anular la retención" size="sm" onClose={onCerrar} footer={footer}>
      <div className="ret-v8 v8-registro">
        <p className="v8-reg-sub">
          {nombreImpuesto(r.tipo)} · N° {r.numeroComprobante ?? 'sin número'} · {r.contraparteNombre ?? '—'} · {money(r.montoRetenido, r.moneda)}
        </p>
        <label className="campo">
          <span>Motivo de la anulación</span>
          <textarea className="texto" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-invalid={tocado && !!errorMotivo} />
          {tocado && errorMotivo && <small className="v8-reg-error" role="alert">{errorMotivo}</small>}
        </label>
        <p className="huella">El número queda usado y no se repite. La retención queda en el libro como anulada, con su motivo, y lo que faltaba vuelve a «Por realizar».</p>
        {error && <div className="aviso-error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
