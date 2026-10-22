import { Router } from 'express';
import { noEncontrado } from '../lib/errores.js';
import { sumarDias } from '../lib/derivados.js';
import { SUBPRODUCTOS_INFO } from '../conocimiento/subproductos.js';
import { hoyEn } from '../lib/prediccion.js';
import { leerCache } from '../lib/fuentesClima.js';
import { inventarioCafe, estadoResultados, cadenaCostoLote } from '../lib/costos.js';
import { sugerirPrecio } from '../lib/precios.js';

const diasEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// Alertas del negocio: frescura del tostado, pesos que no cuadran y precios
// de lista por debajo del costo.
async function alertasNegocio(db, hoy) {
  const alertas = [];
  const add = (nivel, tipo, mensaje, ref = {}) => alertas.push({ nivel, tipo, mensaje, grupo: 'cafe', ...ref });

  const lotes = await db.todos("SELECT id, codigo FROM lotes_cafe WHERE COALESCE(estado,'en_proceso') <> 'descartado'");
  for (const l of lotes) {
    const c = await cadenaCostoLote(db, l.id);
    if (!c) continue;
    for (const a of c.avisos) {
      if (a.nivel === 'alta' || a.nivel === 'media') add(a.nivel, 'costos', `Lote ${l.codigo}: ${a.texto}`, { lote_cafe_id: l.id });
    }
    // Frescura: el tostado se vende mejor en las primeras semanas.
    const tostado = c.etapas.filter((e) => e.estado.startsWith('tostado') && e.kg_disponible > 0.05);
    if (tostado.length) {
      const ultimoTueste = (await db.uno("SELECT MAX(fecha) AS f FROM procesos_cafe WHERE lote_cafe_id = ? AND estado_salida LIKE 'tostado%'", [l.id]))?.f;
      if (ultimoTueste) {
        const dias = diasEntre(ultimoTueste, hoy);
        const kg = tostado.reduce((s, e) => s + e.kg_disponible, 0);
        if (dias > 45) {
          add('alta', 'frescura', `Lote ${l.codigo}: ${kg.toFixed(1)} kg de café tostado el ${ultimoTueste} (hace ${dias} días) siguen en inventario. El tostado pierde calidad: priorizar su venta.`, { lote_cafe_id: l.id });
        } else if (dias > 25) {
          add('media', 'frescura', `Lote ${l.codigo}: ${kg.toFixed(1)} kg tostados hace ${dias} días sin vender.`, { lote_cafe_id: l.id });
        }
      }
    }
  }

  // Precios de lista que no cubren el costo.
  const inv = await inventarioCafe(db);
  const presentaciones = await db.todos("SELECT * FROM presentaciones WHERE COALESCE(activa,'si') = 'si' AND precio_venta_cop IS NOT NULL");
  for (const pres of presentaciones) {
    const estado = inv.estados.find((e) => e.estado === pres.estado_cafe);
    if (!estado?.cop_por_kg) continue;
    const r = sugerirPrecio({
      costo_cop_kg: estado.cop_por_kg,
      gramos: pres.gramos,
      costo_empaque_cop: pres.costo_empaque_cop ?? 0,
      precio_actual_cop: pres.precio_venta_cop,
    });
    const ev = r.evaluacion;
    if (ev && !ev.cubre_costo) {
      add('alta', 'precio', `${pres.nombre}: se vende a $${pres.precio_venta_cop.toLocaleString('es-CO')} y cuesta $${r.costo_unitario.total_cop.toLocaleString('es-CO')}. Cada unidad pierde plata.`, { presentacion_id: pres.id });
    } else if (ev && ev.margen_pct < 20) {
      add('media', 'precio', `${pres.nombre}: margen de solo ${ev.margen_pct} % sobre el precio. No alcanza para gastos generales.`, { presentacion_id: pres.id });
    }
  }

  return alertas;
}

// Nivel 3 del plan ("alertas"): reglas simples y explicables sobre los datos registrados.
// No son diagnósticos; indican qué revisar.
async function calcularAlertas(db, fincaId, hoy, lotes) {
  const alertas = [];
  const add = (nivel, tipo, mensaje, ref) => alertas.push({ nivel, tipo, mensaje, grupo: 'cultivo', ...ref });

  const obs = await db.todos(`
    SELECT o.*, l.nombre AS lote FROM observaciones o JOIN lotes l ON l.id = o.lote_id
    WHERE l.finca_id = ? AND COALESCE(o.estado, 'abierta') != 'resuelta'`, [fincaId]);
  for (const o of obs) {
    if ((o.severidad ?? 0) >= 4) {
      add('alta', 'observacion', `${o.lote}: ${o.problema ?? o.categoria} con severidad ${o.severidad} sin resolver (desde ${o.fecha}).`, { observacion_id: o.id });
    } else if (diasEntre(o.actualizado_en.slice(0, 10), hoy) > 15) {
      add('media', 'seguimiento', `${o.lote}: observación "${o.problema ?? o.categoria}" sin seguimiento hace más de 15 días.`, { observacion_id: o.id });
    }
  }

  for (const l of lotes) {
    if (l.estado === 'inactivo') continue;
    if (!l.ultima_labor) {
      add('info', 'registro', `${l.nombre}: aún no tiene labores registradas.`, { lote_id: l.id });
    } else if (diasEntre(l.ultima_labor, hoy) > 30) {
      add('info', 'registro', `${l.nombre}: sin labores registradas desde ${l.ultima_labor}.`, { lote_id: l.id });
    }
  }

  const floraciones = await db.todos(`
    SELECT fl.*, l.nombre AS lote FROM floraciones fl JOIN lotes l ON l.id = fl.lote_id
    WHERE l.finca_id = ? AND (fl.es_principal = 'si' OR fl.intensidad >= 4) AND fl.fecha >= ?`, [fincaId, sumarDias(hoy, -260)]);
  for (const f of floraciones) {
    const inicio = sumarDias(f.fecha, 210);
    const faltan = diasEntre(hoy, inicio);
    if (faltan <= 30 && faltan >= -35) {
      add('media', 'cosecha', `${f.lote}: la floración del ${f.fecha} indica cosecha aproximada desde ${inicio}. Preparar recolección y manejo de subproductos.`, { floracion_id: f.id });
    }
  }

  const ultimoClima = (await db.uno('SELECT MAX(fecha_hora) AS u FROM clima WHERE finca_id = ?', [fincaId])).u;
  if (!ultimoClima || diasEntre(ultimoClima.slice(0, 10), hoy) > 3) {
    add('info', 'clima', ultimoClima ? `Sin datos de clima desde ${ultimoClima.slice(0, 10)}.` : 'No hay datos de clima. Sincronice Open-Meteo o registre lecturas.', {});
  }

  const perecederos = await db.todos(`
    SELECT id, tipo, fecha, kg_frescos FROM subproductos
    WHERE estado IN ('disponible','recolectado','almacenado') AND tipo IN ('pulpa','mucilago','borra','aguas_mieles')`);
  for (const s of perecederos) {
    const vida = SUBPRODUCTOS_INFO[s.tipo].vida_util_fresco_horas;
    if (diasEntre(s.fecha, hoy) * 24 > vida) {
      add('alta', 'biomasa', `${s.kg_frescos} kg de ${s.tipo} del ${s.fecha} superan su vida útil de referencia (~${vida} h). Procesar o compostar ya.`, { subproducto_id: s.id });
    }
  }

  const vencidas = await db.todos(`
    SELECT p.id, p.titulo, p.fecha_programada, p.prioridad, l.nombre AS lote FROM plan_labores p JOIN lotes l ON l.id = p.lote_id
    WHERE l.finca_id = ? AND p.estado = 'pendiente' AND p.fecha_programada < ? ORDER BY p.fecha_programada`, [fincaId, hoy]);
  for (const t of vencidas) {
    add(t.prioridad === 'alta' ? 'alta' : 'media', 'plan', `${t.lote}: "${t.titulo}" estaba programada para ${t.fecha_programada}.`, { plan_id: t.id });
  }

  // Riesgos agroclimáticos del último cálculo guardado (se actualiza cada pocas horas).
  const cache = await leerCache(db, `riesgos:finca:${fincaId}`);
  if (cache && Date.now() - Date.parse(cache.obtenido_en) < 12 * 3_600_000) {
    for (const r of cache.datos.riesgos.filter((x) => x.nivel !== 'info' || x.id.startsWith('floracion'))) {
      const nivel = r.nivel === 'alto' ? 'alta' : r.nivel === 'medio' ? 'media' : 'info';
      add(nivel, 'clima_riesgo', `${r.nombre} (${r.periodo.desde} a ${r.periodo.hasta}): ${r.evidencia[0] ?? ''}`, { riesgo_id: r.id });
    }
  }

  const orden = { alta: 0, media: 1, info: 2 };
  return alertas.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
}

export function routerResumen(db, config) {
  const r = Router();

  r.get('/', async (req, res) => {
    const fincaId = Number(req.query.finca_id ?? 1);
    const finca = await db.uno('SELECT * FROM fincas WHERE id = ?', [fincaId]);
    if (!finca) throw noEncontrado('Finca');
    const hoy = hoyEn(config.timezone);

    const lotes = (await db.todos(`
      SELECT l.id, l.nombre, l.variedad, l.num_plantas, l.fecha_siembra, l.estado, l.area_ha,
        (SELECT MAX(fecha) FROM actividades a WHERE a.lote_id = l.id) AS ultima_labor,
        (SELECT MAX(fecha) FROM floraciones f WHERE f.lote_id = l.id) AS ultima_floracion,
        (SELECT COUNT(*) FROM observaciones o WHERE o.lote_id = l.id AND COALESCE(o.estado,'abierta') != 'resuelta') AS observaciones_abiertas,
        (SELECT COALESCE(SUM(kg_cereza),0) FROM cosechas c WHERE c.lote_id = l.id) AS kg_cereza_total
      FROM lotes l WHERE l.finca_id = ? ORDER BY l.id`, [fincaId]))
      .map((l) => ({
        ...l,
        edad_meses: l.fecha_siembra ? Math.floor(diasEntre(l.fecha_siembra, hoy) / 30.44) : null,
      }));

    const desde30 = sumarDias(hoy, -30);
    const labores30 = await db.todos(`
      SELECT a.tipo, COUNT(*) AS cantidad, COALESCE(SUM(a.costo_cop),0) AS costo_cop
      FROM actividades a JOIN lotes l ON l.id = a.lote_id
      WHERE l.finca_id = ? AND a.fecha >= ? GROUP BY a.tipo ORDER BY cantidad DESC`, [fincaId, desde30]);

    const clima7 = await db.uno(`
      SELECT ROUND(SUM(precipitacion_mm),1) AS lluvia_mm, ROUND(AVG(temperatura_c),1) AS temp_media,
             ROUND(MIN(temperatura_c),1) AS temp_min, ROUND(MAX(temperatura_c),1) AS temp_max,
             ROUND(AVG(humedad_rel_pct),0) AS humedad_media, COUNT(*) AS lecturas
      FROM clima WHERE finca_id = ? AND fecha_hora >= ? AND fuente = (
        SELECT fuente FROM clima WHERE finca_id = ? AND fecha_hora >= ?
        GROUP BY fuente ORDER BY CASE fuente WHEN 'estacion' THEN 0 WHEN 'sensor' THEN 1 WHEN 'manual' THEN 2 ELSE 3 END LIMIT 1)`, [fincaId, sumarDias(hoy, -7), fincaId, sumarDias(hoy, -7)]);

    const anio = hoy.slice(0, 4);
    const cosechaAnio = await db.uno(`
      SELECT COALESCE(SUM(c.kg_cereza),0) AS kg_cereza, COALESCE(SUM(c.kg_pergamino_seco),0) AS kg_pergamino_seco, COUNT(*) AS registros
      FROM cosechas c JOIN lotes l ON l.id = c.lote_id WHERE l.finca_id = ? AND substr(c.fecha,1,4) = ?`, [fincaId, anio]);

    const biomasa = await db.todos(`
      SELECT tipo, ROUND(SUM(kg_frescos),1) AS kg_frescos, COUNT(*) AS partidas
      FROM subproductos WHERE estado IN ('disponible','recolectado','almacenado') GROUP BY tipo ORDER BY kg_frescos DESC`);

    const tablasContadas = ['plan_labores', 'actividades', 'observaciones', 'floraciones', 'clima', 'suelo', 'vuelos', 'cosechas',
      'productores', 'subproductos', 'oportunidades', 'lotes_cafe', 'procesos_cafe', 'ventas', 'gastos', 'presentaciones'];
    const conteos = Object.fromEntries(await Promise.all(
      tablasContadas.map(async (t) => [t, Number((await db.uno(`SELECT COUNT(*) AS n FROM "${t}"`)).n)]),
    ));

    const pendientes = [];
    if (finca.altitud_msnm == null) pendientes.push('Confirmar altitud de la finca (m s. n. m.).');
    const conPlan = new Set((await db.todos("SELECT DISTINCT lote_id FROM plan_labores WHERE estado = 'pendiente'")).map((x) => x.lote_id));
    for (const l of lotes) {
      if (!conPlan.has(l.id) && l.estado !== 'inactivo') pendientes.push(`${l.nombre}: generar el plan de cultivo.`);
      if (!l.variedad) pendientes.push(`${l.nombre}: registrar variedad(es).`);
      if (!l.fecha_siembra) pendientes.push(`${l.nombre}: registrar fecha de siembra.`);
    }
    if (!conteos.suelo) pendientes.push('Cargar los análisis de suelo existentes.');
    if (!conteos.productores) pendientes.push('Empezar el censo de productores vecinos.');

    res.json({
      hoy,
      finca,
      totales: {
        lotes: lotes.length,
        plantas: lotes.reduce((s, l) => s + (l.num_plantas ?? 0), 0),
      },
      lotes,
      labores_30_dias: labores30,
      clima_7_dias: clima7?.lecturas ? clima7 : null,
      cosecha_anio: { anio, ...cosechaAnio },
      biomasa_disponible: biomasa,
      registros: conteos,
      negocio: {
        inventario: await inventarioCafe(db),
        anio: await estadoResultados(db, { desde: `${anio}-01-01`, hasta: `${anio}-12-31` }),
      },
      alertas: [...await calcularAlertas(db, fincaId, hoy, lotes), ...await alertasNegocio(db, hoy)],
      datos_pendientes: pendientes,
    });
  });

  return r;
}
