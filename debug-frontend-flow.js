import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';

/**
 * Script para debuggear paso a paso lo que debería pasar en el frontend
 */

async function debugFrontendFlow() {
  console.log('🔍 DEBUGGING FRONTEND BIOMETRIC FLOW');
  console.log('====================================\n');

  const email = 'andreslopezpina187@gmail.com';

  try {
    // 1. Verificar si el usuario tiene dispositivos (igual que el frontend)
    console.log('1️⃣ Verificando dispositivos del usuario (userHasBiometricDevices)...');
    
    const deviceCheckResponse = await axios.post(`${API_BASE}/auth/biometric/check-user-devices`, {
      email: email
    });
    
    console.log('✅ Respuesta check-user-devices:', deviceCheckResponse.data);
    console.log(`📱 Tiene dispositivos: ${deviceCheckResponse.data.hasDevices}`);
    
    if (!deviceCheckResponse.data.hasDevices) {
      console.log('❌ PROBLEMA: El usuario no tiene dispositivos registrados');
      console.log('💡 SOLUCIÓN: El usuario necesita registrar su huella primero');
      return;
    }

    // 2. Obtener challenge (primer paso del login biométrico)
    console.log('\n2️⃣ Obteniendo challenge para autenticación...');
    
    const challengeResponse = await axios.post(`${API_BASE}/auth/biometric/quick-login`);
    const { challenge, timeout, allowCredentials } = challengeResponse.data;
    
    console.log('✅ Challenge obtenido:', challenge);
    console.log('⏱️ Timeout:', timeout);
    console.log('🔑 Credenciales permitidas:', allowCredentials);

    // 3. Simular lo que hace navigator.credentials.get()
    console.log('\n3️⃣ Simulando navigator.credentials.get()...');
    console.log('📋 En el navegador se ejecutaría:');
    console.log(`
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: Uint8Array.from(atob('${challenge}'), c => c.charCodeAt(0)),
          timeout: ${timeout},
          userVerification: "required"
        }
      });
    `);

    // En lugar de usar el navegador, simulamos la respuesta
    console.log('🔄 Como no podemos ejecutar WebAuthn aquí, simularemos...');
    
    // Usar uno de los credential IDs permitidos
    const credentialToUse = allowCredentials && allowCredentials.length > 0 
      ? allowCredentials[0].id 
      : 'encEzFtcuNz-DAeN3F2S4sjLNOrAHCmDFNr45fJrDNA';
      
    console.log('🎯 Usando credential ID:', credentialToUse);

    // 4. Simular la respuesta de autenticación
    console.log('\n4️⃣ Simulando respuesta del dispositivo...');
    
    const simulatedAssertion = {
      id: credentialToUse,
      rawId: new ArrayBuffer(32), // Simulado
      response: {
        signature: new ArrayBuffer(64), // Simulado
        authenticatorData: new ArrayBuffer(37), // Simulado
        clientDataJSON: new ArrayBuffer(100) // Simulado
      }
    };

    // 5. Convertir a formato que espera el backend (igual que el frontend)
    console.log('\n5️⃣ Convirtiendo datos para el backend...');
    
    // Simular la conversión que hace webauthnService.js
    const authData = {
      signature: 'simulated_signature_base64',
      credentialId: credentialToUse,
      challenge: challenge,
      authenticatorData: 'simulated_auth_data_base64',
      clientDataJSON: 'simulated_client_data_base64'
    };
    
    console.log('📤 Datos a enviar:', authData);

    // 6. Enviar al backend
    console.log('\n6️⃣ Enviando al backend...');
    
    const authResponse = await axios.put(`${API_BASE}/auth/biometric/quick-login`, authData);
    
    if (authResponse.data.success) {
      console.log('🎉 ¡AUTENTICACIÓN EXITOSA!');
      console.log('👤 Usuario:', authResponse.data.user.email);
      console.log('💬 Mensaje:', authResponse.data.message);
    } else {
      console.log('❌ Autenticación falló:', authResponse.data.message);
    }

  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    
    if (error.response?.status === 404) {
      console.log('\n🔧 DIAGNÓSTICO:');
      console.log('- El credential ID no coincide con ninguno en la base de datos');
      console.log('- Posible causa: Diferencias en formato (base64 vs base64url)');
      console.log('- Solución: Verificar conversión de formatos en el frontend');
    }
  }
}

async function checkWebAuthnSupport() {
  console.log('\n🌐 VERIFICANDO SOPORTE WEBAUTHN');
  console.log('===============================');
  
  console.log('ℹ️ Este script no puede verificar WebAuthn directamente');
  console.log('📋 En el navegador deberías verificar:');
  console.log('   1. window.PublicKeyCredential !== undefined');
  console.log('   2. navigator.credentials !== undefined');
  console.log('   3. navigator.credentials.create !== undefined');
  console.log('   4. navigator.credentials.get !== undefined');
  console.log('\n💡 Para verificar en la consola del navegador:');
  console.log(`
    console.log('WebAuthn soportado:', !!window.PublicKeyCredential);
    
    if (PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then(available => console.log('Biométrico disponible:', available));
    }
  `);
}

// Ejecutar debugging
debugFrontendFlow()
  .then(() => checkWebAuthnSupport())
  .catch(console.error);