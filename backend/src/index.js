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
import { initializeDatabase } from './config/database.js';
import { autoDeleteOldRecords } from './controllers/recordsController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
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

// Initialize database and start server
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    
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
    
    console.log(`Auto-delete scheduler started (runs every ${AUTO_DELETE_INTERVAL_HOURS} hours, deletes records older than ${retentionMonths} months)`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
}); 