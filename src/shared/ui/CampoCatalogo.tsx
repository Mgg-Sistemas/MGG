import { useCallback, useEffect, useMemo, useState } from 'react';
import { SearchSelect } from './SearchSelect';
import { toast } from './Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import {
  listCatalogoPedido, crearCatalogoPedido, type ScopeCatalogoPedido,
} from '@/modules/pedidos/pedidos.repository';
import { modoCatalogo, opcionesConGuardada } from './catalogoModo';

/**
 * Campo de una sola opción tomada de un catálogo que el usuario puede ampliar.
 *
 * Con pocas opciones se ven todas juntas como chips y se elige de un toque; a
 * partir de cinco se vuelve un buscador, porque los chips ya se desbordarían
 * en varias filas. La regla vive en `catalogoModo.ts` y está probada aparte.
 *
 * Lo que se agrega acá queda en el catálogo compartido y aparece enseguida en
 * las demás pantallas (realtime), así dos personas cargando en paralelo no
 * terminan con dos versiones del mismo nombre.
 */
export function CampoCatalogo({
  scope, value, onChange, label, actor, ayuda, placeholderNuevo, permitirAgregar = true,
}: {
  scope: ScopeCatalogoPedido;
  value?: string;
  onChange: (v: string) => void;
  label: string;
  /** Correo de quien agrega. Si no se pasa, sale de la sesión. */
  actor?: string | null;
  ayuda?: string;
  placeholderNuevo?: string;
  permitirAgregar?: boolean;
}) {
  const { appUser } = usePermissions();
  const autor = actor ?? appUser?.email ?? null;
  const [opciones, setOpciones] = useState<string[]>([]);
  const [nuevo, setNuevo] = useState('');
  const [agregando, setAgregando] = useState(false);

  const cargar = useCallback(() => {
    listCatalogoPedido(scope, true)
      .then((r) => setOpciones(r.map((x) => x.nombre)))
      .catch(() => setOpciones([]));
  }, [scope]);
  useEffect(() => { cargar(); }, [cargar]);
  useRealtime(['catalogos_pedido'], cargar);

  const todas = useMemo(() => opcionesConGuardada(opciones, value), [opciones, value]);
  const modo = modoCatalogo(todas.length);

  async function agregar() {
    const n = nuevo.trim();
    if (!n) { toast('Escribí el nombre', 'error'); return; }
    // Si ya existe (aunque esté escrito distinto), se elige en vez de duplicarlo.
    const existente = todas.find((o) => o.toLowerCase() === n.toLowerCase());
    if (existente) {
      onChange(existente); setNuevo('');
      toast(`"${existente}" ya estaba en la lista — se seleccionó`, 'warning');
      return;
    }
    setAgregando(true);
    try {
      await crearCatalogoPedido(scope, n, autor);
      setOpciones((prev) => [...prev, n].sort((a, b) => a.localeCompare(b, 'es')));
      onChange(n);
      setNuevo('');
      toast(`"${n}" agregado a la lista`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo agregar', 'error');
    } finally { setAgregando(false); }
  }

  return (
    <div className="form-row">
      <label>{label}</label>

      {modo === 'chips' ? (
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          {!todas.length && <span className="muted" style={{ fontSize: '.78rem' }}>Todavía no hay ninguno cargado. Agregá el primero abajo.</span>}
          {todas.map((op) => {
            const activo = (value ?? '') === op;
            return (
              <button key={op} type="button" onClick={() => onChange(activo ? '' : op)}
                className={`btn btn-sm ${activo ? 'btn-primary' : 'btn-ghost'}`}
                style={{ borderRadius: 999 }}>
                {op}
              </button>
            );
          })}
        </div>
      ) : (
        <SearchSelect
          value={value ?? ''}
          onChange={onChange}
          options={[{ value: '', label: '— sin indicar —' }, ...todas.map((o) => ({ value: o, label: o }))]}
          placeholder="🔎 Buscá…"
          emptyText="Ninguno coincide" />
      )}

      {permitirAgregar && (
        <div style={{ display: 'flex', gap: '.4rem', marginTop: '.35rem' }}>
          <input className="input" value={nuevo} onChange={(e) => setNuevo(e.target.value)}
            placeholder={placeholderNuevo ?? '¿No está? Escribilo y añadilo'}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void agregar(); } }}
            style={{ flex: 1, fontSize: '.82rem' }} />
          <button type="button" className="btn btn-sm btn-ghost" onClick={agregar} disabled={agregando || !nuevo.trim()}>
            {agregando ? '…' : '+ Añadir'}
          </button>
        </div>
      )}

      {ayuda && <small className="muted" style={{ fontSize: '.72rem' }}>{ayuda}</small>}
    </div>
  );
}
