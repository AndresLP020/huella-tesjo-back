import mongoose from 'mongoose';

/**
 * Esquema de Usuario con soporte para autenticación biométrica
 * Campos biométricos según documentación:
 * - biometric_enabled: boolean - Estado activo/inactivo
 * - biometric_public_key: text - Clave pública (nunca la privada)
 * - biometric_credential_id: text - ID único de la credencial
 * - biometric_counter: integer - Contador de autenticaciones
 * - biometric_registered_at: timestamp - Fecha de registro
 */
const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'El correo es requerido'],
    lowercase: true,
    trim: true
  },
  numeroControl: {
    type: String,
    required: [true, 'El número de control es requerido'],
    trim: true
  },
  nombre: {
    type: String,
    required: true,
    trim: true
  },
  apellidoPaterno: {
    type: String,
    required: true,
    trim: true
  },
  apellidoMaterno: {
    type: String,
    trim: true
  },
  carrera: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Carrera',
    required: true
  },
  semestre: {
    type: Number,
    required: false,
    default: 1
  },
  password: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  fotoPerfil: {
    type: String,
    default: null
  },
  role: {
    type: String,
    enum: ['admin', 'docente'],
    default: 'docente'
  },
  resetPasswordToken: {
    type: String,
    default: null
  },
  resetPasswordExpires: {
    type: Date,
    default: null
  },
  // Campos biométricos según la documentación
  biometric_enabled: {
    type: Boolean,
    default: false
  },
  biometric_public_key: {
    type: String,
    default: null
  },
  biometric_credential_id: {
    type: String,
    default: null
  },
  biometric_counter: {
    type: Number,
    default: 0
  },
  biometric_registered_at: {
    type: Date,
    default: null
  },
  // Campos para WebAuthn challenge temporal
  webauthn_challenge: {
    type: String,
    default: null
  },
  webauthn_challenge_expires: {
    type: Date,
    default: null
  },
  // WebAuthn Authenticators - Para compatibilidad con la implementación anterior
  authenticators: [{
    credentialID: {
      type: String,
      required: true
    },
    publicKey: {
      type: String,
      required: true
    },
    counter: {
      type: Number,
      required: true,
      default: 0
    },
    transports: [{
      type: String,
      enum: ['internal', 'usb', 'nfc', 'ble', 'hybrid']
    }],
    deviceName: {
      type: String,
      default: 'Dispositivo Biométrico'
    },
    registeredAt: {
      type: Date,
      default: Date.now
    },
    lastUsed: {
      type: Date,
      default: Date.now
    }
  }],
  // Campo temporal para desafíos WebAuthn
  currentChallenge: {
    type: String,
    default: null
  }
});

// Función segura para manejar índices
const handleIndexes = async () => {
  try {
    const collection = mongoose.connection.collection('users');
    
    // Primero intentar eliminar índices existentes de forma segura
    try {
      await collection.dropIndexes();
      console.log('Índices anteriores eliminados correctamente');
    } catch (dropError) {
      console.log('Aviso: No se pudieron eliminar índices anteriores');
    }

    // Crear nuevos índices
    const indexPromises = [
      collection.createIndex(
        { email: 1 },
        { 
          unique: true,
          background: true,
          name: 'email_unique',
          sparse: true
        }
      ),
      collection.createIndex(
        { numeroControl: 1 },
        { 
          unique: true,
          background: true,
          name: 'numeroControl_unique',
          sparse: true
        }
      )
    ];

    await Promise.all(indexPromises);
    console.log('Índices creados correctamente');
  } catch (error) {
    console.log('Error al manejar índices:', error.message);
    // No lanzar el error, solo registrarlo
  }
};

// Modificar el evento connected para manejar mejor el timing
mongoose.connection.once('connected', () => {
  setTimeout(() => {
    handleIndexes();
  }, 1000); // Pequeño delay para asegurar que la conexión esté estable
});

const User = mongoose.model('User', userSchema);

export default User;
