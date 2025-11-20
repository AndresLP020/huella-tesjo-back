import mongoose from 'mongoose';
import User from './models/User.js';
import axios from 'axios';

// Base URL de la API (ajustar según configuración)
const API_BASE = 'http://localhost:5000/api';

async function connectDB() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/seguimiento_docentes', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Conectado a MongoDB');
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error);
    process.exit(1);
  }
}

async function testUserIsolation() {
  console.log('\n🧪 === PRUEBA DE AISLAMIENTO DE USUARIOS ===\n');
  
  try {
    // Buscar usuarios con credenciales biométricas
    const usersWithBiometrics = await User.find({
      $or: [
        { biometric_enabled: true },
        { 'authenticators.0': { $exists: true } }
      ]
    }).select('email biometric_enabled biometric_credential_id authenticators');
    
    console.log('👥 Usuarios con biometría habilitada:');
    usersWithBiometrics.forEach((user, index) => {
      console.log(`  ${index + 1}. Email: ${user.email}`);
      console.log(`     - Biometric enabled: ${user.biometric_enabled}`);
      console.log(`     - Legacy credential: ${user.biometric_credential_id ? 'Sí' : 'No'}`);
      console.log(`     - Authenticators: ${user.authenticators?.length || 0} dispositivos`);
      if (user.authenticators?.length > 0) {
        user.authenticators.forEach((auth, i) => {
          console.log(`       ${i + 1}. ID: ${auth.credentialId?.substring(0, 20)}...`);
          console.log(`          Dispositivo: ${auth.deviceName || 'Sin nombre'}`);
        });
      }
      console.log('');
    });
    
    if (usersWithBiometrics.length < 2) {
      console.log('⚠️  Se necesitan al menos 2 usuarios con biometría para probar el aislamiento');
      return;
    }
    
    // Probar el endpoint general (no debe devolver credenciales específicas)
    console.log('🔍 Probando endpoint general /quick-login...');
    try {
      const generalResponse = await axios.post(`${API_BASE}/auth/biometric/quick-login`);
      console.log('✅ Respuesta general recibida');
      console.log('   - Challenge presente:', !!generalResponse.data.challenge);
      console.log('   - allowCredentials incluido:', !!generalResponse.data.allowCredentials);
      
      if (generalResponse.data.allowCredentials) {
        console.log('⚠️  PROBLEMA: El endpoint general NO debería incluir allowCredentials');
      } else {
        console.log('✅ CORRECTO: El endpoint general no incluye credenciales específicas');
      }
    } catch (error) {
      console.log('❌ Error en endpoint general:', error.response?.data || error.message);
    }
    
    // Probar el endpoint específico por usuario
    console.log('\n🔍 Probando endpoint específico /login-challenge...');
    
    for (let i = 0; i < Math.min(usersWithBiometrics.length, 2); i++) {
      const user = usersWithBiometrics[i];
      console.log(`\n👤 Probando usuario: ${user.email}`);
      
      try {
        const userResponse = await axios.post(`${API_BASE}/auth/biometric/login-challenge`, {
          email: user.email
        });
        
        console.log('✅ Respuesta específica recibida');
        console.log('   - Challenge presente:', !!userResponse.data.challenge);
        console.log('   - allowCredentials incluido:', !!userResponse.data.allowCredentials);
        
        if (userResponse.data.allowCredentials) {
          console.log(`   - Número de credenciales: ${userResponse.data.allowCredentials.length}`);
          
          // Verificar que las credenciales coinciden con las del usuario
          const userCredentials = user.authenticators?.map(auth => auth.credentialId) || [];
          if (user.biometric_credential_id) {
            userCredentials.push(user.biometric_credential_id);
          }
          
          console.log(`   - Credenciales esperadas: ${userCredentials.length}`);
          console.log(`   - Credenciales devueltas: ${userResponse.data.allowCredentials.length}`);
          
          // Verificar que no hay credenciales de otros usuarios
          const otherUsers = usersWithBiometrics.filter(u => u.email !== user.email);
          let hasOtherUserCredentials = false;
          
          for (const otherUser of otherUsers) {
            const otherCredentials = otherUser.authenticators?.map(auth => auth.credentialId) || [];
            if (otherUser.biometric_credential_id) {
              otherCredentials.push(otherUser.biometric_credential_id);
            }
            
            for (const otherCred of otherCredentials) {
              const found = userResponse.data.allowCredentials.some(cred => cred.id === otherCred);
              if (found) {
                hasOtherUserCredentials = true;
                console.log(`❌ PROBLEMA: Encontrada credencial de ${otherUser.email} en respuesta de ${user.email}`);
              }
            }
          }
          
          if (!hasOtherUserCredentials) {
            console.log('✅ CORRECTO: Solo credenciales del usuario actual');
          }
          
        } else {
          console.log('⚠️  Usuario sin credenciales en la respuesta');
        }
        
      } catch (error) {
        console.log('❌ Error en endpoint específico:', error.response?.data || error.message);
      }
    }
    
    // Probar con usuario inexistente
    console.log('\n🔍 Probando con usuario inexistente...');
    try {
      const fakeResponse = await axios.post(`${API_BASE}/auth/biometric/login-challenge`, {
        email: 'usuario.inexistente@test.com'
      });
      console.log('⚠️  PROBLEMA: El endpoint debería fallar con usuario inexistente');
      console.log('   - Credenciales devueltas:', fakeResponse.data.allowCredentials?.length || 0);
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('✅ CORRECTO: Usuario inexistente retorna 404');
      } else {
        console.log('❓ Error inesperado:', error.response?.data || error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Error durante las pruebas:', error);
  }
}

async function main() {
  await connectDB();
  await testUserIsolation();
  
  console.log('\n🏁 Pruebas completadas');
  process.exit(0);
}

// Ejecutar directamente
main().catch(console.error);