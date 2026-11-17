/* ============================================================
   Golden Touch · Administración · Modal de Gestión de Carpetas
   (05/11/2026)

   Permite a los administradores:
     1. Ver todas las carpetas del módulo con sus contadores.
     2. Añadir nuevas carpetas personalizadas (con ícono, nombre y breve descripción/nota).
     3. Modificar/editar carpetas existentes (nombre, ícono y notas).
     4. Eliminar carpetas que no contengan archivos activos.
   ============================================================ */

import { useState, useMemo } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { SearchCreateSelect } from '@/shared/ui/SearchSelect';
import { CARPETAS_DOCUMENTOS, type InfoCarpetaDoc } from './admin.repository';
import { obtenerListaResponsables, type CentroAcopio } from './administracionCentrosResponsables';

const EMOJIS_SUGERIDOS = [
  '📁', '⛏️', '👷', '⚖️', '👥', '🏛️', '📑', '📜', '🛡️',
  '💰', '🏢', '🚚', '📦', '🏷️', '🔒', '📝', '⚡', '⭐',
];

interface Props {
  carpetas: InfoCarpetaDoc[];
  /** Los centros vienen de quien abre el modal, que los lee de la base. */
  centros?: CentroAcopio[];
  empresaClave?: string | null;
  onClose: () => void;
  onGuardar: (carpetasActualizadas: InfoCarpetaDoc[]) => void;
}

export function GestionarCarpetasModal({
  carpetas,
  centros: centrosProp,
  onClose,
  onGuardar,
}: Props) {
  const [lista, setLista] = useState<InfoCarpetaDoc[]>(carpetas);
  const [busqueda, setBusqueda] = useState('');

  // Estado para crear o editar
  const [editId, setEditId] = useState<string | null>(null); // null = creando nueva, id = editando
  const [modoFormulario, setModoFormulario] = useState(false);
  const [icon, setIcon] = useState('📁');
  const [label, setLabel] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [centroAcopioId, setCentroAcopioId] = useState<string>('');
  const [responsable, setResponsable] = useState<string>('');

  const centros = centrosProp ?? [];
  const mapaCentros = useMemo(() => new Map(centros.map((c) => [c.id, c.nombre])), [centros]);
  const opcionesResponsables = useMemo(() => obtenerListaResponsables(centros, [], [], lista), [centros, lista]);

  const abrirCrear = () => {
    setEditId(null);
    setIcon('📁');
    setLabel('');
    setDescripcion('');
    setCentroAcopioId('');
    setResponsable('');
    setModoFormulario(true);
  };

  const abrirEditar = (c: InfoCarpetaDoc) => {
    setEditId(c.id);
    setIcon(c.icon);
    setLabel(c.label);
    setDescripcion(c.descripcion || '');
    setCentroAcopioId(c.centroAcopioId || '');
    setResponsable(c.responsable || '');
    setModoFormulario(true);
  };

  const guardarCarpeta = () => {
    const nombreTrim = label.trim();
    if (!nombreTrim) {
      toast('El nombre de la carpeta no puede estar vacío.', 'warning');
      return;
    }

    const cIdLimpio = centroAcopioId.trim() || null;
    const respLimpio = responsable.trim() || null;
    if (editId) {
      // Modificar existente
      const nuevaLista = lista.map((c) =>
        c.id === editId
          ? {
              ...c,
              icon: icon || '📁',
              label: nombreTrim,
              descripcion: descripcion.trim(),
              centroAcopioId: cIdLimpio,
              responsable: respLimpio,
            }
          : c,
      );
      setLista(nuevaLista);
      onGuardar(nuevaLista);
      toast('Carpeta modificada correctamente.', 'success');
    } else {
      // Crear nueva
      const slugId = `carpeta_${Date.now()}_${nombreTrim.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const nuevaCarpeta: InfoCarpetaDoc = {
        id: slugId,
        icon: icon || '📁',
        label: nombreTrim,
        descripcion: descripcion.trim(),
        centroAcopioId: cIdLimpio,
        responsable: respLimpio,
        esPersonalizada: true,
      };
      const nuevaLista = [...lista, nuevaCarpeta];
      setLista(nuevaLista);
      onGuardar(nuevaLista);
      toast('Nueva carpeta agregada correctamente.', 'success');
    }

    setModoFormulario(false);
    setEditId(null);
  };

  const eliminarCarpeta = (id: string) => {
    if (lista.length <= 1) {
      toast('Debe existir al menos una carpeta.', 'warning');
      return;
    }
    const nuevaLista = lista.filter((c) => c.id !== id);
    setLista(nuevaLista);
    onGuardar(nuevaLista);
    toast('Carpeta eliminada.', 'info');
  };

  const filtradas = lista.filter((c) => {
    if (!busqueda.trim()) return true;
    const q = busqueda.toLowerCase();
    return c.label.toLowerCase().includes(q) || (c.descripcion || '').toLowerCase().includes(q);
  });

  return (
    <Modal
      title="📂 Gestión y Personalización de Carpetas"
      onClose={onClose}
      size="lg"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span className="muted hint" style={{ fontSize: '.76rem' }}>
            {lista.length} carpetas configuradas
          </span>
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
            Listo
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem' }}>
        <p className="muted hint" style={{ margin: 0, fontSize: '.8rem' }}>
          Personaliza las carpetas para organizar los documentos de la empresa. Puedes añadir nuevas carpetas,
          cambiar sus nombres, íconos y redactar una breve descripción o nota sobre su propósito.
        </p>

        {/* Botonera superior: Agregar + Buscador */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <input
            type="search"
            className="input input-sm"
            placeholder="🔍 Buscar carpetas por nombre o descripción…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            style={{ minWidth: 240, flex: 1 }}
          />

          {!modoFormulario && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ background: '#ff8a00', color: '#000', fontWeight: 700 }}
              onClick={abrirCrear}
            >
              + Nueva Carpeta
            </button>
          )}
        </div>

        {/* Formulario emergente para Crear o Modificar Carpeta */}
        {modoFormulario && (
          <div
            style={{
              border: '2px solid #ff8a00',
              borderRadius: 8,
              padding: '.85rem',
              background: 'var(--surface-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: '.75rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '.88rem', color: '#ff8a00' }}>
                {editId ? '✏️ Modificar Carpeta' : '✨ Crear Nueva Carpeta'}
              </strong>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setModoFormulario(false)}
              >
                ✕ Cancelar
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '.6rem', alignItems: 'flex-start' }}>
              {/* Ícono / Emoji */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                <span className="muted hint" style={{ fontSize: '.7rem' }}>Ícono</span>
                <input
                  type="text"
                  className="input input-sm"
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  style={{ textAlign: 'center', fontSize: '1.2rem', padding: '.2rem' }}
                  maxLength={4}
                />
              </label>

              {/* Nombre de la Carpeta */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                <span className="muted hint" style={{ fontSize: '.7rem' }}>Nombre de la Carpeta *</span>
                <input
                  type="text"
                  className="input input-sm"
                  placeholder="Ej: Permisos de Traslado y Guías"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  autoFocus
                />
              </label>
            </div>

            {/* Selector rápido de emojis */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem', flexWrap: 'wrap' }}>
              <span className="muted hint" style={{ fontSize: '.68rem' }}>Sugeridos:</span>
              {EMOJIS_SUGERIDOS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="btn btn-ghost btn-xs"
                  style={{
                    padding: '.15rem .35rem',
                    fontSize: '.9rem',
                    border: icon === e ? '1px solid #ff8a00' : '1px solid transparent',
                    background: icon === e ? 'rgba(255, 138, 0, 0.2)' : 'transparent',
                  }}
                  onClick={() => setIcon(e)}
                >
                  {e}
                </button>
              ))}
            </div>

            {/* Asociación a Centro de Acopio */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
              <span className="muted hint" style={{ fontSize: '.7rem' }}>
                🏭 Centro de Acopio Asociado (opcional):
              </span>
              <select
                className="select select-sm"
                value={centroAcopioId}
                onChange={(e) => setCentroAcopioId(e.target.value)}
                style={{ fontSize: '.8rem' }}
              >
                <option value="">🏢 General / Toda la empresa (sin centro asignado)</option>
                {centros.map((c) => (
                  <option key={c.id} value={c.id}>
                    🏭 {c.nombre} ({c.empresaClave})
                  </option>
                ))}
              </select>
              <span className="muted hint" style={{ fontSize: '.68rem' }}>
                Los archivos guardados en esta carpeta se contabilizarán bajo la custodia del centro de acopio y su responsable asignado.
              </span>
            </label>

            {/* Responsable / Analista asignado a la carpeta */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
              <span className="muted hint" style={{ fontSize: '.7rem' }}>
                👤 Responsable / Analista a Cargo de la Carpeta (opcional):
              </span>
              <SearchCreateSelect
                placeholder="Elija o escriba el analista/responsable…"
                options={opcionesResponsables}
                value={responsable}
                onChange={setResponsable}
              />
              <span className="muted hint" style={{ fontSize: '.68rem' }}>
                Los documentos que pertenezcan a esta carpeta se asignarán a este analista/responsable por defecto.
              </span>
            </div>

            {/* Breve descripción o nota («e incluso colocar una breve descripción/nota») */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
              <span className="muted hint" style={{ fontSize: '.7rem' }}>
                Breve descripción o nota explicativa:
              </span>
              <textarea
                className="input input-sm"
                rows={2}
                placeholder="Describe qué tipos de archivos deben guardarse en esta carpeta, ente al que pertenecen o recordatorios..."
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                style={{ resize: 'vertical', fontSize: '.78rem' }}
              />
            </label>

            {/* Botones de acción */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setModoFormulario(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ background: '#ff8a00', color: '#000', fontWeight: 700 }}
                onClick={guardarCarpeta}
              >
                {editId ? 'Guardar Cambios' : 'Crear Carpeta'}
              </button>
            </div>
          </div>
        )}

        {/* Lista de Carpetas con desplazamiento controlado (evita abrumar la pantalla) */}
        <div
          style={{
            maxHeight: 380,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '.45rem',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '.45rem',
            background: 'var(--surface-1)',
          }}
        >
          {filtradas.length === 0 ? (
            <div className="muted" style={{ padding: '2rem', textAlign: 'center', fontSize: '.85rem' }}>
              No se encontraron carpetas con «{busqueda}».
            </div>
          ) : (
            filtradas.map((c) => (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '.6rem',
                  padding: '.55rem .75rem',
                  background: 'var(--surface-2)',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.6rem', flex: 1 }}>
                  <span style={{ fontSize: '1.35rem', lineHeight: 1 }}>{c.icon}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.15rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                      <strong style={{ fontSize: '.84rem', color: 'var(--text)' }}>{c.label}</strong>
                      {c.centroAcopioId && (
                        <span
                          style={{
                            fontSize: '.62rem',
                            padding: '.08rem .35rem',
                            borderRadius: 4,
                            background: 'rgba(234, 179, 8, 0.15)',
                            color: '#eab308',
                            fontWeight: 600,
                          }}
                          title="Asociada al Centro de Acopio"
                        >
                          🏭 {mapaCentros.get(c.centroAcopioId) || c.centroAcopioId}
                        </span>
                      )}
                      {c.responsable && (
                        <span
                          style={{
                            fontSize: '.62rem',
                            padding: '.08rem .35rem',
                            borderRadius: 4,
                            background: 'rgba(168, 85, 247, 0.15)',
                            color: '#c084fc',
                            fontWeight: 600,
                          }}
                          title="Responsable / Analista a Cargo"
                        >
                          👤 {c.responsable}
                        </span>
                      )}
                      {c.esPersonalizada && (
                        <span
                          style={{
                            fontSize: '.62rem',
                            padding: '.08rem .3rem',
                            borderRadius: 4,
                            background: 'rgba(56, 189, 248, 0.15)',
                            color: '#38bdf8',
                            fontWeight: 600,
                          }}
                        >
                          Personalizada
                        </span>
                      )}
                    </div>
                    {c.descripcion ? (
                      <span className="muted" style={{ fontSize: '.74rem', lineHeight: 1.3 }}>
                        {c.descripcion}
                      </span>
                    ) : (
                      <span className="muted hint" style={{ fontSize: '.7rem', fontStyle: 'italic' }}>
                        Sin descripción agregada
                      </span>
                    )}
                  </div>
                </div>

                {/* Acciones */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flexShrink: 0 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => abrirEditar(c)}
                    title="Modificar nombre, ícono o descripción"
                  >
                    ✏️ Modificar
                  </button>
                  {c.esPersonalizada && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      style={{ color: '#ef4444' }}
                      onClick={() => eliminarCarpeta(c.id)}
                      title="Eliminar esta carpeta"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

export const KEY_CARPETAS_CUSTOM = 'admin.carpetas.custom.v1';

export function leerCarpetasPersonalizadas(_empresaClave?: string | null): InfoCarpetaDoc[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(KEY_CARPETAS_CUSTOM) : null;
    if (!raw) return CARPETAS_DOCUMENTOS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // fallback
  }
  return CARPETAS_DOCUMENTOS;
}

export function guardarCarpetasPersonalizadas(carpetas: InfoCarpetaDoc[]): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(KEY_CARPETAS_CUSTOM, JSON.stringify(carpetas));
    }
  } catch {
    // ignorar
  }
}
