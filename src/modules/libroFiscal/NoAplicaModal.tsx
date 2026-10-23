/* ============================================================
   Golden Touch · Retenciones · Ficha «No aplica» (D48)

   Para un impuesto de una compra al que no le corresponde retención: el
   motivo (de Parámetros › Motivos, o escrito si la lista está vacía) y un
   detalle. No gasta número de comprobante ni pide N° de factura.
   ============================================================ */
import { useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { hoyVE } from '@/modules/tesoreria/tasas.repository';
import { motivosVigentes, type MotivoNoAplica } from './motivosSupuestos.repository';
import { marcarNoAplica } from './noAplica.repository';

export interface ObjetivoNoAplica {
  ordenId: string;
  codigo: string;
  proveedorId: string | null;
  proveedorNombre: string | null;
  moneda: string;
  total: number | null;
  impuestoClave: string;
  /** Cómo se llama el impuesto para el usuario (IVA, ISLR, ISAE…). */
  impuestoNombre: string;
}

export function NoAplicaModal({ objetivo: o, actor, actorName, onClose, onHecho }: {
  objetivo: ObjetivoNoAplica; actor: string; actorName: string | null;
  onClose: () => void; onHecho: () => void;
}) {
  const [motivos, setMotivos] = useState<MotivoNoAplica[] | null>(null);
  const [motivoId, setMotivoId] = useState('');
  const [motivoTexto, setMotivoTexto] = useState('');
  const [detalle, setDetalle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    motivosVigentes(o.impuestoClave, hoyVE())
      .then((m) => { if (vivo) setMotivos(m); })
      .catch(() => { if (vivo) setMotivos([]); });
    return () => { vivo = false; };
  }, [o.impuestoClave]);

  const elegido = motivos?.find((m) => m.id === motivoId) ?? null;

  async function guardar() {
    setError(null);
    if (!motivoId && !motivoTexto.trim()) { setError('Indica el motivo: por qué no corresponde retener.'); return; }
    if (elegido?.requiereTexto && !detalle.trim()) { setError(`El motivo «${elegido.texto}» pide un detalle.`); return; }
    setGuardando(true);
    try {
      await marcarNoAplica({
        ordenId: o.ordenId, proveedorId: o.proveedorId, proveedorNombre: o.proveedorNombre,
        moneda: o.moneda, total: o.total, impuestoClave: o.impuestoClave,
        motivoId: motivoId || null, motivoTexto: motivoId ? null : motivoTexto, detalle, actor, actorName,
      });
      toast(`${o.impuestoNombre} de ${o.codigo}: marcado «no aplica».`, 'success');
      onHecho();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
      setGuardando(false);
    }
  }

  return (
    <Modal title={`No aplica · ${o.impuestoNombre} · ${o.codigo}`} onClose={onClose}
      footer={<>
        {error && <small style={{ color: 'var(--danger)', marginRight: 'auto', maxWidth: '60%' }}>No se guardó: {error}</small>}
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
        <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={guardando}>{guardando ? 'Guardando…' : 'Marcar «no aplica»'}</button>
      </>}>
      <p className="muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        A esta compra no le corresponde retención de {o.impuestoNombre}. No se emite comprobante ni se usa un número;
        queda anotado con su motivo y sale de «Por realizar» para este impuesto.
      </p>
      <div className="form-row">
        <label>Motivo</label>
        {motivos === null && <small className="muted">Leyendo los motivos…</small>}
        {motivos && motivos.length > 0 && (
          <select className="select" value={motivoId} onChange={(e) => setMotivoId(e.target.value)}>
            <option value="">— Elige el motivo —</option>
            {motivos.map((m) => <option key={m.id} value={m.id}>{m.texto}</option>)}
            <option value="">Otro (escribirlo)</option>
          </select>
        )}
        {motivos && (motivos.length === 0 || !motivoId) && (
          <input className="input" value={motivoTexto} onChange={(e) => setMotivoTexto(e.target.value)}
            placeholder="Ej.: no es documento fiscal (nota de entrega), proveedor exento…" style={{ marginTop: '.3rem' }} />
        )}
        {motivos && motivos.length === 0 && (
          <small className="hint muted">No hay motivos cargados para este impuesto. Se pueden cargar en Parámetros › Motivos de «No aplica».</small>
        )}
      </div>
      <div className="form-row">
        <label>Detalle {elegido?.requiereTexto ? '(obligatorio)' : '(opcional)'}</label>
        <textarea className="input" rows={2} value={detalle} onChange={(e) => setDetalle(e.target.value)} />
      </div>
    </Modal>
  );
}
