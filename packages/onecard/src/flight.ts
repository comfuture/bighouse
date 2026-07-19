export type FlightCardBounds = {
  width: number;
  height: number;
};

export type FlightCardSize = {
  width: number;
  height: number;
};

const fallbackAspectRatio = 1.38;

export function fitFlightCardSize(bounds: FlightCardBounds | undefined, viewportWidth: number): FlightCardSize {
  const safeViewportWidth = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 320;
  const responsiveMaxWidth = Math.min(92, Math.max(44, safeViewportWidth * 0.18));
  const measuredWidth = bounds && Number.isFinite(bounds.width) && bounds.width > 0
    ? bounds.width
    : Math.min(76, responsiveMaxWidth);
  const measuredAspectRatio = bounds && Number.isFinite(bounds.height) && bounds.height > 0
    ? bounds.height / measuredWidth
    : fallbackAspectRatio;
  const width = Math.min(Math.max(measuredWidth, 36), responsiveMaxWidth);
  const aspectRatio = Math.min(Math.max(measuredAspectRatio, 1.25), 1.55);

  return { width, height: width * aspectRatio };
}

export function clampFlightCenter(center: number, halfSize: number, viewportStart: number, viewportSize: number): number {
  const inset = Math.max(8, halfSize);
  if (viewportSize <= inset * 2) return viewportStart + viewportSize / 2;
  return Math.min(Math.max(center, viewportStart + inset), viewportStart + viewportSize - inset);
}

export function clampFlightPosition(position: number, size: number, viewportStart: number, viewportSize: number): number {
  const minPosition = viewportStart + 8;
  const maxPosition = Math.max(minPosition, viewportStart + viewportSize - size - 8);
  return Math.min(Math.max(position, minPosition), maxPosition);
}
