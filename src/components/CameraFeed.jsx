function CameraFeed() {
  return (
    <video
      autoPlay
      playsInline
      muted
      style={{ width: "400px", border: "1px solid black" }}
      ref={(video) => {
        if (video) {
          navigator.mediaDevices
            .getUserMedia({ video: true, audio: true })
            .then((stream) => {
              video.srcObject = stream;
            })
            .catch((err) => console.error("Error accessing webcam:", err));
        }
      }}
    />
  );
}
export default CameraFeed;
