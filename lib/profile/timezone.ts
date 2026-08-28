/**
 * IANA timezone validation, shared by the client capture route and (later)
 * anything else that needs to trust a stored `timezone` value.
 *
 * There is no built-in "is this a real zone name" check short of asking the
 * platform to resolve it: `Intl.DateTimeFormat` throws a RangeError for a
 * bogus zone and is silent for a real one, so that's the check. Node's
 * `Intl.supportedValuesOf("timeZone")` would also work but is a much larger
 * array to build and compare against for the same answer.
 */
export function isValidTimezone(value: string): boolean {
  if (!value || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
