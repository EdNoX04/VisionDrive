# Training a YOLO licence-plate model for VisionDrive

This trains a dedicated **plate detector** (much more accurate than the built-in
classic-CV localizer) and exports it to TensorFlow.js so the React app can run it
fully in the browser.

## 1. Get a dataset

Use any plate dataset in **YOLO format** (one `.txt` per image: `class cx cy w h`,
all normalised 0–1). Single class: `plate`.

- [Roboflow Universe — License Plate Recognition](https://universe.roboflow.com/) (export as "YOLOv8")
- CCPD, OpenALPR benchmark, or your own labelled footage (label with Roboflow / CVAT / labelImg).

Arrange it as described in `data.yaml`.

## 2. Train + export

```bash
cd training
pip install -r requirements.txt
python train_plate_yolo.py --epochs 100 --imgsz 640 --model yolov8n.pt
```

`yolov8n` is fastest (best for in-browser). Use `yolov8s` for more accuracy.
The script trains, validates, and exports to TF.js automatically. Output:

```
runs/detect/plate/weights/best_web_model/
  model.json
  group1-shard1of*.bin
```

(You can also export manually: `yolo export model=best.pt format=tfjs`.)

## 3. Serve the model with CORS

The browser fetches the model over HTTP(S) and needs CORS enabled. Quick local test:

```bash
cd runs/detect/plate/weights/best_web_model
npx http-server -p 8000 --cors
# model URL -> http://localhost:8000/model.json
```

For production, drop the folder on any static host / S3 / CDN with
`Access-Control-Allow-Origin` set.

## 4. Load it in the app

Open the app → **YOLO plate model** panel → paste the `model.json` URL → format
**YOLOv8** → **Load model** → tick *Use YOLO model for plates*. Detected plates
draw in **green** (vs cyan for the built-in CV fallback).

## Notes

- Keep `imgsz` the same for training and at runtime (the app auto-reads it from
  the model, default 640).
- The app decodes both YOLOv5 (objectness) and YOLOv8 (no objectness) outputs;
  pick the matching format if auto-detect misbehaves.
- For best speed on lower-end machines, train `yolov8n` at `imgsz 480`.
