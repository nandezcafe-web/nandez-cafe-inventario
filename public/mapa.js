// Vista de mapa: terreno (satélite/relieve), lotes, observaciones, productores
// y clima regional (lluvia, viento, sol/nubes, calor) con línea de tiempo.

const TZ = 'America/Bogota';
let leafletListo = null;

function cargarLeaflet() {
  if (window.L) return Promise.resolve();
  leafletListo ??= new Promise((ok, falla) => {
    const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/vendor/leaflet/leaflet.css' });
    const js = Object.assign(document.createElement('script'), { src: '/vendor/leaflet/leaflet.js' });
    js.onload = ok;
    js.onerror = () => falla(new Error('No se pudo cargar la librería de mapas'));
    document.head.append(css, js);
  });
  return leafletListo;
}

// ---------- Escalas de color (secuenciales, de claro a oscuro) ----------

const ESCALAS = {
  lluvia: {
    titulo: 'Lluvia en 3 horas (mm)',
    cortes: [0.2, 1, 2.5, 5, 10, 20],
    colores: ['#d6e6f5', '#a6c8e8', '#6fa6d8', '#3d7fc2', '#1f5a9e', '#0f3a70'],
    etiquetas: ['0,2–1', '1–2,5', '2,5–5', '5–10', '10–20', '> 20'],
  },
  calor: {
    titulo: 'Temperatura (°C)',
    cortes: [-99, 14, 17, 20, 23, 26, 29],
    colores: ['#fff3c4', '#fedc8c', '#fdbb62', '#f8913f', '#e5642b', '#c23c1b', '#8c1f0e'],
    etiquetas: ['< 14', '14–17', '17–20', '20–23', '23–26', '26–29', '> 29'],
  },
  viento: {
    titulo: 'Viento (m/s) · la flecha indica hacia dónde sopla',
    cortes: [0, 1.5, 3, 5, 8, 11],
    colores: ['#e3f2de', '#b5dea8', '#7bc47c', '#3f9c56', '#1f7340', '#0d4a26'],
    etiquetas: ['< 1,5', '1,5–3', '3–5', '5–8', '8–11', '> 11'],
  },
  nubes: {
    titulo: 'Nubosidad (%)',
    cortes: [0, 25, 60, 85],
    colores: ['#ffd24a', '#f3f0e0', '#c9ccd2', '#8d939c'],
    etiquetas: ['Despejado < 25', 'Parcial 25–60', 'Nublado 60–85', 'Cubierto > 85'],
  },
};

function colorPara(escala, valor) {
  if (valor == null) return null;
  const e = ESCALAS[escala];
  let idx = -1;
  e.cortes.forEach((c, i) => { if (valor >= c) idx = i; });
  return idx < 0 ? null : e.colores[idx];
}

const CARDINALES = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const cardinal = (grados) => (grados == null ? '—' : CARDINALES[Math.round(grados / 45) % 8]);

function iconoTiempo({ lluvia, nubes, dia }) {
  if (lluvia >= 2) return '🌧️';
  if (lluvia >= 0.2) return '🌦️';
  if (!dia) return nubes >= 60 ? '☁️' : '🌙';
  if (nubes < 25) return '☀️';
  if (nubes < 60) return '🌤️';
  if (nubes < 85) return '⛅';
  return '☁️';
}

function etiquetaHora(h) {
  const [fecha, hora] = h.split('T');
  const dia = new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
  const hh = Number(hora.slice(0, 2));
  const ampm = hh === 0 ? '12 a. m.' : hh < 12 ? `${hh} a. m.` : hh === 12 ? '12 p. m.' : `${hh - 12} p. m.`;
  return `${dia}, ${ampm}`;
}

// Área esférica de un anillo [[lat, lon], …] en hectáreas (igual que el servidor).
function areaHa(puntos) {
  if (puntos.length < 3) return 0;
  const R = 6_371_008.8;
  let t = 0;
  for (let i = 0; i < puntos.length; i++) {
    const [la1, lo1] = puntos[i];
    const [la2, lo2] = puntos[(i + 1) % puntos.length];
    t += ((lo2 - lo1) * Math.PI / 180) * (2 + Math.sin(la1 * Math.PI / 180) + Math.sin(la2 * Math.PI / 180));
  }
  return Math.abs((t * R * R) / 2) / 10_000;
}

const SEVERIDAD_COLOR = (s) => (s >= 4 ? '#c62828' : s === 3 ? '#ef6c00' : '#f2b705');

export async function vistaMapa({ vista, api, esc, fmt, avisar, abrirFormulario }) {
  await cargarLeaflet();
  const L = window.L;
  const capas = await api('/mapa/capas');
  const { finca } = capas;
  if (finca.latitud == null) {
    vista.innerHTML = '<div class="alerta media">La finca no tiene coordenadas. Agréguelas en Fincas.</div>';
    return;
  }

  vista.innerHTML = `
    <h1>Mapa de la finca</h1>
    <div class="herramientas" role="tablist">
      <button class="primario" data-pestana="mapa" role="tab" aria-selected="true">Mapa y clima</button>
      <button data-pestana="windy" role="tab" aria-selected="false">Animación regional (Windy)</button>
    </div>

    <div id="pestana-mapa" class="mapa-rejilla">
      <div class="mapa-contenedor"><div id="mapa" class="mapa"></div></div>
      <aside class="mapa-panel">
        <section class="tarjeta">
          <h2>Clima sobre el mapa</h2>
          <div class="segmentado" id="capa-clima">
            ${[['ninguna', 'Ninguno'], ['lluvia', '🌧️ Lluvia'], ['viento', '💨 Viento'], ['nubes', '☀️ Sol y nubes'], ['calor', '🌡️ Calor']]
    .map(([id, et]) => `<button data-capa="${id}" aria-pressed="${id === 'ninguna'}">${et}</button>`).join('')}
          </div>
          <div class="linea-tiempo" id="linea-tiempo" hidden>
            <button id="reproducir" aria-label="Reproducir">▶</button>
            <input type="range" id="hora" min="0" max="0" value="0" aria-label="Hora del pronóstico">
            <span id="etiqueta-hora" class="pequeno"></span>
          </div>
          <div id="leyenda" class="leyenda"></div>
          <p id="estado-clima" class="suave pequeno"></p>
        </section>

        <section class="tarjeta" id="detalle-finca">
          <h2>En la finca</h2>
          <p class="suave pequeno">Elija una capa de clima para ver el pronóstico por horas.</p>
        </section>

        <section class="tarjeta">
          <h2>Lotes</h2>
          <ul class="limpia lista-lotes">${capas.lotes.map((l) => `
            <li><b>${esc(l.nombre)}</b> · ${fmt(l.num_plantas)} plantas${l.geometria ? '' : ' · <span class="suave">sin borde</span>'}
              <div class="herramientas" style="margin:4px 0 8px">
                ${l.geometria ? `<button data-ver-lote="${l.id}">Ver</button>` : ''}
                <button data-dibujar="${l.id}">${l.geometria ? 'Editar borde' : 'Dibujar borde'}</button>
              </div></li>`).join('')}
          </ul>
          <div id="dibujo" class="alerta" hidden>
            <p class="pequeno"><b id="dibujo-titulo"></b><br>Toque el mapa en cada esquina del lote o camine el borde y use <b>Punto GPS</b>. Los vértices se pueden arrastrar.</p>
            <p class="pequeno">Vértices: <b id="dibujo-n">0</b> · Área: <b id="dibujo-area">0</b> ha</p>
            <div class="herramientas">
              <button id="dibujo-gps">📍 Punto GPS</button>
              <button id="dibujo-deshacer">Deshacer</button>
              <button id="dibujo-cancelar">Cancelar</button>
              <button id="dibujo-guardar" class="primario">Guardar</button>
            </div>
          </div>
          <p class="suave pequeno">Toque cualquier punto del mapa para ver sus coordenadas o crear una observación ahí.</p>
        </section>
      </aside>
    </div>

    <div id="pestana-windy" hidden>
      <div class="herramientas" id="windy-capas">
        ${[['rain', '🌧️ Lluvia'], ['wind', '💨 Viento'], ['clouds', '☁️ Nubes'], ['temp', '🌡️ Temperatura'], ['rh', '💧 Humedad'], ['cape', '⛈️ Tormentas']]
    .map(([id, et], i) => `<button data-windy="${id}" aria-pressed="${i === 0}">${et}</button>`).join('')}
      </div>
      <div class="mapa-contenedor"><iframe id="windy" class="mapa" title="Mapa animado de Windy" loading="lazy" referrerpolicy="no-referrer"></iframe></div>
      <p class="suave pequeno">Animación de Windy.com (servicio externo) centrada en la finca. Use la barra de tiempo inferior del mapa para ver los próximos días.</p>
    </div>`;

  // ---------- Pestañas ----------
  const windy = vista.querySelector('#windy');
  const urlWindy = (overlay) => `https://embed.windy.com/embed.html?${new URLSearchParams({
    type: 'map', location: 'coordinates', metricRain: 'mm', metricTemp: '°C', metricWind: 'm/s', zoom: '9', overlay,
    product: 'ecmwf', level: 'surface', lat: finca.latitud, lon: finca.longitud, detailLat: finca.latitud,
    detailLon: finca.longitud, marker: 'true', message: 'true',
  })}`;
  vista.querySelectorAll('[data-pestana]').forEach((b) => b.addEventListener('click', () => {
    const esWindy = b.dataset.pestana === 'windy';
    vista.querySelector('#pestana-mapa').hidden = esWindy;
    vista.querySelector('#pestana-windy').hidden = !esWindy;
    vista.querySelectorAll('[data-pestana]').forEach((x) => {
      x.classList.toggle('primario', x === b);
      x.setAttribute('aria-selected', String(x === b));
    });
    if (esWindy && !windy.src) windy.src = urlWindy('rain');
    if (!esWindy) mapa.invalidateSize();
  }));
  vista.querySelectorAll('[data-windy]').forEach((b) => b.addEventListener('click', () => {
    windy.src = urlWindy(b.dataset.windy);
    vista.querySelectorAll('[data-windy]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));

  // ---------- Mapa base ----------
  const mapa = L.map(vista.querySelector('#mapa'), { zoomControl: true }).setView([finca.latitud, finca.longitud], 15);
  const satelite = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, maxNativeZoom: 18, attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics',
    }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 18 }),
  ]).addTo(mapa);
  const relieve = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17, attribution: '© OpenStreetMap, SRTM · estilo © OpenTopoMap (CC-BY-SA)',
  });
  const calles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
  L.control.scale({ imperial: false }).addTo(mapa);

  const capaLotes = L.layerGroup().addTo(mapa);
  const capaObs = L.layerGroup().addTo(mapa);
  const capaProd = L.layerGroup().addTo(mapa);
  const capaClima = L.layerGroup().addTo(mapa);
  L.control.layers(
    { Satélite: satelite, 'Relieve (curvas de nivel)': relieve, Calles: calles },
    { Lotes: capaLotes, Observaciones: capaObs, Productores: capaProd },
    { collapsed: true },
  ).addTo(mapa);

  L.marker([finca.latitud, finca.longitud], {
    icon: L.divIcon({ className: 'pin-finca', html: '☕', iconSize: [30, 30], iconAnchor: [15, 15] }),
    title: finca.nombre,
  }).bindPopup(`<b>${esc(finca.nombre)}</b><br>${finca.latitud}, ${finca.longitud}<br>${fmt(finca.hectareas, 1)} ha`).addTo(mapa);

  const poligonos = new Map();
  function pintarLotes() {
    capaLotes.clearLayers();
    poligonos.clear();
    for (const l of capas.lotes) {
      if (!l.geometria) continue;
      const pol = L.geoJSON(l.geometria, { style: { color: '#ffb000', weight: 3, fillColor: '#ffb000', fillOpacity: 0.12 } })
        .bindTooltip(`${esc(l.nombre)}`, { permanent: true, direction: 'center', className: 'etiqueta-lote' })
        .bindPopup(`<b>${esc(l.nombre)}</b><br>${esc(l.variedad ?? 'variedad sin registrar')} · ${fmt(l.num_plantas)} plantas<br>Área dibujada: ${fmt(areaHa(l.geometria.coordinates[0].map(([lo, la]) => [la, lo])), 2)} ha`)
        .addTo(capaLotes);
      poligonos.set(l.id, pol);
    }
  }
  pintarLotes();
  const conBorde = [...poligonos.values()];
  if (conBorde.length) mapa.fitBounds(L.featureGroup(conBorde).getBounds().pad(0.3));

  for (const o of capas.observaciones) {
    L.circleMarker([o.latitud, o.longitud], {
      radius: 8, color: '#fff', weight: 2, fillColor: SEVERIDAD_COLOR(o.severidad ?? 1), fillOpacity: 1,
    }).bindPopup(`<b>${esc(o.problema ?? o.categoria)}</b> · severidad ${o.severidad ?? '—'}<br>${esc(o.lote)} · ${esc(o.fecha)} · ${esc(o.estado ?? '')}<br><button data-abrir-obs="${o.id}">Abrir</button>`)
      .addTo(capaObs);
  }
  for (const p of capas.productores) {
    L.circleMarker([p.latitud, p.longitud], { radius: 7, color: '#fff', weight: 2, fillColor: '#6a3d9a', fillOpacity: 1 })
      .bindPopup(`<b>${esc(p.nombre)}</b>${p.finca ? ` · ${esc(p.finca)}` : ''}<br>${esc(p.variedades ?? '')}<br>Disposición: ${esc(p.disposicion ?? '—')}`)
      .addTo(capaProd);
  }

  mapa.on('popupopen', (ev) => {
    ev.popup.getElement()?.querySelector('[data-abrir-obs]')?.addEventListener('click', (e) => {
      abrirFormulario('observaciones', Number(e.target.dataset.abrirObs));
    });
    ev.popup.getElement()?.querySelector('[data-nueva-obs]')?.addEventListener('click', (e) => {
      const [lat, lon] = e.target.dataset.nuevaObs.split(',').map(Number);
      mapa.closePopup();
      abrirFormulario('observaciones', null, () => avisar('Observación guardada. Recargue el mapa para verla.'), { latitud: lat, longitud: lon });
    });
  });

  // ---------- Dibujo de lotes ----------
  let dibujo = null; // { loteId, puntos: [[lat, lon]], capa }
  const panelDibujo = vista.querySelector('#dibujo');

  function redibujar() {
    dibujo.capa.clearLayers();
    if (dibujo.puntos.length >= 2) {
      L.polygon(dibujo.puntos, { color: '#00e5ff', weight: 3, dashArray: '6 4', fillOpacity: 0.15 }).addTo(dibujo.capa);
    }
    dibujo.puntos.forEach((p, i) => {
      L.marker(p, { draggable: true, icon: L.divIcon({ className: 'vertice', iconSize: [16, 16], iconAnchor: [8, 8] }) })
        .on('drag', (e) => { const ll = e.target.getLatLng(); dibujo.puntos[i] = [ll.lat, ll.lng]; })
        .on('dragend', redibujar)
        .addTo(dibujo.capa);
    });
    vista.querySelector('#dibujo-n').textContent = dibujo.puntos.length;
    vista.querySelector('#dibujo-area').textContent = fmt(areaHa(dibujo.puntos), 2);
  }

  function terminarDibujo() {
    if (dibujo) mapa.removeLayer(dibujo.capa);
    dibujo = null;
    panelDibujo.hidden = true;
    mapa.getContainer().classList.remove('dibujando');
  }

  vista.querySelectorAll('[data-dibujar]').forEach((b) => b.addEventListener('click', () => {
    terminarDibujo();
    const lote = capas.lotes.find((l) => l.id === Number(b.dataset.dibujar));
    const previos = lote.geometria?.coordinates?.[0]?.slice(0, -1).map(([lo, la]) => [la, lo]) ?? [];
    dibujo = { loteId: lote.id, puntos: previos, capa: L.layerGroup().addTo(mapa) };
    vista.querySelector('#dibujo-titulo').textContent = `${lote.nombre}: ${previos.length ? 'editando borde' : 'nuevo borde'}`;
    panelDibujo.hidden = false;
    mapa.getContainer().classList.add('dibujando');
    if (poligonos.has(lote.id)) mapa.fitBounds(poligonos.get(lote.id).getBounds().pad(0.4));
    redibujar();
    panelDibujo.scrollIntoView({ block: 'nearest' });
  }));

  vista.querySelectorAll('[data-ver-lote]').forEach((b) => b.addEventListener('click', () => {
    const pol = poligonos.get(Number(b.dataset.verLote));
    if (pol) mapa.fitBounds(pol.getBounds().pad(0.4));
  }));

  vista.querySelector('#dibujo-deshacer').addEventListener('click', () => { dibujo?.puntos.pop(); if (dibujo) redibujar(); });
  vista.querySelector('#dibujo-cancelar').addEventListener('click', terminarDibujo);
  vista.querySelector('#dibujo-gps').addEventListener('click', () => {
    if (!navigator.geolocation) { avisar('Este dispositivo no tiene GPS disponible.'); return; }
    avisar('Obteniendo ubicación…');
    navigator.geolocation.getCurrentPosition((pos) => {
      if (!dibujo) return;
      dibujo.puntos.push([pos.coords.latitude, pos.coords.longitude]);
      redibujar();
      mapa.panTo([pos.coords.latitude, pos.coords.longitude]);
      avisar(`Punto agregado (precisión ±${Math.round(pos.coords.accuracy)} m).`);
    }, (err) => avisar(`GPS: ${err.message}`), { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 });
  });
  vista.querySelector('#dibujo-guardar').addEventListener('click', async () => {
    if (!dibujo || dibujo.puntos.length < 3) { avisar('Se necesitan al menos 3 vértices.'); return; }
    const anillo = dibujo.puntos.map(([la, lo]) => [Number(lo.toFixed(7)), Number(la.toFixed(7))]);
    anillo.push(anillo[0]);
    const geometria = { type: 'Polygon', coordinates: [anillo] };
    const lote = capas.lotes.find((l) => l.id === dibujo.loteId);
    const cuerpo = { geometria };
    if (lote.area_ha == null) cuerpo.area_ha = Number(areaHa(dibujo.puntos).toFixed(2));
    try {
      await api(`/lotes/${lote.id}`, { metodo: 'PATCH', cuerpo });
      lote.geometria = geometria;
      if (cuerpo.area_ha != null) lote.area_ha = cuerpo.area_ha;
      terminarDibujo();
      pintarLotes();
      avisar(`Borde de ${lote.nombre} guardado (${fmt(areaHa(anillo.map(([lo, la]) => [la, lo])), 2)} ha).`);
    } catch (e) {
      avisar(e.message);
    }
  });

  mapa.on('click', (e) => {
    const { lat, lng } = e.latlng;
    if (dibujo) {
      dibujo.puntos.push([lat, lng]);
      redibujar();
      return;
    }
    L.popup().setLatLng(e.latlng)
      .setContent(`${lat.toFixed(6)}, ${lng.toFixed(6)}<br><button data-nueva-obs="${lat.toFixed(6)},${lng.toFixed(6)}">Crear observación aquí</button>`)
      .openOn(mapa);
  });

  // ---------- Clima regional ----------
  let clima = null;
  let capaActiva = 'ninguna';
  let frames = [];
  let temporizador = null;
  const celdas = [];
  const control = vista.querySelector('#hora');
  const estado = vista.querySelector('#estado-clima');

  async function asegurarClima() {
    if (clima) return clima;
    estado.textContent = 'Consultando el pronóstico regional…';
    clima = await api('/mapa/clima');
    const ahora = new Date().toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 13).replace(' ', 'T');
    const inicio = Math.max(0, clima.horas.findIndex((h) => h.slice(0, 13) >= ahora));
    frames = [];
    for (let i = inicio; i < clima.horas.length; i += 3) frames.push(i);
    control.max = String(frames.length - 1);
    control.value = '0';

    const medio = clima.cuadricula.paso_grados / 2;
    for (const p of clima.puntos) {
      const rect = L.rectangle([[p.latitud - medio, p.longitud - medio], [p.latitud + medio, p.longitud + medio]], {
        weight: 1, color: 'rgba(255,255,255,.35)', fillOpacity: 0, interactive: false,
      }).addTo(capaClima);
      const etiqueta = L.marker([p.latitud, p.longitud], { icon: L.divIcon({ className: 'celda-clima', html: '', iconSize: [70, 40], iconAnchor: [35, 20] }) }).addTo(capaClima);
      celdas.push({ p, rect, etiqueta });
    }
    estado.textContent = `${clima.aviso} Modelos: ${clima.modelos.join(', ')}.`;
    return clima;
  }

  function valores(p, h) {
    const suma3 = [0, 1, 2].reduce((s, k) => s + (p.lluvia_mm[h + k] ?? 0), 0);
    return {
      lluvia: Math.round(suma3 * 10) / 10,
      prob: Math.max(...[0, 1, 2].map((k) => p.prob_lluvia[h + k] ?? 0)),
      temp: p.temperatura_c[h],
      sensacion: p.sensacion_c[h],
      viento: p.viento_ms[h],
      rafaga: p.rafaga_ms[h],
      dir: p.viento_dir[h],
      nubes: p.nubes_pct[h],
      radiacion: p.radiacion_wm2[h],
      uv: p.uv[h],
      dia: p.es_dia[h],
    };
  }

  function pintarFrame() {
    if (!clima || capaActiva === 'ninguna') return;
    const h = frames[Number(control.value)];
    vista.querySelector('#etiqueta-hora').textContent = etiquetaHora(clima.horas[h]);

    for (const { p, rect, etiqueta } of celdas) {
      const v = valores(p, h);
      let color = null;
      let opacidad = 0.5;
      let html = '';
      if (capaActiva === 'lluvia') {
        color = colorPara('lluvia', v.lluvia);
        html = v.lluvia >= 0.2 ? `<b>${fmt(v.lluvia, 1)}</b><small>${v.prob}%</small>` : `<small>${v.prob}%</small>`;
      } else if (capaActiva === 'calor') {
        color = colorPara('calor', v.temp);
        opacidad = 0.45;
        html = `<b>${fmt(v.temp, 0)}°</b>`;
      } else if (capaActiva === 'viento') {
        color = colorPara('viento', v.viento);
        opacidad = 0.4;
        const rot = v.dir == null ? 0 : (v.dir + 180) % 360;
        html = `${v.dir == null ? '' : `<span class="flecha" style="transform:rotate(${rot}deg)">↑</span>`}<small>${fmt(v.viento, 1)} m/s</small>`;
      } else if (capaActiva === 'nubes') {
        color = colorPara('nubes', v.nubes);
        opacidad = v.dia ? 0.45 : 0.3;
        html = `<span class="emoji">${iconoTiempo({ lluvia: v.lluvia, nubes: v.nubes ?? 0, dia: v.dia })}</span><small>${v.nubes ?? '—'}%</small>`;
      }
      rect.setStyle({ fillColor: color ?? '#000', fillOpacity: color ? opacidad : 0 });
      etiqueta.setIcon(L.divIcon({ className: 'celda-clima', html: `<div class="cc">${html}</div>`, iconSize: [70, 40], iconAnchor: [35, 20] }));
    }
    pintarDetalle(h);
  }

  function pintarDetalle(h) {
    const f = clima.finca;
    const v = valores(f, h);
    const fechaDia = clima.horas[h].slice(0, 10);
    const d = f.diario;
    const iDia = d ? d.fecha.indexOf(fechaDia) : -1;
    const proximas = frames.slice(Number(control.value), Number(control.value) + 8).map((hh) => {
      const x = valores(f, hh);
      return `<div class="hora-mini" data-tip="${esc(etiquetaHora(clima.horas[hh]))}: ${fmt(x.temp, 0)} °C, lluvia ${fmt(x.lluvia, 1)} mm, viento ${fmt(x.viento, 1)} m/s del ${cardinal(x.dir)}">
        <span>${clima.horas[hh].slice(11, 13)}h</span><span class="emoji">${iconoTiempo({ lluvia: x.lluvia, nubes: x.nubes ?? 0, dia: x.dia })}</span><b>${fmt(x.temp, 0)}°</b><small>${x.lluvia >= 0.2 ? `${fmt(x.lluvia, 1)} mm` : ''}</small></div>`;
    }).join('');

    vista.querySelector('#detalle-finca').innerHTML = `
      <h2>En la finca · ${esc(etiquetaHora(clima.horas[h]))}</h2>
      <div class="detalle-grande"><span class="emoji-grande">${iconoTiempo({ lluvia: v.lluvia, nubes: v.nubes ?? 0, dia: v.dia })}</span>
        <div><b class="temp-grande">${fmt(v.temp, 1)} °C</b><br><span class="suave pequeno">Sensación ${fmt(v.sensacion, 1)} °C</span></div></div>
      <ul class="limpia pequeno">
        <li>🌧️ Lluvia (3 h): <b>${fmt(v.lluvia, 1)} mm</b> · probabilidad ${v.prob}%</li>
        <li>💨 Viento del <b>${cardinal(v.dir)}</b> a ${fmt(v.viento, 1)} m/s · ráfagas ${fmt(v.rafaga, 1)} m/s</li>
        <li>☁️ Nubosidad ${v.nubes ?? '—'}% · ☀️ radiación ${fmt(v.radiacion)} W/m²${v.uv != null ? ` · UV ${fmt(v.uv, 1)}` : ''}</li>
        ${iDia >= 0 ? `<li>🌅 ${esc(d.amanecer[iDia] ?? '—')} · 🌇 ${esc(d.atardecer[iDia] ?? '—')} · ${fmt(d.horas_sol[iDia], 1)} h de sol · UV máx ${fmt(d.uv_max[iDia], 1)} · lluvia del día ${fmt(d.lluvia_mm[iDia], 1)} mm</li>` : ''}
      </ul>
      <div class="horas-mini">${proximas}</div>`;
  }

  function pintarLeyenda() {
    const cont = vista.querySelector('#leyenda');
    if (capaActiva === 'ninguna') { cont.innerHTML = ''; return; }
    const e = ESCALAS[capaActiva];
    cont.innerHTML = `<div class="pequeno"><b>${esc(e.titulo)}</b></div>${e.colores.map((c, i) => `<span class="item-leyenda"><span class="muestra" style="background:${c}"></span>${esc(e.etiquetas[i])}</span>`).join('')}`;
  }

  vista.querySelectorAll('[data-capa]').forEach((b) => b.addEventListener('click', async () => {
    capaActiva = b.dataset.capa;
    vista.querySelectorAll('[data-capa]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    pintarLeyenda();
    if (capaActiva === 'ninguna') {
      detener();
      capaClima.getLayers().forEach((l) => l.setStyle?.({ fillOpacity: 0 }));
      celdas.forEach((c) => c.etiqueta.setIcon(L.divIcon({ className: 'celda-clima', html: '', iconSize: [70, 40] })));
      vista.querySelector('#linea-tiempo').hidden = true;
      mapa.flyTo([finca.latitud, finca.longitud], 15);
      return;
    }
    try {
      await asegurarClima();
      vista.querySelector('#linea-tiempo').hidden = false;
      if (mapa.getZoom() > 10) mapa.flyToBounds(L.featureGroup(celdas.map((c) => c.rect)).getBounds(), { duration: 1 });
      pintarFrame();
    } catch (e) {
      estado.textContent = e.message;
    }
  }));

  control.addEventListener('input', pintarFrame);
  function detener() {
    clearInterval(temporizador);
    temporizador = null;
    vista.querySelector('#reproducir').textContent = '▶';
  }
  vista.querySelector('#reproducir').addEventListener('click', () => {
    if (temporizador) { detener(); return; }
    vista.querySelector('#reproducir').textContent = '⏸';
    temporizador = setInterval(() => {
      if (!document.body.contains(control)) { detener(); return; }
      control.value = String((Number(control.value) + 1) % frames.length);
      pintarFrame();
    }, 900);
  });

  setTimeout(() => mapa.invalidateSize(), 50);
}
