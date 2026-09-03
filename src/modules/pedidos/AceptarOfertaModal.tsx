import { useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { money } from '@/shared/lib/format';
import type { ItemOrden, OfertaProveedor } from '@/shared/lib/types';

/**
 * Al aceptar una oferta, si el proveedor cotizó el MISMO producto en varias
 * marcas (renglones con el mismo SKU cargados con "＋ marca"), acá se elige
 * cuál marca se compra — no se compran todas. Muestra por producto la marca,
 * el modelo y los precios en Bs (BCV) y en $ (USD). Los productos con una sola
 * marca entran directo. Al confirmar devuelve UN ítem por producto (el elegido).
 */

interface Grupo {
  key: string;
  nombre: string;
  sku: string;
  opciones: ItemOrden[];
}

/** Agrupa los ítems por producto (mismo SKU = variantes de marca del mismo producto). */
function agruparPorProducto(items: ItemOrden[]): Grupo[] {
  const orden: string[] = [];
  const mapa = new Map<string, Grupo>();
  for (const it of items ?? []) {
    const key = (it.sku && String(it.sku).trim()) || String(it.nombre ?? '').trim() || `#${orden.length}`;
    let g = mapa.get(key);
    if (!g) {
      g = { key, nombre: it.nombre ?? '—', sku: it.sku ?? '', opciones: [] };
      mapa.set(key, g);
      orden.push(key);
    }
    g.opciones.push(it);
  }
  return orden.map((k) => mapa.get(k)!);
}

const unit = (it: ItemOrden) => ({
  bcv: Number(it.precio) || 0,
  usd: Number(it.precio_usd) || 0,
  cant: Number(it.cantidad) || 0,
});
const marcaLabel = (it: ItemOrden) =>
  [it.marca, it.modelo].map((s) => (s ?? '').toString().trim()).filter(Boolean).join(' · ') || 'Sin marca';

interface Props {
  oferta: OfertaProveedor;
  proveedorNombre: string;
  /** SKUs que YA compra otra sub-OC viva: se muestran en gris y no se pueden marcar
   *  (comprarlos de nuevo sería pagar dos veces el mismo producto). */
  skusBloqueados?: Set<string>;
  /** Devuelve los ítems elegidos (uno por producto) + totales en Bs y $ + la observación
   *  del analista (por qué elige la oferta) y sus adjuntos (imágenes/PDF). */
  onConfirm: (itemsElegidos: ItemOrden[], bcvTotal: number, usdTotal: number, motivo: string, adjuntos: File[]) => Promise<void> | void;
  onCancel: () => void;
}

export function AceptarOfertaModal({ oferta, proveedorNombre, skusBloqueados, onConfirm, onCancel }: Props) {
  const grupos = useMemo(() => agruparPorProducto(oferta.items), [oferta.items]);
  const bloqueado = (sku: string) => !!skusBloqueados?.has(sku);
  // Solo se cotizan/compran los productos que quedan libres.
  const gruposLibres = useMemo(() => grupos.filter((g) => !bloqueado(g.sku)), [grupos, skusBloqueados]);
  const nBloqueados = grupos.length - gruposLibres.length;
  const hayVariantes = gruposLibres.some((g) => g.opciones.length > 1);

  // Selección por producto: índice de la opción elegida (por defecto la 1ª cargada).
  const [sel, setSel] = useState<Record<string, number>>(() =>
    Object.fromEntries(grupos.map((g) => [g.key, 0])),
  );
  // Qué productos se le compran a ESTA oferta. Por defecto todos los libres: se destildan
  // los que se piensan comprar a otro proveedor (quedan pendientes para asignar aparte).
  const [incluido, setIncluido] = useState<Record<string, boolean>>({});
  const estaIncluido = (key: string) => incluido[key] !== false;
  // Observación del analista (por qué elige) + adjuntos (imágenes/PDF).
  const [motivo, setMotivo] = useState('');
  const [adjuntos, setAdjuntos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const nuevos = Array.from(e.target.files ?? []);
    const validos: File[] = [];
    for (const f of nuevos) {
      if (f.type !== 'application/pdf' && !f.type.startsWith('image/')) continue; // solo imagen o PDF
      if (f.size > 10 * 1024 * 1024) continue;                                     // hasta 10 MB
      validos.push(f);
    }
    setAdjuntos((prev) => {
      const key = (f: File) => `${f.name}-${f.size}`;
      const ya = new Set(prev.map(key));
      return [...prev, ...validos.filter((f) => !ya.has(key(f)))];
    });
    e.target.value = '';
  }

  const gruposElegidos = gruposLibres.filter((g) => estaIncluido(g.key));
  const elegidos = gruposElegidos.map((g) => g.opciones[Math.min(sel[g.key] ?? 0, g.opciones.length - 1)]);
  const nDestildados = gruposLibres.length - gruposElegidos.length;
  const bcvTotal = Math.round(elegidos.reduce((a, it) => { const u = unit(it); return a + u.cant * u.bcv; }, 0) * 100) / 100;
  const usdTotal = Math.round(elegidos.reduce((a, it) => { const u = unit(it); return a + u.cant * u.usd; }, 0) * 100) / 100;
  const sinPrecio = bcvTotal <= 0 && usdTotal <= 0;
  const sinSeleccion = elegidos.length === 0;

  async function confirmar() {
    if (sinPrecio || sinSeleccion || saving) return;
    setSaving(true);
    try {
      await onConfirm(elegidos, bcvTotal, usdTotal > 0 ? usdTotal : 0, motivo.trim(), adjuntos);
    } finally {
      setSaving(false);
    }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancelar</button>
      <button className="btn btn-primary" onClick={confirmar} disabled={saving || sinPrecio || sinSeleccion}
        title={sinSeleccion ? 'Tildá al menos un producto para comprarle a este proveedor' : undefined}>
        {saving ? 'Eligiendo…' : `Elegir oferta${elegidos.length ? ` · ${elegidos.length} producto(s)` : ''}`}
      </button>
    </>
  );

  return (
    <Modal title={`Elegir oferta · ${proveedorNombre}`} size="lg" onClose={onCancel} footer={footer}>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        {hayVariantes
          ? 'Este proveedor cotizó algún producto en varias marcas. Elegí cuál marca se compra de cada uno (no se compran todas). Se muestran los precios en Bs (BCV) y en $ (USD).'
          : 'Revisá los productos, marcas y precios (Bs y $). Al confirmar, la orden queda pendiente por aprobación del Gerente General.'}
      </p>
      <p className="hint muted" style={{ marginTop: '-.4rem', fontSize: '.82rem' }}>
        ☑️ Tildá los productos que le comprás <strong>a este proveedor</strong>. Si alguno lo vas a comprar a otro, <strong>destildalo</strong>: queda pendiente y se asigna aparte desde la OP.
      </p>
      {nBloqueados > 0 && (
        <p className="hint muted" style={{ marginTop: '-.4rem', fontSize: '.82rem' }}>
          🧩 <strong>{nBloqueados}</strong> producto(s) de esta oferta ya se le compraron a otro proveedor: salen <strong>en gris</strong> y no se pueden marcar. Solo se compra —y se cobra— lo que queda pendiente.
        </p>
      )}
      {nDestildados > 0 && (
        <p className="hint" style={{ marginTop: '-.4rem', fontSize: '.82rem', color: 'var(--warning)' }}>
          ⚠ <strong>{nDestildados}</strong> producto(s) destildado(s): <strong>no</strong> se le compran a este proveedor y quedan <strong>pendientes por asignar</strong> en la OP madre.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '.7rem' }}>
        {grupos.map((g) => {
          const yaComprado = bloqueado(g.sku);
          const incl = !yaComprado && estaIncluido(g.key);
          const multi = incl && g.opciones.length > 1;
          return (
            <div key={g.key} className="card"
              style={{ margin: 0, padding: '.7rem .8rem', opacity: yaComprado ? 0.5 : (incl ? 1 : 0.6) }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '.5rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  {/* Tildar = se le compra a este proveedor. Destildar = queda pendiente
                      para comprárselo a otro (vuelve a la bolsa de la OP madre). */}
                  {!yaComprado && (
                    <input
                      type="checkbox"
                      checked={incl}
                      onChange={(e) => setIncluido((m) => ({ ...m, [g.key]: e.target.checked }))}
                      style={{ cursor: 'pointer', width: 17, height: 17 }}
                      title={incl ? 'Se le compra a este proveedor · destildá para comprarlo a otro' : 'No se le compra a este proveedor'}
                    />
                  )}
                  <strong style={yaComprado || !incl ? { textDecoration: 'line-through' } : undefined}>{g.nombre}</strong>
                  {g.sku ? <span className="muted mono" style={{ fontSize: '.78rem' }}> · {g.sku}</span> : null}
                </div>
                {yaComprado
                  ? <span className="badge">✓ Ya comprado a otro proveedor</span>
                  : !incl
                    ? <span className="badge warning">Queda pendiente · se compra a otro</span>
                    : multi
                      ? <span className="badge warning">{g.opciones.length} marcas · elegí una</span>
                      : <span className="muted" style={{ fontSize: '.76rem' }}>marca única</span>}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', marginTop: '.5rem' }}>
                {g.opciones.map((it, i) => {
                  const u = unit(it);
                  const elegida = incl && (sel[g.key] ?? 0) === i;
                  return (
                    <label
                      key={i}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'auto 1fr auto',
                        alignItems: 'center',
                        gap: '.6rem',
                        padding: '.45rem .6rem',
                        borderRadius: 8,
                        cursor: multi ? 'pointer' : 'default',
                        background: elegida ? 'var(--grad-primary-soft, rgba(255,138,0,.10))' : 'var(--bg-1)',
                        border: `1px solid ${elegida ? 'var(--brand, #ff8a00)' : 'var(--border)'}`,
                      }}
                    >
                      <input
                        type="radio"
                        name={`marca-${g.key}`}
                        checked={elegida}
                        disabled={!incl || !multi}
                        onChange={() => setSel((m) => ({ ...m, [g.key]: i }))}
                      />
                      <div>
                        <div style={{ fontWeight: 600 }}>{marcaLabel(it)}</div>
                        <div className="muted" style={{ fontSize: '.76rem' }}>
                          Cantidad: <span className="mono">{u.cant}</span>
                        </div>
                      </div>
                      <div className="mono" style={{ textAlign: 'right', fontSize: '.82rem', lineHeight: 1.5 }}>
                        <div>Bs: <strong>{u.bcv > 0 ? money(u.bcv, 'Bs') : '—'}</strong></div>
                        <div style={{ color: 'var(--success)' }}>$: <strong>{u.usd > 0 ? money(u.usd, 'USD') : '—'}</strong></div>
                        <div className="muted" style={{ fontSize: '.72rem' }}>
                          Total: {u.bcv > 0 ? money(u.cant * u.bcv, 'Bs') : '—'}{u.usd > 0 ? ` · ${money(u.cant * u.usd, 'USD')}` : ''}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Observación del analista: por qué elige esta oferta (la ven Gerente y Tesorería). */}
      <div className="card" style={{ padding: '.7rem .8rem', marginTop: '.8rem', borderLeft: '3px solid var(--primary)' }}>
        <div className="form-row" style={{ margin: 0 }}>
          <label>📝 Observación · ¿por qué elegís esta oferta? <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
          <textarea className="textarea" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej.: mejor precio en efectivo, entrega inmediata, único con stock, calidad comprobada…" />
          <small className="muted">Lo verán el <strong>Gerente General</strong> (al aprobar) y <strong>Tesorería</strong> (al pagar).</small>
        </div>
        <div className="form-row" style={{ margin: '.5rem 0 0' }}>
          <label>📎 Adjuntar imágenes / PDF de respaldo <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
          <input type="file" className="input" accept="application/pdf,image/*" multiple onChange={onFiles} />
          {adjuntos.length > 0 && (
            <div style={{ marginTop: '.35rem', display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
              {adjuntos.map((f, i) => (
                <div key={`${f.name}-${i}`} className="muted" style={{ fontSize: '.78rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                  ✓ {f.name} ({(f.size / 1024).toFixed(0)} KB)
                  <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 .35rem', color: 'var(--danger)' }}
                    onClick={() => setAdjuntos((prev) => prev.filter((_, k) => k !== i))} title="Quitar">✕</button>
                </div>
              ))}
            </div>
          )}
          <small className="muted" style={{ fontSize: '.72rem' }}>PDF o imágenes · máximo 10 MB c/u.</small>
        </div>
      </div>

      {/* Totales de lo elegido (se actualizan al cambiar de marca). */}
      <div className="card" style={{ background: 'var(--bg-2)', padding: '.7rem .8rem', marginTop: '.8rem' }}>
        <div className="card-title" style={{ marginBottom: '.35rem' }}><span>💵 Total a comprar</span></div>
        <div className="mono" style={{ fontSize: '.9rem', lineHeight: 1.7 }}>
          <div>Total Bs (BCV): <strong>{bcvTotal > 0 ? money(bcvTotal, 'Bs') : '—'}</strong></div>
          <div>Total $ (USD): <strong style={{ color: 'var(--success)' }}>{usdTotal > 0 ? money(usdTotal, 'USD') : '—'}</strong></div>
          {((Number(oferta.iva) || 0) > 0 || (Number(oferta.igtf) || 0) > 0) && (() => {
            const iva = Number(oferta.iva) || 0;
            const igtf = Number(oferta.igtf) || 0;
            const bcvConImp = Math.round((bcvTotal + iva + igtf) * 100) / 100;
            const usdConImp = usdTotal > 0 ? Math.round((usdTotal + iva + igtf) * 100) / 100 : 0;
            return (
              <div style={{ marginTop: '.2rem' }}>
                {iva > 0 && <span className="badge" style={{ marginRight: '.35rem' }}>+ IVA {money(iva)}</span>}
                {igtf > 0 && <span className="badge">+ IGTF {money(igtf)}</span>}
                <div style={{ marginTop: '.2rem' }}>
                  Total con impuestos: <strong>{bcvTotal > 0 ? money(bcvConImp, 'Bs') : '—'}</strong>
                  {usdConImp > 0 && <> · <strong style={{ color: 'var(--success)' }}>{money(usdConImp, 'USD')}</strong></>}
                </div>
                <div className="muted" style={{ fontSize: '.76rem', marginTop: '.15rem' }}>
                  El total que va a Tesorería ya incluye los impuestos.
                </div>
              </div>
            );
          })()}
        </div>
        {sinPrecio && (
          <p className="hint" style={{ color: 'var(--danger)', fontSize: '.8rem', margin: '.4rem 0 0' }}>
            Las marcas elegidas no tienen precio. Elegí una con precio o cargalo en la oferta.
          </p>
        )}
      </div>
    </Modal>
  );
}
