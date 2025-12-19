'use client';

import { useState, useEffect } from 'react';
import Layout from '@/components/Layout';
import { useAuth } from '@/contexts/AuthContext';

interface Company {
  id: number;
  name: string;
  slug: string;
  logo: string | null;
  created_at: string;
  updated_at: string;
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [formData, setFormData] = useState({ name: '', slug: '' });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    fetchCompanies();
  }, []);

  const fetchCompanies = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/companies`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setCompanies(data);
      } else {
        throw new Error('Failed to fetch companies');
      }
    } catch (error) {
      setError('Failed to load companies');
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const token = localStorage.getItem('token');
      const formDataToSend = new FormData();
      formDataToSend.append('name', formData.name);
      formDataToSend.append('slug', formData.slug);
      
      if (logoFile) {
        formDataToSend.append('logo', logoFile);
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/companies${
          selectedCompany ? `/${selectedCompany.id}` : ''
        }`,
        {
          method: selectedCompany ? 'PUT' : 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formDataToSend,
        }
      );

      if (response.ok) {
        await fetchCompanies();
        setShowAddModal(false);
        setShowEditModal(false);
        setFormData({ name: '', slug: '' });
        setLogoFile(null);
        setLogoPreview(null);
        setSelectedCompany(null);
      } else {
        const error = await response.json();
        throw new Error(error.message || 'Failed to save company');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save company');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this company?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/companies/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        await fetchCompanies();
      } else {
        throw new Error('Failed to delete company');
      }
    } catch (error) {
      setError('Failed to delete company');
      console.error('Error:', error);
    }
  };

  const openEditModal = (company: Company) => {
    setSelectedCompany(company);
    setFormData({ name: company.name, slug: company.slug });
    setLogoFile(null);
    setLogoPreview(company.logo ? `${process.env.NEXT_PUBLIC_API_URL}${company.logo}` : null);
    setShowEditModal(true);
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setLogoPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
  };

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    const slug = generateSlug(name);
    setFormData({ name, slug });
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const slug = e.target.value;
    setFormData({ name: formData.name, slug });
  };

  if (!user || user.role !== 'admin') {
    return (
      <Layout>
        <div className="text-center">このページを表示する権限がありません。</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="sm:flex sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold text-gray-900">会社一覧</h1>
          <button
            onClick={() => {
              setFormData({ name: '', slug: '' });
              setLogoFile(null);
              setLogoPreview(null);
              setShowAddModal(true);
              console.log('showAddModal', showAddModal);
            }}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-[5px] shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            会社を追加
          </button>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-4">
            <div className="flex">
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">{error}</h3>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col">
          <div className="-my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
            <div className="py-2 align-middle inline-block min-w-full sm:px-6 lg:px-8">
              <div className="shadow overflow-hidden border-b border-gray-200 sm:rounded-[5px]">
                <table className="min-w-full divide-y divide-gray-200 rounded-[5px]">
                  <thead className="bg-gray-50 rounded-[5px]">
                    <tr className="rounded-[5px]">
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider rounded-[5px]"
                      >
                        ロゴ
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider rounded-[5px]"
                      >
                        会社名
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider rounded-[5px]"
                      >
                        スラッグ
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider rounded-[5px]"
                      >
                        作成日
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider rounded-[5px]"
                      >
                        更新日
                      </th>
                      <th scope="col" className="relative px-6 py-3 rounded-[5px]">
                        <span className="sr-only">操作</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200 rounded-[5px]">
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-4 whitespace-nowrap text-center rounded-[5px]">
                          読み込み中...
                        </td>
                      </tr>
                    ) : companies.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-4 whitespace-nowrap text-center rounded-[5px]">
                          会社が見つかりません
                        </td>
                      </tr>
                    ) : (
                      companies.map((company) => (
                        <tr key={company.id} className="rounded-[5px]">
                          <td className="px-6 py-4 whitespace-nowrap rounded-[5px]">
                            {company.logo ? (
                              <div className="h-10 w-10">
                                <img 
                                  src={`${process.env.NEXT_PUBLIC_API_URL}${company.logo}`} 
                                  alt={company.name} 
                                  className="h-full w-full object-cover rounded"
                                />
                              </div>
                            ) : (
                              <div className="h-10 w-10 bg-gray-200 rounded flex items-center justify-center">
                                <span className="text-gray-400 text-xs">ロゴなし</span>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap rounded-[5px]">
                            <div className="text-sm font-medium text-gray-900 rounded-[5px]">{company.name}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">
                              {company.slug}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">
                              {new Date(company.created_at).toLocaleDateString()}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">
                              {new Date(company.updated_at).toLocaleDateString()}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                              onClick={() => openEditModal(company)}
                              className="text-indigo-600 hover:text-indigo-900 mr-4"
                            >
                              編集
                            </button>
                            <button
                              onClick={() => handleDelete(company.id)}
                              className="text-red-600 hover:text-red-900"
                            >
                              削除
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {(showAddModal || showEditModal) && (
        <div className="fixed z-50 inset-0 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            {/* Background overlay */}
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>

            {/* Center modal */}
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full relative z-50">
              <form onSubmit={handleSubmit}>
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                    {selectedCompany ? '会社を編集' : '新しい会社を追加'}
                  </h3>
                  <div className="mb-4">
                    <label
                      htmlFor="name"
                      className="block text-sm font-medium text-gray-700 mb-2"
                    >
                      会社名
                    </label>
                    <input
                      type="text"
                      name="name"
                      id="name"
                      required
                      value={formData.name}
                      onChange={handleNameChange}
                      className="p-2 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                      placeholder="会社名を入力してください"
                    />
                  </div>
                  
                  <div className="mb-4">
                    <label
                      htmlFor="slug"
                      className="block text-sm font-medium text-gray-700 mb-2"
                    >
                      会社スラッグ
                    </label>
                    <input
                      type="text"
                      name="slug"
                      id="slug"
                      required
                      value={formData.slug}
                      onChange={handleSlugChange}
                      className="p-2 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                      placeholder="会社スラッグを入力してください"
                    />
                  </div>
                  
                  <div className="mb-4">
                    <label
                      htmlFor="logo"
                      className="block text-sm font-medium text-gray-700 mb-2"
                    >
                      会社ロゴ
                    </label>
                    <div className="flex items-center space-x-4">
                      <input
                        type="file"
                        name="logo"
                        id="logo"
                        accept="image/*"
                        onChange={handleLogoChange}
                        className="p-2 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md"
                      />
                      {logoPreview && (
                        <button
                          type="button"
                          onClick={clearLogo}
                          className="px-3 py-1 text-sm text-red-600 hover:text-red-800"
                        >
                          クリア
                        </button>
                      )}
                    </div>
                    {logoPreview && (
                      <div className="mt-2">
                        <img
                          src={logoPreview}
                          alt="ロゴプレビュー"
                          className="h-20 w-20 object-cover rounded border"
                        />
                      </div>
                    )}
                  </div>
                </div>
                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm"
                  >
                    {selectedCompany ? '更新' : '作成'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddModal(false);
                      setShowEditModal(false);
                      setSelectedCompany(null);
                      setFormData({ name: '', slug: '' });
                      setLogoFile(null);
                      setLogoPreview(null);
                    }}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                  >
                    キャンセル
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
} 