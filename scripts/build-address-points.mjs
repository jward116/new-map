const sourceUrl = 'https://services.kansasgis.org/arcgis4/rest/services/NG911/NG911_AddressPoints/MapServer/0/query';

const params = new URLSearchParams({
  where: '1=1',
  outFields: '*',
  returnGeometry: 'true',
  f: 'geojson',
  outSR: '4326',
  inSR: '4326',
  geometryType: 'esriGeometryEnvelope',
  spatialRel: 'esriSpatialRelIntersects',
  geometry: '-95.50,39.90,-95.20,40.10',
  resultRecordCount: '2000'
});

const url = `${sourceUrl}?${params.toString()}`;

function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function classifyAddress(props) {
  const label = `${clean(props.LABEL)} ${clean(props.LMK)} ${clean(props.LOC)} ${clean(props.PLC)}`.toLowerCase();

  if (
    label.includes('casino') ||
    label.includes('office') ||
    label.includes('police') ||
    label.includes('court') ||
    label.includes('clinic') ||
    label.includes('school') ||
    label.includes('church') ||
    label.includes('fire')
  ) {
    return 'public_or_business';
  }

  return 'address';
}

console.log('Downloading Kansas NG911 address points near Iowa Tribe area...');
console.log(url);

const res = await fetch(url);

if (!res.ok) {
  throw new Error(`Kansas address request failed: ${res.status}`);
}

const geojson = await res.json();

if (geojson.error) {
  throw new Error(JSON.stringify(geojson.error));
}

const output = {
  type: 'FeatureCollection',
  name: 'Kansas public NG911 address points near Iowa Tribe area',
  source: 'Kansas NG911 public address points; filtered to a bounding box near the Iowa Tribe area. Address points are public reference data and should be field verified before operational reliance.',
  generatedAt: new Date().toISOString(),
  features: (geojson.features ?? []).map((feature) => {
    const props = feature.properties ?? {};
    const addressLabel = clean(props.LABEL);
    const city = clean(props.POSTCO || props.MSAGCO || props.MUNI);
    const zip = clean(props.ZIP);
    const county = clean(props.COUNTY);

    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        id: clean(props.NGKSADDID || props.NGADDID || props.OBJECTID),
        address: addressLabel,
        houseNumber: clean(props.HNO),
        roadName: clean(props.RD),
        roadType: clean(props.STS),
        city,
        county,
        state: clean(props.STATE || 'KS'),
        zip,
        label: addressLabel,
        locationType: clean(props.LOCTYPE),
        category: classifyAddress(props),
        source: 'Kansas NG911 public address points',
        verification_status: 'Public address point - needs field verification',
        original: props
      }
    };
  })
};

await import('node:fs/promises').then(fs =>
  fs.writeFile('public/data/address-points.geojson', JSON.stringify(output, null, 2) + '\n')
);

console.log(`Saved ${output.features.length} address point(s) to public/data/address-points.geojson`);
