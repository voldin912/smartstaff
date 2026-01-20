import { useAuth } from '@/contexts/AuthContext';

export interface ApiError {
  message: string;
  status?: number;
  data?: any;
}

export class ApiException extends Error {
  status?: number;
  data?: any;

  constructor(message: string, status?: number, data?: any) {
    super(message);
    this.name = 'ApiException';
    this.status = status;
    this.data = data;
  }
}

/**
 * Enhanced API call utility with proper error handling
 * Handles 401/403 errors with logout, retry logic, and consistent error messages
 */
export const apiRequest = async <T = any>(
  url: string,
  options: RequestInit = {},
  retryCount = 0
): Promise<T> => {
  const token = localStorage.getItem('token');
  
  if (!token) {
    throw new ApiException('認証トークンが見つかりません。再度ログインしてください。', 401);
  }

  try {
    // Don't set Content-Type for FormData - browser will set it with boundary
    const isFormData = options.body instanceof FormData;
    const headers: HeadersInit = {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    };
    
    // Only set Content-Type if it's not FormData and not already set
    if (!isFormData && !(options.headers as Record<string, string>)?.['Content-Type']) {
      (headers as HeadersInit & Record<string, string>)['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Handle 401 Unauthorized - logout user
    if (response.status === 401) {
      localStorage.removeItem('token');
      // Trigger logout by redirecting or using router
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
      throw new ApiException('セッションが期限切れです。再度ログインしてください。', 401);
    }

    // Handle 403 Forbidden
    if (response.status === 403) {
      throw new ApiException('この操作を実行する権限がありません。', 403);
    }

    // Handle other errors
    if (!response.ok) {
      let errorMessage = 'リクエストに失敗しました。';
      let errorData = null;

      try {
        errorData = await response.json();
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch {
        // If response is not JSON, use status text
        errorMessage = response.statusText || errorMessage;
      }

      throw new ApiException(errorMessage, response.status, errorData);
    }

    // Handle empty responses
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    }

    // For blob responses (PDFs, etc.)
    if (contentType && contentType.includes('application/pdf')) {
      return await response.blob() as any;
    }

    // For other content types, return response as-is
    return response as any;
  } catch (error) {
    // Retry logic for network errors (max 1 retry)
    if (retryCount < 1 && error instanceof TypeError && error.message.includes('fetch')) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      return apiRequest<T>(url, options, retryCount + 1);
    }

    // Re-throw ApiException as-is
    if (error instanceof ApiException) {
      throw error;
    }

    // Wrap other errors
    if (error instanceof Error) {
      throw new ApiException(error.message, 0);
    }

    throw new ApiException('予期しないエラーが発生しました。', 0);
  }
};

/**
 * Helper to handle API errors and show appropriate messages
 */
export const handleApiError = (error: unknown, defaultMessage: string = 'エラーが発生しました。'): string => {
  if (error instanceof ApiException) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return defaultMessage;
};
