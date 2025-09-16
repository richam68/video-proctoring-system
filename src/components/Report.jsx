function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
    const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
    const s = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  }
  
  export default function Report({ elapsedMs, counters, integrityScore }) {
    return (
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
        <h3>Proctoring Report</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div><strong>Candidate:</strong> Anonymous</div>
          <div><strong>Duration:</strong> {formatTime(elapsedMs)}</div>
          <div><strong>Focus lost:</strong> {counters.focusLost}</div>
          <div>
            <strong>Suspicious events:</strong>{" "}
            {counters.multipleFaces +
              counters.noFace +
              counters.phoneDetected +
              counters.bookDetected +
              counters.deviceDetected}
          </div>
          <div><strong>Integrity score:</strong> {integrityScore}</div>
        </div>
      </div>
    );
  }
  