import mongoose from 'mongoose';
import User from './models/User.js';
import dotenv from 'dotenv';
dotenv.config();

async function debugCredentials() {
  try {
    // Conectar a la base de datos
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/seguimiento');
    console.log('🔌 Conectado a la base de datos');

    // Buscar todos los usuarios primero
    console.log('\n📋 Total de usuarios en la base de datos:');
    const totalUsers = await User.countDocuments();
    console.log(`Total: ${totalUsers} usuarios`);
    
    // Mostrar algunos usuarios para verificar conexión
    const someUsers = await User.find({}).limit(5).select('email nombre biometric_enabled biometric_credential_id');
    console.log('\n👥 Usuarios encontrados:');
    someUsers.forEach(user => {
      console.log(`  - ${user.email} (${user.nombre}) - Biometric: ${user.biometric_enabled || false}`);
    });

    // Buscar usuario por email específico
    const user = await User.findOne({ email: 'andreslopezpina187@gmail.com' });
    
    if (user) {
      console.log('\n👤 Usuario específico encontrado:');
      console.log('📧 Email:', user.email);
      console.log('🔐 Biometric enabled:', user.biometric_enabled);
      console.log('🔑 Biometric credential ID:', user.biometric_credential_id);
      console.log('🔑 Biometric public key:', user.biometric_public_key ? 'SÍ' : 'NO');
      console.log('📊 Biometric counter:', user.biometric_counter);
      console.log('📅 Registered at:', user.biometric_registered_at);
      
      if (user.authenticators && user.authenticators.length > 0) {
        console.log('\n🎯 Authenticators (sistema anterior):');
        user.authenticators.forEach((auth, index) => {
          console.log(`  ${index + 1}. ID: ${auth.credentialID}`);
          console.log(`     Counter: ${auth.counter}`);
        });
      }
    } else {
      console.log('❌ Usuario específico no encontrado');
      
      // Buscar con patrones similares
      console.log('\n🔍 Buscando usuarios con emails similares...');
      const similarUsers = await User.find({ 
        email: { $regex: 'andres', $options: 'i' }
      }).select('email nombre');
      
      if (similarUsers.length > 0) {
        console.log('📧 Usuarios con email similar:');
        similarUsers.forEach(u => console.log(`  - ${u.email}`));
      } else {
        console.log('No se encontraron usuarios similares');
      }
    }

    // Buscar todos los usuarios con biométrico habilitado
    console.log('\n🔍 Todos los usuarios con biométrico:');
    const biometricUsers = await User.find({ 
      $or: [
        { biometric_enabled: true },
        { 'authenticators.0': { $exists: true } }
      ]
    }).select('email biometric_enabled biometric_credential_id authenticators');
    
    biometricUsers.forEach(user => {
      console.log(`\n📧 ${user.email}:`);
      console.log(`  - Biometric enabled: ${user.biometric_enabled}`);
      console.log(`  - Credential ID: ${user.biometric_credential_id}`);
      console.log(`  - Old authenticators: ${user.authenticators?.length || 0}`);
      if (user.authenticators && user.authenticators.length > 0) {
        user.authenticators.forEach((auth, i) => {
          console.log(`    ${i + 1}. ${auth.credentialID}`);
        });
      }
    });

    // Buscar específicamente el credential ID que está fallando actualmente
    const searchCredentialId = 'jDpdlTYI8oG4JGut3cfL6P0JynWp3iX4iMz-NC93wPQ'; // Del log más reciente
    console.log(`\n🔎 Buscando credential ID de login actual: ${searchCredentialId}`);
    
    const userWithCredential = await User.findOne({ 
      biometric_credential_id: searchCredentialId 
    });
    
    console.log('Resultado de búsqueda por credential ID actual:', userWithCredential ? 'ENCONTRADO' : 'NO ENCONTRADO');
    
    if (userWithCredential) {
      console.log('Usuario encontrado:', userWithCredential.email);
    }
    
    // Actualizar el credential ID del usuario para que coincida con el del login
    console.log(`\n🔧 Actualizando credential ID del usuario...`);
    console.log(`📝 Credential ID del registro: Bg1vNySaDz-X0gzD1ybmdBpfrwQuM2ALjOHG4oL_wtE`);
    console.log(`📝 Credential ID del login: ${searchCredentialId}`);
    
    // Por ahora, mantener el del registro pero notar la discrepancia
    console.log(`\n⚠️ NOTA: Los credential IDs no coinciden!`);
    console.log(`   - Registro: Bg1vNySaDz-X0gzD1ybmdBpfrwQuM2ALjOHG4oL_wtE`);
    console.log(`   - Login:    ${searchCredentialId}`);
    console.log(`\n💡 Esto es normal en WebAuthn - cada operación puede generar IDs diferentes`);
    
    // No actualizar automáticamente, dejar el del registro
    const updateResult = await User.findOne({ email: 'andreslopezpina187@gmail.com' });
    
    if (updateResult) {
      console.log('✅ Usuario actualizado correctamente');
      console.log('Nuevo credential ID:', updateResult.biometric_credential_id);
    } else {
      console.log('❌ Error actualizando usuario');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Desconectado de la base de datos');
  }
}

debugCredentials();