// Precio de venta recomendado.
//
// Regla: el margen se calcula SOBRE EL PRECIO DE VENTA, no sobre el costo.
//   precio = costo_unitario / (1 − margen)
// Es la forma en que se habla en comercio ("gano el 40 %") y evita el error
// clásico de sumarle 40 % al costo y creer que se ganó 40 %.
//
// El costo unitario incluye: café (al costo real del lote), merma de empaque,
// empaque y etiqueta, y la parte de gastos generales que le toca al kg.

import { CANALES_VENTA, AVISO_IVA, ESTADOS_CAFE_INFO } from '../conocimiento/procesos_cafe.js';
import { invalido } from './errores.js';

const r0 = (n) => Math.round(n);
const r2 = (n) => Math.round(n * 100) / 100;

// Redondeo comercial hacia arriba: nunca deja el margen por debajo del objetivo.
function redondear(valor, paso = 500) {
  return Math.ceil(valor / paso) * paso;
}

function num(obj, campo, { requerido = false, defecto = 0, min = 0, max } = {}, errores) {
  const v = obj[campo];
  if (v === undefined || v === null || v === '') {
    if (requerido) errores[campo] = 'es obligatorio';
    return defecto;
  }
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  if (!Number.isFinite(n) || n < min) errores[campo] = `debe ser un número ≥ ${min}`;
  else if (max !== undefined && n > max) errores[campo] = `debe ser ≤ ${max}`;
  return n;
}

export function sugerirPrecio(p = {}) {
  const errores = {};
  const costoKg = num(p, 'costo_cop_kg', { requerido: true }, errores);
  const gramos = num(p, 'gramos', { defecto: 250, min: 1 }, errores);
  const empaque = num(p, 'costo_empaque_cop', {}, errores);
  const generalesKg = num(p, 'gastos_generales_cop_kg', {}, errores);
  const mermaEmpaque = num(p, 'merma_empaque_pct', { defecto: 2, max: 50 }, errores);
  const ivaPct = num(p, 'iva_pct', { defecto: 0, max: 100 }, errores);
  const paso = num(p, 'redondeo_cop', { defecto: 500, min: 1 }, errores);
  const costosFijosMes = num(p, 'costos_fijos_mes_cop', {}, errores);
  const margenForzado = p.margen_objetivo_pct === undefined || p.margen_objetivo_pct === null || p.margen_objetivo_pct === ''
    ? null
    : num(p, 'margen_objetivo_pct', { min: 0, max: 95 }, errores);
  const precioActual = p.precio_actual_cop === undefined || p.precio_actual_cop === null || p.precio_actual_cop === ''
    ? null
    : num(p, 'precio_actual_cop', {}, errores);
  if (Object.keys(errores).length) throw invalido(errores);

  const kgPorUnidad = (gramos / 1000) * (1 + mermaEmpaque / 100);
  const costoCafe = costoKg * kgPorUnidad;
  const costoGenerales = generalesKg * (gramos / 1000);
  const costoUnitario = costoCafe + costoGenerales + empaque;

  const pedidos = Array.isArray(p.canales) && p.canales.length
    ? p.canales.filter((c) => CANALES_VENTA[c])
    : Object.keys(CANALES_VENTA);
  if (!pedidos.length) throw invalido({ canales: `use: ${Object.keys(CANALES_VENTA).join(', ')}` });

  const canales = pedidos.map((id) => {
    const info = CANALES_VENTA[id];
    const margenPct = margenForzado ?? info.margen_pct;
    const precio = costoUnitario / (1 - margenPct / 100);
    const sugerido = redondear(precio, paso);
    const margenCop = sugerido - costoUnitario;
    return {
      canal: id,
      nombre: info.nombre,
      margen_objetivo_pct: margenPct,
      precio_exacto_cop: r0(precio),
      precio_sugerido_cop: sugerido,
      precio_con_iva_cop: ivaPct ? redondear(sugerido * (1 + ivaPct / 100), paso) : null,
      margen_cop: r0(margenCop),
      margen_real_pct: r2((margenCop / sugerido) * 100),
      multiplo_del_costo: r2(sugerido / costoUnitario),
      precio_cop_kg: r0(sugerido / (gramos / 1000)),
      nota: info.nota ?? null,
    };
  });

  const avisos = [];
  if (!generalesKg) {
    avisos.push('No se incluyeron gastos generales por kg (arriendo, servicios, marketing, su tiempo). Sin eso el margen se ve mejor de lo que es: use /api/costos/gastos-por-kg para sacar el valor real.');
  }
  if (!empaque) {
    avisos.push('No se incluyó costo de empaque ni etiqueta. En bolsas de 250 g suele ser una parte importante del costo.');
  }
  if (generalesKg > costoKg * 0.4) {
    avisos.push(`Los gastos generales ($${r0(generalesKg).toLocaleString('es-CO')}/kg) pesan más del 40 % de lo que cuesta el café ($${r0(costoKg).toLocaleString('es-CO')}/kg). Con pocos kg producidos, un gasto grande de una sola vez distorsiona el costo: revise /api/costos/gastos-por-kg antes de fijar el precio con este número.`);
  }
  if (ivaPct) avisos.push(AVISO_IVA);

  let evaluacion = null;
  if (precioActual != null) {
    const margenCop = precioActual - costoUnitario;
    const margenPct = precioActual > 0 ? (margenCop / precioActual) * 100 : null;
    evaluacion = {
      precio_cop: r0(precioActual),
      margen_cop: r0(margenCop),
      margen_pct: margenPct != null ? r2(margenPct) : null,
      cubre_costo: margenCop > 0,
      veredicto: margenCop <= 0
        ? 'Está vendiendo por debajo del costo: cada bolsa pierde plata.'
        : margenPct < 20
          ? 'Margen muy ajustado: no alcanza para gastos generales ni para imprevistos.'
          : margenPct < 35
            ? 'Margen de mayoreo. Sirve para cafetería o volumen, no para venta directa.'
            : 'Margen sano para venta directa.',
    };
  }

  const puntoEquilibrio = costosFijosMes > 0 && canales.length
    ? (() => {
      const ref = canales.find((c) => c.canal === 'directo') ?? canales[0];
      const contribucion = ref.precio_sugerido_cop - costoUnitario;
      return {
        canal_referencia: ref.canal,
        precio_cop: ref.precio_sugerido_cop,
        contribucion_por_unidad_cop: r0(contribucion),
        unidades_mes: contribucion > 0 ? Math.ceil(costosFijosMes / contribucion) : null,
        kg_mes: contribucion > 0 ? r2((Math.ceil(costosFijosMes / contribucion) * gramos) / 1000) : null,
      };
    })()
    : null;

  return {
    entrada: {
      costo_cop_kg: r2(costoKg),
      gramos,
      merma_empaque_pct: mermaEmpaque,
      iva_pct: ivaPct,
      estado_cafe: p.estado_cafe ?? null,
      nombre_estado: p.estado_cafe ? ESTADOS_CAFE_INFO[p.estado_cafe]?.nombre ?? p.estado_cafe : null,
    },
    costo_unitario: {
      cafe_cop: r0(costoCafe),
      kg_por_unidad: r2(kgPorUnidad * 1000) / 1000,
      gastos_generales_cop: r0(costoGenerales),
      empaque_cop: r0(empaque),
      total_cop: r0(costoUnitario),
      precio_minimo_cop: redondear(costoUnitario, paso),
    },
    canales: canales.sort((a, b) => b.precio_sugerido_cop - a.precio_sugerido_cop),
    evaluacion,
    punto_equilibrio: puntoEquilibrio,
    avisos,
    aviso: 'Margen calculado sobre el precio de venta. Los porcentajes por canal son referencias del mercado de café especial: ajústelos con lo que realmente pueda cobrar.',
  };
}

// Precios sugeridos para todas las presentaciones activas, con el costo real
// del lote indicado.
export async function preciosDeLote(db, { cadena, gastos_generales_cop_kg = 0, iva_pct = 0, redondeo_cop = 500 }) {
  const presentaciones = await db.todos(
    "SELECT * FROM presentaciones WHERE COALESCE(activa,'si') = 'si' ORDER BY estado_cafe, gramos",
  );

  return presentaciones.map((pres) => {
    const etapa = cadena.etapas.find((e) => e.estado === pres.estado_cafe);
    if (!etapa || !etapa.cop_por_kg) {
      return {
        presentacion_id: pres.id,
        nombre: pres.nombre,
        estado_cafe: pres.estado_cafe,
        gramos: pres.gramos,
        sin_costo: `El lote ${cadena.lote.codigo} todavía no tiene café en estado ${ESTADOS_CAFE_INFO[pres.estado_cafe]?.nombre ?? pres.estado_cafe}.`,
      };
    }
    const r = sugerirPrecio({
      costo_cop_kg: etapa.cop_por_kg,
      gramos: pres.gramos,
      costo_empaque_cop: pres.costo_empaque_cop ?? 0,
      gastos_generales_cop_kg,
      iva_pct,
      redondeo_cop,
      estado_cafe: pres.estado_cafe,
      precio_actual_cop: pres.precio_venta_cop ?? null,
    });
    return {
      presentacion_id: pres.id,
      nombre: pres.nombre,
      estado_cafe: pres.estado_cafe,
      gramos: pres.gramos,
      precio_de_lista_cop: pres.precio_venta_cop ?? null,
      costo_unitario_cop: r.costo_unitario.total_cop,
      precio_minimo_cop: r.costo_unitario.precio_minimo_cop,
      canales: r.canales,
      evaluacion: r.evaluacion,
    };
  });
}
