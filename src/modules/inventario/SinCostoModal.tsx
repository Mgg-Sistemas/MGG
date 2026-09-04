/* ============================================================
   MGG · Inventario · «Sin costo»
   Cola de trabajo: existencias con material contado pero valoradas
   en $0. Mientras estén así, el almacén vale menos de lo que tiene.

   Se carga el costo y queda un ajuste en el kardex con el motivo,
   que es la traza que nunca tuvieron las cargas masivas viejas.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { money, num } from '@/shared/lib/format';
import { DecimalInput } from '@/shared/ui/DecimalInput';
import { valuarExistencia } from './movimientos.repository';
import { listarSinCosto } from './sinCosto.repository';
import { claveFila, valorRecuperado, validarCosto, type FilaSinCosto } from './sinCosto';

interface Props {
  actor: string;
  actorName?: string | null;
  canWrite: boolean;
  onClose: () => void;
  /** Se avisa al padre cuando algo se valoró, para refrescar el inventario. */
  onValuado?: () => void;
}

export function SinCostoModal({ actor, actorName, canWrite, onClose, onValuado }: Props) {
  const [filas, setFilas] = useState<FilaSinCosto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [almacenFiltro, setAlmacenFiltro] = useState('');
  // Costo tipeado por fila (clave = producto|almacén).
  const [costos, setCostos] = useState<Map<string, number | null>>(new Map());
  const [guardando, setGuardando] = useState<string | null>(null);
  const [guardandoTodo, setGuardandoTodo] = useState(false);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const data = await listarSinCosto();
      setFilas(data);
      // Los que tienen precio en el historial arrancan precargados: solo hay
      // que confirmarlos en vez de salir a averiguarlos.
      setCostos(new Map(data.filter((f) => f.sugerido != null).map((f) => [claveFila(f), f.sugerido as number])));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la lista.');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => { void cargar(); }, []);

  const almacenes = useMemo(
    () => Array.from(new Set(filas.map((f) => f.almacen))).sort((a, b) => a.localeCompare(b, 'es')),
    [filas],
  );

  const visibles = useMemo(() => {
    const q = texto.trim().toLowerCase();
    return filas.filter((f) => {
      if (almacenFiltro && f.almacen !== almacenFiltro) return false;
      if (!q) return true;
      return f.nombre.toLowerCase().includes(q) || f.sku.toLowerCase().includes(q);
    });
  }, [filas, texto, almacenFiltro]);

  // Solo cuentan los costos válidos: un 0 tipeado no debe sumar ni habilitar el guardado.
  const costosValidos = useMemo(() => {
    const m = new Map<string, number>();
    for (const [k, v] of costos) if (v != null && validarCosto(v) == null) m.set(k, v);
    return m;
  }, [costos]);

  const listasVisibles = useMemo(
    () => visibles.filter((f) => costosValidos.has(claveFila(f))),
    [visibles, costosValidos],
  );
  const recupera = useMemo(() => valorRecuperado(listasVisibles, costosValidos), [listasVisibles, costosValidos]);

  function setCosto(f: FilaSinCosto, v: number | null) {
    setCostos((prev) => {
      const next = new Map(prev);
      if (v == null) next.delete(claveFila(f)); else next.set(claveFila(f), v);
      return next;
    });
  }

  /** Texto del ajuste que queda en el kardex, para que se entienda solo. */
  const motivo = (f: FilaSinCosto, costo: number) =>
    `Valuación de existencia sin costo · ${f.almacen} · ${num(f.stock)} ${f.unidad ?? 'u'} x ${money(costo)}`;

  async function guardarFila(f: FilaSinCosto) {
    const costo = costosValidos.get(claveFila(f));
    if (costo == null) return;
    setGuardando(claveFila(f));
    try {
      await valuarExistencia({
        producto_id: f.producto_id,
        almacen: f.almacen,
        costo,
        actor,
        actor_name: actorName ?? null,
        detalle: motivo(f, costo),
      });
      setFilas((prev) => prev.filter((x) => claveFila(x) !== claveFila(f)));
      toast(`"${f.nombre}" valorado en ${money(costo)} · ${f.almacen}`, 'success');
      onValuado?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar el costo.', 'error');
    } finally {
      setGuardando(null);
    }
  }

  /** Guarda de una todas las filas visibles que ya tienen un costo válido. */
  async function guardarTodo() {
    if (!listasVisibles.length) return;
    setGuardandoTodo(true);
    const hechas: string[] = [];
    const fallidas: string[] = [];
    for (const f of listasVisibles) {
      const costo = costosValidos.get(claveFila(f));
      if (costo == null) continue;
      try {
        await valuarExistencia({
          producto_id: f.producto_id,
          almacen: f.almacen,
          costo,
          actor,
          actor_name: actorName ?? null,
          detalle: motivo(f, costo),
        });
        hechas.push(claveFila(f));
      } catch {
        // Se sigue con el resto: una fila que falló (p. ej. otro usuario la valoró
        // primero) no debe frenar el trabajo ya hecho en las demás.
        fallidas.push(f.sku);
      }
    }
    if (hechas.length) {
      const ok = new Set(hechas);
      setFilas((prev) => prev.filter((x) => !ok.has(claveFila(x))));
      toast(`${hechas.length} producto(s) valorados`, 'success');
      onValuado?.();
    }
    if (fallidas.length) {
      toast(
        `${fallidas.length} no se pudieron guardar (${fallidas.slice(0, 3).join(', ')}${fallidas.length > 3 ? '…' : ''}). Refrescá la lista.`,
        'warning',
      );
    }
    setGuardandoTodo(false);
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardandoTodo}>Cerrar</button>
      {canWrite && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => { void guardarTodo(); }}
          disabled={!listasVisibles.length || guardandoTodo || !!guardando}
          title="Guarda todas las filas visibles que ya tienen un costo cargado"
        >
          {guardandoTodo ? 'Guardando…' : `Guardar ${listasVisibles.length} con costo`}
        </button>
      )}
    </>
  );

  return (
    <Modal title="Productos sin costo" size="xl" onClose={onClose} footer={footer}>
      <p className="muted" style={{ marginTop: 0 }}>
        Estas existencias tienen material contado pero valen <strong>$0</strong> en el inventario:
        el stock está, el valor no. Cargá el costo unitario y queda un ajuste en el kardex
        con quién lo valoró y cuándo.
      </p>

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.75rem' }}>
        <input
          className="input"
          placeholder="Buscar por nombre o SKU…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          style={{ flex: '1 1 16rem', minWidth: '12rem' }}
        />
        <select className="input" value={almacenFiltro} onChange={(e) => setAlmacenFiltro(e.target.value)} style={{ flex: '0 1 14rem' }}>
          <option value="">Todos los almacenes ({filas.length})</option>
          {almacenes.map((a) => (
            <option key={a} value={a}>{a} ({filas.filter((f) => f.almacen === a).length})</option>
          ))}
        </select>
        <button type="button" className="btn btn-ghost" onClick={() => { void cargar(); }} disabled={cargando || guardandoTodo}>
          ↻ Refrescar
        </button>
      </div>

      {recupera > 0 && (
        <div className="card" style={{ marginBottom: '.75rem', borderColor: 'var(--success)' }}>
          Con lo cargado el inventario recupera <strong>{money(recupera)}</strong> en {listasVisibles.length} producto(s).
        </div>
      )}

      {cargando ? (
        <p className="muted">Cargando…</p>
      ) : !filas.length ? (
        <div className="card" style={{ textAlign: 'center', padding: '1.5rem' }}>
          <strong>No queda ningún producto sin costo.</strong>
          <p className="muted" style={{ marginBottom: 0 }}>Todo el stock del inventario está valorado.</p>
        </div>
      ) : !visibles.length ? (
        <p className="muted">Ningún producto coincide con el filtro.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Almacén</th>
                <th style={{ textAlign: 'right' }}>Stock</th>
                <th style={{ width: '11rem' }}>Costo unitario</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const k = claveFila(f);
                const v = costos.get(k) ?? null;
                const invalido = v != null ? validarCosto(v) : null;
                const costoOk = costosValidos.get(k);
                const valor = costoOk != null ? f.stock * costoOk : null;
                return (
                  <tr key={k}>
                    <td>
                      <strong>{f.nombre}</strong>
                      <div className="muted" style={{ fontSize: '.8rem' }}>
                        {f.sku}{f.categoria ? ` · ${f.categoria}` : ''}
                      </div>
                    </td>
                    <td>{f.almacen}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {num(f.stock)} {f.unidad ?? ''}
                    </td>
                    <td>
                      <DecimalInput
                        value={v}
                        onChange={(n) => setCosto(f, n)}
                        placeholder="0,00"
                        disabled={!canWrite || guardandoTodo}
                        aria-label={`Costo unitario de ${f.nombre} en ${f.almacen}`}
                      />
                      {f.sugeridoOrigen && (
                        <div className="muted" style={{ fontSize: '.75rem' }}>
                          sugerido de {f.sugeridoOrigen}
                        </div>
                      )}
                      {invalido && (
                        <div style={{ fontSize: '.75rem', color: 'var(--danger)' }}>{invalido}</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {valor != null ? money(valor) : <span className="muted">—</span>}
                    </td>
                    {canWrite && (
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => { void guardarFila(f); }}
                          disabled={costoOk == null || guardando === k || guardandoTodo}
                          title="Guardar el costo de esta existencia"
                        >
                          {guardando === k ? '…' : '✓'}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
