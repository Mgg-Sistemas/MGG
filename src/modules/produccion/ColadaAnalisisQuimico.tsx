/* ============================================================
   MGG · Análisis químico de laboratorio de UNA colada (fundición).
   Reutiliza la grilla del laboratorio de Recepciones (LabAnalisisGrid) y su
   catálogo de minerales/procedencias. Desplegable, editable en curso, realtime.
   Al finalizar la colada, estos datos salen en el reporte MGG-FR-001.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import type { ModuleKey } from '@/modules/usuarios/permisos.repository';
import { LabAnalisisGrid } from '@/shared/ui/LabAnalisisGrid';
import { ConfigMineralesModal } from '@/shared/ui/ConfigMineralesModal';
import {
  listMinerales, listProcedencias,
  type RecepcionMineral, type RecepcionProcedencia, type RecepcionAnalisis,
} from '@/modules/recepciones/recepciones.repository';
import {
  listColadaAnalisis, crearColadaAnalisis, actualizarColadaAnalisis, eliminarColadaAnalisis,
} from './coladaAnalisis.repository';

export function ColadaAnalisisQuimico({ produccionId, editable, modulo = 'produccion' }: { produccionId: string; editable: boolean; modulo?: ModuleKey }) {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = editable && can(modulo, 'escritura');
  const actor = user?.email ?? 'sistema';
  const miNombre = appUser?.nombre?.trim() || user?.email || '';

  const [minerales, setMinerales] = useState<RecepcionMineral[]>([]);
  const [procedenciasCat, setProcedenciasCat] = useState<RecepcionProcedencia[]>([]);
  const [analisis, setAnalisis] = useState<RecepcionAnalisis[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [ms, pc, as] = await Promise.all([listMinerales(true), listProcedencias(true), listColadaAnalisis(produccionId)]);
    setMinerales(ms); setProcedenciasCat(pc); setAnalisis(as);
  }, [produccionId]);
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    reload().catch((e) => { if (!cancel) toast(e instanceof Error ? e.message : 'Error al cargar análisis', 'error'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reload]);
  useRealtime(['colada_analisis', 'recepcion_minerales', 'recepcion_procedencias'], reload);

  // Opciones de procedencia (catálogo + las ya usadas en los análisis) con color, para la grilla.
  const procOpciones = useMemo<Array<{ nombre: string; color: string | null }>>(() => {
    const cat = procedenciasCat.map((p) => ({ nombre: p.nombre.trim().toUpperCase(), color: p.color ?? null }));
    const catNames = new Set(cat.map((c) => c.nombre));
    const usadas = analisis.map((a) => (a.procedencia ?? '').trim().toUpperCase()).filter(Boolean);
    const extras = Array.from(new Set(usadas)).filter((n) => n && !catNames.has(n)).map((nombre) => ({ nombre, color: null as string | null }));
    return [...cat, ...extras];
  }, [procedenciasCat, analisis]);

  // Nº de lecturas (columnas) cargadas, para el resumen del encabezado.
  const nLecturas = analisis.length;

  const secStyle: React.CSSProperties = { margin: '0 0 .7rem', padding: '.65rem .8rem', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-1)' };

  return (
    <div style={secStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', cursor: 'pointer' }}
        onClick={() => setAbierto((v) => !v)}>
        <div style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, color: 'var(--primary-3)' }}>
          🧪 Análisis químico de laboratorio
          <span className="muted" style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, marginLeft: '.4rem' }}>
            · {loading ? 'cargando…' : `${nLecturas} lectura${nLecturas === 1 ? '' : 's'}`}
          </span>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); setAbierto((v) => !v); }}>
          {abierto ? '▲ Ocultar' : '▼ Desplegar'}
        </button>
      </div>

      {abierto && (
        <div style={{ marginTop: '.7rem' }}>
          {loading ? (
            <div className="muted" style={{ fontSize: '.82rem' }}>Cargando…</div>
          ) : (
            <LabAnalisisGrid
              minerales={minerales}
              analisis={analisis}
              canWrite={canWrite}
              procOpciones={procOpciones}
              onReload={reload}
              onConfig={canWrite ? () => setConfigOpen(true) : undefined}
              crear={(input) => crearColadaAnalisis(produccionId, input, actor, miNombre).then(() => {})}
              actualizar={(id, patch) => actualizarColadaAnalisis(id, patch)}
              eliminar={(id) => eliminarColadaAnalisis(id)}
            />
          )}
        </div>
      )}

      {configOpen && <ConfigMineralesModal onClose={() => setConfigOpen(false)} onChanged={reload} />}
    </div>
  );
}
