import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_BASE = 'http://localhost:3001/api';

/**
 * Script para probar el login biométrico desde el lado del servidor
 * Simula lo que haría el frontend
 */

async function testBiometricLogin() {
  console.log('🧪 TESTING BIOMETRIC LOGIN FLOW');
  console.log('================================\n');

  try {
    // 1. Verificar si el usuario tiene dispositivos registrados
    console.log('1️⃣ Verificando dispositivos del usuario...');
    
    const userCheckResponse = await axios.post(`${API_BASE}/auth/biometric/check-user-devices`, {
      email: 'andreslopezpina187@gmail.com'
    });
    
    console.log('✅ Respuesta verificación usuario:', userCheckResponse.data);
    
    if (!userCheckResponse.data.hasDevices) {
      console.log('❌ El usuario no tiene dispositivos biométricos registrados');
      return;
    }

    // 2. Obtener challenge para login
    console.log('\n2️⃣ Obteniendo challenge para login...');
    
    const challengeResponse = await axios.post(`${API_BASE}/auth/biometric/quick-login`);
    console.log('✅ Challenge obtenido:', challengeResponse.data);

    // 3. Simular credencial (esto normalmente lo haría el navegador)
    console.log('\n3️⃣ Simulando respuesta del dispositivo biométrico...');
    
    // Usar el credential ID que sabemos que está en la DB
    const credentialId = 'encEzFtcuNz-DAeN3F2S4sjLNOrAHCmDFNr45fJrDNA';
    
    console.log('🔑 Usando credential ID:', credentialId);
    
    // Datos simulados de autenticación (en la práctica estos vienen del WebAuthn API)
    const simulatedAuthData = {
      signature: 'simulated_signature_' + Date.now(),
      credentialId: credentialId,
      challenge: challengeResponse.data.challenge,
      authenticatorData: 'simulated_auth_data',
      clientDataJSON: 'simulated_client_data'
    };

    // 4. Intentar login
    console.log('\n4️⃣ Intentando login biométrico...');
    
    try {
      const loginResponse = await axios.put(`${API_BASE}/auth/biometric/quick-login`, simulatedAuthData);
      
      if (loginResponse.data.success) {
        console.log('🎉 LOGIN BIOMÉTRICO EXITOSO!');
        console.log('👤 Usuario logueado:', loginResponse.data.user.email);
        console.log('🔑 Token recibido:', loginResponse.data.token ? 'SÍ' : 'NO');
      } else {
        console.log('❌ Login falló:', loginResponse.data.message);
      }
    } catch (loginError) {
      console.log('❌ Error en login:', loginError.response?.data || loginError.message);
    }

  } catch (error) {
    console.error('❌ Error en el test:', error.response?.data || error.message);
  }
}

// Función adicional para verificar el estado de la DB
async function checkDatabaseState() {
  console.log('\n🔍 VERIFICANDO ESTADO DE LA BASE DE DATOS');
  console.log('=========================================\n');
  
  try {
    // Simular lo que hace debug-credentials.js pero desde axios
    console.log('Nota: Para ver el estado completo de la DB, ejecuta:');
    console.log('node debug-credentials.js');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Ejecutar tests
async function runAllTests() {
  await testBiometricLogin();
  await checkDatabaseState();
}

runAllTests();