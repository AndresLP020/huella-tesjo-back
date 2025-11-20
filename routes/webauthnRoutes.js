import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import { auth } from '../middleware/auth.js';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';

const router = express.Router();

// Configuración WebAuthn
const rpName = 'Sistema de Seguimiento de Docentes';
const rpID = process.env.WEBAUTHN_RP_ID || 'localhost';
const origin = process.env.NODE_ENV === 'production' ? 'https://your-domain.com' : 'http://localhost:5173';

/**
 * PASO 1: Generar opciones específicas para registro biométrico por usuario
 */
router.post('/registration-options', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    console.log('🔧 Generando opciones de registro para:', user.email);

    // Obtener credenciales existentes para evitar re-registro
    const excludeCredentials = [];
    
    if (user.biometric_credential_id) {
      excludeCredentials.push({ id: user.biometric_credential_id, type: 'public-key' });
    }
    
    if (user.authenticators?.length > 0) {
      user.authenticators.forEach(auth => {
        if (auth.credentialID) {
          excludeCredentials.push({ id: auth.credentialID, type: 'public-key' });
        }
      });
    }

    // Generar userID único basado en el ID del usuario
    const userIdBuffer = Buffer.from(user._id.toString(), 'utf8');
    
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: userIdBuffer,
      userName: user.email,
      userDisplayName: `${user.nombre} ${user.apellidos}`,
      timeout: 60000,
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: {
        userVerification: 'required',
        residentKey: 'preferred',
        requireResidentKey: false
      },
      supportedAlgorithmIDs: [-7, -257]
    });

    // Guardar challenge temporalmente
    user.webauthn_challenge = options.challenge;
    user.webauthn_challenge_expires = new Date(Date.now() + 300000);
    await user.save();

    res.json({ success: true, options });

  } catch (error) {
    console.error('❌ Error generando opciones:', error);
    res.status(500).json({ success: false, message: 'Error al generar opciones', error: error.message });
  }
});

/**
 * PASO 2: Verificar y registrar la respuesta biométrica
 */
router.post('/register', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    // Verificar challenge válido
    if (!user.webauthn_challenge || new Date() > user.webauthn_challenge_expires) {
      return res.status(400).json({
        success: false,
        message: 'Challenge expirado. Solicita nuevas opciones.',
        code: 'INVALID_CHALLENGE'
      });
    }

    const { response } = req.body;
    if (!response) {
      return res.status(400).json({ success: false, message: 'Respuesta requerida' });
    }

    try {
      // Verificar usando SimpleWebAuthn
      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: user.webauthn_challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true
      });

      if (!verification.verified || !verification.registrationInfo) {
        return res.status(400).json({
          success: false,
          message: 'Verificación falló',
          code: 'VERIFICATION_FAILED'
        });
      }

      const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
      
      // Convertir a base64url
      const credentialIdString = Buffer.from(credentialID).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      console.log('✅ Nueva credencial para', user.email, ':', credentialIdString);

      // Verificar si ya existe
      const existsInNew = user.biometric_credential_id === credentialIdString;
      const existsInOld = user.authenticators?.some(auth => auth.credentialID === credentialIdString);
      
      if (existsInNew || existsInOld) {
        return res.status(400).json({
          success: false,
          message: 'Esta credencial ya está registrada.',
          code: 'CREDENTIAL_EXISTS'
        });
      }

      // Inicializar authenticators
      if (!user.authenticators) user.authenticators = [];
      
      // Crear nuevo authenticator
      const newAuth = {
        credentialID: credentialIdString,
        publicKey: Buffer.from(credentialPublicKey).toString('base64'),
        counter,
        transports: ['internal'],
        deviceName: `Huella ${user.authenticators.length + 1}`,
        registeredAt: new Date(),
        lastUsed: new Date()
      };
      
      user.authenticators.push(newAuth);
      
      // Habilitar biométrico si es primera huella
      if (!user.biometric_enabled) {
        user.biometric_enabled = true;
        user.biometric_registered_at = new Date();
        user.biometric_public_key = Buffer.from(credentialPublicKey).toString('base64');
        user.biometric_credential_id = credentialIdString;
        user.biometric_counter = counter;
      }
      
      // Limpiar challenge
      user.webauthn_challenge = undefined;
      user.webauthn_challenge_expires = undefined;
      
      await user.save();
      
      console.log('✅ Registrada huella para', user.email, '- Total:', user.authenticators.length);
      
      res.json({
        success: true,
        message: 'Huella registrada correctamente',
        deviceName: newAuth.deviceName,
        totalDevices: user.authenticators.length
      });
      
    } catch (verificationError) {
      console.error('❌ Error verificación:', verificationError);
      return res.status(400).json({
        success: false,
        message: 'Error en verificación',
        error: verificationError.message
      });
    }

  } catch (error) {
    console.error('❌ Error registro:', error);
    res.status(500).json({ success: false, message: 'Error interno', error: error.message });
  }
});

/**
 * Endpoint para obtener challenge simple (compatibilidad)
 */
router.get('/challenge', async (req, res) => {
  try {
    console.log('🔑 [CHALLENGE] Solicitud recibida');
    const challenge = crypto.randomBytes(32).toString('base64');
    console.log('✅ [CHALLENGE] Challenge generado');
    res.json({ challenge, timeout: 60000 });
  } catch (error) {
    console.error('❌ [CHALLENGE] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Endpoint de prueba sin auth
 */
router.get('/test', async (req, res) => {
  console.log('🧪 [TEST] Endpoint de prueba llamado');
  res.json({ success: true, message: 'WebAuthn routes working', timestamp: new Date() });
});

/**
 * Consultar estado de dispositivos biométricos del usuario autenticado
 */
router.get('/status', auth, async (req, res) => {
  try {
    console.log('🔍 [STATUS] Solicitud recibida para usuario:', req.user.id);
    
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    const totalDevices = user.authenticators?.length || 0;
    const hasDevices = totalDevices > 0;
    
    // Preparar información de dispositivos (sin claves públicas por seguridad)
    const devices = user.authenticators?.map((auth, index) => ({
      id: auth.credentialID,
      name: auth.deviceName || `Dispositivo ${index + 1}`,
      registeredAt: auth.registeredAt,
      lastUsed: auth.lastUsed
    })) || [];

    const statusResponse = {
      success: true,
      biometricEnabled: user.biometric_enabled || false,
      hasDevices,
      totalDevices,
      devices,
      canRegisterMore: totalDevices < 5, // Límite de 5 dispositivos por usuario
      user: {
        email: user.email,
        name: `${user.nombre} ${user.apellidos}`
      }
    };
    
    console.log('✅ [STATUS] Estado para', user.email, ':', {
      biometricEnabled: statusResponse.biometricEnabled,
      totalDevices: statusResponse.totalDevices
    });
    
    res.json(statusResponse);

  } catch (error) {
    console.error('❌ [STATUS] Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error consultando estado', 
      error: error.message 
    });
  }
});

/**
 * Eliminar todos los dispositivos biométricos del usuario
 */
router.delete('/delete', auth, async (req, res) => {
  try {
    console.log('🗑️ [DELETE] Solicitud de eliminación de dispositivos biométricos');
    
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    console.log('🔍 Estado antes de eliminar:', {
      email: user.email,
      biometric_enabled: user.biometric_enabled,
      total_authenticators: user.authenticators?.length || 0
    });

    // Resetear todos los campos biométricos
    user.biometric_enabled = false;
    user.biometric_registered_at = null;
    user.biometric_public_key = null;
    user.biometric_credential_id = null;
    user.biometric_counter = null;
    user.authenticators = [];

    // Limpiar challenges pendientes
    user.webauthn_challenge = undefined;
    user.webauthn_challenge_expires = undefined;

    await user.save();

    console.log('✅ [DELETE] Dispositivos biométricos eliminados exitosamente para:', user.email);

    res.json({
      success: true,
      message: 'Todos los dispositivos biométricos han sido eliminados correctamente',
      biometricEnabled: false,
      totalDevices: 0
    });

  } catch (error) {
    console.error('❌ [DELETE] Error eliminando dispositivos:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error eliminando dispositivos biométricos', 
      error: error.message 
    });
  }
});

/**
 * Otros endpoints para mantener funcionalidad
 */
router.post('/quick-login', async (req, res) => {
  try {
    const challenge = crypto.randomBytes(32).toString('base64');
    res.json({ challenge, timeout: 60000 });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/quick-login', async (req, res) => {
  try {
    const { credentialId } = req.body;
    
    let user = await User.findOne({ biometric_credential_id: credentialId });
    if (!user) {
      user = await User.findOne({ 'authenticators.credentialID': credentialId });
    }

    if (!user || !user.biometric_enabled) {
      return res.status(404).json({ success: false, message: 'Credencial no válida' });
    }

    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });

    res.json({
      success: true,
      message: 'Login exitoso',
      token,
      user: { id: user._id, email: user.email, nombre: user.nombre, apellidos: user.apellidos, rol: user.rol }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;