// Vistas de contabilidad del panel: inventario, costos por lote, precio de
// venta y resultados. Se cargan bajo demanda desde app.js.

let H = {};

const pesos = (n, dec = 0) => (n == null ? '—' : `$${H.fmt(n, dec)}`);
const pct = (n, dec = 1) => (n == null ? '—' : `${H.fmt(n, dec)} %`);

function cifra(valor, etiqueta) {
  return `<div class="cifra"><b>${valor}</b><span>${H.esc(etiqueta)}</span></div>`;
}

function tabla(cabeceras, filas, { vacio = 'Sin datos todavía.' } = {}) {
  if (!filas.length) return `<div class="tabla-contenedor"><p class="vacio">${H.esc(vacio)}</p></div>`;
  return `<div class="tabla-contenedor"><table>
    <thead><tr>${cabeceras.map((c) => `<th${c.num ? ' class="num"' : ''}>${H.esc(c.t ?? c)}</th>`).join('')}</tr></thead>
    <tbody>${filas.join('')}</tbody></table></div>`;
}

function avisos(lista) {
  return (lista ?? []).map((a) => {
    const texto = typeof a === 'string' ? a : a.texto;
    const nivel = typeof a === 'string' ? '' : (a.nivel ?? '');
    return `<div class="alerta ${H.esc(nivel)}">${H.esc(texto)}</div>`;
  }).join('');
}

// ---------- Inventario ----------

async function vistaInventario() {
  const inv = await H.api('/inventario');
  H.vista.innerHTML = `
    <h1>Inventario de café</h1>
    <p class="suave">Lo que hay hoy en cada estado, valorizado al costo real de cada lote (no al precio de venta).</p>
    <div class="cifras">
      ${cifra(`${H.fmt(inv.total_kg, 1)} kg`, 'café en inventario')}
      ${cifra(pesos(inv.total_valor_cop), 'valor al costo')}
      ${cifra(inv.lotes.length, 'lotes con existencias')}
    </div>

    <section class="tarjeta">
      <h2>Por estado</h2>
      ${tabla(
    ['Estado', { t: 'kg', num: true }, { t: 'COP/kg', num: true }, { t: 'Valor', num: true }],
    inv.estados.map((e) => `<tr>
          <td>${H.esc(e.nombre)}</td>
          <td class="num"><b>${H.fmt(e.kg, 2)}</b></td>
          <td class="num">${pesos(e.cop_por_kg)}</td>
          <td class="num">${pesos(e.valor_cop)}</td></tr>`),
    { vacio: 'Todavía no hay café registrado. Empiece creando un lote en "Lotes de café".' },
  )}
    </section>

    <section class="tarjeta" style="margin-top:12px">
      <h2>Por lote</h2>
      ${inv.lotes.length ? inv.lotes.map((l) => `
        <details>
          <summary><b>${H.esc(l.codigo)}</b> · ${H.esc(l.fecha)} · ${H.esc(l.variedad ?? 'sin variedad')} · ${pesos(l.valor_cop)}</summary>
          ${tabla(
    ['Estado', { t: 'Disponible kg', num: true }, { t: 'Producido kg', num: true }, { t: 'Vendido kg', num: true }, { t: 'COP/kg', num: true }, { t: 'Valor', num: true }],
    l.etapas.map((e) => `<tr>
              <td>${H.esc(e.nombre)}</td>
              <td class="num"><b>${H.fmt(e.kg_disponible, 2)}</b></td>
              <td class="num">${H.fmt(e.kg_producido, 2)}</td>
              <td class="num">${H.fmt(e.kg_vendido, 2)}</td>
              <td class="num">${pesos(e.cop_por_kg)}</td>
              <td class="num">${pesos(e.valor_inventario_cop)}</td></tr>`),
  )}
        </details>`).join('') : '<p class="suave">Sin existencias.</p>'}
    </section>`;
}

// ---------- Costos por lote ----------

async function vistaCostos() {
  const { datos: lotes } = await H.api('/costos/lotes');
  H.vista.innerHTML = `
    <h1>Costo por lote y por proceso</h1>
    <p class="suave">Cada proceso le suma costo y le quita kg al lote. El costo por kg en cada estado es costo acumulado ÷ kg que realmente salieron.</p>
    ${tabla(
    ['Lote', 'Estado', { t: 'COP/kg', num: true }, { t: 'Disponible', num: true }, { t: '!', num: true }],
    lotes.map((l) => `<tr data-id="${l.id}">
        <td><b>${H.esc(l.codigo)}</b><br><span class="suave pequeno">${H.esc(l.fecha)}${l.variedad ? ` · ${H.esc(l.variedad)}` : ''}</span></td>
        <td>${H.esc(H.titulo(l.estado_final ?? '—'))}</td>
        <td class="num"><b>${pesos(l.cop_por_kg_final)}</b></td>
        <td class="num">${H.fmt(l.kg_disponible, 2)} kg</td>
        <td class="num">${l.avisos ? `<span class="chip baja">${l.avisos}</span>` : '✓'}</td></tr>`),
    { vacio: 'Sin lotes. Cree el primero en "Lotes de café" con los kg y el precio pagado.' },
  )}
    <p class="suave pequeno">Toque un lote para ver su cadena completa.</p>
    <div id="detalle-lote" style="margin-top:12px"></div>

    <details class="tarjeta" style="margin-top:16px">
      <summary><b>Antes de comprar: ¿cuánto tostado sale y a cómo me queda?</b></summary>
      <p class="suave pequeno">Proyección con rendimientos de referencia. Sirve para decidir cuánto pagar por una carga.</p>
      <form id="f-sim">
        <div class="form-calc">
          <div><label for="s-kg">kg a comprar *</label><input id="s-kg" name="kg" type="number" step="any" min="0" required value="51"></div>
          <div><label for="s-precio">Precio COP/kg *</label><input id="s-precio" name="precio_cop_kg" type="number" step="any" min="0" required value="22000"></div>
          <div><label for="s-ini">Estado que compra</label><select id="s-ini" name="estado_inicial">
            <option value="pergamino_seco" selected>Pergamino seco</option>
            <option value="cereza">Cereza</option>
            <option value="verde">Verde / almendra</option>
          </select></div>
          <div><label for="s-fin">Hasta</label><select id="s-fin" name="estado_final">
            <option value="tostado_grano" selected>Tostado en grano</option>
            <option value="tostado_molido">Tostado molido</option>
            <option value="verde">Verde / almendra</option>
          </select></div>
          <div><label for="s-perfil">Punto de tueste</label><select id="s-perfil" name="perfil_tueste">
            <option value="">referencia general</option>
            <option value="claro">Claro</option><option value="medio_claro">Medio-claro</option>
            <option value="medio" selected>Medio</option><option value="medio_oscuro">Medio-oscuro</option>
            <option value="oscuro">Oscuro</option>
          </select></div>
          <div><label for="s-flete">Transporte COP</label><input id="s-flete" name="costo_transporte_cop" type="number" step="any" min="0" value="0"></div>
          <div><label for="s-trilla">Trilla COP/kg que entra</label><input id="s-trilla" name="trilla" type="number" step="any" min="0" value="0"></div>
          <div><label for="s-tueste">Tueste COP/kg que entra</label><input id="s-tueste" name="tueste" type="number" step="any" min="0" value="0"></div>
        </div>
        <button class="primario">Proyectar</button>
      </form>
      <div id="res-sim" style="margin-top:12px"></div>
    </details>`;

  H.vista.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => detalleLote(Number(tr.dataset.id)));
  });
  if (lotes.length) detalleLote(lotes[0].id);

  H.vista.querySelector('#f-sim').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries([...new FormData(ev.target)].filter(([, v]) => v !== ''));
    const cuerpo = {
      kg: f.kg,
      precio_cop_kg: f.precio_cop_kg,
      estado_inicial: f.estado_inicial,
      estado_final: f.estado_final,
      costo_transporte_cop: f.costo_transporte_cop ?? 0,
      ...(f.perfil_tueste ? { perfil_tueste: f.perfil_tueste } : {}),
      costos_proceso_cop_kg: { trilla: Number(f.trilla ?? 0), tueste: Number(f.tueste ?? 0) },
    };
    const caja = H.vista.querySelector('#res-sim');
    try {
      const s = await H.api('/costos/simular', { metodo: 'POST', cuerpo });
      const rr = s.resultado;
      caja.innerHTML = `
        <div class="cifras">
          ${cifra(`${H.fmt(rr.kg_final.tipico, 1)} kg`, `${H.esc(H.titulo(s.estado_final))} (típico)`)}
          ${cifra(pesos(rr.cop_por_kg.tipico), 'COP/kg típico')}
          ${cifra(`${H.fmt(rr.kg_final.min, 1)}–${H.fmt(rr.kg_final.max, 1)}`, 'rango de kg')}
          ${cifra(pct(rr.rendimiento_global_pct.tipico), 'rendimiento global')}
        </div>
        ${tabla(
    ['Paso', { t: 'kg entran', num: true }, { t: 'Rendimiento', num: true }, { t: 'kg salen (típico)', num: true }, { t: 'COP/kg paso', num: true }, 'Confianza'],
    s.pasos.map((p) => `<tr>
            <td>${H.esc(p.nombre)}</td>
            <td class="num">${H.fmt(p.kg_entrada, 2)}</td>
            <td class="num">${pct(p.rendimiento_pct.tipico)} <span class="suave pequeno">(${H.fmt(p.rendimiento_pct.min, 0)}–${H.fmt(p.rendimiento_pct.max, 0)})</span></td>
            <td class="num"><b>${H.fmt(p.kg_salida.tipico, 2)}</b></td>
            <td class="num">${pesos(p.costo_proceso_cop_kg)}</td>
            <td><span class="chip ${H.esc(p.confianza)}">${H.esc(p.confianza)}</span></td></tr>`),
  )}
        <p class="suave pequeno">Peor caso: ${pesos(rr.cop_por_kg.peor)}/kg · mejor caso: ${pesos(rr.cop_por_kg.mejor)}/kg. ${H.esc(s.aviso)}</p>`;
    } catch (e) {
      caja.innerHTML = `<div class="alerta alta">${H.esc(e.message)} ${H.esc(Object.entries(e.detalles ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · '))}</div>`;
    }
  });
}

async function detalleLote(id) {
  const caja = H.vista.querySelector('#detalle-lote');
  caja.innerHTML = '<p class="suave">Cargando lote…</p>';
  const c = await H.api(`/costos/lote/${id}`);
  const t = c.totales;
  caja.innerHTML = `
    <section class="tarjeta">
      <h2>Lote ${H.esc(c.lote.codigo)} · ${H.esc(c.lote.fecha)}</h2>
      <div class="cifras">
        ${cifra(pesos(t.costo_total_cop), 'costo total del lote')}
        ${cifra(pesos(t.cop_por_kg_final), `COP/kg ${H.esc(H.titulo(t.estado_final ?? ''))}`)}
        ${cifra(pesos(t.valor_inventario_cop), 'inventario al costo')}
        ${cifra(pesos(t.ingresos_cop), 'vendido')}
      </div>
      ${avisos(c.avisos)}

      <h2 style="margin-top:8px">Entrada</h2>
      ${tabla(['Concepto', { t: 'COP', num: true }], [
    `<tr><td>Compra (${H.fmt(c.lote.kg_inicial, 1)} kg de ${H.esc(H.titulo(c.lote.estado_inicial))})</td><td class="num">${pesos(c.entrada.valor_compra_cop)}</td></tr>`,
    `<tr><td>Transporte</td><td class="num">${pesos(c.entrada.costo_transporte_cop)}</td></tr>`,
    `<tr><td>Otros costos de entrada</td><td class="num">${pesos(c.entrada.otros_costos_cop)}</td></tr>`,
    c.gastos_directos_cop ? `<tr><td>Gastos asignados al lote</td><td class="num">${pesos(c.gastos_directos_cop)}</td></tr>` : '',
    `<tr><td><b>Total entrada</b></td><td class="num"><b>${pesos(c.entrada.total_cop)}</b> <span class="suave pequeno">(${pesos(c.entrada.cop_por_kg)}/kg)</span></td></tr>`,
  ].filter(Boolean))}

      <h2 style="margin-top:12px">Procesos</h2>
      ${tabla(
    ['Fecha', 'Proceso', { t: 'kg', num: true }, { t: 'Rend.', num: true }, { t: 'Costo', num: true }, { t: 'COP/kg', num: true }],
    c.pasos.map((p) => `<tr data-proc="${p.id}">
        <td>${H.esc(p.fecha)}</td>
        <td>${H.esc(p.nombre)}${p.perfil_tueste ? `<br><span class="suave pequeno">${H.esc(H.titulo(p.perfil_tueste))}</span>` : ''}</td>
        <td class="num">${H.fmt(p.kg_entrada, 1)} → <b>${H.fmt(p.kg_salida, 1)}</b>${p.kg_salida_estimado ? ' <span class="chip baja">est.</span>' : ''}</td>
        <td class="num">${pct(p.rendimiento_pct)}${p.rendimiento_esperado_pct ? `<br><span class="suave pequeno">esp. ${H.fmt(p.rendimiento_esperado_pct.min, 1)}–${H.fmt(p.rendimiento_esperado_pct.max, 1)}</span>` : ''}</td>
        <td class="num">${pesos(p.costos_cop.proceso)}</td>
        <td class="num"><b>${pesos(p.cop_por_kg_salida)}</b></td></tr>`),
    { vacio: 'Sin procesos registrados. Agregue la trilla y el tueste en "Registrar".' },
  )}

      <h2 style="margin-top:12px">Costo por estado</h2>
      ${tabla(
    ['Estado', { t: 'Disponible', num: true }, { t: 'COP/kg', num: true }, { t: 'Valor', num: true }],
    c.etapas.map((e) => `<tr>
        <td>${H.esc(e.nombre)}</td>
        <td class="num"><b>${H.fmt(e.kg_disponible, 2)} kg</b></td>
        <td class="num">${pesos(e.cop_por_kg)}</td>
        <td class="num">${pesos(e.valor_inventario_cop)}</td></tr>`),
  )}
      <p class="suave pequeno" style="margin-top:8px">El detalle de kg producidos, usados y vendidos está en <a href="#/inventario">Inventario</a>. ${H.esc(c.aviso)}
        <a href="#/precios">Ver precio recomendado de este lote</a>.</p>
    </section>`;

  caja.querySelectorAll('tbody tr[data-proc]').forEach((tr) => {
    tr.addEventListener('click', () => H.abrirFormulario('procesos_cafe', Number(tr.dataset.proc), () => detalleLote(id)));
  });
}

// ---------- Precio de venta ----------

async function vistaPrecios() {
  const { datos: lotes } = await H.api('/costos/lotes');
  const gg = await H.api('/costos/gastos-por-kg');
  H.vista.innerHTML = `
    <h1>Precio de venta recomendado</h1>
    <p class="suave">El margen se calcula sobre el precio de venta: precio = costo ÷ (1 − margen). Sumarle un 40 % al costo no es ganar 40 %.</p>
    <div class="herramientas">
      <div><label for="p-lote">Lote</label><select id="p-lote">${lotes.map((l) => `<option value="${l.id}">${H.esc(l.codigo)} · ${H.esc(l.fecha)}</option>`).join('')}</select></div>
      <div><label for="p-gg">Gastos generales COP/kg</label><input id="p-gg" type="number" step="any" min="0" value="${gg.cop_por_kg ?? 0}"></div>
      <div><label for="p-iva">IVA %</label><input id="p-iva" type="number" step="any" min="0" max="100" value="0"></div>
      <div><label for="p-red">Redondear a</label><input id="p-red" type="number" step="any" min="1" value="500"></div>
    </div>
    <p class="suave pequeno">Gastos generales calculados: ${pesos(gg.gastos_generales_cop)} ÷ ${H.fmt(gg.kg_producidos, 1)} kg tostados = ${pesos(gg.cop_por_kg)}/kg${gg.amortizacion_cop ? `, de los cuales ${pesos(gg.gastos_operativos_cop)} son gastos del periodo y ${pesos(gg.amortizacion_cop)} la cuota de las inversiones (${pesos(gg.amortizacion.cuota_mensual_cop)}/mes)` : ''}. Si está en cero, registre los gastos (arriendo, servicios, su tiempo) para que el precio los cubra.</p>
    ${avisos(gg.avisos)}
    <div id="res-precios"></div>

    <details class="tarjeta" style="margin-top:16px">
      <summary><b>Calculadora libre</b></summary>
      <p class="suave pequeno">Para probar un costo o un precio sin depender de un lote.</p>
      <form id="f-precio">
        <div class="form-calc">
          <div><label for="c-costo">Costo COP/kg *</label><input id="c-costo" name="costo_cop_kg" type="number" step="any" min="0" required value="40000"></div>
          <div><label for="c-gramos">Gramos por bolsa *</label><input id="c-gramos" name="gramos" type="number" step="any" min="1" required value="250"></div>
          <div><label for="c-emp">Empaque + etiqueta COP</label><input id="c-emp" name="costo_empaque_cop" type="number" step="any" min="0" value="1500"></div>
          <div><label for="c-gg">Gastos generales COP/kg</label><input id="c-gg" name="gastos_generales_cop_kg" type="number" step="any" min="0" value="0"></div>
          <div><label for="c-margen">Margen objetivo % (opcional)</label><input id="c-margen" name="margen_objetivo_pct" type="number" step="any" min="0" max="95"></div>
          <div><label for="c-actual">Precio que cobra hoy (opcional)</label><input id="c-actual" name="precio_actual_cop" type="number" step="any" min="0"></div>
          <div><label for="c-fijos">Costos fijos del mes COP</label><input id="c-fijos" name="costos_fijos_mes_cop" type="number" step="any" min="0" value="0"></div>
          <div><label for="c-iva">IVA %</label><input id="c-iva" name="iva_pct" type="number" step="any" min="0" max="100" value="0"></div>
        </div>
        <button class="primario">Calcular</button>
      </form>
      <div id="res-calc" style="margin-top:12px"></div>
    </details>`;

  const pintar = async () => {
    const caja = H.vista.querySelector('#res-precios');
    const id = H.vista.querySelector('#p-lote').value;
    if (!id) { caja.innerHTML = '<div class="alerta">Cree un lote de café para ver precios con su costo real.</div>'; return; }
    caja.innerHTML = '<p class="suave">Calculando…</p>';
    const q = new URLSearchParams({
      gastos_generales_cop_kg: H.vista.querySelector('#p-gg').value || '0',
      iva_pct: H.vista.querySelector('#p-iva').value || '0',
      redondeo_cop: H.vista.querySelector('#p-red').value || '500',
    });
    const r = await H.api(`/precios/lote/${id}?${q}`);
    caja.innerHTML = `
      ${tabla(['Estado del lote', { t: 'Disponible kg', num: true }, { t: 'COP/kg (costo)', num: true }],
    r.etapas.filter((e) => e.kg_producido > 0).map((e) => `<tr><td>${H.esc(e.nombre)}</td><td class="num">${H.fmt(e.kg_disponible, 2)}</td><td class="num"><b>${pesos(e.cop_por_kg)}</b></td></tr>`))}
      ${r.presentaciones.length ? r.presentaciones.map((p, i) => (p.sin_costo ? `
        <div class="alerta media" style="margin-top:12px"><b>${H.esc(p.nombre)}:</b> ${H.esc(p.sin_costo)}</div>` : `
        <details class="tarjeta" style="margin-top:12px" ${i === 0 ? 'open' : ''}>
          <summary><b>${H.esc(p.nombre)}</b> <span class="suave pequeno">cuesta ${pesos(p.costo_unitario_cop)}${p.precio_de_lista_cop ? ` · se vende a ${pesos(p.precio_de_lista_cop)}` : ''}${p.evaluacion ? ` · gana ${pct(p.evaluacion.margen_pct)}` : ''}</span></summary>
          <div class="cifras" style="margin-top:12px">
            ${cifra(pesos(p.costo_unitario_cop), 'costo por unidad')}
            ${cifra(pesos(p.precio_minimo_cop), 'precio mínimo (sin ganancia)')}
            ${cifra(pesos(p.precio_de_lista_cop), 'precio de lista actual')}
          </div>
          ${p.evaluacion ? `<div class="alerta ${p.evaluacion.cubre_costo ? (p.evaluacion.margen_pct < 20 ? 'media' : '') : 'alta'}">
            A ${pesos(p.evaluacion.precio_cop)} gana ${pesos(p.evaluacion.margen_cop)} por unidad (${pct(p.evaluacion.margen_pct)}). ${H.esc(p.evaluacion.veredicto)}</div>` : ''}
          ${tabla(['Canal', { t: 'Precio', num: true }, { t: 'Gana', num: true }],
    p.canales.map((c) => `<tr>
              <td>${H.esc(c.nombre)}<br><span class="suave pequeno">margen ${H.fmt(c.margen_objetivo_pct, 0)} %</span></td>
              <td class="num"><b>${pesos(c.precio_sugerido_cop)}</b><br><span class="suave pequeno">${c.precio_con_iva_cop ? `con IVA ${pesos(c.precio_con_iva_cop)}` : `${pesos(c.precio_cop_kg)}/kg`}</span></td>
              <td class="num">${pesos(c.margen_cop)}</td></tr>`))}
        </details>`)).join('') : '<div class="alerta media">No hay presentaciones activas. Cree al menos una en "Presentaciones" (p. ej. bolsa de 250 g molido) con su costo de empaque.</div>'}
      <p class="suave pequeno">${H.esc(r.aviso)}</p>`;
  };

  H.vista.querySelector('#p-lote').addEventListener('change', pintar);
  ['#p-gg', '#p-iva', '#p-red'].forEach((s) => H.vista.querySelector(s).addEventListener('change', pintar));
  await pintar();

  H.vista.querySelector('#f-precio').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const cuerpo = Object.fromEntries([...new FormData(ev.target)].filter(([, v]) => v !== ''));
    const caja = H.vista.querySelector('#res-calc');
    try {
      const r = await H.api('/precios/sugerir', { metodo: 'POST', cuerpo });
      const cu = r.costo_unitario;
      caja.innerHTML = `
        <div class="cifras">
          ${cifra(pesos(cu.total_cop), 'costo por unidad')}
          ${cifra(pesos(cu.precio_minimo_cop), 'precio mínimo')}
          ${cifra(pesos(r.canales.find((c) => c.canal === 'directo')?.precio_sugerido_cop), 'sugerido venta directa')}
          ${cifra(pesos(r.canales.find((c) => c.canal === 'cafeteria')?.precio_sugerido_cop), 'sugerido cafetería')}
        </div>
        ${r.evaluacion ? `<div class="alerta ${r.evaluacion.cubre_costo ? (r.evaluacion.margen_pct < 20 ? 'media' : '') : 'alta'}">
          A ${pesos(r.evaluacion.precio_cop)}: gana ${pesos(r.evaluacion.margen_cop)} (${pct(r.evaluacion.margen_pct)}). ${H.esc(r.evaluacion.veredicto)}</div>` : ''}
        ${tabla(['Concepto', { t: 'COP', num: true }], [
    `<tr><td>Café (${H.fmt(cu.kg_por_unidad, 3)} kg con merma de empaque)</td><td class="num">${pesos(cu.cafe_cop)}</td></tr>`,
    `<tr><td>Gastos generales</td><td class="num">${pesos(cu.gastos_generales_cop)}</td></tr>`,
    `<tr><td>Empaque y etiqueta</td><td class="num">${pesos(cu.empaque_cop)}</td></tr>`,
    `<tr><td><b>Costo por unidad</b></td><td class="num"><b>${pesos(cu.total_cop)}</b></td></tr>`,
  ])}
        ${tabla(['Canal', { t: 'Margen', num: true }, { t: 'Precio', num: true }, { t: 'Con IVA', num: true }, { t: 'Gana', num: true }, { t: 'COP/kg', num: true }],
    r.canales.map((c) => `<tr>
            <td>${H.esc(c.nombre)}</td><td class="num">${pct(c.margen_objetivo_pct, 0)}</td>
            <td class="num"><b>${pesos(c.precio_sugerido_cop)}</b></td>
            <td class="num">${c.precio_con_iva_cop ? pesos(c.precio_con_iva_cop) : '—'}</td>
            <td class="num">${pesos(c.margen_cop)}</td><td class="num">${pesos(c.precio_cop_kg)}</td></tr>`))}
        ${r.punto_equilibrio?.unidades_mes ? `<div class="alerta">Punto de equilibrio: ${H.fmt(r.punto_equilibrio.unidades_mes)} unidades al mes (${H.fmt(r.punto_equilibrio.kg_mes, 1)} kg) a ${pesos(r.punto_equilibrio.precio_cop)} para cubrir los costos fijos.</div>` : ''}
        ${avisos(r.avisos)}
        <p class="suave pequeno">${H.esc(r.aviso)}</p>`;
    } catch (e) {
      caja.innerHTML = `<div class="alerta alta">${H.esc(e.message)} ${H.esc(Object.entries(e.detalles ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · '))}</div>`;
    }
  });
}

// ---------- Resultados del periodo ----------

async function vistaResultados() {
  const fin = H.hoy();
  const ini = `${fin.slice(0, 4)}-01-01`;
  H.vista.innerHTML = `
    <h1>Resultados</h1>
    <p class="suave">Ingresos, costo de lo vendido, gastos y utilidad del periodo.</p>
    <div class="herramientas">
      <div><label for="r-desde">Desde</label><input id="r-desde" type="date" value="${ini}"></div>
      <div><label for="r-hasta">Hasta</label><input id="r-hasta" type="date" value="${fin}"></div>
      <button id="r-ver" class="primario" style="align-self:end">Ver</button>
    </div>
    <div id="res-pyg"></div>`;

  const pintar = async () => {
    const caja = H.vista.querySelector('#res-pyg');
    caja.innerHTML = '<p class="suave">Calculando…</p>';
    const q = new URLSearchParams({
      desde: H.vista.querySelector('#r-desde').value,
      hasta: H.vista.querySelector('#r-hasta').value,
    });
    const r = await H.api(`/contabilidad/resultados?${q}`);
    caja.innerHTML = `
      <div class="cifras">
        ${cifra(pesos(r.ingresos_cop), 'ingresos')}
        ${cifra(pesos(r.margen_bruto_cop), `margen bruto (${pct(r.margen_bruto_pct)})`)}
        ${cifra(pesos(r.utilidad_operativa_cop), `utilidad (${pct(r.margen_neto_pct)})`)}
        ${cifra(pesos(r.inventario_valor_cop), 'inventario al costo')}
      </div>
      ${avisos(r.avisos)}
      <section class="tarjeta">
        <h2>Estado de resultados</h2>
        ${tabla(['Concepto', { t: 'COP', num: true }], [
    `<tr><td>Ingresos por ventas</td><td class="num">${pesos(r.ingresos_cop)}</td></tr>`,
    `<tr><td>− Costo del café vendido</td><td class="num">${pesos(r.costo_vendido_cop)}</td></tr>`,
    `<tr><td><b>= Margen bruto</b></td><td class="num"><b>${pesos(r.margen_bruto_cop)}</b></td></tr>`,
    `<tr><td>− Gastos operativos</td><td class="num">${pesos(r.gastos_operativos_cop)}</td></tr>`,
    `<tr><td>− Depreciación de equipos${r.amortizacion?.cuota_mensual_cop ? ` <span class="suave pequeno">${pesos(r.amortizacion.cuota_mensual_cop)}/mes</span>` : ''}</td><td class="num">${pesos(r.depreciacion_cop)}</td></tr>`,
    `<tr><td><b>= Utilidad operativa</b></td><td class="num"><b>${pesos(r.utilidad_operativa_cop)}</b></td></tr>`,
  ])}
        <p class="suave pequeno" style="margin-top:8px">${H.esc(r.aviso)}</p>
      </section>

      <section class="tarjeta" style="margin-top:12px">
        <h2>Qué canal deja más</h2>
        ${tabla(['Canal', { t: 'Ingresos', num: true }, { t: 'Margen', num: true }],
    r.por_canal.map((c) => `<tr>
          <td>${H.esc(H.titulo(c.canal))}<br><span class="suave pequeno">${c.ventas} venta(s) · ${H.fmt(c.kg, 1)} kg</span></td>
          <td class="num">${pesos(c.ingresos_cop)}</td>
          <td class="num"><b>${pesos(c.margen_cop)}</b><br><span class="suave pequeno">${pct(c.margen_pct)}</span></td></tr>`),
    { vacio: 'Sin ventas en el periodo.' })}
      </section>

      <details class="tarjeta" style="margin-top:12px">
        <summary><b>Más detalle</b></summary>
        <h2 style="margin-top:12px">Movimiento de plata</h2>
        ${tabla(['Concepto', { t: 'COP', num: true }], [
    `<tr><td>Compras de café (${H.fmt(r.compras.kg, 1)} kg en ${r.compras.lotes} lote(s))</td><td class="num">${pesos(r.compras.valor_cop)}</td></tr>`,
    `<tr><td>Inversiones (equipos)</td><td class="num">${pesos(r.inversiones_cop)}</td></tr>`,
    `<tr><td>Por cobrar (${r.por_cobrar.ventas} venta(s))</td><td class="num">${pesos(r.por_cobrar.valor_cop)}</td></tr>`,
    `<tr><td>kg vendidos</td><td class="num">${H.fmt(r.kg_vendidos, 2)} kg a ${pesos(r.cop_por_kg_vendido)}/kg</td></tr>`,
  ])}
        ${r.amortizacion?.detalle?.length ? `
        <h2 style="margin-top:12px">Qué se está amortizando</h2>
        ${tabla(['Inversión', { t: 'Cuota mensual', num: true }, { t: 'En el periodo', num: true }],
    r.amortizacion.detalle.map((a) => `<tr>
          <td>${H.esc(a.descripcion ?? 'sin descripción')}<br><span class="suave pequeno">${pesos(a.valor_cop)} en ${a.amortizar_meses} meses · termina ${H.esc(a.termina)}</span></td>
          <td class="num">${pesos(a.cuota_mensual_cop)}</td>
          <td class="num"><b>${pesos(a.cop)}</b><br><span class="suave pequeno">${a.meses_cobrados} mes(es)</span></td></tr>`))}` : ''}
        ${r.amortizacion?.sin_vida_util?.length ? `<div class="alerta media">Sin vida útil, no cargan nada al costo: ${r.amortizacion.sin_vida_util.map((g) => `${H.esc(g.descripcion ?? 'sin descripción')} (${pesos(g.valor_cop)})`).join(', ')}. Póngales "amortizar meses" en Gastos.</div>` : ''}
        <h2 style="margin-top:12px">Gastos por categoría</h2>
        ${tabla(['Categoría', { t: 'COP', num: true }],
    r.gastos_por_categoria.map((g) => `<tr><td>${H.esc(H.titulo(g.categoria))}<br><span class="suave pequeno">${g.registros} registro(s)</span></td><td class="num">${pesos(g.valor_cop)}</td></tr>`),
    { vacio: 'Sin gastos registrados en el periodo.' })}
      </details>`;
  };

  H.vista.querySelector('#r-ver').addEventListener('click', pintar);
  await pintar();
}

// ---------- Registro rápido de procesos ----------
//
// Pensado para usarlo con una mano en la trilladora o frente a la tostadora:
// se elige el lote, se toca qué se hizo y solo se escriben los kg. Los estados
// de entrada y salida se deducen del tipo de proceso, y los costos son
// opcionales: se pueden completar después sin romper nada.

const ORDEN_PROCESOS = ['despulpado', 'secado', 'trilla', 'seleccion', 'tueste', 'molienda'];
const NIVELES_MOLIENDA = ['grueso', 'medio_grueso', 'medio', 'medio_fino', 'fino', 'turco'];

let RP = { con: null, lotes: [], cadena: null, tipo: null };

function rangoEsperado(tipo, perfil) {
  if (tipo === 'tueste' && perfil && RP.con.perfiles_tueste[perfil]) return RP.con.perfiles_tueste[perfil].rendimiento;
  return RP.con.transiciones[tipo]?.rendimiento ?? null;
}

const nombreEstado = (id) => RP.con.estados.find((e) => e.id === id)?.nombre ?? id;

function disponible(estado) {
  const e = RP.cadena?.etapas.find((x) => x.estado === estado);
  return e ? e.kg_disponible : 0;
}

async function vistaRegistrar() {
  const [{ datos: lotes }, con] = await Promise.all([H.api('/costos/lotes'), H.api('/costos/conocimiento')]);
  RP = { con, lotes: lotes.filter((l) => l.estado !== 'descartado'), cadena: null, tipo: null };

  if (!RP.lotes.length) {
    H.vista.innerHTML = `<h1>Registrar proceso</h1>
      <div class="alerta media">No hay lotes de café. Cree el primero en <a href="#/lotes_cafe">Lotes de café</a> con los kg y el precio que pagó.</div>`;
    return;
  }

  H.vista.innerHTML = `
    <h1>Registrar proceso</h1>
    <p class="suave">Lo mínimo es: qué hizo, cuántos kg entraron y cuántos salieron. Los costos se pueden completar después.</p>
    <div class="herramientas">
      <div class="crece"><label for="rp-lote">Lote</label>
        <select id="rp-lote">${RP.lotes.map((l) => `<option value="${l.id}">${H.esc(l.codigo)} · ${H.esc(l.fecha)}${l.variedad ? ` · ${H.esc(l.variedad)}` : ''}</option>`).join('')}</select></div>
      <div><label for="rp-fecha">Fecha</label><input id="rp-fecha" type="date" value="${H.hoy()}"></div>
    </div>
    <div id="rp-disponible"></div>
    <section class="tarjeta" style="margin-top:12px">
      <h2>¿Qué hizo?</h2>
      <div class="proc-botones" id="rp-tipos"></div>
      <p class="suave pequeno" style="margin:10px 0 0">✓ = lo que se puede hacer ahora con lo que hay en el lote. Para empaque u otro proceso use el <a href="#/procesos_cafe">formulario completo</a>.</p>
    </section>
    <div id="rp-form"></div>`;

  H.vista.querySelector('#rp-lote').addEventListener('change', cargarLote);
  await cargarLote();
}

async function cargarLote() {
  const id = Number(H.vista.querySelector('#rp-lote').value);
  RP.cadena = await H.api(`/costos/lote/${id}`);
  RP.tipo = null;
  H.vista.querySelector('#rp-form').innerHTML = '';

  const conKg = RP.cadena.etapas.filter((e) => e.kg_disponible > 0.001);
  H.vista.querySelector('#rp-disponible').innerHTML = conKg.length
    ? `<div class="alerta">En este lote hay: ${conKg.map((e) => `<b>${H.fmt(e.kg_disponible, 2)} kg</b> de ${H.esc(e.nombre.toLowerCase())} a ${pesos(e.cop_por_kg)}/kg`).join(' · ')}</div>`
    : '<div class="alerta media">Este lote no tiene café disponible: ya se procesó o se vendió todo.</div>';

  H.vista.querySelector('#rp-tipos').innerHTML = ORDEN_PROCESOS.map((tipo) => {
    const t = RP.con.transiciones[tipo];
    const hay = disponible(t.de) > 0.001;
    return `<button type="button" class="proc-boton ${hay ? 'sugerido' : ''}" data-tipo="${tipo}" aria-pressed="false">
      <b>${H.esc(t.nombre)}</b>
      <span>${H.esc(nombreEstado(t.de))} → ${H.esc(nombreEstado(t.a))}${hay ? ` · hay ${H.fmt(disponible(t.de), 2)} kg` : ''}</span>
    </button>`;
  }).join('');

  H.vista.querySelectorAll('#rp-tipos .proc-boton').forEach((b) => {
    b.addEventListener('click', () => elegirTipo(b.dataset.tipo));
  });

  // Si solo hay un proceso posible con lo que hay en el lote, se abre directo.
  const posibles = ORDEN_PROCESOS.filter((tipo) => disponible(RP.con.transiciones[tipo].de) > 0.001);
  if (posibles.length === 1) elegirTipo(posibles[0]);
}

function campoNum(n, etiqueta, { valor = '', ayuda = '', grande = false, paso = 'any' } = {}) {
  return `<div class="${grande ? 'campo-grande' : ''}">
    <label for="rp-${n}">${etiqueta}</label>
    <input id="rp-${n}" name="${n}" type="number" inputmode="decimal" step="${paso}" min="0" value="${valor}">
    ${ayuda ? `<p class="ayuda">${ayuda}</p>` : ''}
  </div>`;
}

function elegirTipo(tipo) {
  RP.tipo = tipo;
  const t = RP.con.transiciones[tipo];
  const hay = disponible(t.de);
  H.vista.querySelectorAll('#rp-tipos .proc-boton').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.tipo === tipo));
  });

  const esTueste = tipo === 'tueste';
  const r = rangoEsperado(tipo, esTueste ? 'medio' : null);

  H.vista.querySelector('#rp-form').innerHTML = `
    <form class="tarjeta" id="rp-f" style="margin-top:12px">
      <h2>${H.esc(t.nombre)} <span class="suave pequeno">${H.esc(nombreEstado(t.de))} → ${H.esc(nombreEstado(t.a))}</span></h2>
      ${t.nota ? `<p class="suave pequeno">${H.esc(t.nota)}</p>` : ''}

      <div class="form-calc">
        ${campoNum('kg_entrada', 'kg que entran *', {
    valor: hay > 0.001 ? Math.round(hay * 100) / 100 : '',
    ayuda: hay > 0.001 ? `Disponibles: ${H.fmt(hay, 2)} kg` : 'No hay kg registrados en ese estado',
    grande: true,
  })}
        ${campoNum('kg_salida', 'kg que salen *', { ayuda: 'Pese siempre: es lo que define el costo', grande: true })}
      </div>
      <p class="rend" id="rp-rend">${r ? `Esperado: ${H.fmt(r.min * 100, 1)}–${H.fmt(r.max * 100, 1)} % de rendimiento` : ''}</p>

      ${esTueste ? `<div class="form-calc">
        <div><label for="rp-perfil_tueste">Punto de tueste</label>
          <select id="rp-perfil_tueste" name="perfil_tueste">
            ${Object.entries(RP.con.perfiles_tueste).map(([k, v]) => `<option value="${k}" ${k === 'medio' ? 'selected' : ''}>${H.esc(v.nombre)}</option>`).join('')}
          </select></div>
      </div>` : ''}

      ${tipo === 'molienda' ? `<div class="form-calc"><div>
        <label for="rp-molienda">Nivel de molienda</label>
        <select id="rp-molienda" name="molienda"><option value="">—</option>
          ${NIVELES_MOLIENDA.map((m) => `<option value="${m}">${H.esc(H.titulo(m))}</option>`).join('')}
        </select></div></div>` : ''}

      ${t.subproducto ? `<fieldset style="border:1px solid var(--borde);border-radius:var(--radio);padding:12px;margin:12px 0">
        <legend class="suave pequeno">${H.esc(H.titulo(t.subproducto))} que salió</legend>
        <div class="form-calc">
          ${campoNum('kg_subproducto', 'kg', { ayuda: 'No es basura: tiene uso y valor' })}
          ${campoNum('valor_subproducto_cop', 'Su valor, si se vende o se usa (COP)', { ayuda: 'Se descuenta del costo del lote' })}
        </div>
        <div class="fila-check">
          <input type="checkbox" id="rp-anotar-sub" name="anotar_sub" checked>
          <label for="rp-anotar-sub">Anotarlo también en Subproductos</label>
        </div>
      </fieldset>` : ''}

      <details style="margin:12px 0">
        <summary><b>Costos y detalles</b> <span class="suave pequeno">— se pueden completar después</span></summary>
        <div class="form-calc" style="margin-top:10px">
          ${campoNum('maquila_cop', 'Lo que pagó a un tercero (COP)', { ayuda: 'Maquila de trilla o de tueste' })}
          ${campoNum('mano_obra_cop', 'Mano de obra (COP)', { ayuda: 'Incluya su propio tiempo' })}
          ${esTueste || tipo === 'secado' ? campoNum('energia_cop', 'Gas, luz o leña (COP)') : ''}
          ${campoNum('transporte_cop', 'Transporte (COP)')}
          ${campoNum('insumos_cop', 'Insumos (COP)')}
          ${campoNum('empaque_cop', 'Empaque (COP)')}
          ${campoNum('otros_cop', 'Otros (COP)')}
          ${campoNum('jornales', 'Jornales')}
          ${esTueste ? campoNum('temperatura_c', 'Temperatura de salida (°C)') : ''}
          ${esTueste ? campoNum('duracion_min', 'Duración (min)') : ''}
          ${tipo === 'secado' ? campoNum('humedad_salida_pct', 'Humedad al terminar (%)', { ayuda: 'Objetivo: 10–12 %' }) : ''}
          ${campoNum('puntaje_taza', 'Puntaje de taza', { paso: '0.25' })}
          <div><label for="rp-equipo">Equipo</label><input id="rp-equipo" name="equipo" type="text" placeholder="Tostadora, trilladora, molino"></div>
          <div><label for="rp-responsable">Responsable</label><input id="rp-responsable" name="responsable" type="text"></div>
        </div>
        <div style="margin-top:10px"><label for="rp-notas">Notas</label><textarea id="rp-notas" name="notas"></textarea></div>
      </details>

      <button class="primario">Guardar ${H.esc(t.nombre.toLowerCase())}</button>
    </form>
    <div id="rp-resultado"></div>`;

  const form = H.vista.querySelector('#rp-f');
  const pintarRend = () => {
    const caja = H.vista.querySelector('#rp-rend');
    const rango = rangoEsperado(tipo, form.perfil_tueste?.value);
    const textoBase = rango ? `Esperado: ${H.fmt(rango.min * 100, 1)}–${H.fmt(rango.max * 100, 1)} % de rendimiento` : '';
    const ent = Number(form.kg_entrada.value);
    const sal = Number(form.kg_salida.value);
    if (!ent || !form.kg_salida.value) {
      caja.className = 'rend';
      caja.textContent = textoBase;
      return;
    }
    if (sal > ent) {
      caja.className = 'rend mal';
      caja.textContent = `No puede salir más de lo que entró (${H.fmt(sal, 2)} kg de ${H.fmt(ent, 2)} kg). Revise los pesos.`;
      return;
    }
    const rendimiento = (sal / ent) * 100;
    if (!rango) {
      caja.className = 'rend ok';
      caja.textContent = `Rendimiento ${H.fmt(rendimiento, 1)} %`;
      return;
    }
    const dentro = rendimiento >= rango.min * 100 && rendimiento <= rango.max * 100;
    caja.className = `rend ${dentro ? 'ok' : 'ojo'}`;
    caja.textContent = dentro
      ? `Rendimiento ${H.fmt(rendimiento, 1)} % · dentro de lo esperado (${H.fmt(rango.min * 100, 1)}–${H.fmt(rango.max * 100, 1)} %)`
      : `Rendimiento ${H.fmt(rendimiento, 1)} % · fuera de lo esperado (${H.fmt(rango.min * 100, 1)}–${H.fmt(rango.max * 100, 1)} %). Puede ser real, pero vuelva a pesar antes de guardar.`;
  };
  form.kg_entrada.addEventListener('input', pintarRend);
  form.kg_salida.addEventListener('input', pintarRend);
  form.perfil_tueste?.addEventListener('change', pintarRend);

  form.addEventListener('submit', (ev) => { ev.preventDefault(); guardarProceso(form, tipo); });
}

async function guardarProceso(form, tipo) {
  const t = RP.con.transiciones[tipo];
  const datos = Object.fromEntries([...new FormData(form)].filter(([, v]) => v !== ''));
  const anotarSub = Boolean(datos.anotar_sub);
  delete datos.anotar_sub;

  const caja = H.vista.querySelector('#rp-resultado');
  const boton = form.querySelector('button.primario');
  boton.disabled = true;
  try {
    const loteId = Number(H.vista.querySelector('#rp-lote').value);
    const fecha = H.vista.querySelector('#rp-fecha').value;
    await H.api('/procesos_cafe', {
      metodo: 'POST',
      cuerpo: {
        ...datos,
        lote_cafe_id: loteId,
        fecha,
        tipo,
        estado_entrada: t.de,
        estado_salida: t.a,
        ...(t.subproducto && datos.kg_subproducto ? { subproducto_tipo: t.subproducto } : {}),
      },
    });

    // La cascarilla o la pulpa pasan al inventario de biomasa si se pidió.
    let avisoSub = '';
    if (anotarSub && t.subproducto && datos.kg_subproducto) {
      const lote = RP.lotes.find((l) => l.id === loteId);
      try {
        await H.api('/subproductos', {
          metodo: 'POST',
          cuerpo: {
            tipo: t.subproducto,
            fecha,
            kg_frescos: Number(datos.kg_subproducto),
            origen: lote?.origen === 'finca_propia' ? 'finca_propia' : 'productor',
            ...(lote?.productor_id ? { productor_id: lote.productor_id } : {}),
            estado: 'disponible',
            proceso_aplicado: t.nombre,
            notas: `Generado en la ${t.nombre.toLowerCase()} del lote ${lote?.codigo ?? loteId}.`,
          },
        });
        avisoSub = 'También quedó anotado en <a href="#/subproductos">Subproductos</a>.';
      } catch (e) {
        avisoSub = `No se pudo anotar en Subproductos: ${H.esc(e.message)}`;
      }
    }

    H.avisar('Proceso guardado');
    RP.cadena = await H.api(`/costos/lote/${loteId}`);
    const etapa = RP.cadena.etapas.find((e) => e.estado === t.a);
    const paso = RP.cadena.pasos[RP.cadena.pasos.length - 1];

    caja.innerHTML = `
      <section class="tarjeta" style="margin-top:12px">
        <h2>Guardado</h2>
        <div class="cifras">
          ${cifra(`${H.fmt(etapa?.kg_disponible, 2)} kg`, `de ${H.esc((etapa?.nombre ?? '').toLowerCase())} disponibles`)}
          ${cifra(pesos(etapa?.cop_por_kg), 'COP/kg ahora')}
          ${cifra(pct(paso?.rendimiento_pct), 'rendimiento de este paso')}
          ${cifra(pesos(RP.cadena.totales.costo_total_cop), 'costo total del lote')}
        </div>
        ${avisoSub ? `<div class="alerta">${avisoSub}</div>` : ''}
        ${avisos(RP.cadena.avisos.filter((a) => a.nivel === 'alta' || a.nivel === 'media'))}
        <div class="herramientas" style="margin-bottom:0">
          <button type="button" class="primario" id="rp-otro">Registrar otro proceso</button>
          <a class="boton" href="#/costos">Ver costos del lote</a>
          <a class="boton" href="#/precios">Ver precios</a>
        </div>
      </section>`;
    caja.querySelector('#rp-otro').addEventListener('click', cargarLote);
    caja.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    caja.innerHTML = `<div class="alerta alta" style="margin-top:12px">${H.esc(e.message)}
      ${H.esc(Object.entries(e.detalles ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · '))}</div>`;
  } finally {
    boton.disabled = false;
  }
}

const VISTAS = {
  registrar: vistaRegistrar,
  inventario: vistaInventario,
  costos: vistaCostos,
  precios: vistaPrecios,
  pyg: vistaResultados,
};

export async function vistaContabilidad(id, helpers) {
  H = helpers;
  await VISTAS[id]();
}
