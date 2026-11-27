/* ============================================================
   Golden Touch · Retenciones · Gestión Centralizada de Empresas en Parámetros

   Dentro de «⚙ Parámetros» → «🏢 Gestión de empresas».
   Permite administrar directamente desde la configuración del módulo:
   1. Sincronizar automáticamente con el catálogo de Administración (`admin_empresas`).
   2. Dar de alta nuevas empresas receptoras (identidad + datos fiscales).
   3. Editar RIF, razón social, nombre corto, alícuotas municipales (ISAE) y licencias.
   4. Activar o desactivar empresas del padrón.
   5. Eliminar empresas que no tengan facturas asociadas.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { Modal } from '@/shared/ui/Modal';
import {
  listEmpresasReceptoras,
  fichaFiscalEmpresaDisponible,
  guardarEmpresaReceptora,
  eliminarEmpresaReceptora,
  sincronizarEmpresasDesdeAdmin,
  type EmpresaReceptora,
} from './empresasReceptoras.repository';
import { esEmpresaGt } from './empresaActual';
import { EmpresaEditor } from './EmpresaEditor';
import { getConfigRetencion, guardarConfigRetencion, type ConfigRetencion } from '@/modules/libroFiscal/retencionesFiscal.repository';

export interface EditorFichasFiscalesEmpresaProps {
  puedeEditar: boolean;
  onEmpresaCambiada?: () => void;
}

export function EditorFichasFiscalesEmpresa({
  puedeEditar,
  onEmpresaCambiada,
}: EditorFichasFiscalesEmpresaProps) {
  const [empresas, setEmpresas] = useState<EmpresaReceptora[] | null>(null);
  const [disponible, setDisponible] = useState<boolean | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [multiempresaActivo, setMultiempresaActivo] = useState(true);
  const [cfgRetencion, setCfgRetencion] = useState<ConfigRetencion | null>(null);

  // Modos de edición inline
  const [creandoNueva, setCreandoNueva] = useState(false);
  const [empresaEditando, setEmpresaEditando] = useState<EmpresaReceptora | null>(null);
  const [modoEditor, setModoEditor] = useState<'completo' | 'fiscal'>('completo');

  const cargar = useCallback(async () => {
    const [hay, lista, cfg] = await Promise.all([
      fichaFiscalEmpresaDisponible().catch(() => false),
      listEmpresasReceptoras().catch(() => [] as EmpresaReceptora[]),
      getConfigRetencion().catch(() => null),
    ]);
    setDisponible(hay);
    setEmpresas(lista);
    if (cfg) {
      setMultiempresaActivo(cfg.multiempresaActivo !== false);
      setCfgRetencion(cfg);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const handleToggleMultiempresa = async (activo: boolean) => {
    try {
      const cfg = await getConfigRetencion();
      await guardarConfigRetencion({ ...cfg, multiempresaActivo: activo });
      setMultiempresaActivo(activo);
      toast(
        activo
          ? 'Modo Multi-Empresa activado: conmutador y buzones segregados disponibles.'
          : 'Modo Empresa Única activado: módulo anclado a Golden Touch 1127 C.A.',
        'info'
      );
      onEmpresaCambiada?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al cambiar modo de operación.', 'error');
    }
  };

  const handleSincronizar = async () => {
    setSincronizando(true);
    try {
      const res = await sincronizarEmpresasDesdeAdmin();
      if (res.creadas > 0 || res.actualizadas > 0) {
        toast(
          `✅ ${res.creadas} empresa(s) importada(s) de Administración, ${res.actualizadas} actualizada(s).`,
          'success'
        );
      } else {
        toast(`Todas las empresas de Administración (${res.totalAdmin}) ya están sincronizadas.`, 'info');
      }
      await cargar();
      onEmpresaCambiada?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al sincronizar con Administración.', 'error');
    } finally {
      setSincronizando(false);
    }
  };

  const handleToggleActivo = async (emp: EmpresaReceptora) => {
    try {
      const nuevo = !emp.activo;
      await guardarEmpresaReceptora({
        id: emp.id,
        clave: emp.clave,
        nombre: emp.nombre,
        nombreCorto: emp.nombreCorto,
        rif: emp.rif,
        colorBadge: emp.colorBadge,
        activo: nuevo,
        orden: emp.orden,
      });
      setEmpresas((prev) =>
        (prev ?? []).map((e) => (e.id === emp.id ? { ...e, activo: nuevo } : e))
      );
      toast(`Empresa ${emp.nombreCorto || emp.nombre} ${nuevo ? 'activada' : 'desactivada'}.`, 'info');
      onEmpresaCambiada?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cambiar el estado de la empresa.', 'error');
    }
  };

  const handleEliminar = async (emp: EmpresaReceptora) => {
    if (esEmpresaGt(emp)) {
      toast('Golden Touch es la empresa base del sistema y no puede eliminarse.', 'warning');
      return;
    }
    if (!window.confirm(`¿Seguro que deseas eliminar a «${emp.nombreCorto || emp.nombre}»? Si tiene facturas asociadas en el buzón, la base requerirá desactivarla.`)) {
      return;
    }

    try {
      await eliminarEmpresaReceptora(emp.id);
      setEmpresas((prev) => (prev ?? []).filter((e) => e.id !== emp.id));
      toast(`Empresa ${emp.nombreCorto || emp.nombre} eliminada correctamente.`, 'success');
      onEmpresaCambiada?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo eliminar la empresa.', 'error');
    }
  };

  const empresasFiltradas = useMemo(() => {
    if (!empresas) return [];
    if (!busqueda.trim()) return empresas;
    const q = busqueda.trim().toLowerCase();
    return empresas.filter(
      (e) =>
        e.nombre.toLowerCase().includes(q) ||
        (e.nombreCorto && e.nombreCorto.toLowerCase().includes(q)) ||
        e.rif.toLowerCase().includes(q) ||
        (e.municipio && e.municipio.toLowerCase().includes(q))
    );
  }, [empresas, busqueda]);

  if (empresas === null) return <p className="muted">Cargando empresas…</p>;
  if (disponible === false) {
    return (
      <p className="muted">
        La configuración fiscal por empresa estará disponible cuando la base traiga sus campos. Por ahora el módulo trabaja con una sola empresa.
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {/* ── Gobernanza: Interruptor Maestro de Operación Multi-Empresa ── */}
      <div
        className="card"
        style={{
          background: multiempresaActivo ? 'rgba(245, 158, 11, 0.05)' : 'rgba(255, 255, 255, 0.02)',
          border: `1.5px solid ${multiempresaActivo ? 'var(--primary, #f59e0b)' : 'var(--border)'}`,
          padding: '.85rem 1.15rem',
          borderRadius: '10px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.8rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <span style={{ fontSize: '1.25rem' }}>🌐</span>
              <strong style={{ fontSize: '.95rem', color: '#f8fafc' }}>
                Gobernanza del Modo de Operación: {multiempresaActivo ? 'Multi-Empresa Activo' : 'Empresa Única (Single-Empresa)'}
              </strong>
            </div>
            <p className="muted" style={{ margin: '.25rem 0 0', fontSize: '.8rem', maxWidth: '650px', lineHeight: 1.4 }}>
              {multiempresaActivo
                ? 'El módulo opera con selector de empresas, segregación de buzón móvil y libros fiscales independientes para cada RIF.'
                : 'El módulo opera anclado exclusivamente a Golden Touch 1127 C.A. (Empresa Base). Se oculta el banner de cambio de empresa en la vista principal para simplificar la interfaz.'}
            </p>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.6rem', cursor: puedeEditar ? 'pointer' : 'default', fontWeight: 700, fontSize: '.88rem', color: '#f8fafc' }}>
            <input
              type="checkbox"
              checked={multiempresaActivo}
              disabled={!puedeEditar}
              onChange={(e) => void handleToggleMultiempresa(e.target.checked)}
              style={{ width: '18px', height: '18px', accentColor: 'var(--primary, #f59e0b)', cursor: 'pointer' }}
            />
            <span>{multiempresaActivo ? 'Multi-Empresa Activado' : 'Empresa Única'}</span>
          </label>
        </div>
      </div>

      {/* ── Barra de encabezado y acciones superiores ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '.8rem' }}>
        <div>
          <h3 style={{ margin: '0 0 .3rem', fontSize: '1.05rem', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '.45rem' }}>
            <span>🏢</span> Catálogo y Fichas Fiscales de Empresas
          </h3>
          <p className="muted" style={{ margin: 0, fontSize: '.84rem', maxWidth: '650px' }}>
            Gestiona las empresas que actúan como agentes de retención. Puedes preconfigurarlas trayendo en 1 clic
            las empresas de <strong style={{ color: '#f8fafc' }}>Administración</strong> o administrarlas individualmente.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {puedeEditar && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleSincronizar}
              disabled={sincronizando}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '.35rem',
                background: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid var(--primary, #f59e0b)',
                color: 'var(--primary, #f59e0b)',
                fontWeight: 600,
              }}
              title="Importar y actualizar automáticamente empresas desde el módulo de Administración"
            >
              <span>{sincronizando ? '⏳ Sincronizando…' : '🔄 Sincronizar desde Administración'}</span>
            </button>
          )}

          {puedeEditar && !creandoNueva && !empresaEditando && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                setCreandoNueva(true);
                setEmpresaEditando(null);
                setModoEditor('completo');
              }}
            >
              ➕ Nueva empresa
            </button>
          )}
        </div>
      </div>

      {/* ── Modal Flotante de Creación / Edición de Empresa ── */}
      {(creandoNueva || empresaEditando) && (
        <Modal
          title={
            creandoNueva
              ? '✨ Crear nueva empresa receptora'
              : modoEditor === 'fiscal'
              ? `🌐 Ficha fiscal · ${empresaEditando?.nombreCorto || empresaEditando?.nombre}`
              : `✏️ Editar empresa · ${empresaEditando?.nombreCorto || empresaEditando?.nombre}`
          }
          size="lg"
          className="modal-empresa-popup"
          onClose={() => {
            setCreandoNueva(false);
            setEmpresaEditando(null);
          }}
        >
          <style>{`
            .modal-backdrop.modal-empresa-popup-backdrop {
              z-index: 10050 !important;
              display: flex !important;
              align-items: center !important;
              justify-content: center !important;
              padding: 1.5rem !important;
            }
            .modal.modal-empresa-popup {
              z-index: 10051 !important;
              width: min(740px, calc(100vw - 2.5rem)) !important;
              max-width: min(740px, calc(100vw - 2.5rem)) !important;
              height: auto !important;
              max-height: min(85vh, 680px) !important;
              border-radius: 14px !important;
              border: 1.5px solid var(--primary, #f59e0b) !important;
              box-shadow: 0 25px 70px rgba(0, 0, 0, 0.85) !important;
              margin: auto !important;
              display: flex !important;
              flex-direction: column !important;
              overflow: hidden !important;
            }
            .modal.modal-empresa-popup .modal-body {
              max-height: calc(85vh - 110px) !important;
              overflow-y: auto !important;
              padding: 1.25rem 1.4rem !important;
            }
          `}</style>
          {empresaEditando && (
            <div
              style={{
                display: 'flex',
                gap: '.5rem',
                marginBottom: '1rem',
                paddingBottom: '.6rem',
                borderBottom: '1px solid var(--border)',
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                className={`btn btn-sm ${modoEditor === 'completo' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setModoEditor('completo')}
              >
                ✏️ Identidad y Contacto
              </button>
              <button
                type="button"
                className={`btn btn-sm ${modoEditor === 'fiscal' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setModoEditor('fiscal')}
              >
                🌐 Ficha fiscal (ISAE, Licencia, Comprobantes)
              </button>
            </div>
          )}

          <EmpresaEditor
            empresa={empresaEditando ?? undefined}
            modo={modoEditor}
            configGt={cfgRetencion}
            onGuardada={(guardada) => {
              toast(`Empresa «${guardada.nombreCorto || guardada.nombre}» guardada con éxito.`, 'success');
              setCreandoNueva(false);
              setEmpresaEditando(null);
              void cargar();
              onEmpresaCambiada?.();
            }}
            onClose={() => {
              setCreandoNueva(false);
              setEmpresaEditando(null);
            }}
          />
        </Modal>
      )}

      {/* ── Barra de búsqueda y contador ── */}
      {empresas.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '.7rem',
            flexWrap: 'wrap',
            padding: '.55rem .8rem',
            background: 'rgba(255, 255, 255, 0.02)',
            borderRadius: '8px',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '.84rem', fontWeight: 600, color: '#f8fafc' }}>
              {empresas.length} {empresas.length === 1 ? 'empresa configurada' : 'empresas configuradas'}
            </span>
            <span style={{ color: '#94a3b8', fontSize: '.78rem' }}>•</span>
            <span style={{ fontSize: '.78rem', color: '#22c55e', fontWeight: 600 }}>
              {empresas.filter((e) => e.activo).length} activas
            </span>
            {empresas.some((e) => !e.activo) && (
              <span style={{ fontSize: '.78rem', color: '#94a3b8' }}>
                ({empresas.filter((e) => !e.activo).length} desactivadas)
              </span>
            )}
          </div>

          <div style={{ minWidth: '220px', flex: '0 1 280px' }}>
            <input
              type="text"
              className="input sm"
              style={{ width: '100%' }}
              placeholder="🔍 Buscar por nombre o RIF…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* ── Listado de Tarjetas de Empresas ── */}
      {empresas.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '2.5rem 1rem',
            background: 'rgba(255, 255, 255, 0.02)',
            borderRadius: '8px',
            border: '1px dashed var(--border)',
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '.4rem' }}>🏢</div>
          <p style={{ fontWeight: 600, margin: '0 0 .5rem', color: '#f8fafc' }}>
            No hay empresas cargadas en el módulo de Retenciones
          </p>
          <p className="muted" style={{ fontSize: '.84rem', margin: '0 0 1rem' }}>
            Puedes preconfigurarlas automáticamente trayendo las empresas ya existentes en Administración.
          </p>
          {puedeEditar && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSincronizar}
              disabled={sincronizando}
            >
              🔄 Sincronizar desde Administración
            </button>
          )}
        </div>
      ) : empresasFiltradas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
          No se encontraron empresas con el término «{busqueda}».
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '.7rem' }}>
          {empresasFiltradas.map((e) => {
            const esGt = esEmpresaGt(e);
            const esActiva = e.activo;

            return (
              <div
                key={e.id}
                className="card"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '.8rem',
                  flexWrap: 'wrap',
                  padding: '.85rem 1rem',
                  opacity: esActiva ? 1 : 0.65,
                }}
              >
                {/* Información de la empresa */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flex: '1 1 340px' }}>
                  <div
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      background: e.colorBadge || '#2563eb',
                      flexShrink: 0,
                    }}
                    title={`Color identificador: ${e.colorBadge}`}
                  />

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '.94rem', color: '#f8fafc' }}>
                        {e.nombreCorto || e.nombre}
                      </strong>
                      {!esActiva && (
                        <span
                          style={{
                            fontSize: '.66rem',
                            color: '#94a3b8',
                            background: 'rgba(255, 255, 255, 0.05)',
                            padding: '1px 6px',
                            borderRadius: '4px',
                          }}
                        >
                          Desactivada
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: '.68rem',
                          color: esGt ? '#94a3b8' : 'var(--info, #38bdf8)',
                          background: esGt ? 'rgba(255, 255, 255, 0.03)' : 'rgba(56, 189, 248, 0.1)',
                          padding: '1px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        {esGt ? '🛒 Compras + 📱 Buzón' : '📱 Solo Buzón Móvil'}
                      </span>
                      <span
                        style={{
                          fontSize: '.68rem',
                          color: e.imprimirOriginalYCopia === false ? 'var(--primary, #f59e0b)' : '#94a3b8',
                          background: e.imprimirOriginalYCopia === false ? 'rgba(245, 158, 11, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                          border: `1px solid ${e.imprimirOriginalYCopia === false ? 'rgba(245, 158, 11, 0.3)' : 'rgba(255, 255, 255, 0.06)'}`,
                          padding: '1px 6px',
                          borderRadius: '4px',
                        }}
                        title={e.imprimirOriginalYCopia === false ? 'Comprobante configurado en Solo Original (1 página)' : 'Comprobante configurado en Original y Copia (2 páginas)'}
                      >
                        {e.imprimirOriginalYCopia === false ? '📄 Solo Original' : '📑 Original y Copia'}
                      </span>
                    </div>

                    <div style={{ fontSize: '.78rem', color: '#94a3b8', marginTop: '.2rem' }}>
                      <span>{e.nombre}</span> · <code style={{ fontSize: '.75rem', color: '#cbd5e1' }}>{e.rif}</code>
                      {e.municipio && <span> · Municipio: {e.municipio}</span>}
                      {e.alicuotaMunicipal != null && <span> · ISAE: {e.alicuotaMunicipal}%</span>}
                    </div>
                  </div>
                </div>

                {/* Acciones */}
                {puedeEditar && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() => {
                        setEmpresaEditando(e);
                        setCreandoNueva(false);
                        setModoEditor('completo');
                      }}
                      title="Editar RIF, Razón Social, datos de contacto y ficha fiscal"
                    >
                      ✏️ Editar datos
                    </button>

                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() => {
                        setEmpresaEditando(e);
                        setCreandoNueva(false);
                        setModoEditor('fiscal');
                      }}
                      title="Configuración de alícuota municipal (ISAE), licencia y comprobantes"
                    >
                      🌐 Ficha fiscal
                    </button>

                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() => void handleToggleActivo(e)}
                      title={esActiva ? 'Desactivar empresa' : 'Activar empresa'}
                    >
                      {esActiva ? 'Desactivar' : 'Activar'}
                    </button>

                    {!esGt && (
                      <button
                        type="button"
                        className="btn btn-xs"
                        style={{ color: '#ef4444' }}
                        onClick={() => void handleEliminar(e)}
                        title="Eliminar empresa (solo si no tiene facturas)"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
