import mongoose from 'mongoose';
import User from './models/User.js';
import bcrypt from 'bcryptjs';

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

async function createTestUser() {
  console.log('\n🏗️  Creando segundo usuario de prueba...\n');
  
  try {
    const testEmail = 'test.user2@example.com';
    
    // Verificar si ya existe
    const existingUser = await User.findOne({ email: testEmail });
    if (existingUser) {
      console.log('👤 Usuario ya existe:', testEmail);
      console.log('   - Biometric enabled:', existingUser.biometric_enabled);
      console.log('   - Authenticators:', existingUser.authenticators?.length || 0);
      return existingUser;
    }
    
    // Crear usuario con datos básicos
    const hashedPassword = await bcrypt.hash('testpass123', 10);
    
    const newUser = new User({
      email: testEmail,
      password: hashedPassword,
      nombre: 'Usuario Test 2',
      apellidos: 'Prueba Biometría',
      rol: 'docente',
      biometric_enabled: true,
      authenticators: [
        {
          credentialId: 'fake_credential_id_user2_device1',
          publicKey: 'fake_public_key_data_1',
          counter: 0,
          deviceName: 'Dispositivo Test User2 #1',
          createdAt: new Date()
        },
        {
          credentialId: 'fake_credential_id_user2_device2', 
          publicKey: 'fake_public_key_data_2',
          counter: 0,
          deviceName: 'Dispositivo Test User2 #2',
          createdAt: new Date()
        }
      ]
    });
    
    await newUser.save();
    console.log('✅ Usuario creado exitosamente:', testEmail);
    console.log('   - Authenticators creados:', newUser.authenticators.length);
    
    newUser.authenticators.forEach((auth, index) => {
      console.log(`     ${index + 1}. ${auth.deviceName}: ${auth.credentialId}`);
    });
    
    return newUser;
    
  } catch (error) {
    console.error('❌ Error creando usuario:', error);
    throw error;
  }
}

async function showAllUsersWithBiometrics() {
  console.log('\n👥 Usuarios con biometría en el sistema:\n');
  
  const users = await User.find({
    $or: [
      { biometric_enabled: true },
      { 'authenticators.0': { $exists: true } }
    ]
  }).select('email biometric_enabled biometric_credential_id authenticators');
  
  users.forEach((user, index) => {
    console.log(`${index + 1}. ${user.email}`);
    console.log(`   - Biometric enabled: ${user.biometric_enabled}`);
    console.log(`   - Legacy credential: ${user.biometric_credential_id ? 'Sí' : 'No'}`);
    console.log(`   - Authenticators: ${user.authenticators?.length || 0}`);
    
    if (user.authenticators?.length > 0) {
      user.authenticators.forEach((auth, i) => {
        console.log(`     ${i + 1}. ${auth.deviceName}: ${auth.credentialId}`);
      });
    }
    console.log('');
  });
  
  return users;
}

async function main() {
  await connectDB();
  
  await createTestUser();
  const users = await showAllUsersWithBiometrics();
  
  console.log(`\n📊 Total de usuarios con biometría: ${users.length}`);
  console.log('🏁 Preparación completada. Ahora puedes ejecutar test-user-isolation.js');
  
  process.exit(0);
}

main().catch(console.error);