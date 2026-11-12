/* ============================================================
   MGG · (traído de Golden Touch 11-11-2026) · Ventas · Formulario de PERMUTA (alta / edición de borrador)

   Una permuta es una venta en la que parte del precio —o todo— se paga con
   material. Por eso esta pantalla es la de venta MÁS dos cosas:

     1. El bloque «Material que recibo»: qué entrega el cliente, cuánto, y a
        qué valor por unidad se pactó. Ese material puede ser algo que la
        empresa nunca compró, así que se permite dar de alta la ficha del
        producto aquí mismo.

     2. La BALANZA, visible y permanente:
             vendo $X · recibo $Y · diferencia $Z
        · Z > 0 → el cliente debe: se cobra con las patas de pago o queda a
          crédito.
        · Z = 0 → permuta cerrada, sin dinero de por medio.
        · Z < 0 → saldo a favor del cliente. El sistema NO lo lleva: hoy
          `cuentas_por_cobrar` no tiene dónde alojar un saldo a favor, así que
          solo queda anotado en la nota de este documento.

   Todo lo demás —el cliente, la grilla de lo que entrego con sus tres avisos,
   y la tabla de patas de pago— es lo MISMO que en la venta y vive en
   `ventasFormPartes`. Lo único que esta pantalla le dice de distinto a la
   tabla de patas es CONTRA QUÉ tienen que cuadrar:

   LO QUE SE COBRA ES LA DIFERENCIA, NO EL TOTAL. Parte del precio ya se pagó
   con material: si las patas de pago cuadraran contra el total, se estaría
   cobrando dos veces. Todo lo que compara dinero en esta pantalla mira
   `resumen.diferencia`.

   El valor por unidad del material recibido es OBLIGATORIO y mayor que cero.
   La base lo exige (`ventas_recibidos_valor_unit_check`), pero un error de
   restricción no le explica nada a nadie: aquí se avisa antes y con la razón.
   En una permuta el valor del material ES la forma de pago; si va en 0, el
   material entra al inventario sin costo y la diferencia a cobrar sale mal.

   Los totales salen SIEMPRE de `resumenDeVenta` (que por dentro es
   `calcularTotalesVenta`). Aquí no se vuelve a escribir la cuenta ni en el JSX.
   ============================================================ */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ConfirmDialog, Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { dosDecimales, montoMoneda, num } from '@/shared/lib/format';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import {
  createProducto, getCategorias, getUnidades, listProductos, nextSku,
} from '@/modules/inventario/inventario.repository';
import { esCategoriaReal, MENSAJE_CATEGORIA_OBLIGATORIA } from '@/modules/inventario/categoriaReal';
import { listCajasActivas } from '@/modules/salidas/cajas.repository';
import { listSaldos } from '@/modules/tesoreria/cajaSaldos.repository';
import type { Caja, CajaSaldo, Producto } from '@/shared/lib/types';
import { round2 } from './ventasCalculos';
import {
  ClienteSelector, DocumentoImpuestos, MONEDAS_DOC, TablaPagoLegs, TablaRenglonesVenta,
  calcularFilas, documentoImpuestosInicial, legsAPago, nuevaLeg, nuevaLinea, porcentajesAplicados, proximoId,
  useClienteVenta, type DocumentoImpuestosUI, type LegUI, type LineaUI,
} from './ventasFormPartes';
import { AUTORIZADORES_VENTAS_TEXTO } from './ventasAutorizadores';
import {
  actualizarBorrador, crearBorrador, enviarVentaAAutorizar,
  listClientes, listExistenciasVenta, resumenDeVenta, sumaPagoLegs,
  type CondicionVenta, type ExistenciaProducto, type PagoLeg,
  type RecibidoInput, type RenglonInput, type VentaCompleta, type VentaInput,
} from './ventas.repository';

/* ─────────────────────────── Estado de la pantalla ─────────────────────────── */

/** Un renglón de lo que ENTRA. El valor por unidad es la forma de pago. */
interface ReciboUI {
  id: number;
  productoId: string;
  cantidad: string;
  valorUnit: string;
}

/** Almacén donde entra el material recibido (el único que usa el sistema). */
const ALMACEN = 'General';

const nuevoRecibo = (id: number): ReciboUI => ({ id, productoId: '', cantidad: '1', valorUnit: '' });

/* ───────────────── Alta de ficha al vuelo (material recibido) ─────────────────
   El cliente puede entregar algo que la empresa nunca compró: sin esto habría
   que salir a Inventario, crear la ficha y volver a empezar la permuta. La
   ficha nace en 0 y sin costo a propósito: el costo se lo pone la ENTRADA de
   kardex al entregar, con el valor por unidad pactado aquí. */
function NuevaFichaModal({ categorias, unidades, onCancel, onCreada }: {
  categorias: string[];
  unidades: string[];
  onCancel: () => void;
  onCreada: (p: Producto) => void;
}) {
  const [nombre, setNombre] = useState('');
  // Arranca vacía a propósito: la categoría se elige, no se hereda la primera de la lista.
  const [categoria, setCategoria] = useState('');
  const [unidad, setUnidad] = useState(unidades[0] ?? 'und');
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    const n = nombre.trim().toUpperCase();
    if (!n) { setError('Escribe el nombre del material.'); return; }
    if (!esCategoriaReal(categoria)) { setError(MENSAJE_CATEGORIA_OBLIGATORIA); return; }
    setError(null);
    setCreando(true);
    try {
      const cat = categoria.trim().toUpperCase();
      // SKU correlativo por categoría, reservado de forma atómica en la base.
      const sku = await nextSku(cat);
      const creado = await createProducto({
        sku, nombre: n, categoria: cat,
        unidad: unidad.trim() || 'und',
        stock: 0, stock_min: 0, precio: 0,
        almacen: ALMACEN, estado: 'activo',
      });
      notify(`Ficha «${creado.nombre}» (${creado.sku}) creada`, 'success', { link: '#/app/inventario' });
      onCreada(creado);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la ficha del producto.');
      setCreando(false);
    }
  }

  return (
    <Modal title="Ficha nueva para el material recibido" size="md" compact onClose={onCancel} footer={
      <>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={creando}>Cancelar</button>
        <button type="button" className="btn btn-primary" onClick={crear} disabled={creando}>
          {creando ? 'Creando…' : '＋ Crear ficha'}
        </button>
      </>
    }>
      <p className="muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Para material que la empresa nunca compró. La ficha nace con stock 0 y sin costo: el costo se lo pone la
        entrada al inventario cuando se <strong>entregue</strong> la permuta, con el valor por unidad que se pacte aquí.
      </p>
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}
      <div className="form-row">
        <label>Nombre del material *</label>
        <input className="input" value={nombre} style={{ textTransform: 'uppercase' }} autoFocus
          onChange={(e) => setNombre(e.target.value.toUpperCase())} placeholder="Ej.: CHATARRA DE BRONCE" />
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label>Categoría *</label>
          <select className="select" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Elige una categoría…</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <small className="muted">De ahí sale el prefijo del SKU.</small>
        </div>
        <div className="form-row">
          <label>Medida</label>
          <select className="select" value={unidad} onChange={(e) => setUnidad(e.target.value)}>
            {unidades.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  );
}

export interface PermutaFormProps {
  /** Borrador a editar. Si viene `null`/ausente, es un alta. */
  venta?: VentaCompleta | null;
  /** Se llama con el documento ya guardado (o confirmado). */
  onSaved: (venta: VentaCompleta) => void;
  onCancel: () => void;
}

export function PermutaForm({ venta, onSaved, onCancel }: PermutaFormProps) {
  const esEdicion = !!venta;
  const { user } = useSession();
  const { appUser } = usePermissions();
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre?.trim() || user?.email || null;

  /* ── Catálogos ── */
  const [productos, setProductos] = useState<Producto[]>([]);
  const [existencias, setExistencias] = useState<Record<string, ExistenciaProducto>>({});
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [saldos, setSaldos] = useState<CajaSaldo[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [unidades, setUnidades] = useState<string[]>([]);
  const [cargando, setCargando] = useState(true);

  /* ── Cabecera ── */
  const cliente = useClienteVenta(venta?.venta.cliente_id ?? '');
  const [condicion, setCondicion] = useState<CondicionVenta>(venta?.venta.condicion ?? 'contado');
  const [moneda, setMoneda] = useState(venta?.venta.moneda ?? 'USD');
  const [tasaBs, setTasaBs] = useState(venta?.venta.tasa_bs ? String(venta.venta.tasa_bs) : '');
  // Documento (nota de entrega / factura) e impuestos con casilla: ver `DocumentoImpuestos`.
  const [docImp, setDocImp] = useState<DocumentoImpuestosUI>(() => documentoImpuestosInicial(venta?.venta));
  const [descuento, setDescuento] = useState(venta?.venta.descuento ? String(venta.venta.descuento) : '');
  // La nota va NO controlada (defaultValue + ref): un re-render no puede comerse
  // lo que se está tecleando. Se lee del DOM al guardar.
  const notaRef = useRef<HTMLTextAreaElement>(null);

  /* ── Lo que entrego, lo que recibo, y las patas ── */
  const [lineas, setLineas] = useState<LineaUI[]>(() => {
    if (!venta || !venta.renglones.length) return [nuevaLinea(1)];
    return venta.renglones.map((r, i) => ({
      id: i + 1,
      productoId: r.producto_id,
      cantidad: String(r.cantidad),
      precio: r.precio_unit ? String(r.precio_unit) : '',
      descuento: r.descuento ? String(r.descuento) : '',
    }));
  });
  const [recibos, setRecibos] = useState<ReciboUI[]>(() => {
    if (!venta || !venta.recibidos.length) return [nuevoRecibo(1)];
    return venta.recibidos.map((r, i) => ({
      id: i + 1,
      productoId: r.producto_id,
      cantidad: String(r.cantidad),
      valorUnit: r.valor_unit ? String(r.valor_unit) : '',
    }));
  });
  const [legs, setLegs] = useState<LegUI[]>(() =>
    (venta?.venta.pago_legs ?? []).map((l, i) => ({
      id: i + 1,
      cajaId: l.cajaId ?? '',
      cuenta: l.cuenta ?? 'general',
      moneda: l.moneda ?? 'USD',
      monto: l.monto ? String(l.monto) : '',
    })));

  /* ── Guardado ── */
  const [guardando, setGuardando] = useState(false);
  const [pidiendoConfirmar, setPidiendoConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Id del renglón recibido para el que se está creando una ficha nueva. */
  const [fichaPara, setFichaPara] = useState<number | null>(null);

  const setClientes = cliente.setClientes;
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const [prods, clis, exis, cjs, sds] = await Promise.all([
          listProductos(), listClientes(), listExistenciasVenta(), listCajasActivas(), listSaldos(),
        ]);
        if (cancel) return;
        setProductos(prods); setClientes(clis); setExistencias(exis); setCajas(cjs); setSaldos(sds);
        // Las taxonomías son solo para el alta de ficha al vuelo: si fallan, el
        // resto de la pantalla tiene que seguir andando igual.
        const [cats, unis] = await Promise.all([
          getCategorias(prods).catch(() => [] as string[]),
          getUnidades(prods).catch(() => [] as string[]),
        ]);
        if (cancel) return;
        setCategorias(cats);
        setUnidades(unis.length ? unis : ['und']);
      } catch (e) {
        if (!cancel) toast(e instanceof Error ? e.message : 'No se pudieron cargar los catálogos', 'error');
      } finally {
        if (!cancel) setCargando(false);
      }
    })();
    return () => { cancel = true; };
  }, [setClientes]);

  const activos = useMemo(() => productos.filter((p) => p.estado === 'activo'), [productos]);
  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);

  /* ── Cuentas de lo que ENTREGO (y sus avisos): compartidas con la venta ── */
  const filas = useMemo(
    () => calcularFilas(lineas, porId, existencias, (c) => resumenDeVenta([c], [], 0, 0)),
    [lineas, porId, existencias],
  );

  /* ────────────────────── Cuentas de lo que RECIBO ──────────────────────
     `sinValor` es el aviso propio de la permuta: la base rechaza valor 0 con
     una restricción, y aquí se explica por qué antes de que eso pase. */
  const filasRecibo = useMemo(() => recibos.map((r) => {
    const producto = r.productoId ? porId.get(r.productoId) ?? null : null;
    const existencia = r.productoId ? existencias[r.productoId] : undefined;
    const cantidad = Number(r.cantidad) || 0;
    const valorUnit = Number(r.valorUnit) || 0;
    const cuenta = !!r.productoId && cantidad > 0;
    return {
      recibo: r, producto, cantidad, valorUnit,
      /** Lo que ya hay en la ficha, si es que la ficha existía. */
      costoActual: existencia?.costo_promedio ?? 0,
      fichaNueva: !!r.productoId && !existencia,
      subtotal: round2(cantidad * valorUnit),
      /** Entra al documento: producto elegido y cantidad > 0. */
      cuenta,
      sinValor: cuenta && valorUnit <= 0,
      sinCantidad: !!r.productoId && cantidad <= 0,
    };
  }), [recibos, porId, existencias]);

  const { ivaPct: ivaPctNum, igtfPct: igtfPctNum } = porcentajesAplicados(docImp);
  const descuentoNum = Math.max(0, Number(descuento) || 0);

  /** Solo los recibidos que de verdad se van a guardar entran a la balanza. */
  const recibidosCalculo = useMemo(
    () => filasRecibo.filter((f) => f.cuenta).map((f) => ({ cantidad: f.cantidad, valor_unit: f.valorUnit })),
    [filasRecibo],
  );

  // LA cuenta del documento. Una sola llamada, un solo lugar: totales del lado
  // que vendo, valor del lado que recibo y la diferencia entre los dos.
  const resumen = useMemo(
    () => resumenDeVenta(filas.map((f) => f.calculo), recibidosCalculo, ivaPctNum, descuentoNum, igtfPctNum),
    [filas, recibidosCalculo, ivaPctNum, descuentoNum, igtfPctNum],
  );

  /* ── La balanza ── */
  // Lo que se cobra es la DIFERENCIA, nunca el total: parte del precio ya se
  // pagó con material y cobrar el total sería cobrarlo dos veces.
  const aCobrar = resumen.diferencia;
  const cerrada = Math.abs(aCobrar) <= 0.01;
  const debeElCliente = aCobrar > 0.01;
  const aFavorDelCliente = aCobrar < -0.01;

  /* ── Patas de pago: lo cargado contra lo que hay que cobrar ── */
  const legsCargadas = useMemo<PagoLeg[]>(() => legsAPago(legs), [legs]);
  // Nota conocida (misma que en la venta): las patas NO convierten entre
  // monedas. Si el documento está en $ y la pata en Bs, la suma se compara en
  // crudo, que es lo que la RPC exige hoy.
  const pagado = sumaPagoLegs(legsCargadas);
  const falta = round2(aCobrar - pagado);
  const esContado = condicion === 'contado';
  const patasCuadran = !esContado || !debeElCliente || Math.abs(falta) <= 0.01;
  const legSinCaja = legsCargadas.some((l) => !l.cajaId);

  const productosSinCosto = filas.filter((f) => f.sinCosto).length;
  /** El bloqueo propio de la permuta: material valorado en 0. */
  const recibidosSinValor = filasRecibo.filter((f) => f.sinValor).length;
  const sinMaterialRecibido = !recibidosCalculo.length;

  /* ─────────────────────────── Edición de las grillas ─────────────────────────── */

  function setLinea(id: number, patch: Partial<LineaUI>) {
    setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function agregarLinea() { setLineas((ls) => [...ls, nuevaLinea(proximoId(ls))]); }
  function quitarLinea(id: number) { setLineas((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls)); }

  function setRecibo(id: number, patch: Partial<ReciboUI>) {
    setRecibos((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function agregarRecibo() { setRecibos((rs) => [...rs, nuevoRecibo(proximoId(rs))]); }
  function quitarRecibo(id: number) { setRecibos((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs)); }

  /** Al elegir material recibido se propone su costo promedio como valor pactado. */
  function elegirRecibido(id: number, productoId: string) {
    const costo = existencias[productoId]?.costo_promedio ?? 0;
    setRecibo(id, { productoId, valorUnit: costo > 0 ? String(round2(costo)) : '' });
  }

  /** La ficha recién creada se mete al catálogo y se engancha en su renglón. */
  function fichaCreada(p: Producto) {
    setProductos((ps) => [...ps, p]);
    if (fichaPara != null) setRecibo(fichaPara, { productoId: p.id, valorUnit: '' });
    setFichaPara(null);
  }

  function setLeg(id: number, patch: Partial<LegUI>) {
    setLegs((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function agregarLeg() {
    setLegs((ls) => [...ls, nuevaLeg(proximoId(ls), cajas[0]?.id ?? '', cajas[0]?.moneda ?? moneda)]);
  }
  function quitarLeg(id: number) { setLegs((ls) => ls.filter((l) => l.id !== id)); }

  /**
   * Deja escrito en la nota el saldo a favor. Es el ÚNICO lugar donde queda:
   * `cuentas_por_cobrar` no tiene dónde alojar un saldo a favor del cliente.
   */
  function anotarSaldoAFavor() {
    const el = notaRef.current;
    if (!el) return;
    const linea = `Saldo a favor del cliente: ${montoMoneda(Math.abs(aCobrar), moneda)} (entregó material por más de lo que se le vendió).`;
    if (el.value.includes('Saldo a favor del cliente:')) return;
    el.value = el.value.trim() ? `${el.value.trim()}\n${linea}` : linea;
    toast('Anotado en la nota del documento', 'success');
  }

  /* ─────────────────────────── Guardar / confirmar ─────────────────────────── */

  /** Arma el input del repositorio. Una sola vez, para guardar y para confirmar. */
  function construirInput(): VentaInput {
    const renglones: RenglonInput[] = filas
      .filter((f) => f.linea.productoId && f.cantidad > 0)
      .map((f) => ({
        producto_id: f.linea.productoId,
        producto_sku: f.producto?.sku ?? null,
        producto_nombre: f.producto?.nombre ?? null,
        unidad: f.producto?.unidad ?? null,
        cantidad: f.cantidad,
        precio_unit: f.precio,
        // Referencial: al confirmar, la base lo pisa con `existencias.costo_promedio`.
        costo_unit: f.costo,
        descuento: Math.max(0, Number(f.linea.descuento) || 0),
      }));
    const recibidos: RecibidoInput[] = filasRecibo
      .filter((f) => f.cuenta)
      .map((f) => ({
        producto_id: f.recibo.productoId,
        producto_sku: f.producto?.sku ?? null,
        producto_nombre: f.producto?.nombre ?? null,
        unidad: f.producto?.unidad ?? null,
        cantidad: f.cantidad,
        valor_unit: f.valorUnit,
      }));
    const cli = cliente.clientes.find((c) => c.id === cliente.clienteId) ?? null;
    return {
      tipo: 'permuta',
      clienteId: cliente.clienteId || null,
      clienteNombre: cli?.nombre ?? null,
      clienteRif: cli?.rif ?? null,
      condicion, moneda,
      tasaBs: Number(tasaBs) > 0 ? Number(tasaBs) : null,
      ivaPct: ivaPctNum,
      igtfPct: igtfPctNum,
      documento: docImp.documento,
      numeroFactura: docImp.numeroFactura,
      numeroControl: docImp.numeroControl,
      descuento: descuentoNum,
      // Lo que se cobra es la diferencia; si no queda nada que cobrar, no hay patas.
      pagoLegs: esContado && debeElCliente ? legsCargadas : [],
      nota: notaRef.current?.value ?? '',
      renglones,
      recibidos,
      actor, actorName,
    };
  }

  /**
   * El chequeo que la base haría igual, pero con la razón puesta. Se corre
   * antes de tocar la red: si el valor va en 0 no hay nada que guardar.
   */
  function trabaDePermuta(): string | null {
    const mal = filasRecibo.find((f) => f.sinValor);
    if (!mal) return null;
    const quien = mal.producto?.nombre ?? 'El material recibido';
    return `«${quien}» no tiene valor por unidad. En una permuta el valor del material ES la forma de pago, no un dato opcional: `
      + 'si va en 0, el material entra al inventario sin costo y la diferencia a cobrar sale mal. '
      + 'Pon cuánto se pactó por unidad.';
  }

  /** Guarda el borrador (alta o edición) y devuelve el documento leído de la base. */
  async function guardarBorrador(): Promise<VentaCompleta> {
    const traba = trabaDePermuta();
    if (traba) throw new Error(traba);
    // Da de alta el cliente si se lo estaba creando al vuelo: devuelve la ficha,
    // porque el `setState` de recién no se ve todavía en esta pasada.
    const cli = await cliente.resolver();
    const input = construirInput();
    input.clienteId = cli?.id ?? null;
    input.clienteNombre = cli?.nombre ?? null;
    input.clienteRif = cli?.rif ?? null;
    return esEdicion && venta ? actualizarBorrador(venta.venta.id, input) : crearBorrador(input);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      const guardada = await guardarBorrador();
      notify(
        `Borrador ${guardada.venta.codigo} guardado · vendo ${montoMoneda(guardada.venta.total, guardada.venta.moneda)}`
        + ` · recibo ${montoMoneda(guardada.venta.valor_recibido, guardada.venta.moneda)}`,
        'success', { link: '#/app/ventas' },
      );
      onSaved(guardada);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la permuta.');
      setGuardando(false);
    }
  }

  /**
   * Guarda y la manda a autorizar. NO mueve dinero ni material: la permuta se
   * CONFIRMA (dinero) y se ENTREGA (material) recién después de que LEYDIS RENGEL
   * o JESUS LOZADA la autorizan.
   */
  async function handleConfirmar() {
    setPidiendoConfirmar(false);
    setError(null);
    setGuardando(true);
    try {
      const guardada = await guardarBorrador();
      const enviada = await enviarVentaAAutorizar(guardada.venta.id, actor, actorName ?? actor);
      notify(
        `Permuta ${enviada.codigo} enviada a autorizar · diferencia ${montoMoneda(enviada.diferencia, enviada.moneda)}`,
        'success', { link: '#/app/ventas' },
      );
      onSaved({ ...guardada, venta: enviada });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar la permuta a autorizar.');
      setGuardando(false);
    }
  }

  /* ─────────────────────────── Pantalla ─────────────────────────── */

  const puedeGuardar = !guardando && !cargando && !recibidosSinValor;
  const puedeConfirmar = puedeGuardar && resumen.total > 0 && patasCuadran && !legSinCaja;

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={guardando}>Cancelar</button>
      <button type="submit" form="permuta-form" className="btn btn-primary" disabled={!puedeGuardar}
        title={recibidosSinValor
          ? 'Falta el valor por unidad del material recibido: sin eso la base rechaza el documento'
          : 'Guarda sin mover dinero ni material'}>
        {guardando ? 'Guardando…' : '💾 Guardar borrador'}
      </button>
      <button type="button" className="btn btn-primary" disabled={!puedeConfirmar}
        onClick={() => setPidiendoConfirmar(true)}
        title={recibidosSinValor
          ? 'Falta el valor por unidad del material recibido'
          : patasCuadran
            ? `Guarda y la manda a ${AUTORIZADORES_VENTAS_TEXTO}. No mueve dinero ni material.`
            : 'Las patas de pago tienen que sumar la diferencia, no el total'}>
        📤 Guardar y enviar a autorizar
      </button>
    </>
  );

  return (
    <Modal title={esEdicion ? `Editar permuta ${venta?.venta.codigo ?? ''}` : 'Nueva permuta'} size="xl"
      onClose={onCancel} footer={footer}>
      <form id="permuta-form" onSubmit={handleSubmit}>
        {error && (
          <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* ── Cliente ── */}
        <ClienteSelector {...cliente.selector} />

        {/* ── Nota de entrega o factura, con IVA / IGTF por casilla ── */}
        <DocumentoImpuestos valor={docImp} onChange={setDocImp} />

        {/* ── Condición, moneda, descuento ── */}
        <div className="form-grid">
          <div className="form-row">
            <label>Condición de la diferencia</label>
            <select className="select" value={condicion} onChange={(e) => setCondicion(e.target.value as CondicionVenta)}>
              <option value="contado">Contado (se cobra ahora)</option>
              <option value="credito">Crédito (cuenta por cobrar)</option>
            </select>
            <small className="muted">
              {!debeElCliente
                ? 'Con esta balanza no queda nada que cobrar, así que la condición no mueve dinero.'
                : esContado
                  ? 'Al confirmar entra a la caja SOLO la diferencia, por las patas de pago de abajo.'
                  : 'Al confirmar se le carga SOLO la diferencia a la cuenta corriente del cliente.'}
            </small>
          </div>
          <div className="form-row">
            <label>Moneda</label>
            <select className="select" value={moneda} onChange={(e) => setMoneda(e.target.value)}>
              {MONEDAS_DOC.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label>Tasa Bs/$ <span className="muted">(opcional)</span></label>
            <input className="input mono" inputMode="decimal" value={tasaBs}
              onChange={(e) => setTasaBs(dosDecimales(e.target.value))} placeholder="0,00" />
          </div>
          <div className="form-row">
            <label>Descuento del documento</label>
            <input className="input mono" inputMode="decimal" value={descuento}
              onChange={(e) => setDescuento(dosDecimales(e.target.value))} placeholder="0,00" />
            <small className="muted">Baja el total y también la ganancia.</small>
          </div>
        </div>

        {/* ── Lo que entrego ── */}
        <h4 style={{ margin: '1rem 0 .5rem' }}>Material que entrego</h4>
        <TablaRenglonesVenta
          filas={filas} activos={activos} existencias={existencias} porId={porId} moneda={moneda}
          onSetLinea={setLinea} onAgregar={agregarLinea} onQuitar={quitarLinea}
          verboSobreStock="entregando"
          textoSinPrecio="sin precio: este renglón no vale nada en la balanza"
          textoNoBloquea="Ninguno de estos avisos bloquea la permuta: son para que quede claro qué se está entregando."
        />

        {/* ── Lo que recibo: el bloque propio de la permuta ── */}
        <h4 style={{ margin: '1rem 0 .5rem' }}>Material que recibo</h4>
        <p className="muted" style={{ margin: '0 0 .5rem', fontSize: '.82rem' }}>
          Lo que entrega el cliente, valorado al pactar. Ese valor <strong>es la forma de pago</strong>: descuenta de lo
          que hay que cobrar y, al <strong>entregar</strong>, entra al inventario a ese mismo precio (así el costo
          promedio de la ficha se recalcula solo). Si es material que la empresa nunca compró, se le crea la ficha aquí.
        </p>
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead>
              <tr>
                <th style={{ minWidth: 260 }}>Material recibido</th>
                <th style={{ width: 110, textAlign: 'right' }}>Cantidad</th>
                <th style={{ width: 140, textAlign: 'right' }}>Valor por unidad *</th>
                <th style={{ width: 130, textAlign: 'right' }}>Valor total</th>
                <th style={{ width: 44 }}></th>
              </tr>
            </thead>
            <tbody>
              {filasRecibo.map((f, idx) => (
                <tr key={f.recibo.id}>
                  <td>
                    <SearchSelect value={f.recibo.productoId} onChange={(v) => elegirRecibido(f.recibo.id, v)}
                      disabled={!activos.length}
                      placeholder={activos.length ? `🔍 Material #${idx + 1}…` : '— sin productos —'}
                      options={activos.map((p) => {
                        const costo = existencias[p.id]?.costo_promedio ?? 0;
                        return {
                          value: p.id,
                          label: `${p.nombre} · ${p.sku} · ${p.unidad}`
                            + (costo > 0 ? ` · costo actual ${montoMoneda(costo, moneda)}` : ' · sin costo en la ficha'),
                        };
                      })} />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem', marginTop: '.3rem', alignItems: 'center' }}>
                      <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '0 .3rem' }}
                        onClick={() => setFichaPara(f.recibo.id)}>
                        ＋ Ficha nueva
                      </button>
                      {f.sinValor && (
                        <span className="badge danger" title="La base rechaza un valor por unidad en 0 (ventas_recibidos_valor_unit_check)">
                          ✕ falta el valor por unidad: en una permuta es la forma de pago, no puede ir en 0
                        </span>
                      )}
                      {f.sinCantidad && <span className="badge info">sin cantidad: este renglón no se guarda</span>}
                      {f.fichaNueva && !f.sinValor && (
                        <span className="badge info" title="Todavía no tiene existencias: el costo se lo pone esta permuta al entregar">
                          ficha sin existencias: el costo se lo pone esta permuta
                        </span>
                      )}
                      {f.cuenta && !f.sinValor && f.costoActual > 0 && f.valorUnit > f.costoActual * 1.5 && (
                        <span className="badge warning" title={`Costo actual en la ficha: ${montoMoneda(f.costoActual, moneda)}`}>
                          ⚠ se está pagando bastante por encima del costo de la ficha
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <input className="input mono" type="number" min={0} step="any" style={{ textAlign: 'right' }}
                      value={f.recibo.cantidad} onChange={(e) => setRecibo(f.recibo.id, { cantidad: e.target.value })} />
                  </td>
                  <td>
                    <input className="input mono" inputMode="decimal" placeholder="0,00"
                      style={{ textAlign: 'right', borderColor: f.sinValor ? 'var(--danger)' : undefined }}
                      value={f.recibo.valorUnit}
                      onChange={(e) => setRecibo(f.recibo.id, { valorUnit: dosDecimales(e.target.value) })} />
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{montoMoneda(f.subtotal, moneda)}</td>
                  <td>
                    {recibos.length > 1 && (
                      <button type="button" className="btn btn-sm btn-ghost" title="Quitar material recibido"
                        onClick={() => quitarRecibo(f.recibo.id)}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginTop: '.4rem' }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={agregarRecibo}>＋ Agregar material recibido</button>
          {sinMaterialRecibido && (
            <span className="badge info">todavía no recibes nada: así esto es una venta común, no una permuta</span>
          )}
        </div>

        {recibidosSinValor > 0 && (
          <div className="card" style={{ marginTop: '.75rem', borderColor: 'var(--danger)' }}>
            <div className="card-title" style={{ marginBottom: '.25rem' }}>
              ✕ {recibidosSinValor === 1 ? 'Hay 1 material recibido sin valor' : `Hay ${recibidosSinValor} materiales recibidos sin valor`}
            </div>
            <div className="muted" style={{ fontSize: '.82rem' }}>
              En una permuta el valor del material <strong>es la forma de pago</strong>, no un dato opcional. Si va en 0
              pasan dos cosas malas: el material entra al inventario <strong>sin costo</strong> (y toda venta futura de
              esa ficha va a mostrar una ganancia inventada), y la <strong>diferencia a cobrar sale mal</strong> porque
              el pago en material no se descuenta. La base tampoco lo acepta: lo rechaza con la restricción
              <span className="mono"> ventas_recibidos_valor_unit_check</span>. Pon cuánto se pactó por unidad.
            </div>
          </div>
        )}

        {/* ── LA BALANZA. Siempre visible: es de lo que se trata una permuta ── */}
        <div className="card" style={{ marginTop: '.75rem', borderColor: 'var(--brand, #ff8a00)' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}>Balanza de la permuta</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.2rem', alignItems: 'center' }}>
            <div>Vendo: <strong className="mono">{montoMoneda(resumen.total, moneda)}</strong></div>
            <div>·</div>
            <div>Recibo: <strong className="mono">{montoMoneda(resumen.valorRecibido, moneda)}</strong></div>
            <div>·</div>
            <div>Diferencia:{' '}
              <strong className="mono" style={{ color: aFavorDelCliente ? 'var(--danger)' : undefined }}>
                {montoMoneda(resumen.diferencia, moneda)}
              </strong>
            </div>
            {cerrada
              ? <span className="badge success">✔ permuta cerrada: no hay dinero de por medio</span>
              : debeElCliente
                ? <span className="badge warning">el cliente debe {montoMoneda(aCobrar, moneda)}</span>
                : <span className="badge info">saldo a favor del cliente: {montoMoneda(Math.abs(aCobrar), moneda)}</span>}
          </div>
          <div className="muted" style={{ fontSize: '.82rem', marginTop: '.4rem' }}>
            {cerrada && (
              <div>
                El material que entra vale lo mismo que el que sale: al confirmar no se mueve ni un peso, y al entregar
                se hace el intercambio de material en el kardex.
              </div>
            )}
            {debeElCliente && (
              <div>
                Se cobra la <strong>diferencia</strong>, no el total: {montoMoneda(resumen.total, moneda)} ya están
                pagados en parte con material. De contado entra por las patas de pago de abajo; a crédito se le carga a
                la cuenta corriente del cliente.
              </div>
            )}
            {aFavorDelCliente && (
              <div>
                El cliente entregó material por más de lo que se le vendió. <strong>El sistema no lleva ese saldo a
                favor:</strong> hoy <span className="mono">cuentas_por_cobrar</span> solo aloja deudas del cliente, no
                créditos a su favor. Queda únicamente <strong>anotado en la nota</strong> de este documento y hay que
                acordarlo aparte (descontarlo de la próxima venta, o pagarlo por fuera del módulo).
              </div>
            )}
          </div>
          {aFavorDelCliente && (
            <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: '.4rem' }}
              onClick={anotarSaldoAFavor}>
              ✎ Anotar el saldo a favor en la nota
            </button>
          )}
        </div>

        {/* ── Totales y ganancia del lado que vendo ── */}
        <div className="card" style={{ marginTop: '.75rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}>Totales de lo que entrego</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.2rem' }}>
            <div>Subtotal: <strong className="mono">{montoMoneda(resumen.subtotal, moneda)}</strong></div>
            <div>Descuento: <strong className="mono">− {montoMoneda(resumen.descuento, moneda)}</strong></div>
            {resumen.ivaPct > 0 && <div>IVA ({num(resumen.ivaPct)} %): <strong className="mono">{montoMoneda(resumen.ivaMonto, moneda)}</strong></div>}
            {resumen.igtfPct > 0 && <div>IGTF ({num(resumen.igtfPct)} %): <strong className="mono">{montoMoneda(resumen.igtfMonto, moneda)}</strong></div>}
            <div>Total vendido: <strong className="mono">{montoMoneda(resumen.total, moneda)}</strong></div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.2rem', marginTop: '.4rem' }}>
            <div className="muted">Costo del material: <strong className="mono">{montoMoneda(resumen.costoTotal, moneda)}</strong></div>
            {/* La ganancia va SEPARADA del total a propósito: el total lleva IVA y
                el IVA no es ganancia. */}
            <div>Ganancia estimada:{' '}
              <strong className="mono" style={{ color: resumen.gananciaTotal < 0 ? 'var(--danger)' : 'var(--success, #22c55e)' }}>
                {montoMoneda(resumen.gananciaTotal, moneda)}
              </strong>
            </div>
          </div>
          <small className="muted">
            La ganancia es la del material que sale y no incluye el IVA ni se calcula como total − costo. Se congela al confirmar.
          </small>
        </div>

        {/* ── Patas de pago: contra la DIFERENCIA, nunca contra el total ── */}
        {esContado && debeElCliente && (
          <>
            <h4 style={{ margin: '1rem 0 .5rem' }}>Cobro de la diferencia · ¿en qué cajas entra el dinero?</h4>
            <TablaPagoLegs
              legs={legs} cajas={cajas} saldos={saldos}
              aCobrar={aCobrar} pagado={pagado} falta={falta} legSinCaja={legSinCaja} moneda={moneda}
              onSetLeg={setLeg} onAgregar={agregarLeg} onQuitar={quitarLeg}
              etiquetaObjetivo="de la diferencia"
              textoCuadran="✔ las patas cuadran con la diferencia"
            />
            <small className="muted">
              Las patas suman contra la <strong>diferencia</strong> ({montoMoneda(aCobrar, moneda)}), no contra el total
              vendido ({montoMoneda(resumen.total, moneda)}): parte ya se pagó con material y cobrar el total sería
              cobrar dos veces. Al confirmar entra una entrada de caja por cada forma de pago, atada a esta permuta
              (Tesorería la muestra como «Cobro de venta»).
            </small>
          </>
        )}

        {esContado && !debeElCliente && (
          <div className="card" style={{ marginTop: '.75rem' }}>
            <div className="card-title" style={{ marginBottom: '.25rem' }}>Sin cobro</div>
            <div className="muted" style={{ fontSize: '.82rem' }}>
              {cerrada
                ? 'La balanza cierra en cero: no hay formas de pago que cargar. Al confirmar no se mueve dinero.'
                : 'El saldo queda a favor del cliente, así que no hay nada que cobrar. Este módulo no paga saldos a favor en efectivo.'}
            </div>
          </div>
        )}

        {!esContado && (
          <div className="card" style={{ marginTop: '.75rem', borderColor: 'var(--brand, #ff8a00)' }}>
            <div className="card-title" style={{ marginBottom: '.25rem' }}>Diferencia a crédito</div>
            <div className="muted" style={{ fontSize: '.82rem' }}>
              {debeElCliente ? (
                <>
                  Al confirmar se le cargan <strong className="mono">{montoMoneda(aCobrar, moneda)}</strong> —la
                  diferencia, no el total— a la cuenta corriente del cliente. Esa cuenta es una sola por cliente y
                  acumula todas sus ventas a crédito: los cobros se registran desde Tesorería.
                </>
              ) : cerrada ? (
                'La balanza cierra en cero: no hay deuda que cargarle al cliente.'
              ) : (
                <>
                  El saldo queda <strong>a favor del cliente</strong>, y la cuenta por cobrar no puede alojar eso: solo
                  registra lo que el cliente debe. No se le carga nada; queda anotado en la nota.
                </>
              )}
            </div>
          </div>
        )}

        <div className="form-row" style={{ marginTop: '.75rem' }}>
          <label>Nota / observación <span className="muted">(opcional)</span></label>
          <textarea className="input" rows={3} ref={notaRef} defaultValue={venta?.venta.nota ?? ''}
            placeholder="Qué se pactó en el intercambio (se muestra en el comprobante)…" />
          {aFavorDelCliente && (
            <small className="muted">Aquí es donde tiene que quedar el saldo a favor: el sistema no lo lleva en ningún otro lado.</small>
          )}
        </div>

        {cargando && <p className="muted" style={{ marginTop: '.5rem' }}>Cargando productos, clientes y existencias…</p>}
      </form>

      {fichaPara != null && (
        <NuevaFichaModal
          categorias={categorias}
          unidades={unidades}
          onCancel={() => setFichaPara(null)}
          onCreada={fichaCreada}
        />
      )}

      {pidiendoConfirmar && (
        <ConfirmDialog
          title="Enviar la permuta a autorizar"
          message={
            `Balanza: vendo ${montoMoneda(resumen.total, moneda)}, recibo ${montoMoneda(resumen.valorRecibido, moneda)}, `
            + `diferencia ${montoMoneda(resumen.diferencia, moneda)}. `
            + (debeElCliente
              ? `Al confirmarla se cobra solo la diferencia (${montoMoneda(aCobrar, moneda)}), ${esContado ? 'en la(s) caja(s) elegida(s)' : 'a la cuenta corriente del cliente'}.`
              : cerrada
                ? 'Cierra en cero: al confirmarla no se mueve dinero.'
                : `Queda un saldo a favor del cliente de ${montoMoneda(Math.abs(aCobrar), moneda)} que el sistema no lleva, solo queda en la nota.`)
            + ` Se guarda y le llega un aviso a ${AUTORIZADORES_VENTAS_TEXTO}. No se mueve nada hasta que la autoricen;`
            + ' al ENTREGAR sale lo que vendo y entra el material recibido al inventario, al valor pactado.'
            + (productosSinCosto > 0
              ? ` OJO: ${productosSinCosto === 1 ? 'hay 1 renglón' : `hay ${productosSinCosto} renglones`} con costo en 0, así que la ganancia no es real.`
              : '')
          }
          confirmText="Sí, enviar"
          onConfirm={handleConfirmar}
          onCancel={() => setPidiendoConfirmar(false)}
        />
      )}
    </Modal>
  );
}
