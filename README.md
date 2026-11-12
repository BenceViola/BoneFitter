# BoneFitter

A lightweight tool for fitting geometric primitives (lines, planes, spheres, cylinders) to surface meshes of bones, in the browser, to measure structures such as epiphyses and joint surfaces. It is the sister app of [Landmarker3D](https://github.com/BenceViola/Landmarker3D) and shares its foundations.

**Open the app: https://benceviola.github.io/BoneFitter/**

Nothing to install. Meshes are read on your own computer and never uploaded.

## Where it stands (v0.10)

The foundation, curves drawn on a mesh, regions enclosed by closed curves, spheres, cylinders and planes fitted to them, and new meshes made from regions. Constructing, measuring, moving meshes and saving the scene come next.

- Opens binary and ASCII **STL** and **PLY** triangle meshes, several at once, each shown where its file puts it.
- **Objects** (left): every mesh, with what is attached to it nested underneath. Click a name to select it, the eye to hide or show it.
- **Properties** (left, below): the facts and numbers of the selected object, with a button to copy them for a spreadsheet.
- **3D view** (right): click a mesh or anything on it to select it. Above it: Open, the menus, and **View** (look along an axis, fit everything in view).
- **Tools** (the strip of buttons beside the 3D view) decide what the mouse does there: **Select** (the usual: click to select, drag to turn), **Curve**, **Point**, **Lasso** and **Box**.
- **Making things** works from either end:
  - *Start from what you want.* The menus above the 3D view (**Region**, **Sphere**, **Cylinder**, **Plane**, **Point**, **Line**) list the ways to make each. Choose one, and if what is selected suits, it is made at once; otherwise a strip asks for what it needs ("Click a region or a closed curve") and you click it in the 3D view or in the Objects list. Esc cancels.
  - *Start from what you have.* Select an object, and Properties offer what can be **made from this** in one click: a sphere, cylinder, plane or new mesh from a region; a region or a plane from a curve.
- **Curves**: with the Curve tool on, click points on a mesh and the app joins them by the shortest path across the surface. A curve can be left open or closed into a loop. It is listed under its mesh, with its length and centroid in Properties, and its clicked points can be dragged afterwards.
- **Regions**: Region ▸ Inside a closed curve gives the part of the mesh the curve encloses, tinted on the mesh, with its area, triangle count and centroid in Properties. "Use the other side" takes the rest of the surface instead. Further closed curves can be added as boundaries, for a region with a hole or the band between two rings. A region follows its curves when their points are moved. Its edge runs along triangle edges, within about one triangle of the curve.
- **Lasso and Box**: with one of these tools on, select a region by drawing on the screen. Only the surface you can see is selected, unless "Select through the surface" is ticked. Shift-drag adds to the selected region, Alt-drag takes away. The region records exactly which triangles were picked and how. Fits, new meshes and saving work on it as on any region.
- **Spheres**: Sphere ▸ Fit to a region (a closed curve stands for the region it encloses): the best fit by distance to the surface, weighted by area. Properties give its centre, radius and diameter, how well it fits (RMS and largest deviation) and how much of the sphere the region covers. The sphere is refitted when its region changes. On the example's head it gives back the head's centre and radius as built.
- **Cylinders**: Cylinder ▸ Fit to a region, in the same way. Properties give the axis (a point on it and its direction), radius, diameter, the axis ends the region spans and its length, how well it fits, and how far round the axis the region reaches.
- **Planes**: Plane ▸ Fit to a region, or Plane ▸ Fit to a curve. A plane fitted to a curve's path suits rims and margins. Properties give a point on the plane, its normal, its equation and how flat the data are. Flip normal (planes) and Flip direction (cylinders) turn the sign round without moving them.
- **New meshes from regions**: in a region's Properties, "New mesh" (under Make from this) makes a separate mesh of just that region, beside the original (which stays as it is). It is a copy: later changes to the region don't change it. Every mesh shows its **surface area**, and can be saved as **STL** or **PLY** for other software.
- **Points**: with the Point tool on, each click on a mesh places a point there. Point ▸ also makes the centre of a sphere, the centroid of a region or curve, the point midway between two points, and the point where a line meets a plane.
- **Lines**: Line ▸ Through two points, Axis of a cylinder, Fit to a curve, Perpendicular to a plane (through a point), Where two planes meet. Properties give a point on the line, its direction, and what its length means: the distance between the two points, from the point to the plane, the length of the cylinder. Flip direction turns it round without moving it. A line is drawn with an arrowhead at the end it points to.
- Wherever a point is asked for, a sphere counts as its centre: a line through the centres of two spheres needs no extra points. Made points and lines remember what they were made from and follow it: move a curve's point, and the region, the sphere, its centre and the line through it all move with it. Remove one, and what was made from it goes too.
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
| Enter, or click the last point again | finish the curve as it is |
| C, or click the first point again | close the curve into a loop (three points or more) |
| Backspace | take the last point off |
| Esc | remove the curve being drawn; again to leave the tool |

You can also drop meshes and landmark files anywhere on the page.

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
