import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useSession } from '@/modules/auth/authStore';
import { toast } from '@/shared/ui/Toast';
import { num as fmtNum } from '@/shared/lib/format';
import { solicitarCompraDeOrden, type OrdenServicio } from './flota.repository';

/**
 * «🛒 Pedir compra» de una orden que requiere repuestos:
 * Los repuestos pasan directamente a Pedidos (Compras) con sus nombres generales.
 * No se crean productos en el inventario; el analista de compras colocará el nombre real.
 */
export function PedirCompraModal({ orden, onClose, onDone }: { orden: OrdenServicio; onClose: () => void; onDone: () => void }) {
  const { appUser } = usePermissions();
  const { user } = useSession();
  const actor = { email: user?.email ?? 'sistema', nombre: appUser?.nombre ?? null };
  const porComprar = orden.repuestos.filter((r) => r.a_comprar > 0);
  const [saving, setSaving] = useState(false);

  async function pedir() {
    setSaving(true);
    try {
      const codigo = await solicitarCompraDeOrden(orden, actor);
      toast(`${orden.codigo}: solicitud de pedido ${codigo} creada.`, 'success');
      onDone();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : (e as { message?: string })?.message || 'No se pudo pedir la compra', 'error');
    } finally { setSaving(false); }
  }

  return (
    <Modal title={`🛒 Pedir compra · ${orden.codigo}`} size="md" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void pedir()} disabled={saving || !porComprar.length}>
          {saving ? 'Pidiendo…' : 'Crear solicitud de pedido'}
        </button>
      </>}>
      <div className="flo" style={{ display: 'grid', gap: '.75rem' }}>
        <p className="muted" style={{ margin: 0, fontSize: '.84rem' }}>
          Lo que falta entra a <strong>Pedidos</strong> como solicitud de pedido. Los productos no se guardan en el inventario: el analista de compras colocará el nombre comercial exacto, el cual se sincronizará para los próximos servicios.
        </p>
        <div style={{ display: 'grid', gap: '.4rem' }}>
          {porComprar.map((n, i) => (
            <div key={`${n.nombre}-${i}`} className="flo-linea">
              <div className="flo-linea-top">
                <div>
                  <strong>{n.nombre}</strong>
                  <small>{fmtNum(n.a_comprar)} {n.unidad} a comprar</small>
                </div>
                <span className="flo-chip tone-primary">🛒 Para compras</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
