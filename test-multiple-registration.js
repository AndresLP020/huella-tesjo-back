import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_BASE = 'http://localhost:3001/api';

/**
 * Script para probar el nuevo sistema de múltiples huellas
 */

async function testMultipleBiometricRegistration() {
  console.log('🧪 TESTING MÚLTIPLES REGISTROS BIOMÉTRICOS');
  console.log('==========================================\n');

  try {
    // 1. Verificar estado actual del usuario
    console.log('1️⃣ Verificando estado actual...');
    
    const userCheckResponse = await axios.post(`${API_BASE}/auth/biometric/check-user-devices`, {
      email: 'andreslopezpina187@gmail.com'
    });
    
    console.log('✅ Estado actual:', userCheckResponse.data);

    // 2. Simular intento de registro de nueva huella
    console.log('\n2️⃣ Simulando registro de nueva huella...');
    
    // Necesitamos un token válido para esto
    const loginResponse = await axios.post(`${API_BASE}/auth/login`, {
      email: 'andreslopezpina187@gmail.com',
      password: '123456' // Cambia por la contraseña correcta
    });
    
    if (!loginResponse.data.success) {
      console.log('❌ Error en login:', loginResponse.data.message);
      return;
    }

    const token = loginResponse.data.token;
    console.log('✅ Login exitoso, token obtenido');

    // 3. Intentar registro de nueva huella (simulado)
    console.log('\n3️⃣ Intentando registro de huella adicional...');
    
    const newCredentialId = 'TEST_CREDENTIAL_' + Date.now(); // ID único para prueba
    
    const registrationData = {
      publicKey: 'test_public_key_' + Date.now(),
      credentialId: newCredentialId,
      attestationObject: 'test_attestation',
      clientDataJSON: 'test_client_data'
    };
    
    try {
      const registerResponse = await axios.post(
        `${API_BASE}/auth/biometric/register`,
        registrationData,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (registerResponse.data.success) {
        console.log('🎉 Registro exitoso!');
        console.log('📱 Mensaje:', registerResponse.data.message);
        console.log('🆔 Nuevo dispositivo:', registerResponse.data.authenticator);
      } else {
        console.log('❌ Registro falló:', registerResponse.data.message);
      }
    } catch (registerError) {
      console.log('❌ Error en registro:', registerError.response?.data || registerError.message);
    }

    // 4. Verificar estado después del registro
    console.log('\n4️⃣ Verificando estado después del registro...');
    
    const statusResponse = await axios.get(`${API_BASE}/auth/biometric/status`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('📊 Estado biométrico:', statusResponse.data);

    // 5. Verificar dispositivos disponibles
    console.log('\n5️⃣ Verificando dispositivos disponibles...');
    
    const finalCheckResponse = await axios.post(`${API_BASE}/auth/biometric/check-user-devices`, {
      email: 'andreslopezpina187@gmail.com'
    });
    
    console.log('🔍 Check final:', finalCheckResponse.data);

  } catch (error) {
    console.error('❌ Error en el test:', error.response?.data || error.message);
  }
}

// Ejecutar test
testMultipleBiometricRegistration();