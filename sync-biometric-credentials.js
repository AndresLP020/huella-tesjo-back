import mongoose from 'mongoose';
import User from './models/User.js';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Script para sincronizar y corregir credenciales biométricas
 * Este script ayuda a migrar entre diferentes sistemas de almacenamiento
 */

async function syncBiometricCredentials() {
  try {
    // Conectar a la base de datos
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/seguimiento');
    console.log('🔌 Conectado a la base de datos');

    // 1. Buscar usuarios con credenciales biométricas
    const usersWithBiometric = await User.find({
      $or: [
        { biometric_enabled: true },
        { 'authenticators.0': { $exists: true } }
      ]
    });

    console.log(`\n📊 Encontrados ${usersWithBiometric.length} usuarios con credenciales biométricas`);

    for (const user of usersWithBiometric) {
      console.log(`\n👤 Procesando usuario: ${user.email}`);
      
      let needsUpdate = false;
      
      // Verificar sistema nuevo
      if (user.biometric_enabled && user.biometric_credential_id) {
        console.log(`  ✅ Sistema nuevo: ${user.biometric_credential_id}`);
      }
      
      // Verificar sistema anterior
      if (user.authenticators && user.authenticators.length > 0) {
        console.log(`  📱 Sistema anterior: ${user.authenticators.length} dispositivos`);
        
        user.authenticators.forEach((auth, index) => {
          console.log(`    ${index + 1}. ${auth.credentialID} (counter: ${auth.counter})`);
        });
        
        // Si no tiene sistema nuevo pero tiene anterior, migrar el primer dispositivo
        if (!user.biometric_enabled && user.authenticators[0]) {
          const firstAuth = user.authenticators[0];
          console.log(`  🔄 Migrando al sistema nuevo...`);
          
          user.biometric_enabled = true;
          user.biometric_credential_id = firstAuth.credentialID;
          user.biometric_public_key = firstAuth.publicKey || 'migrated_key';
          user.biometric_counter = firstAuth.counter;
          user.biometric_registered_at = firstAuth.registeredAt;
          
          needsUpdate = true;
          console.log(`  ✅ Migrado: ${firstAuth.credentialID}`);
        }
      }
      
      // Guardar cambios si es necesario
      if (needsUpdate) {
        await user.save();
        console.log(`  💾 Usuario actualizado`);
      }
    }

    console.log('\n🎉 Sincronización completada');

    // 2. Mostrar resumen final
    console.log('\n📈 RESUMEN FINAL:');
    
    const finalUsers = await User.find({
      $or: [
        { biometric_enabled: true },
        { 'authenticators.0': { $exists: true } }
      ]
    }).select('email biometric_enabled biometric_credential_id authenticators');
    
    finalUsers.forEach(user => {
      console.log(`\n📧 ${user.email}:`);
      console.log(`  Sistema nuevo: ${user.biometric_enabled ? 'ACTIVO' : 'INACTIVO'}`);
      if (user.biometric_credential_id) {
        console.log(`  Credential ID: ${user.biometric_credential_id}`);
      }
      console.log(`  Dispositivos antiguos: ${user.authenticators?.length || 0}`);
    });

  } catch (error) {
    console.error('❌ Error en sincronización:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Desconectado de la base de datos');
  }
}

// Función para limpiar credential IDs duplicados o problemáticos
async function cleanupCredentials() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/seguimiento');
    console.log('🔌 Conectado para limpieza');

    // Buscar usuarios con sistemas duplicados
    const users = await User.find({
      biometric_enabled: true,
      'authenticators.0': { $exists: true }
    });

    console.log(`\n🧹 Limpiando ${users.length} usuarios con sistemas duplicados`);

    for (const user of users) {
      console.log(`\n👤 ${user.email}:`);
      
      // Si el credential_id del nuevo sistema coincide con alguno del anterior, limpiar duplicados
      const matchingAuth = user.authenticators.find(auth => 
        auth.credentialID === user.biometric_credential_id
      );

      if (matchingAuth) {
        console.log('  🔄 Encontrado duplicado, manteniendo solo sistema nuevo');
        user.authenticators = user.authenticators.filter(auth => 
          auth.credentialID !== user.biometric_credential_id
        );
        await user.save();
        console.log('  ✅ Duplicado eliminado');
      } else {
        console.log('  ℹ️ No hay duplicados');
      }
    }

    console.log('\n🎉 Limpieza completada');

  } catch (error) {
    console.error('❌ Error en limpieza:', error);
  } finally {
    await mongoose.disconnect();
  }
}

// Ejecutar según parámetro
const action = process.argv[2];

if (action === 'cleanup') {
  cleanupCredentials();
} else {
  syncBiometricCredentials();
}