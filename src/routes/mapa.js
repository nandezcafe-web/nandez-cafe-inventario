import { Router } from 'express';
import { obtenerClimaRegional } from '../lib/mapaClima.js';
import { noEncontrado } from '../lib/errores.js';
import { centroide } from '../lib/geo.js';

export function routerMapa(db, config) {
  const r = Router();

  // Clima horario en cuadrícula regional + detalle de la finca.
  r.get('/clima', async (req, res) => {
    const finca = await db.uno('SELECT * FROM fincas WHERE id = ?', [Number(req.query.finca_id ?? 1)]);
    if (!finca) throw noEncontrado('Finca');
    res.json(await obtenerClimaRegional(db, finca, {
      n: Number(req.query.n ?? 7),
      paso: Number(req.query.paso ?? 0.2),
      horas: Number(req.query.horas ?? 72),
      timezone: config.timezone,
      modelos: config.climaModelos,
      fetchImpl: config.fetchImpl,
    }));
  });

  // Todo lo que se dibuja sobre el mapa de la finca, en una sola consulta.
  r.get('/capas', async (req, res) => {
    const fincaId = Number(req.query.finca_id ?? 1);
    const finca = await db.uno('SELECT * FROM fincas WHERE id = ?', [fincaId]);
    if (!finca) throw noEncontrado('Finca');
    const lotes = (await db.todos('SELECT id, nombre, variedad, num_plantas, estado, area_ha, geometria FROM lotes WHERE finca_id = ? ORDER BY id', [fincaId]))
      .map((l) => {
        let geometria = null;
        try { geometria = l.geometria ? JSON.parse(l.geometria) : null; } catch { geometria = null; }
        return { ...l, geometria, centro: geometria ? centroide(geometria) : null };
      });
    const observaciones = await db.todos(`
      SELECT o.id, o.fecha, o.categoria, o.problema, o.severidad, o.estado, o.latitud, o.longitud, l.nombre AS lote
      FROM observaciones o JOIN lotes l ON l.id = o.lote_id
      WHERE l.finca_id = ? AND o.latitud IS NOT NULL AND o.longitud IS NOT NULL
      ORDER BY o.fecha DESC LIMIT 500`, [fincaId]);
    const productores = await db.todos(`
      SELECT id, nombre, finca, municipio, disposicion, variedades, latitud, longitud FROM productores
      WHERE latitud IS NOT NULL AND longitud IS NOT NULL`);
    res.json({ finca, lotes, observaciones, productores });
  });

  return r;
}
