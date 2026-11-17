/* ============================================================
   Golden Touch · Administración · Centro de Alertas y Notificaciones Push
   (Modal interactivo, descarte por tiempos establecidos y PWA Push)
   ============================================================ */

import { useState, useEffect } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import {
  evaluarAlertasDocumentos,
  descartarNotificacionDocumento,
  restaurarNotificacionDocumento,
  dispararSonidoAlertaAdmin,
  emitirNotificacionPushNativa,
  activarNotificaciones,
  soportaPush,
  estadoPermisoNotif,
  type AlertaDocumento,
} from './notificacionesAdministracion';
import type { DocumentoEmpresa } from './admin.repository';

interface NotificacionesAdminModalProps {
  documentos: DocumentoEmpresa[];
  empresaClave?: string | null;
  onClose: () => void;
  onVerDocumento?: (docId: string) => void;
}

export function NotificacionesAdminModal({
  documentos,
  empresaClave,
  onClose,
  onVerDocumento,
}: NotificacionesAdminModalProps) {
  const [docsFiltrados, setDocsFiltrados] = useState<DocumentoEmpresa[]>([]);
  const [versionDescartes, setVersionDescartes] = useState(0);
  const [permisoPush, setPermisoPush] = useState<string>('default');
  const [pushSoportado, setPushSoportado] = useState(false);
  const [activandoPush, setActivandoPush] = useState(false);
  const [mensajePush, setMensajePush] = useState<string | null>(null);

  useEffect(() => {
    setPushSoportado(soportaPush());
    setPermisoPush(estadoPermisoNotif());
  }, []);

  useEffect(() => {
    const filtrados = empresaClave
      ? documentos.filter((d) => d.empresaClave === empresaClave)
      : documentos;
    setDocsFiltrados(filtrados);
  }, [documentos, empresaClave]);

  // Evaluar alertas según los descartes actuales
  const { alertas, nuevasParaSonar, totalSilenciadas } = evaluarAlertasDocumentos(docsFiltrados);

  // Descartar una alerta individual
  const handleDescartar = (alerta: AlertaDocumento) => {
    descartarNotificacionDocumento(alerta.docId, alerta.hitoActual, alerta.diasRestantes);
    setVersionDescartes((v) => v + 1);
  };

  // Restaurar / Reactivar una alerta silenciada
  const handleReactivar = (alerta: AlertaDocumento) => {
    restaurarNotificacionDocumento(alerta.docId);
    setVersionDescartes((v) => v + 1);
  };

  // Descartar todas las alertas activas actuales en lote
  const handleDescartarTodas = () => {
    for (const a of nuevasParaSonar) {
      descartarNotificacionDocumento(a.docId, a.hitoActual, a.diasRestantes);
    }
    setVersionDescartes((v) => v + 1);
  };

  // Activar Notificaciones Web Push
  const handleHabilitarPush = async () => {
    setActivandoPush(true);
    setMensajePush(null);
    try {
      const res = await activarNotificaciones();
      if (res.ok) {
        setPermisoPush('granted');
        setMensajePush('✅ Notificaciones Push activadas en este dispositivo.');
      } else {
        setMensajePush(`⚠️ ${res.motivo || 'No se pudieron activar las notificaciones push.'}`);
      }
    } catch (e) {
      setMensajePush(`⚠️ Error: ${e instanceof Error ? e.message : 'falló la activación'}`);
    } finally {
      setActivandoPush(false);
    }
  };

  const handleProbarAlertaAdmin = async () => {
    dispararSonidoAlertaAdmin();
    const docEjemplo = alertas[0]?.nombre || 'RIF ACTUALIZADO GOLDEN TOUCH';
    const empresaEjemplo = alertas[0]?.empresaClave || empresaClave || 'GT';
    const diasEjemplo = alertas[0]?.diasRestantes ?? 3;
    const enviado = await emitirNotificacionPushNativa(
      `💼 Alerta de Documento · ${empresaEjemplo}`,
      `«${docEjemplo}»: Vence en ${diasEjemplo} días. Requiere atención oportuna.`,
      '/administracion',
    );
    if (enviado) {
      toast('Notificación de documento enviada al dispositivo.', 'success');
    } else {
      toast('No se pudo emitir la notificación. Revisa permisos del navegador.', 'warning');
    }
  };

  return (
    <Modal
      title="🔔 Centro de Alertas y Notificaciones de Administración"
      size="lg"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => dispararSonidoAlertaAdmin()}
              title="Prueba el tono suave de notificación"
            >
              🔊 Probar Sonido
            </button>
            {nuevasParaSonar.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleDescartarTodas}
                title="Silencia todas las alertas hasta sus siguientes tiempos establecidos"
              >
                🔕 Descartar Todas ({nuevasParaSonar.length})
              </button>
            )}
          </div>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Entendido
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} data-v={versionDescartes}>
        {/* Banner PWA y Web Push */}
        <div
          style={{
            padding: '.75rem .9rem',
            borderRadius: '8px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '.6rem',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: '.84rem', color: 'var(--text)' }}>
              📲 Notificaciones Push y Alertas Móviles
            </div>
            <div className="muted hint" style={{ fontSize: '.74rem', marginTop: '.2rem' }}>
              {permisoPush === 'granted'
                ? '🟢 Notificaciones push autorizadas en este dispositivo.'
                : permisoPush === 'denied'
                ? '🔴 Permiso bloqueado en el navegador. Habilítalo en la barra de direcciones.'
                : 'Permite que la app te avise en el teléfono o navegador cuando venza un documento.'}
            </div>
            {mensajePush && (
              <div style={{ fontSize: '.74rem', marginTop: '.3rem', color: '#38bdf8' }}>{mensajePush}</div>
            )}
          </div>

          {pushSoportado && permisoPush !== 'granted' && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void handleHabilitarPush()}
              disabled={activandoPush || permisoPush === 'denied'}
            >
              {activandoPush ? 'Activando…' : 'Activar Notificaciones Push'}
            </button>
          )}

          {pushSoportado && permisoPush === 'granted' && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void handleProbarAlertaAdmin()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}
              title="Envía una notificación de documento real de prueba a este teléfono o equipo"
            >
              📲 Probar alerta de documento
            </button>
          )}
        </div>

        {/* Resumen de Estado */}
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="badge" style={{ background: nuevasParaSonar.length > 0 ? '#ef4444' : '#10b981', color: '#fff', fontSize: '.75rem' }}>
            {nuevasParaSonar.length} alerta(s) activa(s)
          </span>
          {totalSilenciadas > 0 && (
            <span className="badge" style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--text-muted)', fontSize: '.75rem' }}>
              🔕 {totalSilenciadas} silenciada(s) hasta su siguiente tiempo
            </span>
          )}
        </div>

        {/* Lista de Alertas */}
        {alertas.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '1.8rem', marginBottom: '.4rem' }}>✅</div>
            <div style={{ fontWeight: 600 }}>Todos los permisos y documentos están al día</div>
            <p className="muted hint" style={{ fontSize: '.76rem', margin: '.2rem 0 0' }}>
              No hay documentos vencidos ni próximos a vencer en el período de alerta.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem', maxHeight: '420px', overflowY: 'auto' }}>
            {alertas.map((a) => {
              const esVencido = a.diasRestantes !== null && a.diasRestantes < 0;
              return (
                <div
                  key={a.docId}
                  style={{
                    padding: '.75rem .9rem',
                    borderRadius: '8px',
                    border: a.descartada
                      ? '1px dashed var(--border)'
                      : esVencido
                      ? '1.5px solid rgba(239, 68, 68, 0.6)'
                      : '1.5px solid rgba(234, 179, 8, 0.6)',
                    background: a.descartada
                      ? 'var(--surface-1)'
                      : esVencido
                      ? 'rgba(239, 68, 68, 0.05)'
                      : 'rgba(234, 179, 8, 0.05)',
                    opacity: a.descartada ? 0.75 : 1,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.5rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '220px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: '.84rem', color: 'var(--text)' }}>
                          {a.nombre}
                        </span>
                        <span className="badge" style={{ fontSize: '.68rem' }}>{a.empresaClave}</span>
                        {a.descartada ? (
                          <span
                            className="badge"
                            style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--text-muted)', fontSize: '.68rem' }}
                            title="Descartada por el usuario"
                          >
                            🔕 Silenciada
                          </span>
                        ) : (
                          <span
                            className="badge"
                            style={{
                              background: esVencido ? 'rgba(239, 68, 68, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                              color: esVencido ? '#ef4444' : '#eab308',
                              fontSize: '.68rem',
                              fontWeight: 700,
                            }}
                          >
                            🔔 Sonando / Activa
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: '.76rem', color: esVencido ? '#ef4444' : '#f59e0b', marginTop: '.25rem', fontWeight: 600 }}>
                        {a.mensaje}
                      </div>

                      <div className="muted hint" style={{ fontSize: '.72rem', marginTop: '.2rem' }}>
                        📅 <strong>Vencimiento:</strong> {a.fechaVencimiento || 'No especificada'}
                        {a.descartada && (
                          <span style={{ display: 'block', marginTop: '.15rem', color: '#38bdf8' }}>
                            ⏳ <em>Volverá a sonar: {a.proximoHitoTexto}</em>
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                      {onVerDocumento && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => {
                            onVerDocumento(a.docId);
                            onClose();
                          }}
                          title="Abrir detalles de este documento"
                        >
                          👁️ Ver
                        </button>
                      )}

                      {a.descartada ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          style={{ color: '#38bdf8' }}
                          onClick={() => handleReactivar(a)}
                          title="Quitar silenciamiento y reactivar alerta de inmediato"
                        >
                          🔔 Reactivar
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          style={{ color: '#ef4444' }}
                          onClick={() => handleDescartar(a)}
                          title={`Descartar aviso: no volverá a sonar hasta ${a.proximoHitoTexto}`}
                        >
                          🔕 Descartar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
