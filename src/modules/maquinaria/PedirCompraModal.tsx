import { useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useSession } from '@/modules/auth/authStore';
import { toast } from '@/shared/ui/Toast';
import { num as fmtNum } from '@/shared/lib/format';
import { CategoriaProductoSelect } from '@/modules/inventario/CategoriaProductoSelect';
import { buscarProductosParecidos, type ProductoParecido } from '@/modules/inventario/inventario.repository';
import { solicitarCompraDeOrden, type OrdenServicio } from './flota.repository';
import { CATEGORIA_REPUESTOS, categoriaFijaEnTelefono } from './flota';

/**
 * «🛒 Pedir compra» de una orden que ya existe y trae piezas que no están en el inventario
 * (12/10/2026): se elige la categoría de cada una y la base las da de alta (stock 0) y crea
 * la solicitud de pedido en un paso. Muestra los productos de nombre parecido para no duplicar.
 */
export function PedirCompraModal({ orden, onClose, onDone }: { orden: OrdenServicio; onClose: () => void; onDone: () => void }) {
  const { appUser } = usePermissions();
  const { user } = useSession();
  const actor = { email: user?.email ?? 'sistema', nombre: appUser?.nombre ?? null };
  const nuevas = orden.repuestos.filter((r) => !r.producto_id && r.a_comprar > 0);
  // REPUESTOS por defecto; en el teléfono es la única (sin selector).
  const [cats, setCats] = useState<Record<string, string>>(() => Object.fromEntries(nuevas.map((n) => [n.nombre, CATEGORIA_REPUESTOS])));
  const [categoriaFija] = useState(categoriaFijaEnTelefono);
  const [parecidos, setParecidos] = useState<Record<string, ProductoParecido[]>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let vivo = true;
    for (const n of orden.repuestos.filter((r) => !r.producto_id && r.a_comprar > 0)) {
      void buscarProductosParecidos(n.nombre).then((lista) => { if (vivo) setParecidos((p) => ({ ...p, [n.nombre]: lista })); });
    }
    return () => { vivo = false; };
  }, [orden.repuestos]);

  const faltan = nuevas.filter((n) => !(cats[n.nombre] ?? '').trim()).length;

  async function pedir() {
    setSaving(true);
    try {
      const codigo = await solicitarCompraDeOrden(orden, nuevas.map((n) => ({ nombre: n.nombre, categoria: (cats[n.nombre] ?? '').trim(), unidad: n.unidad })), actor);
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
        <button className="btn btn-primary" onClick={() => void pedir()} disabled={saving || faltan > 0}>{saving ? 'Pidiendo…' : 'Crear solicitud de pedido'}</button>
      </>}>
      <div className="flo" style={{ display: 'grid', gap: '.75rem' }}>
        <p className="muted" style={{ margin: 0, fontSize: '.84rem' }}>
          Lo que falta entra a <strong>Pedidos</strong> como solicitud de pedido. {nuevas.length === 1 ? 'Esta pieza no está' : 'Estas piezas no están'} en
          el inventario: se {nuevas.length === 1 ? 'da' : 'dan'} de alta en {categoriaFija ? CATEGORIA_REPUESTOS : 'la categoría elegida (REPUESTOS por defecto)'} con stock 0. Cuando llegue la compra, entran al inventario.
        </p>
        {nuevas.map((n, i) => {
          const lista = parecidos[n.nombre] ?? [];
          return (
            <div key={n.nombre} className="flo-linea">
              <div className="flo-linea-top"><div><strong>{n.nombre}</strong><small>{fmtNum(n.a_comprar)} {n.unidad} a comprar</small></div></div>
              {categoriaFija
                ? <small className="muted">Categoría en el inventario: <strong>{CATEGORIA_REPUESTOS}</strong></small>
                : (
                  <div className="form-row" style={{ marginBottom: 0 }}>
                    <label htmlFor={`pc-cat-${i}`}>Categoría en el inventario *</label>
                    <CategoriaProductoSelect id={`pc-cat-${i}`} value={cats[n.nombre] ?? ''} onChange={(c) => setCats((p) => ({ ...p, [n.nombre]: c }))} />
                  </div>
                )}
              {lista.length > 0 && (
                <div className="aviso warning sm"><span className="aviso-icono">🔎</span><div>
                  Ya hay productos con un nombre parecido: {lista.slice(0, 4).map((p) => `${p.nombre} (${p.sku})`).join(' · ')}.
                  Si es el mismo, cancela y usa «🔁 Ya existe en inventario: cambiar por el producto» en la orden.
                </div></div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
