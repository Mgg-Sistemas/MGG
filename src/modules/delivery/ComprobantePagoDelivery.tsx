/* ============================================================
   MGG · Delivery · Comprobante de pago de Tesorería (31/10/2026)
   El motorizado (teléfono) y la PC verifican que la OC de verdad se pagó:
   fecha, montos por método y los comprobantes que adjuntó Tesorería (PDF o
   imagen, enlace firmado de 10 min).
   ============================================================ */
import { useEffect, useState } from 'react';
import { previewArchivo } from '@/shared/lib/reportePreview';
import { fechaHoraVE, montoTxt, type PedidoDelivery } from './delivery';
import { comprobantePagoDelivery, type ComprobantePagoDelivery } from './delivery.repository';

const msgError = (e: unknown, def: string) => (e instanceof Error ? e.message : def);

/** Lo que adjuntó Tesorería al pagar (lo usan la PC y el teléfono). */
export function ComprobantePagoCuerpo({ pedido }: { pedido: PedidoDelivery }) {
  const [estado, setEstado] = useState<{ cargando: boolean; dato: ComprobantePagoDelivery | null; error: string | null }>(
    { cargando: true, dato: null, error: null },
  );
  useEffect(() => {
    let vivo = true;
    comprobantePagoDelivery(pedido.orden_id)
      .then((dato) => { if (vivo) setEstado({ cargando: false, dato, error: null }); })
      .catch((e) => { if (vivo) setEstado({ cargando: false, dato: null, error: msgError(e, 'No se pudo leer el comprobante.') }); });
    return () => { vivo = false; };
  }, [pedido.orden_id]);
  const { cargando, dato, error } = estado;

  if (cargando) return <p className="muted">Buscando el comprobante…</p>;
  if (error) return <div className="aviso danger sm"><span className="aviso-icono">⚠</span><div>{error}</div></div>;
  if (!dato) return null;
  // 02/11/2026: un retiro en Almacén Los Pinos no tiene pago.
  if (!dato.aplica) {
    return <div className="aviso info sm"><span className="aviso-icono">📦</span><div>{dato.mensaje || 'Este pedido no lleva comprobante de pago.'}</div></div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
      <div className="surt-detalle">
        {dato.pagadaEn && <div className="surt-fila"><span>Pagada</span><span>{fechaHoraVE(dato.pagadaEn)}</span></div>}
        {dato.pagos.length
          ? dato.pagos.map((x, i) => (
            <div key={i} className="surt-fila">
              <span>{dato.pagos.length > 1 ? `Pago ${i + 1}` : 'Monto pagado'}{x.metodo && x.metodo !== '—' ? ` · ${x.metodo}` : ''}</span>
              <span>{montoTxt(x.monto, x.moneda)}</span>
            </div>
          ))
          : <div className="surt-fila"><span>Total de la OC</span><span>{montoTxt(dato.total, dato.moneda)}</span></div>}
      </div>
      {!dato.archivos.length && (
        <div className="aviso info sm"><span className="aviso-icono">🧾</span><div>Tesorería no adjuntó comprobante (pago en efectivo u otro).</div></div>
      )}
      {dato.archivos.map((a) => (a.esPdf ? (
        <button key={a.url} type="button" className="btn btn-primary" style={{ justifyContent: 'center' }}
          onClick={() => previewArchivo(a.url, a.nombre)}>
          📄 Vista previa PDF · {a.etiqueta}
        </button>
      ) : (
        <button key={a.url} type="button" title={`Vista previa · ${a.nombre}`}
          onClick={() => previewArchivo(a.url, a.nombre)}
          style={{ padding: 0, border: 0, background: 'transparent', cursor: 'zoom-in', display: 'block', margin: '0 auto', maxWidth: '100%' }}>
          <img src={a.url} alt={a.nombre} style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', display: 'block', margin: '0 auto', borderRadius: 8, border: '1px solid var(--border)' }} />
        </button>
      )))}
      {dato.archivos.length > 0 && <small className="muted">El enlace dura 10 minutos; si vence, cierra y vuelve a abrir el comprobante.</small>}
    </div>
  );
}
