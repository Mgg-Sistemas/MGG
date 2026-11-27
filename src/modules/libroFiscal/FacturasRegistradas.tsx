/* ============================================================
   Golden Touch · Retenciones · Facturas registradas (R10)

   Cada factura registrada con lo retenido por impuesto, lo pendiente y los
   «no aplica», con su buscador (número, control, RIF o proveedor) y el
   filtro «solo las que tienen algo por retener». Desde una retenible se
   retiene después, sobre ese mismo documento.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { useRealtime } from '@/shared/lib/useRealtime';
import { listFacturasResumen, type FacturaResumen } from './facturasResumen.repository';
import { rotuloImpuesto } from './rotulos';
import { fechaCorta } from './parametrosR1';

const monto = (n: number | null | undefined, moneda: string) =>
  n == null ? '—' : `${moneda === 'Bs' ? 'Bs' : '$'} ${Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Lo retenido de una factura, por impuesto, en una línea: «IVA: Bs 120,00 · ISLR: Bs 20,00». */
function retenidoEnTexto(f: FacturaResumen): string {
  const xs = Object.entries(f.retenido).map(([k, r]) => `${rotuloImpuesto(k)}: ${monto(r.montoBs ?? r.monto, r.montoBs != null ? 'Bs' : f.moneda)}${r.lineas > 1 ? ` (${r.lineas} líneas)` : ''}`);
  return xs.length ? xs.join(' · ') : 'Nada todavía';
}

export function FacturasRegistradas({ puedeRetener, onRetener, onClose }: {
  puedeRetener: boolean;
  onRetener: (f: FacturaResumen) => void;
  onClose: () => void;
}) {
  const [texto, setTexto] = useState('');
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [lista, setLista] = useState<FacturaResumen[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try { setLista(await listFacturasResumen({ texto, soloRetenibles: soloPendientes, limite: 100 })); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron leer las facturas.'); }
  }, [texto, soloPendientes]);
  useEffect(() => { const t = setTimeout(() => { void cargar(); }, 250); return () => clearTimeout(t); }, [cargar]);
  useRealtime(['retencion_documentos', 'retenciones', 'retencion_decisiones'], () => { void cargar(); });

  return (
    <Modal title="Facturas registradas · Auditoría de retenciones" size="xl" onClose={onClose} footer={<button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '.6rem',
        padding: '.55rem .85rem',
        borderRadius: '8px',
        background: 'rgba(59, 130, 246, 0.08)',
        border: '1px solid rgba(59, 130, 246, 0.25)',
        marginBottom: '.85rem',
        fontSize: '.82rem',
        color: 'var(--text-normal, #f1f5f9)',
      }}>
        <span style={{ fontSize: '1.1rem' }}>📋</span>
        <span>
          <strong>Consolidado por documento:</strong> Esta lista agrupa cada factura con sus retenciones practicadas (ISLR, IVA, ISAE). Permite auditar montos y completar retenciones pendientes sobre la misma factura.
        </span>
      </div>

      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.65rem' }}>
        <input className="input" style={{ flex: '1 1 280px' }} value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por N° de factura, control, RIF o proveedor…" aria-label="Buscar factura" />
        <label style={{ display: 'inline-flex', gap: '.4rem', alignItems: 'center', fontSize: '.84rem', cursor: 'pointer', padding: '.4rem .6rem', borderRadius: '6px', background: 'rgba(255,255,255,0.03)' }}>
          <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
          <span style={{ fontWeight: 600 }}>Solo facturas con retenciones pendientes</span>
        </label>
      </div>
      {error && <div className="card" style={{ borderColor: 'var(--danger)' }}>{error} <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cargar()}>Reintentar</button></div>}
      {!lista && !error && <p className="muted" style={{ padding: '1rem 0' }}>Leyendo las facturas…</p>}
      {lista?.length === 0 && <p className="muted" style={{ padding: '1rem 0' }}>{texto.trim() || soloPendientes ? 'Ninguna factura coincide con los filtros.' : 'Todavía no hay facturas registradas.'}</p>}
      {lista && lista.length > 0 && (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.82rem', width: '100%' }}>
            <thead>
              <tr><th>Factura</th><th>Proveedor</th><th style={{ textAlign: 'right' }}>Total Factura</th><th>Retenido practicado</th><th>Por retener</th><th>No aplica</th><th aria-label="Acciones" /></tr>
            </thead>
            <tbody>
              {lista.map((f) => {
                const noAplica = Object.entries(f.decisiones).filter(([, d]) => d === 'no_aplica').map(([k]) => rotuloImpuesto(k));
                return (
                  <tr key={f.documentoId}>
                    <td>
                      <strong className="mono" style={{ color: 'var(--primary, #f59e0b)' }}>{f.facturaNro ?? 'Sin número'}</strong>
                      <div className="muted" style={{ fontSize: '.74rem', marginTop: '2px' }}>
                        {f.facturaControl ? `Control ${f.facturaControl} · ` : ''}{f.facturaFecha ? fechaCorta(f.facturaFecha) : 'Sin fecha'}
                        {f.direccion === 'recibida' ? ' · nos la practicaron' : ''}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{f.razonSocial ?? '—'}</div>
                      {f.rif && <div className="muted mono" style={{ fontSize: '.74rem' }}>{f.rif}</div>}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700, fontSize: '.86rem' }}>{monto(f.facturaTotal, f.moneda)}</td>
                    <td>
                      <span style={{ fontWeight: 600, color: 'var(--text-normal)' }}>{retenidoEnTexto(f)}</span>
                    </td>
                    <td>
                      {f.pendientes.length ? (
                        f.pendientes.map((k) => (
                          <span key={k} className="badge" style={{ marginRight: '.25rem', background: 'rgba(245, 158, 11, 0.15)', borderColor: 'rgba(245, 158, 11, 0.4)', color: '#fef08a' }}>
                            ⏳ {rotuloImpuesto(k)}
                          </span>
                        ))
                      ) : (
                        <span style={{ color: 'var(--success, #22c55e)', fontWeight: 600, fontSize: '.8rem' }}>✓ Al día</span>
                      )}
                    </td>
                    <td>{noAplica.length ? noAplica.join(', ') : <span className="muted">—</span>}</td>
                    <td style={{ textAlign: 'right' }}>
                      {puedeRetener && f.retenible && (
                        <button type="button" className="btn btn-sm btn-primary" title="Agregar impuestos a esta factura ya registrada" onClick={() => onRetener(f)}>
                          + Retener aquí
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint muted" style={{ fontSize: '.76rem', marginTop: '.75rem' }}>«Por retener» cuenta solo los impuestos que la empresa practica a la fecha de la factura (según su régimen en Parámetros).</p>
    </Modal>
  );
}
