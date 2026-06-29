# VisionDrive Web (React) vs. original VisionDrive

This documents how the React web app covers everything in the original
[VisionDrive](https://github.com/Aman-2305/VisionDrive) (a PyQt5 desktop app:
YOLOv5s + EasyOCR + KMeans colour) and where it goes further.

## Feature parity

| Capability | VisionDrive (Python/PyQt5) | VisionDrive Web (React) |
|---|---|---|
| Vehicle detection | YOLOv5s (car/bus/truck) | COCO-SSD + **optional trainable YOLOv5/v8** (car/bus/truck/motorcycle/bicycle) |
| Number-plate OCR | EasyOCR on the **whole vehicle crop** | Tesseract.js on a **localised plate crop** (CV or YOLO) + Otsu threshold |
| Speed estimation | pixel movement ÷ frame-rate × ratio | same physics, but on a **stable multi-object tracker** (see below) |
| Colour detection | KMeans dominant colour, 9–17 named colours | HSV body-region sampling, shade-aware names (incl. Maroon/Navy/Olive/Brown/Indigo) |
| Video input | webcam + file | webcam + file + **HLS/MJPEG live streams (CCTV)** |
| GPU acceleration | CUDA (if available) | WebGL via TensorFlow.js (automatic) |
| UI | desktop window, 3 buttons | web dashboard: stats, settings, live log |

## Where the React app is better

- **Real object tracking.** VisionDrive keys vehicles by their *detection index*
  (`vehicle_{i}`) each frame, so IDs shuffle constantly and speed is unreliable.
  VisionDrive Web uses a centroid tracker with stable IDs, distance gating and EMA
  smoothing, so each vehicle keeps one ID and one speed.
- **Dedicated plate localisation.** EasyOCR was run on the entire vehicle box;
  here a CV localizer (or a trained YOLO model) finds the plate first, so OCR sees
  only the plate — far fewer false reads.
- **Plate-format validation.** Country templates (India/UK/generic) auto-correct
  O↔0, I↔1, S↔5… per character slot and reject misreads.
- **Evidence snapshots.** Each logged vehicle keeps a plate/vehicle thumbnail,
  viewable in the table and exportable.
- **Exports.** CSV log + a self-contained **HTML evidence report** with embedded
  images. (Original had console prints only.)
- **Zero install to run.** Runs in any modern browser; no PyQt/CUDA setup. Video
  never leaves the device.

## What the Python version still does natively

- EasyOCR tends to beat Tesseract on hard plates. To match it, train the YOLO
  plate model (see `training/`) which feeds Tesseract clean crops, or run a
  Python OCR microservice and point `lib/ocr.js` at it.
- Native CUDA can be faster than WebGL on large models — use a smaller input size
  (`imgsz 480`) for the in-browser YOLO model on weaker machines.
