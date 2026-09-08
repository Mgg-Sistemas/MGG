/* ============================================================
   Inventario · «También en…» — que una ficha figure en otra sede
   Crea la existencia EN CERO, sin mover material y sin línea de kardex
   (no hay movimiento que registrar). Sirve para el caso que no tenía
   salida: un material que se va a manejar en dos sedes pero todavía no
   llegó el primer bulto — «Mover a otro almacén» exige cantidad > 0.
   ============================================================ */
import { useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { money } from '@/shared/lib/format';
import type { Almacen, Existencia } from '@/shared/lib/types';
import { crearExistenciaInicial } from './almacenes.repository';
import { opcionesDePresencia } from './presenciaAlmacen';
import { useSectorizacion } from './useSectorizacion';

interface Props {
  producto: { id: string; nombre: string; sku?: string | null; precio?: number | null; unidad?: string | null };
  almacenes: Almacen[];
  /** Existencias de ESTE producto (para saber dónde ya figura). */
  existencias: Pick<Existencia, 'almacen'>[];
  onClose: () => void;
  onDone: () => void;
}

export function PresenciaAlmacenModal({ producto, almacenes, existencias, onClose, onDone }: Props) {
  // Mismo criterio que mover stock: un almacenista solo abre la ficha en SUS sedes.
  const sector = useSectorizacion();
  const grupos = useMemo(() => opcionesDePresencia(almacenes, existencias), [almacenes, existencias]);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);

  const costo = Number(producto.precio) || 0;
  const puede = elegidos.length > 0 && !guardando;

  function alternar(nombre: string) {
    setElegidos((prev) => (prev.includes(nombre) ? prev.filter((n) => n !== nombre) : [...prev, nombre]));
  }

  const sembrar = async () => {
    if (!puede) return;
    if (sector.sectorizado && !sector.listo) {
      toast('Todavía se están cargando los almacenes. Probá de nuevo en un momento.', 'warning'); return;
    }
    const bloqueado = elegidos.map((n) => sector.motivo(n)).find(Boolean);
    if (bloqueado) { toast(bloqueado, 'error'); return; }
    setGuardando(true);
    try {
      // El costo se hereda de la ficha: sin él, la existencia nace «sin costo»
      // y engorda esa lista sin que nadie haya comprado nada.
      for (const nombre of elegidos) await crearExistenciaInicial(producto.id, nombre, costo);
      toast(
        elegidos.length === 1
          ? `${producto.nombre} ya figura en ${elegidos[0]}`
          : `${producto.nombre} ya figura en ${elegidos.length} almacenes`,
        'success',
      );
      onDone();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo agregar el almacén', 'error');
      setGuardando(false);
    }
  };

  return (
    <Modal title={`También en… · ${producto.nombre}`} size="sm" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
        <button className="btn btn-primary" onClick={sembrar} disabled={!puede}>
          {guardando ? 'Agregando…' : `Agregar${elegidos.length ? ` (${elegidos.length})` : ''}`}
        </button>
      </>
    }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
        <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>
          Hace que la ficha aparezca en la lista de esa sede <strong>en cero</strong>, para pedirla
          o recibirla ahí. No mueve material ni deja línea en el kardex.
        </p>

        {grupos.map(([sede, opciones]) => (
          <div key={sede}>
            <div style={{ fontWeight: 700, fontSize: '.78rem', letterSpacing: '.03em', marginBottom: '.3rem' }}>{sede}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
              {opciones.map((o) => {
                const bloqueo = sector.motivo(o.nombre);
                const inhabilitado = o.yaEsta || !!bloqueo || guardando;
                return (
                  <label key={o.nombre}
                    title={bloqueo ?? (o.yaEsta ? 'Ya figura acá' : undefined)}
                    style={{ display: 'flex', alignItems: 'center', gap: '.5rem', paddingLeft: '.4rem', opacity: inhabilitado ? 0.6 : 1 }}>
                    <input type="checkbox" disabled={inhabilitado}
                      checked={o.yaEsta || elegidos.includes(o.nombre)}
                      onChange={() => alternar(o.nombre)} />
                    <span>{o.nombre}</span>
                    {o.yaEsta && <small className="muted">· ya figura</small>}
                    {!o.yaEsta && bloqueo && <small className="muted">· 🔒 otra sede</small>}
                  </label>
                );
              })}
            </div>
          </div>
        ))}

        <div className="muted" style={{ fontSize: '.8rem' }}>
          Entra con stock 0 y costo {money(costo)} (el de la ficha).
          {costo <= 0 && ' Cargale el precio para que no cuente como «sin costo».'}
        </div>
      </div>
    </Modal>
  );
}
