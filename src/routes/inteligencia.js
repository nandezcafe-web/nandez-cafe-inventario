import { Router } from 'express';
import { evaluarBiomasa, estimarGeneracion } from '../lib/biomasa.js';
import { costoPuestoEnPlanta, haversineKm } from '../lib/logistica.js';
import { indiceOportunidad } from '../lib/derivados.js';
import { invalido, noEncontrado } from '../lib/errores.js';
import { CRITERIOS_OPORTUNIDAD } from '../resources.js';
import { SUBPRODUCTOS_INFO } from '../conocimiento/subproductos.js';

export function routerInteligencia(db) {
  const r = Router();

  // Base de conocimiento completa (para consulta y para el panel).
  r.get('/biomasa/conocimiento', (_req, res) => res.json(SUBPRODUCTOS_INFO));

  // "Tengo X kg de Y"
  r.post('/biomasa/evaluar', (req, res) => res.json(evaluarBiomasa(req.body ?? {})));

  // Subproductos esperados de X kg de cereza
  r.get('/biomasa/generacion', (req, res) => {
    res.json(estimarGeneracion(req.query.kg_cereza, req.query.proceso));
  });

  // Costo puesto en planta. Si llega productor_id sin distancia, la estima
  // desde la finca (línea recta × factor de ruta).
  r.post('/logistica/costo', async (req, res) => {
    const p = { ...(req.body ?? {}) };
    let distanciaEstimada = null;
    if ((p.distancia_km === undefined || p.distancia_km === '') && p.productor_id) {
      const prod = await db.uno('SELECT latitud, longitud, nombre FROM productores WHERE id = ?', [Number(p.productor_id)]);
      if (!prod) throw noEncontrado('Productor');
      const finca = p.finca_id
        ? await db.uno('SELECT latitud, longitud FROM fincas WHERE id = ?', [Number(p.finca_id)])
        : await db.uno('SELECT latitud, longitud FROM fincas ORDER BY id LIMIT 1');
      if (prod.latitud == null || !finca || finca.latitud == null) {
        throw invalido({ distancia_km: 'faltan coordenadas del productor o de la finca; ingrese la distancia' });
      }
      const factor = Number(p.factor_ruta ?? 1.4);
      const linea = haversineKm(finca.latitud, finca.longitud, prod.latitud, prod.longitud);
      p.distancia_km = Math.round(linea * factor * 10) / 10;
      distanciaEstimada = { linea_recta_km: Math.round(linea * 10) / 10, factor_ruta: factor, productor: prod.nombre };
    }
    res.json({ ...costoPuestoEnPlanta(p), distancia_estimada: distanciaEstimada });
  });

  // Matriz de oportunidades ordenada por índice. Pesos opcionales: ?peso_demanda=2
  r.get('/oportunidades-ranking', async (req, res) => {
    const pesos = {};
    for (const [c] of CRITERIOS_OPORTUNIDAD) {
      const v = req.query[`peso_${c}`];
      if (v !== undefined) {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) throw invalido({ [`peso_${c}`]: 'debe ser un número ≥ 0' });
        pesos[c] = n;
      }
    }
    const filas = await db.todos("SELECT * FROM oportunidades WHERE estado IS NOT 'descartada'");
    const ranking = filas
      .map((o) => ({ id: o.id, nombre: o.nombre, subproducto: o.subproducto, linea: o.linea, estado: o.estado, ...indiceOportunidad(o, pesos) }))
      .sort((a, b) => (b.indice ?? -1) - (a.indice ?? -1));
    res.json({
      criterios: CRITERIOS_OPORTUNIDAD.map(([id, etiqueta]) => ({ id, etiqueta, peso: pesos[id] ?? 1 })),
      escala: '1–5 de favorabilidad (5 = más conveniente). Índice 0–100.',
      ranking,
    });
  });

  // Inventario regional de biomasa: ¿cuánto hay disponible, de qué y dónde?
  r.get('/biomasa/inventario', async (req, res) => {
    const estados = String(req.query.estados ?? 'disponible,recolectado,almacenado').split(',');
    const marcas = estados.map(() => '?').join(',');
    const filas = await db.todos(`
      SELECT s.tipo, s.origen, COALESCE(p.nombre, f.nombre) AS fuente,
             COUNT(*) AS partidas, SUM(s.kg_frescos) AS kg_frescos,
             SUM(COALESCE(s.kg_secos, s.kg_frescos * (1 - s.humedad_pct / 100.0))) AS kg_secos_conocidos,
             MIN(s.fecha) AS desde, MAX(s.fecha) AS hasta
      FROM subproductos s
      LEFT JOIN productores p ON p.id = s.productor_id
      LEFT JOIN fincas f ON f.id = s.finca_id
      WHERE s.estado IN (${marcas})
      GROUP BY s.tipo, s.origen, fuente
      ORDER BY s.tipo, kg_frescos DESC`, [...estados]);
    res.json({ estados, datos: filas });
  });

  return r;
}
