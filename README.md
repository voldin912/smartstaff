# Company User Management System

A full-stack application for managing companies and users with role-based access control.

## Tech Stack

- Frontend: Next.js 14 (TypeScript + Tailwind CSS + App Router)
- Backend: Express.js
- Database: MySQL

## Features

- Authentication (Register, Login, Forgot Password)
- Role-based access control (Admin, Company Manager, Member)
- Company Management (CRUD)
- User Management (CRUD)
- Responsive Design
- File Upload (Avatar)

## Project Structure

```
.
├── frontend/               # Next.js frontend application
└── backend/               # Express.js backend application
```

## Getting Started

### Prerequisites

- Node.js 18+
- MySQL 8+
- npm or yarn

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env.local` file with:
```
NEXT_PUBLIC_API_URL=http://localhost:5000
```

4. Run the development server:
```bash
npm run dev
```

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file with:
```
PORT=5000
DB_HOST=localhost
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=company_management
JWT_SECRET=your_jwt_secret
```

4. Run the development server:
```bash
npm run dev
```

## Database Setup

1. Create a MySQL database named `company_management`
2. The tables will be automatically created when running the backend

## API Documentation

### Authentication Endpoints

- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/forgot-password
- GET /api/auth/me

### Company Endpoints

- GET /api/companies
- POST /api/companies
- PUT /api/companies/:id
- DELETE /api/companies/:id

### User Endpoints

- GET /api/users
- POST /api/users
- PUT /api/users/:id
- DELETE /api/users/:id

## License

MIT