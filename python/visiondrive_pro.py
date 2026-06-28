"""
VisionDrive Pro — improved ANPR desktop app (PyQt5 + YOLOv5 + EasyOCR).

An upgrade of the original VisionDrive that adds:
  - a real centroid tracker with stable IDs (fixes the index-based ID bug),
  - dedicated plate localisation before OCR,
  - country plate-format validation + OCR auto-correction (O/0, I/1, S/5...),
  - shade-aware colour names (Maroon, Navy, Olive, Brown, Indigo...),
  - evidence snapshots saved per vehicle,
  - a CSV detection log export.

Run:  python visiondrive_pro.py
"""

import os
import sys
import csv
import time
import datetime

import cv2
import numpy as np
import torch

from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QPushButton, QLabel, QFileDialog, QComboBox,
    QDoubleSpinBox, QSpinBox, QCheckBox, QWidget, QVBoxLayout, QHBoxLayout, QGroupBox,
)
from PyQt5.QtCore import QTimer, Qt
from PyQt5.QtGui import QImage, QPixmap

from vd.tracker import Tracker
from vd.color_detect import detect_color
from vd.plate_locator import locate_plate
from vd.ocr import read_plate
from vd.plate_format import format_options

VEHICLE_CLASSES = {2, 5, 7, 3}  # car, bus, truck, motorcycle (COCO)
CLASS_COLORS = {"car": (235, 130, 59), "truck": (11, 158, 245),
                "bus": (168, 85, 247), "motorcycle": (16, 185, 129)}
CAPTURE_DIR = "captures"


class VisionDrivePro(QMainWindow):
    def __init__(self):
        super().__init__()
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.gpu = self.device.type == "cuda"

        self._init_ui()

        # Models (YOLOv5 + EasyOCR loaded lazily inside the modules).
        self.model = torch.hub.load("ultralytics/yolov5", "yolov5s", device=self.device)

        self.tracker = Tracker(meters_per_pixel=self.calib.value())
        self.capture = None
        self.video_stream = ""
        self.records = {}          # key -> dict
        self.last_ocr = {}         # id -> timestamp
        self.ocr_interval = 1.2    # seconds between OCR attempts per vehicle
        self.frame_count = 0

        os.makedirs(CAPTURE_DIR, exist_ok=True)

        self.timer = QTimer()
        self.timer.timeout.connect(self.update_frame)

    # ---------------------------------------------------------------- UI
    def _init_ui(self):
        self.setWindowTitle("VisionDrive Pro — ANPR System")
        self.setGeometry(100, 100, 1320, 760)

        central = QWidget()
        self.setCentralWidget(central)
        root = QHBoxLayout(central)

        # Sidebar.
        side = QVBoxLayout()
        root.addLayout(side, 0)

        src_box = QGroupBox("Source")
        sb = QVBoxLayout(src_box)
        self.start_button = QPushButton("Start (webcam/loaded)")
        self.start_button.clicked.connect(self.start_video)
        self.stop_button = QPushButton("Stop")
        self.stop_button.clicked.connect(self.stop_video)
        self.load_button = QPushButton("Load video file")
        self.load_button.clicked.connect(self.load_video)
        for b in (self.start_button, self.stop_button, self.load_button):
            sb.addWidget(b)
        side.addWidget(src_box)

        set_box = QGroupBox("Settings")
        st = QVBoxLayout(set_box)

        st.addWidget(QLabel("Calibration (metres / pixel)"))
        self.calib = QDoubleSpinBox()
        self.calib.setRange(0.005, 0.5)
        self.calib.setSingleStep(0.005)
        self.calib.setDecimals(3)
        self.calib.setValue(0.05)
        self.calib.valueChanged.connect(lambda v: self.tracker.set_calibration(v))
        st.addWidget(self.calib)

        st.addWidget(QLabel("Speed limit (km/h, 0 = off)"))
        self.limit = QSpinBox()
        self.limit.setRange(0, 200)
        self.limit.setValue(60)
        st.addWidget(self.limit)

        st.addWidget(QLabel("Plate region / format"))
        self.fmt = QComboBox()
        for key, label in format_options():
            self.fmt.addItem(label, key)
        st.addWidget(self.fmt)

        self.use_locator = QCheckBox("Dedicated plate localisation")
        self.use_locator.setChecked(True)
        st.addWidget(self.use_locator)
        self.do_color = QCheckBox("Colour detection")
        self.do_color.setChecked(True)
        st.addWidget(self.do_color)
        self.save_caps = QCheckBox("Save evidence snapshots")
        self.save_caps.setChecked(True)
        st.addWidget(self.save_caps)

        side.addWidget(set_box)

        self.export_button = QPushButton("Export CSV log")
        self.export_button.clicked.connect(self.export_csv)
        side.addWidget(self.export_button)

        self.status = QLabel("Device: " + ("GPU" if self.gpu else "CPU"))
        self.status.setStyleSheet("color:#666")
        side.addWidget(self.status)
        side.addStretch(1)

        # Video display.
        self.video_label = QLabel()
        self.video_label.setStyleSheet("background-color: black;")
        self.video_label.setAlignment(Qt.AlignCenter)
        self.video_label.setMinimumSize(1000, 700)
        root.addWidget(self.video_label, 1)

    # ------------------------------------------------------------- control
    def start_video(self):
        self.capture = cv2.VideoCapture(0 if not self.video_stream else self.video_stream)
        self.tracker.reset()
        self.timer.start(30)

    def stop_video(self):
        self.timer.stop()
        if self.capture:
            self.capture.release()

    def load_video(self):
        name, _ = QFileDialog.getOpenFileName(
            self, "Select Video File", "", "Video Files (*.mp4 *.avi *.mov *.mkv)")
        if name:
            self.video_stream = name
            self.status.setText("Loaded: " + os.path.basename(name))

    # -------------------------------------------------------------- pipeline
    def update_frame(self):
        ret, frame = self.capture.read()
        if not ret:
            self.stop_video()
            return
        frame = cv2.resize(frame, (960, 540))
        out = self.process(frame)

        rgb = cv2.cvtColor(out, cv2.COLOR_BGR2RGB)
        h, w, ch = rgb.shape
        img = QImage(rgb.data, w, h, ch * w, QImage.Format_RGB888)
        scaled = img.scaled(self.video_label.width(), self.video_label.height(),
                            Qt.KeepAspectRatio)
        self.video_label.setPixmap(QPixmap.fromImage(scaled))

    def process(self, frame):
        results = self.model(frame)
        dets = []
        for *box, conf, cls in results.xyxy[0].tolist():
            if int(cls) in VEHICLE_CLASSES:
                x1, y1, x2, y2 = map(int, box)
                dets.append(((x1, y1, x2, y2), self.model.names[int(cls)], float(conf)))

        now = time.perf_counter()
        active = self.tracker.update(dets, now)
        limit = self.limit.value()
        fmt_key = self.fmt.currentData()

        for tr in active:
            x1, y1, x2, y2 = tr.box
            x1, y1 = max(0, x1), max(0, y1)
            crop = frame[y1:y2, x1:x2]

            # Colour.
            if self.do_color.isChecked() and crop.size:
                tr.color, tr.color_hex = detect_color(crop)

            # Plate localisation + OCR (throttled per vehicle).
            if crop.size and now - self.last_ocr.get(tr.id, 0) > self.ocr_interval:
                self.last_ocr[tr.id] = now
                plate_box = locate_plate(crop) if self.use_locator.isChecked() else None
                if plate_box:
                    px, py, pw, ph = plate_box
                    tr.plate_box = (x1 + px, y1 + py, pw, ph)
                    plate_crop = crop[py:py + ph, px:px + pw]
                else:
                    ph0 = int((y2 - y1) * 0.55)
                    tr.plate_box = None
                    plate_crop = crop[ph0:, :]
                res = read_plate(plate_crop, fmt_key, gpu=self.gpu)
                if res and (res["valid"] in (True, None)):
                    tr.plate = res["display"]
                    if self.save_caps.isChecked():
                        self._save_snapshot(tr, plate_crop, crop)

            self._record(tr)
            self._draw(frame, tr, limit)

        cv2.putText(frame, f"Vehicles: {len(active)}  Logged: {len(self.records)}",
                    (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        self.frame_count += 1
        return frame

    def _draw(self, frame, tr, limit):
        x1, y1, x2, y2 = tr.box
        over = limit > 0 and tr.speed_kmh > limit
        color = (0, 0, 255) if over else CLASS_COLORS.get(tr.cls, (235, 130, 59))
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        if tr.plate_box:
            px, py, pw, ph = tr.plate_box
            cv2.rectangle(frame, (px, py), (px + pw, py + ph), (238, 210, 34), 2)

        lines = [f"#{tr.id} {tr.cls} {tr.speed_kmh:.0f} km/h"]
        if tr.plate:
            lines.append(tr.plate)
        if tr.color:
            lines.append(tr.color)
        y = max(15, y1 - 6 - 18 * (len(lines) - 1))
        for i, ln in enumerate(lines):
            yy = y + i * 18
            cv2.putText(frame, ln, (x1, yy), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 3)
            cv2.putText(frame, ln, (x1, yy), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)

    def _record(self, tr):
        if tr.hits < 3 and not tr.plate:
            return
        key = tr.plate or f"id-{tr.id}"
        rec = self.records.get(key, {"first": datetime.datetime.now(), "max": 0})
        rec.update({
            "id": tr.id, "plate": tr.plate or rec.get("plate") or "",
            "type": tr.cls, "color": tr.color or rec.get("color") or "",
            "speed": round(tr.speed_kmh), "max": max(rec.get("max", 0), round(tr.max_speed)),
            "conf": round(tr.score * 100), "last": datetime.datetime.now(),
        })
        self.records[key] = rec

    def _save_snapshot(self, tr, plate_crop, veh_crop):
        stamp = datetime.datetime.now().strftime("%H%M%S")
        tag = (tr.plate or f"id{tr.id}").replace(" ", "")
        try:
            if plate_crop is not None and plate_crop.size:
                cv2.imwrite(os.path.join(CAPTURE_DIR, f"{tag}_{stamp}_plate.jpg"), plate_crop)
            if veh_crop is not None and veh_crop.size:
                cv2.imwrite(os.path.join(CAPTURE_DIR, f"{tag}_{stamp}_veh.jpg"), veh_crop)
        except Exception:
            pass

    def export_csv(self):
        if not self.records:
            return
        name = f"anpr-log-{int(time.time())}.csv"
        with open(name, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["Plate", "Type", "Colour", "Speed", "Max", "Conf%", "First seen", "Last seen"])
            for r in sorted(self.records.values(), key=lambda x: x["last"], reverse=True):
                w.writerow([r.get("plate", ""), r.get("type", ""), r.get("color", ""),
                            r.get("speed", 0), r.get("max", 0), r.get("conf", 0),
                            r["first"].strftime("%H:%M:%S"), r["last"].strftime("%H:%M:%S")])
        self.status.setText("Saved " + name)

    def resizeEvent(self, event):
        super().resizeEvent(event)


def main():
    app = QApplication(sys.argv)
    win = VisionDrivePro()
    win.show()
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
