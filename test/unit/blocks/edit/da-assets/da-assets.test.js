import { expect } from '@esm-bundle/chai';
import sinon from 'sinon';
import { setNx } from '../../../../../scripts/utils.js';

import { resetConfigCache } from '../../../../../blocks/edit/da-assets/helpers.js';

// Set up nx mock before importing da-assets (which has top-level awaits).
// Using example.com so setNx returns the fixture path (isProd = true).
setNx('/test/fixtures/nx', { hostname: 'example.com' });

// Mock window.PureJSSelectors before importing
window.PureJSSelectors = { renderAssetSelector: sinon.stub() };

let openAssets;
let getConfKey;

describe('da-assets', () => {
  before(async () => {
    const mod = await import('../../../../../blocks/edit/da-assets/da-assets.js');
    openAssets = mod.openAssets;
    getConfKey = mod.getConfKey;
  });

  afterEach(() => {
    resetConfigCache();
    sinon.restore();
    document.body.innerHTML = '';
    delete window.view;
  });

  describe('getConfKey (re-exported)', () => {
    it('is exported and is a function', () => {
      expect(getConfKey).to.be.a('function');
    });

    it('returns null when owner and repo are both falsy', async () => {
      const result = await getConfKey(null, null, 'some.key');
      expect(result).to.be.null;
    });
  });

  describe('openAssets', () => {
    it('does not proceed when user has no access token', async () => {
      // The mock loadIms resolves with undefined, so imsDetails.anonymous
      // would throw. openAssets should handle this gracefully by exiting
      // before calling PureJSSelectors.
      try {
        await openAssets();
      } catch {
        // Expected: mock loadIms returns undefined, causing early exit/error
      }
      expect(window.PureJSSelectors.renderAssetSelector.called).to.be.false;
    });
  });
});
