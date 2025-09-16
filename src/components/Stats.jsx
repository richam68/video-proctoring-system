export default function Stats({ counters }) {
    return (
      <div style={{ marginTop: 12 }}>
        <div><strong>Focus lost:</strong> {counters.focusLost}</div>
        <div><strong>No face:</strong> {counters.noFace}</div>
        <div><strong>Multiple faces:</strong> {counters.multipleFaces}</div>
        <div><strong>Phone:</strong> {counters.phoneDetected}</div>
        <div><strong>Books/Notes:</strong> {counters.bookDetected}</div>
        <div><strong>Extra devices:</strong> {counters.deviceDetected}</div>
      </div>
    );
  }
  