import type { ReactNode } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { num, dateTime } from '@/shared/lib/format';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import type { AdjuntoFactura } from './compras.repository';
import type { DetalleServicioItem, EventoHistorial } from '@/shared/lib/types';

function montoCaja(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${v}` : `${moneda} ${v}`;
}

/**
 * Detalle de una Compra/Servicio Directo: ficha + ítems (cantidad y precio) + facturas.
 * Se abre al hacer clic en la fila (lista) o la tarjeta (kanban). Los botones de acción
 * (PDF vista previa, editar, facturas, finalizar…) llegan por `footer`.
 */
export function DetalleDirectoModal({ title, estadoLabel, ficha, itemsTitle, items, moneda, total, nota, pagoExterno, facturas, urlFor, footer, onClose, anticipo, historial }: {
  title: string;
  estadoLabel: string;
  ficha: Array<[string, string]>;
  itemsTitle: string;
  items: { nombre: string; cantidad: number; gasto: number | null | undefined; detalle?: DetalleServicioItem[] | null }[];
  moneda: string;
  total: number | null | undefined;
  nota?: string | null;
  /** Pago a externo: datos de la persona externa que pagó (MGG debe reintegrarle). */
  pagoExterno?: string | null;
  facturas: AdjuntoFactura[];
  urlFor: (path: string) => Promise<string>;
  footer: ReactNode;
  onClose: () => void;
  /** Pago anticipado (servicios): anticipo + pendiente para mostrar el resumen. */
  anticipo?: { monto: number; moneda: string; pendiente: number | null; monedaServicio: string } | null;
  /** Trazabilidad de eventos (anticipo, crédito…). */
  historial?: EventoHistorial[];
}) {
  async function abrir(a: AdjuntoFactura) {
    try { await previewFileUrl(await urlFor(a.path), a.filename); }
    catch { toast('No se pudo abrir la factura', 'error'); }
  }

  return (
    <Modal title={title} size="lg" onClose={onClose} footer={footer}>
      <div style={{ marginBottom: '.6rem' }}><span className="badge">{estadoLabel}</span></div>

      {pagoExterno != null && (
        <div className="card" style={{ margin: '0 0 .8rem', borderLeft: '3px solid var(--brand, #ff8a00)', background: 'rgba(255,138,0,.08)', fontSize: '.86rem' }}>
          💳 <strong>Pago a externo — reintegrar el dinero</strong>
          <div className="muted" style={{ fontSize: '.82rem', marginTop: '.15rem' }}>Lo pagó una persona externa; Tesorería le reintegra al pagar.</div>
          {pagoExterno.trim() && <div style={{ marginTop: '.25rem', whiteSpace: 'pre-wrap' }}>👤 {pagoExterno.trim()}</div>}
        </div>
      )}

      <div className="form-grid" style={{ gap: '.3rem 1rem', marginBottom: '.8rem' }}>
        {ficha.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: '.4rem', fontSize: '.86rem' }}>
            <span className="muted" style={{ minWidth: 130 }}>{k}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>

      <h4 style={{ margin: '.4rem 0' }}>{itemsTitle}</h4>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>Detalle</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Costo unit.</th><th style={{ textAlign: 'right' }}>Precio</th></tr></thead>
          <tbody>
            {items.map((it, i) => {
              const g = it.gasto != null ? Number(it.gasto) : null;
              const cu = g != null && it.cantidad > 0 ? g / it.cantidad : null;
              const det = (it.detalle ?? []).filter((d) => (d.descripcion ?? '').trim());
              return (
                <tr key={i}>
                  <td>
                    {it.nombre}
                    {det.length > 0 && (
                      <ul className="muted" style={{ margin: '.25rem 0 0', paddingLeft: '1rem', fontSize: '.78rem' }}>
                        {det.map((d, j) => <li key={j}>{d.descripcion}{d.cantidad != null ? ` · ${num(d.cantidad)}` : ''}{d.precio != null ? ` · ${montoCaja(d.precio, moneda)}` : ''}</li>)}
                      </ul>
                    )}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(it.cantidad)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{cu != null ? montoCaja(cu, moneda) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{g != null ? montoCaja(g, moneda) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="num" style={{ textAlign: 'right', fontWeight: 700 }}>TOTAL</td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{total != null && Number(total) > 0 ? montoCaja(total, moneda) : '—'}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {anticipo && (
        <div className="card" style={{ margin: '.8rem 0 0', background: 'var(--bg-2)' }}>
          <div style={{ color: 'var(--success)', fontSize: '.86rem' }}>💳 Pago anticipado: <strong className="mono">{montoCaja(anticipo.monto, anticipo.moneda)}</strong>{anticipo.moneda !== anticipo.monedaServicio && anticipo.pendiente != null ? <span className="muted"> (convertido a {anticipo.monedaServicio})</span> : null}</div>
          <div style={{ color: 'var(--warning)', fontSize: '.86rem' }}>Pendiente (crédito en Tesorería): <strong className="mono">{anticipo.pendiente != null ? montoCaja(anticipo.pendiente, anticipo.monedaServicio) : '—'}</strong></div>
        </div>
      )}

      {historial && historial.length > 0 && (
        <>
          <h4 style={{ margin: '.8rem 0 .4rem' }}>Trazabilidad</h4>
          <div className="timeline">
            {historial.map((h, i) => (
              <div key={i} className="tl-item">
                <span className="tl-dot info" />
                <div className="tl-title">{h.evento === 'anticipo' ? '💳 Anticipo' : h.evento === 'credito_saldado' ? '🧾 Crédito generado' : h.evento}</div>
                {h.motivo && <div className="muted" style={{ fontSize: '.8rem' }}>{h.motivo}</div>}
                <div className="tl-meta">{dateTime(h.at)} · {h.actor}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {nota?.trim() && (
        <>
          <h4 style={{ margin: '.8rem 0 .4rem' }}>Nota para Tesorería</h4>
          <div className="card" style={{ margin: 0, fontSize: '.86rem', whiteSpace: 'pre-wrap' }}>📝 {nota.trim()}</div>
        </>
      )}

      <h4 style={{ margin: '.8rem 0 .4rem' }}>Facturas</h4>
      {facturas.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
          {facturas.map((a) => (
            <div key={a.path} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', justifyContent: 'space-between', border: '1px solid var(--border)', borderRadius: 6, padding: '.35rem .55rem' }}>
              <button className="btn btn-sm btn-ghost" onClick={() => abrir(a)} title="Ver factura (vista previa)" style={{ padding: 0 }}>📎 {a.filename}</button>
              <span className="muted" style={{ fontSize: '.72rem' }}>{dateTime(a.at)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint muted" style={{ margin: 0, fontSize: '.85rem' }}>Sin facturas cargadas.</p>
      )}
    </Modal>
  );
}
