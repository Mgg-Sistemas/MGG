import { useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { date, dateTime, money, num } from '@/shared/lib/format';
import type { Movimiento, Producto } from '@/shared/lib/types';
import { listMovimientosPorProducto, TIPOS_MOVIMIENTO } from './movimientos.repository';
// descargarProductoPdf se importa dinámicamente (al generar) para no cargar jsPDF al abrir.

interface ProductoDetailProps {
  producto: Producto;
  onClose: () => void;
}

export function ProductoDetail({ producto, onClose }: ProductoDetailProps) {
  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // ESTAÑO EN BRUTO / ESTAÑO REFINADO llevan doble medida: stock en kg + N° lingotes
  // (Σ lingotes producidos en fundición/refinación). Se carga aparte y solo para ellos.
  const esBruto = /bruto/i.test(producto.nombre);
  const esRefinado = /refinad/i.test(producto.nombre);
  const [lingotes, setLingotes] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listMovimientosPorProducto(producto.id)
      .then((data) => { if (!cancelled) setMovs(data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Error al cargar kardex'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [producto.id]);

  useEffect(() => {
    if (!esBruto && !esRefinado) { setLingotes(null); return; }
    let cancelled = false;
    (esBruto
      ? import('@/modules/produccion/colada.repository').then((m) => m.totalLingotesFundicion())
      : import('@/modules/produccion/refinacion.repository').then((m) => m.totalLingotesRefinacion())
    ).then((n) => { if (!cancelled) setLingotes(n); }).catch(() => { if (!cancelled) setLingotes(null); });
    return () => { cancelled = true; };
  }, [producto.id, esBruto, esRefinado]);

  const totalIn = movs.filter((m) => m.delta > 0).reduce((a, m) => a + m.delta, 0);
  const totalOut = movs.filter((m) => m.delta < 0).reduce((a, m) => a + Math.abs(m.delta), 0);

  // Reconstruir, cronológicamente, el costo inicial y el ajuste de PMP en cada
  // recompra: cuál era el costo base antes de la entrada y en cuánto quedó.
  const ajustes = new Map<string, { antes: number | null; despues: number; compra: number | null }>();
  let costoInicial: number | null = null;
  {
    const crono = [...movs].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    let lastPmp: number | null = null;
    for (const m of crono) {
      if (costoInicial == null && (m.costo_promedio != null || m.precio_unitario != null)) {
        costoInicial = m.costo_promedio ?? m.precio_unitario ?? null;
      }
      const pmp = m.costo_promedio ?? null;
      if (m.delta > 0 && pmp != null) {
        ajustes.set(m.id, { antes: lastPmp, despues: pmp, compra: m.precio_unitario ?? null });
      }
      if (pmp != null) lastPmp = pmp;
    }
  }

  async function handleDownloadPdf() {
    try {
      const { descargarProductoPdf } = await import('./productoPdf');
      await descargarProductoPdf(producto.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error');
    }
  }

  return (
    <Modal
      title={`Detalle · ${producto.sku}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={handleDownloadPdf} title="Descargar trazabilidad del producto">
            ↓ Trazabilidad PDF
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        </>
      }
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '.75rem' }}>
        <div>
          <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Trazabilidad
          </div>
          <h3 style={{ margin: '.15rem 0 0' }}>{producto.nombre}</h3>
          <div className="muted mono" style={{ fontSize: '.78rem' }}>
            {producto.sku} · {producto.categoria} · {producto.unidad} · almacén {producto.almacen}
          </div>
          <div style={{ marginTop: '.35rem', display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
            {producto.receta_fundicion && (
              <span className="badge info">Receta: {producto.receta_fundicion}</span>
            )}
            {producto.en_fundicion && (
              <span className="badge warning">🔥 EN PROCESO DE FUNDICIÓN</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <MiniStat label={esBruto || esRefinado ? 'Stock (kg)' : 'Stock actual'} value={num(producto.stock)} color="var(--primary-3)" />
          {(esBruto || esRefinado) && lingotes != null && (
            <MiniStat label="N° lingotes" value={num(lingotes)} color="var(--primary-3)" />
          )}
          <MiniStat label="Mínimo" value={num(producto.stock_min)} color="var(--text)" />
          <MiniStat label="Costo inicial" value={costoInicial != null ? money(costoInicial) : '—'} color="var(--text)" />
          <MiniStat label="Costo base (PMP)" value={money(producto.precio)} color="var(--primary-3)" />
          <MiniStat label="Entradas" value={`+${num(totalIn)}`} color="var(--success)" />
          <MiniStat label="Salidas" value={`−${num(totalOut)}`} color="var(--danger)" />
        </div>
      </div>

      {(() => {
        const detalle = ([
          ['Nombre de búsqueda', producto.nombre_busqueda],
          ['Marca', producto.marca],
          ['Modelo', producto.modelo],
          ['Fabricante', producto.fabricante],
          ['Color', producto.color],
          ['N°', producto.numero],
          ['Serial', producto.serial],
          ['Código', producto.codigo],
          ['Ubicación física', producto.ubicacion_fisica],
          ['Descripción', producto.descripcion],
        ] as Array<[string, string | null | undefined]>).filter(([, v]) => v && String(v).trim());
        if (!detalle.length) return null;
        return (
          <div className="card" style={{ margin: '0 0 .75rem', padding: '.65rem .85rem' }}>
            <div className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.4rem' }}>
              Detalle del producto
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '.35rem .9rem' }}>
              {detalle.map(([k, v]) => (
                <div key={k} style={{ fontSize: '.82rem' }}>
                  <span className="muted">{k}: </span>
                  <strong style={{ color: 'var(--text)' }}>{v}</strong>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading ? (
        <EmptyState message="Cargando kardex…" icon="◔" />
      ) : !movs.length ? (
        <div className="card" style={{ padding: '1.5rem' }}>
          <EmptyState message="Sin movimientos registrados todavía." icon="✨" />
        </div>
      ) : (
        <div className="timeline">
          {movs.map((m) => {
            const meta = TIPOS_MOVIMIENTO[m.tipo] ?? { label: m.tipo, icon: '◔', color: 'info' as const };
            const isIn = m.delta > 0;
            const isOut = m.delta < 0;
            const deltaTxt = isIn ? `+${num(m.delta)}` : isOut ? `−${num(Math.abs(m.delta))}` : '0';
            const deltaCol = isIn ? 'var(--success)' : isOut ? 'var(--danger)' : 'var(--text-muted)';
            const dotCls =
              meta.color === 'success' ? 'ok'
              : meta.color === 'warning' ? 'warn'
              : meta.color === 'danger' ? 'err'
              : 'info';

            return (
              <div className="tl-item" key={m.id}>
                <div className={`tl-dot ${dotCls}`} />
                <div className="tl-body">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '.5rem' }}>
                    <div className="tl-title">{meta.icon} {meta.label}</div>
                    <div className="mono" style={{ fontWeight: 700, fontSize: '.95rem', color: deltaCol }}>
                      {deltaTxt}
                    </div>
                  </div>
                  {m.detalle && (
                    <div style={{ fontSize: '.82rem', color: 'var(--text)', marginTop: '.15rem' }}>
                      {m.detalle}
                    </div>
                  )}
                  {m.destino && (
                    <div style={{ fontSize: '.78rem', color: 'var(--text-muted)', marginTop: '.15rem' }}>
                      {m.almacen && <>Origen: <strong style={{ color: 'var(--text)' }}>{m.almacen}</strong> → </>}
                      Destino: <strong style={{ color: 'var(--text)' }}>{m.destino}</strong>
                      {m.fecha_entrega && <> · {date(m.fecha_entrega)}</>}
                    </div>
                  )}
                  {m.consumo_interno && (
                    <div style={{ marginTop: '.2rem' }}>
                      <span className="badge info" style={{ fontSize: '.66rem' }}>🏭 Consumo interno</span>
                    </div>
                  )}
                  {m.ref_codigo && (
                    <div style={{ fontSize: '.78rem', color: 'var(--text-muted)', marginTop: '.15rem' }}>
                      Ref: <span className="mono">{m.ref_codigo}</span>
                    </div>
                  )}
                  {(m.precio_unitario != null || m.costo_promedio != null) && (
                    <div className="mono" style={{ fontSize: '.78rem', color: 'var(--text-muted)', marginTop: '.15rem' }}>
                      {m.precio_unitario != null && <>Costo unit: <strong style={{ color: 'var(--text)' }}>{money(m.precio_unitario)}</strong></>}
                      {m.precio_unitario != null && m.costo_promedio != null && ' · '}
                      {m.costo_promedio != null && <>Costo base (PMP): <strong style={{ color: 'var(--primary-3)' }}>{money(m.costo_promedio)}</strong></>}
                    </div>
                  )}
                  {(() => {
                    const aj = ajustes.get(m.id);
                    if (!aj || aj.antes == null || aj.antes === aj.despues) return null;
                    const subio = aj.despues > aj.antes;
                    return (
                      <div className="mono" style={{ fontSize: '.78rem', marginTop: '.15rem', color: subio ? 'var(--danger)' : 'var(--success)' }}>
                        💱 Precio ajustado por recompra{aj.compra != null ? ` (compra a ${money(aj.compra)})` : ''}: {money(aj.antes)} → <strong>{money(aj.despues)}</strong> {subio ? '▲' : '▼'}
                      </div>
                    );
                  })()}
                  <div className="tl-meta">
                    {dateTime(m.at)} · por {m.actor_name || m.actor || '—'}
                    {m.almacen && <> · <span className="badge" style={{ fontSize: '.62rem' }}>▣ {m.almacen}</span></>} · saldo{' '}
                    <span className="mono">{num(m.stock_despues)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="card" style={{ padding: '.55rem .75rem', margin: 0 }}>
      <div className="muted" style={{ fontSize: '.65rem', textTransform: 'uppercase' }}>{label}</div>
      <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
