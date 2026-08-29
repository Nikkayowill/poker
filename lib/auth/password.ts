/**
 * Matches Supabase's password_min_length (Authentication -> Providers ->
 * Email). NIST SP 800-63B and OWASP ASVS L1 both put the floor at 8.
 *
 * Shared rather than declared per-form: the sign-in/sign-up form and the
 * password-reset form both validate against it, and a mismatch between the
 * two would mean a password the reset form accepts that sign-in then
 * rejects (or the reverse).
 */
export const MIN_PASSWORD_LENGTH = 8;
