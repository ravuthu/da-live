import { expect } from '@esm-bundle/chai';
import sinon from 'sinon';

import {
  resetConfigCache,
  constructConfigPaths,
  formatExternalBrief,
  findBlockContext,
  getParentBlockName,
  getBaseDmUrl,
  getAssetUrl,
  resolveDeliveryConfig,
  extractAssetMetadata,
  isAssetApprovedForDelivery,
  filterResponsiveConfigs,
  buildStructureSelection,
  buildCropItemsHtml,
  resolveStandardAssetSrc,
} from '../../../../../blocks/edit/da-assets/helpers.js';

describe('da-assets helpers', () => {
  afterEach(() => {
    resetConfigCache();
    sinon.restore();
  });

  // --- constructConfigPaths ---

  describe('constructConfigPaths', () => {
    it('returns repo-level then org-level paths', () => {
      const paths = constructConfigPaths('adobe', 'my-repo');
      expect(paths).to.deep.equal(['/adobe/my-repo/', '/adobe/']);
    });

    it('handles different owner/repo values', () => {
      const paths = constructConfigPaths('org1', 'repo2');
      expect(paths).to.deep.equal(['/org1/repo2/', '/org1/']);
    });
  });

  // --- formatExternalBrief ---

  describe('formatExternalBrief', () => {
    function createMockDoc({ textContent, nodes = [] }) {
      return {
        textContent,
        descendants: (callback) => {
          for (const node of nodes) {
            const shouldContinue = callback(node);
            if (!shouldContinue) break;
          }
        },
      };
    }

    it('returns empty string if document has no text content', () => {
      const doc = createMockDoc({ title: '', textContent: '', nodes: [] });
      expect(formatExternalBrief(doc)).to.equal('');
    });

    it('includes title when H1 heading is present', () => {
      const doc = createMockDoc({
        title: 'My Page',
        textContent: 'My Page Some body text',
        nodes: [
          { type: { name: 'heading' }, attrs: { level: 1 }, textContent: 'My Page' },
          { type: { name: 'paragraph' }, attrs: {}, textContent: 'Some body text' },
        ],
      });
      const result = formatExternalBrief(doc);
      expect(result).to.include('Title: My Page');
      expect(result).to.include('My Page Some body text');
      expect(result).to.include('visually appealing');
    });

    it('omits title line when no H1 heading exists', () => {
      const doc = createMockDoc({
        title: '',
        textContent: 'Just some text',
        nodes: [
          { type: { name: 'paragraph' }, attrs: {}, textContent: 'Just some text' },
        ],
      });
      const result = formatExternalBrief(doc);
      expect(result).not.to.include('Title:');
      expect(result).to.include('Just some text');
    });

    it('uses only the first H1 heading as the title', () => {
      const doc = createMockDoc({
        title: 'First Title',
        textContent: 'First Title Second Title body',
        nodes: [
          { type: { name: 'heading' }, attrs: { level: 1 }, textContent: 'First Title' },
          { type: { name: 'heading' }, attrs: { level: 1 }, textContent: 'Second Title' },
          { type: { name: 'paragraph' }, attrs: {}, textContent: 'body' },
        ],
      });
      const result = formatExternalBrief(doc);
      expect(result).to.include('Title: First Title');
      expect(result).not.to.include('Title: Second Title');
    });

    it('ignores H2 headings as title', () => {
      const doc = createMockDoc({
        title: '',
        textContent: 'H2 heading body',
        nodes: [
          { type: { name: 'heading' }, attrs: { level: 2 }, textContent: 'H2 heading' },
          { type: { name: 'paragraph' }, attrs: {}, textContent: 'body' },
        ],
      });
      const result = formatExternalBrief(doc);
      expect(result).not.to.include('Title:');
    });
  });

  // --- findBlockContext ---

  describe('findBlockContext', () => {
    // The comparison uses object identity (===), so the schema tableType
    // and the node type must be the same object reference.
    function createMockView(nodes, tableType) {
      return {
        state: {
          selection: {
            $from: {
              depth: nodes.length,
              node: (depth) => nodes[depth - 1],
            },
          },
          schema: { nodes: { table: tableType } },
        },
      };
    }

    it('returns the table node when selection is inside a table', () => {
      const tableType = { name: 'table' };
      const tableNode = { type: tableType, textContent: 'table content' };
      const view = createMockView([tableNode], tableType);
      expect(findBlockContext(view)).to.equal(tableNode);
    });

    it('returns null when selection is not inside a table', () => {
      const tableType = { name: 'table' };
      const paragraphNode = { type: { name: 'paragraph' } };
      const view = createMockView([paragraphNode], tableType);
      expect(findBlockContext(view)).to.be.null;
    });

    it('returns the nearest table when nested', () => {
      const tableType = { name: 'table' };
      const outerTable = { type: tableType, id: 'outer' };
      const innerTable = { type: tableType, id: 'inner' };
      const view = createMockView([outerTable, innerTable], tableType);
      // traverses from depth down, so innerTable is found first
      expect(findBlockContext(view)).to.equal(innerTable);
    });

    it('returns null when depth is 0', () => {
      const tableType = { name: 'table' };
      const view = createMockView([], tableType);
      expect(findBlockContext(view)).to.be.null;
    });
  });

  // --- getParentBlockName ---

  describe('getParentBlockName', () => {
    const tableType = { name: 'table' };

    function createTableNode(cellText) {
      return {
        type: tableType,
        firstChild: { firstChild: { textContent: cellText } },
      };
    }

    it('returns block name from first cell text', () => {
      const schema = { nodes: { table: tableType } };
      const node = createTableNode('Hero');
      expect(getParentBlockName(node, schema)).to.equal('hero');
    });

    it('strips variant info in parentheses', () => {
      const schema = { nodes: { table: tableType } };
      const node = createTableNode('Marquee (dark, large)');
      expect(getParentBlockName(node, schema)).to.equal('marquee');
    });

    it('converts spaces to hyphens', () => {
      const schema = { nodes: { table: tableType } };
      const node = createTableNode('Section Metadata');
      expect(getParentBlockName(node, schema)).to.equal('section-metadata');
    });

    it('returns null if parentBlock is null', () => {
      const schema = { nodes: { table: tableType } };
      expect(getParentBlockName(null, schema)).to.be.null;
    });

    it('returns null if parentBlock is not a table', () => {
      const schema = { nodes: { table: tableType } };
      const node = { type: { name: 'paragraph' } };
      expect(getParentBlockName(node, schema)).to.be.null;
    });

    it('returns null if no first row', () => {
      const schema = { nodes: { table: tableType } };
      const node = { type: tableType, firstChild: null };
      expect(getParentBlockName(node, schema)).to.be.null;
    });

    it('returns null if no first cell', () => {
      const schema = { nodes: { table: tableType } };
      const node = { type: tableType, firstChild: { firstChild: null } };
      expect(getParentBlockName(node, schema)).to.be.null;
    });
  });

  // --- getBaseDmUrl ---

  describe('getBaseDmUrl', () => {
    it('builds URL with /adobe/assets/ when origin has no path', () => {
      const asset = { 'repo:id': 'abc-123' };
      const url = getBaseDmUrl('delivery-p12345-e67890.adobeaemcloud.com', asset);
      expect(url).to.equal('https://delivery-p12345-e67890.adobeaemcloud.com/adobe/assets/abc-123');
    });

    it('builds URL without /adobe/assets/ when origin includes a path', () => {
      const asset = { 'repo:id': 'abc-123' };
      // When the origin includes '/', the repo:id is appended directly
      const url = getBaseDmUrl('custom.cdn.com/assets/', asset);
      expect(url).to.equal('https://custom.cdn.com/assets/abc-123');
    });
  });

  // --- getAssetUrl ---

  describe('getAssetUrl', () => {
    const asset = {
      name: 'photo.jpg',
      path: '/content/dam/images/photo.jpg',
      'repo:id': 'abc-123',
    };

    it('returns publish URL when DM delivery is disabled', () => {
      const url = getAssetUrl({
        prodOrigin: 'publish-p12345-e67890.adobeaemcloud.com',
        dmDeliveryEnabled: false,
        asset,
      });
      expect(url).to.equal('https://publish-p12345-e67890.adobeaemcloud.com/content/dam/images/photo.jpg');
    });

    it('returns DM delivery URL when DM delivery is enabled', () => {
      const url = getAssetUrl({
        prodOrigin: 'delivery-p12345-e67890.adobeaemcloud.com',
        dmDeliveryEnabled: true,
        asset,
      });
      expect(url).to.equal(
        'https://delivery-p12345-e67890.adobeaemcloud.com/adobe/assets/abc-123/as/photo.jpg',
      );
    });

    it('includes /original segment for video assets', () => {
      const videoAsset = { ...asset, mimetype: 'video/mp4' };
      const url = getAssetUrl({
        prodOrigin: 'delivery-p12345-e67890.adobeaemcloud.com',
        dmDeliveryEnabled: true,
        asset: videoAsset,
      });
      expect(url).to.include('/original/as/photo.jpg');
    });

    it('uses custom name when provided', () => {
      const url = getAssetUrl({
        prodOrigin: 'delivery-p12345-e67890.adobeaemcloud.com',
        dmDeliveryEnabled: true,
        asset,
        name: 'crop-photo.jpg',
      });
      expect(url).to.include('/as/crop-photo.jpg');
    });
  });

  // --- resolveDeliveryConfig ---

  describe('resolveDeliveryConfig', () => {
    it('detects author repo from repoId', () => {
      const result = resolveDeliveryConfig({
        repoId: 'author-p12345-e67890.adobeaemcloud.com',
        smartCropSelectEnabled: false,
        dmDeliveryValue: null,
        prodOriginConfig: null,
      });
      expect(result.isAuthorRepo).to.be.true;
    });

    it('detects non-author repo', () => {
      const result = resolveDeliveryConfig({
        repoId: 'publish-p12345-e67890.adobeaemcloud.com',
        smartCropSelectEnabled: false,
        dmDeliveryValue: null,
        prodOriginConfig: null,
      });
      expect(result.isAuthorRepo).to.be.false;
    });

    it('enables DM delivery when smartCropSelectEnabled is true', () => {
      const result = resolveDeliveryConfig({
        repoId: 'author-p12345-e67890.adobeaemcloud.com',
        smartCropSelectEnabled: true,
        dmDeliveryValue: null,
        prodOriginConfig: null,
      });
      expect(result.dmDeliveryEnabled).to.be.true;
    });

    it('enables DM delivery when dmDeliveryValue is "on"', () => {
      const result = resolveDeliveryConfig({
        repoId: 'author-p12345-e67890.adobeaemcloud.com',
        smartCropSelectEnabled: false,
        dmDeliveryValue: 'on',
        prodOriginConfig: null,
      });
      expect(result.dmDeliveryEnabled).to.be.true;
    });

    it('enables DM delivery when prodOriginConfig starts with "delivery-"', () => {
      const result = resolveDeliveryConfig({
        repoId: 'author-p12345-e67890.adobeaemcloud.com',
        smartCropSelectEnabled: false,
        dmDeliveryValue: null,
        prodOriginConfig: 'delivery-custom.cdn.com',
      });
      expect(result.dmDeliveryEnabled).to.be.true;
    });

    it('disables DM delivery when none of the conditions are met', () => {
      const result = resolveDeliveryConfig({
        repoId: 'author-p12345-e67890.adobeaemcloud.com',
        smartCropSelectEnabled: false,
        dmDeliveryValue: null,
        prodOriginConfig: null,
      });
      expect(result.dmDeliveryEnabled).to.be.false;
    });

    it('uses custom prodOriginConfig when provided', () => {
      const result = resolveDeliveryConfig({
        repoId: 'author-p12345-e67890.adobeaemcloud.com',
        smartCropSelectEnabled: false,
        dmDeliveryValue: null,
        prodOriginConfig: 'custom.cdn.com',
      });
      expect(result.prodOrigin).to.equal('custom.cdn.com');
    });

    it('derives delivery prodOrigin when DM enabled and no custom origin', () => {
      const result = resolveDeliveryConfig({
        repoId: 'author-p12345-e67890.adobeaemcloud.com',
        smartCropSelectEnabled: true,
        dmDeliveryValue: null,
        prodOriginConfig: null,
      });
      expect(result.prodOrigin).to.equal('delivery-p12345-e67890.adobeaemcloud.com');
    });

    it('derives publish prodOrigin when DM disabled and no custom origin', () => {
      const result = resolveDeliveryConfig({
        repoId: 'author-p12345-e67890.adobeaemcloud.com',
        smartCropSelectEnabled: false,
        dmDeliveryValue: null,
        prodOriginConfig: null,
      });
      expect(result.prodOrigin).to.equal('publish-p12345-e67890.adobeaemcloud.com');
    });
  });

  // --- extractAssetMetadata ---

  describe('extractAssetMetadata', () => {
    it('extracts all metadata from a fully populated asset', () => {
      const asset = {
        'aem:formatName': 'jpeg',
        mimetype: 'image/jpeg',
        _embedded: {
          'http://ns.adobe.com/adobecloud/rel/metadata/asset': {
            'dam:assetStatus': 'approved',
            'dam:activationTarget': 'delivery',
            'dc:description': 'A beautiful landscape',
            'dc:title': 'Landscape Photo',
          },
        },
      };

      const result = extractAssetMetadata(asset);
      expect(result.format).to.equal('jpeg');
      expect(result.mimetype).to.equal('image/jpeg');
      expect(result.isImage).to.be.true;
      expect(result.status).to.equal('approved');
      expect(result.activationTarget).to.equal('delivery');
      expect(result.alt).to.equal('A beautiful landscape');
    });

    it('falls back to dc:format when mimetype is absent', () => {
      const asset = {
        'aem:formatName': 'png',
        'dc:format': 'image/png',
        _embedded: { 'http://ns.adobe.com/adobecloud/rel/metadata/asset': {} },
      };

      const result = extractAssetMetadata(asset);
      expect(result.mimetype).to.equal('image/png');
      expect(result.isImage).to.be.true;
    });

    it('falls back to dc:title when dc:description is absent', () => {
      const asset = {
        'aem:formatName': 'jpeg',
        mimetype: 'image/jpeg',
        _embedded: { 'http://ns.adobe.com/adobecloud/rel/metadata/asset': { 'dc:title': 'Photo Title' } },
      };

      const result = extractAssetMetadata(asset);
      expect(result.alt).to.equal('Photo Title');
    });

    it('returns undefined alt when neither description nor title exists', () => {
      const asset = {
        'aem:formatName': 'pdf',
        mimetype: 'application/pdf',
        _embedded: { 'http://ns.adobe.com/adobecloud/rel/metadata/asset': {} },
      };

      const result = extractAssetMetadata(asset);
      expect(result.alt).to.be.undefined;
    });

    it('handles non-image mimetypes correctly', () => {
      const asset = {
        'aem:formatName': 'mp4',
        mimetype: 'video/mp4',
        _embedded: { 'http://ns.adobe.com/adobecloud/rel/metadata/asset': {} },
      };

      const result = extractAssetMetadata(asset);
      expect(result.isImage).to.be.false;
    });

    it('handles missing _embedded gracefully', () => {
      const asset = {
        'aem:formatName': 'jpeg',
        mimetype: 'image/jpeg',
      };

      const result = extractAssetMetadata(asset);
      expect(result.status).to.be.undefined;
      expect(result.activationTarget).to.be.undefined;
      expect(result.alt).to.be.undefined;
    });

    it('returns undefined format when aem:formatName is absent', () => {
      const asset = { mimetype: 'image/jpeg' };
      const result = extractAssetMetadata(asset);
      expect(result.format).to.be.undefined;
    });
  });

  // --- isAssetApprovedForDelivery ---

  describe('isAssetApprovedForDelivery', () => {
    it('returns true when DM delivery is disabled', () => {
      expect(isAssetApprovedForDelivery({
        dmDeliveryEnabled: false,
        isAuthorRepo: true,
        activationTarget: null,
        status: null,
      })).to.be.true;
    });

    it('returns true when not an author repo', () => {
      expect(isAssetApprovedForDelivery({
        dmDeliveryEnabled: true,
        isAuthorRepo: false,
        activationTarget: null,
        status: null,
      })).to.be.true;
    });

    it('returns true when activationTarget is "delivery"', () => {
      expect(isAssetApprovedForDelivery({
        dmDeliveryEnabled: true,
        isAuthorRepo: true,
        activationTarget: 'delivery',
        status: null,
      })).to.be.true;
    });

    it('returns true when status is "approved"', () => {
      expect(isAssetApprovedForDelivery({
        dmDeliveryEnabled: true,
        isAuthorRepo: true,
        activationTarget: null,
        status: 'approved',
      })).to.be.true;
    });

    it('returns false when DM enabled, author repo, and asset not approved or targeted', () => {
      expect(isAssetApprovedForDelivery({
        dmDeliveryEnabled: true,
        isAuthorRepo: true,
        activationTarget: null,
        status: null,
      })).to.be.false;
    });

    it('returns false when status is "draft" on author repo with DM', () => {
      expect(isAssetApprovedForDelivery({
        dmDeliveryEnabled: true,
        isAuthorRepo: true,
        activationTarget: 'preview',
        status: 'draft',
      })).to.be.false;
    });
  });

  // --- filterResponsiveConfigs ---

  describe('filterResponsiveConfigs', () => {
    const smartCropItems = [
      { name: 'mobile' },
      { name: 'tablet' },
      { name: 'desktop' },
    ];

    const configs = [
      { name: 'Hero Layout', position: 'hero', crops: ['mobile', 'desktop'] },
      { name: 'Universal', position: 'everywhere', crops: ['mobile', 'tablet'] },
      { name: 'Outside Only', position: 'outside-blocks', crops: ['desktop'] },
      { name: 'Missing Crop', position: 'everywhere', crops: ['mobile', 'nonexistent'] },
    ];

    it('returns empty array when responsiveImageConfig is null', () => {
      const result = filterResponsiveConfigs({
        responsiveImageConfig: null,
        parentBlockName: null,
        smartCropItems,
      });
      expect(result).to.deep.equal([]);
    });

    it('filters for "everywhere" and "outside-blocks" when no parent block', () => {
      const result = filterResponsiveConfigs({
        responsiveImageConfig: configs,
        parentBlockName: null,
        smartCropItems,
      });
      expect(result).to.have.lengthOf(2);
      expect(result.map((c) => c.name)).to.include('Universal');
      expect(result.map((c) => c.name)).to.include('Outside Only');
    });

    it('filters for "everywhere" and matching block name when inside a block', () => {
      const result = filterResponsiveConfigs({
        responsiveImageConfig: configs,
        parentBlockName: 'hero',
        smartCropItems,
      });
      expect(result).to.have.lengthOf(2);
      expect(result.map((c) => c.name)).to.include('Hero Layout');
      expect(result.map((c) => c.name)).to.include('Universal');
    });

    it('excludes configs with crops not present in smartCropItems', () => {
      const result = filterResponsiveConfigs({
        responsiveImageConfig: configs,
        parentBlockName: null,
        smartCropItems,
      });
      expect(result.map((c) => c.name)).not.to.include('Missing Crop');
    });

    it('returns empty array when no configs match', () => {
      const result = filterResponsiveConfigs({
        responsiveImageConfig: configs,
        parentBlockName: 'marquee',
        smartCropItems: [{ name: 'nonexistent' }],
      });
      expect(result).to.deep.equal([]);
    });
  });

  // --- buildStructureSelection ---

  describe('buildStructureSelection', () => {
    const smartCropItems = [{ name: 'mobile' }, { name: 'desktop' }];

    it('returns empty string when no responsive configs match', () => {
      const result = buildStructureSelection({
        responsiveImageConfig: [],
        parentBlockName: null,
        smartCropItems,
      });
      expect(result).to.equal('');
    });

    it('returns empty string when responsiveImageConfig is null', () => {
      const result = buildStructureSelection({
        responsiveImageConfig: null,
        parentBlockName: null,
        smartCropItems,
      });
      expect(result).to.equal('');
    });

    it('generates HTML with radio buttons for matching configs', () => {
      const configs = [
        { name: 'Layout A', position: 'everywhere', crops: ['mobile', 'desktop'] },
      ];
      const result = buildStructureSelection({
        responsiveImageConfig: configs,
        parentBlockName: null,
        smartCropItems,
      });
      expect(result).to.include('Insert Type');
      expect(result).to.include('Single, Manual');
      expect(result).to.include('Layout A');
      expect(result).to.include('da-dialog-asset-structure-select');
    });

    it('includes the "Single, Manual" option checked by default', () => {
      const configs = [
        { name: 'Layout A', position: 'everywhere', crops: ['mobile', 'desktop'] },
      ];
      const result = buildStructureSelection({
        responsiveImageConfig: configs,
        parentBlockName: null,
        smartCropItems,
      });
      expect(result).to.include('id="single"');
      expect(result).to.include('checked');
    });

    it('encodes config values in radio button values', () => {
      const configs = [
        { name: 'Layout A', position: 'everywhere', crops: ['mobile', 'desktop'] },
      ];
      const result = buildStructureSelection({
        responsiveImageConfig: configs,
        parentBlockName: null,
        smartCropItems,
      });
      const expectedValue = encodeURIComponent(JSON.stringify(configs[0]));
      expect(result).to.include(`value="${expectedValue}"`);
    });
  });

  // --- buildCropItemsHtml ---

  describe('buildCropItemsHtml', () => {
    const asset = {
      name: 'hero.jpg',
      path: '/content/dam/hero.jpg',
      'repo:id': 'asset-123',
    };

    it('includes the original crop as first selected item', () => {
      const html = buildCropItemsHtml({
        smartCropItems: [],
        prodOrigin: 'delivery-p123-e456.adobeaemcloud.com',
        dmDeliveryEnabled: true,
        asset,
      });
      expect(html).to.include('class="selected"');
      expect(html).to.include('data-name="original"');
      expect(html).to.include('Original');
    });

    it('includes smart crop items with correct URLs', () => {
      const html = buildCropItemsHtml({
        smartCropItems: [{ name: 'mobile' }, { name: 'desktop' }],
        prodOrigin: 'delivery-p123-e456.adobeaemcloud.com',
        dmDeliveryEnabled: true,
        asset,
      });
      expect(html).to.include('data-name="mobile"');
      expect(html).to.include('data-name="desktop"');
      expect(html).to.include('?smartcrop=mobile');
      expect(html).to.include('?smartcrop=desktop');
    });

    it('uses publish URLs when DM delivery is disabled', () => {
      const html = buildCropItemsHtml({
        smartCropItems: [],
        prodOrigin: 'publish-p123-e456.adobeaemcloud.com',
        dmDeliveryEnabled: false,
        asset,
      });
      expect(html).to.include('https://publish-p123-e456.adobeaemcloud.com/content/dam/hero.jpg');
    });
  });

  // --- resolveStandardAssetSrc ---

  describe('resolveStandardAssetSrc', () => {
    const asset = {
      name: 'photo.jpg',
      path: '/content/dam/photo.jpg',
      'repo:id': 'asset-456',
      _links: {
        'http://ns.adobe.com/adobecloud/rel/rendition': [
          { href: 'https://cdn.example.com/rendition1?width=200' },
          { href: 'https://cdn.example.com/rendition2' },
        ],
      },
    };

    it('returns getAssetUrl when aemTierType is "author"', () => {
      const src = resolveStandardAssetSrc({
        aemTierType: 'author',
        mimetype: 'image/jpeg',
        asset,
        prodOrigin: 'publish-p123-e456.adobeaemcloud.com',
        dmDeliveryEnabled: false,
      });
      expect(src).to.equal('https://publish-p123-e456.adobeaemcloud.com/content/dam/photo.jpg');
    });

    it('returns video play link for video mimetype', () => {
      const videoAsset = {
        ...asset,
        _links: {
          'http://ns.adobe.com/adobecloud/rel/rendition': [
            { href: 'https://cdn.example.com/rendition1' },
            { href: 'https://cdn.example.com/video/play' },
          ],
        },
      };
      const src = resolveStandardAssetSrc({
        aemTierType: 'delivery',
        mimetype: 'video/mp4',
        asset: videoAsset,
        prodOrigin: 'delivery-p123-e456.adobeaemcloud.com',
        dmDeliveryEnabled: true,
      });
      expect(src).to.equal('https://cdn.example.com/video/play');
    });

    it('returns first rendition link without query params for non-video, non-author', () => {
      const src = resolveStandardAssetSrc({
        aemTierType: 'delivery',
        mimetype: 'image/jpeg',
        asset,
        prodOrigin: 'delivery-p123-e456.adobeaemcloud.com',
        dmDeliveryEnabled: true,
      });
      expect(src).to.equal('https://cdn.example.com/rendition1');
    });

    it('handles missing _links gracefully', () => {
      const assetNoLinks = { name: 'photo.jpg', path: '/dam/photo.jpg', 'repo:id': 'x' };
      const src = resolveStandardAssetSrc({
        aemTierType: 'delivery',
        mimetype: 'image/jpeg',
        asset: assetNoLinks,
        prodOrigin: 'delivery-p123-e456.adobeaemcloud.com',
        dmDeliveryEnabled: true,
      });
      expect(src).to.be.undefined;
    });

    it('handles missing mimetype gracefully', () => {
      const src = resolveStandardAssetSrc({
        aemTierType: 'delivery',
        mimetype: undefined,
        asset,
        prodOrigin: 'delivery-p123-e456.adobeaemcloud.com',
        dmDeliveryEnabled: true,
      });
      // Falls through to rendition URL since mimetype?.startsWith('video/') is falsy
      expect(src).to.equal('https://cdn.example.com/rendition1');
    });
  });
});
