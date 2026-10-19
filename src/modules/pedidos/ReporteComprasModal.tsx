/* ============================================================
   MGG · Compras · Reporte por renglones (modal en pantalla)
   Pedido de la administradora (19-10-2026): muestra, TIPO POR
   RENGLÓN, las compras pendientes con su CÓDIGO, su MOTIVO y su
   MONTO en $ o Bs:
     · PENDIENTE POR APROBAR        (OC/servicio en `oc_creada`)
     · CUENTAS A CRÉDITO            (OC/servicio en `cuenta_abierta`)
     · POR INDICAR MÉTODO DE PAGO   (OC/servicio en `confirmada_metodo`)
     · POR PAGAR                    (OC/servicio en `oc_aprobada` + directos `por_pagar`)
   Salidas: PDF (vista previa), Excel con estilos, WhatsApp (mensaje con
   emojis, listo para copiar o mandar) e impresión por sistema.
   Se actualiza en vivo (realtime).
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { agruparReporte, fmtMonto, totalesPorMoneda, totalesTexto, type FilaReporteCompras } from './comprasReporte';
import { listReporteCompras } from './comprasReporte.repository';
import { compartirMovimiento, enlaceWhatsapp, mensajeReporteCompras, puedeCompartir } from './comprasReporteMensaje';

export function ReporteComprasModal({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [filas, setFilas] = useState<FilaReporteCompras[]>([]);
  const [genPdf, setGenPdf] = useState(false);
  const [genExcel, setGenExcel] = useState(false);
  const [imprimiendo, setImprimiendo] = useState(false);

  const cargar = useCallback(async () => {
    const r = await listReporteCompras().catch(() => [] as FilaReporteCompras[]);
    setFilas(r);
    setLoading(false);
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  // Realtime: aprobar, cargar oferta o pagar mueve una compra de renglón al instante.
  useRealtime(['ordenes', 'compras_directas', 'servicios_directos'], () => { void cargar(); });

  const grupos = useMemo(() => agruparReporte(filas), [filas]);
  const total = useMemo(() => totalesPorMoneda(filas), [filas]);
  const mensaje = useMemo(() => mensajeReporteCompras(filas), [filas]);
  const vacio = !loading && filas.length === 0;

  async function verPdf() {
    setGenPdf(true);
    try {
      const { descargarReporteComprasPdf } = await import('./reporteComprasPdf');
      await descargarReporteComprasPdf(filas);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
    finally { setGenPdf(false); }
  }

  async function verExcel() {
    setGenExcel(true);
    try {
      const { exportarReporteComprasExcel } = await import('./reporteComprasExcel');
      await exportarReporteComprasExcel(filas);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el Excel', 'error'); }
    finally { setGenExcel(false); }
  }

  // Imprimir por sistema: el mismo PDF, con la orden de impresión embebida (sale a
  // tamaño real con sus márgenes). No pasa por el visor, va derecho a la impresora.
  async function imprimir() {
    setImprimiendo(true);
    try {
      const { imprimirReporteComprasPdf } = await import('./reporteComprasPdf');
      await imprimirReporteComprasPdf(filas);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo imprimir el reporte', 'error'); }
    finally { setImprimiendo(false); }
  }

  async function copiar() {
    try { await navigator.clipboard.writeText(mensaje); toast('Mensaje copiado', 'success'); }
    catch { toast('No se pudo copiar solo. Mantené presionado el texto para copiarlo.', 'warning'); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      <button className="btn btn-ghost" onClick={() => void verPdf()} disabled={genPdf || vacio}>
        {genPdf ? 'Generando…' : '📄 PDF (vista previa)'}
      </button>
      <button className="btn btn-ghost" onClick={() => void verExcel()} disabled={genExcel || vacio}>
        {genExcel ? 'Generando…' : '📊 Excel'}
      </button>
      {/* En el teléfono el mensaje va por la hoja de compartir (llega exacto, con sus
          emojis); en la PC, el enlace derecho a api.whatsapp.com (nunca wa.me). */}
      <a className="btn btn-ghost" href={enlaceWhatsapp(mensaje)} target="_blank" rel="noopener noreferrer"
        onClick={(e) => {
          if (vacio) { e.preventDefault(); return; }
          if (!puedeCompartir()) return;
          e.preventDefault();
          void compartirMovimiento(mensaje);
        }}>
        💬 WhatsApp
      </a>
      <button className="btn btn-primary" onClick={() => void imprimir()} disabled={imprimiendo || vacio}>
        {imprimiendo ? 'Enviando…' : '🖨 Imprimir'}
      </button>
    </>
  );

  return (
    <Modal title="Reporte de compras por renglón" size="lg" onClose={onClose} footer={footer}>
      <div className="muted" style={{ fontSize: '.82rem', marginBottom: '.6rem' }}>
        Pendiente por aprobar · Cuentas a crédito · Por indicar método de pago · Por pagar
        {' · '}<strong>{filas.length}</strong> renglón(es) · se actualiza en vivo
      </div>

      {loading && <div className="card"><p className="hint muted" style={{ margin: 0 }}>Cargando…</p></div>}

      {vacio && (
        <div className="card"><p className="hint muted" style={{ margin: 0 }}>✅ No hay compras pendientes en este momento.</p></div>
      )}

      {!loading && grupos.filter((g) => g.filas.length > 0).map((g) => {
        const esCredito = g.key === 'cuenta_abierta';
        const cols = esCredito ? 7 : 5;
        return (
          <div key={g.key} className="table-wrap" style={{ marginBottom: '.9rem' }}>
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead>
                <tr><th colSpan={cols} style={{ background: g.color, color: '#fff', fontWeight: 700, letterSpacing: '.02em' }}>{g.emoji} {g.titulo} · {g.filas.length}</th></tr>
                <tr>
                  <th style={{ width: 34, textAlign: 'center' }}>#</th>
                  <th style={{ width: 122 }}>CÓDIGO</th>
                  <th style={{ width: 112 }}>TIPO</th>
                  <th>MOTIVO</th>
                  <th style={{ textAlign: 'right' }}>MONTO</th>
                  {esCredito && <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>ABONADO</th>}
                  {esCredito && <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>SALDO</th>}
                </tr>
              </thead>
              <tbody>
                {g.filas.map((f, i) => (
                  <tr key={`${f.codigo}-${i}`}>
                    <td className="muted" style={{ textAlign: 'center' }}>{i + 1}</td>
                    <td className="mono">{f.codigo}</td>
                    <td className="muted" style={{ fontSize: '.78rem' }}>{f.tipo}</td>
                    <td>{f.motivo}</td>
                    <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtMonto(f.monto, f.moneda)}</td>
                    {esCredito && <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtMonto(f.abonado, f.moneda)}</td>}
                    {esCredito && <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtMonto(f.saldo, f.moneda)}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: g.color, color: '#fff' }}>
                  <td colSpan={cols - 1} style={{ textAlign: 'right', fontWeight: 700 }}>
                    TOTAL {g.titulo}{esCredito ? ' (saldo pendiente)' : ''}
                  </td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{totalesTexto(g)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}

      {!loading && !vacio && (
        <div className="card" style={{ background: 'var(--brand, #ff8a00)', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
          <div>
            <strong style={{ fontSize: '1.05rem' }}>TOTAL GENERAL</strong>
            <div style={{ fontSize: '.78rem', opacity: .9 }}>Suma de los cuatro renglones (en crédito, el saldo pendiente) · en la moneda de cada compra</div>
          </div>
          <div className="mono" style={{ textAlign: 'right', fontSize: '1.25rem', fontWeight: 800 }}>
            {fmtMonto(total.usd, 'USD')}  ·  {fmtMonto(total.bs, 'Bs')}
          </div>
        </div>
      )}

      {/* El mismo mensaje que se manda por WhatsApp, con sus emojis, a la vista. */}
      {!loading && !vacio && (
        <details style={{ marginTop: '.9rem' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>💬 Mensaje para WhatsApp (con emojis)</summary>
          <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '.5rem 0' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => void copiar()}>📋 Copiar mensaje</button>
          </div>
          <pre className="surt-mensaje">{mensaje}</pre>
        </details>
      )}
    </Modal>
  );
}
