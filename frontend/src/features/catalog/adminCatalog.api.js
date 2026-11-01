import { apiClient } from '@/services/apiClient.js';

/**
 * Back-office catalogue API.
 * ---------------------------------------------------------------------------
 * All server communication for the category/product screens lives here, so
 * components never construct URLs and a route change is a one-line edit.
 */
export const adminCatalogApi = {
  // --- Categories ---
  listCategories: () => apiClient.get('/admin/catalog/categories'),
  createCategory: (payload) => apiClient.post('/admin/catalog/categories', payload),
  updateCategory: (id, payload) => apiClient.patch(`/admin/catalog/categories/${id}`, payload),
  deleteCategory: (id) => apiClient.delete(`/admin/catalog/categories/${id}`),

  // --- Products ---
  listProducts: (params) =>
    // `_wantEnvelope` keeps the pagination block, which the interceptor would
    // otherwise strip along with the rest of the envelope.
    apiClient.get('/admin/catalog/products', { params, _wantEnvelope: true }),
  createProduct: (payload) => apiClient.post('/admin/catalog/products', payload),
  updateProduct: (id, payload) => apiClient.patch(`/admin/catalog/products/${id}`, payload),
  deleteProduct: (id) => apiClient.delete(`/admin/catalog/products/${id}`),

  /**
   * Upload an image and get back its URL.
   *
   * Deliberately a separate call from saving the record: the image uploads as
   * soon as it is chosen, so a validation failure on the form doesn't lose it
   * and force the user to re-pick the file.
   *
   * The Content-Type header is not set manually — the browser must generate it
   * so it can include the multipart boundary. Setting it by hand produces a
   * boundary-less header and the server fails to parse the body.
   */
  /**
   * @param {File} file
   * @param {string} [folder] Where to file it in the media library — the
   *   category name for a product photo, or a fixed label like `categories`
   *   or `payments`. Sanitised server-side; omitted, the asset is filed by
   *   month instead.
   */
  uploadImage: (file, folder) => {
    const form = new FormData();
    form.append('image', file);
    // Appended before the file so the field is early in the multipart body —
    // it costs nothing and keeps the text part available to any middleware
    // that inspects the stream as it arrives.
    if (folder) form.append('folder', folder);
    return apiClient.post('/admin/catalog/uploads', form).catch(explainUploadFailure(file));
  },

  /**
   * Images or video, for the storefront media fields.
   *
   * A separate endpoint from `uploadImage` because that one is deliberately
   * image-only — a 50MB clip is never a valid product thumbnail. Resolves to
   * `{ url, size, kind }` where `kind` is 'image' or 'video'.
   */
  uploadMedia: (file, folder) => {
    const form = new FormData();
    // Field name stays 'image' so both endpoints share one multer config.
    form.append('image', file);
    if (folder) form.append('folder', folder);
    return apiClient.post('/admin/catalog/uploads/media', form).catch(explainUploadFailure(file));
  },
};

/*
 * A large upload refused by the HOST reads as "could not reach the server".
 *
 * Vercel turns away any request body over 4.5 MB at its edge, before the API
 * runs, and that refusal carries no CORS headers — so the browser hides it and
 * the client sees a network error, which sends the owner off to check their
 * internet connection over a photo that is simply too big. A failure that never
 * reached the API, for a file over 4 MB, is far more likely the size than the
 * network, so it says so. Every other error passes through untouched, including
 * the API's own "too large" message for files it did receive.
 */
const HOST_BODY_LIMIT_BYTES = 4 * 1024 * 1024;

function explainUploadFailure(file) {
  return (error) => {
    if (error?.isNetworkError && file?.size > HOST_BODY_LIMIT_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      const explained = new Error(
        `This file is ${mb} MB, and the server accepts uploads up to 4 MB. ` +
          'Choose a smaller photo, or compress it (e.g. save as WebP or JPG at a lower quality) and try again.',
      );
      explained.code = 'FILE_TOO_LARGE';
      throw explained;
    }
    throw error;
  };
}

export default adminCatalogApi;
