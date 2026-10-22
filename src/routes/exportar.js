import { Router } from 'express';
import { recursos } from '../resources.js';
import { noEncontrado } from '../lib/errores.js';
import { filtrosDesdeQuery } from '../lib/crud.js';

function celdaCsv(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/exportar/:recurso.csv — acepta los mismos filtros que el listado.
// Separador ";" y BOM para que Excel en español lo abra correctamente.
export function routerExportar(db) {
  const r = Router();
  r.get('/:archivo', async (req, res) => {
    const tabla = req.params.archivo.replace(/\.csv$/, '');
    const rec = recursos[tabla];
    if (!rec) throw noEncontrado('Recurso');
    const { sql, params } = filtrosDesdeQuery(rec, req.query);
    const columnas = ['id', ...Object.keys(rec.campos), 'creado_en', 'actualizado_en'];
    const filas = await db.todos(`SELECT * FROM "${tabla}" ${sql} ORDER BY id`, [...params]);

    const lineas = [columnas.join(';'), ...filas.map((f) => columnas.map((c) => celdaCsv(f[c])).join(';'))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${tabla}.csv"`);
    res.send(`﻿${lineas.join('\r\n')}`);
  });
  return r;
}
