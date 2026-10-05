/* ============================================================
   MGG · Cocina · Panel del Mercado (ciclo de 21 días)

   Se muestra POR CAPAS, de lo macro a lo micro:
     1. La ecuación del ciclo (saldo + entradas = disponible − consumo = queda),
        siempre visible, y el contraste contra el inventario SOLO si no cuadra.
     2. Tres tarjetas con switch —Disponible, Movimientos, Distribución— para
        encender lo que se quiere mirar. Antes los dos bloques venían encima sin
        alternativa y con 50 víveres el scroll era abrumador; ahora lo elige el
        usuario y se recuerda. Ver «Disponible» y «Movimientos» a la vez es tener
        las dos encendidas (ver `vistaMercado.ts`).
     3. El detalle: drill por víver y kardex.

   Los víveres que NO se movieron en el ciclo quedan detrás de un «ver los N
   restantes»: siguen ahí, pero no compiten con lo que sí pasó.
   ============================================================ */
import { Fragment, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { dateTime, money, num } from '@/shared/lib/format';
import { costoDeAlimentar } from './costoPorPlato';
import { LeyendaMercado } from './LeyendaMercado';
import type { CocinaComida, TipoComida } from '@/shared/lib/types';
import { labelTipoComida, TIPOS_COMIDA } from './cocina.repository';
import {
  cerrarMercado, type ResumenMercado, type DisponibleItem, type KardexEntrada, type KardexConsumo,
  type KardexMerma, type KardexRow, type KardexTraslado, type MercadoCocina,
} from './mercados.repository';
import { RepartirMercadoModal } from './RepartirMercadoModal';
import { DistribucionPanel } from './DistribucionPanel';
import { ListaFisicaMercado, SelectorListaMercado, subirListaMercado } from './ListaFisicaMercado';
import {
  describirEvento, explicarSobrante, productosAjustados, separarMovidos,
  type DiferenciaViver, type SalidaFueraDelCiclo,
} from './mercadoComparar';
import { alternarVista, vistaEncendida, TARJETAS_VISTA, type LlaveVista, type Vista } from './vistaMercado';
import { explicarCifra, type ClaveCifra, type DatosCifra } from './explicacionCifra';
import {
  filtrarKardex, hayFiltro, numerosDePagina, paginar, totalesDeKardex,
  CLASES_KARDEX, FILTRO_KARDEX_VACIO, type FiltroKardex,
} from './filtroKardex';

const VISTA_KEY = 'mgg.cocina.mercado.vista';

/** Un cero en una tabla de 50 filas es ruido: se muestra un punto tenue. */
function cifra(n: number): string { return n === 0 ? '·' : num(n); }

/** Un traslado se lee por su signo: «−120» salió del centro, «+120» llegó. */
function conSigno(n: number): string { return n > 0 ? `+${num(n)}` : n < 0 ? `−${num(Math.abs(n))}` : '0'; }

function fmtDia(iso: string): string { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function diaAntes(iso: string): string { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }
/** Hora local de un instante ISO: «16:38». */
function horaDe(iso: string): string { return new Date(iso).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false }); }

export function MercadoPanel({ resumen, mercados, onElegirMercado, cocinaNombre, almacen, canWrite, actor, userEmail, onReload, onEditComida, onDelComida, resguardo = false }: {
  /** Resguardo: almacena y distribuye, no sirve comidas (sin platos ni costo por plato). */
  resguardo?: boolean;
  resumen: ResumenMercado;
  /** Todos los cortes de esta cocina, del más nuevo al más viejo. Alimenta el selector. */
  mercados: MercadoCocina[];
  onElegirMercado: (id: string) => void;
  cocinaNombre: string;
  almacen: string | null;
  canWrite: boolean;
  actor: string;
  userEmail: string | null;
  onReload: () => void | Promise<void>;
  onEditComida: (c: CocinaComida) => void;
  onDelComida: (c: CocinaComida) => void;
}) {
  const { mercado, dia, dias, puedeCerrar, disponible, kardex, totales, diferencias } = resumen;
  const [drill, setDrill] = useState<DisponibleItem | null>(null);
  const [cerrar, setCerrar] = useState(false);
  const [repartir, setRepartir] = useState(false);
  /** La tarjeta del encabezado que se tocó, para explicar de dónde sale su número. */
  const [verCifra, setVerCifra] = useState<ClaveCifra | null>(null);
  /** Todo lo que recorta el kardex. El buscador viejo era solo `texto`. */
  const [filtro, setFiltro] = useState<FiltroKardex>(FILTRO_KARDEX_VACIO);
  const [pagina, setPagina] = useState(1);
  const [verQuietos, setVerQuietos] = useState(false);
  const [soloDif, setSoloDif] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);
  // Víveres cuyo saldo cambió alguien a mano al ajustar. Se marcan en la tabla:
  // «quién ajustó» sin «qué ajustó» obliga a cruzar dos pantallas.
  const ajustados = useMemo(() => productosAjustados(resumen.mercado.historial), [resumen.mercado.historial]);
  // Platos, consumo en dinero y costo por plato: ya venían en `kpis`, sin mostrarse.
  const costo = useMemo(() => costoDeAlimentar(resumen.kpis), [resumen.kpis]);
  const [vista, setVista] = useState<Vista>(() => {
    try { const v = localStorage.getItem(VISTA_KEY); if (v === 'disponible' || v === 'movimientos' || v === 'ambos') return v; } catch { /* modo privado */ }
    return 'disponible';
  });
  function elegirVista(v: Vista) {
    setVista(v);
    try { localStorage.setItem(VISTA_KEY, v); } catch { /* modo privado: no se recuerda, no importa */ }
  }
  function tocarVista(llave: LlaveVista) { elegirVista(alternarVista(vista, llave)); }

  // Los víveres que se movieron en el ciclo van primero; los que solo arrastran
  // saldo quedan detrás de un botón. Con 50 víveres, mostrarlos todos es lo que
  // hace que no se pueda leer nada.
  const { movidos, quietos } = useMemo(() => separarMovidos(disponible), [disponible]);
  const difPorProducto = useMemo(
    () => new Map(diferencias.map((d) => [d.producto_id, d] as const)),
    [diferencias],
  );

  // Un víver puede estar descuadrado SIN haberse movido en el ciclo: arrastra un
  // saldo que el inventario no tiene. Escondido detrás de «ver los que no se
  // movieron», la tira decía «10 víveres» y la tabla mostraba 7 — el descuadre se
  // contaba pero no se podía encontrar. Los quietos con diferencia suben siempre.
  const [quietosConDif, quietosOk] = useMemo(() => {
    const con: DisponibleItem[] = [];
    const sin: DisponibleItem[] = [];
    for (const d of quietos) (difPorProducto.has(d.producto_id) ? con : sin).push(d);
    return [con, sin] as const;
  }, [quietos, difPorProducto]);

  // Con 50 víveres y 10 descuadrados, encontrarlos a ojo entre las barras naranjas
  // es el trabajo que el filtro evita: se pide «solo los descuadrados» y la tabla
  // queda con esos y nada más.
  const filas = useMemo(() => {
    const base = [...movidos, ...quietosConDif];
    if (soloDif) return base.filter((d) => difPorProducto.has(d.producto_id));
    return verQuietos ? [...base, ...quietosOk] : base;
  }, [movidos, quietosConDif, quietosOk, verQuietos, soloDif, difPorProducto]);
  // `labelTipoComida` pide un `TipoComida` y el kardex guarda el tipo como texto:
  // un tipo viejo que ya no esté en la lista se muestra tal cual, no rompe.
  const etiquetaComida = (t: string) => labelTipoComida(t as TipoComida);
  const kardexFiltrado = useMemo(
    () => filtrarKardex(kardex, filtro, etiquetaComida),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `etiquetaComida` es una constante disfrazada
    [kardex, filtro],
  );
  /** Los números del bloque de movimientos: son de lo que está a la vista. */
  const totalesKardex = useMemo(() => totalesDeKardex(kardexFiltrado), [kardexFiltrado]);
  // De a 10. `paginar` corrige sola la página cuando el filtro deja menos: pedir
  // la 8 de una lista que quedó en 3 mostraba el vacío, que se lee como «no hay nada».
  const pag = useMemo(() => paginar(kardexFiltrado, pagina), [kardexFiltrado, pagina]);
  const indices = useMemo(() => numerosDePagina(pag.pagina, pag.paginas), [pag.pagina, pag.paginas]);
  const filtroPuesto = hayFiltro(filtro);
  function cambiarFiltro(parche: Partial<FiltroKardex>) {
    setFiltro((f) => ({ ...f, ...parche }));
    setPagina(1); // otro filtro, otra lista: quedarse en la página 5 no significa nada.
  }

  /** Lo que necesita el modal de una tarjeta para explicar su número. */
  const datosCifra: DatosCifra = {
    totales, costo, mermasValor: resumen.kpis.mermasValor,
    disponible, kardex, dia: Math.min(dia, dias),
    inventarioAl: resumen.inventarioAl ? fmtDia(resumen.inventarioAl) : null,
    num, money, etiquetaComida,
  };

  return (
    <div>
      {/* ── CAPA 1 · La ecuación del ciclo ─────────────────────────────────
          Seis números en el orden en que se leen. Reemplaza a las cuatro tarjetas
          que mezclaban bolívares con platos y no se sumaban entre sí. */}
      <div className="card" style={{ margin: '.3rem 0 .7rem', padding: '.8rem 1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.35rem' }}>
          {/* Con un solo corte el selector sería un desplegable de un elemento: hasta
              que exista el segundo, el título es texto. */}
          {mercados.length > 1 ? (
            <select
              className="select"
              style={{ width: 'auto', fontSize: '.9rem', fontWeight: 700, padding: '.15rem 1.6rem .15rem .4rem' }}
              value={mercado.id}
              onChange={(e) => onElegirMercado(e.target.value)}
              title="Cambiar de mercado"
            >
              {mercados.map((m) => (
                <option key={m.id} value={m.id}>
                  Mercado #{m.numero}{m.estado === 'abierto' ? ' · en curso' : ''}
                </option>
              ))}
            </select>
          ) : (
            <strong style={{ fontSize: '.95rem' }}>Mercado #{mercado.numero}</strong>
          )}
          <span className="muted" style={{ fontSize: '.78rem' }}>
            {fmtDia(mercado.fecha_inicio)}{mercado.inicio_at ? ` ${horaDe(mercado.inicio_at)}` : ''} → {fmtDia(mercado.fecha_fin)}
            {mercado.estado === 'cerrado'
              ? ' · cerrado'
              : ` · día ${Math.min(dia, dias)} de ${dias}`}
          </span>
        </div>

        {/* Quién intervino: sin protagonismo. Es un dato de respaldo para cuando
            alguien pregunta, no algo que haya que leer todos los días — así que va
            en una línea tenue y el detalle con fechas queda a un clic.
            Los mercados anteriores al 02/09/2026 no tienen historial. */}
        {mercado.historial.length > 0 && (
          <div className="dim" style={{ fontSize: '.71rem', marginBottom: '.55rem' }}>
            {mercado.historial.map(describirEvento).join(' · ')}
            <button
              className="btn btn-sm btn-ghost"
              style={{ marginLeft: '.4rem', padding: '0 .3rem', fontSize: '.68rem' }}
              onClick={() => setVerHistorial((v) => !v)}
            >
              {verHistorial ? 'ocultar' : 'cuándo'}
            </button>
            {verHistorial && (
              <ul style={{ margin: '.3rem 0 0', paddingLeft: '1rem' }}>
                {mercado.historial.map((e, i) => (
                  <li key={`${e.at}-${i}`}>
                    {fmtDia(e.at.slice(0, 10))} · {describirEvento(e)}
                    {e.motivo ? ` · «${e.motivo}»` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {/* La ecuación, en tarjetas. Cada una se TOCA y explica de dónde sale su
            número: las mismas tres preguntas volvían por mensaje cada ciclo. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '.5rem' }}>
          <Cifra clave="saldoInicial" rotulo="Saldo inicial" valor={num(totales.saldoInicial)}
            nota="lo que quedó del ciclo anterior" onVer={setVerCifra} />
          <Cifra clave="entradas" rotulo="+ Entradas" valor={num(totales.entradas)} nota="compras del ciclo"
            color="var(--primary-3, #2ecc71)" onVer={setVerCifra} />
          {/* Los traslados en su propia cifra y con signo: «−120» es lo que este centro
              repartió, «+120» lo que le llegó. Mezclados con las entradas, la cocina que
              reparte parecía tener un faltante del tamaño del reparto. */}
          <Cifra clave="traslados" rotulo="± Traslados" valor={conSigno(totales.traslados)}
            nota="− envía, + recibe" color="var(--info)" onVer={setVerCifra} />
          <Cifra clave="disponible" rotulo="= Disponible" valor={num(totales.disponible)}
            nota="saldo + entradas ± traslados" onVer={setVerCifra} />
          {!resguardo && (
            <Cifra clave="consumos" rotulo="− Consumo" valor={num(totales.consumos)} nota="servido en comidas"
              color="var(--danger)" onVer={setVerCifra} />
          )}
          {/* Pérdidas, salidas manuales y ajustes a la baja. Sin esta cifra el libro no las
              restaba y cada pérdida aparecía como un faltante contra el inventario. */}
          <Cifra clave="mermas" rotulo="− Mermas / salidas" valor={num(totales.mermas)}
            nota="dañado, salidas y ajustes" color="var(--warning)" onVer={setVerCifra} />
          <Cifra clave="queda" rotulo="= Queda" valor={num(totales.queda)} nota="pasa al próximo mercado"
            fuerte color="var(--primary-3, #2ecc71)" onVer={setVerCifra} />
        </div>
        {/* Lo que costó dar de comer. La ecuación de arriba se lee en UNIDADES y sirve
            para cuadrar el almacén; esta línea responde la otra pregunta, la del
            presupuesto: cuánto salió el plato. Los tres números ya venían calculados
            en `kpis` y no los mostraba nadie.
            Van en su propia fila y no mezcladas con las de arriba: son otra unidad
            (dinero y platos) y en una sola tira se leerían como si se sumaran. */}
        {/* El resguardo no sirve platos: esta fila solo diría ceros. */}
        {!resguardo && <div style={{
          marginTop: '.5rem',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '.5rem',
        }}>
          <Cifra clave="platos" rotulo="Platos servidos" valor={num(costo.platos)} nota="en este ciclo" onVer={setVerCifra} />
          <Cifra clave="costoConsumo" rotulo="Costo del consumo" valor={money(costo.consumo)}
            nota="víveres servidos" color="var(--danger)" onVer={setVerCifra} />
          <Cifra clave="costoPorPlato" rotulo="Costo por plato"
            valor={costo.porPlato != null ? money(costo.porPlato) : '—'}
            nota={costo.porPlato == null ? 'todavía no se sirvió ningún plato' : 'consumo ÷ platos'}
            color="var(--warning)" fuerte onVer={setVerCifra} />
          {costo.entradas > 0 && (
            <Cifra clave="entradasValoradas" rotulo="Entradas valoradas" valor={money(costo.entradas)}
              nota="lo que costó lo que entró" onVer={setVerCifra} />
          )}
          {/* Lo perdido en dinero, APARTE del costo por plato: una pérdida no es comida servida. */}
          {resumen.kpis.mermasValor > 0 && (
            <Cifra clave="mermasValoradas" rotulo="Mermas valoradas" valor={money(resumen.kpis.mermasValor)}
              nota="aparte del costo por plato" color="var(--warning)" onVer={setVerCifra} />
          )}
        </div>}
        {/* El contraste con el inventario aparece SOLO si no cuadra. Un «0» que
            tranquiliza ocupa lugar y enseña a no mirar. */}
        {totales.diferencia != null && totales.vieresConDiferencia > 0 && (
          <div style={{ marginTop: '.6rem', paddingTop: '.55rem', borderTop: '1px solid var(--border)', fontSize: '.83rem' }}>
            ⚠ Según el inventario{resumen.inventarioAl ? ` al ${fmtDia(resumen.inventarioAl)}` : ''} quedan <strong className="mono">{num(totales.inventario ?? 0)}</strong>
            {' · diferencia '}
            <strong className="mono" style={{ color: totales.diferencia < 0 ? 'var(--danger)' : 'var(--warning)' }}>
              {totales.diferencia > 0 ? '+' : ''}{num(totales.diferencia)}
            </strong>
            {' en '}{totales.vieresConDiferencia} víver{totales.vieresConDiferencia === 1 ? '' : 'es'}
            {/* Un solo botón lleva de la advertencia a los víveres concretos: enciende
                el filtro y, si hacía falta, cambia a la vista que tiene la tabla.
                Antes solo cambiaba de vista y dejaba al analista buscándolos a ojo. */}
            <button
              className={`btn btn-sm ${soloDif ? 'btn-primary' : 'btn-ghost'}`}
              style={{ marginLeft: '.5rem' }}
              onClick={() => {
                const activar = !soloDif;
                setSoloDif(activar);
                if (activar && vista === 'movimientos') elegirVista('disponible');
              }}
            >
              {soloDif ? '↩ Ver todos' : 'Ver solo estos'}
            </button>
          </div>
        )}
        {/* Un traslado que salió y no llegó a ningún almacén NO da diferencia: el libro
            ya lo resta de este centro y el otro nunca lo vio. Por eso se avisa aparte;
            si no, la mercancía perdida en el camino queda muda. */}
        {resumen.trasladosSinLlegada.length > 0 && (
          <div style={{ marginTop: '.6rem', paddingTop: '.55rem', borderTop: '1px solid var(--border)', fontSize: '.83rem' }}>
            <span style={{ color: 'var(--danger)' }}>
              ⚠ {resumen.trasladosSinLlegada.length === 1
                ? '1 traslado salió de este centro y no aparece su llegada'
                : `${resumen.trasladosSinLlegada.length} traslados salieron de este centro y no aparece su llegada`} a ningún almacén
            </span>
            <ul className="dim" style={{ margin: '.25rem 0 0', paddingLeft: '1.1rem', fontSize: '.78rem' }}>
              {resumen.trasladosSinLlegada.slice(0, 6).map((t) => (
                <li key={t.id}>
                  {fmtDia(t.at.slice(0, 10))} · {t.nombre} · <span className="mono">{num(t.sinLlegada)} {t.unidad}</span>
                  {t.contraparte ? ` → ${t.contraparte}` : ''}{t.codigo ? ` · ${t.codigo}` : ''}
                </li>
              ))}
            </ul>
            <div className="hint muted" style={{ marginTop: '.2rem', fontSize: '.74rem' }}>
              No descuadra el mercado: el faltante está en el camino. Se corrige desde Inventario.
            </div>
          </div>
        )}
      </div>

      {/* ── CAPA 2 · Qué se quiere mirar ─────────────────────────────────────
          Tarjetas con switch: la tarjeta entera es el botón, y el switch de la
          derecha dice de un vistazo qué está encendido. Disponible y Movimientos
          se pueden tener juntos; Distribución va sola. */}
      <div className="view-switch" role="group" aria-label="Qué mirar del mercado"
        style={{ display: 'flex', gap: '.5rem', marginBottom: '.8rem', flexWrap: 'wrap' }}>
        {TARJETAS_VISTA.map(({ llave, titulo, detalle }) => {
          const on = vistaEncendida(vista, llave);
          const unica = on && !TARJETAS_VISTA.some((t) => t.llave !== llave && vistaEncendida(vista, t.llave));
          return (
            <button key={llave} type="button" className="card" role="switch" aria-checked={on}
              onClick={() => tocarVista(llave)}
              title={unica ? 'Es lo único encendido: prendé otra tarjeta para poder apagar esta'
                : on ? 'Tocá para apagarlo' : 'Tocá para verlo'}
              style={{
                flex: '1 1 200px', minWidth: 190, maxWidth: 320, padding: '.55rem .7rem',
                background: 'var(--bg-2)', cursor: 'pointer', textAlign: 'left', font: 'inherit',
                display: 'flex', alignItems: 'center', gap: '.6rem',
                borderColor: on ? 'var(--primary, #ff8a00)' : 'var(--border)',
                borderWidth: on ? 2 : 1,
                boxShadow: on ? 'inset 3px 0 0 var(--primary, #ff8a00)' : undefined,
                opacity: on ? 1 : .72,
              }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '.86rem', fontWeight: 600 }}>{titulo}</span>
                <span className="muted" style={{ display: 'block', fontSize: '.7rem' }}>{detalle}</span>
              </span>
              {/* El switch: sin texto, porque el color y la posición del botón ya
                  dicen encendido o apagado, y repetirlo ensucia la tarjeta. */}
              <span aria-hidden="true" style={{
                flex: '0 0 auto', width: 34, height: 19, borderRadius: 999,
                background: on ? 'var(--primary, #ff8a00)' : 'var(--border)',
                position: 'relative', transition: 'background .15s',
              }}>
                <span style={{
                  position: 'absolute', top: 2, left: on ? 17 : 2, width: 15, height: 15,
                  borderRadius: '50%', background: '#fff', transition: 'left .15s',
                }} />
              </span>
            </button>
          );
        })}
      </div>

      {/* Un solo cierre, el día que sea: los movimientos pasan al histórico y lo que
          queda es el saldo inicial del mercado siguiente, que arranca hoy. Hasta el
          30/09/2026 antes del día 22 decía «anticipadamente» y parecía otro trámite.
          Un mercado ya cerrado se está CONSULTANDO desde el selector: ofrecerle
          «cerrar» sería una trampa. */}
      {canWrite && mercado.estado === 'abierto' && (
        <div style={{ marginBottom: '.8rem' }}>
          <button
            className={`btn ${puedeCerrar ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setCerrar(true)}
            title="Cierra el mercado: los movimientos pasan al histórico y lo que queda arranca el mercado siguiente"
          >
            🔒 Cerrar mercado
          </button>
          {/* REPARTIR arma la solicitud de traslado hacia la otra cocina. No mueve stock:
              lo mueve Salidas cuando se autoriza y ejecuta. Va al lado de cerrar porque es
              parte del ciclo, pero NO depende del cierre. */}
          {almacen && (
            <button className="btn btn-ghost" style={{ marginLeft: '.5rem' }} onClick={() => setRepartir(true)}
              title="Trasladar víveres a otra cocina o al resguardo">
              🚚 DISTRIBUCIÓN A OTRA COCINA / RESGUARDO
            </button>
          )}
          {/* Acá había un botón «⊘ Descartar mercado», que cerraba el ciclo SIN
              pasarle el remanente al siguiente. Se quitó el 28/09/2026: tirar a la
              basura lo que quedaba en la despensa no describe nada de lo que pasa
              en la cocina —los víveres siguen ahí— y cada cierre terminaba en una
              discusión sobre kilos que nadie se comió. El cierre ahora siempre
              arrastra lo que hay. Los dos ciclos que ya se descartaron se siguen
              leyendo como se cerraron. */}
        </div>
      )}

      {/* La lista en papel de lo que entró a este mercado (fotos o PDF). */}
      <ListaFisicaMercado mercadoId={mercado.id} actor={actor} soloLectura={!canWrite} />

      {/* Lo que se pidió y todavía no se movió. Sin esto, quien acaba de repartir ve el
          mercado igual que antes y cree que no se guardó. */}
      {mercado.estado === 'abierto' && resumen.repartosPendientes.length > 0 && (
        <div className="card" style={{ marginBottom: '.8rem', padding: '.6rem .9rem', borderLeft: '3px solid var(--info)', fontSize: '.83rem' }}>
          <strong>🚚 Traslados pendientes</strong>
          <span className="muted"> · todavía no mueven el inventario ni el mercado: cuentan cuando Salidas los ejecuta · </span>
          <a href="#/app/salidas">ver en Salidas</a>
          <ul style={{ margin: '.3rem 0 0', paddingLeft: '1.1rem' }}>
            {resumen.repartosPendientes.map((r) => (
              <li key={r.id}>
                <span className="mono">{r.codigo}</span>
                {' · '}{r.estado === 'por_aprobar' ? 'por aprobar' : 'aprobado, falta ejecutarlo'}
                {' · '}{r.sentido === 'sale' ? `sale a ${r.contraparte}` : `llega desde ${r.contraparte}`}
                {' · '}{r.viveres} víver{r.viveres === 1 ? '' : 'es'}
                <span className="muted"> · {fmtDia(r.creado.slice(0, 10))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── CAPA 3a · Disponible a consumir ──────────────────────────────── */}
      {vista === 'distribucion' && (
        <DistribucionPanel resumen={resumen} cocinaId={mercado.cocina_id} cocinaNombre={cocinaNombre} canWrite={canWrite} />
      )}

      {vista !== 'movimientos' && vista !== 'distribucion' && (
      <div className="card" style={{ marginBottom: '.9rem' }}>
        <div className="card-title" style={{ marginBottom: '.5rem' }}>Disponible a consumir <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· saldo inicial + entradas ± traslados − consumos − mermas · tocá un víver para el detalle</span></div>
        {/* Una tabla filtrada que no lo dice se lee como si fuera todo el mercado, y
            ahí el filtro deja de ayudar y empieza a engañar. El aviso lleva su propia
            salida, para no tener que volver a la tira de arriba. */}
        {soloDif && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.5rem', padding: '.4rem .6rem', borderLeft: '3px solid var(--warning)', background: 'var(--bg-2, rgba(255,255,255,.03))', borderRadius: 'var(--r-sm, 4px)', fontSize: '.79rem' }}>
            <span style={{ color: 'var(--warning)' }}>
              Mostrando solo los <strong>{filas.length}</strong> víveres descuadrados de {disponible.length}
            </span>
            <button className="btn btn-sm btn-ghost" onClick={() => setSoloDif(false)}>↩ Ver todos</button>
          </div>
        )}
        {!filas.length ? (
          <p className="hint muted" style={{ margin: 0 }}>
            {soloDif
              ? 'Ya no queda ningún víver descuadrado: el mercado y el inventario coinciden.'
              : 'Sin víveres movidos en este mercado todavía.'}
          </p>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="table" style={{ fontSize: '.83rem' }}>
              <thead><tr>
                <th>Víver</th>
                <th style={{ textAlign: 'right' }}>Saldo inicial</th>
                <th style={{ textAlign: 'right' }}>Entradas</th>
                <th style={{ textAlign: 'right' }}>Traslados</th>
                <th style={{ textAlign: 'right' }}>Disponible</th>
                <th style={{ textAlign: 'right' }}>Consumido</th>
                <th style={{ textAlign: 'right' }}>Mermas / salidas</th>
                <th style={{ textAlign: 'right' }}>Queda</th>
              </tr></thead>
              <tbody>
                {filas.map((d) => {
                  const dif = difPorProducto.get(d.producto_id);
                  const fueAjustado = ajustados.has(d.producto_id);
                  return (
                    // El Fragment lleva la key, no el <tr>: la fila del víver y su
                    // sub-línea de diferencia son DOS <tr> del mismo elemento de la lista.
                    <Fragment key={d.producto_id}>
                      {/* Dos marcas distintas y que no se pisan: el descuadre (naranja)
                          es «esto no cuadra con el almacén»; el ajuste (azul) es
                          «a esta fila la cambió una persona». Una fila puede tener
                          las dos, así que el ajuste se dice además con una etiqueta:
                          dos colores contiguos no se distinguen de memoria. */}
                      <tr className="row-selectable"
                        style={{
                          cursor: 'pointer',
                          ...(dif ? { borderLeft: '3px solid var(--warning)' }
                            : fueAjustado ? { borderLeft: '3px solid var(--info)' } : {}),
                        }}
                        onClick={() => setDrill(d)} title="Ver saldo, entradas y consumos">
                        {/* La unidad va UNA vez, con el nombre: repetirla en cada celda de
                            «Queda» partía el número en dos líneas y multiplicaba el ruido. */}
                        <td>
                          {d.nombre}{' '}
                          <span className="muted mono" style={{ fontSize: '.72rem' }}>{d.unidad}</span>
                          {' '}<span className="dim mono" style={{ fontSize: '.7rem' }}>{d.sku}</span>
                          {fueAjustado && (
                            <span className="badge" style={{ marginLeft: '.35rem', fontSize: '.66rem', color: 'var(--info)', borderColor: 'var(--info)' }}
                              title="El saldo de este víver se ajustó al inventario en un cierre">✎ ajustado</span>
                          )}
                        </td>
                        <td className="mono" style={{ textAlign: 'right' }}>{cifra(d.saldoInicial)}</td>
                        <td className="mono" style={{ textAlign: 'right', color: d.entradas ? 'var(--primary-3, #2ecc71)' : undefined }}>{d.entradas ? `+${num(d.entradas)}` : '·'}</td>
                        <td className="mono" style={{ textAlign: 'right', color: d.traslados ? 'var(--info)' : undefined }}>{d.traslados ? conSigno(d.traslados) : '·'}</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{cifra(d.disponible)}</td>
                        <td className="mono" style={{ textAlign: 'right', color: d.consumos ? 'var(--danger)' : undefined }}>{d.consumos ? `−${num(d.consumos)}` : '·'}</td>
                        <td className="mono" style={{ textAlign: 'right', color: d.mermas ? 'var(--warning)' : undefined }}>{d.mermas ? `−${num(d.mermas)}` : '·'}</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: d.queda <= 0 ? 'var(--danger)' : 'var(--primary-3, #2ecc71)' }}>{num(d.queda)}</td>
                      </tr>
                      {/* La diferencia se dice con NÚMEROS y palabras, no solo con un color:
                          así se lee igual en una captura en blanco y negro. */}
                      {dif && (
                        <tr style={{ borderLeft: '3px solid var(--warning)' }}>
                          <td colSpan={8} style={{ paddingTop: 0, fontSize: '.76rem' }}>
                            <span style={{ color: 'var(--warning)' }}>⚠ en inventario hay <strong className="mono">{num(dif.inventario)}</strong></span>
                            {' · '}
                            {dif.diferencia < 0 ? 'faltan' : 'sobran'} <strong className="mono">{num(Math.abs(dif.diferencia))}</strong> {d.unidad.toLowerCase()}
                            {/* Un SOBRANTE no se explica con salidas, así que se mira
                                la fila del ciclo. El caso grave es el libro en
                                negativo: no sobra comida, falta una entrada. */}
                            {dif.diferencia > 0 && (
                              <span className="dim" style={{ display: 'block', marginTop: '.1rem' }}>
                                ↳ {explicarSobrante(d)}
                              </span>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {/* Los que no se movieron no desaparecen: su stock sigue siendo real. Se
            cuentan los CUADRADOS: los que tienen diferencia ya están arriba, y
            ofrecer «ver 12» para después mostrar 9 es una cuenta que no cierra.
            Con el filtro encendido el botón no va: contradiría al filtro. */}
        {!soloDif && quietosOk.length > 0 && (
          <button className="btn btn-sm btn-ghost" style={{ marginTop: '.5rem' }} onClick={() => setVerQuietos((v) => !v)}>
            {verQuietos ? `Ocultar los ${quietosOk.length} que no se movieron` : `Ver los ${quietosOk.length} víveres que no se movieron`}
          </button>
        )}
      </div>
      )}

      {/* ── CAPA 3b · Kardex: entradas (verde) y consumos (rojo) ───────────
          Sus PROPIAS tarjetas arriba: son los números de lo que está a la vista,
          y cambian con el filtro. Los del encabezado son los del ciclo entero. */}
      {vista !== 'disponible' && vista !== 'distribucion' && (
      <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '.5rem', marginBottom: '.5rem' }}>
        <CifraKardex rotulo="Platos" valor={num(totalesKardex.platos)}
          nota={`${num(totalesKardex.movimientos)} movimiento${totalesKardex.movimientos === 1 ? '' : 's'} · ${filtroPuesto ? 'filtrado' : 'todo el ciclo'}`} />
        <CifraKardex rotulo="Consumo" valor={money(totalesKardex.consumoValor)} color="var(--danger)"
          nota={`costo de víveres · ${totalesKardex.comidas} comida${totalesKardex.comidas === 1 ? '' : 's'}`} />
        <CifraKardex rotulo="Promedio por plato" fuerte color="var(--warning)"
          valor={totalesKardex.porPlato != null ? money(totalesKardex.porPlato) : '—'}
          nota={totalesKardex.porPlato != null ? 'consumo ÷ platos' : 'sin platos servidos acá'} />
        <CifraKardex rotulo="Víveres tocados" valor={num(totalesKardex.viveres)} nota="productos distintos" />
        {totalesKardex.entradasValor > 0 && (
          <CifraKardex rotulo="Entradas" valor={money(totalesKardex.entradasValor)}
            color="var(--primary-3, #2ecc71)" nota="lo que entró, valorado" />
        )}
        {totalesKardex.mermasValor > 0 && (
          <CifraKardex rotulo="Mermas" valor={money(totalesKardex.mermasValor)}
            color="var(--warning)" nota="lo que se perdió" />
        )}
      </div>

      {/* La barra de filtros: fecha, clase, tipo de comida y una caja que busca
          en TODO lo que la fila muestra —incluida la fecha tecleada—. */}
      <div className="card" style={{ marginBottom: '.5rem', padding: '.6rem .8rem', background: 'var(--bg-2)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'flex-end' }}>
          <div className="form-row" style={{ flex: '1 1 140px', margin: 0 }}>
            <label>Desde</label>
            <input className="input" type="date" value={filtro.desde} max={filtro.hasta || undefined}
              onChange={(e) => cambiarFiltro({ desde: e.target.value })} />
          </div>
          <div className="form-row" style={{ flex: '1 1 140px', margin: 0 }}>
            <label>Hasta</label>
            <input className="input" type="date" value={filtro.hasta} min={filtro.desde || undefined}
              onChange={(e) => cambiarFiltro({ hasta: e.target.value })} />
          </div>
          <div className="form-row" style={{ flex: '1 1 180px', margin: 0 }}>
            <label>Tipo de movimiento</label>
            <select className="select" value={filtro.clase}
              onChange={(e) => cambiarFiltro({ clase: e.target.value as FiltroKardex['clase'] })}>
              {CLASES_KARDEX.map((c) => <option key={c.clave} value={c.clave}>{c.label}</option>)}
            </select>
          </div>
          <div className="form-row" style={{ flex: '1 1 150px', margin: 0 }}>
            <label>Tipo de comida</label>
            <select className="select" value={filtro.tipoComida}
              onChange={(e) => cambiarFiltro({ tipoComida: e.target.value })}>
              <option value="">Todas</option>
              {TIPOS_COMIDA.map((t) => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
            </select>
          </div>
          <div className="form-row" style={{ flex: '2 1 240px', margin: 0 }}>
            <label>Búsqueda general</label>
            <input className="input" type="search" value={filtro.texto}
              onChange={(e) => cambiarFiltro({ texto: e.target.value })}
              placeholder="🔍 víver, código, almacén, quién, motivo, 26/09/2026…" />
          </div>
          {filtroPuesto && (
            <button type="button" className="btn btn-ghost"
              onClick={() => { setFiltro(FILTRO_KARDEX_VACIO); setPagina(1); }}>
              ✕ Limpiar
            </button>
          )}
        </div>
        <div className="dim" style={{ fontSize: '.72rem', marginTop: '.35rem' }}>
          La búsqueda mira todo lo que la fila muestra y exige todas las palabras: «pollo 26/09/2026»
          trae el pollo de ese día, no todo el pollo y todo el 26.
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
          <div className="card-title" style={{ margin: 0 }}>Movimientos del mercado <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· entradas, traslados, consumos y mermas</span></div>
          {pag.total > 0 && (
            <span className="muted mono" style={{ fontSize: '.78rem' }}>
              {pag.primero}–{pag.ultimo} de {pag.total}
            </span>
          )}
        </div>
        {!pag.total ? (
          <p className="hint muted" style={{ margin: 0 }}>
            {filtroPuesto
              ? 'Ningún movimiento coincide con el filtro. Probá con «✕ Limpiar».'
              : 'Sin movimientos en este mercado.'}
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
              {pag.items.map((k, i) => k.kind === 'entrada'
                ? <FilaEntrada key={`e${pag.primero + i}`} row={k} />
                : k.kind === 'traslado'
                  ? <FilaTraslado key={`t${k.id}`} row={k} />
                  : k.kind === 'merma'
                  ? <FilaMerma key={`m${pag.primero + i}`} row={k} />
                  : <FilaConsumo key={`c${k.comida.id}`} row={k} canWrite={canWrite} onEdit={() => onEditComida(k.comida)} onDel={() => onDelComida(k.comida)} />)}
            </div>
            {pag.paginas > 1 && (
              <div style={{ display: 'flex', gap: '.25rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', marginTop: '.7rem' }}>
                <button type="button" className="btn btn-sm btn-ghost" disabled={pag.pagina <= 1}
                  onClick={() => setPagina(pag.pagina - 1)}>‹ Anterior</button>
                {indices.map((n, i) => (n === '…'
                  ? <span key={`h${i}`} className="dim" style={{ padding: '0 .2rem' }}>…</span>
                  : <button key={n} type="button" className={`btn btn-sm ${n === pag.pagina ? 'btn-primary' : 'btn-ghost'}`}
                      style={{ minWidth: 34 }} aria-current={n === pag.pagina ? 'page' : undefined}
                      onClick={() => setPagina(n)}>{n}</button>
                ))}
                <button type="button" className="btn btn-sm btn-ghost" disabled={pag.pagina >= pag.paginas}
                  onClick={() => setPagina(pag.pagina + 1)}>Siguiente ›</button>
              </div>
            )}
          </>
        )}
      </div>
      </>
      )}

      {verCifra && <CifraModal clave={verCifra} datos={datosCifra} onClose={() => setVerCifra(null)} />}

      {drill && (
        <DrillModal item={drill} kardex={kardex} fechaInicio={mercado.fecha_inicio} inicioAt={mercado.inicio_at}
          fuera={resumen.salidasFueraDelCiclo.get(drill.producto_id) ?? []}
          diferencia={difPorProducto.get(drill.producto_id) ?? null}
          onClose={() => setDrill(null)} />
      )}
      {repartir && (
        <RepartirMercadoModal resumen={resumen} cocinaNombre={cocinaNombre} almacen={almacen} actor={actor} userEmail={userEmail}
          onClose={() => setRepartir(false)}
          onDone={async () => { setRepartir(false); await onReload(); }} />
      )}

      {cerrar && (
        <CierreModal resumen={resumen} cocinaNombre={cocinaNombre} almacen={almacen} actor={actor} userEmail={userEmail}
          onClose={() => setCerrar(false)}
          onDone={async () => { setCerrar(false); await onReload(); }} />
      )}

      {/* Va al pie y cerrada: las mismas preguntas vuelven cada ciclo, y responderlas
          donde aparece la duda evita el mensaje. Quien ya sabe, no la abre. */}
      <LeyendaMercado />
    </div>
  );
}

/** Un número de la ecuación del ciclo, con su rótulo debajo. */
function Cifra({ clave, rotulo, valor, nota, color, fuerte, onVer }: {
  clave: ClaveCifra; rotulo: string; valor: string; nota?: string; color?: string; fuerte?: boolean;
  onVer: (c: ClaveCifra) => void;
}) {
  return (
    <button type="button" className="card" onClick={() => onVer(clave)}
      title={`Ver de dónde sale ${rotulo.replace(/^[+−±=]\s*/, '')}`}
      style={{
        margin: 0, padding: '.6rem .8rem', background: 'var(--bg-2)', cursor: 'pointer',
        textAlign: 'left', font: 'inherit',
        borderColor: fuerte ? 'var(--primary, #ff8a00)' : 'var(--border)',
        display: 'flex', flexDirection: 'column', gap: '.12rem',
      }}>
      {/* El rótulo primero y en mayúsculas: es lo que dice de qué es el número,
          y con siete tarjetas seguidas leer la cifra sin saber qué mide no sirve. */}
      <div className="muted" style={{ fontSize: '.68rem', letterSpacing: '.06em', textTransform: 'uppercase' }}>{rotulo}</div>
      {/* Cifras tabulares (.mono) para que los dígitos se alineen entre tarjetas
          y entre mercados, cuando se comparan dos cortes uno debajo del otro. */}
      <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 800, lineHeight: 1.15, color }}>{valor}</div>
      {/* Qué es, en palabras. Contestaba «¿y esto de dónde sale?» por mensaje una
          vez por ciclo; ahora lo dice la tarjeta, y el detalle está a un toque. */}
      {nota && <div className="dim" style={{ fontSize: '.7rem' }}>{nota}</div>}
    </button>
  );
}

/**
 * Una tarjeta del bloque de movimientos. Igual que `Cifra` pero sin toque: su
 * número ya ES el detalle —cambia con el filtro— así que no hay nada que abrir.
 */
function CifraKardex({ rotulo, valor, nota, color, fuerte }: {
  rotulo: string; valor: string; nota?: string; color?: string; fuerte?: boolean;
}) {
  return (
    <div className="card" style={{
      margin: 0, padding: '.6rem .8rem', background: 'var(--bg-2)',
      borderColor: fuerte ? 'var(--primary, #ff8a00)' : 'var(--border)',
      display: 'flex', flexDirection: 'column', gap: '.12rem',
    }}>
      <div className="muted" style={{ fontSize: '.68rem', letterSpacing: '.06em', textTransform: 'uppercase' }}>{rotulo}</div>
      <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 800, lineHeight: 1.15, color }}>{valor}</div>
      {nota && <div className="dim" style={{ fontSize: '.7rem' }}>{nota}</div>}
    </div>
  );
}

/** Lo que hay detrás de una tarjeta: la cuenta, el detalle y la aclaración. */
function CifraModal({ clave, datos, onClose }: {
  clave: ClaveCifra; datos: DatosCifra; onClose: () => void;
}) {
  const e = explicarCifra(clave, datos);
  return (
    <Modal title={e.titulo} size="md" onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Entendido</button>}>
      <p style={{ marginTop: 0, fontSize: '.9rem' }}>{e.queEs}</p>
      {e.cuenta && (
        <div className="card mono" style={{
          margin: '0 0 .7rem', padding: '.6rem .8rem', background: 'var(--bg-2)',
          fontSize: '.86rem', overflowX: 'auto', whiteSpace: 'nowrap',
        }}>
          {e.cuenta}
        </div>
      )}
      {e.tituloLista && e.renglones.length > 0 && (
        <>
          <div className="muted" style={{ fontSize: '.7rem', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: '.3rem' }}>
            {e.tituloLista}
          </div>
          <table className="table" style={{ fontSize: '.83rem', marginBottom: '.5rem' }}>
            <tbody>
              {e.renglones.map((r, i) => (
                <tr key={`${r.nombre}-${i}`}>
                  <td>{r.nombre}{r.nota ? <span className="dim" style={{ fontSize: '.74rem' }}> · {r.nota}</span> : null}</td>
                  <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{r.valor}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {e.restantes > 0 && (
            <p className="dim" style={{ margin: '0 0 .5rem', fontSize: '.76rem' }}>
              y {e.restantes} víver{e.restantes === 1 ? '' : 'es'} más · la tabla de abajo los tiene todos
            </p>
          )}
        </>
      )}
      {e.ojo && <p className="hint muted" style={{ margin: 0 }}>{e.ojo}</p>}
    </Modal>
  );
}

/* ───────── Fila de kardex: ENTRADA (verde) ───────── */
function FilaEntrada({ row }: { row: KardexEntrada }) {
  return (
    <div className="card" style={{ margin: 0, padding: '.5rem .7rem', borderLeft: '4px solid var(--primary-3, #2ecc71)', display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '.86rem' }}><span style={{ color: 'var(--primary-3, #2ecc71)' }}>⬇ Entrada</span> · {row.nombre}</div>
        <div className="muted" style={{ fontSize: '.74rem' }}>{dateTime(row.at)}{row.almacen ? ` · 📦 ${row.almacen}` : ''}{row.detalle ? ` · ${row.detalle}` : ''}</div>
      </div>
      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div className="mono" style={{ fontWeight: 800, color: 'var(--primary-3, #2ecc71)' }}>+{num(row.cantidad)} {row.unidad}</div>
        {row.valor > 0 && <div className="muted mono" style={{ fontSize: '.74rem' }}>{money(row.valor)}</div>}
      </div>
    </div>
  );
}

/* ───────── Fila de kardex: TRASLADO (azul; rojo si no llegó) ───────── */
function FilaTraslado({ row }: { row: KardexTraslado }) {
  const sale = row.cantidad < 0;
  return (
    <div className="card" style={{ margin: 0, padding: '.5rem .7rem', borderLeft: `4px solid ${row.sinLlegada > 0 ? 'var(--danger)' : 'var(--info)'}`, display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '.86rem' }}>
          <span style={{ color: 'var(--info)' }}>↔ Traslado</span> · {row.nombre}
          {row.codigo && <span className="badge mono" style={{ marginLeft: '.35rem', fontSize: '.64rem' }}>{row.codigo}</span>}
        </div>
        <div className="muted" style={{ fontSize: '.74rem' }}>
          {dateTime(row.at)}{row.almacen ? ` · 📦 ${row.almacen}` : ''}
          {row.contraparte ? (sale ? ` → ${row.contraparte}` : ` ← ${row.contraparte}`) : ''}
          {row.interno ? ' · dentro del centro' : ''}
        </div>
        {row.sinLlegada > 0 && (
          <div style={{ fontSize: '.74rem', color: 'var(--danger)' }}>
            ⚠ no aparece la llegada de {num(row.sinLlegada)} {row.unidad} a ningún almacén
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div className="mono" style={{ fontWeight: 800, color: 'var(--info)' }}>{conSigno(row.cantidad)} {row.unidad}</div>
        {row.valor !== 0 && <div className="muted mono" style={{ fontSize: '.74rem' }}>{money(Math.abs(row.valor))}</div>}
      </div>
    </div>
  );
}

/* ───────── Fila de kardex: MERMA / SALIDA (naranja) ───────── */
function FilaMerma({ row }: { row: KardexMerma }) {
  return (
    <div className="card" style={{ margin: 0, padding: '.5rem .7rem', borderLeft: '4px solid var(--warning)', display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '.86rem' }}>
          <span style={{ color: 'var(--warning)' }}>⚠ Merma / salida</span> · {row.nombre}
          <span className="badge" style={{ marginLeft: '.35rem', fontSize: '.64rem' }}>{row.tipo}</span>
        </div>
        <div className="muted" style={{ fontSize: '.74rem' }}>
          {dateTime(row.at)}{row.almacen ? ` · 📦 ${row.almacen}` : ''}{row.actor_name ? ` · ${row.actor_name}` : ''}
          {row.detalle
            ? <> · {row.detalle}</>
            : <span style={{ fontStyle: 'italic' }}> · sin motivo escrito</span>}
        </div>
      </div>
      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div className="mono" style={{ fontWeight: 800, color: 'var(--warning)' }}>−{num(row.cantidad)} {row.unidad}</div>
        {row.valor > 0 && <div className="muted mono" style={{ fontSize: '.74rem' }}>{money(row.valor)}</div>}
      </div>
    </div>
  );
}

/* ───────── Fila de kardex: CONSUMO (rojo, expandible) ───────── */
function FilaConsumo({ row, canWrite, onEdit, onDel }: { row: KardexConsumo; canWrite: boolean; onEdit: () => void; onDel: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const c = row.comida;
  const t = TIPOS_COMIDA.find((x) => x.value === c.tipo_comida);
  return (
    <div className="card" style={{ margin: 0, padding: '.5rem .7rem', borderLeft: '4px solid var(--danger)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ minWidth: 0, cursor: 'pointer' }} onClick={() => setAbierto((v) => !v)}>
          <div style={{ fontWeight: 600, fontSize: '.86rem' }}>
            <span style={{ color: 'var(--danger)' }}>⬆ Consumo</span> · <span className="mono">{c.codigo}</span> · {t?.icon} {labelTipoComida(c.tipo_comida)}
          </div>
          <div className="muted" style={{ fontSize: '.74rem' }}>{dateTime(c.at)} · {num(c.platos)} platos · {(c.items ?? []).length} víver(es) {abierto ? '▾' : '▸'}</div>
        </div>
        <div style={{ textAlign: 'right', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
          <span className="mono" style={{ fontWeight: 800, color: 'var(--danger)' }}>{money(c.valor_total)}</span>
          {canWrite && <>
            <button className="btn btn-sm btn-ghost" onClick={onEdit} title="Editar comida">✎</button>
            <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={onDel} title="Eliminar comida">🗑</button>
          </>}
        </div>
      </div>
      {abierto && (
        <ul className="muted" style={{ margin: '.4rem 0 0', paddingLeft: '1.1rem', fontSize: '.78rem' }}>
          {(c.items ?? []).map((it, j) => <li key={j}>{it.nombre} · {num(it.cantidad)} {it.unidad} · {money(it.subtotal)}</li>)}
        </ul>
      )}
    </div>
  );
}

/* ───────── Drill-down de un víver: saldo inicial + entradas + consumos ───────── */
function DrillModal({ item, kardex, fechaInicio, inicioAt, fuera, diferencia, onClose }: {
  item: DisponibleItem;
  kardex: KardexRow[];
  fechaInicio: string;
  /** Instante exacto de apertura, si lo tiene: el saldo es el inventario de ese momento. */
  inicioAt: string | null;
  /** Las mermas / salidas de este víver: pérdidas, salidas manuales y ajustes a la baja. */
  fuera: SalidaFueraDelCiclo[];
  /** inventario − libro para este víver. `null` si cuadra o si el mercado está cerrado. */
  diferencia: DiferenciaViver | null;
  onClose: () => void;
}) {
  const entradas = kardex.filter((k): k is KardexEntrada => k.kind === 'entrada' && k.producto_id === item.producto_id);
  const traslados = kardex.filter((k): k is KardexTraslado => k.kind === 'traslado' && k.producto_id === item.producto_id);
  const consumos = kardex
    .filter((k): k is KardexConsumo => k.kind === 'consumo')
    .map((k) => ({ comida: k.comida, item: (k.comida.items ?? []).find((it) => it.producto_id === item.producto_id) }))
    .filter((x) => x.item);

  return (
    <Modal title={`Víver · ${item.nombre}`} size="lg" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <div className="card" style={{ margin: '0 0 .8rem', background: 'var(--bg-2)', fontSize: '.9rem' }}>
        {inicioAt
          ? <div>Al abrir, el <strong>{fmtDia(fechaInicio)} a las {horaDe(inicioAt)}</strong>, había <strong className="mono">{num(item.saldoInicial)} {item.unidad}</strong></div>
          : <div>Hasta el <strong>{fmtDia(diaAntes(fechaInicio))}</strong>: quedaban <strong className="mono">{num(item.saldoInicial)} {item.unidad}</strong></div>}
        <div>+ entradas desde {inicioAt ? 'la apertura' : <>el <strong>{fmtDia(fechaInicio)}</strong></>}: <strong className="mono" style={{ color: 'var(--primary-3, #2ecc71)' }}>{num(item.entradas)} {item.unidad}</strong></div>
        {item.traslados !== 0 && (
          <div>
            ± traslados: <strong className="mono" style={{ color: 'var(--info)' }}>{conSigno(item.traslados)} {item.unidad}</strong>
            <span className="muted"> ({item.traslados < 0 ? 'este centro envió más de lo que recibió' : 'este centro recibió más de lo que envió'})</span>
          </div>
        )}
        <div style={{ marginTop: '.2rem' }}>= <strong>TOTAL DISPONIBLE A CONSUMIR</strong>: <strong className="mono" style={{ fontSize: '1.05rem' }}>{num(item.disponible)} {item.unidad}</strong></div>
        <div className="muted">− consumido: <strong className="mono" style={{ color: 'var(--danger)' }}>{num(item.consumos)} {item.unidad}</strong>
          {item.mermas !== 0 && <> · − mermas / salidas: <strong className="mono" style={{ color: 'var(--warning)' }}>{num(item.mermas)} {item.unidad}</strong></>}
          {' '}· queda: <strong className="mono" style={{ color: item.queda <= 0 ? 'var(--danger)' : 'var(--primary-3, #2ecc71)' }}>{num(item.queda)} {item.unidad}</strong></div>

        {/* EL CONTRASTE Y SU DIAGNÓSTICO, donde se viene a entender el víver. La
            tabla ya lo avisa, pero acá es donde uno llega buscando el porqué. */}
        {diferencia && (
          <div style={{ marginTop: '.45rem', paddingTop: '.4rem', borderTop: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--warning)' }}>
              ⚠ en inventario hay <strong className="mono">{num(diferencia.inventario)} {item.unidad}</strong>
              {' · '}{diferencia.diferencia < 0 ? 'faltan' : 'sobran'}{' '}
              <strong className="mono">{num(Math.abs(diferencia.diferencia))} {item.unidad}</strong>
            </span>
            {diferencia.diferencia > 0 && (
              <div className="dim" style={{ fontSize: '.8rem', marginTop: '.15rem' }}>↳ {explicarSobrante(item)}</div>
            )}
          </div>
        )}
      </div>

      <h4 style={{ margin: '.6rem 0 .35rem', color: 'var(--primary-3, #2ecc71)' }}>Entradas ({entradas.length})</h4>
      {!entradas.length ? <p className="hint muted" style={{ margin: 0 }}>Sin entradas nuevas en este mercado.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          {entradas.map((e, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '.25rem', fontSize: '.83rem' }}>
              <span className="muted">{dateTime(e.at)}{e.almacen ? ` · 📦 ${e.almacen}` : ''}</span>
              <span className="mono" style={{ color: 'var(--primary-3, #2ecc71)' }}>+{num(e.cantidad)} {e.unidad}</span>
            </div>
          ))}
        </div>
      )}

      {/* Los traslados al mismo nivel que entradas y consumos: son parte del libro. */}
      <h4 style={{ margin: '.8rem 0 .35rem', color: 'var(--info)' }}>Traslados ({traslados.length})</h4>
      {!traslados.length ? <p className="hint muted" style={{ margin: 0 }}>Sin traslados de este víver en este mercado.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          {traslados.map((t) => (
            <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '.25rem', fontSize: '.83rem' }}>
              <span className="muted">
                {dateTime(t.at)}{t.almacen ? ` · 📦 ${t.almacen}` : ''}
                {t.contraparte ? (t.cantidad < 0 ? ` → ${t.contraparte}` : ` ← ${t.contraparte}`) : ''}
                {t.codigo ? ` · ${t.codigo}` : ''}
                {t.sinLlegada > 0 && <span style={{ color: 'var(--danger)' }}> · no aparece la llegada</span>}
              </span>
              <span className="mono" style={{ color: 'var(--info)', whiteSpace: 'nowrap' }}>{conSigno(t.cantidad)} {t.unidad}</span>
            </div>
          ))}
        </div>
      )}

      <h4 style={{ margin: '.8rem 0 .35rem', color: 'var(--danger)' }}>Consumos ({consumos.length})</h4>
      {!consumos.length ? <p className="hint muted" style={{ margin: 0 }}>Sin consumos de este víver.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          {consumos.map(({ comida, item: it }, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '.25rem', fontSize: '.83rem' }}>
              <span><span className="mono">{comida.codigo}</span> · {labelTipoComida(comida.tipo_comida)} · <span className="muted">{dateTime(comida.at)}</span></span>
              <span className="mono" style={{ color: 'var(--danger)' }}>−{num(it?.cantidad ?? 0)} {it?.unidad ?? ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* MERMAS / SALIDAS, al mismo nivel que entradas y consumos: restan del libro.
          Una por una, con quién y por qué: el total solo no dice si fue una pérdida
          o una salida mal cargada. */}
      <h4 style={{ margin: '.8rem 0 .35rem', color: 'var(--warning)' }}>
        Mermas / salidas ({fuera.length})
      </h4>
      {!fuera.length ? (
        <p className="hint muted" style={{ margin: 0 }}>Ninguna: todo lo que salió pasó por una comida o un traslado.</p>
      ) : (
        <>
          <p className="hint muted" style={{ margin: '0 0 .35rem' }}>
            Pérdidas, salidas manuales y ajustes a la baja. <strong>Restan de lo que queda</strong>, pero no son consumo: no suben el costo por plato.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
            {fuera.map((f, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '.25rem', fontSize: '.83rem' }}>
                <span>
                  <span className="badge" style={{ fontSize: '.66rem', marginRight: '.35rem' }}>{f.tipo}</span>
                  <span className="muted">{dateTime(f.at)}</span>
                  {f.actor_name ? <span className="muted"> · {f.actor_name}</span> : null}
                  {/* El detalle es lo único que explica un movimiento manual, y
                      justo en los que motivaron esto venía vacío. */}
                  {f.detalle
                    ? <span className="dim"> · {f.detalle}</span>
                    : <span className="dim" style={{ fontStyle: 'italic' }}> · sin motivo escrito</span>}
                </span>
                <span className="mono" style={{ color: 'var(--warning)', whiteSpace: 'nowrap' }}>−{num(f.cantidad)} {item.unidad}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

/* ───────── Modal de cierre: preview PDF + correo + confirmar ───────── */
function CierreModal({ resumen, cocinaNombre, almacen, actor, userEmail, onClose, onDone }: {
  resumen: ResumenMercado; cocinaNombre: string; almacen: string | null; actor: string; userEmail: string | null;
  onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const { mercado, kpis, disponible, totales, diferencias } = resumen;
  const remanente = disponible.filter((d) => d.queda > 0);
  const [correos, setCorreos] = useState('');
  /** Lista física de lo que entra al mercado NUEVO: se sube cuando ya tiene id. */
  const [listaFisica, setListaFisica] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El ajuste solo EXISTE si hay diferencia. Cuando todo cuadra, el modal es un
  // resumen y un botón: sin opciones, sin motivo, sin fricción.
  const hayDiferencia = diferencias.length > 0;
  const [ajustar, setAjustar] = useState(true);   // por defecto ajustar: es lo que ya se hacía a mano
  const [motivo, setMotivo] = useState('');

  // Snapshot "previo" para la vista previa del PDF (mismos datos que persiste el cierre).
  const snapshotPreview = useMemo(() => ({
    generado_en: new Date().toISOString(),
    desde: `${mercado.fecha_inicio}T00:00:00`, hasta: `${mercado.fecha_fin}T23:59:59`,
    totales: { platos: kpis.platos, valor: kpis.consumoValor, entradasValor: kpis.entradasValor },
    consumos: disponible.filter((d) => d.consumos > 0).map((d) => ({ producto_id: d.producto_id, sku: d.sku, nombre: d.nombre, unidad: d.unidad, cantidad: d.consumos, valor: Math.round(d.consumos * d.precio * 100) / 100 })),
    entradas: disponible.filter((d) => d.entradas > 0).map((d) => ({ producto_id: d.producto_id, sku: d.sku, nombre: d.nombre, unidad: d.unidad, cantidad: d.entradas, valor: Math.round(d.entradas * d.precio * 100) / 100 })),
    traslados: disponible.filter((d) => d.traslados !== 0).map((d) => ({ producto_id: d.producto_id, sku: d.sku, nombre: d.nombre, unidad: d.unidad, cantidad: d.traslados, valor: Math.round(d.traslados * d.precio * 100) / 100 })),
    mermas: disponible.filter((d) => d.mermas > 0).map((d) => ({ producto_id: d.producto_id, sku: d.sku, nombre: d.nombre, unidad: d.unidad, cantidad: d.mermas, valor: Math.round(d.mermas * d.precio * 100) / 100 })),
    remanente: remanente.map((d) => ({ producto_id: d.producto_id, sku: d.sku, nombre: d.nombre, unidad: d.unidad, cantidad: d.queda })),
  }), [mercado, kpis, disponible, remanente]);

  async function verPdf() {
    try {
      const { descargarCierrePdf } = await import('./mercadoCierrePdf');
      await descargarCierrePdf(cocinaNombre, mercado, snapshotPreview);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  async function confirmar() {
    setError(null); setSaving(true);
    try {
      const { cerrado, siguiente, snapshot } = await cerrarMercado(mercado, almacen, actor, userEmail,
        hayDiferencia ? { ajustarAInventario: ajustar, motivo } : undefined);
      // La lista física va al mercado que ARRANCA: es lo que entró para él. Si falla,
      // el cierre ya quedó hecho y se avisa qué no subió.
      await subirListaMercado(siguiente.id, listaFisica, actor).catch(() => { /* subirListaMercado ya avisa */ });
      // Siempre genera el PDF del cierre (vista previa).
      try {
        const { descargarCierrePdf } = await import('./mercadoCierrePdf');
        await descargarCierrePdf(cocinaNombre, cerrado, snapshot);
      } catch { /* si el PDF falla, el cierre igual quedó hecho */ }
      // Correo OPCIONAL: solo si se cargaron destinatarios.
      const lista = correos.split(/[;,\s]+/).map((s) => s.trim()).filter(Boolean);
      if (lista.length) {
        try {
          const { enviarCierrePorCorreo } = await import('./enviarCierreCocina');
          const { destinatarios } = await enviarCierrePorCorreo(cocinaNombre, cerrado, snapshot, lista);
          toast(`Mercado cerrado · PDF generado · enviado a ${destinatarios.join(', ')}`, 'success');
        } catch (e) {
          toast(`Mercado cerrado y PDF generado, pero el correo falló: ${e instanceof Error ? e.message : ''}`, 'warning');
        }
      } else {
        toast('Mercado cerrado · PDF generado. Se abrió el siguiente con el saldo arrastrado.', 'success');
      }
      notify(`🔒 Cocina · mercado #${mercado.numero} de ${cocinaNombre} cerrado`, 'info', { link: '#/app/cocina' });
      await onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cerrar el mercado'); setSaving(false); }
  }

  return (
    <Modal title={`Cerrar mercado #${mercado.numero} · ${cocinaNombre}`} size="lg" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-ghost" onClick={verPdf} disabled={saving}>↓ Ver PDF</button>
        <button className="btn btn-primary" onClick={() => void confirmar()}
          disabled={saving || (hayDiferencia && ajustar && motivo.trim().length < 5)}
          title={hayDiferencia && ajustar && motivo.trim().length < 5 ? 'Escribí el motivo del ajuste' : undefined}>
          {saving ? 'Cerrando…' : '🔒 Cerrar mercado'}
        </button>
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
      <p className="hint muted" style={{ marginTop: 0 }}>
        Se cierra el mercado <strong>#{mercado.numero}</strong> ({fmtDia(mercado.fecha_inicio)} → {fmtDia(mercado.fecha_fin)}), se <strong>genera el PDF</strong> del cierre y <strong>lo que queda pasa como saldo inicial del próximo mercado</strong>. No mueve el inventario real. El correo es opcional.
      </p>
      <div className="card" style={{ margin: '0 0 .8rem', background: 'var(--bg-2)' }}>
        <div style={{ fontSize: '.88rem' }}>Platos: <strong className="mono">{num(kpis.platos)}</strong> · Consumo: <strong className="mono" style={{ color: 'var(--danger)' }}>{money(kpis.consumoValor)}</strong> · Remanente: <strong className="mono" style={{ color: 'var(--primary-3, #2ecc71)' }}>{money(kpis.disponibleValor)}</strong></div>
        <div className="muted" style={{ fontSize: '.8rem', marginTop: '.2rem' }}>{remanente.length} víver(es) pasan al próximo mercado.</div>
      </div>

      {/* ── El ajuste: SOLO cuando el libro y el almacén no coinciden ──────────
          No se escribe ningún movimiento de inventario. Si los dos difieren es
          porque algo se movió por fuera del ciclo y el inventario YA lo contó:
          escribirlo otra vez lo contaría dos veces. Lo único que se decide acá es
          con qué número arranca el mercado siguiente. */}
      {hayDiferencia && (
        <div className="card" style={{ margin: '0 0 .8rem', borderColor: 'var(--warning)' }}>
          <div style={{ fontWeight: 600, marginBottom: '.4rem' }}>
            ⚠ El mercado y el inventario no coinciden
          </div>
          <div style={{ fontSize: '.86rem', marginBottom: '.5rem' }}>
            Según el mercado quedan <strong className="mono">{num(totales.queda)}</strong> ·
            {' '}según el inventario{resumen.inventarioAl ? ` al ${fmtDia(resumen.inventarioAl)}` : ''} <strong className="mono">{num(totales.inventario ?? 0)}</strong> ·
            {' diferencia '}
            <strong className="mono" style={{ color: (totales.diferencia ?? 0) < 0 ? 'var(--danger)' : 'var(--warning)' }}>
              {(totales.diferencia ?? 0) > 0 ? '+' : ''}{num(totales.diferencia ?? 0)}
            </strong>
            {' en '}{diferencias.length} víver{diferencias.length === 1 ? '' : 'es'}
          </div>
          <div className="table-wrap" style={{ maxHeight: 180, overflowY: 'auto', marginBottom: '.6rem' }}>
            <table className="table" style={{ fontSize: '.8rem' }}>
              <thead><tr>
                <th>Víver</th>
                <th style={{ textAlign: 'right' }}>Mercado</th>
                <th style={{ textAlign: 'right' }}>Inventario</th>
                <th style={{ textAlign: 'right' }}>Diferencia</th>
              </tr></thead>
              <tbody>
                {diferencias.map((d) => (
                  <tr key={d.producto_id} style={{ borderLeft: '3px solid var(--warning)' }}>
                    <td>{d.nombre} <span className="muted mono" style={{ fontSize: '.72rem' }}>{d.unidad}</span></td>
                    <td className="mono" style={{ textAlign: 'right' }}>{num(d.mercado)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{num(d.inventario)}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: d.diferencia < 0 ? 'var(--danger)' : 'var(--warning)' }}>
                      {d.diferencia > 0 ? '+' : ''}{num(d.diferencia)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label style={{ display: 'flex', gap: '.45rem', alignItems: 'flex-start', cursor: 'pointer', marginBottom: '.35rem' }}>
            <input type="radio" checked={ajustar} onChange={() => setAjustar(true)} style={{ marginTop: '.25rem' }} />
            <span style={{ fontSize: '.86rem' }}>
              <strong>Ajustar al inventario</strong> ({num(totales.inventario ?? 0)}{resumen.inventarioAl ? ` al ${fmtDia(resumen.inventarioAl)}` : ''}) — el mercado siguiente arranca del stock real
            </span>
          </label>
          <label style={{ display: 'flex', gap: '.45rem', alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="radio" checked={!ajustar} onChange={() => setAjustar(false)} style={{ marginTop: '.25rem' }} />
            <span style={{ fontSize: '.86rem' }}>
              Cerrar con el remanente del mercado ({num(totales.queda)}) — la diferencia queda anotada y se arrastra
            </span>
          </label>
          {ajustar && (
            <div className="form-row" style={{ marginTop: '.55rem' }}>
              <label>Motivo del ajuste <span style={{ color: 'var(--danger)' }}>*</span></label>
              <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej.: conteo del 11/09 con la cocina · salida no imputada al ciclo" />
              <small className="hint muted" style={{ fontSize: '.72rem' }}>
                Queda guardado en el cierre. Sin esto, dentro de cuatro meses el número no se puede auditar.
              </small>
            </div>
          )}
        </div>
      )}
      <SelectorListaMercado archivos={listaFisica} onChange={setListaFisica} disabled={saving} />
      <div className="form-row">
        <label>📧 Enviar por correo <span className="muted" style={{ fontWeight: 400 }}>· opcional (dejalo vacío para solo cerrar y generar el PDF)</span></label>
        <input className="input" value={correos} onChange={(e) => setCorreos(e.target.value)} placeholder="correo1@mgg.com, correo2@mgg.com" />
      </div>
    </Modal>
  );
}

