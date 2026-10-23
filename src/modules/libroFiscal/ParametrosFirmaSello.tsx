/* ============================================================
   Golden Touch · Retenciones · Parámetros: logo, firma y sello de la empresa (R1)
   Cada imagen va por versiones desde una fecha: un comprobante usa la vigente
   a su fecha de emisión. Sin imagen, el comprobante deja el recuadro en blanco.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import {
  faltaEnImagen, listImagenesAgente, subirImagenAgente, versionVigente, type ClaseImagenAgente, type ImagenAgente,
} from './entes.repository';
import { CLASES_AGENTE, fechaCorta } from './parametrosR1';
import { ImagenRetencion } from './ImagenRetencion';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { faltaEnFechaRango } from './parametrosNumeros';
import { rotuloMotivo } from './rotulos';

/** Hoy en Venezuela (no en UTC: después de las 20:00 ya sería mañana). */
const hoyIso = hoyVenezuela;

export function ParametrosFirmaSello({ puedeEditar }: { puedeEditar: boolean }) {
  const [imagenes, setImagenes] = useState<ImagenAgente[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try { setImagenes(await listImagenesAgente()); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron leer las imágenes.'); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['retencion_agente_imagenes'], () => { void cargar(); });

  return (
    <div>
      <p className="muted" style={{ fontSize: '.84rem', marginTop: 0 }}>
        Lo que lleva cada comprobante de retención de la empresa. Una imagen nueva vale desde su fecha; los comprobantes anteriores conservan la que tenían.
      </p>
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          {error} <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cargar()}>Reintentar</button>
        </div>
      )}
      {!imagenes && !error && <p className="muted">Leyendo las imágenes…</p>}
      {imagenes && (
        <div style={{ display: 'grid', gap: '.8rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {CLASES_AGENTE.map((c) => (
            <TarjetaImagen key={c.key} clase={c.key} titulo={c.label} ayuda={c.ayuda}
              versiones={imagenes.filter((i) => i.clase === c.key)} puedeEditar={puedeEditar} onCambio={() => void cargar()} />
          ))}
        </div>
      )}
    </div>
  );
}

function TarjetaImagen({ clase, titulo, ayuda, versiones, puedeEditar, onCambio }: {
  clase: ClaseImagenAgente; titulo: string; ayuda: string;
  versiones: ImagenAgente[]; puedeEditar: boolean; onCambio: () => void;
}) {
  const vigente = versionVigente(versiones);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [desde, setDesde] = useState(hoyIso());
  const [firmante, setFirmante] = useState('');
  const [motivo, setMotivo] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const faltaArchivo = archivo ? faltaEnImagen(archivo) : null;
  const faltaDesde = desde ? faltaEnFechaRango(desde, `la fecha «vale desde» ${clase === 'logo' ? 'del logo' : clase === 'firma' ? 'de la firma' : 'del sello'}`) : 'Indica desde qué fecha vale la imagen.';
  const faltaFirmante = clase === 'firma' && !firmante.trim() ? 'Indica el nombre y el cargo de quien firma.' : null;
  /** Por qué «Cargar» está apagado (se dice debajo del botón). */
  const falta = !archivo ? 'Elige la imagen.' : faltaArchivo ?? faltaFirmante ?? faltaDesde;

  async function subir() {
    if (!archivo || falta) { if (falta) toast(falta, 'error'); return; }
    setSubiendo(true);
    try {
      await subirImagenAgente(clase, archivo, desde, { firmante, motivo });
      toast(`${titulo}: imagen cargada.`, 'success');
      setArchivo(null); setMotivo('');
      onCambio();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cargar la imagen.', 'error');
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div className="card" style={{ margin: 0 }}>
      <strong>{titulo}</strong>
      <p className="muted" style={{ fontSize: '.78rem', margin: '.2rem 0 .5rem' }}>{ayuda}</p>
      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center' }}>
        <ImagenRetencion ruta={vigente?.ruta} alt={`${titulo} vigente`} ancho={120} alto={70} vacio="Sin imagen: recuadro en blanco" />
        <div style={{ fontSize: '.8rem' }}>
          {vigente ? <>Vigente desde {fechaCorta(vigente.desde)}{vigente.firmante && <div>{vigente.firmante}</div>}</> : <span className="muted">Sin imagen cargada.</span>}
        </div>
      </div>

      {versiones.length > 1 && (
        <details style={{ marginTop: '.5rem' }}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: '.8rem' }}>Versiones ({versiones.length})</summary>
          {versiones.map((v) => (
            <div key={v.id} style={{ display: 'flex', gap: '.5rem', alignItems: 'center', padding: '.25rem 0', opacity: v.activo ? 1 : 0.55 }}>
              <ImagenRetencion ruta={v.ruta} alt={`${titulo} desde ${fechaCorta(v.desde)}`} ancho={60} alto={36} />
              <span style={{ fontSize: '.76rem' }}>
                Desde {fechaCorta(v.desde)}{v.firmante ? ` · ${v.firmante}` : ''}{v.motivo ? ` · ${rotuloMotivo(v.motivo)}` : ''}{!v.activo ? ' · desactivada' : ''}
              </span>
            </div>
          ))}
        </details>
      )}

      {puedeEditar && (
        <div style={{ marginTop: '.6rem', borderTop: '1px solid var(--border)', paddingTop: '.5rem' }}>
          <div className="form-row" style={{ margin: 0 }}>
            <label>Imagen nueva (PNG o JPG, hasta 1 MB)</label>
            <input className="input" type="file" accept="image/png,image/jpeg" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
            {faltaArchivo && <small style={{ color: 'var(--danger)' }}>{faltaArchivo}</small>}
          </div>
          {clase === 'firma' && (
            <div className="form-row" style={{ margin: '.4rem 0 0' }}>
              <label>Quién firma (nombre y cargo)</label>
              <input className="input" value={firmante} onChange={(e) => setFirmante(e.target.value)} />
            </div>
          )}
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginTop: '.4rem' }}>
            <div className="form-row" style={{ flex: '1 1 130px', margin: 0 }}>
              <label>Vale desde</label>
              <input className="input" type="date" value={desde} min="2000-01-01" max="2100-12-31" onChange={(e) => setDesde(e.target.value)} />
              {faltaDesde && <small style={{ color: 'var(--danger)' }}>{faltaDesde}</small>}
            </div>
            <div className="form-row" style={{ flex: '2 1 160px', margin: 0 }}>
              <label>Motivo</label>
              <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
          </div>
          <button type="button" className="btn" style={{ marginTop: '.5rem' }} onClick={() => void subir()}
            disabled={!!falta || subiendo}>{subiendo ? 'Subiendo…' : 'Cargar'}</button>
          {falta && falta !== faltaArchivo && falta !== faltaDesde && <small className="hint muted" style={{ marginLeft: '.5rem' }}>{falta}</small>}
        </div>
      )}
    </div>
  );
}
