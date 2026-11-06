import { ART_PACK, artPath } from './skin';
// Retain decoded image objects for this document. A new build changes content versions.
const images = new Map<string, Promise<void>>();
const retained = new Map<string, HTMLImageElement>();
let warming: Promise<void> | undefined;
export function warmCardArt(): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  if (warming) return warming;
  const assets = [
    ...Object.values(ART_PACK.cards),
    ART_PACK.cardBack,
    ...Object.values(ART_PACK.events || {}).flatMap((pair) =>
      pair ? [pair.front, pair.back] : [],
    ),
  ];
  const urls = [
    ...new Set(
      assets
        .map((asset) => artPath(asset))
        .filter((value): value is string => !!value),
    ),
  ];
  warming = Promise.all(
    urls.map((src) => {
      let promise = images.get(src);
      if (!promise) {
        const image = new Image();
        retained.set(src, image);
        promise = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('卡面载入超时，请检查网络后重试')),
            25000,
          );
          image.onload = () => {
            void image.decode().then(
              () => {
                clearTimeout(timer);
                resolve();
              },
              () => {
                clearTimeout(timer);
                reject(new Error('卡面解码失败，请重试'));
              },
            );
          };
          image.onerror = () => {
            clearTimeout(timer);
            reject(new Error('卡面载入失败，请检查网络后重试'));
          };
          image.src = src;
        }).catch((error) => {
          images.delete(src);
          retained.delete(src);
          throw error;
        });
        images.set(src, promise);
      }
      return promise;
    }),
  )
    .then(() => {})
    .catch((error) => {
      warming = undefined;
      throw error;
    });
  return warming;
}
