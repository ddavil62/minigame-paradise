/** @fileoverview 달빛 주방열차 아틀라스를 비차단으로 불러오고 프레임 단위 폴백 상태를 제공한다. */

const DEFAULT_MANIFEST_URL = './assets/sprites/moonlight-atlas.json';

/**
 * 이미지의 디코딩 완료까지 기다린다.
 * @param {string} url 이미지 URL
 * @returns {Promise<HTMLImageElement>} 디코딩된 이미지
 * @private
 */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', async () => {
      try {
        if (typeof image.decode === 'function') await image.decode();
        resolve(image);
      } catch (error) {
        reject(error);
      }
    }, { once: true });
    image.addEventListener('error', () => reject(new Error(`아틀라스 이미지 로드 실패: ${url}`)), { once: true });
    image.src = url;
  });
}

/**
 * 렌더러가 사용하는 읽기 전용 아틀라스 저장소를 만든다.
 * @param {string} [manifestUrl] manifest URL
 * @returns {{ready:boolean,failedKeys:string[],load:()=>Promise<object>,getFrame:(key:string)=>object|null}}
 */
export function createKitchenAssets(manifestUrl = DEFAULT_MANIFEST_URL) {
  let manifest = null;
  const images = new Map();
  const failedKeys = [];
  let loadPromise = null;
  const store = {
    get ready() { return Boolean(manifest) && images.size > 0; },
    get failedKeys() { return [...failedKeys]; },
    /**
     * manifest와 세 이미지를 불러온다. 일부 실패는 성공한 시트의 사용을 막지 않는다.
     * @returns {Promise<object>} 현재 저장소
     */
    load() {
      if (loadPromise) return loadPromise;
      loadPromise = fetch(manifestUrl)
        .then((response) => {
          if (!response.ok) throw new Error(`아틀라스 manifest 로드 실패: ${response.status}`);
          return response.json();
        })
        .then(async (loadedManifest) => {
          manifest = loadedManifest;
          const baseUrl = new URL(manifestUrl, document.baseURI);
          const entries = Object.entries(manifest.images ?? {});
          const results = await Promise.allSettled(entries.map(([key, relativeUrl]) => {
            const imageUrl = new URL(relativeUrl, baseUrl).href;
            return loadImage(imageUrl).then((image) => ({ key, image }));
          }));
          results.forEach((result, index) => {
            const key = entries[index][0];
            if (result.status === 'fulfilled') images.set(result.value.key, result.value.image);
            else failedKeys.push(key);
          });
          return store;
        })
        .catch((error) => {
          failedKeys.push('manifest');
          console.warn(error.message);
          return store;
        });
      return loadPromise;
    },
    /**
     * 사용할 수 있는 source image를 포함한 프레임을 반환한다.
     * @param {string} key 프레임 키
     * @returns {object|null} 프레임 또는 폴백 신호
     */
    getFrame(key) {
      const frame = manifest?.frames?.[key];
      const image = frame ? images.get(frame.image) : null;
      return frame && image ? { ...frame, image } : null;
    },
  };
  return store;
}

/**
 * 기본 런타임 저장소의 로드를 시작한다.
 * @param {string} [manifestUrl] 테스트용 manifest URL
 * @returns {Promise<object>} 로드가 정리된 저장소
 */
export function loadKitchenAtlas(manifestUrl = DEFAULT_MANIFEST_URL) {
  const store = createKitchenAssets(manifestUrl);
  return store.load();
}
