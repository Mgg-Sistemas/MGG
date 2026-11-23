/* ============================================================
   Mineral Group Guayana · Proveedores · selector de ubicación en el mapa (03/11/2026)
   Actualizado (18/11/2026):
   - Modo de visualización ampliado (maximizado / pantalla completa) para
     facilitar la ubicación cómoda y precisa de proveedores.
   - Opción de expandir altura inline (440px / 580px) y redimensionamiento
     vertical libre con ResizeObserver.
   - Controles de búsqueda integrados, centrado inteligente y atajo con Escape.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { EMPRESA_EMAIL } from '@/shared/lib/empresa';
import { toast } from '@/shared/ui/Toast';
import {
  buscarDireccion,
  coordsTxt,
  interpretarEntradaUbicacion,
  puntoValido,
  type PuntoMapa,
  type ResultadoGeo,
} from './ubicacionProveedor';

/** Centro de Puerto Ordaz (el mismo que usa Delivery). */
const CENTRO: [number, number] = [8.2869, -62.7467];

const PIN = L.divIcon({
  html: '<div style="font-size:30px;line-height:1;transform:translate(-50%,-100%);filter:drop-shadow(0 2px 2px rgba(0,0,0,.4))">📍</div>',
  className: 'prov-pin', iconSize: [0, 0], iconAnchor: [0, 0],
});

export function SelectorUbicacionMapa({ value, onChange, direccion }: {
  value: PuntoMapa | null;
  onChange: (p: PuntoMapa | null) => void;
  /** La dirección escrita en la ficha: se ofrece como texto a buscar. */
  direccion?: string | null;
}) {
  const contenedor = useRef<HTMLDivElement | null>(null);
  const mapa = useRef<L.Map | null>(null);
  const pin = useRef<L.Marker | null>(null);
  const cambiar = useRef(onChange);
  useEffect(() => { cambiar.current = onChange; }, [onChange]);

  const [q, setQ] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoGeo[]>([]);
  const [gpsOcupado, setGpsOcupado] = useState(false);

  // Interpretación inteligente del campo unificado (dirección física, coordenadas o URL)
  const interpretacion = useMemo(() => {
    return interpretarEntradaUbicacion(q || direccion);
  }, [q, direccion]);

  // Opciones de visualización y tamaño amplio
  const [maximizado, setMaximizado] = useState(false);
  const [altura, setAltura] = useState(440);

  // El mapa se crea una sola vez (el modal puede abrirse con el contenedor aún sin tamaño: invalidateSize).
  useEffect(() => {
    if (!contenedor.current || mapa.current) return;
    const m = L.map(contenedor.current, { center: value ? [value.lat, value.lng] : CENTRO, zoom: value ? 16 : 12 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => cambiar.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
    mapa.current = m;
    const t = setTimeout(() => m.invalidateSize(), 150);
    return () => {
      clearTimeout(t);
      m.remove();
      mapa.current = null;
      pin.current = null;
    };
    // Solo al montar: el valor inicial centra; después manda el efecto del pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ResizeObserver para redimensionamiento fluido del mapa
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !contenedor.current) return;
    const ro = new ResizeObserver(() => {
      mapa.current?.invalidateSize();
    });
    ro.observe(contenedor.current);
    return () => ro.disconnect();
  }, []);

  // Al alternar maximizado o cambiar altura: invalidar dimensiones y recentrar suavemente
  useEffect(() => {
    if (!mapa.current) return;
    const t1 = setTimeout(() => {
      mapa.current?.invalidateSize();
      if (value) {
        mapa.current?.setView([value.lat, value.lng], Math.max(mapa.current.getZoom(), 15));
      }
    }, 100);
    const t2 = setTimeout(() => {
      mapa.current?.invalidateSize();
    }, 300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [maximizado, altura, value]);

  // Tecla Escape para salir de pantalla completa / maximizado
  useEffect(() => {
    if (!maximizado) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMaximizado(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [maximizado]);

  // El pin sigue al valor (se arrastra para afinar).
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    if (!value) {
      pin.current?.remove();
      pin.current = null;
      return;
    }
    const ll = L.latLng(value.lat, value.lng);
    if (!pin.current) {
      pin.current = L.marker(ll, { icon: PIN, draggable: true, title: 'Arrastra para afinar' })
        .on('dragend', (e) => { const p = (e.target as L.Marker).getLatLng(); cambiar.current({ lat: p.lat, lng: p.lng }); })
        .addTo(m);
    } else {
      pin.current.setLatLng(ll);
    }
    if (!m.getBounds().contains(ll)) m.setView(ll, Math.max(m.getZoom(), 15));
  }, [value]);

  function elegir(r: ResultadoGeo) {
    setResultados([]);
    cambiar.current({ lat: r.lat, lng: r.lng });
    mapa.current?.setView([r.lat, r.lng], 16);
  }

  function manejarCambioTexto(nuevoTexto: string) {
    setQ(nuevoTexto);
    if (!nuevoTexto.trim()) return;

    // Si el usuario escribe o pega coordenadas o una URL con posición, ubicar y recentrar de inmediato
    const interp = interpretarEntradaUbicacion(nuevoTexto);
    if (interp.punto) {
      elegir({ nombre: coordsTxt(interp.punto), ...interp.punto });
    }
  }

  async function buscar() {
    const texto = q.trim() || (direccion ?? '').trim();
    if (!texto) {
      toast('Escribe la dirección, pega las coordenadas o la URL de Google Maps.', 'error');
      return;
    }

    const interp = interpretarEntradaUbicacion(texto);
    if (interp.punto) {
      elegir({ nombre: coordsTxt(interp.punto), ...interp.punto });
      toast(`📍 Ubicación fijada: ${coordsTxt(interp.punto)}`, 'success');
      return;
    }

    if (interp.esUrlCorta) {
      toast(
        'Enlace corto de Google Maps (maps.app.goo.gl): ábrelo en tu navegador y copia la URL completa con coordenadas o pega las coordenadas directas.',
        'info',
      );
      return;
    }

    setBuscando(true);
    try {
      const r = await buscarDireccion(texto, EMPRESA_EMAIL);
      setResultados(r);
      if (!r.length) {
        toast(
          'No se encontró esa dirección. Prueba con menos palabras (sector y ciudad), pega las coordenadas o el enlace de Google Maps.',
          'error',
        );
      } else if (r.length === 1) {
        elegir(r[0]);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo buscar la dirección.', 'error');
    } finally {
      setBuscando(false);
    }
  }

  function usarMiUbicacion() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { toast('Este navegador no permite leer la ubicación.', 'error'); return; }
    setGpsOcupado(true);
    navigator.geolocation.getCurrentPosition((g) => {
      setGpsOcupado(false);
      const p = puntoValido(g.coords.latitude, g.coords.longitude);
      if (!p) { toast('No se pudo leer la ubicación.', 'error'); return; }
      cambiar.current(p);
      mapa.current?.setView([p.lat, p.lng], 16);
      if (g.coords.accuracy > 100) toast(`Ubicación con poca precisión (± ${Math.round(g.coords.accuracy)} m): afina el pin en el mapa.`, 'info');
    }, (e) => {
      setGpsOcupado(false);
      toast(e.code === 1 ? 'El navegador no dio permiso de ubicación.' : 'No se pudo leer la ubicación de este equipo.', 'error');
    }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 });
  }

  return (
    <>
      {/* Backdrop oscuro cuando está maximizado */}
      {maximizado && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(3, 5, 8, 0.78)',
            backdropFilter: 'blur(5px)',
            zIndex: 10040,
          }}
          onClick={() => setMaximizado(false)}
        />
      )}

      <div
        style={
          maximizado
            ? {
                position: 'fixed',
                top: 14,
                bottom: 14,
                left: 14,
                right: 14,
                zIndex: 10050,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                boxShadow: '0 25px 60px rgba(0,0,0,0.85)',
                display: 'flex',
                flexDirection: 'column',
                padding: '1rem',
                gap: '.75rem',
                isolation: 'isolate',
              }
            : {
                display: 'grid',
                gap: '.5rem',
                position: 'relative',
              }
        }
      >
        {/* Cabecera ampliada (solo en modo maximizado) */}
        {maximizado && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem', paddingBottom: '.4rem', borderBottom: '1px solid var(--border)' }}>
            <div>
              <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '1.05rem' }}>
                <span>📍</span> Ubicación del Proveedor en el Mapa
              </h4>
              <p className="muted hint" style={{ margin: '2px 0 0', fontSize: '.78rem' }}>
                Haz clic en cualquier punto o arrastra el marcador 📍 para afinar la ubicación exacta del local para la ruta de Delivery.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              {value && (
                <span className="badge mono" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', fontWeight: 600, fontSize: '.78rem' }}>
                  📍 {coordsTxt(value)}
                </span>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setMaximizado(false)}
                title="Reducir al tamaño normal del formulario (Esc)"
              >
                🗗 Reducir mapa (Esc)
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setMaximizado(false)}
                title="Conservar ubicación y volver al formulario"
              >
                ✓ Listo / Volver
              </button>
            </div>
          </div>
        )}

        {/* Barra de Búsqueda y Controles de Tamaño */}
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <input
              className="input"
              style={{ width: '100%' }}
              value={q}
              onChange={(e) => manejarCambioTexto(e.target.value)}
              onPaste={(e) => {
                const pegado = e.clipboardData.getData('text');
                if (pegado) {
                  const interp = interpretarEntradaUbicacion(pegado);
                  if (interp.punto) {
                    elegir({ nombre: coordsTxt(interp.punto), ...interp.punto });
                    toast(`📍 Coordenadas reconocidas (${interp.tipo === 'url' ? 'URL' : 'GPS'}): ${coordsTxt(interp.punto)}`, 'success');
                  }
                }
              }}
              placeholder={direccion?.trim() ? `Buscar: ${direccion.trim()} (o pega coordenadas / URL)` : 'Dirección física, coordenadas (ej. 8.2869, -62.7467) o URL de Google Maps'}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void buscar(); } }}
              aria-label="Buscar dirección, coordenadas o URL de mapa"
            />
            {/* Feedback en tiempo real del campo unificado */}
            {q.trim() && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.74rem', padding: '1px 4px' }}>
                {interpretacion.tipo === 'coordenadas' && (
                  <span className="badge" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', padding: '2px 6px' }}>
                    ✓ Coordenadas detectadas: {coordsTxt(interpretacion.punto!)}
                  </span>
                )}
                {interpretacion.tipo === 'url' && interpretacion.punto && (
                  <span className="badge" style={{ background: 'rgba(56,189,248,0.15)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)', padding: '2px 6px' }}>
                    ✓ Enlace de mapa interpretado: {coordsTxt(interpretacion.punto!)}
                  </span>
                )}
                {interpretacion.tipo === 'url' && !interpretacion.punto && (
                  <span className="badge" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', padding: '2px 6px' }}>
                    🔗 {interpretacion.etiqueta}
                  </span>
                )}
                {interpretacion.tipo === 'direccion' && (
                  <span className="badge" style={{ background: 'rgba(148,163,184,0.12)', color: 'var(--text-muted, #94a3b8)', border: '1px solid var(--border)', padding: '2px 6px' }}>
                    🏢 Dirección física · Presiona [Buscar] o [Enter]
                  </span>
                )}
              </div>
            )}
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => void buscar()} disabled={buscando}>
            {buscando ? 'Buscando…' : '🔍 Buscar'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={usarMiUbicacion} disabled={gpsOcupado} title="Si estás en el local del proveedor">
            {gpsOcupado ? 'Leyendo GPS…' : '📡 Usar mi ubicación'}
          </button>

          {/* Botones de tamaño del mapa */}
          {!maximizado && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setAltura((h) => (h >= 560 ? 440 : 580))}
              title="Cambiar la altura visible del mapa dentro del formulario"
              style={{ fontSize: '.82rem' }}
            >
              ↕ {altura >= 560 ? 'Altura normal (440px)' : 'Más alto (580px)'}
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setMaximizado((m) => !m)}
            title={maximizado ? 'Reducir al tamaño del formulario (Esc)' : 'Agrandar mapa a pantalla completa'}
            style={{
              borderColor: 'var(--brand, #ff8a00)',
              color: 'var(--brand, #ff8a00)',
              fontWeight: 600,
            }}
          >
            {maximizado ? '🗗 Reducir mapa' : '⛶ Agrandar mapa'}
          </button>
        </div>

        {resultados.length > 1 && (
          <div style={{ display: 'grid', gap: '.25rem' }}>
            {resultados.map((r) => (
              <button
                key={`${r.lat},${r.lng}`}
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal' }}
                onClick={() => elegir(r)}
              >
                📍 {r.nombre}
              </button>
            ))}
          </div>
        )}

        {/* Contenedor del Mapa con tirador y botón flotante */}
        <div style={{ position: 'relative', flex: maximizado ? '1 1 auto' : undefined, width: '100%' }}>
          {/* Botón flotante directo dentro del mapa en la esquina superior derecha */}
          <button
            type="button"
            onClick={() => setMaximizado((m) => !m)}
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              zIndex: 1000,
              background: 'var(--surface-2, #1e293b)',
              color: 'var(--text, #f8fafc)',
              border: '1px solid var(--border, #334155)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: '.78rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '.35rem',
              boxShadow: '0 4px 10px rgba(0,0,0,0.4)',
              transition: 'background .15s ease',
            }}
            title={maximizado ? 'Reducir mapa a vista normal' : 'Agrandar mapa a vista amplia / pantalla completa'}
          >
            <span>{maximizado ? '🗗' : '⛶'}</span>
            <span>{maximizado ? 'Reducir' : 'Agrandar'}</span>
          </button>

          <div
            ref={contenedor}
            style={
              maximizado
                ? {
                    height: '100%',
                    width: '100%',
                    minHeight: 380,
                    borderRadius: 8,
                    overflow: 'hidden',
                    border: '1px solid var(--border)',
                    isolation: 'isolate',
                    position: 'relative',
                    background: 'var(--surface-3)',
                  }
                : {
                    height: altura,
                    minHeight: 340,
                    maxHeight: 750,
                    resize: 'vertical',
                    borderRadius: 8,
                    overflow: 'hidden',
                    border: '1px solid var(--border)',
                    isolation: 'isolate',
                    position: 'relative',
                    background: 'var(--surface-3)',
                  }
            }
          />
        </div>

        {/* Barra inferior de estado y coordenadas */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem', fontSize: '.82rem' }}>
          <div>
            {value ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontWeight: 600 }}>📍 {coordsTxt(value)}</span>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${value.lat.toFixed(6)},${value.lng.toFixed(6)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link"
                >
                  Ver en Google Maps ↗
                </a>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => cambiar.current(null)}
                  style={{ color: 'var(--danger, #ef4444)' }}
                >
                  ✕ Quitar ubicación
                </button>
              </div>
            ) : (
              <span className="muted">
                Sin ubicación fijada. Haz clic en el mapa, busca la dirección o usa tu ubicación actual.
              </span>
            )}
          </div>

          {!maximizado && (
            <span className="muted hint" style={{ fontSize: '.74rem' }}>
              💡 Tip: Puedes arrastrar la esquina inferior para cambiar la altura o presionar <strong>⛶ Agrandar mapa</strong>.
            </span>
          )}
        </div>
      </div>
    </>
  );
}
