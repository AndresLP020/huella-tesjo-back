import express from 'express';
const router = express.Router();
import { auth } from '../middleware/auth.js';
import { upload, handleMulterError } from '../middleware/uploadMiddleware.js';
import {
    createAssignment,
    getAllAssignments,
    getUserAssignments,
    getUserDashboardStats,
    getAssignmentById,
    getFilteredAssignments,
    submitAssignmentResponse,
    updateAssignmentStatus,
    getTeacherAssignmentStats,
    getTeacherFilteredAssignments,
    markAssignmentCompleted,
    // Nuevas funciones para administrador
    getAdminAllAssignments,
    getAdminAssignmentStats,
    markAssignmentCompletedByAdmin,
    updateAssignmentByAdmin
} from '../controllers/assignmentController.js';

// Rutas para administradores
router.post('/', 
    auth, 
    upload.array('attachments', 5),
    handleMulterError,
    createAssignment
);

// Rutas específicas para administrador
router.get('/admin/all', auth, getAdminAllAssignments);
router.get('/admin/stats', auth, getAdminAssignmentStats);
router.patch('/admin/:assignmentId/complete', auth, markAssignmentCompletedByAdmin);
router.put('/admin/:assignmentId', auth, updateAssignmentByAdmin);

// Ruta temporal sin autenticación para pruebas
router.post('/test', 
    upload.array('attachments', 5),
    handleMulterError,
    async (req, res) => {
        try {
            // Simular usuario admin para la prueba
            req.user = { _id: '686adb66894909cadb9449bf' };
            await createAssignment(req, res);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
);

router.get('/all', auth, getAllAssignments);
router.patch('/:id/status', auth, updateAssignmentStatus);

// Rutas para docentes
router.get('/my-assignments', auth, getUserAssignments);
router.get('/dashboard-stats', auth, getUserDashboardStats);
router.get('/filtered', auth, getFilteredAssignments);

// Nuevas rutas específicas para docentes
router.get('/teacher/stats', auth, getTeacherAssignmentStats);
router.get('/teacher/assignments', auth, getTeacherFilteredAssignments);
router.patch('/teacher/:id/complete', auth, markAssignmentCompleted);

router.get('/:id', auth, getAssignmentById);
router.post('/:id/submit', 
    auth, 
    upload.array('files', 5),
    handleMulterError,
    submitAssignmentResponse
);

// Endpoint de debug para verificar headers
router.post('/debug-headers', (req, res) => {
    console.log('🔍 === DEBUG HEADERS ===');
    console.log('Headers:', req.headers);
    console.log('Authorization:', req.headers.authorization);
    console.log('Body:', req.body);
    
    res.json({
        success: true,
        message: 'Headers recibidos',
        headers: req.headers,
        hasAuth: !!req.headers.authorization,
        authHeader: req.headers.authorization
    });
});

// Endpoint para verificar el estado de autenticación desde frontend
router.get('/auth-status', (req, res) => {
    console.log('🔍 === AUTH STATUS CHECK ===');
    console.log('Headers recibidos:', req.headers);
    console.log('Authorization header:', req.headers.authorization);
    
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        console.log('❌ No hay header de autorización');
        return res.status(401).json({
            success: false,
            message: 'No hay token de autorización',
            hasAuth: false
        });
    }
    
    if (!authHeader.startsWith('Bearer ')) {
        console.log('❌ Formato de autorización incorrecto');
        return res.status(401).json({
            success: false,
            message: 'Formato de autorización incorrecto',
            hasAuth: true,
            authFormat: authHeader.substring(0, 20) + '...'
        });
    }
    
    const token = authHeader.split(' ')[1];
    console.log('✅ Token encontrado:', token ? 'Sí' : 'No');
    
    res.json({
        success: true,
        message: 'Token presente y con formato correcto',
        hasAuth: true,
        tokenLength: token ? token.length : 0
    });
});

export default router;