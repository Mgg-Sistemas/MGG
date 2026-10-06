/* ============================================================
   MGG · Asignaciones · Registrar o corregir una entrega

   Una entrega es de una persona, en una fecha, con VARIOS ítems: a un
   ingreso se le dan uniforme, botas, casco y laptop el mismo día, y
   cargarlos de a uno es cuatro veces el mismo trámite.

   Cada ítem se guarda como su propia asignación, porque cada uno se
   devuelve por separado: la laptop vuelve y el uniforme no.

   Al CORREGIR se edita un solo renglón —el que se tocó—, así que ahí no
   se agregan ni se quitan ítems.
   ============================================================ */
import { useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { num } from '@/shared/lib/format';
import type { Asignacion, Existencia, Personal, Producto } from '@/shared/lib/types';
import { numeroFicha } from '@/modules/rrhh/fichaPersonal';
import {
  TIPOS_ASIGNACION, GRUPOS_ASIGNACION, tiposDelGrupo, definicionTipo, errorRenglones, retornablePorDefecto,
} from './asignaciones';
import type { AsignacionInput } from './asignaciones.repository';

/** Hoy en formato yyyy-mm-dd, para que la fecha arranque puesta. */
function hoyIso(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Un ítem de la entrega, como lo maneja el formulario. */
interface Renglon {
  key: string;
  tipo: string;
  descripcion: string;
  delInventario: boolean;
  productoId: string;
  almacen: string;
  cantidad: string;
  serial: string;
  numeroLinea: string;
  retornable: boolean;
}

let contador = 0;
function renglonVacio(tipo = 'dotacion'): Renglon {
  contador += 1;
  return {
    key: `r${contador}`,
    tipo,
    descripcion: '',
    delInventario: false,
    productoId: '',
    almacen: '',
    cantidad: '1',
    serial: '',
    numeroLinea: '',
    retornable: retornablePorDefecto(tipo),
  };
}

function renglonDe(a: Asignacion): Renglon {
  contador += 1;
  return {
    key: `r${contador}`,
    tipo: a.tipo,
    descripcion: a.descripcion,
    delInventario: !!a.producto_id,
    productoId: a.producto_id ?? '',
    almacen: a.almacen ?? '',
    cantidad: String(a.cantidad ?? 1),
    serial: a.serial ?? '',
    numeroLinea: a.numero_linea ?? '',
    retornable: a.retornable,
  };
}

export function AsignacionFormModal({
  editando, personal, productos, existencias, guardando, onGuardar, onClose,
}: {
  editando: Asignacion | null;
  personal: Personal[];
  productos: Producto[];
  existencias: Existencia[];
  guardando: boolean;
  onGuardar: (inputs: AsignacionInput[]) => void;
  onClose: () => void;
}) {
  const [personalId, setPersonalId] = useState(editando?.personal_id ?? '');
  const [fecha, setFecha] = useState(editando?.fecha_asignacion ?? hoyIso());
  const [historico, setHistorico] = useState(editando?.historico ?? false);
  const [observaciones, setObservaciones] = useState(editando?.observaciones ?? '');
  const [renglones, setRenglones] = useState<Renglon[]>(
    () => (editando ? [renglonDe(editando)] : [renglonVacio()]),
  );
  const [error, setError] = useState<string | null>(null);

  const opcionesPersonal = useMemo(() => personal.map((p) => ({
    value: p.id,
    label: `${p.nombre} ${p.apellido ?? ''}`.trim(),
    hint: numeroFicha(p.numero_ficha),
    keywords: [p.cedula ?? '', p.cargo ?? '', p.departamento ?? ''],
  })), [personal]);

  const opcionesProducto = useMemo(() => productos
    .filter((p) => (p.estado ?? 'activo') === 'activo')
    .map((p) => ({ value: p.id, label: p.nombre, hint: p.sku ?? '', keywords: [p.categoria ?? ''] })),
  [productos]);

  const almacenesDe = (productoId: string) => existencias
    .filter((e) => e.producto_id === productoId && Number(e.stock) > 0)
    .sort((a, b) => Number(b.stock) - Number(a.stock));

  function cambiar(key: string, patch: Partial<Renglon>) {
    setRenglones((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  /* Al cambiar de tipo se propone su default de retorno. Es una PROPUESTA: hay
     laptops que se regalan y uniformes que se devuelven, así que la casilla
     queda editable. */
  function cambiarTipo(key: string, tipo: string) {
    cambiar(key, { tipo, retornable: retornablePorDefecto(tipo) });
  }

  /* Al elegir el producto se propone su nombre como descripción y el almacén
     con más stock: casi siempre es lo que se quería escribir. */
  function elegirProducto(key: string, id: string) {
    const p = productos.find((x) => x.id === id);
    const conStock = almacenesDe(id);
    setRenglones((rs) => rs.map((r) => (r.key === key
      ? {
        ...r,
        productoId: id,
        almacen: conStock[0]?.almacen ?? '',
        descripcion: r.descripcion.trim() || (p?.nombre ?? ''),
      }
      : r)));
  }

  /** El nuevo ítem hereda el tipo del anterior: se entrega por tandas del mismo palo. */
  function agregarItem() {
    setRenglones((rs) => [...rs, renglonVacio(rs[rs.length - 1]?.tipo ?? 'dotacion')]);
  }

  function quitarItem(key: string) {
    setRenglones((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  }

  /** Lo que el formulario tiene cargado, en la forma que espera el repositorio. */
  const aInputs = (): AsignacionInput[] => renglones.map((r) => ({
    personal_id: personalId,
    tipo: r.tipo,
    descripcion: r.descripcion,
    producto_id: r.delInventario ? (r.productoId || null) : null,
    almacen: r.delInventario ? (r.almacen || null) : null,
    cantidad: Number(r.cantidad),
    unidad: productos.find((p) => p.id === r.productoId)?.unidad ?? null,
    serial: r.serial,
    numero_linea: r.numeroLinea,
    fecha_asignacion: fecha,
    retornable: r.retornable,
    historico,
    observaciones,
  }));

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const inputs = aInputs();

    const mal = errorRenglones(inputs);
    if (mal) { setError(mal); return; }

    for (let i = 0; i < renglones.length; i += 1) {
      const r = renglones[i];
      if (!r.delInventario) continue;
      if (!r.productoId) { setError(`Ítem ${i + 1}: elegí el producto del inventario.`); return; }
      if (!r.almacen) { setError(`Ítem ${i + 1}: elegí de qué almacén sale.`); return; }
      // El stock solo se exige cuando el movimiento va a ocurrir de verdad: una
      // carga histórica no descuenta nada, y pedirle existencia trabaría el
      // registro de algo que ya pasó.
      if (historico || editando) continue;
      const hay = Number(almacenesDe(r.productoId).find((e) => e.almacen === r.almacen)?.stock ?? 0);
      if (Number(r.cantidad) > hay) {
        setError(`Ítem ${i + 1}: en ${r.almacen} hay ${num(hay)} y estás entregando ${num(Number(r.cantidad))}.`);
        return;
      }
    }

    onGuardar(inputs);
  }

  const titulo = editando
    ? '✎ Corregir asignación'
    : renglones.length > 1 ? `🎒 Nueva entrega · ${renglones.length} ítems` : '🎒 Nueva asignación';

  return (
    <Modal
      title={titulo}
      size="xl"
      onClose={() => !guardando && onClose()}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="submit" form="form-asignacion" className="btn btn-primary" disabled={guardando}>
            {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : `Registrar ${renglones.length > 1 ? `${renglones.length} ítems` : ''}`.trim()}
          </button>
        </>
      }
    >
      <form id="form-asignacion" onSubmit={submit}>
        {/* ── Lo que vale para toda la entrega ── */}
        <div className="form-row">
          <label>Trabajador *</label>
          <SearchSelect
            options={opcionesPersonal}
            value={personalId}
            onChange={setPersonalId}
            placeholder="🔍 Buscar por nombre, ficha o cédula…"
            sinPreseleccion
          />
        </div>
        <div className="form-row" style={{ maxWidth: 220 }}>
          <label>Fecha de la entrega *</label>
          <input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>

        {/* ── Los ítems ── */}
        {renglones.map((r, i) => {
          const def = definicionTipo(r.tipo);
          const almacenes = almacenesDe(r.productoId);
          return (
            <div key={r.key} className="card" style={{ padding: '.7rem', marginTop: '.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.4rem' }}>
                <strong style={{ fontSize: '.82rem' }}>Ítem {i + 1}</strong>
                {!editando && renglones.length > 1 && (
                  <button type="button" className="btn btn-icon btn-ghost" title="Quitar este ítem"
                    style={{ marginLeft: 'auto' }} onClick={() => quitarItem(r.key)}>🗑</button>
                )}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem' }}>
                <div className="form-row" style={{ flex: '0 1 220px' }}>
                  <label>Categoría *</label>
                  {/* Agrupado en las tres clases: bienes y equipo, dotación, vehículos. */}
                  <select className="select" value={r.tipo} onChange={(e) => cambiarTipo(r.key, e.target.value)}>
                    {GRUPOS_ASIGNACION.map((g) => (
                      <optgroup key={g.key} label={`${g.icon} ${g.label}`}>
                        {tiposDelGrupo(g.key).map((t) => (
                          <option key={t.key} value={t.key}>{t.icon} {t.label}</option>
                        ))}
                      </optgroup>
                    ))}
                    {TIPOS_ASIGNACION.some((t) => t.key === r.tipo) ? null : <option value={r.tipo}>{r.tipo}</option>}
                  </select>
                </div>
                <div className="form-row" style={{ flex: '2 1 280px' }}>
                  <label>¿Qué se asigna? *</label>
                  <input className="input"
                    value={r.descripcion}
                    onChange={(e) => cambiar(r.key, { descripcion: e.target.value })}
                    placeholder={def?.pidePlaca ? 'Toyota Hilux 2019 blanca, moto Bera 150…' : 'Laptop Lenovo T480, uniforme completo talla M…'} />
                </div>
              </div>

              {(def?.pideSerial || def?.pideLinea || def?.pidePlaca) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem' }}>
                  {def?.pidePlaca && (
                    <div className="form-row" style={{ flex: '1 1 200px' }}>
                      <label>Placa *</label>
                      <input className="input mono" value={r.serial} onChange={(e) => cambiar(r.key, { serial: e.target.value.toUpperCase() })} placeholder="AB123CD" />
                    </div>
                  )}
                  {def?.pideSerial && (
                    <div className="form-row" style={{ flex: '1 1 200px' }}>
                      <label>Serial</label>
                      <input className="input mono" value={r.serial} onChange={(e) => cambiar(r.key, { serial: e.target.value })} placeholder="S/N del equipo" />
                    </div>
                  )}
                  {def?.pideLinea && (
                    <div className="form-row" style={{ flex: '1 1 200px' }}>
                      <label>Número de la línea *</label>
                      <input className="input mono" value={r.numeroLinea} onChange={(e) => cambiar(r.key, { numeroLinea: e.target.value })} placeholder="0414-1234567" />
                    </div>
                  )}
                </div>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer', fontSize: '.85rem', marginTop: '.3rem' }}>
                <input type="checkbox" checked={r.delInventario}
                  onChange={(e) => cambiar(r.key, e.target.checked
                    ? { delInventario: true }
                    : { delInventario: false, productoId: '', almacen: '' })} />
                <span>📦 <strong>Sale del inventario</strong>
                  <span className="hint muted" style={{ fontSize: '.75rem' }}> · se descuenta del almacén y queda en el kardex. Destildá si no está fichado, como una línea telefónica.</span>
                </span>
              </label>

              {r.delInventario && (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem', marginTop: '.4rem' }}>
                    <div className="form-row" style={{ flex: '2 1 240px' }}>
                      <label>Producto *</label>
                      <SearchSelect
                        options={opcionesProducto}
                        value={r.productoId}
                        onChange={(id) => elegirProducto(r.key, id)}
                        placeholder="🔍 Buscar producto…"
                        sinPreseleccion
                      />
                    </div>
                    <div className="form-row" style={{ flex: '1 1 190px' }}>
                      <label>Almacén *</label>
                      <select className="select" value={r.almacen} onChange={(e) => cambiar(r.key, { almacen: e.target.value })} disabled={!r.productoId}>
                        <option value="">— elegí —</option>
                        {almacenes.map((e) => (
                          <option key={e.almacen} value={e.almacen}>{e.almacen} · {num(Number(e.stock))}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-row" style={{ flex: '0 1 110px' }}>
                      <label>Cantidad *</label>
                      <input className="input mono" type="number" min="0" step="any" value={r.cantidad}
                        onChange={(e) => cambiar(r.key, { cantidad: e.target.value })} />
                    </div>
                  </div>
                  {r.productoId && !almacenes.length && (
                    <small className="muted" style={{ color: 'var(--warning)' }}>
                      Ese producto no tiene stock en ningún almacén. Si es una carga histórica, marcá el modo histórico abajo.
                    </small>
                  )}
                </>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer', fontSize: '.85rem', marginTop: '.35rem' }}>
                <input type="checkbox" checked={r.retornable} onChange={(e) => cambiar(r.key, { retornable: e.target.checked })} />
                <span>↩ <strong>Tiene que devolverlo</strong>
                  <span className="hint muted" style={{ fontSize: '.75rem' }}> · queda pendiente hasta que lo entregue. La dotación, el material de oficina y los implementos de seguridad no vuelven.</span>
                </span>
              </label>
            </div>
          );
        })}

        {!editando && (
          <button type="button" className="btn btn-ghost" style={{ marginTop: '.5rem' }} onClick={agregarItem}>
            + Agregar ítem
          </button>
        )}

        {/* ── Lo que vale para toda la entrega, otra vez ── */}
        <div className="card" style={{ padding: '.7rem', marginTop: '.6rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer', fontSize: '.88rem' }}
            title="Ese material salió del almacén hace rato: descontarlo hoy lo contaría dos veces">
            <input type="checkbox" checked={historico} onChange={(e) => setHistorico(e.target.checked)} />
            <span>📜 <strong>Modo histórico</strong> (ya existía antes del sistema)
              <span className="hint muted" style={{ fontSize: '.76rem' }}> · se registra para el historial y <strong>NO toca el inventario</strong>, porque ese material ya había salido del almacén. Tampoco se exige stock. Aplica a <strong>todos los ítems</strong> de esta entrega.</span>
            </span>
          </label>
        </div>

        <div className="form-row" style={{ marginTop: '.6rem' }}>
          <label>Observación</label>
          <textarea className="textarea" rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Estado de los equipos al entregarlos, accesorios incluidos…" />
        </div>

        {error && <p style={{ color: 'var(--danger)', margin: '.5rem 0 0', fontSize: '.85rem' }}>{error}</p>}
      </form>
    </Modal>
  );
}
