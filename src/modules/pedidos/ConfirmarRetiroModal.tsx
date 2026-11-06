/* ============================================================
   MGG · Compras · Confirmar el retiro de una OC pagada (06-11-2026)
   La OC pagada espera en «Pendientes por recibir». El analista confirma que se va a
   retirar y quién entrega: Delivery, Carga pesada o Con entrega a domicilio (la trae el
   proveedor). Recién entonces le llega a la flota que toca.
   ============================================================ */
import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import type { Orden } from '@/shared/lib/types';
import { OPCIONES_ENTREGA, type EntregaModalidad } from './entregaModalidad';
import { confirmarRetiroOc } from './pedidos.repository';

export function ConfirmarRetiroModal({ orden, proveedorNombre, actorEmail, onClose, onHecho }: {
  orden: Orden;
  proveedorNombre?: string | null;
  actorEmail: string;
  onClose: () => void;
  onHecho: (o: Orden) => void;
}) {
  // Lo que se indicó al pagar viene marcado; el analista lo confirma o lo cambia.
  const [modalidad, setModalidad] = useState<EntregaModalidad | null>(orden.entrega_modalidad ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codigo = orden.oc_codigo ?? orden.codigo;

  async function confirmar() {
    if (!modalidad) { setError('Indica quién entrega: Delivery, Carga pesada o Con entrega a domicilio.'); return; }
    setSaving(true); setError(null);
    try {
      onHecho(await confirmarRetiroOc(orden, modalidad, actorEmail));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo confirmar el retiro');
      setSaving(false);
    }
  }

  return (
    <Modal title={`Confirmar retiro · ${codigo}`} size="md" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button className="btn btn-primary" onClick={() => void confirmar()} disabled={saving || !modalidad}>
        {saving ? 'Guardando…' : '✓ Confirmar retiro'}
      </button>
    </>}>
      <div className="aviso info" style={{ marginBottom: '.8rem' }}>
        <span className="aviso-icono">ℹ</span>
        <div>
          La orden{proveedorNombre ? <> de <strong>{proveedorNombre}</strong></> : null} ya está pagada. Al confirmar, le llega a
          {' '}<strong>Delivery</strong> o a <strong>Carga pesada</strong> para retirarla. Con entrega a domicilio no va a ninguna:
          la trae el proveedor y se recibe en el almacén.
        </div>
      </div>
      <div className="form-row">
        <label>¿Quién entrega? *</label>
        <div style={{ display: 'grid', gap: '.45rem' }}>
          {OPCIONES_ENTREGA.map((op) => (
            <label key={op.value} className="card" style={{ margin: 0, padding: '.6rem .8rem', display: 'flex', gap: '.6rem', alignItems: 'flex-start', cursor: 'pointer',
              borderColor: modalidad === op.value ? 'var(--primary)' : undefined }}>
              <input type="radio" name="retiro-modalidad" checked={modalidad === op.value} onChange={() => setModalidad(op.value)} style={{ marginTop: '.2rem' }} />
              <span>
                <strong>{op.icono} {op.label}</strong>
                <span className="muted" style={{ display: 'block', fontSize: '.8rem' }}>{op.ayuda}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      {error && <p style={{ color: 'var(--danger)', fontSize: '.85rem' }}>{error}</p>}
    </Modal>
  );
}
