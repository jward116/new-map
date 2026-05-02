# Iowa Tribe Field Map - GIS Source Plan

## Purpose

This file controls the parcel/GIS plan for the Iowa Tribe field map.

Goal:
- Show Iowa Tribe boundary / relevant tribal area
- Show county parcel layers where publicly feasible
- Show owner/parcel info where publicly available
- Use GPS location
- Use clear mobile/desktop layer controls
- Avoid fake or guessed parcel data

Core counties:
- Brown County, Kansas
- Doniphan County, Kansas
- Richardson County, Nebraska

---

# County Source Status

## 1. Doniphan County, Kansas

### Status
FEASIBLE for direct parcel integration.

### Known public source
Doniphan County public Geocortex parcel layer:

https://dadegis.integritygis.com/Geocortex/Essentials/REST/sites/Doniphan_County_KS/map/mapservices/3/layers/11

### Layer info
- Layer name: Parcel
- Layer ID: 11
- Feature type: Polygon
- Display field: PartyName
- Queryable: Yes
- Identifiable: Yes
- Searchable: Yes

### Useful fields
- PID
- QuickRefID
- TaxID
- PartyName
- AllOwners
- PartyAddress
- SitusAddress
- LegalDescription
- CalcAcres
- FinalLand
- FinalBuild
- FinalTotal
- TAX
- Acres
- PropertyID

### App plan
Use this as the first full parcel integration.

Expected behavior:
- Turn on Doniphan parcels layer
- Click parcel
- Show owner name, parcel ID, situs address, acres, legal description, and values
- If direct browser request fails due to CORS, use a lightweight proxy

### Risk
The raw ArcGIS service behind Integrity may require login/token. Use public Geocortex route first.

---

## 2. Richardson County, Nebraska

### Status
PARTIALLY FEASIBLE.

Parcel boundaries are feasible.
Full owner popup is not confirmed directly from the GIS layer.

### Known public source
Richardson County gWorks ArcGIS REST service:

https://mapserver01.gworks.com/arcgis/rest/services/Richardson_County_NE_Assessor/MapServer

Parcel layer:

https://mapserver01.gworks.com/arcgis/rest/services/Richardson_County_NE_Assessor/MapServer/98

### Layer info
- Layer name: Parcels
- Layer ID: 98
- Geometry: Polygon
- Supported query formats: JSON, geoJSON
- Supported operation: Query

### Fields confirmed
- OBJECTID
- acres
- PID
- Shape
- GlobalID
- Shape.STArea()
- Shape.STLength()

### Owner/detail workaround
The GIS layer appears to expose parcel boundary, PID, and acres only.

Use PID to open gWorks or Beacon/assessor report.

Potential report pattern:

https://report.gworks.com/report.ashx?county=richardson&id=PARCEL_ID_HERE&subs=true&type=assessor

### App plan
Stage 1:
- Turn on Richardson parcels layer
- Click parcel
- Show PID and acres

Stage 2:
- Add button: Open Richardson assessor report
- Use PID in report URL

Stage 3 later:
- If allowed/possible, use proxy to fetch/parse owner info into in-app popup

### Risk
Owner name, situs address, legal description, and values are not directly exposed in the parcel layer.

---

## 3. Brown County, Kansas

### Status
NOT FEASIBLE AS REQUESTED YET for direct in-app parcel overlay with owner popup.

Brown County is important, but we do not yet have a verified public parcel polygon API.

### Known public sources

Official Brown County GIS page:
https://www.brcoks.org/1213/Brown-County-GIS-Mapping

Brown ORKA property ownership map:
https://www.kansasgis.org/orka/intro.cfm?countyName=brown

Brown KansasGov parcel search:
https://brown.kansasgov.com/parcel/

ORKA Extras ArcGIS service:
https://services.kgs.ku.edu/arcgis/rest/services/ORKA/KS_ORKA_Extras/MapServer

### What is verified
- Brown County uses ORKA for public GIS mapping
- Brown ORKA is a public property ownership map
- Brown KansasGov parcel search allows property searches
- ORKA Extras has address/annotation/support layers

### What is not verified
- Clean Brown parcel polygon REST layer
- Owner fields through public GIS API
- Click-to-identify parcel owner data through a public API
- Browser-usable GeoJSON/FeatureServer parcel layer

### App plan for now
Do not fake Brown parcel overlay.

Use:
- Button: Open Brown ORKA
- Button: Open Brown parcel search

Keep researching:
- ORKA hidden service URLs
- Browser Network requests after accepting ORKA disclaimer
- DASC/KGS downloadable county parcel export
- PORKA/ORKA data request route
- Paid fallback provider only if public source fails

### Possible workaround path
If we can find Brown parcel geometry with Parcel ID / Quick Ref ID:
- Use geometry layer for boundaries
- Use Parcel ID / Quick Ref ID to cross-reference Brown KansasGov search

### Risk
Brown may require ORKA/PORKA data access, manual export, or a third-party parcel data provider.

---

# Development Order

Do not code all counties at once.

## Phase 1
Create source test scripts:
- Test Doniphan query
- Test Richardson query
- Test Brown ORKA service availability

## Phase 2
Build Doniphan integration:
- Parcel overlay
- Click-to-identify
- Owner/address/value popup

## Phase 3
Build Richardson integration:
- Parcel overlay
- Click-to-identify PID/acres
- Button to open assessor report by PID

## Phase 4
Brown workaround:
- Add Brown ORKA button
- Add Brown KansasGov parcel search button
- Do not show Brown overlay until parcel geometry is verified

## Phase 5
Brown deeper research:
- Inspect ORKA Network traffic
- Search for hidden parcel service
- Investigate downloadable parcel data
- Consider paid parcel dataset only if needed

---

# Rule

If a county does not have a verified public parcel layer, the app must say:

"Parcel overlay not available from verified public source. Open official county viewer."

Do not guess parcel boundaries.
Do not use outdated screenshots as parcel data.
Do not claim owner info unless it comes from a verified source.

---

# Test Results - Codespaces Public Endpoint Check

## Doniphan County KS

Confirmed public Geocortex parcel layer fields:
- PID
- TaxID
- QuickRefID
- PartyName
- AllOwners
- SitusAddress
- LegalDescription
- CalcAcres
- FinalTotal
- Acres
- GIS_ACRES

Decision:
Doniphan is confirmed for full parcel integration.

## Richardson County NE

Confirmed public ArcGIS parcel fields:
- OBJECTID
- acres
- PID
- GlobalID

Sample query returned:
- PID: 740000209
- acres: 80.90994

Decision:
Richardson is confirmed for parcel boundary + PID/acres integration.
Owner details should be opened through gWorks/assessor report lookup by PID.

## Brown County KS

ORKA Extras returned parcel-related support/annotation layers:
- Address Points
- Annotations
- BB- Acreage
- BB- Parcel Dimensions
- BB- Parcel Numbers
- Parcel Number 1200
- Parcel Number 2400
- Parcel Number 4800
- CR- Parcel Numbers
- JW- Parcel Annotation
- NM- Parcel Annotation

Decision:
Brown still does not have a confirmed clean public parcel polygon layer with owner fields.
Continue deeper ORKA hidden-service research before coding Brown overlay.

---

# Brown County KS False Lead Rejected

A public ArcGIS FeatureServer named "Parcels" with layer "BROWN-COUNTY" was tested:

https://services3.arcgis.com/3Zd7D4Itq19bMuuV/ArcGIS/rest/services/Parcels/FeatureServer/0

Result:
- It returned parcel-style fields such as PARCELNUMB, LASTFIRST, ADDRESS, ACREAGE.
- However, the GeoJSON sample returned coordinates around longitude -83.898 and latitude 38.860.
- Brown County, Kansas should be around longitude -95, not -83.

Decision:
This service is NOT Brown County, Kansas.
Do not use it in the Iowa Tribe field map.

Brown County KS remains unresolved for direct parcel polygon API.
Continue researching ORKA/KGS/DASC/PORKA or downloadable parcel data.

---

# Brown County KS ORKA Deep Check Result

A deeper check of the Kansas ORKA Extras MapServer found useful support layers, but not a verified Brown County KS ownership parcel polygon layer.

Relevant ORKA layers found:
- Ag-use polygon layers
- Flood boundary layers
- Water feature layers
- Soils
- City limits
- Leaseholds / condos
- County boundaries
- Annotation layers such as parcel numbers and parcel dimensions

Important finding:
The parcel-related ORKA layers found for Brown/other counties are annotation/support layers, not confirmed parcel ownership polygon layers with owner/address fields.

Decision:
Brown County KS direct parcel overlay remains NOT FEASIBLE AS REQUESTED from verified free public API at this time.

Brown County app plan:
- Add "Open Brown ORKA" button
- Add "Open Brown Parcel Search" button
- Do not show Brown parcel overlay until a real Brown KS parcel polygon API, export, or paid dataset is available

Possible future options:
- Inspect ORKA browser Network traffic after accepting the ORKA disclaimer
- Request parcel GIS export through ORKA/PORKA/KGS/DASC
- Use a paid parcel dataset if the department needs direct Brown overlay in-app
