import { Router } from 'express';
import { ErrorHttp, invalido, noEncontrado } from '../lib/errores.js';
import { combinarModelos, MODELOS_PRONOSTICO } from '../lib/fuentesClima.js';

const VARIABLES = 'temperature_2m,relative_humidity_2m,precipitation,shortwave_radiation,wind_speed_10m';

// Descarga clima horario de Open-Meteo (modelo meteorológico, gratuito, sin clave).
// No reemplaza una estación en la finca: sirve como referencia y para llenar vacíos.
export async function sincronizarOpenMeteo(db, { fincaId, dias, timezone, modelos = MODELOS_PRONOSTICO, fetchImpl = fetch }) {
  const lista = String(modelos).split(',').map((m) => m.trim()).filter(Boolean);
  const finca = await db.uno('SELECT id, latitud, longitud FROM fincas WHERE id = ?', [fincaId]);
  if (!finca) throw noEncontrado('Finca');
  if (finca.latitud == null || finca.longitud == null) throw invalido({ finca: 'la finca no tiene coordenadas' });

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: finca.latitud,
    longitude: finca.longitud,
    hourly: VARIABLES,
    past_days: String(dias),
    forecast_days: '1',
    wind_speed_unit: 'ms',
    timezone,
    models: lista.join(','),
  }).toString();

  let datos;
  try {
    const resp = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    datos = await resp.json();
  } catch (e) {
    throw new ErrorHttp(502, `No se pudo consultar Open-Meteo: ${e.message}`);
  }

  const h = datos.hourly ?? { time: [] };
  const med = (variable) => combinarModelos(h, variable, lista).map((x) => (x.mediana == null ? null : Math.round(x.mediana * 10) / 10));
  const temp = med('temperature_2m');
  const hr = med('relative_humidity_2m');
  const lluvia = med('precipitation');
  const rad = med('shortwave_radiation');
  const viento = med('wind_speed_10m');
  const ahora = new Date().toLocaleString('sv-SE', { timeZone: timezone }).replace(' ', 'T').slice(0, 16);
  const insertar = `
    INSERT INTO clima (finca_id, fecha_hora, temperatura_c, humedad_rel_pct, precipitacion_mm, radiacion_wm2, viento_ms, fuente, actualizado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'open_meteo', ?)
    ON CONFLICT (finca_id, fecha_hora, fuente) DO UPDATE SET
      temperatura_c = excluded.temperatura_c, humedad_rel_pct = excluded.humedad_rel_pct,
      precipitacion_mm = excluded.precipitacion_mm, radiacion_wm2 = excluded.radiacion_wm2,
      viento_ms = excluded.viento_ms, actualizado_en = excluded.actualizado_en`;
  const marca = new Date().toISOString();

  let guardados = 0;
  await db.transaccion(async () => {
    for (const [i, t] of (h.time ?? []).entries()) {
      if (t > ahora) continue; // solo horas ya ocurridas, no pronóstico
      await db.ejecutar(insertar, [finca.id, t, temp[i], hr[i], lluvia[i], rad[i], viento[i], marca]);
      guardados++;
    }
  });
  return { finca_id: finca.id, horas_guardadas: guardados, fuente: 'open_meteo', modelos: lista, elevacion_modelo_m: datos.elevation ?? null };
}

export function routerClima(db, config) {
  const r = Router();

  r.post('/sincronizar', async (req, res) => {
    const fincaId = Number(req.body?.finca_id ?? req.query.finca_id ?? 1);
    const dias = Number(req.body?.dias ?? req.query.dias ?? 7);
    if (!Number.isInteger(dias) || dias < 1 || dias > 92) throw invalido({ dias: 'entre 1 y 92' });
    res.json(await sincronizarOpenMeteo(db, { fincaId, dias, timezone: config.timezone, modelos: config.climaModelos, fetchImpl: config.fetchImpl }));
  });

  // Resumen diario: temperatura mín/media/máx, humedad media, lluvia acumulada.
  r.get('/diario', async (req, res) => {
    const fincaId = Number(req.query.finca_id ?? 1);
    const params = [fincaId];
    let filtro = '';
    if (req.query.fuente) {
      filtro += ' AND fuente = ?';
      params.push(String(req.query.fuente));
    }
    if (req.query.desde) {
      filtro += ' AND fecha_hora >= ?';
      params.push(String(req.query.desde));
    }
    if (req.query.hasta) {
      filtro += ' AND substr(fecha_hora, 1, 10) <= ?';
      params.push(String(req.query.hasta).slice(0, 10));
    }
    const filas = await db.todos(`
      SELECT substr(fecha_hora, 1, 10) AS fecha, fuente,
             ROUND(MIN(temperatura_c), 1) AS temp_min, ROUND(AVG(temperatura_c), 1) AS temp_media,
             ROUND(MAX(temperatura_c), 1) AS temp_max, ROUND(AVG(humedad_rel_pct), 0) AS humedad_media,
             ROUND(SUM(precipitacion_mm), 1) AS lluvia_mm, COUNT(*) AS lecturas
      FROM clima WHERE finca_id = ? ${filtro}
      GROUP BY fecha, fuente ORDER BY fecha DESC LIMIT 400`, [...params]);
    res.json({ datos: filas });
  });

  return r;
}
