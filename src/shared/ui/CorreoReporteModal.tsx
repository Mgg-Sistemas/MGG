import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Modal genérico para enviar un reporte por correo, con el formato estándar del
 * sistema: pre-selecciona el correo del usuario logueado («Tu correo») y permite
 * agregar un correo adicional. `onEnviar` recibe la lista final de destinatarios
 * y debe devolver a quiénes se envió (para el aviso de éxito).
 */
export function CorreoReporteModal({ titulo, descripcion, defaultEmail, onEnviar, onClose }: {
  titulo: string;
  descripcion?: string;
  defaultEmail: string;
  onEnviar: (emails: string[]) => Promise<string[]>;
  onClose: () => void;
}) {
  const propio = defaultEmail.trim().toLowerCase();
  const [incluirPropio, setIncluirPropio] = useState(!!propio);
  const [extra, setExtra] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function handleEnviar() {
    const lista: string[] = [];
    if (incluirPropio && propio) lista.push(propio);
    const extraClean = extra.trim().toLowerCase();
    if (extraClean) {
      if (!EMAIL_RX.test(extraClean)) { toast('El correo adicional no es válido', 'error'); return; }
      if (!lista.includes(extraClean)) lista.push(extraClean);
    }
    if (!lista.length) { toast('Marcá al menos un destinatario', 'error'); return; }
    setEnviando(true);
    try {
      const enviados = await onEnviar(lista);
      toast(`Enviado a: ${(enviados.length ? enviados : lista).join(', ')}`, 'success');
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo enviar', 'error');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal title={titulo} size="md" onClose={() => !enviando && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={enviando}>Cancelar</button>
        <button className="btn btn-primary" onClick={handleEnviar} disabled={enviando}>{enviando ? 'Enviando…' : '📧 Enviar'}</button>
      </>
    }>
      {descripcion && <p className="muted" style={{ marginTop: 0, fontSize: '.88rem' }}>{descripcion}</p>}

      <label style={{
        display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.7rem .85rem',
        border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
        background: incluirPropio ? 'rgba(255,138,0,0.06)' : 'transparent',
        cursor: propio ? 'pointer' : 'not-allowed', marginBottom: '.6rem',
      }}>
        <input type="checkbox" checked={incluirPropio} disabled={!propio} onChange={(e) => setIncluirPropio(e.target.checked)} />
        <div>
          <div style={{ fontWeight: 600 }}>Tu correo</div>
          <div className="mono" style={{ fontSize: '.82rem' }}>{propio || '— sin correo —'}</div>
        </div>
      </label>

      <div className="form-row" style={{ marginTop: '.4rem' }}>
        <label>Correo adicional (opcional)</label>
        <input className="input" type="email" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="otro@correo.com" maxLength={120} />
        <small className="muted">Podés mandarlo a un segundo destinatario al mismo tiempo.</small>
      </div>
    </Modal>
  );
}
