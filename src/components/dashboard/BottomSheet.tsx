import { useEffect, useRef, useState } from "react";
import { T } from "./tokens";

type Props = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export function BottomSheet({ open, onClose, children }: Props) {
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    startY.current = e.clientY;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current == null) return;
    const dy = e.clientY - startY.current;
    if (dy > 0) setDragY(dy);
  };
  const onPointerUp = () => {
    if (dragY > 60) onClose();
    setDragY(0);
    startY.current = null;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[200] flex items-end justify-center"
      onClick={onClose}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
      />
      <div
        className="relative w-full max-w-[480px]"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.surface,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          borderTop: `0.5px solid ${T.border}`,
          padding: 20,
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
          transform: `translateY(${dragY}px)`,
          transition: dragY ? "none" : "transform 0.25s ease",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          aria-hidden
          style={{
            width: 36,
            height: 4,
            background: T.border,
            borderRadius: 2,
            margin: "0 auto 16px",
          }}
        />
        {children}
      </div>
    </div>
  );
}
