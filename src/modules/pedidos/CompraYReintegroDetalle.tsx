import { useEffect, useState } from 'react';
import { supabase } from '@/shared/lib/supabase';
import { dateTime, money } from '@/shared/lib/format';
import { mensajeError } from '@/shared/lib/errores';
import type { OrdenTarjeta } from './ContextoCompraTarjeta';

interface Pago { fecha: string; monto: number; moneda: string }

export function CompraYReintegroDetalle({ orden, monto, moneda, estado }: { orden: OrdenTarjeta; monto: number; moneda: string; estado: string }) {
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let vigente = true;
    setLoading(true); setError('');
    void (async () => {
      try {
        const { data, error: e } = await supabase.rpc('compras_pagos_detalle_reintegro', { p_orden: orden.id });
        if (e) throw e;
        if (vigente) setPagos((data || []) as Pago[]);
      } catch (e) { if (vigente) setError(mensajeError(e, 'No se pudo consultar el pago')); }
      finally { if (vigente) setLoading(false); }
    })();
    return () => { vigente = false; };
  }, [orden.id]);
  const totales = pagos.reduce<Record<string, number>>((r, p) => { r[p.moneda] = (r[p.moneda] || 0) + Number(p.monto); return r; }, {});
  const monedaCompra = (orden as OrdenTarjeta & { total_moneda?: string; moneda?: string }).total_moneda || (orden as OrdenTarjeta & { moneda?: string }).moneda || 'USD';
  const precio = (i: typeof orden.items[number]) => Number(orden.pago_en_divisa && i.precio_usd != null ? i.precio_usd : i.precio) || 0;
  const comprados = orden.items.filter(i => i.comprar !== false && Number(i.cantidad) > 0 && precio(i) > 0);
  return <section className="card compras-resumen-pago">
    <div className="form-grid">
      <div className="form-row"><span className="muted">💳 Total pagado al proveedor</span><strong>{loading ? 'Consultando…' : error ? 'No disponible' : Object.entries(totales).map(([m, v]) => money(v, m)).join(' + ') || 'Sin egreso vigente registrado'}</strong></div>
      <div className="form-row"><span className="muted">📅 Fecha del pago</span><strong>{pagos[0] ? dateTime(pagos[0].fecha) : orden.pagada_en ? dateTime(orden.pagada_en) : 'Sin pago registrado'}</strong></div>
      <div className="form-row"><span className="muted">↩️ Reintegro {estado === 'recibido' ? 'recibido' : 'pendiente'}</span><strong>{money(monto, moneda)}</strong></div>
    </div>
    {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    {pagos.length > 1 && <details><summary>Ver pagos realizados ({pagos.length})</summary><ul>{pagos.map((p, i) => <li key={i}>{dateTime(p.fecha)} · {money(p.monto, p.moneda)}</li>)}</ul></details>}
    <h4>📦 Lo que se compró</h4>
    <div style={{ overflowX: 'auto' }}><table className="compras-productos"><thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>{comprados.map((i, n) => <tr key={n}><td>{i.nombre}<small>{i.sku}</small></td><td>{i.cantidad} {i.unidad}</td><td>{money(precio(i), monedaCompra)}</td><td>{money(precio(i) * Number(i.cantidad), monedaCompra)}</td></tr>)}</tbody></table></div>
    <p className="muted">Total de la compra con impuestos y descuentos: <strong>{money(orden.total, monedaCompra)}</strong></p>
  </section>;
}
