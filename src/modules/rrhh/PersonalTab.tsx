import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { FechaVe } from '@/shared/ui/FechaVe';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { money, date, dateTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import type { Personal, NominaRenglon } from '@/shared/lib/types';
import {
  listPersonal, crearPersonal, actualizarPersonal, setPersonalActivo, eliminarPersonal,
  subirFotoCarnet, digitosCedula, listHistorialSueldo,
  listDocumentosPersonal, listDocumentosDeTodos, subirDocumentoPersonal,
  urlDocumentoPersonal, borrarDocumentoPersonal, renombrarDocumentoPersonal,
  type PersonalInput, type CambioSueldoRegistro, type DocumentoPersonal,
} from './personal.repository';
import {
  TIPOS_DOCUMENTO_PERSONAL, documentacionCompleta, megas, resumenDocumentos,
  validarArchivoDocumento, type TipoDocumentoPersonal,
  MAX_DOCUMENTOS_OTROS, MIN_ETIQUETA, TIPO_OTRO, errorEtiquetaDocumento,
  iconoDocumento, tituloDocumento,
} from './documentosPersonal';
import { EMPRESA_POR_DEFECTO, definicionEmpresa, type Empresa } from './empresa';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import {
  MAX_DETALLE_SALUD, errorCondicionesSalud, renglonesSalud, type RespuestaSalud,
} from './condicionesSalud';
import {
  AGRUPADORES, ESTADOS_CIVILES, GENEROS, GRADOS_INSTRUCCION, GRUPOS_SANGUINEOS, PARENTESCOS, SIN_DATO,
  agruparPersonal, antiguedad, cantidadHijos, filtrarPersonal, labelEstadoCivil, labelGenero,
  labelGradoInstruccion, labelParentesco, numeroFicha, porDepartamento, textoEdad, tieneHijos,
  MIN_FICHA, errorNumeroFicha, normalizarNumeroFicha, ordenarPorFicha, errorCorreo,
  type Agrupador, type EstadoFiltro, type FiltroPersonal, type Genero, type HijosFiltro,
  type Parentesco,
} from './fichaPersonal';
import {
  listCargaFamiliar, listCargaFamiliarDeTodos, agregarFamiliar, actualizarFamiliar, eliminarFamiliar,
  type FamiliarPersonal, type FamiliarInput,
} from './personal.repository';
import { verFichaTecnicaPdf } from './fichaTecnicaPdf';
import {
  TIPOS_CAMBIO_SUELDO, huboCambioSueldo, labelTipoCambio, textoVariacion, tipoSugerido,
  validarCambioSueldo, variacionSueldo, type TipoCambioSueldo,
} from './cambioSueldo';
import { listHistoricoPersona } from './nomina.repository';
import { listCargos, listDepartamentos, addCargo, addDepartamento } from './catalogos';
import {
  generarFrenteBlob, generarReversoBlob, descargarFrente, descargarReverso,
  type TemaCarnet,
} from './carnetImagen';
import { descargarConstanciaTrabajoPdf } from './constanciaTrabajoPdf';

const VACIO: PersonalInput = { nombre: '', apellido: '', numero_ficha: '', cedula: '', rif: '', cargo: '', departamento: '', sueldo_base: 0, fecha_ingreso: '', telefono: '', correo: '', contacto_emergencia: '', contacto_emergencia_tlf: '', contacto_emergencia_parentesco: '', genero: '', estado_civil: '', fecha_nacimiento: '', grupo_sanguineo: '', grado_instruccion: '', tiene_alergias: null, alergias_detalle: '', tiene_enfermedad: null, enfermedad_detalle: '', nacionalidad: 'VENEZOLANO', direccion: '', foto_url: '', foto_pos_x: 0.5, foto_pos_y: 0.5, foto_zoom: 1 };

/**
 * La ficha guardada → el formulario.
 *
 * El tipo de retorno es \`Required<PersonalInput>\` A PROPÓSITO: obliga a que
 * estén TODOS los campos. Si mañana se agrega uno al formulario y se olvida
 * acá, el proyecto no compila.
 *
 * Sin esa guarda pasó esto: se agregaron género, estado civil, fecha de
 * nacimiento, grupo sanguíneo, nacionalidad, dirección y parentesco, pero
 * \`editar()\` no los cargaba. Llegaban vacíos al guardar y el dato se BORRABA
 * al editar cualquier otra cosa de la persona.
 */
function formDePersona(p: Personal, empresa: Empresa): Required<PersonalInput> {
  return {
    empresa,
    nombre: p.nombre,
    apellido: p.apellido ?? '',
    numero_ficha: p.numero_ficha ?? '',
    cedula: p.cedula ?? '',
    rif: p.rif ?? '',
    cargo: p.cargo ?? '',
    departamento: p.departamento ?? '',
    genero: p.genero ?? '',
    estado_civil: p.estado_civil ?? '',
    fecha_nacimiento: p.fecha_nacimiento ?? '',
    grupo_sanguineo: p.grupo_sanguineo ?? '',
    grado_instruccion: p.grado_instruccion ?? '',
    tiene_alergias: p.tiene_alergias ?? null,
    alergias_detalle: p.alergias_detalle ?? '',
    tiene_enfermedad: p.tiene_enfermedad ?? null,
    enfermedad_detalle: p.enfermedad_detalle ?? '',
    nacionalidad: p.nacionalidad ?? '',
    direccion: p.direccion ?? '',
    contacto_emergencia_parentesco: p.contacto_emergencia_parentesco ?? '',
    sueldo_base: Number(p.sueldo_base) || 0,
    fecha_ingreso: p.fecha_ingreso ?? '',
    telefono: p.telefono ?? '',
    correo: p.correo ?? '',
    contacto_emergencia: p.contacto_emergencia ?? '',
    contacto_emergencia_tlf: p.contacto_emergencia_tlf ?? '',
    foto_url: p.foto_url ?? '',
    foto_pos_x: p.foto_pos_x == null ? 0.5 : Number(p.foto_pos_x),
    foto_pos_y: p.foto_pos_y == null ? 0.5 : Number(p.foto_pos_y),
    foto_zoom: p.foto_zoom == null ? 1 : Number(p.foto_zoom),
  };
}

/** Un familiar mientras se edita el formulario. Sin \`id\` = todavía no está guardado. */
interface FamiliarUI {
  id?: string;
  nombre: string;
  parentesco: Parentesco;
  fechaNacimiento: string;
  genero: '' | Genero;
  observacion: string;
}
const FAMILIAR_VACIO: FamiliarUI = { nombre: '', parentesco: 'hijo', fechaNacimiento: '', genero: '', observacion: '' };

/** Limita la cédula a formato venezolano: prefijo opcional (V/E/J/G/P) + hasta 8 dígitos. */
function sanitizarCedula(v: string): string {
  const limpio = (v || '').toUpperCase().replace(/[^VEJGP0-9]/g, '');
  const letra = /^[VEJGP]/.test(limpio) ? limpio[0] : '';
  const digitos = limpio.replace(/[^0-9]/g, '').slice(0, 8);
  return letra && digitos ? `${letra}-${digitos}` : letra + digitos;
}

/** RIF venezolano: letra + hasta 8 dígitos + dígito verificador (V-12345678-9). */
function sanitizarRif(v: string): string {
  const limpio = (v || '').toUpperCase().replace(/[^VEJGP0-9]/g, '');
  const letra = /^[VEJGP]/.test(limpio) ? limpio[0] : '';
  const digitos = limpio.replace(/[^0-9]/g, '').slice(0, 9);
  if (!letra && !digitos) return '';
  const cuerpo = digitos.slice(0, 8);
  const verificador = digitos.slice(8, 9);
  return [letra || '', cuerpo, verificador].filter(Boolean).join('-');
}

/**
 * Una pregunta de salud: Sí / No / Sin responder, y el detalle cuando la
 * respuesta es «Sí».
 *
 * «Sin responder» es un botón y no la ausencia de los otros dos: hace falta
 * poder VOLVER a dejarlo sin contestar si alguien marcó mal, y hace falta que
 * en pantalla se distinga de un «No». En una emergencia no es lo mismo «no
 * tiene alergias» que «nadie se lo preguntó nunca».
 *
 * El detalle solo aparece con «Sí». Al cambiar la respuesta se limpia solo,
 * porque el detalle viejo seguiría saliendo en el QR del carnet.
 */
function PreguntaSalud({ pregunta, respuesta, onRespuesta, detalle, onDetalle, ayuda }: {
  pregunta: string;
  respuesta: RespuestaSalud;
  onRespuesta: (v: RespuestaSalud) => void;
  detalle: string;
  onDetalle: (v: string) => void;
  ayuda: string;
}) {
  const opciones: { v: RespuestaSalud; label: string }[] = [
    { v: true, label: 'Sí' }, { v: false, label: 'No' }, { v: null, label: 'Sin responder' },
  ];
  return (
    <div style={{ marginBottom: '.7rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.5rem' }}>
        <strong style={{ fontSize: '.88rem' }}>{pregunta}</strong>
        <div style={{ display: 'flex', gap: '.3rem' }}>
          {opciones.map((o) => (
            <button
              key={String(o.v)} type="button"
              className={`btn btn-sm ${respuesta === o.v ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={respuesta === o.v}
              onClick={() => onRespuesta(o.v)}
            >{o.label}</button>
          ))}
        </div>
      </div>
      {respuesta === true && (
        <div className="form-row" style={{ margin: '.35rem 0 0' }}>
          <input
            className="input" value={detalle} maxLength={MAX_DETALLE_SALUD}
            onChange={(e) => onDetalle(e.target.value)}
            placeholder={ayuda} autoComplete="off"
          />
          <small className="muted">{ayuda} · Un «Sí» sin decir a qué no le sirve a quien lo atienda.</small>
        </div>
      )}
    </div>
  );
}

/**
 * Encuadre de la foto del carnet: muestra la imagen dentro de un marco con la MISMA
 * proporción que el carnet (260×300) y deja al usuario ARRASTRARLA para centrar la cara,
 * más un zoom. La posición (0..1) y el zoom se guardan y el carnet los respeta idénticos.
 */
function FotoEncuadre({ url, posX, posY, zoom, onChange }: {
  url: string; posX: number; posY: number; zoom: number;
  onChange: (v: { foto_pos_x: number; foto_pos_y: number; foto_zoom: number }) => void;
}) {
  const BOX_W = 191, BOX_H = 220;   // proporción del carnet: 260×300
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  useEffect(() => {
    let vivo = true; const im = new Image();
    im.onload = () => { if (vivo) setNat({ w: im.naturalWidth || 1, h: im.naturalHeight || 1 }); };
    im.onerror = () => { if (vivo) setNat(null); };
    im.src = url;
    return () => { vivo = false; };
  }, [url]);

  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  const z = Math.min(4, Math.max(1, zoom));
  const base = nat ? Math.max(BOX_W / nat.w, BOX_H / nat.h) : 1;
  const scale = base * z;
  const dispW = nat ? nat.w * scale : BOX_W;
  const dispH = nat ? nat.h * scale : BOX_H;
  const overX = Math.max(0, dispW - BOX_W);
  const overY = Math.max(0, dispH - BOX_H);
  const left = -overX * clamp01(posX);
  const top = -overY * clamp01(posY);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: posX, py: posY };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    const nx = overX > 0 ? clamp01(drag.current.px - dx / overX) : 0.5;
    const ny = overY > 0 ? clamp01(drag.current.py - dy / overY) : 0.5;
    onChange({ foto_pos_x: nx, foto_pos_y: ny, foto_zoom: z });
  };
  const onUp = () => { drag.current = null; };

  return (
    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
        style={{ width: BOX_W, height: BOX_H, borderRadius: 12, border: '3px solid var(--primary)', overflow: 'hidden', position: 'relative', cursor: 'grab', touchAction: 'none', background: 'var(--bg-1)', flexShrink: 0 }}
        title="Arrastrá para mover la foto dentro del marco">
        {nat
          ? <img src={url} alt="Encuadre" draggable={false} style={{ position: 'absolute', left, top, width: dispW, height: dispH, maxWidth: 'none', userSelect: 'none', pointerEvents: 'none' }} />
          : <div className="muted" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.8rem' }}>Cargando…</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', minWidth: 180, flex: '1 1 180px' }}>
        <small className="muted">Arrastrá la foto para <strong>centrar la cara</strong> en el marco (proporción real del carnet). Así queda en el carnet.</small>
        <label style={{ fontSize: '.82rem' }}>Zoom <span className="mono muted">{z.toFixed(2)}×</span>
          <input type="range" min={1} max={4} step={0.01} value={z}
            onChange={(e) => onChange({ foto_pos_x: posX, foto_pos_y: posY, foto_zoom: Number(e.target.value) })}
            style={{ width: '100%' }} />
        </label>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange({ foto_pos_x: 0.5, foto_pos_y: 0.5, foto_zoom: 1 })}>↺ Centrar / restablecer</button>
      </div>
    </div>
  );
}

export function PersonalTab({ canWrite, actor, actorName, empresa = EMPRESA_POR_DEFECTO }: {
  canWrite: boolean; actor: string; actorName?: string | null; empresa?: Empresa;
}) {
  const { isAdmin } = usePermissions();
  const [lista, setLista] = useState<Personal[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PersonalInput>(VACIO);
  const [guardando, setGuardando] = useState(false);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* La ficha se traba una vez asignada. Queda abierta al crear, cuando la ficha
     vieja no tiene número, y siempre para un administrador. */
  const fichaTrabada = !!editId && !!(form.numero_ficha ?? '').trim() && !isAdmin;
  const [histPersona, setHistPersona] = useState<Personal | null>(null);
  const [sueldoPersona, setSueldoPersona] = useState<Personal | null>(null);
  const [docsPersona, setDocsPersona] = useState<Personal | null>(null);
  // Los papeles de todo el personal, para poder marcar en el listado quién los
  // tiene completos sin pedir uno por uno.
  const [docsPorPersona, setDocsPorPersona] = useState<Map<string, DocumentoPersonal[]>>(new Map());
  // La carga familiar de todo el personal: sin esto no se puede filtrar ni
  // agrupar por «con hijos» sin preguntar persona por persona.
  const [familiaPorPersona, setFamiliaPorPersona] = useState<Map<string, FamiliarPersonal[]>>(new Map());
  const [fichaPersona, setFichaPersona] = useState<Personal | null>(null);
  // La familia que se está editando en el formulario. Se guarda al guardar la
  // ficha, para que al crear a alguien se pueda cargar todo de una vez.
  const [familiaForm, setFamiliaForm] = useState<FamiliarUI[]>([]);
  const [familiaBorrada, setFamiliaBorrada] = useState<string[]>([]);

  /* Filtros y agrupación del listado. */
  const [fTexto, setFTexto] = useState('');
  const [fDepto, setFDepto] = useState('');
  const [fCargo, setFCargo] = useState('');
  const [fGenero, setFGenero] = useState('');
  const [fCivil, setFCivil] = useState('');
  const [fEstado, setFEstado] = useState<EstadoFiltro>('todos');
  const [fHijos, setFHijos] = useState<HijosFiltro>('');
  const [fEdadDesde, setFEdadDesde] = useState('');
  const [fEdadHasta, setFEdadHasta] = useState('');
  const [agrupar, setAgrupar] = useState<Agrupador>('');
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  // El sueldo con el que se abrió la ficha: contra esto se compara para saber
  // si hubo cambio. No se compara contra la lista, que puede recargarse sola.
  const [sueldoOriginal, setSueldoOriginal] = useState(0);
  const [motivoSueldo, setMotivoSueldo] = useState('');
  const [tipoSueldo, setTipoSueldo] = useState<TipoCambioSueldo>('aumento');
  const [vigenteDesde, setVigenteDesde] = useState('');
  const [carnetPersona, setCarnetPersona] = useState<Personal | null>(null);
  const [constanciaPersona, setConstanciaPersona] = useState<Personal | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [cargos, setCargos] = useState<string[]>([]);
  const [departamentos, setDepartamentos] = useState<string[]>([]);

  // ¿La cédula que se está escribiendo ya es de otra ficha? Se resuelve contra la
  // lista que la pestaña ya tiene cargada: no hace falta ir a la base para avisar.
  // Ojo: esta lista es SOLO de la empresa que se está mirando. La guarda real
  // contra las dos nóminas la hace el repositorio antes de guardar.
  const duenoCedula = useMemo(() => {
    const d = digitosCedula(form.cedula);
    if (!d) return null;
    return lista.find((p) => digitosCedula(p.cedula) === d && p.id !== editId) ?? null;
  }, [form.cedula, lista, editId]);

  const recargar = useCallback(async () => {
    setLoading(true);
    try {
      // En paralelo: los papeles no deben hacer esperar al listado.
      const [gente, docs, familia] = await Promise.all([
        listPersonal(false, empresa),
        listDocumentosDeTodos().catch(() => [] as DocumentoPersonal[]),
        listCargaFamiliarDeTodos().catch(() => [] as FamiliarPersonal[]),
      ]);
      setLista(gente);
      const mapa = new Map<string, DocumentoPersonal[]>();
      for (const d of docs) mapa.set(d.personalId, [...(mapa.get(d.personalId) ?? []), d]);
      setDocsPorPersona(mapa);
      const fam = new Map<string, FamiliarPersonal[]>();
      for (const x of familia) fam.set(x.personalId, [...(fam.get(x.personalId) ?? []), x]);
      setFamiliaPorPersona(fam);
    }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar el personal', 'error'); }
    finally { setLoading(false); }
  }, [empresa]);
  const cargarCatalogos = useCallback(() => {
    listCargos().then(setCargos).catch(() => { /* catálogo opcional */ });
    listDepartamentos().then(setDepartamentos).catch(() => { /* catálogo opcional */ });
  }, []);
  useEffect(() => { void recargar(); }, [recargar]);
  useEffect(() => { cargarCatalogos(); }, [cargarCatalogos]);
  useRealtime(['personal', 'personal_sueldos', 'personal_documentos', 'personal_carga_familiar'], () => { void recargar(); });

  /* ── Lo que se ve: filtrado y agrupado ── */
  const tieneHijosDe = useCallback(
    (id: string) => tieneHijos(familiaPorPersona.get(id) ?? []),
    [familiaPorPersona],
  );

  const filtro: FiltroPersonal = useMemo(() => ({
    texto: fTexto, departamento: fDepto, cargo: fCargo, genero: fGenero,
    estadoCivil: fCivil, estado: fEstado, hijos: fHijos,
    edadDesde: fEdadDesde ? Number(fEdadDesde) : null,
    edadHasta: fEdadHasta ? Number(fEdadHasta) : null,
  }), [fTexto, fDepto, fCargo, fGenero, fCivil, fEstado, fHijos, fEdadDesde, fEdadHasta]);

  // El listado va por N° DE FICHA, que es como se lee una nómina en papel: se
  // busca «el 014», no «el que está entre Díaz y Gil». El orden alfabético que
  // traía la consulta se conserva solo dentro de los que aún no tienen ficha.
  const visibles = useMemo(
    () => ordenarPorFicha(filtrarPersonal(lista, filtro, tieneHijosDe)),
    [lista, filtro, tieneHijosDe],
  );
  const grupos = useMemo(() => agruparPersonal(visibles, agrupar, tieneHijosDe), [visibles, agrupar, tieneHijosDe]);
  const deptos = useMemo(() => porDepartamento(visibles), [visibles]);

  /**
   * La lista sobre la que cuentan las tarjetas: achicada por todo lo que NO es
   * una tarjeta (la búsqueda, el departamento, el cargo, la edad). Lo de las
   * tarjetas se aplica después, tarjeta por tarjeta, en `contarTarjeta`.
   */
  const baseTarjetas = useMemo(() => filtrarPersonal(lista, {
    texto: fTexto, departamento: fDepto, cargo: fCargo,
    edadDesde: fEdadDesde ? Number(fEdadDesde) : null,
    edadHasta: fEdadHasta ? Number(fEdadHasta) : null,
  }, tieneHijosDe), [lista, fTexto, fDepto, fCargo, fEdadDesde, fEdadHasta, tieneHijosDe]);

  const hayFiltro = !!(fTexto || fDepto || fCargo || fGenero || fCivil || fHijos || fEdadDesde || fEdadHasta || fEstado !== 'todos');
  function limpiarFiltros() {
    setFTexto(''); setFDepto(''); setFCargo(''); setFGenero(''); setFCivil('');
    setFEstado('todos'); setFHijos(''); setFEdadDesde(''); setFEdadHasta('');
  }

  /* ── Las tarjetas como filtro ──
     SE COMBINAN: mujeres + con hijos + activos se van sumando y cada una acota
     más la tabla. Tocar una que ya está puesta la apaga.

     Dos tarjetas del MISMO campo no pueden convivir —nadie es hombre y mujer a
     la vez, ni activo e inactivo—, así que ahí la nueva reemplaza a la
     anterior en vez de dar una tabla vacía. */
  const CAMPOS_TARJETA = ['genero', 'estadoCivil', 'estado', 'hijos'] as const;
  type CampoTarjeta = typeof CAMPOS_TARJETA[number];

  /** Qué valor significa «este campo no filtra». `estado` usa 'todos', no ''. */
  const NEUTRO: Record<CampoTarjeta, string> = { genero: '', estadoCivil: '', estado: 'todos', hijos: '' };
  const puesto: Record<CampoTarjeta, string> = { genero: fGenero, estadoCivil: fCivil, estado: fEstado, hijos: fHijos };

  function ponerTarjeta(campo: CampoTarjeta, valor: string) {
    if (campo === 'genero') setFGenero(valor);
    else if (campo === 'estadoCivil') setFCivil(valor);
    else if (campo === 'estado') setFEstado(valor as EstadoFiltro);
    else setFHijos(valor as HijosFiltro);
  }

  function limpiarTarjetas() {
    setFGenero(''); setFCivil(''); setFEstado('todos'); setFHijos('');
  }
  const sinFiltroDeTarjeta = CAMPOS_TARJETA.every((c) => puesto[c] === NEUTRO[c]);

  /** Tocar una tarjeta: la pone si estaba apagada, la apaga si ya estaba. */
  function alternarTarjeta(campo: CampoTarjeta, valor: string) {
    ponerTarjeta(campo, puesto[campo] === valor ? NEUTRO[campo] : valor);
  }

  /**
   * El número de una tarjeta = cuánta gente quedaría si se tocara AHORA.
   *
   * Se aplican las demás tarjetas puestas —por eso «Mujeres» baja cuando se
   * pone «Con hijos»— pero NO la del propio campo: si «Hombres» se contara con
   * «Mujeres» puesta diría 0, y no habría forma de pasar de una a la otra.
   */
  function contarTarjeta(campo: CampoTarjeta, valor: string): number {
    const f = { ...puesto, [campo]: valor };
    return filtrarPersonal(baseTarjetas, {
      genero: f.genero, estadoCivil: f.estadoCivil,
      estado: f.estado as EstadoFiltro, hijos: f.hijos as HijosFiltro,
    }, tieneHijosDe).length;
  }

  const totalBase = baseTarjetas.length;
  const pct = (n: number) => (totalBase ? `${Math.round((n / totalBase) * 100)}% del total` : '—');

  const TARJETAS: Array<{
    campo: CampoTarjeta; valor: string; titulo: string; icono: string;
    color?: string; pie: (n: number) => string;
  }> = [
    { campo: 'genero', valor: 'masculino', titulo: 'Hombres', icono: '👨', color: '#3b82f6', pie: pct },
    { campo: 'genero', valor: 'femenino', titulo: 'Mujeres', icono: '👩', color: '#ec4899', pie: pct },
    { campo: 'estado', valor: 'activos', titulo: 'Activos', icono: '✅', color: 'var(--success)', pie: () => 'Trabajando hoy' },
    { campo: 'estado', valor: 'inactivos', titulo: 'Inactivos', icono: '⏸', pie: () => 'Dados de baja' },
    { campo: 'hijos', valor: 'con', titulo: 'Con hijos', icono: '👨‍👩‍👧', color: 'var(--success)', pie: () => 'Con carga familiar' },
    { campo: 'estadoCivil', valor: 'soltero', titulo: 'Solteros', icono: '🙋', pie: () => 'Según el estado civil' },
    // Sin género no suma ni en Hombres ni en Mujeres: la tarjeta está para
    // poder ir a completar justo esas fichas.
    { campo: 'genero', valor: SIN_DATO, titulo: 'Sin género cargado', icono: '⚠', color: 'var(--warning)', pie: () => 'No suman en Hombres ni Mujeres' },
  ];
  const tarjetasPuestas = TARJETAS.filter((t) => puesto[t.campo] === t.valor);

  /**
   * Parentescos para el contacto de emergencia: el catálogo de siempre más
   * los que alguien ya escribió a mano. Así el que se agrega una vez queda
   * disponible la próxima, sin tener que mantener una lista aparte.
   */
  const parentescosContacto = useMemo(() => {
    const usados = lista.map((p) => (p.contacto_emergencia_parentesco ?? '').trim()).filter(Boolean);
    const base = PARENTESCOS.map((p) => p.label);
    const extras = ['Esposo/a', 'Tío/a', 'Abuelo/a', 'Primo/a', 'Amigo/a', 'Vecino/a'];
    const todos = [...new Set([...base, ...extras, ...usados])];
    return todos
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map((x) => ({ value: x, label: x }));
  }, [lista]);

  /**
   * Nacionalidades: las de la región más las que ya se cargaron. Igual que el
   * parentesco, la que alguien escriba una vez queda para la próxima.
   */
  const nacionalidades = useMemo(() => {
    const usadas = lista.map((p) => (p.nacionalidad ?? '').trim()).filter(Boolean);
    const base = ['VENEZOLANO', 'VENEZOLANA', 'COLOMBIANO', 'COLOMBIANA', 'BRASILEÑO', 'BRASILEÑA',
      'ECUATORIANO', 'ECUATORIANA', 'PERUANO', 'PERUANA', 'ARGENTINO', 'ARGENTINA',
      'CHILENO', 'CHILENA', 'ESPAÑOL', 'ESPAÑOLA', 'PORTUGUÉS', 'PORTUGUESA',
      'CHINO', 'CHINA', 'ITALIANO', 'ITALIANA', 'EXTRANJERO'];
    return [...new Set([...base, ...usadas.map((x) => x.toUpperCase())])]
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map((x) => ({ value: x, label: x }));
  }, [lista]);

  /** Los valores que existen de verdad, para no ofrecer filtros vacíos. */
  const deptosUsados = useMemo(
    () => [...new Set(lista.map((p) => p.departamento || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')),
    [lista]);
  const cargosUsados = useMemo(
    () => [...new Set(lista.map((p) => p.cargo || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')),
    [lista]);

  /** Deja el bloque del cambio de sueldo en blanco. */
  function limpiarCambioSueldo(base: number) {
    setSueldoOriginal(base);
    setMotivoSueldo('');
    setTipoSueldo('aumento');
    setVigenteDesde(new Date().toISOString().slice(0, 10));
  }

  // La ficha nueva nace en la empresa que se está mirando. No es un campo del
  // formulario a propósito: quién pertenece a cada nómina lo decide el
  // interruptor de arriba, y así no se puede elegir mal sin darse cuenta.
  /** Abre la hoja de ingreso en blanco, en vista previa. */
  const [hojaAbriendo, setHojaAbriendo] = useState(false);
  async function hojaIngreso() {
    if (hojaAbriendo) return;
    setHojaAbriendo(true);
    try {
      const { verHojaIngresoPdf } = await import('./hojaIngresoPdf');
      await verHojaIngresoPdf(empresa);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar la hoja de ingreso', 'error');
    } finally { setHojaAbriendo(false); }
  }

  function abrirNuevo() {
    setEditId(null); setForm({ ...VACIO, empresa }); limpiarCambioSueldo(0);
    setFamiliaForm([]); setFamiliaBorrada([]);
    setError(null); setFormOpen(true);
  }
  function editar(p: Personal) {
    setEditId(p.id);
    setForm(formDePersona(p, empresa));
    limpiarCambioSueldo(Number(p.sueldo_base) || 0);
    setFamiliaBorrada([]);
    setFamiliaForm((familiaPorPersona.get(p.id) ?? []).map((x) => ({
      id: x.id, nombre: x.nombre, parentesco: x.parentesco,
      fechaNacimiento: x.fechaNacimiento ?? '', genero: x.genero ?? '', observacion: x.observacion ?? '',
    })));
    setError(null); setFormOpen(true);
  }
  function cerrarForm() {
    setEditId(null); setForm({ ...VACIO, empresa }); limpiarCambioSueldo(0);
    setFamiliaForm([]); setFamiliaBorrada([]);
    setError(null); setFormOpen(false);
  }

  /* ── La carga familiar del formulario ── */
  function agregarFila() { setFamiliaForm((f) => [...f, { ...FAMILIAR_VACIO }]); }
  function cambiarFila(i: number, patch: Partial<FamiliarUI>) {
    setFamiliaForm((f) => f.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  }
  function quitarFila(i: number) {
    setFamiliaForm((f) => {
      const fila = f[i];
      // Si ya estaba guardada, hay que borrarla de la base al guardar.
      if (fila?.id) setFamiliaBorrada((b) => [...b, fila.id as string]);
      return f.filter((_, k) => k !== i);
    });
  }

  /** Guarda la familia del formulario contra la base. */
  async function guardarFamilia(personalId: string) {
    for (const id of familiaBorrada) await eliminarFamiliar(id).catch(() => { /* ya no estaba */ });
    for (const fam of familiaForm) {
      const nombre = fam.nombre.trim();
      if (!nombre) continue;   // una fila vacía que quedó abierta no es un familiar
      const input: FamiliarInput = {
        nombre, parentesco: fam.parentesco,
        fechaNacimiento: fam.fechaNacimiento || null,
        genero: fam.genero || null,
        observacion: fam.observacion || null,
      };
      if (fam.id) await actualizarFamiliar(fam.id, input);
      else await agregarFamiliar(personalId, input, actor);
    }
  }

  async function onPickFoto(file: File | null) {
    if (!file) return;
    setSubiendoFoto(true); setError(null);
    try {
      const url = await subirFotoCarnet(file);
      // Nueva foto → arranca centrada y sin zoom (el usuario la reencuadra si quiere).
      setForm((f) => ({ ...f, foto_url: url, foto_pos_x: 0.5, foto_pos_y: 0.5, foto_zoom: 1 }));
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo subir la foto'); }
    finally { setSubiendoFoto(false); }
  }
  function quitarFoto() { setForm((f) => ({ ...f, foto_url: '', foto_pos_x: 0.5, foto_pos_y: 0.5, foto_zoom: 1 })); }

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!form.nombre.trim()) { setError('Indicá el nombre.'); return; }
    const malaFicha = errorNumeroFicha(form.numero_ficha);
    if (malaFicha) { setError(malaFicha); return; }
    // Dos personas con la misma ficha es peor que ninguna: se revisa acá para dar
    // el nombre de quién la tiene, y la base lo garantiza con un índice único.
    const ficha = normalizarNumeroFicha(form.numero_ficha);
    if (ficha) {
      const otro = lista.find((p) => p.id !== editId && normalizarNumeroFicha(p.numero_ficha) === ficha);
      if (otro) {
        setError(`La ficha ${ficha} ya es de ${otro.nombre} ${otro.apellido ?? ''}. No puede haber dos personas con la misma ficha.`);
        return;
      }
    }
    if (duenoCedula) {
      setError(`La cédula ${form.cedula} ya es de ${duenoCedula.nombre} ${duenoCedula.apellido ?? ''}. No puede haber dos fichas con la misma cédula.`);
      return;
    }
    // La base rechaza un correo mal formado; mejor decirlo acá que mostrar el
    // error de Postgres. A diferencia de la ficha, repetido SÍ se acepta.
    const malCorreo = errorCorreo(form.correo);
    if (malCorreo) { setError(malCorreo); return; }
    // Decir «si tiene alergia» sin decir a cual no sirve: en una urgencia el
    // que lee el carnet necesita el nombre del alergeno, no el aviso.
    const malSalud = errorCondicionesSalud(form);
    if (malSalud) { setError(malSalud); return; }
    // El sueldo no se pisa en silencio: si cambió, hay que decir por qué.
    if (editId) {
      const falla = validarCambioSueldo({ anterior: sueldoOriginal, nuevo: form.sueldo_base, motivo: motivoSueldo, vigenteDesde });
      if (falla) { setError(falla); return; }
    }
    setGuardando(true);
    try {
      let personaId = editId;
      if (editId) {
        await actualizarPersonal(editId, form, {
          motivo: motivoSueldo, tipo: tipoSueldo, vigenteDesde,
          actor, actorName: actorName ?? null,
        });
      } else {
        // Al crear, la familia se guarda con el id recién asignado: así se
        // puede cargar todo de una sola vez, en el mismo formulario.
        personaId = (await crearPersonal(form, actor)).id;
      }
      if (personaId) await guardarFamilia(personaId);
      // Si el cargo/departamento es nuevo, lo agregamos al catálogo compartido.
      const cargo = (form.cargo ?? '').trim();
      const depto = (form.departamento ?? '').trim();
      if (cargo && !cargos.includes(cargo)) await addCargo(cargo, actor).catch(() => {});
      if (depto && !departamentos.includes(depto)) await addDepartamento(depto, actor).catch(() => {});
      cargarCatalogos();
      toast(editId ? 'Personal actualizado' : 'Personal agregado', 'success');
      cerrarForm();
      await recargar();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); }
    finally { setGuardando(false); }
  }

  async function toggleActivo(p: Personal) {
    try { await setPersonalActivo(p.id, !p.activo); await recargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cambiar', 'error'); }
  }
  // El cartel del navegador se reemplaza por el diálogo del sistema.
  const [porBorrar, setPorBorrar] = useState<Personal | null>(null);
  async function confirmarBorrado() {
    if (!porBorrar) return;
    try { await eliminarPersonal(porBorrar.id); setPorBorrar(null); await recargar(); toast('Eliminado', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); setPorBorrar(null); }
  }

  return (
    <div>
      {canWrite && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.75rem' }}>
          {/* La hoja en blanco es para ANTES de que exista la ficha: se imprime,
              la llena la persona que entra y con eso se carga el registro. */}
          <button className="btn btn-ghost" onClick={() => void hojaIngreso()} disabled={hojaAbriendo}
            title="Formulario en blanco para imprimir y que lo llene quien ingresa">
            {hojaAbriendo ? 'Generando…' : '🖨 Hoja de ingreso (en blanco)'}
          </button>
          <button className="btn btn-primary" onClick={abrirNuevo}>+ Ingresar Registro de Personal</button>
        </div>
      )}

      {/* Las tarjetas se tocan y filtran, y SE COMBINAN entre sí. La primera es
          el «todos»: apaga las demás. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.7rem', marginBottom: '.5rem' }}>
        <Tarjeta titulo="Personal" icono="👥" valor={totalBase}
          pie={sinFiltroDeTarjeta ? 'Sin filtros puestos' : 'Tocá para ver a todos'}
          activa={sinFiltroDeTarjeta} onClick={limpiarTarjetas} />
        {TARJETAS.map((t) => {
          const n = contarTarjeta(t.campo, t.valor);
          return (
            <Tarjeta key={t.titulo} titulo={t.titulo} icono={t.icono} valor={n} color={t.color}
              pie={t.pie(n)} activa={puesto[t.campo] === t.valor}
              onClick={() => alternarTarjeta(t.campo, t.valor)} />
          );
        })}
      </div>

      {/* Qué tarjetas están puestas y cómo sacarlas. Con varias combinadas hace
          falta verlo escrito: si no, un número raro en la tabla parece un error
          del sistema en vez de un filtro que quedó prendido. */}
      {tarjetasPuestas.length > 0 && (
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.75rem' }}>
          <span className="muted" style={{ fontSize: '.78rem' }}>Filtrando por:</span>
          {tarjetasPuestas.map((t) => (
            <button key={t.titulo} className="btn btn-sm"
              onClick={() => alternarTarjeta(t.campo, NEUTRO[t.campo])}
              title={`Quitar «${t.titulo}»`}
              style={{ background: t.color ?? 'var(--primary, #ff8a00)', color: '#fff', border: 'none' }}>
              {t.icono} {t.titulo} ✕
            </button>
          ))}
          <button className="btn btn-sm btn-ghost" onClick={limpiarTarjetas}>✕ Quitar todos</button>
        </div>
      )}

      {/* Cuánta gente hay en cada departamento */}
      {deptos.length > 1 && (
        <div className="card" style={{ marginBottom: '.75rem', padding: '.6rem .75rem' }}>
          <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: '.4rem' }}>Por departamento</div>
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
            {deptos.map((d) => (
              <button key={d.nombre} className="btn btn-sm"
                onClick={() => setFDepto(fDepto === d.nombre ? '' : (d.nombre === 'Sin departamento' ? '' : d.nombre))}
                disabled={d.nombre === 'Sin departamento'}
                style={{
                  border: `1px solid ${fDepto === d.nombre ? 'var(--primary)' : 'var(--border)'}`,
                  background: fDepto === d.nombre ? 'var(--primary)' : 'transparent',
                  color: fDepto === d.nombre ? '#fff' : 'var(--text)',
                }}>
                {d.nombre} <strong>{d.cantidad}</strong>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="card" style={{ marginBottom: '.75rem' }}>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-row" style={{ margin: 0, flex: '1 1 220px' }}>
            <label>Buscar</label>
            <input className="input" value={fTexto} onChange={(e) => setFTexto(e.target.value)}
              placeholder="Nombre, cédula, cargo o departamento…" />
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            <label>Agrupar por</label>
            <select className="select" value={agrupar} onChange={(e) => setAgrupar(e.target.value as Agrupador)}>
              {AGRUPADORES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </div>
          <button className="btn btn-ghost" onClick={() => setFiltrosAbiertos((v) => !v)}>
            {filtrosAbiertos ? '▲ Menos filtros' : '▼ Más filtros'}
          </button>
          {hayFiltro && <button className="btn btn-ghost" onClick={limpiarFiltros}>✕ Limpiar</button>}
          <span className="muted" style={{ fontSize: '.8rem', marginLeft: 'auto' }}>
            {visibles.length} de {lista.length}
          </span>
        </div>

        {filtrosAbiertos && (
          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginTop: '.6rem' }}>
            <div className="form-row" style={{ margin: 0, flex: '1 1 150px' }}>
              <label>Departamento</label>
              <select className="select" value={fDepto} onChange={(e) => setFDepto(e.target.value)}>
                <option value="">Todos</option>
                {deptosUsados.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-row" style={{ margin: 0, flex: '1 1 150px' }}>
              <label>Cargo</label>
              <select className="select" value={fCargo} onChange={(e) => setFCargo(e.target.value)}>
                <option value="">Todos</option>
                {cargosUsados.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-row" style={{ margin: 0, flex: '0 1 130px' }}>
              <label>Género</label>
              {/* La opción «sin cargar» tiene que existir acá también: si no,
                  al tocar esa tarjeta el select se queda en blanco —el valor
                  no coincide con ninguna opción— y el filtro puesto no se ve. */}
              <select className="select" value={fGenero} onChange={(e) => setFGenero(e.target.value)}>
                <option value="">Todos</option>
                {GENEROS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                <option value={SIN_DATO}>Sin cargar</option>
              </select>
            </div>
            <div className="form-row" style={{ margin: 0, flex: '0 1 140px' }}>
              <label>Estado civil</label>
              <select className="select" value={fCivil} onChange={(e) => setFCivil(e.target.value)}>
                <option value="">Todos</option>
                {ESTADOS_CIVILES.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
                <option value={SIN_DATO}>Sin cargar</option>
              </select>
            </div>
            <div className="form-row" style={{ margin: 0, flex: '0 1 130px' }}>
              <label>Hijos</label>
              <select className="select" value={fHijos} onChange={(e) => setFHijos(e.target.value as HijosFiltro)}>
                <option value="">Todos</option>
                <option value="con">Con hijos</option>
                <option value="sin">Sin hijos</option>
              </select>
            </div>
            <div className="form-row" style={{ margin: 0, flex: '0 1 130px' }}>
              <label>Estado</label>
              <select className="select" value={fEstado} onChange={(e) => setFEstado(e.target.value as EstadoFiltro)}>
                <option value="todos">Todos</option>
                <option value="activos">Activos</option>
                <option value="inactivos">Inactivos</option>
              </select>
            </div>
            <div className="form-row" style={{ margin: 0, flex: '0 1 100px' }}>
              <label>Edad desde</label>
              <input className="input mono" type="number" min={0} max={110} value={fEdadDesde}
                onChange={(e) => setFEdadDesde(e.target.value)} placeholder="—" />
            </div>
            <div className="form-row" style={{ margin: 0, flex: '0 1 100px' }}>
              <label>Edad hasta</label>
              <input className="input mono" type="number" min={0} max={110} value={fEdadHasta}
                onChange={(e) => setFEdadHasta(e.target.value)} placeholder="—" />
            </div>
          </div>
        )}
      </div>

      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>Persona</th><th>Departamento</th><th>Cargo</th><th style={{ textAlign: 'center' }}>Edad</th><th style={{ textAlign: 'center' }}>Familia</th><th style={{ textAlign: 'right' }}>Sueldo base</th><th style={{ textAlign: 'center' }}>Estado</th><th style={{ textAlign: 'center' }}>Acciones</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !lista.length && <tr><td colSpan={8}><EmptyState message="Sin personal. Usá “+ Ingresar Registro de Personal”." icon="👥" /></td></tr>}
            {!loading && lista.length > 0 && !visibles.length && (
              <tr><td colSpan={8}><EmptyState message="Ningún trabajador coincide con esos filtros" icon="🔍" /></td></tr>
            )}
            {!loading && grupos.map((g) => (
              <Fragment key={g.nombre || 'todos'}>
                {g.nombre && (
                  <tr>
                    <td colSpan={8} style={{ background: 'var(--bg-2)', fontWeight: 700, fontSize: '.82rem', padding: '.4rem .6rem' }}>
                      {g.nombre} <span className="muted" style={{ fontWeight: 400 }}>· {g.filas.length}</span>
                    </td>
                  </tr>
                )}
                {g.filas.map((p) => (
              <tr key={p.id} style={{ opacity: p.activo ? 1 : 0.55 }}>
                <td>
                  {/* El nombre abre la ficha: es lo que uno intenta tocar primero.
                      Quien no puede escribir la ve, no la edita. */}
                  <button type="button"
                    onClick={() => (canWrite ? editar(p) : setFichaPersona(p))}
                    title={canWrite ? 'Editar la ficha' : 'Ver la ficha técnica'}
                    style={{
                      background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit',
                      color: 'inherit', cursor: 'pointer', textAlign: 'left', textDecoration: 'underline',
                      textDecorationColor: 'var(--border)', textUnderlineOffset: '3px',
                    }}>
                    <strong>{p.nombre} {p.apellido}</strong>
                  </button>
                  {p.cedula ? <span className="muted"> · {p.cedula}</span> : null}
                  <div className="muted" style={{ fontSize: '.7rem' }}>
                    {numeroFicha(p.numero_ficha)}
                    {p.genero ? ` · ${labelGenero(p.genero)}` : ''}
                    {p.estado_civil ? ` · ${labelEstadoCivil(p.estado_civil)}` : ''}
                  </div>
                  {/* El RIF y el estado de los papeles, a la vista: es lo que se busca acá. */}
                  <div className="muted mono" style={{ fontSize: '.72rem', display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                    {p.rif ? <span>RIF {p.rif}</span> : null}
                    {(() => {
                      const docs = docsPorPersona.get(p.id) ?? [];
                      const completa = documentacionCompleta(docs);
                      return (
                        <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 .35rem', fontSize: '.72rem' }}
                          onClick={() => setDocsPersona(p)}
                          title={completa ? 'Documentación completa' : `Faltan papeles: ${resumenDocumentos(docs)}`}>
                          📁 <span style={{ color: completa ? 'var(--success)' : docs.length ? 'var(--warning)' : 'var(--muted)' }}>
                            {resumenDocumentos(docs)}
                          </span>
                        </button>
                      );
                    })()}
                  </div>
                </td>
                <td className="muted">{p.departamento || '—'}</td>
                {/* Un cargo vacío se avisa en vez de pasar como un guion mudo: sin él
                    el carnet sale con el departamento solo y nadie sabe por qué. */}
                <td className={p.cargo ? 'muted' : ''}>
                  {p.cargo || <span style={{ color: 'var(--warning)' }} title="Cargá el cargo: sale en el carnet y en la ficha técnica">Sin cargo</span>}
                </td>
                <td className="mono muted" style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{textoEdad(p.fecha_nacimiento)}</td>
                <td style={{ textAlign: 'center' }}>
                  {(() => {
                    const fam = familiaPorPersona.get(p.id) ?? [];
                    const hijos = cantidadHijos(fam);
                    if (!fam.length) return <span className="muted">—</span>;
                    return (
                      <span className="badge" title={`${fam.length} familiar(es) cargado(s)`}>
                        👨‍👩‍👧 {fam.length}{hijos ? ` · ${hijos} 🧒` : ''}
                      </span>
                    );
                  })()}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>{Number(p.sueldo_base) > 0 ? money(p.sueldo_base) : '—'}</td>
                <td style={{ textAlign: 'center' }}><span className="badge" style={{ color: p.activo ? 'var(--success)' : 'var(--muted)' }}>{p.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setFichaPersona(p)} title="Ficha técnica">📋</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setCarnetPersona(p)} title="Carnet (imagen con QR)">🪪</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setConstanciaPersona(p)} title="Constancia de trabajo (PDF)">📄</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setHistPersona(p)} title="Histórico de pagos">🧾</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setSueldoPersona(p)} title="Historial de sueldos: cuándo cambió y por qué">💵</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setDocsPersona(p)} title="Documentación: cédula, RIF y currículum">📁</button>
                  {canWrite && <>
                    <button className="btn btn-sm btn-ghost" onClick={() => editar(p)} title="Editar">✎</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => toggleActivo(p)} title={p.activo ? 'Desactivar' : 'Activar'}>{p.activo ? '⏸' : '▶'}</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setPorBorrar(p)} title="Eliminar" style={{ color: 'var(--danger)' }}>🗑</button>
                  </>}
                </td>
              </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <Modal
          title={editId ? 'Editar registro de personal' : 'Ingresar registro de personal'}
          size="lg"
          onClose={() => { if (!guardando) cerrarForm(); }}
          footer={
            <>
              <button className="btn btn-ghost" onClick={cerrarForm} disabled={guardando}>Cancelar</button>
              <button type="submit" form="rrhh-personal-form" className="btn btn-primary" disabled={guardando}>
                {guardando ? 'Guardando…' : editId ? 'Guardar cambios' : '+ Agregar'}
              </button>
            </>
          }
        >
          <form id="rrhh-personal-form" onSubmit={guardar}>
            {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}

            {/* Foto del carnet (opcional): subir / cambiar / quitar. */}
            <div className="form-row">
              <label>Foto del carnet</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.8rem', flexWrap: 'wrap' }}>
                <div style={{ width: 84, height: 96, borderRadius: 10, border: '2px solid var(--primary)', overflow: 'hidden', background: 'var(--bg-1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {form.foto_url
                    ? <img src={form.foto_url} alt="Foto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span className="muted" style={{ fontSize: '1.6rem' }}>👤</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                  <label className="btn btn-sm btn-ghost" style={{ cursor: subiendoFoto ? 'wait' : 'pointer' }}>
                    {subiendoFoto ? 'Subiendo…' : (form.foto_url ? '🔄 Cambiar foto' : '📷 Subir foto')}
                    <input type="file" accept="image/*" style={{ display: 'none' }} disabled={subiendoFoto}
                      onChange={(e) => { void onPickFoto(e.target.files?.[0] ?? null); e.target.value = ''; }} />
                  </label>
                  {form.foto_url && <button type="button" className="btn btn-sm btn-danger" onClick={quitarFoto} disabled={subiendoFoto}>🗑 Quitar</button>}
                </div>
                <small className="muted" style={{ flex: '1 1 160px', minWidth: 0 }}>Imagen (JPG/PNG) ≤ 5&nbsp;MB. Se recorta al marco del carnet.</small>
              </div>
            </div>

            {/* Encuadre de la foto: el usuario arrastra para centrar la cara + zoom. */}
            {form.foto_url && (
              <div className="form-row">
                <label>Encuadre de la foto <span className="muted" style={{ fontWeight: 400 }}>· arrastrá para centrar la cara</span></label>
                <FotoEncuadre
                  url={form.foto_url}
                  posX={form.foto_pos_x ?? 0.5}
                  posY={form.foto_pos_y ?? 0.5}
                  zoom={form.foto_zoom ?? 1}
                  onChange={(v) => setForm((f) => ({ ...f, ...v }))}
                />
              </div>
            )}

            <div className="form-grid">
              {/* N° de ficha: se escribe una vez. Después queda trabado, porque es el
                  número con el que la persona figura en nómina, en el carnet y en los
                  recibos: cambiarlo parte el rastro. Un admin sí puede corregirlo,
                  para no tener que ir a la base por un dedazo. */}
              <div className="form-row">
                <label>N° de ficha</label>
                {fichaTrabada ? (
                  <>
                    <input className="input mono" value={form.numero_ficha ?? ''} readOnly disabled
                      style={{ opacity: .75, cursor: 'not-allowed' }} />
                    <small className="muted">🔒 Ya está asignado. Solo un administrador puede corregirlo.</small>
                  </>
                ) : (
                  <>
                    <input className="input mono" value={form.numero_ficha ?? ''} maxLength={20}
                      onChange={(e) => setForm((f) => ({ ...f, numero_ficha: e.target.value.toUpperCase() }))}
                      placeholder="001" />
                    <small className="muted">
                      Mínimo {MIN_FICHA} caracteres (ej.: <strong>001</strong>, <strong>A01</strong>, <strong>MGG-015</strong>).
                      {editId ? ' Corregilo solo si se cargó mal: es el número con el que figura en nómina y en el carnet.' : ' Se escribe una vez y después queda trabado.'}
                    </small>
                  </>
                )}
              </div>
              <div className="form-row"><label>Nombre *</label><input className="input" autoFocus value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} required /></div>
              <div className="form-row"><label>Apellido</label><input className="input" value={form.apellido ?? ''} onChange={(e) => setForm((f) => ({ ...f, apellido: e.target.value }))} /></div>
              <div className="form-row">
                <label>Cédula</label>
                <input className="input" value={form.cedula ?? ''} onChange={(e) => setForm((f) => ({ ...f, cedula: sanitizarCedula(e.target.value) }))}
                  placeholder="V-12345678" maxLength={11} inputMode="numeric"
                  style={duenoCedula ? { borderColor: 'var(--danger)' } : undefined} />
                {/* La cédula no se repite. Se avisa MIENTRAS se escribe, con el
                    nombre de quien ya la tiene: un error al guardar llega tarde. */}
                {duenoCedula && (
                  <small style={{ color: 'var(--danger)', marginTop: '.3rem', display: 'block' }}>
                    Esa cédula ya es de <strong>{duenoCedula.nombre} {duenoCedula.apellido ?? ''}</strong>. No puede haber dos fichas con la misma.
                  </small>
                )}
              </div>
              <div className="form-row">
                <label>RIF</label>
                <input className="input mono" value={form.rif ?? ''} onChange={(e) => setForm((f) => ({ ...f, rif: sanitizarRif(e.target.value) }))}
                  placeholder="V-12345678-9" maxLength={13} />
                <small className="muted">Para la constancia de trabajo y las retenciones. Se puede corregir al editar.</small>
              </div>
              {/* Los papeles ya no se cargan acá: tienen su propia ventana, que
                  necesita la ficha creada para saber de quién son. */}
              <div className="form-row">
                <label>📁 Documentación (cédula, RIF, currículum)</label>
                {editId ? (
                  <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="badge">{resumenDocumentos(docsPorPersona.get(editId) ?? [])} cargados</span>
                    <button type="button" className="btn btn-sm btn-ghost"
                      onClick={() => { const p = lista.find((x) => x.id === editId); if (p) { cerrarForm(); setDocsPersona(p); } }}>
                      📁 Abrir documentación
                    </button>
                  </div>
                ) : (
                  <small className="muted">
                    Primero guardá la ficha. Después, con el botón <strong>📁</strong> del listado se cargan
                    la <strong>cédula</strong>, el <strong>RIF</strong> y el <strong>currículum</strong>.
                  </small>
                )}
                {editId && <small className="muted">Quedan en un depósito privado: se abren con un enlace temporal, no con una dirección pública.</small>}
              </div>
              <ComboConAgregar
                label="Cargo" valor={form.cargo ?? ''} opciones={cargos}
                onChange={(v) => setForm((f) => ({ ...f, cargo: v }))}
                hint="Elegí de la lista o agregá uno nuevo (queda guardado)." />
              <ComboConAgregar
                label="Departamento" valor={form.departamento ?? ''} opciones={departamentos}
                onChange={(v) => setForm((f) => ({ ...f, departamento: v }))}
                hint="Toma los de Usuarios; podés agregar uno nuevo." />
              <div className="form-row">
                <label>Sueldo base mensual (USD)</label>
                <input className="input mono" type="number" min={0} step="any" value={form.sueldo_base ?? 0}
                  onChange={(e) => {
                    const v = Number(e.target.value) || 0;
                    setForm((f) => ({ ...f, sueldo_base: v }));
                    // El tipo se sugiere solo según hacia dónde se mueve; se puede cambiar.
                    if (editId) setTipoSueldo(tipoSugerido(sueldoOriginal, v));
                  }} placeholder="0,00" />
              </div>
              <div className="form-row">
                <label>Fecha de ingreso</label>
                <FechaVe
                  value={form.fecha_ingreso ?? ''}
                  onChange={(iso) => setForm((x) => ({ ...x, fecha_ingreso: iso }))}
                  futuro={false} minAnio={1950}
                  ayuda={form.fecha_ingreso
                    ? <>Antigüedad: <strong>{antiguedad(form.fecha_ingreso)}</strong></>
                    : 'dd/mm/aaaa · de acá sale la antigüedad'}
                />
              </div>
              <div className="form-row"><label>Teléfono</label><input className="input mono" value={form.telefono ?? ''} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} placeholder="0414-1234567" inputMode="tel" /></div>
              {/* El correo se guarda en minúsculas al grabar: así el mismo
                  correo cargado por dos personas distintas queda igual. */}
              <div className="form-row">
                <label>Correo electrónico</label>
                <input className="input" type="email" value={form.correo ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, correo: e.target.value }))}
                  placeholder="nombre@gmail.com" inputMode="email" autoComplete="off" />
                {errorCorreo(form.correo)
                  ? <small style={{ color: 'var(--danger)' }}>{errorCorreo(form.correo)}</small>
                  : <small className="muted">Opcional. Puede repetirse: hay familias con una sola cuenta.</small>}
              </div>
              {/* El nombre y el parentesco, separados: juntos en un solo campo
                  no se puede buscar «todos los que dejaron a un hijo de contacto». */}
              <div className="form-row">
                <label>Contacto de emergencia</label>
                <input className="input" value={form.contacto_emergencia ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, contacto_emergencia: e.target.value }))}
                  placeholder="Nombre y apellido" />
              </div>
              <div className="form-row">
                <label>Parentesco</label>
                <SearchSelect
                  options={parentescosContacto}
                  value={form.contacto_emergencia_parentesco ?? ''}
                  onChange={(v) => setForm((f) => ({ ...f, contacto_emergencia_parentesco: v }))}
                  placeholder="Buscar o escribir…"
                  allowCreate
                  sinPreseleccion
                />
                <small className="muted">Se busca escribiendo. Si no está en la lista, se escribe y queda para la próxima.</small>
              </div>
              <div className="form-row"><label>Tel. de emergencia</label><input className="input mono" value={form.contacto_emergencia_tlf ?? ''} onChange={(e) => setForm((f) => ({ ...f, contacto_emergencia_tlf: e.target.value }))} placeholder="0414-1234567" inputMode="tel" /></div>
            </div>

            {/* ── Condiciones de salud ──
                Va en su propio bloque y no mezclado con el resto de la ficha:
                es lo que se lee al escanear el QR del carnet cuando la persona
                no puede contestar por sí misma. */}
            <div className="card" style={{ margin: '.6rem 0' }}>
              <div style={{ fontWeight: 700, marginBottom: '.15rem' }}>🩺 Condiciones de salud</div>
              <div className="muted" style={{ fontSize: '.82rem', marginBottom: '.6rem' }}>
                Se imprime en el carnet y se muestra al <strong>escanear su QR</strong>, para que puedan atenderlo en una emergencia.
                Lo que quede <strong>sin responder</strong> se muestra como «—»: no es lo mismo que decir que no tiene.
              </div>
              <PreguntaSalud
                pregunta="¿Padece alguna alergia?"
                respuesta={form.tiene_alergias ?? null}
                onRespuesta={(v) => setForm((f) => ({ ...f, tiene_alergias: v, alergias_detalle: v === true ? (f.alergias_detalle ?? '') : '' }))}
                detalle={form.alergias_detalle ?? ''}
                onDetalle={(v) => setForm((f) => ({ ...f, alergias_detalle: v }))}
                ayuda="¿A qué? Medicamentos, alimentos, picaduras, polvo…"
              />
              <PreguntaSalud
                pregunta="¿Padece alguna enfermedad?"
                respuesta={form.tiene_enfermedad ?? null}
                onRespuesta={(v) => setForm((f) => ({ ...f, tiene_enfermedad: v, enfermedad_detalle: v === true ? (f.enfermedad_detalle ?? '') : '' }))}
                detalle={form.enfermedad_detalle ?? ''}
                onDetalle={(v) => setForm((f) => ({ ...f, enfermedad_detalle: v }))}
                ayuda="¿Cuál? Indicá también el tratamiento que recibe"
              />
            </div>

            {/* Cambió el sueldo: acá se explica por qué. Es lo que queda en el historial. */}
            {editId && huboCambioSueldo(sueldoOriginal, form.sueldo_base) && (
              <div className="card" style={{ borderColor: 'var(--warning)', margin: '.6rem 0' }}>
                <div style={{ fontWeight: 700, marginBottom: '.2rem' }}>💵 Estás cambiando el sueldo</div>
                <div className="muted mono" style={{ fontSize: '.84rem', marginBottom: '.5rem' }}>
                  {textoVariacion(variacionSueldo(sueldoOriginal, form.sueldo_base))}
                </div>
                <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
                  <div className="form-row" style={{ flex: '1 1 190px', margin: 0 }}>
                    <label>¿Qué tipo de cambio es?</label>
                    <select className="select" value={tipoSueldo} onChange={(e) => setTipoSueldo(e.target.value as TipoCambioSueldo)}>
                      {TIPOS_CAMBIO_SUELDO.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </select>
                    <small className="muted">{TIPOS_CAMBIO_SUELDO.find((t) => t.key === tipoSueldo)?.ayuda ?? ''}</small>
                  </div>
                  <div className="form-row" style={{ flex: '0 1 165px', margin: 0 }}>
                    <label>Rige desde</label>
                    <input className="input" type="date" value={vigenteDesde} onChange={(e) => setVigenteDesde(e.target.value)} />
                    <small className="muted">No siempre es hoy.</small>
                  </div>
                </div>
                <div className="form-row" style={{ marginBottom: 0 }}>
                  <label>¿Por qué cambia el sueldo? <span style={{ color: 'var(--danger)' }}>*</span></label>
                  <input className="input" value={motivoSueldo} onChange={(e) => setMotivoSueldo(e.target.value)} autoFocus
                    placeholder="Ej.: aumento acordado en la reunión del 15/09" />
                  <small className="muted">
                    Queda en el historial de la persona, con la fecha y con tu nombre. Un aumento y una corrección
                    de un error se ven igual en la ficha: el motivo es lo que los distingue.
                  </small>
                </div>
              </div>
            )}

            {/* ── Datos personales de la ficha tecnica ── */}
            <div className="card" style={{ margin: '.7rem 0', padding: '.7rem .8rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '.5rem' }}>🪪 Datos personales</div>
              <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
                <div className="form-row" style={{ flex: '0 1 150px', margin: 0 }}>
                  <label>Género</label>
                  <select className="select" value={form.genero ?? ''} onChange={(e) => setForm((x) => ({ ...x, genero: e.target.value }))}>
                    <option value="">— sin cargar —</option>
                    {GENEROS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                  </select>
                </div>
                <div className="form-row" style={{ flex: '0 1 160px', margin: 0 }}>
                  <label>Estado civil</label>
                  <select className="select" value={form.estado_civil ?? ''} onChange={(e) => setForm((x) => ({ ...x, estado_civil: e.target.value }))}>
                    <option value="">— sin cargar —</option>
                    {ESTADOS_CIVILES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div className="form-row" style={{ flex: '0 1 210px', margin: 0 }}>
                  <label>Fecha de nacimiento</label>
                  {/* Se escribe a mano en dd/mm/aaaa o se elige en el calendario.
                      La EDAD no se guarda: sale de acá y se actualiza sola. */}
                  <FechaVe
                    value={form.fecha_nacimiento ?? ''}
                    onChange={(iso) => setForm((x) => ({ ...x, fecha_nacimiento: iso }))}
                    futuro={false} minAnio={1900}
                    ayuda={form.fecha_nacimiento
                      ? <>Edad: <strong>{textoEdad(form.fecha_nacimiento)}</strong></>
                      : 'dd/mm/aaaa · de acá sale la edad'}
                  />
                </div>
                <div className="form-row" style={{ flex: '0 1 120px', margin: 0 }}>
                  <label>Grupo sanguíneo</label>
                  <select className="select" value={form.grupo_sanguineo ?? ''} onChange={(e) => setForm((x) => ({ ...x, grupo_sanguineo: e.target.value }))}>
                    <option value="">—</option>
                    {GRUPOS_SANGUINEOS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div className="form-row" style={{ flex: '0 1 200px', margin: 0 }}>
                  <label>Grado de instrucción</label>
                  <select className="select" value={form.grado_instruccion ?? ''} onChange={(e) => setForm((x) => ({ ...x, grado_instruccion: e.target.value }))}>
                    <option value="">— sin cargar —</option>
                    {GRADOS_INSTRUCCION.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                  </select>
                </div>
                <div className="form-row" style={{ flex: '1 1 180px', margin: 0 }}>
                  <label>Nacionalidad</label>
                  <SearchSelect
                    options={nacionalidades}
                    value={form.nacionalidad ?? ''}
                    onChange={(v) => setForm((x) => ({ ...x, nacionalidad: v.toUpperCase() }))}
                    placeholder="Buscar o escribir…"
                    allowCreate
                    sinPreseleccion
                  />
                  <small className="muted">Si no está, se escribe y queda para la próxima.</small>
                </div>
              </div>
              <div className="form-row" style={{ marginBottom: 0, marginTop: '.5rem' }}>
                <label>Dirección</label>
                <input className="input" value={form.direccion ?? ''}
                  onChange={(e) => setForm((x) => ({ ...x, direccion: e.target.value }))}
                  placeholder="Ciudad, sector, calle…" />
              </div>
            </div>

            {/* ── CARGA FAMILIAR ── */}
            <div className="card" style={{ margin: '.7rem 0', padding: '.7rem .8rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>👨‍👩‍👧 CARGA FAMILIAR</div>
                  <small className="muted">
                    De acá sale quién tiene hijos: no se pregunta aparte, para que no pueda decir
                    una cosa la casilla y otra la lista.
                  </small>
                </div>
                <button type="button" className="btn btn-sm btn-ghost" onClick={agregarFila}>+ Agregar familiar</button>
              </div>

              {!familiaForm.length && (
                <small className="muted">Sin carga familiar cargada. Con <strong>+ Agregar familiar</strong> se suman hijos, cónyuge y quien corresponda.</small>
              )}

              {familiaForm.map((fam, i) => (
                <div key={i} style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'flex-end', padding: '.45rem 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                  <div className="form-row" style={{ flex: '2 1 170px', margin: 0 }}>
                    <label style={{ fontSize: '.72rem' }}>Nombre y apellido</label>
                    <input className="input" value={fam.nombre} onChange={(e) => cambiarFila(i, { nombre: e.target.value })} placeholder="Nombre del familiar" />
                  </div>
                  <div className="form-row" style={{ flex: '0 1 140px', margin: 0 }}>
                    <label style={{ fontSize: '.72rem' }}>Parentesco</label>
                    <select className="select" value={fam.parentesco} onChange={(e) => cambiarFila(i, { parentesco: e.target.value as Parentesco })}>
                      {PARENTESCOS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select>
                  </div>
                  <div className="form-row" style={{ flex: '0 1 195px', margin: 0 }}>
                    <label style={{ fontSize: '.72rem' }}>Fecha de nacimiento</label>
                    <FechaVe
                      value={fam.fechaNacimiento}
                      onChange={(iso) => cambiarFila(i, { fechaNacimiento: iso })}
                      futuro={false} minAnio={1900}
                      ayuda={fam.fechaNacimiento ? textoEdad(fam.fechaNacimiento) : undefined}
                    />
                  </div>
                  <div className="form-row" style={{ flex: '0 1 120px', margin: 0 }}>
                    <label style={{ fontSize: '.72rem' }}>Género</label>
                    <select className="select" value={fam.genero} onChange={(e) => cambiarFila(i, { genero: e.target.value as '' | Genero })}>
                      <option value="">—</option>
                      {GENEROS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                    </select>
                  </div>
                  <div className="form-row" style={{ flex: '1 1 140px', margin: 0 }}>
                    <label style={{ fontSize: '.72rem' }}>Observación</label>
                    <input className="input" value={fam.observacion} onChange={(e) => cambiarFila(i, { observacion: e.target.value })} placeholder="Opcional" />
                  </div>
                  <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }}
                    onClick={() => quitarFila(i)} title="Quitar">🗑</button>
                </div>
              ))}

              {familiaForm.length > 0 && (
                <small className="muted" style={{ display: 'block', marginTop: '.5rem' }}>
                  {familiaForm.length} familiar(es) · {familiaForm.filter((x) => x.parentesco === 'hijo').length} hijo(s).
                  Se guardan junto con la ficha.
                </small>
              )}
            </div>

            <small className="muted" style={{ display: 'block', marginTop: '.5rem' }}>El sueldo base es <strong>mensual</strong>; la quincena = 15 días (mitad). Queda guardado para precargar la nómina. El <strong>teléfono</strong> y el <strong>contacto de emergencia</strong> se incluyen en el <strong>QR del carnet</strong> (🪪).</small>
          </form>
        </Modal>
      )}

      {histPersona && <HistoricoPersonaModal persona={histPersona} onClose={() => setHistPersona(null)} />}
      {sueldoPersona && <HistorialSueldoModal persona={sueldoPersona} onClose={() => setSueldoPersona(null)} />}
      {fichaPersona && (
        <FichaTecnicaModal persona={fichaPersona} onClose={() => setFichaPersona(null)}
          onEditar={() => { const p = fichaPersona; setFichaPersona(null); editar(p); }} canWrite={canWrite} />
      )}
      {docsPersona && (
        <DocumentacionModal persona={docsPersona} canWrite={canWrite} actor={actor} actorName={actorName ?? null}
          onClose={() => setDocsPersona(null)} onCambio={() => { void recargar(); }} />
      )}
      {carnetPersona && <CarnetModal persona={carnetPersona} onClose={() => setCarnetPersona(null)} />}
      {constanciaPersona && <ConstanciaModal persona={constanciaPersona} onClose={() => setConstanciaPersona(null)} />}
      {porBorrar && (
        <ConfirmDialog
          title="Eliminar del personal"
          message={`¿Eliminar a ${porBorrar.nombre} ${porBorrar.apellido ?? ''} de la nómina? No afecta los pagos ya hechos.`}
          confirmText="Eliminar" danger
          onConfirm={() => void confirmarBorrado()}
          onCancel={() => setPorBorrar(null)} />
      )}
    </div>
  );
}

/* ───────── Constancia de trabajo (PDF, vista previa) ───────── */
function ConstanciaModal({ persona, onClose }: { persona: Personal; onClose: () => void }) {
  const [dirigidoA, setDirigidoA] = useState('A quien pueda interesar');
  const [lugar, setLugar] = useState('Puerto Ordaz, Estado Bolívar');
  const [incluirSalario, setIncluirSalario] = useState(true);
  const [generando, setGenerando] = useState(false);

  const faltan: string[] = [];
  if (!persona.cedula) faltan.push('cédula');
  if (!persona.cargo) faltan.push('cargo');
  if (!persona.fecha_ingreso) faltan.push('fecha de ingreso');

  async function generar() {
    setGenerando(true);
    try {
      await descargarConstanciaTrabajoPdf(persona, { dirigidoA: dirigidoA.trim() || 'A quien pueda interesar', lugar: lugar.trim() || 'Puerto Ordaz, Estado Bolívar', incluirSalario });
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar la constancia', 'error'); }
    finally { setGenerando(false); }
  }

  return (
    <Modal title={`Constancia de trabajo · ${persona.nombre} ${persona.apellido}`} size="md" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={generando}>Cancelar</button>
        <button className="btn btn-primary" onClick={generar} disabled={generando}>{generando ? 'Generando…' : '📄 Ver constancia (vista previa)'}</button>
      </>
    }>
      {faltan.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: '.7rem', fontSize: '.85rem' }}>
          ⚠️ Este registro no tiene <strong>{faltan.join(', ')}</strong>. Podés generarla igual (esos datos se omiten) o completarlos primero con ✎ Editar.
        </div>
      )}
      <div className="form-row">
        <label>Dirigida a</label>
        <input className="input" value={dirigidoA} onChange={(e) => setDirigidoA(e.target.value)} placeholder="A quien pueda interesar" />
      </div>
      <div className="form-row">
        <label>Lugar de emisión</label>
        <input className="input" value={lugar} onChange={(e) => setLugar(e.target.value)} placeholder="Puerto Ordaz, Estado Bolívar" />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.9rem', marginTop: '.3rem' }}>
        <input type="checkbox" checked={incluirSalario} onChange={(e) => setIncluirSalario(e.target.checked)} />
        Incluir el <strong>sueldo mensual</strong> {Number(persona.sueldo_base) > 0 ? <span className="mono muted">({money(persona.sueldo_base)})</span> : <span className="muted">(sin sueldo cargado)</span>}
      </label>
      <small className="muted" style={{ display: 'block', marginTop: '.5rem' }}>
        La fecha de emisión es la de hoy. El documento se abre en <strong>vista previa</strong> para revisar/imprimir.
      </small>
    </Modal>
  );
}

/* ───────── Vista previa + descarga del carnet (frente + reverso, PNG con QR) ───────── */
function CarnetModal({ persona, onClose }: { persona: Personal; onClose: () => void }) {
  const [frente, setFrente] = useState<string | null>(null);
  const [reverso, setReverso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState<false | 1 | 2>(false);
  /* En qué fondo se ve y se baja. El oscuro es el de la marca; el blanco existe
     porque un carnet negro a sangre se come el tóner de una impresora común. */
  const [tema, setTema] = useState<TemaCarnet>('oscuro');

  useEffect(() => {
    let urls: string[] = [];
    let vivo = true;
    setFrente(null); setReverso(null); setError(null);
    Promise.all([generarFrenteBlob(persona, tema), generarReversoBlob(tema)])
      .then(([bf, br]) => {
        if (!vivo) return;
        const uf = URL.createObjectURL(bf);
        const ur = URL.createObjectURL(br);
        urls = [uf, ur];
        setFrente(uf); setReverso(ur);
      })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudo generar el carnet'); });
    return () => { vivo = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [persona, tema]);

  /** Una cara por vez: así cada archivo cae con su nombre y en el orden en que
      se manda a imprimir. Bajar las dos juntas hacía que el navegador ignorara
      la segunda descarga. */
  async function bajar(cara: 1 | 2) {
    setBajando(cara);
    try {
      if (cara === 1) await descargarFrente(persona, tema);
      else await descargarReverso(persona, tema);
      toast(cara === 1 ? 'Frente descargado' : 'Reverso descargado', 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo descargar', 'error'); }
    finally { setBajando(false); }
  }

  const imgStyle: CSSProperties = { width: 230, maxWidth: '100%', height: 'auto', borderRadius: 10, boxShadow: 'var(--shadow-md)' };
  const listo = !!frente && !!reverso;
  return (
    <Modal title={`Carnet · ${persona.nombre} ${persona.apellido}`} size="lg" onClose={onClose} footer={
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
    }>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.7rem' }}>
        {/* Alternador de fondo. */}
        <div className="view-toggle" role="tablist" aria-label="Fondo del carnet">
          <button type="button" className={tema === 'oscuro' ? 'active' : ''}
            onClick={() => setTema('oscuro')} title="El de la marca, para pantalla">◼ Oscuro</button>
          <button type="button" className={tema === 'blanco' ? 'active' : ''}
            onClick={() => setTema('blanco')} title="Fondo blanco: gasta mucha menos tinta al imprimir">◻ Blanco</button>
        </div>
        {error && <div className="card" style={{ borderColor: 'var(--danger)' }}><strong>Error:</strong> {error}</div>}
        {!error && !frente && <div className="muted" style={{ padding: '2rem' }}>Generando carnet…</div>}
        {/* Cada cara con su rótulo arriba y su descarga justo debajo: el botón
            está donde está la imagen que baja, no en un pie común donde hay que
            acordarse de cuál era cuál. */}
        <div style={{ display: 'flex', gap: '1.4rem', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start' }}>
          {frente && (
            <Cara rotulo="Frente" src={frente} alt="Frente del carnet" imgStyle={imgStyle}
              onBajar={() => bajar(1)} bajando={bajando === 1} deshabilitado={!listo || bajando !== false} />
          )}
          {reverso && (
            <Cara rotulo="Reverso" src={reverso} alt="Reverso del carnet" imgStyle={imgStyle}
              onBajar={() => bajar(2)} bajando={bajando === 2} deshabilitado={!listo || bajando !== false} />
          )}
        </div>
        <small className="muted" style={{ textAlign: 'center' }}>
          PNG de 54×86&nbsp;mm a 300&nbsp;DPI (638×1016&nbsp;px), <strong>uno por cara</strong>. El QR del frente incluye cédula, teléfono y contacto de emergencia.
          {tema === 'blanco'
            ? ' El fondo blanco es para imprimir: mismos datos, muchísima menos tinta.'
            : ' Para imprimir conviene el fondo blanco: el oscuro se come el tóner.'}
        </small>
      </div>
    </Modal>
  );
}

/** Una cara del carnet: rótulo, imagen y su propio botón de descarga. */
function Cara({ rotulo, src, alt, imgStyle, onBajar, bajando, deshabilitado }: {
  rotulo: string; src: string; alt: string; imgStyle: CSSProperties;
  onBajar: () => void; bajando: boolean; deshabilitado: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.5rem' }}>
      <div className="muted" style={{
        fontSize: '.72rem', fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase',
      }}>{rotulo}</div>
      <img src={src} alt={alt} style={imgStyle} />
      <button className="btn btn-sm btn-primary" onClick={onBajar} disabled={deshabilitado}>
        {bajando ? 'Descargando…' : `⬇ ${rotulo} (PNG)`}
      </button>
    </div>
  );
}

/* ───────── Combo estilizado (select del sistema) con opción de agregar nuevo ───────── */
function ComboConAgregar({ label, valor, opciones, onChange, hint }: {
  label: string; valor: string; opciones: string[]; onChange: (v: string) => void; hint?: string;
}) {
  const [agregando, setAgregando] = useState(false);
  const [nuevo, setNuevo] = useState('');
  // Si el valor actual no está en el catálogo (p. ej. al editar), lo incluimos.
  const opts = valor && !opciones.includes(valor) ? [valor, ...opciones] : opciones;
  function confirmar() {
    const v = nuevo.trim();
    if (v) onChange(v);
    setNuevo(''); setAgregando(false);
  }
  return (
    <div className="form-row">
      <label>{label}</label>
      {agregando ? (
        <div style={{ display: 'flex', gap: '.3rem' }}>
          <input className="input" autoFocus value={nuevo} placeholder={`Nuevo ${label.toLowerCase()}…`}
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); } if (e.key === 'Escape') { setAgregando(false); setNuevo(''); } }} />
          <button type="button" className="btn btn-sm btn-primary" onClick={confirmar} title="Agregar">✓</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setAgregando(false); setNuevo(''); }} title="Cancelar">✕</button>
        </div>
      ) : (
        <select className="select" value={valor}
          onChange={(e) => { if (e.target.value === '__nuevo__') setAgregando(true); else onChange(e.target.value); }}>
          <option value="">— elegir —</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          <option value="__nuevo__">+ Agregar nuevo…</option>
        </select>
      )}
      {hint && <small className="muted">{hint}</small>}
    </div>
  );
}

/* ───────── Histórico de pagos individuales de una persona ───────── */
/* ───────── Tarjeta del encabezado: un número que además filtra ─────────
   Es un <button> de verdad, no un <div> con onClick: así se llega con el
   tabulador, se activa con Enter y el lector de pantalla dice si está puesta
   (aria-pressed) en vez de leer un número suelto. */
function Tarjeta({ titulo, icono, valor, pie, color, activa, onClick }: {
  titulo: string; icono?: string; valor: number | string; pie: string;
  color?: string; activa?: boolean; onClick?: () => void;
}) {
  const borde = activa ? (color ?? 'var(--primary, #ff8a00)') : 'var(--border)';
  return (
    <button
      type="button"
      className="card"
      onClick={onClick}
      aria-pressed={!!activa}
      title={activa ? `Quitar el filtro «${titulo}»` : `Ver solo: ${titulo}`}
      style={{
        margin: 0, padding: '.6rem .75rem', textAlign: 'left', width: '100%',
        cursor: 'pointer', font: 'inherit',
        borderColor: borde,
        boxShadow: activa ? `inset 0 0 0 1px ${borde}` : 'none',
      }}>
      <div className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.03em' }}>
        {icono ? `${icono} ` : ''}{titulo}
      </div>
      <div className="mono" style={{ fontSize: '1.8rem', fontWeight: 800, lineHeight: 1.1, color: color ?? 'inherit' }}>{valor}</div>
      <div className="muted" style={{ fontSize: '.72rem' }}>{pie}</div>
    </button>
  );
}

/* ───────── Ficha técnica: todo de una persona, en una hoja ───────── */
function FichaTecnicaModal({ persona, canWrite, onClose, onEditar }: {
  persona: Personal; canWrite: boolean; onClose: () => void; onEditar: () => void;
}) {
  const [familia, setFamilia] = useState<FamiliarPersonal[]>([]);
  const [docs, setDocs] = useState<DocumentoPersonal[]>([]);
  const [loading, setLoading] = useState(true);
  const [generando, setGenerando] = useState(false);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      listCargaFamiliar(persona.id).catch(() => [] as FamiliarPersonal[]),
      listDocumentosPersonal(persona.id).catch(() => [] as DocumentoPersonal[]),
    ]).then(([fam, dd]) => { if (vivo) { setFamilia(fam); setDocs(dd); } })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [persona.id]);

  async function verPdf() {
    setGenerando(true);
    try { await verFichaTecnicaPdf(persona, familia); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar la ficha', 'error'); }
    finally { setGenerando(false); }
  }

  const emp = definicionEmpresa(persona.empresa);
  const emergencia = [persona.contacto_emergencia, persona.contacto_emergencia_parentesco]
    .map((x) => String(x ?? '').trim()).filter(Boolean).join(', ');

  return (
    <Modal title={`Ficha técnica · ${persona.nombre} ${persona.apellido}`} size="xl" onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
          {canWrite && <button className="btn btn-ghost" onClick={onEditar}>✎ Editar datos</button>}
          <button className="btn btn-primary" onClick={() => void verPdf()} disabled={generando}>
            {generando ? 'Generando…' : '📄 Ver ficha en PDF'}
          </button>
        </>
      }>
      {/* Encabezado: quién es y en qué nómina está */}
      <div className="card" style={{ margin: '0 0 .75rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', borderLeft: `3px solid ${emp.color}` }}>
        <div style={{ width: 72, height: 82, borderRadius: 8, overflow: 'hidden', background: 'var(--bg-1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '2px solid var(--primary)' }}>
          {persona.foto_url
            ? <img src={persona.foto_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span className="muted" style={{ fontSize: '1.6rem' }}>👤</span>}
        </div>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>{persona.nombre} {persona.apellido}</div>
          <div className="muted" style={{ fontSize: '.84rem' }}>
            {numeroFicha(persona.numero_ficha)} · {persona.cargo || 'Sin cargo'} · {persona.departamento || 'Sin departamento'}
          </div>
          <div style={{ marginTop: '.3rem', display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
            <span className="badge" style={{ color: persona.activo ? 'var(--success)' : 'var(--muted)' }}>{persona.activo ? 'Activo' : 'Inactivo'}</span>
            <span className="badge" style={{ background: emp.color, color: '#fff' }}>Nómina {emp.label}</span>
            <span className="badge">{resumenDocumentos(docs)} papeles</span>
          </div>
        </div>
      </div>

      <BloqueFicha titulo="Identificación" pares={[
        ['Cédula', persona.cedula || '—'],
        ['RIF', persona.rif || '—'],
        ['Fecha de nacimiento', persona.fecha_nacimiento ? date(persona.fecha_nacimiento) : '—'],
        ['Edad', textoEdad(persona.fecha_nacimiento)],
        ['Grupo sanguíneo', persona.grupo_sanguineo || '—'],
        ['Grado de instrucción', persona.grado_instruccion ? labelGradoInstruccion(persona.grado_instruccion) : '—'],
        ['Género', persona.genero ? labelGenero(persona.genero) : '—'],
        ['Nacionalidad', persona.nacionalidad || '—'],
        ['Estado civil', persona.estado_civil ? labelEstadoCivil(persona.estado_civil) : '—'],
      ]} />

      <BloqueFicha titulo="Contacto" pares={[
        ['Teléfono', persona.telefono || '—'],
        ['Correo', persona.correo || '—'],
        ['En una emergencia, llamar a', [emergencia || null, persona.contacto_emergencia_tlf || null].filter(Boolean).join(' · ') || '—'],
        ['Dirección', persona.direccion || '—'],
      ]} />

      {/* Antes de los datos laborales: es lo que hay que saber si a la persona
          le pasa algo, no un dato administrativo más. */}
      <BloqueFicha titulo="Condiciones de salud" pares={
        renglonesSalud(persona).map((r) => [r.etiqueta, r.valor] as [string, string])
      } />

      <BloqueFicha titulo="Datos laborales" pares={[
        ['Cargo', persona.cargo || '—'],
        ['Departamento', persona.departamento || '—'],
        ['Fecha de ingreso', persona.fecha_ingreso ? date(persona.fecha_ingreso) : '—'],
        ['Antigüedad', antiguedad(persona.fecha_ingreso)],
        ['Sueldo base mensual', Number(persona.sueldo_base) > 0 ? money(persona.sueldo_base) : '—'],
        ['Empresa', emp.razonSocial],
      ]} />

      {/* Carga familiar */}
      <div style={{ marginTop: '.9rem' }}>
        <div style={{ color: 'var(--primary)', fontWeight: 800, fontSize: '.8rem', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid var(--primary)', paddingBottom: '.25rem', marginBottom: '.5rem' }}>
          Carga familiar
        </div>
        {loading && <div className="muted" style={{ fontSize: '.85rem' }}>Cargando…</div>}
        {!loading && !familia.length && <div className="muted" style={{ fontSize: '.85rem' }}>Sin carga familiar registrada.</div>}
        {!loading && familia.length > 0 && (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead><tr><th>Nombre</th><th>Parentesco</th><th>Nacimiento</th><th style={{ textAlign: 'center' }}>Edad</th><th>Género</th><th>Observación</th></tr></thead>
              <tbody>
                {familia.map((x) => (
                  <tr key={x.id}>
                    <td>{x.nombre}</td>
                    <td><span className="badge">{labelParentesco(x.parentesco)}</span></td>
                    <td className="mono muted">{x.fechaNacimiento ? date(x.fechaNacimiento) : '—'}</td>
                    <td className="mono" style={{ textAlign: 'center' }}>{textoEdad(x.fechaNacimiento)}</td>
                    <td className="muted">{x.genero ? labelGenero(x.genero) : '—'}</td>
                    <td className="muted">{x.observacion || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Un bloque de la ficha: título con línea y los datos de a dos por renglón. */
function BloqueFicha({ titulo, pares }: { titulo: string; pares: [string, string][] }) {
  return (
    <div style={{ marginBottom: '.9rem' }}>
      <div style={{ color: 'var(--primary)', fontWeight: 800, fontSize: '.8rem', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid var(--primary)', paddingBottom: '.25rem', marginBottom: '.4rem' }}>
        {titulo}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 1.5rem' }}>
        {pares.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '.35rem 0', borderBottom: '1px solid var(--border)', fontSize: '.86rem' }}>
            <span className="muted">{k}</span>
            <span style={{ fontWeight: 700, textAlign: 'right' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────── Documentación: cédula, RIF y currículum ───────── */
function DocumentacionModal({ persona, canWrite, actor, actorName, onClose, onCambio }: {
  persona: Personal; canWrite: boolean; actor: string; actorName: string | null;
  onClose: () => void; onCambio: () => void;
}) {
  const [docs, setDocs] = useState<DocumentoPersonal[]>([]);
  const [loading, setLoading] = useState(true);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [porQuitar, setPorQuitar] = useState<DocumentoPersonal | null>(null);
  /** Nombre del documento extra que se está por cargar. Se pide ANTES del
   *  archivo: sin nombre no hay forma de distinguirlo de los otros. */
  const [nombreNuevo, setNombreNuevo] = useState('');
  /** Documento al que se le está cambiando el nombre: id → texto en edición. */
  const [renombrando, setRenombrando] = useState<{ id: string; texto: string } | null>(null);

  const recargar = useCallback(async () => {
    try { setDocs(await listDocumentosPersonal(persona.id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar la documentación'); }
    finally { setLoading(false); }
  }, [persona.id]);
  useEffect(() => { void recargar(); }, [recargar]);

  const porTipo = useMemo(() => {
    const m = new Map<string, DocumentoPersonal>();
    for (const d of docs) if (d.tipo !== TIPO_OTRO) m.set(d.tipo, d);
    return m;
  }, [docs]);
  /** Los papeles agregados a mano, del más viejo al más nuevo. */
  const otros = useMemo(
    () => docs.filter((d) => d.tipo === TIPO_OTRO).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')),
    [docs],
  );
  const hayLugar = otros.length < MAX_DOCUMENTOS_OTROS;

  async function subir(
    tipo: TipoDocumentoPersonal | 'otro', file: File | null,
    extra: { etiqueta?: string; reemplazaId?: string } = {},
  ) {
    if (!file) return;
    setError(null);
    // Se avisa ANTES de subir: no tiene sentido esperar a que viaje un archivo
    // de 40 MB para decir que no se acepta.
    const falla = validarArchivoDocumento(file);
    if (falla) { setError(falla); return; }
    if (tipo === TIPO_OTRO && !extra.reemplazaId) {
      const mal = errorEtiquetaDocumento(extra.etiqueta, otros.map((d) => d.etiqueta ?? ''));
      if (mal) { setError(mal); return; }
    }
    setSubiendo(extra.reemplazaId ?? tipo);
    try {
      await subirDocumentoPersonal(persona.id, tipo, file, { actor, actorName, ...extra });
      toast('Documento cargado', 'success');
      setNombreNuevo('');
      await recargar();
      onCambio();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo subir el documento'); }
    finally { setSubiendo(null); }
  }

  async function guardarNombre() {
    if (!renombrando) return;
    const d = docs.find((x) => x.id === renombrando.id);
    if (!d) { setRenombrando(null); return; }
    setError(null);
    try {
      await renombrarDocumentoPersonal(d, renombrando.texto);
      setRenombrando(null);
      toast('Nombre actualizado', 'success');
      await recargar();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cambiar el nombre'); }
  }

  async function ver(d: DocumentoPersonal) {
    try { await previewFileUrl(await urlDocumentoPersonal(d.path), d.nombre, 'Documentación del trabajador'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir el documento', 'error'); }
  }

  async function quitar() {
    if (!porQuitar) return;
    try {
      await borrarDocumentoPersonal(porQuitar);
      setPorQuitar(null);
      toast('Documento quitado', 'success');
      await recargar();
      onCambio();
    } catch (e) { setPorQuitar(null); toast(e instanceof Error ? e.message : 'No se pudo quitar', 'error'); }
  }

  const completa = documentacionCompleta(docs);

  return (
    <Modal title={`📁 Documentación · ${persona.nombre} ${persona.apellido}`} size="lg" onClose={onClose}
      footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}

      <div className="card" style={{ background: 'var(--bg-2)', marginBottom: '.75rem', display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '.88rem' }}>
          {loading ? 'Cargando…' : completa
            ? <><strong style={{ color: 'var(--success)' }}>✓ Documentación completa</strong> — están los tres papeles.</>
            : <><strong>{resumenDocumentos(docs)}</strong> papeles cargados.</>}
        </span>
        <span className="muted" style={{ fontSize: '.78rem' }}>PDF o imagen · hasta 10 MB</span>
      </div>

      <div style={{ display: 'grid', gap: '.6rem' }}>
        {TIPOS_DOCUMENTO_PERSONAL.map((t) => {
          const d = porTipo.get(t.key);
          const cargando = subiendo === t.key;
          return (
            <div key={t.key} className="card" style={{ margin: 0, borderColor: d ? 'var(--success)' : 'var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.7rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{t.icono} {t.label}</div>
                  {d ? (
                    <div className="muted" style={{ fontSize: '.78rem', wordBreak: 'break-all' }}>
                      {d.nombre}{d.tamano ? ` · ${megas(d.tamano)}` : ''}
                      <div>Cargado {d.createdAt ? dateTime(d.createdAt) : ''}{d.subidoPorNombre ? ` por ${d.subidoPorNombre}` : ''}</div>
                    </div>
                  ) : (
                    <div className="muted" style={{ fontSize: '.78rem' }}>{t.ayuda} <strong>Falta cargarlo.</strong></div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {d && <button className="btn btn-sm btn-ghost" onClick={() => void ver(d)}>👁 Ver</button>}
                  {canWrite && (
                    <label className="btn btn-sm btn-ghost" style={{ cursor: cargando ? 'wait' : 'pointer', margin: 0 }}>
                      {cargando ? 'Subiendo…' : d ? '🔄 Reemplazar' : '📎 Cargar'}
                      <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }} disabled={cargando}
                        onChange={(e) => { void subir(t.key, e.target.files?.[0] ?? null); e.target.value = ''; }} />
                    </label>
                  )}
                  {d && canWrite && (
                    <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }}
                      onClick={() => setPorQuitar(d)} title="Quitar">🗑</button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* ── Otros documentos ── Los tres de arriba son los obligatorios; acá va
            todo lo demás (título, certificado médico, contrato firmado…), que no
            se puede listar de antemano porque cada puesto pide lo suyo. */}
        <div className="card" style={{ margin: 0, background: 'var(--bg-2)' }}>
          <div style={{ fontWeight: 700, marginBottom: otros.length ? '.5rem' : '.35rem' }}>
            📎 Otros documentos <span className="muted" style={{ fontWeight: 400, fontSize: '.8rem' }}>· {otros.length} de {MAX_DOCUMENTOS_OTROS}</span>
          </div>

          {otros.map((d) => {
            const editando = renombrando?.id === d.id;
            return (
              <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '.7rem', flexWrap: 'wrap', alignItems: 'center', padding: '.45rem 0', borderTop: '1px solid var(--border)' }}>
                <div style={{ minWidth: 220, flex: 1 }}>
                  {editando ? (
                    <div style={{ display: 'flex', gap: '.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input className="input" autoFocus value={renombrando.texto} maxLength={60}
                        onChange={(e) => setRenombrando({ id: d.id, texto: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); void guardarNombre(); }
                          if (e.key === 'Escape') setRenombrando(null);
                        }}
                        style={{ maxWidth: 260 }} />
                      <button className="btn btn-sm btn-primary" onClick={() => void guardarNombre()}>✓</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setRenombrando(null)}>✕</button>
                    </div>
                  ) : (
                    <div style={{ fontWeight: 700 }}>{iconoDocumento(d.tipo)} {tituloDocumento(d)}</div>
                  )}
                  <div className="muted" style={{ fontSize: '.78rem', wordBreak: 'break-all' }}>
                    {d.nombre}{d.tamano ? ` · ${megas(d.tamano)}` : ''}
                    <div>Cargado {d.createdAt ? dateTime(d.createdAt) : ''}{d.subidoPorNombre ? ` por ${d.subidoPorNombre}` : ''}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => void ver(d)}>👁 Ver</button>
                  {canWrite && !editando && (
                    <button className="btn btn-sm btn-ghost" title="Cambiar el nombre"
                      onClick={() => setRenombrando({ id: d.id, texto: d.etiqueta ?? '' })}>✎ Nombre</button>
                  )}
                  {canWrite && (
                    <label className="btn btn-sm btn-ghost" style={{ cursor: subiendo === d.id ? 'wait' : 'pointer', margin: 0 }}>
                      {subiendo === d.id ? 'Subiendo…' : '🔄 Reemplazar'}
                      <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }} disabled={subiendo === d.id}
                        onChange={(e) => { void subir(TIPO_OTRO, e.target.files?.[0] ?? null, { reemplazaId: d.id }); e.target.value = ''; }} />
                    </label>
                  )}
                  {canWrite && (
                    <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }}
                      onClick={() => setPorQuitar(d)} title="Quitar">🗑</button>
                  )}
                </div>
              </div>
            );
          })}

          {canWrite && (hayLugar ? (
            <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap', paddingTop: otros.length ? '.55rem' : 0, borderTop: otros.length ? '1px solid var(--border)' : undefined }}>
              {/* El nombre va primero: el archivo se sube recién cuando ya se sabe
                  cómo se va a llamar, así no queda un «documento sin nombre». */}
              <input className="input" value={nombreNuevo} maxLength={60}
                onChange={(e) => setNombreNuevo(e.target.value)}
                placeholder="Nombre del documento (ej.: Título universitario)"
                style={{ flex: 1, minWidth: 220 }} />
              <label className={`btn btn-sm ${nombreNuevo.trim().length >= MIN_ETIQUETA ? 'btn-primary' : 'btn-ghost'}`}
                style={{ cursor: nombreNuevo.trim().length >= MIN_ETIQUETA ? 'pointer' : 'not-allowed', margin: 0, opacity: nombreNuevo.trim().length >= MIN_ETIQUETA ? 1 : .6 }}
                title={nombreNuevo.trim().length >= MIN_ETIQUETA ? 'Elegí el archivo' : `Escribí primero el nombre (mínimo ${MIN_ETIQUETA} caracteres)`}>
                {subiendo === TIPO_OTRO ? 'Subiendo…' : '📎 Añadir documento'}
                <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
                  disabled={subiendo === TIPO_OTRO || nombreNuevo.trim().length < MIN_ETIQUETA}
                  onChange={(e) => { void subir(TIPO_OTRO, e.target.files?.[0] ?? null, { etiqueta: nombreNuevo }); e.target.value = ''; }} />
              </label>
            </div>
          ) : (
            <small className="muted">Llegaste al tope de {MAX_DOCUMENTOS_OTROS} documentos extra. Quitá alguno para sumar otro.</small>
          ))}

          {!otros.length && !canWrite && <small className="muted">Sin documentos adicionales.</small>}
        </div>
      </div>

      <small className="hint muted" style={{ display: 'block', marginTop: '.6rem' }}>
        Son documentos de identidad: viven en un <strong>depósito privado</strong> y se abren con un enlace que
        <strong> caduca a los 10 minutos</strong>, no con una dirección pública como la foto del carnet.
        En los <strong>tres obligatorios</strong>, cargar de nuevo <strong>reemplaza</strong> el anterior: queda uno
        solo por tipo, para no tener diez versiones de la misma cédula sin saber cuál es la buena. En
        <strong> «Otros documentos»</strong> se pueden sumar hasta {MAX_DOCUMENTOS_OTROS}, cada uno con su
        nombre, y el nombre se cambia cuando haga falta con <strong>✎ Nombre</strong>.
      </small>

      {porQuitar && (
        <ConfirmDialog
          title="Quitar el documento"
          message={`¿Quitar «${tituloDocumento(porQuitar)}» (${porQuitar.nombre}) de la documentación de ${persona.nombre}? El archivo se borra del depósito.`}
          confirmText="Quitar" danger
          onConfirm={() => void quitar()}
          onCancel={() => setPorQuitar(null)} />
      )}
    </Modal>
  );
}

/* ───────── Historial de sueldos: cuándo cambió, cuánto y por qué ───────── */
function HistorialSueldoModal({ persona, onClose }: { persona: Personal; onClose: () => void }) {
  const [filas, setFilas] = useState<CambioSueldoRegistro[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    listHistorialSueldo(persona.id)
      .then((r) => { if (vivo) setFilas(r); })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudo cargar el historial'); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [persona.id]);

  // Los cambios reales son los que movieron el número; la carga inicial no lo es.
  const cambios = filas.filter((f) => f.tipo !== 'inicial').length;

  return (
    <Modal title={`Historial de sueldos · ${persona.nombre} ${persona.apellido}`} size="lg" onClose={onClose}
      footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}

      <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', marginBottom: '.6rem', fontSize: '.86rem' }}>
        <div>
          <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase' }}>Sueldo actual</div>
          <div className="mono" style={{ fontSize: '1.3rem', fontWeight: 800 }}>
            {Number(persona.sueldo_base) > 0 ? money(persona.sueldo_base) : '—'}
          </div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase' }}>Cambios registrados</div>
          <div className="mono" style={{ fontSize: '1.3rem', fontWeight: 800 }}>{cambios}</div>
        </div>
      </div>

      <div className="table-wrap" style={{ maxHeight: 400, overflowY: 'auto' }}>
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead>
            <tr>
              <th>Rige desde</th><th>Tipo</th>
              <th style={{ textAlign: 'right' }}>Antes</th>
              <th style={{ textAlign: 'right' }}>Después</th>
              <th style={{ textAlign: 'right' }}>Variación</th>
              <th>Motivo</th><th>Cargado</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !filas.length && (
              <tr><td colSpan={7}><EmptyState icon="💵" message="Sin cambios de sueldo registrados" /></td></tr>
            )}
            {!loading && filas.map((r) => {
              const v = variacionSueldo(r.sueldoAnterior, r.sueldoNuevo);
              return (
                <tr key={r.id}>
                  <td className="mono">{date(r.vigenteDesde)}</td>
                  <td><span className="badge">{labelTipoCambio(r.tipo)}</span></td>
                  <td className="mono" style={{ textAlign: 'right' }}>{r.sueldoAnterior > 0 ? money(r.sueldoAnterior) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.sueldoNuevo)}</td>
                  <td className="mono" style={{ textAlign: 'right', color: v.direccion === 'aumento' ? 'var(--success)' : v.direccion === 'rebaja' ? 'var(--danger)' : undefined }}>
                    {v.direccion === 'igual' ? '—' : `${v.monto > 0 ? '+' : ''}${money(v.monto)}${v.pct == null ? '' : ` (${v.pct > 0 ? '+' : ''}${v.pct}%)`}`}
                  </td>
                  <td style={{ maxWidth: 260, whiteSpace: 'normal' }}>{r.motivo}</td>
                  <td className="muted" style={{ fontSize: '.74rem' }}>
                    {r.createdAt ? dateTime(r.createdAt) : '—'}
                    <div>{r.actorName || r.actor || ''}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <small className="hint muted" style={{ display: 'block', marginTop: '.4rem' }}>
        Un renglón del historial <strong>no se edita ni se borra</strong>. Si alguno quedó mal cargado, se registra
        otro cambio que lo corrija: un historial que se puede reescribir no sirve para respaldar una nómina vieja.
      </small>
    </Modal>
  );
}

function HistoricoPersonaModal({ persona, onClose }: { persona: Personal; onClose: () => void }) {
  const [rows, setRows] = useState<NominaRenglon[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    listHistoricoPersona(persona.id).then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, [persona.id]);

  const pagados = rows.filter((r) => r.estado === 'pagada');
  const totalPagado = pagados.reduce((a, r) => a + (Number(r.neto_usd) || 0), 0);

  return (
    <Modal title={`Histórico de pagos · ${persona.nombre} ${persona.apellido}`} size="lg" onClose={onClose} footer={
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
    }>
      <div className="muted" style={{ marginBottom: '.5rem', fontSize: '.85rem' }}>
        {pagados.length} pago(s) · Total pagado <strong className="mono">{money(totalPagado)}</strong>
      </div>
      <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead><tr><th>Nómina</th><th>Período</th><th style={{ textAlign: 'right' }}>Días</th><th style={{ textAlign: 'right' }}>Neto</th><th style={{ textAlign: 'center' }}>Estado</th><th>Pagada</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !rows.length && <tr><td colSpan={6}><EmptyState message="Sin pagos registrados" /></td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.periodo?.codigo ?? '—'}</td>
                <td className="muted">{r.periodo?.periodo_desde ? `${date(r.periodo.periodo_desde)} → ${date(r.periodo.periodo_hasta)}` : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.dias_trabajados}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(r.neto_usd)}</td>
                <td style={{ textAlign: 'center' }}>
                  <span className="badge" style={{ color: r.estado === 'pagada' ? 'var(--success)' : 'var(--warning)' }}>{r.estado === 'pagada' ? 'Pagada' : 'Por pagar'}</span>
                </td>
                <td className="muted">{r.pagada_en ? dateTime(r.pagada_en) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
