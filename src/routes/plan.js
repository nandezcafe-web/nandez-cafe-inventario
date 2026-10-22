import { Router } from 'express';
import { PLANTILLAS } from '../conocimiento/plan_cultivo.js';
import { TIPO_A_VENTANA } from '../conocimiento/agroclima.js';
import { recursos } from '../resources.js';
import { transaccion } from '../db/index.js';
import { ErrorHttp, invalido, noEncontrado } from '../lib/errores.js';
import { sumarDias } from '../lib/derivados.js';
import { validarRegistro } from '../lib/validar.js';
import { leerUno } from '../lib/crud.js';
import { calcularPrediccion, hoyEn } from '../lib/prediccion.js';
import { mejorDia } from '../lib/agroclima.js';

function etapaDe(lote, hoy) {
  if (lote.estado && PLANTILLAS[lote.estado]) return lote.estado;
  if (lote.fecha_siembra && sumarDias(lote.fecha_siembra, 730) <= hoy) return 'produccion';
  return 'levante';
}

export function routerPlan(db, config) {
  const r = Router();
  const fetchImpl = config.fetchImpl ?? fetch;

  // Crea el plan base de un lote a partir de la plantilla de su etapa.
  r.post('/generar', (req, res) => {
    const hoy = hoyEn(config.timezone);
    const loteId = Number(req.body?.lote_id);
    const lote = db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId);
    if (!lote) throw invalido({ lote_id: 'el lote no existe' });
    const desde = req.body?.desde ? validarRegistro({ campos: { d: { tipo: 'fecha' } } }, { d: req.body.desde }).d : hoy;
    const etapa = req.body?.etapa ?? etapaDe(lote, hoy);
    const plantilla = PLANTILLAS[etapa];
    if (!plantilla) throw invalido({ etapa: `use: ${Object.keys(PLANTILLAS).join(', ')}` });

    const existentes = db.prepare(
      "SELECT COUNT(*) AS n FROM plan_labores WHERE lote_id = ? AND origen = 'plantilla' AND estado = 'pendiente'",
    ).get(loteId).n;
    if (existentes && !req.body?.reemplazar) {
      throw new ErrorHttp(409, `El lote ya tiene ${existentes} tareas de plantilla pendientes. Envíe "reemplazar": true para regenerarlas.`);
    }

    const creadas = transaccion(db, () => {
      if (existentes) {
        db.prepare("DELETE FROM plan_labores WHERE lote_id = ? AND origen = 'plantilla' AND estado = 'pendiente'").run(loteId);
      }
      const stmt = db.prepare(`INSERT INTO plan_labores
        (lote_id, tipo, titulo, fecha_programada, ventana_dias, repetir_cada_dias, prioridad, estado, origen, notas)
        VALUES (?, ?, ?, ?, 3, ?, ?, 'pendiente', 'plantilla', ?)`);
      return plantilla.map((t) => {
        const info = stmt.run(loteId, t.tipo, t.titulo, sumarDias(desde, t.inicio), t.cada, t.prioridad,
          'Tarea de plantilla: ajustar frecuencia, producto y dosis con el agrónomo.');
        return leerUno(db, 'plan_labores', recursos.plan_labores, Number(info.lastInsertRowid));
      });
    });
    res.status(201).json({ lote: lote.nombre, etapa, desde, datos: creadas });
  });

  // Marca una tarea como hecha, registra la labor y programa la siguiente.
  r.post('/:id/completar', (req, res) => {
    const id = Number(req.params.id);
    const tarea = db.prepare('SELECT * FROM plan_labores WHERE id = ?').get(id);
    if (!tarea) throw noEncontrado('Tarea');
    if (tarea.estado !== 'pendiente') throw new ErrorHttp(409, `La tarea ya está ${tarea.estado}`);

    const hoy = hoyEn(config.timezone);
    const cuerpo = req.body ?? {};
    const actividad = validarRegistro(recursos.actividades, {
      lote_id: tarea.lote_id,
      tipo: tarea.tipo,
      fecha: cuerpo.fecha ?? hoy,
      producto: cuerpo.producto ?? tarea.producto,
      dosis: cuerpo.dosis ?? tarea.dosis,
      unidad: cuerpo.unidad ?? tarea.unidad,
      plantas_intervenidas: cuerpo.plantas_intervenidas,
      jornales: cuerpo.jornales,
      costo_cop: cuerpo.costo_cop,
      responsable: cuerpo.responsable ?? tarea.responsable,
      notas: [tarea.titulo, cuerpo.notas].filter(Boolean).join(' — '),
    });

    const resultado = transaccion(db, () => {
      const cols = Object.keys(actividad).filter((c) => actividad[c] !== null);
      const info = db.prepare(`INSERT INTO actividades (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
        .run(...cols.map((c) => actividad[c]));
      const actividadId = Number(info.lastInsertRowid);
      db.prepare(`UPDATE plan_labores SET estado = 'hecha', actividad_id = ?,
        actualizado_en = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(actividadId, id);

      let siguiente = null;
      if (tarea.repetir_cada_dias) {
        const s = db.prepare(`INSERT INTO plan_labores
          (lote_id, tipo, titulo, fecha_programada, ventana_dias, repetir_cada_dias, prioridad, estado, producto, dosis, unidad, responsable, origen, notas)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?, ?)`).run(
          tarea.lote_id, tarea.tipo, tarea.titulo, sumarDias(actividad.fecha, tarea.repetir_cada_dias), tarea.ventana_dias,
          tarea.repetir_cada_dias, tarea.prioridad, tarea.producto, tarea.dosis, tarea.unidad, tarea.responsable, tarea.origen, tarea.notas,
        );
        siguiente = leerUno(db, 'plan_labores', recursos.plan_labores, Number(s.lastInsertRowid));
      }
      return {
        actividad: leerUno(db, 'actividades', recursos.actividades, actividadId),
        tarea: leerUno(db, 'plan_labores', recursos.plan_labores, id),
        siguiente,
      };
    });
    res.status(201).json(resultado);
  });

  // Agenda: tareas pendientes (y repeticiones proyectadas) con el mejor día según el clima.
  r.get('/agenda', async (req, res) => {
    const fincaId = Number(req.query.finca_id ?? 1);
    const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 365);
    const hoy = hoyEn(config.timezone);
    const hasta = sumarDias(hoy, dias);

    const pendientes = db.prepare(`
      SELECT p.*, l.nombre AS lote FROM plan_labores p JOIN lotes l ON l.id = p.lote_id
      WHERE l.finca_id = ? AND p.estado = 'pendiente' AND p.fecha_programada <= ?
      ORDER BY p.fecha_programada`).all(fincaId, hasta);

    const items = [];
    for (const t of pendientes) {
      items.push({ ...t, proyectada: false });
      if (t.repetir_cada_dias) {
        let f = sumarDias(t.fecha_programada < hoy ? hoy : t.fecha_programada, t.repetir_cada_dias);
        while (f <= hasta) {
          items.push({ ...t, id: null, tarea_origen_id: t.id, fecha_programada: f, proyectada: true });
          f = sumarDias(f, t.repetir_cada_dias);
        }
      }
    }

    let ventanas = null;
    let avisoClima = null;
    try {
      ventanas = (await calcularPrediccion(db, fincaId, { timezone: config.timezone, modelos: config.climaModelos, fetchImpl })).ventanas;
    } catch (e) {
      avisoClima = `Sin pronóstico disponible: ${e.message}`;
    }

    const datos = items
      .sort((a, b) => a.fecha_programada.localeCompare(b.fecha_programada) || (a.proyectada - b.proyectada))
      .map((t) => {
        const vencida = !t.proyectada && t.fecha_programada < hoy;
        const tipoVentana = TIPO_A_VENTANA[t.tipo];
        let clima = null;
        if (ventanas && tipoVentana) {
          clima = mejorDia(ventanas[tipoVentana].dias, vencida ? hoy : t.fecha_programada, t.ventana_dias ?? 3, hoy);
        }
        return {
          ...t,
          vencida,
          dias_vencida: vencida ? Math.round((Date.parse(hoy) - Date.parse(t.fecha_programada)) / 86_400_000) : 0,
          clima,
          consejo: consejo(t, clima, vencida),
        };
      });

    res.json({ hoy, hasta, datos, aviso_clima: avisoClima });
  });

  return r;
}

function consejo(t, clima, vencida) {
  const prefijo = vencida ? 'Atrasada. ' : '';
  if (!clima) return vencida ? 'Atrasada: realizar lo antes posible.' : null;
  switch (clima.estado) {
    case 'apto': return `${prefijo}Buen clima el día programado.`;
    case 'mover': return `${prefijo}Mejor hacerla el ${clima.fecha_sugerida} por el clima.`;
    case 'sin_dia_apto': return `${prefijo}No hay día apto entre ${clima.desde} y ${clima.hasta} (${clima.motivos.join('; ')}). Considere reprogramar o tomar precauciones.`;
    default: return vencida ? 'Atrasada: realizar lo antes posible.' : 'Aún fuera del alcance del pronóstico (16 días).';
  }
}
