/**
 * MCAD task specs — 10 dimensioned mechanical parts adopted from the MIT-licensed
 * text-to-cad benchmark set (github.com/earthtojake/text-to-cad, `benchmarks/`).
 *
 * Upstream ships each part as a prompt plus a human checklist ("four through-holes,
 * 8 mm each; no floating gussets") with NO grader. This file is the machine-checkable
 * form: every assertion below is derivable in closed form from the upstream prompt,
 * and every derivation is shown in a comment beside its number. An assertion that
 * cannot be derived in closed form is OMITTED, never guessed — the judge only
 * asserts what the prompt actually pins.
 *
 * FORMAT DEVIATION, stated once: upstream asks for STEP export. The v1 judge
 * compiles OpenSCAD and grades the STL mesh (same judge deps as `cad-design`);
 * OpenSCAD cannot emit STEP. The geometric content of every check is preserved;
 * the "STEP imports" row is replaced by "compiles + watertight". Tasks keep the
 * upstream dimensional text verbatim inside an OpenSCAD-deliverable wrapper.
 *
 * Probes are the hole/pocket checks: a point the finished solid must NOT contain
 * (inside a hole bore) or MUST contain (in the surrounding material). Locations
 * come from the prompt's own dimensions, with clearance chosen so a hole that is
 * missing, misplaced by more than ~1 mm, or wrong in diameter by more than ~1 mm
 * flips at least one probe.
 */

export interface McadSpec {
  /** Overall axis-aligned extents in mm, [min, max] per axis. */
  bbox?: { x?: [number, number]; y?: [number, number]; z?: [number, number] }
  /** Enclosed mesh volume band in mm^3 — closed-form only, derivation in a comment. */
  volume?: [number, number]
  /** Disconnected-solid count band (fused parts must read as ONE solid). */
  solids?: [number, number]
  /** Triangle floor — rejects degenerate single-box answers where relevant. */
  minTriangles?: number
  /** Points (mm) that must test INSIDE the solid (material present). */
  probesInsideSolid?: Array<[number, number, number]>
  /** Points (mm) that must test OUTSIDE the solid (hole/pocket/clearance present). */
  probesOutsideSolid?: Array<[number, number, number]>
}

export interface McadTask {
  id: string
  /** Upstream dimensional brief, verbatim, wrapped for the OpenSCAD deliverable. */
  prompt: string
  spec: McadSpec
  /** Upstream file this was adopted from. */
  source: string
  /** False when the spec has no verified gold yet — the judge still runs, but the
   *  accept direction is uncalibrated and the loader surfaces that in metadata. */
  calibrated: boolean
}

/** Exported so a sibling adapter can SWAP this preamble for its own deliverable
 *  (see `mcad-cq-bench.ts`) by prefix, instead of re-authoring ten prompts and
 *  letting the two copies drift. The upstream dimensional text stays the tail. */
export const MCAD_DELIVERABLE =
  'Author OpenSCAD source (units: mm) that builds exactly this part as one fused solid. ' +
  'Reply with ONLY the OpenSCAD code. Use $fn=96 or finer for round features.'

const DELIVERABLE = MCAD_DELIVERABLE

/** Task 10 is an ASSEMBLY, not a part: its own text says "use separate solid bodies"
 *  and its checklist pins nine of them, which the single-solid boilerplate above
 *  flatly contradicts. A worker cannot satisfy both, so that task gets this
 *  preamble instead; everything else about the deliverable is unchanged. */
export const MCAD_DELIVERABLE_MULTIBODY =
  'Author OpenSCAD source (units: mm) that builds exactly this assembly as the separate ' +
  'solid bodies listed below. The bodies must stay disjoint — no two of them may touch or ' +
  'intersect. Reply with ONLY the OpenSCAD code. Use $fn=96 or finer for round features.'

const DELIVERABLE_MULTIBODY = MCAD_DELIVERABLE_MULTIBODY

export const MCAD_TASKS: McadTask[] = [
  {
    id: 'calibration-block',
    source: 'benchmarks/01-rectangular-calibration-block.md',
    calibrated: true,
    prompt:
      `${DELIVERABLE}\n\n` +
      'The part is a rectangular block, 100 mm long in X, 60 mm wide in Y, and 20 mm tall in Z. ' +
      'Center the block on the XY origin, with the bottom face at Z = 0. ' +
      'Add four vertical through-holes, each 8 mm in diameter, located at X = +/-35 mm and Y = +/-20 mm. ' +
      'Add a 2 mm chamfer to the top perimeter edges only. Do not chamfer the holes.',
    spec: {
      bbox: { x: [99, 101], y: [59, 61], z: [19, 21] },
      // block 100*60*20 = 120000; holes 4 * pi * 4^2 * 20 = 4021.2;
      // top-perimeter 2 mm chamfer ~ (2*2/2) * perimeter(320) - corners ~ 620..640.
      // exact-ish 115340; band allows +-1% modelling slack but excludes
      // no-chamfer (115979) ONLY via the upper edge staying below it? No -
      // 115979 is within 1%; the chamfer is NOT volume-separable at this size,
      // so the band checks holes+block and the chamfer stays unasserted.
      volume: [113_000, 117_000],
      solids: [1, 1],
      probesInsideSolid: [
        [0, 0, 10], // core material between the holes
        [48, 28, 10], // corner material
        [35, 20 + 5.5, 10], // 5.5 mm off a hole center: outside an 8 mm bore, inside the block
      ],
      probesOutsideSolid: [
        [35, 20, 10], // each 8 mm bore, probed at mid-depth
        [-35, 20, 10],
        [35, -20, 10],
        [-35, -20, 10],
        [35, 20 + 3.0, 10], // 3.0 mm off center: still inside a 4 mm-radius bore
      ],
    },
  },
  {
    id: 'circular-flange',
    source: 'benchmarks/02-circular-flange.md',
    calibrated: true,
    prompt:
      `${DELIVERABLE}\n\n` +
      'The flange is a cylinder with an outside diameter of 80 mm and a thickness of 10 mm. ' +
      'Its axis is vertical along Z, with the bottom face at Z = 0 and the center at X = 0, Y = 0. ' +
      'Add a central vertical through-bore with diameter 30 mm. ' +
      'Add six equally spaced vertical through-holes, each 6 mm in diameter, on a 60 mm bolt-circle diameter. ' +
      'Add a 1.5 mm fillet to the top and bottom outside circular edges.',
    spec: {
      // OD 80 -> radius 40; thickness 10.
      bbox: { x: [79, 81], y: [79, 81], z: [9, 11] },
      // cylinder pi*40^2*10 = 50265.48; central bore pi*15^2*10 = 7068.58;
      // 6 bolt holes 6*pi*3^2*10 = 1696.46; net 41500.44.
      // top+bottom 1.5 mm fillet on the OD removes ~2*(1-pi/4)*1.5^2*(pi*80)
      // = ~242.7 (0.6%), well inside a +-3% band, so it stays unasserted here.
      volume: [40_250, 42_750],
      solids: [1, 1],
      minTriangles: 100,
      probesInsideSolid: [
        [22, 0, 5], // core material between the 30 mm bore and the 60 mm bolt circle
        [15 + 1.5, 0, 5], // 1.5 mm past the 15 mm bore radius: inside material
      ],
      probesOutsideSolid: [
        [0, 0, 5], // central bore, dead center, mid-thickness
        [15 - 1, 0, 5], // 1 mm inside the 15 mm bore radius: still inside the bore
      ],
      // The 6 bolt holes have a pinned radius (30 mm) and count (6) but no stated
      // starting angle, so their exact XY centers are not derivable; any global
      // rotation of the pattern is a valid answer. Omitted rather than guessed.
    },
  },
  {
    id: 'l-bracket',
    source: 'benchmarks/03-l-bracket.md',
    calibrated: true,
    prompt:
      `${DELIVERABLE}\n\n` +
      'The bracket has a horizontal base plate 80 mm long in X, 50 mm wide in Y, and 8 mm thick in Z. Center the base plate on the XY origin, with its bottom at Z = 0. ' +
      'Add a vertical back plate along the rear long edge of the base. The back plate is 80 mm long in X, 8 mm thick in Y, and 50 mm tall in Z, rising from the top of the base plate. The back plate should sit along the rear edge at positive Y. ' +
      'Add two vertical through-holes in the base plate, each 6 mm in diameter, located at X = +/-25 mm and Y = -10 mm. ' +
      'Add two horizontal through-holes in the vertical plate, each 6 mm in diameter, located at X = +/-25 mm and Z = 30 mm, passing through the 8 mm thickness of the vertical plate. ' +
      'Add two triangular gussets, each 8 mm thick in X, located at X = +/-20 mm. Each gusset should connect the base plate to the back plate with a right-triangle side profile 30 mm tall and 30 mm deep. ' +
      'Add 2 mm fillets to the outside corner where the base and back plate meet.',
    spec: {
      // X: both plates are 80 mm long, gussets sit within +/-24 -> base governs.
      // Y: base is 50 mm wide (-25..25); back plate (8 mm thick) hugs the rear
      // edge, occupying Y=17..25 (flush at Y=25), inside the base's Y range.
      // Z: base bottom 0, base top 8; back plate rises 50 mm from there -> top 58.
      bbox: { x: [79, 81], y: [49, 51], z: [57, 59] },
      // base 80*50*8=32000 - 2 holes(pi*3^2*8=452.39) = 31547.61
      // back  80*8*50=32000 - 2 holes(452.39)          = 31547.61
      // 2 gussets: right triangle 30x30 * 8 mm thick = 0.5*30*30*8=3600 each -> 7200
      // sum 70295.22; the two plates occupy disjoint Z ranges (0-8 vs 8-58), no
      // volume overlap. A 2 mm fillet on the one outside X-running corner edge
      // (length 80) removes ~(1-pi/4)*2^2*80=68.7 (0.1%), folded into the band.
      volume: [68_200, 72_400],
      solids: [1, 1],
      minTriangles: 100,
      probesInsideSolid: [
        [0, 0, 4], // base plate core, away from both base holes (X=+/-25, Y=-10)
        [0, 21, 30], // back plate core (mid-Y-thickness 17..25), away from both back holes
        [25, -10 + 4.5, 4], // 4.5 mm past the base hole's 3 mm radius (r+1.5): inside material
        [25, 21, 30 + 4.5], // 4.5 mm past the back hole's 3 mm radius (r+1.5), offset in Z: inside material
      ],
      probesOutsideSolid: [
        [25, -10, 4], // base hole (X=25, Y=-10), dead center, mid-thickness
        [-25, -10, 4], // base hole (X=-25, Y=-10), dead center
        [25, -10 + 2, 4], // 1 mm inside the base hole's 3 mm radius (r-1)
        [25, 21, 30], // back hole (X=25, Z=30), dead center, mid-Y-thickness
        [-25, 21, 30], // back hole (X=-25, Z=30), dead center
        [25, 21, 30 + 2], // 1 mm inside the back hole's 3 mm radius (r-1), offset in Z
      ],
    },
  },
  {
    id: 'stepped-shaft-keyway',
    source: 'benchmarks/04-stepped-shaft-keyway.md',
    calibrated: true,
    prompt:
      `${DELIVERABLE}\n\n` +
      'The shaft axis runs along X. The total length is 120 mm. The left end center is at X = 0, Y = 0, Z = 0. ' +
      'From X = 0 to X = 30, the shaft diameter is 20 mm. From X = 30 to X = 90, the shaft diameter is 30 mm. From X = 90 to X = 120, the shaft diameter is 20 mm. ' +
      'Add a 1 mm chamfer to both end edges. ' +
      'Add a rectangular keyway slot on the top of the 30 mm diameter middle section. The keyway is 6 mm wide in Y, 3 mm deep in Z, and runs from X = 40 to X = 80.',
    spec: {
      // length 0..120; widest section is the 30 mm-diameter middle (radius 15).
      bbox: { x: [119, 121], y: [29, 31], z: [29, 31] },
      // 3 segments on-axis (Y=0,Z=0): pi*10^2*30 + pi*15^2*60 + pi*10^2*30 = 61261.06
      // minus keyway 6*3*40=720 -> net 60541.06. End chamfers (1 mm, r=10 circles)
      // remove ~2*0.5*1^2*(2*pi*10)=62.8 (0.1%), folded into the band.
      // TIGHTENED band: a model that omits the keyway entirely would measure
      // 61261.06, only 1.19% above net -- inside a naive +-3% band. Upper bound
      // is pulled below 61261 to force that failure to read as a miss; probes
      // below also independently catch a keyway that is missing or too shallow.
      volume: [59_700, 61_050],
      solids: [1, 1],
      minTriangles: 100,
      probesInsideSolid: [
        [15, 0, 0], // on-axis material, left 20 mm-diameter section
        [60, 0, 0], // on-axis material, middle section, far from the keyway (which is at Z=12..15)
        [105, 0, 0], // on-axis material, right 20 mm-diameter section
        [60, 3 + 1.5, 15 - 1.5], // 1.5 mm past the keyway's 3 mm half-width (assumed centered on Y=0): inside the 30 mm section
        [60, 0, 15 - 3 - 2], // 2 mm below the keyway floor (Z = 15-3 = 12): shaft material intact beneath the slot
      ],
      probesOutsideSolid: [
        [60, 0, 15 - 1.5], // keyway void, X-midpoint of the 40..80 run, mid-depth between floor (Z=12) and top (Z=15)
        [60, 3 - 1, 15 - 1.5], // 1 mm inside the keyway's 3 mm half-width: still within the 6 mm-wide slot
      ],
    },
  },
  {
    id: 'open-top-electronics-enclosure',
    source: 'benchmarks/05-open-top-electronics-enclosure.md',
    calibrated: true,
    prompt:
      `${DELIVERABLE}\n\n` +
      'The outer shape is a rectangular box 100 mm long in X, 70 mm wide in Y, and 30 mm tall in Z. Center it on the XY origin, with the bottom face at Z = 0. ' +
      'The enclosure is open at the top. The wall thickness is 3 mm and the bottom floor thickness is 3 mm. ' +
      'Add four internal cylindrical standoffs rising from the inside floor. Each standoff has an outside diameter of 10 mm and a height of 12 mm above the inside floor. Place the standoffs at X = +/-35 mm and Y = +/-25 mm. ' +
      'Add a centered blind hole in each standoff, 3 mm in diameter and 8 mm deep from the top of the standoff. ' +
      'Add 2 mm radius fillets to the four outside vertical corners of the enclosure.',
    spec: {
      bbox: { x: [99, 101], y: [69, 71], z: [29, 31] },
      // outer box 100*70*30=210000; interior cavity (94 x 64 footprint, open
      // top, floor top at Z=3) is 94*64*27=162432; shell = 47568.
      // 4 standoffs (OD10 r5, h12 above floor): 4*pi*5^2*12=3769.91.
      // 4 blind holes (d3 r1.5, 8 mm deep from standoff top): 4*pi*1.5^2*8=226.19.
      // net 47568 + 3769.91 - 226.19 = 51111.72. 4 corner fillets (r2, full
      // 30 mm height) remove ~4*(1-pi/4)*2^2*30=103.0 (0.2%), folded into band.
      volume: [49_600, 52_650],
      solids: [1, 1],
      minTriangles: 100,
      probesInsideSolid: [
        [0, 0, 3 / 2], // floor slab, mid-thickness (Z=0..3), away from all standoffs
        [50 - 3 / 2, 0, 15], // +X wall material, mid-wall-thickness (47..50), mid-height
        [35 + 1.5 + 1.5, 25, 15 - 8 / 2], // 1.5 mm past the (35,25) standoff's 1.5 mm blind-hole radius (r+1.5): inside the standoff (OD10, r5)
        [35, 25, 3 + 0.5], // 0.5 mm above the floor top (Z=3), within the (35,25) standoff's footprint: confirms the standoff is fused to the floor, not floating
      ],
      probesOutsideSolid: [
        [0, 0, 15], // open interior cavity, away from standoffs: confirms the box is hollow, not solid
        [35, 25, 15 - 8 / 2], // blind hole at the (35,25) standoff: top at Z=3+12=15, 8 mm deep -> mid-depth Z=11
        [-35, 25, 15 - 8 / 2], // blind hole at the (-35,25) standoff, dead center
        [35, -25, 15 - 8 / 2], // blind hole at the (35,-25) standoff, dead center
        [-35, -25, 15 - 8 / 2], // blind hole at the (-35,-25) standoff, dead center
        [35 + 0.5, 25, 15 - 8 / 2], // 1 mm inside the (35,25) hole's 1.5 mm radius
      ],
    },
  },
  {
    id: 'clevis-bracket-lightening-cutouts',
    source: 'benchmarks/06-clevis-bracket-lightening-cutouts.md',
    calibrated: true,
    prompt:
      `${DELIVERABLE}\n\n` +
      'The part is symmetric about the XZ plane. ' +
      'Start with a base plate 120 mm long in X, 60 mm wide in Y, and 10 mm thick in Z, centered on the XY origin, with bottom face at Z = 0. ' +
      'Add two vertical clevis lugs rising from the top of the base near the center. Each lug is 18 mm thick in Y, 42 mm tall above the base, and extends 36 mm along X. The two lugs are separated by a 16 mm central gap in Y. The top of each lug has a semicircular rounded profile with radius 18 mm when viewed from the side. ' +
      'Add a horizontal through-hole of diameter 14 mm through both lugs along the Y direction, centered at X = 0 and Z = 34 mm. ' +
      'Add four base mounting holes, diameter 7 mm, through the base plate, located at X = +/-45 mm and Y = +/-20 mm. ' +
      'Add two triangular lightening cutouts through the base web, one on each side of the clevis, each with rounded corners of radius 3 mm. ' +
      'Add two diagonal reinforcing ribs from the base to the outer faces of the lugs, one on each side, thickness 6 mm. ' +
      'Add 3 mm fillets to the base perimeter and 2 mm fillets at lug-to-base transitions.',
    spec: {
      // X: base 120 mm governs (lugs +/-18, ribs bounded by the lugs, both well inside).
      // Y: base 60 mm governs (lugs span 8..26 / -26..-8, inside the base's +/-30).
      // Z: base top at 10; lug is 42 mm tall total (36 mm X-width -> the stated
      // 18 mm cap radius = half that width, so the 42 mm figure already includes
      // the rounded top) -> lug top at 10+42=52.
      bbox: { x: [119, 121], y: [59, 61], z: [51, 53] },
      // Volume OMITTED: the two triangular lightening cutouts have no stated
      // size (only "rounded corners radius 3 mm" and "one on each side"), and
      // the two reinforcing ribs give only a thickness (6 mm), not a length or
      // height. Both features materially remove/add volume by an unbounded
      // amount, so no closed-form band is honest here.
      solids: [1, 1],
      minTriangles: 100,
      probesInsideSolid: [
        // 8.5 mm past the clevis hole's 7 mm radius (r+1.5), offset in Z, inside
        // the lug's rounded cap (Z=34 is the semicircle's flat base at the lug's
        // straight-to-round transition; 34+8.5=42.5 is within the cap, |X|<~15.9 there).
        [0, 17, 34 + 8.5],
        [45, 20 + 3.5 + 1.5, 5], // 5 mm past the (45,20) mounting hole's 3.5 mm radius (r+1.5): inside the base plate
      ],
      probesOutsideSolid: [
        [0, 17, 34], // clevis hole, dead center (positive-Y lug, mid-thickness Y=17 of the 8..26 lug)
        [0, -17, 34], // clevis hole, dead center (negative-Y lug, mid-thickness Y=-17)
        [0, 17, 34 + 6], // 1 mm inside the clevis hole's 7 mm radius (r-1), offset in Z
        [45, 20, 5], // (45,20) mounting hole, dead center, mid-thickness
        [-45, 20, 5], // (-45,20) mounting hole, dead center
        [45, -20, 5], // (45,-20) mounting hole, dead center
        [-45, -20, 5], // (-45,-20) mounting hole, dead center
        [45, 20 + 3.5 - 1, 5], // 1 mm inside the (45,20) hole's 3.5 mm radius (r-1)
      ],
      // Lightening-cutout and rib probes omitted: neither feature has a stated
      // position or size beyond "one on each side" / a single thickness, so no
      // point can be placed with confidence it lands inside or outside either.
    },
  },
  {
    id: 'radial-engine-cylinder',
    source: 'benchmarks/07-radial-engine-cylinder.md',
    calibrated: true,
    prompt:
      `${DELIVERABLE}\n\n` +
      'The main cylinder axis is vertical along Z and centered at the origin. ' +
      'Create a central barrel with diameter 36 mm and height 70 mm, bottom at Z = 0. ' +
      'Around the barrel, add 12 horizontal circular cooling fins. Each fin is 2 mm thick in Z, has outside diameter 62 mm, and is spaced every 5 mm from Z = 10 mm to Z = 65 mm. ' +
      'Add a thicker base flange at the bottom, outside diameter 70 mm and thickness 8 mm, with six vertical mounting holes of diameter 5 mm on a 56 mm bolt circle. ' +
      'Add a top cap cylinder, diameter 44 mm and height 8 mm, from Z = 70 mm to Z = 78 mm. ' +
      'Add an angled spark-plug boss protruding from the side of the top cap. The boss is a cylinder of diameter 12 mm and length 24 mm, angled upward at 35 degrees from horizontal, with its axis pointing outward in the positive X direction. ' +
      'Add a 5 mm diameter hole through the boss along its own axis. ' +
      'Add small 1 mm fillets to the outer fin edges and base flange edges.',
    spec: {
      // Y is unaffected by the boss (boss points only in +X): widest rotational
      // feature is the base flange, OD 70 mm.
      // X and Z OMITTED: the boss (12 mm dia, 24 mm long, 35 deg up, +X) has no
      // stated root position along the top cap (only "protruding from the side"),
      // so how far it extends past the cap's OD=44 (X) and how high its tip
      // rises past the cap top at Z=78 (Z) both depend on an unstated embedding
      // depth -- not closed-form derivable.
      bbox: { y: [69, 71] },
      // Volume OMITTED: same boss-root ambiguity makes the boss's net
      // contribution (external protrusion minus embedded overlap minus its own
      // 5 mm bore, intersected at an angle with the cap's curved surface) not
      // closed-form. The rotational-body-only components (barrel 71251.32 +
      // 12 fins 48028.67 + flange-net 21702.12 + cap 12164.25 = 153146.36) are
      // well defined but omitting the boss would silently mis-grade any correct
      // model, so the whole field is left unset rather than partially asserted.
      solids: [1, 1],
      minTriangles: 100,
      probesInsideSolid: [
        [0, 0, 35], // barrel core, on-axis, mid-height (0..70) -- barrel has no bore
        [22, 0, 4], // flange material at r=22 (between barrel r=18 and the 56 mm bolt-circle band r=25.5..30.5), mid-thickness (0..8)
        [33, 0, 4], // flange material at r=33 (between the bolt-circle band and OD 35), mid-thickness
        [0, 0, 74], // top cap core, on-axis, mid-height (70..78) -- away from the boss, which emerges from the cap's side, not its axis
        [18 - 1, 0, 12 + 1.5], // 1 mm inside the barrel's 18 mm radius, at Z=13.5 -- the gap between fin 1 (Z=10..12) and fin 2 (Z=15..17), where only the barrel itself can be present
      ],
      probesOutsideSolid: [
        [18 + 1, 0, 12 + 1.5], // 1 mm beyond the barrel's 18 mm radius, same fin-gap Z=13.5: confirms the barrel does not bulge past its stated 36 mm diameter (fins only exist in their own 2 mm Z-slices, not this gap)
      ],
      // No further probesOutsideSolid: the 6 base-flange mounting holes have a
      // pinned radius (28 mm) and count (6) but no stated starting angle (same
      // ambiguity as task 02's bolt circle), and the boss's own 5 mm bore sits
      // at an unstated root position on the cap. Neither has a fully pinned
      // XYZ location to probe.
    },
  },
  {
    id: 'centrifugal-impeller',
    source: 'benchmarks/08-centrifugal-impeller.md',
    calibrated: true,
    prompt:
      `${DELIVERABLE}\n\n` +
      'The impeller axis is vertical along Z and centered at the origin. ' +
      'Add a circular backplate disk with outside diameter 90 mm and thickness 6 mm, with its bottom face at Z = 0. ' +
      'Add a central hub cylinder on top of the backplate, diameter 26 mm and height 22 mm above the backplate. ' +
      'Add a vertical through-bore of diameter 8 mm through the entire part. ' +
      'Add 12 identical backward-curved blades on top of the backplate, equally spaced around the hub. Each blade begins at radius 18 mm and ends at radius 43 mm. Each blade is 3 mm thick, 16 mm tall above the backplate, and curves backward by approximately 45 degrees from root to tip. The blade tips should lean opposite the direction of rotation when viewed from above. ' +
      'Add 1 mm fillets at the blade roots where they meet the backplate and hub. Add a 1.5 mm fillet to the top and bottom outer circular edges of the backplate.',
    spec: {
      // X/Y: backplate OD 90 mm is the widest feature (blade tips reach only
      // r=43 -> diameter 86). Z: backplate top at 6, hub top at 6+22=28, which
      // exceeds the blades' top at 6+16=22 -> hub governs the overall height.
      bbox: { x: [89, 91], y: [89, 91], z: [27, 29] },
      // Volume OMITTED (named directly in the task rules as an omit example):
      // the 12 blades are specified only by start/end radius, thickness, and an
      // "approximately 45 degrees" backward curve -- no exact swept-path or
      // cross-section profile is given, so their volume is not closed-form.
      solids: [1, 1],
      minTriangles: 100,
      probesInsideSolid: [
        [4 + 1.5, 0, 14], // 1.5 mm past the 4 mm through-bore radius (r+1.5), inside the hub
        [10, 0, 15], // hub material (r=10, within the hub's 13 mm radius), away from the bore and the blade root region (blades begin at r=18)
        [30, 0, 3], // backplate material, mid-thickness (Z=0..6), r=30 -- below blade start height (Z=6), safe regardless of blade shape
      ],
      probesOutsideSolid: [
        [0, 0, 14], // through-bore, dead center, mid-height (bore runs the full 0..28 part height)
        [4 - 1, 0, 14], // 1 mm inside the bore's 4 mm radius (r-1)
      ],
      // Blade probes omitted: the curved sweep path between the stated start
      // (r18) and end (r43) radii is only qualitatively described ("approximately
      // 45 degrees"), so no exact in/out point on a blade is derivable.
    },
  },
  {
    id: 'spiral-staircase',
    source: 'benchmarks/09-spiral-staircase.md',
    calibrated: true,
    prompt:
      `${DELIVERABLE}\n\n` +
      'The staircase is centered on the origin and rises along Z. ' +
      'Add a central vertical column, diameter 14 mm and height 140 mm, with its bottom at Z = 0. ' +
      'Add 20 identical wedge-shaped stair treads arranged helically around the column. Each tread is 4 mm thick, has an inner radius of 10 mm, an outer radius of 62 mm, and subtends 24 degrees in plan view. The first tread is at Z = 4 mm, and each subsequent tread rises by 6 mm and rotates by 18 degrees around Z. ' +
      'Add a helical outer handrail tube of diameter 5 mm following radius 66 mm, starting at Z = 14 mm and ending at Z = 130 mm, making one full revolution around the staircase. ' +
      'Add 20 vertical balusters, each diameter 3 mm, connecting the outer end of each tread to the handrail. ' +
      'Add a circular base disk, diameter 90 mm and thickness 5 mm.',
    spec: {
      // Widest reach is the handrail TUBE's outer surface: centerline radius 66
      // + tube radius 2.5 = 68.5 -> diameter 137. (Base disk OD 90 and tread OD
      // 124 are both smaller.)
      // Z OMITTED: the base disk (diameter 90, thickness 5) has no stated Z
      // position -- unlike every other feature in this part, its placement
      // relative to the column's Z=0 bottom is never given. Column-top-only
      // height is 140; if the disk sits fully below Z=0 the total is 145 --
      // a 5 mm (3.6%) swing with no textual basis to pick one, so left unset.
      bbox: { x: [136, 138], y: [136, 138] },
      // Volume OMITTED (named directly in the task rules as an omit example):
      // helical wedge treads, a helical handrail sweep, and angled balusters
      // have no closed-form solid-of-revolution/extrusion formula from radii
      // and angles alone.
      solids: [1, 1],
      minTriangles: 100,
      probesInsideSolid: [
        [0, 0, 70], // central column, on-axis, mid-height (0..140) -- unambiguous regardless of tread/handrail/baluster placement
        [7 - 1, 0, 70], // 1 mm inside the column's 7 mm radius: confirms the column reaches its stated 14 mm diameter
      ],
      probesOutsideSolid: [
        // 1 mm beyond the column's 7 mm radius, same height: treads never reach
        // this radius (their stated inner radius is 10 mm, a fixed 3 mm gap from
        // the column regardless of Z), so this is safely open air at any Z.
        [7 + 1, 0, 70],
      ],
      // No hole/bore/pocket is stated for this part otherwise -- it is purely
      // additive (column, treads, handrail, balusters, base disk).
    },
  },
  {
    id: 'planetary-gear-stage',
    source: 'benchmarks/10-planetary-gear-stage.md',
    calibrated: true,
    prompt:
      `${DELIVERABLE_MULTIBODY}\n\n` +
      'The assembly lies flat in the XY plane with gear axes along Z. Use separate solid bodies for the sun gear, three planet gears, ring gear, carrier plate, and three planet pins. ' +
      'All gears are 8 mm thick. Use simplified straight-sided trapezoidal teeth rather than true involute teeth. ' +
      'The sun gear has 24 external teeth, pitch diameter 48 mm, root diameter 42 mm, and outside diameter 54 mm. ' +
      'The three planet gears each have 18 external teeth, pitch diameter 36 mm, root diameter 31 mm, and outside diameter 41 mm. Place the planet gear centers on a 42 mm radius circle, equally spaced every 120 degrees. ' +
      'The ring gear is concentric with the sun gear, has 60 internal teeth, internal pitch diameter 120 mm, internal root diameter 126 mm, internal tooth-tip diameter 114 mm, and outside diameter 140 mm. ' +
      'Add a thin circular carrier plate below the gears, diameter 105 mm and thickness 4 mm, located from Z = -5 mm to Z = -1 mm. ' +
      'Add three vertical planet pins, each diameter 6 mm and height 14 mm, centered under the planet gears. ' +
      'Add a central sun bore of diameter 10 mm.',
    spec: {
      // This task uses DELIVERABLE_MULTIBODY, not the single-solid boilerplate:
      // the two are contradictory here (the part's own text says "Use separate
      // solid bodies for..."), and solids below is the upstream checklist's
      // explicit nine-body requirement, which no fused answer can satisfy.
      //
      // X/Y: ring gear OD 140 mm is the widest feature (planet reach = 42
      // (center radius) + 20.5 (planet outside radius) = 62.5 -> dia 125, smaller).
      bbox: { x: [139, 141], y: [139, 141] },
      // Z OMITTED: only the carrier plate has an explicit Z range (-5..-1).
      // The pin height (14 mm) strongly suggests pins bridge carrier-top to
      // gear-bottom (-1 -> 13, gears then spanning 13..21), since spacing the
      // gears above the carrier is the pin's whole mechanical purpose -- but
      // the prompt never states pins rest flush on the carrier or that gears
      // rest flush on the pins, so this is inference, not a pinned value.
      //
      // Volume OMITTED (gear teeth named directly in the task rules as an omit
      // example): trapezoidal tooth width/profile is not given beyond pitch/
      // root/outside diameters and tooth count, and the Z-stacking ambiguity
      // above compounds it for 8 of the 9 bodies.
      solids: [9, 9], // sun(1) + 3 planets + ring(1) + carrier(1) + 3 pins = 9, per the checklist's explicit body count
      minTriangles: 100,
      probesInsideSolid: [
        [40, 0, -3], // carrier plate material, mid-thickness (Z=-5..-1), r=40 (within its 52.5 mm radius) -- the only body with a fully pinned Z range
        [105 / 2 - 1, 0, -3], // 1 mm inside the carrier's 52.5 mm radius (105 mm OD): confirms the carrier reaches its stated diameter
      ],
      probesOutsideSolid: [
        // 1 mm beyond the carrier's 52.5 mm radius, same mid-thickness Z: the
        // prompt states the carrier plate is "below the gears," so nothing
        // else in the assembly can occupy Z=-3 at any radius.
        [105 / 2 + 1, 0, -3],
      ],
      // No further probesOutsideSolid: the sun bore and every other gear-body
      // feature sit at a Z height that depends on the carrier/pin stacking
      // inference above, which the prompt does not state numerically. Planet
      // gear centers ARE derivable in XY (radius 42, 120 deg spacing ->
      // (42,0), (42*cos120, 42*sin120)=(-21, 36.37), (-21,-36.37)) but without
      // a pinned Z no 3D probe point can be placed with confidence.
    },
  },
]
