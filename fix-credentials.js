import mongoose from 'mongoose';
import User from './models/User.js';
import dotenv from 'dotenv';
dotenv.config();

async function fixCredentialIds() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/seguimiento');
    console.log('🔌 Conectado a la base de datos');

    const user = await User.findOne({ email: 'andreslopezpina187@gmail.com' });
    
    console.log('📋 ESTADO ACTUAL:');
    console.log(`Sistema nuevo credential ID: ${user.biometric_credential_id}`);
    console.log(`Authenticators: ${user.authenticators?.length || 0}`);
    
    // El credential ID correcto del registro más reciente
    const correctCredentialId = 'Bg1vNySaDz-X0gzD1ybmdBpfrwQuM2ALjOHG4oL_wtE';
    
    console.log(`\n🔧 Actualizando credential ID principal a: ${correctCredentialId}`);
    
    user.biometric_credential_id = correctCredentialId;
    await user.save();
    
    console.log('✅ Credential ID principal actualizado');
    
    // Verificar estado final
    const updatedUser = await User.findOne({ email: 'andreslopezpina187@gmail.com' });
    
    console.log('\n📋 ESTADO FINAL:');
    console.log(`Sistema nuevo credential ID: ${updatedUser.biometric_credential_id}`);
    console.log(`Total authenticators disponibles: ${updatedUser.authenticators?.length || 0}`);
    
    console.log('\n🔗 Todos los credential IDs disponibles:');
    console.log(`1. Principal: ${updatedUser.biometric_credential_id}`);
    if (updatedUser.authenticators) {
      updatedUser.authenticators.forEach((auth, index) => {
        console.log(`${index + 2}. Authenticator: ${auth.credentialID}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Desconectado');
  }
}

fixCredentialIds();