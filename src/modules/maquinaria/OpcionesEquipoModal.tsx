import { useEffect } from 'react';
import { num as fmtNum } from '@/shared/lib/format';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';
import { CLASES_EQUIPO, ESTADOS_EQUIPO, estadoEfectivo, claseEquipo } from './flota';
import type { InfoEquipo } from './MaquinariaPage';

export interface OpcionesEquipoModalProps {
  equipo: MaquinariaEquipo;
  info?: InfoEquipo | null;
  canWrite: boolean;
  onClose: () => void;
  onHorometro: () => void;
  onServicio: () => void;
  onLavado: () => void;
  onAveria: () => void;
  onExpediente: () => void;
  onEditar?: () => void;
  onWhatsapp: () => void;
}

/**
 * Modal / Hoja táctil de opciones para vista de teléfono y PC.
 * Muestra prominentemente las horas que faltan para el mantenimiento y
 * expone todas las acciones en botones grandes fáciles de pulsar.
 */
export function OpcionesEquipoModal({
  equipo,
  info,
  canWrite,
  onClose,
  onHorometro,
  onServicio,
  onLavado,
  onAveria,
  onExpediente,
  onEditar,
  onWhatsapp,
}: OpcionesEquipoModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const st = ESTADOS_EQUIPO[estadoEfectivo(equipo)];
  const cl = CLASES_EQUIPO.find((c) => c.id === claseEquipo(equipo));
  const avisoH = info?.avisoH ?? null;
  const avisoK = info?.avisoK ?? null;

  return (
    <div className="flo-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flo-opciones-sheet" onClick={(e) => e.stopPropagation()}>
        {/* Cabecera del Equipo */}
        <div className="flo-opciones-head">
          <div className="flo-opciones-head-top">
            <span className="flo-card-icon">{cl?.icon ?? '🚜'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="flo-card-title">
                <span className="flo-card-nom">{equipo.equipo}</span>
                <span className={`flo-badge ${st.tono}`}>{st.icon} {st.label}</span>
              </div>
              <div className="flo-card-sub">
                {[equipo.marca, equipo.modelo, equipo.anio ? `(${equipo.anio})` : null, equipo.placa ? `🏷️ ${equipo.placa}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {equipo.responsable && (
                <div className="flo-card-resp" style={{ marginTop: '0.2rem' }}>
                  👤 Encargado: <strong>{equipo.responsable}</strong>
                </div>
              )}
            </div>
            <button type="button" className="btn-icon" onClick={onClose} aria-label="Cerrar">
              ✕
            </button>
          </div>
        </div>

        {/* Bloque Destacado: Horas que faltan para mantenimiento */}
        <div className="flo-opciones-horas-box">
          {avisoH ? (
            <div className={`flo-horas-highlight ${avisoH.restante <= 0 ? 'vencido' : avisoH.nivel === 'proximo' ? 'proximo' : 'ok'}`}>
              <div className="flo-horas-header">
                <span className="flo-horas-tag">⏱️ HORAS PARA MANTENIMIENTO</span>
                <span className="flo-horas-badge">{Math.round(avisoH.pct)}% del intervalo</span>
              </div>
              <div className="flo-horas-display">
                <span className="flo-horas-ico">{avisoH.restante <= 0 ? '⛔' : avisoH.nivel === 'proximo' ? '⚠️' : '⏳'}</span>
                <div className="flo-horas-datos">
                  <div className="flo-horas-titulo">
                    {avisoH.restante <= 0
                      ? `MANTENIMIENTO VENCIDO HACE ${fmtNum(Math.abs(avisoH.restante))} HRS`
                      : `FALTAN ${fmtNum(avisoH.restante)} HRS PARA EL SERVICIO`}
                  </div>
                  <div className="flo-horas-detalle">
                    Lectura actual: <strong>{info?.horometro != null ? fmtNum(info.horometro) : '--'} hrs</strong> · Próximo servicio a: <strong>{fmtNum((info?.horometro ?? 0) + avisoH.restante)} hrs</strong> (cada {fmtNum(equipo.mantenimiento_cada_hrs)} hrs)
                  </div>
                </div>
              </div>
              <div
                className="flo-meter"
                style={{ ['--tone' as string]: avisoH.restante <= 0 ? 'var(--danger)' : avisoH.nivel === 'proximo' ? 'var(--warning)' : 'var(--success)' }}
              >
                <i style={{ width: `${avisoH.pct}%` }} />
              </div>
            </div>
          ) : avisoK ? (
            <div className={`flo-horas-highlight ${avisoK.restante <= 0 ? 'vencido' : avisoK.nivel === 'proximo' ? 'proximo' : 'ok'}`}>
              <div className="flo-horas-header">
                <span className="flo-horas-tag">🛣️ KILÓMETROS PARA SERVICIO</span>
                <span className="flo-horas-badge">{Math.round(avisoK.pct)}%</span>
              </div>
              <div className="flo-horas-display">
                <span className="flo-horas-ico">{avisoK.restante <= 0 ? '⛔' : avisoK.nivel === 'proximo' ? '⚠️' : '⏳'}</span>
                <div className="flo-horas-datos">
                  <div className="flo-horas-titulo">
                    {avisoK.restante <= 0
                      ? `SERVICIO VENCIDO HACE ${fmtNum(Math.abs(avisoK.restante))} KM`
                      : `FALTAN ${fmtNum(avisoK.restante)} KM PARA EL SERVICIO`}
                  </div>
                  <div className="flo-horas-detalle">
                    Lectura actual: <strong>{info?.km != null ? fmtNum(info.km) : '--'} km</strong> · Próximo a: <strong>{fmtNum((info?.km ?? 0) + avisoK.restante)} km</strong>
                  </div>
                </div>
              </div>
              <div
                className="flo-meter"
                style={{ ['--tone' as string]: avisoK.restante <= 0 ? 'var(--danger)' : avisoK.nivel === 'proximo' ? 'var(--warning)' : 'var(--success)' }}
              >
                <i style={{ width: `${avisoK.pct}%` }} />
              </div>
            </div>
          ) : (
            <div className="flo-horas-highlight neutro">
              <div className="flo-horas-header">
                <span className="flo-horas-tag">⏱️ CONTROL DE MANTENIMIENTO</span>
              </div>
              <div className="flo-horas-display">
                <span className="flo-horas-ico">⚪</span>
                <div className="flo-horas-datos">
                  <div className="flo-horas-titulo">SIN INTERVALO DE HORAS CONFIGURADO</div>
                  <div className="flo-horas-detalle">
                    {equipo.mantenimiento_cada_hrs
                      ? 'Sin horómetro registrado aún en el sistema.'
                      : 'Puedes configurar cada cuántas horas requiere servicio desde la ficha.'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Acciones principales tipo "Puro Botón" */}
        <div className="flo-opciones-menu">
          <div className="flo-opciones-label">OPCIONES DISPONIBLES EN TELÉFONO</div>
          
          <button
            type="button"
            className="flo-opcion-btn"
            onClick={() => {
              onClose();
              onHorometro();
            }}
          >
            <span className="flo-opcion-ico">⏱️</span>
            <div className="flo-opcion-texts">
              <strong>Registrar Horómetro / Kilometraje</strong>
              <small>Actualizar lectura del odómetro u horómetro</small>
            </div>
            <span className="flo-opcion-arrow">›</span>
          </button>

          <button
            type="button"
            className="flo-opcion-btn primary"
            onClick={() => {
              onClose();
              onServicio();
            }}
          >
            <span className="flo-opcion-ico">🔧</span>
            <div className="flo-opcion-texts">
              <strong>Solicitar Servicio de Mantenimiento</strong>
              <small>Crear orden preventiva o correctiva hacia Compras</small>
            </div>
            <span className="flo-opcion-arrow">›</span>
          </button>

          <button
            type="button"
            className="flo-opcion-btn"
            onClick={() => {
              onClose();
              onLavado();
            }}
          >
            <span className="flo-opcion-ico">🚿</span>
            <div className="flo-opcion-texts">
              <strong>Registrar Lavado del Equipo</strong>
              <small>Anotar lavado con chasis, cabina o motor</small>
            </div>
            <span className="flo-opcion-arrow">›</span>
          </button>

          <button
            type="button"
            className="flo-opcion-btn danger"
            onClick={() => {
              onClose();
              onAveria();
            }}
          >
            <span className="flo-opcion-ico">⚠️</span>
            <div className="flo-opcion-texts">
              <strong>Reportar Avería o Falla</strong>
              <small>Marcar como inoperativo y avisar por WhatsApp</small>
            </div>
            <span className="flo-opcion-arrow">›</span>
          </button>

          <button
            type="button"
            className="flo-opcion-btn"
            onClick={() => {
              onClose();
              onExpediente();
            }}
          >
            <span className="flo-opcion-ico">📂</span>
            <div className="flo-opcion-texts">
              <strong>Ver Expediente Completo</strong>
              <small>Ficha técnica, historial de mantenimientos y fotos</small>
            </div>
            <span className="flo-opcion-arrow">›</span>
          </button>

          <button
            type="button"
            className="flo-opcion-btn whatsapp"
            onClick={() => {
              onClose();
              onWhatsapp();
            }}
          >
            <span className="flo-opcion-ico">💬</span>
            <div className="flo-opcion-texts">
              <strong>Enviar Estado por WhatsApp</strong>
              <small>Compartir ficha y horas restantes con el equipo</small>
            </div>
            <span className="flo-opcion-arrow">›</span>
          </button>

          {canWrite && onEditar && (
            <button
              type="button"
              className="flo-opcion-btn"
              onClick={() => {
                onClose();
                onEditar();
              }}
            >
              <span className="flo-opcion-ico">✏️</span>
              <div className="flo-opcion-texts">
                <strong>Editar Datos del Equipo</strong>
                <small>Modificar encargado, marca, modelo o intervalos</small>
              </div>
              <span className="flo-opcion-arrow">›</span>
            </button>
          )}
        </div>

        {/* Botón de cierre inferior para pulgar */}
        <div className="flo-opciones-foot">
          <button type="button" className="btn btn-secondary flo-btn-cerrar-sheet" onClick={onClose}>
            ✕ Cerrar Opciones
          </button>
        </div>
      </div>
    </div>
  );
}
