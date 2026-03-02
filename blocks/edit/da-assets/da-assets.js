import { DOMParser as proseDOMParser, Fragment } from 'da-y-wrapper';
import { getNx } from '../../../scripts/utils.js';
import { daFetch } from '../../shared/utils.js';
import getPathDetails from '../../shared/pathDetails.js';
import {
  getConfKey,
  getResponsiveImageConfig,
  resolveDeliveryConfig,
  getBaseDmUrl,
  getAssetUrl,
  formatExternalBrief,
  findBlockContext,
  getParentBlockName,
  extractAssetMetadata,
  isAssetApprovedForDelivery,
  buildStructureSelection,
  buildCropItemsHtml,
  resolveStandardAssetSrc,
} from './helpers.js';

export { getConfKey };

const { loadStyle } = await import(`${getNx()}/scripts/nexter.js`);
const { loadIms, handleSignIn } = await import(`${getNx()}/utils/ims.js`);
const loadScript = (await import(`${getNx()}/utils/script.js`)).default;

const ASSET_SELECTOR_URL = 'https://experience.adobe.com/solutions/CQ-assets-selectors/static-assets/resources/assets-selectors.js';

// --- Dialog Management ---

function createDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'da-dialog-asset';

  const assetSelectorWrapper = document.createElement('div');
  assetSelectorWrapper.className = 'da-dialog-asset-inner';
  dialog.append(assetSelectorWrapper);

  const cropSelectorWrapper = document.createElement('div');
  cropSelectorWrapper.style.display = 'none';
  cropSelectorWrapper.className = 'da-dialog-asset-inner';
  dialog.append(cropSelectorWrapper);

  const resetCropSelector = () => {
    cropSelectorWrapper.style.display = 'none';
    cropSelectorWrapper.innerHTML = '';
    assetSelectorWrapper.style.display = 'block';
  };

  return { dialog, assetSelectorWrapper, cropSelectorWrapper, resetCropSelector };
}

// --- Unapproved Asset Error ---

// eslint-disable-next-line max-len
function showUnapprovedError({ cropSelectorWrapper, assetSelectorWrapper, resetCropSelector, dialog }) {
  assetSelectorWrapper.style.display = 'none';
  cropSelectorWrapper.style.display = 'block';
  cropSelectorWrapper.innerHTML = '<p class="da-dialog-asset-error">The selected asset is not available because it is not approved for delivery. Please check the status.</p><div class="da-dialog-asset-buttons"><button class="back">Back</button><button class="cancel">Cancel</button></div>';
  cropSelectorWrapper.querySelector('.cancel').addEventListener('click', () => {
    resetCropSelector();
    dialog.close();
  });
  cropSelectorWrapper.querySelector('.back').addEventListener('click', () => resetCropSelector());
}

// --- Smart Crop Selection ---

function setupCropToolbarHandlers({
  cropSelectorWrapper, cropSelectorList, dialog,
  resetCropSelector, createImage, view, state,
}) {
  cropSelectorWrapper.querySelector('.cancel').addEventListener('click', () => {
    resetCropSelector();
    dialog.close();
  });

  cropSelectorWrapper.querySelector('.back').addEventListener('click', () => resetCropSelector());

  cropSelectorWrapper.querySelector('.insert').addEventListener('click', () => {
    dialog.close();

    const insertTypeSelection = cropSelectorWrapper.querySelector(
      '.da-dialog-asset-structure-select input:checked',
    );
    const structureConfig = !insertTypeSelection || insertTypeSelection.value === 'single'
      ? null
      : JSON.parse(decodeURIComponent(insertTypeSelection.value));

    const singleSelectedCropElement = cropSelectorList.querySelector('.selected');
    const singleSelectedCropElementName = !structureConfig
      ? singleSelectedCropElement?.dataset.name
      : 'original';

    const fragment = Fragment.fromArray(
      (structureConfig?.crops || [singleSelectedCropElementName]).map(
        (crop) => createImage(
          cropSelectorList.querySelector(`[data-name="${crop}"] img`)?.src,
        ),
      ),
    );
    resetCropSelector();
    view.dispatch(
      state.tr.insert(state.selection.from, fragment).deleteSelection().scrollIntoView(),
    );
  });
}

function setupStructureChangeHandler(cropSelectorWrapper, cropSelectorList) {
  cropSelectorWrapper.querySelector('.da-dialog-asset-structure-select')?.addEventListener('change', (e) => {
    if (e.target.value === 'single') {
      cropSelectorList.querySelectorAll('li').forEach((crop) => crop.classList.remove('selected'));
      cropSelectorList.querySelector('li[data-name="original"]').classList.add('selected');
    } else {
      const structure = JSON.parse(decodeURIComponent(e.target.value));
      cropSelectorList.querySelectorAll('li').forEach((crop) => {
        if (structure.crops.includes(crop.dataset.name)) {
          crop.classList.add('selected');
        } else {
          crop.classList.remove('selected');
        }
      });
    }
  });
}

function setupCropListClickHandler(cropSelectorList, cropSelectorWrapper) {
  cropSelectorList.addEventListener('click', () => {
    const structure = cropSelectorWrapper.querySelector(
      '.da-dialog-asset-structure-select input:checked',
    );
    if (structure && structure.value !== 'single') return;
    const li = cropSelectorList.querySelector('li:hover');
    if (!li) return;
    cropSelectorList.querySelector('.selected')?.classList.remove('selected');
    li.classList.add('selected');
  });
}

async function showSmartCropSelector({
  asset, assetSelectorWrapper, cropSelectorWrapper, dialog,
  resetCropSelector, createImage, config, view, state,
}) {
  assetSelectorWrapper.style.display = 'none';
  cropSelectorWrapper.style.display = 'block';

  const { prodOrigin, dmDeliveryEnabled } = config;
  const dmBaseUrl = getBaseDmUrl(prodOrigin, asset);
  const listSmartCropsResponse = await daFetch(`${dmBaseUrl}/smartCrops`);
  const listSmartCrops = await listSmartCropsResponse.json();

  // If no smart crops available, insert original and return
  if (!(listSmartCrops.items?.length > 0)) {
    dialog.close();
    const assetSrc = getAssetUrl({ prodOrigin, dmDeliveryEnabled, asset });
    const fpo = createImage(assetSrc);
    resetCropSelector();
    view.dispatch(state.tr.replaceSelectionWith(fpo).scrollIntoView());
    return;
  }

  const parentBlock = findBlockContext(view);
  const parentBlockName = getParentBlockName(parentBlock, state.schema);
  const responsiveImageConfig = await config.loadResponsiveImageConfig;

  const structureSelection = buildStructureSelection({
    responsiveImageConfig,
    parentBlockName,
    smartCropItems: listSmartCrops.items,
  });

  cropSelectorWrapper.innerHTML = `<div class="da-dialog-asset-crops-toolbar"><button class="cancel">Cancel</button><button class="back">Back</button><button class="insert">Insert</button></div>${structureSelection}<h2>Smart Crops</h2>`;

  const cropSelectorList = document.createElement('ul');
  cropSelectorList.classList.add('da-dialog-asset-crops');
  cropSelectorWrapper.append(cropSelectorList);

  setupCropToolbarHandlers({
    cropSelectorWrapper,
    cropSelectorList,
    dialog,
    resetCropSelector,
    createImage,
    view,
    state,
  });

  cropSelectorList.innerHTML = buildCropItemsHtml({
    smartCropItems: listSmartCrops.items,
    prodOrigin,
    dmDeliveryEnabled,
    asset,
  });

  setupCropListClickHandler(cropSelectorList, cropSelectorWrapper);
  setupStructureChangeHandler(cropSelectorWrapper, cropSelectorList);
}

// --- Standard Asset Insertion ---

function insertStandardAsset({
  asset, config, dialog, view, state, isImage, injectLink, createImage,
}) {
  dialog.close();

  const { aemTierType, prodOrigin, dmDeliveryEnabled } = config;
  const { mimetype } = extractAssetMetadata(asset);

  // eslint-disable-next-line max-len
  const src = resolveStandardAssetSrc({ aemTierType, mimetype, asset, prodOrigin, dmDeliveryEnabled });

  let fpo;
  if (!isImage || injectLink) {
    const para = document.createElement('p');
    const link = document.createElement('a');
    link.href = src;
    link.innerText = src;
    para.append(link);
    fpo = proseDOMParser.fromSchema(window.view.state.schema).parse(para);
  } else {
    fpo = createImage(src);
  }

  view.dispatch(state.tr.replaceSelectionWith(fpo).scrollIntoView());
}

// --- Configuration Resolution ---

async function resolveAllConfig(owner, repo) {
  const repoId = await getConfKey(owner, repo, 'aem.repositoryId');
  const prodOriginConfig = await getConfKey(owner, repo, 'aem.assets.prod.origin');
  const smartCropSelectEnabled = (await getConfKey(owner, repo, 'aem.asset.smartcrop.select')) === 'on';
  const dmDeliveryValue = await getConfKey(owner, repo, 'aem.asset.dm.delivery');
  const injectLink = (await getConfKey(owner, repo, 'aem.assets.image.type')) === 'link';

  // eslint-disable-next-line max-len
  const { isAuthorRepo, dmDeliveryEnabled, prodOrigin } = resolveDeliveryConfig({ repoId, smartCropSelectEnabled, dmDeliveryValue, prodOriginConfig });

  const aemTierType = repoId.includes('delivery') ? 'delivery' : 'author';
  const featureSet = ['upload', 'collections', 'detail-panel', 'advisor'];
  if (dmDeliveryEnabled) featureSet.push('dynamic-media');

  const loadResponsiveImageConfig = getResponsiveImageConfig(owner, repo);

  return {
    repoId,
    prodOrigin,
    isAuthorRepo,
    dmDeliveryEnabled,
    smartCropSelectEnabled,
    aemTierType,
    featureSet,
    injectLink,
    loadResponsiveImageConfig,
  };
}

// --- Asset Selector Props ---

function buildSelectorProps({
  details, config, assetSelectorWrapper, cropSelectorWrapper, dialog, resetCropSelector,
}) {
  const externalBrief = formatExternalBrief(window.view.state.doc);

  return {
    imsToken: details.accessToken.token,
    repositoryId: config.repoId,
    aemTierType: config.aemTierType,
    featureSet: config.featureSet,
    externalBrief,
    onClose: () => assetSelectorWrapper.style.display !== 'none' && dialog.close(),
    handleSelection: async (assets) => {
      const [asset] = assets;
      if (!asset) return;

      const { format, isImage, status, activationTarget, alt } = extractAssetMetadata(asset);
      if (!format) return;

      const { view } = window;
      const { state } = view;

      const createImage = (src) => {
        const imgObj = { src, style: 'width: 180px' };
        if (alt) imgObj.alt = alt;
        return state.schema.nodes.image.create(imgObj);
      };

      if (!isAssetApprovedForDelivery({
        dmDeliveryEnabled: config.dmDeliveryEnabled,
        isAuthorRepo: config.isAuthorRepo,
        activationTarget,
        status,
      })) {
        // eslint-disable-next-line max-len
        showUnapprovedError({ cropSelectorWrapper, assetSelectorWrapper, resetCropSelector, dialog });
      } else if (isImage && config.smartCropSelectEnabled) {
        await showSmartCropSelector({
          asset,
          assetSelectorWrapper,
          cropSelectorWrapper,
          dialog,
          resetCropSelector,
          createImage,
          config,
          view,
          state,
        });
      } else {
        insertStandardAsset({
          asset,
          config,
          dialog,
          view,
          state,
          isImage,
          injectLink: config.injectLink,
          createImage,
        });
      }
    },
  };
}

// --- Main Entry Point ---

export async function openAssets() {
  const imsDetails = await loadIms();
  if (imsDetails.anonymous) handleSignIn();
  if (!(imsDetails.accessToken)) return;

  const { owner, repo } = getPathDetails();
  const config = await resolveAllConfig(owner, repo);

  let dialog = document.querySelector('.da-dialog-asset');
  if (dialog) {
    dialog.showModal();
    return;
  }

  await loadStyle(import.meta.url.replace('.js', '.css'));
  await loadScript(ASSET_SELECTOR_URL);

  const {
    dialog: newDialog,
    assetSelectorWrapper,
    cropSelectorWrapper,
    resetCropSelector,
  } = createDialog();
  dialog = newDialog;

  const main = document.body.querySelector('main');
  main.insertAdjacentElement('afterend', dialog);
  dialog.showModal();

  const selectorProps = buildSelectorProps({
    details: imsDetails,
    config,
    assetSelectorWrapper,
    cropSelectorWrapper,
    dialog,
    resetCropSelector,
  });

  window.PureJSSelectors.renderAssetSelector(assetSelectorWrapper, selectorProps);
}
