/* ============================================================
   MGG · Compras · Pendientes por pagar (modal en pantalla)
   Unifica TODO lo que se debe pagar: Compras directas · Órdenes
   de compra · Servicios · Servicios directos, con subtotales y un
   TOTAL GENERAL en $ y Bs (tasa BCV del día). Sección aparte de
   CUENTAS A CRÉDITO (cuenta abierta, saldo pendiente). Realtime.
   Adentro, botón para ver/descargar el PDF (misma data).
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { listOrdenesPorPagar, listOrdenesEnCredito, type OrdenPorPagar } from './pedidos.repository';
import { cargarDirectosPorPagar, type DirectoFila } from './DirectosPorPagarModal';
import { getTasaHoy, aBs, aExtranjero } from '@/modules/tesoreria/tasas.repository';

const esBsMoneda = (m: string | null | undefined): boolean => /bs|ves/i.test(String(m ?? ''));
function usd(n: number | null | undefined): string {
  return `$ ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function bs(n: number | null | undefined): string {
  return `Bs ${Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface FilaRep { codigo: string; nombre: string; detalle: string; montoUsd: number }
interface Segmento { titulo: string; color: string; filas: FilaRep[] }

export function PendientesPorPagarModal({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<OrdenPorPagar[]>([]);
  const [directos, setDirectos] = useState<DirectoFila[]>([]);
  const [creditos, setCreditos] = useState<OrdenPorPagar[]>([]);
  const [tasa, setTasa] = useState(0);
  const [tasaFecha, setTasaFecha] = useState<string | null>(null);
  const [genPdf, setGenPdf] = useState(false);

  const cargar = useCallback(async () => {
    const [r, d, c, t] = await Promise.all([
      listOrdenesPorPagar().catch(() => [] as OrdenPorPagar[]),
      cargarDirectosPorPagar().catch(() => [] as DirectoFila[]),
      listOrdenesEnCredito().catch(() => [] as OrdenPorPagar[]),
      getTasaHoy().catch(() => null),
    ]);
    setRows(r); setDirectos(d); setCreditos(c);
    setTasa(Number(t?.usd) || 0); setTasaFecha(t?.fecha ?? null);
    setLoading(false);
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  // Realtime: cada pago (OC, compra/servicio directo) actualiza la lista al instante.
  useRealtime(['ordenes', 'compras_directas', 'servicios_directos', 'movimientos_caja', 'cajas'], () => { void cargar(); });

  const { segmentos, totalUsd, credFilas, credTotal } = useMemo(() => {
    const ocRows = rows.filter((r) => r.orden.clase !== 'servicio');
    const servRows = rows.filter((r) => r.orden.clase === 'servicio');
    const comprasDir = directos.filter((d) => d.kind === 'compra');
    const servDir = directos.filter((d) => d.kind === 'servicio');

    const deOrden = (r: OrdenPorPagar): FilaRep => ({
      codigo: r.orden.oc_codigo ?? r.orden.codigo, nombre: r.proveedorNombre,
      detalle: r.esperandoMetodo ? 'Esperando método' : 'Lista para pagar',
      montoUsd: Number(r.montoAPagar) || 0,
    });
    const deDirecto = (d: DirectoFila): FilaRep => ({
      codigo: d.codigo, nombre: d.titulo, detalle: d.detalle || '—',
      montoUsd: esBsMoneda(d.moneda) ? aExtranjero(Number(d.total) || 0, tasa) : (Number(d.total) || 0),
    });

    const segs: Segmento[] = [
      { titulo: 'COMPRAS DIRECTAS', color: '#2563eb', filas: comprasDir.map(deDirecto) },
      { titulo: 'ÓRDENES DE COMPRA', color: '#ff8a00', filas: ocRows.map(deOrden) },
      { titulo: 'SERVICIOS', color: '#7c5cff', filas: servRows.map(deOrden) },
      { titulo: 'SERVICIOS DIRECTOS', color: '#108a78', filas: servDir.map(deDirecto) },
    ].filter((s) => s.filas.length > 0);
    const total = segs.reduce((a, s) => a + s.filas.reduce((b, f) => b + f.montoUsd, 0), 0);

    const cred = creditos.map((r) => {
      const t = Number(r.montoAPagar) || 0;
      const ab = Math.max(0, Number(r.orden.abonado_total) || 0);
      return { codigo: r.orden.oc_codigo ?? r.orden.codigo, nombre: r.proveedorNombre, abonado: ab, total: t, saldo: Math.max(0, Math.round((t - ab) * 100) / 100) };
    });
    const credT = cred.reduce((a, f) => a + f.saldo, 0);
    return { segmentos: segs, totalUsd: total, credFilas: cred, credTotal: credT };
  }, [rows, directos, creditos, tasa]);

  const nPend = rows.length + directos.length;
  const vacio = !loading && nPend === 0 && creditos.length === 0;

  async function verPdf() {
    setGenPdf(true);
    try {
      const { descargarResumenPorPagarPdf } = await import('@/modules/tesoreria/ordenesPorPagarPdf');
      await descargarResumenPorPagarPdf(rows, directos, creditos);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
    finally { setGenPdf(false); }
  }

  const montoCell = (u: number) => (
    <>
      <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{usd(u)}</td>
      <td className="mono muted" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{tasa > 0 ? bs(aBs(u, tasa)) : '—'}</td>
    </>
  );

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      <button className="btn btn-primary" onClick={() => void verPdf()} disabled={genPdf || vacio}>
        {genPdf ? 'Generando…' : '📄 Ver PDF (vista previa)'}
      </button>
    </>
  );

  return (
    <Modal title="Pendientes por pagar" size="lg" onClose={onClose} footer={footer}>
      <div className="muted" style={{ fontSize: '.82rem', marginBottom: '.6rem' }}>
        {tasa > 0 ? `Tasa BCV del día: ${bs(tasa)}/$${tasaFecha ? ` · ${tasaFecha}` : ''}` : 'Sin tasa BCV disponible'}
        {' · '}<strong>{nPend}</strong> pendiente(s){creditos.length ? ` · ${creditos.length} a crédito` : ''} · se actualiza en vivo
      </div>

      {loading && <div className="card"><p className="hint muted" style={{ margin: 0 }}>Cargando…</p></div>}

      {vacio && (
        <div className="card"><p className="hint muted" style={{ margin: 0 }}>✅ No hay pendientes por pagar en este momento.</p></div>
      )}

      {!loading && segmentos.map((seg) => {
        const sub = seg.filas.reduce((a, f) => a + f.montoUsd, 0);
        return (
          <div key={seg.titulo} className="table-wrap" style={{ marginBottom: '.9rem' }}>
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead>
                <tr><th colSpan={5} style={{ background: seg.color, color: '#fff', fontWeight: 700, letterSpacing: '.02em' }}>{seg.titulo}</th></tr>
                <tr>
                  <th style={{ width: 92 }}>CÓDIGO</th>
                  <th>PROVEEDOR / CONCEPTO</th>
                  <th>DETALLE</th>
                  <th style={{ textAlign: 'right' }}>MONTO $</th>
                  <th style={{ textAlign: 'right' }}>MONTO Bs</th>
                </tr>
              </thead>
              <tbody>
                {seg.filas.map((f, i) => (
                  <tr key={`${f.codigo}-${i}`}>
                    <td className="mono">{f.codigo}</td>
                    <td>{f.nombre}</td>
                    <td className="muted" style={{ fontSize: '.78rem' }}>{f.detalle}</td>
                    {montoCell(f.montoUsd)}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: seg.color, color: '#fff' }}>
                  <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>TOTAL {seg.titulo}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{usd(sub)}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{tasa > 0 ? bs(aBs(sub, tasa)) : '—'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}

      {/* TOTAL GENERAL (lo que se debe pagar ahora) */}
      {!loading && segmentos.length > 0 && (
        <div className="card" style={{ background: 'var(--brand, #ff8a00)', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.9rem' }}>
          <strong style={{ fontSize: '1.05rem' }}>TOTAL GENERAL</strong>
          <div style={{ textAlign: 'right' }}>
            <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800 }}>{usd(totalUsd)}</div>
            <div className="mono" style={{ fontSize: '1rem' }}>{tasa > 0 ? bs(aBs(totalUsd, tasa)) : 'Sin tasa BCV'}</div>
          </div>
        </div>
      )}

      {/* CUENTAS A CRÉDITO (aparte del total por pagar) */}
      {!loading && credFilas.length > 0 && (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead>
              <tr><th colSpan={5} style={{ background: '#dc2626', color: '#fff', fontWeight: 700 }}>CUENTAS A CRÉDITO · se saldan con abonos</th></tr>
              <tr>
                <th style={{ width: 92 }}>CÓDIGO</th>
                <th>PROVEEDOR</th>
                <th>ABONOS</th>
                <th style={{ textAlign: 'right' }}>SALDO $</th>
                <th style={{ textAlign: 'right' }}>SALDO Bs</th>
              </tr>
            </thead>
            <tbody>
              {credFilas.map((f, i) => (
                <tr key={`${f.codigo}-${i}`}>
                  <td className="mono">{f.codigo}</td>
                  <td>{f.nombre}</td>
                  <td className="muted" style={{ fontSize: '.78rem' }}>Abonado {usd(f.abonado)} de {usd(f.total)}</td>
                  {montoCell(f.saldo)}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#dc2626', color: '#fff' }}>
                <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>TOTAL A CRÉDITO (saldo pendiente)</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{usd(credTotal)}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{tasa > 0 ? bs(aBs(credTotal, tasa)) : '—'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Modal>
  );
}
