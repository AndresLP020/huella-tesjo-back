import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Importar rutas
import authRoutes from './routes/authRoutes.js';
import webauthnRoutes from './routes/webauthnRoutes.js';
import assignmentRoutes from './routes/assignmentRoutes.js';
import usersRoutes from './routes/users.js';
import carrerasRoutes from './routes/carreras.js';
import semestresRoutes from './routes/semestres.js';
import dailyRecordRoutes from './routes/dailyRecordRoutes.js';
import statsRoutes from './routes/statsRoutes.js';
import bulkRoutes from './routes/bulkRoutes.js';

// Importar middlewares
import errorHandler from './middleware/errorHandler.js';
import { uploadConfig } from './config/upload.js';

// Configurar __dirname para ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ========== MIDDLEWARES GLOBALES ==========

// CORS configurado para desarrollo y producción
const corsOrigins = process.env.NODE_ENV === 'production' 
  ? [
      process.env.FRONTEND_URL, 
      process.env.CLIENT_URL,
      process.env.CORS_ORIGIN
    ].filter(Boolean)
  : ['http://localhost:3000', 'http://localhost:5173'];

app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'cache-control', 'pragma'],
  optionsSuccessStatus: 200 // Para compatibilidad con navegadores móviles
}));

// Parseo de JSON y URL encoded
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Crear directorios de uploads
uploadConfig.createUploadDirs();

// Servir archivos estáticos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ========== CONEXIÓN A BASE DE DATOS ==========

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/seguimiento_docentes';
    
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('🟢 MongoDB conectado exitosamente');
    console.log(`📍 Base de datos: ${mongoose.connection.name}`);
    
  } catch (error) {
    console.error('🔴 Error conectando a MongoDB:', error.message);
    process.exit(1);
  }
};

// ========== RUTAS DE LA API ==========

// Ruta de salud del servidor
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Rutas principales de la API
app.use('/api/auth', authRoutes);
app.use('/api/auth/biometric', webauthnRoutes);  // Rutas biométricas WebAuthn
app.use('/api/assignments', assignmentRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/carreras', carrerasRoutes);
app.use('/api/semestres', semestresRoutes);
app.use('/api/daily-records', dailyRecordRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/bulk', bulkRoutes);

// Ruta para servir el frontend en producción
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
  });
}

// Ruta 404 para APIs no encontradas
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
    timestamp: new Date().toISOString()
  });
});

// ========== MANEJO DE ERRORES ==========

// Middleware de manejo de errores
app.use(errorHandler);

// Manejo de errores no capturados
process.on('unhandledRejection', (err, promise) => {
  console.error('🔴 Unhandled Promise Rejection:', err.message);
  console.error('Stack:', err.stack);
});

process.on('uncaughtException', (err) => {
  console.error('🔴 Uncaught Exception:', err.message);
  console.error('Stack:', err.stack);
  process.exit(1);
});

// ========== INICIAR SERVIDOR ==========

const startServer = async () => {
  try {
    // Conectar a la base de datos
    await connectDB();
    
    // Iniciar el servidor
    app.listen(PORT, () => {
      console.log('🚀 ========================================');
      console.log('🚀 SERVIDOR INICIADO CORRECTAMENTE');
      console.log('🚀 ========================================');
      console.log(`🌐 Servidor corriendo en puerto: ${PORT}`);
      console.log(`🔗 URL local: http://localhost:${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🧪 Test WebAuthn: http://localhost:${PORT}/api/auth/biometric/test`);
      console.log(`🛡️ Entorno: ${process.env.NODE_ENV || 'development'}`);
      console.log('🚀 ========================================');
      
      // Log de rutas disponibles
      console.log('📋 RUTAS DISPONIBLES:');
      console.log('   📍 /api/auth/* - Autenticación y registro');
      console.log('   🔐 /api/auth/biometric/* - WebAuthn biometría');
      console.log('   📝 /api/assignments/* - Gestión de asignaciones');
      console.log('   👥 /api/users/* - Gestión de usuarios');
      console.log('   🏫 /api/carreras/* - Catálogo de carreras');
      console.log('   📚 /api/semestres/* - Catálogo de semestres');
      console.log('   📊 /api/stats/* - Estadísticas');
      console.log('   📋 /api/daily-records/* - Registros diarios');
      console.log('   🔄 /api/bulk/* - Operaciones en lote');
      console.log('🚀 ========================================');
    });
    
  } catch (error) {
    console.error('🔴 Error iniciando el servidor:', error.message);
    process.exit(1);
  }
};

// Iniciar la aplicación
startServer();

export default app;