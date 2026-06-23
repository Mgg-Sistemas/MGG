import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { CorreoReporteModal } from '@/shared/ui/CorreoReporteModal';
import { money, num, dateTime, hoyISO } from '@/shared/lib/format';
import { useSession } from '@/modules/auth/authStore';
import type { Almacen, Existencia, Producto } from '@/shared/lib/types';
import { resumenInventarioMovs, type ResumenInventarioMovs, type ResumenGrupo } from './inventarioResumen.repository';
import {
  descargarResumenInventarioPdf, enviarResumenInventarioPorCorreo,
  type ResumenAlmacenFila, type ResumenInventarioFull,
} from './inventarioResumenPdf';

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const byNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre, 'es');

/** Primer día del mes actual (YYYY-MM-DD). */
function inicioMes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function haceDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function ResumenInventarioModal({ productos, existencias, almacenes, onClose }: {
  productos: Producto[];
  existencias: Existencia[];
  almacenes: Almacen[];
  onClose: () => void;
}) {
  const { user } = useSession();
  const [desde, setDesde] = useState(inicioMes());
  const [hasta, setHasta] = useState(hoyISO());
  const [movs, setMovs] = useState<ResumenInventarioMovs | null>(null);
  const [loading, setLoading] = useState(false);
  // Detalle al hacer click: grupo de movimientos o un almacén concreto.
  const [verGrupo, setVerGrupo] = useState<'nuevos' | 'salidas' | 'traslados' | null>(null);
  const [verAlmacen, setVerAlmacen] = useState<string | null>(null);
  const [correoOpen, setCorreoOpen] = useState(false);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    resumenInventarioMovs(desde, hasta)
      .then((r) => { if (!cancel) setMovs(r); })
      .catch((e) => { if (!cancel) toast(e instanceof Error ? e.message : 'No se pudo cargar el resumen', 'error'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [desde, hasta]);

  // Valor total del inventario (mismo criterio que la tarjeta global: stock × precio del catálogo).
  const totalInventario = useMemo(
    () => round2(productos.filter((p) => p.estado === 'activo').reduce((a, p) => a + (Number(p.stock) || 0) * (Number(p.precio) || 0), 0)),
    [productos],
  );

  // Valor/unidades por almacén (foto actual de existencias).
  const valorPorAlmacen = useMemo(() => {
    const m = new Map<string, { valor: number; unidades: number; items: number }>();
    existencias.forEach((e) => {
      const st = Number(e.stock) || 0;
      const cur = m.get(e.almacen) ?? { valor: 0, unidades: 0, items: 0 };
      cur.valor += st * (Number(e.costo_promedio) || 0);
      cur.unidades += st;
      cur.items += 1;
      m.set(e.almacen, cur);
    });
    return m;
  }, [existencias]);

  // Filas: cada almacén padre seguido de sus subalmacenes (indentados).
  const almacenesFilas = useMemo<ResumenAlmacenFila[]>(() => {
    const filas: ResumenAlmacenFila[] = [];
    const usados = new Set<string>();
    const push = (a: Almacen, esSub: boolean) => {
      const v = valorPorAlmacen.get(a.nombre) ?? { valor: 0, unidades: 0, items: 0 };
      filas.push({ nombre: a.nombre, esSub, valor: round2(v.valor), unidades: v.unidades, items: v.items });
      usados.add(a.nombre);
    };
    const principales = almacenes.filter((a) => !a.parent_id && a.estado === 'activo').sort(byNombre);
    for (const p of principales) {
      push(p, false);
      almacenes.filter((h) => h.parent_id === p.id && h.estado === 'activo').sort(byNombre).forEach((h) => push(h, true));
    }
    // Almacenes con existencias que no están en el catálogo activo (legados).
    for (const [nombre, v] of valorPorAlmacen) {
      if (!usados.has(nombre)) filas.push({ nombre, esSub: false, valor: round2(v.valor), unidades: v.unidades, items: v.items });
    }
    return filas;
  }, [almacenes, valorPorAlmacen]);

  // Productos dentro de un almacén (para el detalle al hacer click).
  const prodMap = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const productosDeAlmacen = useMemo(() => {
    if (!verAlmacen) return [];
    return existencias
      .filter((e) => e.almacen === verAlmacen && (Number(e.stock) || 0) > 0)
      .map((e) => ({ e, p: prodMap.get(e.producto_id) }))
      .sort((a, b) => (Number(b.e.stock) || 0) * (Number(b.e.costo_promedio) || 0) - (Number(a.e.stock) || 0) * (Number(a.e.costo_promedio) || 0));
  }, [verAlmacen, existencias, prodMap]);

  const fullData = (): ResumenInventarioFull | null => (movs ? { desde, hasta, totalInventario, almacenes: almacenesFilas, movs } : null);

  async function onPdf() {
    const d = fullData();
    if (!d) { toast('Esperá a que cargue el resumen', 'warning'); return; }
    try { await descargarResumenInventarioPdf(d); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  const grupoSel: ResumenGrupo | null = movs && verGrupo ? movs[verGrupo] : null;
  const grupoTitulo = verGrupo === 'nuevos' ? 'Productos nuevos' : verGrupo === 'salidas' ? 'Salidas' : verGrupo === 'traslados' ? 'Traslados' : '';

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      <button type="button" className="btn btn-ghost" onClick={() => setCorreoOpen(true)} disabled={!movs}>✉ Enviar por correo</button>
      <button type="button" className="btn btn-primary" onClick={onPdf} disabled={!movs}>↓ PDF (vista previa)</button>
    </>
  );

  const Kpi = ({ label, valor, sub, onClick, color }: { label: string; valor: string; sub?: string; onClick?: () => void; color?: string }) => (
    <div className="card" onClick={onClick}
      style={{ margin: 0, padding: '.6rem .85rem', cursor: onClick ? 'pointer' : 'default', borderLeft: color ? `3px solid ${color}` : undefined }}>
      <div className="muted" style={{ fontSize: '.68rem' }}>{label}</div>
      <div className="mono" style={{ fontSize: '1.15rem', fontWeight: 700 }}>{valor}</div>
      {sub && <div className="muted" style={{ fontSize: '.72rem' }}>{sub}</div>}
    </div>
  );

  return (
    <Modal title="📊 Resumen de Inventario" size="xl" onClose={onClose} footer={footer}>
      {/* Período */}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.8rem' }}>
        <button className="btn btn-sm btn-ghost" onClick={() => { setDesde(hoyISO()); setHasta(hoyISO()); }}>Hoy</button>
        <button className="btn btn-sm btn-ghost" onClick={() => { setDesde(haceDias(6)); setHasta(hoyISO()); }}>Semana</button>
        <button className="btn btn-sm btn-ghost" onClick={() => { setDesde(inicioMes()); setHasta(hoyISO()); }}>Mes</button>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
          Desde <input className="input" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} style={{ width: 'auto' }} />
        </label>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
          Hasta <input className="input" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} style={{ width: 'auto' }} />
        </label>
        {loading && <span className="muted" style={{ fontSize: '.8rem' }}>cargando…</span>}
      </div>

      {/* KPIs (los de movimientos abren su detalle al click) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '.6rem', marginBottom: '.9rem' }}>
        <Kpi label="VALOR TOTAL INVENTARIO" valor={money(totalInventario)} sub={`${num(almacenesFilas.length)} almacén(es)`} />
        <Kpi label="PRODUCTOS NUEVOS" valor={num(movs?.nuevos.count ?? 0)} sub={movs ? money(movs.nuevos.total) : '—'} color="var(--success)"
          onClick={() => setVerGrupo(verGrupo === 'nuevos' ? null : 'nuevos')} />
        <Kpi label="SALIDAS" valor={num(movs?.salidas.count ?? 0)} sub={movs ? money(movs.salidas.total) : '—'} color="var(--warning)"
          onClick={() => setVerGrupo(verGrupo === 'salidas' ? null : 'salidas')} />
        <Kpi label="TRASLADOS" valor={num(movs?.traslados.count ?? 0)} sub={movs ? money(movs.traslados.total) : '—'} color="var(--info, #38bdf8)"
          onClick={() => setVerGrupo(verGrupo === 'traslados' ? null : 'traslados')} />
      </div>

      {/* Detalle del grupo de movimientos seleccionado */}
      {grupoSel && (
        <div className="card" style={{ margin: '0 0 .9rem', padding: '.6rem .85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
            <strong>{grupoTitulo} · {grupoSel.count} · {money(grupoSel.total)}</strong>
            <button className="btn btn-sm btn-ghost" onClick={() => setVerGrupo(null)}>✕</button>
          </div>
          {grupoSel.items.length === 0 ? (
            <div className="muted" style={{ fontSize: '.85rem' }}>Sin movimientos en el período.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ fontSize: '.8rem' }}>
                <thead><tr><th>Fecha</th><th>SKU</th><th>Producto</th><th style={{ textAlign: 'right' }}>Cant.</th><th>Almacén</th><th>Destino</th><th style={{ textAlign: 'right' }}>Valor</th></tr></thead>
                <tbody>
                  {grupoSel.items.map((it, i) => (
                    <tr key={`${it.producto_id}-${i}`}>
                      <td>{dateTime(it.at)}</td>
                      <td className="mono">{it.sku ?? '—'}</td>
                      <td>{it.nombre ?? '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{num(it.cantidad)} {it.unidad ?? ''}</td>
                      <td>{it.almacen ?? '—'}</td>
                      <td>{it.destino ?? '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{money(it.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Total por almacén / subalmacén (click → productos de ese almacén) */}
      <div className="card" style={{ margin: 0, padding: '.6rem .85rem' }}>
        <strong style={{ display: 'block', marginBottom: '.4rem' }}>Total por almacén y subalmacén</strong>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead><tr><th>Almacén</th><th style={{ textAlign: 'right' }}>Productos</th><th style={{ textAlign: 'right' }}>Unidades</th><th style={{ textAlign: 'right' }}>Valor</th></tr></thead>
            <tbody>
              {almacenesFilas.map((a) => (
                <tr key={a.nombre} style={{ cursor: 'pointer' }} onClick={() => setVerAlmacen(verAlmacen === a.nombre ? null : a.nombre)}>
                  <td style={{ paddingLeft: a.esSub ? '1.4rem' : undefined }}>{a.esSub ? '› ' : ''}{a.nombre}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(a.items)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(a.unidades)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(a.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detalle de un almacén (productos) */}
      {verAlmacen && (
        <Modal title={`📦 ${verAlmacen}`} size="lg" onClose={() => setVerAlmacen(null)}>
          {productosDeAlmacen.length === 0 ? (
            <div className="muted">Sin productos con stock en este almacén.</div>
          ) : (
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead><tr><th>SKU</th><th>Producto</th><th style={{ textAlign: 'right' }}>Stock</th><th style={{ textAlign: 'right' }}>Costo</th><th style={{ textAlign: 'right' }}>Valor</th></tr></thead>
              <tbody>
                {productosDeAlmacen.map(({ e, p }) => (
                  <tr key={e.producto_id}>
                    <td className="mono">{p?.sku ?? '—'}</td>
                    <td>{p?.nombre ?? '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{num(e.stock)} {p?.unidad ?? ''}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(e.costo_promedio)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money((Number(e.stock) || 0) * (Number(e.costo_promedio) || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}

      {correoOpen && (
        <CorreoReporteModal
          titulo="Enviar Resumen de Inventario"
          descripcion={`Se enviará el PDF del resumen del período ${desde} → ${hasta}.`}
          defaultEmail={user?.email ?? ''}
          onEnviar={async (emails) => {
            const d = fullData();
            if (!d) throw new Error('El resumen aún no cargó');
            return enviarResumenInventarioPorCorreo(d, emails);
          }}
          onClose={() => setCorreoOpen(false)}
        />
      )}
    </Modal>
  );
}
