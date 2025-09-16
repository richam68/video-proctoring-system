# proctor_server.py
import asyncio
import json
import time
import uuid
from datetime import datetime
from typing import List, Dict, Any

import cv2
import mediapipe as mp
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel
from ultralytics import YOLO
import numpy as np

VIDEO_SOURCE = 0
OUTPUT_VIDEO = "recorded_interview.mp4"
LOG_JSON = "proctor_events.json"
FRAME_WIDTH = 640
FRAME_HEIGHT = 480
FPS = 20

LOOK_AWAY_SECONDS = 5
NO_FACE_SECONDS = 10
CONFIDENCE_THRESHOLD = 0.35
YOLO_DETECT_CLASSES = {"cell phone", "book", "laptop", "tablet", "earphone", "headphones", "keyboard", "mouse"}

def now_ts() -> str:
    return datetime.utcnow().isoformat() + "Z"

class Event(BaseModel):
    id: str
    timestamp: str
    type: str
    data: Dict[str, Any]

class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active.append(websocket)

    def disconnect(self, websocket: WebSocket):
        try:
            self.active.remove(websocket)
        except ValueError:
            pass

    async def broadcast(self, message: Dict[str, Any]):
        living = []
        for conn in list(self.active):
            try:
                await conn.send_json(message)
                living.append(conn)
            except Exception:
                pass
        self.active = living

manager = ConnectionManager()

class ProctorPipeline:
    # ...init same as before
    def process_frame(self, frame):
        image_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(image_rgb)
        faces = []
        if results.multi_face_landmarks:
            for face_landmarks in results.multi_face_landmarks:
                faces.append(face_landmarks.landmark)

        face_count = len(faces)
        # Multiple faces event
        if face_count >= 2:
            self.log_event("multiple_faces", {"count": face_count})

        # No face present event
        if face_count == 0:
            now_ = time.time()
            if self.absence_start is None:
                self.absence_start = now_
            elif now_ - self.absence_start >= NO_FACE_SECONDS:
                self.log_event("no_face_present", {"duration_seconds": int(now_ - self.absence_start)})
                self.absence_start = None
        else:
            self.absence_start = None

        # Head pose & attention
        if face_count >= 1:
            lm = faces
            yaw, pitch, roll = self.estimate_head_pose(lm, frame.shape)
            eye_openness = abs(lm.y - lm.y)  # Example eye-open measure
            is_looking_away = abs(yaw) > 25
            if is_looking_away:
                if self.lookaway_start is None:
                    self.lookaway_start = time.time()
                elif time.time() - self.lookaway_start >= LOOK_AWAY_SECONDS:
                    self.log_event("look_away", {"duration_seconds": int(time.time() - self.lookaway_start), "yaw": yaw})
                    self.lookaway_start = None
            else:
                self.lookaway_start = None
            # Eye closed warning (threshold chosen empirically)
            if eye_openness < 0.02:
                self.log_event("eyes_closed", {"eye_openness": eye_openness})

        # YOLO detection
        if self.frame_index % self.detection_stride == 0:
            yolo_results = self.yolo.predict(frame, imgsz=640, conf=CONFIDENCE_THRESHOLD, verbose=False)
            detections = []
            if yolo_results:
                r = yolo_results
                boxes = r.boxes
                for box in boxes:
                    cls = int(box.cls.cpu().numpy())
                    conf = float(box.conf.cpu().numpy())
                    names_dict = getattr(self.yolo, "names", None) or getattr(self.yolo.model, "names", {})
                    name = names_dict.get(cls, str(cls))
                    if name in YOLO_DETECT_CLASSES and conf >= CONFIDENCE_THRESHOLD:
                        xyxy = box.xyxy.cpu().numpy().tolist()
                        self.log_event("object_detected", {"name": name, "conf": conf, "xyxy": xyxy})

        self.writer.write(frame)
        self.frame_index += 1
        return frame

    def shutdown(self):
        self.running = False
        try:
            self.cap.release()
        except: pass
        try:
            self.writer.release()
        except: pass
        cv2.destroyAllWindows()
        if self.events:
            try:
                self.log_event("session_stopped", {"events": len(self.events)})
            except: pass

pipeline = ProctorPipeline()

app = FastAPI(title="Proctoring Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Start is now exposed via an endpoint instead of auto-starting

@app.websocket("/ws/events")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    while True:
        try:
            await ws.receive_text()
        except WebSocketDisconnect:
            break

@app.post("/start")
async def start_session():
    if not pipeline.running:
        asyncio.create_task(pipeline.run_loop())
        return {"status": "started"}
    return {"status": "already_running"}

@app.post("/stop")
async def stop_and_dump():
    pipeline.running = False
    pipeline.shutdown()
    return {"status": "stopped"}

@app.post("/reset")
async def reset_session():
    pipeline.running = False
    pipeline.reset()
    return {"status": "reset"}

@app.get("/report")
async def get_report():
    events = pipeline.events
    suspicious_count = sum(
        1 for e in events if e["type"] in ("look_away", "no_face_present", "multiple_faces", "object_detected", "eyes_closed")
    )
    integrity_score = max(0, 100 - 5 * suspicious_count)
    summary = {
        "candidate_name": getattr(pipeline, "candidate_name", "UNKNOWN"),
        "events_count": len(events),
        "suspicious_count": suspicious_count,
        "final_integrity_score": integrity_score,
        "events": events,
        "recorded_video": pipeline.writer.filename,
    }
    return JSONResponse(content=summary)

@app.get("/download")
async def download_video():
    return FileResponse("recorded_interview.mp4", media_type="video/mp4", filename="interview_recording.mp4")

