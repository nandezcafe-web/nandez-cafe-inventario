import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import { ErrorHttp } from '../lib/errores.js';
import { respaldar } from '../db/index.js';

// Descarga de respaldo de la base.
//
// No copia `cafe.db` tal cual: mientras el servidor escribe, parte de los datos
// está en el archivo WAL y una copia directa puede quedar incompleta o
// corrupta. `VACUUM INTO` le pide a SQLite que escriba un archivo nuevo,
// consistente y ya compactado, sin detener el servidor.
//
// Queda bajo /api, así que exige la clave de acceso igual que todo lo demás.
// Entrega la base completa, pero no revela nada que la clave no permita ya leer
// recurso por recurso.
export function routerRespaldo(db) {
  const r = Router();

  r.get('/', async (_req, res) => {
    const temporal = path.join(os.tmpdir(), `respaldo-${crypto.randomUUID()}.sqlite`);
    try {
      await respaldar(db, temporal);
    } catch (e) {
      throw new ErrorHttp(500, `No se pudo preparar el respaldo: ${e.message}`);
    }

    const limpiar = () => fs.rm(temporal, { force: true }, () => {});
    let bytes = 0;
    try {
      bytes = fs.statSync(temporal).size;
    } catch { /* si no se puede leer el tamaño, no es motivo para fallar */ }

    const nombre = `nandez-cafe-${new Date().toISOString().slice(0, 10)}.sqlite`;
    res.setHeader('X-Respaldo-Bytes', String(bytes));
    res.download(temporal, nombre, (err) => {
      limpiar();
      if (err && !res.headersSent) res.status(500).json({ error: 'Falló la descarga del respaldo' });
    });
  });

  return r;
}
