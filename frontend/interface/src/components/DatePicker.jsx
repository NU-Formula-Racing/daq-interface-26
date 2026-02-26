import { useState, useEffect, useRef, useCallback } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { startOfMonth, endOfMonth, format, parse } from "date-fns";
import { useSession } from "@/context/SessionContext";
import "./DatePicker.css";

export default function DatePicker({ value, onChange }) {
  const { fetchDatesWithData } = useSession();
  const [open, setOpen] = useState(false);
  const [datesWithData, setDatesWithData] = useState(new Set());
  const [displayMonth, setDisplayMonth] = useState(() =>
    value ? parse(value, "yyyy-MM-dd", new Date()) : new Date()
  );
  const [popoverStyle, setPopoverStyle] = useState({});
  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);

  // Position popover using fixed positioning to avoid clipping
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const calWidth = 310;
    let left = rect.left;
    // Keep popover on-screen
    if (left + calWidth > window.innerWidth) {
      left = window.innerWidth - calWidth - 8;
    }
    if (left < 8) left = 8;
    setPopoverStyle({
      position: "fixed",
      top: rect.bottom + 6,
      left,
    });
  }, [open]);

  // Close on outside click/touch
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick);
    };
  }, [open]);

  // Fetch dates with data when month changes or popover opens
  const loadDatesForMonth = useCallback(
    async (month) => {
      const start = startOfMonth(month).toISOString();
      const end = endOfMonth(month).toISOString();
      const dates = await fetchDatesWithData({ start, end });
      setDatesWithData(dates);
    },
    [fetchDatesWithData]
  );

  useEffect(() => {
    if (open) {
      loadDatesForMonth(displayMonth);
    }
  }, [open, displayMonth, loadDatesForMonth]);

  const selected = value
    ? parse(value, "yyyy-MM-dd", new Date())
    : undefined;

  function handleSelect(date) {
    if (date) {
      onChange(format(date, "yyyy-MM-dd"));
    }
    setOpen(false);
  }

  function handleMonthChange(month) {
    setDisplayMonth(month);
  }

  return (
    <div className="datepicker-wrapper" ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        className="datepicker-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        {value || "Select date"}
      </button>

      {open && (
        <div className="datepicker-popover" style={popoverStyle}>
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={handleSelect}
            month={displayMonth}
            onMonthChange={handleMonthChange}
            modifiers={{
              hasData: (day) =>
                datesWithData.has(format(day, "yyyy-MM-dd")),
            }}
            modifiersClassNames={{
              hasData: "day-has-data",
            }}
          />
        </div>
      )}
    </div>
  );
}
