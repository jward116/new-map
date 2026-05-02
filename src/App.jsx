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
  const [countyParcelSources, setCountyParcelSources] = useState([]);
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState('');
  const [dataWarning, setDataWarning] = useState('');
  const [tracking, setTracking] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [query, setQuery] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [placeDraft, setPlaceDraft] = useState({ name: '', type: 'Field Point', phone: '', notes: '' });
  const [layerVisibility, setLayerVisibility] = useState({ boundary: true, stateLine: true, places: true, accuracy: true });
  const [categoryVisibility, setCategoryVisibility] = useState({
    law: true,
    court: true,
    gov: true,
    business: true,
    farm: true,
    place: true
  });
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


  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function getPlaceCategory(properties = {}) {
    const raw = `${properties.type ?? ''} ${properties.category ?? ''} ${properties.name ?? ''}`.toLowerCase();

    if (raw.includes('police') || raw.includes('sheriff') || raw.includes('law enforcement')) return 'law';
    if (raw.includes('court')) return 'court';
    if (raw.includes('government') || raw.includes('administration') || raw.includes('tribal')) return 'gov';
    if (raw.includes('casino')) return 'casino';
    if (raw.includes('farm') || raw.includes('bee') || raw.includes('agriculture')) return 'farm';
    if (raw.includes('oil') || raw.includes('tire') || raw.includes('business')) return 'business';

    return 'place';
  }

  function getPlaceIconConfig(properties = {}) {
    const category = getPlaceCategory(properties);

    const configs = {
      law: { icon: '🛡', label: 'Law Enforcement', className: 'marker-law' },
      court: { icon: '⚖', label: 'Court', className: 'marker-court' },
      gov: { icon: '🏛', label: 'Government', className: 'marker-gov' },
      casino: { icon: '🎰', label: 'Casino / Business', className: 'marker-casino' },
      farm: { icon: '🌾', label: 'Farm / Agriculture', className: 'marker-farm' },
      business: { icon: '🏢', label: 'Business', className: 'marker-business' },
      place: { icon: '📍', label: 'Public Place', className: 'marker-place' }
    };

    return configs[category] ?? configs.place;
  }

  function makePlaceIcon(properties = {}) {
    const cfg = getPlaceIconConfig(properties);

    return L.divIcon({
      className: `pro-marker ${cfg.className}`,
      html: `<span>${cfg.icon}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -18]
    });
  }

  function firstValue(properties = {}, keys = []) {
    for (const key of keys) {
      if (properties[key] != null && properties[key] !== '') return properties[key];
    }
    return '';
  }

  function buildPlacePopup(properties = {}) {
    const name = firstValue(properties, ['name', 'Name', 'title', 'Title']) || 'Public Place';
    const type = firstValue(properties, ['type', 'Type', 'category', 'Category']) || getPlaceIconConfig(properties).label;
    const address = firstValue(properties, ['address', 'Address']);
    const phone = firstValue(properties, ['phone', 'Phone']);
    const website = firstValue(properties, ['website', 'Website', 'url', 'URL']);
    const notes = firstValue(properties, ['notes', 'Notes', 'description', 'Description']);
    const cfg = getPlaceIconConfig(properties);

    return `
      <div class="place-popup">
        <div class="place-popup-title">${cfg.icon} ${escapeHtml(name)}</div>
        <div class="place-popup-type">${escapeHtml(type)}</div>
        ${address ? `<div class="place-popup-row"><span>Address</span><strong>${escapeHtml(address)}</strong></div>` : ''}
        ${phone ? `<div class="place-popup-row"><span>Phone</span><strong>${escapeHtml(phone)}</strong></div>` : ''}
        ${website ? `<div class="place-popup-row"><span>Website</span><strong>${escapeHtml(website)}</strong></div>` : ''}
        ${notes ? `<div class="place-popup-notes">${escapeHtml(notes)}</div>` : ''}
      </div>
    `;
  }

  useEffect(() => {
    const layer = layersRef.current.places;
    if (!layer || !places) return;

    layer.eachLayer((marker) => {
      const properties = marker.feature?.properties ?? {};

      if (marker.setIcon) {
        marker.setIcon(makePlaceIcon(properties));
      }

      if (marker.bindPopup) {
        marker.bindPopup(buildPlacePopup(properties));
      }
    });
  }, [places, layerVisibility.places]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (layersRef.current.baseMap) return;
    applyBasemap(selectedBasemap);
  }, []);

  function applyBasemap(key) {
    const map = mapRef.current;
    if (!map) return;

    const cfg = BASEMAPS[key] || BASEMAPS.satellite;

    if (layersRef.current.baseMap) {
      map.removeLayer(layersRef.current.baseMap);
      layersRef.current.baseMap = null;
    }

    const nextBaseMap = L.tileLayer(cfg.url, {
      ...cfg.options,
      zIndex: 1
    });

    nextBaseMap.addTo(map);
    nextBaseMap.bringToBack();

    layersRef.current.baseMap = nextBaseMap;
    setSelectedBasemap(key);
  }

  function toggleCategory(category) {
    setCategoryVisibility((prev) => ({
      ...prev,
      [category]: !prev[category]
    }));
  }

  const hiddenCategoryClasses = Object.entries(categoryVisibility)
    .filter(([, visible]) => !visible)
    .map(([category]) => `hide-${category}`)
    .join(' ');

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/county-parcel-sources.json`)
      .then((res) => res.json())
      .then((data) => setCountyParcelSources(data.counties ?? []))
      .catch(() => setCountyParcelSources([]));
  }, []);

  function openExternalParcelLink(url) {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function buildRichardsonReportUrl(pid) {
    return `https://report.gworks.com/report.ashx?county=richardson&id=${encodeURIComponent(pid)}&subs=true&type=assessor`;
  }

  function cleanParcelValue(value) {
    if (value === null || value === undefined) return 'Not listed';
    const text = String(value).trim();
    return text || 'Not listed';
  }

  function buildRichardsonPopup(properties = {}) {
    const pid = cleanParcelValue(properties.PID);
    const acres = cleanParcelValue(properties.acres);

    return `
      <div class="parcel-popup">
        <div class="parcel-popup-title">Richardson County Parcel</div>
        <div class="parcel-popup-row">
          <span>Parcel ID</span>
          <strong>${pid}</strong>
        </div>
        <div class="parcel-popup-row">
          <span>Acres</span>
          <strong>${acres}</strong>
        </div>
        <div class="parcel-popup-note">
          Owner details are not exposed in the GIS parcel layer. Use the PID for assessor lookup.
        </div>
      </div>
    `;
  }

  async function loadRichardsonParcelsForCurrentView() {
    const map = mapRef.current;
    if (!map) return;

    const bounds = map.getBounds();
    const west = bounds.getWest();
    const south = bounds.getSouth();
    const east = bounds.getEast();
    const north = bounds.getNorth();

    const params = new URLSearchParams({
      where: '1=1',
      outFields: 'OBJECTID,PID,acres',
      returnGeometry: 'true',
      f: 'geojson',
      outSR: '4326',
      inSR: '4326',
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      geometry: `${west},${south},${east},${north}`,
      resultRecordCount: '500'
    });

    const url = `https://mapserver01.gworks.com/arcgis/rest/services/Richardson_County_NE_Assessor/MapServer/98/query?${params.toString()}`;

    setLocationError('Loading Richardson parcels only inside the current map view...');

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Richardson parcel request failed: ${response.status}`);
    }

    const geojson = await response.json();

    if (layersRef.current.richardsonParcels) {
      layersRef.current.richardsonParcels.remove();
      layersRef.current.richardsonParcels = null;
    }

    const layer = L.geoJSON(geojson, {
      style: {
        color: '#38bdf8',
        weight: 1.5,
        fillColor: '#0ea5e9',
        fillOpacity: 0.08
      },
      onEachFeature: (feature, parcelLayer) => {
        parcelLayer.bindPopup(buildRichardsonPopup(feature.properties ?? {}));
      }
    }).addTo(map);

    layersRef.current.richardsonParcels = layer;

    const count = geojson.features?.length ?? 0;
    setLocationError(`Loaded ${count} Richardson parcel(s) in this map view.`);
  }

  function zoomToRichardsonCounty() {
    const map = mapRef.current;
    if (!map) return;

    map.fitBounds([
      [39.98, -96.03],
      [40.27, -95.30]
    ]);
  }

  function zoomAndLoadRichardsonParcels() {
    const map = mapRef.current;
    if (!map) return;

    zoomToRichardsonCounty();

    setLocationError('Zooming to Richardson County. Loading parcels...');

    window.setTimeout(() => {
      loadRichardsonParcelsForCurrentView().catch((error) => {
        console.error(error);
        setLocationError(`Could not load Richardson parcels: ${error.message}`);
      });
    }, 900);
  }

  function clearRichardsonParcels() {
    if (layersRef.current.richardsonParcels) {
      layersRef.current.richardsonParcels.remove();
      layersRef.current.richardsonParcels = null;
      setLocationError('Richardson parcel layer cleared.');
    } else {
      setLocationError('No Richardson parcel layer is currently loaded.');
    }
  }

  async function toggleRichardsonParcels() {
    const map = mapRef.current;
    if (!map) return;

    if (layersRef.current.richardsonParcels) {
      layersRef.current.richardsonParcels.remove();
      layersRef.current.richardsonParcels = null;
      setLocationError('Richardson parcel layer turned off.');
      return;
    }

    try {
      await loadRichardsonParcelsForCurrentView();
    } catch (error) {
      console.error(error);
      setLocationError(`Could not load Richardson parcels: ${error.message}`);
    }
  }


  function ringAreaSqMeters(coords = []) {
    if (!coords.length) return 0;

    const radius = 6378137;
    let area = 0;

    for (let i = 0; i < coords.length; i += 1) {
      const [lon1, lat1] = coords[i];
      const [lon2, lat2] = coords[(i + 1) % coords.length];

      const lon1Rad = lon1 * Math.PI / 180;
      const lon2Rad = lon2 * Math.PI / 180;
      const lat1Rad = lat1 * Math.PI / 180;
      const lat2Rad = lat2 * Math.PI / 180;

      area += (lon2Rad - lon1Rad) * (2 + Math.sin(lat1Rad) + Math.sin(lat2Rad));
    }

    return Math.abs(area * radius * radius / 2);
  }

  function polygonAreaAcres(rings = []) {
    if (!rings.length) return 0;

    const outer = ringAreaSqMeters(rings[0]);
    const holes = rings.slice(1).reduce((sum, ring) => sum + ringAreaSqMeters(ring), 0);

    return (outer - holes) * 0.000247105;
  }

  function geometryAreaAcres(geometry) {
    if (!geometry) return 0;

    if (geometry.type === 'Polygon') {
      return polygonAreaAcres(geometry.coordinates);
    }

    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.reduce((sum, polygon) => sum + polygonAreaAcres(polygon), 0);
    }

    return 0;
  }

  function buildBoundaryPopup(feature = {}) {
    const props = feature.properties ?? {};
    const name =
      props.name ??
      props.NAME ??
      props.NAMELSAD ??
      props.label ??
      'Loaded reservation / tribal boundary';

    const acres = geometryAreaAcres(feature.geometry);

    return `
      <div class="parcel-popup">
        <div class="parcel-popup-title">Reservation / Tribal Boundary</div>
        <div class="parcel-popup-row">
          <span>Name</span>
          <strong>${String(name)}</strong>
        </div>
        <div class="parcel-popup-row">
          <span>Estimated acres from loaded map geometry</span>
          <strong>${acres ? acres.toLocaleString(undefined, { maximumFractionDigits: 1 }) : 'Not available'}</strong>
        </div>
        <div class="parcel-popup-note">
          Acreage is calculated from the loaded public boundary geometry. It should be treated as a field reference estimate, not a legal survey.
        </div>
      </div>
    `;
  }

  useEffect(() => {
    const boundaryLayer = layersRef.current.boundary;
    if (!boundaryLayer || !boundary) return;

    boundaryLayer.eachLayer((layer) => {
      if (layer.feature && layer.bindPopup) {
        layer.bindPopup(buildBoundaryPopup(layer.feature));
      }
    });
  }, [boundary, layerVisibility.boundary]);

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


        <div className="drawer-section legend-card">
          <h2>Map legend</h2>

          <div className="legend-grid">
            <button type="button" className={categoryVisibility.law ? 'legend-filter active' : 'legend-filter'} onClick={() => toggleCategory('law')}><span className="legend-icon marker-law">🛡</span><strong>Law Enforcement</strong></button>
            <button type="button" className={categoryVisibility.court ? 'legend-filter active' : 'legend-filter'} onClick={() => toggleCategory('court')}><span className="legend-icon marker-court">⚖</span><strong>Court</strong></button>
            <button type="button" className={categoryVisibility.gov ? 'legend-filter active' : 'legend-filter'} onClick={() => toggleCategory('gov')}><span className="legend-icon marker-gov">🏛</span><strong>Government</strong></button>
            <button type="button" className={categoryVisibility.business ? 'legend-filter active' : 'legend-filter'} onClick={() => toggleCategory('business')}><span className="legend-icon marker-business">🏢</span><strong>Business</strong></button>
            <button type="button" className={categoryVisibility.farm ? 'legend-filter active' : 'legend-filter'} onClick={() => toggleCategory('farm')}><span className="legend-icon marker-farm">🌾</span><strong>Farm / Ag</strong></button>
            <button type="button" className={categoryVisibility.place ? 'legend-filter active' : 'legend-filter'} onClick={() => toggleCategory('place')}><span className="legend-icon marker-place">📍</span><strong>Public Place</strong></button>
          </div>

          <div className="legend-lines">
            <div><span className="legend-line boundary"></span> Reservation boundary</div>
            <div><span className="legend-line state"></span> Kansas / Nebraska line</div>
          </div>
        </div>


        <div className="drawer-section parcel-source-card">
          <h2>County parcel sources</h2>
          <p className="muted">
            Verified parcel sources for the field map. Brown County remains external-only until a verified public parcel polygon API is found.
          </p>

          <div className="parcel-source-list">
            {countyParcelSources.map((county) => (
              <div className={`parcel-source-item status-${county.status}`} key={county.id}>
                <div className="parcel-source-header">
                  <div>
                    <strong>{county.name}, {county.state}</strong>
                    <span>{county.label}</span>
                  </div>
                  <em>
                    {county.status === 'direct_full'
                      ? 'Full'
                      : county.status === 'direct_partial'
                        ? 'Partial'
                        : 'External'}
                  </em>
                </div>

                <p>{county.notes}</p>

                {county.status === 'direct_full' ? (
                  <div className="parcel-capability good">
                    Parcel overlay and owner popup planned.
                  </div>
                ) : null}

                {county.status === 'direct_partial' ? (
                  <div className="parcel-capability partial">
                    Parcel overlay planned. Owner details open through assessor report.
                  </div>
                ) : null}

                {county.status === 'external_only' ? (
                  <div className="button-row parcel-actions">
                    <button type="button" onClick={() => openExternalParcelLink(county.officialViewerUrl)}>
                      Open ORKA
                    </button>
                    <button type="button" onClick={() => openExternalParcelLink(county.parcelSearchUrl)}>
                      Parcel Search
                    </button>
                  </div>
                ) : county.id === 'richardson-ne' ? (
                  <div className="button-row parcel-actions stacked-actions">
                    <button type="button" onClick={loadRichardsonParcelsForCurrentView}>
                      Load Richardson Parcels in Current View
                    </button>
                    <button type="button" onClick={clearRichardsonParcels}>
                      Clear Richardson Parcels
                    </button>
                  </div>
                ) : (
                  <div className="button-row parcel-actions">
                    <button type="button" disabled>
                      Doniphan Overlay Coming Next
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
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
                  onClick={() => applyBasemap(key)}
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
