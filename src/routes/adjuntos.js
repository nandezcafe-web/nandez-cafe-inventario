import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { recursos } from '../resources.js';
import { invalido, noEncontrado } from '../lib/errores.js';

const TIPOS_PERMITIDOS = /^(image\/(jpeg|png|webp|heic|heif|tiff)|application\/pdf|text\/csv)$/;

export function routerAdjuntos(db, config) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });

  const subida = multer({
    storage: multer.diskStorage({
      destination: config.uploadsDir,
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
        cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
      },
    }),
    limits: { fileSize: 25 * 1024 * 1024, files: 10 },
    fileFilter: (_req, file, cb) => cb(null, TIPOS_PERMITIDOS.test(file.mimetype)),
  });

  const r = Router();

  // multipart/form-data: entidad, entidad_id, descripcion, archivos[] (campo "archivos")
  r.post('/', subida.array('archivos', 10), async (req, res) => {
    const archivos = req.files ?? [];
    const borrar = () => archivos.forEach((f) => fs.rmSync(f.path, { force: true }));
    const { entidad, descripcion } = req.body ?? {};
    const entidadId = Number(req.body?.entidad_id);

    if (!recursos[entidad] || entidad === 'adjuntos') {
      borrar();
      throw invalido({ entidad: 'recurso inválido' });
    }
    if (!Number.isInteger(entidadId) || !await db.uno(`SELECT 1 FROM "${entidad}" WHERE id = ?`, [entidadId])) {
      borrar();
      throw invalido({ entidad_id: 'el registro no existe' });
    }
    if (!archivos.length) throw invalido({ archivos: 'adjunte al menos un archivo (imagen, PDF o CSV, máx. 25 MB)' });

    const insertar = `INSERT INTO adjuntos (entidad, entidad_id, archivo, nombre_original, mime, tamano_bytes, descripcion)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`;
    const creados = [];
    for (const f of archivos) {
      const { id } = await db.uno(insertar, [entidad, entidadId, f.filename, f.originalname, f.mimetype, f.size, descripcion ?? null]);
      creados.push(await db.uno('SELECT * FROM adjuntos WHERE id = ?', [Number(id)]));
    }
    res.status(201).json({ datos: creados });
  });

  r.delete('/:id', async (req, res) => {
    const adj = await db.uno('SELECT * FROM adjuntos WHERE id = ?', [Number(req.params.id)]);
    if (!adj) throw noEncontrado('Adjunto');
    await db.ejecutar('DELETE FROM adjuntos WHERE id = ?', [adj.id]);
    fs.rmSync(path.join(config.uploadsDir, path.basename(adj.archivo)), { force: true });
    res.status(204).end();
  });

  return r;
}
