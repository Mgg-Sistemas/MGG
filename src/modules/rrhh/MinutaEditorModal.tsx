/* ============================================================
   MGG · RRHH · Minutas · editor

   Carga y edición de una minuta, por secciones y en el orden del papel.
   Las cinco listas (orden del día, participantes, acuerdos, próximos puntos
   y avances) no tienen tope de filas y arrancan con una en blanco.
   ============================================================ */
import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ConfirmDialog, Modal } from '@/shared/ui/Modal';
import { FechaVe as FechaInput } from '@/shared/ui/FechaVe';
import { toast } from '@/shared/ui/Toast';
import type { Minuta, MinutaAcuerdo, MinutaAvance, MinutaParticipante, Personal } from '@/shared/lib/types';
import {
  errorMinuta, filaAcuerdoVacia, filaAvanceVacia, filaParticipanteVacia, type BorradorMinuta,
} from './minutaModelo';
import { borradorDesdeMinuta, filaTieneContenido, participanteDesdePersonal } from './minutaBorrador';
import { actualizarMinuta, crearMinuta } from './minutas.repository';
import { listPersonal } from './personal.repository';

interface MinutaEditorModalProps {
  /** `null` = alta. */
  minuta: Minuta | null;
  actor: string;
  onClose: () => void;
  onGuardada: (m: Minuta) => void;
}

/** Agregar y quitar filas, igual para las cinco tablas. */
const agregar = <T,>(set: Dispatch<SetStateAction<T[]>>, vacia: () => T) =>
  () => set((prev) => [...prev, vacia()]);
const quitar = <T,>(set: Dispatch<SetStateAction<T[]>>) =>
  (i: number) => set((prev) => prev.filter((_, j) => j !== i));
/** Cambia campos de una sola fila sin tocar las demás. */
const cambiar = <T,>(set: Dispatch<SetStateAction<T[]>>, i: number, parche: Partial<T>) =>
  set((prev) => prev.map((f, j) => (j === i ? { ...f, ...parche } : f)));

/** Textarea que crece solo mientras se escribe (y al abrirse con texto ya cargado). */
function AreaCrece({ value, onChange, rows = 2 }: {
  value: string; onChange: (v: string) => void; rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref} className="input" rows={rows} value={value}
      onChange={(e) => onChange(e.target.value)}
      onInput={(e) => {
        const el = e.currentTarget;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      }}
      style={{ resize: 'vertical', overflow: 'hidden' }}
    />
  );
}

/** Fila en blanco: se quita de un clic. Con algo escrito, antes pregunta. */
function Papelera({ onClick, campos }: { onClick: () => void; campos: unknown[] }) {
  const [confirmando, setConfirmando] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }}
        title="Quitar fila" aria-label="Quitar fila"
        onClick={() => (filaTieneContenido(campos) ? setConfirmando(true) : onClick())}>🗑</button>
      {confirmando && (
        <ConfirmDialog
          title="Quitar fila" danger confirmText="Sí, quitar"
          message="Esta fila tiene datos escritos. Si la quitás, se pierden. ¿Seguro que querés quitarla?"
          onConfirm={() => { setConfirmando(false); onClick(); }}
          onCancel={() => setConfirmando(false)}
        />
      )}
    </>
  );
}

function BotonAgregar({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: '.4rem' }} onClick={onClick}>
      + Agregar fila
    </button>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: '1.2rem' }}>
      <h4 style={{ margin: '0 0 .5rem' }}>{titulo}</h4>
      {children}
    </section>
  );
}

/** Porcentaje en pantalla y en el estado: texto vacío = `null`, nunca 0. */
const pctATexto = (n: number | null) => (n === null || n === undefined ? '' : String(n));
const textoAPct = (s: string): number | null => (s.trim() === '' ? null : Number(s));

/**
 * El `key` hace que cambiar de minuta remonte el formulario: sin él, el estado
 * inicial (que se toma una sola vez) se quedaría con lo de la minuta anterior.
 */
export function MinutaEditorModal(props: MinutaEditorModalProps) {
  return <MinutaEditorForm key={props.minuta?.id ?? 'nueva'} {...props} />;
}

function MinutaEditorForm({ minuta, actor, onClose, onGuardada }: MinutaEditorModalProps) {
  const [inicial] = useState(() => borradorDesdeMinuta(minuta));
  const [fecha, setFecha] = useState(inicial.fecha);
  const [lugar, setLugar] = useState(inicial.lugar);
  const [horaInicio, setHoraInicio] = useState(inicial.hora_inicio);
  const [objetivo, setObjetivo] = useState(inicial.objetivo);
  const [ordenDia, setOrdenDia] = useState<string[]>(inicial.orden_dia);
  const [participantes, setParticipantes] = useState<MinutaParticipante[]>(inicial.participantes);
  const [acuerdos, setAcuerdos] = useState<MinutaAcuerdo[]>(inicial.acuerdos);
  const [otrosAsuntos, setOtrosAsuntos] = useState(inicial.otros_asuntos);
  const [proximaFecha, setProximaFecha] = useState<string | null>(inicial.proxima_fecha);
  const [proximosPuntos, setProximosPuntos] = useState<string[]>(inicial.proximos_puntos);
  const [avances, setAvances] = useState<MinutaAvance[]>(inicial.avances);
  const [observaciones, setObservaciones] = useState(inicial.observaciones);
  const [estado, setEstado] = useState(inicial.estado);
  const [anexar, setAnexar] = useState(inicial.anexar_adjuntos_pdf);
  const [personal, setPersonal] = useState<Personal[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [confirmaSalir, setConfirmaSalir] = useState(false);

  useEffect(() => {
    let vivo = true;
    listPersonal(true, 'TODAS')
      .then((l) => { if (vivo) setPersonal(l); })
      .catch(() => {
        if (vivo) toast('No se pudo cargar el personal. Igual podés escribir a los participantes a mano.', 'error');
      });
    return () => { vivo = false; };
  }, []);

  /** Se elige del personal y se COPIA el texto: nunca queda una referencia viva. */
  function elegirPersona(i: number, personalId: string) {
    const p = personal.find((x) => x.id === personalId);
    setParticipantes((prev) => prev.map((fila, j) => (j !== i ? fila : (
      p ? participanteDesdePersonal(p) : { ...fila, personal_id: null }
    ))));
  }

  const armarBorrador = (): BorradorMinuta => ({
    fecha, lugar, hora_inicio: horaInicio, objetivo, orden_dia: ordenDia, participantes,
    acuerdos, otros_asuntos: otrosAsuntos, proxima_fecha: proximaFecha || null,
    proximos_puntos: proximosPuntos, avances, observaciones, estado, anexar_adjuntos_pdf: anexar,
  });

  /** Cancelar y la ✕: si hay cambios respecto al estado inicial, primero se pregunta. */
  function intentarCerrar() {
    if (ocupado) return;
    const cambios = JSON.stringify(armarBorrador())
      !== JSON.stringify({ ...inicial, proxima_fecha: inicial.proxima_fecha || null });
    if (cambios) setConfirmaSalir(true); else onClose();
  }

  async function guardar() {
    const borrador = armarBorrador();
    const error = errorMinuta(borrador);
    if (error) { toast(error, 'error'); return; }
    setOcupado(true);
    try {
      const guardada = minuta
        ? await actualizarMinuta(minuta.id, borrador, actor)
        : await crearMinuta(borrador, actor);
      toast(minuta ? 'Minuta actualizada.' : 'Minuta guardada.', 'success');
      onGuardada(guardada);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar la minuta.', 'error');
    } finally { setOcupado(false); }
  }

  const titulo = minuta ? `Minuta ${minuta.numero}` : 'Nueva minuta de reunión';

  return (
    <>
    <Modal
      size="xl" title={titulo} onClose={intentarCerrar}
      footer={
        <>
          <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={intentarCerrar}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={ocupado} onClick={() => void guardar()}>
            {ocupado ? 'Guardando…' : 'Guardar minuta'}
          </button>
        </>
      }
    >
      <Seccion titulo="Datos de la reunión">
        <div className="form-grid">
          <div className="form-row">
            <label>Fecha *</label>
            <FechaInput value={fecha} onChange={setFecha} />
          </div>
          <div className="form-row">
            <label>Hora de inicio</label>
            <input className="input" type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Lugar</label>
            <input className="input" value={lugar} onChange={(e) => setLugar(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Estado</label>
            <select className="input" value={estado} onChange={(e) => setEstado(e.target.value as BorradorMinuta['estado'])}>
              <option value="borrador">Borrador</option>
              <option value="finalizada">Finalizada</option>
            </select>
          </div>
        </div>
        <div className="form-row" style={{ marginTop: '.5rem' }}>
          <label>Objetivo de la reunión *</label>
          <AreaCrece value={objetivo} onChange={setObjetivo} />
        </div>
      </Seccion>

      <Seccion titulo="Orden del día">
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead><tr><th style={{ width: '2.5rem' }}>#</th><th>Punto</th><th style={{ width: '3rem' }} /></tr></thead>
            <tbody>
              {ordenDia.map((t, i) => (
                <tr key={i}>
                  <td className="mono">{i + 1}</td>
                  <td>
                    <AreaCrece value={t} rows={1}
                      onChange={(v) => setOrdenDia((prev) => prev.map((x, j) => (j === i ? v : x)))} />
                  </td>
                  <td style={{ textAlign: 'center' }}><Papelera campos={[t]} onClick={() => quitar(setOrdenDia)(i)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <BotonAgregar onClick={agregar(setOrdenDia, () => '')} />
      </Seccion>

      <Seccion titulo="Participantes">
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead>
              <tr><th style={{ minWidth: '11rem' }}>Elegir del personal</th><th>Nombre</th><th>Cargo</th><th style={{ width: '3rem' }} /></tr>
            </thead>
            <tbody>
              {participantes.map((p, i) => {
                // Si la persona ya no está entre el personal activo, la opción
                // sigue mostrando el nombre que quedó escrito en la minuta.
                const enLista = !p.personal_id || personal.some((x) => x.id === p.personal_id);
                return (
                  <tr key={i}>
                    <td>
                      <select className="input" value={p.personal_id ?? ''} onChange={(e) => elegirPersona(i, e.target.value)}>
                        <option value="">Invitado externo</option>
                        {!enLista && <option value={p.personal_id ?? ''}>{p.nombre || 'Persona del personal'}</option>}
                        {personal.map((x) => (
                          <option key={x.id} value={x.id}>
                            {`${x.nombre} ${x.apellido ?? ''}`.trim()}{x.cargo ? ` · ${x.cargo}` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td><input className="input" value={p.nombre} onChange={(e) => cambiar(setParticipantes, i, { nombre: e.target.value })} /></td>
                    <td><input className="input" value={p.cargo} onChange={(e) => cambiar(setParticipantes, i, { cargo: e.target.value })} /></td>
                    <td style={{ textAlign: 'center' }}><Papelera campos={[p.nombre, p.cargo]} onClick={() => quitar(setParticipantes)(i)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <BotonAgregar onClick={agregar(setParticipantes, filaParticipanteVacia)} />
        <small className="muted" style={{ display: 'block', marginTop: '.4rem' }}>
          La firma se hace sobre el papel: esta columna sale en blanco en el PDF.
        </small>
      </Seccion>

      <Seccion titulo="Acuerdos y compromisos">
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead>
              <tr><th style={{ minWidth: '9rem' }}>Responsable</th><th>Actividad</th><th style={{ minWidth: '10rem' }}>Fecha de compromiso</th><th style={{ width: '3rem' }} /></tr>
            </thead>
            <tbody>
              {acuerdos.map((a, i) => (
                <tr key={i}>
                  <td><input className="input" value={a.responsable} onChange={(e) => cambiar(setAcuerdos, i, { responsable: e.target.value })} /></td>
                  <td><AreaCrece value={a.actividad} rows={1} onChange={(v) => cambiar(setAcuerdos, i, { actividad: v })} /></td>
                  <td><FechaInput value={a.fecha_compromiso ?? ''} onChange={(iso) => cambiar(setAcuerdos, i, { fecha_compromiso: iso || null })} /></td>
                  <td style={{ textAlign: 'center' }}><Papelera campos={[a.responsable, a.actividad, a.fecha_compromiso]} onClick={() => quitar(setAcuerdos)(i)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <BotonAgregar onClick={agregar(setAcuerdos, filaAcuerdoVacia)} />
      </Seccion>

      <Seccion titulo="Otros asuntos">
        <AreaCrece value={otrosAsuntos} onChange={setOtrosAsuntos} rows={3} />
      </Seccion>

      <Seccion titulo="Próxima reunión">
        <div className="form-row" style={{ maxWidth: '14rem', marginBottom: '.5rem' }}>
          <label>Fecha</label>
          <FechaInput value={proximaFecha ?? ''} onChange={(iso) => setProximaFecha(iso || null)} />
        </div>
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead><tr><th style={{ width: '2.5rem' }}>#</th><th>Puntos a tratar</th><th style={{ width: '3rem' }} /></tr></thead>
            <tbody>
              {proximosPuntos.map((t, i) => (
                <tr key={i}>
                  <td className="mono">{i + 1}</td>
                  <td>
                    <AreaCrece value={t} rows={1}
                      onChange={(v) => setProximosPuntos((prev) => prev.map((x, j) => (j === i ? v : x)))} />
                  </td>
                  <td style={{ textAlign: 'center' }}><Papelera campos={[t]} onClick={() => quitar(setProximosPuntos)(i)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <BotonAgregar onClick={agregar(setProximosPuntos, () => '')} />
      </Seccion>

      <Seccion titulo="Seguimiento de avances">
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead>
              <tr>
                <th style={{ minWidth: '10rem' }}>Actividad</th>
                <th style={{ minWidth: '8rem' }}>Responsable</th>
                <th style={{ minWidth: '9.5rem' }}>Fecha programada</th>
                <th style={{ minWidth: '9.5rem' }}>Fecha de revisión</th>
                <th style={{ width: '5.5rem' }}>% inicial</th>
                <th style={{ minWidth: '10rem' }}>Revisión final</th>
                <th style={{ width: '5.5rem' }}>% avance</th>
                <th style={{ width: '3rem' }} />
              </tr>
            </thead>
            <tbody>
              {avances.map((a, i) => (
                <tr key={i}>
                  <td><AreaCrece value={a.actividad} rows={1} onChange={(v) => cambiar(setAvances, i, { actividad: v })} /></td>
                  <td><input className="input" value={a.responsable} onChange={(e) => cambiar(setAvances, i, { responsable: e.target.value })} /></td>
                  <td><FechaInput value={a.fecha_programada ?? ''} onChange={(iso) => cambiar(setAvances, i, { fecha_programada: iso || null })} /></td>
                  <td><FechaInput value={a.revision_fecha ?? ''} onChange={(iso) => cambiar(setAvances, i, { revision_fecha: iso || null })} /></td>
                  <td>
                    <input className="input" type="number" min={0} max={100} inputMode="decimal"
                      value={pctATexto(a.pct_inicial)} onChange={(e) => cambiar(setAvances, i, { pct_inicial: textoAPct(e.target.value) })} />
                  </td>
                  <td><AreaCrece value={a.revision_final} rows={1} onChange={(v) => cambiar(setAvances, i, { revision_final: v })} /></td>
                  <td>
                    <input className="input" type="number" min={0} max={100} inputMode="decimal"
                      value={pctATexto(a.pct_avance)} onChange={(e) => cambiar(setAvances, i, { pct_avance: textoAPct(e.target.value) })} />
                  </td>
                  <td style={{ textAlign: 'center' }}><Papelera campos={[a.actividad, a.responsable, a.fecha_programada, a.revision_fecha, a.pct_inicial, a.revision_final, a.pct_avance]} onClick={() => quitar(setAvances)(i)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <BotonAgregar onClick={agregar(setAvances, filaAvanceVacia)} />
      </Seccion>

      <Seccion titulo="Observaciones">
        <AreaCrece value={observaciones} onChange={setObservaciones} rows={3} />
      </Seccion>

      <label style={{ display: 'flex', gap: '.4rem', alignItems: 'center', fontSize: '.88rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={anexar} onChange={(e) => setAnexar(e.target.checked)} />
        Anexar las fotos al final del PDF
      </label>
    </Modal>
    {confirmaSalir && (
      <ConfirmDialog
        title="Descartar cambios" danger confirmText="Sí, descartar"
        message="Hay datos escritos que no se han guardado. Si cerrás ahora, se pierden. ¿Seguro que querés descartarlos?"
        onConfirm={() => { setConfirmaSalir(false); onClose(); }}
        onCancel={() => setConfirmaSalir(false)}
      />
    )}
    </>
  );
}
