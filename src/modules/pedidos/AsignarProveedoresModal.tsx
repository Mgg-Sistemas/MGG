import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { notify } from '@/shared/lib/notify';
import { money, num } from '@/shared/lib/format';
import type { ItemOrden, OfertaProveedor, Orden, Proveedor } from '@/shared/lib/types';
import { listOfertasDeOrdenes } from './ofertas.repository';
import { ordenesConOfertasDe } from './ordenDeOfertas';
import { getStatsForProveedores, type ProveedorStats } from './evaluaciones.repository';
import { scoreOfertas } from './score';
import { asignarProveedoresAOrden, listSubOcs, type AsignacionProveedor } from './pedidos.repository';
import { itemHijaDesdeOferta, itemsAgregadosPorOferta, recortarOfertaAHija } from './subOc';
import { AgregarOfertaModal } from './AgregarOfertaModal';
import {
  ajusteInicial, cambiarModo, cotizaEnOtraUnidad, faltaFactor, precioUsoDe, renglonReparto, textoConversion,
  unidadCotizadaDe, unidadUsoDe, type AjusteRenglon, type ModoUnidad, type RenglonReparto,
} from './repartoRenglon';
import { skuOGuion } from './renglonVisible';

/**
 * Asignador de proveedores POR PRODUCTO (OC multi-proveedor). Para una OP aprobada:
 *   · se elige un proveedor y se ven sus precios por producto,
 *   · se marca con check qué productos comprarle,
 *   · los productos ya asignados a otro proveedor (o a una sub-OC previa) quedan bloqueados.
 * Al confirmar, cada proveedor genera una OC hija (sub-OC) con su método de pago propio.
 */
export function AsignarProveedoresModal({ orden, proveedorMap, actorEmail, onClose, onDone }: {
  orden: Orden;
  proveedorMap: Map<string, Proveedor>;
  actorEmail: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [ofertas, setOfertas] = useState<OfertaProveedor[]>([]);
  const [stats, setStats] = useState<Map<string, ProveedorStats>>(new Map());
  const [hijas, setHijas] = useState<Orden[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // sku → proveedor_id asignado en ESTA sesión (no incluye los ya bloqueados por sub-OC previa).
  const [asignado, setAsignado] = useState<Record<string, string>>({});
  const [selProv, setSelProv] = useState<string>('');
  // Moneda elegida por proveedor: 'bcv' (paga en Bs al cambio) o 'usd' (directo en divisa).
  const [monedaSel, setMonedaSel] = useState<Record<string, 'bcv' | 'usd'>>({});
  // Cargar una oferta nueva SIN salir del asignador (para cubrir lo que ningún proveedor cotizó).
  const [agregando, setAgregando] = useState(false);
  // Cambios de unidad/cantidad que hace Compras al asignar, por (sku, proveedor): al cambiar
  // de proveedor se arranca otra vez de lo que cotizó ese proveedor (12-11-2026, de GT).
  const [ajustes, setAjustes] = useState<Record<string, AjusteRenglon>>({});
  const [editando, setEditando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      // Las mismas ofertas que muestra la comparativa de esta orden: si el asignador
      // viera menos, se repartirían productos entre proveedores que ahí sí cotizaron.
      // Las sub-OC que se crean acá SÍ son de esta orden, no de la madre.
      const [ofs, hs] = await Promise.all([
        listOfertasDeOrdenes(ordenesConOfertasDe(orden)),
        listSubOcs(orden.id),
      ]);
      setOfertas(ofs);
      setHijas(hs);
      const s = await getStatsForProveedores(Array.from(new Set(ofs.map((o) => o.proveedor_id))));
      setStats(s);
      setSelProv((p) => p || ofs[0]?.proveedor_id || '');
    } finally { setLoading(false); }
  }, [orden]);
  useEffect(() => { void cargar(); }, [cargar]);

  // Ítems "a comprar" de la OP.
  const opItems = useMemo(() => orden.items.filter((it) => it.comprar !== false), [orden.items]);
  // Proveedores disponibles y los que ya tienen oferta (para el modal de «cargar oferta»).
  const proveedoresList = useMemo(() => Array.from(proveedorMap.values()), [proveedorMap]);
  const proveedoresYaOfertados = useMemo(() => new Set(ofertas.map((o) => o.proveedor_id)), [ofertas]);
  // Oferta por proveedor + precio por (proveedor, sku).
  const ofertaDe = useMemo(() => new Map(ofertas.map((o) => [o.proveedor_id, o])), [ofertas]);
  // ¿Qué monedas cotizó el proveedor? (hay al menos un ítem con precio BCV / precio USD).
  const ofreceMoneda = useCallback((provId: string): { bcv: boolean; usd: boolean } => {
    const items = ofertaDe.get(provId)?.items ?? [];
    return {
      bcv: items.some((x) => (Number(x.precio) || 0) > 0),
      usd: items.some((x) => (Number(x.precio_usd) || 0) > 0),
    };
  }, [ofertaDe]);
  // Moneda EFECTIVA del proveedor: la elegida, o por defecto BCV (o USD si solo cotizó en divisa).
  const monedaDe = useCallback((provId: string): 'bcv' | 'usd' => {
    const sel = monedaSel[provId];
    if (sel) return sel;
    const { bcv, usd } = ofreceMoneda(provId);
    return (!bcv && usd) ? 'usd' : 'bcv';
  }, [monedaSel, ofreceMoneda]);
  // Precio del proveedor para un sku, EN LA MONEDA elegida (BCV = paga en Bs; USD = directo en divisa).
  const precioEnMoneda = useCallback((provId: string, sku: string, moneda: 'bcv' | 'usd'): number | null => {
    const it = ofertaDe.get(provId)?.items?.find((x) => x.sku === sku);
    if (!it) return null;
    const val = moneda === 'usd' ? (Number(it.precio_usd) || 0) : (Number(it.precio) || 0);
    return val > 0 ? val : null;
  }, [ofertaDe]);
  const precioDe = (provId: string, sku: string): number | null => precioEnMoneda(provId, sku, monedaDe(provId));
  // Lo que ESE proveedor cotizó para el ítem (cantidad, unidad de compra y factor).
  const ofertadoDe = useCallback((provId: string, sku: string) => ofertaDe.get(provId)?.items?.find((x) => x.sku === sku), [ofertaDe]);
  const claveAj = (provId: string, sku: string) => `${sku}|${provId}`;
  const ajusteDe = useCallback((provId: string, it: ItemOrden): AjusteRenglon =>
    ajustes[`${it.sku}|${provId}`] ?? ajusteInicial(it, ofertadoDe(provId, it.sku)), [ajustes, ofertadoDe]);
  const ajustar = (provId: string, sku: string, aj: AjusteRenglon | null) => setAjustes((p) => {
    const n = { ...p };
    if (aj) n[claveAj(provId, sku)] = aj; else delete n[claveAj(provId, sku)];
    return n;
  });
  // El renglón tal como irá a la sub-OC: por defecto lo que cotizó el proveedor (2 PAILA × $230),
  // no la cantidad/unidad de la solicitud con el precio de la oferta.
  const renglonDe = useCallback((provId: string, it: ItemOrden): RenglonReparto | null => {
    const precio = precioEnMoneda(provId, it.sku, monedaDe(provId));
    if (precio == null) return null;
    return renglonReparto(it, ofertadoDe(provId, it.sku), ajusteDe(provId, it), precio);
  }, [precioEnMoneda, monedaDe, ofertadoDe, ajusteDe]);
  // El prorrateo de IVA/IGTF/descuento/efectivo por la fracción que compra cada hija vive
  // en recortarOfertaAHija (subOc.ts): una sola regla para el preview, la creación de la
  // sub-OC y su re-sincronización.
  // Ítems ya asignados a una sub-OC previa (bloqueados): sku → proveedor_id.
  const bloqueado = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of hijas) for (const it of (h.items ?? [])) if (h.proveedor_id) m.set(it.sku, h.proveedor_id);
    return m;
  }, [hijas]);

  // Recomendación por precio/calidad (badges del score).
  const scored = useMemo(() => scoreOfertas(ofertas, stats), [ofertas, stats]);
  const recoPrecio = scored.find((s) => s.mejorPrecio)?.oferta.proveedor_id ?? null;
  const recoCalidad = scored.find((s) => s.mejorCalidad)?.oferta.proveedor_id ?? null;

  function toggle(sku: string, provId: string) {
    if (bloqueado.has(sku)) return;
    setAsignado((prev) => {
      const next = { ...prev };
      if (next[sku] === provId) delete next[sku];
      else next[sku] = provId;
      return next;
    });
  }

  // Resumen por proveedor (de lo asignado en esta sesión).
  const resumen = useMemo(() => {
    // `iva` acá es SOLO el que suma al total (con los precios ya con IVA adentro va en 0);
    // `ajuste` es la parte prorrateada del ajuste declarado (impuestosOc.ts).
    const m = new Map<string, { items: number; total: number; iva: number; igtf: number; ajuste: number }>();
    for (const it of opItems) {
      const prov = asignado[it.sku];
      if (!prov) continue;
      const ren = renglonDe(prov, it);
      const cur = m.get(prov) ?? { items: 0, total: 0, iva: 0, igtf: 0, ajuste: 0 };
      cur.items += 1;
      // El renglón que irá a la sub-OC (cantidad y unidad cotizadas, o las que ajustó Compras).
      cur.total += ren ? ren.cantidad * ren.precio : 0;
      m.set(prov, cur);
    }
    // Más lo que el proveedor agregó en su cotización (entra a su sub-OC).
    for (const [prov, cur] of m) {
      const moneda = monedaDe(prov);
      for (const extra of itemsAgregadosPorOferta(ofertaDe.get(prov)?.items ?? [], opItems.map((i) => i.sku))) {
        const precio = precioEnMoneda(prov, extra.sku, moneda);
        if (precio == null) continue;
        cur.items += 1;
        cur.total += (Number(extra.cantidad) || 0) * precio;
      }
    }
    // Prorratea IVA/IGTF (y descuento/efectivo) de cada oferta por lo asignado, con la MISMA
    // regla con la que se crea la sub-OC (recortarOfertaAHija): así el preview iguala a la OC.
    for (const [prov, r] of m) {
      const of = ofertaDe.get(prov);
      const enDivisa = monedaDe(prov) === 'usd';
      const rec = recortarOfertaAHija(
        {
          items: of?.items ?? [],
          precio_total: Number(of?.precio_total) || 0,
          precio_efectivo: enDivisa ? null : of?.precio_efectivo,
          descuento: enDivisa ? null : of?.descuento,
          iva: enDivisa ? null : of?.iva,
          igtf: enDivisa ? null : of?.igtf,
          iva_incluido: enDivisa ? null : of?.iva_incluido,
          ajuste: enDivisa ? null : of?.ajuste,
          ajuste_motivo: of?.ajuste_motivo,
        },
        [
          ...opItems.filter((it) => asignado[it.sku] === prov).map((it) => it.sku),
          ...itemsAgregadosPorOferta(of?.items ?? [], opItems.map((i) => i.sku)).map((it) => it.sku),
        ],
      );
      r.iva = rec.iva_incluido ? 0 : (rec.iva ?? 0);
      r.igtf = rec.igtf ?? 0;
      r.ajuste = rec.ajuste ?? 0;
      // Efectivo (si es menor que el BCV asignado) reemplaza el subtotal; el descuento lo reduce.
      const base = rec.precio_efectivo != null && rec.precio_efectivo < r.total ? rec.precio_efectivo : r.total;
      r.total = Math.max(0, base - (rec.descuento ?? 0));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asignado, opItems, ofertaDe, monedaDe, monedaSel, ajustes]);

  const sinAsignar = opItems.filter((it) => !asignado[it.sku] && !bloqueado.has(it.sku));
  const nuevos = Object.keys(asignado).length;

  async function confirmar() {
    setError(null);
    if (!nuevos) { setError('Marcá al menos un producto para algún proveedor.'); return; }
    // Agrupa lo asignado por proveedor.
    const porProv = new Map<string, ItemOrden[]>();
    for (const it of opItems) {
      const prov = asignado[it.sku];
      if (!prov) continue;
      const precio = precioDe(prov, it.sku);
      if (precio == null) { setError(`El proveedor no cotizó «${it.nombre}».`); return; }
      const aj = ajusteDe(prov, it);
      const uso = unidadUsoDe(it, ofertadoDe(prov, it.sku));
      if (faltaFactor(aj)) { setError(`«${it.nombre}»: indica cuántos ${uso || 'unidades'} trae 1 ${aj.modo === 'otra' ? (aj.otraUnidad || 'unidad') : unidadCotizadaDe(it, ofertadoDe(prov, it.sku))} (✎ Unidad).`); return; }
      const ren = renglonReparto(it, ofertadoDe(prov, it.sku), aj, precio);
      if (!(ren.cantidad > 0)) { setError(`Indica la cantidad de «${it.nombre}».`); return; }
      const arr = porProv.get(prov) ?? [];
      // La cantidad y la unidad salen de la COTIZACIÓN (14-10-2026) o de lo que Compras ajustó
      // aquí (12-11-2026): la sub-OC lleva exactamente lo que muestra la fila.
      const base = itemHijaDesdeOferta(it, ofertadoDe(prov, it.sku), precio);
      const pUsd = Number(base.precio_usd) || 0;
      arr.push({
        ...base,
        cantidad: ren.cantidad,
        precio: ren.precio,
        ...(pUsd > 0 ? { precio_usd: Math.round(pUsd * ren.escala * 10000) / 10000 } : {}),
        unidad_compra: ren.unidad_compra,
        factor_compra: ren.factor_compra,
      });
      porProv.set(prov, arr);
    }
    // Lo que el proveedor agregó en su cotización y la solicitud no pedía va a SU sub-OC.
    for (const [prov, arr] of porProv) {
      const moneda = monedaDe(prov);
      for (const extra of itemsAgregadosPorOferta(ofertaDe.get(prov)?.items ?? [], opItems.map((i) => i.sku))) {
        const precio = precioEnMoneda(prov, extra.sku, moneda);
        if (precio != null && !arr.some((x) => x.sku === extra.sku)) arr.push({ ...extra, precio, comprar: true });
      }
    }
    const asignaciones: AsignacionProveedor[] = Array.from(porProv.entries()).map(([proveedorId, items]) => {
      const of = ofertaDe.get(proveedorId);
      const enDivisa = monedaDe(proveedorId) === 'usd';
      // La hija toma SOLO su parte de la oferta: IVA/IGTF/descuento/efectivo prorrateados por
      // la fracción que representa (misma regla que recortarOfertaAHija en el repositorio,
      // así lo que muestra el preview es lo que queda guardado). Directo en divisa: el precio
      // USD ya es el final; sin IVA/IGTF ni descuento efectivo (son en Bs).
      const rec = recortarOfertaAHija(
        {
          items: of?.items ?? [],
          precio_total: Number(of?.precio_total) || 0,
          precio_efectivo: enDivisa ? null : of?.precio_efectivo,
          descuento: of?.descuento,
          iva: of?.iva,
          igtf: of?.igtf,
          iva_incluido: of?.iva_incluido,
          ajuste: of?.ajuste,
          ajuste_motivo: of?.ajuste_motivo,
        },
        items.map((i) => i.sku),
      );
      return {
        proveedorId, items,
        modalidad_pago: enDivisa ? 'usd' : 'bs',
        pago_en_divisa: enDivisa,
        condiciones_pago: of?.condiciones_pago ?? null,
        oferta_detalle: of?.detalle ?? null,
        oferta_precio_efectivo: rec.precio_efectivo,
        descuento: rec.descuento,
        iva: rec.iva,
        igtf: rec.igtf,
        iva_incluido: rec.iva_incluido,
        ajuste: rec.ajuste,
        ajuste_motivo: rec.ajuste_motivo,
      };
    });
    setSaving(true);
    try {
      const creadas = await asignarProveedoresAOrden(orden, asignaciones, actorEmail);
      notify(`${creadas.length} OC creada(s) por proveedor · pendientes de aprobación`, 'success', { link: '#/app/pedidos' });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo asignar'); setSaving(false); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button className="btn btn-primary" onClick={() => void confirmar()} disabled={saving || !nuevos}>
        {saving ? 'Creando OC…' : `Confirmar asignación (${nuevos})`}
      </button>
    </>
  );

  const provName = (id: string) => proveedorMap.get(id)?.razon_social ?? '—';

  return (
    <Modal title={`Asignar proveedores por producto · ${orden.codigo}`} size="xl" onClose={onClose} footer={footer}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
      {!loading && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '.5rem' }}>
          <button className="btn btn-sm btn-ghost" onClick={() => setAgregando(true)}>
            + Cargar oferta de proveedor
          </button>
        </div>
      )}
      {loading ? (
        <p className="hint muted" style={{ margin: 0 }}>Cargando ofertas…</p>
      ) : !ofertas.length ? (
        <p className="hint muted" style={{ margin: 0 }}>
          No hay ofertas cargadas para esta orden. Usá <strong>«+ Cargar oferta de proveedor»</strong> para agregar la cotización del proveedor que tiene estos productos y luego asignarlos.
        </p>
      ) : (
        <>
          <p className="hint muted" style={{ marginTop: 0, fontSize: '.84rem' }}>
            Elegí un proveedor y marcá los productos que le comprás (a su precio). Si el producto que falta no lo cotizó nadie, cargá su oferta con <strong>«+ Cargar oferta de proveedor»</strong>. Un producto ya asignado a otro proveedor queda bloqueado. Cada proveedor genera su propia OC con su método de pago. Lo que dejes sin asignar queda pendiente.
          </p>

          {/* Recomendación por precio / calidad */}
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.6rem', fontSize: '.82rem' }}>
            {recoPrecio && <span className="badge info">💲 Mejor precio: <strong>{provName(recoPrecio)}</strong></span>}
            {recoCalidad && <span className="badge info">⭐ Mejor calidad: <strong>{provName(recoCalidad)}</strong></span>}
          </div>

          {/* Selector de proveedor (chips) */}
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
            {ofertas.map((o) => {
              const r = resumen.get(o.proveedor_id);
              const activo = selProv === o.proveedor_id;
              return (
                <button key={o.id} className={activo ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'} onClick={() => setSelProv(o.proveedor_id)}>
                  {provName(o.proveedor_id)}{r ? ` · ${r.items} ítem(s) · ${money(r.total + r.iva + r.igtf + r.ajuste)}` : ''}
                </button>
              );
            })}
          </div>

          {/* Selector de moneda del proveedor: paga en Bs (al cambio) o directo en divisa ($). */}
          {selProv && ofreceMoneda(selProv).usd && (() => {
            const { bcv, usd } = ofreceMoneda(selProv);
            const m = monedaDe(selProv);
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.6rem', fontSize: '.82rem' }}>
                <span className="muted">Pago de <strong>{provName(selProv)}</strong>:</span>
                <div className="view-toggle" role="tablist">
                  <button className={m === 'bcv' ? 'active' : ''} disabled={!bcv}
                    onClick={() => setMonedaSel((p) => ({ ...p, [selProv]: 'bcv' }))}
                    title={!bcv ? 'Este proveedor no cotizó en Bs' : undefined}>💵 Bs al cambio (BCV)</button>
                  <button className={m === 'usd' ? 'active' : ''} disabled={!usd}
                    onClick={() => setMonedaSel((p) => ({ ...p, [selProv]: 'usd' }))}>💲 Directo en divisa ($)</button>
                </div>
                {m === 'usd' && <span className="muted" style={{ fontSize: '.76rem' }}>Se usa el precio USD como monto final (sin IVA/IGTF ni descuento efectivo en Bs).</span>}
              </div>
            );
          })()}

          {/* Tabla de productos para el proveedor seleccionado */}
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.84rem' }}>
              <thead><tr>
                <th style={{ width: 40 }}></th><th>Producto</th>
                <th style={{ textAlign: 'right' }}>Cant.</th>
                <th style={{ textAlign: 'right' }}>Precio {provName(selProv)} · {monedaDe(selProv) === 'usd' ? 'Divisa $' : 'Bs (BCV)'}</th>
                <th style={{ textAlign: 'right' }}>Subtotal</th>
                <th>Asignación</th>
              </tr></thead>
              <tbody>
                {opItems.map((it) => {
                  const precioCot = precioDe(selProv, it.sku);
                  const ren = renglonDe(selProv, it);
                  const precio = ren?.precio ?? null;
                  const ofertado = ofertadoDe(selProv, it.sku);
                  const aj = ajusteDe(selProv, it);
                  const uso = unidadUsoDe(it, ofertado);
                  const cot = unidadCotizadaDe(it, ofertado);
                  const abierto = editando === it.sku && !!ren;
                  const pedido = `${num(Number(it.cantidad) || 0)}${it.unidad ? ` ${it.unidad}` : ''}`;
                  const queda = ren ? `${num(ren.cantidad)}${ren.unidadMostrada ? ` ${ren.unidadMostrada}` : ''}` : pedido;
                  const conversion = ren ? textoConversion(ren, uso) : '';
                  // Precio en la OTRA moneda, como referencia visual.
                  const otra = monedaDe(selProv) === 'usd' ? 'bcv' : 'usd';
                  const precioOtra = precioEnMoneda(selProv, it.sku, otra);
                  const lockProv = bloqueado.get(it.sku);
                  const asignProv = asignado[it.sku];
                  const checked = asignProv === selProv;
                  const disabled = !!lockProv || !precio || (asignProv && asignProv !== selProv);
                  return (
                    <Fragment key={it.sku}>
                    <tr style={lockProv ? { opacity: .6 } : undefined}>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={checked} disabled={!!disabled}
                          onChange={() => toggle(it.sku, selProv)} title={!precio ? 'Este proveedor no cotizó el producto' : undefined} />
                      </td>
                      <td>{it.nombre}{skuOGuion(it) !== '—' && <span className="muted"> · {skuOGuion(it)}</span>}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {queda}
                        {conversion && <div className="muted" style={{ fontSize: '.7rem' }}>{conversion}</div>}
                        {ren && queda !== pedido && <div className="muted" style={{ fontSize: '.7rem' }}>pedido: {pedido}</div>}
                        {ren && faltaFactor(aj) && <div style={{ fontSize: '.7rem', color: 'var(--warning, #f59e0b)' }}>⚠ ¿cuántos {uso || 'unid.'} trae 1 {aj.modo === 'otra' ? (aj.otraUnidad || 'unidad') : cot}?</div>}
                        {ren && !lockProv && (
                          <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: '.72rem', padding: '.1rem .4rem', marginTop: '.15rem' }}
                            onClick={() => setEditando(abierto ? null : it.sku)}>{abierto ? 'Listo' : '✎ Unidad'}</button>
                        )}
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {precio != null ? <>{money(precio)}{ren?.unidadMostrada ? <span className="muted" style={{ fontWeight: 400 }}> / {ren.unidadMostrada}</span> : null}</> : <span className="muted">no cotizó</span>}
                        {ren && precioCot != null && ren.unidadMostrada !== uso && uso && <div className="muted" style={{ fontSize: '.7rem', fontWeight: 400 }}>{money(precioUsoDe(aj, precioCot))} / {uso}</div>}
                        {precioOtra != null && <div className="muted" style={{ fontSize: '.7rem', fontWeight: 400 }}>{money(precioOtra)} · {otra === 'usd' ? 'divisa' : 'BCV'}</div>}
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>{ren ? money(ren.cantidad * ren.precio) : '—'}</td>
                      <td style={{ fontSize: '.8rem' }}>
                        {lockProv ? <span className="badge success">🔒 {provName(lockProv)} (OC creada)</span>
                          : asignProv ? <span className="badge primary">{provName(asignProv)}</span>
                          : <span className="muted">sin asignar</span>}
                      </td>
                    </tr>
                    {abierto && ren && precioCot != null && (
                      <tr>
                        <td colSpan={6} style={{ background: 'var(--surface-2)' }}>
                          <EditorUnidad aj={aj} uso={uso} cot={cot}
                            cotizaOtra={cotizaEnOtraUnidad(it, ofertado)}
                            precio={ren.precio} unidad={ren.unidadMostrada} precioUso={precioUsoDe(aj, precioCot)}
                            onChange={(n) => ajustar(selProv, it.sku, n)} onReset={() => ajustar(selProv, it.sku, null)} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Resumen de asignación */}
          <div className="card" style={{ marginTop: '.7rem' }}>
            <div className="card-title"><span>Resumen de la asignación</span></div>
            {!resumen.size ? (
              <p className="hint muted" style={{ margin: 0, fontSize: '.84rem' }}>Todavía no asignaste productos en esta sesión.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '.85rem' }}>
                {Array.from(resumen.entries()).map(([prov, r]) => (
                  <li key={prov}><strong>{provName(prov)}</strong>: {r.items} producto(s) · <span className="mono">{money(r.total + r.iva + r.igtf + r.ajuste)}</span>
                    {(r.iva > 0 || r.igtf > 0 || r.ajuste !== 0) && <span className="muted"> (base {money(r.total)}{r.iva > 0 ? ` · IVA ${money(r.iva)}` : ''}{r.igtf > 0 ? ` · IGTF ${money(r.igtf)}` : ''}{r.ajuste !== 0 ? ` · ajuste ${money(r.ajuste)}` : ''})</span>}
                  </li>
                ))}
              </ul>
            )}
            {sinAsignar.length > 0 && (
              <p className="hint muted" style={{ marginBottom: 0, marginTop: '.4rem', fontSize: '.8rem' }}>
                Quedan <strong>{sinAsignar.length}</strong> producto(s) sin asignar — se podrán asignar después (la OP queda pendiente).
              </p>
            )}
          </div>
        </>
      )}
      {agregando && (
        <AgregarOfertaModal
          orden={orden}
          proveedores={proveedoresList}
          proveedoresYaOfertados={proveedoresYaOfertados}
          registradoPorEmail={actorEmail}
          soloSkus={new Set(opItems.filter((it) => !bloqueado.has(it.sku)).map((it) => it.sku))}
          onClose={() => setAgregando(false)}
          onCreated={() => { setAgregando(false); void cargar(); }}
        />
      )}
    </Modal>
  );
}

/** Cambiar la unidad del renglón al asignar: la cotizada, la del inventario u otra. */
function EditorUnidad({ aj, uso, cot, cotizaOtra, precio, unidad, precioUso, onChange, onReset }: {
  aj: AjusteRenglon; uso: string; cot: string; cotizaOtra: boolean;
  precio: number; unidad: string; precioUso: number;
  onChange: (aj: AjusteRenglon) => void; onReset: () => void;
}) {
  const leer = (v: string) => (v === '' ? 0 : Number(v.replace(',', '.')) || 0);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem', alignItems: 'flex-end', fontSize: '.8rem' }}>
      <label style={{ display: 'grid', gap: '.2rem' }}>
        <span className="muted">Unidad</span>
        <select className="select" value={aj.modo} onChange={(e) => onChange(cambiarModo(aj, e.target.value as ModoUnidad))}>
          {cotizaOtra && <option value="cotizada">{cot || 'Cotizada'} (como cotizó)</option>}
          <option value="uso">{uso || 'Unidad'} (inventario)</option>
          <option value="otra">Otra…</option>
        </select>
      </label>
      {aj.modo === 'cotizada' && cotizaOtra && (
        <label style={{ display: 'grid', gap: '.2rem' }}>
          <span className="muted">1 {cot} =</span>
          <span style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
            <input className="input" type="number" min={0} step="any" style={{ width: '6rem' }}
              value={aj.factorCotizada || ''} onChange={(e) => onChange({ ...aj, factorCotizada: leer(e.target.value) })} />
            {uso}
          </span>
        </label>
      )}
      {aj.modo === 'otra' && (
        <>
          <label style={{ display: 'grid', gap: '.2rem' }}>
            <span className="muted">Nombre</span>
            <input className="input" style={{ width: '7rem' }} placeholder="CAJA, TAMBOR…"
              value={aj.otraUnidad} onChange={(e) => onChange({ ...aj, otraUnidad: e.target.value.toUpperCase() })} />
          </label>
          <label style={{ display: 'grid', gap: '.2rem' }}>
            <span className="muted">1 {aj.otraUnidad || 'unidad'} =</span>
            <span style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
              <input className="input" type="number" min={0} step="any" style={{ width: '6rem' }}
                value={aj.otraFactor || ''} onChange={(e) => {
                  // Al definir el factor, la cantidad se mantiene en unidades de uso.
                  const cantUso = (Number(aj.cantidad) || 0) * (aj.otraFactor > 0 ? aj.otraFactor : 1);
                  const f = leer(e.target.value);
                  onChange({ ...aj, otraFactor: f, cantidad: f > 0 ? Math.round((cantUso / f) * 1000) / 1000 : aj.cantidad });
                }} />
              {uso}
            </span>
          </label>
        </>
      )}
      <label style={{ display: 'grid', gap: '.2rem' }}>
        <span className="muted">Cantidad</span>
        <input className="input" type="number" min={0} step="any" style={{ width: '6rem' }}
          value={aj.cantidad || ''} onChange={(e) => onChange({ ...aj, cantidad: leer(e.target.value) })} />
      </label>
      <div className="mono" style={{ paddingBottom: '.35rem' }}>
        {money(precio)}{unidad ? ` / ${unidad}` : ''}
        {unidad && uso && unidad !== uso && <span className="muted"> · {money(precioUso)} / {uso}</span>}
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>↺ Como cotizó</button>
    </div>
  );
}
