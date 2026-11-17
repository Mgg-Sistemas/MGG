/* ============================================================
   Golden Touch · Administración · importar histórico (Excel/CSV) con validación
   Mismo patrón que la carga de Depósito Mina: se elige archivo (xlsx/xls/CSV) o
   se pega el CSV, se ANALIZA (válidas / duplicadas / con error, errores por
   columna, duplicado en archivo y contra la base) y solo se importan las filas
   válidas. Las filas con error nunca entran; los duplicados piden confirmación.
   ============================================================ */
import { useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { analizarArchivoAdmin, analizarTextoAdmin, aplicarImportacionAdmin, descargarPlantillaAdminExcel } from './administracionBulk';
import type { AnalisisImportAdmin, ExistenteMov, FilaAnalizadaAdmin } from './administracionImport';
import type { AdminRepo, Empresa, OpcionRef } from './admin.repository';

const ESTADO_COLOR: Record<AnalisisImportAdmin['estado'], string> = { Validado: '#10b981', Duplicados: '#f59e0b', Error: '#ef4444' };
const ESTADO_ICONO: Record<AnalisisImportAdmin['estado'], string> = { Validado: '✅', Duplicados: '⚠', Error: '❌' };
const FILTROS: { key: 'todos' | 'error' | 'duplicado' | 'valido'; label: string }[] = [
  { key: 'todos', label: 'Todas' }, { key: 'error', label: 'Con error' }, { key: 'duplicado', label: 'Duplicadas' }, { key: 'valido', label: 'Válidas' },
];

export function ImportarAdminModal({ repo, empresas, categorias, existentes, onClose, onImportado }: {
  repo: AdminRepo;
  empresas: Empresa[];
  categorias: OpcionRef[];
  /** Movimientos ya cargados, para detectar duplicados contra la base. */
  existentes: ExistenteMov[];
  onClose: () => void;
  onImportado: () => void;
}) {
  const ctx = useMemo(() => ({ empresas: empresas.map((e) => ({ clave: e.clave, nombre: e.nombre })), categorias }), [empresas, categorias]);
  const [texto, setTexto] = useState('');
  const [analisis, setAnalisis] = useState<AnalisisImportAdmin | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [filtro, setFiltro] = useState<'todos' | 'error' | 'duplicado' | 'valido'>('todos');
  const [confirmando, setConfirmando] = useState(false);
  const [aplicando, setAplicando] = useState(false);

  function tras(a: AnalisisImportAdmin) {
    setAnalisis(a);
    setErrMsg(null);
    setConfirmando(false);
    setFiltro(a.conError > 0 ? 'error' : a.duplicadas > 0 ? 'duplicado' : 'todos');
  }
  async function analizarFile(file: File | undefined) {
    if (!file) return;
    setAnalizando(true); setErrMsg(null); setAnalisis(null); setConfirmando(false); setTexto('');
    try { tras(await analizarArchivoAdmin(file, ctx, existentes)); }
    catch (e) { setErrMsg(e instanceof Error ? e.message : 'No se pudo leer el archivo.'); }
    finally { setAnalizando(false); }
  }
  function analizarTxt(t: string) {
    setTexto(t); setConfirmando(false);
    if (!t.trim()) { setAnalisis(null); setErrMsg(null); return; }
    try { tras(analizarTextoAdmin(t, ctx, existentes)); }
    catch (e) { setAnalisis(null); setErrMsg(e instanceof Error ? e.message : 'No se pudo analizar.'); }
  }
  async function plantilla() {
    try { await descargarPlantillaAdminExcel(empresas.map((e) => ({ clave: e.clave, nombre: e.nombre }))); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar la plantilla.', 'error'); }
  }

  const puedeImportar = !!analisis && analisis.estado !== 'Error' && (analisis.validas + analisis.duplicadas) > 0;
  const necesitaConfirmar = analisis?.estado === 'Duplicados';
  const filas = analisis ? analisis.filas.filter((f) => (filtro === 'todos' ? true : f.estado === filtro)) : [];

  async function ejecutar() {
    if (!analisis) return;
    if (necesitaConfirmar && !confirmando) { setConfirmando(true); return; }
    setAplicando(true);
    try {
      const r = await aplicarImportacionAdmin(repo, analisis);
      toast(`Importados ${r.insertados} movimiento(s)${r.errores ? ` · ${r.errores} con error` : ''}.`, r.errores ? 'warning' : 'success');
      onImportado();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo importar.', 'error');
    } finally {
      setAplicando(false);
    }
  }

  return (
    <Modal title="⬆ Importar histórico" size="xl" onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={aplicando}>Cancelar</button>
          {analisis && !puedeImportar && (
            <button type="button" className="btn btn-danger" disabled title="Corregí los errores antes de importar">✖ No se puede importar</button>
          )}
          {puedeImportar && (
            <button type="button" className={`btn ${necesitaConfirmar ? 'btn-warning' : 'btn-primary'}`} onClick={() => void ejecutar()} disabled={aplicando}>
              {aplicando ? 'Importando…' : necesitaConfirmar && confirmando ? 'Sí, importar de todas formas' : `↑ Importar ${analisis.validas + analisis.duplicadas} fila(s)`}
            </button>
          )}
        </>
      }>
      <p className="muted hint" style={{ marginTop: 0 }}>
        Archivo <b>Excel</b> (.xlsx) o <b>CSV</b>, o pegá el CSV. Columnas: <b>empresa, fecha, concepto, monto, moneda</b> (obligatorias) · proveedor, periodo, categoria, estado, nota (opcionales).
      </p>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.5rem' }}>
        <input type="file" accept=".csv,.txt,.xlsx,.xls" className="input" onChange={(e) => void analizarFile(e.target.files?.[0])} style={{ maxWidth: 320 }} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void plantilla()}>⬇ Descargar plantilla</button>
        {analizando && <span className="muted">Analizando…</span>}
      </div>
      <textarea className="input" style={{ width: '100%', minHeight: 90, fontFamily: 'monospace', fontSize: '.82rem' }}
        value={texto} onChange={(e) => analizarTxt(e.target.value)} placeholder={'…o pegá el CSV:\nempresa,fecha,concepto,monto,moneda\nGT,2026-10-05,Agua,"1.800,00",Bs'} />

      {errMsg && <div className="adm-aviso" style={{ marginTop: '.6rem' }}>{errMsg}</div>}

      {analisis && (
        <>
          <div style={{ display: 'grid', gap: '.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', margin: '.9rem 0' }}>
            <EstadoCard big icono={ESTADO_ICONO[analisis.estado]} color={ESTADO_COLOR[analisis.estado]} titulo={`Estado: ${analisis.estado}`}
              subtitulo={analisis.estado === 'Validado' ? 'Todas las filas son válidas. Importación directa.' : analisis.estado === 'Duplicados' ? 'Hay filas duplicadas. Confirmá para continuar.' : 'Hay filas con error. Corregilas antes de importar.'} />
            <EstadoCard icono="∑" color="#64748b" titulo="Total filas" subtitulo={String(analisis.total)} />
            <EstadoCard icono="✓" color="#10b981" titulo="Válidas" subtitulo={String(analisis.validas)} />
            <EstadoCard icono="⚠" color="#f59e0b" titulo="Duplicadas" subtitulo={`${analisis.duplicadas} (${analisis.yaEnBd} ya en el sistema)`} />
            <EstadoCard icono="❌" color="#ef4444" titulo="Con error" subtitulo={String(analisis.conError)} />
          </div>

          {Object.keys(analisis.errorPorColumna).length > 0 && (
            <div className="card" style={{ padding: '.6rem .85rem', marginBottom: '.8rem' }}>
              <div className="card-title" style={{ marginBottom: '.4rem' }}><span>Errores por columna</span></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
                {Object.entries(analisis.errorPorColumna).map(([col, n]) => (
                  <span key={col} className="adm-badge pago-pendiente" style={{ padding: '.2rem .5rem' }}>{col}: {n}</span>
                ))}
              </div>
            </div>
          )}

          {confirmando && necesitaConfirmar && (
            <div className="adm-aviso demo" style={{ marginBottom: '.8rem' }}>
              <b>⚠ Hay {analisis.duplicadas} fila(s) duplicada(s)</b> (misma empresa + período + concepto; {analisis.yaEnBd} ya existen en el sistema). Si continuás, se cargan igual como movimientos nuevos. ¿Seguir?
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'center', marginBottom: '.4rem' }}>
            <strong style={{ fontSize: '.9rem' }}>Detalle de filas</strong>
            <div className="view-toggle" role="tablist" aria-label="Filtro de filas" style={{ marginTop: 0 }}>
              {FILTROS.map((f) => (
                <button key={f.key} type="button" className={filtro === f.key ? 'active' : ''} onClick={() => setFiltro(f.key)} style={{ padding: '.2rem .6rem', fontSize: '.76rem' }}>{f.label}</button>
              ))}
            </div>
            <span className="muted mono" style={{ marginLeft: 'auto', fontSize: '.78rem' }}>{filas.length} fila(s)</span>
          </div>
          <div className="adm-tabla" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table>
              <thead><tr><th style={{ width: 48 }}>Fila</th><th>Empresa</th><th>Concepto</th><th style={{ textAlign: 'right' }}>Monto</th><th>Estado</th><th>Detalle</th></tr></thead>
              <tbody>
                {filas.map((f) => <FilaTr key={f.fila} fila={f} />)}
                {filas.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Sin filas para este filtro.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="muted hint" style={{ fontSize: '.75rem', marginTop: '.6rem' }}>
            Las filas con error nunca se importan, ni al confirmar. Corregí los datos y volvé a subir el archivo.
          </p>
        </>
      )}
    </Modal>
  );
}

function EstadoCard({ icono, color, titulo, subtitulo, big }: { icono: string; color: string; titulo: string; subtitulo: string; big?: boolean }) {
  return (
    <div className="card" style={{ borderLeft: `3px solid ${color}`, padding: big ? '.8rem 1rem' : '.55rem .8rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <div style={{ fontSize: big ? '1.3rem' : '1rem' }}>{icono}</div>
        <div>
          <div style={{ fontWeight: 600, color }}>{titulo}</div>
          <div className={big ? '' : 'muted'} style={{ fontSize: big ? '.76rem' : '1rem', fontWeight: big ? 400 : 600 }}>{subtitulo}</div>
        </div>
      </div>
    </div>
  );
}

function FilaTr({ fila }: { fila: FilaAnalizadaAdmin }) {
  const detalle: string[] = [...fila.errores];
  if (fila.duplicadoEnArchivo) detalle.push('Duplicada en el archivo');
  if (fila.duplicadoEnBd) detalle.push('Ya existe en el sistema');
  const badge = fila.estado === 'valido'
    ? <span className="adm-badge pago-pagado">Válida</span>
    : fila.estado === 'error'
      ? <span className="adm-badge pago-anulado">Error</span>
      : <span className="adm-badge pago-pendiente">Duplicada</span>;
  return (
    <tr>
      <td className="mono">{fila.fila}</td>
      <td className="mono">{fila.empresa || '—'}</td>
      <td>{fila.concepto || '—'}</td>
      <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fila.monto || '—'}</td>
      <td>{badge}</td>
      <td className="muted" style={{ fontSize: '.8rem' }}>{detalle.join(' · ') || 'OK'}</td>
    </tr>
  );
}
