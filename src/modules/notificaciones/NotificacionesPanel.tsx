import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { relTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { listLatest, markAllRead, markRead, pruneOld } from './notif.repository';
import type { Notificacion } from '@/shared/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onAllRead: () => void;
}

const KIND_ICON: Record<string, string> = {
  success: '✓',
  warning: '⚠',
  error: '🚨',
  info: '◔',
};

export function NotificacionesPanel({ open, onClose, onAllRead }: Props) {
  const [items, setItems] = useState<Notificacion[]>([]);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);
  const navigate = useNavigate();

  // Al hacer click en una notificación: la marca leída, va a su módulo/detalle y cierra.
  function abrir(n: Notificacion) {
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      void markRead(n.id);
    }
    if (n.link) {
      const destino = n.link.startsWith('#') ? n.link.slice(1) : n.link;
      navigate(destino);
    }
    onClose();
  }

  // Mostramos solo las 10 más recientes y, en segundo plano, borramos las viejas
  // (DELETE es admin-only: si no sos admin simplemente no borra nada).
  const cargar = useCallback(() => {
    if (!open) return;
    setLoading(true);
    listLatest(10)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    cargar();
    pruneOld(10).catch(() => { /* sin permiso (no-admin) o sin red: se ignora */ });
  }, [open, cargar]);
  // Realtime: la lista se actualiza en vivo si entra una notificación nueva.
  useRealtime(['notificaciones'], cargar);

  async function handleMarkAll() {
    setMarking(true);
    try {
      await markAllRead();
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      onAllRead();
    } finally {
      setMarking(false);
    }
  }

  if (!open) return null;

  const hasUnread = items.some((n) => !n.read);

  return (
    <Modal
      title="Notificaciones"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
          <button className="btn btn-primary" onClick={handleMarkAll} disabled={!hasUnread || marking}>
            {marking ? 'Marcando…' : 'Marcar todas leídas'}
          </button>
        </>
      }
    >
      {loading ? (
        <p className="hint muted" style={{ margin: 0 }}>Cargando…</p>
      ) : items.length === 0 ? (
        <EmptyState message="Sin notificaciones." />
      ) : (
        <div className="feed" style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {items.map((n) => (
            <div
              key={n.id}
              className="feed-item"
              onClick={() => abrir(n)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') abrir(n); }}
              title={n.link ? 'Ir al detalle' : undefined}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                alignItems: 'center',
                gap: '.75rem',
                padding: '.65rem .8rem',
                background: n.read ? 'var(--bg-1)' : 'var(--surface-2)',
                border: `1px solid ${n.read ? 'var(--border)' : 'var(--border-strong)'}`,
                borderLeft: `3px solid ${kindColor(n.kind)}`,
                borderRadius: 'var(--r-md)',
                cursor: 'pointer',
              }}
            >
              <div className="pin" style={{ fontSize: '1.1rem' }}>{KIND_ICON[n.kind] ?? '◔'}</div>
              <div className="body">
                <div className="title" style={{ fontWeight: 600 }}>{n.title}</div>
                {n.message && <div className="meta muted" style={{ fontSize: '.82rem', marginTop: '.15rem' }}>{n.message}</div>}
                <div className="meta dim" style={{ fontSize: '.72rem', marginTop: '.25rem' }}>{relTime(n.at)}</div>
              </div>
              {n.link && <span className="muted" aria-hidden="true" style={{ fontSize: '1.1rem' }}>›</span>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function kindColor(kind: string): string {
  switch (kind) {
    case 'success': return 'var(--success)';
    case 'warning': return 'var(--warning)';
    case 'error':   return 'var(--danger)';
    default:        return 'var(--primary)';
  }
}
