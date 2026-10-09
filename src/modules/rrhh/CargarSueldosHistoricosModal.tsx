/* ============================================================
   MGG · RRHH · Cargar sueldos históricos desde Excel (09-10-2026, como en GT)

   Para pasar al sistema el historial de sueldos que se llevaba en Excel y
   ver en qué año cambió el sueldo de cada quien. Cada fila es un sueldo
   viejo (cédula, fecha o año, sueldo, motivo y nota). Entra todo o nada, y
   nunca toca el sueldo de hoy. El renglón del sueldo actual con su fecha
   real corrige la carga inicial (la que tenía la fecha de ingreso).
   ============================================================ */
import { useMemo, useState } from 'react';
import { ConfirmDialog, Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { money, date, hoyISO } from '@/shared/lib/format';
import { previewWorkbook } from '@/shared/lib/reportPreview';
import type { Personal } from '@/shared/lib/types';
import { cargarSueldosHistoricos } from './personal.repository';
import { MOTIVO_HISTORICO_POR_DEFECTO, analizarFilasHistorico, type FilaHistoricoExcel } from './sueldoHistorico';

type XlsxLike = {
  read: (d: ArrayBuffer, o: unknown) => { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: {
    sheet_to_json: <T>(ws: unknown, o?: unknown) => T[];
    aoa_to_sheet: (a: unknown[][]) => Record<string, unknown>;
    book_new: () => unknown;
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
  };
};

/** Plantilla con las columnas que entiende la carga y dos filas de ejemplo. Vista previa, no descarga sola. */
async function verPlantilla() {
  const XLSXmod = await import('xlsx-js-style');
  const XLSX = XLSXmod as unknown as XlsxLike;
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Cédula', 'Fecha', 'Sueldo', 'Motivo', 'Nota'],
    ['12345678', '2023', 150, MOTIVO_HISTORICO_POR_DEFECTO, 'Ejemplo: solo el año → 01/01/2023 (borrá esta fila)'],
    ['12345678', '01/06/2024', 220, 'Aumento', 'Ejemplo con fecha completa (borrá esta fila)'],
    ['12345678', '01/03/2026', 500, 'Aumento', 'Ejemplo: el sueldo ACTUAL con su fecha real corrige la carga inicial (borrá esta fila)'],
  ]);
  ws['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 30 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Sueldos');
  previewWorkbook(XLSXmod, wb, 'plantilla-sueldos-historicos.xlsx');
}

export function CargarSueldosHistoricosModal({ personal, actor, actorName, onClose, onCargado }: {
  personal: Personal[]; actor: string; actorName: string | null; onClose: () => void; onCargado: () => void;
}) {
  const [archivo, setArchivo] = useState<string>('');
  const [filas, setFilas] = useState<FilaHistoricoExcel[]>([]);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validas = useMemo(() => filas.filter((f) => !f.error), [filas]);
  const conError = filas.length - validas.length;
  const personas = new Set(validas.map((f) => f.persona?.id)).size;

  async function leer(file: File) {
    setLeyendo(true); setError(null); setFilas([]); setArchivo(file.name);
    try {
      const XLSX = (await import('xlsx-js-style')) as unknown as XlsxLike;
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const hoja = wb.SheetNames.find((n) => /sueldo/i.test(n)) ?? wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[hoja], { defval: null, raw: true });
      if (!rows.length) throw new Error('La hoja está vacía.');
      const r = analizarFilasHistorico(rows, personal, hoyISO());
      if (!r.length) throw new Error('No se encontraron filas con cédula, fecha y sueldo. Usá la plantilla.');
      setFilas(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo');
    } finally { setLeyendo(false); }
  }

  async function cargar() {
    setConfirmar(false); setGuardando(true); setError(null);
    try {
      const n = await cargarSueldosHistoricos(validas.map((f) => ({
        fila: f.fila, personalId: f.persona!.id, fecha: f.fecha!, sueldo: f.sueldo!, motivo: f.motivo, nota: f.nota || null,
      })), actor, actorName);
      toast(`${n} sueldo(s) histórico(s) cargado(s). Los sueldos de hoy no cambiaron.`, 'success');
      onCargado();
      onClose();
    } catch (e) {
      // La carga es todo o nada: si una fila choca (fecha repetida, posterior al vigente…) no entra ninguna.
      setError(e instanceof Error ? e.message : 'No se pudo cargar');
    } finally { setGuardando(false); }
  }

  return (
    <Modal
      title="Cargar sueldos históricos desde Excel"
      size="lg"
      onClose={() => { if (!guardando) onClose(); }}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cerrar</button>
          <button className="btn btn-ghost" onClick={() => void verPlantilla().catch(() => toast('No se pudo generar la plantilla', 'error'))}>
            📄 Plantilla
          </button>
          <button className="btn btn-primary" disabled={!validas.length || conError > 0 || guardando} onClick={() => setConfirmar(true)}
            title={conError ? 'Corregí las filas con error en el Excel y volvé a subirlo' : undefined}>
            {guardando ? 'Cargando…' : `Cargar ${validas.length || ''} sueldo(s)`}
          </button>
        </>
      }
    >
      <div className="card" style={{ marginBottom: '.6rem', fontSize: '.84rem' }}>
        Una fila por sueldo: <strong>Cédula</strong>, <strong>Fecha</strong> (dd/mm/aaaa, mm/aaaa o solo el año),
        <strong> Sueldo</strong> mensual en USD y, si querés, <strong>Motivo</strong> y <strong>Nota</strong>.
        Esta carga <strong>no cambia el sueldo de hoy</strong>. Incluí también el <strong>sueldo actual con la fecha real</strong> desde
        la que rige: ese renglón corrige la carga inicial (que tiene la fecha de ingreso) en vez de duplicarla. Entra todo o nada.
      </div>
      {error && <div className="aviso danger" style={{ marginBottom: '.6rem' }}><span className="aviso-icono">⛔</span><div>{error}</div></div>}

      <div className="form-row">
        <label>Archivo Excel</label>
        <input id="sueldos-historicos-archivo" className="input" type="file" accept=".xlsx,.xls,.csv" disabled={leyendo || guardando || !personal.length}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void leer(f); e.target.value = ''; }} />
        {archivo && <small className="muted">{leyendo ? 'Leyendo…' : archivo}</small>}
      </div>

      {!!filas.length && (
        <>
          <div className="muted" style={{ margin: '.6rem 0', fontSize: '.86rem' }}>
            {validas.length} fila(s) lista(s) de {personas} persona(s)
            {conError > 0 && <> · <strong style={{ color: 'var(--danger)' }}>{conError} con error</strong> (corregilas en el Excel y volvé a subirlo)</>}
          </div>
          <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead>
                <tr><th>Fila</th><th>Trabajador</th><th>Desde</th><th style={{ textAlign: 'right' }}>Sueldo</th><th>Motivo / nota</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.fila}>
                    <td className="mono">{f.fila}</td>
                    <td>{f.persona ? `${f.persona.nombre} ${f.persona.apellido ?? ''}`.trim() : <span className="muted">C.I. {f.cedula || '—'}</span>}</td>
                    <td className="mono">{f.fecha ? date(f.fecha) : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{f.sueldo != null ? money(f.sueldo) : '—'}</td>
                    <td>{f.motivo}{f.nota && <div className="muted" style={{ fontSize: '.76rem' }}>{f.nota}</div>}</td>
                    <td style={{ color: f.error ? 'var(--danger)' : 'var(--success)' }}>{f.error ?? '✓ Lista'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {confirmar && (
        <ConfirmDialog
          title="Cargar sueldos históricos"
          message={`Se agregan ${validas.length} sueldo(s) al historial de ${personas} trabajador(es) desde «${archivo}». El sueldo de hoy no cambia. Si alguna fila choca con lo que ya está cargado, no entra ninguna.`}
          confirmText="Cargar"
          onConfirm={() => void cargar()}
          onCancel={() => setConfirmar(false)}
        />
      )}
    </Modal>
  );
}
