const sources = [
  {
    id: 'ks-ng911-address-points',
    name: 'Kansas NG911 Address Points - tribal area box',
    url: 'https://services.kgs.ku.edu/arcgis4/rest/services/NG911/NG911/MapServer/0/query',
    box: {
      west: -95.50,
      south: 39.90,
      east: -95.20,
      north: 40.10
    }
  },
  {
    id: 'ks-ng911-address-points-alt',
    name: 'Kansas NG911 AddressPoints service - tribal area box',
    url: 'https://services.kansasgis.org/arcgis4/rest/services/NG911/NG911_AddressPoints/MapServer/0/query',
    box: {
      west: -95.50,
      south: 39.90,
      east: -95.20,
      north: 40.10
    }
  },
  {
    id: 'ne-ng911-address-points',
    name: 'Nebraska NG911 Address Points - Richardson tribal-side box',
    url: 'https://giscat.ne.gov/enterprise/rest/services/Address_Points/MapServer/0/query',
    box: {
      west: -95.55,
      south: 39.95,
      east: -95.25,
      north: 40.18
    }
  }
];

function buildQueryUrl(source, returnGeometry = false, countOnly = false) {
  const { west, south, east, north } = source.box;

  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    returnGeometry: String(returnGeometry),
    f: returnGeometry ? 'geojson' : 'json',
    outSR: '4326',
    inSR: '4326',
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    geometry: `${west},${south},${east},${north}`,
    resultRecordCount: '10'
  });

  if (countOnly) {
    params.set('returnCountOnly', 'true');
    params.set('f', 'json');
    params.delete('outFields');
    params.delete('returnGeometry');
    params.delete('resultRecordCount');
  }

  return `${source.url}?${params.toString()}`;
}

function getFeatureProperties(feature) {
  return feature?.attributes ?? feature?.properties ?? {};
}

async function testSource(source) {
  console.log('\n============================================================');
  console.log(source.name);
  console.log(`Box: ${source.box.west}, ${source.box.south}, ${source.box.east}, ${source.box.north}`);
  console.log('------------------------------------------------------------');

  try {
    const countUrl = buildQueryUrl(source, false, true);
    const countRes = await fetch(countUrl);
    const countText = await countRes.text();

    console.log(`Count HTTP: ${countRes.status} ${countRes.statusText}`);
    console.log(`Count response preview: ${countText.slice(0, 300)}`);

    let countJson = null;
    try {
      countJson = JSON.parse(countText);
    } catch {
      console.log('Count response was not JSON.');
    }

    if (countJson?.error) {
      console.log('Count error:');
      console.log(JSON.stringify(countJson.error, null, 2));
      return;
    }

    console.log(`Address count: ${countJson?.count ?? 'unknown'}`);

    const sampleUrl = buildQueryUrl(source, false, false);
    const sampleRes = await fetch(sampleUrl);
    const sampleText = await sampleRes.text();

    console.log(`Sample HTTP: ${sampleRes.status} ${sampleRes.statusText}`);

    let sampleJson = null;
    try {
      sampleJson = JSON.parse(sampleText);
    } catch {
      console.log('Sample response was not JSON.');
      console.log(sampleText.slice(0, 1000));
      return;
    }

    if (sampleJson?.error) {
      console.log('Sample error:');
      console.log(JSON.stringify(sampleJson.error, null, 2));
      return;
    }

    const features = sampleJson.features ?? [];
    console.log(`Sample features returned: ${features.length}`);

    if (features.length) {
      const props = getFeatureProperties(features[0]);
      console.log('First address properties:');
      console.log(JSON.stringify(props, null, 2).slice(0, 2500));
      console.log('Field names:');
      console.log(Object.keys(props).join(', '));
    }

    const geoUrl = buildQueryUrl(source, true, false);
    const geoRes = await fetch(geoUrl);
    const geoText = await geoRes.text();

    console.log(`GeoJSON HTTP: ${geoRes.status} ${geoRes.statusText}`);
    console.log(`GeoJSON preview: ${geoText.slice(0, 500)}`);
  } catch (error) {
    console.log('REQUEST FAILED:');
    console.log(error.message);
  }
}

console.log('ADDRESS POINT SOURCE TEST');
console.log('Testing Kansas and Nebraska public address point services near Iowa Tribe area.');

for (const source of sources) {
  await testSource(source);
}

console.log('\nDONE');
