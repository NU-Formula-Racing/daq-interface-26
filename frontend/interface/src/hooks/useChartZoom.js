import { useState, useCallback } from 'react';

export default function useChartZoom() {
  const [refAreaStart, setRefAreaStart] = useState(null);
  const [refAreaEnd, setRefAreaEnd] = useState(null);
  const [zoomDomain, setZoomDomain] = useState(null);

  const onMouseDown = useCallback((e) => {
    if (e && e.activeLabel) {
      setRefAreaStart(e.activeLabel);
      setRefAreaEnd(null);
    }
  }, []);

  const onMouseMove = useCallback((e) => {
    if (refAreaStart && e && e.activeLabel) {
      setRefAreaEnd(e.activeLabel);
    }
  }, [refAreaStart]);

  const onMouseUp = useCallback(() => {
    if (refAreaStart && refAreaEnd && refAreaStart !== refAreaEnd) {
      const [left, right] = [refAreaStart, refAreaEnd].sort();
      setZoomDomain({ left, right });
    }
    setRefAreaStart(null);
    setRefAreaEnd(null);
  }, [refAreaStart, refAreaEnd]);

  const resetZoom = useCallback(() => {
    setZoomDomain(null);
    setRefAreaStart(null);
    setRefAreaEnd(null);
  }, []);

  const isZoomed = zoomDomain !== null;

  return {
    zoomDomain,
    refAreaStart,
    refAreaEnd,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    resetZoom,
    isZoomed,
  };
}
