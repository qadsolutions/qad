import express from 'express';
import cors from 'cors';
import configRoutes from './routes/config.js';
import overviewRoutes from './routes/overview.js';
import automationsRoutes from './routes/automations.js';
import activityRoutes from './routes/activity.js';
import documentsRoutes from './routes/documents.js';
import calendarRoutes from './routes/calendar.js';
import exceptionsRoutes from './routes/exceptions.js';
import reportsRoutes from './routes/reports.js';
import uploadRoutes from './routes/upload.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:4173'] }));
app.use(express.json());

app.use('/api/config',      configRoutes);
app.use('/api/overview',    overviewRoutes);
app.use('/api/automations', automationsRoutes);
app.use('/api/activity',    activityRoutes);
app.use('/api/documents',   documentsRoutes);
app.use('/api/calendar',    calendarRoutes);
app.use('/api/exceptions',  exceptionsRoutes);
app.use('/api/reports',     reportsRoutes);
app.use('/api/upload',      uploadRoutes);

app.get('/api/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.listen(PORT, () => console.log(`QAD API running on http://localhost:${PORT}`));
