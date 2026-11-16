import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "./StableContentFrame.css";

// Reserve geometry, never previous rows. Requests still discard data/abort on
// a scope change; only the new scope's completed content sets the next height.
export function StableContentFrame({
  pending,
  children,
}: {
  pending: boolean;
  children: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    // A second selection can interrupt a resize. Freeze the visible height,
    // rather than allowing the previous scope's resize to keep running.
    if (pending && frame.current && height) {
      setHeight(frame.current.getBoundingClientRect().height);
    }
  }, [pending]);
  useLayoutEffect(() => {
    if (pending || !content.current) return;
    const element = content.current;
    // Disconnect before the loading placeholder is painted, otherwise a
    // queued observation could replace the reserved height with its 160px.
    const measure = () => setHeight(element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [pending]);
  return (
    <div
      ref={frame}
      className="stable-content-frame"
      aria-busy={pending}
      style={height ? { blockSize: height } : undefined}
    >
      <div ref={content}>{children}</div>
    </div>
  );
}
