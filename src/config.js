import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '127.0.0.1',
  dbPath: process.env.DB_PATH === ':memory:'
    ? ':memory:'
    : path.resolve(raiz, process.env.DB_PATH ?? 'data/cafe.db'),
  uploadsDir: path.resolve(raiz, process.env.UPLOADS_DIR ?? 'data/uploads'),
  apiToken: process.env.API_TOKEN || null,
  timezone: process.env.TIMEZONE ?? 'America/Bogota',
  // Cada cuántas horas se sincroniza el clima y se recalculan los riesgos (0 = desactivado).
  climaAutoHoras: Number(process.env.CLIMA_AUTO_HORAS ?? 3),
  // Modelos de Open-Meteo combinados por mediana (ver src/lib/fuentesClima.js).
  climaModelos: process.env.CLIMA_MODELOS || undefined,
  publicDir: path.join(raiz, 'public'),
};
