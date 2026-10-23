/* ============================================================
   MGG · Retenciones · El detalle de la OC y de la compra directa

   Las tarjetas «Detalle de la orden de compra» y «Detalle de la compra
   directa» de RetencionesPage, sacadas aquí sin cambios para que la v8
   las use en «Ver OC» (20/10/2026). La pantalla de hoy se ve igual.
   ============================================================ */

import { money, num, dateTime } from '@/shared/lib/format';
import { labelCondicionPago } from '@/modules/pedidos/ofertas.repository';
import type { CompraDirecta } from '@/modules/pedidos/compras.repository';
import { labelRetencionModo, type RetencionItem } from './retenciones.repository';

/** Formatea un monto según la moneda de la fila (compra directa puede ser Bs). */
export function fmtMonto(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'Bs' ? `Bs ${v}` : `$ ${v}`;
}

export function DetalleOrdenCompra({ item }: { item: RetencionItem }) {
  const o = item.orden!;
  return (
    <div className="card" style={{ margin: '0 0 .75rem' }}>
      <div className="card-title" style={{ marginBottom: '.4rem' }}>Detalle de la orden de compra</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '.4rem .9rem', fontSize: '.86rem' }}>
        <div><span className="muted">Proveedor:</span> <strong>{item.proveedorNombre}</strong></div>
        {o.numero_administracion && (
          <div title="Teléfono de la administración del proveedor (se carga al indicar el método de pago y queda en su ficha)">
            <span className="muted">📞 Administración del proveedor:</span> <strong className="mono">{o.numero_administracion}</strong>
          </div>
        )}
        <div><span className="muted">Condición:</span> {labelCondicionPago(o.condiciones_pago)}</div>
        <div><span className="muted">Retención:</span> {labelRetencionModo(o.retencion_modo)}</div>
        <div><span className="muted">Total:</span> <strong className="mono">{money(o.total, item.moneda)}</strong></div>
        {item.avisoMoneda && <div className="hint" style={{ color: 'var(--warning)' }}>⚠ {item.avisoMoneda}</div>}
        <div><span className="muted">Tesorería:</span> {o.retencion_pagada ? <strong style={{ color: 'var(--success)' }}>✓ Pagada{o.retencion_pagada_en ? ` · ${dateTime(o.retencion_pagada_en)}` : ''}</strong> : 'Por pagar'}</div>
      </div>
      <div className="table-wrap" style={{ marginTop: '.5rem' }}>
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead><tr><th>Material</th><th style={{ textAlign: 'right' }}>Cant.</th><th style={{ textAlign: 'right' }}>Precio</th></tr></thead>
          <tbody>
            {(o.items ?? []).map((it, i) => (
              <tr key={i}><td>{it.nombre}{it.sku ? <span className="muted"> · {it.sku}</span> : null}</td><td className="mono" style={{ textAlign: 'right' }}>{num(it.cantidad)}</td><td className="mono" style={{ textAlign: 'right' }}>{money(it.precio, item.moneda)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DetalleCompraDirecta({ compra }: { compra: CompraDirecta }) {
  const m = compra.moneda || 'Bs';
  return (
    <div className="card" style={{ margin: '0 0 .75rem' }}>
      <div className="card-title" style={{ marginBottom: '.4rem' }}>Detalle de la compra directa</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '.4rem .9rem', fontSize: '.86rem' }}>
        <div><span className="muted">Proveedor:</span> <strong>{compra.proveedor_nombre || '—'}</strong></div>
        <div><span className="muted">Moneda:</span> {m === 'Bs' ? 'Bolívares (Bs)' : 'Dólares ($)'}</div>
        {compra.descuento_monto > 0 && <div><span className="muted">Descuento:</span> {compra.descuento_pct ? `${compra.descuento_pct}% · ` : ''}{fmtMonto(compra.descuento_monto, m)}</div>}
        <div><span className="muted">IVA:</span> <strong className="mono">{fmtMonto(compra.iva, m)}</strong></div>
        <div><span className="muted">Retención IVA:</span> <strong className="mono">{compra.retencion_pct}% · {fmtMonto(compra.retencion_monto, m)}</strong></div>
        <div><span className="muted">Total:</span> <strong className="mono">{fmtMonto(compra.gasto, m)}</strong></div>
        <div><span className="muted">Tesorería:</span> {compra.estado === 'por_pagar' ? 'Por pagar' : <strong style={{ color: 'var(--success)' }}>✓ Pagada</strong>}</div>
      </div>
      <div className="table-wrap" style={{ marginTop: '.5rem' }}>
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead><tr><th>Material</th><th style={{ textAlign: 'right' }}>Cant.</th><th style={{ textAlign: 'right' }}>Precio</th></tr></thead>
          <tbody>
            {(compra.items ?? []).map((it, i) => (
              <tr key={i}><td>{it.producto_nombre}{it.producto_sku ? <span className="muted"> · {it.producto_sku}</span> : null}</td><td className="mono" style={{ textAlign: 'right' }}>{num(it.cantidad)}</td><td className="mono" style={{ textAlign: 'right' }}>{fmtMonto(it.gasto, m)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
