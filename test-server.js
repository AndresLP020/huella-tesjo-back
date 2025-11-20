import express from 'express';
import mongoose from 'mongoose';
import User from './models/User.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// Test endpoint con el fix correcto
app.post('/test-check-user-devices', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email es requerido'
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.json({
        success: true,
        hasDevices: false,
        message: 'Usuario no encontrado'
      });
    }

    // Verificar tanto el sistema nuevo como el anterior
    const hasNewSystem = user.biometric_enabled && user.biometric_public_key;
    const hasOldSystem = user.authenticators && user.authenticators.length > 0;
    const hasDevices = hasNewSystem || hasOldSystem;
    
    console.log('🔍 Debug check-user-devices para:', email);
    console.log('  - biometric_enabled:', user.biometric_enabled);
    console.log('  - biometric_public_key:', user.biometric_public_key);
    console.log('  - biometric_public_key type:', typeof user.biometric_public_key);
    console.log('  - !!biometric_public_key:', !!user.biometric_public_key);
    console.log('  - hasNewSystem:', hasNewSystem);
    console.log('  - authenticators count:', user.authenticators?.length || 0);
    console.log('  - hasOldSystem:', hasOldSystem);
    console.log('  - hasDevices calculation:', hasDevices);
    console.log('  - hasDevices type:', typeof hasDevices);

    const response = {
      success: true,
      hasDevices: Boolean(hasDevices),
      deviceCount: hasOldSystem ? user.authenticators.length : (hasNewSystem ? 1 : 0),
      newSystem: Boolean(hasNewSystem),
      oldSystem: Boolean(hasOldSystem),
      debug: {
        originalHasDevices: hasDevices,
        originalHasDevicesType: typeof hasDevices,
        biometric_public_key: user.biometric_public_key,
        biometric_enabled: user.biometric_enabled
      }
    };
    
    console.log('📤 Respuesta final:', response);
    
    res.json(response);

  } catch (error) {
    console.error('Error verificando dispositivos del usuario:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
});

// Conectar a MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/seguimiento')
  .then(() => {
    console.log('🔌 Conectado a MongoDB');
    
    // Iniciar servidor en puerto diferente
    const PORT = 3002;
    app.listen(PORT, () => {
      console.log(`🚀 Servidor de prueba iniciado en puerto ${PORT}`);
      console.log(`📋 Test endpoint: POST http://localhost:${PORT}/test-check-user-devices`);
    });
  })
  .catch(err => {
    console.error('❌ Error conectando a MongoDB:', err);
  });