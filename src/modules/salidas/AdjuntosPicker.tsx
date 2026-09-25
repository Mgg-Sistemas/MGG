/* ============================================================
   MGG · Salidas · Selector de adjuntos

   El mismo bloque en los cinco formularios: salida de material, salida de
   dinero, traslado de material, traslado de dinero y salida temporal.

   Muestra JUNTOS los que ya estaban guardados y los que se acaban de elegir,
   porque para quien edita son lo mismo: cuatro papeles de esta solicitud. La
   diferencia —unos viven en el depósito y otros todavía en el navegador— es un
   detalle de implementación que no tiene por qué aparecer en pantalla.

   Quitar uno que ya estaba NO lo borra en el momento: lo marca, libera su lugar
   y recién se borra al guardar. Así se puede reemplazar el cuarto adjunto sin
   guardar dos veces, y si la persona se arrepiente y cierra, no perdió nada.
   ============================================================ */
import { useState, type ChangeEvent } from 'react';
import {
  MAX_ADJUNTOS_SALIDA, adjuntosQueQuedan, cupoAdjuntos, iconoAdjunto, pesoAdjunto,
  validarTandaAdjuntos, type AdjuntoSalida,
} from './adjuntosSalida';
import { urlAdjuntoSalida } from './adjuntosSalida.repository';

export interface EstadoAdjuntos {
  /** Los que ya están guardados en la solicitud (vacío al crear una nueva). */
  existentes: AdjuntoSalida[];
  /** Los que se acaban de elegir y todavía no se subieron. */
  nuevos: File[];
  /** Los `path` de los guardados que se van a borrar al guardar. */
  quitar: string[];
}

export const ADJUNTOS_VACIO: EstadoAdjuntos = { existentes: [], nuevos: [], quitar: [] };

/** El estado inicial a partir de una solicitud que se está editando. */
export function adjuntosDe(existentes: AdjuntoSalida[] | null | undefined): EstadoAdjuntos {
  return { existentes: existentes ?? [], nuevos: [], quitar: [] };
}

/** ¿Hay algo que guardar? Evita un viaje al servidor cuando nadie tocó nada. */
export function hayCambiosAdjuntos(e: EstadoAdjuntos): boolean {
  return e.nuevos.length > 0 || e.quitar.length > 0;
}

export function AdjuntosPicker({ valor, onChange, disabled, ayuda }: {
  valor: EstadoAdjuntos;
  onChange: (v: EstadoAdjuntos) => void;
  disabled?: boolean;
  /** Qué conviene adjuntar en ESTE formulario. Cambia según sea material o dinero. */
  ayuda?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);

  const quedan = adjuntosQueQuedan(valor.existentes, valor.quitar);
  const total = quedan.length + valor.nuevos.length;
  const libre = cupoAdjuntos(valor.existentes, valor.quitar, valor.nuevos.length);

  function elegir(e: ChangeEvent<HTMLInputElement>) {
    const elegidos = Array.from(e.target.files ?? []);
    // El input se limpia SIEMPRE, aunque la tanda no pase: si no, elegir el
    // mismo archivo otra vez no dispara el evento y parece que no anda.
    e.target.value = '';
    if (!elegidos.length) return;
    const malo = validarTandaAdjuntos(
      [...valor.nuevos, ...elegidos].map((f) => ({ name: f.name, type: f.type, size: f.size })),
      valor.existentes, valor.quitar,
    );
    if (malo) { setError(malo); return; }
    setError(null);
    onChange({ ...valor, nuevos: [...valor.nuevos, ...elegidos] });
  }

  /** Quita uno ya guardado: lo marca, no lo borra todavía. */
  function marcarQuitar(path: string) {
    setError(null);
    onChange({ ...valor, quitar: [...valor.quitar, path] });
  }

  /** Vuelve atrás: el que se había marcado se conserva. */
  function deshacerQuitar(path: string) {
    onChange({ ...valor, quitar: valor.quitar.filter((p) => p !== path) });
  }

  function quitarNuevo(i: number) {
    setError(null);
    onChange({ ...valor, nuevos: valor.nuevos.filter((_, k) => k !== i) });
  }

  async function ver(a: AdjuntoSalida) {
    setAbriendo(a.path);
    try {
      const url = await urlAdjuntoSalida(a.path);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el adjunto.');
    } finally { setAbriendo(null); }
  }

  const marcados = valor.existentes.filter((a) => valor.quitar.includes(a.path));

  return (
    <div className="form-row">
      <label>
        📎 Adjuntos <span className="muted" style={{ fontWeight: 400 }}>({total} de {MAX_ADJUNTOS_SALIDA})</span>
      </label>

      {(quedan.length > 0 || valor.nuevos.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', margin: '.15rem 0 .35rem' }}>
          {quedan.map((a) => (
            <span key={a.path} className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
              <button type="button" className="btn-link" onClick={() => void ver(a)} disabled={abriendo === a.path}
                title="Ver el adjunto" style={{ padding: 0 }}>
                {iconoAdjunto(a)} {abriendo === a.path ? 'abriendo…' : a.filename}
              </button>
              {!disabled && (
                <button type="button" className="btn-link" onClick={() => marcarQuitar(a.path)}
                  title="Quitar este adjunto" style={{ padding: 0, color: 'var(--danger)' }}>✕</button>
              )}
            </span>
          ))}
          {valor.nuevos.map((f, i) => (
            <span key={`${f.name}-${i}`} className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
              <span title="Todavía sin subir">🆕 {f.name} <span className="muted">{pesoAdjunto(f.size)}</span></span>
              {!disabled && (
                <button type="button" className="btn-link" onClick={() => quitarNuevo(i)}
                  title="Sacar de la lista" style={{ padding: 0, color: 'var(--danger)' }}>✕</button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Los marcados para borrar siguen a la vista: quitar uno sin querer y
          no poder deshacerlo hasta recargar sería peor que el clic de más. */}
      {marcados.length > 0 && (
        <div className="muted" style={{ fontSize: '.8rem', marginBottom: '.35rem' }}>
          Se van a borrar al guardar:{' '}
          {marcados.map((a) => (
            <span key={a.path} style={{ marginRight: '.5rem', textDecoration: 'line-through' }}>
              {a.filename}{' '}
              <button type="button" className="btn-link" style={{ padding: 0, textDecoration: 'none' }}
                onClick={() => deshacerQuitar(a.path)} title="No borrarlo">↩</button>
            </span>
          ))}
        </div>
      )}

      {!disabled && libre > 0 && (
        <input
          type="file" className="input" multiple
          accept="image/*,application/pdf,.pdf,.jpg,.jpeg,.png,.heic,.heif,.webp"
          onChange={elegir}
        />
      )}
      {!disabled && libre === 0 && (
        <div className="muted" style={{ fontSize: '.82rem' }}>
          Llegaste a los {MAX_ADJUNTOS_SALIDA}. Quitá uno para poder agregar otro.
        </div>
      )}

      {error
        ? <small style={{ color: 'var(--danger)' }}>{error}</small>
        : <small className="muted">{ayuda ?? 'Foto o PDF, hasta 15 MB cada uno.'} Se puede cambiar mientras la solicitud no esté ejecutada.</small>}
    </div>
  );
}
