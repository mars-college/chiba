import { useState, useCallback } from 'react';

const API_BASE = '/api';

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

      const apiKey = options.apiKey || localStorage.getItem('apiKey');
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
  const apiKey = localStorage.getItem('apiKey');
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
  const apiKey = localStorage.getItem('apiKey');
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
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
  const apiKey = localStorage.getItem('apiKey');
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
