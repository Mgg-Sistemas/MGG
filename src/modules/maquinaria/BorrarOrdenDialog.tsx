import { ConfirmDialog } from '@/shared/ui/Modal';
import { VistaPrevia, Dato } from '@/shared/ui/VistaPrevia';
import { toast } from '@/shared/ui/Toast';
import { num as fmtNum, date as fmtDate } from '@/shared/lib/format';
import { ORDEN_ESTADOS, ordenAbierta, servicioPorId } from './flota';
import { eliminarOrdenServicio, type OrdenServicio } from './flota.repository';

/**
 * Confirmación para borrar una orden de servicio (hay que escribir su código). Explica qué
 * pasa con el equipo, las fotos y lo que se pidió. Una orden realizada (traza completa)
 * solo la borra un administrador: la base lo exige aunque se llegue aquí.
 */
export function BorrarOrdenDialog({ orden, equipo, salida, compra, onClose, onDone }: {
  orden: OrdenServicio;
  equipo: string | null | undefined;
  /** Código de la salida / pedido vinculados, si los hay (no se cancelan solos). */
  salida?: string | null;
  compra?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const s = servicioPorId(orden.tipo);
  const enCurso = ordenAbierta(orden.estado);
  const vinculos = [salida ? `la salida ${salida}` : null, compra ? `el pedido ${compra}` : null].filter(Boolean).join(' y ');
  return (
    <ConfirmDialog title={`Borrar orden ${orden.codigo}`} danger confirmText="Borrar orden" requireText={orden.codigo}
      requireLabel={`Escribe ${orden.codigo} para confirmar`}
      message={
        <div style={{ display: 'grid', gap: '.45rem' }}>
          <span>Se borra la orden con sus fotos. No se puede deshacer; queda registrada en la auditoría.</span>
          {enCurso && <span>Si es la única orden abierta del equipo, el equipo <strong>vuelve al estado que tenía antes de abrirla</strong>.</span>}
          {orden.estado === 'realizada' && <span>⚠️ El servicio ya se realizó (traza completa): <strong>solo un administrador puede borrarla</strong>. La anotación en la bitácora y el reinicio del contador no se deshacen.</span>}
          {vinculos && <span>Lo que se pidió ({vinculos}) no se cancela solo: si ya no hace falta, cancélalo en Salidas / Pedidos.</span>}
        </div>
      }
      preview={
        <VistaPrevia>
          <Dato label="Orden">{orden.codigo}</Dato>
          <Dato label="Equipo">{equipo ?? undefined}</Dato>
          <Dato label="Servicio">{s?.label ?? orden.tipo}</Dato>
          <Dato label="Estado">{ORDEN_ESTADOS[orden.estado]?.label ?? orden.estado}</Dato>
          <Dato label="Abierta">{fmtDate(orden.created_at)}{orden.actor_name ? ` · ${orden.actor_name}` : ''}</Dato>
          <Dato label="Repuestos">{orden.repuestos.length ? orden.repuestos.map((r) => `${fmtNum(r.cantidad)} ${r.unidad} ${r.nombre}`).join(' · ') : undefined}</Dato>
        </VistaPrevia>
      }
      onCancel={onClose}
      onConfirm={() => {
        onClose();
        void eliminarOrdenServicio(orden)
          .then(() => { toast(`Orden ${orden.codigo} borrada`, 'success'); onDone(); })
          .catch((e) => toast(e instanceof Error ? e.message : (e as { message?: string })?.message || 'No se pudo borrar la orden', 'error'));
      }} />
  );
}
