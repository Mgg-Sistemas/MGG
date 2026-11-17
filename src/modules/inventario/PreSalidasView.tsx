/* ============================================================
   MGG · Vista de Pre-salidas (Borradores de Salida)
   17-11-2026.
   Muestra los borradores de salida pendientes del almacén. Permite:
   · Enviar / reenviar a WhatsApp para aprobación del supervisor.
   · Editar el borrador (agregar/quitar materiales, cambiar cantidades o motivo).
   · Descartar el borrador si fue rechazado.
   · Confirmar y dar la salida oficial seleccionando quién autorizó por WhatsApp.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { listAutorizadoresActivos } from '@/modules/combustible/combustible.repository';
import { useRealtime } from '@/shared/lib/useRealtime';
import { num, fechaHoraVE, type SalidaTelefono } from './inventarioTelefono';
import { nombreAlmacenVisible } from './sectorizacion';
import {
  filtrarPreSalidas,
  mensajePreSalidaWhatsapp,
  validarPreSalida,
  type LineaPreSalida,
  type PreSalida,
} from './presalidas';
import {
  actualizarPreSalida,
  descartarPreSalida,
  listPreSalidas,
  marcarPreSalidaProcesada,
} from './presalidas.repository';
import {
  registrarSalidaTelefonoLote,
  type ProductoEnAlmacen,
} from './inventarioTelefono.repository';
import {
  enviarSalidaAMaquinaria,
  type EnvioMaquinaria,
} from './EntregaMaquinariaTelefono';
import { motivoConMaquina } from '@/modules/maquinaria/entregasAlmacen';

interface Props {
  almacen: string;
  productos: ProductoEnAlmacen[];
  actor: string;
  actorName: string | null;
  quien: string;
  onVolver: () => void;
  onSalidaHecha: (ss: SalidaTelefono[], envio: EnvioMaquinaria | null) => void;
}

export function PreSalidasView({
  almacen,
  productos,
  actor,
  actorName,
  quien,
  onVolver,
  onSalidaHecha,
}: Props) {
  const [lista, setLista] = useState<PreSalida[] | null>(null);
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<PreSalida | null>(null);
  const [confirmando, setConfirmando] = useState<PreSalida | null>(null);
  const [autorizado, setAutorizado] = useState('');
  const [autorizadores, setAutorizadores] = useState<string[] | null>(null);
  const [ejecutando, setEjecutando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const ps = await listPreSalidas(almacen, true);
      setLista(ps);
    } catch {
      setLista([]);
    }
  }, [almacen]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useRealtime(['inventario_presalidas'], () => {
    void cargar();
  });

  // Cargar lista de autorizadores
  useEffect(() => {
    listAutorizadoresActivos()
      .then(setAutorizadores)
      .catch(() => setAutorizadores([]));
  }, []);

  const visibles = useMemo(() => filtrarPreSalidas(lista ?? [], busca), [lista, busca]);

  async function handleDescartar(p: PreSalida) {
    if (!window.confirm(`¿Descartar el borrador ${p.codigo}? No saldrá ningún material del almacén.`)) return;
    try {
      await descartarPreSalida(p.id);
      toast(`Borrador ${p.codigo} descartado.`, 'info');
      void cargar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo descartar', 'error');
    }
  }

  async function handleConfirmarSalida(p: PreSalida) {
    if (!autorizado.trim()) {
      toast('Selecciona quién autorizó la salida en WhatsApp.', 'error');
      return;
    }

    // Verificar existencias actuales en el almacén
    for (const l of p.lineas) {
      const pr = productos.find((x) => x.id === l.productoId);
      if (pr && l.cantidad > pr.stock_almacen) {
        toast(`No alcanza ${l.productoNombre}: hay ${num(pr.stock_almacen)} ${l.unidad} en ${almacen}.`, 'error');
        return;
      }
    }

    setEjecutando(true);
    try {
      const motivoFinal = p.equipo?.nombre ? motivoConMaquina(p.motivo, p.equipo.nombre) : p.motivo;
      const lineasLote = p.lineas.map((l) => {
        const pr = productos.find((x) => x.id === l.productoId);
        return {
          producto: pr ?? ({ id: l.productoId, nombre: l.productoNombre, sku: l.sku, unidad: l.unidad, stock_almacen: 0 } as ProductoEnAlmacen),
          cantidad: l.cantidad,
        };
      });

      const ss = await registrarSalidaTelefonoLote({
        lineas: lineasLote,
        almacen: p.almacen,
        motivo: motivoFinal,
        autorizadoPor: autorizado.trim(),
        retorna: p.retorna,
        actor,
        actorName,
        equipo: p.equipo || null,
      });

      await marcarPreSalidaProcesada(p.id, ss[0]?.codigo || '', autorizado.trim());

      let envio: EnvioMaquinaria | null = null;
      if (p.equipo?.id) {
        envio = await enviarSalidaAMaquinaria(ss, {
          equipoId: p.equipo.id,
          equipoNombre: p.equipo.nombre,
          tipo: p.tipoMant || null,
          nota: p.motivo,
          codigo: null,
          error: null,
        }).catch(() => null);
      }

      toast(`¡Salida ${ss[0]?.codigo || ''} confirmada y registrada en kardex!`, 'success');
      setConfirmando(null);
      setAutorizado('');
      onSalidaHecha(ss, envio);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo registrar la salida', 'error');
    } finally {
      setEjecutando(false);
    }
  }

  if (editando) {
    return (
      <EditorPreSalida
        pre={editando}
        productos={productos}
        onCancel={() => setEditando(null)}
        onGuardado={() => {
          setEditando(null);
          void cargar();
        }}
      />
    );
  }

  return (
    <section className="surt-lista">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', margin: '.5rem 0' }}>
        <strong style={{ fontSize: '1.1rem' }}>⏳ Pre-salidas (Borradores) · {nombreAlmacenVisible(almacen)}</strong>
        <button type="button" className="btn btn-ghost" onClick={onVolver}>← Volver</button>
      </div>

      <div className="card" style={{ borderLeft: '3px solid var(--info, #3b82f6)', padding: '.6rem .9rem', fontSize: '.84rem' }}>
        💡 <strong>Flujo de Pre-salidas:</strong> Los materiales de estos borradores <strong>no descuentan stock</strong> hasta que sean autorizados por WhatsApp y confirmados aquí.
      </div>

      <input
        className="input surt-input"
        type="search"
        placeholder="🔍 Buscar por código, material, motivo o equipo…"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        aria-label="Buscar pre-salidas"
      />

      {lista === null ? (
        <p className="muted">Cargando pre-salidas…</p>
      ) : !lista.length ? (
        <p className="muted" style={{ textAlign: 'center', padding: '1.5rem 0' }}>
          No hay pre-salidas pendientes en {nombreAlmacenVisible(almacen)}.
          <br /><small>Al registrar una salida puedes guardarla como pre-salida para pedir autorización por WhatsApp.</small>
        </p>
      ) : (
        <>
          <h2>
            {busca.trim()
              ? `${visibles.length} encontrado(s) de ${lista.length}`
              : `${lista.length} pre-salida(s) por autorizar / despachar`}
          </h2>

          <div style={{ display: 'grid', gap: '.8rem' }}>
            {visibles.map((p) => {
              const msgWa = mensajePreSalidaWhatsapp(p, quien);
              return (
                <div key={p.id} className="card" style={{ margin: 0, padding: '.8rem', borderLeft: '4px solid var(--warning)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '.5rem' }}>
                    <strong style={{ fontSize: '1.05rem' }}>{p.codigo}</strong>
                    <span className="badge warning" style={{ fontSize: '.75rem' }}>⏳ Por autorizar</span>
                  </div>

                  <div className="muted" style={{ fontSize: '.82rem', margin: '.3rem 0' }}>
                    🕒 {fechaHoraVE(p.createdAt)} · Solicitó: {p.actorName || p.actor}
                  </div>

                  <div style={{ margin: '.5rem 0' }}>
                    <strong>Materiales ({p.lineas.length}):</strong>
                    <ul style={{ margin: '.25rem 0 0 1.2rem', padding: 0, fontSize: '.9rem' }}>
                      {p.lineas.map((l) => (
                        <li key={l.productoId}>
                          {l.productoNombre}: <strong>{num(l.cantidad)} {l.unidad}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div style={{ fontSize: '.88rem', margin: '.4rem 0' }}>
                    <strong>Motivo:</strong> {p.motivo}
                    {p.equipo?.nombre && (
                      <div><strong>Equipo:</strong> {p.equipo.nombre} {p.tipoMant ? `(${p.tipoMant})` : ''}</div>
                    )}
                    <div><strong>Retorna:</strong> {p.retorna ? '🔄 SÍ (temporal)' : '❌ NO (consumo)'}</div>
                  </div>

                  <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: '.75rem' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        setConfirmando(p);
                        setAutorizado('');
                      }}
                    >
                      ✓ Confirmar salida
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setEditando(p)}
                    >
                      ✎ Editar
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--danger)' }}
                      onClick={() => void handleDescartar(p)}
                    >
                      🗑 Descartar
                    </button>
                  </div>

                  <div style={{ marginTop: '.6rem' }}>
                    <CompartirWhatsapp texto={msgWa} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Modal / Diálogo para confirmar la salida oficial */}
      {confirmando && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem',
          }}
        >
          <div className="card" style={{ maxWidth: 450, width: '100%', margin: 0, background: 'var(--surface-1)' }}>
            <h3 style={{ margin: '0 0 .5rem' }}>✓ Confirmar Salida · {confirmando.codigo}</h3>
            <p className="muted" style={{ fontSize: '.85rem', margin: '0 0 .8rem' }}>
              El supervisor ya aprobó la salida en WhatsApp. Indica quién dio la autorización para descontar el stock y registrar el kardex.
            </p>

            <div className="surt-campo">
              <label htmlFor="pre-autorizado">¿Quién autorizó por WhatsApp? *</label>
              <select
                id="pre-autorizado"
                className="input surt-input"
                value={autorizado}
                onChange={(e) => setAutorizado(e.target.value)}
              >
                <option value="">{autorizadores === null ? 'Cargando…' : 'Elegir autorizador…'}</option>
                {(autorizadores ?? []).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>

            <div style={{ margin: '.6rem 0', fontSize: '.85rem' }}>
              <strong>Se despachará:</strong>
              <ul style={{ margin: '.2rem 0 0 1rem', padding: 0 }}>
                {confirmando.lineas.map((l) => (
                  <li key={l.productoId}>{l.productoNombre}: {num(l.cantidad)} {l.unidad}</li>
                ))}
              </ul>
            </div>

            <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={ejecutando}
                onClick={() => setConfirmando(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={ejecutando || !autorizado.trim()}
                onClick={() => void handleConfirmarSalida(confirmando)}
              >
                {ejecutando ? 'Descontando stock…' : '✓ Descontar y dar salida'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** Editor del borrador: permite quitar, agregar productos o corregir cantidades */
function EditorPreSalida({
  pre,
  productos,
  onCancel,
  onGuardado,
}: {
  pre: PreSalida;
  productos: ProductoEnAlmacen[];
  onCancel: () => void;
  onGuardado: () => void;
}) {
  const [lineas, setLineas] = useState<LineaPreSalida[]>(pre.lineas);
  const [motivo, setMotivo] = useState(pre.motivo);
  const [retorna, setRetorna] = useState(pre.retorna);
  const [buscando, setBuscando] = useState(false);
  const [q, setQ] = useState('');
  const [guardando, setGuardando] = useState(false);

  const candidatos = useMemo(() => {
    const busc = q.toLowerCase().trim();
    if (!busc) return [];
    const ya = new Set(lineas.map((l) => l.productoId));
    return productos.filter((p) => !ya.has(p.id) && (p.nombre.toLowerCase().includes(busc) || p.sku.toLowerCase().includes(busc))).slice(0, 10);
  }, [productos, lineas, q]);

  function agregarProducto(p: ProductoEnAlmacen) {
    setLineas((ls) => [
      ...ls,
      {
        productoId: p.id,
        productoNombre: p.nombre,
        sku: p.sku,
        categoria: p.categoria,
        unidad: p.unidad,
        cantidad: 1,
      },
    ]);
    setBuscando(false);
    setQ('');
  }

  async function handleGuardar() {
    const err = validarPreSalida({ lineas, motivo });
    if (err) {
      toast(err, 'error');
      return;
    }

    setGuardando(true);
    try {
      await actualizarPreSalida(pre.id, {
        motivo,
        retorna,
        lineas,
      });
      toast(`Borrador ${pre.codigo} actualizado.`, 'success');
      onGuardado();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="surt-form">
      <div className="surt-form-titulo">
        <span className="icono" aria-hidden>✎</span>
        <strong>Editar pre-salida · {pre.codigo}</strong>
      </div>

      <div className="surt-campo">
        <label>Materiales del borrador ({lineas.length})</label>
        <div style={{ display: 'grid', gap: '.4rem' }}>
          {lineas.map((l, i) => (
            <div key={l.productoId} style={{ display: 'flex', gap: '.4rem', alignItems: 'center', background: 'var(--surface-2)', padding: '.4rem .6rem', borderRadius: 4 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: '.9rem' }}>
                <strong>{l.productoNombre}</strong>
                <div className="muted" style={{ fontSize: '.75rem' }}>{l.sku} · {l.unidad}</div>
              </span>
              <input
                className="input surt-input"
                type="number"
                min={0.01}
                step="any"
                style={{ width: '5.5rem' }}
                value={l.cantidad || ''}
                aria-label={`Cantidad de ${l.productoNombre}`}
                onChange={(e) => {
                  const val = Number(e.target.value) || 0;
                  setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, cantidad: val } : x)));
                }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Quitar ${l.productoNombre}`}
                onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {!buscando ? (
          <button
            type="button"
            className="btn btn-ghost btn-grande"
            style={{ marginTop: '.5rem' }}
            onClick={() => setBuscando(true)}
          >
            ＋ Agregar otro material
          </button>
        ) : (
          <div style={{ marginTop: '.5rem', display: 'grid', gap: '.35rem' }}>
            <input
              className="input surt-input"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
              placeholder="🔍 Buscar material…"
              autoComplete="off"
            />
            {candidatos.map((p) => (
              <button
                key={p.id}
                type="button"
                className="surt-mov"
                onClick={() => agregarProducto(p)}
              >
                <span className="icono" aria-hidden>📦</span>
                <span style={{ minWidth: 0 }}>
                  <div className="titulo">{p.nombre}</div>
                  <div className="sub">{p.sku} · {p.categoria}</div>
                </span>
                <span className="litros">{num(p.stock_almacen)} {p.unidad}</span>
              </button>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBuscando(false)}>
              Cerrar buscador
            </button>
          </div>
        )}
      </div>

      <div className="surt-campo">
        <label htmlFor="edit-pre-motivo">Motivo</label>
        <input
          id="edit-pre-motivo"
          className="input surt-input"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </div>

      <div className="surt-campo">
        <span className="surt-rotulo">¿Retorna?</span>
        <div className="surt-sino">
          <button
            type="button"
            className={`surt-btn si${retorna ? ' sel' : ''}`}
            onClick={() => setRetorna(true)}
          >
            🔄 SÍ
          </button>
          <button
            type="button"
            className={`surt-btn no${!retorna ? ' sel' : ''}`}
            onClick={() => setRetorna(false)}
          >
            ❌ NO
          </button>
        </div>
      </div>

      <button
        type="button"
        className="btn btn-primary surt-guardar"
        disabled={guardando || !lineas.length || !motivo.trim()}
        onClick={() => void handleGuardar()}
      >
        {guardando ? 'Guardando…' : '✓ Guardar cambios del borrador'}
      </button>

      <button type="button" className="btn btn-ghost btn-grande" onClick={onCancel} disabled={guardando}>
        ← Cancelar edición
      </button>
    </div>
  );
}
