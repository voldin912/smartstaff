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

interface AccountField {
  name: string;
  label: string;
  type: string;
}

interface CareerFieldMapping {
  jobDescription: string;
}

interface CareerMapping {
  careerNumber: number;
  fields: {
    jobDescription: string;
  };
}

export default function SalesforceSettingsPage() {
  const [settings, setSettings] = useState<SalesforceSettings>({
    base_url: '',
    username: '',
    password: '',
    security_token: ''
  });
  const [objects, setObjects] = useState<SalesforceObject[]>([]);
  const [accountFields, setAccountFields] = useState<AccountField[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedObject, setSelectedObject] = useState('');
  const [selectedAccountField, setSelectedAccountField] = useState('');
  const [careerMappings, setCareerMappings] = useState<CareerMapping[]>([]);
  const [isLoadingMappings, setIsLoadingMappings] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    const allFieldsFilled = settings.base_url && 
                          settings.username && 
                          settings.password && 
                          settings.security_token;
    
    if (allFieldsFilled) {
      fetchAccountFields();
    } else {
      setAccountFields([]);
      setSelectedAccountField('');
    }
  }, [settings]);

  useEffect(() => {
    const fetchMappings = async () => {
      if (settings.base_url && settings.username && settings.password && settings.security_token) {
        try {
          setIsLoadingMappings(true);
          const token = localStorage.getItem('token');
          if (!token) throw new Error('No token found');
          const headers = { Authorization: `Bearer ${token}` };
          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/salesforce/career-mappings`, { headers });
          const mappings = await response.json();
          setCareerMappings(mappings);
        } catch (error) {
          console.error('Error fetching career mappings:', error);
        } finally {
          setIsLoadingMappings(false);
        }
      } else {
        // Clear mappings if any field is empty
        setCareerMappings([]);
      }
    };

    fetchMappings();
  }, [settings.base_url, settings.username, settings.password, settings.security_token, accountFields]);

  const fetchSettings = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('No token found');
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/salesforce/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const settingsData = await response.json();
      
      // If user is admin, data will be an array, so we take the first item
      const data = Array.isArray(settingsData) ? settingsData[0] : settingsData;
      if (data) {
        setSettings({
          base_url: data.base_url || '',
          username: data.username || '',
          password: data.password || '',
          security_token: data.security_token || ''
        });
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
      toast.error('設定の取得に失敗しました');
    }
  };

  const fetchAccountFields = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      if (!token) throw new Error('No token found');
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/salesforce/objects`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(settings)
      });
      
      if (!response.ok) {
        console.log(response);
      }
      
      const data = await response.json();
      console.log("data", data);
      
      // Check if data and data.objects exist
      if (!data || !data.objects || !Array.isArray(data.objects)) {
        console.error('Invalid response structure:', data);
        return;
      }

      const accountObject = data.objects.find((obj: any) => obj.name === 'Account');
      if (accountObject && accountObject.fields) {
        setAccountFields(accountObject.fields.map((field: any) => ({
          name: field.name,
          label: field.label,
          type: field.type
        })));
      } else {
        console.warn('Account object or fields not found');
        setAccountFields([]);
      }
    } catch (error) {
      console.error('Error fetching account fields:', error);
      toast.error('Salesforceフィールドの取得に失敗しました');
      setAccountFields([]);
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

  const handleFieldMappingChange = (careerNumber: number, fieldName: string, value: string) => {
    setCareerMappings(prevMappings => {
      const newMappings = [...prevMappings];
      const mappingIndex = newMappings.findIndex(m => m.careerNumber === careerNumber);
      
      if (mappingIndex !== -1) {
        newMappings[mappingIndex] = {
          ...newMappings[mappingIndex],
          fields: {
            ...newMappings[mappingIndex].fields,
            [fieldName]: value
          }
        };
      }
      
      return newMappings;
    });
  };

  const handleSaveMappings = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token')
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/salesforce/career-mappings`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(careerMappings)
      });

      // Show success message from the API response
      toast.success('職務経歴フィールドマッピングの保存が完了しました');

      // Refresh the mappings after successful save
      const updatedMappings = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/salesforce/career-mappings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const updatedMappingsData = await updatedMappings.json();
      setCareerMappings(updatedMappingsData);
    } catch (error: any) {
      console.error('Error saving mappings:', error);
      // Show error message from the API if available, otherwise show generic message
      toast.error(error.message || '職務経歴フィールドマッピングの保存中にエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/salesforce/settings`, {
        method: 'PUT',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(settings)
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      toast.success('Salesforce設定の保存が完了しました');
    } catch (error: any) { 
      console.error('Error saving settings:', error);
      toast.error('Salesforce設定の保存中にエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Salesforce設定</h1>
        <div className="bg-white rounded-lg shadow p-6 max-w-4xl">
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                onClick={handleSaveSettings}
                disabled={loading}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
              >
                保存
              </button>
            </div>
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
            
            <div className="mt-8">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold">職務経歴フィールドマッピング</h2>
                <button
                  onClick={handleSaveMappings}
                  disabled={loading || isLoadingMappings}
                  className={`px-4 py-2 rounded-md text-white ${
                    loading || isLoadingMappings
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {loading ? '保存中...' : '保存'}
                </button>
              </div>

              {isLoadingMappings ? (
                <div className="flex justify-center items-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
              ) : (
                <div className="space-y-6">
                  {careerMappings.map((mapping) => (
                    <div key={mapping.careerNumber} className="border rounded-lg p-4">
                      <h3 className="text-md font-medium mb-3">職務経歴 {mapping.careerNumber}</h3>
                      <div className="grid grid-cols-1 gap-4">
                        <div>
                          <select
                            value={mapping.fields.jobDescription}
                            onChange={(e) => handleFieldMappingChange(mapping.careerNumber, 'jobDescription', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="">フィールドを選択</option>
                            {accountFields.map((field) => (
                              <option key={field.name} value={field.name}>
                                {field.label} ({field.name})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
