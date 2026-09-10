import { useEffect, useMemo, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { textoDeError } from '@/shared/lib/errores';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Involucrado } from '@/shared/lib/types';
import { listInvolucradosActivos } from './involucrados.repository';
import { GestionarInvolucradosModal } from './GestionarInvolucradosModal';
import { alternar, buscar, opcionesInvolucrados, limpiarNombre } from './involucrados';

/**
 * Elige del catálogo quiénes trabajaron la colada, buscando por nombre o cargo.
 *
 * Reemplaza al cuadro de texto donde cada quien tipeaba los nombres a su manera.
 * Lo que se guarda siguen siendo NOMBRES: un reporte ya firmado no puede cambiar
 * de firmante porque después alguien se renombró en el catálogo.
 *
 * Los nombres que la colada ya traía y no están en el catálogo activo se
 * muestran igual, marcados como «fuera del catálogo»: no se pierde a nadie.
 */
export function SelectorInvolucrados({ valor, onChange, actor }: {
  valor: string[];
  onChange: (nombres: string[]) => void;
  actor: string;
}) {
  const [catalogo, setCatalogo] = useState<Involucrado[]>([]);
  const [texto, setTexto] = useState('');
  const [gestionar, setGestionar] = useState(false);

  async function recargar(): Promise<void> {
    try { setCatalogo(await listInvolucradosActivos()); }
    catch (e) { toast(textoDeError(e, 'No se pudo cargar el catálogo de involucrados'), 'error'); }
  }
  useEffect(() => { void recargar(); }, []);
  useRealtime(['involucrados'], () => { void recargar(); });

  const opciones = useMemo(() => opcionesInvolucrados(catalogo, valor), [catalogo, valor]);
  const visibles = useMemo(() => buscar(opciones, texto), [opciones, texto]);
  const elegidos = opciones.filter((o) => o.elegido);

  const escrito = limpiarNombre(texto);
  // Si lo escrito no coincide con nadie, se puede sumar a mano sin salir del formulario.
  const sueltoPosible = !!escrito && !opciones.some((o) => o.nombre.toUpperCase() === escrito);

  return (
    <div>
      <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.4rem', flexWrap: 'wrap' }}>
        <input
          className="input"
          placeholder="Buscar persona por nombre o cargo…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const unica = visibles.length === 1 ? visibles[0].nombre : (sueltoPosible ? escrito : '');
            if (unica) { onChange(alternar(valor, unica)); setTexto(''); }
          }}
          style={{ flex: 1, minWidth: 180 }}
        />
        <button type="button" className="btn btn-ghost" onClick={() => setGestionar(true)}
          title="Agregar, modificar o desactivar personas del catálogo">⚙ Gestionar</button>
      </div>

      {/* Los elegidos, a la vista y quitables de un toque */}
      {elegidos.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem', marginBottom: '.45rem' }}>
          {elegidos.map((o) => (
            <button key={o.nombre} type="button" className="badge"
              onClick={() => onChange(alternar(valor, o.nombre))}
              title="Quitar de la colada"
              style={{ cursor: 'pointer', border: 'none', fontSize: '.76rem' }}>
              {o.nombre}{o.enCatalogo ? '' : ' ·  fuera del catálogo'} ✕
            </button>
          ))}
        </div>
      )}

      <div className="table-wrap" style={{ maxHeight: 190, overflowY: 'auto' }}>
        {!visibles.length ? (
          <div className="muted" style={{ padding: '.6rem', fontSize: '.82rem' }}>
            {sueltoPosible
              ? <>Nadie se llama así en el catálogo. Podés <strong>agregarlo a esta colada</strong> con el botón de abajo, o darlo de alta en <strong>⚙ Gestionar</strong>.</>
              : 'Sin personas en el catálogo. Cargalas con ⚙ Gestionar.'}
          </div>
        ) : (
          <table className="table" style={{ fontSize: '.84rem' }}>
            <tbody>
              {visibles.map((o) => (
                <tr key={o.nombre} onClick={() => onChange(alternar(valor, o.nombre))} style={{ cursor: 'pointer' }}>
                  <td style={{ width: 30 }}><input type="checkbox" readOnly checked={o.elegido} /></td>
                  <td>
                    <strong>{o.nombre}</strong>
                    {!o.enCatalogo && <span className="muted" style={{ fontSize: '.72rem' }}> · fuera del catálogo</span>}
                  </td>
                  <td className="muted" style={{ width: 170 }}>{o.cargo || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sueltoPosible && (
        <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: '.35rem' }}
          onClick={() => { onChange(alternar(valor, escrito)); setTexto(''); }}>
          + Sumar «{escrito}» solo a esta colada
        </button>
      )}

      {gestionar && (
        <GestionarInvolucradosModal
          actor={actor}
          onClose={() => setGestionar(false)}
          onCambio={() => { void recargar(); }}
        />
      )}
    </div>
  );
}
