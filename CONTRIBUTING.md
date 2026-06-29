# Contributing

Thanks for your interest in improving VisionDrive!

## Project layout

- `web/` — React + Vite app (browser-only ML).
- `python/` — PyQt5 desktop app (YOLOv5 + EasyOCR).
- `training/` — scripts to train and export a YOLO plate model.

## Development

### Web

```bash
cd web
npm install
npm run dev        # dev server
npm run build      # production build (run before opening a PR)
```

The detection pipeline lives in `web/src/hooks/useAnpr.js`; the swappable stages
(detector, tracker, colour, plate locator, plate model, OCR, format) live in
`web/src/lib/`. Keep each stage independent so it can be replaced.

### Python

```bash
cd python
pip install -r requirements.txt
python -m py_compile vd/*.py visiondrive_pro.py   # quick syntax check
python visiondrive_pro.py
```

## Pull requests

1. Branch from `main`.
2. Keep changes focused; update the relevant README if behaviour changes.
3. For the web app, make sure `npm run build` succeeds.
4. Describe what you changed and how you tested it.

## Reporting bugs

Open an issue with: what you did, what you expected, what happened, and your
environment (browser/OS or Python/OS, GPU or CPU).
