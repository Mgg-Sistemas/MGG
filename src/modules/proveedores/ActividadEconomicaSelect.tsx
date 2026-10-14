/* ============================================================
   MGG · Proveedores · Desplegable buscable de actividad económica (CIIU)
   Carga el catálogo de la base (y lo mantiene en vivo), busca por código,
   descripción o sección, y si la actividad no existe permite agregarla ahí
   mismo (código + descripción) sin salir de la pantalla.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { normalizarCodigoCiiu, opcionesActividades, seccionDeCodigo, textoActividad, validarActividadNueva, type ActividadEconomica } from './ciiu';
import { crearActividad, listActividades } from './actividades.repository';

/** El catálogo de actividades, en vivo. Sin catálogo (tabla ausente o sin red) queda vacío: no rompe. */
export function useActividades(): [ActividadEconomica[], (f: (l: ActividadEconomica[]) => ActividadEconomica[]) => void] {
  const [lista, setLista] = useState<ActividadEconomica[]>([]);
  const cargar = useCallback(() => { listActividades().then(setLista).catch(() => { /* sin catálogo */ }); }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useRealtime(['actividades_economicas'], cargar);
  return [lista, setLista];
}

/** «5110 · Comercio al por mayor…» de un código guardado (o «—»). */
export function TextoActividad({ codigo }: { codigo: string | null | undefined }) {
  const [lista] = useActividades();
  return <>{textoActividad(codigo, lista) || '—'}</>;
}

export function ActividadEconomicaSelect({ value, onChange, disabled = false, id }: {
  value: string; onChange: (codigo: string) => void; disabled?: boolean; id?: string;
}) {
  const { user } = useSession();
  const { appUser } = usePermissions();
  const [lista, setLista] = useActividades();
  const [nueva, setNueva] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function agregar() {
    const err = validarActividadNueva(codigo, descripcion, lista);
    if (err) { toast(err, 'error'); return; }
    setGuardando(true);
    try {
      const a = await crearActividad(codigo, descripcion, user?.email ?? 'sistema', appUser?.nombre ?? null);
      setLista((l) => [...l.filter((x) => x.codigo !== a.codigo), a]);
      onChange(a.codigo);
      toast(`Actividad ${a.codigo} agregada al catálogo`, 'success');
      setNueva(false); setCodigo(''); setDescripcion('');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo agregar', 'error'); }
    finally { setGuardando(false); }
  }

  const seccion = codigo ? seccionDeCodigo(normalizarCodigoCiiu(codigo)) : null;

  return (
    <div style={{ display: 'grid', gap: '.4rem' }}>
      <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SearchSelect id={id} value={value} onChange={onChange} disabled={disabled}
            options={opcionesActividades(lista, value)}
            placeholder="Buscar por código CIIU, descripción o sección…"
            emptyText="No está en el catálogo: agrégala con + Nueva" />
        </div>
        {value && !disabled && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange('')} title="Quitar la actividad">✕</button>
        )}
        {!disabled && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNueva((v) => !v)} title="Agregar una actividad que no está en el catálogo">
            {nueva ? 'Cancelar' : '+ Nueva'}
          </button>
        )}
      </div>
      {nueva && !disabled && (
        <div className="card" style={{ padding: '.6rem', display: 'grid', gap: '.4rem', background: 'var(--bg-2)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: '.4rem', alignItems: 'end' }}>
            <label>Código CIIU
              <input className="input mono" value={codigo} maxLength={9} placeholder="4520" autoFocus
                onChange={(e) => setCodigo(e.target.value.replace(/[^0-9-]/g, ''))} />
            </label>
            <label>Descripción
              <input className="input" value={descripcion} maxLength={160} placeholder="Construcción de edificios completos y de partes de edificios"
                onChange={(e) => setDescripcion(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void agregar(); } }} />
            </label>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void agregar()} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Agregar'}
            </button>
          </div>
          <small className="hint muted">
            {seccion ? `Sección CIIU: ${seccion}.` : 'Cuatro dígitos del SENIAT (o un rango 4500-4599).'} Queda en el catálogo para todos los proveedores.
          </small>
        </div>
      )}
    </div>
  );
}
