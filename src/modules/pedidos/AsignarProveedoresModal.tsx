import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { notify } from '@/shared/lib/notify';
import { money, num } from '@/shared/lib/format';
import type { ItemOrden, OfertaProveedor, Orden, Proveedor } from '@/shared/lib/types';
import { listOfertasByOrden } from './ofertas.repository';
import { getStatsForProveedores, type ProveedorStats } from './evaluaciones.repository';
import { scoreOfertas } from './score';
import { asignarProveedoresAOrden, listSubOcs, type AsignacionProveedor } from './pedidos.repository';
import { AgregarOfertaModal } from './AgregarOfertaModal';

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
  // Cargar una oferta nueva SIN salir del asignador (para cubrir lo que ningún proveedor cotizó).
  const [agregando, setAgregando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [ofs, hs] = await Promise.all([listOfertasByOrden(orden.id), listSubOcs(orden.id)]);
      setOfertas(ofs);
      setHijas(hs);
      const s = await getStatsForProveedores(Array.from(new Set(ofs.map((o) => o.proveedor_id))));
      setStats(s);
      setSelProv((p) => p || ofs[0]?.proveedor_id || '');
    } finally { setLoading(false); }
  }, [orden.id]);
  useEffect(() => { void cargar(); }, [cargar]);

  // Ítems "a comprar" de la OP.
  const opItems = useMemo(() => orden.items.filter((it) => it.comprar !== false), [orden.items]);
  // Proveedores disponibles y los que ya tienen oferta (para el modal de «cargar oferta»).
  const proveedoresList = useMemo(() => Array.from(proveedorMap.values()), [proveedorMap]);
  const proveedoresYaOfertados = useMemo(() => new Set(ofertas.map((o) => o.proveedor_id)), [ofertas]);
  // Oferta por proveedor + precio por (proveedor, sku).
  const ofertaDe = useMemo(() => new Map(ofertas.map((o) => [o.proveedor_id, o])), [ofertas]);
  const precioDe = (provId: string, sku: string): number | null => {
    const o = ofertaDe.get(provId);
    const it = o?.items?.find((x) => x.sku === sku);
    if (!it) return null;
    // Precio efectivo: BCV si lo cotizó; si la oferta es solo en divisa, el precio USD.
    const bcv = Number(it.precio) || 0;
    const usd = Number(it.precio_usd) || 0;
    const efectivo = bcv > 0 ? bcv : usd;
    return efectivo > 0 ? efectivo : null;
  };
  // IVA/IGTF (montos) de una oferta, PRORRATEADOS por la fracción que compra esta hija
  // (gross asignado / gross total de la oferta). Así una sub-OC que toma solo parte de
  // los ítems del proveedor recibe la parte proporcional del impuesto, no el total.
  const impuestosDe = useCallback((provId: string, grossAsignado: number): { iva: number; igtf: number } => {
    const o = ofertaDe.get(provId);
    const ivaOf = Number(o?.iva) || 0;
    const igtfOf = Number(o?.igtf) || 0;
    if (ivaOf <= 0 && igtfOf <= 0) return { iva: 0, igtf: 0 };
    const grossOferta = Number(o?.precio_total) || (o?.items ?? []).reduce((a, i) => a + (Number(i.cantidad) || 0) * (Number(i.precio) || 0), 0);
    const frac = grossOferta > 0 ? Math.min(1, grossAsignado / grossOferta) : 1;
    return {
      iva: Math.round(ivaOf * frac * 100) / 100,
      igtf: Math.round(igtfOf * frac * 100) / 100,
    };
  }, [ofertaDe]);
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
    const m = new Map<string, { items: number; total: number; iva: number; igtf: number }>();
    for (const it of opItems) {
      const prov = asignado[it.sku];
      if (!prov) continue;
      const precio = precioDe(prov, it.sku) ?? 0;
      const cur = m.get(prov) ?? { items: 0, total: 0, iva: 0, igtf: 0 };
      cur.items += 1;
      cur.total += (Number(it.cantidad) || 0) * precio;
      m.set(prov, cur);
    }
    // Prorratea IVA/IGTF de cada oferta por lo asignado (para que el preview iguale a la OC creada).
    for (const [prov, r] of m) {
      const imp = impuestosDe(prov, r.total);
      r.iva = imp.iva; r.igtf = imp.igtf;
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asignado, opItems, ofertaDe, impuestosDe]);

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
      const arr = porProv.get(prov) ?? [];
      arr.push({ ...it, precio, comprar: true });
      porProv.set(prov, arr);
    }
    const asignaciones: AsignacionProveedor[] = Array.from(porProv.entries()).map(([proveedorId, items]) => {
      const of = ofertaDe.get(proveedorId);
      const gross = items.reduce((a, i) => a + (Number(i.cantidad) || 0) * (Number(i.precio) || 0), 0);
      const imp = impuestosDe(proveedorId, gross);
      return {
        proveedorId, items,
        condiciones_pago: of?.condiciones_pago ?? null,
        oferta_detalle: of?.detalle ?? null,
        oferta_precio_efectivo: of?.precio_efectivo ?? null,
        iva: imp.iva > 0 ? imp.iva : null,
        igtf: imp.igtf > 0 ? imp.igtf : null,
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
                  {provName(o.proveedor_id)}{r ? ` · ${r.items} ítem(s) · ${money(r.total + r.iva + r.igtf)}` : ''}
                </button>
              );
            })}
          </div>

          {/* Tabla de productos para el proveedor seleccionado */}
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.84rem' }}>
              <thead><tr>
                <th style={{ width: 40 }}></th><th>Producto</th>
                <th style={{ textAlign: 'right' }}>Cant.</th>
                <th style={{ textAlign: 'right' }}>Precio {provName(selProv)}</th>
                <th style={{ textAlign: 'right' }}>Subtotal</th>
                <th>Asignación</th>
              </tr></thead>
              <tbody>
                {opItems.map((it) => {
                  const precio = precioDe(selProv, it.sku);
                  const lockProv = bloqueado.get(it.sku);
                  const asignProv = asignado[it.sku];
                  const checked = asignProv === selProv;
                  const disabled = !!lockProv || !precio || (asignProv && asignProv !== selProv);
                  const cant = Number(it.cantidad) || 0;
                  return (
                    <tr key={it.sku} style={lockProv ? { opacity: .6 } : undefined}>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={checked} disabled={!!disabled}
                          onChange={() => toggle(it.sku, selProv)} title={!precio ? 'Este proveedor no cotizó el producto' : undefined} />
                      </td>
                      <td>{it.nombre}<span className="muted"> · {it.sku}</span></td>
                      <td className="mono" style={{ textAlign: 'right' }}>{num(cant)} {it.unidad ?? ''}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{precio != null ? money(precio) : <span className="muted">no cotizó</span>}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{precio != null ? money(cant * precio) : '—'}</td>
                      <td style={{ fontSize: '.8rem' }}>
                        {lockProv ? <span className="badge success">🔒 {provName(lockProv)} (OC creada)</span>
                          : asignProv ? <span className="badge primary">{provName(asignProv)}</span>
                          : <span className="muted">sin asignar</span>}
                      </td>
                    </tr>
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
                  <li key={prov}><strong>{provName(prov)}</strong>: {r.items} producto(s) · <span className="mono">{money(r.total + r.iva + r.igtf)}</span>
                    {(r.iva > 0 || r.igtf > 0) && <span className="muted"> (base {money(r.total)}{r.iva > 0 ? ` · IVA ${money(r.iva)}` : ''}{r.igtf > 0 ? ` · IGTF ${money(r.igtf)}` : ''})</span>}
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
