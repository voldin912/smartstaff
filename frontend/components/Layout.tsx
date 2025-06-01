'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Image from 'next/image';
import { HomeIcon, CogIcon } from '@heroicons/react/24/outline';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles: string[];
}

const navItems: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Records',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    ),
    roles: ['admin', 'company-manager', 'member'],
  },
  {
    href: '/companies',
    label: 'Companies',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
    roles: ['admin'],
  },
  {
    href: '/users',
    label: 'Users',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
    roles: ['admin', 'company-manager'],
  },
  {
    href: '/salesforce-settings',
    label: 'Salesforce Settings',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <mask id="mask0_956_51" style={{ maskType: 'luminance' }} maskUnits="userSpaceOnUse" x="0" y="1" width="18" height="16">
      <path d="M0 1.79999H18V16.272H0V1.79999Z" fill="white"/>
      </mask>
      <g mask="url(#mask0_956_51)">
      <path d="M8.99999 1.79999C7.60049 1.79999 6.19349 2.3338 5.12643 3.40068C4.33293 4.19418 3.85199 5.17855 3.64799 6.20511C1.57743 6.60674 0.00674438 8.41499 0.00674438 10.5979C0.00674438 13.0744 2.02687 15.0945 4.50337 15.0945H6.65399C6.69281 15.0951 6.73124 15.0919 6.76949 15.0847C6.80774 15.0776 6.84487 15.0669 6.88106 15.0523C6.91706 15.0379 6.95137 15.0201 6.98399 14.9987C7.01643 14.9773 7.04662 14.9531 7.07418 14.9257C7.10193 14.8986 7.12668 14.8687 7.14843 14.8365C7.17018 14.8042 7.18856 14.7703 7.20356 14.7345C7.21856 14.6985 7.22999 14.6616 7.23749 14.6235C7.24518 14.5854 7.24912 14.5468 7.24912 14.508C7.24912 14.4692 7.24518 14.4306 7.23749 14.3925C7.22999 14.3544 7.21856 14.3175 7.20356 14.2815C7.18856 14.2457 7.17018 14.2116 7.14843 14.1795C7.12668 14.1472 7.10193 14.1174 7.07418 14.0902C7.04662 14.0629 7.01643 14.0387 6.98399 14.0173C6.95137 13.9959 6.91706 13.9781 6.88106 13.9637C6.84487 13.9492 6.80774 13.9384 6.76949 13.9312C6.73124 13.9241 6.69281 13.9209 6.65399 13.9215H4.50337C2.66081 13.9215 1.17974 12.4404 1.17974 10.5979C1.17974 8.85786 2.50293 7.44036 4.19793 7.28643C4.23093 7.28324 4.26337 7.27724 4.29524 7.26861C4.32731 7.2598 4.35824 7.24855 4.38843 7.23449C4.41843 7.22043 4.44712 7.20411 4.47431 7.18518C4.50168 7.16643 4.52718 7.14543 4.55081 7.12218C4.57462 7.09911 4.59618 7.07418 4.61568 7.04736C4.63518 7.02055 4.65224 6.99224 4.66687 6.96243C4.68149 6.9328 4.69368 6.90205 4.70306 6.87018C4.71262 6.83849 4.71937 6.80605 4.72331 6.77324C4.83112 5.84361 5.24249 4.94043 5.95743 4.22549C6.79912 3.3838 7.89768 2.97299 8.99999 2.97299C10.1023 2.97299 11.1939 3.38286 12.0364 4.22549C13.0102 5.19918 13.4222 6.52218 13.2707 7.78743C13.2681 7.80805 13.2666 7.82868 13.2662 7.8493C13.2658 7.87011 13.2664 7.89074 13.2682 7.91136C13.2699 7.93199 13.2729 7.95243 13.2769 7.97286C13.2808 7.99311 13.2859 8.01318 13.2919 8.03305C13.2981 8.05274 13.305 8.07224 13.3132 8.09118C13.3213 8.1103 13.3305 8.12886 13.3406 8.14686C13.3507 8.16505 13.3618 8.18249 13.3736 8.19936C13.3856 8.21643 13.3986 8.23255 13.4121 8.24811C13.4257 8.26368 13.4404 8.27849 13.4556 8.29255C13.4707 8.30643 13.4867 8.31974 13.5034 8.33193C13.5201 8.3443 13.5373 8.35574 13.5551 8.36624C13.5729 8.37674 13.5913 8.3863 13.6102 8.39493C13.629 8.40336 13.6483 8.41105 13.668 8.41743C13.6877 8.42399 13.7076 8.42943 13.7278 8.43393C13.7481 8.43824 13.7685 8.44161 13.7891 8.44386C13.8096 8.44611 13.8304 8.44724 13.851 8.44724H14.0831C15.6097 8.44724 16.8202 9.65793 16.8202 11.1844C16.8202 12.7108 15.6097 13.9215 14.0831 13.9215H11.346C11.3072 13.9209 11.2687 13.9241 11.2305 13.9312C11.1922 13.9384 11.1551 13.9492 11.1189 13.9637C11.0829 13.9781 11.0486 13.9959 11.016 14.0173C10.9836 14.0387 10.9534 14.0629 10.9258 14.0902C10.8981 14.1174 10.8733 14.1472 10.8516 14.1795C10.8298 14.2116 10.8114 14.2457 10.7964 14.2815C10.7814 14.3173 10.77 14.3544 10.7625 14.3925C10.7548 14.4306 10.7509 14.4692 10.7509 14.508C10.7509 14.5468 10.7548 14.5854 10.7625 14.6235C10.77 14.6616 10.7814 14.6987 10.7964 14.7345C10.8114 14.7703 10.8298 14.8044 10.8516 14.8365C10.8733 14.8687 10.8981 14.8986 10.9258 14.9257C10.9534 14.9531 10.9836 14.9773 11.016 14.9987C11.0486 15.0201 11.0829 15.0379 11.1189 15.0523C11.1551 15.0667 11.1922 15.0776 11.2305 15.0847C11.2687 15.0919 11.3072 15.0951 11.346 15.0945H14.0831C16.2392 15.0945 17.9932 13.3404 17.9932 11.1844C17.9932 9.14943 16.4257 7.49305 14.4375 7.3108C14.4467 5.89555 13.944 4.47749 12.8674 3.40068C11.8012 2.33455 10.3995 1.79999 8.99999 1.79999ZM8.99999 8.0563C8.80443 8.0563 8.70112 8.11911 8.60287 8.20893L6.45224 10.164C6.20399 10.3944 6.20831 10.7685 6.41568 10.995C6.62287 11.2213 7.01906 11.2378 7.24649 11.0316L8.41349 9.96861V15.681C8.41349 16.005 8.67599 16.2675 8.99999 16.2675C9.32399 16.2675 9.58649 16.005 9.58649 15.681V9.96861L10.7535 11.0316C10.9809 11.2378 11.3651 11.2099 11.5843 10.995C11.8155 10.7685 11.7731 10.3725 11.5477 10.164L9.39712 8.20893C9.28087 8.10261 9.19556 8.0563 8.99999 8.0563Z" fill="currentColor"/>
      </g>
      </svg>

    ),
    roles: ['admin', 'company-manager'],
  },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const pathname = usePathname();
  const { user, logout } = useAuth();

  if (!user) return null;

  const filteredNavItems = navItems.filter((item) => item.roles.includes(user.role));

  return (
    <div className="min-h-screen bg-gray-100 rounded-[5px]">
      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-lg transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } lg:translate-x-0 transition-transform duration-300 ease-in-out rounded-[5px]`}
      >
        <div className="flex flex-col h-full rounded-[5px]">
          {/* Logo */}
          <div className="flex items-center justify-center h-16 px-4 rounded-[5px]">
            <img src={'./logo.png'} alt='Logo' className='w-10 h-10 mr-2 rounded-[5px]' />
            <span className="text-2xl text-black font-sans rounded-[5px]">Resona Gate</span>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto rounded-[5px]">
            {filteredNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center px-4 py-2 text-sm font-medium rounded-[5px] ${pathname === item.href
                  ? 'text-white bg-indigo-600'
                  : 'text-gray-600 hover:text-indigo-600 hover:bg-indigo-50'
                  }`}
              >
                {item.icon}
                <span className="ml-3 rounded-[5px]">{item.label}</span>
              </Link>
            ))}
          </nav>

          {/* User Profile */}
          <div className="flex items-center px-4 py-4 border-t border-gray-200 rounded-[5px]">
            <div className="flex-shrink-0 rounded-[5px]">
              {user.avatar ? (
                <Image
                  src={`${process.env.NEXT_PUBLIC_API_URL}${user.avatar}`}
                  alt={user.name}
                  width={40}
                  height={40}
                  className="rounded-full"
                />
              ) : (
                <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
                  <span className="text-indigo-600 font-medium text-lg rounded-[5px]">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </div>
            <div className="ml-3 rounded-[5px]">
              <p className="text-sm font-medium text-gray-700 rounded-[5px]">{user.name}</p>
              <button
                onClick={logout}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-500 rounded-[5px]"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile sidebar button */}
      <div className="fixed top-0 left-0 z-40 lg:hidden rounded-[5px]">
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-4 text-gray-600 focus:outline-none rounded-[5px]"
        >
          <svg className="w-6 h-6 rounded-[5px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
      </div>

      {/* Main content */}
      <div className="lg:pl-64 rounded-[5px]">
        <main className="p-4 sm:p-6 lg:p-8 rounded-[5px]">{children}</main>
      </div>

      {/* Mobile sidebar overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black bg-opacity-50 lg:hidden rounded-[5px]"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
    </div>
  );
} 