import React, { useEffect, useRef } from 'react';
import { GitNexusForceGraph } from './GitNexusForceGraph.js';
import type { ForceGraphData, ForceGraphLevel, ForceGraphNode } from './GitNexusForceGraph.js';

interface GitNexusGraphModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: ForceGraphData;
  title?: string;
  level?: ForceGraphLevel;
  onNodeClick?: (node: ForceGraphNode) => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
}

export function GitNexusGraphModal({
  isOpen,
  onClose,
  data,
  title = 'Dependency Graph',
  level = 'file',
  onNodeClick,
}: GitNexusGraphModalProps): React.ReactElement | null {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isDark = document.documentElement.classList.contains('theme-dark')
      || document.querySelector('.appShell')?.classList.contains('theme-dark');

    const resizeCanvas = () => {
      const modal = modalRef.current;
      if (modal) {
        canvas.width = modal.clientWidth;
        canvas.height = modal.clientHeight;
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const particleCount = 50;
    const particles: Particle[] = [];

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        radius: Math.random() * 1.5 + 0.5,
        alpha: Math.random() * 0.25 + 0.05,
      });
    }

    particlesRef.current = particles;

    const particleColor = isDark ? 'rgba(59, 130, 246, ' : 'rgba(37, 99, 235, ';
    const lineColor = isDark ? 'rgba(59, 130, 246, ' : 'rgba(37, 99, 235, ';

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = particleColor + p.alpha + ')';
        ctx.fill();
      }

      const maxDist = 100;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < maxDist) {
            const alpha = (1 - dist / maxDist) * 0.1;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = lineColor + alpha + ')';
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isOpen]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="gitNexusGraphModalBackdrop"
      onClick={handleBackdropClick}
    >
      <div className="gitNexusGraphModal" ref={modalRef}>
        <canvas
          ref={canvasRef}
          className="gitNexusGraphCanvasBg"
        />

        <div className="gitNexusGraphModalTitle">{title}</div>

        <button
          type="button"
          className="gitNexusGraphModalClose"
          onClick={onClose}
          aria-label="Close"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="gitNexusGraphContent">
          <GitNexusForceGraph
            data={data}
            level={level}
            onNodeClick={onNodeClick}
          />
        </div>
      </div>
    </div>
  );
}
