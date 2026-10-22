// Clima regional en cuadrícula alrededor de la finca, para pintarlo sobre el mapa.
// Cada punto combina varios modelos (mediana; viento como promedio vectorial).
// Resolución real de los modelos: ~13–28 km. La cuadrícula muestra cómo se mueven
// lluvias, vientos y nubes en la región, no diferencias entre lotes.

import { combinarModelos, MODELOS_PRONOSTICO, leerCache, guardarCache } from './fuentesClima.js';
import { ErrorHttp, invalido } from './errores.js';

const HORA = 3_600_000;
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

export function generarCuadricula(lat, lon, n, paso) {
  const mitad = (n - 1) / 2;
  const puntos = [];
  for (let f = 0; f < n; f++) {
    for (let c = 0; c < n; c++) {
      puntos.push({
        latitud: Math.round((lat + (mitad - f) * paso) * 1e4) / 1e4,
        longitud: Math.round((lon + (c - mitad) * paso) * 1e4) / 1e4,
      });
    }
  }
  return puntos;
}

// Dirección desde donde sopla (grados meteorológicos) promediando vectores.
export function direccionVectorial(direcciones, velocidades) {
  let u = 0;
  let v = 0;
  let n = 0;
  direcciones.forEach((d, i) => {
    const s = velocidades[i];
    if (d == null || s == null) return;
    const rad = (d * Math.PI) / 180;
    u += -s * Math.sin(rad);
    v += -s * Math.cos(rad);
    n++;
  });
  if (!n || (Math.abs(u) < 1e-9 && Math.abs(v) < 1e-9)) return null;
  return Math.round(((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360);
}

function procesarPunto(hourly, daily, modelos) {
  const med = (variable) => combinarModelos(hourly, variable, modelos).map((x) => x.mediana);
  const lluvia = med('precipitation');
  const velocidad = med('wind_speed_10m');
  const series = (variable) => modelos.map((m) => hourly[`${variable}_${m}`]).filter(Array.isArray);
  const dirs = series('wind_direction_10m');
  const vels = series('wind_speed_10m');
  if (Array.isArray(hourly.wind_direction_10m)) {
    dirs.push(hourly.wind_direction_10m);
    vels.push(hourly.wind_speed_10m ?? []);
  }
  const dmed = (variable) => combinarModelos(daily ?? { time: [] }, variable, modelos).map((x) => x.mediana);

  return {
    lluvia_mm: lluvia.map(r1),
    prob_lluvia: med('precipitation_probability').map((x) => (x == null ? null : Math.round(x))),
    temperatura_c: med('temperature_2m').map(r1),
    sensacion_c: med('apparent_temperature').map(r1),
    viento_ms: velocidad.map(r1),
    rafaga_ms: med('wind_gusts_10m').map(r1),
    viento_dir: (hourly.time ?? []).map((_, i) => direccionVectorial(dirs.map((s) => s[i]), vels.map((s) => s[i]))),
    nubes_pct: med('cloud_cover').map((x) => (x == null ? null : Math.round(x))),
    radiacion_wm2: med('shortwave_radiation').map((x) => (x == null ? null : Math.round(x))),
    uv: med('uv_index').map(r1),
    es_dia: med('is_day').map((x) => (x == null ? null : x >= 0.5 ? 1 : 0)),
    diario: daily?.time ? {
      fecha: daily.time,
      amanecer: (daily[`sunrise_${modelos[0]}`] ?? daily.sunrise ?? []).map((t) => t?.slice(11, 16) ?? null),
      atardecer: (daily[`sunset_${modelos[0]}`] ?? daily.sunset ?? []).map((t) => t?.slice(11, 16) ?? null),
      horas_sol: dmed('sunshine_duration').map((s) => (s == null ? null : r1(s / 3600))),
      uv_max: dmed('uv_index_max').map(r1),
      lluvia_mm: dmed('precipitation_sum').map(r1),
    } : null,
  };
}

export async function obtenerClimaRegional(db, finca, { n = 7, paso = 0.2, horas = 72, timezone, modelos = MODELOS_PRONOSTICO, fetchImpl = fetch }) {
  if (finca?.latitud == null || finca?.longitud == null) throw invalido({ finca: 'la finca no tiene coordenadas' });
  if (!Number.isInteger(n) || n < 1 || n > 9 || n % 2 === 0) throw invalido({ n: 'número impar entre 1 y 9' });
  if (!(paso >= 0.05 && paso <= 0.5)) throw invalido({ paso: 'entre 0.05 y 0.5 grados' });
  if (!Number.isInteger(horas) || horas < 6 || horas > 168) throw invalido({ horas: 'entre 6 y 168' });

  const lista = String(modelos).split(',').map((m) => m.trim()).filter(Boolean);
  const cuadricula = generarCuadricula(finca.latitud, finca.longitud, n, paso);
  // El primer punto es la finca exacta (detalle local); luego la cuadrícula.
  const puntos = [{ latitud: finca.latitud, longitud: finca.longitud }, ...cuadricula];
  const clave = `mapa:${finca.latitud}:${finca.longitud}:${n}:${paso}:${horas}:${lista.join('+')}`;

  const previo = await leerCache(db, clave);
  if (previo && Date.now() - Date.parse(previo.obtenido_en) < HORA) return { ...previo.datos, obtenido_en: previo.obtenido_en, desde_cache: true };

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: puntos.map((p) => p.latitud).join(','),
    longitude: puntos.map((p) => p.longitud).join(','),
    hourly: 'precipitation,precipitation_probability,temperature_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,shortwave_radiation,uv_index,is_day',
    daily: 'sunrise,sunset,sunshine_duration,uv_index_max,precipitation_sum',
    forecast_hours: String(horas),
    forecast_days: String(Math.min(16, Math.ceil(horas / 24) + 1)),
    wind_speed_unit: 'ms',
    timezone,
    models: lista.join(','),
  }).toString();

  let respuesta;
  try {
    const resp = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    respuesta = await resp.json();
  } catch (e) {
    if (previo) return { ...previo.datos, obtenido_en: previo.obtenido_en, desde_cache: true, desactualizado: true };
    throw new ErrorHttp(502, `No se pudo consultar el clima regional: ${e.message}`);
  }
  const lista_resp = Array.isArray(respuesta) ? respuesta : [respuesta];
  if (lista_resp.length !== puntos.length) throw new ErrorHttp(502, 'Respuesta de clima regional incompleta');

  const procesados = lista_resp.map((r) => procesarPunto(r.hourly ?? { time: [] }, r.daily, lista));
  const datos = {
    horas: lista_resp[0].hourly?.time ?? [],
    modelos: lista,
    cuadricula: { n, paso_grados: paso, paso_km_aprox: Math.round(paso * 111) },
    finca: { ...puntos[0], ...procesados[0] },
    puntos: cuadricula.map((p, i) => {
      const { diario, ...resto } = procesados[i + 1];
      return { ...p, ...resto };
    }),
    aviso: `Modelos con resolución de ~13–28 km: la cuadrícula (cada ${Math.round(paso * 111)} km) muestra el clima de la región, no diferencias entre lotes.`,
  };
  const obtenido_en = await guardarCache(db, clave, datos);
  return { ...datos, obtenido_en, desde_cache: false };
}
