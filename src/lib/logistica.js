import { SUBPRODUCTOS_INFO } from '../conocimiento/subproductos.js';
import { invalido } from './errores.js';

const r0 = (n) => Math.round(n);
const r2 = (n) => Math.round(n * 100) / 100;

// Distancia en línea recta (km) entre dos coordenadas.
export function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function num(obj, campo, { requerido = false, defecto = 0, min = 0 } = {}, errores) {
  const v = obj[campo];
  if (v === undefined || v === null || v === '') {
    if (requerido) errores[campo] = 'es obligatorio';
    return defecto;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) errores[campo] = `debe ser un número ≥ ${min}`;
  return n;
}

// Costo puesto en planta (plan maestro §26):
// kg × humedad × densidad × frecuencia × distancia × deterioro × transporte.
export function costoPuestoEnPlanta(p) {
  const errores = {};
  const info = SUBPRODUCTOS_INFO[p.tipo];
  if (!info) errores.tipo = `use: ${Object.keys(SUBPRODUCTOS_INFO).join(', ')}`;

  const kg = num(p, 'kg', { requerido: true }, errores);
  const distancia = num(p, 'distancia_km', { requerido: true }, errores);
  const costoKm = num(p, 'costo_km_cop', { requerido: true }, errores);
  const capKg = num(p, 'capacidad_kg', { requerido: true }, errores);
  const capM3 = num(p, 'capacidad_m3', { defecto: null }, errores);
  const adquisicionKg = num(p, 'costo_adquisicion_cop_kg', {}, errores);
  const manoObraViaje = num(p, 'mano_obra_cop_viaje', {}, errores);
  const velocidad = num(p, 'velocidad_kmh', { defecto: 25 }, errores);
  const horasEspera = num(p, 'horas_hasta_proceso', {}, errores);
  const humedadObj = num(p, 'humedad_objetivo_pct', { defecto: null }, errores);
  const costoSecado = num(p, 'costo_secado_cop_kg_agua', {}, errores);
  const frecuencia = num(p, 'entregas_por_mes', { defecto: 1 }, errores);
  if (capKg === 0) errores.capacidad_kg = 'debe ser mayor que 0';
  if (capM3 === 0) errores.capacidad_m3 = 'debe ser mayor que 0';
  if (velocidad === 0) errores.velocidad_kmh = 'debe ser mayor que 0';
  if (Object.keys(errores).length) throw invalido(errores);

  const [hMin, hMax] = info.humedad_tipica_pct;
  const humedad = p.humedad_pct === undefined || p.humedad_pct === null || p.humedad_pct === ''
    ? (hMin + hMax) / 2
    : Number(p.humedad_pct);
  const kgSecos = kg * (1 - humedad / 100);
  const volumen = kg / info.densidad_kg_m3;

  const viajesPorPeso = Math.ceil(kg / capKg);
  const viajesPorVolumen = capM3 ? Math.ceil(volumen / capM3) : 0;
  const viajes = Math.max(viajesPorPeso, viajesPorVolumen, 1);
  const limitante = viajesPorVolumen > viajesPorPeso ? 'volumen' : 'peso';

  const kmRecorridos = distancia * 2 * viajes;
  const costoTransporte = kmRecorridos * costoKm;
  const costoManoObra = manoObraViaje * viajes;
  const costoAdquisicion = adquisicionKg * kg;

  let aguaEvaporar = 0;
  if (humedadObj !== null && humedadObj < humedad) {
    aguaEvaporar = kg - kgSecos / (1 - humedadObj / 100);
  }
  const costoSecadoTotal = aguaEvaporar * costoSecado;

  const total = costoTransporte + costoManoObra + costoAdquisicion + costoSecadoTotal;
  const horasHastaProceso = distancia / velocidad + horasEspera;

  const advertencias = [];
  if (info.vida_util_fresco_horas != null && horasHastaProceso > info.vida_util_fresco_horas) {
    advertencias.push(`Tiempo hasta proceso (~${r2(horasHastaProceso)} h) supera la vida útil de referencia (~${info.vida_util_fresco_horas} h).`);
  }
  if (limitante === 'volumen') {
    advertencias.push('El volumen, no el peso, limita la carga: considerar compactar, ensacar o densificar en origen.');
  }
  if (humedad > 60) {
    advertencias.push(`Con ${humedad}% de humedad, ${r0(kg - kgSecos)} kg del transporte son agua: evaluar secar o procesar cerca del origen.`);
  }

  return {
    entrada: { tipo: p.tipo, kg, humedad_pct: humedad, humedad_estimada: p.humedad_pct == null || p.humedad_pct === '', distancia_km: distancia },
    carga: { kg_materia_seca: r2(kgSecos), volumen_m3: r2(volumen), viajes, limitante, km_recorridos: r2(kmRecorridos) },
    costos_cop: {
      adquisicion: r0(costoAdquisicion),
      transporte: r0(costoTransporte),
      mano_obra: r0(costoManoObra),
      secado: r0(costoSecadoTotal),
      total: r0(total),
    },
    indicadores: {
      cop_por_kg_fresco: r2(total / kg),
      cop_por_kg_seco: kgSecos > 0 ? r2(total / kgSecos) : null,
      horas_hasta_proceso: r2(horasHastaProceso),
      agua_a_evaporar_kg: r2(aguaEvaporar),
      costo_mensual_cop: r0(total * frecuencia),
    },
    advertencias,
    aviso: 'Cálculo con los costos que usted ingresó y densidades aproximadas. Ajustar con pesajes y tarifas reales.',
  };
}
