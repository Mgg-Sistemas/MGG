/* ============================================================
   MGG · Combustible · Fotos de un movimiento

   Dos piezas:

   · `SelectorFotos`: lo que se elige ANTES de guardar. Todavía no hay
     movimiento al que colgarlas, así que se quedan en memoria y se
     suben cuando el movimiento ya tiene id.
   · `FotosDelMovimiento`: las que ya están guardadas, con su miniatura;
     se abren en grande, se agregan y se quitan.

   Los botones son grandes a propósito: esto se usa con una mano, al lado
   del tanque, a veces con guantes.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import type { AdjuntoCombustible } from '@/shared/lib/types';
import {
  MAX_FOTOS_MOVIMIENTO, MODULO_ADJUNTO_TANQUE, errorFoto, esImagen, eliminarFoto, listarFotos, subirFotos, urlsFotos,
  type ModuloAdjunto,
} from './adjuntosCombustible.repository';

/* ───────────── Antes de guardar: las que se van a subir ───────────── */
export function SelectorFotos({ archivos, onChange, titulo }: {
  archivos: File[];
  onChange: (fs: File[]) => void;
  titulo: string;
}) {
  const cupo = MAX_FOTOS_MOVIMIENTO - archivos.length;

  function agregar(lista: FileList | null) {
    if (!lista?.length) return;
    const nuevos: File[] = [];
    for (const f of Array.from(lista)) {
      const malo = errorFoto(f);
      if (malo) { toast(malo, 'error'); continue; }
      nuevos.push(f);
    }
    if (nuevos.length > cupo) {
      toast(`Caben ${MAX_FOTOS_MOVIMIENTO} fotos: se tomaron las primeras ${cupo}.`, 'warning');
    }
    onChange([...archivos, ...nuevos.slice(0, cupo)]);
  }

  return (
    <div className="surt-campo">
      <label>{titulo}</label>
      {/* `capture` abre la cámara directo en el teléfono, que es de donde salen
          casi todas: obligar a pasar por la galería es un paso de más. */}
      <input className="input surt-input" type="file" accept="image/*,application/pdf" multiple
        capture="environment" disabled={cupo <= 0}
        onChange={(e) => { agregar(e.target.files); e.target.value = ''; }} />
      {cupo <= 0 && <small className="muted">Ya tenés {MAX_FOTOS_MOVIMIENTO}, el tope por movimiento.</small>}
      {!!archivos.length && (
        <div className="rep-fotos" style={{ marginTop: '.5rem' }}>
          {archivos.map((f, i) => (
            <div key={`${f.name}-${i}`} className="rep-foto" style={{ position: 'relative' }}>
              {f.type.startsWith('image/')
                ? <img src={URL.createObjectURL(f)} alt={f.name} />
                : <span className="rep-foto-doc">📄<small>{f.name}</small></span>}
              <button type="button" className="btn btn-icon btn-ghost"
                style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,.55)' }}
                title="Quitar" onClick={() => onChange(archivos.filter((_, k) => k !== i))}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────── Ya guardadas: ver, agregar y quitar ───────────── */
export function FotosDelMovimiento({ movId, actor, soloLectura, modulo = MODULO_ADJUNTO_TANQUE, sinFotosTexto = 'Este movimiento no tiene fotos.' }: {
  movId: string;
  actor: string;
  soloLectura?: boolean;
  /** De qué es la foto: movimiento de tanque (por defecto) o comida de Alimentación. */
  modulo?: ModuloAdjunto;
  sinFotosTexto?: string;
}) {
  const [fotos, setFotos] = useState<AdjuntoCombustible[]>([]);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);

  const recargar = useCallback(async () => {
    setCargando(true);
    try {
      const fs = await listarFotos(movId, modulo);
      setFotos(fs);
      setUrls(await urlsFotos(fs.map((f) => f.path)));
    } catch { /* sin fotos la pantalla se muestra igual */ }
    finally { setCargando(false); }
  }, [movId, modulo]);
  useEffect(() => { void recargar(); }, [recargar]);

  async function agregar(lista: FileList | null) {
    if (!lista?.length) return;
    setSubiendo(true);
    try {
      const { subidas, fallos } = await subirFotos(movId, Array.from(lista), actor, modulo);
      for (const f of fallos) toast(f, 'error');
      if (subidas.length) toast(subidas.length === 1 ? 'Foto agregada' : `${subidas.length} fotos agregadas`, 'success');
      await recargar();
    } finally { setSubiendo(false); }
  }

  async function quitar(a: AdjuntoCombustible) {
    try { await eliminarFoto(a); toast('Foto eliminada', 'success'); await recargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  const cupo = MAX_FOTOS_MOVIMIENTO - fotos.length;

  return (
    <div style={{ marginTop: '.8rem' }}>
      <div className="surt-rotulo">📷 Fotos y documentos</div>
      {cargando && <p className="muted" style={{ fontSize: '.85rem' }}>Cargando fotos…</p>}
      {!cargando && !fotos.length && <p className="muted" style={{ fontSize: '.85rem' }}>{sinFotosTexto}</p>}

      {!!fotos.length && (
        <div className="rep-fotos">
          {fotos.map((a) => (
            <div key={a.id} className="rep-foto" style={{ position: 'relative' }}>
              {esImagen(a.content_type, a.nombre) && urls.get(a.path)
                ? <button type="button" style={{ all: 'unset', cursor: 'pointer', display: 'block', height: '100%' }}
                    onClick={() => window.open(urls.get(a.path), '_blank', 'noopener')}>
                    <img src={urls.get(a.path)} alt={a.nombre} loading="lazy" />
                  </button>
                : <button type="button" className="rep-foto-doc" style={{ all: 'unset', cursor: 'pointer' }}
                    onClick={() => window.open(urls.get(a.path), '_blank', 'noopener')}>
                    📄<small>{a.nombre}</small>
                  </button>}
              {!soloLectura && (
                <button type="button" className="btn btn-icon btn-ghost"
                  style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,.55)' }}
                  title="Eliminar la foto" onClick={() => void quitar(a)}>🗑</button>
              )}
            </div>
          ))}
        </div>
      )}

      {!soloLectura && cupo > 0 && (
        <input className="input surt-input" type="file" accept="image/*,application/pdf" multiple
          capture="environment" disabled={subiendo} style={{ marginTop: '.5rem' }}
          onChange={(e) => { void agregar(e.target.files); e.target.value = ''; }} />
      )}
      {subiendo && <small className="muted">Subiendo…</small>}
    </div>
  );
}
