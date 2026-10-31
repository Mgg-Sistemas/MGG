/* ============================================================
   MGG · Almacén · TRASLADO por la Solicitud de Pedido (30-10-2026)

   Regla de la administradora: si lo pedido lo tiene Los Pinos y se necesita en
   Matanza (o al revés), el almacenista de la sede que lo tiene HACE UN TRASLADO
   desde su teléfono y se lo envía a la otra; en el traslado queda dicho que el
   pedido lo tiene esa sede («stock completo» si da todo).

   Por renglón se elige de qué ficha y de qué almacén sale (los de nombre general
   no tienen ficha: se busca entre lo que hay en la sede) y cuánto. Al confirmar
   sale del almacén de origen y entra al principal de la sede destino (kardex
   `traslado_sp` con el código de la SP), y la base lo anota en la SP. El mensaje
   de WhatsApp lo muestra el padre (`onHecho`), solo con el botón.

   La misma pantalla sirve en la PC y en el teléfono (`variante`).
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import type { Orden, RenglonTrasladoSolicitud } from '@/shared/lib/types';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { DESTINOS_RECEPCION } from '@/modules/inventario/sectorizacion';
import { toast } from '@/shared/ui/Toast';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { parseMontoEs } from '@/shared/lib/montoEs';
import { fmtCant, mensajeTrasladoSolicitud, type RenglonPorTrasladar, type TrasladoDeSolicitud } from './revisionAlmacen';
import { productosConStockEnSede, registrarTrasladoSolicitud, type StockEnSede } from './revisionAlmacen.repository';
import { usePuedeRevisarAlmacen } from './RevisionSolicitudAlmacen';

interface Props {
  orden: Orden;
  traslado: TrasladoDeSolicitud;
  variante?: 'pc' | 'telefono';
  onCancel: () => void;
  /** Quedó hecho: el padre muestra el mensaje de WhatsApp. */
  onHecho: (actualizada: Orden, mensaje: string) => void;
}

interface Eleccion {
  /** `${productoId}|${almacen}` de lo que hay en la sede. */
  clave: string;
  cantidad: string;
  buscar: string;
}

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');
const claveDe = (s: Pick<StockEnSede, 'productoId' | 'almacen'>) => `${s.productoId}|${s.almacen}`;

/** Almacén principal de la sede que recibe (Matanza → «General»). */
export function almacenDestinoDeSede(sede: string): string | null {
  return DESTINOS_RECEPCION.find((d) => d.sede === sede)?.almacen ?? null;
}

/** La ficha que se propone: la del renglón (o la del mismo nombre) en el almacén que más tiene. */
function propuesta(r: RenglonPorTrasladar, stock: StockEnSede[]): string {
  const candidatos = stock.filter((s) => (r.productoId ? s.productoId === r.productoId : norm(s.nombre) === norm(r.nombre)));
  const alcanza = candidatos.filter((s) => s.stock >= r.cantidad);
  const mejor = [...(alcanza.length ? alcanza : candidatos)].sort((a, b) => b.stock - a.stock)[0];
  return mejor ? claveDe(mejor) : '';
}

export function TrasladoSolicitudAlmacen({ orden, traslado, variante = 'pc', onCancel, onHecho }: Props) {
  const telefono = variante === 'telefono';
  const { user } = useSession();
  const { appUser } = usePermissions();
  const canWrite = usePuedeRevisarAlmacen();
  const actor = user?.email ?? appUser?.email ?? 'almacen';
  const actorName = appUser?.nombre?.trim() || null;
  const destinoAlmacen = almacenDestinoDeSede(traslado.destino);

  const [stock, setStock] = useState<StockEnSede[] | null>(null);
  const [elecciones, setElecciones] = useState<Record<string, Eleccion>>({});
  const [nota, setNota] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [movidos, setMovidos] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let vivo = true;
    productosConStockEnSede(traslado.sede)
      .then((s) => {
        if (!vivo) return;
        setStock(s);
        setElecciones(Object.fromEntries(traslado.renglones.map((r) => [r.sku, {
          clave: propuesta(r, s), cantidad: String(r.cantidad).replace('.', ','), buscar: '',
        }])));
      })
      .catch((e) => { if (vivo) { setStock([]); toast(e instanceof Error ? e.message : 'No se pudo leer el stock de la sede', 'error'); } });
    return () => { vivo = false; };
  }, [traslado.sede, traslado.renglones]);

  const porClave = useMemo(() => new Map((stock ?? []).map((s) => [claveDe(s), s])), [stock]);

  /** Lo listo para mandar, o el primer problema. */
  const armado = useMemo((): { renglones: RenglonTrasladoSolicitud[]; problema: string | null } => {
    const renglones: RenglonTrasladoSolicitud[] = [];
    if (!destinoAlmacen) return { renglones, problema: `No hay almacén de recepción para ${traslado.etiquetaDestino}.` };
    for (const r of traslado.renglones) {
      const e = elecciones[r.sku];
      const s = e ? porClave.get(e.clave) : undefined;
      if (!s) return { renglones, problema: `Elegí de qué producto y almacén sale «${r.nombre}».` };
      const cant = parseMontoEs(e?.cantidad ?? '');
      if (!Number.isFinite(cant) || cant <= 0) return { renglones, problema: `Indicá cuánto se traslada de «${r.nombre}».` };
      if (cant > r.cantidad + 0.0001) return { renglones, problema: `De «${r.nombre}» ${traslado.etiqueta} entrega ${fmtCant(r.cantidad)}: no más.` };
      if (!movidos.has(r.sku) && cant > s.stock + 0.0001) return { renglones, problema: `En ${s.almacen} hay ${fmtCant(s.stock)} de ${s.nombre}: no alcanza para ${fmtCant(cant)}.` };
      if (s.almacen === destinoAlmacen) return { renglones, problema: `«${s.almacen}» ya es el almacén de ${traslado.etiquetaDestino}: elegí uno de ${traslado.etiqueta}.` };
      renglones.push({
        sku: r.sku, nombre: r.nombre, producto_id: s.productoId, producto_nombre: s.nombre,
        cantidad: cant, unidad: r.unidad || s.unidad, almacen_origen: s.almacen, almacen_destino: destinoAlmacen,
      });
    }
    return { renglones, problema: null };
  }, [traslado, elecciones, porClave, destinoAlmacen, movidos]);

  function cambiar(sku: string, patch: Partial<Eleccion>) {
    setElecciones((prev) => ({ ...prev, [sku]: { ...(prev[sku] ?? { clave: '', cantidad: '', buscar: '' }), ...patch } }));
  }

  async function trasladar() {
    setConfirmar(false);
    if (armado.problema) { toast(armado.problema, 'error'); return; }
    setGuardando(true);
    try {
      const actualizada = await registrarTrasladoSolicitud({
        orden, traslado, renglones: armado.renglones, nota: nota.trim() || null, actor, actorName,
        yaMovidos: movidos,
        onMovido: (sku) => setMovidos((prev) => new Set(prev).add(sku)),
      });
      toast(`Traslado de ${orden.codigo} a ${traslado.etiquetaDestino} registrado`, 'success');
      onHecho(actualizada, mensajeTrasladoSolicitud(orden, traslado, armado.renglones, {
        quien: actorName || actor, nota: nota.trim() || null,
      }));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo hacer el traslado', 'error');
    } finally {
      setGuardando(false);
    }
  }

  const btnTam = telefono ? 'btn-grande' : 'btn-sm';

  return (
    <div className="rev-almacen">
      <div className="card" style={{ padding: telefono ? '.8rem' : '1rem 1.1rem', marginBottom: '.75rem' }}>
        <div style={{ display: 'flex', gap: '.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong className="mono" style={{ fontSize: telefono ? '1.2rem' : '1.1rem' }}>🔁 {orden.codigo}</strong>
          <span className="badge info">{traslado.etiqueta} → {traslado.etiquetaDestino}</span>
          {traslado.completo && <span className="badge success">Stock completo</span>}
        </div>
        <div style={{ fontSize: '.9rem', marginTop: '.35rem' }}>
          📦 El pedido lo tiene <strong>{traslado.etiqueta}</strong>{traslado.completo ? <>: <strong>stock completo</strong></> : ' (una parte)'}.
          Se necesita en <strong>{traslado.etiquetaDestino}</strong>: entra al almacén <strong>{destinoAlmacen ?? '—'}</strong>.
        </div>
      </div>

      {!canWrite && (
        <div className="aviso warning sm" style={{ marginBottom: '.75rem' }}>
          <span className="aviso-icono">👁</span>
          <div>Tu rol solo puede ver. Para trasladar hace falta escritura en Inventario o en Salidas.</div>
        </div>
      )}

      {stock === null && <p className="muted">Leyendo el stock de {traslado.etiqueta}…</p>}

      {stock !== null && traslado.renglones.map((r) => {
        const e = elecciones[r.sku] ?? { clave: '', cantidad: '', buscar: '' };
        const t = norm(e.buscar);
        const sugeridos = stock.filter((s) => (r.productoId ? s.productoId === r.productoId : norm(s.nombre) === norm(r.nombre)));
        const opciones = t
          ? stock.filter((s) => norm(`${s.nombre} ${s.sku}`).includes(t)).slice(0, 60)
          : sugeridos;
        const elegido = porClave.get(e.clave);
        const lista = elegido && !opciones.some((o) => claveDe(o) === e.clave) ? [elegido, ...opciones] : opciones;
        return (
          <div key={r.sku} className="card" style={{ padding: telefono ? '.75rem' : '.8rem 1rem', marginBottom: '.6rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: telefono ? '1.02rem' : '.95rem' }}>{r.nombre}</strong>
              <span className="mono">{fmtCant(r.cantidad)} {r.unidad}</span>
            </div>
            {movidos.has(r.sku) && <div className="badge success" style={{ marginTop: '.3rem' }}>✓ Ya trasladado</div>}
            {!r.productoId && (
              <input className={`input ${telefono ? 'surt-input' : ''}`} type="search" value={e.buscar}
                placeholder="🔎 Buscar en el stock de la sede (nombre o SKU)"
                onChange={(ev) => cambiar(r.sku, { buscar: ev.target.value })}
                style={{ width: '100%', marginTop: '.45rem' }} />
            )}
            <label className="muted" style={{ display: 'block', fontSize: '.78rem', marginTop: '.45rem' }}>Sale de</label>
            <select className={`select ${telefono ? 'surt-input' : ''}`} value={e.clave} disabled={movidos.has(r.sku)}
              onChange={(ev) => cambiar(r.sku, { clave: ev.target.value })} style={{ width: '100%' }}>
              <option value="">{lista.length ? '— Elegí producto y almacén —' : r.productoId ? `Sin stock en ${traslado.etiqueta}` : 'Buscá el producto arriba'}</option>
              {lista.map((s) => (
                <option key={claveDe(s)} value={claveDe(s)}>
                  {s.nombre} · {s.almacen} · hay {fmtCant(s.stock)} {s.unidad}
                </option>
              ))}
            </select>
            <label className="muted" style={{ display: 'block', fontSize: '.78rem', marginTop: '.45rem' }}>
              Cuánto se traslada ({elegido?.unidad || r.unidad || 'und'})
            </label>
            <input className={`input mono ${telefono ? 'surt-litros' : ''}`} inputMode="decimal" value={e.cantidad}
              disabled={movidos.has(r.sku)}
              onChange={(ev) => cambiar(r.sku, { cantidad: ev.target.value })} style={{ width: telefono ? '100%' : 160 }} />
          </div>
        );
      })}

      <label className="muted" style={{ display: 'block', fontSize: '.8rem', margin: '.2rem 0 .25rem' }}>Nota (opcional)</label>
      <input className={`input ${telefono ? 'surt-input' : ''}`} value={nota} onChange={(e) => setNota(e.target.value)}
        placeholder="Ej.: va en la camioneta de las 2 pm" style={{ width: '100%', marginBottom: '.75rem' }} />

      {armado.problema && stock !== null && (
        <div className="aviso warning sm" style={{ marginBottom: '.6rem' }}>
          <span className="aviso-icono">⚠</span><div>{armado.problema}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        <button type="button" className={`btn btn-primary ${btnTam}`} disabled={!canWrite || guardando || !!armado.problema || stock === null}
          onClick={() => setConfirmar(true)} style={telefono ? { flex: 1 } : undefined}>
          {guardando ? 'Trasladando…' : `🔁 Trasladar a ${traslado.etiquetaDestino}`}
        </button>
        <button type="button" className={`btn btn-ghost ${btnTam}`} onClick={onCancel} disabled={guardando}>Volver</button>
      </div>

      {confirmar && (
        <ConfirmDialog
          title={`¿Trasladar a ${traslado.etiquetaDestino}?`}
          message={`Sale de ${traslado.etiqueta} y entra a ${destinoAlmacen}: ${armado.renglones.map((r) => `${r.nombre} ${fmtCant(r.cantidad)}`).join(', ')}. Queda anotado en ${orden.codigo}.`}
          confirmText="Sí, trasladar"
          success
          onConfirm={() => void trasladar()}
          onCancel={() => setConfirmar(false)}
        />
      )}
    </div>
  );
}
