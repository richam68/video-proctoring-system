export default function Controls({
  isStreaming,
  isRecording,
  reportOpen,
  downloadUrl,
  onStartStream,
  onStopStream,
  onStartRecording,
  onStopRecording,
  onToggleReport,
  onResetSession,
  loading
}) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {!isStreaming && (
        <button onClick={onStartStream} disabled={!!loading?.start}>
          {loading?.start ? "Starting..." : "Start Camera"}
        </button>
      )}
      {isStreaming && (
        <button onClick={onStopStream} disabled={!!loading?.stop}>
          {loading?.stop ? "Stopping..." : "Stop Camera"}
        </button>
      )}
      {isStreaming && !isRecording && (
        <button onClick={onStartRecording} disabled={!!loading?.record}>
          {loading?.record ? "Starting Rec..." : "Start Recording"}
        </button>
      )}
      {isStreaming && isRecording && (
        <button onClick={onStopRecording} disabled={!!loading?.record}>
          {loading?.record ? "Stopping Rec..." : "Stop Recording"}
        </button>
      )}
      <button onClick={onToggleReport}>{reportOpen ? "Hide" : "Show"} Report</button>
      <button onClick={onResetSession} disabled={!!loading?.reset}>
        {loading?.reset ? "Resetting..." : "Reset"}
      </button>
      {downloadUrl && (
        <a href={downloadUrl} download={`interview-${Date.now()}.webm`} style={{ textDecoration: "none" }}>
          <button>Download Recording</button>
        </a>
      )}
    </div>
  );
}
