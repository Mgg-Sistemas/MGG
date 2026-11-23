/* ============================================================
   MGG · Selector de «Solicitado por» en vista teléfono de Inventario

   Lista buscable de personas (compartida con el catálogo activo de
   `combustible_autorizados`), que además permite escribir y añadir una
   persona nueva a la lista si todavía no existe (tanto para Salidas como
   para Traslados en la vista de teléfono).
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  crearCatalogo,
  listAutorizadoresActivos,
  listCatalogo,
  setEstadoCatalogo,
} from '@/modules/combustible/combustible.repository';
import { useRealtime } from '@/shared/lib/useRealtime';
import { SearchCreateSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import type { Usuario } from '@/shared/lib/types';

const sinAcentos = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Mayúsculas, sin espacios repetidos. */
export function formatoSolicitanteTelefono(v: string): string {
  return v.replace(/\s+/g, ' ').trimStart().toUpperCase();
}

/**
 * Deja a la persona en la lista (si no estaba, o la reactiva si estaba inactiva)
 * y devuelve su nombre limpio. Si falla la red o permisos, sigue con el escrito.
 */
export async function asegurarSolicitanteTelefono(nombre: string, actorEmail?: string | null): Promise<string> {
  const limpia = formatoSolicitanteTelefono(nombre).trim();
  if (!limpia) return '';
  try {
    const todos = await listCatalogo('combustible_autorizados');
    const existente = todos.find((c) => sinAcentos(c.nombre.trim()) === sinAcentos(limpia));
    if (existente) {
      if (existente.estado !== 'activo') {
        await setEstadoCatalogo('combustible_autorizados', existente.id, 'activo');
      }
      return existente.nombre.trim();
    }
    const creado = await crearCatalogo('combustible_autorizados', limpia, actorEmail);
    return creado.nombre.trim() || limpia;
  } catch {
    return limpia;
  }
}

export function SolicitanteTelefonoSelect({
  id,
  value,
  onChange,
  actor,
  disabled,
  placeholder = '🔍 Buscar o escribir persona…',
  usuarios = [],
  onSelectUsuario,
}: {
  id?: string;
  value: string;
  onChange: (persona: string) => void;
  actor?: string | null;
  disabled?: boolean;
  placeholder?: string;
  usuarios?: Usuario[];
  onSelectUsuario?: (u: Usuario | null) => void;
}) {
  const [opciones, setOpciones] = useState<string[]>([]);
  const [agregando, setAgregando] = useState(false);

  const cargar = useCallback(() => {
    listAutorizadoresActivos()
      .then(setOpciones)
      .catch(() => setOpciones((xs) => xs));
  }, []);

  useEffect(() => { cargar(); }, [cargar]);
  useRealtime(['combustible_autorizados'], cargar);

  const nombresUsuarios = useMemo(() => {
    return usuarios.map((u) => `${u.nombre} ${u.apellido ?? ''}`.trim()).filter(Boolean);
  }, [usuarios]);

  const opcionesCombinadas = useMemo(() => {
    return Array.from(new Set([...nombresUsuarios, ...opciones])).sort((a, b) => a.localeCompare(b, 'es'));
  }, [nombresUsuarios, opciones]);

  const limpio = formatoSolicitanteTelefono(value).trim();
  const yaExiste = limpio === '' || opcionesCombinadas.some((o) => sinAcentos(o) === sinAcentos(limpio));

  function handleCambio(v: string) {
    const valLimpio = formatoSolicitanteTelefono(v);
    onChange(valLimpio);
    if (onSelectUsuario) {
      const u = usuarios.find((usr) => {
        const full = `${usr.nombre} ${usr.apellido ?? ''}`.trim();
        return full.toLowerCase() === valLimpio.toLowerCase() || usr.email.toLowerCase() === valLimpio.toLowerCase();
      }) ?? null;
      onSelectUsuario(u);
    }
  }

  async function agregarALista() {
    if (!limpio || agregando) return;
    setAgregando(true);
    try {
      const canonico = await asegurarSolicitanteTelefono(limpio, actor);
      setOpciones((prev) => [...new Set([...prev, canonico])].sort((a, b) => a.localeCompare(b, 'es')));
      handleCambio(canonico);
      toast(`«${canonico}» añadido a la lista.`, 'success');
    } finally {
      setAgregando(false);
    }
  }

  return (
    <div>
      <div className="surt-buscable">
        <SearchCreateSelect
          id={id}
          options={opcionesCombinadas}
          value={value}
          onChange={handleCambio}
          placeholder={placeholder}
          emptyText="Sin coincidencias: escribe el nombre para añadirlo"
          disabled={disabled}
        />
      </div>
      {limpio.length >= 2 && !yaExiste && (
        <button
          type="button"
          className="btn btn-ghost"
          style={{ marginTop: '.4rem', width: '100%' }}
          disabled={agregando || disabled}
          onClick={() => void agregarALista()}
        >
          {agregando ? 'Añadiendo a la lista…' : `➕ Añadir «${limpio}» a la lista`}
        </button>
      )}
    </div>
  );
}

