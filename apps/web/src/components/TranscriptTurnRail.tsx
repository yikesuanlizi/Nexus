import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import './TranscriptTurnRail.css';

export interface TranscriptTurnRailEntry {
  id: string;
  userText: string;
  assistantText: string;
}

interface TranscriptTurnRailProps {
  entries: TranscriptTurnRailEntry[];
  transcriptRef: RefObject<HTMLElement | null>;
  onSelect: (turnId: string) => void;
}

const NEIGHBOR_WIDTHS = [17, 15, 13, 11, 10, 9];

function displayText(text: string, fallback: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

export function TranscriptTurnRail({ entries, transcriptRef, onSelect }: TranscriptTurnRailProps) {
  const [hoveredTurnId, setHoveredTurnId] = useState<string | null>(null);
  const [trackHeight, setTrackHeight] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const hoveredIndex = entries.findIndex((entry) => entry.id === hoveredTurnId);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const syncHeight = () => setTrackHeight(Math.max(0, transcript.clientHeight - 18));
    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(transcript);
    return () => observer.disconnect();
  }, [transcriptRef]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const syncCurrentTurn = () => {
      const scrollRange = transcript.scrollHeight - transcript.clientHeight;
      const progress = scrollRange > 0 ? transcript.scrollTop / scrollRange : 0;
      const nextIndex = Math.min(entries.length - 1, Math.max(0, Math.round(progress * Math.max(entries.length - 1, 0))));
      setCurrentIndex((current) => current === nextIndex ? current : nextIndex);
    };
    syncCurrentTurn();
    transcript.addEventListener('scroll', syncCurrentTurn, { passive: true });
    return () => transcript.removeEventListener('scroll', syncCurrentTurn);
  }, [entries.length, transcriptRef]);

  if (entries.length === 0 || trackHeight === 0) return null;
  const markerStep = Math.min(18, Math.max(8, (trackHeight - 16) / Math.max(entries.length, 1)));
  const compactHeight = Math.min(trackHeight, 16 + Math.max(entries.length - 1, 0) * markerStep);

  return (
    <div className="turnRailAnchor" style={{ '--turn-rail-viewport-height': `${trackHeight}px` } as CSSProperties}>
      <nav
        className="turnRail"
        style={{ '--turn-rail-height': `${compactHeight}px` } as CSSProperties}
        aria-label="对话轮次"
        onMouseLeave={() => setHoveredTurnId(null)}
      >
        {entries.map((entry, index) => {
          const distance = hoveredIndex < 0 ? Number.POSITIVE_INFINITY : Math.abs(index - hoveredIndex);
          const lineWidth = distance === 0 ? 24 : index === currentIndex ? 16 : distance <= NEIGHBOR_WIDTHS.length ? NEIGHBOR_WIDTHS[distance - 1] : 8;
          const top = `${8 + index * markerStep}px`;
          const active = entry.id === hoveredTurnId;
          const current = index === currentIndex;
          return (
            <button
              key={entry.id}
              type="button"
              className={`${active ? 'turnRailMarker active' : 'turnRailMarker'}${current ? ' current' : ''}`}
              style={{ top, '--turn-rail-line-width': `${lineWidth}px` } as CSSProperties}
              aria-label={`定位到对话第 ${index + 1} 轮`}
              onClick={() => onSelect(entry.id)}
              onFocus={() => setHoveredTurnId(entry.id)}
              onBlur={() => setHoveredTurnId(null)}
              onMouseEnter={() => setHoveredTurnId(entry.id)}
            >
              <span className="turnRailLine" />
              <span className="turnRailTooltip" role="tooltip">
                <span className="turnRailTooltipRow">
                  <span className="turnRailTooltipLabel">你</span>
                  <span className="turnRailTooltipText">{displayText(entry.userText, '无文字消息')}</span>
                </span>
                <span className="turnRailTooltipRow">
                  <span className="turnRailTooltipLabel">回复</span>
                  <span className="turnRailTooltipText">{displayText(entry.assistantText, '正在生成回复…')}</span>
                </span>
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
