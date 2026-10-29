// HTTPS deployments use one origin for the UI and all public APIs.
const sameOrigin = typeof window !== 'undefined' && window.location.protocol === 'https:';
const defaultApi = sameOrigin ? `${window.location.origin}/api` : 'http://localhost:8000/api';
export const TICKET_API_URL = import.meta.env.VITE_TICKET_API_URL || import.meta.env.VITE_API_BASE_URL || defaultApi;
export const AUTH_API_URL = import.meta.env.VITE_AUTH_API_URL ||
  (sameOrigin || import.meta.env.VITE_AUTH_VIA_BACKEND === 'true' ? TICKET_API_URL : import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001/api');
