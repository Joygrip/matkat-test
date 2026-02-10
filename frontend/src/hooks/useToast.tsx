/**
 * Toast notification hook using Fluent UI.
 */
import { useCallback, createContext, useContext, ReactNode } from 'react';
import {
  Toaster,
  useToastController,
  Toast,
  ToastTitle,
  ToastBody,
  ToastIntent,
  useId,
} from '@fluentui/react-components';
import { ApiError } from '../types';
import { getApiErrorDetail, getApiErrorTitle } from '../utils/errors';

interface ToastContextType {
  showSuccess: (title: string, message?: string) => void;
  showError: (title: string, message?: string) => void;
  showWarning: (title: string, message?: string) => void;
  showInfo: (title: string, message?: string) => void;
  showApiError: (error: ApiError | Error, context?: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const toasterId = useId('toaster');
  const { dispatchToast } = useToastController(toasterId);

  const showToast = useCallback(
    (intent: ToastIntent, title: string, message?: string) => {
      dispatchToast(
        <Toast>
          <ToastTitle>{title}</ToastTitle>
          {message && <ToastBody>{message}</ToastBody>}
        </Toast>,
        { intent, timeout: intent === 'error' ? 8000 : 5000 }
      );
    },
    [dispatchToast]
  );

  const showSuccess = useCallback(
    (title: string, message?: string) => showToast('success', title, message),
    [showToast]
  );

  const showError = useCallback(
    (title: string, message?: string) => showToast('error', title, message),
    [showToast]
  );

  const showWarning = useCallback(
    (title: string, message?: string) => showToast('warning', title, message),
    [showToast]
  );

  const showInfo = useCallback(
    (title: string, message?: string) => showToast('info', title, message),
    [showToast]
  );

  const showApiError = useCallback(
    (error: ApiError | Error, context?: string) => {
      if (error instanceof ApiError) {
        const title = context || getApiErrorTitle(error);
        const detail = getApiErrorDetail(error);
        const message = context
          ? `${getApiErrorTitle(error)}: ${detail}`
          : detail;
        showError(title, message);
        return;
      }
      const fallbackTitle = context || 'Error';
      const fallbackMessage = error.message || 'An unexpected error occurred';
      showError(fallbackTitle, fallbackMessage);
    },
    [showError]
  );

  return (
    <ToastContext.Provider
      value={{ showSuccess, showError, showWarning, showInfo, showApiError }}
    >
      <Toaster toasterId={toasterId} position="top-end" />
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}
