# ITKN Field Map Starter

This is a working GitHub/Codespaces/Vite/React/Leaflet starter for a field map that works on desktop and phone once hosted over HTTPS.

## What it does now

- Shows an interactive mobile-friendly map.
- Tracks your current location with the browser/device GPS permission.
- Shows an accuracy circle.
- Checks whether the GPS point or clicked map point is inside the loaded reservation boundary.
- Shows Kansas/Nebraska side based on the loaded state-line layer.
- Shows tribal places, businesses, facilities, gate/contact points, and notes from a GeoJSON file.
- Gives parcel/assessor links for Brown, Doniphan, Richardson, and Nemaha County sources.
- Deploys to GitHub Pages with GitHub Actions.

## Important warning

The files inside `public/data` are demo starter data so the app runs immediately. They are not legal/official GIS data. Replace these before using the app operationally:

- `public/data/reservation-boundary.geojson`
- `public/data/state-line.geojson`
- `public/data/tribal-places.geojson`
- `public/data/parcel-sources.json`

## Run in GitHub Codespaces

1. Create a new GitHub repository.
2. Upload/copy these files into the repository.
3. Click `Code` → `Codespaces` → `Create codespace on main`.
4. In the Codespaces terminal, run:

```bash
npm install
npm run dev
```

5. When GitHub shows the forwarded port popup, click **Open in Browser**.
6. Click **Start location tracking** and allow location permission.

## Deploy to GitHub Pages

1. Push the app to the `main` branch.
2. Go to your repo: `Settings` → `Pages`.
3. Under **Build and deployment**, choose **GitHub Actions**.
4. Go to the **Actions** tab and run or wait for `Deploy to GitHub Pages`.
5. Open the deployed link on your phone. GitHub Pages uses HTTPS, which is needed for browser geolocation.

## Data format: tribal places

Edit `public/data/tribal-places.geojson`. Add points like this:

```json
{
  "type": "Feature",
  "properties": {
    "name": "Example Gate",
    "type": "Gate / Pasture",
    "phone": "555-555-5555",
    "notes": "Call landowner before entering. Gate code stored elsewhere, not in public app.",
    "data_quality": "VERIFIED_BY_DEPARTMENT"
  },
  "geometry": { "type": "Point", "coordinates": [-95.300000, 40.000000] }
}
```

GeoJSON coordinates are always `[longitude, latitude]`, not `[latitude, longitude]`.

## Getting the official boundary data

Best sources to ask for or download:

1. Tribe's GIS/person who manages land records.
2. BIA / LTRO / official trust land or reservation boundary file.
3. U.S. Census cartographic boundary files for American Indian/Alaska Native/Hawaiian Home Lands.
4. County GIS parcel exports for Brown KS, Doniphan KS, Richardson NE, and any surrounding counties you need.

For operational use, do not rely on a hand-drawn or guessed polygon.

## Parcel layer reality

County parcel systems are often public to view but not always public as an API or downloadable GeoJSON. If the public GIS service blocks direct app access, the correct path is:

- Ask the county appraiser/assessor/GIS office for a parcel export or API permission.
- Use a paid parcel provider like Regrid/Acres only if the department approves it.
- Keep parcel polygons in a local GeoJSON file if you need offline/fast field use.

## Why this is built as a static web app

This version does not require paid hosting, a database, or an API key. It can be hosted with GitHub Pages. That means it is easier to get working on both phones and computers. Later, you can add a backend if you need live parcel queries, officer-only login, or secure non-public notes.
