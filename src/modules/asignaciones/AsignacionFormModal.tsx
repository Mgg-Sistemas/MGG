/* ============================================================
   MGG · Asignaciones · Registrar o corregir una asignación

   Un solo formulario para las dos cosas. La diferencia entre asignar
   una laptop y entregar un uniforme no está en la pantalla sino en dos
   casillas: si sale del inventario y si tiene que volver.
   ============================================================ */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { num } from '@/shared/lib/format';
import type { Asignacion, Existencia, Personal, Producto } from '@/shared/lib/types';
import { numeroFicha } from '@/modules/rrhh/fichaPersonal';
import {
  TIPOS_ASIGNACION, definicionTipo, errorAsignacion, retornablePorDefecto,
} from './asignaciones';
import type { AsignacionInput } from './asignaciones.repository';

/** Hoy en formato yyyy-mm-dd, para que la fecha arranque puesta. */
function hoyIso(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function AsignacionFormModal({
  editando, personal, productos, existencias, guardando, onGuardar, onClose,
}: {
  editando: Asignacion | null;
  personal: Personal[];
  productos: Producto[];
  existencias: Existencia[];
  guardando: boolean;
  onGuardar: (input: AsignacionInput) => void;
  onClose: () => void;
}) {
  const [personalId, setPersonalId] = useState(editando?.personal_id ?? '');
  const [tipo, setTipo] = useState(editando?.tipo ?? 'dotacion');
  const [descripcion, setDescripcion] = useState(editando?.descripcion ?? '');
  const [delInventario, setDelInventario] = useState(!!editando?.producto_id);
  const [productoId, setProductoId] = useState(editando?.producto_id ?? '');
  const [almacen, setAlmacen] = useState(editando?.almacen ?? '');
  const [cantidad, setCantidad] = useState(String(editando?.cantidad ?? 1));
  const [serial, setSerial] = useState(editando?.serial ?? '');
  const [numeroLinea, setNumeroLinea] = useState(editando?.numero_linea ?? '');
  const [fecha, setFecha] = useState(editando?.fecha_asignacion ?? hoyIso());
  const [retornable, setRetornable] = useState(editando?.retornable ?? retornablePorDefecto('dotacion'));
  const [historico, setHistorico] = useState(editando?.historico ?? false);
  const [observaciones, setObservaciones] = useState(editando?.observaciones ?? '');
  const [error, setError] = useState<string | null>(null);

  const def = definicionTipo(tipo);

  /* Al cambiar de tipo se propone su default de retorno. Es una PROPUESTA: hay
     laptops que se regalan y uniformes que se devuelven, así que la casilla
     queda editable. No se toca cuando se está corrigiendo una asignación: ahí
     el valor guardado es el que vale. */
  useEffect(() => {
    if (editando) return;
    setRetornable(retornablePorDefecto(tipo));
  }, [tipo, editando]);

  const opcionesPersonal = useMemo(() => personal.map((p) => ({
    value: p.id,
    label: `${p.nombre} ${p.apellido ?? ''}`.trim(),
    hint: numeroFicha(p.numero_ficha),
    keywords: [p.cedula ?? '', p.cargo ?? '', p.departamento ?? ''],
  })), [personal]);

  /** Solo los almacenes donde ESTE producto tiene stock: no se puede entregar
   *  desde un almacén que no lo tiene. */
  const almacenesDelProducto = useMemo(() => existencias
    .filter((e) => e.producto_id === productoId && Number(e.stock) > 0)
    .sort((a, b) => Number(b.stock) - Number(a.stock)), [existencias, productoId]);

  const opcionesProducto = useMemo(() => productos
    .filter((p) => (p.estado ?? 'activo') === 'activo')
    .map((p) => ({ value: p.id, label: p.nombre, hint: p.sku ?? '', keywords: [p.categoria ?? ''] })),
  [productos]);

  const producto = productos.find((p) => p.id === productoId) ?? null;
  const stockElegido = almacenesDelProducto.find((e) => e.almacen === almacen)?.stock ?? 0;

  /* Al elegir el producto se propone su nombre como descripción y su almacén
     con más stock: en la mayoría de los casos es exactamente lo que se quería
     escribir, y queda editable. */
  function elegirProducto(id: string) {
    setProductoId(id);
    const p = productos.find((x) => x.id === id);
    if (p && !descripcion.trim()) setDescripcion(p.nombre);
    const conStock = existencias
      .filter((e) => e.producto_id === id && Number(e.stock) > 0)
      .sort((a, b) => Number(b.stock) - Number(a.stock));
    setAlmacen(conStock[0]?.almacen ?? '');
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const input: AsignacionInput = {
      personal_id: personalId,
      tipo,
      descripcion,
      producto_id: delInventario ? (productoId || null) : null,
      almacen: delInventario ? (almacen || null) : null,
      cantidad: Number(cantidad),
      unidad: producto?.unidad ?? null,
      serial,
      numero_linea: numeroLinea,
      fecha_asignacion: fecha,
      retornable,
      historico,
      observaciones,
    };

    const mal = errorAsignacion(input);
    if (mal) { setError(mal); return; }

    if (delInventario && !productoId) { setError('Elegí el producto del inventario.'); return; }
    if (delInventario && !almacen) { setError('Elegí de qué almacén sale.'); return; }
    // El stock solo se exige cuando el movimiento va a ocurrir de verdad: una
    // carga histórica no descuenta nada, así que pedirle existencia trabaría el
    // registro de algo que ya pasó.
    if (delInventario && !historico && !editando && Number(cantidad) > Number(stockElegido)) {
      setError(`En ${almacen} hay ${num(Number(stockElegido))} y estás entregando ${num(Number(cantidad))}.`);
      return;
    }

    onGuardar(input);
  }

  return (
    <Modal
      title={editando ? '✎ Corregir asignación' : '+ Registrar asignación'}
      size="lg"
      onClose={() => !guardando && onClose()}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="submit" form="form-asignacion" className="btn btn-primary" disabled={guardando}>
            {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Registrar'}
          </button>
        </>
      }
    >
      <form id="form-asignacion" onSubmit={submit}>
        <div className="form-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label>Trabajador</label>
            <SearchSelect
              options={opcionesPersonal}
              value={personalId}
              onChange={setPersonalId}
              placeholder="Buscar por nombre, ficha o cédula…"
              sinPreseleccion
            />
          </div>
          <div className="form-group">
            <label>Fecha de la asignación</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Tipo</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPOS_ASIGNACION.map((t) => (
                <option key={t.key} value={t.key}>{t.icon} {t.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ flex: 2 }}>
            <label>Qué se le asigna</label>
            <input
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Ej.: Laptop Lenovo T480 · Uniforme completo talla M" />
          </div>
        </div>

        {(def?.pideSerial || def?.pideLinea) && (
          <div className="form-row">
            {def?.pideSerial && (
              <div className="form-group">
                <label>Serial <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
                <input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="S/N del equipo" />
              </div>
            )}
            {def?.pideLinea && (
              <div className="form-group">
                <label>Número de la línea</label>
                <input value={numeroLinea} onChange={(e) => setNumeroLinea(e.target.value)} placeholder="0414-1234567" />
              </div>
            )}
          </div>
        )}

        {/* ── De dónde sale ── */}
        <div className="card" style={{ padding: '.7rem', marginTop: '.4rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer', fontSize: '.88rem' }}>
            <input type="checkbox" checked={delInventario}
              onChange={(e) => { setDelInventario(e.target.checked); if (!e.target.checked) { setProductoId(''); setAlmacen(''); } }} />
            <span>📦 <strong>Sale del inventario</strong>
              <span className="hint muted" style={{ fontSize: '.76rem' }}> · se descuenta del almacén con un movimiento normal y queda en el kardex. Destildá si es algo que no está fichado, como una línea telefónica.</span>
            </span>
          </label>

          {delInventario && (
            <>
              <div className="form-row" style={{ marginTop: '.5rem' }}>
                <div className="form-group" style={{ flex: 2 }}>
                  <label>Producto</label>
                  <SearchSelect
                    options={opcionesProducto}
                    value={productoId}
                    onChange={elegirProducto}
                    placeholder="Buscar producto…"
                    sinPreseleccion
                  />
                </div>
                <div className="form-group">
                  <label>Almacén</label>
                  <select value={almacen} onChange={(e) => setAlmacen(e.target.value)} disabled={!productoId}>
                    <option value="">— elegí —</option>
                    {almacenesDelProducto.map((e) => (
                      <option key={e.almacen} value={e.almacen}>{e.almacen} · {num(Number(e.stock))}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ maxWidth: 120 }}>
                  <label>Cantidad</label>
                  <input type="number" min="0" step="any" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
                </div>
              </div>
              {productoId && !almacenesDelProducto.length && (
                <small className="muted" style={{ color: 'var(--warning)' }}>
                  Ese producto no tiene stock en ningún almacén. Si es una carga histórica, marcá el modo histórico abajo.
                </small>
              )}
            </>
          )}
        </div>

        {/* ── Cómo se comporta ── */}
        <div className="card" style={{ padding: '.7rem', marginTop: '.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer', fontSize: '.88rem' }}>
            <input type="checkbox" checked={retornable} onChange={(e) => setRetornable(e.target.checked)} />
            <span>↩ <strong>Tiene que devolverla</strong>
              <span className="hint muted" style={{ fontSize: '.76rem' }}> · queda pendiente hasta que la entregue. La dotación, el material de oficina y los implementos de seguridad no vuelven: para esos, destildá.</span>
            </span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '.45rem', marginTop: '.45rem', cursor: 'pointer', fontSize: '.88rem' }}
            title="Ese material salió del almacén hace rato: descontarlo hoy lo contaría dos veces">
            <input type="checkbox" checked={historico} onChange={(e) => setHistorico(e.target.checked)} />
            <span>📜 <strong>Modo histórico</strong> (ya existía antes del sistema)
              <span className="hint muted" style={{ fontSize: '.76rem' }}> · se registra para el historial y <strong>NO toca el inventario</strong>, porque ese material ya había salido del almacén. Tampoco se exige stock.</span>
            </span>
          </label>
        </div>

        <div className="form-group" style={{ marginTop: '.5rem' }}>
          <label>Observaciones <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
          <textarea rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Estado del equipo al entregarlo, accesorios incluidos…" />
        </div>

        {error && <p style={{ color: 'var(--danger)', margin: '.5rem 0 0', fontSize: '.85rem' }}>{error}</p>}
      </form>
    </Modal>
  );
}
