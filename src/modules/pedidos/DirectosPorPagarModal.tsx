import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { num, dosDecimales, dateTime } from '@/shared/lib/format';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import type { Caja, CajaSaldo, CuentaCaja } from '@/shared/lib/types';
import { listCategoriasGasto, soloCategorias, subcategoriasDe, type CategoriaGasto } from '@/modules/tesoreria/categoriasGasto.repository';
import { saldosDeCaja, listSaldos, round2 } from '@/modules/tesoreria/cajaSaldos.repository';
import { getTasaHoy, getTasasMercado, type TasasMercado } from '@/modules/tesoreria/tasas.repository';
import {
  listComprasPorPagar, pagarCompraDirecta, urlAdjuntoCompra, type CompraDirecta, type PagoLeg,
} from './compras.repository';
import {
  listServiciosPorPagar, pagarServicioDirecto, urlAdjuntoServicio, type ServicioDirecto,
} from './serviciosDirectos.repository';

function montoCaja(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${v}` : `${moneda} ${v}`;
}

/** Una compra/servicio directo POR PAGAR, normalizado para la lista de Tesorería. */
export interface DirectoFila {
  kind: 'compra' | 'servicio';
  id: string;
  codigo: string;
  titulo: string;
  detalle: string;
  total: number;
  generoPor: string;
  categoria: string;
  adjuntoPath: string | null;
  adjuntoNombre: string | null;
  compra?: CompraDirecta;
  servicio?: ServicioDirecto;
}

/** Carga las compras + servicios directos POR PAGAR como filas unificadas. */
export async function cargarDirectosPorPagar(): Promise<DirectoFila[]> {
  const [compras, servicios] = await Promise.all([
    listComprasPorPagar().catch(() => [] as CompraDirecta[]),
    listServiciosPorPagar().catch(() => [] as ServicioDirecto[]),
  ]);
  const fc: DirectoFila[] = compras.map((c) => ({
    kind: 'compra', id: c.id, codigo: c.codigo ?? '—', titulo: c.producto_nombre,
    detalle: c.items.length > 1 ? `${c.items.length} materiales` : (c.producto_sku ?? ''),
    total: Number(c.gasto) || 0, generoPor: c.actor_name || c.actor || '—',
    categoria: [c.gasto_categoria, c.gasto_subcategoria].filter(Boolean).join(' → '),
    adjuntoPath: c.adjunto_path, adjuntoNombre: c.adjunto_nombre, compra: c,
  }));
  const fs: DirectoFila[] = servicios.map((s) => ({
    kind: 'servicio', id: s.id, codigo: s.codigo ?? '—', titulo: s.descripcion,
    detalle: s.equipo_nombre || (s.items.length > 1 ? `${s.items.length} servicios` : ''),
    total: Number(s.gasto) || 0, generoPor: s.actor_name || s.actor || '—',
    categoria: [s.gasto_categoria, s.gasto_subcategoria].filter(Boolean).join(' → '),
    adjuntoPath: s.adjunto_path, adjuntoNombre: s.adjunto_nombre, servicio: s,
  }));
  return [...fc, ...fs];
}

/* ───────── Modal: pagar UN directo (caja + multimoneda) ───────── */

export function PagarDirectoModal({ fila, cajas, actor, actorName, onClose, onPaid }: {
  fila: DirectoFila; cajas: Caja[]; actor: string; actorName?: string | null; onClose: () => void; onPaid: () => void;
}) {
  const [cajaId, setCajaId] = useState(cajas[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = fila.total;
  const esCompra = fila.kind === 'compra';

  // Categoría → subcategoría de gasto: la elige Tesorería al pagar (compra directa).
  const [catRows, setCatRows] = useState<CategoriaGasto[]>([]);
  const [catId, setCatId] = useState('');
  const [subId, setSubId] = useState('');
  useEffect(() => { if (esCompra) listCategoriasGasto(true).then(setCatRows).catch(() => setCatRows([])); }, [esCompra]);
  const categorias = soloCategorias(catRows);
  const subcategorias = catId ? subcategoriasDe(catRows, catId) : [];
  // Pre-carga si la compra ya traía categoría.
  useEffect(() => {
    if (!catRows.length || !fila.compra?.gasto_categoria) return;
    const c = soloCategorias(catRows).find((x) => x.nombre === fila.compra?.gasto_categoria);
    if (c) setCatId(c.id);
  }, [catRows, fila.compra?.gasto_categoria]);
  useEffect(() => {
    if (!catId || !fila.compra?.gasto_subcategoria) return;
    const s = subcategoriasDe(catRows, catId).find((x) => x.nombre === fila.compra?.gasto_subcategoria);
    if (s) setSubId(s.id);
  }, [catId, catRows, fila.compra?.gasto_subcategoria]);
  const catNombre = categorias.find((c) => c.id === catId)?.nombre ?? '';
  const subNombre = subcategorias.find((s) => s.id === subId)?.nombre ?? '';

  // Saldo real por caja (para el desplegable).
  const [saldoReal, setSaldoReal] = useState<Map<string, { saldo: number; moneda: string }>>(new Map());
  useEffect(() => {
    listSaldos().then((rows) => {
      const m = new Map<string, { saldo: number; moneda: string }>();
      for (const c of cajas) {
        const porMoneda = new Map<string, number>();
        for (const r of rows) { if (r.caja_id !== c.id) continue; porMoneda.set(r.moneda, (porMoneda.get(r.moneda) ?? 0) + (Number(r.saldo) || 0)); }
        let mon: string = c.moneda; let saldo = porMoneda.get(c.moneda) ?? 0;
        if (saldo === 0 && porMoneda.size) { const mejor = [...porMoneda.entries()].sort((a, b) => b[1] - a[1])[0]; mon = mejor[0]; saldo = mejor[1]; }
        m.set(c.id, { saldo, moneda: mon });
      }
      setSaldoReal(m);
    }).catch(() => { /* sin saldos */ });
  }, [cajas]);

  const caja = cajas.find((c) => c.id === cajaId) ?? null;
  const moneda = caja?.moneda ?? 'USD';

  const [saldosCaja, setSaldosCaja] = useState<CajaSaldo[]>([]);
  const [legMontos, setLegMontos] = useState<Record<string, string>>({});
  const [tasa, setTasa] = useState<number>(0);
  const [mercado, setMercado] = useState<TasasMercado | null>(null);
  useEffect(() => {
    if (!cajaId) { setSaldosCaja([]); return; }
    saldosDeCaja(cajaId).then((rows) => setSaldosCaja(rows.filter((r) => Number(r.saldo) > 0))).catch(() => setSaldosCaja([]));
    setLegMontos({});
  }, [cajaId]);
  useEffect(() => { getTasaHoy().then((t) => { if (t.usd != null) setTasa(t.usd); }).catch(() => { /* sin tasa */ }); }, []);
  useEffect(() => { getTasasMercado().then(setMercado).catch(() => setMercado(null)); }, []);

  const esMultimoneda = saldosCaja.length >= 2;
  function legUsd(monedaLeg: string, n: number): number {
    if (!n || n <= 0) return 0;
    if (monedaLeg === 'USD' || monedaLeg === 'USDT') return round2(n);
    if (monedaLeg === 'Bs') return tasa > 0 ? round2(n / tasa) : 0;
    if (monedaLeg === 'COP') return mercado?.copUsd ? round2(n / mercado.copUsd) : 0;
    return round2(n);
  }
  const sumUsdMulti = round2(saldosCaja.reduce((a, s) => a + legUsd(s.moneda, Number(legMontos[s.id]) || 0), 0));
  const cubreTotalMulti = sumUsdMulti >= total - 0.01;
  const excedeTotalMulti = esMultimoneda && sumUsdMulti > total + 0.01;
  const cuentaLabel = (c: string) => c === 'general' ? '' : c === 'juridica' ? ' · Jurídica' : c === 'personal' ? ' · Personal' : ` · ${c}`;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!cajaId) { setError('Elegí la caja de la que sale el dinero.'); return; }
    if (total <= 0) { setError('Este directo no tiene monto.'); return; }
    if (esCompra) {
      if (!catId) { setError('Elegí la categoría de gasto.'); return; }
      if (!subId) { setError('Elegí la subcategoría de gasto.'); return; }
    }
    let legs: PagoLeg[] | undefined;
    if (esMultimoneda) {
      legs = saldosCaja.map((s) => ({ cuenta: s.cuenta as CuentaCaja, moneda: s.moneda, monto: Number(legMontos[s.id]) || 0 })).filter((l) => l.monto > 0);
      if (!legs.length) { setError('Indicá cuánto pagar en al menos una moneda.'); return; }
      if (excedeTotalMulti) { setError(`No podés pagar más que el total (${montoCaja(total, 'USD')}).`); return; }
      if (!cubreTotalMulti) { setError(`Lo cargado (${montoCaja(sumUsdMulti, 'USD')}) no cubre el total (${montoCaja(total, 'USD')}).`); return; }
    }
    setSaving(true);
    try {
      if (fila.kind === 'compra' && fila.compra) {
        await pagarCompraDirecta({ compra: fila.compra, cajaId, legs, gastoCategoria: catNombre, gastoSubcategoria: subNombre, actor, actorName });
      } else if (fila.kind === 'servicio' && fila.servicio) {
        await pagarServicioDirecto({ servicio: fila.servicio, cajaId, legs, actor, actorName });
      }
      notify(`${fila.kind === 'compra' ? 'Compra' : 'Servicio'} directo ${fila.codigo} pagado · ${montoCaja(total, moneda)} desde ${caja?.nombre ?? ''}`, 'success', { link: '#/app/tesoreria' });
      onPaid();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo pagar.'); setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="dir-pay-form" className="btn btn-primary" disabled={saving || excedeTotalMulti}>{saving ? 'Pagando…' : excedeTotalMulti ? 'Excede el total' : `Pagar · ${montoCaja(total, moneda)}`}</button>
    </>
  );

  return (
    <Modal title={`Pagar ${fila.kind === 'compra' ? 'compra' : 'servicio'} directo · ${fila.codigo}`} size="md" onClose={onClose} footer={footer}>
      <form id="dir-pay-form" onSubmit={handleSubmit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        <div className="card" style={{ marginBottom: '.6rem', fontSize: '.86rem' }}>
          <div><strong>{fila.titulo}</strong>{fila.detalle ? <span className="muted"> · {fila.detalle}</span> : null}</div>
          {fila.categoria && <div className="muted" style={{ fontSize: '.78rem' }}>{fila.categoria}</div>}
          <div className="muted" style={{ fontSize: '.78rem' }}>Montó: {fila.generoPor}</div>
          {esCompra && fila.compra?.nota && (
            <div style={{ marginTop: '.4rem', padding: '.4rem .6rem', borderLeft: '3px solid var(--brand, #ff8a00)', background: 'rgba(255,138,0,.08)', fontSize: '.82rem' }}>
              📝 <strong>Nota del analista:</strong> {fila.compra.nota}
            </div>
          )}
          <div style={{ marginTop: '.3rem', display: 'flex', alignItems: 'center', gap: '.6rem' }}>
            <span>Total: <strong className="mono">{montoCaja(total, 'USD')}</strong></span>
            {fila.adjuntoPath && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={async () => {
                try {
                  const url = fila.kind === 'compra' ? await urlAdjuntoCompra(fila.adjuntoPath as string) : await urlAdjuntoServicio(fila.adjuntoPath as string);
                  await previewFileUrl(url, fila.adjuntoNombre ?? 'factura');
                } catch { toast('No se pudo abrir la factura', 'error'); }
              }}>📎 Ver factura</button>
            )}
          </div>
        </div>

        {esCompra && (
          <div className="form-grid">
            <div className="form-row">
              <label>Categoría de gasto <span style={{ color: 'var(--danger)' }}>*</span></label>
              <SearchSelect value={catId} onChange={(v) => { setCatId(v); setSubId(''); }}
                options={categorias.map((c) => ({ value: c.id, label: c.nombre }))}
                placeholder="Buscar categoría…" emptyText="Cargá categorías en 🗂️ Categorías de gasto" />
            </div>
            <div className="form-row">
              <label>Subcategoría <span style={{ color: 'var(--danger)' }}>*</span></label>
              <SearchSelect value={subId} onChange={setSubId}
                options={subcategorias.map((s) => ({ value: s.id, label: s.nombre }))}
                placeholder={catId ? 'Buscar subcategoría…' : 'Elegí primero la categoría'}
                emptyText={catId ? 'Esta categoría no tiene subcategorías.' : 'Elegí una categoría'} />
            </div>
          </div>
        )}

        <div className="form-row">
          <label>Caja (de dónde sale el dinero)</label>
          <select className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)} required style={{ maxWidth: 320 }}>
            {!cajas.length && <option value="">— sin cajas —</option>}
            {cajas.map((c) => { const sr = saldoReal.get(c.id); return <option key={c.id} value={c.id}>{c.nombre} · {montoCaja(sr?.saldo ?? c.saldo, sr?.moneda ?? c.moneda)}</option>; })}
          </select>
          <small className="muted">El monto se descuenta de esta caja (egreso en Tesorería).{esMultimoneda ? ' Es Multimoneda: repartí el pago por moneda abajo.' : ''}</small>
        </div>

        {esMultimoneda && (
          <div className="card" style={{ marginBottom: '.75rem', borderColor: 'var(--brand, #ff8a00)' }}>
            <div className="card-title" style={{ marginBottom: '.4rem' }}>Pago por moneda · ¿cuánto sale de cada una?</div>
            <div className="table-wrap">
              <table className="table" style={{ fontSize: '.84rem' }}>
                <thead><tr><th>Moneda</th><th style={{ textAlign: 'right' }}>Disponible</th><th style={{ textAlign: 'right' }}>A pagar</th><th style={{ textAlign: 'right' }}>Equiv. USD</th></tr></thead>
                <tbody>
                  {saldosCaja.map((s) => {
                    const n = Number(legMontos[s.id]) || 0;
                    const excede = n > Number(s.saldo);
                    return (
                      <tr key={s.id}>
                        <td><span className="badge">{s.moneda}</span>{cuentaLabel(s.cuenta)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{montoCaja(Number(s.saldo), s.moneda)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <input className="input mono" type="number" min={0} max={Number(s.saldo)} step="any" value={legMontos[s.id] ?? ''} placeholder="0,00"
                            onChange={(e) => setLegMontos((m) => ({ ...m, [s.id]: dosDecimales(e.target.value) }))}
                            style={{ width: 130, textAlign: 'right', borderColor: excede ? 'var(--danger)' : undefined }} />
                        </td>
                        <td className="mono" style={{ textAlign: 'right' }}>{n > 0 ? montoCaja(legUsd(s.moneda, n), 'USD') : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'right', fontWeight: 600 }}>Cubierto / Total</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: excedeTotalMulti ? 'var(--danger)' : cubreTotalMulti ? 'var(--success)' : 'var(--warning)' }}>{montoCaja(sumUsdMulti, 'USD')} / {montoCaja(total, 'USD')}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {tasa > 0 && <small className="muted">Bs↔$ usa la tasa BCV {montoCaja(tasa, 'Bs')}.</small>}
          </div>
        )}

        {fila.kind === 'compra' && fila.compra && (
          <small className="muted" style={{ display: 'block' }}>Al pagar, los materiales entran al inventario en <strong>{fila.compra.almacen}</strong>.</small>
        )}
        {fila.servicio?.items?.length ? (
          <ul className="muted" style={{ fontSize: '.76rem', margin: '.4rem 0 0', paddingLeft: '1rem' }}>
            {fila.servicio.items.map((it, i) => <li key={i}>{it.descripcion} · {num(it.cantidad)} · {montoCaja(Number(it.gasto) || 0, 'USD')}</li>)}
          </ul>
        ) : null}
        <div className="muted" style={{ fontSize: '.72rem', marginTop: '.4rem' }}>Montado el {fila.kind === 'compra' ? dateTime(fila.compra?.updated_at ?? '') : dateTime(fila.servicio?.updated_at ?? '')}.</div>
      </form>
    </Modal>
  );
}
