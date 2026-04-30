import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'public', 'data');
const BOUNDARY_FILE = path.join(OUT_DIR, 'reservation-boundary.geojson');
const PARCEL_FILE = path.join(OUT_DIR, 'parcel-sources.json');
const NOTES_FILE = path.join(OUT_DIR, 'source-notes.json');

const PUBLIC_AIANNH_LAYER_URL = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TribalIndianLands_01/MapServer/0/query';
const WHERE_CLAUSES = ["NAME LIKE '%Iowa%'", "NAMELSAD LIKE '%Iowa%'"];
const ITKN_SEARCH_BOX = { minLon: -96.2, minLat: 39.55, maxLon: -94.75, maxLat: 40.45 };

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

async function fetchBoundaryCandidate(where) {
  const params = new URLSearchParams({
    where,
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson'
  });
  const url = `${PUBLIC_AIANNH_LAYER_URL}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function downloadBoundary() {
  const errors = [];

  for (const where of WHERE_CLAUSES) {
    try {
      const data = await fetchBoundaryCandidate(where);
      const matches = (data.features || []).filter((feature) => {
        const p = feature.properties || {};
        const name = `${p.NAME || ''} ${p.NAMELSAD || ''}`.toLowerCase();
        return name.includes('iowa') && boxesIntersect(getBBox(feature), ITKN_SEARCH_BOX);
      });

      if (!matches.length) {
        errors.push(`${where}: no KS/NE Iowa match`);
        continue;
      }

      const out = {
        type: 'FeatureCollection',
        name: 'Iowa Reservation boundary from public AIANNH GIS service',
        source: 'USFS/USDA ArcGIS REST service using Census TIGER/Line AIANNH data',
        downloadedAt: new Date().toISOString(),
        features: matches.map((feature) => ({
          ...feature,
          properties: {
            ...(feature.properties || {}),
            name: feature.properties?.NAMELSAD || feature.properties?.NAME || 'Iowa Reservation',
            source: 'Public AIANNH GIS service based on U.S. Census TIGER/Line data',
            data_quality: 'PUBLIC_AIANNH_REFERENCE',
            warning: 'Public reference boundary. Use for field awareness; replace with approved local data when available.'
          }
        }))
      };

      await fs.writeFile(BOUNDARY_FILE, JSON.stringify(out, null, 2));
      console.log(`Saved ${matches.length} boundary feature(s) to ${BOUNDARY_FILE}`);
      return;
    } catch (err) {
      errors.push(`${where}: ${err.message}`);
    }
  }

  throw new Error(`Could not download ITKN boundary. ${errors.join(' | ')}`);
}

async function writeParcelSources() {
  const sources = [
    {
      name: 'Brown County, Kansas - ORKA / GIS Mapping',
      state: 'KS',
      county: 'Brown',
      url: 'https://www.brcoks.org/1213/Brown-County-GIS-Mapping',
      notes: 'Public county GIS/ORKA page. Free public mapping system according to Brown County.'
    },
    {
      name: 'Doniphan County, Kansas - Integrity GIS',
      state: 'KS',
      county: 'Doniphan',
      url: 'https://doniphan.integritygis.com/',
      notes: 'Official county-linked public GIS/property mapping source.'
    },
    {
      name: 'Richardson County, Nebraska - Assessor Parcel Search',
      state: 'NE',
      county: 'Richardson',
      url: 'https://nebraskaassessorsonline.us/search.aspx?county=Richardson',
      notes: 'Public property search for Richardson County assessor records.'
    },
    {
      name: 'Nebraska Department of Revenue - County Assessors and Parcel Search',
      state: 'NE',
      county: 'Statewide',
      url: 'https://revenue.nebraska.gov/PAD/county-assessors-and-parcel-search',
      notes: 'State directory for assessor and parcel search links.'
    }
  ];
  await fs.writeFile(PARCEL_FILE, JSON.stringify(sources, null, 2));
  console.log(`Saved parcel source links to ${PARCEL_FILE}`);
}

async function writeSourceNotes() {
  const notes = {
    updatedAt: new Date().toISOString(),
    boundary: 'Public AIANNH reference boundary from USFS/USDA ArcGIS REST service using Census TIGER/Line data.',
    parcels: 'County parcel data is linked out instead of stored in GitHub because full parcel layers are large and may require county-specific terms or services.',
    workflow: 'Run npm run sync:data, review public/data/*.json and *.geojson, then commit the files.'
  };
  await fs.writeFile(NOTES_FILE, JSON.stringify(notes, null, 2));
  console.log(`Saved source notes to ${NOTES_FILE}`);
}

await fs.mkdir(OUT_DIR, { recursive: true });
await downloadBoundary();
await writeParcelSources();
await writeSourceNotes();
