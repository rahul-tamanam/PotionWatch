import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './PotionNetworkMap.css';

/* ======================
   Icons
====================== */
const createCauldronIcon = (color) =>
  new L.DivIcon({
    html: `
      <div style="position: relative; width: 40px; height: 40px;">
        <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
          <ellipse cx="20" cy="32" rx="12" ry="4" fill="#333" opacity="0.3"/>
          <path d="M 12 18 Q 10 25, 12 30 L 28 30 Q 30 25, 28 18 Z" fill="${color}" stroke="#222" stroke-width="1.5"/>
          <ellipse cx="20" cy="18" rx="8" ry="2.5" fill="${color}" stroke="#191919ff" stroke-width="1.5"/>
          <path d="M 11 20 Q 8 20, 8 23 Q 8 25, 11 25" fill="none" stroke="#222" stroke-width="2"/>
          <path d="M 29 20 Q 32 20, 32 23 Q 32 25, 29 25" fill="none" stroke="#222" stroke-width="2"/>
          ircle cx="18" cy="22" r="1.5" fill="#fff" opacity="="0.6"/>
          ircle cx="22" cy="24" r="1.2" fill="#fff" opacity="="0.6"/>
          ircle cx="20" cy="26" r="1" fill="#fff" opacity="0.0.4"/>
        </svg>
      </div>
    `,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 35],
  });

const marketIcon = new L.DivIcon({
  html: `
    <div style="position: relative; width: 50px; height: 50px;">
      <svg width="50" height="50" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">
        ircle cx="25" cy="25" r="20" fill="#9b59b6" opacityty="0.3"/>
        ircle cx="25" cy="25" r="15" fill="#8e44ad" opacityty="0.5"/>
        ircle cx="25" cy="25" r="12" fill="#6c3483" stroke="#fff" strokeke-width="2"/>
        <path d="M 25 15 L 27 21 L 33 21 L 28 25 L 30 31 L 25 27 L 20 31 L 22 25 L 17 21 L 23 21 Z" fill="#fff" stroke="#ffd700" stroke-width="0.5"/>
        ircle cx="15" cy="15" r="1.5" fill="#"#fff"/>
        ircle cx="35" cy="15" r="1" fill="#fffff"/>
        <rcle cx="35" cy="35" r="1.5" fill="#fffff"/>
        <rcle cx="15" cy="35" r="1" fill="#fffff"/>
      </svg>
    </div>
  `,
  className: '',
  iconSize: [50, 50],
  iconAnchor: [25, 25],
});

/* ======================
   Curved line (animated)
====================== */
function CurvedArrow({ positions, color }) {
  const map = useMap();

  useEffect(() => {
    if (!positions || positions.length !== 2) return;
    const start = positions[0];
    const end = positions[1];

    const midLat = (start[0] + end[0]) / 2;
    const midLon = (start[1] + end[1]) / 2;

    const dx = end[1] - start[1];
    const dy = end[0] - start[0];
    const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    const offset = dist * 0.15;

    const controlLat = midLat - (dx / dist) * offset;
    const controlLon = midLon + (dy / dist) * offset;

    const curvePoints = [];
    for (let t = 0; t <= 1.00001; t += 0.05) {
      const lat =
        (1 - t) * (1 - t) * start[0] +
        2 * (1 - t) * t * controlLat +
        t * t * end[0];
      const lon =
        (1 - t) * (1 - t) * start[1] +
        2 * (1 - t) * t * controlLon +
        t * t * end[1];
      curvePoints.push([lat, lon]);
    }

    const deepShadow = L.polyline(curvePoints, {
      color: '#000',
      weight: 10,
      opacity: 0.35,
    }).addTo(map);

    const base = L.polyline(curvePoints, {
      color,
      weight: 5,
      opacity: 0.95,
    }).addTo(map);

    let dashOffset = 0;
    const anim = L.polyline(curvePoints, {
      color: '#ffffff',
      weight: 2.5,
      opacity: 0.6,
      dashArray: '12,18',
      dashOffset: 0,
    }).addTo(map);

    const id = setInterval(() => {
      dashOffset = (dashOffset - 1) % 30;
      anim.setStyle({ dashOffset });
    }, 50);

    return () => {
      clearInterval(id);
      map.removeLayer(deepShadow);
      map.removeLayer(base);
      map.removeLayer(anim);
    };
  }, [positions, color, map]);

  return null;
}

/* ======================
   Forecast + VRP helpers
====================== */
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function estimateFillRatesLph(levelSeriesById, timestamps) {
  const rates = {};
  if (!timestamps || !timestamps.length) return rates;
  Object.entries(levelSeriesById).forEach(([id, series]) => {
    const deltasPerMin = [];
    for (let i = 1; i < series.length; i++) {
      const dv = series[i] - series[i - 1];
      const dtMin = (timestamps[i] - timestamps[i - 1]) / 60;
      if (dtMin <= 0) continue;
      if (dv > 0) deltasPerMin.push(dv / dtMin);
    }
    const perMin = median(deltasPerMin);
    rates[id] = Math.max(perMin * 60, 0); // L/hr
  });
  return rates;
}

function dijkstraShortest(fromId, nodes, neighbors, weight) {
  const dist = {};
  const visited = {};
  nodes.forEach((n) => (dist[n] = Infinity));
  dist[fromId] = 0;
  for (let i = 0; i < nodes.length; i++) {
    let u = null;
    let best = Infinity;
    nodes.forEach((n) => {
      if (!visited[n] && dist[n] < best) {
        best = dist[n];
        u = n;
      }
    });
    if (u === null) break;
    visited[u] = true;
    neighbors(u).forEach((v) => {
      const alt = dist[u] + weight(u, v);
      if (alt < dist[v]) dist[v] = alt;
    });
  }
  return dist;
}

function buildTravelMatrix(ids, edges) {
  const graph = {};
  ids.forEach((id) => (graph[id] = []));
  (edges || []).forEach((e) => {
    if (graph[e.from]) graph[e.from].push({ id: e.to, w: e.travel_time_minutes });
    if (graph[e.to]) graph[e.to].push({ id: e.from, w: e.travel_time_minutes });
  });
  const neighbors = (id) => graph[id].map((x) => x.id);
  const weight = (a, b) => {
    const n = graph[a].find((x) => x.id === b);
    return n ? n.w : 999999;
  };
  const matrix = {};
  ids.forEach((a) => {
    const dist = dijkstraShortest(a, ids, neighbors, weight);
    matrix[a] = dist; // minutes
  });
  return matrix;
}

function computeOverflowMinutes(current, max, fillRateLph) {
  if (fillRateLph <= 0) return Infinity;
  const remaining = Math.max(max - current, 0);
  return (remaining / fillRateLph) * 60;
}

function greedyAssignRoutes(
  cauldrons,
  currentLevels,
  fillRatesLph,
  travelMatrix,
  depotId = 'market_001',
  maxRouteMinutes = 8 * 60
) {
  const items = cauldrons.map((c) => {
    const current = currentLevels[c.id] || 0;
    const rate = Math.max(fillRatesLph[c.id] || 0, 0.00001);
    const overflowInMin = computeOverflowMinutes(current, c.max_volume, rate);
    return { ...c, current, rate, overflowInMin };
  });

  items.sort((a, b) => a.overflowInMin - b.overflowInMin);
  const pending = new Set(items.map((x) => x.id));
  const routes = [];

  while (pending.size) {
    let timeUsed = 0;
    let curr = depotId;
    const route = [depotId];

    while (true) {
      let chosen = null;
      let chosenTravel = 0;
      let bestSlack = Infinity;

      for (const c of items) {
        if (!pending.has(c.id)) continue;
        const travel = travelMatrix[curr]?.[c.id] ?? Infinity;
        const arriveAt = timeUsed + travel;
        const slack = c.overflowInMin - arriveAt;
        if (
          arriveAt <= c.overflowInMin &&
          slack < bestSlack &&
          timeUsed + travel <= maxRouteMinutes
        ) {
          chosen = c;
          chosenTravel = travel;
          bestSlack = slack;
        }
      }

      if (!chosen) break;
      timeUsed += chosenTravel;
      route.push(chosen.id);
      pending.delete(chosen.id);
      curr = chosen.id;
      // Optional service time: timeUsed += 5;
    }

    const back = travelMatrix[curr]?.[depotId] ?? 0;
    if (timeUsed + back <= maxRouteMinutes) route.push(depotId);
    else if (route[route.length - 1] !== depotId) route.push(depotId);

    routes.push(route);
  }

  return routes;
}

function computeScheduleForRoute(route, travelMatrix, startTime = 0) {
  let t = startTime;
  const out = [];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const travel = travelMatrix[a]?.[b] ?? 0;
    t += travel;
    out.push({ id: b, etaMinFromStart: Math.round(t) });
  }
  return out;
}

/* ======================
   Main Component
====================== */
function PotionNetworkMap() {
  const [cauldrons, setCauldrons] = useState([]);
  const [currentLevels, setCurrentLevels] = useState({});
  const [market, setMarket] = useState(null);
  const [edges, setEdges] = useState([]);
  const [timestamp, setTimestamp] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // for rate estimation (last 60 minutes)
  const [seriesById, setSeriesById] = useState({});
  const [seriesTs, setSeriesTs] = useState([]);

  // Initial + periodic refresh
  const fetchAll = async () => {
    try {
      setError(null);

      // Base metadata
      const [caRes, mkRes, nwRes] = await Promise.all([
        fetch('/api/Information/cauldrons'),
        fetch('/api/Information/market'),
        fetch('/api/Information/network'),
      ]);
      if (!caRes.ok || !mkRes.ok || !nwRes.ok) throw new Error('Failed to fetch network info');

      const [caData, mkData, nwData] = await Promise.all([caRes.json(), mkRes.json(), nwRes.json()]);
      setCauldrons(caData);
      setMarket(mkData);
      setEdges(nwData.edges || []);

      // Levels (last 60 min)
      const nowSec = Math.floor(Date.now() / 1000);
      const start = nowSec - 60 * 60;
      const lvRes = await fetch(`/api/Data?start_date=${start}&end_date=${nowSec}`);
      if (!lvRes.ok) throw new Error('Failed to fetch levels');
      const lvData = await lvRes.json();
      if (!Array.isArray(lvData) || !lvData.length) throw new Error('No level data returned');

      const sorted = [...lvData].sort((a, b) => a.timestamp - b.timestamp);
      const ts = sorted.map((x) => x.timestamp);
      setSeriesTs(ts);

      const latest = sorted[sorted.length - 1];
      setCurrentLevels(latest.cauldron_levels || {});
      const byId = {};
      sorted.forEach((snap) => {
        const levels = snap.cauldron_levels || {};
        Object.keys(levels).forEach((id) => {
          if (!byId[id]) byId[id] = [];
          byId[id].push(levels[id]);
        });
      });
      setSeriesById(byId);

      const formatted = new Date(latest.timestamp * 1000).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: 'UTC',
      }) + ' UTC';
      setTimestamp(formatted);

      setLoading(false);
    } catch (e) {
      setError(e.message || String(e));
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);
  useEffect(() => {
    const id = setInterval(() => { fetchAll(); }, 60000);
    return () => clearInterval(id);
  }, []);

  if (error) {
    return (
      <div className="potion-network-error">
        <h2>⚠️ Error Loading Data</h2>
        <p>{error}</p>
        <button onClick={fetchAll}>🔄 Retry</button>
      </div>
    );
  }

  if (loading || !market || !cauldrons.length) {
    return (
      <div className="potion-loading">
        <div className="potion-loading-inner">
          <div style={{ fontSize: 48, marginBottom: 20 }}>🧪</div>
          <div style={{ fontSize: 24, marginBottom: 10, color: '#333', fontWeight: 600 }}>
            Loading Potion Network...
          </div>
          <div style={{ fontSize: 14, color: '#999' }}>
            Fetching topology, levels, and forecasting routes...
          </div>
          <div style={{ marginTop: 20, width: 200, height: 4, background: '#f0f0f0', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'linear-gradient(90deg, #667eea, #764ba2)', animation: 'loading 1.5s infinite', width: '50%' }} />
          </div>
        </div>
        <style>{`
          @keyframes loading {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(300%); }
          }
        `}</style>
      </div>
    );
  }

  // Derived data for VRP + display
  const fillRatesLph = useMemo(
    () => estimateFillRatesLph(seriesById, seriesTs),
    [seriesById, seriesTs]
  );

  const ids = useMemo(
    () => ['market_001', ...cauldrons.map((c) => c.id)],
    [cauldrons]
  );

  const travelMatrix = useMemo(
    () => buildTravelMatrix(ids, edges),
    [ids, edges]
  );

  const routes = useMemo(() => {
    return greedyAssignRoutes(
      cauldrons,
      currentLevels,
      fillRatesLph,
      travelMatrix,
      'market_001',
      8 * 60
    );
  }, [cauldrons, currentLevels, fillRatesLph, travelMatrix]);

  const schedules = useMemo(
    () => routes.map((r) => computeScheduleForRoute(r, travelMatrix, 0)),
    [routes, travelMatrix]
  );

  const avgLat = cauldrons.reduce((sum, c) => sum + c.latitude, 0) / cauldrons.length;
  const avgLon = cauldrons.reduce((sum, c) => sum + c.longitude, 0) / cauldrons.length;

  const palette = ['#d7263d', '#5046e5', '#fdc632', '#087e8b', '#a8c686', '#ff7f50', '#c80064', '#6d214f'];

  return (
    <div className="potion-network-container">
      {/* Header Bar */}
      <header className="potion-network-header-bar">
        <div className="potion-brand">
          <span className="scary-emoji" role="img" aria-label="witch">🧙🏻‍♀️</span>
          <span className="potion-brand-title">El Mejor</span>
        </div>
        <nav className="potion-nav-links">
          <a href="#" className="potion-link">Home</a>
          <a href="#" className="potion-link">Shop</a>
          <a href="#" className="potion-link">Cart</a>
          <a href="#" className="potion-link">Sign Up</a>
        </nav>
      </header>

      {/* Courier legend */}
      <div className="potion-courier-legend">
        <div style={{ marginBottom: 6 }}>
          <strong>📅 {timestamp}</strong>
        </div>
        <div style={{ marginBottom: 8 }}>
          <strong>Minimum witches required:</strong> {routes.length}
        </div>
        {routes.map((r, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <span style={{ color: palette[i % palette.length], fontWeight: 800 }}>Witch {i + 1}</span>
            <span style={{ marginLeft: 8, color: '#ffe9b1' }}>{r.join(' → ')}</span>
            <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>
              {schedules[i].map((s) => (
                <span key={s.id} style={{ marginRight: 8 }}>
                  {s.id}: {s.etaMinFromStart}m
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Map */}
      <MapContainer center={[avgLat, avgLon]} zoom={13} style={{ flex: 1, width: '100%' }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />

        {/* Draw optimized courier routes */}
        {routes.map((route, i) => {
          const color = palette[i % palette.length];
          return (
            <React.Fragment key={i}>
              {Array.from({ length: route.length - 1 }).map((_, idx) => {
                const a = route[idx];
                const b = route[idx + 1];
                const from =
                  a === 'market_001'
                    ? [market.latitude, market.longitude]
                    : [
                        cauldrons.find((c) => c.id === a).latitude,
                        cauldrons.find((c) => c.id === a).longitude,
                      ];
                const to =
                  b === 'market_001'
                    ? [market.latitude, market.longitude]
                    : [
                        cauldrons.find((c) => c.id === b).latitude,
                        cauldrons.find((c) => c.id === b).longitude,
                      ];
                return <CurvedArrow key={`${a}_${b}`} positions={[from, to]} color={color} />;
              })}
            </React.Fragment>
          );
        })}

        {/* Cauldrons */}
        {cauldrons.map((c) => {
          const current = currentLevels[c.id] || 0;
          const rate = Math.max(fillRatesLph[c.id] || 0, 0);
          const overflowMin = computeOverflowMinutes(current, c.max_volume, rate);
          const fullness = c.max_volume > 0 ? current / c.max_volume : 0;
          const color =
            fullness < 0.5 ? '#2ecc71' : fullness < 0.9 ? '#f39c12' : '#e74c3c';
          return (
            <Marker key={c.id} position={[c.latitude, c.longitude]} icon={createCauldronIcon(color)}>
              <Popup>
                <div style={{ fontFamily: 'Segoe UI, sans-serif', minWidth: 200 }}>
                  <strong style={{ fontSize: 15, color: '#333' }}>{c.name}</strong>
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <div style={{ marginBottom: 4 }}>
                      📊 <strong>{current.toFixed(1)}</strong> / {c.max_volume} L
                    </div>
                    <div>Rate: {rate.toFixed(1)} L/hr</div>
                    <div>
                      Overflow in: {overflowMin === Infinity ? '—' : `${Math.max(0, Math.round(overflowMin))} min`}
                    </div>
                    <div style={{ marginTop: 6, background: '#f0f0f0', borderRadius: 10, height: 8, overflow: 'hidden' }}>
                      <div style={{ background: color, width: `${Math.min(100, fullness * 100)}%`, height: '100%', borderRadius: 10, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Market */}
        <Marker position={[market.latitude, market.longitude]} icon={marketIcon}>
          <Popup>
            <div style={{ fontFamily: 'Segoe UI, sans-serif', textAlign: 'center', padding: 5 }}>
              <div style={{ fontSize: 24, marginBottom: 5 }}>✨</div>
              <strong style={{ fontSize: 16, color: '#8e44ad' }}>
                {market.name || 'Enchanted Market'}
              </strong>
              <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                Depot / Distribution Hub
              </div>
            </div>
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}

export default PotionNetworkMap;
