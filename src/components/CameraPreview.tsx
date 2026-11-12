import { useEffect, useRef } from 'react';
import { HAND_CONNECTIONS } from '../lib/landmarks';
import { normalizedToPixel } from '../lib/transforms';
import { engine } from '../tracking/engine';
import { liveHub } from '../state/frameHub';

/**
 * Mirrored webcam preview with the tracked landmarks drawn on top.
 * Draws straight from the in-memory <video>; nothing is captured or stored.
 */
export function CameraPreview({ className, showVideo = true }: { className?: string; showVideo?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const video = engine.getVideo();
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(1, Math.round(rect.width * dpr));
      const H = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      ctx.clearRect(0, 0, W, H);
      const hasVideo = !!video && video.readyState >= 2 && video.videoWidth > 0;
      // cover-fit the video into the canvas
      let dx = 0;
      let dy = 0;
      let dw = W;
      let dh = H;
      if (hasVideo) {
        const vr = video!.videoWidth / video!.videoHeight;
        const cr = W / H;
        if (vr > cr) {
          dh = H;
          dw = H * vr;
          dx = (W - dw) / 2;
        } else {
          dw = W;
          dh = W / vr;
          dy = (H - dh) / 2;
        }
        if (showVideo) {
          ctx.save();
          ctx.translate(W, 0);
          ctx.scale(-1, 1);
          ctx.globalAlpha = 0.92;
          ctx.drawImage(video!, W - dx - dw, dy, dw, dh);
          ctx.restore();
          // cool clinical tint
          ctx.fillStyle = 'rgba(8, 20, 40, 0.28)';
          ctx.fillRect(0, 0, W, H);
        }
      }
      const s = liveHub.current;
      if (!s || !hasVideo) return;
      const pts = s.frame.landmarks.map((p) => {
        const q = normalizedToPixel(p, dw, dh, true);
        return { x: q.x + dx, y: q.y + dy };
      });
      ctx.lineWidth = 2 * dpr;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(62, 230, 210, 0.85)';
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.moveTo(pts[a].x, pts[a].y);
        ctx.lineTo(pts[b].x, pts[b].y);
      }
      ctx.stroke();
      for (let i = 0; i < pts.length; i++) {
        const tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
        ctx.beginPath();
        ctx.fillStyle = tip ? '#8f7cff' : '#e6fffb';
        ctx.arc(pts[i].x, pts[i].y, (tip ? 3.4 : 2.6) * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [showVideo]);

  return <canvas ref={canvasRef} className={className} aria-label="Mirrored camera preview with tracked hand landmarks" />;
}
