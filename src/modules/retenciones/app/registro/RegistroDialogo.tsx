/* ============================================================
   MGG · Retenciones v8 · Registrar una retención

   Traslado del diálogo «Registrar retención» de la maqueta v8
   (v8-4-dialogos-registro.js y las decisiones del 14/10): el documento y la
   contraparte arriba; el resumen (impuesto, base o IVA, %, monto); los
   datos de la factura; varias líneas para ISLR e ISAE (una por concepto);
   y «Cómo se calculó», con lo que hizo cada paso del motor.

   Calcula con el motor nuevo de 8 pasos. Las reglas salen de la
   configuración de hoy (reglasDesdeConfig.ts) mientras la base no tenga el
   paquete de reglas. Guarda con el registro de hoy (puerta.registrar): una
   retención por línea. La foto del cálculo todavía no tiene dónde
   guardarse; se muestra, pero no se dice que se guarde.

   Nada se corrige en silencio: cada campo dice su error debajo y
   «Registrar» queda bloqueado mientras haya alguno.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { parseDecimal } from '@/shared/ui/DecimalInput';
import { money } from '@/shared/lib/format';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useSession } from '@/modules/auth/authStore';
import { periodoDe, quincenaDe, type ConceptoRetencion, type ConfigRetencion, type MotivosIvaCien } from '../../retencionesCalculo';
import { faltaEnLaCarga } from '../../validarCarga';
import { mensajeDobleRegistro, retencionYaRegistrada } from '../../dobleRegistro';
import { usePuerta, type NuevaRetencion, type RetencionItem } from '../datos/puerta';
import type { PeriodoRetencion } from '../datos/periodos';
import { periodoCerradoPara } from '../periodos/validarDeclaracion';
import { nombrePeriodo } from '../periodos/modeloPeriodos';
import { componentesDelDocumento, type DocumentoAnfitrion } from '../logica/componentes';
import { calcularLinea, type ResultadoCalculo } from '../logica/motor';
import { nombreImpuesto } from '../pantalla/pendientesPorDocumento';
import type { SemillaRegistro } from '../pantalla/registrarDeNuevo';
import { contextoDeHoy, filaDeConcepto, reglasDeHoy, SUPUESTOS_IVA, supuestosMarcados } from './reglasDesdeConfig';
import { textoDelPaso, textoFalta } from './textosCalculo';
import { revisarRif } from './validarRif';
import { textoNumeroComprobante } from './numeroComprobante';
import { MarcaPaquete21 } from '../comun/MarcaPaquete21';
import { PerfilFiscal } from '../perfil/PerfilFiscal';
import './registro.css';
import './rv8-registro.css';

type Impuesto = 'iva' | 'islr' | 'municipal';

interface Props {
  item: RetencionItem;
  impuesto: string;
  onCerrar: () => void;
  onRegistrada: () => void;
  /** «Registrar <IMP> de nuevo»: abre con los datos de la factura de la anulada (se pueden corregir). */
  semilla?: SemillaRegistro;
}

interface Linea { conceptoId: string; base: string }

/** Los montos del documento, desde la OC o la compra. */
function documentoDe(item: RetencionItem): DocumentoAnfitrion {
  if (item.kind === 'compra_directa' && item.compra) {
    const c = item.compra;
    return { tipo: 'compra_directa', moneda: c.moneda, total: c.gasto, iva: c.iva, igtf: c.igtf, iva_incluido: null, descuento: c.descuento_monto };
  }
  const o = item.orden;
  return {
    tipo: 'oc', moneda: item.moneda, total: o?.total ?? item.total, iva: o?.iva ?? null, igtf: o?.igtf ?? null,
    iva_incluido: o?.iva_incluido ?? null, descuento: o?.descuento_obtenido ?? null,
  };
}

const texto = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));
const hoyIso = () => new Date().toLocaleDateString('en-CA');

export function RegistroDialogo({ item, impuesto, onCerrar, onRegistrada, semilla }: Props) {
  const puerta = usePuerta();
  const { user } = useSession();
  const { appUser, can } = usePermissions();
  // El perfil fiscal: en local, o cuando la base lo tenga (capacidades.perfilProveedor)
  const [perfilAbierto, setPerfilAbierto] = useState(false);
  const cerrarPerfil = useCallback(() => setPerfilAbierto(false), []);
  const imp = impuesto as Impuesto;
  const conLineas = imp === 'islr' || imp === 'municipal';

  const [config, setConfig] = useState<ConfigRetencion | null>(null);
  const [conceptos, setConceptos] = useState<ConceptoRetencion[]>([]);
  const [periodos, setPeriodos] = useState<PeriodoRetencion[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      puerta.config(),
      puerta.conceptos(true),
      puerta.periodos ? puerta.periodos() : Promise.resolve(null),
    ])
      .then(([c, cs, pers]) => { setConfig(c); setConceptos(cs); setPeriodos(pers); })
      .catch((e: unknown) => setErrorCarga(e instanceof Error ? e.message : 'No se pudo leer la configuración fiscal.'));
  }, [puerta]);

  const comp = useMemo(() => componentesDelDocumento(documentoDe(item)), [item]);
  const baseInicial = comp.montos.subtotal != null ? comp.montos.subtotal - (comp.montos.descuento ?? 0) : null;

  const [factura, setFactura] = useState(semilla?.factura ?? '');
  const [control, setControl] = useState(semilla?.control ?? '');
  const [fecha, setFecha] = useState(semilla?.fecha ?? '');
  const [ivaTxt, setIvaTxt] = useState(texto(semilla?.iva ?? comp.montos.iva));
  const [baseTxt, setBaseTxt] = useState(texto(semilla?.base ?? baseInicial));
  const [motivos, setMotivos] = useState<MotivosIvaCien>({});
  const [lineas, setLineas] = useState<Linea[]>([{ conceptoId: '', base: texto(semilla?.base ?? baseInicial) }]);
  const [tocado, setTocado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);

  const delImpuesto = conceptos.filter((c) => c.tipo === imp);
  const iva = parseDecimal(ivaTxt);
  const base = parseDecimal(baseTxt);

  const periodoCerrado = useMemo(() => {
    return fecha ? periodoCerradoPara(imp, fecha, periodos) : null;
  }, [imp, fecha, periodos]);

  // Los errores de cada campo (se muestran al tocar «Registrar» o al escribir).
  const rif = revisarRif(item.proveedorRif);
  const errores: Record<string, string | null> = {
    rif: rif.error,
    factura: !factura.trim() ? 'Indique el N° de la factura.' : factura.trim().length > 20 ? 'El N° de factura no puede pasar de 20 caracteres.' : null,
    control: imp === 'iva' && !control.trim() ? 'Indique el N° de control de la factura.' : null,
    fecha: !fecha
      ? 'Indique la fecha de la factura.'
      : fecha > hoyIso()
      ? 'La fecha de la factura no puede ser posterior a hoy.'
      : periodoCerrado
      ? `Período fiscal declarado (${nombrePeriodo(periodoCerrado)}): reábralo en Períodos para registrar.`
      : null,
    iva: imp === 'iva' && (iva == null || iva < 0) ? 'Indique el IVA de la factura (0 si no tiene).' : null,
    base: imp === 'iva' && (base == null || base <= 0) ? 'Indique la base imponible de la factura.' : null,
    // La misma regla que adjuntarComprobante: PDF o imagen.
    archivo: archivo && archivo.type && archivo.type !== 'application/pdf' && !archivo.type.startsWith('image/') ? 'El comprobante debe ser PDF o imagen.' : null,
  };
  lineas.forEach((l, i) => {
    if (!conLineas) return;
    const b = parseDecimal(l.base);
    errores[`concepto${i}`] = !l.conceptoId ? 'Elija el concepto.' : null;
    errores[`base${i}`] = b == null || b <= 0 ? 'Indique la base de la línea.' : null;
  });

  // El cálculo, con el motor nuevo.
  const resultados: ResultadoCalculo[] = useMemo(() => {
    if (!config) return [];
    const reglas = reglasDeHoy(config);
    const ctx = contextoDeHoy(config);
    const sup = supuestosMarcados(motivos, config);
    if (imp === 'iva') {
      return [calcularLinea(reglas.iva, { montos: { iva: iva ?? null }, moneda: item.moneda, tipo: 'factura', fila: null, supuestos: sup }, ctx)];
    }
    if (!conLineas) return [];
    return lineas.map((l) => {
      const c = conceptos.find((x) => x.id === l.conceptoId);
      return calcularLinea(reglas[imp], {
        montos: { subtotal: parseDecimal(l.base) }, moneda: item.moneda, tipo: 'factura', fila: c ? filaDeConcepto(c) : null, supuestos: [],
      }, ctx);
    });
  }, [config, conceptos, imp, iva, lineas, motivos, item.moneda, conLineas]);

  const total = resultados.reduce((a, r) => a + (r.estado === 'calculado' ? r.magnitud : 0), 0);
  const conErrores = Object.values(errores).some(Boolean);
  const sinCalculo = resultados.some((r) => r.estado !== 'calculado');
  const agenteIva = !config || config.esContribuyenteEspecial;

  const registrar = async () => {
    setTocado(true);
    if (conErrores || sinCalculo || !config || (imp === 'iva' && !agenteIva)) return;
    if (periodoCerrado) {
      setErrorGuardar(`El período fiscal (${nombrePeriodo(periodoCerrado)}) ya fue declarado ante el SENIAT. Reábralo en Períodos para registrar.`);
      return;
    }
    // La misma validación de la carga que la pantalla de hoy (validarCarga.ts).
    const falta = faltaEnLaCarga({ tipo: imp, facturaNumero: factura, facturaFecha: fecha });
    if (falta) { setErrorGuardar(falta); return; }
    // Una línea que da 0 no se registra (registrarRetencion la rechazaría): se dice antes.
    const enCero = resultados.findIndex((r) => r.estado === 'calculado' && r.magnitud <= 0);
    if (enCero >= 0) {
      const r = resultados[enCero];
      setErrorGuardar(`${conLineas ? `La línea ${enCero + 1}` : 'La retención'} da 0,00${r.estado === 'calculado' && r.nota ? `: ${r.nota}` : '.'} No se registra.`);
      return;
    }
    // Guarda anti-doble retención (regla: una sola retención vigente por impuesto y factura)
    try {
      const existentes = await puerta.libro({ direccion: 'practicada' });
      const duplicada = retencionYaRegistrada(existentes, {
        direccion: 'practicada',
        tipo: imp,
        contraparteRif: item.proveedorRif,
        facturaNumero: factura.trim(),
      });
      if (duplicada) {
        setErrorGuardar(mensajeDobleRegistro(duplicada));
        return;
      }
    } catch {
      // Si falla la lectura del libro, continúa para no bloquear el flujo ante problemas transitorios
    }
    setGuardando(true); setErrorGuardar(null);
    const comun = {
      tipo: imp, direccion: 'practicada' as const, docKind: item.kind, docId: item.id, docCodigo: item.ocCodigo,
      contraparteId: item.proveedorId, contraparteRif: item.proveedorRif, contraparteNombre: item.proveedorNombre,
      facturaNumero: factura.trim(), facturaControl: control.trim() || null, facturaFecha: fecha,
      periodo: periodoDe(fecha), quincena: imp === 'iva' ? quincenaDe(fecha) : null, moneda: item.moneda,
      actor: user?.email ?? 'sistema', actorName: appUser?.nombre ?? null,
    };
    const hechas: string[] = [];
    const sinAdjunto: string[] = [];
    try {
      for (let i = 0; i < resultados.length; i++) {
        const r = resultados[i];
        if (r.estado !== 'calculado') continue;
        let input: NuevaRetencion;
        if (imp === 'iva') {
          const motivo = SUPUESTOS_IVA.filter((s) => motivos[s.clave]).map((s) => s.texto).join('; ');
          input = {
            ...comun, baseImponible: base ?? 0, impuesto: iva ?? 0,
            alicuota: base && iva ? Math.round((iva / base) * 10000) / 100 : 0,
            porcentaje: r.foto.valores.pct_supuesto ?? config.pctIvaGeneral, sustraendo: 0, montoRetenido: r.magnitud,
            observacion: motivo ? `100 % porque: ${motivo.toLowerCase()}` : null,
          };
        } else {
          const c = conceptos.find((x) => x.id === lineas[i].conceptoId);
          input = {
            ...comun, conceptoId: c?.id ?? null, conceptoNombre: c?.nombre ?? null,
            contraparteSujeto: c && c.sujeto !== 'todos' ? c.sujeto : null,
            // Como hoy: la base que se guarda es la del cálculo (con la porción del concepto ya aplicada).
            baseImponible: Math.round(r.base * 100) / 100, porcentaje: r.pct ?? 0, sustraendo: r.sustraendo, montoRetenido: r.magnitud,
          };
        }
        const registrada = await puerta.registrar(input);
        hechas.push(imp === 'iva' ? 'IVA' : `línea ${i + 1}`);
        // Como hoy: el comprobante se adjunta después; si no sube, la retención queda y se avisa.
        if (archivo) await puerta.adjuntarComprobante(registrada.id, archivo).catch(() => sinAdjunto.push(hechas[hechas.length - 1]));
      }
      if (sinAdjunto.length) toast(`La retención quedó, pero el adjunto no subió (${sinAdjunto.join(', ')}).`, 'error');
      onRegistrada();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'No se pudo registrar.';
      setErrorGuardar(hechas.length ? `Quedó registrada: ${hechas.join(', ')}. La siguiente falló: ${msg}` : msg);
    } finally {
      setGuardando(false);
    }
  };

  const conPerfil = import.meta.env.DEV || puerta.capacidades.perfilProveedor;
  const err = (k: string) => (tocado || k.startsWith('base') || k.startsWith('concepto') ? errores[k] : null);
  // Como la maqueta (abrirRegistrar): «Factura N · Proveedor · Documento», o «Documento … · Proveedor · factura por indicar».
  const subtitulo = factura.trim()
    ? `Factura ${factura.trim()} · ${item.proveedorNombre} · ${item.ocCodigo ?? '—'}`
    : `Documento ${item.ocCodigo ?? '—'} · ${item.proveedorNombre} · factura por indicar`;

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={guardando}>Cancelar</button>
      <button type="button" className="btn btn-primary" onClick={registrar}
        disabled={guardando || !config || (tocado && (conErrores || sinCalculo)) || !!periodoCerrado || (imp === 'iva' && !agenteIva)}>
        {guardando ? 'Registrando…' : 'Registrar'}
      </button>
    </>
  );

  return (
    <>
    <Modal title="Registrar retención" size="lg" onClose={onCerrar} footer={footer}>
      <div className="ret-v8 v8-registro">
        <p className="v8-reg-sub">{subtitulo}</p>
        {semilla?.reemplazaA && <p className="v8-reg-aviso">Reemplaza al N° {semilla.reemplazaA} (anulado). Los datos vienen de la retención anulada: revisarlos antes de registrar.</p>}
        {rif.error && <p className="v8-reg-error" role="alert">{rif.error}</p>}
        {rif.aviso && <p className="v8-reg-aviso">{rif.aviso}</p>}
        {errorCarga && <div className="aviso-error" role="alert">No se pudo leer la configuración fiscal: {errorCarga}</div>}
        {!config && !errorCarga && <p className="muted" role="status">Cargando la configuración fiscal…</p>}
        {config && imp === 'iva' && !agenteIva && (
          <div className="aviso-error" role="alert">La empresa no está marcada como contribuyente especial en ⚙ Parámetros: no practica retención de IVA.</div>
        )}

        {config && (
          <>
            <div className="v8-reg-resumen" aria-live="polite">
              <div><span>Impuesto</span><b>{nombreImpuesto(imp)}</b></div>
              {imp === 'iva'
                ? <div><span>IVA de la factura</span><b>{iva != null ? money(iva, item.moneda) : '—'}</b></div>
                : <div><span>Base</span><b>{money(lineas.reduce((a, l) => a + (parseDecimal(l.base) ?? 0), 0), item.moneda)}</b></div>}
              <div><span>Porcentaje</span><b>{imp === 'iva'
                ? `${resultados[0]?.foto.valores.pct_supuesto ?? config.pctIvaGeneral} %${resultados[0]?.foto.valores.pct_supuesto != null ? ' (art. 5)' : ''}`
                : (lineas.length === 1 && resultados[0]?.estado === 'calculado' && resultados[0].pct != null ? `${resultados[0].pct} %` : 'Por línea')}</b></div>
              <div><span>Monto a retener</span><b>{sinCalculo ? '—' : money(total, item.moneda)}</b></div>
            </div>

            {comp.pendientes.length > 0 && <p className="v8-reg-aviso">{comp.pendientes.join(' ')}</p>}

            {periodoCerrado && (
              <div className="aviso-error" role="alert" style={{ marginBottom: '0.8rem' }}>
                <strong>🔒 Período Fiscal Declarado ({nombrePeriodo(periodoCerrado)})</strong>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
                  Este período ya fue declarado y enterado ante el SENIAT{periodoCerrado.declaradoEn ? ` el ${periodoCerrado.declaradoEn.slice(0, 10)}` : ''}.
                  Para registrar retenciones con esta fecha, el administrador debe reabrir el período con justificación en la pestaña Períodos.
                </p>
              </div>
            )}

            <div className="v8-reg-campos">
              <label className="campo">
                <span>N° de factura</span>
                <input className="texto" value={factura} maxLength={30} onChange={(e) => setFactura(e.target.value)} aria-invalid={!!err('factura')} />
                {err('factura') && <small className="v8-reg-error">{err('factura')}</small>}
              </label>
              <label className="campo">
                <span>N° de control</span>
                <input className="texto" value={control} onChange={(e) => setControl(e.target.value)} aria-invalid={!!err('control')} />
                {err('control') && <small className="v8-reg-error">{err('control')}</small>}
              </label>
              <label className="campo">
                <span>Fecha de la factura</span>
                <input className="texto" type="date" value={fecha} max={hoyIso()} onChange={(e) => setFecha(e.target.value)} aria-invalid={!!err('fecha')} />
                {fecha && !err('fecha') && <small className="muted">Período {periodoDe(fecha)}{imp === 'iva' ? ` · quincena ${quincenaDe(fecha)}` : ''}</small>}
                {err('fecha') && <small className="v8-reg-error">{err('fecha')}</small>}
              </label>
              <label className="campo">
                <span>Comprobante (PDF o imagen)</span>
                <input className="texto" type="file" accept="application/pdf,image/*" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} aria-invalid={!!errores.archivo} />
                {archivo && !errores.archivo && <small className="muted">{archivo.name}</small>}
                {errores.archivo && <small className="v8-reg-error">{errores.archivo}</small>}
              </label>
              {imp === 'iva' && (
                <>
                  <label className="campo">
                    <span>Base imponible</span>
                    <input className="texto mono" inputMode="decimal" value={baseTxt} onChange={(e) => setBaseTxt(e.target.value)} aria-invalid={!!err('base')} />
                    {err('base') && <small className="v8-reg-error">{err('base')}</small>}
                  </label>
                  <label className="campo">
                    <span>IVA de la factura</span>
                    <input className="texto mono" inputMode="decimal" value={ivaTxt} onChange={(e) => setIvaTxt(e.target.value)} aria-invalid={!!err('iva')} />
                    {err('iva') && <small className="v8-reg-error">{err('iva')}</small>}
                  </label>
                </>
              )}
            </div>

            <div className="rv8-caja-pa" aria-live="polite">
              <span className="rv8-caja-t">N° de comprobante</span>
              <p className="rv8-huella">{textoNumeroComprobante(imp, fecha ? periodoDe(fecha) : '')}</p>
              {import.meta.env.DEV && (
                <span className="rv8-con-marca">
                  <label className="rv8-chk rv8-requiere-base"><input type="checkbox" disabled /> Editar número</label><MarcaPaquete21 />
                </span>
              )}
            </div>

            {imp === 'iva' && (
              <fieldset className="v8-reg-supuestos">
                <legend>% aplicable: {config.pctIvaGeneral} % (art. 4). Para el {config.pctIvaEspecial} %, marcar el supuesto del art. 5:</legend>
                {SUPUESTOS_IVA.map((s) => (
                  <label key={s.clave}>
                    <input type="checkbox" checked={!!motivos[s.clave]} onChange={(e) => setMotivos((m) => ({ ...m, [s.clave]: e.target.checked }))} /> {s.texto}
                  </label>
                ))}
              </fieldset>
            )}

            {conLineas && (
              <div className="v8-reg-lineas">
                <div className="v8-reg-lineas-cab"><b>Líneas</b> <span className="muted">Una por concepto; cada una con su %.</span></div>
                {!delImpuesto.length && <p className="aviso-error">No hay conceptos de {nombreImpuesto(imp)} activos en el catálogo. Cárguelos en ⚙ Parámetros.</p>}
                {lineas.map((l, i) => {
                  const r = resultados[i];
                  return (
                    <div key={i} className="v8-reg-linea">
                      <label className="campo">
                        <span>Concepto</span>
                        <select className="select" value={l.conceptoId} onChange={(e) => setLineas((xs) => xs.map((x, j) => (j === i ? { ...x, conceptoId: e.target.value } : x)))}>
                          <option value="">Elegir…</option>
                          {delImpuesto.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} · ` : ''}{c.nombre} ({c.porcentaje} %)</option>)}
                        </select>
                        {err(`concepto${i}`) && <small className="v8-reg-error">{err(`concepto${i}`)}</small>}
                      </label>
                      <label className="campo">
                        <span>Base de la línea</span>
                        <input className="texto mono" inputMode="decimal" value={l.base} onChange={(e) => setLineas((xs) => xs.map((x, j) => (j === i ? { ...x, base: e.target.value } : x)))} />
                        {err(`base${i}`) && <small className="v8-reg-error">{err(`base${i}`)}</small>}
                      </label>
                      <div className="v8-reg-linea-monto">
                        <span>Retiene</span>
                        <b>{r?.estado === 'calculado' ? money(r.magnitud, item.moneda) : '—'}</b>
                      </div>
                      {lineas.length > 1 && (
                        <button type="button" className="mini" onClick={() => setLineas((xs) => xs.filter((_, j) => j !== i))} aria-label={`Quitar la línea ${i + 1}`}>Quitar</button>
                      )}
                      {r && r.estado === 'sin_dato' && l.conceptoId && <p className="v8-reg-error v8-reg-linea-nota">{textoFalta(r)}</p>}
                      {r && r.estado === 'calculado' && r.nota && <p className="muted v8-reg-linea-nota">{r.nota}</p>}
                    </div>
                  );
                })}
                <button type="button" className="mini" onClick={() => setLineas((xs) => [...xs, { conceptoId: '', base: '' }])}>+ Otra línea</button>
              </div>
            )}

            {resultados.some((r) => r.estado === 'calculado') && (
              <details className="v8-reg-foto">
                <summary>Cómo se calculó</summary>
                {resultados.map((r, i) => (r.estado === 'calculado' || r.estado === 'sin_dato') && (
                  <ol key={i} aria-label={conLineas ? `Línea ${i + 1}` : 'Cálculo'}>
                    {conLineas && <li className="v8-reg-foto-t">Línea {i + 1}</li>}
                    {r.foto.pasos.map((p, j) => <li key={j}>{textoDelPaso(p, item.moneda)}</li>)}
                  </ol>
                ))}
              </details>
            )}
            {imp === 'iva' && resultados[0]?.estado === 'sin_dato' && <p className="v8-reg-error">{textoFalta(resultados[0])}</p>}
            {resultados.flatMap((r) => (r.estado === 'calculado' ? r.avisos : [])).map((a, i) => <p key={i} className="v8-reg-aviso">{a}</p>)}
            {conPerfil && item.proveedorId && !sinCalculo && total <= 0 && (
              <p className="v8-reg-aviso" role="alert">
                El cálculo da {money(total, item.moneda)}: no se registra una retención en cero. Revise el perfil fiscal del proveedor.{' '}
                <button type="button" className="mini" onClick={() => setPerfilAbierto(true)}>Perfil fiscal del proveedor</button>
              </p>
            )}
            {errorGuardar && <div className="aviso-error" role="alert">{errorGuardar}</div>}
          </>
        )}
      </div>
    </Modal>
    {perfilAbierto && item.proveedorId && (
      <PerfilFiscal proveedor={{ id: item.proveedorId, razonSocial: item.proveedorNombre ?? '—', rif: item.proveedorRif ?? '—', direccion: null }}
        puedeEditar={can('retenciones', 'escritura')} onCerrar={cerrarPerfil} />
    )}
    </>
  );
}
