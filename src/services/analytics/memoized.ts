import { computeAnalytics, AnalyticsInput } from "./compute";
import { AnalyticsSummary } from "./types";

let cachedVersion: string | null = null;
let cachedResult: AnalyticsSummary | null = null;

export function computeAnalyticsMemoized(
  input: AnalyticsInput,
  versionKey: string,
): AnalyticsSummary {
  if (cachedResult !== null && cachedVersion === versionKey) {
    return cachedResult;
  }

  const result = computeAnalytics(input);
  cachedVersion = versionKey;
  cachedResult = result;
  return result;
}

export function clearAnalyticsCache(): void {
  cachedVersion = null;
  cachedResult = null;
}
