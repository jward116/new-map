const sources = [
  {
    name: 'BIA Land Area Representations - Iowa name search',
    url: "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/BND___Bureau_of_Indian_Affairs_Tribal_Boundaries___Areas__DOI_/FeatureServer/4/query?where=UPPER(LARName)%20LIKE%20%27%25IOWA%25%27&outFields=*&returnGeometry=false&f=json"
  },
  {
    name: 'BIA Land Area Representations - Iowa GeoJSON sample',
    url: "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/BND___Bureau_of_Indian_Affairs_Tribal_Boundaries___Areas__DOI_/FeatureServer/4/query?where=UPPER(LARName)%20LIKE%20%27%25IOWA%25%27&outFields=*&returnGeometry=true&outSR=4326&f=geojson"
  }
];

for (const source of sources) {
  console.log('\n============================================================');
  console.log(source.name);
  console.log(source.url);
  console.log('------------------------------------------------------------');

  try {
    const res = await fetch(source.url);
    console.log(`HTTP: ${res.status} ${res.statusText}`);
    console.log(`Content-Type: ${res.headers.get('content-type')}`);

    const text = await res.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      console.log('Not JSON. First 1000 chars:');
      console.log(text.slice(0, 1000));
      continue;
    }

    if (json.error) {
      console.log('ERROR:');
      console.log(JSON.stringify(json.error, null, 2));
      continue;
    }

    const features = json.features ?? [];
    console.log(`Feature count returned: ${features.length}`);

    for (const feature of features.slice(0, 10)) {
      const props = feature.attributes ?? feature.properties ?? {};
      console.log('---');
      console.log(JSON.stringify(props, null, 2).slice(0, 1500));
    }

    if (json.type === 'FeatureCollection') {
      console.log('GeoJSON returned.');
      console.log(`Has geometry: ${Boolean(features[0]?.geometry)}`);
    }
  } catch (err) {
    console.log('REQUEST FAILED:');
    console.log(err.message);
  }
}
