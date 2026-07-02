import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { money, num, dateTime } from '@/shared/lib/format';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { labelCondicionPago } from '@/modules/pedidos/ofertas.repository';
import { urlAdjuntoCompra, finalizarRetencionCompraDirecta, type CompraDirecta } from '@/modules/pedidos/compras.repository';
import {
  listRetencionesPendientes, listRetencionesHechas, finalizarRetencion,
  urlRetencion, comprobantesDeOrden, labelRetencionModo,
  TIPOS_RETENCION, type RetencionItem, type TipoRetencion,
} from './retenciones.repository';

type Vista = 'pendientes' | 'hechas';

/** Formatea un monto según la moneda de la fila (compra directa puede ser Bs). */
function fmtMonto(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'Bs' ? `Bs ${v}` : `$ ${v}`;
}

export function RetencionesPage() {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('retenciones', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;

  const [vista, setVista] = useState<Vista>('pendientes');
  const [pendientes, setPendientes] = useState<RetencionItem[]>([]);
  const [hechas, setHechas] = useState<RetencionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<RetencionItem | null>(null);

  // Filtros del historial (vista Realizadas).
  const [fDesde, setFDesde] = useState('');
  const [fHasta, setFHasta] = useState('');
  const [fTipo, setFTipo] = useState<'' | TipoRetencion>('');
  const [fTexto, setFTexto] = useState('');
  const limpiarFiltros = () => { setFDesde(''); setFHasta(''); setFTipo(''); setFTexto(''); };

  const reload = useCallback(async () => {
    const [p, h] = await Promise.all([
      listRetencionesPendientes().catch(() => [] as RetencionItem[]),
      listRetencionesHechas().catch(() => [] as RetencionItem[]),
    ]);
    setPendientes(p); setHechas(h);
  }, []);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    reload().catch(() => { /* RLS/red */ }).finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reload]);

  // Realtime multiusuario: lo que registra otro (o paga Tesorería) se refleja al instante.
  useRealtime(['ordenes', 'compras_directas'], () => { void reload(); });

  // Historial filtrado (solo aplica a la vista Realizadas).
  const hechasFiltradas = useMemo(() => {
    const txt = fTexto.trim().toLowerCase();
    return hechas.filter((it) => {
      const fin = (it.finalizadaEn ?? '').slice(0, 10);
      if (fDesde && fin && fin < fDesde) return false;
      if (fHasta && fin && fin > fHasta) return false;
      if (fDesde && !fin) return false;
      if (fTipo && !it.tiposComprobante.includes(fTipo)) return false;
      if (txt) {
        const hay = `${it.ocCodigo ?? ''} ${it.opCodigo ?? ''} ${it.proveedorNombre}`.toLowerCase();
        if (!hay.includes(txt)) return false;
      }
      return true;
    });
  }, [hechas, fDesde, fHasta, fTipo, fTexto]);

  const filas = vista === 'pendientes' ? pendientes : hechasFiltradas;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>🧾 Retenciones</h1>
          <p className="hint muted" style={{ margin: '.25rem 0 0' }}>Retenciones fiscales de las OC con soporte de factura.</p>
        </div>
        <div className="view-toggle" role="tablist" aria-label="Vista de retenciones">
          <button className={vista === 'pendientes' ? 'active' : ''} onClick={() => setVista('pendientes')}>Por realizar{pendientes.length ? ` (${pendientes.length})` : ''}</button>
          <button className={vista === 'hechas' ? 'active' : ''} onClick={() => setVista('hechas')}>Realizadas</button>
        </div>
      </div>

      {/* Tarjeta total pendientes (solo en la vista Por realizar) */}
      {vista === 'pendientes' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
          <div className="card" style={{ margin: 0 }}>
            <div className="muted" style={{ fontSize: '.75rem', textTransform: 'uppercase', letterSpacing: '.03em' }}>Total de retenciones pendientes</div>
            <div className="mono" style={{ fontSize: '1.9rem', fontWeight: 800, color: pendientes.length ? 'var(--warning)' : 'var(--success)' }}>{pendientes.length}</div>
          </div>
        </div>
      )}

      {/* Filtros del historial (solo en Realizadas) */}
      {vista === 'hechas' && (
        <div className="card" style={{ marginBottom: '.75rem' }}>
          <div className="filterbar" style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-row" style={{ margin: 0 }}>
              <label>Desde</label>
              <input className="input" type="date" value={fDesde} onChange={(e) => setFDesde(e.target.value)} />
            </div>
            <div className="form-row" style={{ margin: 0 }}>
              <label>Hasta</label>
              <input className="input" type="date" value={fHasta} onChange={(e) => setFHasta(e.target.value)} />
            </div>
            <div className="form-row" style={{ margin: 0 }}>
              <label>Tipo de retención</label>
              <select className="select" value={fTipo} onChange={(e) => setFTipo(e.target.value as '' | TipoRetencion)}>
                <option value="">Todas</option>
                {TIPOS_RETENCION.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            <div className="form-row" style={{ margin: 0, flex: '1 1 200px' }}>
              <label>Buscar (OC / proveedor)</label>
              <input className="input" value={fTexto} onChange={(e) => setFTexto(e.target.value)} placeholder="N° OC, OP o proveedor…" />
            </div>
            <button className="btn btn-ghost" onClick={limpiarFiltros}>Limpiar</button>
            <span className="muted" style={{ fontSize: '.8rem', marginLeft: 'auto' }}>{hechasFiltradas.length} de {hechas.length}</span>
          </div>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.86rem' }}>
            <thead>
              <tr>
                <th>N°OC</th><th>OP</th><th>Proveedor</th><th>Condición</th><th>Retención</th>
                <th style={{ textAlign: 'right' }}>Total $</th><th>Tesorería</th>
                {vista === 'hechas' && <th>Realizada</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={vista === 'hechas' ? 9 : 8} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
              {!loading && !filas.length && (
                <tr><td colSpan={vista === 'hechas' ? 9 : 8}><EmptyState icon={vista === 'pendientes' ? '✅' : '🧾'} message={vista === 'pendientes' ? 'No hay retenciones pendientes' : 'Sin retenciones en el historial con esos filtros'} /></td></tr>
              )}
              {!loading && filas.map((it) => (
                <tr key={`${it.kind}-${it.id}`}>
                  <td className="mono">{it.ocCodigo ?? '—'}{it.kind === 'compra_directa' && <span className="badge" style={{ marginLeft: '.35rem' }} title="Compra directa">CD</span>}</td>
                  <td className="mono">{it.opCodigo ?? '—'}</td>
                  <td>{it.proveedorNombre}</td>
                  <td>{it.condicionLabel}</td>
                  <td>{it.retencionLabel}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{fmtMonto(it.total, it.moneda)}</td>
                  <td>{it.tesoreria === 'pagada' ? <span className="badge" style={{ color: 'var(--success)' }}>✓ Pagada</span> : it.tesoreria === 'por_pagar' ? <span className="muted">Por pagar</span> : <span className="muted">—</span>}</td>
                  {vista === 'hechas' && <td className="muted">{it.finalizadaEn ? dateTime(it.finalizadaEn) : '—'}</td>}
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-sm btn-primary" onClick={() => setSel(it)}>Ver</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {sel && sel.kind === 'oc' && sel.orden && (
        <RetencionModal
          item={sel} canWrite={canWrite} actor={actor} actorName={actorName}
          onClose={() => setSel(null)}
          onSaved={async () => { setSel(null); await reload(); }}
        />
      )}
      {sel && sel.kind === 'compra_directa' && sel.compra && (
        <RetencionCompraModal
          compra={sel.compra} canWrite={canWrite} actor={actor}
          onClose={() => setSel(null)}
          onSaved={async () => { setSel(null); await reload(); }}
        />
      )}
    </div>
  );
}

function RetencionModal({ item, canWrite, actor, actorName, onClose, onSaved }: {
  item: RetencionItem; canWrite: boolean; actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const o = item.orden!;
  const yaFinalizada = !!o.retencion_finalizada;
  const comprobantes = useMemo(() => comprobantesDeOrden(o), [o]);
  const [archivos, setArchivos] = useState<Partial<Record<TipoRetencion, File>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const algunArchivo = (Object.values(archivos) as (File | undefined)[]).some(Boolean);

  function setArchivo(tipo: TipoRetencion, file: File | null) {
    setArchivos((m) => ({ ...m, [tipo]: file ?? undefined }));
  }

  async function descargar(path: string) {
    try { window.open(await urlRetencion(path), '_blank', 'noopener'); }
    catch { toast('No se pudo abrir el comprobante', 'error'); }
  }

  async function verComprobante(path: string, nombre?: string | null) {
    try { await previewFileUrl(await urlRetencion(path), nombre ?? 'comprobante', 'Comprobante de la OC'); }
    catch { toast('No se pudo abrir el comprobante', 'error'); }
  }

  const labelComprobante = o.comprobante_tipo === 'nota_entrega' ? 'Nota de entrega' : 'Factura';

  async function handleFinalizar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!algunArchivo) { setError('Cargá al menos un comprobante (IVA, ISLR o Municipal).'); return; }
    setSaving(true);
    try {
      void actorName;
      await finalizarRetencion({ orden: o, archivos, actor });
      notify(`Retención registrada · OC ${o.oc_codigo ?? o.codigo}`, 'success', { link: '#/app/retenciones' });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo finalizar la retención.'); setSaving(false); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cerrar</button>
      {!yaFinalizada && canWrite && (
        <button type="submit" form="ret-form" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Finalizar retención'}</button>
      )}
    </>
  );

  return (
    <Modal title={`Retención · OC ${o.oc_codigo ?? o.codigo}`} size="lg" onClose={onClose} footer={footer}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

      {/* Detalle de la OC */}
      <div className="card" style={{ margin: '0 0 .75rem' }}>
        <div className="card-title" style={{ marginBottom: '.4rem' }}>Detalle de la orden de compra</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '.4rem .9rem', fontSize: '.86rem' }}>
          <div><span className="muted">Proveedor:</span> <strong>{item.proveedorNombre}</strong></div>
          <div><span className="muted">Condición:</span> {labelCondicionPago(o.condiciones_pago)}</div>
          <div><span className="muted">Retención:</span> {labelRetencionModo(o.retencion_modo)}</div>
          <div><span className="muted">Total:</span> <strong className="mono">{money(o.total)}</strong></div>
          <div><span className="muted">Tesorería:</span> {o.retencion_pagada ? <strong style={{ color: 'var(--success)' }}>✓ Pagada{o.retencion_pagada_en ? ` · ${dateTime(o.retencion_pagada_en)}` : ''}</strong> : 'Por pagar'}</div>
        </div>
        <div className="table-wrap" style={{ marginTop: '.5rem' }}>
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead><tr><th>Material</th><th style={{ textAlign: 'right' }}>Cant.</th><th style={{ textAlign: 'right' }}>Precio</th></tr></thead>
            <tbody>
              {(o.items ?? []).map((it, i) => (
                <tr key={i}><td>{it.nombre}{it.sku ? <span className="muted"> · {it.sku}</span> : null}</td><td className="mono" style={{ textAlign: 'right' }}>{num(it.cantidad)}</td><td className="mono" style={{ textAlign: 'right' }}>{money(it.precio)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Factura / nota de entrega cargada en la OC (comprobante de ingreso) */}
      {o.factura_path && (
        <div className="card" style={{ margin: '0 0 .75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
          <span style={{ fontSize: '.85rem' }}>
            <span className="badge">{labelComprobante}</span> <span className="muted">{o.factura_nombre}</span>
          </span>
          <button className="btn btn-sm btn-ghost" onClick={() => void verComprobante(o.factura_path!, o.factura_nombre)}>👁 Vista previa</button>
        </div>
      )}

      {/* Comprobantes ya cargados (descarga) */}
      {comprobantes.length > 0 && (
        <div className="card" style={{ margin: '0 0 .75rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}>Comprobantes cargados</div>
          <div style={{ display: 'grid', gap: '.35rem' }}>
            {comprobantes.map((c) => (
              <div key={c.tipo} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', fontSize: '.85rem' }}>
                <span><span className="badge">{c.label}</span> <span className="muted">{c.nombre}</span></span>
                <button className="btn btn-sm btn-ghost" onClick={() => descargar(c.path)}>📎 Descargar</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Carga de los 3 comprobantes (al menos uno) */}
      {!yaFinalizada && canWrite && (
        <form id="ret-form" onSubmit={handleFinalizar}>
          <div className="muted" style={{ fontSize: '.8rem', marginBottom: '.5rem' }}>
            Cargá <strong>al menos uno</strong> de los comprobantes (PDF o imagen). Al finalizar, la retención queda registrada y se refleja en Tesorería.
          </div>
          {TIPOS_RETENCION.map((t) => (
            <div key={t.key} className="form-row">
              <label>{t.label}</label>
              <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setArchivo(t.key, e.target.files?.[0] ?? null)} />
              {archivos[t.key] && <small className="muted">{archivos[t.key]?.name}</small>}
            </div>
          ))}
        </form>
      )}
      {yaFinalizada && (
        <div className="muted" style={{ fontSize: '.84rem' }}>✓ Retención finalizada{o.retencion_finalizada_en ? ` el ${dateTime(o.retencion_finalizada_en)}` : ''}.</div>
      )}
    </Modal>
  );
}

/* ───────── Modal: retención de una COMPRA DIRECTA (retención de IVA) ───────── */

function RetencionCompraModal({ compra, canWrite, actor, onClose, onSaved }: {
  compra: CompraDirecta; canWrite: boolean; actor: string; onClose: () => void; onSaved: () => void;
}) {
  const m = compra.moneda || 'Bs';
  const yaFinalizada = !!compra.retencion_finalizada;
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verFactura(path: string, nombre?: string | null) {
    try { await previewFileUrl(await urlAdjuntoCompra(path), nombre ?? 'comprobante', 'Comprobante de la compra directa'); }
    catch { toast('No se pudo abrir el comprobante', 'error'); }
  }

  async function handleFinalizar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!file) { setError('Cargá el comprobante de la retención de IVA (PDF o imagen).'); return; }
    setSaving(true);
    try {
      await finalizarRetencionCompraDirecta({ compra, file, actor });
      notify(`Retención registrada · Compra directa ${compra.codigo ?? ''}`, 'success', { link: '#/app/retenciones' });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo finalizar la retención.'); setSaving(false); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cerrar</button>
      {!yaFinalizada && canWrite && (
        <button type="submit" form="ret-cd-form" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Finalizar retención'}</button>
      )}
    </>
  );

  return (
    <Modal title={`Retención · Compra directa ${compra.codigo ?? ''}`} size="lg" onClose={onClose} footer={footer}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

      {/* Detalle de la compra directa */}
      <div className="card" style={{ margin: '0 0 .75rem' }}>
        <div className="card-title" style={{ marginBottom: '.4rem' }}>Detalle de la compra directa</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '.4rem .9rem', fontSize: '.86rem' }}>
          <div><span className="muted">Proveedor:</span> <strong>{compra.proveedor_nombre || '—'}</strong></div>
          <div><span className="muted">Moneda:</span> {m === 'Bs' ? 'Bolívares (Bs)' : 'Dólares ($)'}</div>
          {compra.descuento_monto > 0 && <div><span className="muted">Descuento:</span> {compra.descuento_pct ? `${compra.descuento_pct}% · ` : ''}{fmtMonto(compra.descuento_monto, m)}</div>}
          <div><span className="muted">IVA:</span> <strong className="mono">{fmtMonto(compra.iva, m)}</strong></div>
          <div><span className="muted">Retención IVA:</span> <strong className="mono">{compra.retencion_pct}% · {fmtMonto(compra.retencion_monto, m)}</strong></div>
          <div><span className="muted">Total:</span> <strong className="mono">{fmtMonto(compra.gasto, m)}</strong></div>
          <div><span className="muted">Tesorería:</span> {compra.estado === 'por_pagar' ? 'Por pagar' : <strong style={{ color: 'var(--success)' }}>✓ Pagada</strong>}</div>
        </div>
        <div className="table-wrap" style={{ marginTop: '.5rem' }}>
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead><tr><th>Material</th><th style={{ textAlign: 'right' }}>Cant.</th><th style={{ textAlign: 'right' }}>Precio</th></tr></thead>
            <tbody>
              {(compra.items ?? []).map((it, i) => (
                <tr key={i}><td>{it.producto_nombre}{it.producto_sku ? <span className="muted"> · {it.producto_sku}</span> : null}</td><td className="mono" style={{ textAlign: 'right' }}>{num(it.cantidad)}</td><td className="mono" style={{ textAlign: 'right' }}>{fmtMonto(it.gasto, m)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Facturas cargadas en la compra */}
      {(compra.facturas?.length ?? 0) > 0 && (
        <div className="card" style={{ margin: '0 0 .75rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}>Facturas de la compra</div>
          <div style={{ display: 'grid', gap: '.3rem' }}>
            {compra.facturas.map((a) => (
              <div key={a.path} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', fontSize: '.85rem' }}>
                <span className="muted">📎 {a.filename}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => void verFactura(a.path, a.filename)}>👁 Vista previa</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Comprobante de retención ya cargado */}
      {compra.retencion_iva_path && (
        <div className="card" style={{ margin: '0 0 .75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
          <span style={{ fontSize: '.85rem' }}><span className="badge">Retención IVA</span> <span className="muted">{compra.retencion_iva_nombre}</span></span>
          <button className="btn btn-sm btn-ghost" onClick={() => void verFactura(compra.retencion_iva_path!, compra.retencion_iva_nombre)}>👁 Vista previa</button>
        </div>
      )}

      {/* Carga del comprobante de retención de IVA */}
      {!yaFinalizada && canWrite && (
        <form id="ret-cd-form" onSubmit={handleFinalizar}>
          <div className="muted" style={{ fontSize: '.8rem', marginBottom: '.5rem' }}>
            Cargá el <strong>comprobante de la retención de IVA</strong> (PDF o imagen). Al finalizar, la retención queda registrada.
          </div>
          <div className="form-row">
            <label>Comprobante de retención de IVA</label>
            <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file && <small className="muted">{file.name}</small>}
          </div>
        </form>
      )}
      {yaFinalizada && (
        <div className="muted" style={{ fontSize: '.84rem' }}>✓ Retención finalizada{compra.retencion_finalizada_en ? ` el ${dateTime(compra.retencion_finalizada_en)}` : ''}.</div>
      )}
    </Modal>
  );
}
