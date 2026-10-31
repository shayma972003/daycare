export type Coordinates = {
  latitude: number;
  longitude: number;
};

const EARTH_RADIUS_METERS = 6_371_000;

function radians(degrees: number) {
  return degrees * (Math.PI / 180);
}

/** Great-circle distance used by the server to validate every device event. */
export function distanceMeters(from: Coordinates, to: Coordinates): number {
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const fromLatitude = radians(from.latitude);
  const toLatitude = radians(to.latitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function roundedDistanceMeters(from: Coordinates, to: Coordinates) {
  return Math.round(distanceMeters(from, to));
}
