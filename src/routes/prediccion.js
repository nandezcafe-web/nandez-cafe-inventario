import { Router } from 'express';
import { calcularPrediccion, hoyEn } from '../lib/prediccion.js';
import { obtenerClimatologia, obtenerEnso } from '../lib/fuentesClima.js';
import { noEncontrado } from '../lib/errores.js';

export function routerPrediccion(db, config) {
  const r = Router();
  const fetchImpl = config.fetchImpl ?? fetch;

  // Riesgos, pronóstico, historial reciente y ventanas de labores.
  r.get('/', async (req, res) => {
    res.json(await calcularPrediccion(db, Number(req.query.finca_id ?? 1), { timezone: config.timezone, modelos: config.climaModelos, fetchImpl }));
  });

  // ¿Qué suele pasar en la ubicación mes a mes? + lo que viene en los próximos 3 meses.
  r.get('/climatologia', async (req, res) => {
    const finca = db.prepare('SELECT * FROM fincas WHERE id = ?').get(Number(req.query.finca_id ?? 1));
    if (!finca) throw noEncontrado('Finca');
    const clima = await obtenerClimatologia(db, finca, { fetchImpl });
    const mesActual = Number(hoyEn(config.timezone).slice(5, 7));
    const proximos = [0, 1, 2, 3].map((k) => clima.datos.meses[(mesActual - 1 + k) % 12]).map((m) => ({
      ...m,
      que_esperar: queEsperar(m),
    }));
    res.json({
      ...clima.datos,
      proximos_meses: proximos,
      fuente: { nombre: `Open-Meteo Archive (reanálisis ${clima.datos.modelo?.toUpperCase() ?? 'ERA5'})`, obtenido_en: clima.obtenido_en, desactualizado: clima.desactualizado },
      aviso: 'Promedios de ~10 años de reanálisis para las coordenadas. "Año seco" y "año lluvioso" son los percentiles 10 y 90.',
    });
  });

  r.get('/enso', async (_req, res) => {
    const e = await obtenerEnso(db, { fetchImpl });
    res.json({ ...e.datos, obtenido_en: e.obtenido_en, desactualizado: e.desactualizado });
  });

  return r;
}

function queEsperar(m) {
  const partes = [];
  if (m.temporada === 'mas_lluvioso') partes.push(`${capital(m.nombre)} es de los meses más lluviosos: preparar drenajes, vigilar roya y evitar fertilizar antes de aguaceros.`);
  else if (m.temporada === 'mas_seco') partes.push(`${capital(m.nombre)} es de los meses más secos: proteger lotes jóvenes, conservar humedad y vigilar broca.`);
  else partes.push(`${capital(m.nombre)} es un mes intermedio en lluvias.`);
  if (m.balance_mm != null && m.balance_mm < 0) partes.push(`En promedio la evapotranspiración supera a la lluvia (${m.balance_mm} mm).`);
  if (m.lluvia_anio_seco_mm != null) partes.push(`Rango habitual de lluvia: ${m.lluvia_anio_seco_mm}–${m.lluvia_anio_lluvioso_mm} mm.`);
  return partes.join(' ');
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
