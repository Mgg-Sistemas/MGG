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
import { useState, useEffect, type FormEvent } from 'react';
import { toast } from '@/shared/ui/Toast';
import { completarRif, formatearRif } from '@/shared/lib/rif';
import {
  guardarEmpresaReceptora, faltaEnEmpresa,
  type EmpresaReceptora, type EmpresaReceptoraInput,
} from './empresasReceptoras.repository';
import { esEmpresaGt } from './empresaActual';
import { getConfigRetencion, guardarConfigRetencion, type ConfigRetencion } from '@/modules/libroFiscal/retencionesFiscal.repository';

const COLOR_POR_DEFECTO = '#2563eb';
const esColorValido = (c: string | null | undefined) => /^#[0-9a-fA-F]{6}$/.test(String(c ?? ''));

/** 'rapido' = alta/edición mínima del teléfono · 'identidad' = ficha identidad+contacto (buzón PC)
 *  · 'fiscal' = lo por-empresa del comprobante (alícuota municipal, licencia, original y copia)
 *  · 'completo' = editor integral con identidad, contacto y ficha fiscal para PC. */
export type ModoEmpresaEditor = 'rapido' | 'identidad' | 'fiscal' | 'completo';

export function EmpresaEditor({ empresa, modo, onGuardada, onClose, idForm, configGt }: {
  /** undefined = crear; definida = editar. El modo 'fiscal' siempre es edición. */
  empresa?: EmpresaReceptora;
  modo: ModoEmpresaEditor;
  onGuardada: (emp: EmpresaReceptora) => void;
  /** Lo pasa el llamador-modal para ofrecer «Cancelar»; inline lo omite. */
  onClose?: () => void;
  /** Id opcional del <form> (para un botón de guardar externo si el llamador lo necesita). */
  idForm?: string;
  /** Configuración fiscal global de GT para sincronización bidireccional de comprobantes. */
  configGt?: ConfigRetencion | null;
}) {
  const esEdicion = !!empresa;
  const esGt = esEmpresaGt(empresa);
  const verContacto = modo === 'identidad' || modo === 'completo';
  const verFiscal = modo === 'fiscal' || modo === 'completo';
  const esModoCompleto = modo === 'completo';

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
  const [imprimirOriginalYCopia, setImprimirOriginalYCopia] = useState<boolean>(() => {
    if (esGt && configGt?.imprimirOriginalYCopia !== undefined) {
      return configGt.imprimirOriginalYCopia !== false;
    }
    if (empresa?.imprimirOriginalYCopia !== undefined) {
      return empresa.imprimirOriginalYCopia !== false;
    }
    return !esGt;
  });
  const [esContribuyenteEspecial, setEsContribuyenteEspecial] = useState(empresa?.esContribuyenteEspecial === true);

  // Sincronizar preferencia de emisión (Original y Copia vs Solo Original) para Golden Touch desde la configuración global
  useEffect(() => {
    if (esGt) {
      if (configGt?.imprimirOriginalYCopia !== undefined) {
        setImprimirOriginalYCopia(configGt.imprimirOriginalYCopia !== false);
      } else {
        void getConfigRetencion().then((c) => {
          if (c && c.imprimirOriginalYCopia !== undefined) {
            setImprimirOriginalYCopia(c.imprimirOriginalYCopia !== false);
          }
        }).catch(() => {});
      }
    } else if (empresa?.imprimirOriginalYCopia !== undefined) {
      setImprimirOriginalYCopia(empresa.imprimirOriginalYCopia !== false);
    }
  }, [esGt, configGt, empresa?.imprimirOriginalYCopia]);

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

    if (esModoCompleto) {
      return {
        id: prev?.id,
        clave: prev?.clave,
        orden: prev?.orden,
        nombre: nombre.trim(),
        nombreCorto: nombreCorto.trim() || undefined,
        rif: rif.trim(),
        colorBadge: colorBadge,
        activo: activo,
        email: email.trim() || undefined,
        telefono: telefono.trim() || undefined,
        direccionFiscal: direccionFiscal.trim() || undefined,
        municipio: municipio.trim() || undefined,
        estado: estado.trim() || undefined,
        licenciaMunicipal: licenciaMunicipal.trim() || undefined,
        alicuotaMunicipal: alicuotaMunicipal.trim() === '' ? undefined : Number(alicuotaMunicipal),
        imprimirOriginalYCopia,
        esContribuyenteEspecial,
      };
    }

    if (verFiscal) {
      // Modo fiscal: edita alícuota municipal, licencia, original/copia y régimen especial; la identidad se
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
        esContribuyenteEspecial,
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
      // Mantener sincronizada la configuración canónica de Golden Touch
      if (esGt) {
        try {
          const cfgActual = await getConfigRetencion();
          await guardarConfigRetencion({
            ...cfgActual,
            imprimirOriginalYCopia: emp.imprimirOriginalYCopia !== false,
            licenciaMunicipal: emp.licenciaMunicipal ?? cfgActual.licenciaMunicipal,
            alicuotaMunicipal: emp.alicuotaMunicipal,
          });
        } catch {
          // Si falla config, la ficha de la empresa ya se guardó en la tabla receptora
        }
      }
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
      {verFiscal && !esModoCompleto && empresa && (
        <div style={{ fontWeight: 700 }}>{empresa.nombreCorto || empresa.nombre} <span className="muted mono" style={{ fontWeight: 400 }}>· {empresa.rif}</span></div>
      )}

      {(!verFiscal || esModoCompleto) && (
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
          {/* Guía informativa de qué retiene la empresa */}
          <div style={{ gridColumn: '1 / -1', background: 'rgba(56, 189, 248, 0.06)', border: '1px solid rgba(56, 189, 248, 0.2)', padding: '.65rem .85rem', borderRadius: '8px', fontSize: '.78rem', color: '#94a3b8' }}>
            <strong style={{ color: '#38bdf8' }}>💡 ¿Qué retiene esta empresa al crearse?</strong>
            <div style={{ marginTop: '.25rem', lineHeight: 1.45 }}>
              • <strong>ISLR:</strong> Habilitado de inmediato según Decreto 1.808 (personas jurídicas y naturales en compras y servicios).<br />
              • <strong>IVA:</strong> Solo aplica si la empresa fue formalmente designada Sujeto Pasivo Especial por el SENIAT.<br />
              • <strong>ISAE (Municipal):</strong> Requiere la alícuota de la ordenanza municipal y el N° de Licencia (RIM).
            </div>
          </div>

          {/* Selector de Régimen SENIAT */}
          <div style={{ gridColumn: '1 / -1', background: 'rgba(255, 255, 255, 0.03)', padding: '.75rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <label style={etq}>Régimen Tributario ante el SENIAT</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '.5rem', marginTop: '.35rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.55rem .75rem', borderRadius: '6px', border: `1.5px solid ${!esContribuyenteEspecial ? 'var(--primary)' : 'var(--border)'}`, background: !esContribuyenteEspecial ? 'rgba(245, 158, 11, 0.08)' : 'transparent', cursor: 'pointer' }}>
                <input type="radio" name="regimen_seniat" checked={!esContribuyenteEspecial} onChange={() => setEsContribuyenteEspecial(false)} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '.84rem', color: 'var(--text)' }}>🏢 Contribuyente Ordinario</div>
                  <div className="muted" style={{ fontSize: '.74rem' }}>Paga el 100% del IVA al proveedor. Retiene ISLR e ISAE.</div>
                </div>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.55rem .75rem', borderRadius: '6px', border: `1.5px solid ${esContribuyenteEspecial ? '#eab308' : 'var(--border)'}`, background: esContribuyenteEspecial ? 'rgba(234, 179, 8, 0.1)' : 'transparent', cursor: 'pointer' }}>
                <input type="radio" name="regimen_seniat" checked={esContribuyenteEspecial} onChange={() => setEsContribuyenteEspecial(true)} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '.84rem', color: '#eab308' }}>⭐ Contribuyente Especial</div>
                  <div className="muted" style={{ fontSize: '.74rem' }}>Designada por SENIAT. Retiene IVA (75/100%) y percibe IGTF.</div>
                </div>
              </label>
            </div>
          </div>

          <div>
            <label style={etq}>Alícuota del ISAE / Impuesto Municipal (%)</label>
            <input className="input mono" type="number" min={0} max={100} step="any" value={alicuotaMunicipal} onChange={(e) => setAlicuotaMunicipal(e.target.value)} placeholder="Ej. 1" />
          </div>
          <div>
            <label style={etq}>Licencia municipal (RIM)</label>
            <input className="input" type="text" maxLength={60} value={licenciaMunicipal} onChange={(e) => setLicenciaMunicipal(e.target.value)} placeholder="N° de licencia de actividad económica" />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'grid', gap: '.25rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontSize: '.86rem' }}>
              <input type="checkbox" checked={imprimirOriginalYCopia} onChange={(e) => setImprimirOriginalYCopia(e.target.checked)} />
              <span>Imprimir el comprobante en Original y Copia (Página 1: Sujeto Retenido · Página 2: Agente)</span>
            </label>
            {!imprimirOriginalYCopia ? (
              <div className="muted" style={{ fontSize: '.76rem', marginLeft: '1.45rem', color: 'var(--primary, #f59e0b)' }}>
                ℹ️ Modalidad configurada: <strong>Solo Original</strong> (emite 1 página estándar sin duplicado).
              </div>
            ) : (
              <div className="muted" style={{ fontSize: '.76rem', marginLeft: '1.45rem' }}>
                ℹ️ Modalidad estándar: emite 2 páginas (Original para el proveedor + Copia para el archivo del agente).
              </div>
            )}
          </div>
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
