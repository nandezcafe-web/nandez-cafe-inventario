// Contabilidad de costos por lote de café.
//
// La idea es una sola: el café entra por compra o cosecha con un costo, y cada
// proceso le suma costos y le quita kg. Dividiendo costo acumulado entre kg
// reales que salieron se obtiene el costo por kg en cada estado. Ese número es
// el que manda para fijar precios y para valorizar el inventario.
//
// Método: costo promedio ponderado por estado. Si se tuestan dos tandas del
// mismo lote con costos distintos, el kg tostado del lote vale el promedio.

import { ESTADOS_CAFE, ESTADOS_CAFE_INFO, TRANSICIONES, PERFILES_TUESTE } from '../conocimiento/procesos_cafe.js';
import { invalido } from './errores.js';

const r0 = (n) => Math.round(n);
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

const CAMPOS_COSTO_PROCESO = [
  'maquila_cop', 'mano_obra_cop', 'energia_cop', 'insumos_cop',
  'empaque_cop', 'transporte_cop', 'otros_cop',
];

export function costoEntradaLote(lote) {
  const valorCompra = lote.valor_compra_cop
    ?? (lote.precio_cop_kg != null && lote.kg_inicial != null ? lote.precio_cop_kg * lote.kg_inicial : 0);
  return {
    valor_compra_cop: r0(valorCompra ?? 0),
    costo_transporte_cop: r0(lote.costo_transporte_cop ?? 0),
    otros_costos_cop: r0(lote.otros_costos_cop ?? 0),
    total_cop: r0((valorCompra ?? 0) + (lote.costo_transporte_cop ?? 0) + (lote.otros_costos_cop ?? 0)),
    cop_por_kg: lote.kg_inicial
      ? r2(((valorCompra ?? 0) + (lote.costo_transporte_cop ?? 0) + (lote.otros_costos_cop ?? 0)) / lote.kg_inicial)
      : null,
  };
}

function costoDirectoProceso(p) {
  const bruto = CAMPOS_COSTO_PROCESO.reduce((s, c) => s + (p[c] ?? 0), 0);
  return { bruto, credito: p.valor_subproducto_cop ?? 0, neto: bruto - (p.valor_subproducto_cop ?? 0) };
}

// Rango de rendimiento esperado para un proceso, según su tipo y perfil.
function rangoEsperado(p) {
  if (p.tipo === 'tueste' && p.perfil_tueste && PERFILES_TUESTE[p.perfil_tueste]) {
    return PERFILES_TUESTE[p.perfil_tueste].rendimiento;
  }
  return TRANSICIONES[p.tipo]?.rendimiento ?? null;
}

// Cadena completa de un lote: entrada, cada proceso, costo por kg por estado,
// inventario disponible y avisos cuando un pesaje se sale de lo esperado.
export function cadenaCostoLote(db, loteId) {
  const lote = db.prepare('SELECT * FROM lotes_cafe WHERE id = ?').get(loteId);
  if (!lote) return null;

  const procesos = db
    .prepare('SELECT * FROM procesos_cafe WHERE lote_cafe_id = ? ORDER BY fecha ASC, id ASC')
    .all(loteId);
  const ventas = db
    .prepare(`SELECT v.*, pr.gramos AS pres_gramos, pr.estado_cafe AS pres_estado, pr.nombre AS pres_nombre
              FROM ventas v LEFT JOIN presentaciones pr ON pr.id = v.presentacion_id
              WHERE v.lote_cafe_id = ? ORDER BY v.fecha ASC, v.id ASC`)
    .all(loteId);
  const gastosLote = db
    .prepare("SELECT * FROM gastos WHERE lote_cafe_id = ? AND COALESCE(tipo_costo,'operativo') = 'operativo'")
    .all(loteId);

  const entrada = costoEntradaLote(lote);
  const avisos = [];

  // Estado del inventario por etapa.
  const estados = new Map();
  const bucket = (e) => {
    if (!estados.has(e)) estados.set(e, { estado: e, kg_producido: 0, costo_producido: 0, kg_consumido: 0, kg_vendido: 0 });
    return estados.get(e);
  };

  const inicial = bucket(lote.estado_inicial);
  inicial.kg_producido += lote.kg_inicial ?? 0;
  inicial.costo_producido += entrada.total_cop;

  const costoKg = (b) => (b.kg_producido > 0 ? b.costo_producido / b.kg_producido : 0);

  const pasos = [];
  for (const p of procesos) {
    const bEnt = bucket(p.estado_entrada);
    const bSal = bucket(p.estado_salida);
    const directo = costoDirectoProceso(p);
    const unitEntrada = costoKg(bEnt);
    const kgEntrada = p.kg_entrada ?? 0;

    const disponibleAntes = bEnt.kg_producido - bEnt.kg_consumido - bEnt.kg_vendido;
    if (kgEntrada > disponibleAntes + 0.01) {
      avisos.push({
        nivel: 'alta',
        texto: `Proceso #${p.id} (${p.tipo}, ${p.fecha}) toma ${r2(kgEntrada)} kg de ${ESTADOS_CAFE_INFO[p.estado_entrada]?.nombre ?? p.estado_entrada} pero solo había ${r2(disponibleAntes)} kg disponibles. Revisar los pesos.`,
      });
    }

    // kg de salida: lo medido manda; si falta, se estima con el rendimiento de referencia.
    const rango = rangoEsperado(p);
    const estimado = p.kg_salida == null;
    const kgSalida = p.kg_salida ?? (rango ? kgEntrada * rango.tipico : kgEntrada);
    if (estimado) {
      avisos.push({
        nivel: 'media',
        texto: `Proceso #${p.id} (${p.tipo}, ${p.fecha}) no tiene kg de salida: se estimó ${r2(kgSalida)} kg con el rendimiento de referencia. Pesar y corregir.`,
      });
    }

    const costoHeredado = kgEntrada * unitEntrada;
    const costoAcumulado = costoHeredado + directo.neto;

    bEnt.kg_consumido += kgEntrada;
    bSal.kg_producido += kgSalida;
    bSal.costo_producido += costoAcumulado;

    const rendimiento = kgEntrada > 0 ? kgSalida / kgEntrada : null;
    if (rendimiento != null && rango && !estimado) {
      if (rendimiento < rango.min) {
        avisos.push({
          nivel: 'media',
          texto: `${TRANSICIONES[p.tipo]?.nombre ?? p.tipo} del ${p.fecha}: rindió ${(rendimiento * 100).toFixed(1)} %, por debajo de lo esperado (${(rango.min * 100).toFixed(1)}–${(rango.max * 100).toFixed(1)} %). Puede ser humedad alta, merma real o un peso mal anotado.`,
        });
      } else if (rendimiento > rango.max) {
        avisos.push({
          nivel: 'media',
          texto: `${TRANSICIONES[p.tipo]?.nombre ?? p.tipo} del ${p.fecha}: rindió ${(rendimiento * 100).toFixed(1)} %, por encima de lo esperado (${(rango.min * 100).toFixed(1)}–${(rango.max * 100).toFixed(1)} %). Verificar la báscula o si se mezcló café de otro lote.`,
        });
      }
    }

    pasos.push({
      id: p.id,
      fecha: p.fecha,
      tipo: p.tipo,
      nombre: TRANSICIONES[p.tipo]?.nombre ?? p.tipo,
      estado_entrada: p.estado_entrada,
      estado_salida: p.estado_salida,
      kg_entrada: r2(kgEntrada),
      kg_salida: r2(kgSalida),
      kg_salida_estimado: estimado,
      merma_kg: r2(kgEntrada - kgSalida - (p.kg_subproducto ?? 0)),
      kg_subproducto: p.kg_subproducto != null ? r2(p.kg_subproducto) : null,
      rendimiento_pct: rendimiento != null ? r2(rendimiento * 100) : null,
      rendimiento_esperado_pct: rango ? { min: r2(rango.min * 100), tipico: r2(rango.tipico * 100), max: r2(rango.max * 100) } : null,
      costos_cop: {
        ...Object.fromEntries(CAMPOS_COSTO_PROCESO.map((c) => [c.replace('_cop', ''), r0(p[c] ?? 0)])),
        credito_subproducto: r0(directo.credito),
        proceso: r0(directo.neto),
        cafe_que_entra: r0(costoHeredado),
        acumulado: r0(costoAcumulado),
      },
      cop_por_kg_entrada: r2(unitEntrada),
      cop_por_kg_salida: kgSalida > 0 ? r2(costoAcumulado / kgSalida) : null,
      perfil_tueste: p.perfil_tueste,
      responsable: p.responsable,
    });
  }

  // Los gastos asignados al lote se cargan al estado más avanzado (ahí está el
  // empaque, las etiquetas y lo que se gastó para dejarlo listo para vender).
  const gastosDirectos = gastosLote.reduce((s, g) => s + (g.valor_cop ?? 0), 0);
  const avanzado = [...estados.values()]
    .filter((b) => b.kg_producido > 0)
    .sort((a, b) => ESTADOS_CAFE.indexOf(b.estado) - ESTADOS_CAFE.indexOf(a.estado))[0];
  if (gastosDirectos > 0 && avanzado) avanzado.costo_producido += gastosDirectos;

  // Ventas: descuentan kg del estado correspondiente.
  let kgVendidos = 0;
  let ingresos = 0;
  for (const v of ventas) {
    const estadoVenta = v.estado_cafe ?? v.pres_estado;
    const kg = v.kg ?? (v.pres_gramos && v.unidades ? (v.pres_gramos * v.unidades) / 1000 : 0);
    ingresos += v.total_cop ?? ((v.precio_unitario_cop ?? 0) * (v.unidades ?? 0) - (v.descuento_cop ?? 0));
    kgVendidos += kg;
    if (!estadoVenta) {
      avisos.push({ nivel: 'media', texto: `Venta #${v.id} (${v.fecha}) no dice en qué estado salió el café: no se pudo descontar del inventario.` });
      continue;
    }
    bucket(estadoVenta).kg_vendido += kg;
  }

  const etapas = [...estados.values()]
    .sort((a, b) => ESTADOS_CAFE.indexOf(a.estado) - ESTADOS_CAFE.indexOf(b.estado))
    .map((b) => {
      const disponible = b.kg_producido - b.kg_consumido - b.kg_vendido;
      const unit = costoKg(b);
      return {
        estado: b.estado,
        nombre: ESTADOS_CAFE_INFO[b.estado]?.nombre ?? b.estado,
        kg_producido: r2(b.kg_producido),
        kg_usado_en_proceso: r2(b.kg_consumido),
        kg_vendido: r2(b.kg_vendido),
        kg_disponible: r2(Math.max(disponible, 0)),
        cop_por_kg: r2(unit),
        valor_inventario_cop: r0(Math.max(disponible, 0) * unit),
      };
    });

  const costoTotal = entrada.total_cop
    + procesos.reduce((s, p) => s + costoDirectoProceso(p).neto, 0)
    + gastosDirectos;

  const ultima = etapas[etapas.length - 1];
  const rendimientoGlobal = lote.kg_inicial && ultima ? ultima.kg_producido / lote.kg_inicial : null;

  return {
    lote: {
      id: lote.id,
      codigo: lote.codigo,
      fecha: lote.fecha,
      origen: lote.origen,
      proveedor: lote.proveedor,
      productor_id: lote.productor_id,
      variedad: lote.variedad,
      estado_inicial: lote.estado_inicial,
      kg_inicial: lote.kg_inicial,
      humedad_pct: lote.humedad_pct,
      estado: lote.estado,
    },
    entrada,
    pasos,
    etapas,
    gastos_directos_cop: r0(gastosDirectos),
    totales: {
      costo_total_cop: r0(costoTotal),
      ingresos_cop: r0(ingresos),
      kg_vendidos: r2(kgVendidos),
      valor_inventario_cop: r0(etapas.reduce((s, e) => s + e.valor_inventario_cop, 0)),
      // Resultado del lote: lo que entró de plata menos el costo de lo vendido.
      costo_vendido_cop: r0(etapas.reduce((s, e) => s + e.kg_vendido * e.cop_por_kg, 0)),
      rendimiento_global: rendimientoGlobal != null ? r3(rendimientoGlobal) : null,
      estado_final: ultima?.estado ?? null,
      cop_por_kg_final: ultima?.cop_por_kg ?? null,
    },
    avisos,
    aviso: 'Costo promedio ponderado con los pesos y valores registrados. Los kg que falten pesar se estiman con rendimientos de referencia y quedan marcados.',
  };
}

// Inventario de café de todos los lotes, por estado.
export function inventarioCafe(db, { incluirAgotados = false } = {}) {
  const lotes = db
    .prepare(`SELECT id FROM lotes_cafe ${incluirAgotados ? '' : "WHERE COALESCE(estado,'en_proceso') <> 'descartado'"} ORDER BY fecha ASC, id ASC`)
    .all();

  const porEstado = new Map();
  const porLote = [];

  for (const { id } of lotes) {
    const c = cadenaCostoLote(db, id);
    if (!c) continue;
    const etapas = c.etapas.filter((e) => e.kg_disponible > 0.001);
    if (etapas.length || incluirAgotados) {
      porLote.push({
        lote_cafe_id: id,
        codigo: c.lote.codigo,
        fecha: c.lote.fecha,
        variedad: c.lote.variedad,
        etapas,
        valor_cop: etapas.reduce((s, e) => s + e.valor_inventario_cop, 0),
      });
    }
    for (const e of etapas) {
      if (!porEstado.has(e.estado)) {
        porEstado.set(e.estado, { estado: e.estado, nombre: e.nombre, kg: 0, valor_cop: 0, lotes: 0 });
      }
      const acc = porEstado.get(e.estado);
      acc.kg += e.kg_disponible;
      acc.valor_cop += e.valor_inventario_cop;
      acc.lotes += 1;
    }
  }

  const estados = [...porEstado.values()]
    .sort((a, b) => ESTADOS_CAFE.indexOf(a.estado) - ESTADOS_CAFE.indexOf(b.estado))
    .map((e) => ({ ...e, kg: r2(e.kg), valor_cop: r0(e.valor_cop), cop_por_kg: e.kg > 0 ? r2(e.valor_cop / e.kg) : null }));

  return {
    estados,
    lotes: porLote,
    total_kg: r2(estados.reduce((s, e) => s + e.kg, 0)),
    total_valor_cop: r0(estados.reduce((s, e) => s + e.valor_cop, 0)),
  };
}

// Estado de resultados del periodo: ingresos, costo de lo vendido, gastos y
// utilidad. Más cuentas por cobrar y plata que salió en compras.
export function estadoResultados(db, { desde, hasta } = {}) {
  const cond = [];
  const params = [];
  if (desde) { cond.push('fecha >= ?'); params.push(desde); }
  if (hasta) { cond.push('fecha <= ?'); params.push(hasta); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

  const ventas = db.prepare(`
    SELECT v.*, pr.gramos AS pres_gramos, pr.estado_cafe AS pres_estado
    FROM ventas v LEFT JOIN presentaciones pr ON pr.id = v.presentacion_id
    ${where ? where.replace(/fecha/g, 'v.fecha') : ''} ORDER BY v.fecha ASC`).all(...params);

  const cache = new Map();
  const cadena = (loteId) => {
    if (!cache.has(loteId)) cache.set(loteId, cadenaCostoLote(db, loteId));
    return cache.get(loteId);
  };

  let ingresos = 0;
  let costoVendido = 0;
  let kgVendidos = 0;
  let sinCosto = 0;
  const porCanal = new Map();

  for (const v of ventas) {
    const total = v.total_cop ?? ((v.precio_unitario_cop ?? 0) * (v.unidades ?? 0) - (v.descuento_cop ?? 0));
    const kg = v.kg ?? (v.pres_gramos && v.unidades ? (v.pres_gramos * v.unidades) / 1000 : 0);
    ingresos += total;
    kgVendidos += kg;

    let costo = null;
    if (v.lote_cafe_id) {
      const c = cadena(v.lote_cafe_id);
      const estado = v.estado_cafe ?? v.pres_estado;
      const etapa = c?.etapas.find((e) => e.estado === estado);
      if (etapa) costo = kg * etapa.cop_por_kg;
    }
    if (costo == null) sinCosto += 1;
    else costoVendido += costo;

    const canal = v.canal ?? 'otro';
    if (!porCanal.has(canal)) porCanal.set(canal, { canal, ventas: 0, kg: 0, ingresos_cop: 0, costo_cop: 0 });
    const acc = porCanal.get(canal);
    acc.ventas += 1;
    acc.kg += kg;
    acc.ingresos_cop += total;
    acc.costo_cop += costo ?? 0;
  }

  const gastos = db.prepare(`SELECT * FROM gastos ${where}`).all(...params);
  const operativos = gastos.filter((g) => (g.tipo_costo ?? 'operativo') === 'operativo' && !g.lote_cafe_id);
  const inversiones = gastos.filter((g) => g.tipo_costo === 'inversion');

  const porCategoria = new Map();
  for (const g of operativos) {
    if (!porCategoria.has(g.categoria)) porCategoria.set(g.categoria, { categoria: g.categoria, valor_cop: 0, registros: 0 });
    const acc = porCategoria.get(g.categoria);
    acc.valor_cop += g.valor_cop ?? 0;
    acc.registros += 1;
  }

  const gastosOperativos = operativos.reduce((s, g) => s + (g.valor_cop ?? 0), 0);
  // La depreciación es la cuota de las inversiones que le toca a este periodo,
  // aunque se hayan comprado antes. Sin ella la utilidad sale infladísima el
  // mes siguiente a comprar un equipo.
  const amortizacion = amortizacionPeriodo(db, { desde, hasta });
  const margenBruto = ingresos - costoVendido;
  const utilidad = margenBruto - gastosOperativos - amortizacion.cop;

  const compras = db.prepare(`
    SELECT COUNT(*) AS lotes,
           SUM(COALESCE(valor_compra_cop, COALESCE(precio_cop_kg,0) * COALESCE(kg_inicial,0))
               + COALESCE(costo_transporte_cop,0) + COALESCE(otros_costos_cop,0)) AS valor_cop,
           SUM(COALESCE(kg_inicial,0)) AS kg
    FROM lotes_cafe ${where}`).get(...params);

  const porCobrar = db.prepare(`
    SELECT COUNT(*) AS ventas,
           SUM(COALESCE(total_cop, COALESCE(precio_unitario_cop,0) * COALESCE(unidades,0) - COALESCE(descuento_cop,0))) AS valor_cop
    FROM ventas WHERE estado_pago IN ('pendiente','parcial')`).get();

  const avisos = [];
  if (sinCosto) {
    avisos.push(`${sinCosto} venta(s) sin lote o sin estado del café: su costo no entró en el margen. Asignarles el lote para que el margen sea real.`);
  }
  if (ingresos > 0 && costoVendido === 0) {
    avisos.push('Hay ingresos pero no costo de lo vendido: faltan los procesos del lote (trilla, tueste) o el lote en las ventas.');
  }

  return {
    periodo: { desde: desde ?? null, hasta: hasta ?? null },
    ingresos_cop: r0(ingresos),
    costo_vendido_cop: r0(costoVendido),
    margen_bruto_cop: r0(margenBruto),
    margen_bruto_pct: ingresos > 0 ? r2((margenBruto / ingresos) * 100) : null,
    gastos_operativos_cop: r0(gastosOperativos),
    depreciacion_cop: amortizacion.cop,
    amortizacion: amortizacion,
    utilidad_operativa_cop: r0(utilidad),
    margen_neto_pct: ingresos > 0 ? r2((utilidad / ingresos) * 100) : null,
    kg_vendidos: r2(kgVendidos),
    cop_por_kg_vendido: kgVendidos > 0 ? r2(ingresos / kgVendidos) : null,
    por_canal: [...porCanal.values()]
      .map((c) => ({
        ...c,
        kg: r2(c.kg),
        ingresos_cop: r0(c.ingresos_cop),
        costo_cop: r0(c.costo_cop),
        margen_cop: r0(c.ingresos_cop - c.costo_cop),
        margen_pct: c.ingresos_cop > 0 ? r2(((c.ingresos_cop - c.costo_cop) / c.ingresos_cop) * 100) : null,
      }))
      .sort((a, b) => b.ingresos_cop - a.ingresos_cop),
    gastos_por_categoria: [...porCategoria.values()].sort((a, b) => b.valor_cop - a.valor_cop),
    inversiones_cop: r0(inversiones.reduce((s, g) => s + (g.valor_cop ?? 0), 0)),
    compras: { lotes: compras.lotes ?? 0, kg: r2(compras.kg ?? 0), valor_cop: r0(compras.valor_cop ?? 0) },
    por_cobrar: { ventas: porCobrar.ventas ?? 0, valor_cop: r0(porCobrar.valor_cop ?? 0) },
    inventario_valor_cop: inventarioCafe(db).total_valor_cop,
    avisos,
    aviso: 'La utilidad descuenta la depreciación de las inversiones que tengan vida útil (campo "amortizar meses"); las que no la tengan no cargan nada. No descuenta su propio tiempo si no está registrado como gasto de mano de obra.',
  };
}

// Categorías que YA se cobran por unidad en el costo de empaque de cada
// presentación. Si entraran también al gasto general por kg, el mismo peso se
// contaría dos veces y el costo por bolsa saldría inflado.
export const CATEGORIAS_POR_UNIDAD = ['empaque', 'etiquetas'];

const mesIndice = (fecha) => {
  const [anio, mes] = String(fecha).slice(0, 7).split('-').map(Number);
  return anio * 12 + (mes - 1);
};

// Amortización de las inversiones que le toca a un periodo.
//
// Una tostadora no es un costo de octubre: sirve varios años. Con
// `amortizar_meses` la compra se reparte en cuotas mensuales iguales
// (valor ÷ meses) y cada periodo paga solo los meses que le corresponden del
// traslape entre la vida útil [fecha, fecha + meses) y el periodo pedido.
//
// Sin `desde` se cobra lo corrido desde la compra; sin `hasta`, hasta hoy.
// Nunca se cobra más allá de la vida útil: pasados los meses, la inversión
// deja de cargar costo.
export function amortizacionPeriodo(db, { desde, hasta, hoy } = {}) {
  const filas = db
    .prepare("SELECT id, fecha, descripcion, categoria, valor_cop, amortizar_meses FROM gastos WHERE tipo_costo = 'inversion'")
    .all();

  const hoyMes = mesIndice(hoy ?? new Date().toISOString().slice(0, 10));
  const desdeMes = desde ? mesIndice(desde) : null;
  const hastaMes = hasta ? mesIndice(hasta) : hoyMes;

  let total = 0;
  let cuotaMensual = 0;
  const detalle = [];
  const sinVidaUtil = [];

  for (const g of filas) {
    if (!g.amortizar_meses || g.amortizar_meses < 1 || !g.valor_cop) {
      if (g.valor_cop) sinVidaUtil.push({ id: g.id, descripcion: g.descripcion, valor_cop: r0(g.valor_cop) });
      continue;
    }
    const inicio = mesIndice(g.fecha);
    const ultimo = inicio + g.amortizar_meses - 1;
    const primeroCobrado = Math.max(inicio, desdeMes ?? inicio);
    const ultimoCobrado = Math.min(hastaMes, ultimo);
    const meses = Math.max(0, ultimoCobrado - primeroCobrado + 1);
    const cuota = g.valor_cop / g.amortizar_meses;
    cuotaMensual += ultimoCobrado >= primeroCobrado ? cuota : 0;
    if (!meses) continue;
    total += cuota * meses;
    detalle.push({
      id: g.id,
      descripcion: g.descripcion,
      valor_cop: r0(g.valor_cop),
      amortizar_meses: g.amortizar_meses,
      cuota_mensual_cop: r0(cuota),
      meses_cobrados: meses,
      cop: r0(cuota * meses),
      termina: `${String(Math.floor(ultimo / 12)).padStart(4, '0')}-${String((ultimo % 12) + 1).padStart(2, '0')}`,
    });
  }

  return {
    cop: r0(total),
    cuota_mensual_cop: r0(cuotaMensual),
    detalle,
    sin_vida_util: sinVidaUtil,
  };
}

// Gasto general por kg producido en un periodo: sirve para repartir los gastos
// que no son de ningún lote al fijar precios.
export function gastoGeneralPorKg(db, { desde, hasta, estado = 'tostado_grano' } = {}) {
  const cond = [];
  const params = [];
  if (desde) { cond.push('fecha >= ?'); params.push(desde); }
  if (hasta) { cond.push('fecha <= ?'); params.push(hasta); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

  const marcas = CATEGORIAS_POR_UNIDAD.map(() => '?').join(',');
  const base = `FROM gastos ${where}${where ? ' AND' : ' WHERE'} lote_cafe_id IS NULL AND COALESCE(tipo_costo,'operativo') = 'operativo'`;
  const gastos = db
    .prepare(`SELECT SUM(valor_cop) AS v ${base} AND COALESCE(categoria,'') NOT IN (${marcas})`)
    .get(...params, ...CATEGORIAS_POR_UNIDAD);
  const porUnidad = db
    .prepare(`SELECT SUM(valor_cop) AS v ${base} AND COALESCE(categoria,'') IN (${marcas})`)
    .get(...params, ...CATEGORIAS_POR_UNIDAD);
  const kg = db
    .prepare(`SELECT SUM(COALESCE(kg_salida,0)) AS kg FROM procesos_cafe ${where}${where ? ' AND' : ' WHERE'} estado_salida = ?`)
    .get(...params, estado);

  // Las inversiones no entran por su valor completo: entran por la cuota de
  // amortización que le toca al periodo.
  const amortizacion = amortizacionPeriodo(db, { desde, hasta });

  const operativos = gastos?.v ?? 0;
  const excluido = porUnidad?.v ?? 0;
  const valor = operativos + amortizacion.cop;
  const producidos = kg?.kg ?? 0;
  const copPorKg = producidos > 0 ? r2(valor / producidos) : null;

  const avisos = [];
  if (excluido > 0) {
    avisos.push(`No se incluyeron $${r0(excluido).toLocaleString('es-CO')} de ${CATEGORIAS_POR_UNIDAD.join(' y ')}: eso ya se cobra por unidad en el costo de empaque de cada presentación. Contarlo aquí también lo cobraría dos veces.`);
  }
  if (amortizacion.sin_vida_util.length) {
    const lista = amortizacion.sin_vida_util
      .map((g) => `${g.descripcion ?? 'sin descripción'} ($${g.valor_cop.toLocaleString('es-CO')})`)
      .join(', ');
    avisos.push(`Hay inversiones sin vida útil: ${lista}. Mientras no tengan "amortizar meses" no cargan nada al costo del kg, así que el café se ve más barato de lo que es. Ponerle vida útil (tostadora ~60 meses, molino ~36, diseño de empaques ~24) reparte la compra en cuotas mensuales.`);
  }
  if (copPorKg != null && producidos < 100) {
    avisos.push(`Son pocos kg (${r2(producidos)}) para repartir los gastos: cualquier gasto grande de una sola vez (un equipo, un diseño, una compra de insumos para meses) hace ver el kg mucho más caro de lo que es. Márquelos como inversión con su vida útil, o reparta sobre un periodo más largo.`);
  }

  return {
    periodo: { desde: desde ?? null, hasta: hasta ?? null },
    estado,
    gastos_generales_cop: r0(valor),
    gastos_operativos_cop: r0(operativos),
    amortizacion_cop: amortizacion.cop,
    amortizacion: amortizacion,
    gastos_por_unidad_excluidos_cop: r0(excluido),
    categorias_excluidas: CATEGORIAS_POR_UNIDAD,
    kg_producidos: r2(producidos),
    cop_por_kg: copPorKg,
    avisos,
  };
}

// Simulación antes de comprar: "si compro X kg de pergamino a Y COP/kg, ¿cuántos
// kg tostados salen y a cómo me queda el kg?". Usa rendimientos de referencia,
// así que da un rango, no un número exacto.
export function simularCadena(p = {}) {
  const errores = {};
  const kg = Number(p.kg);
  if (!Number.isFinite(kg) || kg <= 0) errores.kg = 'debe ser un número > 0';
  const estadoInicial = p.estado_inicial ?? 'pergamino_seco';
  const estadoFinal = p.estado_final ?? 'tostado_grano';
  const iIni = ESTADOS_CAFE.indexOf(estadoInicial);
  const iFin = ESTADOS_CAFE.indexOf(estadoFinal);
  if (iIni < 0) errores.estado_inicial = `use: ${ESTADOS_CAFE.join(', ')}`;
  if (iFin < 0) errores.estado_final = `use: ${ESTADOS_CAFE.join(', ')}`;
  if (iIni >= 0 && iFin >= 0 && iFin <= iIni) errores.estado_final = 'debe ser un estado posterior al inicial';
  if (Object.keys(errores).length) throw invalido(errores);

  const precioKg = Number(p.precio_cop_kg ?? 0) || 0;
  const costoEntrada = kg * precioKg + (Number(p.costo_transporte_cop ?? 0) || 0) + (Number(p.otros_costos_cop ?? 0) || 0);
  // Costos de proceso por kg que ENTRA a cada paso: { trilla: 500, tueste: 4000 }
  const costosPaso = p.costos_proceso_cop_kg ?? {};

  const escenarios = { min: { kg, costo: costoEntrada }, tipico: { kg, costo: costoEntrada }, max: { kg, costo: costoEntrada } };
  const pasos = [];

  for (const [id, t] of Object.entries(TRANSICIONES)) {
    const i = ESTADOS_CAFE.indexOf(t.de);
    const j = ESTADOS_CAFE.indexOf(t.a);
    if (j <= i || i < iIni || j > iFin) continue;

    const rango = id === 'tueste' && p.perfil_tueste && PERFILES_TUESTE[p.perfil_tueste]
      ? PERFILES_TUESTE[p.perfil_tueste].rendimiento
      : t.rendimiento;
    const costoKgPaso = Number(costosPaso[id] ?? 0) || 0;

    const antes = { ...escenarios.tipico };
    // El escenario "min" es el peor: menos kg de salida.
    escenarios.min.costo += escenarios.min.kg * costoKgPaso;
    escenarios.min.kg *= rango.min;
    escenarios.tipico.costo += escenarios.tipico.kg * costoKgPaso;
    escenarios.tipico.kg *= rango.tipico;
    escenarios.max.costo += escenarios.max.kg * costoKgPaso;
    escenarios.max.kg *= rango.max;

    pasos.push({
      proceso: id,
      nombre: t.nombre,
      de: t.de,
      a: t.a,
      kg_entrada: r2(antes.kg),
      rendimiento_pct: { min: r2(rango.min * 100), tipico: r2(rango.tipico * 100), max: r2(rango.max * 100) },
      kg_salida: { min: r2(escenarios.min.kg), tipico: r2(escenarios.tipico.kg), max: r2(escenarios.max.kg) },
      costo_proceso_cop_kg: costoKgPaso,
      subproducto: t.subproducto ?? null,
      confianza: t.confianza,
      nota: t.nota ?? null,
    });
  }

  const unit = (e) => (e.kg > 0 ? r2(e.costo / e.kg) : null);
  return {
    entrada: { estado_inicial: estadoInicial, kg, precio_cop_kg: precioKg, costo_entrada_cop: r0(costoEntrada) },
    estado_final: estadoFinal,
    pasos,
    resultado: {
      kg_final: { min: r2(escenarios.min.kg), tipico: r2(escenarios.tipico.kg), max: r2(escenarios.max.kg) },
      costo_total_cop: { min: r0(escenarios.min.costo), tipico: r0(escenarios.tipico.costo), max: r0(escenarios.max.costo) },
      // Ojo: el peor caso de costo por kg es el de MENOS kg de salida.
      cop_por_kg: { mejor: unit(escenarios.max), tipico: unit(escenarios.tipico), peor: unit(escenarios.min) },
      rendimiento_global_pct: { min: r2((escenarios.min.kg / kg) * 100), tipico: r2((escenarios.tipico.kg / kg) * 100), max: r2((escenarios.max.kg / kg) * 100) },
    },
    aviso: 'Proyección con rendimientos de referencia, no con pesos reales. Sirve para decidir cuánto pagar; el costo definitivo sale de pesar cada proceso.',
  };
}
