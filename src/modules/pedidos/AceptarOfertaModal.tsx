import { useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { money, moneyUnit } from '@/shared/lib/format';
import { montoFinalOferta } from './score';
import { recortarOfertaAHija } from './subOc';
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
  /** Moneda de la ORDEN: 'USD' o 'Bs'. Los precios «BCV» de la oferta están en esa moneda; antes se rotulaban siempre en Bs. */
  moneda?: string | null;
  /** SKUs que YA compra otra sub-OC viva: se muestran en gris y no se pueden marcar
   *  (comprarlos de nuevo sería pagar dos veces el mismo producto). */
  skusBloqueados?: Set<string>;
  /** Devuelve los ítems elegidos (uno por producto) + totales en Bs y $ + la observación
   *  del analista (por qué elige la oferta), sus adjuntos y la MODALIDAD DE PAGO escogida ('usd' | 'bs'). */
  onConfirm: (
    itemsElegidos: ItemOrden[],
    bcvTotal: number,
    usdTotal: number,
    motivo: string,
    adjuntos: File[],
    modalidadPago: 'usd' | 'bs',
  ) => Promise<void> | void;
  onCancel: () => void;
}

export function AceptarOfertaModal({ oferta, proveedorNombre, moneda, skusBloqueados, onConfirm, onCancel }: Props) {
  const esBs = moneda === 'Bs';
  const mo = esBs ? 'Bs' : 'USD';
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

  // Modalidad de pago elegida por el analista ('usd' | 'bs'):
  // Se inicializa en 'usd' si hay precio USD disponible (suele tener descuento), o 'bs' si solo hay BCV.
  const [modalidadSel, setModalidadSel] = useState<'usd' | 'bs'>('usd');

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

  // Impuestos y descuentos prorrateados
  const parteRecorte = useMemo(() => recortarOfertaAHija(oferta, elegidos.map((it) => it.sku)), [oferta, elegidos]);
  const ivaMontoParte = Number(parteRecorte.iva) || 0;
  const igtfMontoParte = Number(parteRecorte.igtf) || 0;
  const descParte = Number(parteRecorte.descuento) || 0;
  const ajusteParte = Number(parteRecorte.ajuste) || 0;
  const ivaIncluidoParte = parteRecorte.iva_incluido;

  const conBcv = useMemo(
    () => montoFinalOferta({ precio_total: bcvTotal, precio_efectivo: null, iva: ivaMontoParte, igtf: igtfMontoParte, descuento: descParte, iva_incluido: ivaIncluidoParte, ajuste: ajusteParte }),
    [bcvTotal, ivaMontoParte, igtfMontoParte, descParte, ivaIncluidoParte, ajusteParte]
  );
  const conUsd = useMemo(
    () => montoFinalOferta({ precio_total: usdTotal, precio_efectivo: null, iva: ivaMontoParte, igtf: igtfMontoParte, descuento: descParte, iva_incluido: ivaIncluidoParte, ajuste: ajusteParte }),
    [usdTotal, ivaMontoParte, igtfMontoParte, descParte, ivaIncluidoParte, ajusteParte]
  );

  const tieneBcv = bcvTotal > 0;
  const tieneUsd = usdTotal > 0;
  // Modalidad efectiva según disponibilidad
  const modalidadEfectiva: 'usd' | 'bs' = !tieneBcv && tieneUsd ? 'usd' : !tieneUsd && tieneBcv ? 'bs' : modalidadSel;

  const totalFinalElegido = modalidadEfectiva === 'usd' ? conUsd.final : conBcv.final;
  const diferenciaAhorro = tieneBcv && tieneUsd ? Math.round((conBcv.final - conUsd.final) * 100) / 100 : 0;
  const pctAhorro = tieneBcv && tieneUsd && conBcv.final > 0 ? Math.round((diferenciaAhorro / conBcv.final) * 10000) / 100 : 0;

  async function confirmar() {
    if (sinPrecio || sinSeleccion || saving) return;
    setSaving(true);
    try {
      await onConfirm(elegidos, bcvTotal, usdTotal > 0 ? usdTotal : 0, motivo.trim(), adjuntos, modalidadEfectiva);
    } finally {
      setSaving(false);
    }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancelar</button>
      <button className="btn btn-primary" onClick={confirmar} disabled={saving || sinPrecio || sinSeleccion}
        title={sinSeleccion ? 'Tildá al menos un producto para comprarle a este proveedor' : undefined}>
        {saving ? 'Eligiendo…' : `Elegir oferta${elegidos.length ? ` · ${elegidos.length} producto(s)` : ''} · Pagar ${modalidadEfectiva === 'usd' ? money(totalFinalElegido, 'USD') : money(totalFinalElegido, mo)}`}
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
        <p style={{ marginTop: '-.4rem', fontSize: '.82rem', color: 'var(--warning)' }}>
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
                        <div>{esBs ? 'Bs' : '$ BCV'}: <strong>{u.bcv > 0 ? moneyUnit(u.bcv, mo) : '—'}</strong></div>
                        <div style={{ color: 'var(--success)' }}>{esBs ? '$' : '$ efectivo'}: <strong>{u.usd > 0 ? moneyUnit(u.usd, 'USD') : '—'}</strong></div>
                        <div className="muted" style={{ fontSize: '.72rem' }}>
                          Total: {u.bcv > 0 ? money(u.cant * u.bcv, mo) : '—'}{u.usd > 0 ? ` · ${money(u.cant * u.usd, 'USD')}` : ''}
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

      {/* SELECTOR DE MODALIDAD DE PAGO (Bs a BCV vs $ en Divisa / Efectivo) */}
      <div className="card" style={{ padding: '.8rem .9rem', marginTop: '.8rem', borderLeft: '4px solid var(--brand, #ff8a00)', background: 'var(--bg-1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.4rem', marginBottom: '.5rem' }}>
          <strong style={{ fontSize: '.92rem' }}>🪙 ¿Cómo se va a pagar esta compra?</strong>
          <span className="badge" style={{ background: modalidadEfectiva === 'usd' ? 'var(--success)' : 'rgba(59,130,246,.15)', color: modalidadEfectiva === 'usd' ? '#fff' : 'var(--primary)', fontWeight: 600 }}>
            {modalidadEfectiva === 'usd' ? '✓ Seleccionado: Pago en $ (USD / Divisa)' : '✓ Seleccionado: Pago en Bs al cambio (BCV)'}
          </span>
        </div>
        <p className="muted" style={{ fontSize: '.8rem', margin: '0 0 .6rem' }}>
          Indicá la opción que acordaste con el proveedor. Evita confusiones cuando la cotización muestra un monto en Bs y otro en dólares: la OC y el monto a pagar se generarán con la opción que marques aquí.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '.6rem' }}>
          {/* Opción A: Pago en USD / Divisa */}
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '.35rem',
              padding: '.7rem .85rem',
              borderRadius: 8,
              cursor: tieneUsd ? 'pointer' : 'not-allowed',
              opacity: tieneUsd ? 1 : 0.5,
              background: modalidadEfectiva === 'usd' ? 'rgba(16,185,129,.10)' : 'var(--bg-2)',
              border: `2px solid ${modalidadEfectiva === 'usd' ? 'var(--success)' : 'var(--border)'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <input
                  type="radio"
                  name="modalidad_pago_sel"
                  value="usd"
                  checked={modalidadEfectiva === 'usd'}
                  disabled={!tieneUsd}
                  onChange={() => setModalidadSel('usd')}
                />
                <strong style={{ color: 'var(--success)' }}>Pagar en $ (USD / Divisa)</strong>
              </div>
              {diferenciaAhorro > 0 && (
                <span className="badge success" style={{ fontSize: '.72rem' }}>
                  −{money(diferenciaAhorro, 'USD')} ({pctAhorro}%)
                </span>
              )}
            </div>
            <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 700, marginLeft: '1.4rem' }}>
              {tieneUsd ? money(conUsd.final, 'USD') : '—'}
            </div>
            <div className="muted" style={{ fontSize: '.74rem', marginLeft: '1.4rem' }}>
              {tieneUsd
                ? `Base ${money(usdTotal, 'USD')}${ivaMontoParte + igtfMontoParte > 0 ? ` + imp. ${money(ivaMontoParte + igtfMontoParte, 'USD')}` : ''}`
                : 'Esta oferta no cotizó precio en USD'}
            </div>
          </label>

          {/* Opción B: Pago en Bs al cambio (tasa BCV) */}
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '.35rem',
              padding: '.7rem .85rem',
              borderRadius: 8,
              cursor: tieneBcv ? 'pointer' : 'not-allowed',
              opacity: tieneBcv ? 1 : 0.5,
              background: modalidadEfectiva === 'bs' ? 'rgba(59,130,246,.10)' : 'var(--bg-2)',
              border: `2px solid ${modalidadEfectiva === 'bs' ? 'var(--primary)' : 'var(--border)'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <input
                  type="radio"
                  name="modalidad_pago_sel"
                  value="bs"
                  checked={modalidadEfectiva === 'bs'}
                  disabled={!tieneBcv}
                  onChange={() => setModalidadSel('bs')}
                />
                <strong style={{ color: 'var(--primary)' }}>Pagar en Bs al cambio (tasa BCV)</strong>
              </div>
            </div>
            <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 700, marginLeft: '1.4rem' }}>
              {tieneBcv ? money(conBcv.final, mo) : '—'}
            </div>
            <div className="muted" style={{ fontSize: '.74rem', marginLeft: '1.4rem' }}>
              {tieneBcv
                ? `Base ${money(bcvTotal, mo)}${ivaMontoParte + igtfMontoParte > 0 ? ` + imp. ${money(ivaMontoParte + igtfMontoParte, mo)}` : ''}`
                : 'Esta oferta no cotizó precio en Bs'}
            </div>
          </label>
        </div>
      </div>

      {/* Observación del analista: por qué elige esta oferta (la ven Gerente y Tesorería). */}
      <div className="card" style={{ padding: '.7rem .8rem', marginTop: '.8rem', borderLeft: '3px solid var(--primary)' }}>
        <div className="form-row" style={{ margin: 0 }}>
          <label>📝 Observación · ¿por qué elegís esta oferta? <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
          <textarea className="textarea" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej.: mejor precio en efectivo, entrega inmediata, único con stock, calidad comprobada…" />
          <small className="hint muted">Lo verán el <strong>Gerente General</strong> (al aprobar) y <strong>Tesorería</strong> (al pagar).</small>
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
          <small className="hint muted" style={{ fontSize: '.72rem' }}>PDF o imágenes · máximo 10 MB c/u.</small>
        </div>
      </div>

      {/* Resumen del total a comprar con la opción seleccionada */}
      <div className="card" style={{ background: 'var(--bg-2)', padding: '.7rem .8rem', marginTop: '.8rem' }}>
        <div className="card-title" style={{ marginBottom: '.35rem' }}>
          <span>💵 Resumen del monto a comprar</span>
        </div>
        <div className="mono" style={{ fontSize: '.9rem', lineHeight: 1.7 }}>
          <div>Total cotizado en Bs (BCV): <strong>{bcvTotal > 0 ? money(bcvTotal, mo) : '—'}</strong> {bcvTotal > 0 && <span className="muted">· con imp. {money(conBcv.final, mo)}</span>}</div>
          <div>Total cotizado en $ (USD): <strong style={{ color: 'var(--success)' }}>{usdTotal > 0 ? money(usdTotal, 'USD') : '—'}</strong> {usdTotal > 0 && <span className="muted">· con imp. {money(conUsd.final, 'USD')}</span>}</div>
          
          {(ivaMontoParte > 0 || igtfMontoParte > 0 || descParte > 0 || ajusteParte !== 0) && (
            <div style={{ marginTop: '.25rem' }}>
              {descParte > 0 && <span className="badge success" style={{ marginRight: '.35rem' }}>− desc. {money(descParte, mo)}</span>}
              {ivaMontoParte > 0 && <span className="badge" style={{ marginRight: '.35rem' }} title={ivaIncluidoParte ? 'Los precios ya traen el IVA: se guarda para la retención, no se suma' : undefined}>{ivaIncluidoParte ? 'IVA incluido' : '+ IVA'} {money(ivaMontoParte, mo)}</span>}
              {igtfMontoParte > 0 && <span className="badge" style={{ marginRight: '.35rem' }}>+ IGTF {money(igtfMontoParte, mo)}</span>}
              {ajusteParte !== 0 && <span className="badge" title={parteRecorte.ajuste_motivo ?? undefined}>{ajusteParte > 0 ? '+' : '−'} ajuste {money(Math.abs(ajusteParte), mo)}</span>}
            </div>
          )}

          <div style={{ marginTop: '.4rem', paddingTop: '.35rem', borderTop: '1px dashed var(--border)', fontSize: '1rem' }}>
            Total final de la OC a emitir: <strong style={{ color: modalidadEfectiva === 'usd' ? 'var(--success)' : 'var(--primary)' }}>{modalidadEfectiva === 'usd' ? money(conUsd.final, 'USD') : money(conBcv.final, mo)}</strong>
            <span className="badge" style={{ marginLeft: '.5rem', fontSize: '.75rem' }}>
              {modalidadEfectiva === 'usd' ? 'Pago en $ (Divisa)' : 'Pago en Bs a tasa BCV'}
            </span>
          </div>
          <div className="muted" style={{ fontSize: '.76rem', marginTop: '.2rem' }}>
            Este es el monto exacto que se registrará en la Orden de Compra y pasará a aprobación y a Tesorería.
            {parteRecorte.fraccion < 1 && <> Se le compra el {Math.round(parteRecorte.fraccion * 100)}% de esta oferta, así que descuento e impuestos van en esa proporción.</>}
          </div>
        </div>
        {sinPrecio && (
          <p style={{ color: 'var(--danger)', fontSize: '.8rem', margin: '.4rem 0 0' }}>
            Las marcas elegidas no tienen precio. Elegí una con precio o cargalo en la oferta.
          </p>
        )}
      </div>
    </Modal>
  );
}
