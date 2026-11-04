/* ============================================================
   MGG · Delivery · teléfono · mapa y ruta (03-11-2026)

   Pedido de la administradora, «tipo Yummy o Ridery»:
   · Al abrir la pantalla el delivery ve dónde está y el proveedor más
     cercano entre las OC pagadas por tomar (con la distancia).
   · Con un pedido aceptado ve la ruta: él → proveedor → almacén (si ya
     subió las fotos al recibir, directo al almacén), con la distancia y el
     tiempo, y los botones para seguirla en Google Maps o Waze.
   · Si el proveedor de su pedido no está ubicado, lo marca él (tocando el
     mapa, con su GPS o pegando las coordenadas) y queda guardado para las
     próximas veces.
   La ruta se pide al servidor público de OSRM; si no responde, se dibuja la
   línea recta entre las paradas.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { toast } from '@/shared/ui/Toast';
import { MapaSelector } from '@/shared/ui/MapaSelector';
import { crearMapaBase, iconoPildora, iconoYo } from '@/shared/lib/mapaBase';
import { esRetiro, ocDe, type PedidoDelivery } from './delivery';
import { distanciaMetros } from './deliveryMovil';
import {
  debeRecalcularRuta, distanciaTxt, googleMapsHref, marcaRuta, paradasDelPedido, proveedoresCercanos, proximaParada,
  puntoDeDestino, puntosRuta, tiempoRutaTxt, wazeHref, type DestinosDelivery, type MarcaRuta, type Punto, type Ruta,
} from './deliveryRutas';
import { calcularRuta, ubicarProveedor } from './delivery.repository';

/** Mi posición mientras la pantalla está abierta (solo en este teléfono; compartirla es aparte). */
export function useMiPosicion(): { yo: Punto | null; precision: number | null; error: string | null } {
  const [yo, setYo] = useState<Punto | null>(null);
  const [precision, setPrecision] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setError('Este teléfono no permite leer la ubicación.'); return; }
    const id = navigator.geolocation.watchPosition((pos) => {
      setYo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setPrecision(pos.coords.accuracy ?? null);
      setError(null);
    }, (e) => setError(e.code === 1 ? 'Activa el permiso de ubicación para ver tu posición y la ruta.' : 'No se pudo leer tu ubicación.'),
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 });
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return { yo, precision, error };
}

export function PanelRutaMovil({ yo, gpsError, libres, enCurso, provPts, destinos, canWrite, onUbicado }: {
  yo: Punto | null;
  gpsError: string | null;
  /** Pedidos por tomar (para el proveedor más cercano). */
  libres: PedidoDelivery[];
  /** Mi pedido en curso, si hay. */
  enCurso: PedidoDelivery | null;
  provPts: Map<string, Punto>;
  destinos: DestinosDelivery;
  canWrite: boolean;
  onUbicado: () => void;
}) {
  const contenedor = useRef<HTMLDivElement | null>(null);
  const mapa = useRef<L.Map | null>(null);
  const capa = useRef<L.LayerGroup | null>(null);
  const encuadrado = useRef<string>('');
  const [ruta, setRuta] = useState<Ruta | null>(null);
  const marca = useRef<MarcaRuta | null>(null);
  const [ubicar, setUbicar] = useState(false);

  const paradas = useMemo(() => (enCurso ? paradasDelPedido(enCurso, provPts, destinos) : null), [enCurso, provPts, destinos]);
  const cercanos = useMemo(() => (enCurso ? [] : proveedoresCercanos(yo, libres, provPts)), [enCurso, yo, libres, provPts]);
  const proxima = paradas ? proximaParada(paradas) : null;
  const faltaUbicarProveedor = !!enCurso && !esRetiro(enCurso) && !!enCurso.proveedor_id && !provPts.has(enCurso.proveedor_id);

  // La ruta del pedido en curso (sin pedirla de más: ver debeRecalcularRuta).
  useEffect(() => {
    if (!paradas) { setRuta(null); marca.current = null; return; }
    const ahora = marcaRuta(yo, paradas, Date.now());
    if (!debeRecalcularRuta(marca.current, ahora)) return;
    marca.current = ahora;
    let vivo = true;
    void calcularRuta(puntosRuta(yo, paradas)).then((r) => { if (vivo) setRuta(r); });
    return () => { vivo = false; };
  }, [yo, paradas]);

  useEffect(() => {
    if (!contenedor.current || mapa.current) return;
    const m = crearMapaBase(contenedor.current, {});
    mapa.current = m;
    capa.current = L.layerGroup().addTo(m);
    const t = setTimeout(() => m.invalidateSize(), 150);
    return () => { clearTimeout(t); m.remove(); mapa.current = null; capa.current = null; };
  }, []);

  // Dibuja: yo, las paradas (o los proveedores cercanos) y la ruta.
  useEffect(() => {
    const m = mapa.current;
    const g = capa.current;
    if (!m || !g) return;
    g.clearLayers();
    const pts: L.LatLngExpression[] = [];
    if (yo) { L.marker([yo.lat, yo.lng], { icon: iconoYo() }).bindPopup('Tú estás aquí').addTo(g); pts.push([yo.lat, yo.lng]); }
    if (enCurso && paradas) {
      if (paradas.origen && !paradas.recogido) {
        L.marker([paradas.origen.lat, paradas.origen.lng], { icon: iconoPildora(esRetiro(enCurso) ? '🏬' : '🏭', esRetiro(enCurso) ? 'Retiro' : (enCurso.proveedor_nombre ?? 'Proveedor'), '#ea580c') }).addTo(g);
        pts.push([paradas.origen.lat, paradas.origen.lng]);
      }
      if (paradas.destino) {
        L.marker([paradas.destino.lat, paradas.destino.lng], { icon: iconoPildora('📦', paradas.destinoClave ?? 'Almacén', '#16a34a') }).addTo(g);
        pts.push([paradas.destino.lat, paradas.destino.lng]);
      }
      if (ruta && ruta.linea.length > 1) {
        L.polyline(ruta.linea.map((p) => [p.lat, p.lng] as [number, number]), {
          color: '#2563eb', weight: 5, opacity: 0.85, dashArray: ruta.fuente === 'recta' ? '8 8' : undefined,
        }).addTo(g);
      }
    } else {
      for (const c of cercanos.slice(0, 8)) {
        L.marker([c.punto.lat, c.punto.lng], { icon: iconoPildora('🏭', `${c.nombre} · ${distanciaTxt(c.metros)}`, '#ea580c', { tenue: c !== cercanos[0] }) }).addTo(g);
      }
      if (cercanos[0]) pts.push([cercanos[0].punto.lat, cercanos[0].punto.lng]);
      for (const k of ['LOS PINOS', 'MATANZA'] as const) {
        const d = puntoDeDestino(destinos[k]);
        if (d) L.marker([d.lat, d.lng], { icon: iconoPildora('📦', k, '#16a34a', { tenue: true }) }).addTo(g);
      }
    }
    // Encuadra cuando cambia lo que se muestra (no en cada paso del GPS).
    const clave = `${enCurso ? ocDe(enCurso) : 'libre'}|${paradas?.recogido ? 1 : 0}|${cercanos[0]?.proveedor_id ?? ''}|${yo ? 1 : 0}|${ruta ? 1 : 0}`;
    if (clave !== encuadrado.current && pts.length) {
      encuadrado.current = clave;
      if (pts.length === 1) m.setView(pts[0], 15);
      else m.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 });
    }
  }, [yo, enCurso, paradas, ruta, cercanos, destinos]);

  // Google Maps lleva la ruta completa (el proveedor como parada); Waze va a la próxima parada.
  const gmDestino = paradas?.destino ?? paradas?.origen ?? null;
  const gmParadas = paradas && !paradas.recogido && paradas.origen && paradas.destino ? [paradas.origen] : [];

  return (
    <section className="surt-form" style={{ gap: '.5rem' }} aria-label="Mapa y ruta">
      <div className="surt-form-titulo">
        <span className="icono" aria-hidden>🗺</span>
        <strong>{enCurso ? `Ruta · ${ocDe(enCurso)}` : 'Tu ubicación y el proveedor más cercano'}</strong>
      </div>
      {gpsError && <div className="aviso warning sm"><span className="aviso-icono">📍</span><div>{gpsError}</div></div>}

      {enCurso && paradas && (
        <div className="muted" style={{ fontSize: '.88rem' }}>
          {paradas.recogido
            ? <>✅ Ya recogido · ahora al almacén <strong>{paradas.destinoClave ?? enCurso.almacen_destino ?? ''}</strong></>
            : <>Primero a <strong>{esRetiro(enCurso) ? 'Los Pinos (retiro)' : enCurso.proveedor_nombre ?? 'el proveedor'}</strong>, después al almacén <strong>{paradas.destinoClave ?? '—'}</strong>. Al subir las fotos al recibir, la ruta sigue al almacén.</>}
          {ruta && <div style={{ marginTop: '.2rem' }}>🛣 <strong>{distanciaTxt(ruta.metros)}</strong>{ruta.segundos != null ? ` · ⏱ ${tiempoRutaTxt(ruta.segundos)}` : ''}{ruta.fuente === 'recta' ? ' · en línea recta (sin ruta por calle)' : ''}</div>}
        </div>
      )}

      {!enCurso && (
        cercanos.length ? (
          <div style={{ fontSize: '.9rem' }}>
            🏭 Más cercano: <strong>{cercanos[0].nombre}</strong> · {distanciaTxt(cercanos[0].metros)}
            {cercanos[0].pedidos > 1 ? ` · ${cercanos[0].pedidos} pedidos` : ''}
            {cercanos.length > 1 && (
              <div className="muted" style={{ fontSize: '.8rem', marginTop: '.2rem' }}>
                Luego: {cercanos.slice(1, 4).map((c) => `${c.nombre} (${distanciaTxt(c.metros)})`).join(' · ')}
              </div>
            )}
          </div>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>
            {!yo ? 'Buscando tu ubicación…' : libres.length ? 'Los proveedores de los pedidos por tomar todavía no están ubicados en el mapa.' : 'No hay pedidos por tomar ahora.'}
          </p>
        )
      )}

      <div ref={contenedor} style={{ height: 260, borderRadius: 10, overflow: 'hidden', isolation: 'isolate', position: 'relative' }} />

      {enCurso && gmDestino && proxima && (
        <div className="surt-grid2">
          <a className="btn btn-primary btn-grande" href={googleMapsHref(gmDestino, gmParadas, yo)}
            target="_blank" rel="noopener noreferrer">🧭 Google Maps</a>
          <a className="btn btn-ghost btn-grande" href={wazeHref(proxima)} target="_blank" rel="noopener noreferrer">🚗 Waze</a>
        </div>
      )}
      {faltaUbicarProveedor && canWrite && (
        <button type="button" className="btn btn-ghost btn-grande" onClick={() => setUbicar(true)}>
          📍 Ubicar a {enCurso?.proveedor_nombre ?? 'el proveedor'} (queda guardado)
        </button>
      )}
      {enCurso && paradas && !paradas.destino && (
        <small className="muted">El almacén de entrega todavía no está ubicado en el mapa: lo ubica la oficina desde la PC.</small>
      )}

      {ubicar && enCurso?.proveedor_id && (
        <MapaSelector titulo={`📍 Ubicar · ${enCurso.proveedor_nombre ?? 'Proveedor'}`}
          subtitulo="Toca el mapa, usa tu ubicación o pega las coordenadas. Queda guardado para los próximos pedidos."
          inicial={null} centro={yo} onCerrar={() => setUbicar(false)}
          onGuardar={async (p) => {
            if (!p || !enCurso.proveedor_id) return;
            try {
              await ubicarProveedor(enCurso.proveedor_id, p);
              toast('Proveedor ubicado.', 'success');
              setUbicar(false);
              onUbicado();
            } catch (e) {
              toast(e instanceof Error ? e.message : 'No se pudo guardar la ubicación', 'error');
            }
          }} />
      )}
    </section>
  );
}

/** Metros desde mi posición al punto donde se busca el pedido (para ordenar por cercanía). */
export function metrosAlPedido(yo: Punto | null, p: PedidoDelivery, provPts: Map<string, Punto>, destinos: DestinosDelivery): number | null {
  if (!yo) return null;
  const punto = esRetiro(p) ? puntoDeDestino(destinos['LOS PINOS']) : (p.proveedor_id ? provPts.get(p.proveedor_id) ?? null : null);
  return punto ? distanciaMetros(yo, punto) : null;
}
