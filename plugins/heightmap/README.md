# Heightmap Plugin

Probes the surface of a workpiece, builds a Z-correction map, and applies it to G-code files. Designed for PCB milling, engraving, and any precision work where the material surface is not perfectly flat.

---

## How It Works

1. The machine probes a grid of points across your workpiece, recording the Z height at each location.
2. Those heights are interpolated into a smooth heightmap and saved as a `.hmap` file on the SD card.
3. You select one or more G-code files and apply the heightmap - the plugin rewrites each file with adjusted Z values that follow the surface contour.

---

## Before You Start

**Hardware checklist:**

- Confirm your probe (touch plate or probe pin) is connected and functioning. Send `G38.2 Z-1 F30` manually and verify the machine halts on contact. If it does not stop, do not proceed - a misconfigured probe will drive the tool into your material.
- Check that the probe wire is secured and will not snag during travel across the grid.
- Ensure the probe tip is clean and making solid electrical contact. Oxidation, residue, or a dirty touch plate will cause missed triggers.
- Set your work coordinate origin (G54 / zero) before probing. The heightmap is stored in work coordinates, so if you re-zero after probing the map will no longer align.

**Safe Z height:**

- Set **Safe Z** high enough that the tool clears any clamps, fixture hardware, or surface features when travelling between probe points. A value too low risks a collision during rapid moves.
- Safe Z is a work-coordinate value. If your material surface is near Z=0, a Safe Z of 2–5 mm is typical.

**Probe depth:**

- **Max Probe Travel** controls how far down the machine will search for the surface before giving up. Set this slightly larger than the expected surface variation plus any flex in the setup - but not so large that a missed probe trigger would drive the tool deep into the material.

---

## Probe Tab

### Step 1 - Load a G-code file

Tap **Browse SD** under *G-code File* and select your file. The plugin reads the file's XY extents and pre-fills the probe area bounds.

### Step 2 - Set probe parameters

| Parameter | Description |
|---|---|
| **Grid** | Number of probe columns × rows. More points = finer correction, longer probing time. |
| **Probe area X / Y** | The rectangular region to probe, in work coordinates. Should fully cover the area your G-code cuts. |
| **Safe Z Height** | Z height for rapid travel between probe points. |
| **Max Probe Travel** | Maximum downward distance for each probe move. |
| **Feed rate** | Speed of the probing move (mm/min). Slower = more accurate. 30–60 mm/min is typical. |
| **Interpolation** | Factor by which the probed grid is upsampled using bilinear interpolation before saving. Higher values produce smoother correction with no extra probing time. 4× is the default. |

### Step 3 - Start probing

Press **Start Probing**. The machine will:

1. Move to Safe Z.
2. Travel to each grid point in a snake pattern (alternating row direction to minimise travel).
3. Probe down, record the Z value, and retract to Safe Z before the next point.

Results appear in the grid table as each point is measured. Failed triggers are shown in red.

Press **Abort** to stop mid-sequence. The machine will receive a feed hold and partially-collected results will be discarded.

### Step 4 - Save the heightmap

After probing completes, review the Z range shown below the grid. If the values look reasonable, enter a filename and press **Save to SD** to write the `.hmap` file, then tap **Use & Apply →** to move directly to the Apply tab with this heightmap pre-selected.

---

## Apply Tab

### Step 1 - Select a heightmap

Use the session result (automatically available after probing) or tap **Browse SD** to load a previously saved `.hmap` file.

### Step 2 - Select G-code files

Check one or more G-code files from the SD card list. If you loaded a file on the Probe tab, it will be pre-checked.

### Step 3 - Apply

Press **Apply Heightmap**. Each selected file is read, Z-corrected, and written back to the SD card with `_leveled` appended to the filename (e.g. `board.nc` → `board_leveled.nc`). The original files are not modified.

Run the `_leveled` file as you would any other G-code.

---

## The `.hmap` File Format

Heightmap files are plain JSON and can be inspected or transferred manually:

```json
{
  "version": 1,
  "cols": 9,
  "rows": 9,
  "xMin": 0,
  "xMax": 80,
  "yMin": 0,
  "yMax": 60,
  "meanZ": -0.012,
  "points": [[...], ...]
}
```

`points[row][col]` stores the work Z at each grid position. Row 0 corresponds to `yMin`, the last row to `yMax`. Column 0 is `xMin`.

---

## Limitations

- **Arc moves (G2/G3)** are passed through without Z correction. For most PCB and engraving work this is not an issue since arcs are uncommon.
- The heightmap covers a fixed rectangular region. Moves outside the probed area are clamped to the nearest edge - if your G-code extends beyond the probe boundary, add some margin to the probe area.
- The correction assumes the workpiece does not move or flex between probing and cutting. Re-probe if the workpiece is re-fixured.
- Heightmaps are saved in work coordinates. Re-zeroing the machine after probing will misalign the map.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Points show "Failed" | Probe did not trigger - check probe wiring and connection |
| Machine alarms mid-probe | Probe did not trigger before reaching Max Probe Travel - increase the depth or check the probe |
| Z range looks unreasonably large | Probe contact is intermittent or the workpiece is not secured flat |
| Leveled G-code cuts too deep or too shallow | Work coordinate origin changed after probing - re-probe with the same zero |
| G-code file not listed | Only files with extensions `.nc .gcode .ngc .gc .g .tap .cnc` are shown |
