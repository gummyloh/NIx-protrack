// Shared client-side validation + compression for the photo-upload inputs
// on the Photos and Meetings pages. Runs before anything hits Supabase
// Storage, so a giant phone-camera photo (12-40MB HEIC/JPEG originals are
// common) doesn't get uploaded byte-for-byte, blow past storage quota, or
// take forever to load back in the photo grid / customer view.

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // reject anything absurd outright
const MAX_DIMENSION = 2000; // px, longest side, after which we downscale
const JPEG_QUALITY = 0.82;

export class ImageUploadError extends Error {}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImageUploadError("That file doesn't look like a valid image."));
    img.src = url;
  });
}

/**
 * Validates that `file` is a reasonably-sized image, then downsamples it
 * (if it's larger than MAX_DIMENSION on its longest side) and re-encodes
 * it as a JPEG to keep upload size and storage usage predictable. Throws
 * ImageUploadError with a message safe to show the user if the file is
 * rejected outright.
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new ImageUploadError("Only image files can be uploaded here.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    throw new ImageUploadError(
      `That file is ${mb}MB, which is over the 25MB limit. Try a smaller photo.`
    );
  }

  // SVGs and already-small files pass through untouched -- there's nothing
  // useful to downsample, and re-encoding a small file can bloat it.
  if (file.type === "image/svg+xml" || file.size < 400 * 1024) {
    return file;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const { width, height } = img;
    const longest = Math.max(width, height);
    if (longest <= MAX_DIMENSION) {
      return file;
    }

    const scale = MAX_DIMENSION / longest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file; // canvas unsupported -- upload the original rather than fail

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob) return file;

    const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
