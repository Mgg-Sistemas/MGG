import { useEffect, useState } from 'react';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { listClientes, crearCliente, type Cliente } from '@/modules/ventas/clientes.repository';

/**
 * Selector buscable de Cliente (reusa el catálogo de Ventas) con alta inline. Lo usan las
 * salidas/traslados a un cliente: al ejecutar se genera una cuenta por cobrar a su nombre.
 * El cliente que se da de alta queda guardado en el catálogo compartido de clientes.
 */
export function ClientePicker({ value, onChange, actor, actorName }: {
  value: Cliente | null;
  onChange: (c: Cliente | null) => void;
  actor: string;
  actorName?: string | null;
}) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  useEffect(() => {
    listClientes().then((cs) => setClientes(cs.filter((c) => c.activo))).catch(() => setClientes([]));
  }, []);

  // Alta inline
  const [nNombre, setNNombre] = useState('');
  const [nRif, setNRif] = useState('');
  const [nTel, setNTel] = useState('');
  const [adding, setAdding] = useState(false);
  async function addCliente() {
    const nombre = nNombre.trim();
    if (!nombre) { toast('Escribí el nombre del cliente', 'error'); return; }
    const ya = clientes.find((c) => c.nombre.toLowerCase() === nombre.toLowerCase());
    if (ya) { onChange(ya); setNNombre(''); setNRif(''); setNTel(''); toast(`El cliente "${ya.nombre}" ya existe — se seleccionó`, 'warning'); return; }
    setAdding(true);
    try {
      const c = await crearCliente({ nombre, rif: nRif, telefono: nTel }, actor, actorName);
      setClientes((p) => [...p, c].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
      onChange(c); setNNombre(''); setNRif(''); setNTel('');
      toast(`Cliente "${c.nombre}" agregado al catálogo`, 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo agregar el cliente', 'error'); }
    finally { setAdding(false); }
  }

  const opciones = clientes.map((c) => ({ value: c.id, label: `${c.nombre}${c.rif ? ` · ${c.rif}` : ''}` }));

  return (
    <div className="form-row">
      <label>Cliente</label>
      <SearchSelect value={value?.id ?? ''} onChange={(id) => onChange(clientes.find((c) => c.id === id) ?? null)}
        options={opciones} placeholder="🔎 Buscá el cliente…" emptyText="Sin clientes guardados." sinPreseleccion />
      {value && (value.rif || value.telefono) && (
        <small className="muted">{value.rif ? <>RIF: <strong>{value.rif}</strong></> : null}{value.rif && value.telefono ? ' · ' : ''}{value.telefono ? <>Tel: <strong>{value.telefono}</strong></> : null}</small>
      )}
      {/* Alta inline: acá Enter significa "añadir", no "siguiente campo" → fuera del recorrido. */}
      <div data-enter-omitir="" style={{ display: 'flex', gap: '.4rem', marginTop: '.35rem', flexWrap: 'wrap' }}>
        <input className="input" value={nNombre} onChange={(e) => setNNombre(e.target.value)} placeholder="¿No está? Nombre / razón social"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addCliente(); } }} style={{ flex: '2 1 160px', fontSize: '.82rem' }} />
        <input className="input mono" value={nRif} onChange={(e) => setNRif(e.target.value)} placeholder="RIF"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addCliente(); } }} style={{ flex: '1 1 90px', fontSize: '.82rem' }} />
        <input className="input mono" value={nTel} onChange={(e) => setNTel(e.target.value)} placeholder="Teléfono"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addCliente(); } }} style={{ flex: '1 1 110px', fontSize: '.82rem' }} />
        <button type="button" className="btn btn-sm btn-ghost" onClick={addCliente} disabled={adding || !nNombre.trim()}>
          {adding ? '…' : '+ Añadir'}
        </button>
      </div>
      <small className="muted">Se guarda en el catálogo de clientes (compartido con Ventas). Al ejecutar la salida se le crea una cuenta por cobrar.</small>
    </div>
  );
}
