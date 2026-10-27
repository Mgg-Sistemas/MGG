/* ============================================================
   Golden Touch · Control de Maquinaria · Fotos de una orden por crear
   Las fotos que se eligen en el asistente de la orden de servicio
   antes de que la orden exista: se comprimen al elegirlas y se suben
   al crear (la carpeta del bucket lleva el id de la orden).
   ============================================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { mensajeError } from '@/shared/lib/errores';
import { avisoCupo, tomarHastaCupo } from './osFotos';
import { prepararFotoOrden } from './osFotos.repository';

export interface FotoLocal { id: string; file: File; url: string }

/**
 * Vive en el asistente (que no se desmonta entre pasos) y libera las vistas
 * previas al cerrarse. Nunca deja pasar de 4 (contando las que se preparan).
 */
export function useFotosLocales() {
  const [fotos, setFotos] = useState<FotoLocal[]>([]);
  const [preparando, setPreparando] = useState(0);
  const total = useRef(0);
  const vivas = useRef<FotoLocal[]>([]);
  vivas.current = fotos;
  useEffect(() => () => { vivas.current.forEach((f) => URL.revokeObjectURL(f.url)); }, []);

  const agregar = useCallback(async (files: File[]) => {
    const { tomar, descartadas } = tomarHastaCupo(total.current, files);
    const aviso = avisoCupo(descartadas);
    if (aviso) toast(aviso, 'warning');
    total.current += tomar.length;
    setPreparando((n) => n + tomar.length);
    for (const original of tomar) {
      try {
        const file = await prepararFotoOrden(original);
        const nueva = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, file, url: URL.createObjectURL(file) };
        setFotos((prev) => [...prev, nueva]);
      } catch (e) {
        total.current -= 1;
        toast(mensajeError(e, 'No se pudo preparar la foto'), 'error');
      } finally {
        setPreparando((n) => n - 1);
      }
    }
  }, []);

  const quitar = useCallback((id: string) => {
    const f = vivas.current.find((x) => x.id === id);
    if (!f) return;
    URL.revokeObjectURL(f.url);
    total.current -= 1;
    setFotos((prev) => prev.filter((x) => x.id !== id));
  }, []);

  return { fotos, preparando, agregar, quitar };
}

export type FotosLocales = ReturnType<typeof useFotosLocales>;
