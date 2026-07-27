/* ============================================================
   Inventario · Panel lateral en árbol (Sede → Almacén → Sub-almacén)
   Navegación colapsable de almacenes. Al clickear un nodo, filtra el
   listado del inventario a ese almacén (con roll-up de sub-almacenes).
   ============================================================ */
import { useMemo, useState } from 'react';
import { money } from '@/shared/lib/format';
import type { Almacen } from '@/shared/lib/types';
import { construirArbol, type NodoArbol } from './arbolAlmacenes';

interface ValorNodo { valor: number; items: number }

interface Props {
  almacenes: Almacen[];
  sedesIncluidas: string[];
  /** Nombre del almacén activo (resaltado). */
  seleccionado: string | null;
  /** Valor/conteo por nombre de almacén (roll-up, solo con stock). */
  valores: Record<string, ValorNodo>;
  onSelect: (nombre: string) => void;
}

export function ArbolAlmacenesPanel({ almacenes, sedesIncluidas, seleccionado, valores, onSelect }: Props) {
  const arbol = useMemo(() => construirArbol(almacenes, sedesIncluidas), [almacenes, sedesIncluidas]);
  // Sedes colapsadas (por defecto todas abiertas); nodos con hijos colapsados.
  const [cerrados, setCerrados] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setCerrados((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  if (!arbol.length) {
    return <div className="muted" style={{ padding: '.5rem' }}>No hay almacenes en estas sedes.</div>;
  }

  const renderNodo = (n: NodoArbol, nivel: number) => {
    const v = valores[n.nombre];
    const tieneHijos = n.hijos.length > 0;
    const key = `n:${n.id}`;
    const colapsado = cerrados.has(key);
    const activo = seleccionado === n.nombre;
    return (
      <div key={n.id}>
        <div
          className={`arbol-item${activo ? ' activo' : ''}`}
          style={{
            display: 'flex', alignItems: 'center', gap: '.35rem',
            padding: '.28rem .4rem', paddingLeft: `${0.4 + nivel * 0.9}rem`,
            cursor: 'pointer', borderRadius: 6,
            background: activo ? 'var(--primary-soft, rgba(245,158,11,.15))' : 'transparent',
            fontWeight: activo ? 700 : 400,
          }}
          onClick={() => onSelect(n.nombre)}
          title={`Ver ${n.nombre}`}
        >
          {tieneHijos ? (
            <button
              className="btn btn-ghost btn-xs"
              style={{ padding: '0 .25rem', lineHeight: 1 }}
              onClick={(e) => { e.stopPropagation(); toggle(key); }}
              title={colapsado ? 'Expandir' : 'Colapsar'}
            >{colapsado ? '▸' : '▾'}</button>
          ) : <span style={{ width: '1.1rem', textAlign: 'center', opacity: .4 }}>·</span>}
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.nombre}</span>
          {v && v.items > 0 && (
            <span className="muted mono" style={{ fontSize: '.72rem' }}>{v.items} · {money(v.valor)}</span>
          )}
        </div>
        {tieneHijos && !colapsado && n.hijos.map((h) => renderNodo(h, nivel + 1))}
      </div>
    );
  };

  return (
    <div className="arbol-almacenes" style={{ display: 'flex', flexDirection: 'column', gap: '.15rem' }}>
      {arbol.map((s) => {
        const key = `s:${s.sede}`;
        const colapsada = cerrados.has(key);
        return (
          <div key={s.sede}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '.35rem', padding: '.3rem .3rem', cursor: 'pointer', fontWeight: 700 }}
              onClick={() => toggle(key)}
              title={colapsada ? 'Expandir sede' : 'Colapsar sede'}
            >
              <span style={{ width: '1.1rem', textAlign: 'center' }}>{colapsada ? '▸' : '▾'}</span>
              <span style={{ flex: 1 }}>📍 {s.sede}</span>
            </div>
            {!colapsada && <div>{s.nodos.map((n) => renderNodo(n, 1))}</div>}
          </div>
        );
      })}
    </div>
  );
}
