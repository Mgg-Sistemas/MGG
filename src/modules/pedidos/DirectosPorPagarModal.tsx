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
  /** Moneda del total ($ o Bs): la compra/servicio se montó en esta moneda. */
  moneda: string;
  generoPor: string;
  categoria: string;
  /** Pago a externo: lo pagó una persona externa; el pago reintegra el dinero a esa persona. */
  pagoExterno: boolean;
  pagoExternoDatos: string | null;
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
    total: Number(c.gasto) || 0, moneda: c.moneda === 'Bs' ? 'Bs' : 'USD', generoPor: c.actor_name || c.actor || '—',
    categoria: [c.gasto_categoria, c.gasto_subcategoria].filter(Boolean).join(' → '),
    pagoExterno: !!c.pago_externo, pagoExternoDatos: c.pago_externo_datos,
    adjuntoPath: c.adjunto_path, adjuntoNombre: c.adjunto_nombre, compra: c,
  }));
  const fs: DirectoFila[] = servicios.map((s) => ({
    kind: 'servicio', id: s.id, codigo: s.codigo ?? '—', titulo: s.descripcion,
    detalle: s.equipo_nombre || (s.items.length > 1 ? `${s.items.length} servicios` : ''),
    total: Number(s.gasto) || 0, moneda: s.moneda === 'Bs' ? 'Bs' : 'USD', generoPor: s.actor_name || s.actor || '—',
    categoria: [s.gasto_categoria, s.gasto_subcategoria].filter(Boolean).join(' → '),
    pagoExterno: !!s.pago_externo, pagoExternoDatos: s.pago_externo_datos,
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
  // Comisión bancaria (opcional, solo compra directa): egreso extra de la caja, NO suma a la factura.
  const [comisionMonto, setComisionMonto] = useState('');
  const [comisionSaldoId, setComisionSaldoId] = useState('');
  const total = fila.total;
  const esCompra = fila.kind === 'compra';
  // Moneda del directo ($ o Bs): el total está en ESTA moneda (compra y servicio).
  const monedaBase = (fila.compra?.moneda ?? fila.servicio?.moneda) === 'Bs' ? 'Bs' : 'USD';

  // Categoría → subcategoría de gasto: la elige Tesorería al pagar (compra Y servicio directo).
  const [catRows, setCatRows] = useState<CategoriaGasto[]>([]);
  const [catId, setCatId] = useState('');
  const [subId, setSubId] = useState('');
  useEffect(() => { listCategoriasGasto(true).then(setCatRows).catch(() => setCatRows([])); }, []);
  const categorias = soloCategorias(catRows);
  const subcategorias = catId ? subcategoriasDe(catRows, catId) : [];
  // Pre-carga si el directo ya traía categoría (compra o servicio).
  const gastoCatPrevia = fila.compra?.gasto_categoria ?? fila.servicio?.gasto_categoria ?? null;
  const gastoSubPrevia = fila.compra?.gasto_subcategoria ?? fila.servicio?.gasto_subcategoria ?? null;
  useEffect(() => {
    if (!catRows.length || !gastoCatPrevia) return;
    const c = soloCategorias(catRows).find((x) => x.nombre === gastoCatPrevia);
    if (c) setCatId(c.id);
  }, [catRows, gastoCatPrevia]);
  useEffect(() => {
    if (!catId || !gastoSubPrevia) return;
    const s = subcategoriasDe(catRows, catId).find((x) => x.nombre === gastoSubPrevia);
    if (s) setSubId(s.id);
  }, [catId, catRows, gastoSubPrevia]);
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

  const [saldosCaja, setSaldosCaja] = useState<CajaSaldo[]>([]);
  const [legMontos, setLegMontos] = useState<Record<string, string>>({});
  const [cuentaSel, setCuentaSel] = useState<string>(''); // id del saldo elegido, o '__split__'
  const [tasa, setTasa] = useState<number>(0);
  // Tasa manual para este pago (Bs por $): si se coloca, prevalece sobre la tasa BCV.
  const [tasaManualStr, setTasaManualStr] = useState('');
  const [mercado, setMercado] = useState<TasasMercado | null>(null);
  useEffect(() => {
    if (!cajaId) { setSaldosCaja([]); return; }
    saldosDeCaja(cajaId).then((rows) => setSaldosCaja(rows.filter((r) => Number(r.saldo) > 0))).catch(() => setSaldosCaja([]));
    setLegMontos({});
  }, [cajaId]);
  // Por defecto, la cuenta/billetera que coincide con la moneda de la caja (o la primera).
  useEffect(() => {
    if (!saldosCaja.length) { setCuentaSel(''); return; }
    const pref = saldosCaja.find((s) => s.moneda === caja?.moneda) ?? saldosCaja[0];
    setCuentaSel(pref.id);
  }, [saldosCaja, caja?.moneda]);
  useEffect(() => { getTasaHoy().then((t) => { if (t.usd != null) setTasa(t.usd); }).catch(() => { /* sin tasa */ }); }, []);
  useEffect(() => { getTasasMercado().then(setMercado).catch(() => setMercado(null)); }, []);

  // Tasa efectiva Bs/$: la manual (si la colocan) prevalece sobre la BCV auto.
  const tasaEff = (Number(tasaManualStr) || 0) > 0 ? Number(tasaManualStr) : tasa;

  const esMultimoneda = saldosCaja.length >= 2;
  function legUsd(monedaLeg: string, n: number): number {
    if (!n || n <= 0) return 0;
    if (monedaLeg === 'USD' || monedaLeg === 'USDT') return round2(n);
    if (monedaLeg === 'Bs') return tasaEff > 0 ? round2(n / tasaEff) : 0;
    if (monedaLeg === 'COP') return mercado?.copUsd ? round2(n / mercado.copUsd) : 0;
    return round2(n);
  }
  // USD → moneda de la cuenta (para pagar el total desde una sola cuenta/billetera).
  function montoEnMoneda(monedaLeg: string, usd: number): number {
    if (!usd || usd <= 0) return 0;
    if (monedaLeg === 'USD' || monedaLeg === 'USDT') return round2(usd);
    if (monedaLeg === 'Bs') return tasaEff > 0 ? round2(usd * tasaEff) : 0;
    if (monedaLeg === 'COP') return mercado?.copUsd ? round2(usd * mercado.copUsd) : 0;
    return round2(usd);
  }
  const cuentaLabel = (c: string) => c === 'general' ? '' : c === 'juridica' ? ' · Jurídica' : c === 'personal' ? ' · Personal' : ` · ${c}`;

  // El total está en la moneda base de la compra ($ o Bs). Para reusar el motor de
  // conversión (pivota en USD), llevamos el total a USD-equivalente con la tasa.
  const totalUsd = monedaBase === 'Bs' ? (tasaEff > 0 ? round2(total / tasaEff) : 0) : total;

  // Modo de pago: una sola cuenta/billetera (default) o repartir entre varias monedas.
  const esSplit = cuentaSel === '__split__';
  const saldoSel = saldosCaja.find((s) => s.id === cuentaSel) ?? null;
  const montoCuenta = saldoSel ? montoEnMoneda(saldoSel.moneda, totalUsd) : totalUsd;
  const sumUsdMulti = round2(saldosCaja.reduce((a, s) => a + legUsd(s.moneda, Number(legMontos[s.id]) || 0), 0));
  const cubreTotalMulti = sumUsdMulti >= totalUsd - 0.01;
  const excedeTotalMulti = esSplit && sumUsdMulti > totalUsd + 0.01;
  // ¿Este pago cruza Bs↔$ (hace falta tasa)? Para mostrar el campo de tasa manual.
  const cruzaBsUsd = !esSplit
    ? (!!saldoSel && saldoSel.moneda !== monedaBase && (saldoSel.moneda === 'Bs' || monedaBase === 'Bs'))
    : (monedaBase !== 'Bs' && saldosCaja.some((s) => s.moneda === 'Bs')) || (monedaBase === 'Bs' && saldosCaja.some((s) => s.moneda === 'USD' || s.moneda === 'USDT'));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!cajaId) { setError('Elegí la caja de la que sale el dinero.'); return; }
    if (total <= 0) { setError('Este directo no tiene monto.'); return; }
    if (cruzaBsUsd && tasaEff <= 0) { setError('Colocá la tasa (Bs por $) para convertir el monto.'); return; }
    // La categoría de gasto la fija Tesorería al pagar (compra Y servicio directo).
    if (!catId) { setError('Elegí la categoría de gasto.'); return; }
    if (!subId) { setError('Elegí la subcategoría de gasto.'); return; }
    let legs: PagoLeg[] | undefined;
    if (esSplit) {
      legs = saldosCaja.map((s) => ({ cuenta: s.cuenta as CuentaCaja, moneda: s.moneda, monto: Number(legMontos[s.id]) || 0 })).filter((l) => l.monto > 0);
      if (!legs.length) { setError('Indicá cuánto pagar en al menos una moneda.'); return; }
      if (excedeTotalMulti) { setError(`No podés pagar más que el total (${montoCaja(totalUsd, 'USD')}).`); return; }
      if (!cubreTotalMulti) { setError(`Lo cargado (${montoCaja(sumUsdMulti, 'USD')}) no cubre el total (${montoCaja(totalUsd, 'USD')}).`); return; }
    } else if (saldoSel) {
      // Pago completo desde la cuenta/billetera elegida (convierte el total a su moneda si hace falta).
      const m = montoEnMoneda(saldoSel.moneda, totalUsd);
      if (m <= 0) { setError(`No hay tasa para convertir el total a ${saldoSel.moneda}.`); return; }
      if (m > Number(saldoSel.saldo) + 0.01) { setError(`La cuenta ${saldoSel.moneda}${cuentaLabel(saldoSel.cuenta)} no tiene saldo suficiente (${montoCaja(Number(saldoSel.saldo), saldoSel.moneda)}).`); return; }
      legs = [{ cuenta: saldoSel.cuenta as CuentaCaja, moneda: saldoSel.moneda, monto: m }];
    }
    // Comisión bancaria (solo compra directa): sale del saldo elegido (o el del pago).
    const comMontoNum = round2(Number(comisionMonto) || 0);
    let comision: { cuenta: CuentaCaja; moneda: string; monto: number } | null = null;
    if (esCompra && comMontoNum > 0) {
      const sc = saldosCaja.find((s) => s.id === comisionSaldoId) ?? saldoSel ?? saldosCaja[0];
      if (!sc) { setError('No hay saldo para descontar la comisión.'); return; }
      comision = { cuenta: sc.cuenta as CuentaCaja, moneda: sc.moneda, monto: comMontoNum };
    }
    setSaving(true);
    try {
      if (fila.kind === 'compra' && fila.compra) {
        await pagarCompraDirecta({ compra: fila.compra, cajaId, legs, gastoCategoria: catNombre, gastoSubcategoria: subNombre, comision, actor, actorName });
      } else if (fila.kind === 'servicio' && fila.servicio) {
        await pagarServicioDirecto({ servicio: fila.servicio, cajaId, legs, gastoCategoria: catNombre, gastoSubcategoria: subNombre, actor, actorName });
      }
      notify(
        fila.kind === 'compra'
          ? `Compra directa ${fila.codigo} pagada · ${montoCaja(total, monedaBase)} · queda POR RECIBIR en Inventario`
          : `Servicio directo ${fila.codigo} pagado · ${montoCaja(total, monedaBase)} desde ${caja?.nombre ?? ''}`,
        'success',
        { link: fila.kind === 'compra' ? '#/app/inventario' : '#/app/tesoreria' },
      );
      onPaid();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo pagar.'); setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="dir-pay-form" className="btn btn-primary" disabled={saving || excedeTotalMulti}>{saving ? 'Pagando…' : excedeTotalMulti ? 'Excede el total' : `Pagar · ${montoCaja(total, monedaBase)}`}</button>
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
          {fila.pagoExterno && (
            <div style={{ marginTop: '.4rem', padding: '.5rem .6rem', borderLeft: '3px solid var(--danger, #e5484d)', background: 'rgba(229,72,77,.1)', fontSize: '.82rem' }}>
              💳 <strong>Pago a externo — este pago REINTEGRA el dinero a la persona externa que ya pagó.</strong>
              {fila.pagoExternoDatos?.trim() && <div style={{ marginTop: '.2rem', whiteSpace: 'pre-wrap' }}>👤 {fila.pagoExternoDatos.trim()}</div>}
            </div>
          )}
          {(fila.compra?.nota ?? fila.servicio?.nota) && (
            <div style={{ marginTop: '.4rem', padding: '.4rem .6rem', borderLeft: '3px solid var(--brand, #ff8a00)', background: 'rgba(255,138,0,.08)', fontSize: '.82rem' }}>
              📝 <strong>Nota del analista:</strong> {fila.compra?.nota ?? fila.servicio?.nota}
            </div>
          )}
          <div style={{ marginTop: '.3rem', display: 'flex', alignItems: 'center', gap: '.6rem' }}>
            <span>Total: <strong className="mono">{montoCaja(total, monedaBase)}</strong>{monedaBase === 'Bs' && tasaEff > 0 ? <span className="muted"> · ≈ {montoCaja(totalUsd, 'USD')}</span> : null}</span>
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

        <div className="form-row">
          <label>Caja (de dónde sale el dinero)</label>
          <select className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)} required style={{ maxWidth: 320 }}>
            {!cajas.length && <option value="">— sin cajas —</option>}
            {cajas.map((c) => { const sr = saldoReal.get(c.id); return <option key={c.id} value={c.id}>{c.nombre} · {montoCaja(sr?.saldo ?? c.saldo, sr?.moneda ?? c.moneda)}</option>; })}
          </select>
          <small className="muted">El monto se descuenta de la cuenta/billetera que elijas abajo (egreso en Tesorería).</small>
        </div>

        {saldosCaja.length > 0 && (
          <div className="form-row">
            <label>Cuenta / Billetera (de dónde sale)</label>
            <select className="select" value={cuentaSel} onChange={(e) => setCuentaSel(e.target.value)} style={{ maxWidth: 320 }}>
              {saldosCaja.map((s) => <option key={s.id} value={s.id}>{s.moneda}{cuentaLabel(s.cuenta)} · {montoCaja(Number(s.saldo), s.moneda)}</option>)}
              {esMultimoneda && <option value="__split__">↔ Repartir entre varias monedas…</option>}
            </select>
            {!esSplit && saldoSel && (
              <div className="card" style={{ margin: '.45rem 0 0', padding: '.5rem .7rem', fontSize: '.86rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                <span>Pagás en <span className="badge">{saldoSel.moneda}</span>{cuentaLabel(saldoSel.cuenta)}</span>
                <span style={{ textAlign: 'right' }}>
                  Se descuenta <strong className="mono">{montoCaja(montoCuenta, saldoSel.moneda)}</strong>
                  {saldoSel.moneda !== monedaBase && (
                    <span className="muted"> · equivale a {montoCaja(total, monedaBase)}{tasaEff > 0 && (saldoSel.moneda === 'Bs' || monedaBase === 'Bs') ? ` · tasa ${montoCaja(tasaEff, 'Bs')}` : ''}</span>
                  )}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Tasa manual (Bs/$) para este pago: aparece cuando el pago cruza Bs↔$. */}
        {cruzaBsUsd && (
          <div className="form-row">
            <label>Tasa de pago (Bs por $) {tasa > 0 && <span className="muted" style={{ fontWeight: 400 }}>· BCV {montoCaja(tasa, 'Bs')}</span>}</label>
            <input className="input mono" type="number" min={0} step="any" style={{ maxWidth: 200 }}
              value={tasaManualStr} placeholder={tasa > 0 ? String(tasa) : '0,00'}
              onChange={(e) => setTasaManualStr(dosDecimales(e.target.value))} />
            <small className="muted">
              {monedaBase === 'USD'
                ? `El total ${montoCaja(total, 'USD')} equivale a ${montoCaja(montoEnMoneda('Bs', totalUsd), 'Bs')} a la tasa ${tasaEff > 0 ? montoCaja(tasaEff, 'Bs') : '—'}.`
                : `El total ${montoCaja(total, 'Bs')} equivale a ${montoCaja(totalUsd, 'USD')} a la tasa ${tasaEff > 0 ? montoCaja(tasaEff, 'Bs') : '—'}.`}
              {' '}Si la dejás vacía se usa la tasa BCV.
            </small>
          </div>
        )}

        {esSplit && (
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
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: excedeTotalMulti ? 'var(--danger)' : cubreTotalMulti ? 'var(--success)' : 'var(--warning)' }}>{montoCaja(sumUsdMulti, 'USD')} / {montoCaja(totalUsd, 'USD')}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {tasaEff > 0 && <small className="muted">Bs↔$ usa la tasa {montoCaja(tasaEff, 'Bs')}{(Number(tasaManualStr) || 0) > 0 ? ' (manual)' : ' (BCV)'}.</small>}
          </div>
        )}

        {esCompra && (
          <div className="form-row" style={{ marginTop: '.4rem' }}>
            <label>Comisión bancaria <span className="muted" style={{ fontWeight: 400 }}>(opcional · se descuenta de la caja, no suma a la factura)</span></label>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input mono" type="number" min={0} step="any" value={comisionMonto} placeholder="0,00"
                onChange={(e) => setComisionMonto(dosDecimales(e.target.value))} style={{ maxWidth: 140, textAlign: 'right' }} />
              {(Number(comisionMonto) || 0) > 0 && saldosCaja.length > 0 && (
                <select className="select" style={{ maxWidth: 240 }} value={comisionSaldoId || saldoSel?.id || saldosCaja[0]?.id || ''} onChange={(e) => setComisionSaldoId(e.target.value)}>
                  {saldosCaja.map((s) => <option key={s.id} value={s.id}>{s.moneda}{cuentaLabel(s.cuenta)} · {montoCaja(Number(s.saldo), s.moneda)}</option>)}
                </select>
              )}
            </div>
            {(Number(comisionMonto) || 0) > 0 && (
              <small className="muted">Se registra como un egreso aparte (Comisión bancaria) en Tesorería. El pago de la factura sigue siendo {montoCaja(total, monedaBase)}.</small>
            )}
          </div>
        )}
        {fila.kind === 'compra' && fila.compra && (
          <small className="muted" style={{ display: 'block' }}>Al pagar, los materiales quedan <strong>POR RECIBIR en Inventario</strong>: el almacenista les da entrada y elige el almacén / subalmacén.</small>
        )}
        {fila.servicio?.items?.length ? (
          <ul className="muted" style={{ fontSize: '.76rem', margin: '.4rem 0 0', paddingLeft: '1rem' }}>
            {fila.servicio.items.map((it, i) => <li key={i}>{it.descripcion} · {num(it.cantidad)} · {montoCaja(Number(it.gasto) || 0, monedaBase)}</li>)}
          </ul>
        ) : null}
        <div className="muted" style={{ fontSize: '.72rem', marginTop: '.4rem' }}>Montado el {fila.kind === 'compra' ? dateTime(fila.compra?.updated_at ?? '') : dateTime(fila.servicio?.updated_at ?? '')}.</div>
      </form>
    </Modal>
  );
}
