import { useState, type CSSProperties } from "react";
import { artPath, type ArtAsset } from "./skin";
export function Artwork({
  asset,
  className = "",
}: {
  asset?: ArtAsset;
  className?: string;
}) {
  const src = artPath(asset);
  const [failed, setFailed] = useState<string>();
  if (!src || failed === src) return null;
  return (
    <img
      aria-hidden="true"
      alt=""
      className={`game-art ${className}`}
      src={src}
      loading="eager"
      decoding="sync"
      draggable={false}
      style={{ objectPosition: asset?.position } as CSSProperties}
      onError={() => setFailed(src)}
    />
  );
}
