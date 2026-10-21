/* ============================================================
   MGG · Proveedores · «⬇ Descargar datos» · 21-10-2026
   Casillas para elegir QUÉ datos salen en el reporte (PDF y Excel),
   orientación de la hoja, vista previa y descarga directa.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import type { Proveedor } from '@/shared/lib/types';
import {
  CAMPOS_BASICOS,
  CAMPOS_EXPORT_PROVEEDORES,
  CAMPOS_POR_DEFECTO,
  camposElegidosProveedores,
  tablaExportProveedores,
} from './exportarProveedores';
import type { OrientacionPdf } from './proveedoresPdf';
import { listActividades } from './actividades.repository';
import type { ActividadEconomica } from './ciiu';

const CLAVE_CAMPOS = 'mgg.proveedores.exportar.campos';

function camposGuardados(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_CAMPOS) ?? 'null');
    if (Array.isArray(v)) {
      const validos = v.filter((k) => CAMPOS_EXPORT_PROVEEDORES.some((c) => c.key === k));
      if (validos.length) return validos;
    }
  } catch {
    /* sin almacenamiento: se usan los de por defecto */
  }
  return [...CAMPOS_POR_DEFECTO];
}

export function ExportarProveedoresModal({
  proveedores,
  filtros,
  onClose,
}: {
  proveedores: Proveedor[];
  filtros: string;
  onClose: () => void;
}) {
  const [campos, setCampos] = useState<string[]>(camposGuardados);
  const [orientacion, setOrientacion] = useState<OrientacionPdf>('auto');
  const [generando, setGenerando] = useState<'excel' | 'pdf' | null>(null);
  const [actividades, setActividades] = useState<ActividadEconomica[]>([]);

  useEffect(() => {
    let vivo = true;
    listActividades()
      .then((acts) => {
        if (vivo) setActividades(acts);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  const marcado = (k: string) => campos.includes(k);
  function toggle(k: string) {
    setCampos((cs) => (cs.includes(k) ? cs.filter((x) => x !== k) : [...cs, k]));
  }

  // Ordenar alfabéticamente por razón social para la descarga
  const proveedoresOrdenados = useMemo(() => {
    return [...proveedores].sort((a, b) => (a.razon_social ?? '').localeCompare(b.razon_social ?? ''));
  }, [proveedores]);

  // Ancho estimado para calcular si en "auto" sale horizontal o vertical
  const camposActivos = useMemo(() => camposElegidosProveedores(campos), [campos]);
  const anchoTotal = useMemo(() => 6 + camposActivos.reduce((acc, c) => acc + c.ancho, 0), [camposActivos]);
  const esHorizontal = orientacion === 'horizontal' || (orientacion === 'auto' && (anchoTotal > 80 || campos.length > 6));

  async function generar(tipo: 'excel' | 'pdf') {
    if (!campos.length) {
      toast('Marca al menos un dato para exportar.', 'error');
      return;
    }
    if (!proveedoresOrdenados.length) {
      toast('No hay proveedores en la lista para exportar.', 'error');
      return;
    }
    try {
      localStorage.setItem(CLAVE_CAMPOS, JSON.stringify(campos));
    } catch {
      /* opcional */
    }
    setGenerando(tipo);
    try {
      if (tipo === 'excel') {
        const { exportarProveedoresExcel } = await import('./proveedoresExcel');
        await exportarProveedoresExcel(proveedoresOrdenados, filtros, {
          keys: campos,
          actividades,
        });
      } else {
        const { descargarProveedoresPdf } = await import('./proveedoresPdf');
        await descargarProveedoresPdf(proveedoresOrdenados, filtros, {
          keys: campos,
          orientacion,
          actividades,
        });
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el archivo', 'error');
    } finally {
      setGenerando(null);
    }
  }

  // Muestra de las 3 primeras filas para vista previa
  const muestra = useMemo(() => {
    return tablaExportProveedores(proveedoresOrdenados.slice(0, 3), campos, actividades);
  }, [proveedoresOrdenados, campos, actividades]);

  return (
    <Modal
      title="⬇ Descargar datos de proveedores"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={!!generando}>
            Cerrar
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => void generar('excel')}
            disabled={!!generando || !campos.length}
          >
            {generando === 'excel' ? 'Generando…' : '📊 Excel'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void generar('pdf')}
            disabled={!!generando || !campos.length}
          >
            {generando === 'pdf' ? 'Generando…' : '📄 PDF para imprimir'}
          </button>
        </>
      }
    >
      <p className="hint muted" style={{ margin: '0 0 1rem' }}>
        Marca los datos que quieres que salgan. Se descargan <strong>{proveedoresOrdenados.length} proveedor(es)</strong>, ordenados por razón social.
      </p>

      {/* Botones de selección rápida */}
      <div className="form-row">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
          <label style={{ margin: 0 }}>
            ¿Qué datos? <span className="muted" style={{ fontWeight: 400 }}>({campos.length} de {CAMPOS_EXPORT_PROVEEDORES.length} marcados)</span>
          </label>
          <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setCampos([...CAMPOS_BASICOS])}
            >
              Solo RIF y razón social
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setCampos(CAMPOS_EXPORT_PROVEEDORES.map((c) => c.key))}
            >
              Marcar todos
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setCampos([])}
            >
              Ninguno
            </button>
          </div>
        </div>

        {/* Cuadrícula de 3 columnas para las casillas */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '.55rem .8rem',
            padding: '.75rem',
            background: 'var(--bg-card, rgba(255, 255, 255, 0.03))',
            borderRadius: '6px',
            border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
          }}
        >
          {CAMPOS_EXPORT_PROVEEDORES.map((c) => (
            <label
              key={c.key}
              style={{
                display: 'inline-flex',
                gap: '.45rem',
                alignItems: 'center',
                cursor: 'pointer',
                fontSize: '.9rem',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={marcado(c.key)}
                onChange={() => toggle(c.key)}
              />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Orientación de la hoja */}
      <div className="form-row" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
          <label style={{ margin: 0, fontWeight: 600 }}>Hoja</label>
          <select
            className="select"
            style={{ maxWidth: 280 }}
            value={orientacion}
            onChange={(e) => setOrientacion(e.target.value as OrientacionPdf)}
          >
            <option value="auto">Automática (según las columnas)</option>
            <option value="horizontal">Horizontal</option>
            <option value="vertical">Vertical</option>
          </select>
          <span className="muted" style={{ fontSize: '.85rem' }}>
            {esHorizontal
              ? 'Sale en horizontal. Al imprimir, elige la misma orientación.'
              : 'Sale en vertical. Al imprimir, elige la misma orientación.'}
          </span>
        </div>
      </div>

      {/* Vista previa de cómo va a salir */}
      {campos.length > 0 && proveedoresOrdenados.length > 0 && (
        <div className="form-row" style={{ marginTop: '1rem' }}>
          <label>
            Así va a salir{' '}
            <span className="muted" style={{ fontWeight: 400 }}>
              (primeras {Math.min(3, proveedoresOrdenados.length)} de {proveedoresOrdenados.length})
            </span>
          </label>
          <div className="table-wrap" style={{ maxHeight: '180px', overflowY: 'auto' }}>
            <table className="table" style={{ fontSize: '.8rem' }}>
              <thead>
                <tr>
                  {muestra.head.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {muestra.filas.map((f, i) => (
                  <tr key={i}>
                    {f.map((v, j) => (
                      <td key={j}>{v || <span className="muted">—</span>}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
