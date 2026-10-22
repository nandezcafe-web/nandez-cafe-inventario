import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { recursos } from '../resources.js';
import { ErrorHttp, invalido, noEncontrado } from '../lib/errores.js';

const TIPOS_PERMITIDOS = /^(image\/(jpeg|png|webp|heic|heif|tiff)|application\/pdf|text\/csv)$/;

// Vercel corta toda petición de más de 4,5 MB antes de que llegue al
// servidor. En línea el tope es 4 MB por archivo para que el error lo dé la
// app, con un mensaje que se entiende, y no la plataforma.
const MB = 1024 * 1024;

export function routerAdjuntos(db, config, almacen) {
  const topeMb = config.enLinea ? 4 : 25;

  // Los archivos quedan en memoria hasta saber que el registro existe; recién
  // ahí se guardan. Así no quedan archivos huérfanos de subidas rechazadas.
  const subida = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: topeMb * MB, files: 10 },
    fileFilter: (_req, file, cb) => cb(null, TIPOS_PERMITIDOS.test(file.mimetype)),
  });

  const recibir = (req, res, next) => {
    // Si en línea no hay dónde guardar, se avisa antes de recibir el archivo.
    if (!almacen.disponible) throw new ErrorHttp(503, almacen.motivo);
    subida.array('archivos', 10)(req, res, (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') {
        return next(new ErrorHttp(413, `El archivo pasa de ${topeMb} MB. Reduzca la foto o envíela con menos resolución.`));
      }
      next(err);
    });
  };

  const r = Router();

  // multipart/form-data: entidad, entidad_id, descripcion, archivos[] (campo "archivos")
  r.post('/', recibir, async (req, res) => {
    const archivos = req.files ?? [];
    const { entidad, descripcion } = req.body ?? {};
    const entidadId = Number(req.body?.entidad_id);

    if (!recursos[entidad] || entidad === 'adjuntos') throw invalido({ entidad: 'recurso inválido' });
    if (!Number.isInteger(entidadId) || !await db.uno(`SELECT 1 FROM "${entidad}" WHERE id = ?`, [entidadId])) {
      throw invalido({ entidad_id: 'el registro no existe' });
    }
    if (!archivos.length) throw invalido({ archivos: `adjunte al menos un archivo (imagen, PDF o CSV, máx. ${topeMb} MB)` });

    const insertar = `INSERT INTO adjuntos (entidad, entidad_id, archivo, nombre_original, mime, tamano_bytes, descripcion)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`;
    const creados = [];
    for (const f of archivos) {
      const ext = path.extname(f.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
      const nombre = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
      // Primero el archivo y después el registro: si falla guardar, no queda un
      // registro apuntando a una foto que no existe.
      await almacen.guardar(nombre, f.buffer, f.mimetype);
      const { id } = await db.uno(insertar, [entidad, entidadId, nombre, f.originalname, f.mimetype, f.size, descripcion ?? null]);
      creados.push(await db.uno('SELECT * FROM adjuntos WHERE id = ?', [Number(id)]));
    }
    res.status(201).json({ datos: creados });
  });

  r.delete('/:id', async (req, res) => {
    const adj = await db.uno('SELECT * FROM adjuntos WHERE id = ?', [Number(req.params.id)]);
    if (!adj) throw noEncontrado('Adjunto');
    await db.ejecutar('DELETE FROM adjuntos WHERE id = ?', [adj.id]);
    await almacen.borrar(adj.archivo);
    res.status(204).end();
  });

  return r;
}
