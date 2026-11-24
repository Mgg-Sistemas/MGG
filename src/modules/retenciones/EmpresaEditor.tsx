/* ============================================================
   Golden Touch · Retenciones · Editor ÚNICO de empresa receptora (C4b)

   Un solo editor para las empresas que reciben facturas, en vez de tres copias
   (alta rápida del teléfono, ficha del buzón PC, config fiscal en Parámetros).
   El MODO decide qué grupos de campos se ven; el LLAMADOR decide el envoltorio
   (modal en móvil/buzón, inline por fila en Parámetros) — no hay variantes del
   componente.

   Una sola fuente al guardar: siempre `guardarEmpresaReceptora`. Gracias al
   presence-gate del repo, cada modo manda SOLO sus campos y no pisa el resto:
   NUNCA se tocan desde aquí los % nacionales (los gobierna Parámetros → Valores)
   ni las banderas de régimen (Parámetros → Régimen).
   ============================================================ */
import { useState, type FormEvent } from 'react';
import { toast } from '@/shared/ui/Toast';
import { completarRif, formatearRif } from '@/shared/lib/rif';
import {
  guardarEmpresaReceptora, faltaEnEmpresa,
  type EmpresaReceptora, type EmpresaReceptoraInput,
} from './empresasReceptoras.repository';

const COLOR_POR_DEFECTO = '#2563eb';
const esColorValido = (c: string | null | undefined) => /^#[0-9a-fA-F]{6}$/.test(String(c ?? ''));

/** 'rapido' = alta/edición mínima del teléfono · 'identidad' = ficha identidad+contacto (buzón PC)
 *  · 'fiscal' = lo por-empresa del comprobante (alícuota municipal, licencia, original y copia). */
export type ModoEmpresaEditor = 'rapido' | 'identidad' | 'fiscal';

export function EmpresaEditor({ empresa, modo, onGuardada, onClose, idForm }: {
  /** undefined = crear; definida = editar. El modo 'fiscal' siempre es edición. */
  empresa?: EmpresaReceptora;
  modo: ModoEmpresaEditor;
  onGuardada: (emp: EmpresaReceptora) => void;
  /** Lo pasa el llamador-modal para ofrecer «Cancelar»; inline lo omite. */
  onClose?: () => void;
  /** Id opcional del <form> (para un botón de guardar externo si el llamador lo necesita). */
  idForm?: string;
}) {
  const esEdicion = !!empresa;
  const verContacto = modo === 'identidad';
  const verFiscal = modo === 'fiscal';

  const [nombre, setNombre] = useState(empresa?.nombre ?? '');
  const [nombreCorto, setNombreCorto] = useState(empresa?.nombreCorto ?? '');
  const [rif, setRif] = useState(empresa?.rif ?? '');
  const [colorBadge, setColorBadge] = useState(esColorValido(empresa?.colorBadge) ? (empresa!.colorBadge) : COLOR_POR_DEFECTO);
  const [activo, setActivo] = useState(empresa?.activo ?? true);
  const [email, setEmail] = useState(empresa?.email ?? '');
  const [telefono, setTelefono] = useState(empresa?.telefono ?? '');
  const [direccionFiscal, setDireccionFiscal] = useState(empresa?.direccionFiscal ?? '');
  const [municipio, setMunicipio] = useState(empresa?.municipio ?? '');
  const [estado, setEstado] = useState(empresa?.estado ?? '');
  const [alicuotaMunicipal, setAlicuotaMunicipal] = useState<string>(empresa?.alicuotaMunicipal != null ? String(empresa.alicuotaMunicipal) : '');
  const [licenciaMunicipal, setLicenciaMunicipal] = useState(empresa?.licenciaMunicipal ?? '');
  const [imprimirOriginalYCopia, setImprimirOriginalYCopia] = useState(empresa?.imprimirOriginalYCopia !== false);

  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const revisarRif = () => {
    const escrito = rif.trim();
    if (!escrito) return;
    const completo = completarRif(escrito);
    if (completo) setRif(formatearRif(completo));
  };

  function construirInput(): EmpresaReceptoraInput {
    // Pick EXPLÍCITO (nada de `...empresa`): el editor único arma SOLO identidad/contacto y lo
    // por-empresa del comprobante (alícuota municipal, licencia, original/copia). NUNCA el
    // RÉGIMEN (qué retiene) ni los % nacionales: su fuente es Parámetros → Régimen (L6) y
    // Parámetros → Valores (R3), no esta ficha. Los campos que el modo no edita se conservan
    // de la empresa para no blanquearlos al guardar.
    const prev = empresa;

    if (verFiscal) {
      // Modo fiscal: edita alícuota municipal, licencia y original/copia; la identidad se
      // conserva tal cual de la empresa.
      const e = prev as EmpresaReceptora;
      return {
        id: e.id, clave: e.clave, orden: e.orden,
        nombre: e.nombre, nombreCorto: e.nombreCorto, rif: e.rif,
        colorBadge: e.colorBadge, activo: e.activo,
        email: e.email, telefono: e.telefono, direccionFiscal: e.direccionFiscal,
        municipio: e.municipio, estado: e.estado,
        licenciaMunicipal: licenciaMunicipal.trim() || undefined,
        alicuotaMunicipal: alicuotaMunicipal.trim() === '' ? undefined : Number(alicuotaMunicipal),
        imprimirOriginalYCopia,
      };
    }

    // Rápido e identidad. Base: claves de fila (en edición) y lo que este modo no edita,
    // conservado de la empresa. La alícuota municipal y original/copia quedan FUERA del input
    // → el presence-gate del repo no los pisa.
    const base: EmpresaReceptoraInput = {
      id: prev?.id, clave: prev?.clave, orden: prev?.orden,
      nombre: nombre.trim(),
      nombreCorto: nombreCorto.trim() || undefined,
      rif: rif.trim(),
      colorBadge: prev?.colorBadge ?? COLOR_POR_DEFECTO,
      activo: prev?.activo ?? true,
      email: prev?.email,
      telefono: prev?.telefono,
      direccionFiscal: prev?.direccionFiscal,
      municipio: prev?.municipio,
      estado: prev?.estado,
      licenciaMunicipal: prev?.licenciaMunicipal,
    };
    if (verContacto) {
      base.colorBadge = colorBadge;
      base.activo = activo;
      base.email = email.trim() || undefined;
      base.telefono = telefono.trim() || undefined;
      base.direccionFiscal = direccionFiscal.trim() || undefined;
      base.municipio = municipio.trim() || undefined;
      base.estado = estado.trim() || undefined;
    }
    return base;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (guardando) return;
    const input = construirInput();
    const falta = (verContacto && !esColorValido(colorBadge)) ? 'Elige el color de la empresa.' : faltaEnEmpresa(input);
    if (falta) { setError(falta); return; }
    setError(null); setGuardando(true);
    try {
      const emp = await guardarEmpresaReceptora(input);
      onGuardada(emp);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la empresa.');
      toast(err instanceof Error ? err.message : 'No se pudo guardar la empresa.', 'error');
    } finally {
      setGuardando(false);
    }
  }

  const etq: React.CSSProperties = { display: 'block', fontSize: '.8rem', fontWeight: 700, marginBottom: '.2rem' };

  return (
    <form id={idForm} onSubmit={submit} style={{ display: 'grid', gap: '.7rem' }}>
      {verFiscal && empresa && (
        <div style={{ fontWeight: 700 }}>{empresa.nombreCorto || empresa.nombre} <span className="muted mono" style={{ fontWeight: 400 }}>· {empresa.rif}</span></div>
      )}

      {!verFiscal && (
        <>
          <div className="surt-grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
            <div>
              <label style={etq}>Razón social *</label>
              <input className="input" style={{ width: '100%' }} value={nombre} maxLength={200} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Inversiones El Roble C.A." required autoFocus={!esEdicion} />
            </div>
            <div>
              <label style={etq}>Nombre corto</label>
              <input className="input" style={{ width: '100%' }} value={nombreCorto} maxLength={60} onChange={(e) => setNombreCorto(e.target.value)} placeholder="Ej. El Roble" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: verContacto ? '1fr 1fr' : '1fr', gap: '.6rem' }}>
            <div>
              <label style={etq}>RIF *</label>
              <input className="input mono" style={{ width: '100%' }} value={rif} onChange={(e) => setRif(e.target.value)} onBlur={revisarRif} autoCapitalize="characters" placeholder="J-XXXXXXXX-X" required />
            </div>
            {verContacto && (
              <div style={{ display: 'flex', gap: '.8rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer' }}>
                  <span style={etq}>Color</span>
                  <input type="color" value={colorBadge} onChange={(e) => setColorBadge(e.target.value)} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
                  <span>Activa (aparece al cargar facturas)</span>
                </label>
              </div>
            )}
          </div>
        </>
      )}

      {verContacto && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
            <div><label style={etq}>Correo</label><input className="input" style={{ width: '100%' }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><label style={etq}>Teléfono</label><input className="input" style={{ width: '100%' }} value={telefono} onChange={(e) => setTelefono(e.target.value)} /></div>
          </div>
          <div><label style={etq}>Dirección fiscal</label><input className="input" style={{ width: '100%' }} value={direccionFiscal} onChange={(e) => setDireccionFiscal(e.target.value)} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
            <div><label style={etq}>Municipio</label><input className="input" style={{ width: '100%' }} value={municipio} onChange={(e) => setMunicipio(e.target.value)} placeholder="Ej. Caroní" /></div>
            <div><label style={etq}>Estado</label><input className="input" style={{ width: '100%' }} value={estado} onChange={(e) => setEstado(e.target.value)} placeholder="Ej. Bolívar" /></div>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: '.78rem' }}>El régimen y los % de cada empresa se editan en Parámetros → Régimen y Config fiscal por empresa.</p>
        </>
      )}

      {verFiscal && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
          <div>
            <label style={etq}>Alícuota del ISAE / Impuesto Municipal (%)</label>
            <input className="input mono" type="number" min={0} max={100} step="any" value={alicuotaMunicipal} onChange={(e) => setAlicuotaMunicipal(e.target.value)} placeholder="la del municipio" />
          </div>
          <div>
            <label style={etq}>Licencia municipal (RIM)</label>
            <input className="input" type="text" maxLength={60} value={licenciaMunicipal} onChange={(e) => setLicenciaMunicipal(e.target.value)} placeholder="N° de licencia de actividad económica" />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontSize: '.86rem', gridColumn: '1 / -1' }}>
            <input type="checkbox" checked={imprimirOriginalYCopia} onChange={(e) => setImprimirOriginalYCopia(e.target.checked)} />
            Imprimir el comprobante en Original y Copia
          </label>
          <p className="muted" style={{ margin: 0, fontSize: '.78rem', gridColumn: '1 / -1' }}>Los % nacionales (IVA 75/100, alícuota del IVA, IGTF) se configuran en Parámetros → Valores; el régimen, en Parámetros → Régimen.</p>
        </div>
      )}

      {error && <div className="aviso error sm"><span className="aviso-icono">⚠️</span><div>{error}</div></div>}

      <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
        {onClose && <button type="button" className="btn" onClick={onClose} disabled={guardando}>Cancelar</button>}
        <button type="submit" className="btn btn-primary" disabled={guardando}>
          {guardando ? 'Guardando…' : (esEdicion ? 'Guardar' : 'Crear empresa')}
        </button>
      </div>
    </form>
  );
}
