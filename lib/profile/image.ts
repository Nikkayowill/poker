export interface DetectedImage {
  contentType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  extension: "png" | "jpg" | "webp" | "gif";
}

export interface ImageDimensions {
  width: number;
  height: number;
}

// A file well under the byte-size cap can still declare an enormous canvas
// (a "pixel bomb") that hangs a browser tab decoding it into memory. These
// caps bound the decoded footprint, independent of the compressed file size.
export const MAX_AVATAR_DIMENSION = 4096;
export const MAX_AVATAR_PIXELS = 16_000_000; // ~4096x4096

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) return null;
  // 8-byte signature + 4-byte chunk length + "IHDR" (4 bytes) precede width/height.
  return { width: readUint32BE(bytes, 16) >>> 0, height: readUint32BE(bytes, 20) >>> 0 };
}

function gifDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 10) return null;
  return { width: readUint16LE(bytes, 6), height: readUint16LE(bytes, 8) };
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2; // skip SOI marker
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    // Start-of-frame markers (baseline/progressive/etc.), excluding DHT/JPG extensions.
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { height: readUint16BE(bytes, offset + 5), width: readUint16BE(bytes, offset + 7) };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const segmentLength = readUint16BE(bytes, offset + 2);
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30) return null;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === "VP8X") {
    return { width: readUint24LE(bytes, 24) + 1, height: readUint24LE(bytes, 27) + 1 };
  }
  if (chunk === "VP8 ") {
    return { width: readUint16LE(bytes, 26) & 0x3fff, height: readUint16LE(bytes, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    const bits = readUint32BE(bytes, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** Reads pixel dimensions without decoding the image, so a hostile payload never reaches a decoder. */
export function readImageDimensions(bytes: Uint8Array, contentType: DetectedImage["contentType"]): ImageDimensions | null {
  try {
    if (contentType === "image/png") return pngDimensions(bytes);
    if (contentType === "image/gif") return gifDimensions(bytes);
    if (contentType === "image/jpeg") return jpegDimensions(bytes);
    if (contentType === "image/webp") return webpDimensions(bytes);
  } catch {
    return null;
  }
  return null;
}

export function detectImage(bytes: Uint8Array): DetectedImage | null {
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    )
  ) return { contentType: "image/png", extension: "png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return { contentType: "image/webp", extension: "webp" };
  if (
    bytes.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.slice(0, 6)))
  ) return { contentType: "image/gif", extension: "gif" };
  return null;
}
