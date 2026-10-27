/* ============================================================
   Golden Touch · Control de Maquinaria · Diálogo «Descargar datos de equipos»
   (26/10/2026)

   Casillas para elegir qué datos salen (idéntico a RRHH):
   - Selección de columnas personalizables («Foto del equipo» decide si la
     ficha PDF lleva el recuadro de la foto).
   - Filtro por propietario y por categoría (maquinaria / vehículos / motos /
     lanchas), combinados; el título del PDF y del Excel nombran la categoría.
   - Opción para agrupar por empresa / propietario.
   - Excel o PDF en fichas con foto (con vista previa para imprimir).
   - Recuerda las preferencias del usuario en localStorage.
   ============================================================ */
import { useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';
import { CLASES_EQUIPO, claseEquipo, type ClaseEquipo } from './flota';
import {
  CAMPOS_EQUIPO,
  CAMPOS_POR_DEFECTO_EQUIPOS,
  descargarEquiposExcelPersonalizado,
  descargarEquiposPdfPersonalizado,
  orientacionFinal,
  type ContextoEquipoExportar,
  type OrientacionHoja,
} from './exportarEquipos';

// «.v2» (26/10/2026): la selección guardada antes no traía «Foto del equipo» y el
// usuario creía que la casilla no hacía nada; con la clave nueva vuelve a salir marcada.
const CLAVE_LOCAL_CAMPOS = 'maquinaria.exportar-equipos.campos.v2';
const CLAVE_LOCAL_AGRUPAR = 'maquinaria.exportar-equipos.agrupar';

function seleccionGuardada(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_LOCAL_CAMPOS) ?? 'null');
    if (Array.isArray(v) && v.every((x) => typeof x === 'string') && v.length) return v;
  } catch { /* usa valor por defecto */ }
  return CAMPOS_POR_DEFECTO_EQUIPOS;
}

function agruparGuardado(): boolean {
  try {
    const v = localStorage.getItem(CLAVE_LOCAL_AGRUPAR);
    if (v !== null) return v === 'true';
  } catch { /* usa valor por defecto */ }
  return true; // Por defecto agrupado por empresa como solicitó el usuario
}

function guardarPreferencias(claves: string[], agrupar: boolean) {
  try {
    localStorage.setItem(CLAVE_LOCAL_CAMPOS, JSON.stringify(claves));
    localStorage.setItem(CLAVE_LOCAL_AGRUPAR, String(agrupar));
  } catch { /* no crítico */ }
}

interface Props {
  equipos: MaquinariaEquipo[];
  total: number;
  contextoMap?: Map<string, ContextoEquipoExportar>;
  fotosMap?: Map<string, string>;
  onClose: () => void;
  formatoInicial?: 'pdf' | 'xlsx' | null;
}

export function ExportarEquiposModal({ equipos, total, contextoMap, fotosMap, onClose }: Props) {
  const [marcados, setMarcados] = useState<string[]>(seleccionGuardada);
  const [agrupar, setAgrupar] = useState<boolean>(agruparGuardado);
  const [propietarioSel, setPropietarioSel] = useState<string>('todos');
  const [categoriaSel, setCategoriaSel] = useState<'todas' | ClaseEquipo>('todas');
  const [ocupado, setOcupado] = useState<'xlsx' | 'pdf' | null>(null);
  const [orientacion, setOrientacion] = useState<OrientacionHoja>('auto');

  const listaPropietarios = useMemo(() => {
    const s = new Set<string>();
    for (const e of equipos) {
      const p = (e.propietario ?? '').trim();
      if (p) s.add(p);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'es'));
  }, [equipos]);

  // Primer filtro: propietario (los conteos de las categorías se calculan sobre este grupo)
  const equiposDelPropietario = useMemo(() => {
    if (propietarioSel === 'todos') return equipos;
    if (propietarioSel === '__sin__') return equipos.filter((e) => !(e.propietario ?? '').trim());
    return equipos.filter((e) => (e.propietario ?? '').trim().toUpperCase() === propietarioSel.toUpperCase());
  }, [equipos, propietarioSel]);

  // Segundo filtro: categoría (misma clasificación que el catálogo: claseEquipo)
  const equiposAExportar = useMemo(() => {
    if (categoriaSel === 'todas') return equiposDelPropietario;
    return equiposDelPropietario.filter((e) => claseEquipo(e) === categoriaSel);
  }, [equiposDelPropietario, categoriaSel]);

  const conteoCategorias = useMemo(() => {
    const m = new Map<ClaseEquipo, number>();
    for (const e of equiposDelPropietario) {
      const c = claseEquipo(e);
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return m;
  }, [equiposDelPropietario]);

  const categoriaLabel = categoriaSel === 'todas' ? null : (CLASES_EQUIPO.find((c) => c.id === categoriaSel)?.label ?? null);
  const propietarioLabel = propietarioSel === 'todos' ? null : propietarioSel === '__sin__' ? 'Sin propietario' : propietarioSel;

  const alternar = (clave: string) =>
    setMarcados((m) => (m.includes(clave) ? m.filter((x) => x !== clave) : [...m, clave]));

  async function descargar(formato: 'xlsx' | 'pdf') {
    setOcupado(formato);
    try {
      guardarPreferencias(marcados, agrupar);
      if (formato === 'xlsx') {
        await descargarEquiposExcelPersonalizado(equiposAExportar, marcados, agrupar, contextoMap, orientacion, categoriaLabel);
      } else {
        await descargarEquiposPdfPersonalizado(
          equiposAExportar,
          marcados,
          agrupar,
          contextoMap,
          orientacion,
          fotosMap,
          categoriaLabel,
        );
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el archivo', 'error');
    } finally {
      setOcupado(null);
    }
  }

  const nada = marcados.length === 0;

  return (
    <Modal
      title="⬇ Descargar datos de maquinaria y vehículos"
      size="md"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={!!ocupado}>Cerrar</button>
          <button
            className="btn btn-ghost"
            onClick={() => void descargar('xlsx')}
            disabled={nada || !!ocupado || !equiposAExportar.length}
          >
            {ocupado === 'xlsx' ? 'Generando…' : '📊 Excel'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void descargar('pdf')}
            disabled={nada || !!ocupado || !equiposAExportar.length}
          >
            {ocupado === 'pdf' ? 'Generando…' : '📄 PDF (imprimir)'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: '.84rem', marginTop: 0 }}>
        Marca los datos que quieres que salgan. Se descargan <strong>{equiposAExportar.length}</strong> equipo(s)
        {categoriaLabel || propietarioLabel ? (
          <> de <strong>{[categoriaLabel, propietarioLabel].filter(Boolean).join(' · ')}</strong></>
        ) : (
          equipos.length !== total ? <> de {total}, los que deja ver el filtro aplicado</> : null
        )}.
      </p>

      {/* Selector de Empresa / Propietario específico */}
      <div style={{
        background: 'var(--surface-2, #182230)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '.6rem .75rem',
        marginBottom: '.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '.5rem',
      }}>
        <label htmlFor="exp-filtro-propietario" style={{ fontSize: '.86rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '.4rem', color: 'var(--text, #f1f5f9)' }}>
          🏢 Propietario a exportar:
        </label>
        <select
          id="exp-filtro-propietario"
          className="select"
          style={{ minWidth: '220px', maxWidth: '100%', fontSize: '.84rem', padding: '.3rem .6rem' }}
          value={propietarioSel}
          onChange={(e) => setPropietarioSel(e.target.value)}
        >
          <option value="todos">Todos los propietarios ({equipos.length} equipos)</option>
          {listaPropietarios.map((p) => {
            const cant = equipos.filter((e) => (e.propietario ?? '').trim().toUpperCase() === p.toUpperCase()).length;
            return (
              <option key={p} value={p}>
                {p} ({cant} equipo{cant === 1 ? '' : 's'})
              </option>
            );
          })}
          {equipos.some((e) => !(e.propietario ?? '').trim()) && (
            <option value="__sin__">Sin propietario asignado</option>
          )}
        </select>
      </div>

      {/* Categoría a exportar (misma clasificación que el catálogo); se combina con el propietario */}
      <div style={{
        background: 'var(--surface-2, #182230)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '.6rem .75rem',
        marginBottom: '.5rem',
      }}>
        <div style={{ fontSize: '.86rem', fontWeight: 600, marginBottom: '.4rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
          🚜 Categoría a exportar:
        </div>
        <div className="flo-pills solido" role="group" aria-label="Categoría a exportar" style={{ marginBottom: 0 }}>
          <button type="button" className="flo-pill" aria-pressed={categoriaSel === 'todas'} onClick={() => setCategoriaSel('todas')}>
            Todas<span className="n">{equiposDelPropietario.length}</span>
          </button>
          {CLASES_EQUIPO.map((c) => (
            <button key={c.id} type="button" className="flo-pill" aria-pressed={categoriaSel === c.id} onClick={() => setCategoriaSel(c.id)}>
              {c.icon} {c.label}<span className="n">{conteoCategorias.get(c.id) ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Opción destacada: Agrupar por Empresa / Propietario */}
      <div style={{
        background: 'var(--surface-2, #182230)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '.6rem .75rem',
        marginBottom: '.75rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <label htmlFor="exp-agrupar-empresa" style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontSize: '.88rem', fontWeight: 600 }}>
          <input
            type="checkbox"
            id="exp-agrupar-empresa"
            checked={agrupar}
            onChange={(e) => setAgrupar(e.target.checked)}
          />
          📁 Agrupar equipos por empresa / propietario
        </label>
        <span className="muted" style={{ fontSize: '.76rem' }}>
          {agrupar ? 'Subtotales y secciones separadas' : 'Listado corrido'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => setMarcados(CAMPOS_POR_DEFECTO_EQUIPOS)}
        >
          Solo principales
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => setMarcados(CAMPOS_EQUIPO.map((c) => c.clave))}
        >
          Marcar todos
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => setMarcados([])}
        >
          Ninguno
        </button>
      </div>

      {/* Grid de casillas de verificación */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '.3rem .8rem' }}>
        {CAMPOS_EQUIPO.map((c) => (
          <label key={c.clave} style={{ display: 'flex', alignItems: 'center', gap: '.45rem', fontSize: '.86rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              id={`exp-equipo-${c.clave}`}
              checked={marcados.includes(c.clave)}
              onChange={() => alternar(c.clave)}
            />
            {c.etiqueta}
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginTop: '.9rem' }}>
        <label htmlFor="exp-equipo-orientacion" style={{ fontSize: '.86rem', fontWeight: 600 }}>Hoja</label>
        <select
          id="exp-equipo-orientacion"
          className="input"
          style={{ width: 'auto' }}
          value={orientacion}
          onChange={(e) => setOrientacion(e.target.value as OrientacionHoja)}
        >
          <option value="auto">Automática (según las columnas)</option>
          <option value="vertical">Vertical</option>
          <option value="horizontal">Horizontal</option>
        </select>
        <small className="muted">
          Sale en {orientacionFinal(marcados, orientacion) === 'portrait' ? 'vertical' : 'horizontal'}. Al imprimir, elige la misma orientación.
        </small>
      </div>

      {nada && <p className="muted" style={{ fontSize: '.78rem', color: 'var(--warning, #f59e0b)' }}>Marca al menos un dato.</p>}
    </Modal>
  );
}
export default ExportarEquiposModal;
