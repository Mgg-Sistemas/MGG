/* ============================================================
   MGG · RRHH · Armar el tabulador desde los cargos (13-10-2026)

   Una sola ventana con TODOS los cargos que existen (catálogo + fichas del
   personal activo + lo que ya está en el tabulador), cada uno con su sueldo
   actual (el del tabulador, o el que cobra el personal si todos cobran igual)
   y una casilla para el SUELDO NUEVO. Se escribe un motivo y la fecha desde
   la que rige, y se guardan de una vez las altas y los cambios (una llamada
   por fila a la misma RPC con historial). Antes o después se imprime en PDF
   o se baja en Excel con el sueldo anterior y el nuevo.

   Lo que no se toca no se guarda: una fila sin monto nuevo no se crea.
   Guardar acá NO cambia sueldos de nadie: para eso sigue «⚡ Aplicar tabulador».
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { DecimalInput } from '@/shared/ui/DecimalInput';
import { toast } from '@/shared/ui/Toast';
import { money } from '@/shared/lib/format';
import type { Personal } from '@/shared/lib/types';
import { listCargos } from './catalogos';
import { textoPct } from './historicoSalarial';
import {
  MIN_MOTIVO_TABULADOR, armarTabuladorDesdeCargos, cambiosArmado, filasExportArmado, normalizarCargo,
  type FilaTabulador, type RenglonArmado,
} from './tabulador';
import { guardarFilaTabulador } from './tabulador.repository';
import { descargarTabuladorExcel, descargarTabuladorPdf } from './tabuladorExport';

const hoyIso = () => new Date().toISOString().slice(0, 10);

const REFERENCIA: Record<RenglonArmado['referencia'], { label: string; title: string }> = {
  tabulador: { label: 'tabulador', title: 'Lo que dice hoy el tabulador' },
  personal: { label: 'ficha', title: 'No está en el tabulador: es lo que cobra hoy el personal del cargo (todos igual)' },
  varios: { label: 'varios', title: 'El personal del cargo cobra montos distintos: hay que fijarlo a mano' },
  ninguna: { label: 'sin dato', title: 'Nadie activo con ese cargo ni monto en el tabulador' },
};

export function ArmarTabuladorModal({ filas, personal, actor, actorName, onClose, onGuardado }: {
  filas: FilaTabulador[]; personal: Personal[]; actor: string; actorName: string | null;
  onClose: () => void; onGuardado: () => void;
}) {
  const [cargos, setCargos] = useState<string[] | null>(null);
  const [nuevos, setNuevos] = useState<Record<string, number | null>>({});
  const [vigente, setVigente] = useState(hoyIso());
  const [motivo, setMotivo] = useState('');
  const [soloFaltantes, setSoloFaltantes] = useState(false);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    let vivo = true;
    listCargos().then((c) => { if (vivo) setCargos(c); }).catch(() => { if (vivo) setCargos([]); });
    return () => { vivo = false; };
  }, []);

  const renglones = useMemo(() => armarTabuladorDesdeCargos(cargos ?? [], personal, filas), [cargos, personal, filas]);

  // La primera vez que hay renglones, el sueldo nuevo arranca en el actual (lo que ya no haga falta tocar, queda igual).
  useEffect(() => {
    if (!cargos) return;
    setNuevos((prev) => {
      const n = { ...prev };
      for (const r of renglones) { const k = normalizarCargo(r.cargo); if (!(k in n)) n[k] = r.sueldoActual; }
      return n;
    });
  }, [cargos, renglones]);

  const visibles = useMemo(() => {
    const q = normalizarCargo(texto);
    return renglones.filter((r) => (!soloFaltantes || !r.fila) && (!q || normalizarCargo(r.cargo).includes(q)));
  }, [renglones, soloFaltantes, texto]);

  const cambios = useMemo(() => cambiosArmado(renglones, nuevos), [renglones, nuevos]);
  const altas = cambios.filter((c) => c.accion === 'alta').length;
  const faltantes = renglones.filter((r) => !r.fila).length;
  const fechaOk = /^\d{4}-\d{2}-\d{2}$/.test(vigente);
  const motivoOk = motivo.trim().length >= MIN_MOTIVO_TABULADOR;

  function poner(cargo: string, v: number | null) {
    setNuevos((n) => ({ ...n, [normalizarCargo(cargo)]: v }));
  }

  async function guardar() {
    setError(null);
    if (!cambios.length) { setError('No hay nada que guardar: ningún cargo nuevo con monto ni ningún monto distinto del actual.'); return; }
    if (!fechaOk) { setError('Indicá desde cuándo rigen los montos nuevos.'); return; }
    if (!motivoOk) { setError(`Escribí el motivo (mínimo ${MIN_MOTIVO_TABULADOR} letras): queda en el historial de cada cargo.`); return; }
    let hechos = 0;
    try {
      for (const c of cambios) {
        setGuardando(`${hechos + 1}/${cambios.length} · ${c.cargo}`);
        await guardarFilaTabulador({ cargo: c.cargo, sueldoBase: c.nuevo, vigenteDesde: vigente, motivo: motivo.trim(), activo: true, actor, actorName });
        hechos += 1;
      }
      toast(`Tabulador guardado: ${altas} cargo(s) nuevo(s) y ${cambios.length - altas} cambio(s) de monto`, 'success');
      onGuardado();
    } catch (err) {
      setError(`${err instanceof Error ? err.message : 'No se pudo guardar'} · Se guardaron ${hechos} de ${cambios.length}; lo que falta sigue en la lista.`);
      setGuardando(null);
    }
  }

  async function exportar(tipo: 'pdf' | 'excel') {
    setExportando(true);
    try {
      const filasExp = filasExportArmado(renglones, nuevos, fechaOk ? vigente : null);
      const meta = { titulo: 'Propuesta de tabulador de sueldos por cargo', subtitulo: motivo.trim() || null, vigenteDesde: fechaOk ? vigente : null, emitidoPor: actorName || actor };
      if (tipo === 'pdf') await descargarTabuladorPdf(filasExp, meta); else await descargarTabuladorExcel(filasExp, meta);
    } catch (err) { toast(err instanceof Error ? err.message : 'No se pudo generar el archivo', 'error'); }
    finally { setExportando(false); }
  }

  return (
    <Modal title="📋 Armar el tabulador desde los cargos" size="xl" onClose={() => !guardando && onClose()}
      footer={<>
        <button className="btn btn-ghost" onClick={() => void exportar('pdf')} disabled={exportando || !renglones.length} title="Imprimir con sueldo anterior y nuevo">📄 PDF</button>
        <button className="btn btn-ghost" onClick={() => void exportar('excel')} disabled={exportando || !renglones.length} title="Bajar en Excel con sueldo anterior y nuevo">📊 Excel</button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={onClose} disabled={!!guardando}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void guardar()} disabled={!!guardando || !cambios.length}>
          {guardando ? `Guardando ${guardando}…` : `Guardar ${cambios.length} fila(s)`}
        </button>
      </>}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}

      <div style={{ display: 'flex', gap: '.8rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '.6rem' }}>
        <div className="form-row" style={{ margin: 0, flex: '1 1 320px' }}>
          <label>Motivo (queda en el historial de cada cargo)</label>
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: Tabulador 2026 · revisión general de sueldos" />
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <label>Los montos nuevos rigen desde</label>
          <input className="input" type="date" value={vigente} onChange={(e) => setVigente(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.5rem' }}>
        <input className="input" placeholder="Buscar cargo…" value={texto} onChange={(e) => setTexto(e.target.value)} style={{ minWidth: 200 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.85rem' }}>
          <input type="checkbox" checked={soloFaltantes} onChange={(e) => setSoloFaltantes(e.target.checked)} /> Solo los que no están en el tabulador ({faltantes})
        </label>
        <span className="muted" style={{ fontSize: '.82rem', marginLeft: 'auto' }}>
          {renglones.length} cargo(s) · <strong>{altas}</strong> nuevo(s) · <strong>{cambios.length - altas}</strong> cambian de monto
        </span>
      </div>

      <div className="table-wrap" style={{ maxHeight: 440, overflowY: 'auto' }}>
        <table className="table" style={{ fontSize: '.84rem' }}>
          <thead>
            <tr>
              <th>Cargo</th>
              <th style={{ textAlign: 'center' }}>Activos</th>
              <th style={{ textAlign: 'right' }}>Sueldo actual</th>
              <th style={{ textAlign: 'right', minWidth: 150 }}>Sueldo nuevo (USD/mes)</th>
              <th style={{ textAlign: 'center' }}>Var. %</th>
              <th>Queda como</th>
            </tr>
          </thead>
          <tbody>
            {!cargos && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center' }}>Cargando cargos…</td></tr>}
            {cargos && !visibles.length && <tr><td colSpan={6}><EmptyState icon="📐" message={renglones.length ? 'Ningún cargo coincide' : 'No hay cargos en el catálogo ni en las fichas'} /></td></tr>}
            {cargos && visibles.map((r) => {
              const k = normalizarCargo(r.cargo);
              const nuevo = nuevos[k] ?? null;
              const cambio = cambios.find((c) => normalizarCargo(c.cargo) === k) ?? null;
              const ref = REFERENCIA[r.referencia];
              return (
                <tr key={k} style={cambio ? { background: 'rgba(255,138,0,.06)' } : undefined}>
                  <td>
                    <strong>{r.cargo}</strong>
                    {!r.fila && <span className="badge" style={{ marginLeft: '.4rem', color: 'var(--warning)' }} title="No está en el tabulador">nuevo</span>}
                    {r.fila && !r.fila.activo && <span className="badge" style={{ marginLeft: '.4rem', color: 'var(--muted)' }}>desactivado</span>}
                  </td>
                  <td className="mono" style={{ textAlign: 'center' }}>{r.activos || '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }} title={r.referencia === 'varios' ? `Cobran: ${r.sueldosPersonal.map((s) => money(s)).join(' · ')}` : ref.title}>
                    {r.sueldoActual != null ? money(r.sueldoActual) : r.referencia === 'varios' ? 'varios' : '—'}
                    <div className="muted" style={{ fontSize: '.68rem' }}>{ref.label}</div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <DecimalInput className="input mono" value={nuevo} onChange={(v) => poner(r.cargo, v)} placeholder={r.fila ? '0,00' : 'vacío = no se crea'}
                      style={{ textAlign: 'right', padding: '.25rem .45rem' }} aria-label={`Sueldo nuevo de ${r.cargo}`} />
                  </td>
                  <td className="mono" style={{ textAlign: 'center', color: cambio?.variacion.direccion === 'aumento' ? 'var(--success)' : cambio?.variacion.direccion === 'rebaja' ? 'var(--danger)' : undefined }}>
                    {cambio && cambio.anterior > 0 ? textoPct(cambio.variacion) : '—'}
                  </td>
                  <td style={{ fontSize: '.78rem' }}>
                    {cambio
                      ? <span className="badge" style={{ color: 'var(--warning)' }}>{cambio.accion === 'alta' ? `alta · ${cambio.nuevo > 0 ? money(cambio.nuevo) : 'sin definir'}` : `cambio · ${money(cambio.nuevo)}`}</span>
                      : <span className="muted">{r.fila ? 'igual' : 'no se crea'}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <small className="hint muted" style={{ display: 'block', marginTop: '.5rem' }}>
        Cada fila guardada queda en 📜 Historial con el motivo, la fecha y tu nombre. Guardar acá <strong>no cambia el sueldo de nadie</strong>:
        después se usa <strong>⚡ Aplicar tabulador</strong>, que muestra a quién toca y pide confirmar. Un cargo nuevo con la casilla vacía no se crea.
      </small>
    </Modal>
  );
}
