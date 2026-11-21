# Arch City Run

**Play it at https://cbus-run.shafe.dev**

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

- Keyboard: arrow keys or A/D change lanes, Space, Up or W jumps, Down or S ducks, P or Esc pauses,
  M mutes, R or Enter rides again from the results card.
- Phone: one swipe left or right moves one lane, swipe up or tap to jump, swipe down to duck.
- The run pauses by itself when the tab or window loses focus.

## Run locally

    python3 -m http.server 8811 -d public

No build step and no packages. three.js r170 is vendored in `public/vendor/`.
`public/js/main.js` boots the app shell in `public/js/app/` (input, flow, HUD, camera, quality,
sound); `world.js` builds the city, `game.js` runs the skater, course and traffic.

## Deploy

`public/` is served by a static-assets Cloudflare Worker (`wrangler.jsonc`) at cbus-run.shafe.dev:

    wrangler deploy

## Rebuild the city data

Raw downloads live in `tools/cache/` (not committed): `osm.json` (Overpass query for the bounding
box 39.953,-83.016 to 39.991,-82.990), `structs-*.json` (USA Structures feature service, same box),
`dem.tif` (3DEP `exportImage`, float32 GeoTIFF, 640x896). Then:

    node tools/build-city.mjs

To move the route, change the start/end points and `ROUTE_NAMES` near the top of that script.

## Dev tools

They drive headless Chrome with `playwright-core` borrowed from the sibling `arabic-sound-lab`
checkout (see `tools/drive.mjs`); nothing is installed here.

- `node tools/flowtest.mjs <url> --score=392827` — regression test of input, flow, focus, quality
  and scoring (the score is what the test pilot makes on a fixed-step run).
- `node tools/audit.mjs <outDir> <url>` — layout, focus and touch audit at seven screen sizes.
- `node tools/shot.mjs <outDir> '<json steps>'` — scripted screenshots.
- URL flags: `?bot=1&auto=1` lets a test pilot skate the route, `&ts=4` runs it 4x fast,
  `?q=low|mid|high` pins the quality tier, `?stats=1` shows frame stats.

## Licence

Code: MIT (see `LICENSE`). three.js: MIT (`public/vendor/three.LICENSE`).
`public/data/city.json` is derived from OpenStreetMap and is available under the
[Open Database License](https://opendatacommons.org/licenses/odbl/), © OpenStreetMap contributors;
it also carries USGS 3DEP and FEMA / ORNL USA Structures values (US government open data).
