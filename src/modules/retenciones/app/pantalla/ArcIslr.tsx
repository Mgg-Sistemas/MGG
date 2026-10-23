/* ============================================================
   MGG · Retenciones v8 · «📄 Comprobante ARC (ISLR)» (botón y diálogo)

   Emisión del Comprobante Anual de Retenciones de ISLR (Forma ARC)
   según el Artículo 24 del Decreto N° 1.808 (Reglamento Parcial de la
   Ley de ISLR en materia de Retenciones).
   Permite seleccionar el ejercicio fiscal anual y el proveedor (sujeto
   retenido), mostrando el acumulado mensual y generando el PDF con
   código QR y huella digital SHA-256 (PA 0084 y 0093).
   ============================================================ */

import { useEffect, useMemo, useState } from 'react';
import { money } from '@/shared/lib/format';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { usePuerta, type ConfigRetencion, type RetencionPracticada } from '../datos/puerta';
import { compilarDatosArc, verComprobanteArcPdf } from '../../comprobanteArcPdf';
import { CONFIG_RETENCION_DEFECTO } from '../../retencionesCalculo';
import './rv8-txt.css';

export function BotonArcIslr({ libro }: { libro: readonly RetencionPracticada[] }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setAbierto(true)}
        title="Comprobante de Retención de ISLR Anual por Proveedor (Forma ARC - Art. 24 Decreto 1.808)"
      >
        📄 Comprobante ARC (ISLR)
      </button>
      {abierto && <DialogoArcIslr libro={libro} onCerrar={() => setAbierto(false)} />}
    </>
  );
}

export function DialogoArcIslr({
  libro,
  onCerrar,
  proveedorRifInicial,
  anioInicial,
}: {
  libro: readonly RetencionPracticada[];
  onCerrar: () => void;
  proveedorRifInicial?: string;
  anioInicial?: number;
}) {
  const puerta = usePuerta();
  const [config, setConfig] = useState<ConfigRetencion | null>(null);
  const [anio, setAnio] = useState<number>(() => anioInicial ?? new Date().getFullYear());
  const [rifSeleccionado, setRifSeleccionado] = useState<string>(() => proveedorRifInicial ?? '');
  const [generando, setGenerando] = useState(false);

  useEffect(() => {
    let vivo = true;
    puerta
      .config()
      .then((c) => {
        if (vivo) setConfig(c);
      })
      .catch((e: unknown) =>
        toast(e instanceof Error ? e.message : 'No se pudo leer la configuración fiscal.', 'error')
      );
    return () => {
      vivo = false;
    };
  }, [puerta]);

  // Lista de años presentes en las retenciones de ISLR
  const aniosDisponibles = useMemo(() => {
    const setAnios = new Set<number>();
    setAnios.add(new Date().getFullYear());
    for (const r of libro) {
      if (r.tipo === 'islr') {
        const y = Number((r.facturaFecha || r.createdAt || '').slice(0, 4));
        if (Number.isFinite(y) && y >= 2020 && y <= 2035) setAnios.add(y);
      }
    }
    return [...setAnios].sort((a, b) => b - a);
  }, [libro]);

  // Proveedores con retenciones practicadas de ISLR en el año seleccionado
  const proveedores = useMemo(() => {
    const mapa = new Map<string, string>();
    const anioStr = String(anio);
    for (const r of libro) {
      if (r.tipo === 'islr' && r.direccion === 'practicada' && !r.anulada && r.contraparteRif) {
        const fecha = (r.facturaFecha || r.createdAt || '').slice(0, 4);
        if (fecha === anioStr || (r.periodo && r.periodo.startsWith(anioStr))) {
          mapa.set(r.contraparteRif, r.contraparteNombre || r.contraparteRif);
        }
      }
    }
    return [...mapa.entries()]
      .map(([rif, nombre]) => ({ rif, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [libro, anio]);

  // Si cambia el año y el proveedor actual ya no está, reajustar si es necesario
  useEffect(() => {
    if (rifSeleccionado && !proveedores.some((p) => p.rif === rifSeleccionado)) {
      setRifSeleccionado(proveedores[0]?.rif ?? '');
    } else if (!rifSeleccionado && proveedores.length > 0) {
      setRifSeleccionado(proveedores[0].rif);
    }
  }, [proveedores, rifSeleccionado]);

  // Resumen del ARC compilado para el proveedor y año elegidos
  const datosArc = useMemo(() => {
    if (!rifSeleccionado) return null;
    return compilarDatosArc(anio, rifSeleccionado, libro as RetencionPracticada[]);
  }, [anio, rifSeleccionado, libro]);

  const emitirPdf = async () => {
    if (!rifSeleccionado || !datosArc) {
      toast('Seleccione un proveedor para generar el comprobante ARC.', 'error');
      return;
    }
    setGenerando(true);
    try {
      await verComprobanteArcPdf(
        anio,
        rifSeleccionado,
        libro as RetencionPracticada[],
        config ?? CONFIG_RETENCION_DEFECTO,
        { incluirLogo: true, incluirQr: true }
      );
      toast('Comprobante ARC generado correctamente.', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el comprobante ARC.', 'error');
    } finally {
      setGenerando(false);
    }
  };

  const footer = (
    <>
      <span className="rv8-txt-huella">
        Art. 24 Decreto 1.808 · Certificación oficial con QR y SHA-256 (PA 0084 y 0093).
      </span>
      <button type="button" className="btn btn-ghost" onClick={onCerrar}>
        Cerrar
      </button>
      <button
        type="button"
        className="btn btn-primary"
        disabled={!datosArc || datosArc.totalOperaciones === 0 || generando}
        onClick={emitirPdf}
      >
        {generando ? 'Generando PDF…' : 'Ver / Descargar ARC (PDF)'}
      </button>
    </>
  );

  return (
    <Modal
      title="Comprobante Anual ARC de ISLR (Art. 24 Decreto 1.808)"
      size="lg"
      onClose={onCerrar}
      footer={footer}
    >
      <p className="rv8-txt-huella" style={{ marginBottom: '.8rem' }}>
        Relación anual consolidada de retenciones de Impuesto sobre la Renta practicadas al
        proveedor durante el ejercicio fiscal (enero a diciembre), con verificación digital.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem', marginBottom: '1rem' }}>
        <label className="rv8-txt-campo">
          <span>Ejercicio Fiscal (Año)</span>
          <select
            className="select"
            value={anio}
            onChange={(e) => setAnio(Number(e.target.value) || new Date().getFullYear())}
          >
            {aniosDisponibles.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>

        <label className="rv8-txt-campo">
          <span>Proveedor (Sujeto Retenido)</span>
          <select
            className="select"
            value={rifSeleccionado}
            onChange={(e) => setRifSeleccionado(e.target.value)}
          >
            {!proveedores.length && (
              <option value="">Sin proveedores con retenciones de ISLR en {anio}</option>
            )}
            {proveedores.map((p) => (
              <option key={p.rif} value={p.rif}>
                {p.nombre} ({p.rif})
              </option>
            ))}
          </select>
        </label>
      </div>

      {datosArc && (
        <div style={{ background: 'var(--surface-sunken, #161b22)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border, #30363d)' }}>
          <p className="rv8-txt-sub" style={{ margin: 0 }}>
            <b>{datosArc.proveedorNombre}</b> · RIF: <span className="mono">{datosArc.proveedorRif}</span>
          </p>
          <div style={{ display: 'flex', gap: '1.5rem', marginTop: '.6rem', flexWrap: 'wrap' }}>
            <div>
              <span className="muted" style={{ fontSize: '.8rem' }}>Operaciones en el año:</span>{' '}
              <b>{datosArc.totalOperaciones}</b>
            </div>
            <div>
              <span className="muted" style={{ fontSize: '.8rem' }}>Base imponible total:</span>{' '}
              <b>{money(datosArc.totalBaseBs, 'Bs')}</b>
            </div>
            <div>
              <span className="muted" style={{ fontSize: '.8rem' }}>ISLR retenido total:</span>{' '}
              <b style={{ color: 'var(--accent, #6366f1)' }}>{money(datosArc.totalRetenidoBs, 'Bs')}</b>
            </div>
          </div>
          {datosArc.totalOperaciones === 0 && (
            <p className="rv8-txt-huella" style={{ marginTop: '.6rem', color: 'var(--warning, #e3b341)' }}>
              No hay retenciones de ISLR registradas para este proveedor en el año fiscal {anio}.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
