import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { aplicarImportacion, type AnalisisImport, type FilaAnalizada } from './inventarioBulk';

interface Props {
  analisis: AnalisisImport;
  /** Almacén del centro/scope actual: destino por defecto de las filas sin columna «almacen». */
  defaultAlmacen?: string | null;
  onClose: () => void;
  onImportado: () => void;
}

const ESTADO_COLOR: Record<AnalisisImport['estado'], string> = {
  Validado: '#10b981',
  Duplicados: '#f59e0b',
  Error: '#ef4444',
};

const ESTADO_ICONO: Record<AnalisisImport['estado'], string> = {
  Validado: '✅',
  Duplicados: '⚠',
  Error: '❌',
};

const FILTROS: Array<{ key: 'todos' | 'error' | 'duplicado' | 'valido'; label: string }> = [
  { key: 'todos', label: 'Todas' },
  { key: 'error', label: 'Con error' },
  { key: 'duplicado', label: 'Duplicadas' },
  { key: 'valido', label: 'Válidas' },
];

export function ImportarExcelModal({ analisis, defaultAlmacen, onClose, onImportado }: Props) {
  const [confirmando, setConfirmando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  // Modo actualización: en vez de omitir los materiales ya existentes, se les actualiza
  // el precio y/o el stock del almacén con lo que trae la plantilla.
  const [actualizar, setActualizar] = useState(false);
  const [filtro, setFiltro] = useState<'todos' | 'error' | 'duplicado' | 'valido'>(
    analisis.conError > 0 ? 'error' : analisis.duplicadas > 0 ? 'duplicado' : 'todos',
  );

  const filas = analisis.filas.filter((f) =>
    filtro === 'todos' ? true : f.estado === filtro,
  );

  const puedeImportar = analisis.estado !== 'Error';
  const necesitaConfirmar = analisis.estado === 'Duplicados';

  async function ejecutar() {
    if (necesitaConfirmar && !confirmando) {
      setConfirmando(true);
      return;
    }
    setAplicando(true);
    try {
      const res = await aplicarImportacion(analisis, { actualizarExistentes: actualizar, defaultAlmacen });
      const partes: string[] = [];
      if (res.insertados) partes.push(`${res.insertados} nuevos`);
      if (res.actualizados) partes.push(`${res.actualizados} actualizados`);
      if (res.actualizadosExistentes) partes.push(`${res.actualizadosExistentes} precios/stock actualizados`);
      if (res.omitidos.length) partes.push(`${res.omitidos.length} ya existían (omitidos)`);
      if (res.errores.length) partes.push(`${res.errores.length} con error`);
      notify(`Importación: ${partes.join(' · ') || '0 cambios'}`, (res.errores.length || res.omitidos.length) ? 'warning' : 'success', { link: '#/app/inventario' });
      onImportado();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo importar', 'error');
    } finally {
      setAplicando(false);
    }
  }

  return (
    <Modal
      title="Importar inventario desde Excel"
      size="xl"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={aplicando}>Cancelar</button>
          {puedeImportar && (
            <button
              className={`btn ${necesitaConfirmar ? 'btn-warning' : 'btn-primary'}`}
              onClick={ejecutar}
              disabled={aplicando}
            >
              {aplicando
                ? 'Importando…'
                : necesitaConfirmar
                  ? confirmando
                    ? 'Sí, importar de todas formas'
                    : '↑ Subir archivo'
                  : '↑ Subir archivo'}
            </button>
          )}
          {!puedeImportar && (
            <button className="btn btn-danger" disabled title="Corregí los errores en el Excel antes de subir">
              ✖ No se puede importar
            </button>
          )}
        </>
      }
    >
      <div style={{ display: 'grid', gap: '.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: '1rem' }}>
        <EstadoCard
          big
          icono={ESTADO_ICONO[analisis.estado]}
          color={ESTADO_COLOR[analisis.estado]}
          titulo={`Estado: ${analisis.estado}`}
          subtitulo={
            analisis.estado === 'Validado'
              ? 'Todos los registros son válidos y nuevos. Importación directa.'
              : analisis.estado === 'Duplicados'
                ? 'Hay materiales que ya existen: NO se re-ingresan, solo se importan los nuevos.'
                : 'El archivo trae errores de datos. Corregilos antes de subir.'
          }
        />
        <EstadoCard icono="∑" color="#64748b" titulo="Total filas" subtitulo={String(analisis.total)} />
        <EstadoCard icono="✓" color="#10b981" titulo="Válidas" subtitulo={String(analisis.validas)} />
        <EstadoCard icono="⚠" color="#f59e0b" titulo="Ya existen / duplicadas" subtitulo={String(analisis.duplicadas)} />
        <EstadoCard icono="❌" color="#ef4444" titulo="Con error" subtitulo={String(analisis.conError)} />
      </div>

      {analisis.duplicadas > 0 && (
        <label className="card" style={{ display: 'flex', gap: '.6rem', alignItems: 'flex-start', padding: '.75rem 1rem', marginBottom: '1rem', borderLeft: `3px solid ${actualizar ? '#10b981' : '#64748b'}`, cursor: 'pointer' }}>
          <input type="checkbox" checked={actualizar} onChange={(e) => setActualizar(e.target.checked)} style={{ marginTop: '.2rem' }} />
          <span>
            <strong>Actualizar precio y stock de los que ya existen</strong>
            <div className="muted" style={{ fontSize: '.8rem', marginTop: '.2rem' }}>
              En vez de omitir los materiales que ya están en el inventario, se les <strong>actualiza el precio</strong> (costo del almacén) y el <strong>stock</strong> del almacén que indique la plantilla.
              Las columnas <strong>en blanco se dejan como están</strong> (no se borra nada). Se cotejan por <strong>nombre</strong> y nunca se crean duplicados.
            </div>
          </span>
        </label>
      )}

      {confirmando && necesitaConfirmar && (
        <div className="card" style={{ borderLeft: '3px solid #f59e0b', padding: '.85rem 1rem', marginBottom: '1rem' }}>
          <strong>⚠ Hay materiales que ya existen</strong>
          <p style={{ margin: '.35rem 0 0' }}>
            {analisis.duplicadas} fila(s) coinciden por nombre (o SKU) con otras del archivo o con
            materiales que <strong>ya están en el inventario</strong>. {actualizar
              ? <>Como marcaste <strong>«Actualizar precio y stock»</strong>, a esos materiales se les <strong>actualizará el precio y el stock</strong> (sin crear duplicados). ¿Querés continuar?</>
              : <>Al subir, esos materiales <strong>NO se vuelven a ingresar</strong> (para no duplicarlos): se importan solo los <strong>nuevos</strong>. ¿Querés continuar?</>}
          </p>
        </div>
      )}

      {Object.keys(analisis.errorPorColumna).length > 0 && (
        <div className="card" style={{ padding: '.75rem 1rem', marginBottom: '1rem' }}>
          <div className="card-title" style={{ marginBottom: '.5rem' }}>
            <span>Errores por columna</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
            {Object.entries(analisis.errorPorColumna).map(([col, n]) => (
              <span key={col} className="badge danger" style={{ padding: '.25rem .55rem' }}>
                {col}: {n}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginBottom: '.5rem', alignItems: 'center' }}>
        <strong>Detalle de filas</strong>
        <div className="view-switch" style={{ marginTop: 0, padding: '.15rem' }}>
          {FILTROS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`view-switch-tab${filtro === f.key ? ' active' : ''}`}
              onClick={() => setFiltro(f.key)}
              style={{ padding: '.25rem .65rem', fontSize: '.74rem' }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="muted mono" style={{ marginLeft: 'auto', fontSize: '.75rem' }}>
          {filas.length} fila(s)
        </span>
      </div>

      <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
        <table className="table" style={{ fontSize: '.78rem' }}>
          <thead>
            <tr>
              <th style={{ width: 50 }}>Fila</th>
              <th>SKU</th>
              <th>Nombre</th>
              <th>Estado</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <FilaTr key={f.fila} fila={f} />
            ))}
            {filas.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Sin filas para este filtro.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="hint muted" style={{ fontSize: '.75rem', marginTop: '.75rem' }}>
        Las filas con error nunca se importan, ni siquiera cuando se sube el archivo. Si necesitás
        forzar la importación de un registro problemático, corregí los datos en el Excel y volvé a subirlo.
      </p>
    </Modal>
  );
}

function EstadoCard({ icono, color, titulo, subtitulo, big }: {
  icono: string;
  color: string;
  titulo: string;
  subtitulo: string;
  big?: boolean;
}) {
  return (
    <div className="card" style={{ borderLeft: `3px solid ${color}`, padding: big ? '.85rem 1rem' : '.6rem .85rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <div style={{ fontSize: big ? '1.4rem' : '1.05rem' }}>{icono}</div>
        <div>
          <div style={{ fontWeight: 600, color }}>{titulo}</div>
          <div className={big ? '' : 'muted'} style={{ fontSize: big ? '.78rem' : '1.05rem', fontWeight: big ? 400 : 600 }}>{subtitulo}</div>
        </div>
      </div>
    </div>
  );
}

function FilaTr({ fila }: { fila: FilaAnalizada }) {
  if (fila.estado === 'valido') {
    return (
      <tr>
        <td className="mono">{fila.fila}</td>
        <td className="mono">{fila.sku || '—'}</td>
        <td>{fila.nombre || '—'}</td>
        <td><span className="badge success">Válida</span></td>
        <td className="muted">OK</td>
      </tr>
    );
  }

  const detalles: string[] = [];
  if (fila.errores.length) detalles.push(...fila.errores);
  // Los materiales ya existentes por nombre (o repetidos en el archivo) NO se re-ingresan.
  if (fila.duplicadoEnBd) detalles.push(`Ya existe en el inventario (${fila.duplicadoEnBd})${(fila.duplicadoEnBd === 'nombre' || fila.duplicadoEnBd === 'ambos') ? ' — no se importa' : ''}`);
  if (fila.duplicadoEnArchivo) detalles.push(`Repetido en el archivo (${fila.duplicadoEnArchivo})${(fila.duplicadoEnArchivo === 'nombre' || fila.duplicadoEnArchivo === 'ambos') ? ' — se importa una vez' : ''}`);

  return (
    <tr>
      <td className="mono">{fila.fila}</td>
      <td className="mono">{fila.sku || '—'}</td>
      <td>{fila.nombre || '—'}</td>
      <td>
        {fila.estado === 'error'
          ? <span className="badge danger">Error</span>
          : <span className="badge warning">Duplicado</span>}
      </td>
      <td>{detalles.join(' · ')}</td>
    </tr>
  );
}
