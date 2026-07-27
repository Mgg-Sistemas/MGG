/* ============================================================
   Inventario · Mover un producto a otro almacén (traslado directo)
   Descuenta del almacén origen y suma al destino (con costo/PMP y traza),
   reutilizando `trasladoMaterial`. Pensado como acción rápida por fila.
   ============================================================ */
import { useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { trasladoMaterial } from '@/modules/salidas/salidas.repository';

interface Props {
  producto: { id: string; nombre: string };
  almacenOrigen: string;
  stockDisponible: number;
  /** Nombres de almacenes destino posibles (se excluye el origen). */
  almacenes: string[];
  actor: string;
  actorName?: string | null;
  onClose: () => void;
  onDone: () => void;
}

export function MoverProductoModal({ producto, almacenOrigen, stockDisponible, almacenes, actor, actorName, onClose, onDone }: Props) {
  const destinos = useMemo(
    () => Array.from(new Set(almacenes.map((a) => a.trim()).filter((a) => a && a !== almacenOrigen))).sort((a, b) => a.localeCompare(b)),
    [almacenes, almacenOrigen],
  );
  const [destino, setDestino] = useState('');
  const [cantidadStr, setCantidadStr] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cantidad = Number(cantidadStr) || 0;
  const puede = !!destino && cantidad > 0 && cantidad <= stockDisponible && !guardando;

  const mover = async () => {
    if (!puede) return;
    setGuardando(true);
    try {
      await trasladoMaterial({ productoId: producto.id, almacenOrigen, almacenDestino: destino, cantidad, actor, actorName });
      toast(`Movido ${cantidad} de ${producto.nombre} → ${destino}`, 'success');
      onDone();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo mover el producto', 'error');
      setGuardando(false);
    }
  };

  return (
    <Modal title={`Mover · ${producto.nombre}`} size="sm" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
        <button className="btn btn-primary" onClick={mover} disabled={!puede}>{guardando ? 'Moviendo…' : 'Mover'}</button>
      </>
    }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
        <div className="muted">Desde <strong>{almacenOrigen}</strong> · disponible <strong>{stockDisponible}</strong></div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          <span>Almacén destino</span>
          <select className="input" value={destino} onChange={(e) => setDestino(e.target.value)}>
            <option value="">— Elegí un almacén —</option>
            {destinos.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          <span>Cantidad</span>
          <input
            className="input" type="number" min={0} max={stockDisponible} step="any"
            value={cantidadStr} onChange={(e) => setCantidadStr(e.target.value)}
            placeholder={`Máx ${stockDisponible}`}
          />
          {cantidad > stockDisponible && <span className="text-danger" style={{ fontSize: '.8rem' }}>Supera el stock disponible.</span>}
        </label>
      </div>
    </Modal>
  );
}
