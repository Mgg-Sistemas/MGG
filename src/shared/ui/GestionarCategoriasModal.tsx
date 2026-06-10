import { useEffect, useMemo, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { mismaTaxonomia } from '@/shared/lib/taxonomias';

/** Un "modo" de gestión (un catálogo: categorías, medidas, etc.). */
export interface ModoGestion {
  /** Clave única del modo (para el switch). */
  key: string;
  /** Etiqueta del switch ("Categorías", "Medidas"). */
  label: string;
  /** Valores actuales (incluye los en uso y los del catálogo). */
  categorias: string[];
  /** Conteo de "registros que usan" por valor. */
  conteoUso: Record<string, number>;
  /** Etiqueta singular de los registros usuarios — "producto", "proveedor"… */
  entidadLabel: string;
  /** Renombrado en BD + cascada. Devuelve cantidad afectada. */
  onRenombrar: (oldName: string, newName: string) => Promise<number>;
  /** Eliminar (sólo si no está en uso). */
  onEliminar?: (nombre: string) => Promise<void>;
  /** Agregar al catálogo. Devuelve el nombre creado o null. */
  onAgregar?: (nombre: string) => Promise<string | null>;
  /** Término singular ("categoría", "medida"). */
  terminoSingular?: string;
  /** Refresca el dataset padre tras cambios. */
  onCambioAplicado: () => Promise<void> | void;
}

interface Props {
  titulo: string;
  onClose: () => void;
  /** NUEVO: varios catálogos con un switch arriba. Si se pasa, ignora las props sueltas. */
  modos?: ModoGestion[];
  /* ── Modo único (compatibilidad con usos previos) ── */
  categorias?: string[];
  conteoUso?: Record<string, number>;
  entidadLabel?: string;
  onRenombrar?: (oldName: string, newName: string) => Promise<number>;
  onEliminar?: (nombre: string) => Promise<void>;
  onAgregar?: (nombre: string) => Promise<string | null>;
  terminoSingular?: string;
  onCambioAplicado?: () => Promise<void> | void;
}

export function GestionarCategoriasModal({
  titulo,
  onClose,
  modos,
  categorias,
  conteoUso,
  entidadLabel,
  onRenombrar,
  onEliminar,
  onAgregar,
  terminoSingular,
  onCambioAplicado,
}: Props) {
  // Normalizamos a una lista de modos (uno solo si vino por props sueltas).
  const modosEff: ModoGestion[] = useMemo(() => {
    if (modos && modos.length) return modos;
    return [{
      key: 'default',
      label: '',
      categorias: categorias ?? [],
      conteoUso: conteoUso ?? {},
      entidadLabel: entidadLabel ?? 'registro',
      onRenombrar: onRenombrar ?? (async () => 0),
      onEliminar,
      onAgregar,
      terminoSingular: terminoSingular ?? 'categoría',
      onCambioAplicado: onCambioAplicado ?? (() => {}),
    }];
  }, [modos, categorias, conteoUso, entidadLabel, onRenombrar, onEliminar, onAgregar, terminoSingular, onCambioAplicado]);

  const [activoKey, setActivoKey] = useState(modosEff[0].key);
  const modo = modosEff.find((m) => m.key === activoKey) ?? modosEff[0];
  const termino = modo.terminoSingular ?? 'categoría';

  const [editando, setEditando] = useState<string | null>(null);
  const [valorEditado, setValorEditado] = useState('');
  const [filtro, setFiltro] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [aEliminar, setAEliminar] = useState<string | null>(null);
  const [versionLocal, setVersionLocal] = useState(0);
  const [nuevo, setNuevo] = useState('');
  const [agregando, setAgregando] = useState(false);

  // Al cambiar de modo, limpiamos el estado de edición/búsqueda.
  useEffect(() => {
    setEditando(null);
    setFiltro('');
    setNuevo('');
  }, [activoKey]);

  const ordenadas = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return modo.categorias
      .filter((c) => !q || c.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => a.localeCompare(b, 'es'));
  }, [modo.categorias, filtro, versionLocal]);

  useEffect(() => {
    if (editando) setValorEditado(editando);
  }, [editando]);

  async function aplicarRename() {
    if (!editando) return;
    const nuevoVal = valorEditado.trim();
    if (!nuevoVal) {
      toast('El nombre no puede estar vacío', 'error');
      return;
    }
    if (nuevoVal === editando) {
      setEditando(null);
      return;
    }
    // Si ya existe otro valor equivalente (case/punto), avisamos que se fusionarán.
    if (modo.categorias.some((c) => c !== editando && mismaTaxonomia(c, nuevoVal))) {
      toast(`Ya existe "${nuevoVal}". Se fusionarán bajo ese nombre.`, 'warning');
    }
    setGuardando(true);
    try {
      const n = await modo.onRenombrar(editando, nuevoVal);
      notify(
        `"${editando}" renombrado a "${nuevoVal}" · ${n} ${modo.entidadLabel}(s) actualizado(s)`,
        'success',
        { link: '#' },
      );
      setEditando(null);
      setVersionLocal((v) => v + 1);
      await modo.onCambioAplicado();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo renombrar', 'error');
    } finally {
      setGuardando(false);
    }
  }

  async function aplicarAgregar() {
    if (!modo.onAgregar) return;
    const clean = nuevo.trim();
    if (!clean) {
      toast(`Escribí el nombre de la ${termino}`, 'error');
      return;
    }
    // Validación case-insensitive: no permitir la misma dos veces (kg vs Kg.).
    if (modo.categorias.some((c) => mismaTaxonomia(c, clean))) {
      toast(`La ${termino} "${clean}" ya existe`, 'warning');
      return;
    }
    setAgregando(true);
    try {
      await modo.onAgregar(clean);
      notify(`${termino[0].toUpperCase()}${termino.slice(1)} "${clean}" agregada`, 'success', { link: '#' });
      setNuevo('');
      setVersionLocal((v) => v + 1);
      await modo.onCambioAplicado();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo agregar', 'error');
    } finally {
      setAgregando(false);
    }
  }

  async function aplicarEliminar() {
    if (!aEliminar || !modo.onEliminar) return;
    setGuardando(true);
    try {
      await modo.onEliminar(aEliminar);
      notify(`"${aEliminar}" eliminado`, 'success', { link: '#' });
      setAEliminar(null);
      await modo.onCambioAplicado();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      title={titulo}
      size="lg"
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary"
          onClick={onClose}
          style={{ textTransform: 'uppercase', textAlign: 'center', justifyContent: 'center', width: '100%' }}
        >
          Cerrar
        </button>
      }
    >
      {modosEff.length > 1 && (
        <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.75rem' }}>
          {modosEff.map((m) => (
            <button
              key={m.key}
              type="button"
              className={`btn btn-sm ${m.key === activoKey ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setActivoKey(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      <p className="muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Agregá nuevas o corregí errores de tipeo. El renombrado se aplica en cascada: todos los {modo.entidadLabel}s
        que usaban el nombre viejo quedan con el nuevo automáticamente. No se permite repetir
        la misma {termino} (ignora mayúsculas/minúsculas).
      </p>

      {modo.onAgregar && (
        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.6rem' }}>
          <input
            className="input"
            placeholder={`Nueva ${termino}…`}
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void aplicarAgregar(); }}
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary" disabled={agregando || !nuevo.trim()} onClick={() => void aplicarAgregar()}>
            {agregando ? 'Agregando…' : '+ Agregar'}
          </button>
        </div>
      )}

      <input
        className="search"
        placeholder={`Filtrar ${termino}s…`}
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        style={{ marginBottom: '.5rem' }}
      />

      <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="table" style={{ fontSize: '.88rem' }}>
          <thead>
            <tr>
              <th style={{ textTransform: 'capitalize' }}>{termino}</th>
              <th style={{ width: 130, textAlign: 'right' }}>En uso</th>
              <th style={{ width: 220 }}></th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.length === 0 && (
              <tr><td colSpan={3} className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Sin {termino}s.</td></tr>
            )}
            {ordenadas.map((c) => {
              const usos = modo.conteoUso[c] ?? 0;
              const enEdicion = editando === c;
              return (
                <tr key={c}>
                  <td>
                    {enEdicion ? (
                      <input
                        className="input"
                        value={valorEditado}
                        onChange={(e) => setValorEditado(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void aplicarRename();
                          if (e.key === 'Escape') setEditando(null);
                        }}
                      />
                    ) : (
                      <strong>{c}</strong>
                    )}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {usos > 0 ? `${usos} ${modo.entidadLabel}${usos === 1 ? '' : 's'}` : <span className="muted">—</span>}
                  </td>
                  <td className="actions">
                    {enEdicion ? (
                      <>
                        <button className="btn btn-sm btn-primary" disabled={guardando} onClick={() => void aplicarRename()}>
                          {guardando ? 'Guardando…' : 'Guardar'}
                        </button>
                        <button className="btn btn-sm btn-ghost" disabled={guardando} onClick={() => setEditando(null)}>
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-sm btn-ghost" onClick={() => setEditando(c)}>
                          ✎ Editar
                        </button>
                        {modo.onEliminar && usos === 0 && (
                          <button className="btn btn-sm btn-danger" onClick={() => setAEliminar(c)}>
                            🗑
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {aEliminar && (
        <ConfirmDialog
          title={`Eliminar ${termino}`}
          message={`Se eliminará "${aEliminar}" del catálogo. No hay ${modo.entidadLabel}s usándola. ¿Continuar?`}
          confirmText="Eliminar"
          danger
          onCancel={() => setAEliminar(null)}
          onConfirm={aplicarEliminar}
        />
      )}
    </Modal>
  );
}
