# VisionDrive — ANPR System (React)

A browser-based **Automatic Number Plate Recognition** app that detects vehicles,
reads number plates, estimates speed, and identifies vehicle colour from a
webcam, an uploaded video, or a live IP-camera/CCTV stream.

Everything runs **client-side in the browser** — no backend, no video upload.

This implements LENSXplore Problem Statement 4 (*Speed Vision*) as a React web app:

| Requirement | How it's done |
|---|---|
| Real-time video processing | `requestAnimationFrame` loop over a `<video>` element |
| Vehicle detection | TensorFlow.js **COCO-SSD** (car, truck, bus, motorcycle, bicycle) |
| Plate **localisation** | Two options: (a) a trainable **YOLOv5/v8 model** run in-browser via TF.js, or (b) built-in classic CV (vertical-edge density → morphological close → connected components scored by plate aspect ratio, no weights) |
| Number-plate recognition (OCR) | **Tesseract.js** on the localised plate crop, with Otsu thresholding |
| Plate **format validation** | Country templates (India, UK, generic) auto-correct OCR confusions per slot (O↔0, I↔1, S↔5, B↔8…) and reject misreads |
| Speed estimation | Centroid tracker + pixel→metre calibration across frames |
| Colour detection (bonus) | HSV body-region analysis with shade-aware names (Maroon/Navy/Olive/Brown…) |
| Evidence capture | Per-vehicle plate/vehicle snapshot, CSV + self-contained HTML report export |

> The problem statement specifies Python/OpenCV/YOLO/Tesseract. This delivers the
> same pipeline as a zero-install React web app using the JS equivalents
> (TensorFlow.js ≈ YOLO/SSD, Tesseract.js = Tesseract). See *Optional Python backend* below.

## Run it

```bash
npm install
npm run dev      # open the printed http://localhost:5173 URL
```

Build for production:

```bash
npm run build
npm run preview
```

The first run downloads the detection model and OCR data in the browser, so give
it a few seconds and keep the tab open.

## Using the app

1. **Pick a source** (left panel): Webcam, Upload video, or Live stream.
2. Press **Run** to start the pipeline (auto-starts when a source connects).
3. Watch live boxes with ID, type, speed, plate and colour. Over-limit vehicles turn red.
4. The **Detection log** records each unique vehicle; **Export CSV** to save it.

### Settings

- **Min confidence** — detection threshold.
- **Calibration (m/px)** — how many real-world metres one pixel spans. This is the
  key dial for accurate speed. Raise it if speeds read too low, lower it if too high.
  (Calibrate by measuring a known real distance visible in the frame.)
- **Speed limit** — vehicles above it are highlighted; 0 disables.
- Toggles for **plate OCR** and **colour detection**.

## Connecting cameras & CCTV

- **Webcam / phone**: use the Webcam tab (grant camera permission).
- **HLS stream** (`.m3u8`): paste the URL — played via `hls.js`.
- **MJPEG / direct MP4 URL**: paste the URL — played natively.
- **RTSP CCTV**: browsers can't play RTSP directly. Run a gateway to convert it to
  HLS, then paste the `.m3u8` URL:

  ```bash
  ffmpeg -i rtsp://CAM_IP:554/stream -c:v libx264 -f hls -hls_time 2 -hls_flags delete_segments stream.m3u8
  # or use MediaMTX (https://github.com/bluenviron/mediamtx) which exposes HLS/WebRTC
  ```

## Project structure

```
src/
  App.jsx                 orchestrator + video-source handling
  hooks/useAnpr.js        the detect→track→speed→colour→OCR loop + overlay
  lib/detector.js         COCO-SSD vehicle detection
  lib/tracker.js          centroid tracker + speed estimation
  lib/colorDetect.js      HSV dominant-colour analysis
  lib/plateLocator.js     classic-CV plate localisation (edge/morphology/CC)
  lib/plateModel.js       optional YOLOv5/v8 plate detector (TF.js)
  lib/plateFormat.js      country plate validation + OCR auto-correction
  lib/ocr.js              Tesseract.js plate OCR (Otsu threshold)
  components/             SourcePanel, SettingsPanel, ModelPanel, StatsBar, DetectionsTable
```

The training scripts live at the repo root in [`../training/`](../training/).

## Dedicated YOLO plate model (most accurate)

The built-in CV localizer needs no setup but a trained model is sharper. Train one
and load it at runtime — see [`../training/README.md`](../training/README.md):

1. `cd ../training && pip install -r requirements.txt`
2. `python train_plate_yolo.py --epochs 100` (exports to TF.js automatically)
3. Serve the `*_web_model/` folder with CORS, paste its `model.json` URL into the
   app's **YOLO plate model** panel, pick format **YOLOv8**, and enable it.

Model-detected plates draw in green; the CV fallback draws in cyan.

## Notes on accuracy

- COCO-SSD detects *vehicles*, not plates specifically; OCR is run on the likely
  plate region of each vehicle, so plate reads work best on clear, front/rear,
  reasonably close vehicles. For production-grade plates, swap in a dedicated
  plate-detection model (e.g. a YOLO licence-plate model via `tfjs`).
- Speed depends entirely on the calibration value and the camera angle. A fixed,
  roughly top-down/oblique camera with a known reference distance gives the best results.

## Optional Python backend (closer to the brief)

For true YOLOv5 + OpenCV + Tesseract, run detection server-side and stream results
to this UI. The frontend is structured so `lib/detector.js` and `lib/ocr.js` can be
replaced with calls to a Flask/FastAPI endpoint without touching the UI.
