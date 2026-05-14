export interface PlacedWidget {
  id: string;
  col: number;
  row: number;
  w: number;
  h: number;
  [key: string]: unknown;
}

export function compactVertical<T extends PlacedWidget>(ws: T[]): T[] {
  const sorted = [...ws].sort((a, b) => (a.row - b.row) || (a.col - b.col));
  const placed: T[] = [];
  for (const w of sorted) {
    let newRow = 1;
    for (const p of placed) {
      const colsOverlap = !(p.col + p.w <= w.col || w.col + w.w <= p.col);
      if (colsOverlap) newRow = Math.max(newRow, p.row + p.h);
    }
    placed.push({ ...w, row: newRow });
  }
  return placed;
}
