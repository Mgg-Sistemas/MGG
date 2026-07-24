import { Fragment, useEffect, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { date, money } from '@/shared/lib/format';
import type {
  OfertaProveedor,
  Orden,
  Proveedor,
} from '@/shared/lib/types';
import { listOfertasByOrden, aceptarOferta as aceptarOfertaRepo, actualizarOferta, getPdfOfertaSignedUrl, descuentoEfectivo, eliminarOferta, comparativaPorProducto, adjuntosDeOferta, subirAdjuntosOferta } from './ofertas.repository';
import { urlAdjuntoOc, listSubOcs } from './pedidos.repository';
import { getStatsForProveedores, type ProveedorStats } from './evaluaciones.repository';
import { scoreOfertas, type ScoredOferta } from './score';
import { aprobarOrdenConOferta } from './pedidos.repository';
import { AgregarOfertaModal } from './AgregarOfertaModal';
import { AceptarOfertaModal } from './AceptarOfertaModal';
import type { ItemOrden } from '@/shared/lib/types';

interface Props {
  orden: Orden;
  proveedorMap: Map<string, Proveedor>;
  canDecidir: boolean;            // solo el jefe (admin): aceptar oferta = aprobar
  canCrearOferta?: boolean;       // admin o analista: cargar ofertas de proveedores
  actorEmail: string;
  reloadKey?: number;
  onAccepted: () => void;
  onAddOferta: () => void;
}

export function OfertasComparativa({
  orden,
  proveedorMap,
  canDecidir,
  canCrearOferta,
  actorEmail,
  reloadKey,
  onAccepted,
  onAddOferta,
}: Props) {
  const [ofertas, setOfertas] = useState<OfertaProveedor[]>([]);
  const [stats, setStats] = useState<Map<string, ProveedorStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [confirmando, setConfirmando] = useState<ScoredOferta | null>(null);
  const [eliminando, setEliminando] = useState<OfertaProveedor | null>(null);
  const [editando, setEditando] = useState<OfertaProveedor | null>(null);
  const [expandido, setExpandido] = useState<Set<string>>(new Set());
  const [bump, setBump] = useState(0);
  // SKUs ya asignados a una sub-OC (multiproveedor): se ocultan de las ofertas restantes,
  // así el detalle solo muestra los productos que quedan pendientes por asignar.
  const [lockedSkus, setLockedSkus] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => setExpandido((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Lista de proveedores (para mostrar el nombre fijo al editar una oferta).
  const proveedores = Array.from(proveedorMap.values());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listOfertasByOrden(orden.id)
      .then(async (rows) => {
        if (cancelled) return;
        setOfertas(rows);
        const pids = Array.from(new Set(rows.map((r) => r.proveedor_id)));
        const [s, hijas] = await Promise.all([getStatsForProveedores(pids), listSubOcs(orden.id)]);
        if (cancelled) return;
        setStats(s);
        // Ítems ya cubiertos por una sub-OC (asignación parcial por proveedor): quedan fuera de las ofertas restantes.
        const locked = new Set<string>();
        for (const h of hijas) for (const it of (h.items ?? [])) if (it.sku) locked.add(it.sku);
        setLockedSkus(locked);
      })
      .catch((e: unknown) => {
        if (!cancelled) toast(e instanceof Error ? e.message : 'Error al cargar ofertas', 'error');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orden.id, reloadKey, bump]);

  const scored = scoreOfertas(ofertas, stats);

  async function confirmarEliminar(of: OfertaProveedor) {
    try {
      await eliminarOferta(of.id);
      setOfertas((prev) => prev.filter((o) => o.id !== of.id));
      toast('Oferta eliminada', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo eliminar la oferta', 'error');
    } finally {
      setEliminando(null);
    }
  }

  async function abrirPdf(path: string) {
    try {
      const url = await getPdfOfertaSignedUrl(path);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo abrir el PDF', 'error');
    }
  }
  // Imagen de referencia de la SOLICITUD (SP): convive con las fotos de las ofertas, no se borra.
  async function abrirImagenSp() {
    if (!orden.imagen_path) return;
    try {
      const url = await urlAdjuntoOc(orden.imagen_path);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo abrir la imagen', 'error');
    }
  }

  /**
   * Confirma la oferta con la(s) marca(s) elegida(s) en el modal: si un producto
   * venía en varias marcas, `itemsElegidos` trae solo la marca escogida por producto.
   * Se persisten en la oferta (items + totales recalculados) para que la OC y el
   * ahorro por efectivo cuadren, y luego se acepta y se crea la OC.
   */
  async function confirmarAceptacion(s: ScoredOferta, itemsElegidos: ItemOrden[], bcvTotal: number, usdTotal: number, motivo: string, adjuntosFiles: File[]) {
    if (!itemsElegidos.some((it) => (Number(it.precio) || 0) > 0 || (Number(it.precio_usd) || 0) > 0)) {
      toast('Cargá al menos un precio: las marcas elegidas están en $0.', 'error');
      return;
    }
    try {
      // Adjuntos de la observación (imágenes/PDF): se suben al bucket de ofertas.
      const motivoAdjuntos = adjuntosFiles.length
        ? await subirAdjuntosOferta(orden.id, s.oferta.proveedor_id, adjuntosFiles)
        : [];
      // Si el usuario descartó marcas (había variantes), la oferta ahora refleja solo lo elegido.
      const huboSeleccion = itemsElegidos.length !== s.oferta.items.length;
      if (huboSeleccion) {
        await actualizarOferta(s.oferta.id, {
          items: itemsElegidos,
          precio_total: bcvTotal,
          precio_efectivo: usdTotal > 0 ? usdTotal : null,
        });
      }
      await aceptarOfertaRepo(s.oferta.id, actorEmail, s.score.total);
      await aprobarOrdenConOferta(
        orden,
        s.oferta.proveedor_id,
        itemsElegidos,
        bcvTotal,
        s.score.total,
        actorEmail,
        motivo || null,
        motivoAdjuntos.length ? motivoAdjuntos : null,
      );
      notify('Oferta elegida · pendiente por aprobación del Gerente General', 'success', { link: '#/app/pedidos' });
      onAccepted();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo elegir la oferta', 'error');
    } finally {
      setConfirmando(null);
    }
  }

  // Las ofertas se cargan/eligen sobre la OP ya APROBADA (etapa Orden de Compra).
  const enEtapaOc = orden.estado === 'aprobada' || orden.estado === 'desistida_proveedor';
  // Cotizaciones: mínimo 1 para poder elegir, máximo 6 para cargar.
  const MIN_OFERTAS = 1, MAX_OFERTAS = 6;
  const minOk = ofertas.length >= MIN_OFERTAS;
  const puedeDecidir = canDecidir && enEtapaOc && minOk;
  const puedeAgregar = (canCrearOferta ?? canDecidir) && enEtapaOc && ofertas.length < MAX_OFERTAS;

  const headLine = (
    <div className="card-title" style={{ marginBottom: '.5rem' }}>
      <span>Ofertas y comparativa</span>
      <span style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
        <span className="muted mono">{scored.length}/{MAX_OFERTAS} oferta(s)</span>
        {puedeAgregar && (
          <button className="btn btn-sm btn-ghost" onClick={onAddOferta}>+ Agregar oferta</button>
        )}
      </span>
    </div>
  );

  if (loading) {
    return (
      <div className="card" style={{ marginTop: '1rem' }}>
        {headLine}
        <p className="hint muted" style={{ margin: 0 }}>Cargando ofertas…</p>
      </div>
    );
  }

  if (!ofertas.length) {
    return (
      <div className="card" style={{ marginTop: '1rem' }}>
        {headLine}
        <EmptyState message="Aún no hay ofertas registradas para esta orden." icon="◇" />
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      {headLine}
      {orden.imagen_path && (
        <div className="card" style={{ margin: '0 0 .6rem', padding: '.45rem .7rem', background: 'var(--bg-1)', display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>📷 Imagen de referencia de la solicitud (SP)</span>
          <button className="btn btn-sm btn-ghost" onClick={abrirImagenSp}>Ver imagen</button>
          <span className="muted" style={{ fontSize: '.74rem' }}>Convive con las fotos de cada oferta (columna PDF/foto) — no se reemplaza.</span>
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Proveedor</th>
              <th className="num">Precio total<div className="muted" style={{ fontWeight: 400, fontSize: '.7rem' }}>BCV · efectivo</div></th>
              <th>Entrega prom.</th>
              <th className="num">Puntualidad</th>
              <th className="num">Calidad</th>
              <th className="num">Cumpl.</th>
              <th className="num">Score</th>
              <th>PDF</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {scored.map((s) => {
              const prov = proveedorMap.get(s.oferta.proveedor_id);
              const recomendada = s.recomendada && s.oferta.estado === 'pendiente';
              const aceptada = s.oferta.estado === 'aceptada';
              const seleccionable = s.oferta.estado === 'pendiente' && puedeDecidir;
              const rowBg = recomendada
                ? 'var(--grad-primary-soft)'
                : aceptada
                  ? 'rgba(41,192,129,0.08)'
                  : undefined;
              return (
                <Fragment key={s.oferta.id}>
                  <tr
                    className="row-selectable"
                    onClick={() => toggleExpand(s.oferta.id)}
                    title="Clic para ver el detalle por producto (Bs · USD)"
                    style={{
                      background: rowBg,
                      cursor: 'pointer',
                      borderBottom: seleccionable ? 'none' : undefined,
                    }}
                  >
                    <td>
                      <div>
                        <strong>{prov?.razon_social ?? '—'}</strong>{' '}
                        {recomendada && <span className="badge primary" style={{ marginLeft: '.4rem' }}>★ Recomendada</span>}
                        {aceptada && <span className="badge success" style={{ marginLeft: '.4rem' }}>Aceptada</span>}
                      </div>
                      <div style={{ marginTop: '.2rem', display: 'flex', gap: '.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        {s.mejorPrecio && <span className="badge info">Mejor precio</span>}
                        {s.masPuntual && <span className="badge info">Más puntual</span>}
                        {s.mejorCalidad && <span className="badge info">Mejor calidad</span>}
                        <span className="muted" style={{ fontSize: '.74rem' }}>
                          {expandido.has(s.oferta.id) ? '▾ Detalle por producto' : '▸ Clic para ver detalle por producto'}
                        </span>
                      </div>
                    </td>
                    <td className="num mono">
                      {(() => {
                        // El PRECIO TOTAL mostrado YA incluye IVA + IGTF (el "monto final" de la oferta).
                        const iva = Number(s.oferta.iva) || 0;
                        const igtf = Number(s.oferta.igtf) || 0;
                        const imp = iva + igtf;
                        const bcvConImp = Math.round(((Number(s.oferta.precio_total) || 0) + imp) * 100) / 100;
                        const efe = Number(s.oferta.precio_efectivo) || 0;
                        const ahorro = descuentoEfectivo(s.oferta.precio_total, s.oferta.precio_efectivo);
                        return (
                          <>
                            <strong>{money(bcvConImp)}</strong>
                            {imp > 0 && (
                              <div className="muted" style={{ fontSize: '.7rem', marginTop: '.1rem', whiteSpace: 'nowrap' }}>
                                base {money(Number(s.oferta.precio_total))}{iva > 0 ? ` · IVA ${money(iva)}` : ''}{igtf > 0 ? ` · IGTF ${money(igtf)}` : ''}
                              </div>
                            )}
                            {ahorro && (
                              <div style={{ fontSize: '.75rem', marginTop: '.15rem', whiteSpace: 'nowrap' }}>
                                <span style={{ color: 'var(--success)' }}>{money(Math.round((efe + imp) * 100) / 100)}</span>{' '}
                                <span className="badge success" title={`Ahorro ${money(ahorro.diferencia)} (${money(s.oferta.precio_total)} BCV − ${money(efe)} efectivo)`}>−{ahorro.pct.toFixed(2)}%</span>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </td>
                    <td className="muted" style={{ fontSize: '.85rem' }}>{date(s.oferta.fecha_entrega_prometida)}</td>
                    <td className="num mono">{(s.score.puntualidad * 100).toFixed(0)}%</td>
                    <td className="num mono">{(s.stats.calidad_avg).toFixed(1)} / 5</td>
                    <td className="num mono">{(s.score.cumplimiento * 100).toFixed(0)}%</td>
                    <td className="num mono"><strong>{(s.score.total * 100).toFixed(0)}</strong></td>
                    <td>
                      {(() => {
                        const adj = adjuntosDeOferta(s.oferta);
                        if (!adj.length) return <span className="muted" style={{ fontSize: '.78rem' }}>—</span>;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', alignItems: 'flex-start' }}>
                            {adj.map((a, i) => (
                              <button
                                key={a.path}
                                className="btn btn-sm btn-ghost"
                                style={{ padding: '0 .35rem' }}
                                onClick={(e) => { e.stopPropagation(); abrirPdf(a.path); }}
                                title={a.filename}
                              >
                                📎 {adj.length > 1 ? `Ver ${i + 1}` : 'Ver'}
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
                        {s.oferta.estado === 'pendiente' && <span className="badge warning">Pendiente</span>}
                        {s.oferta.estado === 'aceptada' && <span className="badge success">Aceptada</span>}
                        {s.oferta.estado === 'descartada' && <span className="badge danger">Descartada</span>}
                        {canCrearOferta && s.oferta.estado === 'pendiente' && (
                          <>
                            <button
                              className="btn btn-sm btn-ghost"
                              title="Editar esta oferta (precios, condición, datos…)"
                              style={{ padding: '0 .35rem' }}
                              onClick={(e) => { e.stopPropagation(); setEditando(s.oferta); }}
                            >✎</button>
                            <button
                              className="btn btn-sm btn-ghost"
                              title="Eliminar esta oferta"
                              style={{ padding: '0 .35rem', color: 'var(--danger)' }}
                              onClick={(e) => { e.stopPropagation(); setEliminando(s.oferta); }}
                            >🗑</button>
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                  {(() => {
                    const d = s.oferta.detalle;
                    if (!d) return null;
                    const tecn = ([
                      ['Marca', d.marca], ['Modelo', d.modelo], ['Procedencia', d.procedencia],
                      ['Materiales', d.materiales], ['Dimensiones', d.dimensiones], ['Peso', d.peso], ['Calidad', d.calidad],
                    ] as [string, string | null | undefined][]).filter(([, v]) => v && String(v).trim());
                    const labLog = (v?: string | null) => v === 'incluido' ? 'incluido' : v === 'por_cuenta' ? 'por cuenta del comprador' : null;
                    const log = ([
                      ['Flete', d.logistica?.flete], ['Transporte', d.logistica?.transporte],
                      ['Embalaje', d.logistica?.embalaje], ['Seguros', d.logistica?.seguros],
                    ] as [string, string | null | undefined][]).map(([k, v]) => [k, labLog(v)] as const).filter(([, v]) => v);
                    if (!tecn.length && !log.length) return null;
                    return (
                      <tr>
                        <td colSpan={9} style={{ paddingTop: 0, paddingBottom: '.5rem', fontSize: '.78rem' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem .6rem' }}>
                            {tecn.map(([k, v]) => <span key={k} className="muted"><strong>{k}:</strong> {v}</span>)}
                            {log.map(([k, v]) => <span key={k} className="muted">🚚 <strong>{k}:</strong> {v}</span>)}
                          </div>
                        </td>
                      </tr>
                    );
                  })()}
                  {expandido.has(s.oferta.id) && (() => {
                    // Solo los productos que siguen PENDIENTES por asignar (ocultamos los ya cubiertos por una sub-OC).
                    const itemsPend = lockedSkus.size ? s.oferta.items.filter((it) => !lockedSkus.has(it.sku)) : s.oferta.items;
                    const filas = comparativaPorProducto(itemsPend);
                    const totBcv = filas.reduce((a, f) => a + f.totalBcv, 0);
                    const totUsd = filas.reduce((a, f) => a + f.totalUsd, 0);
                    const hayUsd = filas.some((f) => f.precioUsd > 0);
                    if (!filas.length) {
                      return (
                        <tr>
                          <td colSpan={9} style={{ padding: '.3rem .6rem .7rem' }}>
                            <p className="hint muted" style={{ margin: 0, fontSize: '.8rem' }}>Todos los productos de esta oferta ya fueron asignados a un proveedor.</p>
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr>
                        <td colSpan={9} style={{ padding: '.3rem .6rem .7rem' }}>
                          <div className="table-wrap">
                            <table className="table" style={{ fontSize: '.8rem', margin: 0 }}>
                              <thead>
                                <tr>
                                  <th>Producto</th>
                                  <th>Marca / modelo</th>
                                  <th className="num">Cant.</th>
                                  <th className="num" style={{ background: 'rgba(80,140,255,.10)' }}>Precio BCV</th>
                                  <th className="num" style={{ background: 'rgba(80,140,255,.10)' }}>Total BCV</th>
                                  <th className="num" style={{ background: 'rgba(255,120,120,.10)' }}>Precio USD</th>
                                  <th className="num" style={{ background: 'rgba(255,120,120,.10)' }}>Total USD</th>
                                  <th className="num">Diferencia</th>
                                  <th className="num">Var. %</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filas.map((f, fi) => (
                                  <tr key={`${f.sku}-${fi}`}>
                                    <td>{f.nombre}</td>
                                    <td>{[f.marca, f.modelo].filter(Boolean).join(' · ') || <span className="muted">—</span>}</td>
                                    <td className="num mono">{f.cantidad}</td>
                                    <td className="num mono">{money(f.precioBcv)}</td>
                                    <td className="num mono">{money(f.totalBcv)}</td>
                                    <td className="num mono">{f.precioUsd > 0 ? money(f.precioUsd) : '—'}</td>
                                    <td className="num mono">{f.precioUsd > 0 ? money(f.totalUsd) : '—'}</td>
                                    <td className="num mono" style={{ color: f.diferencia > 0 ? 'var(--success)' : undefined }}>{hayUsd ? money(f.diferencia) : '—'}</td>
                                    <td className="num mono">{f.precioUsd > 0 ? `${f.pct.toFixed(2)}%` : '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr style={{ fontWeight: 700 }}>
                                  <td colSpan={4} className="num">TOTAL</td>
                                  <td className="num mono">{money(totBcv)}</td>
                                  <td></td>
                                  <td className="num mono">{hayUsd ? money(totUsd) : '—'}</td>
                                  <td className="num mono">{hayUsd ? money(totBcv - totUsd) : '—'}</td>
                                  <td></td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </td>
                      </tr>
                    );
                  })()}
                  {seleccionable && (
                    <tr
                      className="row-selectable"
                      onClick={() => setConfirmando(s)}
                      style={{ background: rowBg, cursor: 'pointer' }}
                    >
                      <td colSpan={9} style={{ textAlign: 'right', paddingTop: 0, paddingBottom: '.6rem' }}>
                        <button
                          className={recomendada ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'}
                          onClick={(e) => { e.stopPropagation(); setConfirmando(s); }}
                        >
                          {recomendada ? '★ Aceptar oferta recomendada' : 'Aceptar esta oferta'}
                        </button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {enEtapaOc && canDecidir && !minOk && (
        <p className="hint muted" style={{ marginTop: '.6rem', fontSize: '.82rem' }}>
          Cargá al menos {MIN_OFERTAS} cotizaciones (máximo {MAX_OFERTAS}) para poder elegir la oferta ganadora.
        </p>
      )}
      {enEtapaOc && !canDecidir && (
        <p className="hint muted" style={{ marginTop: '.6rem', fontSize: '.82rem' }}>
          La oferta del proveedor
        </p>
      )}

      {eliminando && (
        <ConfirmDialog
          title="Eliminar oferta"
          message={`¿Eliminar la oferta de ${proveedorMap.get(eliminando.proveedor_id)?.razon_social ?? 'este proveedor'} (${money(eliminando.precio_total)})? Se quita de la comparativa.`}
          confirmText="Eliminar"
          danger
          onConfirm={() => confirmarEliminar(eliminando)}
          onCancel={() => setEliminando(null)}
        />
      )}
      {editando && (
        <AgregarOfertaModal
          orden={orden}
          proveedores={proveedores}
          proveedoresYaOfertados={new Set()}
          registradoPorEmail={actorEmail}
          ofertaEdit={editando}
          onClose={() => setEditando(null)}
          onCreated={() => { setEditando(null); setBump((b) => b + 1); }}
        />
      )}
      {confirmando && (
        <AceptarOfertaModal
          oferta={confirmando.oferta}
          proveedorNombre={proveedorMap.get(confirmando.oferta.proveedor_id)?.razon_social ?? 'este proveedor'}
          onConfirm={(items, bcv, usd, motivo, files) => confirmarAceptacion(confirmando, items, bcv, usd, motivo, files)}
          onCancel={() => setConfirmando(null)}
        />
      )}
    </div>
  );
}
