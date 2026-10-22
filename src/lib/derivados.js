import { CRITERIOS_OPORTUNIDAD } from '../resources.js';
import { areaHectareas } from './geo.js';
import { costoEntradaLote } from './costos.js';

const DIA_MS = 86_400_000;

export function sumarDias(fecha, dias) {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);
}

// Índice de oportunidad 0–100: promedio ponderado de los criterios evaluados.
// Si faltan criterios se reporta, para no comparar oportunidades medio evaluadas
// como si estuvieran completas.
export function indiceOportunidad(op, pesos = {}) {
  let suma = 0;
  let pesoTotal = 0;
  const faltantes = [];
  for (const [c] of CRITERIOS_OPORTUNIDAD) {
    const v = op[c];
    if (v === null || v === undefined) {
      faltantes.push(c);
      continue;
    }
    const p = pesos[c] ?? 1;
    suma += v * p;
    pesoTotal += p;
  }
  return {
    indice: pesoTotal ? Math.round(((suma / pesoTotal - 1) / 4) * 1000) / 10 : null,
    criterios_evaluados: CRITERIOS_OPORTUNIDAD.length - faltantes.length,
    criterios_faltantes: faltantes,
  };
}

// Campos calculados que se agregan al leer ciertos recursos.
export const derivados = {
  floraciones: (f) => ({
    ...f,
    // Arábica: ~32 semanas de floración a maduración (referencia general Cenicafé).
    // Es una ventana orientativa; ajustarla con las cosechas reales de la finca.
    cosecha_estimada: f.fecha
      ? { desde: sumarDias(f.fecha, 210), probable: sumarDias(f.fecha, 224), hasta: sumarDias(f.fecha, 245) }
      : null,
  }),

  subproductos: (s) => ({
    ...s,
    kg_secos_estimados:
      s.kg_secos ?? (s.kg_frescos != null && s.humedad_pct != null
        ? Math.round(s.kg_frescos * (1 - s.humedad_pct / 100) * 100) / 100
        : null),
    costo_total_cop:
      (s.costo_adquisicion_cop ?? 0) + (s.costo_transporte_cop ?? 0) + (s.costo_proceso_cop ?? 0),
  }),

  lotes: (l) => ({
    ...l,
    area_mapa_ha: l.geometria && typeof l.geometria === 'object' ? areaHectareas(l.geometria) : null,
  }),

  oportunidades: (o) => ({ ...o, ...indiceOportunidad(o) }),

  cosechas: (c) => ({
    ...c,
    kg_cereza_por_planta:
      c.kg_cereza != null && c.plantas_cosechadas
        ? Math.round((c.kg_cereza / c.plantas_cosechadas) * 1000) / 1000
        : null,
  }),

  lotes_cafe: (l) => {
    const e = costoEntradaLote(l);
    return { ...l, costo_entrada_cop: e.total_cop, cop_por_kg_entrada: e.cop_por_kg };
  },

  // Costo y rendimiento del paso, sin el costo del café que entra (ese depende
  // del lote completo y se calcula en /api/costos/lote/:id).
  procesos_cafe: (p) => {
    const costo = ['maquila_cop', 'mano_obra_cop', 'energia_cop', 'insumos_cop', 'empaque_cop', 'transporte_cop', 'otros_cop']
      .reduce((s, c) => s + (p[c] ?? 0), 0) - (p.valor_subproducto_cop ?? 0);
    return {
      ...p,
      costo_proceso_cop: Math.round(costo),
      rendimiento_pct: p.kg_entrada && p.kg_salida != null
        ? Math.round((p.kg_salida / p.kg_entrada) * 10000) / 100
        : null,
      merma_kg: p.kg_entrada != null && p.kg_salida != null
        ? Math.round((p.kg_entrada - p.kg_salida - (p.kg_subproducto ?? 0)) * 100) / 100
        : null,
    };
  },

  presentaciones: (p) => ({
    ...p,
    precio_cop_kg: p.precio_venta_cop != null && p.gramos
      ? Math.round(p.precio_venta_cop / (p.gramos / 1000))
      : null,
  }),

  ventas: (v) => ({
    ...v,
    total_calculado_cop: v.total_cop
      ?? (v.precio_unitario_cop != null && v.unidades != null
        ? Math.round(v.precio_unitario_cop * v.unidades - (v.descuento_cop ?? 0))
        : null),
  }),
};
