import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { VistaPrevia, Dato } from '@/shared/ui/VistaPrevia';
import { toast } from '@/shared/ui/Toast';
import { num as fmtNum } from '@/shared/lib/format';
import { listProductosActivos } from '@/modules/pedidos/pedidos.repository';
import type { Producto } from '@/shared/lib/types';
import { decidirRepuesto } from './flota';
import { reemplazarPiezaOrden, type OrdenServicio } from './flota.repository';

/**
 * Cuando Compras ya dio de alta la pieza nueva, se cambia por el producto del inventario
 * y la base vuelve a decidir si sale del inventario o va a compra. Si la salida de esta
 * orden ya se pidió, la pieza va completa a compra (no se arma una segunda salida).
 */
export function ReemplazarPiezaModal({ orden, indice, onClose, onDone }: {
  orden: OrdenServicio; indice: number; onClose: () => void; onDone: () => void;
}) {
  const pieza = orden.repuestos[indice];
  const [productos, setProductos] = useState<Producto[]>([]);
  const [productoId, setProductoId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { listProductosActivos().then(setProductos).catch(() => setProductos([])); }, []);

  const opciones = useMemo(() => productos.map((p) => ({
    value: p.id, label: `${p.nombre} · ${p.sku} · ${fmtNum(Number(p.stock) || 0)} ${p.unidad} en stock (${p.almacen})`,
  })), [productos]);
  const prod = productos.find((p) => p.id === productoId) ?? null;
  const conSalida = !!orden.solicitud_salida_id;
  const d = prod ? decidirRepuesto(pieza?.cantidad ?? 0, conSalida ? 0 : Number(prod.stock) || 0) : null;

  async function guardar() {
    if (!prod) return;
    setSaving(true);
    try {
      const r = await reemplazarPiezaOrden(orden.id, indice, prod.id);
      toast(`${orden.codigo}: «${pieza?.nombre}» ahora es ${r.nombre} (${r.origen === 'stock' ? 'del inventario' : r.origen === 'parcial' ? 'parcial' : 'a compra'}).`, 'success');
      onDone();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : (e as { message?: string })?.message || 'No se pudo cambiar la pieza', 'error');
    } finally { setSaving(false); }
  }

  if (!pieza) return null;
  return (
    <Modal title={`🔁 Cambiar pieza nueva · ${orden.codigo}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving || !prod}>{saving ? 'Guardando…' : 'Cambiar por este producto'}</button>
      </>}>
      <div className="flo" style={{ display: 'grid', gap: '.8rem' }}>
        <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>
          Elige el producto que Compras dio de alta para «<strong>{pieza.nombre}</strong>». La orden vuelve a decidir si sale del inventario o va a compra.
        </p>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Producto del inventario</label>
          <SearchSelect options={opciones} value={productoId} onChange={setProductoId} placeholder="Buscar producto…" emptyText="No está en el inventario todavía" />
        </div>
        {conSalida && <div className="aviso info sm"><span className="aviso-icono">ℹ️</span><div>La salida de inventario de esta orden ya se pidió: esta pieza irá completa a compra.</div></div>}
        <VistaPrevia titulo="Lo que va a cambiar">
          <Dato label="Pieza">{pieza.nombre}</Dato>
          <Dato label="Cantidad">{`${fmtNum(pieza.cantidad)} ${pieza.unidad}`}</Dato>
          <Dato label="Producto">{prod ? `${prod.nombre} (${prod.sku})` : undefined}</Dato>
          <Dato label="Almacén">{prod?.almacen || undefined}</Dato>
          <Dato label="Decisión">{d ? (d.tipo === 'stock' ? `Sale del inventario (${fmtNum(d.desdeInventario)})` : d.tipo === 'parcial' ? `${fmtNum(d.desdeInventario)} del inventario + ${fmtNum(d.aComprar)} a compra` : `${fmtNum(d.aComprar)} a compra`) : undefined}</Dato>
        </VistaPrevia>
        <p className="muted" style={{ margin: 0, fontSize: '.76rem' }}>El stock se vuelve a revisar al guardar. Después, pide la salida o la compra desde la orden.</p>
      </div>
    </Modal>
  );
}
