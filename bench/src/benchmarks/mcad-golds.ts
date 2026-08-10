/**
 * MCAD gold oracles — one OpenSCAD model per task in `mcad-tasks.ts`.
 *
 * These are CALIBRATION artifacts, not exemplar answers: their whole job is to
 * prove the judge's accept direction fires, so they are written plain (no clever
 * parametrics, `$fn=96` on round features) and every one of them has been run
 * through `createMcadBenchAdapter().judge()` on this host. A task is marked
 * `calibrated: true` in `mcad-tasks.ts` only when its gold below scores 1.0.
 *
 * Where a gold deviates from the prompt's literal dimensions, the deviation is
 * named in a comment at the point of the deviation, with the reason. There is one
 * such deviation (task 10's ring tooth-tip diameter — the prompt's own numbers
 * make a coplanar 9-body assembly geometrically impossible; see the comment).
 */

/** 01 — 100 x 60 x 20 block, four 8 mm through-holes, 2 mm top-perimeter chamfer. */
const CALIBRATION_BLOCK = `
$fn=96;

// The chamfer is the hull between the full-size body and a 2 mm inset top plate,
// so it lands on the top perimeter only and leaves the bore walls square.
module chamfered_block(l, w, h, c) {
  hull() {
    translate([-l/2, -w/2, 0]) cube([l, w, h - c]);
    translate([-l/2 + c, -w/2 + c, h - c]) cube([l - 2*c, w - 2*c, c]);
  }
}

difference() {
  chamfered_block(100, 60, 20, 2);
  for (x = [-35, 35]) for (y = [-20, 20])
    translate([x, y, -1]) cylinder(h = 22, d = 8);
}
`.trim()

/** 02 — OD 80 x 10 flange, 30 mm central bore, six 6 mm holes on a 60 mm bolt circle. */
const CIRCULAR_FLANGE = `
$fn=96;

// Revolved section: a 15..40 mm x 0..10 mm rectangle whose corners are rounded by
// 1.5 mm (shrink then grow). That carries the required round on both outside
// circular edges; the same round lands on the bore edges, which the prompt does
// not ask for and does not forbid.
difference() {
  rotate_extrude()
    offset(r = 1.5) offset(delta = -1.5)
      polygon([[15, 0], [40, 0], [40, 10], [15, 10]]);
  for (i = [0:5]) rotate([0, 0, i * 60])
    translate([30, 0, -1]) cylinder(h = 12, d = 6);
}
`.trim()

/** 03 — L bracket: 80 x 50 x 8 base, 80 x 8 x 50 back plate, 4 holes, 2 gussets. */
const L_BRACKET = `
$fn=96;

// The L is a (Y, Z) section extruded along X. rotate([90,0,90]) maps local
// (x, y, z) to global (z, x, y), so a 2D point (y, z) extrudes along +X.
r = 2;   // round on the outside corner where the base and the back plate meet
arc = [for (i = [0:8]) [25 - r + r*cos(-90 + 90*i/8), r + r*sin(-90 + 90*i/8)]];
section = concat([[-25, 0], [25 - r, 0]], arc, [[25, 58], [17, 58], [17, 8], [-25, 8]]);

difference() {
  union() {
    translate([-40, 0, 0]) rotate([90, 0, 90]) linear_extrude(80) polygon(section);
    // gussets: right triangle 30 tall x 30 deep, 8 mm thick in X, at X = +/-20
    for (x = [-20, 20])
      translate([x - 4, 0, 0]) rotate([90, 0, 90]) linear_extrude(8)
        polygon([[17, 8], [-13, 8], [17, 38]]);
  }
  // base plate through-holes; the cutter stops flush at the base top (Z=8) so it
  // cannot notch the gussets that stand on that face
  for (x = [-25, 25]) translate([x, -10, -1]) cylinder(h = 9, d = 6);
  // back plate through-holes, along +Y through the 8 mm thickness
  for (x = [-25, 25]) translate([x, 17, 30]) rotate([-90, 0, 0]) cylinder(h = 9, d = 6);
}
`.trim()

/** 04 — stepped shaft along X with 1 mm end chamfers and a top keyway. */
const STEPPED_SHAFT_KEYWAY = `
$fn=96;

// Every section is a cylinder laid along +X; the two end chamfers are 1 mm frusta.
module seg(x, len, r1, r2) {
  translate([x, 0, 0]) rotate([0, 90, 0]) cylinder(h = len, r1 = r1, r2 = r2);
}

difference() {
  union() {
    seg(0,   1,  9, 10);
    seg(1,  29, 10, 10);
    seg(30, 60, 15, 15);
    seg(90, 29, 10, 10);
    seg(119, 1, 10,  9);
  }
  // keyway: 6 mm wide in Y, 3 mm deep from the Z=15 top, X = 40..80
  translate([40, -3, 12]) cube([40, 6, 5]);
}
`.trim()

/** 05 — open-top enclosure, 3 mm walls/floor, four standoffs with blind holes. */
const OPEN_TOP_ELECTRONICS_ENCLOSURE = `
$fn=96;

// Outer box with 2 mm rounds on the four vertical corners.
module rounded_box(l, w, h, r) {
  hull() for (x = [-l/2 + r, l/2 - r]) for (y = [-w/2 + r, w/2 - r])
    translate([x, y, 0]) cylinder(h = h, r = r);
}

union() {
  difference() {
    rounded_box(100, 70, 30, 2);
    // interior cavity: 3 mm walls, 3 mm floor, open at the top
    translate([-47, -32, 3]) cube([94, 64, 31]);
  }
  // standoffs rising from the inside floor, each with a 3 mm x 8 mm blind hole
  for (x = [-35, 35]) for (y = [-25, 25])
    translate([x, y, 3]) difference() {
      cylinder(h = 12, d = 10);
      translate([0, 0, 4]) cylinder(h = 9, d = 3);
    }
}
`.trim()

/** 06 — clevis bracket: base plate, two lugs with a 14 mm pin bore, ribs, cutouts. */
const CLEVIS_BRACKET = `
$fn=96;

// Base plate, 3 mm rounds on the four vertical perimeter corners.
module base_plate() {
  hull() for (x = [-57, 57]) for (y = [-27, 27])
    translate([x, y, 0]) cylinder(h = 10, r = 3);
}

// One clevis lug: an (X, Z) side profile extruded 18 mm in Y. The straight part
// runs Z=10..34 and the semicircular cap is r=18 about Z=34, so the lug top is at
// Z=52 -- exactly 42 mm above the base, as the prompt states.
module lug() {
  translate([0, 26, 0]) rotate([90, 0, 0]) linear_extrude(18)
    union() {
      translate([-18, 10]) square([36, 24]);
      translate([0, 34]) circle(r = 18);
    }
}

// 2 mm transition flare where the lug foot meets the base plate.
module lug_foot() {
  hull() {
    translate([-20, 6, 10]) cube([40, 22, 0.01]);
    translate([-18, 8, 12]) cube([36, 18, 0.01]);
  }
}

// Diagonal reinforcing rib, 6 mm thick in Y, lying against the lug's outer face.
module rib() {
  translate([0, 26, 0]) rotate([90, 0, 0]) linear_extrude(6)
    polygon([[18, 10], [40, 10], [18, 34]]);
}

difference() {
  union() {
    base_plate();
    lug();      mirror([0, 1, 0]) lug();
    lug_foot(); mirror([0, 1, 0]) lug_foot();
    rib();      mirror([0, 1, 0]) rib();
  }
  // clevis pin bore, 14 mm through both lugs along Y at X=0, Z=34
  translate([0, -27, 34]) rotate([-90, 0, 0]) cylinder(h = 54, d = 14);
  // four 7 mm base mounting holes
  for (x = [-45, 45]) for (y = [-20, 20])
    translate([x, y, -1]) cylinder(h = 12, d = 7);
  // triangular lightening cutouts through the base web, corners rounded 3 mm
  for (x = [-31, 31]) translate([x, 0, -1]) linear_extrude(12)
    offset(r = 3) polygon([[6, 0], [-3, 5.2], [-3, -5.2]]);
}
`.trim()

/** 07 — radial engine cylinder: barrel, 12 fins, base flange, top cap, plug boss. */
const RADIAL_ENGINE_CYLINDER = `
$fn=96;

// One cooling fin: a 2 mm disc whose outer edge carries the 1 mm round, so the
// fin outside diameter is 2*(30+1) = 62 mm. The round's own section is coarse
// ($fn=24): at 96 it puts ~18k triangles on each of the 12 fins and takes the
// CGAL union past two minutes for a 1 mm cosmetic edge.
module fin(z) {
  translate([0, 0, z]) union() {
    cylinder(h = 2, r = 30);
    translate([0, 0, 1]) rotate_extrude() translate([30, 0]) circle(r = 1, $fn = 24);
  }
}

difference() {
  union() {
    cylinder(h = 70, r = 18);                    // barrel
    for (i = [0:11]) fin(10 + 5 * i);            // 12 fins, Z = 10..67
    // base flange OD 70 x 8, 1 mm rounds on its outer edges. The profile starts
    // at x=1 (not 0) so the revolve never sees a negative radius; the barrel
    // above fills that 1 mm core.
    rotate_extrude() offset(r = 1) offset(delta = -1)
      polygon([[1, 0], [35, 0], [35, 8], [1, 8]]);
    translate([0, 0, 70]) cylinder(h = 8, r = 22);   // top cap
    // spark-plug boss: 12 mm dia, 24 mm long, 35 deg above horizontal, +X, rooted
    // inside the top cap so it fuses with it
    translate([10, 0, 72]) rotate([0, 55, 0]) cylinder(h = 24, d = 12);
  }
  // six 5 mm mounting holes on the 56 mm bolt circle of the base flange
  for (i = [0:5]) rotate([0, 0, i * 60]) translate([28, 0, -1]) cylinder(h = 10, d = 5);
  // 5 mm bore along the boss axis
  translate([10, 0, 72]) rotate([0, 55, 0]) cylinder(h = 25, d = 5);
}
`.trim()

/** 08 — centrifugal impeller: backplate, hub, 12 backward-curved blades, bore. */
const CENTRIFUGAL_IMPELLER = `
$fn=96;

// Blade centreline: radius 18 -> 43 while sweeping 45 degrees backward. The blade
// is the swept 3 mm disc along that path, so its thickness is 3 mm everywhere.
function bp(t) = [(18 + 25*t) * cos(-45*t), (18 + 25*t) * sin(-45*t)];

module blade() {
  for (i = [0:11]) hull() {
    translate(bp(i/12)) circle(d = 3, $fn = 32);
    translate(bp((i+1)/12)) circle(d = 3, $fn = 32);
  }
}

difference() {
  union() {
    // backplate OD 90 x 6 with 1.5 mm rounds on both outer circular edges
    rotate_extrude() offset(r = 1.5) offset(delta = -1.5)
      polygon([[1, 0], [45, 0], [45, 6], [1, 6]]);
    translate([0, 0, 6]) cylinder(h = 22, r = 13);           // hub
    // 12 blades, 16 mm tall above the backplate. The prompt's own radii leave a
    // 5 mm gap between the blade roots (r=18) and the hub (r=13), so the stated
    // blade-to-hub root fillet has nothing to fillet and is omitted.
    for (i = [0:11]) rotate([0, 0, i * 30])
      translate([0, 0, 6]) linear_extrude(16) blade();
  }
  translate([0, 0, -1]) cylinder(h = 30, d = 8);             // through-bore
}
`.trim()

/** 09 — spiral staircase: column, 20 helical treads, helical handrail, balusters. */
const SPIRAL_STAIRCASE = `
$fn=96;

n = 20;        // treads
z0 = 4;        // first tread bottom
rise = 6;      // Z step per tread
turn = 18;     // degrees per tread
rail_r = 66; rail_z0 = 14; rail_z1 = 130;

// Handrail height at a given plan angle, measured counter-clockwise from +X.
function rail_z(a) = rail_z0 + (rail_z1 - rail_z0) * a / 360;

// A wedge tread: annulus sector from ri to ro over "ang" degrees.
module tread(ri, ro, ang, h) {
  m = 24;
  linear_extrude(h) polygon(concat(
    [for (i = [0:m]) [ri * cos(ang*i/m), ri * sin(ang*i/m)]],
    [for (i = [m:-1:0]) [ro * cos(ang*i/m), ro * sin(ang*i/m)]]));
}

union() {
  cylinder(h = 140, r = 7);      // central column
  cylinder(h = 5, r = 45);       // base disk, Z = 0..5 (overlaps the first tread)
  for (k = [0:n-1]) {
    rotate([0, 0, k * turn]) translate([0, 0, z0 + k * rise]) tread(10, 62, 24, 4);
    // baluster at the tread's outer end, mid-width, reaching the handrail centre
    rotate([0, 0, k * turn + 12]) translate([63, 0, z0 + k * rise])
      cylinder(h = rail_z(k * turn + 12) - (z0 + k * rise), d = 3);
  }
  // helical handrail: a 5 mm circle at radius 66 swept one counter-clockwise turn
  // (OpenSCAD's positive twist is clockwise) while rising Z=14 -> 130
  translate([0, 0, rail_z0])
    linear_extrude(height = rail_z1 - rail_z0, twist = -360, slices = 96)
      translate([rail_r, 0]) circle(d = 5, $fn = 48);
}
`.trim()

/** 10 — planetary gear stage: 9 separate bodies (sun, 3 planets, ring, carrier, 3 pins). */
const PLANETARY_GEAR_STAGE = `
$fn=96;

// Straight-sided trapezoidal teeth: each tooth is a four-point polygon between the
// root and tip circles, unioned onto (external) or subtracted from (internal) the
// gear blank. Half-angles are given at the root and the tip.
module ext_gear(n, r_root, r_tip, ha_root, ha_tip, phase) {
  union() {
    circle(r = r_root);
    for (i = [0:n-1]) rotate(phase + 360*i/n)
      polygon([[r_root*cos(-ha_root), r_root*sin(-ha_root)],
               [r_tip*cos(-ha_tip),   r_tip*sin(-ha_tip)],
               [r_tip*cos(ha_tip),    r_tip*sin(ha_tip)],
               [r_root*cos(ha_root),  r_root*sin(ha_root)]]);
  }
}

module int_gear(n, r_tip, r_root, r_out, ha_tip, ha_root, phase) {
  difference() {
    circle(r = r_out);
    difference() {
      circle(r = r_root);
      for (i = [0:n-1]) rotate(phase + 360*i/n)
        polygon([[r_root*cos(-ha_root), r_root*sin(-ha_root)],
                 [r_tip*cos(-ha_tip),   r_tip*sin(-ha_tip)],
                 [r_tip*cos(ha_tip),    r_tip*sin(ha_tip)],
                 [r_root*cos(ha_root),  r_root*sin(ha_root)]]);
    }
  }
}

gz = 16;   // gear underside; the pins (Z=0..14) stop 2 mm short of it
gt = 8;    // gear thickness

// sun: 24 teeth, root d42, OD 54. Phase 7.5 puts a tooth SPACE on each of the
// three planet directions (0/120/240 deg), which is the only phase where the sun
// tip circle clears the planet root circle at all.
translate([0, 0, gz]) linear_extrude(gt) difference() {
  ext_gear(24, 21, 27, 4, 0.2, 7.5);
  circle(d = 10);
}

// three planets: 18 teeth, root d31, OD 41, centres on r=42 every 120 deg. Phase 0
// puts a tooth on the sun side (local 180) and on the ring side (local 0).
for (i = [0:2]) rotate(120*i) translate([42, 0, gz])
  linear_extrude(gt) ext_gear(18, 15.5, 20.5, 5, 2, 0);

// ring: 60 internal teeth, OD 140, internal root d126.
// DEVIATION: internal tooth-tip diameter is 116, not the prompt's 114. At 114 the
// ring tooth tips sit at r=57 while the planet ROOT circles reach r=42+15.5=57.5,
// so every planet overlaps every ring tooth and the required nine separate bodies
// cannot exist at any phase or rotation. 116 restores 0.5 mm of tip clearance and
// leaves every other stated diameter untouched.
translate([0, 0, gz]) linear_extrude(gt) int_gear(60, 58, 63, 70, 1.0, 1.5, 3);

// carrier plate, Z = -5..-1
translate([0, 0, -5]) cylinder(h = 4, r = 52.5);

// three planet pins, Z = 0..14, clear of both the carrier and the gears
for (i = [0:2]) rotate(120*i) translate([42, 0, 0]) cylinder(h = 14, d = 6);
`.trim()

/** Gold OpenSCAD source per task id. */
export const MCAD_GOLDS: Record<string, string> = {
  'calibration-block': CALIBRATION_BLOCK,
  'circular-flange': CIRCULAR_FLANGE,
  'l-bracket': L_BRACKET,
  'stepped-shaft-keyway': STEPPED_SHAFT_KEYWAY,
  'open-top-electronics-enclosure': OPEN_TOP_ELECTRONICS_ENCLOSURE,
  'clevis-bracket-lightening-cutouts': CLEVIS_BRACKET,
  'radial-engine-cylinder': RADIAL_ENGINE_CYLINDER,
  'centrifugal-impeller': CENTRIFUGAL_IMPELLER,
  'spiral-staircase': SPIRAL_STAIRCASE,
  'planetary-gear-stage': PLANETARY_GEAR_STAGE,
}
