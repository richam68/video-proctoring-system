import { useEffect, useRef, useState } from 'react'
import * as tf from '@tensorflow/tfjs'
import * as faceLandmarksDetection from '@tensorflow-models/face-landmarks-detection'
import '@mediapipe/face_mesh'
import * as cocoSsd from '@tensorflow-models/coco-ssd'

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0')
  const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0')
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0')
  return `${h}:${m}:${s}`
}

export default function Interview() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const recordedChunksRef = useRef([])
  const detectionRafRef = useRef(0)
  const lastObjectDetectRef = useRef(0)
  const isStartingRef = useRef(false)

  const [isStreaming, setIsStreaming] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState('')
  const [startTime, setStartTime] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [reportOpen, setReportOpen] = useState(false)

  const [events, setEvents] = useState([])
  const [counters, setCounters] = useState({
    focusLost: 0,
    noFace: 0,
    multipleFaces: 0,
    phoneDetected: 0,
    bookDetected: 0,
    deviceDetected: 0,
  })

  const modelsRef = useRef({ face: null, object: null })

  // State for ongoing conditions
  const lookingAwaySinceRef = useRef(0)
  const noFaceSinceRef = useRef(0)

  useEffect(() => {
    let timer = 0
    if (isStreaming) {
      timer = setInterval(() => {
        if (startTime) setElapsedMs(Date.now() - startTime)
      }, 1000)
    }
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [isStreaming, startTime])

  async function initModels() {
    if (!modelsRef.current.face) {
      modelsRef.current.face = await faceLandmarksDetection.createDetector(
        faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
        { runtime: 'tfjs', refineLandmarks: false, maxFaces: 2 }
      )
    }
    if (!modelsRef.current.object) {
      modelsRef.current.object = await cocoSsd.load({ base: 'lite_mobilenet_v2' })
    }
  }

  function addEvent(label, details = '') {
    const time = formatTime(elapsedMs)
    setEvents((prev) => [{ time, label, details }, ...prev])
  }

  function incCounter(key) {
    setCounters((c) => ({ ...c, [key]: (c[key] || 0) + 1 }))
  }

  async function startStream() {
    if (isStartingRef.current || isStreaming) return
    isStartingRef.current = true
    try {
      await initModels()
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true })
      const video = videoRef.current
      try {
        if (video.srcObject) {
          try { await video.pause() } catch {}
          video.srcObject = null
        }
        video.srcObject = stream
        await video.play()
      } catch (err) {
        // Handle AbortError: try a micro retry
        if (err && err.name === 'AbortError') {
          await new Promise((r) => setTimeout(r, 50))
          try { await video.play() } catch {}
        } else {
          throw err
        }
      }
      setIsStreaming(true)
      setStartTime(Date.now())
      setElapsedMs(0)
      setReportOpen(false)
      startDetectionLoop()
    } catch (err) {
      console.error(err)
      addEvent('Error', 'Could not access camera/microphone')
    } finally {
      isStartingRef.current = false
    }
  }

  async function stopStream() {
    const video = videoRef.current
    const stream = video.srcObject
    // Ensure recording stops before stopping tracks
    if (isRecording) {
      try { await stopRecording() } catch {}
    }
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
    }
    try { await video.pause() } catch {}
    video.srcObject = null
    setIsStreaming(false)
    cancelAnimationFrame(detectionRafRef.current)
    detectionRafRef.current = 0
    lookingAwaySinceRef.current = 0
    noFaceSinceRef.current = 0
  }

  function startRecording() {
    const video = videoRef.current
    const stream = video.srcObject
    if (!stream) return
    recordedChunksRef.current = []
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus' })
    mediaRecorderRef.current = mediaRecorder
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data)
    }
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      setDownloadUrl((old) => {
        if (old) URL.revokeObjectURL(old)
        return url
      })
    }
    mediaRecorder.start()
    setIsRecording(true)
    addEvent('Recording started')
  }

  function stopRecording() {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder) return resolve()
      const finish = () => {
        setIsRecording(false)
        addEvent('Recording stopped')
        resolve()
      }
      if (recorder.state === 'inactive') return finish()
      const onStop = () => {
        recorder.removeEventListener('stop', onStop)
        finish()
      }
      recorder.addEventListener('stop', onStop)
      try {
        // Flush remaining data before stopping
        try { recorder.requestData() } catch {}
        recorder.stop()
      } catch {
        recorder.removeEventListener('stop', onStop)
        finish()
      }
      // Fallback timeout in case 'stop' never fires
      setTimeout(() => {
        try { recorder.removeEventListener('stop', onStop) } catch {}
        finish()
      }, 2000)
    })
  }

  function drawDetections(ctx, faces, objects) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.strokeStyle = '#22c55e'
    ctx.lineWidth = 2
    // Faces - draw bounding box and eye tracking
    faces.forEach((face) => {
      const keypoints = face.keypoints || face.scaledMesh || []
      if (keypoints.length) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        keypoints.forEach((pt) => {
          const x = pt.x ?? pt[0]
          const y = pt.y ?? pt[1]
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        })
        ctx.strokeStyle = '#22c55e'
        ctx.strokeRect(minX, minY, maxX - minX, maxY - minY)
        
        // Draw eye tracking points
        const leftEyeIndices = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
        const rightEyeIndices = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
        
        ctx.fillStyle = '#ff0000'
        leftEyeIndices.forEach(idx => {
          if (keypoints[idx]) {
            const pt = keypoints[idx]
            const x = pt.x ?? pt[0]
            const y = pt.y ?? pt[1]
            ctx.fillRect(x - 2, y - 2, 4, 4)
          }
        })
        
        ctx.fillStyle = '#00ff00'
        rightEyeIndices.forEach(idx => {
          if (keypoints[idx]) {
            const pt = keypoints[idx]
            const x = pt.x ?? pt[0]
            const y = pt.y ?? pt[1]
            ctx.fillRect(x - 2, y - 2, 4, 4)
          }
        })
      }
    })

    // Objects
    if (objects) {
      ctx.strokeStyle = '#ef4444'
      ctx.fillStyle = 'rgba(239, 68, 68, 0.15)'
      objects.forEach((obj) => {
        const [x, y, w, h] = obj.bbox
        ctx.fillRect(x, y, w, h)
        ctx.strokeRect(x, y, w, h)
        ctx.fillStyle = '#ef4444'
        ctx.font = '16px sans-serif'
        ctx.fillText(`${obj.class} ${(obj.score * 100).toFixed(0)}%`, x + 4, y + 18)
        ctx.fillStyle = 'rgba(239, 68, 68, 0.15)'
      })
    }
  }

  function analyzeFocus(faces) {
    const now = Date.now()
    if (!faces || faces.length === 0) {
      // No face condition - more sensitive detection
      if (!noFaceSinceRef.current) noFaceSinceRef.current = now
      if (now - noFaceSinceRef.current > 3000) { // Reduced from 10s to 3s
        addEvent('No face detected >3s')
        incCounter('noFace')
        noFaceSinceRef.current = now + 10000 // throttle for 10s
      }
      // Reset looking-away timer since no face
      lookingAwaySinceRef.current = 0
      return
    }

    // Reset no-face
    noFaceSinceRef.current = 0

    if (faces.length > 1) {
      addEvent('Multiple faces detected')
      incCounter('multipleFaces')
    }

    // Enhanced eye tracking using MediaPipe face mesh landmarks
    const face = faces[0]
    const kps = face.keypoints || face.scaledMesh || []
    if (kps.length === 0) return

    // MediaPipe face mesh landmark indices for eyes
    // Left eye: 33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246
    // Right eye: 362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398
    // Nose tip: 1
    // Face center landmarks: 10, 152
    
    const leftEyeIndices = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
    const rightEyeIndices = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
    const noseIndex = 1
    const faceCenterIndices = [10, 152]

    // Calculate eye centers
    const leftEyeCenter = calculateLandmarkCenter(kps, leftEyeIndices)
    const rightEyeCenter = calculateLandmarkCenter(kps, rightEyeIndices)
    const noseTip = kps[noseIndex] || kps[0]
    const faceCenter = calculateLandmarkCenter(kps, faceCenterIndices)

    if (!leftEyeCenter || !rightEyeCenter || !noseTip || !faceCenter) return

    // Calculate eye gaze direction
    const leftEyeGaze = calculateGazeDirection(leftEyeCenter, faceCenter)
    const rightEyeGaze = calculateGazeDirection(rightEyeCenter, faceCenter)
    const averageGaze = {
      x: (leftEyeGaze.x + rightEyeGaze.x) / 2,
      y: (leftEyeGaze.y + rightEyeGaze.y) / 2
    }

    // Calculate head pose using nose tip relative to face center
    const headPose = {
      yaw: Math.abs(noseTip.x - faceCenter.x) / Math.max(1, Math.abs(faceCenter.x)),
      pitch: Math.abs(noseTip.y - faceCenter.y) / Math.max(1, Math.abs(faceCenter.y))
    }

    // More sensitive thresholds for cheating detection
    const isLookingAway = 
      Math.abs(averageGaze.x) > 0.15 || // Looking left/right
      Math.abs(averageGaze.y) > 0.2 ||  // Looking up/down
      headPose.yaw > 0.2 ||             // Head turned left/right
      headPose.pitch > 0.25             // Head tilted up/down

    if (isLookingAway) {
      if (!lookingAwaySinceRef.current) lookingAwaySinceRef.current = now
      if (now - lookingAwaySinceRef.current > 2000) { // Reduced from 5s to 2s
        addEvent('User looking away >2s')
        incCounter('focusLost')
        lookingAwaySinceRef.current = now + 5000 // throttle for 5s
      }
    } else {
      lookingAwaySinceRef.current = 0
    }
  }

  function calculateLandmarkCenter(landmarks, indices) {
    let sumX = 0, sumY = 0, count = 0
    indices.forEach(idx => {
      if (landmarks[idx]) {
        const pt = landmarks[idx]
        sumX += pt.x ?? pt[0] ?? 0
        sumY += pt.y ?? pt[1] ?? 0
        count++
      }
    })
    return count > 0 ? { x: sumX / count, y: sumY / count } : null
  }

  function calculateGazeDirection(eyeCenter, faceCenter) {
    const dx = eyeCenter.x - faceCenter.x
    const dy = eyeCenter.y - faceCenter.y
    const distance = Math.sqrt(dx * dx + dy * dy)
    return {
      x: distance > 0 ? dx / distance : 0,
      y: distance > 0 ? dy / distance : 0
    }
  }

  async function startDetectionLoop() {
    const faceModel = modelsRef.current.face
    const objectModel = modelsRef.current.object
    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    const onFrame = async () => {
      if (!video || video.readyState < 2) {
        detectionRafRef.current = requestAnimationFrame(onFrame)
        return
      }
      // Resize canvas to video frame
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }

      let faces = []
      try {
        faces = await faceModel.estimateFaces(video, { flipHorizontal: false })
      } catch (e) {
        // ignore frame errors
      }

      let objects = null
      const now = performance.now()
      if (now - lastObjectDetectRef.current > 500) {
        try {
          objects = await objectModel.detect(video)
        } catch (e) {
          // ignore
        }
        lastObjectDetectRef.current = now
        if (objects && objects.length) {
          const detectedClasses = objects.map((o) => o.class.toLowerCase())
          if (detectedClasses.some((c) => c.includes('cell phone') || c.includes('phone'))) {
            addEvent('Phone detected')
            incCounter('phoneDetected')
          }
          if (detectedClasses.some((c) => c.includes('book'))) {
            addEvent('Book/notes detected')
            incCounter('bookDetected')
          }
          if (detectedClasses.some((c) => c.includes('laptop') || c.includes('tv') || c.includes('keyboard') || c.includes('mouse') || c.includes('monitor'))) {
            addEvent('Extra device detected')
            incCounter('deviceDetected')
          }
        }
      }

      drawDetections(ctx, faces, objects)
      analyzeFocus(faces)

      detectionRafRef.current = requestAnimationFrame(onFrame)
    }

    detectionRafRef.current = requestAnimationFrame(onFrame)
  }

  function resetSession() {
    setEvents([])
    setCounters({ focusLost: 0, noFace: 0, multipleFaces: 0, phoneDetected: 0, bookDetected: 0, deviceDetected: 0 })
    setDownloadUrl((old) => {
      if (old) URL.revokeObjectURL(old)
      return ''
    })
    setElapsedMs(0)
    setStartTime(0)
    lookingAwaySinceRef.current = 0
    noFaceSinceRef.current = 0
  }

  const integrityScore = Math.max(
    0,
    100 - counters.focusLost * 5 - counters.noFace * 10 - counters.multipleFaces * 15 - (counters.phoneDetected + counters.bookDetected + counters.deviceDetected) * 10
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
      <h2>Interview Proctoring</h2>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <video ref={videoRef} playsInline muted style={{ width: 640, height: 360, background: '#000', borderRadius: 8 }} />
          <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: 640, height: 360, pointerEvents: 'none' }} />
        </div>

        <div style={{ minWidth: 280 }}>
          <div style={{ marginBottom: 8 }}>
            <strong>Elapsed:</strong> {formatTime(elapsedMs)}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!isStreaming && (
              <button onClick={startStream}>Start Camera</button>
            )}
            {isStreaming && (
              <button onClick={stopStream}>Stop Camera</button>
            )}
            {isStreaming && !isRecording && (
              <button onClick={startRecording}>Start Recording</button>
            )}
            {isStreaming && isRecording && (
              <button onClick={stopRecording}>Stop Recording</button>
            )}
            <button onClick={() => setReportOpen((v) => !v)}>{reportOpen ? 'Hide' : 'Show'} Report</button>
            <button onClick={resetSession}>Reset</button>
            {downloadUrl && (
              <a href={downloadUrl} download={`interview-${Date.now()}.webm`} style={{ textDecoration: 'none' }}>
                <button>Download Recording</button>
              </a>
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <div><strong>Focus lost:</strong> {counters.focusLost}</div>
            <div><strong>No face:</strong> {counters.noFace}</div>
            <div><strong>Multiple faces:</strong> {counters.multipleFaces}</div>
            <div><strong>Phone:</strong> {counters.phoneDetected}</div>
            <div><strong>Books/Notes:</strong> {counters.bookDetected}</div>
            <div><strong>Extra devices:</strong> {counters.deviceDetected}</div>
          </div>
        </div>
      </div>

      {reportOpen && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
          <h3>Proctoring Report</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div><strong>Candidate:</strong> Anonymous</div>
            <div><strong>Duration:</strong> {formatTime(elapsedMs)}</div>
            <div><strong>Focus lost:</strong> {counters.focusLost}</div>
            <div><strong>Suspicious events:</strong> {counters.multipleFaces + counters.noFace + counters.phoneDetected + counters.bookDetected + counters.deviceDetected}</div>
            <div><strong>Integrity score:</strong> {integrityScore}</div>
          </div>
        </div>
      )}

      <div>
        <h3>Live Events</h3>
        <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #e5e7eb' }}>Time</th>
                <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #e5e7eb' }}>Event</th>
                <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #e5e7eb' }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td style={{ padding: 8 }} colSpan={3}>No events yet</td>
                </tr>
              )}
              {events.map((e, idx) => (
                <tr key={idx}>
                  <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6', width: 80 }}>{e.time}</td>
                  <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6' }}>{e.label}</td>
                  <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6' }}>{e.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}


