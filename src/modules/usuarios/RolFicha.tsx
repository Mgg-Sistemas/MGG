/* ============================================================
   MGG · Roles y permisos › Ficha de un rol (Nivelado visual exacto a GT)
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
  MODULES,
  MODULOS_CON_PAPELERA,
  emptyPermission as empty,
  type ModuleKey,
  type ModulePermission,
  type RolePermisos,
} from './permisos.repository';
import { alcanceDeGrupo, gruposConTodos, INFO_MODULO } from './gruposModulos';

type Tema = 'modulos' | 'telefono' | 'almacenes';

export type EstadoAutoguardado = 'idle' | 'guardando' | 'guardado' | 'error';

interface Props {
  rol: CustomRole;
  usuariosEnUso: number;
  permisos: RolePermisos | undefined;
  vistasTelefono: string[];
  soloTelefono: boolean;
  readOnly: boolean;
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
  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set(['mineral']));
  const grupos = gruposConTodos();
  const noEditable = readOnly || bloqueado;

  const alternarGrupo = (key: string) => {
    setAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="rol-ficha">
      <div className="rol-ficha-head">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onVolver}>← Roles</button>
        <h2 className="rol-ficha-titulo" style={{ '--rol-color': rol.color } as CSSProperties}>
          <span className="rol-ficha-color" aria-hidden="true" />
          {rol.label}
          {rol.sistema && <span className="badge" style={{ fontSize: '.65rem' }}>SISTEMA</span>}
        </h2>
        <span className="rol-card-usuarios">
          {usuariosEnUso === 0 ? 'Sin usuarios asignados' : `${usuariosEnUso} usuario(s)`}
        </span>
        {!readOnly && (
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
            <span className={`rol-autoguardado ${autoEstado}`} aria-live="polite">{TEXTO_AUTO[autoEstado]}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onReset} title="Resetear este rol a los valores por defecto">
              ↺ Default
            </button>
            {onEliminar && (
              <button type="button" className="btn btn-sm btn-danger" onClick={onEliminar} title="Eliminar este rol">
                🗑 Eliminar
              </button>
            )}
          </div>
        )}
      </div>

      {rol.descripcion && <p className="muted" style={{ marginTop: 0, marginBottom: '1rem', fontSize: '.85rem' }}>{rol.descripcion}</p>}

      {bloqueado && (
        <div className="aviso warning" style={{ margin: '0 0 1.25rem' }}>
          <span className="aviso-icono">🔒</span>
          <div>
            El rol <strong>Administrador</strong> solo puede ser modificado por otro administrador.
          </div>
        </div>
      )}

      <div className="view-toggle" style={{ marginLeft: 0, marginBottom: '1.25rem' }} role="tablist" aria-label="Qué configurar del rol">
        <button
          type="button"
          role="tab"
          aria-selected={tema === 'modulos'}
          className={tema === 'modulos' ? 'active' : ''}
          onClick={() => setTema('modulos')}
        >
          Módulos
        </button>
        {rol.key !== 'admin' && (
          <button
            type="button"
            role="tab"
            aria-selected={tema === 'telefono'}
            className={tema === 'telefono' ? 'active' : ''}
            onClick={() => setTema('telefono')}
          >
            📱 Teléfono
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={tema === 'almacenes'}
          className={tema === 'almacenes' ? 'active' : ''}
          onClick={() => setTema('almacenes')}
        >
          📦 Almacenes y Sedes
        </button>
      </div>

      {tema === 'modulos' && (
        <div>
          <div className="perm-barra">
            <span className="muted" style={{ fontSize: '.75rem' }}>{MODULES.length} módulos en {grupos.length} grupos</span>
          </div>
          <p className="perm-nota" style={{ margin: '0 0 .75rem' }}>
            Full control incluye lectura y escritura: al marcarlo se marcan las dos.
          </p>

          {grupos.map((g) => {
            const abierto = abiertos.has(g.key);
            const conAcceso = alcanceDeGrupo(permisos, g.modulos);
            return (
              <div className="perm-grupo" key={g.key}>
                <button
                  type="button"
                  className="perm-grupo-head"
                  aria-expanded={abierto}
                  onClick={() => alternarGrupo(g.key)}
                >
                  <span className="perm-grupo-flecha" aria-hidden="true">▸</span>
                  <span>
                    {g.label}
                    <small className="muted" style={{ display: 'block', fontWeight: 500, fontSize: '.74rem' }}>{g.resumen}</small>
                  </span>
                  <span className="perm-grupo-resumen">{conAcceso} de {g.modulos.length}</span>
                </button>

                {abierto && (
                  <div className="perm-grupo-cuerpo">
                    <div className="table-wrap">
                      <table className="perm-tabla">
                        <thead>
                          <tr>
                            <th>Módulo</th>
                            <th>Lectura</th>
                            <th>Escritura</th>
                            <th>Full control</th>
                            <th>Vaciar papelera</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.modulos.map((k) => {
                            const info = INFO_MODULO.get(k);
                            const p = permisos?.[k] ?? { ...empty };
                            const campos: { campo: keyof ModulePermission; label: string }[] = [
                              { campo: 'lectura', label: 'Lectura' },
                              { campo: 'escritura', label: 'Escritura' },
                              { campo: 'full', label: 'Full control' },
                              { campo: 'vaciar_papelera', label: 'Vaciar papelera' },
                            ];
                            return (
                              <tr key={k}>
                                <td className="perm-modulo">
                                  <div className="perm-modulo-nombre">{info?.label ?? k}</div>
                                </td>
                                {campos.map(({ campo, label }) => (
                                  <td className="perm-celda" key={campo}>
                                    <label>
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

          {/* Respaldo de Base de Datos */}
          {rol.key !== 'admin' ? (
            <div style={{ marginTop: '1.25rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--bg-1)' }}>
              <label htmlFor={`respaldo-${rol.key}`} style={{ display: 'flex', gap: '.6rem', alignItems: 'flex-start', cursor: noEditable ? 'default' : 'pointer' }}>
                <input
                  id={`respaldo-${rol.key}`}
                  type="checkbox"
                  disabled={noEditable}
                  checked={permisos?.respaldo?.lectura === true}
                  onChange={() => onToggle('respaldo', 'lectura')}
                  style={{ width: 17, height: 17, marginTop: '.15rem', accentColor: 'var(--primary)' }}
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
            <div style={{ marginTop: '1.25rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--bg-1)', fontSize: '.84rem', color: 'var(--muted)' }}>
              <span>💾 <strong>Respaldo de Base de Datos:</strong> Incluido siempre para Administrador.</span>
            </div>
          )}
        </div>
      )}

      {tema === 'telefono' && rol.key !== 'admin' && (
        <div>
          <p className="muted" style={{ marginTop: 0, marginBottom: '1rem', fontSize: '.82rem' }}>
            Qué pantallas ve este rol cuando entra desde un teléfono.
          </p>
          <div className="rol-lista-opciones">
            {VISTAS_TELEFONO.map((v) => {
              const marcada = (vistasTelefono ?? []).includes(v.key);
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
            <label htmlFor={`tel-${rol.key}-solo`} className="rol-opcion" style={{ cursor: noEditable ? 'default' : 'pointer', marginTop: '.4rem' }}>
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

      {tema === 'almacenes' && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div className="card" style={{ padding: '1.25rem', background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
            <h3 style={{ margin: '0 0 .5rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <span>📦</span> Sectorización física de almacenes por sede
            </h3>
            <p className="muted" style={{ fontSize: '.84rem', margin: '0 0 .75rem', lineHeight: 1.5 }}>
              En MGG, la potestad de <strong>mover inventario</strong> (despachar, trasladar, registrar ajustes manuales o recepcionar compras) se otorga por sede física (<em>CENTRO DE FUNDICION - MATANZAS</em>, <em>LOS PINOS</em>, <em>CENTRO DE ACOPIO - LA ESPERANZA</em>).
            </p>
            <p className="muted" style={{ fontSize: '.84rem', margin: 0, lineHeight: 1.5 }}>
              Esta asignación se realiza <strong>por cada usuario individual</strong> en la pestaña <strong>👤 Personas → Editar usuario → 📦 Almacenes asignados</strong>. Así, usuarios con el mismo rol (por ejemplo, almacenistas o choferes) operan estrictamente en la sede física donde laboran, evitando movimientos accidentales en inventario de otras sedes.
            </p>
          </div>
          <div className="card" style={{ padding: '1.25rem' }}>
            <h4 style={{ margin: '0 0 .6rem', fontSize: '.9rem' }}>💡 Reglas de sectorización</h4>
            <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '.84rem', color: 'var(--text-muted)', display: 'grid', gap: '.5rem' }}>
              <li>
                <strong>Sin sedes marcadas (Acceso Global):</strong> Si un usuario tiene la lista de sedes vacía, <strong>no tiene restricción</strong> y puede ver y mover en cualquier sede o almacén. Este es el estado por defecto para <em>Administrador</em>, <em>Analista de Sistemas</em> y <em>Gerencia</em>.
              </li>
              <li>
                <strong>Con sedes específicas:</strong> El usuario solo puede mover productos en sus almacenes autorizados. Si necesita material de otra sede (por ejemplo, La Esperanza), debe emitir una <strong>Solicitud de Traslado</strong>.
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
