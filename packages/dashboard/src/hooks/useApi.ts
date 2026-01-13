import { useState, useCallback } from 'react';

const API_BASE = '/api';

// Cached API key - fetched once from controller
let cachedApiKey: string | null = null;
let apiKeyPromise: Promise<string> | null = null;

async function getApiKey(): Promise<string> {
  // Return cached key if available
  if (cachedApiKey !== null) return cachedApiKey;

  // Check localStorage first (user override)
  const storedKey = localStorage.getItem('apiKey');
  if (storedKey) {
    cachedApiKey = storedKey;
    return storedKey;
  }

  // Fetch from controller (deduplicated)
  if (!apiKeyPromise) {
    apiKeyPromise = fetch(`${API_BASE}/config`)
      .then(res => res.json())
      .then(data => {
        const key = data.apiKey || '';
        cachedApiKey = key;
        return key;
      })
      .catch(() => {
        cachedApiKey = '';
        return '';
      });
  }
  return apiKeyPromise!;
}

// Initialize API key on module load
getApiKey();

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  apiKey?: string;
}

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useApi<T>() {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const request = useCallback(async (endpoint: string, options: ApiOptions = {}) => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      const apiKey = options.apiKey || await getApiKey();
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed: ${response.status}`);
      }

      const data = await response.json();
      setState({ data, loading: false, error: null });
      return data as T;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      setState(prev => ({ ...prev, loading: false, error }));
      throw err;
    }
  }, []);

  const get = useCallback((endpoint: string) => request(endpoint), [request]);

  const post = useCallback((endpoint: string, body?: unknown) =>
    request(endpoint, { method: 'POST', body }), [request]);

  const put = useCallback((endpoint: string, body?: unknown) =>
    request(endpoint, { method: 'PUT', body }), [request]);

  const del = useCallback((endpoint: string) =>
    request(endpoint, { method: 'DELETE' }), [request]);

  return { ...state, get, post, put, del, request };
}

// Simple fetch helpers for one-off requests
export async function apiGet<T>(endpoint: string): Promise<T> {
  const headers: Record<string, string> = {};
  const apiKey = await getApiKey();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, { headers });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

export async function apiPost<T>(endpoint: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const apiKey = await getApiKey();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Request failed: ${response.status}`);
    }
    return response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timed out after 30 seconds');
    }
    throw err;
  }
}

export async function apiPut<T>(endpoint: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const apiKey = await getApiKey();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'PUT',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

export async function apiDelete<T>(endpoint: string): Promise<T> {
  const headers: Record<string, string> = {};
  const apiKey = await getApiKey();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

export interface UploadResult {
  id: string;
  hash: string;
  filename: string;
  originalName: string;
  contentType: 'video' | 'image';
  sizeBytes: number;
  url: string;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

/**
 * Upload a file to the controller.
 * Returns a promise that resolves with the upload result.
 * Optionally accepts an onProgress callback for progress tracking.
 */
export async function apiUpload(
  file: File,
  name?: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<{ success: boolean; data: UploadResult }> {
  const apiKey = await getApiKey();

  const formData = new FormData();
  formData.append('file', file);
  if (name) {
    formData.append('name', name);
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({
          loaded: e.loaded,
          total: e.total,
          percent: Math.round((e.loaded / e.total) * 100),
        });
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          if (response.success) {
            resolve(response);
          } else {
            reject(new Error(response.error || 'Upload failed'));
          }
        } catch {
          reject(new Error('Invalid response from server'));
        }
      } else {
        try {
          const response = JSON.parse(xhr.responseText);
          reject(new Error(response.error || `Upload failed: ${xhr.status}`));
        } catch {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload cancelled'));
    });

    xhr.open('POST', `${API_BASE}/upload`);
    if (apiKey) {
      xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`);
    }
    xhr.send(formData);
  });
}
