import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import distance from '@turf/distance';
import { point } from '@turf/helpers';

const DATA_BASE = import.meta.env.BASE_URL || '/';
const DEFAULT_CENTER = [39.995, -95.295];
const DEFAULT_ZOOM = 12;
const STATE_LINE_LAT_APPROX = 40.0;

const BASEMAPS = {
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 20, attribution: 'Tiles &copy; Esri' }
  },
  street: {
    label: 'Street',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    options: { maxZoom: 20, subdomains: 'abcd', attribution: '&copy; OpenStreetMap contributors &copy; CARTO' }
  },
  topo: {
    label: 'Topo',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 20, attribution: 'Tiles &copy; Esri' }
  },
  dark: {
    label: 'Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    options: { maxZoom: 20, subdomains: 'abcd', attribution: '&copy; OpenStreetMap contributors &copy; CARTO' }
  }
};
const LOCAL_STORAGE_PLACES_KEY = 'itkn_field_map_saved_places_v1';

// Public AIANNH boundary service. The app also has a build-time script that writes a local copy.
const PUBLIC_AIANNH_LAYER_URL = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TribalIndianLands_01/MapServer/0/query';
const PUBLIC_BOUNDARY_WHERE_CLAUSES = ["NAME LIKE '%Iowa%'", "NAMELSAD LIKE '%Iowa%'"];
const ITKN_SEARCH_BOX = { minLon: -96.2, minLat: 39.55, maxLon: -94.75, maxLat: 40.45 };

function dataUrl(path) {
  return `${DATA_BASE}data/${path}`;
}

async function fetchJson(path) {
  const res = await fetch(dataUrl(path));
  if (!res.ok) throw new Error(`Could not load ${path}`);
  return res.json();
}

async function fetchExternalJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load external GIS source: ${res.status}`);
  return res.json();
}

function publicBoundaryUrl(whereClause) {
  const params = new URLSearchParams({
    where: whereClause,
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson'
  });
  return `${PUBLIC_AIANNH_LAYER_URL}?${params.toString()}`;
}

function flattenCoordinates(coords, output = []) {
  if (!coords) return output;
  if (typeof coords[0] === 'number') output.push(coords);
  else for (const item of coords) flattenCoordinates(item, output);
  return output;
}

function getBBox(feature) {
  const points = flattenCoordinates(feature.geometry?.coordinates || []);
  if (!points.length) return null;
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return {
    minLon: Math.min(...lons),
    minLat: Math.min(...lats),
    maxLon: Math.max(...lons),
    maxLat: Math.max(...lats)
  };
}

function boxesIntersect(a, b) {
  if (!a || !b) return false;
  return !(a.maxLon < b.minLon || a.minLon > b.maxLon || a.maxLat < b.minLat || a.minLat > b.maxLat);
}

function normalizePublicBoundary(collection) {
  if (!collection?.features?.length) throw new Error('Public boundary query returned no features.');
  const matches = collection.features.filter((feature) => {
    const p = feature.properties || {};
    const name = `${p.NAME || ''} ${p.NAMELSAD || ''}`.toLowerCase();
    return name.includes('iowa') && boxesIntersect(getBBox(feature), ITKN_SEARCH_BOX);
  });

  if (!matches.length) throw new Error('Public boundary query returned Iowa features, but none matched the KS/NE target box.');

  return {
    type: 'FeatureCollection',
    name: 'Iowa Reservation boundary from public AIANNH GIS service',
    features: matches.map((feature) => {
      const p = feature.properties || {};
      return {
        ...feature,
        properties: {
          ...p,
          name: p.NAMELSAD || p.NAME || 'Iowa Reservation',
          source: 'Public AIANNH GIS service based on U.S. Census TIGER/Line data',
          data_quality: 'PUBLIC_AIANNH_REFERENCE',
          warning: 'Public reference boundary. Use for field awareness; replace with approved local data when available.'
        }
      };
    })
  };
}

async function loadReservationBoundary() {
  // Try local copy first. This is most reliable on GitHub Pages.
  try {
    const local = await fetchJson('reservation-boundary.geojson');
    if (local?.features?.length && !local.features.some((f) => f?.properties?.data_quality === 'DEMO_ONLY')) return local;
  } catch {
    // Continue to public live source.
  }

  const errors = [];
  for (const whereClause of PUBLIC_BOUNDARY_WHERE_CLAUSES) {
    try {
      const live = await fetchExternalJson(publicBoundaryUrl(whereClause));
      return normalizePublicBoundary(live);
    } catch (err) {
      errors.push(`${whereClause}: ${err.message}`);
    }
  }

  const fallback = await fetchJson('reservation-boundary.geojson');
  return { ...fallback, fetch_warning: `Live public boundary failed; using local fallback. ${errors.join(' | ')}` };
}

function loadSavedPlaces() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_PLACES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSavedPlaces(places) {
  localStorage.setItem(LOCAL_STORAGE_PLACES_KEY, JSON.stringify(places));
}

function formatCoord(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toFixed(6);
}

function getStateSide(lat) {
  if (typeof lat !== 'number') return 'Unknown';
  return lat >= STATE_LINE_LAT_APPROX ? 'Nebraska side' : 'Kansas side';
}

function isDemoFeatureCollection(collection) {
  return collection?.features?.some((f) => f?.properties?.data_quality === 'DEMO_ONLY');
}

function pointInsideAnyBoundary(lat, lng, boundaryGeojson) {
  if (!boundaryGeojson?.features?.length) return { inside: false, matchedName: null };
  const pt = point([lng, lat]);
  for (const feature of boundaryGeojson.features) {
    if (!feature.geometry) continue;
    if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
      try {
        if (booleanPointInPolygon(pt, feature)) return { inside: true, matchedName: feature.properties?.name || 'Boundary' };
      } catch {
        // Ignore malformed feature.
      }
    }
  }
  return { inside: false, matchedName: null };
}

function nearestPlace(lat, lng, placesGeojson) {
  if (!placesGeojson?.features?.length || typeof lat !== 'number' || typeof lng !== 'number') return null;
  const here = point([lng, lat]);
  const candidates = placesGeojson.features
    .filter((f) => f.geometry?.type === 'Point')
    .map((f) => ({ feature: f, miles: distance(here, point(f.geometry.coordinates), { units: 'miles' }) }))
    .sort((a, b) => a.miles - b.miles);
  return candidates[0] || null;
}

function DataBadge({ children, danger }) {
  return <span className={danger ? 'badge badge-danger' : 'badge'}>{children}</span>;
}

export default function App() {
  const mapRef = useRef(null);
  const mapElRef = useRef(null);
  const layersRef = useRef({});
  const watchIdRef = useRef(null);

  const [boundary, setBoundary] = useState(null);
  const [stateLine, setStateLine] = useState(null);
  const [places, setPlaces] = useState(null);
  const [savedPlaces, setSavedPlaces] = useState(() => loadSavedPlaces());
  const [parcelSources, setParcelSources] = useState([]);
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState('');
  const [dataWarning, setDataWarning] = useState('');
  const [tracking, setTracking] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [query, setQuery] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [placeDraft, setPlaceDraft] = useState({ name: '', type: 'Field Point', phone: '', notes: '' });
  const [layerVisibility, setLayerVisibility] = useState({ boundary: true, stateLine: true, places: true, accuracy: true });
  const [selectedBasemap, setSelectedBasemap] = useState('satellite');

  const activePoint = selectedPoint || location;

  const combinedPlaces = useMemo(
    () => ({ type: 'FeatureCollection', features: [...(places?.features || []), ...savedPlaces] }),
    [places, savedPlaces]
  );

  const insideResult = useMemo(() => {
    if (!activePoint) return { inside: false, matchedName: null };
    return pointInsideAnyBoundary(activePoint.lat, activePoint.lng, boundary);
  }, [activePoint, boundary]);

  const closestPlace = useMemo(() => {
    if (!activePoint) return null;
    return nearestPlace(activePoint.lat, activePoint.lng, combinedPlaces);
  }, [activePoint, combinedPlaces]);

  const filteredPlaces = useMemo(() => {
    const term = query.trim().toLowerCase();
    const features = combinedPlaces?.features || [];
    if (!term) return features;
    return features.filter((f) => {
      const p = f.properties || {};
      return [p.name, p.type, p.notes, p.address].filter(Boolean).join(' ').toLowerCase().includes(term);
    });
  }, [combinedPlaces, query]);

  const demoDataLoaded = isDemoFeatureCollection(boundary);

  useEffect(() => {
    Promise.all([loadReservationBoundary(), fetchJson('state-line.geojson'), fetchJson('tribal-places.geojson'), fetchJson('parcel-sources.json')])
      .then(([boundaryData, stateLineData, placesData, parcelData]) => {
        setBoundary(boundaryData);
        setStateLine(stateLineData);
        setPlaces(placesData);
        setParcelSources(parcelData);
        if (boundaryData.fetch_warning) setDataWarning(boundaryData.fetch_warning);
      })
      .catch((err) => setLocationError(err.message));
  }, []);

  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;

    const map = L.map(mapElRef.current, { zoomControl: false, preferCanvas: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ imperial: true, metric: true, position: 'bottomleft' }).addTo(map);

    map.on('click', (e) => {
      setSelectedPoint({ lat: e.latlng.lat, lng: e.latlng.lng, accuracy: null, source: 'Map click' });
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (layersRef.current.baseMap) {
      layersRef.current.baseMap.remove();
    }

    const cfg = BASEMAPS[selectedBasemap] || BASEMAPS.satellite;
    layersRef.current.baseMap = L.tileLayer(cfg.url, {
      ...cfg.options,
      zIndex: 1
    }).addTo(map);

    layersRef.current.baseMap.bringToBack();
  }, [selectedBasemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !boundary) return;
    if (layersRef.current.boundary) layersRef.current.boundary.remove();

    layersRef.current.boundary = L.geoJSON(boundary, {
      style: (feature) => ({
        color: feature.properties?.data_quality === 'DEMO_ONLY' ? '#f59e0b' : '#22c55e',
        weight: 4,
        fillColor: feature.properties?.data_quality === 'DEMO_ONLY' ? '#f59e0b' : '#16a34a',
        fillOpacity: 0.08,
        dashArray: feature.properties?.data_quality === 'DEMO_ONLY' ? '8 8' : null
      }),
      onEachFeature: (feature, layer) => {
        const p = feature.properties || {};
        layer.bindPopup(`<strong>${p.name || 'Boundary'}</strong><br/>${p.source || ''}<br/>${p.warning || ''}`);
      }
    });

    if (layerVisibility.boundary) layersRef.current.boundary.addTo(map);
    try {
      map.fitBounds(layersRef.current.boundary.getBounds(), { padding: [30, 30] });
    } catch {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    }
  }, [boundary, layerVisibility.boundary]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !stateLine) return;
    if (layersRef.current.stateLine) layersRef.current.stateLine.remove();

    layersRef.current.stateLine = L.geoJSON(stateLine, {
      style: { color: '#38bdf8', weight: 3, dashArray: '4 6' },
      onEachFeature: (feature, layer) => layer.bindPopup(`<strong>${feature.properties?.name || 'State line'}</strong><br/>${feature.properties?.source || ''}`)
    });

    if (layerVisibility.stateLine) layersRef.current.stateLine.addTo(map);
  }, [stateLine, layerVisibility.stateLine]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !combinedPlaces) return;
    if (layersRef.current.places) layersRef.current.places.remove();

    layersRef.current.places = L.geoJSON(combinedPlaces, {
      pointToLayer: (feature, latlng) => {
        const type = (feature.properties?.type || '').toLowerCase();
        const saved = feature.properties?.data_quality === 'SAVED_ON_THIS_DEVICE';
        const color = saved ? '#facc15' : type.includes('law') || type.includes('police') ? '#38bdf8' : type.includes('business') ? '#a78bfa' : '#f97316';
        return L.circleMarker(latlng, { radius: 9, color: '#020617', weight: 2, fillColor: color, fillOpacity: 0.95 });
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties || {};
        layer.bindPopup(`<strong>${p.name || 'Place'}</strong><br/>Type: ${p.type || '—'}<br/>Address: ${p.address || '—'}<br/>Phone: ${p.phone || '—'}<br/>Notes: ${p.notes || '—'}`);
      }
    });

    if (layerVisibility.places) layersRef.current.places.addTo(map);
  }, [combinedPlaces, layerVisibility.places]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !location) return;

    if (layersRef.current.locationMarker) layersRef.current.locationMarker.remove();
    if (layersRef.current.accuracyCircle) layersRef.current.accuracyCircle.remove();

    layersRef.current.locationMarker = L.circleMarker([location.lat, location.lng], {
      radius: 10,
      color: '#ffffff',
      weight: 3,
      fillColor: '#2563eb',
      fillOpacity: 1
    }).bindPopup(`<strong>Your location</strong><br/>Accuracy: ${Math.round(location.accuracy || 0)} m`);

    layersRef.current.locationMarker.addTo(map);

    if (layerVisibility.accuracy && location.accuracy) {
      layersRef.current.accuracyCircle = L.circle([location.lat, location.lng], {
        radius: location.accuracy,
        color: '#2563eb',
        weight: 1,
        fillColor: '#60a5fa',
        fillOpacity: 0.12
      }).addTo(map);
    }
  }, [location, layerVisibility.accuracy]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedPoint) return;
    if (layersRef.current.selectedPoint) layersRef.current.selectedPoint.remove();

    layersRef.current.selectedPoint = L.circleMarker([selectedPoint.lat, selectedPoint.lng], {
      radius: 8,
      color: '#111827',
      weight: 2,
      fillColor: '#facc15',
      fillOpacity: 1
    }).bindPopup(`<strong>Checked point</strong><br/>${formatCoord(selectedPoint.lat)}, ${formatCoord(selectedPoint.lng)}`);

    layersRef.current.selectedPoint.addTo(map).openPopup();
  }, [selectedPoint]);

  function startTracking() {
    setLocationError('');
    if (!('geolocation' in navigator)) {
      setLocationError('This device/browser does not support geolocation.');
      return;
    }

    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          timestamp: pos.timestamp,
          source: 'GPS / browser location'
        };
        setLocation(next);
        setSelectedPoint(null);
        setTracking(true);
        mapRef.current?.setView([next.lat, next.lng], Math.max(mapRef.current.getZoom(), 15));
      },
      (err) => {
        setTracking(false);
        setLocationError(`Location error: ${err.message}`);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  function stopTracking() {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    setTracking(false);
  }

  function recenter() {
    const map = mapRef.current;
    if (!map || !location) return;
    map.setView([location.lat, location.lng], Math.max(map.getZoom(), 16));
  }

  function zoomToFeature(feature) {
    const map = mapRef.current;
    if (!map || !feature?.geometry) return;
    if (feature.geometry.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates;
      map.setView([lat, lng], 17);
      setSelectedPoint({ lat, lng, accuracy: null, source: feature.properties?.name || 'Place' });
      return;
    }
    const layer = L.geoJSON(feature);
    map.fitBounds(layer.getBounds(), { padding: [30, 30] });
  }

  function saveCurrentPoint() {
    const pt = activePoint;
    const name = placeDraft.name.trim();
    if (!pt) {
      setLocationError('Start GPS or click the map first, then save the point.');
      return;
    }
    if (!name) {
      setLocationError('Give the point a name before saving it.');
      return;
    }
    const feature = {
      type: 'Feature',
      properties: {
        name,
        type: placeDraft.type.trim() || 'Field Point',
        phone: placeDraft.phone.trim(),
        notes: placeDraft.notes.trim(),
        data_quality: 'SAVED_ON_THIS_DEVICE',
        saved_at: new Date().toISOString()
      },
      geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] }
    };
    const next = [...savedPlaces, feature];
    setSavedPlaces(next);
    saveSavedPlaces(next);
    setPlaceDraft({ name: '', type: 'Field Point', phone: '', notes: '' });
    setLocationError('');
  }

  function exportSavedPlaces() {
    const output = { type: 'FeatureCollection', name: 'ITKN saved field points', features: savedPlaces };
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'itkn-saved-field-points.geojson';
    a.click();
    URL.revokeObjectURL(url);
  }

  function clearSavedPlaces() {
    if (!window.confirm('Delete all points saved on this device? Export first if you need them.')) return;
    setSavedPlaces([]);
    saveSavedPlaces([]);
  }

  function toggleLayer(name) {
    setLayerVisibility((prev) => {
      const next = { ...prev, [name]: !prev[name] };
      const layer = layersRef.current[name];
      const map = mapRef.current;
      if (map && layer) {
        if (next[name]) layer.addTo(map);
        else layer.remove();
      }
      return next;
    });
  }

  async function copyCoordinates() {
    const pt = activePoint;
    if (!pt) {
      setLocationError('Start GPS or tap the map first.');
      return;
    }

    const text = `${formatCoord(pt.lat)}, ${formatCoord(pt.lng)}`;

    try {
      await navigator.clipboard.writeText(text);
      setLocationError(`Copied coordinates: ${text}`);
    } catch {
      setLocationError(`Coordinates: ${text}`);
    }
  }

  function openGoogleMaps() {
    const pt = activePoint;
    if (!pt) {
      setLocationError('Start GPS or tap the map first.');
      return;
    }

    const url = `https://www.google.com/maps?q=${pt.lat},${pt.lng}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="app-shell">
      <div className="map" ref={mapElRef} />

      <header className="topbar">
        <div>
          <div className="eyebrow">Public data field map</div>
          <h1>ITKN Jurisdiction & Property Map</h1>
        </div>
        <button className="menu-btn" onClick={() => setDrawerOpen((v) => !v)}>{drawerOpen ? 'Hide panel' : 'Show panel'}</button>
      </header>

      <section className="status-card">
        <div className="status-main">
          <DataBadge danger={demoDataLoaded}>DATA: {demoDataLoaded ? 'DEMO FALLBACK - REPLACE' : 'Public boundary loaded'}</DataBadge>
          <DataBadge danger={!insideResult.inside}>{insideResult.inside ? 'INSIDE loaded boundary' : 'OUTSIDE loaded boundary'}</DataBadge>
          <DataBadge>{activePoint ? getStateSide(activePoint.lat) : 'Location not checked'}</DataBadge>
        </div>
        <div className="status-grid">
          <div><span>Lat</span><strong>{formatCoord(activePoint?.lat)}</strong></div>
          <div><span>Lng</span><strong>{formatCoord(activePoint?.lng)}</strong></div>
          <div><span>Accuracy</span><strong>{activePoint?.accuracy ? `${Math.round(activePoint.accuracy)} m` : '—'}</strong></div>
          <div><span>Nearest</span><strong>{closestPlace ? `${closestPlace.feature.properties?.name || 'Place'} (${closestPlace.miles.toFixed(2)} mi)` : '—'}</strong></div>
        </div>
        <div className="button-row">
          {!tracking ? <button className="primary" onClick={startTracking}>Start location tracking</button> : <button className="danger" onClick={stopTracking}>Stop tracking</button>}
          <button onClick={recenter} disabled={!location}>Re-center</button>
          <button onClick={() => setSelectedPoint(null)} disabled={!selectedPoint}>Use GPS point</button>
          <button onClick={copyCoordinates} disabled={!activePoint}>Copy GPS</button>
          <button onClick={openGoogleMaps} disabled={!activePoint}>Open Maps</button>
        </div>
        {dataWarning && <p className="error-text">{dataWarning}</p>}
        {locationError && <p className="error-text">{locationError}</p>}
      </section>

      <aside className={drawerOpen ? 'drawer open' : 'drawer'}>
        <div className="drawer-section warning">
          <strong>How this works</strong>
          <p>The app uses public boundary data, your browser GPS, saved field points, and official county parcel links. It is built to work now without waiting on anyone.</p>
        </div>

        <div className="drawer-section">
          <h2>Layers</h2>
          <div className="drawer-basemap-safe">
            <div className="layer-subtitle">Map view</div>
            <div className="basemap-grid">
              {Object.entries(BASEMAPS).map(([key, cfg]) => (
                <button
                  type="button"
                  key={key}
                  className={selectedBasemap === key ? 'basemap active' : 'basemap'}
                  onClick={() => setSelectedBasemap(key)}
                >
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>

          <label><input type="checkbox" checked={layerVisibility.boundary} onChange={() => toggleLayer('boundary')} /> Reservation boundary</label>
          <label><input type="checkbox" checked={layerVisibility.stateLine} onChange={() => toggleLayer('stateLine')} /> KS / NE state line</label>
          <label><input type="checkbox" checked={layerVisibility.places} onChange={() => toggleLayer('places')} /> Places / saved field points</label>
          <label><input type="checkbox" checked={layerVisibility.accuracy} onChange={() => toggleLayer('accuracy')} /> GPS accuracy circle</label>
        </div>

        <div className="drawer-section">
          <h2>Save a field point</h2>
          <p className="muted">Start GPS or tap the map, then save that spot. Saved points stay on this device until you export them.</p>
          <input className="search" placeholder="Name, like North gate or Tribal Office" value={placeDraft.name} onChange={(e) => setPlaceDraft((p) => ({ ...p, name: e.target.value }))} />
          <input className="search" placeholder="Type, like Gate, Business, Housing, Pasture" value={placeDraft.type} onChange={(e) => setPlaceDraft((p) => ({ ...p, type: e.target.value }))} />
          <input className="search" placeholder="Phone or contact, optional" value={placeDraft.phone} onChange={(e) => setPlaceDraft((p) => ({ ...p, phone: e.target.value }))} />
          <textarea className="search textarea" placeholder="Notes, optional" value={placeDraft.notes} onChange={(e) => setPlaceDraft((p) => ({ ...p, notes: e.target.value }))} />
          <div className="button-row compact">
            <button className="primary" onClick={saveCurrentPoint}>Save current/check point</button>
            <button onClick={exportSavedPlaces} disabled={!savedPlaces.length}>Export</button>
            <button onClick={clearSavedPlaces} disabled={!savedPlaces.length}>Clear</button>
          </div>
          <p className="muted">Saved on this device: {savedPlaces.length}</p>
        </div>

        <div className="drawer-section">
          <h2>Places & contacts</h2>
          <input className="search" placeholder="Search facility, gate, pasture, business..." value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="result-list">
            {filteredPlaces.map((feature, index) => (
              <button className="result" key={`${feature.properties?.name || 'place'}-${index}`} onClick={() => zoomToFeature(feature)}>
                <strong>{feature.properties?.name || 'Unnamed place'}</strong>
                <span>{feature.properties?.type || 'No type'} · {feature.properties?.address || feature.properties?.notes || 'No notes'}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="drawer-section">
          <h2>Parcel / assessor links</h2>
          <p className="muted">These open the official/public parcel sources. This avoids loading huge parcel datasets into GitHub.</p>
          <div className="link-list">
            {parcelSources.map((source) => (
              <a key={source.name} href={source.url} target="_blank" rel="noreferrer">
                <strong>{source.county} County, {source.state}</strong>
                <span>{source.notes}</span>
              </a>
            ))}
          </div>
        </div>

        <div className="drawer-section">
          <h2>What it can answer</h2>
          <ul>
            <li>Where am I right now?</li>
            <li>Am I inside the loaded reservation boundary?</li>
            <li>Am I on the Kansas or Nebraska side?</li>
            <li>What saved/public place is closest?</li>
            <li>Which parcel viewer should I open?</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
