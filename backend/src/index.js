import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import companyRoutes from './routes/companies.js';
import recordsRoutes from './routes/records.js';
import salesforceRoutes from './routes/salesforceRoutes.js';
import { initializeDatabase } from './config/database.js';
import { deleteOldRecords } from './controllers/recordsController.js';

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
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/records', recordsRoutes);
app.use('/api/salesforce', salesforceRoutes);

// Initialize database and start server
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    
    // Schedule daily cleanup of records older than 60 days
    // Run cleanup once at startup, then daily at 2 AM
    const scheduleCleanup = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(2, 0, 0, 0); // 2 AM
      
      const msUntilCleanup = tomorrow.getTime() - now.getTime();
      
      // Run cleanup immediately on startup
      deleteOldRecords().catch(err => {
        console.error('Error during initial cleanup:', err);
      });
      
      // Schedule daily cleanup
      setTimeout(() => {
        deleteOldRecords().catch(err => {
          console.error('Error during scheduled cleanup:', err);
        });
        
        // Schedule next cleanup (24 hours later)
        setInterval(() => {
          deleteOldRecords().catch(err => {
            console.error('Error during scheduled cleanup:', err);
          });
        }, 24 * 60 * 60 * 1000); // 24 hours
      }, msUntilCleanup);
      
      console.log(`Scheduled daily cleanup at 2 AM. Next cleanup in ${Math.round(msUntilCleanup / 1000 / 60)} minutes.`);
    };
    
    scheduleCleanup();
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
}); 