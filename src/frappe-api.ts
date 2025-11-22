/**
 * Frappe API - Main export file
 * Re-exports parameterized API functions for multi-tenant support
 */

// Error handling
export { FrappeApiError, handleApiError } from './errors.js';

// API client factory (multi-tenant)
export { createFrappeClient, FrappeClientConfig } from './api-client-factory.js';

// Document operations (parameterized)
export {
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  listDocuments,
  callMethod
} from './document-api-parameterized.js';

// Schema operations (parameterized)
export {
  getDocTypeSchema,
  getFieldOptions,
  getAllDocTypes,
  getAllModules
} from './schema-api-parameterized.js';
