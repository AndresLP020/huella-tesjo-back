import express from 'express';
import { markMultipleAssignmentsCompleted } from '../controllers/bulkActions.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// Ruta para marcar múltiples asignaciones como completadas
router.post('/assignments/mark-completed', verifyToken, markMultipleAssignmentsCompleted);

export default router;
