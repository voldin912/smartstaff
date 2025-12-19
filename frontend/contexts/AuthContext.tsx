'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'company-manager' | 'member';
  company_id: number | null;
  avatar: string | null;
  company?: {
    id: number;
    name: string;
    slug: string;
    logo: string | null;
  };
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: any) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  apiCall: <T>(url: string, options?: RequestInit) => Promise<T>;
  showLogoutWarning: boolean;
  dismissLogoutWarning: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Auto logout timeout in milliseconds (30 minutes)
const AUTO_LOGOUT_TIMEOUT = 30 * 60 * 1000;
// Warning timeout in milliseconds (5 minutes before logout)
const WARNING_TIMEOUT = 25 * 60 * 1000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLogoutWarning, setShowLogoutWarning] = useState(false);
  const router = useRouter();
  const logoutTimerRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  // Set up activity listeners for auto logout
  useEffect(() => {
    if (!user) return;

    const resetLogoutTimer = () => {
      // Clear existing timers
      if (logoutTimerRef.current) {
        clearTimeout(logoutTimerRef.current);
      }
      if (warningTimerRef.current) {
        clearTimeout(warningTimerRef.current);
      }
      
      // Hide warning if it was showing
      setShowLogoutWarning(false);
      
      // Set warning timer (25 minutes)
      warningTimerRef.current = setTimeout(() => {
        setShowLogoutWarning(true);
      }, WARNING_TIMEOUT);
      
      // Set logout timer (30 minutes)
      logoutTimerRef.current = setTimeout(() => {
        console.log('Auto logout triggered due to inactivity');
        logout();
      }, AUTO_LOGOUT_TIMEOUT);
    };

    // Reset timer on user activity
    const handleUserActivity = () => {
      resetLogoutTimer();
    };

    // Set up event listeners for user activity
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    
    events.forEach(event => {
      document.addEventListener(event, handleUserActivity, true);
    });

    // Start the initial timer
    resetLogoutTimer();

    // Cleanup function
    return () => {
      if (logoutTimerRef.current) {
        clearTimeout(logoutTimerRef.current);
      }
      if (warningTimerRef.current) {
        clearTimeout(warningTimerRef.current);
      }
      
      events.forEach(event => {
        document.removeEventListener(event, handleUserActivity, true);
      });
    };
  }, [user]);

  const dismissLogoutWarning = () => {
    setShowLogoutWarning(false);
    // Reset the timers when user dismisses the warning
    if (logoutTimerRef.current) {
      clearTimeout(logoutTimerRef.current);
    }
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
    }
    
    // Restart the timers
    if (user) {
      const resetLogoutTimer = () => {
        if (logoutTimerRef.current) {
          clearTimeout(logoutTimerRef.current);
        }
        if (warningTimerRef.current) {
          clearTimeout(warningTimerRef.current);
        }
        
        warningTimerRef.current = setTimeout(() => {
          setShowLogoutWarning(true);
        }, WARNING_TIMEOUT);
        
        logoutTimerRef.current = setTimeout(() => {
          console.log('Auto logout triggered due to inactivity');
          logout();
        }, AUTO_LOGOUT_TIMEOUT);
      };
      
      resetLogoutTimer();
    }
  };

  const handleUnauthorized = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  const apiCall = async <T,>(url: string, options: RequestInit = {}): Promise<T> => {
    const token = localStorage.getItem('token');
    if (!token) {
      handleUnauthorized();
      throw new Error('No token found');
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401) {
      handleUnauthorized();
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      throw new Error('API call failed');
    }

    return response.json();
  };

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setLoading(false);
        return;
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
      } else if (response.status === 401) {
        handleUnauthorized();
      } else {
        localStorage.removeItem('token');
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      localStorage.removeItem('token');
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Login failed');
      }

      const { token } = await response.json();
      localStorage.setItem('token', token);
      await checkAuth();
      
      // Redirect to appropriate dashboard based on user role and company
      if (user) {
        const baseSlug = user.role === 'admin' ? 'admin' : (user.company?.slug || 'default');
        router.push(`/${baseSlug}/dashboard`);
      } else {
        router.push('/dashboard');
      }
    } catch (error) {
      throw error;
    }
  };

  const register = async (data: any) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Registration failed');
      }

      const { token } = await response.json();
      localStorage.setItem('token', token);
      await checkAuth();
      
      // Redirect to appropriate dashboard based on user role and company
      if (user) {
        const baseSlug = user.role === 'admin' ? 'admin' : (user.company?.slug || 'default');
        router.push(`/${baseSlug}/dashboard`);
      } else {
        router.push('/dashboard');
      }
    } catch (error) {
      throw error;
    }
  };

  const logout = () => {
    // Clear the logout timer
    if (logoutTimerRef.current) {
      clearTimeout(logoutTimerRef.current);
      logoutTimerRef.current = null;
    }
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
    
    setShowLogoutWarning(false);
    localStorage.removeItem('token');
    setUser(null);
    router.push('/login');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        isAuthenticated: !!user,
        apiCall,
        showLogoutWarning,
        dismissLogoutWarning,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
} 