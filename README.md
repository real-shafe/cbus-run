# Arch City Run

A lane-runner on a longboard through 2.3 miles of real Columbus, Ohio: down North High Street
under the 17 Short North arches, over the I-670 cap, through downtown past the Statehouse, then
west on Broad Street across the Scioto to the finish line at COSI.

The city is not hand-modelled. `tools/build-city.mjs` fuses three open datasets into
`public/data/city.json`, and the browser builds the 3D scene from that file at load:

| What | Source |
| --- | --- |
| Streets, the route, cross-street names, 6,100 building footprints and 3D building parts, the arch positions, 3,800 trees with species, bus stops, signals, rail, river | OpenStreetMap (Overpass API), © OpenStreetMap contributors, ODbL |
| Building heights where OSM has none (about 3,700 buildings) | FEMA / ORNL USA Structures, lidar-derived `HEIGHT` |
| Terrain: the river valley, the I-670 and rail trenches, the grade of High Street | USGS 3DEP elevation (ImageServer export, about 4 m cells) |

What is real: every street centreline and width, every building footprint and (where known) height,
tree positions and genus (which sets the autumn colour), the arches, bus stops (the stopped buses
wait at real stops), traffic-signal intersections and their street-name signs, bridges, the river.
What is invented: facades and window patterns, the traffic and construction clutter, the buckeyes.

## Play

Arrow keys or A/D change lanes, Space or Up jumps, Down ducks, P pauses, M mutes.
On a phone: swipe to change lanes, swipe up or tap to jump, swipe down to duck.

## Run locally

    python3 -m http.server 8811 -d public

No build step. three.js r170 is vendored in `public/vendor/`.

## Rebuild the city data

Raw downloads live in `tools/cache/` (not committed): `osm.json` (Overpass query for the bounding
box 39.953,-83.016 to 39.991,-82.990), `structs-*.json` (USA Structures feature service, same box),
`dem.tif` (3DEP `exportImage`, float32 GeoTIFF, 640x896). Then:

    node tools/build-city.mjs

To move the route, change the start/end points and `ROUTE_NAMES` near the top of that script.

`tools/shot.mjs` and `tools/audit.mjs` are dev helpers (headless screenshots, layout audit); they
borrow `playwright-core` from a sibling project. `?bot=1&auto=1` lets a test pilot skate the route.
