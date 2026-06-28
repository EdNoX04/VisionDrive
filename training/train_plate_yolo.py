"""
Train a licence-plate detector with Ultralytics YOLO and export it to the
TensorFlow.js format that this web app loads.

Usage:
    pip install -r requirements.txt
    python train_plate_yolo.py --epochs 100 --imgsz 640 --model yolov8n.pt

After it finishes you'll get:  runs/detect/plate/weights/best_web_model/model.json
Serve that folder over HTTP(S) (with CORS enabled) and paste the model.json URL
into the app's "YOLO plate model" panel. Choose format "YOLOv8".
"""

import argparse
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data.yaml", help="dataset yaml")
    ap.add_argument("--model", default="yolov8n.pt", help="base weights (n=fastest)")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--name", default="plate")
    ap.add_argument("--no-export", action="store_true", help="skip tfjs export")
    args = ap.parse_args()

    from ultralytics import YOLO

    model = YOLO(args.model)
    model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        name=args.name,
    )

    # Validate.
    metrics = model.val()
    print("mAP50-95:", metrics.box.map, " mAP50:", metrics.box.map50)

    if not args.no_export:
        # Export the best weights to TF.js (creates *_web_model/model.json).
        best = Path("runs/detect") / args.name / "weights" / "best.pt"
        if best.exists():
            YOLO(str(best)).export(format="tfjs", imgsz=args.imgsz)
            print(f"\nExported TF.js model next to {best} (folder ends in _web_model).")
            print("Serve it over HTTP with CORS and load model.json in the app.")
        else:
            print("best.pt not found; train first or export manually:")
            print("  yolo export model=best.pt format=tfjs")


if __name__ == "__main__":
    main()
