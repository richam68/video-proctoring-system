import React, { useEffect, useState, useRef } from "react";

// Utility function to map event type to color
const getEventColor = (type) => {
  switch (type) {
    case "object_detected":
    case "multiple_faces":
    case "look_away":
    case "no_face_present":
    case "eyes_closed":
      return "#ffc107"; // warning amber
    case "session_stopped":
      return "#dc3545"; // danger red
    default:
      return "#28a745"; // success green
  }
};

function CameraFeed({ cameraOn, recordingOn, onRecordingData }) {
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const recordedChunks = useRef([]);

  useEffect(() => {
    if (cameraOn) {
      (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          if (videoRef.current) videoRef.current.srcObject = stream;
          streamRef.current = stream;
        } catch (err) {
          alert("Error accessing webcam.");
        }
      })();
    } else if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    }
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [cameraOn]);

  useEffect(() => {
    if (recordingOn) {
      recordedChunks.current = [];
      mediaRecorderRef.current = new window.MediaRecorder(streamRef.current, { mimeType: "video/webm" });
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.current.push(e.data);
      };
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(recordedChunks.current, { type: "video/webm" });
        onRecordingData(blob);
      };
      mediaRecorderRef.current.start();
    } else if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }, [recordingOn, onRecordingData]);

  return cameraOn ? (
    <video ref={videoRef} autoPlay playsInline muted style={{ width: "400px", border: "1px solid black" }} />
  ) : (
    <div style={{ width: 400, height: 300, border: "1px solid black", background: "#eee" }}>
      <span style={{ color: "#888", fontSize: 18, padding: "40px" }}>Camera Off</span>
    </div>
  );
}

export default function Interview() {
  const [cameraOn, setCameraOn] = useState(false);
  const [recordingOn, setRecordingOn] = useState(false);
  const [events, setEvents] = useState([]);
  const [report, setReport] = useState(null);
  const [videoBlob, setVideoBlob] = useState(null);

  // WebSocket: subscribe to backend events
  useEffect(() => {
    if (!cameraOn) return;
    const ws = new WebSocket("ws://localhost:8000/ws/events");
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setEvents((prev) => [...prev, data]);
      // Show error on suspicious events
      if (["object_detected", "no_face_present", "multiple_faces"].includes(data.type)) {
        alert(`Warning: ${data.type.replace("_", " ")} detected!`);
      }
    };
    ws.onclose = () => {};
    return () => ws.close();
  }, [cameraOn]);

  const startCamera = () => setCameraOn(true);
  const stopCamera = () => {
    setCameraOn(false);
    setRecordingOn(false);
  };

  const startRecording = async () => {
    setRecordingOn(true);
    await fetch("http://localhost:8000/start", { method: "POST" });
  };

  const stopRecording = async () => {
    setRecordingOn(false);
    await fetch("http://localhost:8000/stop", { method: "POST" });
    fetchReport();
  };

  const fetchReport = async () => {
    const res = await fetch("http://localhost:8000/report");
    const data = await res.json();
    setReport(data);
  };

  const downloadRecording = () => {
    if (videoBlob) {
      const url = URL.createObjectURL(videoBlob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = "interview_recording.webm";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 100);
    } else {
      // Download from backend if exists there
      window.location.href = "http://localhost:8000/download";
    }
  };

  const resetSession = async () => {
    setEvents([]);
    setReport(null);
    setVideoBlob(null);
    await fetch("http://localhost:8000/reset", { method: "POST" });
    alert("Session reset. Please start camera and recording again.");
  };

  return (
    <div>
      <h2>Live Proctoring Interview</h2>
      <CameraFeed
        cameraOn={cameraOn}
        recordingOn={recordingOn}
        onRecordingData={setVideoBlob}
      />

      <div style={{ marginTop: "10px" }}>
        <button onClick={startCamera} disabled={cameraOn}>Start Camera</button>
        <button onClick={stopCamera} disabled={!cameraOn}>Stop Camera</button>
        <button onClick={startRecording} disabled={!cameraOn || recordingOn}>Start Recording</button>
        <button onClick={stopRecording} disabled={!cameraOn || !recordingOn}>Stop Recording</button>
        <button onClick={downloadRecording} disabled={!videoBlob && !report}>Download Recording</button>
        <button onClick={resetSession}>Reset</button>
      </div>

      <div style={{ maxHeight: 200, overflowY: "auto", marginTop: 10, border: "1px solid #ccc" }}>
        {events.map((e, i) => (
          <div key={i} style={{ color: getEventColor(e.type) }}>
            <strong>{e.type}</strong> - {JSON.stringify(e.data)} ({e.timestamp})
          </div>
        ))}
      </div>

      {report && (
        <div style={{ marginTop: "20px" }}>
          <h3>Final Report</h3>
          <pre style={{ background: "#f5f5f5", color: "#333" }}>{JSON.stringify(report, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
