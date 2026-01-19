'use client';

import { useEffect } from 'react';
import { AlertMessage as AlertMessageType } from '@/lib/types';

interface AlertMessageProps {
  message: AlertMessageType | null;
  onDismiss: () => void;
  autoHideDuration?: number;
}

export default function AlertMessage({ 
  message, 
  onDismiss, 
  autoHideDuration = 5000 
}: AlertMessageProps) {
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        onDismiss();
      }, autoHideDuration);
      return () => clearTimeout(timer);
    }
  }, [message, autoHideDuration, onDismiss]);

  if (!message) return null;

  return (
    <div className={`fixed top-4 right-4 z-50 p-4 rounded-[5px] shadow-lg ${
      message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
    }`}>
      {message.message}
    </div>
  );
}
