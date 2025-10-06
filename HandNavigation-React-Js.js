//npm install @mediapipe/hands @mediapipe/camera_utils @mediapipe/drawing_utils

import React, { useEffect, useRef, useState } from "react";
import { Hands } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";
import { drawConnectors, drawLandmarks, HAND_CONNECTIONS } from "@mediapipe/drawing_utils";
import "./HandNavigation.css"; 
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

const customCursorStyle = `
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

export default function HandNavigation() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const cursorRef = useRef(null); 
  const styleRef = useRef(null); 
  
  const [isHandsfreeModeOn, setIsHandsfreeModeOn] = useState(false);

  const pinchStartRef = useRef(null);
  const pinchActiveRef = useRef(false);
  const lastPinchTimeRef = useRef(0);
  const isScrollingRef = useRef(false);
  const handsRef = useRef(null); 
  const scrollAmountRef = useRef(0);
  const rAFIdRef = useRef(null);
  const cameraRef = useRef(null);

  const [mounted, setMounted] = useState(false);

  const PINCH_DISTANCE_THRESHOLD = 0.08;
  const CLICK_DURATION_THRESHOLD_MS = 300;
  const SCROLL_MULTIPLIER = 2500; 
  const MAX_SCROLL = 2000;

  useEffect(() => setMounted(true), []);

  const toggleHandsfreeMode = () => {
    setIsHandsfreeModeOn(prev => {
      const newState = !prev;
      if (newState) {
        toast.success("✋ হ্যান্ডস-ফ্রি মোড চালু হয়েছে!\n👉 আঙুল দিয়ে পিঞ্চ করলে ক্লিক\n👉 পিঞ্চ ধরে উপরে/নিচে নাড়ালে স্ক্রল", {
          position: "top-right",
          autoClose: 5000,
          pauseOnHover: true,
        });
      } else {
        toast.warning("🚫 হ্যান্ডস-ফ্রি মোড বন্ধ হয়েছে।", {
          position: "top-right",
          autoClose: 3000,
        });
      }
      return newState;
    });
  };

  // Scroll loop
  const scrollLoop = () => {
    if (scrollAmountRef.current !== 0) {
      window.scrollBy({ top: scrollAmountRef.current, behavior: "auto" });
      scrollAmountRef.current = 0;
    }
    rAFIdRef.current = requestAnimationFrame(scrollLoop);
  };

  const simulateClick = (x, y) => {
    if (!cursorRef.current) return;
    cursorRef.current.style.visibility = "hidden";
    const targetElement = document.elementFromPoint(x, y);
    cursorRef.current.style.visibility = "visible";
    if (targetElement) {
      targetElement.click();
      cursorRef.current.classList.add("clicked");
      setTimeout(() => cursorRef.current.classList.remove("clicked"), 100);
    }
  };

  useEffect(() => {
    if (!mounted) return;

    // Inject cursor style
    if (!styleRef.current) {
      const styleElement = document.createElement("style");
      styleElement.innerHTML = customCursorStyle;
      document.head.appendChild(styleElement);
      styleRef.current = styleElement;
    }

    // Cleanup logic
    const cleanup = () => {
      if (rAFIdRef.current) cancelAnimationFrame(rAFIdRef.current);
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
      if (cameraRef.current) {
        cameraRef.current.stop();
        cameraRef.current = null;
      }
      if (cursorRef.current) cursorRef.current.style.opacity = "0";
      pinchActiveRef.current = false;
      isScrollingRef.current = false;
      pinchStartRef.current = null;
    };

    if (isHandsfreeModeOn) {
      rAFIdRef.current = requestAnimationFrame(scrollLoop);

      const hands = new Hands({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });
      handsRef.current = hands;

      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7,
      });

      hands.onResults((results) => {
        if (!canvasRef.current || !videoRef.current || !cursorRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        const cursor = cursorRef.current;
        const currentTime = performance.now();

        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(videoRef.current, -canvas.width, 0, canvas.width, canvas.height);
        ctx.restore();

        if (!results.multiHandLandmarks?.length) {
          if (pinchActiveRef.current && !isScrollingRef.current && (currentTime - lastPinchTimeRef.current < CLICK_DURATION_THRESHOLD_MS)) {
            simulateClick(window.lastCursorX, window.lastCursorY);
          }
          pinchActiveRef.current = false;
          isScrollingRef.current = false;
          pinchStartRef.current = null;
          cursor.style.opacity = "0";
          return;
        }

        const originalLandmarks = results.multiHandLandmarks[0];
        const flippedLandmarks = originalLandmarks.map(l => ({ x: 1 - l.x, y: l.y, z: l.z }));

        const indexTip = flippedLandmarks[8];
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const cursorX = indexTip.x * viewportWidth;
        const cursorY = indexTip.y * viewportHeight;
        window.lastCursorX = cursorX;
        window.lastCursorY = cursorY;

        cursor.style.setProperty("--x", `${cursorX}px`);
        cursor.style.setProperty("--y", `${cursorY}px`);
        cursor.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0) translate(-50%, -50%)`;
        cursor.style.opacity = "1";

        drawConnectors(ctx, flippedLandmarks, HAND_CONNECTIONS, { color: "#0f766e", lineWidth: 3 });
        drawLandmarks(ctx, flippedLandmarks, { color: "#f15a73ff", lineWidth: 1, radius: 3 });

        const thumbTip = flippedLandmarks[4];
        const wrist = flippedLandmarks[0];
        const dx = thumbTip.x - indexTip.x;
        const dy = thumbTip.y - indexTip.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < PINCH_DISTANCE_THRESHOLD) {
          if (!pinchActiveRef.current) {
            pinchActiveRef.current = true;
            lastPinchTimeRef.current = currentTime;
            pinchStartRef.current = wrist.y;
            cursor.style.backgroundColor = "#facc15";
            isScrollingRef.current = false;
          } else {
            const scrollDelta = Math.abs(pinchStartRef.current - wrist.y) * viewportHeight;
            if (scrollDelta > 20 || isScrollingRef.current) {
              isScrollingRef.current = true;
              cursor.style.backgroundColor = "#22c55e";
              let scrollAmount = (pinchStartRef.current - wrist.y) * SCROLL_MULTIPLIER;
              scrollAmount = Math.max(Math.min(scrollAmount, MAX_SCROLL), -MAX_SCROLL);
              scrollAmountRef.current += scrollAmount;
              pinchStartRef.current = wrist.y;
            }
          }
        } else {
          if (pinchActiveRef.current) {
            const pinchDuration = currentTime - lastPinchTimeRef.current;
            if (!isScrollingRef.current && pinchDuration < CLICK_DURATION_THRESHOLD_MS) {
              simulateClick(cursorX, cursorY);
              cursor.style.backgroundColor = "#0284c7";
            } else {
              cursor.style.backgroundColor = "#ef4444";
            }
            pinchActiveRef.current = false;
            isScrollingRef.current = false;
            pinchStartRef.current = null;
            scrollAmountRef.current = 0;
          }
        }
      });

      if (videoRef.current && !videoRef.current.srcObject) {
        navigator.mediaDevices.getUserMedia({ video: true })
          .then((stream) => {
            videoRef.current.srcObject = stream;
            const camera = new Camera(videoRef.current, {
              onFrame: async () => await hands.send({ image: videoRef.current }),
              width: 150,
              height: 140,
            });
            cameraRef.current = camera;
            camera.start();
          })
          .catch((err) => console.error("Cannot access camera:", err));
      }
    }

    return cleanup;
  }, [mounted, isHandsfreeModeOn]);

  if (!mounted) return null;

  return (
    <>
      <div id="custom-cursor" ref={cursorRef} />
      <div className="camdiv text-center">
        <button
          onClick={toggleHandsfreeMode}
          className={`btn ${isHandsfreeModeOn ? "btn-outline-secondary" : "btn-secondary"} mb-2`}
        >
          {isHandsfreeModeOn ? "হ্যান্ডস-ফ্রি অফ" : "হ্যান্ডস-ফ্রি মোড"}
        </button>

        <video ref={videoRef} autoPlay playsInline style={{ display: "none" }} />
        <canvas
          ref={canvasRef}
          style={{
            top: "20px",
            right: "20px",
            width: "150px",
            height: "140px",
            pointerEvents: "none",
            borderRadius: "10px",
            border: "2px solid #4d4d4dff",
            zIndex: 1000,
            display: isHandsfreeModeOn ? "block" : "none",
          }}
        />

        <ToastContainer />
      </div>
    </>
  );
}
