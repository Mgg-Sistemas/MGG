/* ============================================================
   Golden Touch · Retenciones · Config fiscal POR EMPRESA (multi-empresa)

   Dentro de «⚙ Parámetros». Lista las empresas receptoras y, por cada una,
   edita INLINE lo fiscal por-empresa con el editor ÚNICO (EmpresaEditor, modo
   'fiscal'): alícuota municipal, licencia y original/copia. Los % nacionales
   (Parámetros → Valores) y el régimen (Parámetros → Régimen) NO viven acá.
   La identidad (nombre, RIF, contacto) se edita en el buzón, con el mismo editor.

   Degradación segura: si la base todavía no trae las columnas fiscales por
   empresa (F-ME1), se avisa y no se edita.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { listEmpresasReceptoras, fichaFiscalEmpresaDisponible, type EmpresaReceptora } from './empresasReceptoras.repository';
import { EmpresaEditor } from './EmpresaEditor';

export function EditorFichasFiscalesEmpresa({ puedeEditar }: { puedeEditar: boolean }) {
  const [empresas, setEmpresas] = useState<EmpresaReceptora[] | null>(null);
  const [disponible, setDisponible] = useState<boolean | null>(null);

  const cargar = useCallback(async () => {
    const [hay, lista] = await Promise.all([
      fichaFiscalEmpresaDisponible().catch(() => false),
      listEmpresasReceptoras().catch(() => [] as EmpresaReceptora[]),
    ]);
    setDisponible(hay);
    setEmpresas(lista);
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  if (empresas === null) return <p className="muted">Cargando empresas…</p>;
  if (disponible === false) {
    return <p className="muted">La configuración fiscal por empresa estará disponible cuando la base traiga sus campos. Por ahora el módulo trabaja con una sola empresa.</p>;
  }
  if (!empresas.length) {
    return <p className="muted">No hay empresas cargadas. Se agregan en el buzón (📥 Buzón Móvil → Empresas).</p>;
  }

  return (
    <div style={{ display: 'grid', gap: '.9rem' }}>
      <p className="muted" style={{ margin: 0, fontSize: '.88rem' }}>
        Lo municipal de cada empresa (alícuota del ISAE, licencia) y la emisión Original/Copia. Los % nacionales van en
        Parámetros → Valores y el régimen en Parámetros → Régimen; el nombre y el RIF, en el buzón.
      </p>
      {empresas.map((e) => (
        <div key={e.id} className="card" style={{ display: 'grid', gap: '.5rem' }}>
          {puedeEditar ? (
            <EmpresaEditor
              modo="fiscal"
              empresa={e}
              onGuardada={(g) => {
                setEmpresas((prev) => (prev ?? []).map((x) => (x.id === e.id ? g : x)));
                toast(`Config fiscal de ${g.nombreCorto || g.nombre} guardada.`, 'success');
              }}
            />
          ) : (
            <div>
              <div style={{ fontWeight: 700 }}>{e.nombreCorto || e.nombre} <span className="muted mono" style={{ fontWeight: 400 }}>· {e.rif}</span></div>
              <p className="muted" style={{ margin: '.2rem 0 0', fontSize: '.8rem' }}>Sin permiso para editar.</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
