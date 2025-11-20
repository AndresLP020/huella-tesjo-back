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

console.log('🔧 Configuración WebAuthn:', { rpName, rpID, origin });

/**
 * PASO 1: Generar opciones específicas para registro biométrico por usuario
 * Endpoint: POST /api/auth/biometric/registration-options
 */
router.post('/registration-options', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    console.log('🔧 Generando opciones de registro para:', user.email);

    // Obtener credenciales existentes para evitar re-registro
    const excludeCredentials = [];
    
    // Agregar credential del sistema nuevo si existe
    if (user.biometric_credential_id) {
      excludeCredentials.push({
        id: user.biometric_credential_id,
        type: 'public-key'
      });
    }
    
    // Agregar credentials del sistema de authenticators
    if (user.authenticators && user.authenticators.length > 0) {
      user.authenticators.forEach(auth => {
        if (auth.credentialID) {
          excludeCredentials.push({
            id: auth.credentialID,
            type: 'public-key'
          });
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
      supportedAlgorithmIDs: [-7, -257] // ES256 y RS256
    });

    console.log('✅ Opciones generadas para usuario:', user.email);
    console.log('🔑 Challenge length:', options.challenge.length);
    console.log('🚫 Excluding credentials:', excludeCredentials.length);
    
    // Guardar el challenge temporalmente para verificación posterior
    user.webauthn_challenge = options.challenge;
    user.webauthn_challenge_expires = new Date(Date.now() + 300000); // 5 minutos
    await user.save();

    res.json({
      success: true,
      options
    });

  } catch (error) {
    console.error('❌ Error generando opciones de registro:', error);
    res.status(500).json({
      success: false,
      message: 'Error al generar opciones de registro',
      error: error.message
    });
  }
});

/**
 * PASO 2: Verificar y registrar la respuesta biométrica
 * Endpoint: POST /api/auth/biometric/register
 */
router.post('/register', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    // Verificar que tengamos un challenge guardado y no haya expirado
    if (!user.webauthn_challenge || new Date() > user.webauthn_challenge_expires) {
      return res.status(400).json({
        success: false,
        message: 'Challenge expirado o no válido. Solicita nuevas opciones de registro.',
        code: 'INVALID_CHALLENGE'
      });
    }

    console.log('🔐 Verificando registro biométrico para:', user.email);
    
    const { response } = req.body;
    if (!response) {
      return res.status(400).json({
        success: false,
        message: 'Respuesta de registro requerida'
      });
    }

    try {
      // Verificar la respuesta usando SimpleWebAuthn
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
          message: 'Verificación de registro falló',
          code: 'VERIFICATION_FAILED'
        });
      }

      const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
      
      // Convertir credentialID a string base64url
      const credentialIdString = Buffer.from(credentialID).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

      console.log('✅ Verificación exitosa para:', user.email);
      console.log('🔑 Nuevo Credential ID:', credentialIdString);

      // Verificar si esta credencial ya está registrada 
      const existsInNew = user.biometric_credential_id === credentialIdString;
      const existsInOld = user.authenticators?.some(auth => auth.credentialID === credentialIdString);
      
      if (existsInNew || existsInOld) {
        return res.status(400).json({
          success: false,
          message: 'Esta credencial ya está registrada para este usuario.',
          code: 'CREDENTIAL_ALREADY_EXISTS'
        });
      }

      // Inicializar authenticators si no existe
      if (!user.authenticators) {
        user.authenticators = [];
      }
      
      // Crear nuevo authenticator
      const newAuthenticator = {
        credentialID: credentialIdString,
        publicKey: Buffer.from(credentialPublicKey).toString('base64'),
        counter,
        transports: ['internal'],
        deviceName: `Huella ${user.authenticators.length + 1}`,
        registeredAt: new Date(),
        lastUsed: new Date()
      };
      
      user.authenticators.push(newAuthenticator);
      
      // Habilitar biométrico si es la primera huella
      if (!user.biometric_enabled) {
        user.biometric_enabled = true;
        user.biometric_registered_at = new Date();
        user.biometric_public_key = Buffer.from(credentialPublicKey).toString('base64');
        user.biometric_credential_id = credentialIdString;
        user.biometric_counter = counter;
      }
      
      // Limpiar challenge usado
      user.webauthn_challenge = undefined;
      user.webauthn_challenge_expires = undefined;
      
      await user.save();
      
      console.log('✅ Huella registrada exitosamente para:', user.email);
      console.log('📱 Total huellas:', user.authenticators.length);
      
      res.json({
        success: true,
        message: 'Huella biométrica registrada correctamente',
        deviceName: newAuthenticator.deviceName,
        totalDevices: user.authenticators.length
      });
      
    } catch (verificationError) {
      console.error('❌ Error en verificación:', verificationError);
      return res.status(400).json({
        success: false,
        message: 'Error verificando la respuesta biométrica',
        error: verificationError.message
      });
    }

  } catch (error) {
    console.error('❌ Error en registro biométrico:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
});

/**
 * Generar desafío criptográfico general (sin credenciales específicas)
 * Endpoint: POST /api/auth/biometric/quick-login
 */
router.post('/quick-login', async (req, res) => {
  try {
    const challenge = crypto.randomBytes(32).toString('base64');
    
    console.log('🔑 Challenge general generado (sin allowCredentials por seguridad)');
    
    res.json({
      challenge,
      timeout: 60000
      // allowCredentials NO incluido por seguridad - cada usuario debe usar /login-challenge
    });

  } catch (error) {
    console.error('❌ Error generando challenge general:', error);
    res.status(500).json({
      success: false,
      message: 'Error al generar challenge',
      error: error.message
    });
  }
});

/**
 * Generar desafío con credenciales específicas del usuario
 * Endpoint: POST /api/auth/biometric/login-challenge
 */
router.post('/login-challenge', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email requerido'
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    const challenge = crypto.randomBytes(32).toString('base64');
    
    // Recopilar credenciales del usuario específico
    const allowCredentials = [];
    
    // Sistema nuevo
    if (user.biometric_credential_id) {
      allowCredentials.push({
        id: user.biometric_credential_id,
        type: 'public-key'
      });
    }
    
    // Sistema de authenticators
    if (user.authenticators && user.authenticators.length > 0) {
      user.authenticators.forEach(auth => {
        if (auth.credentialID) {
          allowCredentials.push({
            id: auth.credentialID,
            type: 'public-key'
          });
        }
      });
    }

    console.log(`🔑 Challenge específico para ${email}:`, allowCredentials.length, 'credenciales');
    
    res.json({
      challenge,
      timeout: 60000,
      allowCredentials
    });

  } catch (error) {
    console.error('❌ Error generando challenge específico:', error);
    res.status(500).json({
      success: false,
      message: 'Error al generar challenge específico',
      error: error.message
    });
  }
});

/**
 * Verificar huella para autenticación
 * Endpoint: PUT /api/auth/biometric/quick-login
 */
router.put('/quick-login', async (req, res) => {
  try {
    const { signature, authenticatorData, clientDataJSON, credentialId } = req.body;

    if (!signature || !authenticatorData || !clientDataJSON || !credentialId) {
      return res.status(400).json({
        success: false,
        message: 'Datos incompletos para la verificación biométrica'
      });
    }

    console.log('🔍 Buscando usuario por credential ID:', credentialId);

    // Buscar usuario por credential ID en ambos sistemas
    let user = await User.findOne({ biometric_credential_id: credentialId });
    
    if (!user) {
      user = await User.findOne({ 
        'authenticators.credentialID': credentialId 
      });
    }

    if (!user || !user.biometric_enabled) {
      console.log('❌ Usuario no encontrado o biométrico deshabilitado');
      return res.status(404).json({
        success: false,
        message: 'Credencial biométrica no válida'
      });
    }

    console.log('✅ Usuario encontrado:', user.email);

    // Actualizar último uso
    if (user.authenticators) {
      const authenticator = user.authenticators.find(auth => auth.credentialID === credentialId);
      if (authenticator) {
        authenticator.lastUsed = new Date();
        authenticator.counter += 1;
      }
    }

    // Actualizar contador del sistema nuevo si corresponde
    if (user.biometric_credential_id === credentialId) {
      user.biometric_counter += 1;
    }

    await user.save();

    // Generar JWT
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('🎉 Autenticación biométrica exitosa para:', user.email);

    res.json({
      success: true,
      message: 'Autenticación biométrica exitosa',
      token,
      user: {
        id: user._id,
        email: user.email,
        nombre: user.nombre,
        apellidos: user.apellidos,
        rol: user.rol
      }
    });

  } catch (error) {
    console.error('❌ Error en autenticación biométrica:', error);
    res.status(500).json({
      success: false,
      message: 'Error en el servidor durante la autenticación',
      error: error.message
    });
  }
});

/**
 * Consultar estado de dispositivos biométricos
 * Endpoint: GET /api/auth/biometric/status
 */
router.get('/status', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    // Contar dispositivos
    const totalDevices = (user.authenticators?.length || 0) + (user.biometric_credential_id ? 1 : 0);
    
    // Información detallada
    const devices = [];
    
    // Sistema nuevo
    if (user.biometric_credential_id) {
      devices.push({
        id: user.biometric_credential_id,
        type: 'primary',
        deviceName: 'Huella Principal',
        registeredAt: user.biometric_registered_at
      });
    }
    
    // Sistema de authenticators
    if (user.authenticators) {
      user.authenticators.forEach(auth => {
        devices.push({
          id: auth.credentialID,
          type: 'authenticator',
          deviceName: auth.deviceName || 'Dispositivo sin nombre',
          registeredAt: auth.registeredAt,
          lastUsed: auth.lastUsed,
          counter: auth.counter
        });
      });
    }

    res.json({
      success: true,
      biometricEnabled: user.biometric_enabled,
      totalDevices,
      devices,
      canRegisterMore: totalDevices < 5 // Límite de 5 dispositivos
    });

  } catch (error) {
    console.error('❌ Error consultando estado biométrico:', error);
    res.status(500).json({
      success: false,
      message: 'Error al consultar estado biométrico',
      error: error.message
    });
  }
});

/**
 * Eliminar dispositivo biométrico específico
 * Endpoint: DELETE /api/auth/biometric/device/:credentialId
 */
router.delete('/device/:credentialId', auth, async (req, res) => {
  try {
    const { credentialId } = req.params;
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    let deviceRemoved = false;
    let deviceName = '';

    // Verificar si es el credential principal
    if (user.biometric_credential_id === credentialId) {
      user.biometric_credential_id = null;
      user.biometric_public_key = null;
      user.biometric_counter = 0;
      deviceRemoved = true;
      deviceName = 'Huella Principal';
    }

    // Verificar en authenticators
    if (user.authenticators) {
      const initialLength = user.authenticators.length;
      const removedAuth = user.authenticators.find(auth => auth.credentialID === credentialId);
      
      user.authenticators = user.authenticators.filter(auth => auth.credentialID !== credentialId);
      
      if (user.authenticators.length < initialLength) {
        deviceRemoved = true;
        deviceName = removedAuth?.deviceName || 'Dispositivo desconocido';
      }
    }

    if (!deviceRemoved) {
      return res.status(404).json({
        success: false,
        message: 'Dispositivo no encontrado'
      });
    }

    // Si no quedan dispositivos, deshabilitar biométrico
    const remainingDevices = (user.authenticators?.length || 0) + (user.biometric_credential_id ? 1 : 0);
    if (remainingDevices === 0) {
      user.biometric_enabled = false;
    }

    await user.save();

    console.log('🗑️ Dispositivo eliminado:', deviceName, 'para usuario:', user.email);

    res.json({
      success: true,
      message: `Dispositivo "${deviceName}" eliminado correctamente`,
      remainingDevices
    });

  } catch (error) {
    console.error('❌ Error eliminando dispositivo:', error);
    res.status(500).json({
      success: false,
      message: 'Error al eliminar dispositivo',
      error: error.message
    });
  }
});

export default router;