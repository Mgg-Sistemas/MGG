import type { ReactNode } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { num, dateTime } from '@/shared/lib/format';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import type { AdjuntoFactura } from './compras.repository';

function montoCaja(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${v}` : `${moneda} ${v}`;
}

/**
 * Detalle de una Compra/Servicio Directo: ficha + ítems (cantidad y precio) + facturas.
 * Se abre al hacer clic en la fila (lista) o la tarjeta (kanban). Los botones de acción
 * (PDF vista previa, editar, facturas, finalizar…) llegan por `footer`.
 */
export function DetalleDirectoModal({ title, estadoLabel, ficha, itemsTitle, items, moneda, total, nota, pagoExterno, facturas, urlFor, footer, onClose }: {
  title: string;
  estadoLabel: string;
  ficha: Array<[string, string]>;
  itemsTitle: string;
  items: { nombre: string; cantidad: number; gasto: number | null | undefined }[];
  moneda: string;
  total: number | null | undefined;
  nota?: string | null;
  /** Pago a externo: datos de la persona externa que pagó (MGG debe reintegrarle). */
  pagoExterno?: string | null;
  facturas: AdjuntoFactura[];
  urlFor: (path: string) => Promise<string>;
  footer: ReactNode;
  onClose: () => void;
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
              return (
                <tr key={i}>
                  <td>{it.nombre}</td>
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
