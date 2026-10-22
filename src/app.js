import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { recursos, CRITERIOS_OPORTUNIDAD } from './resources.js';
import { crearRouterCrud } from './lib/crud.js';
import { ErrorHttp } from './lib/errores.js';
import { routerInteligencia } from './routes/inteligencia.js';
import { routerClima } from './routes/clima.js';
import { routerResumen } from './routes/resumen.js';
import { routerAdjuntos } from './routes/adjuntos.js';
import { routerExportar } from './routes/exportar.js';
import { routerPrediccion } from './routes/prediccion.js';
import { routerPlan } from './routes/plan.js';
import { routerMapa } from './routes/mapa.js';
import { routerContabilidad } from './routes/contabilidad.js';
import { routerRespaldo } from './routes/respaldo.js';

function tokenValido(recibido, esperado) {
  const a = Buffer.from(recibido ?? '');
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function crearApp(db, config) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/salud', (_req, res) => res.json({ ok: true, version: '0.1.0' }));

  if (config.apiToken) {
    app.use(['/api', '/uploads'], (req, _res, next) => {
      const token = req.get('authorization')?.replace(/^Bearer\s+/i, '') ?? req.query.token;
      if (!tokenValido(token, config.apiToken)) throw new ErrorHttp(401, 'Token inválido o ausente');
      next();
    });
  }

  // Esquema del modelo: lo usa el panel web para construir formularios.
  app.get('/api/esquema', (_req, res) => {
    res.json({
      recursos: Object.fromEntries(Object.entries(recursos).map(([k, v]) => [k, v])),
      criterios_oportunidad: CRITERIOS_OPORTUNIDAD,
    });
  });

  app.use('/api/resumen', routerResumen(db, config));
  app.use('/api/prediccion', routerPrediccion(db, config));
  app.use('/api/plan', routerPlan(db, config));
  app.use('/api/mapa', routerMapa(db, config));
  app.use('/api/clima', routerClima(db, config)); // antes del CRUD: /sincronizar y /diario
  app.use('/api/adjuntos', routerAdjuntos(db, config));
  app.use('/api/exportar', routerExportar(db));
  app.use('/api/respaldo', routerRespaldo(db));
  app.use('/api', routerContabilidad(db));
  app.use('/api', routerInteligencia(db));

  for (const [tabla, rec] of Object.entries(recursos)) {
    app.use(`/api/${tabla}`, crearRouterCrud(db, tabla, rec));
  }

  app.use('/uploads', express.static(config.uploadsDir, { fallthrough: false }));
  app.use('/vendor/leaflet', express.static(path.join(import.meta.dirname, '..', 'node_modules', 'leaflet', 'dist')));
  app.use(express.static(config.publicDir));

  app.use('/api', (_req, _res, next) => next(new ErrorHttp(404, 'Ruta no encontrada')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) err = new ErrorHttp(400, `Archivo inválido: ${err.message}`);
    if (err.type === 'entity.parse.failed') err = new ErrorHttp(400, 'JSON mal formado');
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({
      error: status >= 500 && !(err instanceof ErrorHttp) ? 'Error interno del servidor' : err.message,
      ...(err.detalles ? { detalles: err.detalles } : {}),
    });
  });

  return app;
}
