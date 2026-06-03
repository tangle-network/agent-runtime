from build123d import *
import os, json
OUT = "/tmp/cgb-hard"; os.makedirs(OUT, exist_ok=True)
tasks = []
def save(pid, part, desc):
    p = f"{OUT}/{pid}.step"; export_step(part, p)
    tasks.append({"id": pid, "prompt": desc, "gtStep": p}); print(pid, "OK", round(part.volume,1))

# 1. L-bracket: base plate + vertical leg + 4 holes through base
base = Pos(0,0,4) * Box(60,40,8)
leg  = Pos(-26,0,30) * Box(8,40,52)
lb = base + leg
for (x,y) in [(-10,-10),(-10,10),(20,-10),(20,10)]:
    lb -= Pos(x,y,4) * Cylinder(3,12)
save("l-bracket", lb, "An L-shaped steel mounting bracket. A base plate 60 (X) by 40 (Y) by 8 (Z) units sits flat with its bottom at z=0, centered on X and Y. A vertical leg 8 (X) by 40 (Y) by 52 (Z) units rises from the base's -X edge, forming a right angle (the whole part is ~60 wide, 40 deep, 60 tall). Four vertical through-holes of radius 3 pass through the base plate at X,Y offsets (-10,-10), (-10,10), (20,-10), (20,10) from center.")

# 2. Washer: flat annulus
w = Cylinder(20,4) - Cylinder(10,4)
save("washer", w, "A flat circular washer: an annular disk of outer radius 20, inner radius 10, and thickness 4 units, centered at the origin.")

# 3. Flanged pipe: pipe + flange disk at base + 4 bolt holes in flange
pipe = Cylinder(12,50, align=(Align.CENTER,Align.CENTER,Align.MIN)) - Cylinder(8,50, align=(Align.CENTER,Align.CENTER,Align.MIN))
flange = Cylinder(24,6, align=(Align.CENTER,Align.CENTER,Align.MIN)) - Cylinder(8,6, align=(Align.CENTER,Align.CENTER,Align.MIN))
fp = pipe + flange
import math
for i in range(4):
    a = math.radians(45 + i*90); fp -= Pos(18*math.cos(a),18*math.sin(a),3) * Cylinder(2.5,8)
save("flanged-pipe", fp, "A flanged pipe. A hollow cylindrical pipe of outer radius 12, inner radius 8 (bore), height 50, standing with its base at z=0. At the base is a circular flange disk of radius 24 and thickness 6, sharing the same central bore (radius 8). Four bolt holes of radius 2.5 pass vertically through the flange on a circle of radius 18 from the axis, at 45, 135, 225, 315 degrees.")

# 4. Stepped shaft: 3 stacked cylinders, decreasing radius
s = Cylinder(15,20, align=(Align.CENTER,Align.CENTER,Align.MIN))
s += Pos(0,0,20) * Cylinder(10,20, align=(Align.CENTER,Align.CENTER,Align.MIN))
s += Pos(0,0,40) * Cylinder(6,20, align=(Align.CENTER,Align.CENTER,Align.MIN))
save("stepped-shaft", s, "A stepped cylindrical shaft, coaxial along Z, base at z=0: a bottom section radius 15 height 20, a middle section radius 10 height 20, and a top section radius 6 height 20 (total height 60).")

# 5. Mounting plate: plate + 4 corner holes + center hole
mp = Box(80,60,6)
for (x,y) in [(-32,-22),(-32,22),(32,-22),(32,22)]:
    mp -= Pos(x,y,0) * Cylinder(3,10)
mp -= Cylinder(8,10)
save("mounting-plate", mp, "A rectangular mounting plate 80 (X) by 60 (Y) by 6 (Z) units, centered at the origin. A central through-hole of radius 8, plus four through-holes of radius 3 at the corners, offset (+/-32, +/-22) from center.")

# 6. Hex standoff: hexagonal prism with axial hole
hexp = extrude(RegularPolygon(radius=10, side_count=6), 30) - Cylinder(5,30, align=(Align.CENTER,Align.CENTER,Align.MIN))
save("hex-standoff", hexp, "A hexagonal standoff: a regular hexagonal prism (circumradius 10, i.e. ~17.3 across flats... actually 20 across corners) extruded 30 units tall from z=0, with a coaxial cylindrical through-hole of radius 5 along its full height.")

json.dump(tasks, open(f"{OUT}/tasks.json","w"), indent=2)
print("WROTE", len(tasks), "tasks")
