/* ============================================================
   MGG · Conciliación · Modal para Registrar/Editar Reintegro de Retención (13-11-2026)
   ============================================================ */
import { useState, useRef } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useSession } from '@/modules/auth/authStore';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import { urlAdjuntoOc } from '@/modules/pedidos/pedidos.repository';
import type { Orden } from '@/shared/lib/types';
import type { FilaEntradaRetencion } from './conciliacionEntradas';
import { guardarReintegroConciliacion } from './conciliacionEntradas.repository';

const BANCOS_SUGERIDOS = [
  'BDV JURÍDICO MGG',
  'BDV PERSONAL PALMA',
  'BFC JURÍDICO MGG',
  'BDT JURÍDICO GT',
  'EFECTIVO BS',
  'TRANSFERENCIA OTRO BANCO',
];

const fmtBs = (n: number | null | undefined) =>
  Number.isFinite(n) ? `Bs ${(n as number).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

export function RegistrarReintegroModal({
  fila,
  onClose,
  onGuardado,
}: {
  fila: FilaEntradaRetencion;
  onClose: () => void;
  onGuardado: (orden: Orden) => void;
}) {
  const { user } = useSession();
  const r = fila.reintegro;
  const drive = fila.driveEntradaDetectada;

  const hoyStr = new Date().toISOString().slice(0, 10);
  const [fecha, setFecha] = useState(r?.fechaReintegro || drive?.at?.slice(0, 10) || hoyStr);
  const [referencia, setReferencia] = useState(r?.referencia || drive?.referencias[0] || '');
  const [banco, setBanco] = useState(r?.banco || 'BDV JURÍDICO MGG');
  const [montoBs, setMontoBs] = useState<string>(
    r ? String(r.montoBs) : drive ? String(drive.montoBs) : fila.montoRetencionBs ? String(fila.montoRetencionBs) : '',
  );
  const [nota, setNota] = useState(r?.nota || '');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [abriendoDoc, setAbriendoDoc] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const aplicarSugerenciaDrive = () => {
    if (!drive) return;
    if (drive.at) setFecha(drive.at.slice(0, 10));
    if (drive.referencias.length) setReferencia(drive.referencias[0]);
    if (drive.montoBs > 0) setMontoBs(String(drive.montoBs));
    toast('Datos de Caja Multimoneda aplicados al formulario', 'info');
  };

  const verComprobanteActual = async () => {
    if (!r?.comprobantePath) return;
    setAbriendoDoc(true);
    try {
      const url = await urlAdjuntoOc(r.comprobantePath);
      await previewFileUrl(url, r.comprobanteNombre || 'comprobante-reintegro', 'Comprobante de reintegro');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo abrir el comprobante', 'error');
    } finally {
      setAbriendoDoc(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fecha) {
      toast('Ingresa la fecha del reintegro', 'error');
      return;
    }
    if (!referencia.trim()) {
      toast('Ingresa la referencia bancaria del reintegro', 'error');
      return;
    }
    const m = parseFloat(montoBs.replace(',', '.'));
    if (!Number.isFinite(m) || m <= 0) {
      toast('Ingresa un monto válido en Bs mayor a cero', 'error');
      return;
    }

    setGuardando(true);
    try {
      const ordenActualizada = await guardarReintegroConciliacion(
        fila.id,
        {
          fechaReintegro: fecha,
          referencia: referencia.trim(),
          banco: banco.trim() || null,
          montoBs: m,
          archivo,
          nota: nota.trim() || null,
        },
        user?.email || 'conciliacion',
      );
      toast('Reintegro de retención registrado correctamente', 'success');
      onGuardado(ordenActualizada);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error al guardar el reintegro', 'error');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      title={`🏛️ Registrar Reintegro de Retención · ${fila.codigo}`}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>
            Cancelar
          </button>
          <button type="submit" form="form-reintegro" className="btn btn-primary" disabled={guardando}>
            {guardando ? 'Guardando…' : '✓ Guardar reintegro'}
          </button>
        </>
      }
    >
      {/* Resumen de la Orden */}
      <div className="card" style={{ padding: '.85rem 1rem', marginBottom: '1rem', background: 'var(--bg-subtle, #f8fafc)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '.5rem' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>{fila.codigo}</div>
            <div className="muted" style={{ fontSize: '.84rem' }}>{fila.proveedor}</div>
            {fila.facturaNumero && (
              <div style={{ fontSize: '.78rem', marginTop: '.2rem' }}>
                🧾 Factura: <strong>#{fila.facturaNumero}</strong>
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase' }}>Retención estimada</div>
            <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 800 }}>{fmtBs(fila.montoRetencionBs)}</div>
            <div style={{ display: 'flex', gap: '.25rem', justifyContent: 'flex-end', marginTop: '.25rem' }}>
              {fila.tiposRetencion.map((t) => (
                <span key={t} className="badge info" style={{ fontSize: '.68rem', padding: '.15rem .4rem' }}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Sugerencia detectada en Drive / Caja */}
      {drive && !r && (
        <div
          className="card"
          style={{
            padding: '.75rem 1rem',
            marginBottom: '1rem',
            borderLeft: '4px solid #3b82f6',
            background: 'var(--blue-50, #eff6ff)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '.5rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: '.84rem', color: '#1d4ed8' }}>
              💡 Detectado en libro de Caja Multimoneda
            </div>
            <div style={{ fontSize: '.78rem', color: '#1e3a8a', marginTop: '.15rem' }}>
              Monto: <strong>{fmtBs(drive.montoBs)}</strong> · Ref: <strong>{drive.referencias.join(', ') || '—'}</strong>
            </div>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={aplicarSugerenciaDrive} style={{ fontSize: '.76rem' }}>
            ⚡ Usar datos detectados
          </button>
        </div>
      )}

      {/* Formulario */}
      <form id="form-reintegro" onSubmit={handleSubmit} style={{ display: 'grid', gap: '.85rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
          <label style={{ display: 'grid', gap: '.25rem', fontSize: '.84rem' }}>
            <span style={{ fontWeight: 600 }}>Fecha del reintegro *</span>
            <input
              type="date"
              className="input"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              required
            />
          </label>

          <label style={{ display: 'grid', gap: '.25rem', fontSize: '.84rem' }}>
            <span style={{ fontWeight: 600 }}>Referencia bancaria *</span>
            <input
              type="text"
              className="input mono"
              placeholder="Ej. 35165268"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              required
            />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
          <label style={{ display: 'grid', gap: '.25rem', fontSize: '.84rem' }}>
            <span style={{ fontWeight: 600 }}>Banco / Cuenta de entrada</span>
            <input
              type="text"
              list="bancos-reintegro"
              className="input"
              value={banco}
              onChange={(e) => setBanco(e.target.value)}
              placeholder="Selecciona o escribe..."
            />
            <datalist id="bancos-reintegro">
              {BANCOS_SUGERIDOS.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>

          <label style={{ display: 'grid', gap: '.25rem', fontSize: '.84rem' }}>
            <span style={{ fontWeight: 600 }}>Monto reintegrado (Bs) *</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="input mono"
              placeholder="0.00"
              value={montoBs}
              onChange={(e) => setMontoBs(e.target.value)}
              required
            />
          </label>
        </div>

        {/* Comprobante de pago */}
        <div>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '.84rem', marginBottom: '.25rem' }}>
            Comprobante de entrada (transferencia / recibo)
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setArchivo(f);
              }}
            />
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => fileInputRef.current?.click()}
            >
              {archivo ? '📎 Cambiar archivo' : '📎 Adjuntar comprobante (PDF/imagen)'}
            </button>
            {archivo && (
              <span className="mono" style={{ fontSize: '.76rem', color: '#10b981' }}>
                ✓ {archivo.name}
              </span>
            )}
            {!archivo && r?.comprobantePath && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => void verComprobanteActual()}
                disabled={abriendoDoc}
              >
                {abriendoDoc ? 'Abriendo…' : `📄 Ver comprobante actual (${r.comprobanteNombre || 'archivo'})`}
              </button>
            )}
          </div>
        </div>

        {/* Nota opcional */}
        <label style={{ display: 'grid', gap: '.25rem', fontSize: '.84rem' }}>
          <span className="muted">Nota / Observación (opcional)</span>
          <textarea
            className="input"
            rows={2}
            placeholder="Detalles adicionales sobre el reintegro o la factura..."
            value={nota}
            onChange={(e) => setNota(e.target.value)}
          />
        </label>
      </form>
    </Modal>
  );
}
