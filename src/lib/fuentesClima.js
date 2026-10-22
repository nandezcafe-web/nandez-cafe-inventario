// Fuentes externas de clima para la ubicación de la finca, con caché en SQLite.
//  - Open-Meteo Forecast: últimos días + pronóstico diario a 16 días.
//  - Open-Meteo Archive (reanálisis ERA5): climatología de ~10 años.
//  - NOAA CPC: índice ONI de El Niño / La Niña.
// Si una fuente falla y hay un dato guardado, se devuelve marcado como desactualizado.

import { ErrorHttp, invalido } from './errores.js';

const HORA = 3_600_000;

export async function leerCache(db, clave) {
  const fila = await db.uno('SELECT datos, obtenido_en FROM cache_externo WHERE clave = ?', [clave]);
  return fila ? { datos: JSON.parse(fila.datos), obtenido_en: fila.obtenido_en } : null;
}

export async function guardarCache(db, clave, datos) {
  const ahora = new Date().toISOString();
  await db.ejecutar(`INSERT INTO cache_externo (clave, datos, obtenido_en) VALUES (?, ?, ?)
    ON CONFLICT (clave) DO UPDATE SET datos = excluded.datos, obtenido_en = excluded.obtenido_en`, [clave, JSON.stringify(datos), ahora]);
  return ahora;
}

async function cacheado(db, clave, maxEdadMs, obtener) {
  const previo = await leerCache(db, clave);
  if (previo && Date.now() - Date.parse(previo.obtenido_en) < maxEdadMs) {
    return { ...previo, desde_cache: true, desactualizado: false };
  }
  try {
    const datos = await obtener();
    const obtenido_en = await guardarCache(db, clave, datos);
    return { datos, obtenido_en, desde_cache: false, desactualizado: false };
  } catch (e) {
    if (previo) return { ...previo, desde_cache: true, desactualizado: true, error: e.message };
    throw new ErrorHttp(502, `No se pudo consultar la fuente de clima: ${e.message}`);
  }
}

async function pedirJson(fetchImpl, url) {
  const resp = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function exigirCoordenadas(finca) {
  if (finca?.latitud == null || finca?.longitud == null) {
    throw invalido({ finca: 'la finca no tiene coordenadas (latitud/longitud)' });
  }
}

const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

// En la zona de la finca los modelos difieren mucho en lluvia (el "best_match" de
// Open-Meteo, ECMWF 9 km, llegó a dar 5–6 veces más lluvia que otros). Por eso se
// consulta un conjunto de modelos independientes y se usa la mediana, guardando el
// rango entre modelos como medida de incertidumbre.
export const MODELOS_PRONOSTICO = 'ecmwf_ifs025,gfs_seamless,icon_seamless';
export const MODELO_CLIMATOLOGIA = 'era5';

function mediana(xs) {
  const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Devuelve, para cada posición del bloque (daily u hourly), la mediana y el rango
// de una variable entre modelos. Acepta respuestas de un solo modelo (sin sufijo).
export function combinarModelos(bloque, variable, modelos) {
  const n = bloque?.time?.length ?? 0;
  const series = modelos.map((m) => bloque[`${variable}_${m}`]).filter(Array.isArray);
  if (Array.isArray(bloque?.[variable])) series.push(bloque[variable]);
  return Array.from({ length: n }, (_, i) => {
    const valores = series.map((s) => s[i]).filter((x) => x != null);
    return {
      mediana: mediana(valores),
      min: valores.length ? Math.min(...valores) : null,
      max: valores.length ? Math.max(...valores) : null,
      n: valores.length,
    };
  });
}

const listaModelos = (modelos) => String(modelos).split(',').map((m) => m.trim()).filter(Boolean);

// Pronóstico e historial reciente, diario.
export async function obtenerDiario(db, finca, { timezone, pasados = 30, futuros = 16, modelos = MODELOS_PRONOSTICO, fetchImpl = fetch }) {
  exigirCoordenadas(finca);
  const lista = listaModelos(modelos);
  const variables = {
    lluvia: 'precipitation_sum', prob: 'precipitation_probability_max', tmax: 'temperature_2m_max',
    tmin: 'temperature_2m_min', tmedia: 'temperature_2m_mean', hr: 'relative_humidity_2m_mean',
    viento: 'wind_speed_10m_max', rafaga: 'wind_gusts_10m_max', et0: 'et0_fao_evapotranspiration',
  };
  const params = {
    latitude: finca.latitud,
    longitude: finca.longitud,
    daily: Object.values(variables).join(','),
    past_days: String(pasados),
    forecast_days: String(futuros),
    wind_speed_unit: 'ms',
    timezone,
    models: lista.join(','),
  };
  // Con la altitud real, Open-Meteo corrige la temperatura por elevación.
  if (finca.altitud_msnm != null) params.elevation = String(finca.altitud_msnm);

  const clave = `diario:${finca.latitud}:${finca.longitud}:${finca.altitud_msnm ?? 'dem'}:${pasados}:${futuros}:${lista.join('+')}`;
  return cacheado(db, clave, HORA, async () => {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams(params).toString();
    const j = await pedirJson(fetchImpl, url);
    const d = j.daily ?? { time: [] };
    const c = Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, combinarModelos(d, v, lista)]));
    return {
      elevacion_modelo_m: j.elevation ?? null,
      modelos: lista,
      dias: (d.time ?? []).map((fecha, i) => ({
        fecha,
        lluvia_mm: r1(c.lluvia[i].mediana ?? 0),
        lluvia_min_mm: r1(c.lluvia[i].min),
        lluvia_max_mm: r1(c.lluvia[i].max),
        modelos_n: c.lluvia[i].n,
        prob_lluvia: c.prob[i].mediana == null ? null : Math.round(c.prob[i].mediana),
        tmax: r1(c.tmax[i].mediana),
        tmin: r1(c.tmin[i].mediana),
        tmedia: r1(c.tmedia[i].mediana),
        hr_media: c.hr[i].mediana == null ? null : Math.round(c.hr[i].mediana),
        viento_max: r1(c.viento[i].mediana),
        rafaga_max: r1(c.rafaga[i].mediana),
        et0_mm: r1(c.et0[i].mediana),
      })),
    };
  });
}

function percentil(valores, p) {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const idx = (v.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Resumen mensual a partir de datos diarios de varios años.
export function resumirClimatologia(diario) {
  const porAnioMes = new Map(); // "2020-03" → acumulados
  diario.time.forEach((fecha, i) => {
    const k = fecha.slice(0, 7);
    const a = porAnioMes.get(k) ?? { lluvia: 0, dias_lluvia: 0, tmedia: [], tmax: [], tmin: [], et0: 0 };
    const ll = diario.precipitation_sum?.[i] ?? 0;
    a.lluvia += ll;
    if (ll >= 1) a.dias_lluvia++;
    if (diario.temperature_2m_mean?.[i] != null) a.tmedia.push(diario.temperature_2m_mean[i]);
    if (diario.temperature_2m_max?.[i] != null) a.tmax.push(diario.temperature_2m_max[i]);
    if (diario.temperature_2m_min?.[i] != null) a.tmin.push(diario.temperature_2m_min[i]);
    a.et0 += diario.et0_fao_evapotranspiration?.[i] ?? 0;
    porAnioMes.set(k, a);
  });

  const prom = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const meses = MESES.map((nombre, m) => {
    const del = [...porAnioMes.entries()].filter(([k]) => Number(k.slice(5, 7)) === m + 1).map(([, v]) => v);
    const lluvias = del.map((v) => v.lluvia);
    return {
      mes: m + 1,
      nombre,
      anios: del.length,
      lluvia_media_mm: r1(prom(lluvias)),
      lluvia_anio_seco_mm: r1(percentil(lluvias, 0.1)),
      lluvia_anio_lluvioso_mm: r1(percentil(lluvias, 0.9)),
      dias_lluvia_media: r1(prom(del.map((v) => v.dias_lluvia))),
      tmedia_c: r1(prom(del.flatMap((v) => v.tmedia))),
      tmax_media_c: r1(prom(del.flatMap((v) => v.tmax))),
      tmin_media_c: r1(prom(del.flatMap((v) => v.tmin))),
      et0_media_mm: r1(prom(del.map((v) => v.et0))),
    };
  });

  const orden = [...meses].filter((m) => m.lluvia_media_mm != null).sort((a, b) => a.lluvia_media_mm - b.lluvia_media_mm);
  for (const m of meses) {
    m.balance_mm = m.lluvia_media_mm != null && m.et0_media_mm != null ? r1(m.lluvia_media_mm - m.et0_media_mm) : null;
    const pos = orden.indexOf(m);
    m.temporada = pos < 3 ? 'mas_seco' : pos >= orden.length - 3 ? 'mas_lluvioso' : 'intermedio';
  }
  return {
    meses,
    lluvia_anual_media_mm: r1(meses.reduce((s, m) => s + (m.lluvia_media_mm ?? 0), 0)),
    tmedia_anual_c: r1(prom(meses.map((m) => m.tmedia_c).filter((x) => x != null))),
  };
}

export async function obtenerClimatologia(db, finca, { anios = 10, modelo = MODELO_CLIMATOLOGIA, fetchImpl = fetch, hoy = new Date() }) {
  exigirCoordenadas(finca);
  const ultimoAnio = hoy.getUTCFullYear() - 1;
  const inicio = `${ultimoAnio - anios + 1}-01-01`;
  const fin = `${ultimoAnio}-12-31`;
  const clave = `climatologia:${finca.latitud}:${finca.longitud}:${finca.altitud_msnm ?? 'dem'}:${inicio}:${fin}:${modelo}`;

  return cacheado(db, clave, 30 * 24 * HORA, async () => {
    const url = new URL('https://archive-api.open-meteo.com/v1/archive');
    const params = {
      latitude: finca.latitud,
      longitude: finca.longitud,
      start_date: inicio,
      end_date: fin,
      daily: 'precipitation_sum,temperature_2m_mean,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration',
      timezone: 'America/Bogota',
      models: modelo,
    };
    if (finca.altitud_msnm != null) params.elevation = String(finca.altitud_msnm);
    url.search = new URLSearchParams(params).toString();
    const j = await pedirJson(fetchImpl, url);
    return { periodo: { inicio, fin }, modelo, elevacion_modelo_m: j.elevation ?? null, ...resumirClimatologia(j.daily ?? { time: [] }) };
  });
}

// Índice Oceánico El Niño (ONI): anomalía de temperatura del Pacífico en trimestres móviles.
export function parsearOni(texto) {
  const filas = [];
  for (const linea of texto.split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z]{3})\s+(\d{4})\s+(-?[\d.]+)\s+(-?[\d.]+)\s*$/);
    if (m) filas.push({ trimestre: m[1], anio: Number(m[2]), anomalia: Number(m[4]) });
  }
  return filas;
}

export function faseEnso(anomalia, umbral = 0.5) {
  if (anomalia >= umbral) return 'el_nino';
  if (anomalia <= -umbral) return 'la_nina';
  return 'neutral';
}

export async function obtenerEnso(db, { fetchImpl = fetch } = {}) {
  return cacheado(db, 'enso:oni', 24 * HORA, async () => {
    const resp = await fetchImpl('https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt', { signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const filas = parsearOni(await resp.text());
    if (!filas.length) throw new Error('formato ONI no reconocido');
    const ultimas = filas.slice(-6);
    const actual = ultimas.at(-1);
    return {
      actual: { ...actual, fase: faseEnso(actual.anomalia) },
      tendencia: ultimas.map((f) => ({ ...f, fase: faseEnso(f.anomalia) })),
      fuente: 'NOAA CPC — Oceanic Niño Index (ONI)',
    };
  });
}
