/**
 * Pure visibility policy for the floating AI button (no DOM access,
 * unit-testable). All privacy-sensitive checks (password/OTP/payment/code
 * editors) are represented by the precomputed `fieldEligible` flag, which the
 * content script derives from detector.isEditable().
 */
export interface ButtonVisibilityInput {
  extensionEnabled: boolean;
  showAiButton: boolean;
  siteExcluded: boolean;
  /** Field passed detector.isEditable() (not sensitive/editor/readonly). */
  fieldEligible: boolean;
  /** Field currently contains non-whitespace text. */
  hasText: boolean;
  /** A correction request is in flight — keep the button visible. */
  isBusy: boolean;
}

export function shouldShowButton(v: ButtonVisibilityInput): boolean {
  if (!v.extensionEnabled) return false;
  if (!v.showAiButton) return false;
  if (v.siteExcluded) return false;
  if (!v.fieldEligible) return false;
  if (!v.hasText && !v.isBusy) return false;
  return true;
}
