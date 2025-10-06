<template>
  <div class="camdiv text-center">
    <!-- Custom Cursor -->
    <div id="custom-cursor" ref="cursor"></div>

    <!-- Toggle Button -->
    <button
      @click="toggleHandsfreeMode"
      :class="['btn', isHandsfreeModeOn ? 'btn-outline-secondary' : 'btn-secondary', 'mb-2']"
    >
      {{ isHandsfreeModeOn ? 'হ্যান্ডস-ফ্রি অফ' : 'হ্যান্ডস-ফ্রি মোড' }}
    </button>

    <!-- Hidden video for camera input -->
    <video ref="video" autoplay playsinline style="display:none;"></video>

    <!-- Canvas for hand landmarks -->
    <canvas
      ref="canvas"
      v-show="isHandsfreeModeOn"
      :style="canvasStyle"
    ></canvas>
  </div>
</template>

<script>
import { Hands } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";
import { drawConnectors, drawLandmarks, HAND_CONNECTIONS } from "@mediapipe/drawing_utils";
import { ToastProgrammatic as Toast } from 'buefy'; // Or any Vue toast library
import 'buefy/dist/buefy.css';

export default {
  data() {
    return {
      isHandsfreeModeOn: false,
      pinchActive: false,
      pinchStart: null,
      isScrolling: false,
      lastPinchTime: 0,
      scrollAmount: 0,
      rAFId: null,
      camera: null,
      hands: null,
      PINCH_DISTANCE_THRESHOLD: 0.08,
      CLICK_DURATION_THRESHOLD_MS: 300,
      SCROLL_MULTIPLIER: 2500,
      MAX_SCROLL: 2000,
      mounted: false,
      canvasStyle: {
        top: "20px",
        right: "20px",
        width: "150px",
        height: "140px",
        pointerEvents: "none",
        borderRadius: "10px",
        border: "2px solid #4d4d4dff",
        zIndex: 1000
      }
    };
  },
  mounted() {
    this.mounted = true;
    this.injectCursorStyle();
  },
  methods: {
    injectCursorStyle() {
      const style = document.createElement("style");
      style.innerHTML = `
        #custom-cursor {
          position: fixed; 
          width: 25px; 
          height: 25px;
          background-color: #ef4444; 
          border: 3px solid #fff;
          border-radius: 50%;
          z-index: 99999; 
          pointer-events: none;
          transition: transform 0.05s ease-out, opacity 0.2s; 
          opacity: 0; 
        }
        #custom-cursor.clicked {
          transform: scale(0.8) translate3d(var(--x), var(--y), 0) translate(-50%, -50%);
          background-color: #f97316;
        }
      `;
      document.head.appendChild(style);
    },

    toggleHandsfreeMode() {
      this.isHandsfreeModeOn = !this.isHandsfreeModeOn;
      if (this.isHandsfreeModeOn) {
        this.startHandsfreeMode();
        Toast.open({
          message: "✋ হ্যান্ডস-ফ্রি মোড চালু হয়েছে! 👉 আঙুল দিয়ে পিঞ্চ করলে ক্লিক, 👉 পিঞ্চ ধরে উপরে/নিচে নাড়ালে স্ক্রল",
          type: "is-success",
          duration: 5000
        });
      } else {
        this.cleanup();
        Toast.open({
          message: "🚫 হ্যান্ডস-ফ্রি মোড বন্ধ হয়েছে।",
          type: "is-warning",
          duration: 3000
        });
      }
    },

    scrollLoop() {
      if (this.scrollAmount !== 0) {
        window.scrollBy({ top: this.scrollAmount, behavior: "auto" });
        this.scrollAmount = 0;
      }
      this.rAFId = requestAnimationFrame(this.scrollLoop);
    },

    simulateClick(x, y) {
      const cursor = this.$refs.cursor;
      if (!cursor) return;
      cursor.style.visibility = "hidden";
      const target = document.elementFromPoint(x, y);
      cursor.style.visibility = "visible";
      if (target) {
        target.click();
        cursor.classList.add("clicked");
        setTimeout(() => cursor.classList.remove("clicked"), 100);
      }
    },

    startHandsfreeMode() {
      this.rAFId = requestAnimationFrame(this.scrollLoop);

      this.hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });

      this.hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
      });

      this.hands.onResults(this.onResults);

      const video = this.$refs.video;
      if (video && !video.srcObject) {
        navigator.mediaDevices.getUserMedia({ video: true })
          .then((stream) => {
            video.srcObject = stream;
            this.camera = new Camera(video, {
              onFrame: async () => await this.hands.send({ image: video }),
              width: 150,
              height: 140
            });
            this.camera.start();
          })
          .catch(err => console.error("Cannot access camera:", err));
      }
    },

    cleanup() {
      if (this.rAFId) cancelAnimationFrame(this.rAFId);
      const video = this.$refs.video;
      if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
      }
      if (this.camera) {
        this.camera.stop();
        this.camera = null;
      }
      if (this.$refs.cursor) this.$refs.cursor.style.opacity = 0;
      this.pinchActive = false;
      this.isScrolling = false;
      this.pinchStart = null;
    },

    onResults(results) {
      const canvas = this.$refs.canvas;
      const video = this.$refs.video;
      const cursor = this.$refs.cursor;
      const currentTime = performance.now();

      if (!canvas || !video || !cursor) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Mirror video
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
      ctx.restore();

      if (!results.multiHandLandmarks?.length) {
        if (this.pinchActive && !this.isScrolling && (currentTime - this.lastPinchTime < this.CLICK_DURATION_THRESHOLD_MS)) {
          this.simulateClick(window.lastCursorX, window.lastCursorY);
        }
        this.pinchActive = false;
        this.isScrolling = false;
        this.pinchStart = null;
        cursor.style.opacity = 0;
        return;
      }

      const landmarks = results.multiHandLandmarks[0].map(l => ({ x: 1 - l.x, y: l.y, z: l.z }));

      const indexTip = landmarks[8];
      const thumbTip = landmarks[4];
      const wrist = landmarks[0];
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const cursorX = indexTip.x * viewportWidth;
      const cursorY = indexTip.y * viewportHeight;

      window.lastCursorX = cursorX;
      window.lastCursorY = cursorY;

      cursor.style.setProperty("--x", `${cursorX}px`);
      cursor.style.setProperty("--y", `${cursorY}px`);
      cursor.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0) translate(-50%, -50%)`;
      cursor.style.opacity = 1;

      drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: "#0f766e", lineWidth: 3 });
      drawLandmarks(ctx, landmarks, { color: "#f15a73ff", lineWidth: 1, radius: 3 });

      // Pinch detection
      const dx = thumbTip.x - indexTip.x;
      const dy = thumbTip.y - indexTip.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < this.PINCH_DISTANCE_THRESHOLD) {
        if (!this.pinchActive) {
          this.pinchActive = true;
          this.lastPinchTime = currentTime;
          this.pinchStart = wrist.y;
          cursor.style.backgroundColor = "#facc15";
          this.isScrolling = false;
        } else {
          const scrollDelta = Math.abs(this.pinchStart - wrist.y) * viewportHeight;
          if (scrollDelta > 20 || this.isScrolling) {
            this.isScrolling = true;
            cursor.style.backgroundColor = "#22c55e";
            let scrollAmount = (this.pinchStart - wrist.y) * this.SCROLL_MULTIPLIER;
            scrollAmount = Math.max(Math.min(scrollAmount, this.MAX_SCROLL), -this.MAX_SCROLL);
            this.scrollAmount += scrollAmount;
            this.pinchStart = wrist.y;
          }
        }
      } else {
        if (this.pinchActive) {
          const pinchDuration = currentTime - this.lastPinchTime;
          if (!this.isScrolling && pinchDuration < this.CLICK_DURATION_THRESHOLD_MS) {
            this.simulateClick(cursorX, cursorY);
            cursor.style.backgroundColor = "#0284c7";
          } else {
            cursor.style.backgroundColor = "#ef4444";
          }
          this.pinchActive = false;
          this.isScrolling = false;
          this.pinchStart = null;
          this.scrollAmount = 0;
        }
      }
    }
  }
};
</script>

<style scoped>
.camdiv {
  position: relative;
}
</style>
