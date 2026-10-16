/* ============================================================
   MGG · Retenciones v8 · Pantalla principal (esqueleto)

   Primer corte para que la ruta se vea con datos reales mientras la pieza A
   traslada la maqueta (cabecera, tira de período, pestañas, paginador,
   filtros). Solo muestra lo que ya funciona.
   ============================================================ */

import { useEffect, useState } from 'react';
import { usePuerta, type RetencionItem, type RetencionPracticada } from '../datos/puerta';

type Seccion = 'pendientes' | 'hechas' | 'libro';

const DESCRIPCION: Record<Seccion, string> = {
  pendientes: 'OC y compras con retenciones pendientes de registrar.',
  hechas: 'Facturas con retenciones registradas y sus comprobantes.',
  libro: 'Libro fiscal: una fila por retención.',
};

export function Principal() {
  const puerta = usePuerta();
  const [sec, setSec] = useState<Seccion>('pendientes');
  const [pendientes, setPendientes] = useState<RetencionItem[] | null>(null);
  const [hechas, setHechas] = useState<RetencionItem[] | null>(null);
  const [libro, setLibro] = useState<RetencionPracticada[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([puerta.pendientes(), puerta.hechas(), puerta.libro()])
      .then(([p, h, l]) => { setPendientes(p); setHechas(h); setLibro(l); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudieron leer las retenciones.'));
  }, [puerta]);

  const filas = sec === 'pendientes' ? pendientes : sec === 'hechas' ? hechas : null;
  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>🧾 Retenciones</h1>
          <p className="muted">{DESCRIPCION[sec]}</p>
        </div>
        <nav className="view-toggle" aria-label="Pantallas del módulo">
          <button aria-current={sec === 'pendientes' ? 'page' : undefined} onClick={() => setSec('pendientes')}>Por realizar{pendientes ? ` (${pendientes.length})` : ''}</button>
          <button aria-current={sec === 'hechas' ? 'page' : undefined} onClick={() => setSec('hechas')}>Realizadas</button>
          <button aria-current={sec === 'libro' ? 'page' : undefined} onClick={() => setSec('libro')}>📒 Libro fiscal</button>
        </nav>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {!error && sec !== 'libro' && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>OC o compra</th><th>Proveedor</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
            <tbody>
              {!filas && <tr><td colSpan={3} className="muted">Cargando…</td></tr>}
              {filas?.map((it) => (
                <tr key={`${it.kind}-${it.id}`}><td className="mono">{it.ocCodigo ?? '—'}</td><td>{it.proveedorNombre}</td><td className="mono" style={{ textAlign: 'right' }}>{it.moneda} {it.total.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!error && sec === 'libro' && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Fecha</th><th>Comprobante</th><th>Impuesto</th><th>Proveedor</th><th style={{ textAlign: 'right' }}>Retenido</th></tr></thead>
            <tbody>
              {!libro && <tr><td colSpan={5} className="muted">Cargando…</td></tr>}
              {libro?.map((r) => (
                <tr key={r.id}><td>{r.facturaFecha ?? "—"}</td><td className="mono">{r.numeroComprobante ?? '—'}</td><td>{r.tipo}</td><td>{r.contraparteNombre ?? '—'}</td><td className="mono" style={{ textAlign: 'right' }}>{r.moneda} {r.montoRetenido.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
