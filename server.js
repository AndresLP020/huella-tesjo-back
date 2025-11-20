import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import connectDB from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import webauthnRoutes from './routes/webauthnRoutes.js';
import userRoutes from './routes/users.js';
import assignmentRoutes from './routes/assignmentRoutes.js';
import dailyRecordRoutes from './routes/dailyRecordRoutes.js';
import carrerasRoutes from './routes/carreras.js';
import semestresRoutes from './routes/semestres.js';
import statsRoutes from './routes/statsRoutes.js';
import errorHandler from './middleware/errorHandler.js';
import notificationService from './services/notificationService.js';
import { startScheduledAssignmentsCron } from './services/scheduledAssignmentsService.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// Inicializar servicio de notificaciones
notificationService.initialize(httpServer);

// Middleware
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Rutas estáticas
app.use('/uploads', express.static('uploads'));

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/auth/biometric', webauthnRoutes);
app.use('/api/users', userRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/daily-records', dailyRecordRoutes);
app.use('/api/carreras', carrerasRoutes);
app.use('/api/semestres', semestresRoutes);
app.use('/api/stats', statsRoutes);

// Manejador de errores
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

// Conectar a la base de datos
connectDB().then(() => {
    httpServer.listen(PORT, () => {
        console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
        console.log('Límite de archivos actualizado a 50MB'); // Cambio para forzar reinicio
        
        // Iniciar el servicio de asignaciones programadas
        setTimeout(() => {
            startScheduledAssignmentsCron();
        }, 5000); // Esperar 5 segundos después de que el servidor esté listo
    });
}).catch(err => {
    console.error('Error al conectar a la base de datos:', err);
    process.exit(1);
});