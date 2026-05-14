/**
 * Pick a bucket size (seconds) that produces ~targetBuckets buckets across
 * the given duration. Floored at 1 second since sd_readings has sub-second
 * resolution but the RPC accepts INT seconds.
 */
export function bucketFor(durationSecs: number, targetBuckets: number): number {
  if (durationSecs <= 0) return 1;
  return Math.max(1, Math.round(durationSecs / targetBuckets));
}
