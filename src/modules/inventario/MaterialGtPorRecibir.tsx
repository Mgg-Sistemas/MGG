/* ============================================================
   MGG · Inventario · «📦 Mercancía de GT» (10/11/2026)
   Botón con el contador de lo que Golden Touch envió a Los Pinos y su
   ventana: por cada envío, cada renglón se empareja con un producto de MGG
   (sugerido por nombre) o se crea; «Aceptar» le da entrada en Los Pinos con
   el costo de GT (PMP) y «Rechazar» se lo devuelve a GT con el motivo.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { dateTime, money, num } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Producto } from '@/shared/lib/types';
import { listProductos } from './inventario.repository';
import {
  ALMACEN_DESTINO_GT, aceptarMaterialGt, listEntrantesMaterialGt, rechazarMaterialGt, sugerirProducto,
  type EntranteMaterialGt,
} from './materialGt.repository';

const CREAR = '__crear__';

export function MaterialGtPorRecibir({ actor, actorName, canWrite }: { actor: string; actorName: string | null; canWrite: boolean }) {
  const [entrantes, setEntrantes] = useState<EntranteMaterialGt[]>([]);
  const [abierto, setAbierto] = useState(false);
  const cargar = useCallback(async () => { setEntrantes(await listEntrantesMaterialGt()); }, []);
  useEffect(() => { void cargar().catch(() => {}); }, [cargar]);
  useRealtime(['transferencias_material_inter'], () => { void cargar().catch(() => {}); });
  const pendientes = entrantes.filter((t) => t.estado === 'por_confirmar');
  if (!entrantes.length) return null;
  return (
    <>
      <button className={`btn ${pendientes.length ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setAbierto(true)}
        title="Mercancía que Golden Touch envió al Almacén Los Pinos">
        📦 Mercancía de GT{pendientes.length ? ` · ${pendientes.length} por recibir` : ''}
      </button>
      {abierto && (
        <RecibirMaterialGtModal entrantes={entrantes} actor={actor} actorName={actorName} canWrite={canWrite}
          onClose={() => setAbierto(false)} onCambio={() => { void cargar().catch(() => {}); }} />
      )}
    </>
  );
}

function RecibirMaterialGtModal({ entrantes, actor, actorName, canWrite, onClose, onCambio }: {
  entrantes: EntranteMaterialGt[]; actor: string; actorName: string | null; canWrite: boolean; onClose: () => void; onCambio: () => void;
}) {
  const [productos, setProductos] = useState<Producto[]>([]);
  useEffect(() => { listProductos().then(setProductos).catch(() => setProductos([])); }, []);
  const pendientes = entrantes.filter((t) => t.estado === 'por_confirmar');
  const hechas = entrantes.filter((t) => t.estado !== 'por_confirmar').slice(0, 20);
  return (
    <Modal title="📦 Mercancía de Golden Touch → Almacén Los Pinos" size="lg" onClose={onClose}>
      <div className="aviso info sm" style={{ marginBottom: '.75rem' }}>
        <span className="aviso-icono">🔗</span>
        <div>
          Viene del <strong>Almacén Los Pinos de GT</strong>. Elige con qué producto de MGG entra cada renglón (se sugiere por nombre;
          los códigos de GT son otros) o deja «Crear nuevo». Al aceptar entra al <strong>Almacén {ALMACEN_DESTINO_GT}</strong> con el costo de GT, que se promedia (PMP).
        </div>
      </div>
      {!pendientes.length && <p className="muted">No hay mercancía por recibir.</p>}
      {pendientes.map((t) => (
        <EnvioGt key={t.id} t={t} productos={productos} actor={actor} actorName={actorName} canWrite={canWrite} onCambio={onCambio} />
      ))}
      {hechas.length > 0 && (
        <div className="card" style={{ marginTop: '.75rem' }}>
          <div className="card-title"><span>🧾 Ya procesadas</span></div>
          {hechas.map((t) => (
            <div key={t.id} style={{ padding: '.35rem 0', borderBottom: '1px dashed var(--border)', fontSize: '.85rem' }}>
              <strong>{t.estado === 'recibida' ? '✅ Recibida' : t.estado === 'rechazada' ? '⛔ Rechazada' : t.estado}</strong>
              {' · '}{t.resumen}{' · '}<span className="muted">{dateTime(t.confirmada_at ?? t.created_at)}{t.confirmada_por ? ` · ${t.confirmada_por}` : ''}</span>
              {t.rechazo_motivo && <div style={{ color: 'var(--danger)' }}>Motivo: {t.rechazo_motivo}</div>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function EnvioGt({ t, productos, actor, actorName, canWrite, onCambio }: {
  t: EntranteMaterialGt; productos: Producto[]; actor: string; actorName: string | null; canWrite: boolean; onCambio: () => void;
}) {
  const items = t.items ?? [];
  const [destinos, setDestinos] = useState<string[]>(() => items.map(() => ''));
  const [ocupado, setOcupado] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');

  // Sugerencia por nombre en cuanto llegan los productos (sin pisar lo que se eligió a mano).
  useEffect(() => {
    if (!productos.length) return;
    setDestinos((ds) => items.map((it, k) => ds[k] || it.destino_producto_id || sugerirProducto(it, productos) || CREAR));
  }, [productos]); // eslint-disable-line react-hooks/exhaustive-deps

  const opciones = useMemo(() => productos
    .filter((p) => !p.estado || p.estado === 'activo')
    .map((p) => ({ value: p.id, label: p.nombre, hint: p.sku })), [productos]);

  async function aceptar() {
    setOcupado(true);
    try {
      await aceptarMaterialGt({ entrante: t, destinos: destinos.map((d) => (d && d !== CREAR ? d : null)), actor, actorName });
      toast(`Recibido en ${ALMACEN_DESTINO_GT}: ${items.length} producto(s).`, 'success');
      onCambio();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo recibir', 'error'); onCambio(); }
    finally { setOcupado(false); }
  }
  async function rechazar() {
    setOcupado(true);
    try {
      await rechazarMaterialGt({ entrante: t, motivo, actor, actorName });
      toast('Rechazada: GT puede devolverla a su inventario.', 'success');
      onCambio();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo rechazar', 'error'); }
    finally { setOcupado(false); }
  }

  return (
    <div className="card" style={{ marginBottom: '.6rem', borderColor: 'var(--brand, #ff8a00)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
        <div>
          <strong>De Golden Touch · {dateTime(t.created_at)}</strong>
          <div className="muted" style={{ fontSize: '.8rem' }}>
            Envió {t.actor_name ?? t.actor ?? '—'}{t.total_usd != null ? ` · valor ${money(t.total_usd, 'USD')}` : ''}{t.motivo ? ` · ${t.motivo}` : ''}
          </div>
        </div>
        <span className="badge warning">⏳ Por recibir</span>
      </div>
      <table className="table" style={{ marginTop: '.5rem' }}>
        <thead><tr><th>Producto (GT)</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Costo c/u</th><th style={{ minWidth: 240 }}>Entra en MGG como…</th></tr></thead>
        <tbody>
          {items.map((it, k) => (
            <tr key={`${t.id}-${k}`}>
              <td><strong>{it.nombre}</strong>{it.sku && <div className="muted" style={{ fontSize: '.75rem' }}>Código GT: {it.sku}</div>}</td>
              <td style={{ textAlign: 'right' }} className="mono">{num(it.cantidad)} {it.unidad}</td>
              <td style={{ textAlign: 'right' }} className="mono">{it.costo_unitario != null ? money(it.costo_unitario, 'USD') : '—'}</td>
              <td>
                <SearchSelect value={destinos[k] ?? ''} disabled={!canWrite || ocupado}
                  options={[{ value: CREAR, label: `＋ Crear nuevo: ${it.nombre}`, hint: it.unidad ?? '' }, ...opciones]}
                  onChange={(v) => setDestinos((ds) => ds.map((d, i) => (i === k ? (v || CREAR) : d)))} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canWrite && !rechazando && (
        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: '.5rem' }}>
          <button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }} disabled={ocupado} onClick={() => setRechazando(true)}>✕ Rechazar</button>
          <button type="button" className="btn btn-primary" disabled={ocupado || !productos.length} onClick={() => void aceptar()}>
            {ocupado ? 'Recibiendo…' : `✓ Aceptar y dar entrada en ${ALMACEN_DESTINO_GT}`}
          </button>
        </div>
      )}
      {canWrite && rechazando && (
        <div style={{ display: 'grid', gap: '.4rem', marginTop: '.5rem' }}>
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="¿Por qué se rechaza? (lo verá GT)" autoFocus />
          <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={() => setRechazando(false)}>Volver</button>
            <button type="button" className="btn btn-danger" disabled={ocupado || !motivo.trim()} onClick={() => void rechazar()}>Rechazar y avisar a GT</button>
          </div>
        </div>
      )}
    </div>
  );
}
