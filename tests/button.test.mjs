import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowButton } from '../dist/test/button-policy.mjs';

const base = {
  extensionEnabled: true,
  showAiButton: true,
  siteExcluded: false,
  fieldEligible: true,
  hasText: true,
  isBusy: false,
};

describe('floating button visibility policy', () => {
  it('shows on eligible field with text', () => {
    assert.equal(shouldShowButton(base), true);
  });
  it('hides when field is empty (and not busy)', () => {
    assert.equal(shouldShowButton({ ...base, hasText: false }), false);
  });
  it('stays visible while a correction is in flight', () => {
    assert.equal(shouldShowButton({ ...base, hasText: false, isBusy: true }), true);
  });
  it('hides when extension disabled', () => {
    assert.equal(shouldShowButton({ ...base, extensionEnabled: false }), false);
  });
  it('hides when button setting off', () => {
    assert.equal(shouldShowButton({ ...base, showAiButton: false }), false);
  });
  it('hides on excluded sites', () => {
    assert.equal(shouldShowButton({ ...base, siteExcluded: true }), false);
  });
  it('hides on sensitive/ineligible fields (password, OTP, editors)', () => {
    assert.equal(shouldShowButton({ ...base, fieldEligible: false }), false);
  });
});
