/* ============================================================
   Golden Touch · Retenciones · Facturas de Compras por registrar (P03)

   Los archivos de factura que Compras subió y que todavía no son un
   documento fiscal: se ven y, con permiso, «Registrar factura» abre el
   registro con el archivo y su orden (lo arma quien monta este componente
   con onRegistrar). Con `origenIds`, solo los de esas órdenes, compras o
   servicios. Sin P03, o sin archivos por registrar, no se muestra.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { previewArchivo } from '@/shared/lib/reportePreview';
import { useRealtime } from '@/shared/lib/useRealtime';
import { dateTime } from '@/shared/lib/format';
import { p03Disponible } from './disponibilidad';
import { NOMBRE_ORIGEN, facturasPorRegistrar, urlFacturaDeOrigen, type FacturaDeOrigen } from './documentosOrigen.repository';

export function FacturasPorRegistrar({ origenIds, puedeRegistrar, onRegistrar, titulo = '🧾 Facturas de Compras sin cargar' }: {
  origenIds?: string[];
  puedeRegistrar: boolean;
  onRegistrar: (f: FacturaDeOrigen) => void;
  titulo?: string;
}) {
  const [conP03, setConP03] = useState(false);
  const [lista, setLista] = useState<FacturaDeOrigen[]>([]);
  const [conViejas, setConViejas] = useState(false);
  const [cuantas, setCuantas] = useState(10);
  const clave = origenIds ? origenIds.join(',') : '*';

  useEffect(() => {
    let vivo = true;
    void p03Disponible().then((v) => { if (vivo) setConP03(v); });
    return () => { vivo = false; };
  }, []);

  const reload = useCallback(async () => {
    if (!conP03) return;
    try { setLista(await facturasPorRegistrar(clave === '*' ? undefined : clave.split(',').filter(Boolean))); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudieron leer las facturas por registrar', 'error'); }
  }, [conP03, clave]);

  useEffect(() => { void reload(); }, [reload]);
  useRealtime(['adjuntos_directos', 'retencion_documento_origenes'], () => { void reload(); }, { enabled: conP03 });

  async function abrir(f: FacturaDeOrigen) {
    try { previewArchivo(await urlFacturaDeOrigen(f), f.nombre); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir la factura', 'error'); }
  }

  // Por defecto, solo lo que Compras marcó como factura; los archivos anteriores (sin clasificar: pueden ser pagos) aparte.
  const marcadas = lista.filter((f) => f.esFactura === true);
  const viejas = lista.filter((f) => f.esFactura !== true);
  const base = conViejas ? lista : marcadas;
  const mostradas = base.slice(0, cuantas);

  if (!conP03) return null;
  if (!lista.length) {
    return (
      <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        <p style={{ margin: 0, fontSize: '.92rem' }}>No hay facturas de compras pendientes por registrar.</p>
        <small>Los archivos de factura adjuntos a órdenes de compra aparecerán aquí para cargarse en Retenciones.</small>
      </div>
    );
  }

  return (
    <details className="card" style={{ marginTop: '.6rem' }}>
      <summary style={{ cursor: 'pointer' }}>
        <strong style={{ fontSize: '.9rem' }}>{titulo}</strong>{' '}
        <span className="badge">{marcadas.length}</span>
        <small className="muted"> · archivos de factura que subió Compras y que todavía no se cargan en Retenciones. Pulsa para verlos.</small>
      </summary>
      {viejas.length > 0 && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.8rem', marginTop: '.4rem' }}>
          <input type="checkbox" checked={conViejas} onChange={(e) => { setConViejas(e.target.checked); setCuantas(10); }} />
          Incluir {viejas.length} archivo(s) anteriores sin clasificar (pueden ser pagos u otros papeles, no solo facturas)
        </label>
      )}
      {!base.length && <p className="muted" style={{ fontSize: '.82rem', margin: '.4rem 0 0' }}>Ningún archivo marcado como factura por cargar.</p>}
      <ul style={{ listStyle: 'none', margin: '.4rem 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
        {mostradas.map((f) => (
          <li key={f.adjuntoId} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '.4rem', minWidth: 0 }}>
              <span>{(f.contentType ?? '').startsWith('image/') ? '🖼' : '📄'}</span>
              <button type="button" className="btn btn-sm btn-ghost" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                onClick={() => abrir(f)} title="Ver la factura">{f.nombre}</button>
              <small className="muted">{NOMBRE_ORIGEN[f.origen.tipo]} · subido el {dateTime(f.subidoEn)}</small>
            </span>
            {puedeRegistrar && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => onRegistrar(f)}>Cargar en Retenciones</button>
            )}
          </li>
        ))}
      </ul>
      {base.length > mostradas.length && (
        <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: '.4rem' }} onClick={() => setCuantas((c) => c + 10)}>
          Ver 10 más ({base.length - mostradas.length} restantes)
        </button>
      )}
    </details>
  );
}
