/* ============================================================
   MGG · Delivery · Mapa del Conductor / Repartidor
   Lienzo completo interactivo con OpenStreetMap y Esri Satelital.
   Modo Navegación activa (estilo Uber / Ridery / Yummy) con
   vehículo que avanza en la calzada, orientación de rumbo,
   flujo dinámico de la ruta y auto-seguimiento suave.
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { PUERTO_ORDAZ } from './delivery';
import { escaparHtml } from './deliveryPanel';
import { distanciaTxt, type ParadaRuta, type PuntoMapa, type RutaCalculada } from './deliveryRutas';
import type { PosicionGps } from './usePosicionGps';

export interface DestinoMapa {
  clave: string;
  nombre: string;
  punto: PuntoMapa;
  metros: number | null;
  cercano: boolean;
}

function iconoConductor(icono = '🛵', rumbo?: number | null): L.DivIcon {
  const tieneRumbo = rumbo != null && Number.isFinite(rumbo);
  const rotacion = tieneRumbo ? `transform: rotate(${Math.round(rumbo)}deg);` : '';
  const html = `
    <div class="dlv-yo-wrap">
      <div class="dlv-yo-radar"></div>
      <div class="dlv-yo-pin" style="${rotacion}">
        ${tieneRumbo ? '<div class="dlv-yo-rumbo"></div>' : ''}
        ${icono}
      </div>
    </div>
  `;
  return L.divIcon({ html, className: 'dlv-yo-divicon', iconSize: [44, 44], iconAnchor: [22, 22] });
}

function chipDestino(html: string, fondo: string, borde: string): L.DivIcon {
  const h = `<div class="dlv-map-chip" style="background:${fondo};border-color:${borde};">${html}</div>`;
  return L.divIcon({ html: h, className: 'dlv-chip-wrap', iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -16] });
}

const corto = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function MapaMotorizado({
  yo,
  destinos,
  losPinos,
  ruta,
  iconoVehiculo = '🛵',
  onElegir,
}: {
  yo: PosicionGps | null;
  destinos: DestinoMapa[];
  losPinos: PuntoMapa | null;
  ruta: { ruta: RutaCalculada | null; paradas: ParadaRuta[] } | null;
  iconoVehiculo?: string;
  onElegir?: (clave: string) => void;
}) {
  const contenedor = useRef<HTMLDivElement | null>(null);
  const mapa = useRef<L.Map | null>(null);
  const capaDestinos = useRef<L.LayerGroup | null>(null);
  const capaRuta = useRef<L.LayerGroup | null>(null);
  const capaBaliza = useRef<L.LayerGroup | null>(null);
  const yoMarker = useRef<L.Marker | null>(null);
  const yoCirculo = useRef<L.Circle | null>(null);
  const centrado = useRef(false);
  const [autoSeguir, setAutoSeguir] = useState(true);
  const elegir = useRef(onElegir);
  useEffect(() => { elegir.current = onElegir; }, [onElegir]);

  // Inicializar mapa Leaflet con capas oficiales (Calles OSM y Esri Satelital)
  useEffect(() => {
    if (!contenedor.current || mapa.current) return;
    const m = L.map(contenedor.current, {
      center: PUERTO_ORDAZ,
      zoom: 13,
      zoomControl: false,
      attributionControl: false,
    });

    const calles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    });
    const satelital = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Imágenes &copy; Esri',
    });
    calles.addTo(m);
    L.control.layers({ Calles: calles, Satelital: satelital }, undefined, { position: 'topright' }).addTo(m);

    capaRuta.current = L.layerGroup().addTo(m);
    capaBaliza.current = L.layerGroup().addTo(m);
    capaDestinos.current = L.layerGroup().addTo(m);
    mapa.current = m;

    // Pausar auto-seguimiento si el conductor arrastra el mapa manualmente
    m.on('dragstart', () => setAutoSeguir(false));

    const t = setTimeout(() => m.invalidateSize(), 200);
    return () => {
      clearTimeout(t);
      m.remove();
      mapa.current = null;
      capaDestinos.current = null;
      capaRuta.current = null;
      capaBaliza.current = null;
      yoMarker.current = null;
      yoCirculo.current = null;
    };
  }, []);

  // Posición del conductor en vivo y modo navegación activa
  useEffect(() => {
    const m = mapa.current;
    if (!m || !yo) return;
    const ll = L.latLng(yo.lat, yo.lng);
    const radio = Math.min(Math.max(yo.precision ?? 0, 8), 600);

    if (!yoMarker.current) {
      yoCirculo.current = L.circle(ll, {
        radius: radio,
        color: '#0284c7',
        weight: 1,
        fillColor: '#38bdf8',
        fillOpacity: 0.14,
        interactive: false,
      }).addTo(m);

      yoMarker.current = L.marker(ll, {
        icon: iconoConductor(iconoVehiculo, yo.rumbo),
        zIndexOffset: 1200,
      }).addTo(m);
    } else {
      yoMarker.current.setLatLng(ll);
      yoMarker.current.setIcon(iconoConductor(iconoVehiculo, yo.rumbo));
      yoCirculo.current?.setLatLng(ll).setRadius(radio);
    }

    // Auto-seguimiento: en navegación centra suavemente en el vehículo
    if (autoSeguir) {
      const zoomActual = m.getZoom();
      const zoomObjetivo = Math.max(zoomActual, 16);
      if (!centrado.current) {
        centrado.current = true;
        m.setView(ll, zoomObjetivo, { animate: true });
      } else {
        m.panTo(ll, { animate: true, duration: 0.8 });
      }
    }
  }, [yo, autoSeguir, iconoVehiculo]);

  // Proveedores por tomar y almacén Los Pinos
  const claveDestinos = destinos.map((d) => `${d.clave}:${d.punto.lat},${d.punto.lng}:${d.cercano ? 1 : 0}:${Math.round((d.metros ?? -1) / 50)}`).join('|')
    + `|pinos:${losPinos ? `${losPinos.lat},${losPinos.lng}` : '-'}`;
  const destinosRef = useRef(destinos);
  useEffect(() => { destinosRef.current = destinos; });

  useEffect(() => {
    const g = capaDestinos.current;
    if (!g) return;
    g.clearLayers();

    for (const d of destinosRef.current) {
      const dist = d.metros != null ? ` · ${distanciaTxt(d.metros)}` : '';
      const txt = `<span class="dlv-chip-icon">🏭</span><strong>${escaparHtml(corto(d.nombre))}</strong><span class="dlv-chip-dist">${escaparHtml(dist)}</span>`;
      const fondo = d.cercano ? 'rgba(5, 150, 105, 0.95)' : 'rgba(30, 41, 59, 0.92)';
      const borde = d.cercano ? '#10b981' : '#f59e0b';

      L.marker([d.punto.lat, d.punto.lng], {
        icon: chipDestino(txt, fondo, borde),
        zIndexOffset: d.cercano ? 950 : 800,
      })
        .on('click', () => elegir.current?.(d.clave))
        .addTo(g);
    }

    if (losPinos) {
      const txtPinos = `<span class="dlv-chip-icon">🏬</span><strong>Almacén Los Pinos</strong>`;
      L.marker([losPinos.lat, losPinos.lng], {
        icon: chipDestino(txtPinos, 'rgba(109, 40, 217, 0.92)', '#8b5cf6'),
        zIndexOffset: 700,
      }).addTo(g);
    }
  }, [claveDestinos, losPinos]);

  // Trazado de ruta óptima con animación de avance hacia el destino (Uber / Ridery)
  useEffect(() => {
    const g = capaRuta.current;
    const gb = capaBaliza.current;
    const m = mapa.current;
    if (!g || !m) return;
    g.clearLayers();
    gb?.clearLayers();
    if (!ruta?.ruta || ruta.ruta.linea.length < 2) return;

    const recta = ruta.ruta.fuente === 'recta';

    // Línea de soporte / resplandor vial
    L.polyline(ruta.ruta.linea, {
      color: recta ? '#64748b' : '#0284c7',
      weight: 8,
      opacity: 0.35,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
    }).addTo(g);

    // Línea activa con animación continua de flujo hacia el destino
    const linea = L.polyline(ruta.ruta.linea, {
      color: recta ? '#94a3b8' : '#38bdf8',
      weight: 5,
      opacity: 0.95,
      className: recta ? undefined : 'dlv-ruta-navegacion-animada',
      dashArray: recta ? '8 8' : undefined,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
    }).addTo(g);

    ruta.paradas.forEach((p, i) => {
      if (p.tipo === 'yo') return;
      const esEntrega = p.tipo === 'entrega';
      const icono = esEntrega ? '🏬' : '📦';
      const colorBorde = esEntrega ? '#10b981' : '#38bdf8';
      const colorFondo = esEntrega ? 'rgba(6, 78, 59, 0.95)' : 'rgba(15, 23, 42, 0.95)';
      const rotulo = `<span class="dlv-chip-step">${i}</span><span>${icono} ${escaparHtml(corto(p.nombre))}</span>`;

      L.marker([p.punto.lat, p.punto.lng], {
        icon: chipDestino(rotulo, colorFondo, colorBorde),
        zIndexOffset: 1000,
      }).addTo(g);
    });

    if (!autoSeguir) {
      m.fitBounds(linea.getBounds(), { padding: [60, 60], maxZoom: 16 });
    }
  }, [ruta, autoSeguir]);

  const centrarEnMi = () => {
    setAutoSeguir(true);
    if (mapa.current && yo) {
      mapa.current.setView([yo.lat, yo.lng], Math.max(mapa.current.getZoom(), 16), { animate: true });
    }
  };

  const verTodo = () => {
    setAutoSeguir(false);
    const m = mapa.current;
    if (!m) return;
    const pts: L.LatLngExpression[] = destinos.map((d) => [d.punto.lat, d.punto.lng]);
    if (yo) pts.push([yo.lat, yo.lng]);
    if (losPinos) pts.push([losPinos.lat, losPinos.lng]);
    if (ruta?.ruta) pts.push(...ruta.ruta.linea);
    if (pts.length) {
      m.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 16 });
    }
  };

  return (
    <div className="dlv-mapa-canvas-root">
      <div ref={contenedor} className="dlv-mapa-lienzo-full" />
      <div className="dlv-mapa-flotantes">
        <button
          type="button"
          className={`dlv-btn-mapa-flotante ${autoSeguir ? 'activo' : ''}`}
          onClick={centrarEnMi}
          title={autoSeguir ? 'Modo Navegación activo (centrado en vehículo)' : 'Reanudar seguimiento en vivo'}
          disabled={!yo}
          style={autoSeguir ? { borderColor: '#38bdf8', color: '#38bdf8' } : undefined}
        >
          🧭
        </button>
        <button
          type="button"
          className="dlv-btn-mapa-flotante"
          onClick={verTodo}
          title="Ver ruta completa"
        >
          🗺
        </button>
      </div>
    </div>
  );
}
