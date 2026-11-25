import { useEffect, useState, type FormEvent } from 'react';
import type { Almacen, Usuario } from '@/shared/lib/types';
import { Modal } from '@/shared/ui/Modal';
import { SearchCreateSelect, SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { listUsuarios } from '@/modules/usuarios/usuarios.repository';
import { ensureUnidadSolicitante, listCatalogoPedido } from '@/modules/pedidos/pedidos.repository';
import { SolicitanteTelefonoSelect, asegurarSolicitanteTelefono } from './SolicitanteTelefonoSelect';
import { leerCantidad, num, type SalidaTelefono } from './inventarioTelefono';
import type { TrasladoTelefono } from './historicosTelefono';
import type { ProductoEnAlmacen } from './inventarioTelefono.repository';
import { editarSalidaTelefono, editarTrasladoTelefono } from './edicionTelefono.repository';
import { nombreAlmacenVisible } from './sectorizacion';

interface LineaForm { producto: ProductoEnAlmacen; cantidad: string }
interface BaseProps {
  productos: ProductoEnAlmacen[];
  actor: string;
  actorName: string | null;
  onClose: () => void;
  onGuardado: () => void | Promise<void>;
}

function productoViejo(id: string, nombre: string, unidad: string | null, productos: ProductoEnAlmacen[]): ProductoEnAlmacen {
  return productos.find((p) => p.id === id) ?? ({
    id, nombre, unidad: unidad ?? 'und', sku: '', categoria: '', stock: 0, stock_almacen: 0, precio: 0,
  } as ProductoEnAlmacen);
}

function motivoYUnidad(texto: string): { motivo: string; unidad: string } {
  const m = /^\[(.*?)\]\s*(.*)$/.exec(texto.trim());
  return m ? { unidad: m[1], motivo: m[2] } : { unidad: '', motivo: texto };
}

function LineasEditor({ lineas, setLineas, productos }: {
  lineas: LineaForm[];
  setLineas: (ls: LineaForm[]) => void;
  productos: ProductoEnAlmacen[];
}) {
  return (
    <div style={{ display: 'grid', gap: '.65rem' }}>
      {lineas.map((l, i) => {
        const opciones = productos.some((p) => p.id === l.producto.id) ? productos : [l.producto, ...productos];
        return (
          <div className="card" key={`${i}-${l.producto.id}`} style={{ margin: 0, padding: '.75rem' }}>
            <div className="form-grid">
              <div className="form-row">
                <label>Material #{i + 1}</label>
                <SearchSelect
                  value={l.producto.id}
                  options={opciones.map((p) => ({ value: p.id, label: `${p.nombre} · ${p.sku}`, hint: `${num(p.stock_almacen)} ${p.unidad} disponibles` }))}
                  onChange={(id) => {
                    const p = opciones.find((x) => x.id === id);
                    if (p) setLineas(lineas.map((x, j) => j === i ? { ...x, producto: p } : x));
                  }}
                  placeholder="Buscar material…"
                />
              </div>
              <div className="form-row">
                <label>Cantidad ({l.producto.unidad})</label>
                <input className="input mono" type="number" min="0" step="any" value={l.cantidad}
                  onChange={(e) => setLineas(lineas.map((x, j) => j === i ? { ...x, cantidad: e.target.value } : x))} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PieEdicion({ guardando, onClose, formId }: { guardando: boolean; onClose: () => void; formId: string }) {
  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
      <button type="submit" form={formId} className="btn btn-primary" disabled={guardando}>{guardando ? 'Guardando…' : '✓ Guardar corrección'}</button>
    </>
  );
}

function AvisoStock() {
  return (
    <div className="card" style={{ marginBottom: '.75rem', fontSize: '.84rem' }}>
      Se conserva el mismo número y el movimiento original. Al guardar, el kardex agrega solo la diferencia de stock.
      Para agregar o quitar materiales del lote se registra una operación nueva.
    </div>
  );
}

export function EditarSalidaTelefonoModal({ grupo, productos, actor, actorName, onClose, onGuardado }: BaseProps & { grupo: SalidaTelefono[] }) {
  const inicial = motivoYUnidad(grupo[0].motivo);
  const [lineas, setLineas] = useState<LineaForm[]>(() => grupo.map((s) => ({ producto: productoViejo(s.producto_id, s.producto_nombre, s.unidad, productos), cantidad: String(s.cantidad) })));
  const [motivo, setMotivo] = useState(inicial.motivo);
  const [unidad, setUnidad] = useState(inicial.unidad);
  const [solicitado, setSolicitado] = useState(grupo[0].autorizado_por ?? '');
  const [retorna, setRetorna] = useState(grupo[0].retorna);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [unidades, setUnidades] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    Promise.all([listUsuarios().catch(() => [] as Usuario[]), listCatalogoPedido('unidad_solicitante', true).catch(() => [])])
      .then(([us, cats]) => {
        if (!vivo) return;
        setUsuarios(us);
        const opciones = [...cats.map((c) => c.nombre), ...us.map((u) => u.departamento ?? '')]
          .map((x) => x.trim()).filter(Boolean);
        setUnidades([...new Set(opciones)].sort((a, b) => a.localeCompare(b, 'es')));
      });
    return () => { vivo = false; };
  }, []);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const solicitadoFinal = await asegurarSolicitanteTelefono(solicitado, actor);
      if (unidad.trim()) void ensureUnidadSolicitante(unidad.trim(), actor);
      const motivoFinal = `${unidad.trim() ? `[${unidad.trim()}] ` : ''}${motivo.trim()}`;
      await editarSalidaTelefono({
        anteriores: grupo,
        lineas: lineas.map((l) => ({ producto: l.producto, cantidad: leerCantidad(l.cantidad) })),
        motivo: motivoFinal,
        solicitadoPor: solicitadoFinal,
        retorna,
        actor,
        actorName,
      });
      toast(`Salida ${grupo[0].codigo} actualizada`, 'success');
      await onGuardado();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo editar la salida.', 'error');
    } finally { setGuardando(false); }
  }

  return (
    <Modal title={`Editar salida ${grupo[0].codigo}`} size="lg" onClose={() => { if (!guardando) onClose(); }} footer={<PieEdicion guardando={guardando} onClose={onClose} formId="edit-salida-telefono" />}>
      <form id="edit-salida-telefono" onSubmit={(e) => void guardar(e)}>
        <AvisoStock />
        <LineasEditor lineas={lineas} setLineas={setLineas} productos={productos} />
        <div className="form-row" style={{ marginTop: '.75rem' }}>
          <label>Motivo</label>
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Solicitado por</label>
            <SolicitanteTelefonoSelect id="edit-sal-solicitado" value={solicitado} onChange={setSolicitado} actor={actor} disabled={guardando} usuarios={usuarios} />
          </div>
          <div className="form-row">
            <label>Unidad solicitante</label>
            <SearchCreateSelect id="edit-sal-unidad" options={unidades} value={unidad} onChange={setUnidad} placeholder="Unidad o departamento…" disabled={guardando} />
          </div>
        </div>
        <div className="form-row">
          <label>¿Retorna?</label>
          <select className="select" value={retorna ? 'si' : 'no'} onChange={(e) => setRetorna(e.target.value === 'si')}>
            <option value="no">NO · se consume / se queda</option>
            <option value="si">SÍ · vuelve al almacén</option>
          </select>
        </div>
        <button type="submit" style={{ display: 'none' }} aria-hidden="true" />
      </form>
    </Modal>
  );
}

export function EditarTrasladoTelefonoModal({ grupo, productos, destinos, actor, actorName, onClose, onGuardado }: BaseProps & { grupo: TrasladoTelefono[]; destinos: Almacen[] }) {
  const [lineas, setLineas] = useState<LineaForm[]>(() => grupo.map((t) => ({ producto: productoViejo(t.producto_id, t.producto_nombre, t.unidad, productos), cantidad: String(t.cantidad) })));
  const [destino, setDestino] = useState(grupo[0].destino);
  const [motivo, setMotivo] = useState(grupo[0].motivo);
  const [solicitado, setSolicitado] = useState(grupo[0].solicitado_por ?? '');
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const solicitadoFinal = await asegurarSolicitanteTelefono(solicitado, actor);
      await editarTrasladoTelefono({
        anteriores: grupo,
        lineas: lineas.map((l) => ({ producto: l.producto, cantidad: leerCantidad(l.cantidad) })),
        destino,
        motivo,
        solicitadoPor: solicitadoFinal,
        actor,
        actorName,
      });
      toast(`Traslado ${grupo[0].codigo} actualizado`, 'success');
      await onGuardado();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo editar el traslado.', 'error');
    } finally { setGuardando(false); }
  }

  return (
    <Modal title={`Editar traslado ${grupo[0].codigo}`} size="lg" onClose={() => { if (!guardando) onClose(); }} footer={<PieEdicion guardando={guardando} onClose={onClose} formId="edit-traslado-telefono" />}>
      <form id="edit-traslado-telefono" onSubmit={(e) => void guardar(e)}>
        <AvisoStock />
        <div className="form-grid" style={{ marginBottom: '.75rem' }}>
          <div className="form-row"><label>Origen</label><input className="input" value={nombreAlmacenVisible(grupo[0].origen)} disabled /></div>
          <div className="form-row">
            <label>Almacén destino</label>
            <select className="select" value={destino} onChange={(e) => setDestino(e.target.value)}>
              {[...new Set([grupo[0].destino, ...destinos.map((a) => a.nombre)])].map((a) => <option key={a} value={a}>{nombreAlmacenVisible(a)}</option>)}
            </select>
          </div>
        </div>
        <LineasEditor lineas={lineas} setLineas={setLineas} productos={productos} />
        <div className="form-row" style={{ marginTop: '.75rem' }}><label>Motivo</label><input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
        <div className="form-row">
          <label>Solicitado por</label>
          <SolicitanteTelefonoSelect id="edit-tra-solicitado" value={solicitado} onChange={setSolicitado} actor={actor} disabled={guardando} />
        </div>
        <button type="submit" style={{ display: 'none' }} aria-hidden="true" />
      </form>
    </Modal>
  );
}
