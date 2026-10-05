/* ============================================================
   MGG · Cocina · La lista física del mercado (05-10-2026)

   · `SelectorListaMercado`: lo que se elige ANTES de cerrar o iniciar. El
     mercado nuevo todavía no existe, así que los archivos esperan en memoria
     y se suben cuando ya tiene id.
   · `ListaFisicaMercado`: la que ya está guardada en un mercado; se ve, se
     agrega y se quita. Vive en el mismo depósito privado que las fotos de
     combustible y de las comidas, con su propio módulo.
   ============================================================ */
import { useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { FotosDelMovimiento } from '@/modules/combustible/FotosMovimiento';
import { MODULO_ADJUNTO_MERCADO, subirFotos } from '@/modules/combustible/adjuntosCombustible.repository';
import { errorListaMercado, MAX_FOTOS_LISTA_MERCADO } from './listaMercado';

export function SelectorListaMercado({ archivos, onChange, disabled }: {
  archivos: File[]; onChange: (fs: File[]) => void; disabled?: boolean;
}) {
  function agregar(lista: FileList | null) {
    if (!lista?.length) return;
    const nuevos = Array.from(lista);
    const malo = errorListaMercado(
      [...archivos, ...nuevos].map((f) => ({ nombre: f.name, tipo: f.type })),
    );
    if (malo) { toast(malo, 'error'); return; }
    onChange([...archivos, ...nuevos]);
  }
  return (
    <div className="form-row">
      <label>🧾 Lista física del mercado que entra <span className="muted" style={{ fontWeight: 400 }}>· opcional · hasta {MAX_FOTOS_LISTA_MERCADO} fotos o 1 PDF</span></label>
      <input className="input" type="file" accept="image/*,application/pdf" multiple disabled={disabled}
        onChange={(e) => { agregar(e.target.files); e.target.value = ''; }} />
      {!!archivos.length && (
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: '.4rem' }}>
          {archivos.map((f, i) => (
            <span key={`${f.name}-${i}`} className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}>
              {f.type === 'application/pdf' || /\.pdf$/i.test(f.name) ? '📄' : '🖼'} {f.name}
              <button type="button" className="btn btn-icon btn-ghost" style={{ padding: 0, minWidth: 0 }} title="Quitar"
                onClick={() => onChange(archivos.filter((_, k) => k !== i))} disabled={disabled}>✕</button>
            </span>
          ))}
        </div>
      )}
      <small className="hint muted">La foto o el PDF de la lista en papel de lo que llegó. Queda guardada en el mercado nuevo.</small>
    </div>
  );
}

/** Sube la lista al mercado recién creado. No tumba el cierre/inicio: avisa lo que falló. */
export async function subirListaMercado(mercadoId: string, archivos: File[], actor: string): Promise<void> {
  if (!archivos.length) return;
  const { subidas, fallos } = await subirFotos(mercadoId, archivos, actor, MODULO_ADJUNTO_MERCADO);
  for (const f of fallos) toast(`Lista del mercado: ${f}`, 'warning');
  if (subidas.length) toast(subidas.length === 1 ? 'Lista del mercado guardada' : `Lista del mercado guardada (${subidas.length} archivos)`, 'success');
}

export function ListaFisicaMercado({ mercadoId, actor, soloLectura }: { mercadoId: string; actor: string; soloLectura?: boolean }) {
  // Si otro usuario agrega o quita un archivo, se vuelve a leer: realtime siempre.
  const [vuelta, setVuelta] = useState(0);
  useRealtime(['combustible_adjuntos'], () => setVuelta((n) => n + 1));
  return (
    <div className="card" style={{ marginBottom: '.8rem', padding: '.6rem .9rem' }}>
      <div style={{ fontWeight: 600 }}>🧾 Lista física del mercado</div>
      <div className="muted" style={{ fontSize: '.78rem' }}>Hasta {MAX_FOTOS_LISTA_MERCADO} fotos o 1 PDF de la lista en papel de lo que entró.</div>
      <FotosDelMovimiento key={vuelta} movId={mercadoId} actor={actor} soloLectura={soloLectura}
        modulo={MODULO_ADJUNTO_MERCADO} sinFotosTexto="Este mercado no tiene la lista física cargada." />
    </div>
  );
}
