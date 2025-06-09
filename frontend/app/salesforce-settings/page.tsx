"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import Layout from '@/components/Layout';
import { toast } from 'sonner';

interface SalesforceSettings {
  base_url: string;
  username: string;
  password: string;
  security_token: string;
}

interface SalesforceObject {
  name: string;
  label: string;
}

export default function SalesforceSettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<SalesforceSettings>({
    base_url: '',
    username: '',
    password: '',
    security_token: ''
  });
  const [objects, setObjects] = useState<SalesforceObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedObject, setSelectedObject] = useState('');

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/salesforce/settings`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        // If user is admin, data will be an array, so we take the first item
        const settingsData = Array.isArray(data) ? data[0] : data;
        if (settingsData) {
          setSettings({
            base_url: settingsData.base_url || '',
            username: settingsData.username || '',
            password: settingsData.password || '',
            security_token: settingsData.security_token || ''
          });
        }
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
      toast.error('設定の取得に失敗しました');
    }
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/salesforce/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(settings)
      });
      console.log("response", response);

      if (response.ok) {
        toast.success('設定を保存しました');
        // After saving, fetch objects if all fields are filled
        if (settings.base_url && settings.username && settings.password && settings.security_token) {
          await fetchObjects();
        }
      } else {
        toast.error('設定の保存に失敗しました');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('設定の保存中にエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const fetchObjects = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      console.log("token", token);
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/salesforce/objects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(settings)
      });

      if (response.ok) {
        const data = await response.json();
        console.log("data", data);
        setObjects(data);
      } else {
        toast.error('オブジェクトの取得に失敗しました');
      }
    } catch (error) {
      console.error('Error fetching objects:', error);
      toast.error('オブジェクトの取得中にエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setSettings(prev => ({
      ...prev,
      [name]: value
    }));
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Salesforce設定</h1>
        
        <div className="bg-white rounded-lg shadow p-6 max-w-2xl">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                URL
              </label>
              <input
                type="text"
                name="base_url"
                value={settings.base_url}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="https://your-instance.salesforce.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ユーザー名
              </label>
              <input
                type="text"
                name="username"
                value={settings.username}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="username@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                パスワード
              </label>
              <input
                type="password"
                name="password"
                value={settings.password}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Password"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                セキュリティトークン
              </label>
              <input
                type="password"
                name="security_token"
                value={settings.security_token}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Security Token"
              />
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={loading}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>

          {objects.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold mb-4">Salesforceオブジェクト</h2>
              <select
                value={selectedObject}
                onChange={(e) => setSelectedObject(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">オブジェクトを選択</option>
                {objects.map((obj) => (
                  <option key={obj.name} value={obj.name}>
                    {obj.label} ({obj.name})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
