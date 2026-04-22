// Stay Hard · camera abstraction
//
// Unified camera API:
//   - Native (iOS/Android): uses @capacitor/camera with user's choice of
//     camera vs photo library, returns a Blob.
//   - Web: prompts a hidden <input type="file" accept="image/*" capture>
//     and returns the File as Blob.
//
// Callers (meal-photo.js / 운동영상 녹화) should not know which path was taken.
// The returned Blob is passed to existing `compressImage()` → Supabase upload.

import { isNative } from './platform.js';

/**
 * Open camera/photo-picker and return a single image as Blob.
 * Resolves null if the user cancels.
 * @param {Object} [opts]
 * @param {boolean} [opts.allowLibrary=true] on native, allow fall-back to photo library
 * @param {number} [opts.quality=80] JPEG quality 0–100 (native only)
 * @returns {Promise<Blob|null>}
 */
export async function pickImage(opts = {}) {
  const { allowLibrary = true, quality = 80 } = opts;

  if (isNative()) {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Base64,
        source: allowLibrary ? CameraSource.Prompt : CameraSource.Camera,
        quality,
        allowEditing: false,
        correctOrientation: true,
        presentationStyle: 'fullscreen'
      });
      return _base64ToBlob(photo.base64String, 'image/' + (photo.format || 'jpeg'));
    } catch (e) {
      // User cancel throws — normalize to null
      if (String(e && e.message || '').toLowerCase().includes('cancel')) return null;
      throw e;
    }
  }

  // Web fallback: <input type="file" capture>
  return _pickViaFileInput();
}

function _pickViaFileInput() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.style.position = 'fixed';
    input.style.top = '-9999px';
    input.onchange = () => {
      const f = input.files && input.files[0] ? input.files[0] : null;
      document.body.removeChild(input);
      resolve(f);
    };
    // If user cancels, 'change' may never fire. Watch body focus to detect.
    document.body.appendChild(input);
    input.click();
  });
}

function _base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
