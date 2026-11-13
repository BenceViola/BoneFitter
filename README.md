# BoneFitter

A lightweight tool for fitting geometric primitives (lines, planes, spheres, cylinders) to surface meshes of bones, in the browser, to measure structures such as epiphyses and joint surfaces. It is the sister app of [Landmarker3D](https://github.com/BenceViola/Landmarker3D) and shares its foundations.

**Open the app: https://benceviola.github.io/BoneFitter/**

Nothing to install. Meshes are read on your own computer and never uploaded.

## Where it stands (v0.13)

Curves drawn on a mesh, regions enclosed by them or selected on the screen, spheres, cylinders and planes fitted to them, points and lines made from them, coordinate systems, measurements, orienting meshes, new meshes made from regions, and saving it all.

- Opens binary and ASCII **STL** and **PLY** triangle meshes, several at once, each shown where its file puts it.
- **Objects** (left): every mesh, with what is attached to it nested underneath. Click a name to select it, the eye to hide or show it.
- **Properties** (left, below): the facts and numbers of the selected object, with a button to copy them for a spreadsheet.
- **3D view** (right): click a mesh or anything on it to select it. Above it: the **File** menu, the menus for making things, and **View** (the eye: look along an axis, fit everything in view).
- **Tools** (the strip of buttons beside the 3D view) decide what the mouse does there: **Select** (the usual: click to select, drag to turn), **Curve**, **Point**, **Lasso** and **Box**.
- **Making things** works from either end:
  - *Start from what you want.* The menus above the 3D view (**Region**, **Sphere**, **Cylinder**, **Plane**, **Point**, **Line**, **Axes**, **Orient**, **Measure**) list the ways to make each. Choose one, and if what is selected suits, it is made at once; otherwise a strip asks for what it needs ("Click a region or a closed curve") and you click it in the 3D view or in the Objects list. Esc cancels.
  - *Start from what you have.* Select an object, and Properties offer what can be **made from this** and **measured from this** in one click: a sphere, cylinder, plane or new mesh from a region; a region or a plane from a curve; a distance from a point. Only what can be finished with the objects already in the scene is offered.
- **Curves**: with the Curve tool on, click points on a mesh and the app joins them by the shortest path across the surface. A curve can be left open or closed into a loop. It is listed under its mesh, with its length and centroid in Properties, and its clicked points can be dragged afterwards.
- **Regions**: Region ▸ Inside a closed curve gives the part of the mesh the curve encloses, tinted on the mesh, with its area, triangle count and centroid in Properties. "Use the other side" takes the rest of the surface instead. Further closed curves can be added as boundaries, for a region with a hole or the band between two rings. A region follows its curves when their points are moved. Its edge runs along triangle edges, within about one triangle of the curve.
- **Lasso and Box**: with one of these tools on, select a region by drawing on the screen. Only the surface you can see is selected, unless "Select through the surface" is ticked. Shift-drag adds to the selected region, Alt-drag takes away. The region records exactly which triangles were picked and how. Fits, new meshes and saving work on it as on any region.
- **Spheres**: Sphere ▸ Fit to a region (a closed curve stands for the region it encloses): the best fit by distance to the surface, weighted by area. Properties give its centre, radius and diameter, how well it fits (RMS and largest deviation) and how much of the sphere the region covers. The sphere is refitted when its region changes. On the example's head it gives back the head's centre and radius as built.
- **Cylinders**: Cylinder ▸ Fit to a region, in the same way. Properties give the axis (a point on it and its direction), radius, diameter, the axis ends the region spans and its length, how well it fits, and how far round the axis the region reaches.
- **Planes**: Plane ▸ Fit to a region, or Plane ▸ Fit to a curve, or Plane ▸ Square to a line (the line is its normal; through the line's own point, or through a point you choose). A plane fitted to a curve's path suits rims and margins. Properties give a point on the plane, its normal, its equation and how flat the data are. Flip normal (planes) and Flip direction (cylinders) turn the sign round without moving them.
- **New meshes from regions**: in a region's Properties, "New mesh" (under Make from this) makes a separate mesh of just that region, beside the original (which stays as it is). It is a copy: later changes to the region don't change it. Every mesh shows its **surface area**, and can be saved as **STL** or **PLY** for other software.
- **Points**: with the Point tool on, each click on a mesh places a point there. Point ▸ also makes the centre of a sphere, the centroid of a region or curve, the point midway between two points, and the point where a line meets a plane.
- **Lines**: Line ▸ Through two points, Axis of a cylinder, Fit to a curve, Perpendicular to a plane (through a point), Where two planes meet. Properties give a point on the line, its direction, and what its length means: the distance between the two points, from the point to the plane, the length of the cylinder. Flip direction turns it round without moving it. A line is drawn with an arrowhead at the end it points to.
- Wherever a point is asked for, a sphere counts as its centre: a line through the centres of two spheres needs no extra points. Made points and lines remember what they were made from and follow it: move a curve's point, and the region, the sphere, its centre and the line through it all move with it. Remove one, and what was made from it goes too.
- **Measuring** (Measure menu): the distance between two points, from a point to a line or a plane, between two lines; the angle between lines and/or planes, at a point between two others, and between two lines seen on a plane (torsion and version angles: on the plane square to a bone's long axis, given by that axis itself). A point's coordinates in a coordinate system. Each measurement is an object in the list, with its value beside its name; it follows what it measures, and Copy numbers gives a row for a spreadsheet. On the example, the angle between the shaft and neck axes comes out at 55°, or 125° with the shaft's axis flipped to point down (as built).
- **Coordinate systems** (Axes menu): from an origin and two directions (lines, plane normals, cylinder axes), or from three points (origin, a point the first axis goes towards, a point the second leans towards). The first direction gives one axis exactly, the second is squared up to it, the third makes it right-handed; which axes they give (X, Y or Z) is chosen in Properties. Drawn as red, green and blue arrows for X, Y and Z.
- **Orienting meshes** (Orient menu): put a coordinate system on the scene's axes; turn a line (the shaft axis, say) to point along an axis (+Z at first; changed in Properties); or stand the mesh on a plane (a plane under the condyles: its normal points down, −Z). The orientation follows its inputs and can be removed or undone (Orient ▸ Back to the file's position). **Orient ▸ Apply to the coordinates** makes a new mesh whose coordinates are where the mesh now sits, with its curves, regions, fits, points and measurements carried over and worked out again in the new coordinates; the original is kept as it was, hidden. Save the new mesh (Save as STL) to keep it. Turning and shifting only, never scaling. The mesh file and every stored coordinate stay as they were; for something on a moved mesh, Properties show the numbers **in the scene** (where it now is) or **as in the file**. Objects made from two meshes are worked out where the meshes now are.
- **Saving** (File menu): **Save scene** (Ctrl+S) writes one `.bonefitter.json` file with every mesh's work, and where the meshes sit. Open it again together with its mesh files (select or drop them all at once); the meshes are recognised by their SHA-256, and everything is worked out again from what it was made from, so moving a curve point afterwards still updates everything after it. Meshes made from regions are made again if their own file isn't there. **Save landmark files** writes a landmark-json file for each mesh: landmarks and clicked points, curves (with a template entry each, so Landmarker3D shows them; it samples their semilandmarks itself) and regions (as "surfaces"), with everything else kept in `extensions.bonefitter`, so BoneFitter opens the full work from it too, taking any landmark or curve changed in Landmarker3D since.
- Opens **landmark files** (`.lmk.json`) from Landmarker3D: the landmarks appear as points attached to the mesh they were placed on, matched by the mesh's SHA-256.
- Starts with an **example**: a toy femur built from exact shapes, so fits can be checked against known answers.

Coordinates are always in each mesh file's own coordinate system: the app never changes the mesh.

## Mouse and keys

| | |
|---|---|
| click | select the point, fitted shape (by its centre mark), curve, region or mesh under the cursor |
| drag a white diamond | move a clicked point of the selected curve |
| drag / right-drag / scroll | rotate / pan / zoom |
| F, H | fit the view, default view |

While a menu's command is asking for an object: click it in the 3D view or the Objects list; **Esc** cancels.

With **Lasso** or **Box** on: drag to select (Shift adds, Alt takes away); right-drag pans, scroll zooms. **Esc** switches to turning the view, and **Esc** again back to selecting with the same tool, on the same region. Done leaves the tool.

With the **Curve** tool on:

| | |
|---|---|
| click on a mesh | start a curve, or add a point to it |
| Enter, or click the last point again | finish the curve as it is (a click must be right on the point; a double-click only adds a point) |
| C, or click the first point again | close the curve into a loop (three points or more) |
| Backspace | take the last point off |
| Esc | remove the curve being drawn; again to leave the tool |

You can also drop meshes, scenes and landmark files anywhere on the page. Ctrl+S saves the scene, Ctrl+O opens files.

## Development

Plain JavaScript modules with no build step. three.js and three-mesh-bvh load from a CDN at pinned versions (see the import map in `index.html`).

```sh
npm install
npm test                         # unit tests
npx playwright install chromium  # once
npm run test:e2e                 # browser tests
```

To try changes locally, serve the folder with any static server, e.g. `npx serve .`, and open the address it prints. Opening `index.html` straight from disk does not work, because browsers block module scripts from `file://` addresses.

The site is published to GitHub Pages by `.github/workflows/pages.yml` after the tests pass on every push to `main` (repository Settings → Pages → Source must be "GitHub Actions").

More detail on the code and the decisions behind it: [`CLAUDE.md`](CLAUDE.md). What came from Landmarker3D: [`docs/from-landmarker3d.md`](docs/from-landmarker3d.md). Tests: [`tests/README.md`](tests/README.md).

## License

MIT, see [`LICENSE`](LICENSE).
