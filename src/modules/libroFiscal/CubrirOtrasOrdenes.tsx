/* ============================================================
   Golden Touch · Retenciones · Una factura que cubre varias órdenes (P03)

   En el detalle de una factura registrada: qué órdenes, compras o
   servicios cubre, y (con permiso) agregar otra del mismo proveedor o
   quitar una agregada a mano. La principal y la que salió del archivo de
   Compras no se quitan. Sin P03 no se muestra.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { p03Disponible } from './disponibilidad';
import {
  NOMBRE_ORIGEN, cubrirOrigen, dejarDeCubrir, origenesDeDocumento, origenesDelProveedor,
  type DocumentoDeOrigen, type Origen, type OrigenDelProveedor,
} from './documentosOrigen.repository';

const clave = (o: Origen) => `${o.tipo}:${o.id}`;

export function CubrirOtrasOrdenes({ documentoId, proveedorId, principal, puedeEditar }: {
  documentoId: string;
  /** Sin proveedor (una recibida, o fuera del sistema) no se agregan órdenes. */
  proveedorId: string | null;
  /** El origen con que se registró la factura. */
  principal: Origen | null;
  puedeEditar: boolean;
}) {
  const [conP03, setConP03] = useState(false);
  const [enlaces, setEnlaces] = useState<DocumentoDeOrigen[]>([]);
  const [delProveedor, setDelProveedor] = useState<OrigenDelProveedor[]>([]);
  const [elegido, setElegido] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void p03Disponible().then((v) => { if (vivo) setConP03(v); });
    return () => { vivo = false; };
  }, []);

  const reload = useCallback(async () => {
    if (!conP03) return;
    try {
      const [es, ps] = await Promise.all([origenesDeDocumento(documentoId), proveedorId ? origenesDelProveedor(proveedorId) : Promise.resolve([])]);
      setEnlaces(es); setDelProveedor(ps);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo leer qué órdenes cubre la factura', 'error'); }
  }, [conP03, documentoId, proveedorId]);

  useEffect(() => { void reload(); }, [reload]);

  const codigoDe = useMemo(() => new Map(delProveedor.map((p) => [clave(p.origen), p.codigo])), [delProveedor]);
  const cubiertos = useMemo(() => new Set(enlaces.map((e) => clave(e.origen))), [enlaces]);
  const opciones = delProveedor.filter((p) => !cubiertos.has(clave(p.origen)))
    .map((p) => ({ value: clave(p.origen), label: `${NOMBRE_ORIGEN[p.origen.tipo]} ${p.codigo ?? ''}`.trim() }));

  async function agregar() {
    const p = delProveedor.find((x) => clave(x.origen) === elegido);
    if (!p) return;
    setGuardando(true);
    try { await cubrirOrigen(documentoId, p.origen); setElegido(''); toast('La factura también cubre esa orden', 'success'); await reload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo enlazar', 'error'); }
    finally { setGuardando(false); }
  }

  async function quitar(e: DocumentoDeOrigen) {
    try { await dejarDeCubrir(e, principal, e.origen); toast('Enlace quitado', 'success'); await reload(); }
    catch (err) { toast(err instanceof Error ? err.message : 'No se pudo quitar', 'error'); }
  }

  if (!conP03) return null;

  return (
    <div className="card" style={{ marginTop: '.6rem' }}>
      <strong style={{ fontSize: '.9rem' }}>Órdenes que cubre esta factura</strong>
      <ul style={{ listStyle: 'none', margin: '.4rem 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.85rem' }}>
        {enlaces.map((e) => {
          const fija = !!e.adjuntoId || (principal && clave(principal) === clave(e.origen));
          return (
            <li key={e.enlaceId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
              <span>
                {NOMBRE_ORIGEN[e.origen.tipo]} {codigoDe.get(clave(e.origen)) ?? ''}
                {e.adjuntoId ? <small className="muted"> · del archivo de Compras</small> : fija ? <small className="muted"> · principal</small> : null}
              </span>
              {puedeEditar && !fija && (
                <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} title="Quitar esta orden" onClick={() => quitar(e)}>✕</button>
              )}
            </li>
          );
        })}
        {!enlaces.length && <li className="muted">Sin órdenes enlazadas.</li>}
      </ul>
      {puedeEditar && proveedorId && opciones.length > 0 && (
        <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 240px' }}>
            <SearchSelect value={elegido} onChange={setElegido} options={opciones} placeholder="Otra orden, compra o servicio del proveedor…" />
          </div>
          <button type="button" className="btn btn-sm btn-primary" disabled={!elegido || guardando} onClick={agregar}>
            {guardando ? 'Enlazando…' : 'Agregar'}
          </button>
        </div>
      )}
    </div>
  );
}
