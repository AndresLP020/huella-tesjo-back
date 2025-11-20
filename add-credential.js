import mongoose from 'mongoose';
import User from './models/User.js';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Script para agregar credenciales adicionales de WebAuthn 
 * Esto permite que un usuario tenga múltiples credential IDs activos
 */

async function addAdditionalCredential() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/seguimiento');
    console.log('🔌 Conectado a la base de datos');

    const userEmail = 'andreslopezpina187@gmail.com';
    const newCredentialId = 'jDpdlTYI8oG4JGut3cfL6P0JynWp3iX4iMz-NC93wPQ'; // Del log de login

    // Buscar el usuario
    const user = await User.findOne({ email: userEmail });
    
    if (!user) {
      console.log('❌ Usuario no encontrado');
      return;
    }

    console.log(`\n👤 Usuario encontrado: ${user.email}`);
    console.log(`📱 Credential ID actual: ${user.biometric_credential_id}`);
    console.log(`🔄 Nuevo credential ID: ${newCredentialId}`);

    // Verificar si ya existe este credential ID
    const existsInNew = user.biometric_credential_id === newCredentialId;
    const existsInOld = user.authenticators?.some(auth => auth.credentialID === newCredentialId);

    if (existsInNew || existsInOld) {
      console.log('✅ Credential ID ya existe, no es necesario agregarlo');
    } else {
      console.log('🆕 Agregando nuevo credential ID al sistema de authenticators...');
      
      // Agregar al sistema de authenticators (más flexible)
      if (!user.authenticators) {
        user.authenticators = [];
      }

      const newAuthenticator = {
        credentialID: newCredentialId,
        publicKey: 'placeholder_key_' + Date.now(), // Placeholder
        counter: 0,
        transports: ['internal'],
        deviceName: 'Dispositivo Biométrico Adicional',
        registeredAt: new Date(),
        lastUsed: new Date()
      };

      user.authenticators.push(newAuthenticator);
      await user.save();

      console.log('✅ Credential ID adicional agregado exitosamente');
    }

    // Mostrar resumen final
    console.log('\n📋 ESTADO FINAL DEL USUARIO:');
    console.log(`📧 Email: ${user.email}`);
    console.log(`🔐 Sistema nuevo activo: ${user.biometric_enabled}`);
    console.log(`🔑 Credential ID principal: ${user.biometric_credential_id}`);
    console.log(`📱 Total authenticators: ${user.authenticators?.length || 0}`);
    
    if (user.authenticators && user.authenticators.length > 0) {
      console.log('\n🔗 Authenticators disponibles:');
      user.authenticators.forEach((auth, index) => {
        console.log(`  ${index + 1}. ${auth.credentialID} (${auth.deviceName})`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Desconectado de la base de datos');
  }
}

addAdditionalCredential();