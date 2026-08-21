import { useCallback, useEffect, useState } from 'react';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import type { Chofer, Vehiculo } from '@/shared/lib/types';
import {
  listChoferes, crearChofer, listVehiculos, crearVehiculo,
} from './salidasCatalogos.repository';

/**
 * Selector buscable de Chofer (responsable + cédula) y Vehículo (con placa) para las
 * solicitudes de salida/traslado. Permite elegir uno guardado o dar de alta uno nuevo
 * al vuelo (el chofer pide la cédula; el vehículo pide la placa). Ambos catálogos se
 * administran (editar/deshabilitar) desde "🚚 Choferes / Vehículos".
 */
export function ChoferVehiculoPicker({ chofer, vehiculo, onChofer, onVehiculo, actor }: {
  chofer: Chofer | null;
  vehiculo: Vehiculo | null;
  onChofer: (c: Chofer | null) => void;
  onVehiculo: (v: Vehiculo | null) => void;
  actor: string;
}) {
  const [choferes, setChoferes] = useState<Chofer[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);

  const recargar = useCallback(async () => {
    const [cs, vs] = await Promise.all([listChoferes(true).catch(() => []), listVehiculos(true).catch(() => [])]);
    setChoferes(cs); setVehiculos(vs);
  }, []);
  useEffect(() => { void recargar(); }, [recargar]);

  // Alta inline de chofer
  const [nChofer, setNChofer] = useState('');
  const [nCedula, setNCedula] = useState('');
  const [addingChofer, setAddingChofer] = useState(false);
  async function addChofer() {
    const nombre = nChofer.trim();
    if (!nombre) { toast('Escribí el nombre del chofer', 'error'); return; }
    const ya = choferes.find((c) => c.nombre.toLowerCase() === nombre.toLowerCase());
    if (ya) { onChofer(ya); setNChofer(''); setNCedula(''); toast(`El chofer "${ya.nombre}" ya existe — se seleccionó`, 'warning'); return; }
    setAddingChofer(true);
    try {
      const c = await crearChofer({ nombre, cedula: nCedula, actor });
      setChoferes((p) => [...p, c].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
      onChofer(c); setNChofer(''); setNCedula('');
      toast(`Chofer "${c.nombre}" agregado`, 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo agregar el chofer', 'error'); }
    finally { setAddingChofer(false); }
  }

  // Alta inline de vehículo
  const [nVehiculo, setNVehiculo] = useState('');
  const [nPlaca, setNPlaca] = useState('');
  const [addingVeh, setAddingVeh] = useState(false);
  async function addVehiculo() {
    const nombre = nVehiculo.trim();
    if (!nombre) { toast('Escribí el vehículo', 'error'); return; }
    if (!nPlaca.trim()) { toast('Indicá la placa del vehículo', 'error'); return; }
    const ya = vehiculos.find((v) => v.nombre.toLowerCase() === nombre.toLowerCase());
    if (ya) { onVehiculo(ya); setNVehiculo(''); setNPlaca(''); toast(`El vehículo "${ya.nombre}" ya existe — se seleccionó`, 'warning'); return; }
    setAddingVeh(true);
    try {
      const v = await crearVehiculo({ nombre, placa: nPlaca, actor });
      setVehiculos((p) => [...p, v].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
      onVehiculo(v); setNVehiculo(''); setNPlaca('');
      toast(`Vehículo "${v.nombre}" (${v.placa}) agregado`, 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo agregar el vehículo', 'error'); }
    finally { setAddingVeh(false); }
  }

  const opChoferes = choferes.map((c) => ({ value: c.id, label: `${c.nombre}${c.cedula ? ` · C.I. ${c.cedula}` : ''}` }));
  const opVehiculos = vehiculos.map((v) => ({ value: v.id, label: `${v.nombre}${v.placa ? ` · ${v.placa}` : ''}` }));

  return (
    <div className="form-grid">
      {/* Chofer / responsable */}
      <div className="form-row">
        <label>Chofer / responsable</label>
        <SearchSelect value={chofer?.id ?? ''} onChange={(id) => onChofer(choferes.find((c) => c.id === id) ?? null)}
          options={opChoferes} placeholder="🔎 Buscá el chofer…" emptyText="Sin choferes guardados." />
        {chofer?.cedula && <small className="muted">C.I.: <strong>{chofer.cedula}</strong></small>}
        {/* Alta inline: acá Enter significa "añadir", no "siguiente campo" → fuera del recorrido. */}
        <div data-enter-omitir="" style={{ display: 'flex', gap: '.4rem', marginTop: '.35rem', flexWrap: 'wrap' }}>
          <input className="input" value={nChofer} onChange={(e) => setNChofer(e.target.value)} placeholder="¿No está? Nombre del chofer"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addChofer(); } }} style={{ flex: '2 1 140px', fontSize: '.82rem' }} />
          <input className="input mono" value={nCedula} onChange={(e) => setNCedula(e.target.value)} placeholder="Cédula"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addChofer(); } }} style={{ flex: '1 1 100px', fontSize: '.82rem' }} />
          <button type="button" className="btn btn-sm btn-ghost" onClick={addChofer} disabled={addingChofer || !nChofer.trim()}>
            {addingChofer ? '…' : '+ Añadir'}
          </button>
        </div>
      </div>

      {/* Vehículo + placa */}
      <div className="form-row">
        <label>Vehículo</label>
        <SearchSelect value={vehiculo?.id ?? ''} onChange={(id) => onVehiculo(vehiculos.find((v) => v.id === id) ?? null)}
          options={opVehiculos} placeholder="🔎 Buscá el vehículo…" emptyText="Sin vehículos guardados." />
        {vehiculo?.placa && <small className="muted">Placa: <strong>{vehiculo.placa}</strong></small>}
        {/* Alta inline: acá Enter significa "añadir", no "siguiente campo" → fuera del recorrido. */}
        <div data-enter-omitir="" style={{ display: 'flex', gap: '.4rem', marginTop: '.35rem', flexWrap: 'wrap' }}>
          <input className="input" value={nVehiculo} onChange={(e) => setNVehiculo(e.target.value)} placeholder="¿No está? Vehículo (marca/modelo)"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addVehiculo(); } }} style={{ flex: '2 1 140px', fontSize: '.82rem' }} />
          <input className="input mono" value={nPlaca} onChange={(e) => setNPlaca(e.target.value)} placeholder="Placa"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addVehiculo(); } }} style={{ flex: '1 1 100px', fontSize: '.82rem' }} />
          <button type="button" className="btn btn-sm btn-ghost" onClick={addVehiculo} disabled={addingVeh || !nVehiculo.trim()}>
            {addingVeh ? '…' : '+ Añadir'}
          </button>
        </div>
      </div>
    </div>
  );
}
