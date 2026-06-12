import { useEffect, useState } from 'react';
import { listDirectorioUsuarios, type PersonaDirectorio } from './salidas.repository';
import { AlmacenPicker } from '@/modules/inventario/AlmacenPicker';
import type { Almacen } from '@/shared/lib/types';

type Modo = 'almacen' | 'persona';

/**
 * Selector de destino ("a quién va dirigido") con switch:
 *  - Almacén  → selector jerárquico Sede → Almacén (+ Consumo Interno).
 *  - Persona  → desplegable de usuarios registrados (cargo · nombre apellido).
 */
export function DestinoSelect({
  value,
  onChange,
  almacenes,
  label = 'A quién va dirigido',
  permitirAlmacen = true,
}: {
  value: string;
  onChange: (v: string) => void;
  almacenes: Almacen[];
  label?: string;
  /** Si es false, el destino solo puede ser una persona (o Consumo Interno):
   *  el switch y el selector Sede → Almacén no se muestran. Para salidas
   *  (mandar material a otro almacén es un traslado, no una salida). */
  permitirAlmacen?: boolean;
}) {
  const [modo, setModo] = useState<Modo>(permitirAlmacen ? 'almacen' : 'persona');
  const [personas, setPersonas] = useState<PersonaDirectorio[]>([]);
  const [cargando, setCargando] = useState(false);

  // Carga el directorio de personas la primera vez que se entra a ese modo.
  useEffect(() => {
    if (modo !== 'persona' || personas.length || cargando) return;
    setCargando(true);
    listDirectorioUsuarios()
      .then(setPersonas)
      .catch(() => setPersonas([]))
      .finally(() => setCargando(false));
  }, [modo, personas.length, cargando]);

  function cambiarModo(next: Modo) {
    setModo(next);
    onChange(''); // limpiar la selección al cambiar de tipo de destino
  }

  function etiquetaPersona(p: PersonaDirectorio): string {
    const nombre = `${p.nombre} ${p.apellido}`.trim();
    return p.cargo ? `${nombre} · ${p.cargo}` : nombre;
  }

  return (
    <div className="form-row">
      <label>{label}</label>
      {permitirAlmacen && (
        <div className="view-toggle" role="tablist" aria-label="Tipo de destino" style={{ marginBottom: '.4rem', marginLeft: 0 }}>
          <button type="button" className={modo === 'almacen' ? 'active' : ''} onClick={() => cambiarModo('almacen')}>▣ Almacén</button>
          <button type="button" className={modo === 'persona' ? 'active' : ''} onClick={() => cambiarModo('persona')}>👤 Persona</button>
        </div>
      )}

      {permitirAlmacen && modo === 'almacen' ? (
        <AlmacenPicker value={value} onChange={onChange} almacenes={almacenes} extraOpciones={['Consumo Interno']} sedeLabel="Sede / destino" label="Almacén" />
      ) : (
        <select className="select" value={value} onChange={(e) => onChange(e.target.value)} disabled={cargando}>
          <option value="">{cargando ? 'Cargando…' : '— elegí la persona —'}</option>
          {!permitirAlmacen && <option value="Consumo Interno">Consumo Interno</option>}
          {personas.map((p) => {
            const label = etiquetaPersona(p);
            return <option key={p.id} value={label}>{label}</option>;
          })}
        </select>
      )}
    </div>
  );
}
