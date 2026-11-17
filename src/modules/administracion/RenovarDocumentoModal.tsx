/* ============================================================
   Golden Touch · Administración · Modal de Renovación de Documento
   Permite renovar un permiso/papel legal con nuevo soporte digital,
   nuevas fechas de vigencia y trazabilidad estricta en el historial.
   ============================================================ */

import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useSession } from '@/modules/auth/authStore';
import type { DocumentoEmpresa, AdminRepo } from './admin.repository';
import type { Moneda } from './administracionCalculo';
import { diasRestantes } from './admin.repository';

function tamanoFmt(b: number | null): string {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  documento: DocumentoEmpresa;
  repo: AdminRepo;
  onClose: () => void;
  onRenovado: (actualizado: DocumentoEmpresa) => void;
}

export function RenovarDocumentoModal({
  documento,
  repo,
  onClose,
  onRenovado,
}: Props) {
  const { user } = useSession();
  const actor = user?.email || 'Usuario';

  // Metadatos editables en la renovación
  const [titulo, setTitulo] = useState(documento.nombre);
  const [fechaEmision, setFechaEmision] = useState(() => new Date().toISOString().slice(0, 10));
  const [fechaVencimiento, setFechaVencimiento] = useState('');
  const [numeroRegistro, setNumeroRegistro] = useState(documento.numeroRegistro || '');
  const [notaTramite, setNotaTramite] = useState('');
  const [costoGestion, setCostoGestion] = useState<string>(documento.costoGestion ? String(documento.costoGestion) : '');
  const [monedaCosto, setMonedaCosto] = useState<Moneda>(documento.monedaCosto || 'USD');

  // Archivo nuevo
  const [nuevoArchivo, setNuevoArchivo] = useState<File | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Nombre del archivo actual
  const nombreArchivoActual = documento.path.split('/').pop() || documento.path;

  // Días que durará la nueva vigencia
  const diasCalculados = fechaVencimiento ? diasRestantes(fechaVencimiento) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim()) {
      toast('El título del documento es obligatorio.', 'warning');
      return;
    }
    if (!fechaVencimiento) {
      toast('Indica la nueva fecha de vencimiento del documento renovado.', 'warning');
      return;
    }

    setGuardando(true);
    try {
      const costoNum = costoGestion ? Number(costoGestion.replace(',', '.')) : null;
      const docActualizado = await repo.renovarDocumento(
        documento.id,
        nuevoArchivo,
        {
          nombre: titulo.trim(),
          fechaEmision: fechaEmision || null,
          fechaVencimiento,
          numeroRegistro: numeroRegistro.trim() || null,
          notaTramite: notaTramite.trim() || null,
          costoGestion: Number.isFinite(costoNum) ? costoNum : null,
          monedaCosto,
        },
        actor,
      );

      toast('¡Documento renovado con éxito! Se registró la trazabilidad en el historial.', 'success');
      onRenovado(docActualizado);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error al renovar documento.', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      title={`🔄 Renovar Documento · ${documento.nombre}`}
      size="lg"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', width: '100%' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ background: '#ff8a00', color: '#000', fontWeight: 700, borderColor: '#ff8a00' }}
            onClick={(e) => void handleSubmit(e)}
            disabled={guardando || !fechaVencimiento || !titulo.trim()}
          >
            {guardando ? 'Renovando…' : '🔄 Confirmar Renovación'}
          </button>
        </div>
      }
    >
      <form onSubmit={(e) => void handleSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Banner Informativo del Estado Anterior */}
        <div
          style={{
            padding: '.75rem 1rem',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            fontSize: '.82rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.4rem' }}>
            <div>
              <span className="muted">Archivo actual: </span>
              <strong style={{ color: '#ff8a00' }}>📎 {nombreArchivoActual}</strong>
              <span className="muted mono" style={{ fontSize: '.75rem', marginLeft: '.4rem' }}>
                ({tamanoFmt(documento.tamano)})
              </span>
            </div>
            <div>
              <span className="muted">Vigencia anterior: </span>
              <span className="badge warning" style={{ fontSize: '.72rem' }}>
                {documento.fechaVencimiento || 'Sin fecha'}
              </span>
            </div>
          </div>
          <p className="hint muted" style={{ margin: '.35rem 0 0', fontSize: '.74rem' }}>
            Al renovar, el título permanece en el sistema para control administrativo y el historial cronológico guarda quién realizó la renovación y qué archivo se actualizó.
          </p>
        </div>

        {/* Título permanente del documento */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          <span style={{ fontWeight: 600, fontSize: '.84rem' }}>
            Título o Identificador del Documento *
          </span>
          <input
            className="input"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ej.: Permiso RUM 2026-2027, Solvencia Laboral INCES…"
            required
            disabled={guardando}
          />
          <span className="muted hint" style={{ fontSize: '.72rem' }}>
            Este título identifica al documento en todos los reportes, independiente del nombre del archivo físico.
          </span>
        </label>

        {/* Zona de subida del nuevo archivo digital */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          <span style={{ fontWeight: 600, fontSize: '.84rem' }}>
            Nuevo Soporte Digital (PDF o Imagen escaneada)
          </span>
          <div
            onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArrastrando(false);
              const f = e.dataTransfer.files?.[0];
              if (f) setNuevoArchivo(f);
            }}
            style={{
              border: `2px dashed ${arrastrando ? '#ff8a00' : 'var(--border)'}`,
              borderRadius: '8px',
              padding: '1.25rem',
              textAlign: 'center',
              background: arrastrando ? 'rgba(255, 138, 0, 0.05)' : 'var(--surface-1)',
              cursor: 'pointer',
              transition: 'all .15s ease',
            }}
            onClick={() => {
              const input = document.getElementById('nuevo-archivo-renovacion');
              input?.click();
            }}
          >
            <input
              id="nuevo-archivo-renovacion"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setNuevoArchivo(f);
              }}
            />
            {nuevoArchivo ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.6rem' }}>
                <span style={{ fontSize: '1.5rem' }}>📄</span>
                <div style={{ textAlign: 'left' }}>
                  <strong style={{ color: '#ff8a00', fontSize: '.88rem' }}>{nuevoArchivo.name}</strong>
                  <div className="muted" style={{ fontSize: '.74rem' }}>{tamanoFmt(nuevoArchivo.size)}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  style={{ color: '#ef4444', marginLeft: '.5rem' }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setNuevoArchivo(null);
                  }}
                >
                  ✕ Quitar
                </button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '1.4rem', marginBottom: '.3rem' }}>📁 ⬆️</div>
                <strong style={{ fontSize: '.85rem' }}>Arrastra aquí el nuevo archivo renovado o haz clic</strong>
                <p className="muted hint" style={{ margin: '.2rem 0 0', fontSize: '.74rem' }}>
                  Admite PDF o imágenes escaneadas de hasta 50 MB. Si no seleccionas uno nuevo, se mantendrá el archivo actual y se actualizarán solo las fechas y registros.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Fechas de la nueva vigencia */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '.75rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
            <span style={{ fontWeight: 600, fontSize: '.82rem' }}>Fecha de Emisión / Expedición</span>
            <input
              type="date"
              className="input"
              value={fechaEmision}
              onChange={(e) => setFechaEmision(e.target.value)}
              disabled={guardando}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
            <span style={{ fontWeight: 600, fontSize: '.82rem', color: '#ff8a00' }}>
              Nueva Fecha de Vencimiento *
            </span>
            <input
              type="date"
              className="input"
              value={fechaVencimiento}
              onChange={(e) => setFechaVencimiento(e.target.value)}
              required
              disabled={guardando}
            />
          </label>
        </div>

        {/* Cuenta regresiva en vivo */}
        {diasCalculados !== null && (
          <div
            style={{
              padding: '.4rem .8rem',
              borderRadius: '6px',
              background: diasCalculados > 30 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(234, 179, 8, 0.12)',
              color: diasCalculados > 30 ? '#10b981' : '#eab308',
              fontSize: '.78rem',
              fontWeight: 600,
            }}
          >
            ⏳ Nueva vigencia calculada: {diasCalculados} días restantes (quedará en estado «Vigente»).
          </div>
        )}

        {/* Número de Registro y Costo de Gestión */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '.75rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
            <span style={{ fontWeight: 600, fontSize: '.82rem' }}>N° de Registro / Trámite / Resolución</span>
            <input
              className="input"
              value={numeroRegistro}
              onChange={(e) => setNumeroRegistro(e.target.value)}
              placeholder="Ej.: Gaceta N° 42.123, Oficio N° 084…"
              disabled={guardando}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
            <span style={{ fontWeight: 600, fontSize: '.82rem' }}>Costo de Renovación / Arancel (Opcional)</span>
            <div style={{ display: 'flex', gap: '.3rem' }}>
              <select
                className="input"
                style={{ width: '80px' }}
                value={monedaCosto}
                onChange={(e) => setMonedaCosto(e.target.value as Moneda)}
                disabled={guardando}
              >
                <option value="USD">USD</option>
                <option value="Bs">Bs</option>
              </select>
              <input
                type="number"
                step="0.01"
                className="input"
                value={costoGestion}
                onChange={(e) => setCostoGestion(e.target.value)}
                placeholder="0.00"
                disabled={guardando}
                style={{ flex: 1 }}
              />
            </div>
          </label>
        </div>

        {/* Nota de Renovación */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          <span style={{ fontWeight: 600, fontSize: '.82rem' }}>Nota de Renovación / Observación</span>
          <textarea
            className="input"
            rows={2}
            value={notaTramite}
            onChange={(e) => setNotaTramite(e.target.value)}
            placeholder="Ej.: Trámite realizado ante la Dirección General de Minas. Arancel cancelado."
            disabled={guardando}
          />
        </label>
      </form>
    </Modal>
  );
}
