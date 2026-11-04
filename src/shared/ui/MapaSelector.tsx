/* ============================================================
   MGG · Marcar un lugar en el mapa (03-11-2026)

   Ventana con un mapa: se toca el mapa o se arrastra el alfiler para
   marcar dónde queda (un proveedor, un almacén). «📍 Usar mi ubicación»
   pide el GPS del equipo solo al tocar el botón. Nada se guarda hasta
   «Guardar ubicación».
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Modal } from '@/shared/ui/Modal';
import { CENTRO_PUERTO_ORDAZ, crearMapaBase, iconoAlfiler } from '@/shared/lib/mapaBase';
import { leerCoordenadas } from '@/shared/lib/coordenadas';

export interface PuntoMapa { lat: number; lng: number }

const fmt = (n: number) => n.toFixed(6);

/** Busca una dirección escrita en OpenStreetMap (Nominatim), cerca de Ciudad Guayana. Null si no la encuentra. */
async function buscarDireccion(texto: string): Promise<PuntoMapa | null> {
  const q = texto.trim();
  if (q.length < 6) return null;
  const params = new URLSearchParams({ format: 'json', limit: '1', countrycodes: 've', q, viewbox: '-63.2,8.6,-62.3,7.9', bounded: '0' });
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, { headers: { 'Accept-Language': 'es' } });
    if (!r.ok) return null;
    const j = await r.json() as Array<{ lat?: string; lon?: string }>;
    const lat = Number(j[0]?.lat); const lng = Number(j[0]?.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch { return null; }
}

export function MapaSelector({ titulo, subtitulo, inicial, centro, permitirQuitar, onCerrar, onGuardar }: {
  titulo: string;
  subtitulo?: string;
  /** Ubicación ya guardada (el alfiler arranca ahí). */
  inicial: PuntoMapa | null;
  /** Dónde centrar si no hay ubicación (por defecto Puerto Ordaz). */
  centro?: PuntoMapa | null;
  /** Muestra «Quitar ubicación» (guarda null). */
  permitirQuitar?: boolean;
  onCerrar: () => void;
  onGuardar: (p: PuntoMapa | null) => void | Promise<void>;
}) {
  const contenedor = useRef<HTMLDivElement | null>(null);
  const mapa = useRef<L.Map | null>(null);
  const alfiler = useRef<L.Marker | null>(null);
  const [punto, setPunto] = useState<PuntoMapa | null>(inicial);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // Mueve (o crea) el alfiler; arrastrarlo también cambia el punto.
  const ponerAlfiler = useRef((p: PuntoMapa) => {
    const m = mapa.current;
    if (!m) return;
    if (!alfiler.current) {
      alfiler.current = L.marker([p.lat, p.lng], { icon: iconoAlfiler(), draggable: true, autoPan: true }).addTo(m);
      alfiler.current.on('dragend', () => {
        const ll = alfiler.current!.getLatLng();
        setPunto({ lat: ll.lat, lng: ll.lng });
      });
    } else alfiler.current.setLatLng([p.lat, p.lng]);
    setPunto(p);
  });

  useEffect(() => {
    if (!contenedor.current || mapa.current) return;
    const base = inicial ?? centro ?? null;
    const m = crearMapaBase(contenedor.current, {
      centro: base ? [base.lat, base.lng] : CENTRO_PUERTO_ORDAZ, zoom: inicial ? 17 : base ? 15 : 13,
    });
    mapa.current = m;
    if (inicial) ponerAlfiler.current(inicial);
    m.on('click', (e: L.LeafletMouseEvent) => ponerAlfiler.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
    const t = setTimeout(() => m.invalidateSize(), 150);
    return () => { clearTimeout(t); m.remove(); mapa.current = null; alfiler.current = null; };
    // El mapa se crea una sola vez, con la ubicación con que abrió la ventana.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function usarMiUbicacion() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setAviso('Este equipo no permite leer la ubicación.'); return; }
    setBuscando(true);
    setAviso(null);
    navigator.geolocation.getCurrentPosition((pos) => {
      setBuscando(false);
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      ponerAlfiler.current(p);
      mapa.current?.setView([p.lat, p.lng], 17);
      if (pos.coords.accuracy > 100) setAviso(`Ubicación con poca precisión (± ${Math.round(pos.coords.accuracy)} m): ajusta el alfiler si hace falta.`);
    }, (e) => {
      setBuscando(false);
      setAviso(e.code === 1 ? 'El navegador no dio permiso de ubicación.' : 'No se pudo leer la ubicación de este equipo.');
    }, { enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 });
  }

  const [coords, setCoords] = useState('');
  // 04-11-2026: coordenadas, enlace de Google, código Plus («77V8+J6F, …») o, si no, la
  // dirección escrita, que se busca en OpenStreetMap (solo al tocar el botón).
  async function irACoordenadas() {
    const p = leerCoordenadas(coords) ?? await buscarDireccion(coords);
    if (!p) {
      setAviso('No se encontró ese lugar. Pega las coordenadas («8.2869, -62.7467»), el enlace o el código Plus de Google Maps («77V8+J6F»), o toca el mapa.');
      return;
    }
    setAviso(null);
    ponerAlfiler.current(p);
    mapa.current?.setView([p.lat, p.lng], 17);
  }

  async function guardar(p: PuntoMapa | null) {
    setGuardando(true);
    try { await onGuardar(p); } finally { setGuardando(false); }
  }

  return (
    <Modal title={titulo} size="lg" onClose={onCerrar} minimizable={false}
      footer={(
        <>
          {permitirQuitar && inicial && (
            <button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)', marginRight: 'auto' }}
              disabled={guardando} onClick={() => void guardar(null)}>Quitar ubicación</button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={guardando || !punto} onClick={() => void guardar(punto)}>
            {guardando ? 'Guardando…' : '📍 Guardar ubicación'}
          </button>
        </>
      )}>
      {subtitulo && <p className="muted" style={{ margin: '0 0 .5rem' }}>{subtitulo}</p>}
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.5rem' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={usarMiUbicacion} disabled={buscando}>
          {buscando ? 'Buscando…' : '📍 Usar mi ubicación'}
        </button>
        <span className="muted mono" style={{ fontSize: '.8rem' }}>
          {punto ? `${fmt(punto.lat)}, ${fmt(punto.lng)}` : 'Toca el mapa para poner el alfiler.'}
        </span>
      </div>
      {/* 03-11-2026: también por coordenadas, escritas o pegadas de Google Maps. */}
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.5rem' }}>
        <input className="input" style={{ flex: '1 1 260px' }} value={coords} onChange={(e) => setCoords(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void irACoordenadas(); } }}
          placeholder="Coordenadas, enlace o código Plus de Google Maps (77V8+J6F), o la dirección" aria-label="Coordenadas" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void irACoordenadas(); }} disabled={!coords.trim()}>Ir</button>
      </div>
      {aviso && <div className="aviso warning sm" style={{ marginBottom: '.5rem' }}><span className="aviso-icono">⚠</span><div>{aviso}</div></div>}
      {/* isolation: los paneles de Leaflet (z-index 400–1000) no se montan sobre las ventanas del sistema. */}
      <div ref={contenedor} style={{ height: 'min(60vh, 460px)', minHeight: 280, borderRadius: 10, overflow: 'hidden', isolation: 'isolate', position: 'relative' }} />
      <p className="hint muted" style={{ margin: '.4rem 0 0', fontSize: '.8rem' }}>
        Toca el mapa o arrastra el alfiler hasta la puerta del lugar. Usa la capa «Satelital» (arriba a la derecha) para ubicarte mejor.
      </p>
    </Modal>
  );
}
