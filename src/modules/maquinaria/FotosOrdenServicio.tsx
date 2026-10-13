import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { previewArchivo } from '@/shared/lib/reportePreview';
import { mensajeError } from '@/shared/lib/errores';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useSession } from '@/modules/auth/authStore';
import { supabase } from '@/shared/lib/supabase';
import { MAX_FOTOS_ORDEN, avisoCupo, tomarHastaCupo } from './osFotos';
import {
  TABLA_OS_FOTOS, eliminarFotoOrden, listFotosOrden, prepararFotoOrden, subirFotoOrden, urlsFotos, type FotoOrden,
} from './osFotos.repository';
import type { FotosLocales } from './useFotosLocales';

/* ───────── Piezas comunes: elegir / tomar fotos y la cuadrícula de miniaturas ───────── */

/** Botones «Tomar foto» (cámara del teléfono) y «Elegir de la galería» (varias a la vez). */
function ElegirFotos({ cantidad, ocupado, onArchivos }: { cantidad: number; ocupado: boolean; onArchivos: (files: File[]) => void }) {
  const camaraRef = useRef<HTMLInputElement>(null);
  const galeriaRef = useRef<HTMLInputElement>(null);
  const lleno = cantidad >= MAX_FOTOS_ORDEN;
  const recibir = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) onArchivos(files);
  };
  if (lleno) return <p className="flo-osf-nota">Ya tiene las {MAX_FOTOS_ORDEN} fotos. Quita una para agregar otra.</p>;
  return (
    <div className="flo-osf-acc">
      <button type="button" className="btn" disabled={ocupado} onClick={() => camaraRef.current?.click()}>📷 Tomar foto</button>
      <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={() => galeriaRef.current?.click()}>🖼 Elegir de la galería</button>
      <input ref={camaraRef} type="file" accept="image/*" capture="environment" hidden aria-label="Tomar foto con la cámara" onChange={(e) => recibir(e.currentTarget)} />
      <input ref={galeriaRef} type="file" accept="image/*" multiple hidden aria-label="Elegir fotos de la galería" onChange={(e) => recibir(e.currentTarget)} />
    </div>
  );
}

interface ItemGaleria { key: string; url: string | null; nombre: string; onVer?: () => void; onQuitar?: () => void }

function Galeria({ items, preparando = 0 }: { items: ItemGaleria[]; preparando?: number }) {
  if (!items.length && !preparando) return null;
  return (
    <ul className="flo-osf-grid" aria-label="Fotos de la orden">
      {items.map((it, i) => (
        <li key={it.key} className="flo-osf-item">
          {it.url ? (
            <button type="button" className="ver" onClick={it.onVer} aria-label={`Ver foto ${i + 1} en grande`}>
              <img src={it.url} alt={`Foto ${i + 1} de la orden`} loading="lazy" />
            </button>
          ) : <span className="cargando">Cargando…</span>}
          <span className="n" aria-hidden="true">{i + 1}</span>
          {it.onQuitar && <button type="button" className="quitar" onClick={it.onQuitar} aria-label={`Quitar la foto ${i + 1}`} title="Quitar foto">✕</button>}
        </li>
      ))}
      {Array.from({ length: preparando }, (_, i) => <li key={`prep-${i}`} className="flo-osf-item"><span className="cargando">Preparando…</span></li>)}
    </ul>
  );
}

/* ───────── Fotos de una orden que todavía no existe (asistente) ───────── */

/** Bloque del asistente: miniaturas con ✕ y los botones para tomar/elegir. */
export function FotosNuevaOrden({ estado }: { estado: FotosLocales }) {
  const { fotos, preparando, agregar, quitar } = estado;
  return (
    <div className="flo-osf">
      <div className="flo-osf-head">
        <label>Fotos del equipo o del daño <span className="muted">(opcional · {fotos.length} de {MAX_FOTOS_ORDEN})</span></label>
      </div>
      <Galeria preparando={preparando} items={fotos.map((f) => ({
        key: f.id, url: f.url, nombre: f.file.name,
        onVer: () => previewArchivo(f.url, f.file.name),
        onQuitar: () => quitar(f.id),
      }))} />
      <ElegirFotos cantidad={fotos.length + preparando} ocupado={preparando > 0} onArchivos={(fs) => void agregar(fs)} />
      <p className="flo-osf-nota">Hasta {MAX_FOTOS_ORDEN} fotos. Se achican solas a JPG para subir rápido con poca señal y salen en el PDF de la orden.</p>
    </div>
  );
}

/* ───────── Fotos de una orden ya creada (expediente y submódulo) ───────── */

/**
 * Las fotos de una orden existente: verlas en grande, agregar hasta 4 y quitar
 * (con permiso de escritura en Maquinaria). En vivo.
 */
export function FotosOrden({ ordenId, canWrite, mostrarVacio = true }: { ordenId: string; canWrite: boolean; mostrarVacio?: boolean }) {
  const { appUser } = usePermissions();
  const { user } = useSession();
  const [fotos, setFotos] = useState<FotoOrden[]>([]);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(0);
  const [quitar, setQuitar] = useState<FotoOrden | null>(null);
  const urlsRef = useRef(urls);
  urlsRef.current = urls;

  const recargar = useCallback(async () => {
    const lista = await listFotosOrden(ordenId);
    setFotos(lista);
    // Solo se firman las rutas nuevas: las miniaturas que ya estaban no parpadean.
    const faltan = lista.map((f) => f.path).filter((p) => !urlsRef.current.has(p));
    if (faltan.length) {
      const nuevas = await urlsFotos(faltan);
      setUrls((prev) => new Map([...prev, ...nuevas]));
    }
  }, [ordenId]);

  useEffect(() => {
    recargar().catch((e) => toast(mensajeError(e, 'No se pudieron cargar las fotos'), 'error')).finally(() => setCargando(false));
  }, [recargar]);
  useRealtime([TABLA_OS_FOTOS], () => { void recargar().catch(() => {}); });

  async function agregar(files: File[]) {
    const { tomar, descartadas } = tomarHastaCupo(fotos.length + subiendo, files);
    const aviso = avisoCupo(descartadas);
    if (aviso) toast(aviso, 'warning');
    if (!tomar.length) return;
    setSubiendo((n) => n + tomar.length);
    let ok = 0;
    for (const original of tomar) {
      try {
        const file = await prepararFotoOrden(original);
        await subirFotoOrden(ordenId, file, user?.email ?? null, appUser?.nombre ?? null);
        ok++;
      } catch (e) {
        toast(mensajeError(e, 'No se pudo subir la foto'), 'error');
      } finally {
        setSubiendo((n) => n - 1);
      }
    }
    if (ok) toast(ok === 1 ? 'Foto agregada a la orden' : `${ok} fotos agregadas a la orden`, 'success');
    await recargar().catch(() => {});
  }

  async function confirmarQuitar() {
    const f = quitar;
    setQuitar(null);
    if (!f) return;
    try {
      await eliminarFotoOrden(f);
      toast('Foto quitada', 'success');
      await recargar();
    } catch (e) { toast(mensajeError(e, 'No se pudo quitar la foto'), 'error'); }
  }

  if (cargando) return mostrarVacio ? <p className="flo-osf-nota">Cargando fotos…</p> : null;
  if (!fotos.length && !subiendo && !canWrite && !mostrarVacio) return null;

  return (
    <div className="flo-osf">
      <div className="flo-osf-head"><strong>📷 Registro fotográfico</strong><span className="muted">{fotos.length} de {MAX_FOTOS_ORDEN}</span></div>
      <Galeria preparando={subiendo} items={fotos.map((f) => {
        const url = urls.get(f.path) ?? null;
        return {
          key: f.id, url, nombre: f.nombre,
          onVer: url ? () => previewArchivo(url, f.nombre) : undefined,
          onQuitar: canWrite ? () => setQuitar(f) : undefined,
        };
      })} />
      {!fotos.length && !subiendo && <p className="flo-osf-nota">Sin fotos todavía.</p>}
      {canWrite && <ElegirFotos cantidad={fotos.length + subiendo} ocupado={subiendo > 0} onArchivos={(fs) => void agregar(fs)} />}
      {quitar && (
        <ConfirmDialog title="Quitar foto" danger confirmText="Quitar"
          message="Se borra esta foto de la orden. No se puede deshacer."
          preview={urls.get(quitar.path) ? <img className="flo-osf-confirm" src={urls.get(quitar.path)} alt="Foto que se va a quitar" /> : undefined}
          onCancel={() => setQuitar(null)} onConfirm={() => void confirmarQuitar()} />
      )}
    </div>
  );
}

/** Ventana con las fotos de una orden (desde el submódulo y el historial). */
export function FotosOrdenModal({ ordenId, codigo, equipo, canWrite, onClose }: { ordenId: string; codigo: string; equipo?: string | null; canWrite: boolean; onClose: () => void }) {
  return (
    <Modal title={`📷 Fotos · ${codigo}${equipo ? ` · ${equipo}` : ''}`} onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <div className="flo">
        <FotosOrden ordenId={ordenId} canWrite={canWrite} />
      </div>
    </Modal>
  );
}

/**
 * Fotos de la orden de servicio que originó una solicitud de pedido (12/10/2026).
 * La SP nace de la OS con `orden_compra_id`; las fotos se quedan en la OS (no se
 * copian) y aquí se muestran de solo lectura, en vivo, para que Compras vea la pieza.
 */
export function FotosOrdenServicioDeSp({ spId }: { spId: string }) {
  const [ordenes, setOrdenes] = useState<{ id: string; codigo: string }[]>([]);
  useEffect(() => {
    let vivo = true;
    supabase.from('maquinaria_ordenes_servicio').select('id, codigo').eq('orden_compra_id', spId)
      .then(({ data }) => { if (vivo) setOrdenes((data ?? []) as { id: string; codigo: string }[]); });
    return () => { vivo = false; };
  }, [spId]);
  if (!ordenes.length) return null;
  return (
    <>
      {ordenes.map((o) => (
        <div key={o.id} className="detail-row">
          <div className="k">Fotos de la {o.codigo}</div>
          <div className="v flo"><FotosOrden ordenId={o.id} canWrite={false} /></div>
        </div>
      ))}
    </>
  );
}
