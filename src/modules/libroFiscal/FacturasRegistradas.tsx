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
    <Modal title="Facturas registradas" size="xl" onClose={onClose} footer={<button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.5rem' }}>
        <input className="input" style={{ flex: '1 1 280px' }} value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por N° de factura, control, RIF o proveedor" aria-label="Buscar factura" />
        <label style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center', fontSize: '.84rem' }}>
          <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} /> Solo las que tienen algo por retener
        </label>
      </div>
      {error && <div className="card" style={{ borderColor: 'var(--danger)' }}>{error} <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cargar()}>Reintentar</button></div>}
      {!lista && !error && <p className="muted">Leyendo las facturas…</p>}
      {lista?.length === 0 && <p className="muted">{texto.trim() || soloPendientes ? 'Ninguna factura coincide.' : 'Todavía no hay facturas registradas.'}</p>}
      {lista && lista.length > 0 && (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.82rem', width: '100%' }}>
            <thead>
              <tr><th>Factura</th><th>Proveedor</th><th style={{ textAlign: 'right' }}>Total</th><th>Retenido</th><th>Por retener</th><th>No aplica</th><th aria-label="Acciones" /></tr>
            </thead>
            <tbody>
              {lista.map((f) => {
                const noAplica = Object.entries(f.decisiones).filter(([, d]) => d === 'no_aplica').map(([k]) => rotuloImpuesto(k));
                return (
                  <tr key={f.documentoId}>
                    <td>
                      <strong className="mono">{f.facturaNro ?? 'Sin número'}</strong>
                      <div className="muted" style={{ fontSize: '.74rem' }}>
                        {f.facturaControl ? `Control ${f.facturaControl} · ` : ''}{f.facturaFecha ? fechaCorta(f.facturaFecha) : 'Sin fecha'}
                        {f.direccion === 'recibida' ? ' · nos la practicaron' : ''}
                      </div>
                    </td>
                    <td>{f.razonSocial ?? '—'}{f.rif && <div className="muted mono" style={{ fontSize: '.74rem' }}>{f.rif}</div>}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{monto(f.facturaTotal, f.moneda)}</td>
                    <td>{retenidoEnTexto(f)}</td>
                    <td>{f.pendientes.length ? f.pendientes.map((k) => <span key={k} className="badge" style={{ marginRight: '.2rem' }}>{rotuloImpuesto(k)}</span>) : <span className="muted">Nada</span>}</td>
                    <td>{noAplica.length ? noAplica.join(', ') : <span className="muted">—</span>}</td>
                    <td style={{ textAlign: 'right' }}>
                      {puedeRetener && f.retenible && <button type="button" className="btn btn-sm btn-primary" onClick={() => onRetener(f)}>Retener</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint muted" style={{ fontSize: '.76rem' }}>«Por retener» cuenta solo los impuestos que la empresa practica a la fecha de la factura (según su régimen en Parámetros).</p>
    </Modal>
  );
}
