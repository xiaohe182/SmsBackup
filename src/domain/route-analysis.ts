export interface LocationCoordinate {
  latitude: number;
  longitude: number;
}

export interface LocationPoint extends LocationCoordinate {
  id: string;
  sessionId: string;
  capturedAt: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  bearing: number | null;
  provider: string;
}

export interface RouteBounds {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

export interface RouteSessionAnalysis {
  sessionId: string;
  points: LocationPoint[];
  startedAt: number;
  endedAt: number;
  durationMs: number;
  movingTimeMs: number;
  totalDistanceMeters: number;
  averageSpeedMetersPerSecond: number;
  bounds: RouteBounds;
}

export interface RouteAnalysis {
  sessions: RouteSessionAnalysis[];
  latestPoint: LocationPoint | null;
  rawPointCount: number;
  acceptedPointCount: number;
  rejectedPointCount: number;
  totalDistanceMeters: number;
  totalDurationMs: number;
}

export interface RouteAnalysisOptions {
  maxAccuracyMeters?: number;
  maxPlausibleSpeedMetersPerSecond?: number;
  minMovementMeters?: number;
}

const EARTH_RADIUS_METERS = 6_371_008.8;

function toRadians(value: number): number {
  return value * Math.PI / 180;
}

export function haversineDistanceMeters(
  from: LocationCoordinate,
  to: LocationCoordinate,
): number {
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitude)
    * Math.cos(toLatitude)
    * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(
    Math.sqrt(haversine),
    Math.sqrt(1 - haversine),
  );
}

function isCoordinateValid(point: LocationPoint): boolean {
  return Number.isFinite(point.latitude)
    && Number.isFinite(point.longitude)
    && point.latitude >= -90
    && point.latitude <= 90
    && point.longitude >= -180
    && point.longitude <= 180
    && Number.isFinite(point.capturedAt)
    && point.capturedAt > 0;
}

function createBounds(points: LocationPoint[]): RouteBounds {
  return points.reduce<RouteBounds>((bounds, point) => ({
    minLatitude: Math.min(bounds.minLatitude, point.latitude),
    maxLatitude: Math.max(bounds.maxLatitude, point.latitude),
    minLongitude: Math.min(bounds.minLongitude, point.longitude),
    maxLongitude: Math.max(bounds.maxLongitude, point.longitude),
  }), {
    minLatitude: points[0].latitude,
    maxLatitude: points[0].latitude,
    minLongitude: points[0].longitude,
    maxLongitude: points[0].longitude,
  });
}

function analyzeSession(
  sessionId: string,
  rawPoints: LocationPoint[],
  options: Required<RouteAnalysisOptions>,
): RouteSessionAnalysis | null {
  const sorted = rawPoints
    .filter(isCoordinateValid)
    .sort((left, right) => left.capturedAt - right.capturedAt);
  const accepted: LocationPoint[] = [];
  let totalDistanceMeters = 0;
  let movingTimeMs = 0;

  for (const point of sorted) {
    if (!Number.isFinite(point.accuracy) || point.accuracy > options.maxAccuracyMeters) {
      continue;
    }
    const previous = accepted[accepted.length - 1];
    if (!previous) {
      accepted.push(point);
      continue;
    }

    const elapsedMs = point.capturedAt - previous.capturedAt;
    if (elapsedMs <= 0) continue;
    const distanceMeters = haversineDistanceMeters(previous, point);
    const impliedSpeed = distanceMeters / (elapsedMs / 1_000);
    if (impliedSpeed > options.maxPlausibleSpeedMetersPerSecond) continue;
    if (distanceMeters < options.minMovementMeters) continue;

    accepted.push(point);
    totalDistanceMeters += distanceMeters;
    movingTimeMs += elapsedMs;
  }

  if (accepted.length === 0) return null;
  const startedAt = accepted[0].capturedAt;
  const endedAt = accepted[accepted.length - 1].capturedAt;
  const durationMs = Math.max(0, endedAt - startedAt);
  return {
    sessionId,
    points: accepted,
    startedAt,
    endedAt,
    durationMs,
    movingTimeMs,
    totalDistanceMeters,
    averageSpeedMetersPerSecond: movingTimeMs > 0
      ? totalDistanceMeters / (movingTimeMs / 1_000)
      : 0,
    bounds: createBounds(accepted),
  };
}

export function analyzeRoute(
  points: LocationPoint[],
  providedOptions: RouteAnalysisOptions = {},
): RouteAnalysis {
  const options: Required<RouteAnalysisOptions> = {
    maxAccuracyMeters: providedOptions.maxAccuracyMeters ?? 120,
    maxPlausibleSpeedMetersPerSecond:
      providedOptions.maxPlausibleSpeedMetersPerSecond ?? 80,
    minMovementMeters: providedOptions.minMovementMeters ?? 5,
  };
  const grouped = new Map<string, LocationPoint[]>();
  for (const point of points) {
    const sessionId = point.sessionId || "unknown";
    grouped.set(sessionId, [...(grouped.get(sessionId) || []), point]);
  }

  const sessions = [...grouped.entries()]
    .map(([sessionId, sessionPoints]) => analyzeSession(sessionId, sessionPoints, options))
    .filter((session): session is RouteSessionAnalysis => session !== null)
    .sort((left, right) => right.endedAt - left.endedAt);
  const acceptedPointCount = sessions.reduce(
    (count, session) => count + session.points.length,
    0,
  );
  const latestPoint = sessions.reduce<LocationPoint | null>((latest, session) => {
    const candidate = session.points[session.points.length - 1];
    return !latest || candidate.capturedAt > latest.capturedAt ? candidate : latest;
  }, null);

  return {
    sessions,
    latestPoint,
    rawPointCount: points.length,
    acceptedPointCount,
    rejectedPointCount: Math.max(0, points.length - acceptedPointCount),
    totalDistanceMeters: sessions.reduce(
      (distance, session) => distance + session.totalDistanceMeters,
      0,
    ),
    totalDurationMs: sessions.reduce(
      (duration, session) => duration + session.durationMs,
      0,
    ),
  };
}
