import { useEffect } from "react";

type MessageToastProps = {
  message: string;
  type: "success" | "error";
  onClose: () => void;
  durationMs?: number;
};

export default function MessageToast({
  message,
  type,
  onClose,
  durationMs = 4500,
}: MessageToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(() => onClose(), durationMs);
    return () => window.clearTimeout(timer);
  }, [onClose, durationMs, message, type]);

  return (
    <div className={`message-toast message-toast-${type}`} role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" className="message-toast-close" onClick={onClose} aria-label="Close message">
        Close
      </button>
    </div>
  );
}
