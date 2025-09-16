export default function EventsTable({ events }) {
    return (
      <div>
        <h3>Live Events</h3>
        <div
          style={{
            maxHeight: 220,
            overflow: "auto",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Time</th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Event</th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Details</th>
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
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", width: 80 }}>{e.time}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{e.label}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{e.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  