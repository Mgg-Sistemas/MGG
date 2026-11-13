/* ============================================================
   MGG · Inventario · teléfono · 📥 Recepciones (04-11-2026)

   Pedido de la administradora: el almacenista RECEPCIONA desde su teléfono
   «como recepción de inventario PC pero en el tlf»: ve las OC que se montaron
   en Compras, el delivery encargado y, al recepcionar, entra al inventario del
   almacén elegido (Los Pinos o Matanza), la orden queda RECIBIDA en Compras y
   sale su WhatsApp (con foto) y su PDF. Más abajo, el histórico de lo recibido
   en ese almacén, con su PDF y su WhatsApp. Nada se manda ni se baja solo.
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useQuien } from '@/shared/lib/directorioUsuarios';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import type { Orden } from '@/shared/lib/types';
import { recibirOrdenParcial, esServicioOrden, type RecepcionRenglon } from '@/modules/pedidos/pedidos.repository';
import { subirFacturasAlmacen } from '@/modules/pedidos/facturasOrden.repository';
import { CargarFacturaCampo } from '@/modules/pedidos/CargarFacturaCampo';
import { esDespiezable } from './despieceRes';
import { nombreAlmacenVisible } from './sectorizacion';
import { fechaHoraRecepcion, mensajeRecepcion, type DatosRecepcion } from './recepcionReporte';
import {
  fichasDeProductos, fotosRecepcionDe, listOrdenesPorRecibir, listRecepcionesDeAlmacen, nombresProveedores, subirFotosRecepcion,
  type DeliveryDeOrden, type OrdenPorRecibir,
} from './recepcionTelefono.repository';
import type { Recepcion } from './recepcionesHistorico';

const errMsg = (e: unknown, d: string) => (e instanceof Error && e.message ? e.message : d);
const leer = (t: string) => { const n = Number(String(t ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const num = (n: number) => (Number(n) || 0).toLocaleString('es-VE', { maximumFractionDigits: 4 });
const haceDias = (hoy: string, dias: number) => { const d = new Date(`${hoy}T12:00:00`); d.setDate(d.getDate() - dias); return d.toISOString().slice(0, 10); };

/** «HECTOR ALAGAL · entregó en LOS PINOS 03/11/2026 05:01 p. m.» o «· en camino». */
export function textoDelivery(d: DeliveryDeOrden | null): string | null {
  if (!d) return null;
  const quien = d.repartidor_nombre || 'Delivery';
  if (d.estado === 'entregado') return `${quien} · entregó en ${d.almacen_entrega ? nombreAlmacenVisible(d.almacen_entrega) : 'almacén'} ${fechaHoraRecepcion(d.entregado_en)}`.trim();
  return `${quien} · en camino`;
}

async function abrirPdf(d: DatosRecepcion) {
  try { const { verRecepcionPdf } = await import('./recepcionPdf'); await verRecepcionPdf(d); }
  catch (e) { toast(errMsg(e, 'No se pudo armar el PDF'), 'error'); }
}

export function RecepcionesTelefono({ almacen, canWrite, actor, actorName, quien, onVolver }: {
  almacen: string; canWrite: boolean; actor: string; actorName: string | null; quien: string; onVolver: () => void;
}) {
  const [vista, setVista] = useState<'lista' | 'historico'>('lista');
  const [filas, setFilas] = useState<OrdenPorRecibir[] | null>(null);
  const [elegida, setElegida] = useState<OrdenPorRecibir | null>(null);
  const [listo, setListo] = useState<{ datos: DatosRecepcion; fotos: File[] } | null>(null);

  const turno = useRef(0);
  const cargar = useCallback(async () => {
    const mio = ++turno.current;
    try {
      const xs = await listOrdenesPorRecibir();
      if (mio === turno.current) setFilas(xs);
    } catch (e) {
      if (mio === turno.current) { setFilas([]); toast(errMsg(e, 'No se pudieron leer las recepciones'), 'error'); }
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['ordenes', 'delivery_pedidos'], () => { void cargar(); });

  // Primero lo que un delivery ya dejó en ESTE almacén, después lo que viene en camino, después el resto.
  const ordenadas = useMemo(() => {
    const peso = (f: OrdenPorRecibir) => (f.delivery?.estado === 'entregado' && f.delivery.almacen_entrega === almacen ? 0
      : f.delivery?.estado === 'entregado' ? 1 : f.delivery ? 2 : 3);
    return [...(filas ?? [])].sort((a, b) => peso(a) - peso(b) || String(b.orden.created_at).localeCompare(String(a.orden.created_at)));
  }, [filas, almacen]);

  if (listo) {
    return (
      <div className="surt-form">
        <div className="surt-form-titulo"><span className="icono" aria-hidden>✅</span><strong>Recepción {listo.datos.codigo} registrada</strong></div>
        <div className="muted">Entró al inventario de {nombreAlmacenVisible(almacen)} y la orden quedó recibida en Compras.</div>
        <CompartirWhatsapp texto={mensajeRecepcion(listo.datos)} fotos={listo.fotos.length ? { archivos: listo.fotos } : undefined} />
        <button type="button" className="btn btn-ghost surt-guardar" onClick={() => void abrirPdf(listo.datos)}>📄 Ver PDF de la recepción</button>
        <button type="button" className="btn btn-primary surt-guardar" onClick={() => { setListo(null); void cargar(); }}>← Volver a recepciones</button>
      </div>
    );
  }

  if (elegida) {
    return (
      <FormRecepcion fila={elegida} almacen={almacen} actor={actor} actorName={actorName} quien={quien}
        onCancel={() => setElegida(null)}
        onHecho={(datos, fotos) => { setElegida(null); setListo({ datos, fotos }); }} />
    );
  }

  return (
    <section className="surt-lista">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', margin: '.5rem 0' }}>
        <strong style={{ fontSize: '1.1rem' }}>📥 Recepciones · {nombreAlmacenVisible(almacen)}</strong>
        <button type="button" className="btn btn-ghost" onClick={onVolver}>← Volver</button>
      </div>
      <div className="surt-grid2" style={{ marginBottom: '.5rem' }}>
        <button type="button" className={`btn btn-grande ${vista === 'lista' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setVista('lista')}>
          Por recibir{filas ? ` (${filas.length})` : ''}
        </button>
        <button type="button" className={`btn btn-grande ${vista === 'historico' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setVista('historico')}>
          🧾 Histórico
        </button>
      </div>
      {vista === 'historico' ? <HistoricoRecepciones almacen={almacen} /> : filas === null ? <p className="muted">Cargando…</p> : (
        <>
          <h2>{ordenadas.length ? `${ordenadas.length} orden(es) por recibir` : 'No hay órdenes por recibir'}</h2>
          {ordenadas.map((f) => {
            const o = f.orden;
            const dlv = textoDelivery(f.delivery);
            const aqui = f.delivery?.estado === 'entregado' && f.delivery.almacen_entrega === almacen;
            return (
              <button key={o.id} type="button" className="surt-mov" disabled={!canWrite} onClick={() => setElegida(f)}
                style={aqui ? { borderColor: 'var(--brand, #ff8a00)' } : undefined}>
                <span className="icono" aria-hidden>{aqui ? '🛵' : '📦'}</span>
                <span style={{ minWidth: 0 }}>
                  <div className="titulo">{o.oc_codigo ?? o.codigo} · {f.proveedor ?? '—'}</div>
                  <div className="sub">{(o.items ?? []).length} material(es){o.almacen_destino ? ` · destino ${nombreAlmacenVisible(o.almacen_destino)}` : ''}</div>
                  {dlv && <div className="sub"><strong>🛵 {dlv}</strong></div>}
                </span>
                <span className="litros">{aqui ? 'Recibir' : '›'}</span>
              </button>
            );
          })}
          {!canWrite && <small className="muted">Tu rol solo puede ver: para recepcionar hace falta escritura en Inventario.</small>}
        </>
      )}
    </section>
  );
}

function FormRecepcion({ fila, almacen, actor, actorName, quien, onCancel, onHecho }: {
  fila: OrdenPorRecibir; almacen: string; actor: string; actorName: string | null; quien: string;
  onCancel: () => void; onHecho: (d: DatosRecepcion, fotos: File[]) => void;
}) {
  const o = fila.orden;
  const items = Array.isArray(o.items) ? o.items : [];
  const [recibidas, setRecibidas] = useState<Record<string, string>>(() => Object.fromEntries(items.map((it) => [it.sku, String(it.cantidad ?? 0)])));
  const [nota, setNota] = useState('');
  const [fotos, setFotos] = useState<File[]>([]);
  // Factura del proveedor: opcional al recepcionar (12-11-2026), salvo servicios.
  const [facturas, setFacturas] = useState<File[]>([]);
  const [facturaSubida, setFacturaSubida] = useState(false);
  const pideFactura = !esServicioOrden(o);
  const [guardando, setGuardando] = useState(false);
  const previas = useMemo(() => fotos.map((f) => URL.createObjectURL(f)), [fotos]);
  useEffect(() => () => { previas.forEach((u) => URL.revokeObjectURL(u)); }, [previas]);
  const tieneRes = items.some((it) => esDespiezable(it.nombre));
  const sinFicha = items.filter((it) => !it.productoId && leer(recibidas[it.sku] ?? '') > 0);
  const hayDiferencia = items.some((it) => leer(recibidas[it.sku] ?? '') !== Number(it.cantidad));

  async function guardar() {
    if (tieneRes) { toast('Esta orden trae res en canal: se recibe despiezada desde la PC.', 'error'); return; }
    for (const it of items) if (leer(recibidas[it.sku] ?? '') > Number(it.cantidad)) { toast(`No se puede recibir más de lo pedido en ${it.nombre}.`, 'error'); return; }
    if (items.every((it) => leer(recibidas[it.sku] ?? '') <= 0)) { toast('Indica al menos una cantidad recibida.', 'error'); return; }
    if (hayDiferencia && !nota.trim()) { toast('Llegó distinto a lo pedido: escribe una nota explicando.', 'error'); return; }
    setGuardando(true);
    try {
      // Si el almacenista cargó facturas, se suben antes de recibir.
      if (pideFactura && facturas.length) { await subirFacturasAlmacen(o.id, facturas, actorName || actor); setFacturas([]); setFacturaSubida(true); }
      const recepciones: RecepcionRenglon[] = items.map((it) => ({ sku: it.sku, cantidad_recibida: Math.max(0, leer(recibidas[it.sku] ?? '')), marca_recibida: null, nota_marca: null }));
      const notaDlv = fila.delivery?.estado === 'entregado' ? `Entregada por delivery (${fila.delivery.repartidor_nombre ?? '—'}). ` : '';
      await recibirOrdenParcial(o, recepciones, `${notaDlv}${nota.trim()}`.trim() || null, actor, actorName, almacen);
      if (fotos.length) {
        try { await subirFotosRecepcion(o as Orden & { recepcion_fotos?: unknown }, fotos); }
        catch (e) { toast(`Quedó recibida, pero las fotos no subieron: ${errMsg(e, 'error')}`, 'warning'); }
      }
      const datos: DatosRecepcion = {
        codigo: o.oc_codigo ?? o.codigo, documento: o.oc_codigo ?? o.codigo, proveedor: fila.proveedor, almacen,
        at: new Date().toISOString(), quien, nota: `${notaDlv}${nota.trim()}`.trim() || null, delivery: textoDelivery(fila.delivery),
        fotos: fotos.length,
        items: items.map((it) => ({
          nombre: it.nombre, unidad: (it as { unidad_compra?: string | null }).unidad_compra || it.unidad || null,
          cantidad: leer(recibidas[it.sku] ?? ''), pedido: Number(it.cantidad) || 0,
          precio: (o.moneda ?? 'USD').toUpperCase() === 'BS' ? null : (Number(it.precio) || null),
        })).filter((it) => it.cantidad > 0),
      };
      toast(`${datos.codigo} recibida en ${nombreAlmacenVisible(almacen)}.`, 'success');
      onHecho(datos, fotos);
    } catch (e) {
      toast(errMsg(e, 'No se pudo registrar la recepción'), 'error');
    } finally { setGuardando(false); }
  }

  return (
    <div className="surt-form">
      <div className="surt-form-titulo"><span className="icono" aria-hidden>📥</span><strong>Recepcionar · {o.oc_codigo ?? o.codigo}</strong></div>
      <div className="muted">{fila.proveedor ?? '—'} · entra a <strong>{nombreAlmacenVisible(almacen)}</strong></div>
      {textoDelivery(fila.delivery) && <div className="aviso info sm"><span className="aviso-icono">🛵</span><div>{textoDelivery(fila.delivery)}</div></div>}
      {tieneRes && <div className="aviso warning sm"><span className="aviso-icono">⚠</span><div>Trae res en canal: se recibe despiezada desde la PC.</div></div>}
      {sinFicha.length > 0 && (
        <div className="aviso warning sm"><span className="aviso-icono">⚠</span><div>{sinFicha.map((it) => it.nombre).join(', ')}: sin ficha de inventario. Compras debe fijar con qué nombre se guarda antes de recibir.</div></div>
      )}
      {items.map((it) => {
        const rec = leer(recibidas[it.sku] ?? '');
        const unidad = (it as { unidad_compra?: string | null }).unidad_compra || it.unidad || '';
        return (
          <div key={it.sku} className="card" style={{ margin: 0, padding: '.55rem .65rem' }}>
            <strong style={{ display: 'block' }}>{it.nombre}</strong>
            <small className="muted">Pedido: {num(Number(it.cantidad))} {unidad}</small>
            <input className="input surt-litros" inputMode="decimal" value={recibidas[it.sku] ?? ''} aria-label={`Recibido de ${it.nombre}`}
              onChange={(e) => { const v = e.target.value; setRecibidas((r) => ({ ...r, [it.sku]: v })); }} />
            {rec !== Number(it.cantidad) && <small className="surt-alerta">{rec < Number(it.cantidad) ? `Faltan ${num(Number(it.cantidad) - rec)}` : 'Más de lo pedido'}</small>}
          </div>
        );
      })}
      <div className="surt-campo">
        <label htmlFor="rec-tel-nota">Nota {hayDiferencia ? '(obligatoria: llegó distinto)' : '(opcional)'}</label>
        <input id="rec-tel-nota" className="input surt-input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Faltantes, estado de la mercancía…" />
      </div>
      {pideFactura && !facturaSubida && (
        <CargarFacturaCampo id="rec-tel-factura" className="surt-campo" archivos={facturas} onChange={setFacturas} disabled={guardando} />
      )}
      <div className="surt-campo">
        <label htmlFor="rec-tel-fotos">Fotos ({fotos.length}/4) · van con el WhatsApp</label>
        {fotos.length < 4 && (
          <input id="rec-tel-fotos" className="input surt-input" type="file" accept="image/*" multiple
            onChange={(e) => { const xs = Array.from(e.target.files ?? []).filter((f) => /^image\//.test(f.type)); setFotos((f) => [...f, ...xs].slice(0, 4)); e.target.value = ''; }} />
        )}
        {!!fotos.length && (
          <div className="rep-fotos">
            {fotos.map((f, i) => (
              <div key={`${f.name}-${i}`} className="rep-foto surt-foto-quitar">
                <img src={previas[i]} alt={f.name} />
                <button type="button" aria-label={`Quitar ${f.name}`} onClick={() => setFotos((xs) => xs.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="btn btn-primary surt-guardar" disabled={guardando || tieneRes || sinFicha.length > 0} onClick={() => void guardar()}>
        {guardando ? 'Recibiendo…' : `✓ Recepcionar en ${nombreAlmacenVisible(almacen)}`}
      </button>
      <button type="button" className="btn btn-ghost btn-grande" onClick={onCancel} disabled={guardando}>← Otra orden</button>
    </div>
  );
}

/** Lo recibido en este almacén, con el PDF y el WhatsApp de cada recepción. */
function HistoricoRecepciones({ almacen }: { almacen: string }) {
  const quienDe = useQuien();
  const hoy = hoyVenezuela();
  const [desde, setDesde] = useState(haceDias(hoy, 30));
  const [hasta, setHasta] = useState(hoy);
  const [busca, setBusca] = useState('');
  const [recs, setRecs] = useState<Recepcion[] | null>(null);
  const [fichas, setFichas] = useState<Map<string, { nombre: string; unidad: string | null }>>(new Map());
  const [provs, setProvs] = useState<Map<string, string>>(new Map());
  const [whatsapp, setWhatsapp] = useState<{ datos: DatosRecepcion; fotos: File[] } | null>(null);

  const cargar = useCallback(async () => {
    try {
      const xs = await listRecepcionesDeAlmacen(almacen, desde, hasta);
      const [f, p] = await Promise.all([
        fichasDeProductos(xs.flatMap((r) => r.items.map((i) => i.producto_id))),
        nombresProveedores(xs.map((r) => r.proveedor_id ?? '')),
      ]);
      setFichas(f); setProvs(p); setRecs(xs);
    } catch (e) { setRecs([]); toast(errMsg(e, 'No se pudo leer el histórico'), 'error'); }
  }, [almacen, desde, hasta]);
  useEffect(() => { setRecs(null); void cargar(); }, [cargar]);

  const datosDe = (r: Recepcion): DatosRecepcion => ({
    codigo: r.codigo, documento: r.documento, proveedor: (r.proveedor_id && provs.get(r.proveedor_id)) || null, almacen: r.almacen,
    at: r.at, quien: quienDe(r.actor_name, r.actor) || r.actor_name || r.actor,
    items: r.items.map((i) => ({ nombre: fichas.get(i.producto_id)?.nombre ?? '—', unidad: fichas.get(i.producto_id)?.unidad ?? null, cantidad: i.cantidad, precio: i.precio })),
  });
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return recs ?? [];
    return (recs ?? []).filter((r) => [r.codigo, r.documento ?? '', ...r.items.map((i) => fichas.get(i.producto_id)?.nombre ?? '')].join(' ').toLowerCase().includes(q));
  }, [recs, busca, fichas]);

  async function verWhatsapp(r: Recepcion) {
    const datos = datosDe(r);
    let fotos: File[] = [];
    if (r.ref_tipo === 'orden' && r.ref_id) {
      try { const x = await fotosRecepcionDe(r.ref_id); fotos = x.archivos; datos.fotos = x.fotos.length; } catch { /* sin fotos */ }
    }
    setWhatsapp({ datos, fotos });
  }

  if (whatsapp) {
    return (
      <div className="surt-form">
        <div className="surt-form-titulo"><span className="icono" aria-hidden>💬</span><strong>Recepción {whatsapp.datos.codigo}</strong></div>
        <CompartirWhatsapp texto={mensajeRecepcion(whatsapp.datos)} fotos={whatsapp.fotos.length ? { archivos: whatsapp.fotos } : undefined} />
        <button type="button" className="btn btn-primary surt-guardar" onClick={() => setWhatsapp(null)}>← Volver al histórico</button>
      </div>
    );
  }

  return (
    <>
      <div className="surt-grid2">
        <div className="surt-campo"><label htmlFor="rec-hist-desde">Desde</label>
          <input id="rec-hist-desde" type="date" className="input surt-input" value={desde} max={hoy} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="surt-campo"><label htmlFor="rec-hist-hasta">Hasta</label>
          <input id="rec-hist-hasta" type="date" className="input surt-input" value={hasta} max={hoy} onChange={(e) => setHasta(e.target.value)} /></div>
      </div>
      <input className="input surt-input" type="search" placeholder="🔍 Orden o material…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar recepción" />
      {recs === null ? <p className="muted">Cargando…</p> : (
        <>
          <h2>{lista.length} recepción(es)</h2>
          {lista.map((r) => (
            <div key={`${r.ref_id}-${r.at}`} className="surt-mov surt-hist">
              <span className="icono" aria-hidden>📥</span>
              <span style={{ minWidth: 0 }}>
                <div className="titulo">{r.codigo}{r.proveedor_id && provs.get(r.proveedor_id) ? ` · ${provs.get(r.proveedor_id)}` : ''}</div>
                <div className="sub">{fechaHoraRecepcion(r.at)} · {r.items.length} material(es)</div>
                <div className="sub">Recibió {quienDe(r.actor_name, r.actor) || r.actor_name || r.actor || '—'}</div>
              </span>
              <span className="litros">{num(r.unidades)}</span>
              <div className="surt-hist-acciones">
                <button type="button" className="btn btn-grande" onClick={() => void abrirPdf(datosDe(r))}>📄 Ver PDF</button>
                <button type="button" className="btn btn-grande" onClick={() => void verWhatsapp(r)}>💬 WhatsApp</button>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}
