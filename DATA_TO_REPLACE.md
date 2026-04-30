# Data you need to collect so this app is reliable

## 1. Official reservation boundary

Needed file: `public/data/reservation-boundary.geojson`

Best sources:

- ITKN internal GIS / land office / land records person.
- BIA / LTRO / official trust land boundary data.
- U.S. Census TIGER/Cartographic Boundary files for American Indian/Alaska Native/Hawaiian Home Lands.

Ask for one of these formats:

- GeoJSON preferred.
- KML is okay; convert to GeoJSON.
- Shapefile is okay; convert to GeoJSON.

## 2. State line / county line data

Needed file: `public/data/state-line.geojson`

For better county answers, add a future `public/data/counties.geojson` containing Brown, Doniphan, Richardson, and Nemaha county polygons.

## 3. Tribal properties, businesses, housing, gates, pasture contacts

Needed file: `public/data/tribal-places.geojson`

Recommended fields:

- name
- type
- phone
- notes
- department_contact
- verified_by
- verified_date
- data_quality

Do not put sensitive information into a public GitHub Pages app. If the repo/site is public, gate codes, confidential addresses, and law-enforcement-sensitive notes should not be stored here.

## 4. Parcels

The app can open official parcel viewers now. To show parcel boundaries directly inside the app, you need one of these:

- official county parcel GeoJSON export;
- public ArcGIS REST FeatureServer/MapServer that allows browser access;
- approved paid parcel data source;
- department-maintained parcel file.

Counties/sources to verify:

- Brown County, Kansas: ORKA / Brown County GIS Mapping.
- Doniphan County, Kansas: county appraiser/GIS source.
- Richardson County, Nebraska: Nebraska DOR lists Schneider/Beacon parcel search.
- Nemaha County, Nebraska: assessor/parcel search if you need nearby support.

## 5. Deployment/permissions

To make GPS work on phones, host the app over HTTPS. GitHub Pages is fine for the public-safe version.

For private/secure information, do not use a public repository or public GitHub Pages site. Use a private repo plus controlled hosting, or wait until a login/backend version is built.
