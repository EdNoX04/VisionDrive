# VisionDrive Pro (Python desktop app)

An upgraded version of the original [VisionDrive](https://github.com/Aman-2305/VisionDrive)
desktop app, keeping the same stack (**PyQt5 + YOLOv5 + EasyOCR**) but adding the
improvements from the web version.

## What's new vs the original

- **Stable vehicle IDs.** A proper centroid tracker (`vd/tracker.py`) replaces the
  old index-based IDs, so each vehicle keeps one ID and one smoothed speed.
- **Dedicated plate localisation.** `vd/plate_locator.py` (OpenCV: Sobel edges →
  morphological close → contour scoring) finds the plate before OCR, so EasyOCR
  reads the plate, not the whole car.
- **Plate-format validation + correction.** `vd/plate_format.py` auto-corrects
  O↔0, I↔1, S↔5… per character slot for India / UK / generic and rejects misreads.
- **Shade-aware colours.** `vd/color_detect.py` samples the vehicle body and names
  Maroon, Navy, Dark Green, Olive, Brown, Indigo, etc.
- **Evidence snapshots.** Plate + vehicle crops saved to `captures/`.
- **CSV log export** of all unique vehicles.
- **GPU auto-detect** (CUDA if available), like the original.

## Install & run

```bash
cd python
pip install -r requirements.txt
python visiondrive_pro.py
```

First launch downloads the YOLOv5 weights via `torch.hub` (needs internet once)
and the EasyOCR model. Then:

1. **Load video file** (or just **Start** to use the webcam).
2. Adjust **Calibration (m/px)** for accurate speed, set a **speed limit**, and
   pick the **plate region/format**.
3. **Export CSV log** to save results; snapshots land in `captures/`.

## Layout

```
python/
  visiondrive_pro.py     PyQt5 app (detect → track → speed → colour → plate → OCR)
  vd/
    tracker.py           centroid tracker + speed
    plate_locator.py     OpenCV plate localisation
    plate_format.py      country validation + OCR correction
    color_detect.py      shade-aware colour naming
    ocr.py               EasyOCR wrapper + preprocessing
  requirements.txt
```

## Tuning

- **Speed too low/high?** Adjust the calibration spinbox (real metres per pixel).
  Calibrate by measuring a known real distance visible in the frame.
- **Plates not reading?** Toggle dedicated localisation, or set the correct
  region/format. Front/rear, reasonably close, well-lit plates read best.
- **Slow on CPU?** Lower the input resolution in `process()` / `update_frame()`.
