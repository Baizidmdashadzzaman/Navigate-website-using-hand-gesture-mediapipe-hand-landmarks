"use client";

import React, { useEffect, useRef, useState } from "react";
import { Hands } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";
import { drawConnectors, drawLandmarks, HAND_CONNECTIONS } from "@mediapipe/drawing_utils";

// --- Custom Cursor CSS (Modified to use a class for global cursor hiding) ---
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
  
  // NEW STATE: Toggle switch for the hands-free mode
  const [isHandsfreeModeOn, setIsHandsfreeModeOn] = useState(false);

  // References for scroll/click state
  const pinchStartRef = useRef(null);
  const pinchActiveRef = useRef(false);
  const lastPinchTimeRef = useRef(0);
  const isScrollingRef = useRef(false);
  const handsRef = useRef(null); // New: Store the MediaPipe Hands instance
  
  const scrollAmountRef = useRef(0);
  const rAFIdRef = useRef(null);
  const cameraRef = useRef(null); // New: Store the Camera instance

  const [mounted, setMounted] = useState(false);

  const PINCH_DISTANCE_THRESHOLD = 0.08;
  const CLICK_DURATION_THRESHOLD_MS = 300;
  const SCROLL_MULTIPLIER = 2500; 
  const MAX_SCROLL = 2000;

  useEffect(() => setMounted(true), []);

  // --- Toggle Handler ---
  const toggleHandsfreeMode = () => {
    setIsHandsfreeModeOn(prev => !prev);
  };
  
  // --- Animation Frame Loop for Smooth Scrolling ---
  const scrollLoop = () => {
    if (scrollAmountRef.current !== 0) {
      window.scrollBy({ 
        top: scrollAmountRef.current, 
        behavior: 'auto' 
      });
      scrollAmountRef.current = 0;
    }
    rAFIdRef.current = requestAnimationFrame(scrollLoop);
  };
  
  // --- PROGRAMMATIC CLICK FUNCTION ---
  const simulateClick = (x, y) => {
    if (!cursorRef.current) return;
    
    cursorRef.current.style.visibility = 'hidden'; 
    const targetElement = document.elementFromPoint(x, y);
    cursorRef.current.style.visibility = 'visible';

    if (targetElement) {
      console.log('Simulating click on:', targetElement);
      targetElement.click(); 

      cursorRef.current.classList.add('clicked');
      setTimeout(() => {
        cursorRef.current.classList.remove('clicked');
      }, 100);
    }
  };


  useEffect(() => {
    if (!mounted) return;

    // Inject custom cursor CSS (only done once)
    if (!styleRef.current) {
        const styleElement = document.createElement('style');
        styleElement.innerHTML = customCursorStyle;
        document.head.appendChild(styleElement);
        styleRef.current = styleElement; 
    }
    
    // Manage the global cursor style based on the mode
    if (isHandsfreeModeOn) {
        document.body.classList.add('handsfree-active');
    } else {
        document.body.classList.remove('handsfree-active');
    }

    // --- CLEANUP FUNCTION ---
    const cleanup = () => {
      // 1. Stop animation frame loop
      if (rAFIdRef.current) {
        cancelAnimationFrame(rAFIdRef.current);
        rAFIdRef.current = null;
      }
      
      // 2. Stop camera stream
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = videoRef.current.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
      
      // 3. Stop MediaPipe Camera utility
      if (cameraRef.current) {
          cameraRef.current.stop();
          cameraRef.current = null;
      }
      
      // 4. Hide the custom cursor
      if (cursorRef.current) {
        cursorRef.current.style.opacity = '0';
      }
      
      // 5. Reset all state refs
      pinchActiveRef.current = false;
      isScrollingRef.current = false;
      pinchStartRef.current = null;
    };
    
    // --- MODE ON LOGIC ---
    if (isHandsfreeModeOn) {
      
      // Start the smooth scrolling loop
      rAFIdRef.current = requestAnimationFrame(scrollLoop);
      
      const hands = new Hands({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });
      handsRef.current = hands; // Store instance

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

        // Canvas drawing
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(videoRef.current, -canvas.width, 0, canvas.width, canvas.height);
        ctx.restore();

        if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
            // Hand Lost: Check for click on hand release
            if (pinchActiveRef.current && !isScrollingRef.current && (currentTime - lastPinchTimeRef.current < CLICK_DURATION_THRESHOLD_MS)) {
                 simulateClick(window.lastCursorX, window.lastCursorY);
            }
            // Reset states and hide cursor
            pinchActiveRef.current = false;
            isScrollingRef.current = false;
            pinchStartRef.current = null;
            cursor.style.opacity = '0'; 
            return;
        }

        const originalLandmarks = results.multiHandLandmarks[0];
        const flippedLandmarks = originalLandmarks.map(landmark => ({
            x: 1 - landmark.x, y: landmark.y, z: landmark.z,
        }));

        // --- CURSOR POSITION CALCULATION ---
        const indexTip = flippedLandmarks[8];
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        const cursorX = indexTip.x * viewportWidth;
        const cursorY = indexTip.y * viewportHeight;
        
        window.lastCursorX = cursorX;
        window.lastCursorY = cursorY;

        cursor.style.setProperty('--x', `${cursorX}px`);
        cursor.style.setProperty('--y', `${cursorY}px`);
        cursor.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0) translate(-50%, -50%)`;
        cursor.style.opacity = '1';

        // MediaPipe drawing
        drawConnectors(ctx, flippedLandmarks, HAND_CONNECTIONS, { color: "#0f766e", lineWidth: 3 });
        drawLandmarks(ctx, flippedLandmarks, { color: "#14b8a6", lineWidth: 2, radius: 5 });

        // Pinch detection
        const thumbTip = flippedLandmarks[4];
        const wrist = flippedLandmarks[0]; 
        
        const dx = thumbTip.x - indexTip.x;
        const dy = thumbTip.y - indexTip.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // --- CLICK & SCROLL DETECTION LOGIC (Same as before) ---
        if (distance < PINCH_DISTANCE_THRESHOLD) {
            if (!pinchActiveRef.current) {
              pinchActiveRef.current = true;
              lastPinchTimeRef.current = currentTime;
              pinchStartRef.current = wrist.y;
              cursor.style.backgroundColor = '#facc15';
              isScrollingRef.current = false;
            } else {
              const scrollDelta = Math.abs(pinchStartRef.current - wrist.y) * viewportHeight;
              if (scrollDelta > 20 || isScrollingRef.current) {
                  isScrollingRef.current = true;
                  cursor.style.backgroundColor = '#22c55e';
                  
                  const deltaY = pinchStartRef.current - wrist.y;
                  let scrollAmount = deltaY * SCROLL_MULTIPLIER;
                  if (scrollAmount > MAX_SCROLL) scrollAmount = MAX_SCROLL;
                  if (scrollAmount < -MAX_SCROLL) scrollAmount = -MAX_SCROLL;
                  scrollAmountRef.current += scrollAmount;
                  pinchStartRef.current = wrist.y;
              }
            }
        } else {
            if (pinchActiveRef.current) {
                const pinchDuration = currentTime - lastPinchTimeRef.current;
                
                if (!isScrollingRef.current && pinchDuration < CLICK_DURATION_THRESHOLD_MS) {
                    simulateClick(cursorX, cursorY);
                    cursor.style.backgroundColor = '#0284c7';
                } else {
                    cursor.style.backgroundColor = '#ef4444';
                }
                
                pinchActiveRef.current = false;
                isScrollingRef.current = false;
                pinchStartRef.current = null;
                scrollAmountRef.current = 0;
            }
        }
      });

      // Initialize camera
      if (videoRef.current && !videoRef.current.srcObject) {
        navigator.mediaDevices
          .getUserMedia({ video: true })
          .then((stream) => {
            videoRef.current.srcObject = stream;
            const camera = new Camera(videoRef.current, {
              onFrame: async () => await hands.send({ image: videoRef.current }),
              width: 150,
              height: 140,
            });
            cameraRef.current = camera; // Store instance
            camera.start();
          })
          .catch((err) => console.error("Cannot access camera:", err));
      }
    }

    // Return the cleanup function, which runs when the component unmounts OR when `isHandsfreeModeOn` changes to false
    return () => {
        cleanup();
        // Final cleanup for injected style element (only on unmount)
        if (!isHandsfreeModeOn && styleRef.current && document.head.contains(styleRef.current)) {
           // We keep the style element until the component fully unmounts, just ensure body class is removed
           document.body.classList.remove('handsfree-active');
        }
    };
    
  }, [mounted, isHandsfreeModeOn]); // Key dependency: isHandsfreeModeOn

  if (!mounted) return null;

  return (
    <>
      {/* THE CUSTOM CURSOR ELEMENT */}
      <div 
        id="custom-cursor" 
        ref={cursorRef} 
      />


      <div className="camdiv">
      <div >
        <button
          onClick={toggleHandsfreeMode}
          style={{

            backgroundColor: isHandsfreeModeOn ? '#dc2626' : '#10b981', // Red for OFF, Green for ON

          }}
          className="transition font-medium text-sm bg-teal-600 text-white px-3 py-1.5 rounded-full hover:bg-teal-700"
        >
          {isHandsfreeModeOn ? 'Hands-Free OFF' : 'Hands-Free mode'}
        </button>
      </div>
        
        <video
          ref={videoRef}
          autoPlay
          playsInline
          style={{ display: "none" }}
        />
        <canvas
          ref={canvasRef}
          style={{
           
            top: "20px",
            right: "20px",
            width: "150px",
            height: "140px",
            pointerEvents: "none",
            borderRadius:"10px",
            border: "2px solid #14b8a6",
            zIndex: 1000,
            display: isHandsfreeModeOn ? 'block' : 'none'
          }}
        />

              {/* TOGGLE BUTTON */}


      </div>
      



    </>
  );
}
