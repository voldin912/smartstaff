'use client';

import { useState, useEffect } from 'react';
import Layout from '@/components/Layout';
import { useAuth } from '@/contexts/AuthContext';
import Image from 'next/image';

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  company_id: number | null;
  company_name: string | null;
  avatar: string | null;
  created_at: string;
}

interface Company {
  id: number;
  name: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'member',
    company_id: '',
    avatar: null as File | null,
  });
  const { user } = useAuth();

  useEffect(() => {
    fetchUsers();
    if (user?.role === 'admin') {
      fetchCompanies();
    }
  }, [user?.role]);

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setUsers(data);
      } else {
        console.log(response);
      }
    } catch (error) {
      setError('Failed to load users');
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

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
      }
    } catch (error) {
      console.error('Failed to fetch companies:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const token = localStorage.getItem('token');
      const formDataToSend = new FormData();
      Object.entries(formData).forEach(([key, value]) => {
        if (value !== null && value !== '') {
          if (key === 'company_id' && value === '') {
            formDataToSend.append(key, 'null');
          } else {
            formDataToSend.append(key, value);
          }
        }
      });

      console.log('Sending user data:', {
        name: formData.name,
        email: formData.email,
        role: formData.role,
        company_id: formData.company_id,
        hasPassword: !!formData.password,
        hasAvatar: !!formData.avatar
      });

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/users${selectedUser ? `/${selectedUser.id}` : ''}`,
        {
          method: selectedUser ? 'PUT' : 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formDataToSend,
        }
      );

      if (response.ok) {
        await fetchUsers();
        setShowAddModal(false);
        setShowEditModal(false);
        setFormData({
          name: '',
          email: '',
          password: '',
          role: 'member',
          company_id: '',
          avatar: null,
        });
        setSelectedUser(null);
      } else {
        let errorMessage = 'Failed to save user';
        try {
          const errorData = await response.json();
          console.error('Backend error response:', errorData);
          
          if (errorData.errors && Array.isArray(errorData.errors)) {
            // Handle validation errors
            errorMessage = errorData.errors.map((err: any) => err.msg || err.message).join(', ');
          } else {
            errorMessage = errorData.message || errorData.error || `HTTP ${response.status}: ${response.statusText}`;
          }
        } catch (parseError) {
          console.error('Failed to parse error response:', parseError);
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save user');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this user?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        await fetchUsers();
      } else {
        throw new Error('Failed to delete user');
      }
    } catch (error) {
      setError('Failed to delete user');
      console.error('Error:', error);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFormData((prev) => ({ ...prev, avatar: e.target.files![0] }));
    }
  };

  const openEditModal = (user: User) => {
    setSelectedUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role,
      company_id: user.company_id?.toString() || '',
      avatar: null,
    });
    setShowEditModal(true);
  };

  if (!user || !['admin', 'company-manager'].includes(user.role)) {
    return (
      <Layout>
        <div className="text-center">You do not have permission to view this page.</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="sm:flex sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold text-gray-900">Users</h1>
          <button
            onClick={() => {
              setFormData({
                name: '',
                email: '',
                password: '',
                role: 'member',
                company_id: '',
                avatar: null,
              });
              setShowAddModal(true);
            }}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-[5px] shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Add User
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
                        Name
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider rounded-[5px]"
                      >
                        Email
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider rounded-[5px]"
                      >
                        Role
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider rounded-[5px]"
                      >
                        Company
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider rounded-[5px]"
                      >
                        Created At
                      </th>
                      <th scope="col" className="relative px-6 py-3 rounded-[5px]">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200 rounded-[5px]">
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-4 whitespace-nowrap text-center rounded-[5px]">
                          Loading...
                        </td>
                      </tr>
                    ) : users.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-4 whitespace-nowrap text-center rounded-[5px]">
                          No users found
                        </td>
                      </tr>
                    ) : (
                      users.map((user) => (
                        <tr key={user.id} className="rounded-[5px]">
                          <td className="px-6 py-4 whitespace-nowrap rounded-[5px]">
                            <div className="flex items-center rounded-[5px]">
                              <div className="flex-shrink-0 h-10 w-10">
                                {user.avatar ? (
                                  <Image
                                    src={`${process.env.NEXT_PUBLIC_API_URL}${user.avatar}`}
                                    alt={user.name}
                                    width={40}
                                    height={40}
                                    className="rounded-full"
                                  />
                                ) : (
                                  <div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center">
                                    <span className="text-indigo-600 font-medium text-lg">
                                      {user.name.charAt(0).toUpperCase()}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <div className="ml-4">
                                <div className="text-sm font-medium text-gray-900">{user.name}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="text-sm text-gray-500">{user.email}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span
                              className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                user.role === 'admin'
                                  ? 'bg-red-100 text-red-800'
                                  : user.role === 'company-manager'
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}
                            >
                              {user.role}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{user.company_name || '-'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {new Date(user.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                              onClick={() => openEditModal(user)}
                              className="text-indigo-600 hover:text-indigo-900 mr-4"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(user.id)}
                              className="text-red-600 hover:text-red-900"
                            >
                              Delete
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

            <div className="inline-block align-bottom bg-white rounded-[5px] text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full relative z-50">
              <form onSubmit={handleSubmit}>
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                    {selectedUser ? 'Edit User' : 'Add New User'}
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                        Name
                      </label>
                      <input
                        type="text"
                        name="name"
                        id="name"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                        className="p-2 mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                      />
                    </div>

                    <div>
                      <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                        Email
                      </label>
                      <input
                        type="email"
                        name="email"
                        id="email"
                        required
                        value={formData.email}
                        onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                        className="p-2 mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                      />
                    </div>

                    <div>
                      <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                        Password {selectedUser && '(leave blank to keep current)'}
                      </label>
                      <input
                        type="password"
                        name="password"
                        id="password"
                        required={!selectedUser}
                        value={formData.password}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, password: e.target.value }))
                        }
                        className="p-2 mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                      />
                    </div>

                    <div>
                      <label htmlFor="role" className="block text-sm font-medium text-gray-700">
                        Role
                      </label>
                      <select
                        id="role"
                        name="role"
                        required
                        value={formData.role}
                        onChange={(e) => setFormData((prev) => ({ ...prev, role: e.target.value }))}
                        className="p-2 mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                      >
                        <option value="member">Member</option>
                        <option value="company-manager">Company Manager</option>
                        {user?.role === 'admin' && <option value="admin">Admin</option>}
                      </select>
                    </div>

                    {user?.role === 'admin' && (
                      <div>
                        <label htmlFor="company" className="block text-sm font-medium text-gray-700">
                          Company
                        </label>
                        <select
                          id="company"
                          name="company_id"
                          value={formData.company_id}
                          onChange={(e) =>
                            setFormData((prev) => ({ ...prev, company_id: e.target.value }))
                          }
                          className="p-2 mt-1 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                        >
                          <option value="">No Company</option>
                          {companies.map((company) => (
                            <option key={company.id} value={company.id}>
                              {company.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse rounded-[5px]">
                  <button
                    type="submit"
                    className="w-full inline-flex justify-center rounded-[5px] border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm"
                  >
                    {selectedUser ? 'Update' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddModal(false);
                      setShowEditModal(false);
                      setSelectedUser(null);
                      setFormData({
                        name: '',
                        email: '',
                        password: '',
                        role: 'member',
                        company_id: '',
                        avatar: null,
                      });
                    }}
                    className="mt-3 w-full inline-flex justify-center rounded-[5px] border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                  >
                    Cancel
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