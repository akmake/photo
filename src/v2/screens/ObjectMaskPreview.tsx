import { useEffect, useRef } from 'react';
import type { ManualStroke, ToolInstance } from '../../types';

/** The saved mask and hand corrections, drawn at the picture's displayed size. */
export default function ObjectMaskPreview({ selection, width, height }: {
  selection: NonNullable<ToolInstance['objectSelection']>; width: number; height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const image = new Image();
    let live = true;
    image.onload = () => {
      if (!live) return;
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const selected = pixels.data[i];
        pixels.data[i] = 59;
        pixels.data[i + 1] = 130;
        pixels.data[i + 2] = 246;
        pixels.data[i + 3] = Math.round(selected * 0.48);
      }
      ctx.putImageData(pixels, 0, 0);
      const draw = (strokes: ManualStroke[]) => {
        for (const stroke of strokes) {
          const points = stroke.points;
          if (!points.length) continue;
          const radius = stroke.r * canvas.width;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.lineWidth = radius * 2;
          ctx.beginPath();
          points.forEach(([x, y], i) => {
            if (i === 0) ctx.moveTo(x * canvas.width, y * canvas.height);
            else ctx.lineTo(x * canvas.width, y * canvas.height);
          });
          if (points.length === 1) {
            ctx.arc(points[0][0] * canvas.width, points[0][1] * canvas.height, radius, 0, Math.PI * 2);
            ctx.fill();
          } else ctx.stroke();
        }
      };
      ctx.fillStyle = 'rgba(59, 130, 246, 0.48)';
      ctx.strokeStyle = ctx.fillStyle;
      draw(selection.add ?? []);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#fff';
      draw(selection.subtract ?? []);
      ctx.globalCompositeOperation = 'source-over';
    };
    image.src = selection.maskPng;
    return () => { live = false; };
  }, [selection, width, height]);
  return <canvas ref={canvasRef} className="tz-object-mask-preview" style={{ width, height }} aria-hidden="true" />;
}
