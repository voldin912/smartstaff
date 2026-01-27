import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import companyRoutes from './routes/companies.js';
import recordsRoutes from './routes/records.js';
import followRoutes from './routes/follow.js';
import salesforceRoutes from './routes/salesforceRoutes.js';
import invitationRoutes from './routes/invitations.js';
import { initializeDatabase } from './config/database.js';
import { autoDeleteOldRecords } from './controllers/recordsController.js';
import logger from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// CORS Configuration
// Parse allowed origins from environment variable (comma-separated)
// Default to localhost for development
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001'
    ];

// CORS middleware with proper origin validation
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      logger.warn(`CORS: Blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // Safe now because origin is validated
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type'],
  maxAge: 86400 // 24 hours - cache preflight requests
}));
// Increase body size limit to 100MB for file uploads
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/records', recordsRoutes);
app.use('/api/follow', followRoutes);
app.use('/api/salesforce', salesforceRoutes);
app.use('/api/invitations', invitationRoutes);

// Initialize database and start server
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
    logger.info(`CORS: Allowed origins: ${allowedOrigins.join(', ') || 'none (using environment variable)'}`);
    
    // Start auto-delete scheduler
    // Get retention period from environment variable (default: 4 months)
    const retentionMonths = parseInt(process.env.AUTO_DELETE_RETENTION_MONTHS || '4');
    
    // Run once immediately on startup
    autoDeleteOldRecords();
    
    // Then run every 24 hours (86400000 milliseconds)
    const AUTO_DELETE_INTERVAL_HOURS = parseInt(process.env.AUTO_DELETE_INTERVAL_HOURS || '24');
    setInterval(() => {
      autoDeleteOldRecords();
    }, AUTO_DELETE_INTERVAL_HOURS * 60 * 60 * 1000);
    
    logger.info(`Auto-delete scheduler started (runs every ${AUTO_DELETE_INTERVAL_HOURS} hours, deletes records older than ${retentionMonths} months)`);
  });
}).catch(err => {
  logger.error('Failed to initialize database', err);
  process.exit(1);
}); 