/* ============================================================
   MGG · Control de Maquinaria · «⬇ Exportar datos» (estilo RRHH)
   Permite al usuario marcar con casillas qué datos quiere que
   salgan, a quiénes y agrupar por EMPRESA / PROPIETARIO.
   Descarga en Excel, PDF o envía por correo.
   ============================================================ */
import { useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';
import {
  CAMPOS_EXPORT_MAQUINARIA,
  CAMPOS_POR_DEFECTO_MAQUINARIA,
  GRUPOS_CAMPO_MAQUINARIA,
  tablaExportMaquinaria,
} from './exportarMaquinaria';
import type { InfoEquipo } from './MaquinariaPage';

type Quienes = 'visibles' | 'activos' | 'todos';
const CLAVE_CAMPOS = 'mgg.maquinaria.exportar.campos';
const CLAVE_AGRUPAR = 'mgg.maquinaria.exportar.agrupar';

function camposGuardados(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_CAMPOS) ?? 'null');
    if (Array.isArray(v)) {
      const validos = v.filter((k) => CAMPOS_EXPORT_MAQUINARIA.some((c) => c.key === k));
      if (validos.length) return validos;
    }
  } catch {
    /* fallback a por defecto */
  }
  return [...CAMPOS_POR_DEFECTO_MAQUINARIA];
}

function agruparGuardado(): boolean {
  try {
    const v = localStorage.getItem(CLAVE_AGRUPAR);
    if (v !== null) return v === 'true';
  } catch {
    /* fallback */
  }
  return true; // Por defecto agrupado por empresa
}

export interface ExportarMaquinariaModalProps {
  todos: MaquinariaEquipo[];
  visibles: MaquinariaEquipo[];
  infoMap: Map<string, InfoEquipo>;
  hayFiltros: boolean;
  defaultTipo?: 'excel' | 'pdf' | 'correo' | null;
  actorEmail?: string;
  onClose: () => void;
}

export function ExportarMaquinariaModal({
  todos,
  visibles,
  infoMap,
  hayFiltros,
  defaultTipo = null,
  actorEmail = '',
  onClose,
}: ExportarMaquinariaModalProps) {
  const [campos, setCampos] = useState<string[]>(camposGuardados);
  const [quienes, setQuienes] = useState<Quienes>(hayFiltros ? 'visibles' : 'activos');
  const [propietarioFiltro, setPropietarioFiltro] = useState<string>('todos');
  const [agruparPorEmpresa, setAgruparPorEmpresa] = useState<boolean>(agruparGuardado);
  const [generando, setGenerando] = useState<'excel' | 'pdf' | 'correo' | null>(null);
  const [orientacion, setOrientacion] = useState<'auto' | 'vertical' | 'horizontal'>('auto');
  const [mostrarCorreoInput, setMostrarCorreoInput] = useState(defaultTipo === 'correo');
  const [correoDestinos, setCorreoDestinos] = useState(actorEmail);

  // Lista única de propietarios / empresas ordenados alfabéticamente
  const listaPropietarios = useMemo(() => {
    const s = new Set<string>();
    for (const e of todos) {
      const p = (e.propietario ?? '').trim();
      if (p) s.add(p);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'es'));
  }, [todos]);

  const activos = useMemo(() => todos.filter((e) => e.activo), [todos]);
  const equiposBase = quienes === 'visibles' ? visibles : quienes === 'activos' ? activos : todos;
  const equipos = useMemo(() => {
    if (!propietarioFiltro || propietarioFiltro === 'todos') return equiposBase;
    return equiposBase.filter((e) => (e.propietario ?? '').trim() === propietarioFiltro);
  }, [equiposBase, propietarioFiltro]);

  const tituloBase =
    quienes === 'visibles'
      ? hayFiltros
        ? 'Filtrado'
        : 'Listado'
      : quienes === 'activos'
      ? 'Equipos Activos'
      : 'Todo el Parque de Maquinaria';

  const titulo = propietarioFiltro !== 'todos' ? `${tituloBase} · ${propietarioFiltro}` : tituloBase;

  const marcado = (k: string) => campos.includes(k);

  function toggle(k: string) {
    setCampos((cs) => (cs.includes(k) ? cs.filter((x) => x !== k) : [...cs, k]));
  }

  function grupoEntero(g: string, on: boolean) {
    const ks = CAMPOS_EXPORT_MAQUINARIA.filter((c) => c.grupo === g).map((c) => c.key);
    setCampos((cs) => (on ? [...new Set([...cs, ...ks])] : cs.filter((x) => !ks.includes(x))));
  }

  async function generar(tipo: 'excel' | 'pdf' | 'correo') {
    if (!campos.length) {
      toast('Marca al menos un dato para exportar.', 'error');
      return;
    }
    if (!equipos.length) {
      toast('No hay equipos en la selección actual.', 'error');
      return;
    }

    try {
      localStorage.setItem(CLAVE_CAMPOS, JSON.stringify(campos));
      localStorage.setItem(CLAVE_AGRUPAR, String(agruparPorEmpresa));
    } catch {
      /* almacenamiento opcional */
    }

    setGenerando(tipo);
    try {
      const m = await import('./exportarMaquinariaArchivos');
      if (tipo === 'excel') {
        await m.descargarMaquinariaExcel(equipos, campos, infoMap, titulo, agruparPorEmpresa);
        toast('Archivo Excel generado exitosamente.', 'success');
      } else if (tipo === 'pdf') {
        await m.descargarMaquinariaPdf(equipos, campos, infoMap, titulo, orientacion, agruparPorEmpresa);
        toast('Documento PDF generado exitosamente.', 'success');
      } else if (tipo === 'correo') {
        const correos = correoDestinos
          .split(/[,;\s]+/)
          .map((c) => c.trim())
          .filter(Boolean);
        if (!correos.length) {
          toast('Ingresa al menos un correo destinatario.', 'error');
          setGenerando(null);
          return;
        }
        await m.enviarMaquinariaCorreo(equipos, campos, infoMap, correos, titulo, orientacion, agruparPorEmpresa);
        toast(`Correo enviado a ${correos.join(', ')}.`, 'success');
        onClose();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el reporte', 'error');
    } finally {
      setGenerando(null);
    }
  }

  // Muestra de las 3 primeras filas para ver cómo quedará
  const muestra = useMemo(() => tablaExportMaquinaria(equipos.slice(0, 3), campos, infoMap, false), [equipos, campos, infoMap]);

  return (
    <Modal
      title="⬇ Exportar datos de Maquinaria y Vehículos"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={!!generando}>
            Cerrar
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setMostrarCorreoInput((v) => !v)}
            disabled={!!generando}
          >
            ✉️ {mostrarCorreoInput ? 'Ocultar correo' : 'Enviar por correo'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void generar('excel')}
            disabled={!!generando}
          >
            {generando === 'excel' ? 'Generando…' : '📊 Excel'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void generar('pdf')}
            disabled={!!generando}
          >
            {generando === 'pdf' ? 'Generando…' : '📄 PDF para imprimir'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: '1.25rem' }}>
        {/* Mensaje de alcance */}
        <p className="muted" style={{ margin: 0, fontSize: '.86rem' }}>
          Marca los datos que quieres que salgan. Se descargarán <strong>{equipos.length} equipo(s)</strong>
          {propietarioFiltro !== 'todos' ? (
            <> pertenecientes a <strong style={{ color: 'var(--primary)' }}>{propietarioFiltro}</strong></>
          ) : ''}.
        </p>

        {/* ¿A qué equipos exportar? */}
        <div className="form-row">
          <label style={{ fontWeight: 700, fontSize: '.9rem' }}>¿A qué equipos exportar?</label>
          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginTop: '.35rem' }}>
            <label style={{ display: 'inline-flex', gap: '.4rem', alignItems: 'center', cursor: 'pointer' }}>
              <input type="radio" checked={quienes === 'visibles'} onChange={() => setQuienes('visibles')} />
              {hayFiltros ? 'Los que se ven con los filtros' : 'Los visibles en pantalla'} ({visibles.length})
            </label>
            <label style={{ display: 'inline-flex', gap: '.4rem', alignItems: 'center', cursor: 'pointer' }}>
              <input type="radio" checked={quienes === 'activos'} onChange={() => setQuienes('activos')} />
              Solo activos ({activos.length})
            </label>
            <label style={{ display: 'inline-flex', gap: '.4rem', alignItems: 'center', cursor: 'pointer' }}>
              <input type="radio" checked={quienes === 'todos'} onChange={() => setQuienes('todos')} />
              Todo el parque ({todos.length})
            </label>
          </div>
        </div>

        {/* Filtrar por un propietario / empresa específico (solicitud explícita) */}
        <div className="form-row" style={{ background: 'var(--surface-2)', padding: '.75rem .95rem', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.35rem' }}>
            <label style={{ fontWeight: 700, fontSize: '.9rem', margin: 0 }}>
              🏢 Filtrar por Propietario / Empresa:
            </label>
            {propietarioFiltro !== 'todos' && (
              <button
                type="button"
                className="btn-link"
                style={{ fontSize: '.8rem', fontWeight: 600 }}
                onClick={() => setPropietarioFiltro('todos')}
              >
                Limpiar (Ver todos)
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={propietarioFiltro}
              onChange={(e) => setPropietarioFiltro(e.target.value)}
              className="input-select"
              style={{
                flex: 1,
                minWidth: '220px',
                padding: '.45rem .65rem',
                fontWeight: 600,
                borderRadius: 'var(--r-sm)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
              }}
            >
              <option value="todos">Todos los propietarios / empresas ({equiposBase.length})</option>
              {listaPropietarios.map((p) => {
                const count = equiposBase.filter((e) => (e.propietario ?? '').trim() === p).length;
                return (
                  <option key={p} value={p}>
                    {p} ({count} equipos)
                  </option>
                );
              })}
            </select>
            {propietarioFiltro !== 'todos' && (
              <span className="flo-chip tone-primary" style={{ fontWeight: 700, fontSize: '.82rem' }}>
                Solo: {propietarioFiltro} ({equipos.length})
              </span>
            )}
          </div>
          <div style={{ fontSize: '.78rem', color: 'var(--text-muted)', marginTop: '.3rem' }}>
            {propietarioFiltro === 'todos'
              ? 'Puedes seleccionar una empresa específica para exportar únicamente sus equipos y maquinaria.'
              : `Descargará exclusivamente los equipos registrados a nombre de ${propietarioFiltro}.`}
          </div>
        </div>

        {/* Agrupación por Empresa / Propietario (solicitud explícita de la usuaria) */}
        <div
          style={{
            padding: '.75rem .95rem',
            borderRadius: 'var(--r-md)',
            background: 'color-mix(in srgb, var(--primary) 10%, var(--surface-2))',
            border: '1.5px solid color-mix(in srgb, var(--primary) 40%, var(--border))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <label
              style={{
                display: 'inline-flex',
                gap: '.5rem',
                alignItems: 'center',
                fontWeight: 800,
                fontSize: '.95rem',
                cursor: 'pointer',
                color: 'var(--text)',
              }}
            >
              <input
                type="checkbox"
                checked={agruparPorEmpresa}
                onChange={(e) => setAgruparPorEmpresa(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              🏢 Agrupar por Empresa / Propietario
            </label>
            <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginLeft: '1.6rem', marginTop: '.15rem' }}>
              Separa los equipos por cada empresa (Mineral Group Guayana, Golden Touch, Contratistas...) con sus totales.
            </div>
          </div>
          <span className="flo-chip tone-primary" style={{ fontWeight: 700 }}>
            {agruparPorEmpresa ? '✓ Agrupado activado' : 'Sin agrupar'}
          </span>
        </div>

        {/* Hoja del PDF */}
        <div className="form-row">
          <label style={{ fontWeight: 700, fontSize: '.9rem' }}>Orientación de la hoja en PDF</label>
          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginTop: '.35rem' }}>
            {([
              ['auto', 'Automática (horizontal si hay muchas columnas)'],
              ['horizontal', 'Horizontal'],
              ['vertical', 'Vertical'],
            ] as const).map(([k, l]) => (
              <label key={k} style={{ display: 'inline-flex', gap: '.4rem', alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" checked={orientacion === k} onChange={() => setOrientacion(k)} />
                {l}
              </label>
            ))}
          </div>
        </div>

        {/* Campo de envío de correo si está activado */}
        {mostrarCorreoInput && (
          <div
            style={{
              padding: '.85rem',
              borderRadius: 'var(--r-md)',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              display: 'grid',
              gap: '.5rem',
            }}
          >
            <label style={{ fontWeight: 700, fontSize: '.85rem' }}>
              ✉️ Enviar reporte por correo electrónico a:
            </label>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <input
                type="text"
                className="input"
                value={correoDestinos}
                onChange={(e) => setCorreoDestinos(e.target.value)}
                placeholder="ejemplo@mineralgroupguayana.com, gerencia@..."
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void generar('correo')}
                disabled={!!generando}
              >
                {generando === 'correo' ? 'Enviando…' : '✉️ Enviar ahora'}
              </button>
            </div>
            <small style={{ color: 'var(--text-muted)' }}>
              Puedes separar varios correos con comas o espacios. Se adjuntará el PDF con las columnas seleccionadas.
            </small>
          </div>
        )}

        {/* Casillas para elegir QUÉ datos salen */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.65rem' }}>
            <label style={{ fontWeight: 800, fontSize: '.95rem' }}>
              Casillas: Elige qué datos quieres que salgan ({campos.length} seleccionados)
            </label>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <button
                type="button"
                className="btn-link"
                style={{ fontSize: '.8rem' }}
                onClick={() => setCampos(CAMPOS_EXPORT_MAQUINARIA.map((c) => c.key))}
              >
                Marcar todos
              </button>
              <span style={{ color: 'var(--text-dim)' }}>·</span>
              <button
                type="button"
                className="btn-link"
                style={{ fontSize: '.8rem' }}
                onClick={() => setCampos([...CAMPOS_POR_DEFECTO_MAQUINARIA])}
              >
                Por defecto
              </button>
              <span style={{ color: 'var(--text-dim)' }}>·</span>
              <button
                type="button"
                className="btn-link"
                style={{ fontSize: '.8rem' }}
                onClick={() => setCampos([])}
              >
                Limpiar
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gap: '.75rem' }}>
            {GRUPOS_CAMPO_MAQUINARIA.map((g) => {
              const items = CAMPOS_EXPORT_MAQUINARIA.filter((c) => c.grupo === g.key);
              const todosOn = items.every((c) => marcado(c.key));

              return (
                <div
                  key={g.key}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-md)',
                    background: 'var(--surface)',
                    padding: '.75rem .95rem',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '.55rem',
                      borderBottom: '1px solid var(--border)',
                      paddingBottom: '.4rem',
                    }}
                  >
                    <span style={{ fontWeight: 800, fontSize: '.84rem', color: 'var(--primary)' }}>
                      {g.label.toUpperCase()}
                    </span>
                    <button
                      type="button"
                      className="btn-link"
                      style={{ fontSize: '.76rem' }}
                      onClick={() => grupoEntero(g.key, !todosOn)}
                    >
                      {todosOn ? '✕ Desmarcar grupo' : '✓ Marcar grupo'}
                    </button>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                      gap: '.45rem .8rem',
                    }}
                  >
                    {items.map((c) => (
                      <label
                        key={c.key}
                        style={{
                          display: 'inline-flex',
                          gap: '.4rem',
                          alignItems: 'center',
                          fontSize: '.85rem',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={marcado(c.key)}
                          onChange={() => toggle(c.key)}
                        />
                        <span>{c.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Muestra previa de 3 filas */}
        {muestra.filas.length > 0 && (
          <div>
            <div style={{ fontWeight: 700, fontSize: '.82rem', color: 'var(--text-muted)', marginBottom: '.35rem' }}>
              VISTA PREVIA (primeras 3 filas):
            </div>
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
              <table style={{ width: '100%', fontSize: '.76rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-3)', borderBottom: '1px solid var(--border)' }}>
                    {muestra.head.map((h, i) => (
                      <th key={i} style={{ padding: '.45rem .6rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {muestra.filas.map((f, r) => (
                    <tr key={r} style={{ borderBottom: '1px solid var(--border)' }}>
                      {f.map((cell, c) => (
                        <td key={c} style={{ padding: '.4rem .6rem', whiteSpace: 'nowrap' }}>
                          {String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
