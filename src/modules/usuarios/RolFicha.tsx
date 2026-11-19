/* ============================================================
   MGG · Roles y permisos › Ficha de un rol
   Antes cada rol era una tarjeta con muchas filas × 3 casillas, y se
   pintaban todas a la vez: una pared. Aquí el rol se abre solo
   cuando se va a editar, y su contenido se parte en dos temas
   hermanos — Módulos · Teléfono — en vez de apilar teléfono
   al fondo como apéndice.

   Dentro de «Módulos», los permisos se agrupan por el proceso
   que atienden (ver gruposModulos.ts).

   Es presentación: cada casilla sigue llamando exactamente al
   mismo manejador de antes, con la misma clave de módulo.
   ============================================================ */
import { useState, type CSSProperties } from 'react';
import { VISTAS_TELEFONO } from '@/modules/auth/vistasTelefono';
import type { CustomRole } from './roles.repository';
import {
  MODULOS_CON_PAPELERA,
  emptyPermission as empty,
  type ModuleKey,
  type ModulePermission,
  type RolePermisos,
} from './permisos.repository';
import { alcanceDeGrupo, gruposConTodos, INFO_MODULO } from './gruposModulos';

type Tema = 'modulos' | 'telefono';

export type EstadoAutoguardado = 'idle' | 'guardando' | 'guardado' | 'error';

interface Props {
  rol: CustomRole;
  usuariosEnUso: number;
  permisos: RolePermisos | undefined;
  vistasTelefono: string[];
  soloTelefono: boolean;
  readOnly: boolean;
  /** El rol admin solo lo edita el admin (regla de siempre). */
  bloqueado: boolean;
  autoEstado: EstadoAutoguardado;
  onVolver: () => void;
  onToggle: (mod: ModuleKey, field: keyof ModulePermission) => void;
  onToggleTelefono: (vista: string) => void;
  onSoloTelefono: (valor: boolean) => void;
  onReset: () => void;
  onEliminar: (() => void) | null;
}

const TEXTO_AUTO: Record<EstadoAutoguardado, string> = {
  idle: '💾 Los cambios se guardan automáticamente',
  guardando: '⏳ Guardando…',
  guardado: '✓ Guardado automáticamente',
  error: '⚠ Error al guardar',
};

const ICONO_GRUPO: Record<string, string> = {
  mineral: '⛏',
  abastecimiento: '🛒',
  activos: '🚜',
  dinero: '💰',
  personas: '👥',
  sistema: '⚙',
  otros: '📦',
};

const GRUPOS = gruposConTodos();

export function RolFicha({
  rol,
  usuariosEnUso,
  permisos,
  vistasTelefono,
  soloTelefono,
  readOnly,
  bloqueado,
  autoEstado,
  onVolver,
  onToggle,
  onToggleTelefono,
  onSoloTelefono,
  onReset,
  onEliminar,
}: Props) {
  const [tema, setTema] = useState<Tema>('modulos');
  // Por defecto todos los grupos arrancan abiertos para no esconder módulos.
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>(() =>
    GRUPOS.reduce<Record<string, boolean>>((acc, g) => { acc[g.key] = true; return acc; }, {}),
  );

  const noEditable = readOnly || bloqueado;

  function alternarGrupo(clave: string) {
    setAbiertos((prev) => ({ ...prev, [clave]: !prev[clave] }));
  }

  const estiloRol = { '--rol-color': rol.color || 'var(--primary)' } as CSSProperties;

  return (
    <div className="rol-ficha" style={estiloRol}>
      {/* ── Barra superior: volver + rol actual + estado autoguardado ── */}
      <div className="rol-ficha-top">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onVolver}>
          ← Volver a roles
        </button>
        <div className="rol-ficha-titulo">
          <span className="rol-ficha-tag" />
          <div>
            <h2>{rol.label}</h2>
            <p className="muted">
              <code>{rol.key}</code>
              {rol.descripcion ? ` · ${rol.descripcion}` : ''}
              {` · 👤 ${usuariosEnUso} ${usuariosEnUso === 1 ? 'usuario' : 'usuarios'}`}
            </p>
          </div>
        </div>
        <div className="rol-ficha-acciones">
          <span className={`rol-auto-badge rol-auto-${autoEstado}`} aria-live="polite">
            {TEXTO_AUTO[autoEstado]}
          </span>
          {!noEditable && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onReset}
              title="Restaura los permisos sugeridos para este rol"
            >
              Restablecer sugeridos
            </button>
          )}
          {onEliminar && !noEditable && (
            <button
              type="button"
              className="btn btn-ghost btn-sm text-danger"
              onClick={onEliminar}
            >
              Eliminar rol
            </button>
          )}
        </div>
      </div>

      {bloqueado && (
        <div className="aviso warning" style={{ margin: '0 0 1rem' }}>
          <span className="aviso-icono">🔒</span>
          <div>
            El rol <strong>Administrador</strong> solo puede ser modificado por otro administrador.
          </div>
        </div>
      )}

      {/* ── Conmutador de temas: Módulos · Teléfono ── */}
      <div className="rol-temas" role="tablist" aria-label="Secciones del rol">
        <button
          type="button"
          role="tab"
          aria-selected={tema === 'modulos'}
          className={tema === 'modulos' ? 'activo' : ''}
          onClick={() => setTema('modulos')}
        >
          🧩 Módulos
        </button>
        {rol.key !== 'admin' && (
          <button
            type="button"
            role="tab"
            aria-selected={tema === 'telefono'}
            className={tema === 'telefono' ? 'activo' : ''}
            onClick={() => setTema('telefono')}
          >
            📱 Teléfono
            {vistasTelefono.length > 0 && <span className="rol-tema-conteo">{vistasTelefono.length}</span>}
          </button>
        )}
      </div>

      {/* ── Contenido: Módulos agrupados por proceso ── */}
      {tema === 'modulos' && (
        <div className="rol-grupos">
          <p className="muted" style={{ margin: 0, fontSize: '.82rem' }}>
            Los permisos se guardan al tocar cada casilla. <em>Full control</em> incluye lectura y escritura.
          </p>

          {GRUPOS.map((g) => {
            const conAcceso = alcanceDeGrupo(permisos, g.modulos);
            const abierto = abiertos[g.key] ?? true;
            return (
              <div key={g.key} className="rol-grupo">
                <button
                  type="button"
                  className="rol-grupo-head"
                  onClick={() => alternarGrupo(g.key)}
                  aria-expanded={abierto}
                >
                  <span className="rol-grupo-icono">{ICONO_GRUPO[g.key] ?? '📦'}</span>
                  <div className="rol-grupo-info">
                    <strong>{g.label}</strong>
                    <span className="muted">· {g.resumen}</span>
                  </div>
                  <span className="rol-grupo-alcance">
                    {conAcceso} de {g.modulos.length}
                  </span>
                  <span className="rol-grupo-chevron" aria-hidden="true">{abierto ? '▲' : '▼'}</span>
                </button>

                {abierto && (
                  <div className="rol-grupo-cuerpo">
                    <div className="table-wrap">
                      <table className="table rol-tabla-perm">
                        <thead>
                          <tr>
                            <th>Módulo</th>
                            <th className="th-center">Lectura</th>
                            <th className="th-center">Escritura</th>
                            <th className="th-center">Full control</th>
                            <th className="th-center" title="Solo módulos que manejan papelera">Vaciar papelera</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.modulos.map((k) => {
                            const p = permisos?.[k] ?? empty;
                            const info = INFO_MODULO.get(k);
                            const columnas: Array<{ campo: keyof ModulePermission; label: string }> = [
                              { campo: 'lectura', label: 'Lectura' },
                              { campo: 'escritura', label: 'Escritura' },
                              { campo: 'full', label: 'Full control' },
                              { campo: 'vaciar_papelera', label: 'Vaciar papelera' },
                            ];
                            return (
                              <tr key={k}>
                                <td>
                                  <strong>{info?.label ?? k}</strong>
                                </td>
                                {columnas.map(({ campo, label }) => (
                                  <td key={campo} className="td-center">
                                    <label className="rol-touch-target">
                                      <input
                                        type="checkbox"
                                        disabled={noEditable || (campo === 'vaciar_papelera' && !MODULOS_CON_PAPELERA.has(k))}
                                        checked={!!p[campo]}
                                        onChange={() => onToggle(k, campo)}
                                        aria-label={`${label} ${info?.label ?? k} para ${rol.label}`}
                                      />
                                    </label>
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Respaldo de Base de Datos (conectado a permisos.respaldo) */}
          {rol.key !== 'admin' ? (
            <div style={{ marginTop: '1rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-2)' }}>
              <label htmlFor={`respaldo-${rol.key}`} style={{ display: 'flex', gap: '.6rem', alignItems: 'flex-start', cursor: noEditable ? 'default' : 'pointer' }}>
                <input
                  id={`respaldo-${rol.key}`}
                  type="checkbox"
                  disabled={noEditable}
                  checked={permisos?.respaldo?.lectura === true}
                  onChange={() => onToggle('respaldo', 'lectura')}
                />
                <span>
                  <strong>💾 Respaldo de Base de Datos</strong>
                  <small className="muted" style={{ display: 'block', marginTop: '.2rem' }}>
                    Permite generar, descargar (.sql) y enviar por correo el respaldo de la base de datos.
                  </small>
                </span>
              </label>
            </div>
          ) : (
            <div style={{ marginTop: '1rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-2)', fontSize: '.84rem', color: 'var(--muted)' }}>
              <span>💾 <strong>Respaldo de Base de Datos:</strong> Incluido siempre para Administrador.</span>
            </div>
          )}
        </div>
      )}

      {/* ── Contenido: Pantallas de teléfono ── */}
      {tema === 'telefono' && rol.key !== 'admin' && (
        <div>
          <p className="muted" style={{ marginTop: 0, fontSize: '.82rem' }}>
            Qué pantallas ve este rol cuando entra desde un teléfono.
          </p>
          <div className="rol-lista-opciones">
            {VISTAS_TELEFONO.map((v) => {
              const marcada = vistasTelefono.includes(v.key);
              const mod = permisos?.[v.modulo];
              const sinModulo = !(mod?.lectura || mod?.full);
              const modLabel = INFO_MODULO.get(v.modulo)?.label ?? v.modulo;
              return (
                <label key={v.key} htmlFor={`tel-${rol.key}-${v.key}`} className="rol-opcion" style={{ cursor: noEditable ? 'default' : 'pointer' }}>
                  <input
                    id={`tel-${rol.key}-${v.key}`}
                    type="checkbox"
                    disabled={noEditable}
                    checked={marcada}
                    onChange={() => onToggleTelefono(v.key)}
                  />
                  <span>
                    {v.icono} {v.label}
                    {marcada && sinModulo && (
                      <small style={{ color: 'var(--warning)', display: 'block' }}>
                        No se abre: falta lectura en {modLabel}.
                      </small>
                    )}
                  </span>
                </label>
              );
            })}
            <label htmlFor={`tel-${rol.key}-solo`} className="rol-opcion" style={{ cursor: noEditable ? 'default' : 'pointer' }}>
              <input
                id={`tel-${rol.key}-solo`}
                type="checkbox"
                disabled={noEditable}
                checked={soloTelefono}
                onChange={() => onSoloTelefono(!soloTelefono)}
              />
              <span>
                <strong>Solo teléfono</strong>
                <small className="muted" style={{ display: 'block' }}>Entra directo a sus pantallas de teléfono y no ve las de PC, salvo Ajustes.</small>
                {soloTelefono && !vistasTelefono.length && (
                  <small style={{ color: 'var(--danger)', display: 'block' }}>Sin pantallas marcadas, este rol no tiene nada que abrir.</small>
                )}
              </span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
