import { DA_ORIGIN } from '../../shared/constants.js';
import { daFetch, getFirstSheet } from '../../shared/utils.js';

// --- Configuration Cache ---

const fullConfJsons = {};
const CONFS = {};

/**
 * Reset the configuration cache. Useful for testing.
 */
export function resetConfigCache() {
  Object.keys(fullConfJsons).forEach((key) => delete fullConfJsons[key]);
  Object.keys(CONFS).forEach((key) => delete CONFS[key]);
}

/**
 * Fetch and cache configuration for a given path.
 */
export async function fetchConf(path) {
  if (CONFS[path]) return CONFS[path];
  const resp = await daFetch(`${DA_ORIGIN}/config${path}`);
  if (!resp.ok) return null;

  fullConfJsons[path] = await resp.json();
  const data = getFirstSheet(fullConfJsons[path]);
  if (!data) return null;
  CONFS[path] = data;
  return data;
}

/**
 * Fetch a specific key value from configuration at the given path.
 */
export async function fetchValue(path, key) {
  if (CONFS[path]?.[key]) return CONFS[path][key];

  const data = await fetchConf(path);
  if (!data) return null;

  const confKey = data.find((conf) => conf.key === key);
  if (!confKey) return null;
  return confKey.value;
}

/**
 * Build the list of config paths to check for a given owner/repo.
 */
export function constructConfigPaths(owner, repo) {
  return [`/${owner}/${repo}/`, `/${owner}/`];
}

/**
 * Get a configuration key, checking repo-level then org-level config.
 * Note: this is also called externally to determine if the assets button should be visible.
 */
export async function getConfKey(owner, repo, key) {
  if (!(repo || owner)) return null;
  for (const path of constructConfigPaths(owner, repo)) {
    const value = await fetchValue(path, key);
    if (value) return value;
  }
  return null;
}

/**
 * Get the responsive image configuration for a given owner/repo.
 */
export async function getResponsiveImageConfig(owner, repo) {
  if (!(repo || owner)) return null;
  for (const path of constructConfigPaths(owner, repo)) {
    if (!fullConfJsons[path]) await fetchConf(path);
    const fullConfigJson = fullConfJsons[path];
    const responsiveImages = fullConfigJson?.['responsive-images'];
    if (responsiveImages) {
      return responsiveImages.data.map((config) => ({
        ...config,
        crops: config.crops.split(/\s*,\s*/),
      }));
    }
  }
  return false;
}

// --- URL Construction ---

/**
 * Build the base Dynamic Media URL for an asset.
 */
export function getBaseDmUrl(prodOrigin, asset) {
  return `https://${prodOrigin}${prodOrigin.includes('/') ? '' : '/adobe/assets/'}${asset['repo:id']}`;
}

/**
 * Build the full asset URL based on delivery mode.
 */
export function getAssetUrl({ prodOrigin, dmDeliveryEnabled, asset, name }) {
  if (!dmDeliveryEnabled) {
    return `https://${prodOrigin}${asset.path}`;
  }
  const base = getBaseDmUrl(prodOrigin, asset);
  const seg = asset.mimetype?.startsWith('video/') ? '/original' : '';
  return `${base}${seg}/as/${name || asset.name}`;
}

// --- Delivery Configuration Resolution ---

/**
 * Resolve the delivery configuration from individual config values.
 * Returns { isAuthorRepo, dmDeliveryEnabled, prodOrigin }.
 */
// eslint-disable-next-line max-len
export function resolveDeliveryConfig({ repoId, smartCropSelectEnabled, dmDeliveryValue, prodOriginConfig }) {
  const isAuthorRepo = repoId?.startsWith('author');
  const dmDeliveryEnabled = smartCropSelectEnabled
    || dmDeliveryValue === 'on'
    || (prodOriginConfig?.startsWith('delivery-') ?? false);
  const prodOrigin = prodOriginConfig
    || `${repoId.replace('author', dmDeliveryEnabled ? 'delivery' : 'publish')}`;
  return { isAuthorRepo, dmDeliveryEnabled, prodOrigin };
}

// --- Document / Editor Helpers ---

/**
 * Format the current document content as an external brief for the asset selector advisor.
 */
export function formatExternalBrief(doc) {
  let title = '';
  doc.descendants((node) => {
    if (node.type.name === 'heading' && node.attrs.level === 1 && !title) {
      title = node.textContent;
    }
    return !title;
  });

  const contentPlainText = doc.textContent;
  if (!contentPlainText) return '';

  return `The user is looking for assets that match a web page with the following content:

  ${title ? `Title: ${title}` : ''}

  ${contentPlainText}

  Please suggest Assets that are visually appealing and relevant to the subject.`;
}

/**
 * Find the nearest block (table) context in the ProseMirror selection.
 */
export function findBlockContext(view) {
  const { $from } = view.state.selection;
  for (let { depth } = $from; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type === view.state.schema.nodes.table) {
      return node;
    }
  }
  return null;
}

/**
 * Extract the block name from a parent table node.
 */
export function getParentBlockName(parentBlock, schema) {
  if (!parentBlock || parentBlock.type !== schema.nodes.table) return null;

  const firstRow = parentBlock.firstChild;
  if (!firstRow) return null;

  const firstCell = firstRow.firstChild;
  if (!firstCell) return null;

  return firstCell.textContent?.toLowerCase().split('(')[0].trim().replaceAll(' ', '-');
}

// --- Asset Metadata ---

const METADATA_NS = 'http://ns.adobe.com/adobecloud/rel/metadata/asset';

/**
 * Extract relevant metadata from an asset object returned by the asset selector.
 */
export function extractAssetMetadata(asset) {
  const format = asset['aem:formatName'];
  const mimetype = asset.mimetype || asset['dc:format'];
  const isImage = mimetype?.toLowerCase().startsWith('image/');
  // eslint-disable-next-line no-underscore-dangle
  const metadata = asset?._embedded?.[METADATA_NS];
  const status = metadata?.['dam:assetStatus'];
  const activationTarget = metadata?.['dam:activationTarget'];
  const alt = metadata?.['dc:description'] || metadata?.['dc:title'];

  return {
    format, mimetype, isImage, status, activationTarget, alt,
  };
}

/**
 * Check if an asset is approved for delivery.
 * Returns true if the asset can be used, false if it should be blocked.
 */
// eslint-disable-next-line max-len
export function isAssetApprovedForDelivery({ dmDeliveryEnabled, isAuthorRepo, activationTarget, status }) {
  if (!dmDeliveryEnabled || !isAuthorRepo) return true;
  return activationTarget === 'delivery' || status === 'approved';
}

// --- Smart Crop Helpers ---

/**
 * Filter responsive image configs that match the current context and available crops.
 */
// eslint-disable-next-line max-len
export function filterResponsiveConfigs({ responsiveImageConfig, parentBlockName, smartCropItems }) {
  if (!responsiveImageConfig) return [];

  const positionFilter = parentBlockName
    ? (config) => config.position === 'everywhere' || config.position === parentBlockName
    : (config) => config.position === 'everywhere' || config.position === 'outside-blocks';

  return responsiveImageConfig.filter(
    (config) => positionFilter(config)
      && config.crops.every(
        (crop) => smartCropItems.find((item) => item.name === crop),
      ),
  );
}

/**
 * Build the HTML for the responsive image structure selection UI.
 */
// eslint-disable-next-line max-len
export function buildStructureSelection({ responsiveImageConfig, parentBlockName, smartCropItems }) {
  // eslint-disable-next-line max-len
  const configs = filterResponsiveConfigs({ responsiveImageConfig, parentBlockName, smartCropItems });

  if (configs.length === 0) return '';

  const radioItems = configs.map(
    (config, i) => `<input type="radio" id="da-dialog-asset-structure-select-${i}" name="da-dialog-asset-structure-select" value="${encodeURIComponent(JSON.stringify(config))}"><label for="da-dialog-asset-structure-select-${i}">${config.name}</label>`,
  ).join('</li><li>');

  return `<h2>Insert Type</h2><ul class="da-dialog-asset-structure-select">
              <li><input checked type="radio" id="single" name="da-dialog-asset-structure-select" value="single"><label for="single">Single, Manual</label></li>
              <li>${radioItems}</li>
            </ul>`;
}

/**
 * Build the HTML for the crop items list.
 */
export function buildCropItemsHtml({ smartCropItems, prodOrigin, dmDeliveryEnabled, asset }) {
  const originalUrl = getAssetUrl({ prodOrigin, dmDeliveryEnabled, asset });
  const cropItems = smartCropItems.map((smartCrop) => {
    const cropUrl = getAssetUrl({
      prodOrigin,
      dmDeliveryEnabled,
      asset,
      name: `${smartCrop.name}-${asset.name}`,
    });
    return `<li data-name="${smartCrop.name}"><p>${smartCrop.name}</p><img src="${cropUrl}?smartcrop=${smartCrop.name}">`;
  }).join('</li>');

  return `<li class="selected" data-name="original"><p>Original</p><img src="${originalUrl}"></li>${cropItems}</li>`;
}

/**
 * Resolve the source URL for standard (non-smart-crop) assets.
 */
// eslint-disable-next-line max-len
export function resolveStandardAssetSrc({ aemTierType, mimetype, asset, prodOrigin, dmDeliveryEnabled }) {
  if (aemTierType === 'author') {
    return getAssetUrl({ prodOrigin, dmDeliveryEnabled, asset });
  }

  // eslint-disable-next-line no-underscore-dangle
  const renditionLinks = asset?._links?.['http://ns.adobe.com/adobecloud/rel/rendition'];

  if (mimetype?.startsWith('video/')) {
    return renditionLinks?.find((link) => link.href.endsWith('/play'))?.href;
  }

  return renditionLinks?.[0]?.href.split('?')[0];
}
