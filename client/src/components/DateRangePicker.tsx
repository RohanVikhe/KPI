import { useEffect, useMemo, useRef, useState } from "react";

type DateRangePickerProps = {
  label?: string;
  fromDate: string;
  toDate: string;
  onChangeFrom: (value: string) => void;
  onChangeTo: (value: string) => void;
};

export default function DateRangePicker({
  label = "Date range",
  fromDate,
  toDate,
  onChangeFrom,
  onChangeTo,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  const rangeLabel = useMemo(() => {
    if (!fromDate && !toDate) return "Select range";
    return `${fromDate || "..."} to ${toDate || "..."}`;
  }, [fromDate, toDate]);

  const isEmpty = !fromDate && !toDate;

  return (
    <div className="form-field date-range-field" ref={containerRef}>
      <span>{label}</span>
      <button
        type="button"
        className={`date-range-trigger${isEmpty ? " is-empty" : ""}`}
        onClick={() => setIsOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <span>{rangeLabel}</span>
        <span className="date-range-trigger-icon" aria-hidden="true">
          v
        </span>
      </button>
      {isOpen && (
        <div className="date-range-popover" role="dialog" aria-label={`${label} picker`}>
          <div className="date-range-popover-grid">
            <label className="date-range-popover-field">
              <span>Start date</span>
              <input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(event) => onChangeFrom(event.target.value)}
                aria-label="Start date"
              />
            </label>
            <label className="date-range-popover-field">
              <span>End date</span>
              <input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(event) => onChangeTo(event.target.value)}
                aria-label="End date"
              />
            </label>
          </div>
          <div className="date-range-popover-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setIsOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
