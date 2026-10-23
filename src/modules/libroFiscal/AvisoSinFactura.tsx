/* ============================================================
   Golden Touch · Retenciones · Aviso «Recibidas sin factura» (P03)

   OC recibidas, compras directas recepcionadas y servicios finalizados que
   no tienen ningún archivo que cuente como factura. Es un aviso: se pide la
   factura a Compras. Sin P03, o sin pendientes, no se muestra.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { useRealtime } from '@/shared/lib/useRealtime';
import { p03Disponible } from './disponibilidad';
import { NOMBRE_ORIGEN, origenesSinFactura, type OrigenSinFactura } from './documentosOrigen.repository';

const fechaCorta = (iso: string | null) => { if (!iso) return '—'; const [a, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${a}`; };

export function AvisoSinFactura({ rutaDe }: {
  /** Cómo abrir el origen (p. ej., la ruta de la OC en Pedidos). Sin ruta, solo el código. */
  rutaDe?: (o: OrigenSinFactura) => string | null;
}) {
  const [conP03, setConP03] = useState(false);
  const [lista, setLista] = useState<OrigenSinFactura[]>([]);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    let vivo = true;
    void p03Disponible().then((v) => { if (vivo) setConP03(v); });
    return () => { vivo = false; };
  }, []);

  const reload = useCallback(async () => {
    if (!conP03) return;
    try { setLista(await origenesSinFactura()); } catch { /* el aviso no bloquea */ }
  }, [conP03]);

  useEffect(() => { void reload(); }, [reload]);
  useRealtime(['adjuntos_directos', 'retencion_documento_origenes'], () => { void reload(); }, { enabled: conP03 });

  if (!conP03 || !lista.length) return null;

  return (
    <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: '.6rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
        <span>⚠ <strong>{lista.length}</strong> {lista.length === 1 ? 'compra ya recibida no tiene' : 'compras ya recibidas no tienen'} la factura del proveedor (órdenes de compra, controles de servicio, compras y servicios directos): pídela a Compras.</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAbierto((v) => !v)}>{abierto ? 'Ocultar' : 'Ver cuáles'}</button>
      </div>
      {abierto && (
        <ul style={{ margin: '.4rem 0 0', paddingLeft: '1.1rem', fontSize: '.85rem' }}>
          {lista.map((o) => {
            const ruta = rutaDe?.(o) ?? null;
            const etiqueta = `${NOMBRE_ORIGEN[o.origen.tipo]} ${o.codigo ?? ''}`.trim();
            return (
              <li key={`${o.origen.tipo}:${o.origen.id}`}>
                {ruta ? <a href={`#${ruta}`}>{etiqueta}</a> : etiqueta} <span className="muted">· desde el {fechaCorta(o.desde)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
