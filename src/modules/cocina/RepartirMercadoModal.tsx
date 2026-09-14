/* ============================================================
   MGG · Cocina · Repartir el mercado a otra cocina

   Arma la solicitud de traslado (TRA) con lo que va a la otra
   cocina. No mueve el inventario: se autoriza en Salidas y el stock
   se mueve cuando la ejecutan. Desde ahí aparece en la columna
   «Traslados» de las dos cocinas.

   Se ofrece por víver lo que hay en el almacén del que sale, no lo
   que dice el libro: un traslado se ejecuta contra el stock real, y
   pedir lo que el libro dice pero el almacén no tiene deja una
   solicitud que nadie puede ejecutar. El libro va al lado, como
   referencia.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { dosDecimales, money, num } from '@/shared/lib/format';
import { textoDeError } from '@/shared/lib/errores';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import type { ResumenMercado } from './mercados.repository';
import { crearReparto, prepararReparto, type CocinaDestino, type ViverParaRepartir } from './reparto.repository';

export function RepartirMercadoModal({ resumen, cocinaNombre, almacen, actor, userEmail, onClose, onDone }: {
  resumen: ResumenMercado;
  cocinaNombre: string;
  almacen: string | null;
  actor: string;
  userEmail: string | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const { appUser } = usePermissions();
  const { mercado, disponible } = resumen;
  const [cargando, setCargando] = useState(true);
  const [destinos, setDestinos] = useState<CocinaDestino[]>([]);
  const [viveres, setViveres] = useState<ViverParaRepartir[]>([]);
  const [destinoId, setDestinoId] = useState('');
  const [cant, setCant] = useState<Record<string, string>>({});
  const [busca, setBusca] = useState('');
  const [soloElegidos, setSoloElegidos] = useState(false);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    prepararReparto(mercado.cocina_id, almacen)
      .then((r) => {
        if (!vivo) return;
        setDestinos(r.destinos);
        setViveres(r.viveres);
        // Con un solo destino posible, elegirlo es un paso de más.
        if (r.destinos.length === 1) setDestinoId(r.destinos[0].id);
      })
      .catch((e) => { if (vivo) setError(textoDeError(e, 'No se pudo preparar el reparto.')); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [mercado.cocina_id, almacen]);

  const destino = destinos.find((d) => d.id === destinoId) ?? null;
  const quedaDe = useMemo(() => new Map(disponible.map((d) => [d.producto_id, d.queda] as const)), [disponible]);

  const lineas = useMemo(() => viveres.map((v) => {
    const n = Number(cant[v.producto_id] ?? '');
    return { v, cantidad: Number.isFinite(n) && n > 0 ? n : 0 };
  }), [viveres, cant]);
  const elegidas = lineas.filter((l) => l.cantidad > 0);
  const excedidas = elegidas.filter((l) => l.cantidad > l.v.stock + 1e-9);
  const enDestino = destino ? elegidas.filter((l) => l.v.almacen === destino.almacen) : [];
  const valor = elegidas.reduce((a, l) => a + l.cantidad * l.v.costo, 0);

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return lineas.filter((l) => {
      if (soloElegidos && l.cantidad <= 0) return false;
      return !q || `${l.v.nombre} ${l.v.sku}`.toLowerCase().includes(q);
    });
  }, [lineas, busca, soloElegidos]);

  // Una sola razón a la vista, la primera que falta: una lista de cuatro errores
  // juntos no dice por dónde empezar.
  const bloqueo = !destino ? 'Elegí a qué cocina va el reparto.'
    : !elegidas.length ? 'Indicá cuánto va de al menos un víver.'
    : excedidas.length ? `${excedidas.length} víver${excedidas.length === 1 ? '' : 'es'} piden más de lo que hay en el almacén.`
    : enDestino.length ? `${enDestino[0].v.nombre} ya está en ${destino.almacen}: ese traslado no movería nada.`
    : null;

  async function confirmar() {
    if (bloqueo || !destino || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const sol = await crearReparto({
        mercadoNumero: mercado.numero,
        cocinaOrigen: cocinaNombre,
        destino,
        lineas: elegidas.map((l) => ({
          producto_id: l.v.producto_id, nombre: l.v.nombre, unidad: l.v.unidad,
          almacen: l.v.almacen, cantidad: l.cantidad, costo: l.v.costo,
        })),
        nota,
        solicitante: appUser?.nombre || userEmail || actor,
        actor,
        actorName: appUser?.nombre ?? userEmail,
      });
      notify(`🚚 Reparto del mercado #${mercado.numero}: ${cocinaNombre} → ${destino.nombre} · ${sol.codigo} por aprobar`, 'info', { link: '#/app/salidas' });
      toast(`Solicitud ${sol.codigo} creada · se autoriza y ejecuta en Salidas`, 'success');
      await onDone();
    } catch (e) {
      setError(textoDeError(e, 'No se pudo crear la solicitud de traslado.'));
      setGuardando(false);
    }
  }

  return (
    <Modal title={`Repartir el mercado #${mercado.numero} · ${cocinaNombre}`} size="lg"
      onClose={() => { if (!guardando) onClose(); }}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => void confirmar()}
            disabled={!!bloqueo || guardando || cargando} title={bloqueo ?? undefined}>
            {guardando ? 'Creando…' : '🚚 Crear solicitud de traslado'}
          </button>
        </>
      }>
      <p className="hint muted" style={{ marginTop: 0 }}>
        Se arma una <strong>solicitud de traslado</strong> en Salidas. <strong>No mueve el inventario</strong>:
        la autorizan Leydis Rengel o Jesús Lozada, y el stock se mueve cuando Salidas la ejecuta. Desde ese
        momento aparece en la columna «Traslados» de las dos cocinas —resta acá, suma allá— y no genera
        diferencia en ninguna. No hace falta esperar al cierre.
      </p>
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem', whiteSpace: 'pre-line' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {cargando ? (
        <p className="muted">Cargando víveres…</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.6rem' }}>
            <div className="form-row" style={{ margin: 0 }}>
              <label>Cocina destino</label>
              {destinos.length ? (
                <select className="select" value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
                  {destinos.length > 1 && <option value="">Elegí…</option>}
                  {destinos.map((d) => <option key={d.id} value={d.id}>{d.nombre} · 📦 {d.almacen}</option>)}
                </select>
              ) : (
                <p className="hint muted" style={{ margin: 0 }}>No hay otra cocina con almacén vinculado.</p>
              )}
            </div>
            <div className="form-row" style={{ margin: 0 }}>
              <label>Buscar víver</label>
              <input className="input" type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nombre o SKU…" />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', margin: '.6rem 0 .35rem' }}>
            <span className="muted" style={{ fontSize: '.8rem' }}>
              {elegidas.length
                ? <>{elegidas.length} víver{elegidas.length === 1 ? '' : 'es'} · valor aprox. <strong className="mono">{money(valor)}</strong></>
                : 'Escribí la cantidad que va de cada víver.'}
            </span>
            <label style={{ fontSize: '.8rem', display: 'flex', gap: '.35rem', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={soloElegidos} onChange={(e) => setSoloElegidos(e.target.checked)} />
              Solo los elegidos
            </label>
          </div>

          {!viveres.length ? (
            <p className="hint muted">No hay víveres con stock en {almacen}.</p>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
              <table className="table" style={{ fontSize: '.83rem' }}>
                <thead><tr>
                  <th>Víver</th>
                  <th style={{ textAlign: 'right' }} title="Stock del almacén de donde sale el traslado">Hay</th>
                  <th style={{ textAlign: 'right' }} title="Lo que el mercado dice que queda">Libro</th>
                  <th style={{ textAlign: 'right' }}>Enviar</th>
                </tr></thead>
                <tbody>
                  {visibles.map(({ v, cantidad }) => {
                    const excede = cantidad > v.stock + 1e-9;
                    const queda = quedaDe.get(v.producto_id);
                    return (
                      <tr key={v.producto_id}
                        style={cantidad > 0 ? { borderLeft: `3px solid ${excede ? 'var(--danger)' : 'var(--info)'}` } : undefined}>
                        <td>
                          {v.nombre} <span className="muted mono" style={{ fontSize: '.72rem' }}>{v.unidad}</span>
                          <div className="dim" style={{ fontSize: '.7rem' }}>{v.sku} · 📦 {v.almacen}</div>
                        </td>
                        <td className="mono" style={{ textAlign: 'right' }}>{num(v.stock)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{queda == null ? '·' : num(queda)}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <input className="input mono" type="text" inputMode="decimal"
                            aria-label={`Cantidad de ${v.nombre} a enviar`}
                            style={{ width: 80, textAlign: 'right', display: 'inline-block', ...(excede ? { borderColor: 'var(--danger)' } : {}) }}
                            value={cant[v.producto_id] ?? ''} placeholder="0"
                            onChange={(e) => setCant((c) => ({ ...c, [v.producto_id]: dosDecimales(e.target.value) }))} />
                          <button type="button" className="btn btn-sm btn-ghost" style={{ marginLeft: '.25rem' }}
                            onClick={() => setCant((c) => ({ ...c, [v.producto_id]: String(v.stock) }))}
                            title="Enviar todo lo que hay en el almacén">
                            todo
                          </button>
                          {excede && <div style={{ color: 'var(--danger)', fontSize: '.7rem' }}>máx. {num(v.stock)}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="form-row" style={{ marginTop: '.6rem' }}>
            <label>Nota <span className="muted" style={{ fontWeight: 400 }}>· opcional, va en el motivo del traslado</span></label>
            <input className="input" value={nota} onChange={(e) => setNota(e.target.value)}
              placeholder="Ej.: primera entrega de la semana" />
          </div>
          {bloqueo && elegidas.length > 0 && (
            <p className="hint" style={{ color: 'var(--warning)', margin: 0 }}>{bloqueo}</p>
          )}
        </>
      )}
    </Modal>
  );
}
