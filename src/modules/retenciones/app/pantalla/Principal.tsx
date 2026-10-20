/* ============================================================
   MGG · Retenciones v8 · Pantalla principal

   Traslado de la maqueta v8 (35cbb02b): la cabecera con su descripción
   por pestaña, la fila de accesos y las pestañas de siempre (Por realizar,
   Realizadas y Libro fiscal). Lo que depende de datos que la base aún no
   tiene no se muestra: la tira «Período en curso», los chips de
   Vencimientos, Otro sistema e Impresión, y las pestañas Vista agrupada,
   Períodos y Reportes (capacidades de la puerta en false).
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { money } from '@/shared/lib/format';
import { usePuerta, type RetencionItem, type RetencionPracticada } from '../datos/puerta';
import { documentosPendientes, nombreImpuesto } from './pendientesPorDocumento';
import { PorRealizar } from './PorRealizar';
import './principal.css';

type Seccion = 'pendientes' | 'hechas' | 'libro';

const DESCRIPCION: Record<Seccion, string> = {
  pendientes: 'OC y compras con retenciones pendientes de registrar.',
  hechas: 'Facturas con retenciones registradas y sus comprobantes.',
  libro: 'Libro fiscal: una fila por retención.',
};

interface Props {
  /** Abre ⚙ Parámetros. Sin ella, el acceso no se muestra. */
  onParametros?: () => void;
  /** Abre el registro de una retención. Sin ella, los botones «Registrar» no se muestran. */
  onRegistrar?: (item: RetencionItem, impuesto: string) => void;
}

interface Datos { pendientes: RetencionItem[]; hechas: RetencionItem[]; libro: RetencionPracticada[] }

export function Principal({ onParametros, onRegistrar }: Props) {
  const puerta = usePuerta();
  const [sec, setSec] = useState<Seccion>('pendientes');
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    setError(null);
    Promise.all([puerta.pendientes(), puerta.hechas(), puerta.libro()])
      .then(([pendientes, hechas, libro]) => setDatos({ pendientes, hechas, libro }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudieron leer las retenciones.'));
  }, [puerta]);
  useEffect(() => { cargar(); }, [cargar]);

  const docs = useMemo(() => (datos ? documentosPendientes(datos.pendientes, datos.libro) : []), [datos]);

  return (
    <main className="page ret-v8">
      <header className="page-head">
        <div>
          <h1>🧾 Retenciones</h1>
          <p>{DESCRIPCION[sec]}</p>
        </div>
        <div className="cabeza-acciones">
          {onParametros && <button type="button" className="btn btn-ghost" onClick={onParametros}>⚙ Parámetros</button>}
          <nav className="view-toggle" aria-label="Pantallas del módulo">
            <button type="button" aria-current={sec === 'pendientes' ? 'page' : undefined} onClick={() => setSec('pendientes')}>
              Por realizar{datos ? ` (${docs.length})` : ''}
            </button>
            <button type="button" aria-current={sec === 'hechas' ? 'page' : undefined} onClick={() => setSec('hechas')}>Realizadas</button>
            <button type="button" aria-current={sec === 'libro' ? 'page' : undefined} onClick={() => setSec('libro')}>📒 Libro fiscal</button>
          </nav>
        </div>
      </header>

      {error && (
        <div className="aviso-error" role="alert">
          No se pudieron leer las retenciones: {error} <button type="button" className="mini" onClick={cargar}>Reintentar</button>
        </div>
      )}
      {!error && !datos && <p className="muted" role="status">Cargando…</p>}

      {datos && sec === 'pendientes' && <PorRealizar docs={docs} onRegistrar={onRegistrar} />}

      {datos && sec === 'hechas' && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>OC o compra</th><th>Proveedor</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
            <tbody>
              {datos.hechas.map((it) => (
                <tr key={`${it.kind}-${it.id}`}><td className="mono">{it.ocCodigo ?? '—'}</td><td>{it.proveedorNombre}</td><td className="mono" style={{ textAlign: 'right' }}>{money(it.total, it.moneda)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {datos && sec === 'libro' && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Fecha</th><th>Comprobante</th><th>Impuesto</th><th>Proveedor</th><th style={{ textAlign: 'right' }}>Retenido</th></tr></thead>
            <tbody>
              {datos.libro.map((r) => (
                <tr key={r.id}><td>{r.facturaFecha ?? '—'}</td><td className="mono">{r.numeroComprobante ?? '—'}</td><td>{nombreImpuesto(r.tipo)}</td><td>{r.contraparteNombre ?? '—'}</td><td className="mono" style={{ textAlign: 'right' }}>{money(r.montoRetenido, r.moneda)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
